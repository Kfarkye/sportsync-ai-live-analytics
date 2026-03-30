import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

type MatchRow = {
  id: string;
  odds_api_event_id: string | null;
  league_id: string | null;
  start_time: string;
  home_team: unknown;
  away_team: unknown;
};

type EventRow = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
};

type OddsOutcome = {
  name: string;
  description?: string;
  price?: number;
  point?: number;
};

type OddsMarket = {
  key: string;
  outcomes: OddsOutcome[];
};

type OddsBookmaker = {
  key: string;
  title: string;
  markets: OddsMarket[];
};

type HistoricalEventsResponse = {
  timestamp: string;
  data?: EventRow[];
};

type HistoricalOddsResponse = {
  timestamp: string;
  data?: {
    bookmakers?: OddsBookmaker[];
  };
};

type PlayerStatsRow = {
  match_id: string;
  espn_player_id: string | null;
  player_name: string;
  team: string | null;
  opponent: string | null;
  minutes: number | null;
  is_dnp: boolean | null;
};

type PlayerLookupRow = {
  espnPlayerId: string | null;
  team: string | null;
  opponent: string | null;
  minutes: number;
};

type CliOptions = {
  startDate: string;
  endDate: string;
  sleepMs: number;
  dryRun: boolean;
  skipRefresh: boolean;
  limitDates: number | null;
};

type BackfillStats = {
  datesProcessed: number;
  eventsDiscovered: number;
  eventsMatched: number;
  eventsUnmatched: number;
  oddsFetchErrors: number;
  rowsPrepared: number;
  rowsUpserted: number;
  upsertBatches: number;
  upsertErrors: number;
};

const BASE_URL = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'basketball_nba';
const TARGET_MARKETS = [
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_points_rebounds_assists',
] as const;
const BOOK_PRIORITY = ['draftkings', 'fanduel', 'bovada', 'betmgm'];
const MARKET_TO_BET_TYPE: Record<string, string> = {
  player_points: 'points',
  player_rebounds: 'rebounds',
  player_assists: 'assists',
  player_threes: 'threes_made',
  player_points_rebounds_assists: 'pra',
};
const UPSERT_BATCH_SIZE = 500;

function loadLocalEnv() {
  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;

    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const firstEq = line.indexOf('=');
      if (firstEq <= 0) continue;

      const key = line.slice(0, firstEq).trim();
      const value = line.slice(firstEq + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    startDate: '2025-10-22',
    endDate: '2026-01-03',
    sleepMs: 500,
    dryRun: false,
    skipRefresh: false,
    limitDates: null,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    if (arg === '--skip-refresh') out.skipRefresh = true;

    if (arg.startsWith('--start=')) out.startDate = arg.slice('--start='.length);
    if (arg.startsWith('--end=')) out.endDate = arg.slice('--end='.length);

    if (arg.startsWith('--sleep-ms=')) {
      const v = Number(arg.slice('--sleep-ms='.length));
      if (Number.isFinite(v) && v >= 0) out.sleepMs = v;
    }

    if (arg.startsWith('--limit-dates=')) {
      const v = Number(arg.slice('--limit-dates='.length));
      if (Number.isFinite(v) && v > 0) out.limitDates = Math.floor(v);
    }
  }

  return out;
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function teamNameFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const candidates = [
      rec.name,
      rec.displayName,
      rec.shortDisplayName,
      rec.short_name,
      rec.abbreviation,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return '';
}

function dateOnlyUtc(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    result.push(d.toISOString().slice(0, 10));
  }

  return result;
}

function buildDateTeamKey(date: string, homeTeam: string, awayTeam: string): string {
  return `${date}|${normalizeName(homeTeam)}|${normalizeName(awayTeam)}`;
}

function buildClosingSnapshotTime(commenceTime: string): string {
  const ts = new Date(new Date(commenceTime).getTime() - 2 * 60 * 1000);
  return ts.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mainlineOddsDistance(americanOdds: number): number {
  return Math.abs(Math.abs(americanOdds) - 110);
}

async function fetchHistoricalEvents(oddsApiKey: string, date: string): Promise<EventRow[]> {
  const dateParam = `${date}T12:00:00Z`;
  const anchorMs = Date.parse(`${date}T12:00:00Z`);
  const windowMs = 36 * 60 * 60 * 1000;
  const url =
    `${BASE_URL}/historical/sports/${SPORT_KEY}/events` +
    `?apiKey=${oddsApiKey}&date=${encodeURIComponent(dateParam)}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Events endpoint failed (${res.status}): ${body}`);
  }

  const payload = (await res.json()) as HistoricalEventsResponse;
  const events = payload.data ?? [];
  return events.filter((evt) => {
    const commenceMs = Date.parse(evt.commence_time);
    if (!Number.isFinite(commenceMs)) return false;
    return Math.abs(commenceMs - anchorMs) <= windowMs;
  });
}

async function fetchHistoricalOdds(
  oddsApiKey: string,
  eventId: string,
  snapshotIso: string,
): Promise<HistoricalOddsResponse | null> {
  const markets = TARGET_MARKETS.join(',');
  const url =
    `${BASE_URL}/historical/sports/${SPORT_KEY}/events/${eventId}/odds` +
    `?apiKey=${oddsApiKey}&date=${encodeURIComponent(snapshotIso)}` +
    `&regions=us&markets=${markets}&oddsFormat=american`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    console.error(`[Odds] ${eventId} ${snapshotIso} failed (${res.status}) ${body}`);
    return null;
  }

  return (await res.json()) as HistoricalOddsResponse;
}

function pickPreferredBookmakerForMarket(
  bookmakers: OddsBookmaker[],
  marketKey: string,
): { book: OddsBookmaker; market: OddsMarket } | null {
  const candidates = bookmakers
    .map((book) => ({
      book,
      market: book.markets.find((m) => m.key === marketKey),
      rank: BOOK_PRIORITY.indexOf(book.key),
    }))
    .filter((x) => x.market && x.market.outcomes.length > 0)
    .sort((a, b) => {
      const ra = a.rank === -1 ? 999 : a.rank;
      const rb = b.rank === -1 ? 999 : b.rank;
      return ra - rb;
    });

  if (!candidates.length) return null;
  return { book: candidates[0].book, market: candidates[0].market as OddsMarket };
}

function chooseCanonicalPlayerName(outcome: OddsOutcome): string | null {
  const fromDescription = (outcome.description ?? '').trim();
  if (fromDescription) return fromDescription;

  const fromName = (outcome.name ?? '').trim();
  if (!fromName) return null;

  if (fromName.toLowerCase() === 'over' || fromName.toLowerCase() === 'under') {
    return null;
  }

  return fromName;
}

function buildPropRowsForEvent(args: {
  matchId: string;
  leagueValue: string;
  eventDate: string;
  bookmakers: OddsBookmaker[];
  playerLookup: Map<string, PlayerLookupRow>;
  availableColumns: Set<string>;
}) {
  const { matchId, leagueValue, eventDate, bookmakers, playerLookup, availableColumns } = args;
  const deduped = new Map<string, Record<string, unknown>>();
  const dedupeScore = new Map<string, number>();

  for (const marketKey of TARGET_MARKETS) {
    const selected = pickPreferredBookmakerForMarket(bookmakers, marketKey);
    if (!selected) continue;

    const { book, market } = selected;
    const betType = MARKET_TO_BET_TYPE[marketKey];
    if (!betType) continue;

    for (const outcome of market.outcomes) {
      const sideRaw = (outcome.name ?? '').toLowerCase();
      if (sideRaw !== 'over' && sideRaw !== 'under') continue;

      const playerName = chooseCanonicalPlayerName(outcome);
      if (!playerName) continue;

      const lineValue = numberOrNull(outcome.point);
      const oddsAmerican = numberOrNull(outcome.price);
      if (lineValue === null || oddsAmerican === null) continue;

      const playerRef = playerLookup.get(`${matchId}|${normalizeName(playerName)}`);

      const row: Record<string, unknown> = {
        match_id: matchId,
        player_name: playerName,
        bet_type: betType,
        line_value: lineValue,
        odds_american: Math.trunc(oddsAmerican),
        side: sideRaw,
        market_label: `${marketKey.replace(/_/g, ' ').toUpperCase()} ${lineValue}`,
        provider: book.key,
        sportsbook: book.title,
        event_date: eventDate,
        league: leagueValue,
      };

      if (availableColumns.has('player_id')) row.player_id = playerRef?.espnPlayerId ?? null;
      if (availableColumns.has('espn_player_id')) row.espn_player_id = playerRef?.espnPlayerId ?? null;
      if (availableColumns.has('team')) row.team = playerRef?.team ?? null;
      if (availableColumns.has('opponent')) row.opponent = playerRef?.opponent ?? null;

      const dedupeKey = [
        matchId,
        normalizeName(playerName),
        betType,
        sideRaw,
        book.key,
      ].join('|');
      const score = mainlineOddsDistance(Math.trunc(oddsAmerican));
      const existingScore = dedupeScore.get(dedupeKey);

      if (existingScore === undefined || score < existingScore) {
        dedupeScore.set(dedupeKey, score);
        deduped.set(dedupeKey, row);
      }
    }
  }

  return Array.from(deduped.values());
}

async function loadAllMatches(
  supabase: ReturnType<typeof createClient>,
  startDate: string,
  endDate: string,
): Promise<MatchRow[]> {
  const startIso = `${startDate}T00:00:00Z`;
  const endExclusive = new Date(`${endDate}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const { data, error } = await supabase
    .from('matches')
    .select('id,odds_api_event_id,league_id,start_time,home_team,away_team')
    .eq('league_id', 'nba')
    .gte('start_time', startIso)
    .lt('start_time', endExclusive.toISOString())
    .order('start_time', { ascending: true });

  if (error) throw new Error(`Failed to load matches: ${error.message}`);
  return (data ?? []) as MatchRow[];
}

async function loadPlayerLookup(
  supabase: ReturnType<typeof createClient>,
  startDate: string,
  endDate: string,
): Promise<Map<string, PlayerLookupRow>> {
  const out = new Map<string, PlayerLookupRow>();

  const pageSize = 1000;
  let offset = 0;

  for (;;) {
    const to = offset + pageSize - 1;
    const { data, error } = await supabase
      .from('player_game_stats')
      .select('match_id,espn_player_id,player_name,team,opponent,minutes,is_dnp')
      .eq('league_id', 'nba')
      .gte('game_date', startDate)
      .lte('game_date', endDate)
      .range(offset, to);

    if (error) throw new Error(`Failed loading player_game_stats at offset ${offset}: ${error.message}`);

    const rows = (data ?? []) as PlayerStatsRow[];
    if (!rows.length) break;

    for (const row of rows) {
      if (row.is_dnp === true) continue;
      const nameKey = normalizeName(row.player_name || '');
      if (!nameKey) continue;

      const key = `${row.match_id}|${nameKey}`;
      const existing = out.get(key);
      const minutes = Number.isFinite(Number(row.minutes)) ? Number(row.minutes) : 0;
      const candidate: PlayerLookupRow = {
        espnPlayerId: row.espn_player_id,
        team: row.team,
        opponent: row.opponent,
        minutes,
      };

      // Keep the record with more minutes, usually the strongest identity row.
      if (!existing || candidate.minutes > existing.minutes) {
        out.set(key, candidate);
      }
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return out;
}

async function detectAvailablePropColumns(
  supabase: ReturnType<typeof createClient>,
): Promise<Set<string>> {
  const { data, error } = await supabase.from('player_prop_bets').select('*').limit(1);
  if (error) {
    throw new Error(`Unable to introspect player_prop_bets columns: ${error.message}`);
  }

  const keys = new Set<string>();
  if (data && data.length > 0) {
    for (const k of Object.keys(data[0] as Record<string, unknown>)) keys.add(k);
  }

  // Fallback defaults for empty table.
  if (!keys.size) {
    [
      'match_id',
      'player_id',
      'player_name',
      'bet_type',
      'line_value',
      'odds_american',
      'side',
      'market_label',
      'provider',
      'sportsbook',
      'event_date',
      'league',
      'team',
      'opponent',
      'espn_player_id',
    ].forEach((k) => keys.add(k));
  }

  return keys;
}

async function runRefreshRpc(
  supabase: ReturnType<typeof createClient>,
  fnName: 'refresh_player_prop_outcomes' | 'refresh_prop_hit_rate_cache',
) {
  const withNullArg = await supabase.rpc(fnName, { p_since_date: null });
  if (!withNullArg.error) return withNullArg.data;

  const withoutArgs = await supabase.rpc(fnName, {});
  if (!withoutArgs.error) return withoutArgs.data;

  throw new Error(
    `${fnName} failed: ${withNullArg.error.message} | fallback failed: ${withoutArgs.error.message}`,
  );
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));

  if (!isValidDateInput(options.startDate) || !isValidDateInput(options.endDate)) {
    throw new Error('Invalid date format. Use YYYY-MM-DD, e.g. --start=2025-10-22 --end=2026-01-03');
  }
  if (options.startDate > options.endDate) {
    throw new Error('start date cannot be after end date');
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'https://qffzvrnbzabcokqqrwbv.supabase.co';

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    '';

  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  const supabaseKey = serviceRoleKey || anonKey;

  const oddsApiKey = process.env.ODDS_API_KEY || process.env.VITE_ODDS_API_KEY || '';

  if (!supabaseKey) {
    throw new Error('Missing Supabase key. Set SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY.');
  }
  if (!oddsApiKey) {
    throw new Error('Missing ODDS_API_KEY. Set it in environment before running this backfill.');
  }

  const usingServiceRole = Boolean(serviceRoleKey);
  if (!usingServiceRole) {
    console.warn('[WARN] Running without service-role key. Upserts or RPC calls may fail under RLS.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  console.log('=== Historical NBA Prop Backfill ===');
  console.log(`Range: ${options.startDate} -> ${options.endDate}`);
  console.log(`Dry run: ${options.dryRun ? 'yes' : 'no'}`);
  console.log(`Skip refresh: ${options.skipRefresh ? 'yes' : 'no'}`);
  console.log(`Sleep ms: ${options.sleepMs}`);
  console.log(`Supabase auth: ${usingServiceRole ? 'service_role' : 'anon'}`);

  const allMatches = await loadAllMatches(supabase, options.startDate, options.endDate);
  const availableColumns = await detectAvailablePropColumns(supabase);
  const playerLookup = await loadPlayerLookup(supabase, options.startDate, options.endDate);

  console.log(`Loaded ${allMatches.length} NBA matches in target range.`);
  console.log(`Loaded ${playerLookup.size} player identity rows from player_game_stats.`);

  const byEventId = new Map<string, MatchRow>();
  const byDateTeamKey = new Map<string, MatchRow>();

  for (const match of allMatches) {
    if (match.odds_api_event_id) {
      byEventId.set(match.odds_api_event_id, match);
    }

    const home = teamNameFromUnknown(match.home_team);
    const away = teamNameFromUnknown(match.away_team);
    if (home && away) {
      const key = buildDateTeamKey(dateOnlyUtc(match.start_time), home, away);
      byDateTeamKey.set(key, match);
    }
  }

  let dateList = enumerateDates(options.startDate, options.endDate);
  if (options.limitDates) {
    dateList = dateList.slice(0, options.limitDates);
  }

  const stats: BackfillStats = {
    datesProcessed: 0,
    eventsDiscovered: 0,
    eventsMatched: 0,
    eventsUnmatched: 0,
    oddsFetchErrors: 0,
    rowsPrepared: 0,
    rowsUpserted: 0,
    upsertBatches: 0,
    upsertErrors: 0,
  };

  for (const date of dateList) {
    stats.datesProcessed += 1;
    console.log(`\n[${stats.datesProcessed}/${dateList.length}] Processing ${date}`);

    let events: EventRow[] = [];
    try {
      events = await fetchHistoricalEvents(oddsApiKey, date);
    } catch (err) {
      console.error(`[Events] ${date} failed: ${String(err)}`);
      continue;
    }

    stats.eventsDiscovered += events.length;
    console.log(`[Events] Found ${events.length} historical events`);

    for (const evt of events) {
      const matchFromEvent = byEventId.get(evt.id);
      const eventDate = dateOnlyUtc(evt.commence_time);
      const fallbackKey = buildDateTeamKey(eventDate, evt.home_team, evt.away_team);
      const match = matchFromEvent ?? byDateTeamKey.get(fallbackKey) ?? null;

      if (!match) {
        stats.eventsUnmatched += 1;
        console.warn(`[Match] Unmatched Odds API event ${evt.id}: ${evt.away_team} @ ${evt.home_team} (${eventDate})`);
        continue;
      }

      stats.eventsMatched += 1;

      const snapshotTs = buildClosingSnapshotTime(match.start_time || evt.commence_time);
      const odds = await fetchHistoricalOdds(oddsApiKey, evt.id, snapshotTs);
      if (!odds?.data?.bookmakers?.length) {
        stats.oddsFetchErrors += 1;
        await sleep(options.sleepMs);
        continue;
      }

      const rows = buildPropRowsForEvent({
        matchId: match.id,
        leagueValue: 'nba',
        eventDate: dateOnlyUtc(match.start_time),
        bookmakers: odds.data.bookmakers,
        playerLookup,
        availableColumns,
      });

      stats.rowsPrepared += rows.length;

      if (!rows.length) {
        await sleep(options.sleepMs);
        continue;
      }

      if (options.dryRun) {
        console.log(`[DryRun] ${match.id} (${evt.away_team} @ ${evt.home_team}) -> ${rows.length} rows`);
      } else {
        for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
          const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
          stats.upsertBatches += 1;

          const { error } = await supabase
            .from('player_prop_bets')
            .upsert(batch, { onConflict: 'match_id,player_name,bet_type,side,provider' });

          if (error) {
            stats.upsertErrors += 1;
            console.error(`[Upsert] ${match.id} batch ${stats.upsertBatches} failed: ${error.message}`);
          } else {
            stats.rowsUpserted += batch.length;
          }
        }
      }

      await sleep(options.sleepMs);
    }
  }

  console.log('\n=== Backfill Summary ===');
  console.log(JSON.stringify(stats, null, 2));

  if (!options.dryRun && !options.skipRefresh) {
    console.log('\nRunning refresh_player_prop_outcomes(NULL)...');
    const outcomesRefresh = await runRefreshRpc(supabase, 'refresh_player_prop_outcomes');
    console.log(`refresh_player_prop_outcomes response: ${JSON.stringify(outcomesRefresh)}`);

    console.log('Running refresh_prop_hit_rate_cache(NULL)...');
    const cacheRefresh = await runRefreshRpc(supabase, 'refresh_prop_hit_rate_cache');
    console.log(`refresh_prop_hit_rate_cache response: ${JSON.stringify(cacheRefresh)}`);
  }

  const earliest = await supabase
    .from('player_prop_bets')
    .select('event_date')
    .in('league', ['nba', 'NBA'])
    .order('event_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  const latest = await supabase
    .from('player_prop_bets')
    .select('event_date')
    .in('league', ['nba', 'NBA'])
    .order('event_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const totalRows = await supabase
    .from('player_prop_bets')
    .select('*', { count: 'exact', head: true })
    .in('league', ['nba', 'NBA'])
    .gte('event_date', options.startDate)
    .lte('event_date', options.endDate);

  if (earliest.error || latest.error || totalRows.error) {
    console.warn('[Validation] Could not compute coverage summary from player_prop_bets');
    if (earliest.error) console.warn(`[Validation] earliest query error: ${earliest.error.message}`);
    if (latest.error) console.warn(`[Validation] latest query error: ${latest.error.message}`);
    if (totalRows.error) console.warn(`[Validation] count query error: ${totalRows.error.message}`);
  } else {
    console.log('\n=== Coverage Check (NBA) ===');
    console.log(
      JSON.stringify(
        {
          earliest_event_date: earliest.data?.event_date ?? null,
          latest_event_date: latest.data?.event_date ?? null,
          rows_in_target_range: totalRows.count ?? null,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
