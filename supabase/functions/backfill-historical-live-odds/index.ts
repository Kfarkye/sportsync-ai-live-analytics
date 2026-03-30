import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BASE = 'https://api.the-odds-api.com/v4';

if (!ODDS_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing required env vars: ODDS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

interface BookmakerMarket {
  key: string;
  last_update: string;
  outcomes: Array<{
    name: string;
    price: number;
    point?: number;
    description?: string;
  }>;
}

interface Bookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: BookmakerMarket[];
}

interface HistoricalOddsResponse {
  timestamp: string;
  previous_timestamp: string | null;
  next_timestamp: string | null;
  data: {
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: Bookmaker[];
  };
}

interface HistoricalEventsResponse {
  timestamp: string;
  data: Array<{
    id: string;
    sport_key: string;
    commence_time: string;
    home_team: string;
    away_team: string;
  }>;
}

interface ScoreTimelinePoint {
  minute: number;
  home_score: number;
  away_score: number;
}

interface BackfillRequest {
  mode?: 'historical' | 'recent_live_repair' | 'rolling_historical_closure' | 'repair_historical_sport_labels';
  sport_key?: string;
  match_id?: string;
  league_id?: string;
  home_team?: string;
  away_team?: string;
  kickoff_utc?: string;
  interval_min?: number;
  duration_min?: number;
  regions?: string;
  score_timeline?: ScoreTimelinePoint[];
  odds_event_id?: string;
  window_minutes?: number;
  leagues?: string[];
  snapshot_stale_seconds?: number;
  repair_window_hours?: number;
  window_hours?: number;
  limit_games?: number;
}

function inferSportFromOddsKey(sportKey: string): string {
  const key = String(sportKey || '').toLowerCase();
  if (key.startsWith('basketball_')) return 'basketball';
  if (key.startsWith('baseball_')) return 'baseball';
  if (key.startsWith('icehockey_')) return 'icehockey';
  if (key.startsWith('americanfootball_')) return 'americanfootball';
  if (key.startsWith('soccer_')) return 'soccer';
  if (key.startsWith('tennis_')) return 'tennis';
  return 'unknown';
}

const LEAGUE_TO_ODDS_SPORT_KEY: Record<string, string> = {
  nba: 'basketball_nba',
  ncaamb: 'basketball_ncaab',
  mlb: 'baseball_mlb',
  nhl: 'icehockey_nhl',
  nfl: 'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  epl: 'soccer_epl',
  mls: 'soccer_usa_mls',
  'uefa.champions': 'soccer_uefa_champs_league',
  'uefa.europa': 'soccer_uefa_europa_league',
  'fifa.friendly': 'soccer_fifa_world_cup',
};

const LEAGUE_TO_CANONICAL_SPORT: Record<string, string> = {
  nba: 'basketball',
  ncaamb: 'basketball',
  mlb: 'baseball',
  nhl: 'icehockey',
  nfl: 'americanfootball',
  ncaaf: 'americanfootball',
  epl: 'soccer',
  mls: 'soccer',
  'uefa.champions': 'soccer',
  'uefa.europa': 'soccer',
  'fifa.friendly': 'soccer',
};

function inferOddsSportKeyFromLeagueId(leagueId: string | null | undefined): string | null {
  const key = String(leagueId || '').trim().toLowerCase();
  if (!key) return null;
  return LEAGUE_TO_ODDS_SPORT_KEY[key] ?? null;
}

async function safeInsertReliabilityLog(payload: Record<string, unknown>) {
  try {
    const { error } = await sb.from('live_pipeline_reliability_logs').insert(payload);
    if (error) {
      console.warn('[live_pipeline_reliability_logs] insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[live_pipeline_reliability_logs] insert exception:', String(err));
  }
}

function americanOdds(decimal: number): number {
  if (!decimal || decimal <= 1) return 0;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findOddsApiEventId(
  sportKey: string,
  date: string,
  homeTeam: string,
  awayTeam: string
): Promise<string | null> {
  const url = `${BASE}/historical/sports/${sportKey}/events?apiKey=${ODDS_API_KEY}&date=${date}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Events lookup failed: ${res.status} ${await res.text()}`);
    return null;
  }

  const body: HistoricalEventsResponse = await res.json();
  const homeNorm = normalizeName(homeTeam);
  const awayNorm = normalizeName(awayTeam);

  for (const evt of body.data ?? []) {
    const evtHome = normalizeName(evt.home_team);
    const evtAway = normalizeName(evt.away_team);
    if ((evtHome.includes(homeNorm) || homeNorm.includes(evtHome)) && (evtAway.includes(awayNorm) || awayNorm.includes(evtAway))) {
      return evt.id;
    }
  }

  console.log('Available events:', (body.data ?? []).map((evt) => `${evt.home_team} v ${evt.away_team} (${evt.id})`));
  return null;
}

async function fetchHistoricalOdds(
  sportKey: string,
  eventId: string,
  date: string,
  regions = 'us,eu',
  markets = 'h2h,spreads,totals'
): Promise<HistoricalOddsResponse | null> {
  const url =
    `${BASE}/historical/sports/${sportKey}/events/${eventId}/odds` +
    `?apiKey=${ODDS_API_KEY}&date=${date}&regions=${regions}` +
    `&markets=${markets}&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    console.error(`Odds fetch failed at ${date}: ${res.status} ${txt}`);
    return null;
  }
  return await res.json();
}

function findOutcomeByName(
  outcomes: Array<{ name: string; price: number; point?: number }>,
  teamName: string
) {
  const normalizedTeam = normalizeName(teamName);
  return outcomes.find((o) => normalizeName(o.name) === normalizedTeam) ?? null;
}

function extractRows(
  snapshot: HistoricalOddsResponse,
  sport: string,
  matchId: string,
  leagueId: string,
  homeTeam: string,
  awayTeam: string,
  homeScore: number | null,
  awayScore: number | null,
  clock: string | null
) {
  const rows: Record<string, unknown>[] = [];
  const capturedAt = snapshot.timestamp;

  for (const bk of snapshot.data.bookmakers ?? []) {
    const h2h = bk.markets.find((m) => m.key === 'h2h');
    const spreads = bk.markets.find((m) => m.key === 'spreads');
    const totals = bk.markets.find((m) => m.key === 'totals');

    let homeML: number | null = null;
    let awayML: number | null = null;
    let drawML: number | null = null;
    if (h2h) {
      const ho = findOutcomeByName(h2h.outcomes, homeTeam);
      const ao = findOutcomeByName(h2h.outcomes, awayTeam);
      const dr = h2h.outcomes.find((o) => o.name.toLowerCase() === 'draw');
      if (ho) homeML = americanOdds(ho.price);
      if (ao) awayML = americanOdds(ao.price);
      if (dr) drawML = americanOdds(dr.price);
    }

    let spreadHome: number | null = null;
    let spreadAway: number | null = null;
    let spreadHomePrice: number | null = null;
    let spreadAwayPrice: number | null = null;
    if (spreads) {
      const sh = findOutcomeByName(spreads.outcomes, homeTeam);
      const sa = findOutcomeByName(spreads.outcomes, awayTeam);
      if (sh) {
        spreadHome = sh.point ?? null;
        spreadHomePrice = americanOdds(sh.price);
      }
      if (sa) {
        spreadAway = sa.point ?? null;
        spreadAwayPrice = americanOdds(sa.price);
      }
    }

    let total: number | null = null;
    let overPrice: number | null = null;
    let underPrice: number | null = null;
    if (totals) {
      const ov = totals.outcomes.find((o) => o.name.toLowerCase() === 'over');
      const un = totals.outcomes.find((o) => o.name.toLowerCase() === 'under');
      if (ov) {
        total = ov.point ?? null;
        overPrice = americanOdds(ov.price);
      }
      if (un) {
        underPrice = americanOdds(un.price);
      }
    }

    rows.push({
      match_id: matchId,
      sport,
      league_id: leagueId,
      provider: bk.title,
      provider_id: bk.key,
      market_type: 'historical_backfill',
      captured_at: capturedAt,
      status: homeScore !== null ? 'STATUS_IN_PROGRESS' : 'STATUS_PREGAME',
      period: null,
      clock,
      home_score: homeScore,
      away_score: awayScore,
      home_team: homeTeam,
      away_team: awayTeam,
      home_ml: homeML,
      away_ml: awayML,
      draw_ml: drawML,
      spread_home: spreadHome,
      spread_away: spreadAway,
      spread_home_price: spreadHomePrice,
      spread_away_price: spreadAwayPrice,
      total,
      over_price: overPrice,
      under_price: underPrice,
      is_live: homeScore !== null,
      source: 'odds_api_historical',
      raw_payload: snapshot.data,
    });
  }
  return rows;
}

function extractCurrentOddsSnapshot(odds: any) {
  const homeMl = parseInt(String(
    odds?.main?.h2h?.home?.price
    ?? odds?.homeML
    ?? odds?.homeWin
    ?? odds?.home_ml
    ?? ''
  ), 10);
  const awayMl = parseInt(String(
    odds?.main?.h2h?.away?.price
    ?? odds?.awayML
    ?? odds?.awayWin
    ?? odds?.away_ml
    ?? ''
  ), 10);
  const total = Number(
    odds?.main?.total?.line
    ?? odds?.total
    ?? odds?.overUnder
    ?? NaN
  );
  const spreadHome = Number(
    odds?.main?.spread?.home?.point
    ?? odds?.homeSpread
    ?? odds?.spread
    ?? NaN
  );
  const spreadAway = Number(
    odds?.main?.spread?.away?.point
    ?? odds?.awaySpread
    ?? (Number.isFinite(spreadHome) ? -spreadHome : NaN)
  );

  return {
    homeMl: Number.isFinite(homeMl) ? homeMl : null,
    awayMl: Number.isFinite(awayMl) ? awayMl : null,
    total: Number.isFinite(total) ? total : null,
    spreadHome: Number.isFinite(spreadHome) ? spreadHome : null,
    spreadAway: Number.isFinite(spreadAway) ? spreadAway : null,
    provider: String(odds?.market_source_book ?? odds?.provider ?? '').trim(),
  };
}

function isStarted(status: string | null | undefined, startTime: string | null | undefined) {
  const s = String(status || '').toUpperCase();
  if (s.includes('IN_PROGRESS') || s.includes('LIVE') || s.includes('HALF') || s.includes('FINAL') || s.includes('POST')) return true;
  const t = new Date(String(startTime || '')).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= (Date.now() - 5 * 60 * 1000);
}

function isInProgress(status: string | null | undefined) {
  const s = String(status || '').toUpperCase();
  return s.includes('IN_PROGRESS') || s.includes('LIVE') || s.includes('HALF');
}

async function runRecentLiveRepair(body: BackfillRequest) {
  const windowMinutes = Math.max(30, Number(body.window_minutes || 240));
  const staleSeconds = Math.max(30, Number(body.snapshot_stale_seconds || 90));
  const leagues = Array.isArray(body.leagues) ? body.leagues.map((x) => String(x).trim()).filter(Boolean) : [];

  const windowStartIso = new Date(Date.now() - (windowMinutes * 60000)).toISOString();
  const windowEndIso = new Date(Date.now() + (30 * 60000)).toISOString();

  let query = sb
    .from('matches')
    .select('id,league_id,sport,status,start_time,home_team,away_team,home_score,away_score,period,display_clock,current_odds')
    .gte('start_time', windowStartIso)
    .lte('start_time', windowEndIso)
    .order('start_time', { ascending: true });

  if (leagues.length > 0) query = query.in('league_id', leagues);
  const { data: matches, error: matchErr } = await query;
  if (matchErr) throw new Error(`recent_live_repair matches query failed: ${matchErr.message}`);

  const stats = {
    mode: 'recent_live_repair',
    window_minutes: windowMinutes,
    stale_seconds: staleSeconds,
    scanned_games: 0,
    started_games: 0,
    missing_games: 0,
    stale_games: 0,
    repaired_games: 0,
    degraded_repairs: 0,
    skipped_fresh: 0,
    errors: 0,
    detail: [] as string[],
  };

  for (const match of (matches || [])) {
    stats.scanned_games++;
    if (!isStarted(match.status, match.start_time)) continue;
    stats.started_games++;

    const { data: stateRow } = await sb
      .from('live_game_state')
      .select('period,clock,home_score,away_score')
      .eq('id', match.id)
      .maybeSingle();

    const { data: latestSnapshot } = await sb
      .from('live_odds_snapshots')
      .select('captured_at,provider,total,home_ml,away_ml,spread_home,spread_away')
      .eq('match_id', match.id)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const snapshotAgeSec = latestSnapshot?.captured_at
      ? Math.max(0, Math.floor((Date.now() - new Date(latestSnapshot.captured_at).getTime()) / 1000))
      : null;
    const stale = isInProgress(match.status) && (snapshotAgeSec === null || snapshotAgeSec > staleSeconds);
    const missing = latestSnapshot == null;
    const needsStateRepair = !stateRow;

    if (!missing && !stale && !needsStateRepair) {
      stats.skipped_fresh++;
      continue;
    }
    if (missing) stats.missing_games++;
    if (stale) stats.stale_games++;

    const market = extractCurrentOddsSnapshot(match.current_odds || {});
    const hasMarketData = market.total != null || market.homeMl != null || market.awayMl != null || market.spreadHome != null || market.spreadAway != null;
    const shouldWriteSnapshot = missing || stale;
    if (shouldWriteSnapshot && !hasMarketData) stats.degraded_repairs++;
    const nowIso = new Date().toISOString();
    const liveStatePayload: any = {
      id: match.id,
      league_id: match.league_id,
      sport: match.sport,
      game_status: match.status ?? 'STATUS_SCHEDULED',
      period: stateRow?.period ?? match.period ?? null,
      clock: stateRow?.clock ?? match.display_clock ?? null,
      home_score: stateRow?.home_score ?? match.home_score ?? 0,
      away_score: stateRow?.away_score ?? match.away_score ?? 0,
      odds: { current: match.current_odds ?? null },
      extra_data: {
        capture_mode: 'repair',
        capture_source: 'recent_live_repair',
        capture_reason: missing ? 'missing_snapshot' : (stale ? 'stale_snapshot' : 'missing_state'),
        repaired_at: nowIso,
      },
      updated_at: nowIso,
    };

    const { error: stateErr } = await sb.from('live_game_state').upsert(liveStatePayload, { onConflict: 'id' });
    if (stateErr) {
      stats.errors++;
      stats.detail.push(`${match.id}: LIVE_STATE_ERROR ${stateErr.message}`);
    }

    if (!shouldWriteSnapshot) {
      if (!stateErr) {
        stats.repaired_games++;
        stats.detail.push(`${match.id}: state_refreshed`);
      }
      continue;
    }

    const payload: any = {
      match_id: match.id,
      league_id: match.league_id,
      sport: match.sport,
      status: match.status,
      period: stateRow?.period ?? match.period ?? null,
      clock: stateRow?.clock ?? match.display_clock ?? null,
      home_score: stateRow?.home_score ?? match.home_score ?? 0,
      away_score: stateRow?.away_score ?? match.away_score ?? 0,
      home_team: match.home_team ?? null,
      away_team: match.away_team ?? null,
      provider: hasMarketData ? (market.provider || 'CURRENT_ODDS') : 'DEGRADED_RECENT_REPAIR_NO_MARKET',
      home_ml: market.homeMl,
      away_ml: market.awayMl,
      spread_home: market.spreadHome,
      spread_away: market.spreadAway,
      total: market.total,
      is_live: isInProgress(match.status),
      market_type: hasMarketData ? 'recent_live_repair' : 'provider_degradation',
      source: 'recent_live_repair',
      captured_at: nowIso,
    };

    const { error: insertErr } = await sb.from('live_odds_snapshots').insert(payload);
    if (insertErr) {
      stats.errors++;
      stats.detail.push(`${match.id}: INSERT_ERROR ${insertErr.message}`);
      continue;
    }

    stats.repaired_games++;
    stats.detail.push(`${match.id}: repaired (${payload.provider})`);
  }

  return stats;
}

async function runRollingHistoricalClosure(body: BackfillRequest) {
  const windowHours = Math.max(6, Number(body.window_hours || body.repair_window_hours || 72));
  const staleSeconds = Math.max(30, Number(body.snapshot_stale_seconds || 90));
  const limitGames = Math.max(1, Math.min(Number(body.limit_games || 300), 2000));
  const leagues = Array.isArray(body.leagues) ? body.leagues.map((x) => String(x).trim()).filter(Boolean) : [];
  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  let coverageQuery = sb
    .from('vw_live_pipeline_coverage')
    .select('match_id,league_id,sport,start_time,game_phase,coverage_status,has_live_odds_snapshot,has_live_state,has_pbp')
    .gte('start_time', sinceIso)
    .eq('started', true)
    .order('start_time', { ascending: true });
  if (leagues.length > 0) coverageQuery = coverageQuery.in('league_id', leagues);

  const { data: coverageRows, error: coverageErr } = await coverageQuery;
  if (coverageErr) throw new Error(`rolling_historical_closure coverage query failed: ${coverageErr.message}`);

  const targets = (coverageRows || [])
    .filter((row: any) => ['MISSING_SNAPSHOT', 'MISSING_BOTH', 'STALE_SNAPSHOT'].includes(String(row.coverage_status || '')))
    .slice(0, limitGames);

  const stats = {
    mode: 'rolling_historical_closure',
    window_hours: windowHours,
    stale_seconds: staleSeconds,
    limit_games: limitGames,
    scanned_games: Number((coverageRows || []).length),
    targeted_games: targets.length,
    snapshot_repairs: 0,
    state_repairs: 0,
    repaired_games: 0,
    degraded_repairs: 0,
    errors: 0,
    detail: [] as string[],
  };

  for (const target of targets) {
    const matchId = String(target.match_id || '');
    if (!matchId) continue;

    const { data: matchRow, error: matchErr } = await sb
      .from('matches')
      .select('id,league_id,sport,status,start_time,home_team,away_team,home_score,away_score,period,display_clock,current_odds')
      .eq('id', matchId)
      .maybeSingle();
    if (matchErr || !matchRow) {
      stats.errors++;
      stats.detail.push(`${matchId}: MATCH_LOOKUP_ERROR ${(matchErr && matchErr.message) || 'not_found'}`);
      continue;
    }

    let stateRepaired = false;
    let snapshotRepaired = false;

    if (!target.has_live_state) {
      const nowIso = new Date().toISOString();
      const statePayload: any = {
        id: matchId,
        league_id: matchRow.league_id,
        sport: matchRow.sport,
        game_status: matchRow.status ?? 'STATUS_SCHEDULED',
        period: matchRow.period ?? null,
        clock: matchRow.display_clock ?? null,
        home_score: matchRow.home_score ?? 0,
        away_score: matchRow.away_score ?? 0,
        odds: { current: matchRow.current_odds ?? null },
        extra_data: {
          capture_mode: 'repair',
          capture_source: 'rolling_historical_closure',
          capture_reason: String(target.coverage_status || 'missing_state'),
          repaired_at: nowIso,
        },
        updated_at: nowIso,
      };
      const { error: stateErr } = await sb.from('live_game_state').upsert(statePayload, { onConflict: 'id' });
      if (stateErr) {
        stats.errors++;
        stats.detail.push(`${matchId}: LIVE_STATE_ERROR ${stateErr.message}`);
      } else {
        stateRepaired = true;
        stats.state_repairs++;
      }
    }

    const needsSnapshotRepair = !target.has_live_odds_snapshot || String(target.coverage_status || '') === 'STALE_SNAPSHOT';
    if (needsSnapshotRepair) {
      const { data: latestSnapshot } = await sb
        .from('live_odds_snapshots')
        .select('captured_at')
        .eq('match_id', matchId)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const latestAgeSec = latestSnapshot?.captured_at
        ? Math.max(0, Math.floor((Date.now() - new Date(latestSnapshot.captured_at).getTime()) / 1000))
        : null;

      if (latestAgeSec === null || latestAgeSec > staleSeconds) {
        const market = extractCurrentOddsSnapshot(matchRow.current_odds || {});
        const hasMarketData = market.total != null
          || market.homeMl != null
          || market.awayMl != null
          || market.spreadHome != null
          || market.spreadAway != null;
        if (!hasMarketData) stats.degraded_repairs++;

        const nowIso = new Date().toISOString();
        const snapshotPayload: any = {
          match_id: matchId,
          league_id: matchRow.league_id,
          sport: matchRow.sport,
          status: matchRow.status ?? 'STATUS_SCHEDULED',
          period: matchRow.period ?? null,
          clock: matchRow.display_clock ?? null,
          home_score: matchRow.home_score ?? 0,
          away_score: matchRow.away_score ?? 0,
          home_team: matchRow.home_team ?? null,
          away_team: matchRow.away_team ?? null,
          provider: hasMarketData ? (market.provider || 'CURRENT_ODDS') : 'DEGRADED_ROLLING_HISTORICAL_CLOSURE_NO_MARKET',
          home_ml: market.homeMl,
          away_ml: market.awayMl,
          spread_home: market.spreadHome,
          spread_away: market.spreadAway,
          total: market.total,
          is_live: isInProgress(matchRow.status),
          market_type: hasMarketData ? 'historical_closure_repair' : 'provider_degradation',
          source: 'rolling_historical_closure',
          captured_at: nowIso,
        };

        const { error: snapshotErr } = await sb.from('live_odds_snapshots').insert(snapshotPayload);
        if (snapshotErr) {
          stats.errors++;
          stats.detail.push(`${matchId}: SNAPSHOT_ERROR ${snapshotErr.message}`);
        } else {
          snapshotRepaired = true;
          stats.snapshot_repairs++;
        }
      } else {
        stats.detail.push(`${matchId}: SNAPSHOT_SKIP_RECENT age_sec=${latestAgeSec}`);
      }
    }

    if (stateRepaired || snapshotRepaired) {
      stats.repaired_games++;
      stats.detail.push(`${matchId}: repaired state=${stateRepaired} snapshot=${snapshotRepaired}`);
    }
  }

  return stats;
}

async function runHistoricalSportLabelRepair(body: BackfillRequest) {
  const windowHours = Math.max(1, Number(body.repair_window_hours || 24 * 30));
  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const stats = {
    mode: 'repair_historical_sport_labels',
    window_hours: windowHours,
    since: sinceIso,
    rows_repaired: 0,
    rows_repaired_by_league: {} as Record<string, number>,
    errors: 0,
    detail: [] as string[],
  };

  for (const [leagueId, expectedSport] of Object.entries(LEAGUE_TO_CANONICAL_SPORT)) {
    const base = sb
      .from('live_odds_snapshots')
      .update({
        sport: expectedSport,
      })
      .eq('league_id', leagueId)
      .eq('source', 'odds_api_historical')
      .eq('market_type', 'historical_backfill')
      .gte('captured_at', sinceIso)
      .neq('sport', expectedSport);

    const { error, count } = await base.select('match_id', { count: 'exact', head: true });
    if (error) {
      stats.errors++;
      stats.detail.push(`${leagueId}: UPDATE_ERROR ${error.message}`);
      continue;
    }

    const repaired = Number(count || 0);
    if (repaired > 0) {
      stats.rows_repaired += repaired;
      stats.rows_repaired_by_league[leagueId] = repaired;
      stats.detail.push(`${leagueId}: repaired=${repaired}`);
    }
  }

  await safeInsertReliabilityLog({
    function_name: 'backfill-historical-live-odds',
    status: stats.errors > 0 ? 'failed' : 'replayed',
    trigger_type: 'repair',
    scanned_games: 0,
    started_games: 0,
    snapshot_writes: stats.rows_repaired,
    live_state_writes: 0,
    pbp_writes: 0,
    missing_games: 0,
    stale_games: 0,
    retries_attempted: Object.keys(LEAGUE_TO_CANONICAL_SPORT).length,
    retries_recovered: stats.rows_repaired,
    provider_failures: stats.errors,
    degraded_snapshot_writes: 0,
    metadata: {
      ...stats,
      repaired_at: nowIso,
    },
  });

  return stats;
}

Deno.serve(async (req) => {
  try {
    const body: BackfillRequest = await req.json().catch(() => ({} as BackfillRequest));
    const mode = String(body.mode || '').toLowerCase();

    if (mode === 'recent_live_repair') {
      const repairStats = await runRecentLiveRepair(body);
      await safeInsertReliabilityLog({
        function_name: 'backfill-historical-live-odds',
        status: repairStats.errors > 0 ? 'failed' : 'replayed',
        trigger_type: 'replay',
        scanned_games: repairStats.scanned_games,
        started_games: repairStats.started_games,
        snapshot_writes: repairStats.repaired_games,
        live_state_writes: repairStats.repaired_games,
        pbp_writes: 0,
        missing_games: repairStats.missing_games,
        stale_games: repairStats.stale_games,
        retries_attempted: repairStats.missing_games + repairStats.stale_games,
        retries_recovered: repairStats.repaired_games,
        provider_failures: repairStats.degraded_repairs,
        degraded_snapshot_writes: repairStats.degraded_repairs,
        metadata: repairStats,
      });
      return new Response(JSON.stringify(repairStats, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'rolling_historical_closure') {
      const repairStats = await runRollingHistoricalClosure(body);
      await safeInsertReliabilityLog({
        function_name: 'backfill-historical-live-odds',
        status: repairStats.errors > 0 ? 'failed' : 'replayed',
        trigger_type: 'replay',
        scanned_games: repairStats.scanned_games,
        started_games: repairStats.targeted_games,
        snapshot_writes: repairStats.snapshot_repairs,
        live_state_writes: repairStats.state_repairs,
        pbp_writes: 0,
        missing_games: Math.max(0, repairStats.targeted_games - repairStats.repaired_games),
        stale_games: 0,
        retries_attempted: repairStats.targeted_games,
        retries_recovered: repairStats.repaired_games,
        provider_failures: repairStats.errors,
        degraded_snapshot_writes: repairStats.degraded_repairs,
        metadata: repairStats,
      });
      return new Response(JSON.stringify(repairStats, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'repair_historical_sport_labels') {
      const repairStats = await runHistoricalSportLabelRepair(body);
      return new Response(JSON.stringify(repairStats, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const matchId = body.match_id;
    const kickoffUtc = body.kickoff_utc;
    const intervalMin = body.interval_min || 5;
    const durationMin = body.duration_min || 110;
    const regions = body.regions || 'us,eu';
    const scoreTimeline = body.score_timeline || [];

    let matchRow: {
      id: string;
      sport: string | null;
      league_id: string | null;
      home_team: string | null;
      away_team: string | null;
      start_time: string | null;
    } | null = null;
    if (matchId) {
      const { data, error: matchLookupErr } = await sb
        .from('matches')
        .select('id, sport, league_id, home_team, away_team, start_time')
        .eq('id', matchId)
        .maybeSingle();
      if (matchLookupErr) {
        throw new Error(`match lookup failed: ${matchLookupErr.message}`);
      }
      matchRow = data;
    }

    const leagueId = String(body.league_id || matchRow?.league_id || '').trim();
    const inferredSportKey = inferOddsSportKeyFromLeagueId(leagueId);
    const sportKey = String(body.sport_key || inferredSportKey || '').trim();
    const sport = String(matchRow?.sport || inferSportFromOddsKey(sportKey));
    const homeTeam = body.home_team || matchRow?.home_team || undefined;
    const awayTeam = body.away_team || matchRow?.away_team || undefined;

    if (!sportKey) {
      return new Response(JSON.stringify({
        error: 'sport_key is required (or provide league_id that maps to a known odds sport key)',
        league_id: leagueId || null,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!matchId || !homeTeam || !awayTeam || !kickoffUtc || !leagueId) {
      return new Response(JSON.stringify({ error: 'match_id, league_id, home_team, away_team, kickoff_utc required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`Looking up event: ${homeTeam} v ${awayTeam} at ${kickoffUtc}`);
    const oddsEventId = body.odds_event_id || (await findOddsApiEventId(sportKey, kickoffUtc, homeTeam, awayTeam));

    if (!oddsEventId) {
      return new Response(
        JSON.stringify({ error: 'Could not find Odds API event ID', homeTeam, awayTeam }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    console.log(`Found event: ${oddsEventId}`);

    const kickoff = new Date(kickoffUtc);
    const timestamps: string[] = [];
    const preStart = new Date(kickoff.getTime() - 15 * 60 * 1000);
    const steps = Math.floor((durationMin + 15) / intervalMin);
    for (let i = 0; i <= steps; i += 1) {
      const t = new Date(preStart.getTime() + i * intervalMin * 60 * 1000);
      timestamps.push(t.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    }

    console.log(`Will fetch ${timestamps.length} snapshots from ${timestamps[0]} to ${timestamps[timestamps.length - 1]}`);

    let inserted = 0;
    let errors = 0;
    const results: string[] = [];

    for (const ts of timestamps) {
      const snapshot = await fetchHistoricalOdds(sportKey, oddsEventId, ts, regions);
      if (!snapshot) {
        errors += 1;
        results.push(`${ts}: FAILED`);
        await sleep(300);
        continue;
      }

      const elapsed = (new Date(ts).getTime() - kickoff.getTime()) / 60000;
      let clock: string | null = null;
      let hScore: number | null = null;
      let aScore: number | null = null;

      if (elapsed >= 0 && scoreTimeline.length > 0) {
        clock = `${Math.floor(elapsed)}'`;
        for (const evt of scoreTimeline) {
          if (evt.minute <= elapsed) {
            hScore = evt.home_score;
            aScore = evt.away_score;
          }
        }
      } else if (elapsed < 0) {
        clock = 'PRE';
      }

      const rows = extractRows(snapshot, sport, matchId, leagueId, homeTeam, awayTeam, hScore, aScore, clock);
      if (rows.length > 0) {
        const { error } = await sb.from('live_odds_snapshots').insert(rows);
        if (error) {
          console.error(`Insert failed at ${ts}:`, error.message);
          errors += 1;
          results.push(`${ts}: INSERT_ERROR ${error.message}`);
        } else {
          inserted += rows.length;
          const providers = rows
            .map((r) => String(r.provider ?? 'unknown'))
            .join(',');
          results.push(`${ts}: ${rows.length} rows (${providers})`);
        }
      } else {
        results.push(`${ts}: no bookmakers in response`);
      }

      await sleep(500);
    }

    await safeInsertReliabilityLog({
      function_name: 'backfill-historical-live-odds',
      status: errors > 0 ? 'replayed' : 'succeeded',
      trigger_type: 'manual',
      scanned_games: 1,
      started_games: 1,
      snapshot_writes: inserted,
      live_state_writes: 0,
      pbp_writes: 0,
      missing_games: 0,
      stale_games: 0,
      retries_attempted: timestamps.length,
      retries_recovered: inserted,
      provider_failures: errors,
      degraded_snapshot_writes: 0,
      metadata: {
        mode: 'historical',
        sport_key: sportKey,
        match_id: matchId,
        league_id: leagueId,
        odds_event_id: oddsEventId,
        timestamps_fetched: timestamps.length,
        rows_inserted: inserted,
        errors,
      },
    });

    return new Response(
      JSON.stringify({
        status: 'done',
        odds_event_id: oddsEventId,
        match_id: matchId,
        timestamps_fetched: timestamps.length,
        rows_inserted: inserted,
        errors,
        detail: results,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (e) {
    console.error('Fatal:', e);
    await safeInsertReliabilityLog({
      function_name: 'backfill-historical-live-odds',
      status: 'failed',
      trigger_type: 'manual',
      scanned_games: 0,
      started_games: 0,
      snapshot_writes: 0,
      live_state_writes: 0,
      pbp_writes: 0,
      missing_games: 0,
      stale_games: 0,
      retries_attempted: 0,
      retries_recovered: 0,
      provider_failures: 1,
      degraded_snapshot_writes: 0,
      metadata: { error: String(e) },
    });
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
