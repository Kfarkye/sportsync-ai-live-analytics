declare const Deno: any;

import { createClient } from 'npm:@supabase/supabase-js@2'
import { computeAISignals } from '../_shared/gameStateEngine.ts'
import { EspnAdapters, Safe } from '../_shared/espnAdapters.ts'
import { getCanonicalMatchId, generateDeterministicId, resolveCanonicalMatch } from '../_shared/match-registry.ts'
import { writeCurrentOdds } from '../_shared/current-odds-writer.ts'
import { toCanonicalOdds } from '../_shared/odds-contract.ts'
import { Sport } from '../_shared/types.ts'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

let _supabase: ReturnType<typeof createClient> | null = null;
let _contextSnapshotAvailable = true;
let _liveOddsSnapshotsAvailable = true;
function getSupabaseClient() {
  if (_supabase) return _supabase;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Missing required env vars: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}
const SCOREBOARD_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const SUMMARY_BASES = [
  'https://site.api.espn.com/apis/site/v2/sports',
  'https://site.web.api.espn.com/apis/site/v2/sports'
];

// 🚨 FINAL FIX: Insulates DB canonical sports from ESPN URL/Engine sports.
const MONITOR_LEAGUES = [
  { id: 'nfl', db_sport: 'americanfootball', espn_sport: 'football', endpoint: 'football/nfl' },
  { id: 'nba', db_sport: 'basketball', espn_sport: 'basketball', endpoint: 'basketball/nba' },
  { id: 'wnba', db_sport: 'basketball', espn_sport: 'basketball', endpoint: 'basketball/wnba' },
  { id: 'mlb', db_sport: 'baseball', espn_sport: 'baseball', endpoint: 'baseball/mlb' },
  { id: 'nhl', db_sport: 'icehockey', espn_sport: 'hockey', endpoint: 'hockey/nhl' },
  { id: 'mens-college-basketball', db_sport: 'basketball', espn_sport: 'basketball', endpoint: 'basketball/mens-college-basketball', groups: '50' },
  { id: 'college-football', db_sport: 'americanfootball', espn_sport: 'football', endpoint: 'football/college-football', groups: '80' },
  { id: 'epl', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/eng.1' },
  { id: 'seriea', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/ita.1' },
  { id: 'bundesliga', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/ger.1' },
  { id: 'laliga', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/esp.1' },
  { id: 'ligue1', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/fra.1' },
  { id: 'mls', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/usa.1' },
  { id: 'mex.1', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/mex.1' },
  { id: 'ucl', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/uefa.champions' },
  { id: 'uel', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/uefa.europa' },
  { id: 'atp', db_sport: 'tennis', espn_sport: 'tennis', endpoint: 'tennis/atp' },
  { id: 'wta', db_sport: 'tennis', espn_sport: 'tennis', endpoint: 'tennis/wta' }
];

const Logger = {
  info: (msg: string, data: any) => console.log(JSON.stringify({ level: 'INFO', msg, ...data })),
  warn: (msg: string, data: any) => console.warn(JSON.stringify({ level: 'WARN', msg, ...data })),
  error: (msg: string, error: any) => console.error(JSON.stringify({ level: 'ERROR', msg, error: error.message || error }))
};

const toAdapterSport = (espnSport: string): Sport => {
  switch ((espnSport || '').toLowerCase()) {
    case 'football': return Sport.NFL;
    case 'basketball': return Sport.NBA;
    case 'baseball': return Sport.BASEBALL;
    case 'hockey': return Sport.HOCKEY;
    case 'soccer': return Sport.SOCCER;
    case 'tennis': return Sport.TENNIS;
    default: return Sport.BASKETBALL;
  }
};

// Extraction Wrapper to prevent a single bad metric from tanking the whole game payload
const safeExtract = (name: string, fn: () => any) => {
  try {
    const value = fn();
    return value === undefined ? null : value;
  }
  catch (e: any) {
    Logger.error(`Extraction Failed: ${name}`, { error: e.message || String(e) });
    return null;
  }
};

// Safe DB Type Converters
function parseAmerican(val: any): number | null {
  if (val === null || val === undefined) return null;
  const strVal = String(val).trim().toLowerCase();
  if (strVal === 'ev' || strVal === 'even' || strVal === 'pk' || strVal === 'pick') return 100;
  const num = parseInt(strVal.replace('+', ''), 10);
  return isNaN(num) ? null : num;
}

function parseLine(val: any): number | null {
  if (val == null) return null;
  const strVal = String(val).toLowerCase().trim();
  if (strVal === 'pk' || strVal === 'even' || strVal === 'pick') return 0;
  const num = parseFloat(strVal);
  return isNaN(num) ? null : num;
}

interface ParsedProviderOdds {
  odds_open: any;
  odds_close: any;
  odds_live: any;
  bet365_live: any | null;
  dk_live_200: any | null;
  player_props: any | null;
}

function fractionalToAmerican(fractional: string): number | null {
  const parts = String(fractional || '').split('/');
  if (parts.length !== 2) return null;
  const num = parseFloat(parts[0]);
  const den = parseFloat(parts[1]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return null;
  const decimal = num / den;
  if (decimal >= 1) return Math.round(decimal * 100);
  return Math.round(-100 / decimal);
}

function parseMultiProviderOdds(summaryData: any, comp: any, isSoccer: boolean): ParsedProviderOdds {
  const result: ParsedProviderOdds = {
    odds_open: null,
    odds_close: null,
    odds_live: null,
    bet365_live: null,
    dk_live_200: null,
    player_props: null
  };

  const oddsArray = Array.isArray(summaryData?.odds) ? summaryData.odds : [];
  const compOdds = Array.isArray(comp?.odds) ? comp.odds : [];
  const allProviders = [...oddsArray, ...compOdds];

  for (const provider of allProviders) {
    const name = String(provider?.provider?.name || '').toLowerCase();
    const id = provider?.provider?.id;

    if (name.includes('draftkings') || name.includes('draft kings') || id === 100) {
      if (!result.odds_open && provider?.open) {
        result.odds_open = {
          home_ml: provider.open?.moneyLine ?? provider.open?.homeTeamOdds?.moneyLine ?? null,
          away_ml: provider.open?.awayTeamOdds?.moneyLine ?? null,
          spread: provider.open?.spread ?? null,
          total: provider.open?.overUnder ?? null,
          provider: 'DraftKings',
          provider_id: id ?? 100
        };
      }
      if (!result.odds_close && provider?.close) {
        result.odds_close = {
          home_ml: provider.close?.moneyLine ?? provider.close?.homeTeamOdds?.moneyLine ?? null,
          away_ml: provider.close?.awayTeamOdds?.moneyLine ?? null,
          spread: provider.close?.spread ?? null,
          total: provider.close?.overUnder ?? null,
          provider: 'DraftKings',
          provider_id: id ?? 100
        };
      }
      if (!result.odds_live && provider?.current) {
        result.odds_live = {
          home_ml: provider.current?.moneyLine ?? provider.current?.homeTeamOdds?.moneyLine ?? null,
          away_ml: provider.current?.awayTeamOdds?.moneyLine ?? null,
          spread: provider.current?.spread ?? null,
          total: provider.current?.overUnder ?? null,
          provider: 'DraftKings',
          provider_id: id ?? 100,
          captured_at: new Date().toISOString()
        };
      }
    }

    if (isSoccer && (name.includes('bet365') || id === 2000)) {
      const teamOdds = provider?.teamOdds || provider?.bettingOdds || {};
      const homeOdds = teamOdds?.home || {};
      const awayOdds = teamOdds?.away || {};
      const drawOdds = teamOdds?.draw || {};

      result.bet365_live = {
        home_1x2: homeOdds?.moneyLine ?? null,
        draw_1x2: drawOdds?.moneyLine ?? null,
        away_1x2: awayOdds?.moneyLine ?? null,
        total: provider?.overUnder ?? null,
        over_under: provider?.overUnder ?? null,
        double_chance: provider?.doubleChance ?? null,
        is_live: !!provider?.current,
        provider: 'Bet365',
        provider_id: id ?? 2000,
        captured_at: new Date().toISOString()
      };

      const playerOdds = provider?.playerOdds || provider?.bettingOdds?.players || [];
      if (Array.isArray(playerOdds) && playerOdds.length > 0) {
        result.player_props = {
          market: 'ATGS',
          players: playerOdds.map((p: any) => ({
            name: p?.athlete?.displayName || p?.name || 'Unknown',
            team: p?.team?.displayName || null,
            odds_fractional: p?.odds || null,
            odds_american: p?.odds ? fractionalToAmerican(String(p.odds)) : null
          })).filter((p: any) => p.odds_fractional),
          count: playerOdds.length,
          captured_at: new Date().toISOString()
        };
      }
    }

    if (isSoccer && id === 200) {
      result.dk_live_200 = {
        home_ml: provider?.homeTeamOdds?.moneyLine ?? null,
        away_ml: provider?.awayTeamOdds?.moneyLine ?? null,
        spread: provider?.spread ?? null,
        total: provider?.overUnder ?? null,
        provider: 'DraftKings Live',
        provider_id: 200,
        captured_at: new Date().toISOString()
      };
    }
  }

  return result;
}

function parseBool(val: any): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val === 1;
  if (typeof val !== 'string') return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(val.trim().toLowerCase());
}

function parsePositiveInt(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function effectiveMaxGamesForLeague(leagueId: string, requestedCap: number | null): number | null {
  if (requestedCap === null) return null;
  if (leagueId === 'mens-college-basketball') return Math.max(requestedCap, 10);
  return requestedCap;
}

function countItems(val: any): number | null {
  if (Array.isArray(val)) return val.length;
  if (val && typeof val === 'object') return Object.keys(val).length;
  return null;
}

function normalizeSnapshotState(comp: any): string {
  const state = String(comp?.status?.type?.state || '').trim().toLowerCase();
  if (state === 'in') return 'in';
  if (state === 'post') return 'post';

  const name = String(comp?.status?.type?.name || '').trim().toLowerCase();
  if (name.includes('half')) return 'halftime';
  if (name.includes('progress') || name.includes('live')) return 'in-progress';
  if (name.includes('final') || name.includes('full_time') || name.includes('complete')) return 'post';

  return state || name;
}

function negateLine(val: any): number | null {
  const parsed = parseLine(val);
  return parsed === null ? null : -parsed;
}

function hasSnapshotPriceFields(row: any): boolean {
  return [
    row.home_ml,
    row.away_ml,
    row.draw_ml,
    row.spread_home,
    row.spread_away,
    row.spread_home_price,
    row.spread_away_price,
    row.total,
    row.over_price,
    row.under_price
  ].some((value) => value !== null && value !== undefined);
}

function resolvePrimaryLiveOdds(args: {
  espnOdds: any;
  parsedOdds: ParsedProviderOdds;
  effectiveOdds: any;
}) {
  const { espnOdds, parsedOdds, effectiveOdds } = args;
  return parsedOdds.odds_live || espnOdds || effectiveOdds || null;
}

function resolveCurrentOddsLineage(args: {
  existingCurrentOdds: any;
  effectiveOdds: any;
  finalMarketOdds: any;
  espnOdds: any;
}) {
  const { existingCurrentOdds, effectiveOdds, finalMarketOdds, espnOdds } = args;
  const provider = String(
    effectiveOdds?.provider ||
    finalMarketOdds?.provider ||
    existingCurrentOdds?.provider ||
    ''
  ).toLowerCase();

  const hasEspnSignal = Boolean(
    espnOdds?.homeSpread != null ||
    espnOdds?.homeWin != null ||
    espnOdds?.total != null ||
    espnOdds?.provider
  );

  const isInstitutional =
    finalMarketOdds?.isInstitutional === true ||
    effectiveOdds?.isInstitutional === true ||
    provider.includes('institutional');

  const isExternalBook =
    provider.includes('pinnacle') ||
    provider.includes('circa') ||
    provider.includes('bet365') ||
    provider.includes('draftkings') ||
    provider.includes('draft kings') ||
    provider.includes('fanduel') ||
    provider.includes('betmgm') ||
    provider.includes('bookmaker');

  const isEspnAdapter =
    provider.includes('espn') ||
    provider.includes('consensus') ||
    provider.includes('pickcenter');

  const sourceDetail = isInstitutional
    ? 'premium_feed'
    : isExternalBook && !isEspnAdapter
      ? 'external_current_odds'
      : hasEspnSignal || isEspnAdapter
        ? 'espn_adapter'
        : 'unknown';

  const originChain = [
    existingCurrentOdds?.provider ? `existing:${existingCurrentOdds.provider}` : null,
    finalMarketOdds?.provider ? `final:${finalMarketOdds.provider}` : null,
    espnOdds?.provider ? `espn:${espnOdds.provider}` : null,
    sourceDetail
  ].filter(Boolean);

  return { sourceDetail, originChain };
}

function buildLiveOddsSnapshotRows(args: {
  capturedAt: string;
  comp: any;
  league: any;
  matchId: string;
  homeScore: number;
  awayScore: number;
  homeTeam: string;
  awayTeam: string;
  espnOdds: any;
  effectiveOdds: any;
  finalMarketOdds: any;
  parsedOdds: ParsedProviderOdds;
  currentOddsLineage?: {
    sourceDetail?: string;
    originChain?: string[];
  };
}) {
  const {
    capturedAt,
    comp,
    league,
    matchId,
    homeScore,
    awayScore,
    homeTeam,
    awayTeam,
    espnOdds,
    effectiveOdds,
    finalMarketOdds,
    parsedOdds,
    currentOddsLineage
  } = args;

  const normalizedState = normalizeSnapshotState(comp);
  if (!['in', 'post', 'in-progress', 'halftime'].includes(normalizedState)) {
    return [];
  }

  const baseRow = {
    match_id: matchId,
    sport: league.db_sport,
    league_id: league.id,
    captured_at: capturedAt,
    status: comp?.status?.type?.name || null,
    period: comp?.status?.period ?? null,
    clock: comp?.status?.displayClock ?? null,
    home_score: homeScore ?? 0,
    away_score: awayScore ?? 0,
    home_team: homeTeam || null,
    away_team: awayTeam || null,
    is_live: normalizedState !== 'post'
  };

  const rows: any[] = [];

  const pushRow = (marketType: string, providerPayload: any, source: string) => {
    if (!providerPayload) return;

    const providerName = String(
      providerPayload?.provider ||
      providerPayload?.provider_name ||
      providerPayload?.book ||
      'Unknown'
    ).trim() || 'Unknown';

    const row = {
      ...baseRow,
      provider: providerName,
      provider_id: providerPayload?.provider_id != null ? String(providerPayload.provider_id) : null,
      market_type: marketType,
      home_ml: parseAmerican(providerPayload?.home_ml ?? providerPayload?.homeML ?? providerPayload?.homeWin ?? providerPayload?.moneylineHome ?? providerPayload?.home_1x2),
      away_ml: parseAmerican(providerPayload?.away_ml ?? providerPayload?.awayML ?? providerPayload?.awayWin ?? providerPayload?.moneylineAway ?? providerPayload?.away_1x2),
      draw_ml: parseAmerican(providerPayload?.draw_ml ?? providerPayload?.drawML ?? providerPayload?.drawWin ?? providerPayload?.draw_1x2),
      spread_home: parseLine(providerPayload?.spread_home ?? providerPayload?.homeSpread ?? providerPayload?.spread?.home ?? providerPayload?.spread),
      spread_away: parseLine(providerPayload?.spread_away ?? providerPayload?.awaySpread ?? providerPayload?.spread?.away ?? negateLine(providerPayload?.spread)),
      spread_home_price: parseAmerican(providerPayload?.spread_home_price ?? providerPayload?.homeSpreadOdds ?? providerPayload?.spread_home_odds),
      spread_away_price: parseAmerican(providerPayload?.spread_away_price ?? providerPayload?.awaySpreadOdds ?? providerPayload?.spread_away_odds),
      total: parseLine(providerPayload?.total ?? providerPayload?.total_points ?? providerPayload?.over_under ?? providerPayload?.overUnder),
      over_price: parseAmerican(providerPayload?.over_price ?? providerPayload?.overOdds),
      under_price: parseAmerican(providerPayload?.under_price ?? providerPayload?.underOdds),
      source,
      raw_payload: providerPayload
    };

    if (!hasSnapshotPriceFields(row)) return;
    rows.push(row);
  };

  // ESPN summary/core is the primary live sportsbook calibration source.
  pushRow('main', {
    ...(espnOdds || {}),
    provider: espnOdds?.provider || 'ESPN',
    provider_id: espnOdds?.provider_id ?? 'espn'
  }, 'espn_summary');

  // Persist the currently selected market object separately so external/current state is still archived.
  pushRow('main', {
    ...(finalMarketOdds || {}),
    ...(effectiveOdds || {}),
    source_detail: currentOddsLineage?.sourceDetail || null,
    origin_chain: currentOddsLineage?.originChain || [],
    provider: effectiveOdds?.provider || finalMarketOdds?.provider || 'CurrentOdds',
    provider_id: effectiveOdds?.provider_id ?? finalMarketOdds?.provider_id ?? null
  }, 'match_current_odds');
  pushRow('open', parsedOdds.odds_open, 'espn_summary');
  pushRow('close', parsedOdds.odds_close, 'espn_summary');
  pushRow('live', parsedOdds.odds_live, parsedOdds.odds_live?.source === 'core_api' ? 'espn_core' : 'espn_summary');
  pushRow('live', parsedOdds.bet365_live, 'espn_summary');
  pushRow('live', parsedOdds.dk_live_200, 'espn_summary');

  const deduped = new Map<string, any>();
  for (const row of rows) {
    const key = [
      row.match_id,
      row.provider,
      row.provider_id ?? '',
      row.market_type,
      row.source,
      row.home_ml ?? '',
      row.away_ml ?? '',
      row.draw_ml ?? '',
      row.spread_home ?? '',
      row.spread_away ?? '',
      row.spread_home_price ?? '',
      row.spread_away_price ?? '',
      row.total ?? '',
      row.over_price ?? '',
      row.under_price ?? ''
    ].join('|');
    if (!deduped.has(key)) deduped.set(key, row);
  }

  return Array.from(deduped.values());
}

function computeAISignalsSafely(matchPayload: any, context: { matchId: string; leagueId: string; mode: 'dry' | 'persist' }) {
  try {
    return { value: computeAISignals(matchPayload), error: null as string | null };
  } catch (e: any) {
    const error = e?.message || String(e);
    Logger.error('AI_SIGNAL_COMPUTE_FAILED', {
      matchId: context.matchId,
      league_id: context.leagueId,
      mode: context.mode,
      error
    });
    return { value: null, error };
  }
}

async function fetchWithRetry(url: string) {
  for (let i = 0; i < 3; i++) {
    try {
      const c = new AbortController();
      const id = setTimeout(() => c.abort(), 8000);
      const res = await fetch(url, { signal: c.signal });
      clearTimeout(id);
      if (res.ok) return res;
    } catch { }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Failed: ${url}`);
}

async function fetchSummaryWithFallback(endpoint: string, matchId: string) {
  const summaryUrls: string[] = [];
  for (const base of SUMMARY_BASES) {
    summaryUrls.push(`${base}/${endpoint}/summary?event=${matchId}`);
    summaryUrls.push(`${base}/${endpoint}/summary?event=${matchId}&region=us&lang=en&contentorigin=espn`);
  }

  let lastError: any = null;
  for (const url of summaryUrls) {
    try {
      const res = await fetchWithRetry(url);
      return { res, url };
    } catch (e: any) {
      lastError = e;
      Logger.warn('SUMMARY_FETCH_FAILED', { match_id: matchId, endpoint, url, error: e?.message || String(e) });
    }
  }

  throw new Error(`Summary fetch failed for ${endpoint}/${matchId}: ${lastError?.message || 'unknown error'}`);
}

const getCompetitorName = (c: any) => c?.team?.displayName || c?.athlete?.displayName || 'Unknown';

/** Retry a Supabase upsert up to 3 times with exponential backoff. */
async function upsertWithRetry(table: string, payload: any, retries = 3) {
  const supabase = getSupabaseClient();
  const onConflict = table === 'closing_lines' ? 'match_id' : 'id';
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { error } = await supabase.from(table).upsert(payload, { onConflict });
    if (!error) return;
    Logger.error(`DB_UPSERT_RETRY`, { table, attempt, maxRetries: retries, error: error.message } as any);
    if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    else throw new Error(`${table} upsert failed after ${retries} attempts: ${error.message}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const reqUrl = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const target_match_id = body?.target_match_id ?? reqUrl.searchParams.get('target_match_id');
  const dates = body?.dates ?? reqUrl.searchParams.get('dates');
  const dryRun = parseBool(body?.dry ?? reqUrl.searchParams.get('dry'));
  const debug = parseBool(body?.debug ?? reqUrl.searchParams.get('debug'));
  const maxGames = parsePositiveInt(body?.max_games ?? reqUrl.searchParams.get('max_games'));
  const maxGamesCap = maxGames ? Math.min(maxGames, 50) : null;
  const leagueParamRaw = body?.league ?? reqUrl.searchParams.get('league') ?? '';
  const leagueFilter = new Set(
    String(leagueParamRaw)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  const startedAt = Date.now();
  const stats = {
    attempted: 0,
    processed: 0,
    live: 0,
    failed: 0,
    errors: [] as string[],
    snapshots: 0,
    odds_snapshots_written: 0,
    context_snapshots: 0,
    live_odds_snapshots_written: 0,
    dry_run: dryRun,
    max_games_requested: maxGamesCap,
    max_games_effective: maxGamesCap,
    league_filter: [...leagueFilter],
    dry_samples: [] as any[],
  };
  try {
    // Force lazy init inside request cycle so missing envs return a JSON error instead of a cold-start 503.
    getSupabaseClient();
  } catch (e: any) {
    Logger.error('BOOT_INIT_FAILED', { error: e.message || e });
    return new Response(JSON.stringify({ ok: false, error: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  leagueLoop:
  for (const league of MONITOR_LEAGUES) {
    const leagueMaxGamesCap = effectiveMaxGamesForLeague(league.id, maxGamesCap);
    if (leagueFilter.size > 0 && !leagueFilter.has(league.id)) continue;
    if (leagueMaxGamesCap !== null) (stats as any).max_games_effective = leagueMaxGamesCap;
    if (leagueMaxGamesCap && stats.attempted >= leagueMaxGamesCap) break;

    try {
      const dateParam = dates || new Date().toISOString().split('T')[0].replace(/-/g, '');
      const groupsParam = league.groups ? `&groups=${league.groups}` : '';
      const res = await fetchWithRetry(`${SCOREBOARD_BASE}/${league.endpoint}/scoreboard?dates=${dateParam}${groupsParam}`);
      const data = await res.json();
      let events = data.events || [];

      // FLATTEN TENNIS
      if (league.db_sport === 'tennis') {
        events = events.flatMap((t: any) =>
          (t.groupings || []).flatMap((g: any) =>
            (g.competitions || []).map((c: any) => ({
              ...t, id: c.id, date: c.date, status: c.status, competitions: [c]
            }))
          )
        );
      }

      for (const event of events) {
        if (leagueMaxGamesCap && stats.attempted >= leagueMaxGamesCap) break leagueLoop;

        // Safe robust check for string OR array targets (Casted to String to prevent type crashes)
        if (target_match_id) {
          const targets = Array.isArray(target_match_id) ? target_match_id : [target_match_id];
          if (!targets.some((t: any) => String(t).includes(String(event.id)))) continue;
        }

        const state = event.status?.type?.state;
        if (!['in', 'post'].includes(state)) {
          const mins = (new Date(event.date).getTime() - Date.now()) / 60000;
          if (mins > 75 || mins < -20) continue;
        }
        stats.attempted++;
        await processGame(event, league, stats, { dryRun, debug });
      }
    } catch (e: any) {
      stats.errors.push(`${league.id}: ${e.message}`);
    }
  }
  (stats as any).elapsed_ms = Date.now() - startedAt;
  if (!debug && stats.dry_samples.length > 5) stats.dry_samples = stats.dry_samples.slice(0, 5);
  return new Response(JSON.stringify(stats), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

async function processGame(event: any, league: any, stats: any, options: { dryRun?: boolean; debug?: boolean } = {}) {
  const isDryRun = options.dryRun === true;
  const matchId = event.id;
  const dbMatchId = getCanonicalMatchId(matchId, league.id);

  try {
    const { res, url: summaryUrl } = await fetchSummaryWithFallback(league.endpoint, matchId);
    const data = await res.json();
    const comp = data.header?.competitions?.[0];
    if (!comp) return;
    const adapterSport = toAdapterSport(league.espn_sport);
    const isSoccer = league.db_sport === 'soccer';
    let parsedOdds: ParsedProviderOdds = {
      odds_open: null,
      odds_close: null,
      odds_live: null,
      bet365_live: null,
      dk_live_200: null,
      player_props: null
    };
    try {
      parsedOdds = parseMultiProviderOdds(data, comp, isSoccer);
    } catch (e: any) {
      Logger.warn('PARSE_MULTI_PROVIDER_ODDS_FAILED', {
        match_id: matchId,
        league_id: league.id,
        error: e?.message || String(e)
      });
    }

    Logger.info('SUMMARY_SHAPE', {
      match_id: matchId,
      league_id: league.id,
      adapter_sport: adapterSport,
      summary_host: (() => { try { return new URL(summaryUrl).host; } catch { return null; } })(),
      has_boxscore: !!data?.boxscore,
      boxscore_teams_len: Array.isArray(data?.boxscore?.teams) ? data.boxscore.teams.length : 0,
      has_players: Array.isArray(data?.boxscore?.players),
      has_leaders: Array.isArray(data?.leaders),
      has_winprobability: Array.isArray(data?.winprobability),
      has_predictor: !!data?.predictor,
      has_game_info: !!data?.gameInfo,
      has_plays: Array.isArray(data?.plays),
      has_key_events: Array.isArray(data?.keyEvents),
      has_commentary: Array.isArray(data?.commentary)
    });

    const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
    const away = comp.competitors?.find((c: any) => c.homeAway === 'away');

    let homeScore = Safe.score(home?.score) ?? 0;
    let awayScore = Safe.score(away?.score) ?? 0;

    let manualSituationData: any = {};

    // TENNIS GAME COUNTING
    if (league.db_sport === 'tennis') {
      const hGames = (home?.linescores || []).reduce((a: number, b: any) => a + (parseInt(b.value) || 0), 0);
      const aGames = (away?.linescores || []).reduce((a: number, b: any) => a + (parseInt(b.value) || 0), 0);
      manualSituationData = { home_games_won: hGames, away_games_won: aGames };
    }

    // Context Retrieval
    const espnSituation = safeExtract('Situation', () => EspnAdapters.Situation(data)) || {};
    const mergedSituation = { ...espnSituation, ...manualSituationData };

    // Contextual Intelligence Extraction
    const extractedLastPlay = safeExtract('LastPlay', () => EspnAdapters.LastPlay(data));
    const extractedDrive = safeExtract('Drive', () => EspnAdapters.Drive(data));
    const extractedRecentPlays = safeExtract('RecentPlays', () => EspnAdapters.RecentPlays(data, adapterSport));
    const extractedStats = safeExtract('Stats', () => EspnAdapters.Stats(data, adapterSport));
    const extractedPlayerStats = safeExtract('PlayerStats', () => EspnAdapters.PlayerStats(data));
    const extractedLeaders = safeExtract('Leaders', () => EspnAdapters.Leaders(data));
    const extractedMomentum = safeExtract('Momentum', () => EspnAdapters.Momentum(data));
    const extractedAdvancedMetrics = safeExtract('AdvancedMetrics', () => EspnAdapters.AdvancedMetrics(data, adapterSport));
    const extractedContext = safeExtract('Context', () => EspnAdapters.Context(data));
    const extractedPredictor = safeExtract('Predictor', () => EspnAdapters.Predictor(data));

    if (isDryRun) {
      const drySignalProbePayload = {
        id: dbMatchId,
        league_id: league.id,
        sport: league.db_sport,
        status: comp.status?.type?.name || null,
        period: comp.status?.period || null,
        display_clock: comp.status?.displayClock || null,
        home_score: homeScore,
        away_score: awayScore,
        current_odds: EspnAdapters.Odds(comp, data.pickcenter) || null,
      };
      const drySignalsProbe = computeAISignalsSafely(drySignalProbePayload, {
        matchId: dbMatchId,
        leagueId: league.id,
        mode: 'dry'
      });

      stats.processed++;
      stats.live++;
      if (Array.isArray(stats.dry_samples) && stats.dry_samples.length < 10) {
        stats.dry_samples.push({
          match_id: dbMatchId,
          espn_event_id: matchId,
          league_id: league.id,
          status: comp.status?.type?.name || null,
          summary_host: (() => { try { return new URL(summaryUrl).host; } catch { return null; } })(),
          extraction: {
            situation: Object.keys(mergedSituation).length > 0,
            last_play: extractedLastPlay != null,
            current_drive: extractedDrive != null,
            recent_plays: extractedRecentPlays != null,
            stats: extractedStats != null,
            player_stats: extractedPlayerStats != null,
            leaders: extractedLeaders != null,
            momentum: extractedMomentum != null,
            advanced_metrics: extractedAdvancedMetrics != null,
            match_context: extractedContext != null,
            predictor: extractedPredictor != null
          },
          counts: {
            recent_plays: countItems(extractedRecentPlays),
            stats: countItems(extractedStats),
            player_stats: countItems(extractedPlayerStats),
            leaders: countItems(extractedLeaders),
            momentum: countItems(extractedMomentum)
          },
          signal_guard: {
            ok: drySignalsProbe.error === null,
            error: drySignalsProbe.error
          }
        });
      }
      return;
    }

    const supabase = getSupabaseClient();

    let canonicalId = await resolveCanonicalMatch(supabase, getCompetitorName(home), getCompetitorName(away), event.date, league.id);
    if (!canonicalId) canonicalId = generateDeterministicId(getCompetitorName(home), getCompetitorName(away), event.date, league.id);

    try {
      await upsertWithRetry('canonical_games', {
        id: canonicalId, league_id: league.id, sport: league.db_sport,
        home_team_name: getCompetitorName(home), away_team_name: getCompetitorName(away),
        commence_time: event.date, status: comp.status?.type?.name
      });
    } catch (err) {
      // Non-fatal if canonical_games table is missing or errors out during setup
    }

    // Safely pull existing matches to merge odds without fetching non-existent DB columns
    const { data: existingMatch } = await supabase.from('matches').select('home_score, away_score, current_odds, opening_odds, closing_odds, is_closing_locked').eq('id', dbMatchId).maybeSingle();

    // SAFE RPC CALL: Prevents crash if the RPC function isn't created in the database yet
    let premiumFeed = null;
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('resolve_market_feed', { p_match_id: matchId, p_canonical_id: canonicalId });
      if (!rpcError && rpcData) {
        premiumFeed = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      }
    } catch (e) {
      // Safe fail if RPC isn't deployed yet
    }

    // --- 🚨 FIXED ODDS RESOLUTION & CLOBBER PROTECTION ---
    let finalMarketOdds = existingMatch?.current_odds || {};
    let espnOdds = EspnAdapters.Odds(comp, data.pickcenter) || {};

    // Fallback to basic /scoreboard details if deep /summary Pickcenter returns empty (Fixes NBA missing odds)
    if (espnOdds.homeSpread == null && espnOdds.homeWin == null && espnOdds.total == null) {
      const sbOdds = event.competitions?.[0]?.odds?.[0] || comp.odds?.[0];
      if (sbOdds) {
        espnOdds = {
          total: sbOdds.overUnder ?? null,
          homeWin: sbOdds.homeTeamOdds?.moneyLine ?? sbOdds.moneyline?.home ?? null,
          awayWin: sbOdds.awayTeamOdds?.moneyLine ?? sbOdds.moneyline?.away ?? null,
          homeSpread: sbOdds.homeTeamOdds?.spread ?? sbOdds.spread?.home ?? null,
          awaySpread: sbOdds.awayTeamOdds?.spread ?? sbOdds.spread?.away ?? null,
          provider: sbOdds.provider?.name || 'ESPN'
        };

        // Deep fallback parsing (e.g. "BOS -5.5" or "EVEN") if structured objects aren't available
        if (typeof sbOdds.details === 'string' && espnOdds.homeSpread == null) {
          const detailStr = sbOdds.details.toUpperCase();
          if (detailStr === 'EVEN' || detailStr === 'PK' || detailStr.includes('PICK')) {
            espnOdds.homeSpread = 0;
            espnOdds.awaySpread = 0;
          } else {
            const match = sbOdds.details.match(/([A-Z0-9]+)\s+([+-]?\d+\.?\d*)/i);
            if (match) {
              const val = parseFloat(match[2]);
              const teamAbbr = match[1].toUpperCase();

              const homeAbbr = (home?.team?.abbreviation || home?.athlete?.abbreviation || '').toUpperCase();
              const awayAbbr = (away?.team?.abbreviation || away?.athlete?.abbreviation || '').toUpperCase();

              if (homeAbbr === teamAbbr && homeAbbr !== '') {
                espnOdds.homeSpread = val;
                espnOdds.awaySpread = -val;
              } else if (awayAbbr === teamAbbr && awayAbbr !== '') {
                espnOdds.awaySpread = val;
                espnOdds.homeSpread = -val;
              }
            }
          }
        }
      }
    }

    if (!parsedOdds.odds_live && !isSoccer) {
      try {
        const endpointParts = String(league.endpoint || '').split('/');
        const espnLeagueId = endpointParts.length > 1 ? endpointParts[1] : null;
        if (espnLeagueId) {
          const coreOddsUrl = `https://sports.core.api.espn.com/v2/sports/${league.espn_sport}/leagues/${espnLeagueId}/events/${matchId}/competitions/${matchId}/odds`;
          const coreRes = await fetch(coreOddsUrl, { signal: AbortSignal.timeout(5000) });
          if (coreRes.ok) {
            const coreData = await coreRes.json();
            const items = Array.isArray(coreData?.items) ? coreData.items : (Array.isArray(coreData) ? coreData : []);
            for (const provider of items) {
              const pName = String(provider?.provider?.name || '').toLowerCase();
              if (!pName.includes('draftkings')) continue;

              if (!parsedOdds.odds_live && provider?.current) {
                parsedOdds.odds_live = {
                  home_ml: provider.current?.moneyLine ?? provider.current?.homeTeamOdds?.moneyLine ?? null,
                  away_ml: provider.current?.awayTeamOdds?.moneyLine ?? null,
                  spread: {
                    home: provider.current?.spread ?? null,
                    away: provider.current?.awayTeamOdds?.spread ?? null
                  },
                  total: provider.current?.overUnder ?? null,
                  provider: 'DraftKings',
                  provider_id: provider?.provider?.id ?? 100,
                  source: 'core_api',
                  captured_at: new Date().toISOString()
                };
              }
              if (!parsedOdds.odds_open && provider?.open) {
                parsedOdds.odds_open = {
                  home_ml: provider.open?.moneyLine ?? provider.open?.homeTeamOdds?.moneyLine ?? null,
                  away_ml: provider.open?.awayTeamOdds?.moneyLine ?? null,
                  spread: provider.open?.spread ?? null,
                  total: provider.open?.overUnder ?? null,
                  provider: 'DraftKings',
                  provider_id: provider?.provider?.id ?? 100
                };
              }
              if (!parsedOdds.odds_close && provider?.close) {
                parsedOdds.odds_close = {
                  home_ml: provider.close?.moneyLine ?? provider.close?.homeTeamOdds?.moneyLine ?? null,
                  away_ml: provider.close?.awayTeamOdds?.moneyLine ?? null,
                  spread: provider.close?.spread ?? null,
                  total: provider.close?.overUnder ?? null,
                  provider: 'DraftKings',
                  provider_id: provider?.provider?.id ?? 100
                };
              }
            }
          }
        }
      } catch {
        // Non-fatal enhancement: next poll cycle will retry.
      }
    }

    // Determine Final Odds Injection
    if (premiumFeed && !premiumFeed.is_stale) {
      finalMarketOdds = {
        homeSpread: premiumFeed.spread?.home?.point ?? null,
        awaySpread: premiumFeed.spread?.away?.point ?? null,
        total: premiumFeed.total?.over?.point ?? null,
        homeWin: premiumFeed.h2h?.home?.price ?? null,
        awayWin: premiumFeed.h2h?.away?.price ?? null,
        isInstitutional: true,
        provider: "Institutional"
      };
    } else {
      // DO NOT overwrite live-odds-tracker's bookmaker data. Only update if the DB source is empty or an ESPN variant
      const hasEspnOdds = espnOdds.homeSpread != null || espnOdds.homeWin != null || espnOdds.total != null;

      // Strict lowercasing of arrays to match string comparison
      const isExistingExternal = finalMarketOdds?.provider &&
        !['espn', 'espn bet', 'espnbet', 'pickcenter', 'consensus'].some(p =>
          String(finalMarketOdds.provider).toLowerCase().includes(p)
        );

      if (hasEspnOdds && !isExistingExternal) {
        finalMarketOdds = { ...espnOdds, provider: espnOdds.provider || 'ESPN' };
      }
    }

    // MONOTONICITY GUARD — never let scores regress
    if (existingMatch) {
      if ((existingMatch.home_score || 0) > homeScore) {
        Logger.info("MONO_GUARD_HOME", { dbMatchId, existing: existingMatch.home_score, incoming: homeScore });
        homeScore = existingMatch.home_score;
      }
      if ((existingMatch.away_score || 0) > awayScore) {
        Logger.info("MONO_GUARD_AWAY", { dbMatchId, existing: existingMatch.away_score, incoming: awayScore });
        awayScore = existingMatch.away_score;
      }
    }

    // Safely crafted match payload targeting only real SQL columns
    const homeNameStr = getCompetitorName(home);
    const awayNameStr = getCompetitorName(away);
    const hasOpeningOdds = existingMatch?.opening_odds && Object.keys(existingMatch.opening_odds).length > 0;
    const finalOddsHasKeys = Object.keys(finalMarketOdds).length > 0;

    // Convert {} to explicitly null to protect Postgres from malformed JSON type casting bugs
    const cleanFinalOdds = finalOddsHasKeys ? finalMarketOdds : null;

    const matchPayload: any = {
      id: dbMatchId,
      league_id: league.id,
      sport: league.db_sport,
      status: comp.status?.type?.name,
      period: comp.status?.period,
      display_clock: comp.status?.displayClock,
      home_score: homeScore,
      away_score: awayScore,
      last_updated: new Date().toISOString(),
      opening_odds: hasOpeningOdds ? existingMatch.opening_odds : cleanFinalOdds,
      extra_data: Object.keys(manualSituationData).length > 0 ? manualSituationData : null
    };
    if (homeNameStr !== 'Unknown') matchPayload.home_team = homeNameStr;
    if (awayNameStr !== 'Unknown') matchPayload.away_team = awayNameStr;

    // CLOSING LINE LOGIC
    // Safe check uses true explicit boolean if present, otherwise checks JSON existence.
    let isClosingLocked = existingMatch?.is_closing_locked || !!existingMatch?.closing_odds;
    const isLiveGame = ['LIVE', 'IN_PROGRESS', 'HALFTIME', 'STATUS_IN_PROGRESS', 'STATUS_FINAL'].some(k => (matchPayload.status || '').toUpperCase().includes(k));

    // Support Moneyline closing lock for Tennis and Soccer if spread isn't present
    // Explicit null check prevents 0 (Pick'em spread) from evaluating to false and bypassing the lock
    const hasMarketOdds = cleanFinalOdds?.homeSpread != null || cleanFinalOdds?.homeWin != null;

    if (!isClosingLocked && isLiveGame && hasMarketOdds) {
      matchPayload.closing_odds = cleanFinalOdds;
      matchPayload.is_closing_locked = true;

      const closingPayload = {
        match_id: dbMatchId,
        league_id: league.id,
        home_spread: parseLine(cleanFinalOdds.homeSpread),
        away_spread: parseLine(cleanFinalOdds.awaySpread),
        total: parseLine(cleanFinalOdds.total),
        home_ml: parseAmerican(cleanFinalOdds.homeWin), // 🚨 Ensures safe INTEGER cast
        away_ml: parseAmerican(cleanFinalOdds.awayWin)  // 🚨 Ensures safe INTEGER cast
      };
      await upsertWithRetry('closing_lines', closingPayload);
    } else if (isClosingLocked && existingMatch?.closing_odds) {
      matchPayload.closing_odds = existingMatch.closing_odds; // Explicitly preserve if already locked
    }

    // SNAPSHOTS (T-60 / T-0)
    const minsToStart = (new Date(event.date).getTime() - Date.now()) / 60000;
    const inT60 = minsToStart > 50 && minsToStart < 75;
    const inT0 = minsToStart > -10 && minsToStart < 15;
    let t60_snapshot, t0_snapshot;

    const { data: s } = await supabase.from('live_game_state').select('odds').eq('id', dbMatchId).maybeSingle();
    const currentOddsState = s?.odds || {}; // Fallback prevents null reference if odds column is fully NULL

    if ((inT60 || inT0) && hasMarketOdds) {
      if (inT60 && !currentOddsState.t60_snapshot) {
        t60_snapshot = { odds: cleanFinalOdds, timestamp: new Date().toISOString() };
        stats.snapshots++;
        Logger.info("T-60 Captured", { dbMatchId });
      }
      if (inT0 && !currentOddsState.t0_snapshot) {
        t0_snapshot = { odds: cleanFinalOdds, timestamp: new Date().toISOString() };
        stats.snapshots++;
        Logger.info("T-0 Captured", { dbMatchId });
      }
    }

    await upsertWithRetry('matches', matchPayload);

    // DELEGATE ODDS TO CONTRACT ARCHITECTURE
    const isExistingExternal = existingMatch?.current_odds?.provider && String(existingMatch.current_odds.provider).toLowerCase() !== 'espn';

    let canonicalOddsPayload = null;
    if (finalOddsHasKeys && (!isExistingExternal || espnOdds.provider)) {
      canonicalOddsPayload = toCanonicalOdds(finalMarketOdds, {
        provider: finalMarketOdds.provider || 'ESPN',
        isLive: isLiveGame,
        updatedAt: new Date().toISOString()
      });

      await writeCurrentOdds({
        supabase,
        matchId: dbMatchId,
        rawOdds: finalMarketOdds,
        provider: finalMarketOdds.provider || 'ESPN',
        isLive: isLiveGame,
        updatedAt: new Date().toISOString()
      }).catch((e: any) => console.error("writeCurrentOdds failed", e));
    }

    const effectiveOdds = (isExistingExternal && existingMatch?.current_odds) ? existingMatch.current_odds : canonicalOddsPayload;
    const currentOddsLineage = resolveCurrentOddsLineage({
      existingCurrentOdds: existingMatch?.current_odds,
      effectiveOdds,
      finalMarketOdds,
      espnOdds
    });
    matchPayload.current_odds = effectiveOdds;
    const aiSignalResult = computeAISignalsSafely(matchPayload, {
      matchId: dbMatchId,
      leagueId: league.id,
      mode: 'persist'
    });
    const aiSignals = aiSignalResult.value;
    delete matchPayload.current_odds;

    // 🚨 RESTORED: THE CONTEXTUAL INTELLIGENCE MOAT
    const statePayload = {
      id: dbMatchId,
      league_id: league.id,
      sport: league.db_sport,
      game_status: matchPayload.status || 'SCHEDULED',
      canonical_id: canonicalId,
      period: comp.status?.period,
      clock: comp.status?.displayClock,
      home_score: homeScore,
      away_score: awayScore,

      // Contextual Intelligence Extraction
      // 🚨 PASSES league.espn_sport so the Adapters parse correctly!
      situation: Object.keys(mergedSituation).length > 0 ? mergedSituation : null,
      last_play: extractedLastPlay,
      current_drive: extractedDrive,
      recent_plays: extractedRecentPlays,
      stats: extractedStats,
      player_stats: extractedPlayerStats,
      leaders: extractedLeaders,
      momentum: extractedMomentum,
      advanced_metrics: extractedAdvancedMetrics,
      match_context: extractedContext,
      predictor: extractedPredictor,

      deterministic_signals: aiSignals,
      odds: {
        current: effectiveOdds,
        t60_snapshot: t60_snapshot || currentOddsState.t60_snapshot || null,
        t0_snapshot: t0_snapshot || currentOddsState.t0_snapshot || null
      },
      updated_at: new Date().toISOString()
    };

    const primaryLiveOdds = resolvePrimaryLiveOdds({
      espnOdds,
      parsedOdds,
      effectiveOdds
    });

    const capturedAt = new Date().toISOString();
    const contextSnapshotPayload = {
      match_id: dbMatchId,
      league_id: league.id,
      sport: league.db_sport,
      game_status: matchPayload.status || 'SCHEDULED',
      period: comp.status?.period ?? null,
      clock: comp.status?.displayClock ?? null,
      home_score: homeScore,
      away_score: awayScore,
      odds_current: primaryLiveOdds || null,
      odds_total: parseLine((primaryLiveOdds as any)?.total ?? (primaryLiveOdds as any)?.total_points ?? (primaryLiveOdds as any)?.overUnder ?? (primaryLiveOdds as any)?.over_under),
      odds_home_ml: parseAmerican((primaryLiveOdds as any)?.homeWin ?? (primaryLiveOdds as any)?.homeML ?? (primaryLiveOdds as any)?.home_ml),
      odds_away_ml: parseAmerican((primaryLiveOdds as any)?.awayWin ?? (primaryLiveOdds as any)?.awayML ?? (primaryLiveOdds as any)?.away_ml),
      situation: Object.keys(mergedSituation).length > 0 ? mergedSituation : null,
      last_play: extractedLastPlay,
      recent_plays: extractedRecentPlays,
      stats: extractedStats,
      leaders: extractedLeaders,
      momentum: extractedMomentum,
      advanced_metrics: extractedAdvancedMetrics,
      match_context: extractedContext,
      predictor: extractedPredictor,
      deterministic_signals: aiSignals,
      captured_at: capturedAt
    };

    const liveOddsSnapshotRows = buildLiveOddsSnapshotRows({
      capturedAt,
      comp,
      league,
      matchId: dbMatchId,
      homeScore,
      awayScore,
      homeTeam: homeNameStr,
      awayTeam: awayNameStr,
      espnOdds,
      effectiveOdds,
      finalMarketOdds,
      parsedOdds,
      currentOddsLineage
    });

    await upsertWithRetry('live_game_state', statePayload);

    const hasAnyOdds = !!(parsedOdds.odds_live || parsedOdds.odds_open || parsedOdds.odds_close || parsedOdds.bet365_live || parsedOdds.dk_live_200);
    if (hasAnyOdds) {
      const epochSeconds = Math.floor(Date.now() / 1000);
      const oddsSnapshotPayload: any = {
        match_id: dbMatchId,
        league_id: league.id,
        sport: league.db_sport,
        event_type: 'odds_snapshot',
        sequence: epochSeconds,
        period: comp.status?.period ?? null,
        clock: comp.status?.displayClock ?? null,
        home_score: homeScore,
        away_score: awayScore,
        odds_open: parsedOdds.odds_open,
        odds_close: parsedOdds.odds_close,
        odds_live: parsedOdds.odds_live,
        bet365_live: parsedOdds.bet365_live,
        dk_live_200: parsedOdds.dk_live_200,
        player_props: parsedOdds.player_props,
        match_state: {
          status: comp.status?.type?.name ?? null,
          home_team: getCompetitorName(home),
          away_team: getCompetitorName(away),
          score: `${homeScore}-${awayScore}`,
          period: comp.status?.period ?? null,
          clock: comp.status?.displayClock ?? null
        },
        source: 'espn_live_odds'
      };

      try {
        const { error: geError } = await supabase
          .from('game_events')
          .upsert(oddsSnapshotPayload, { onConflict: 'match_id,event_type,sequence' });

        if (!geError) {
          stats.odds_snapshots_written++;
        } else {
          Logger.warn('ODDS_SNAPSHOT_WRITE_FAILED', {
            match_id: dbMatchId,
            error: geError.message
          });
        }
      } catch (e: any) {
        Logger.warn('ODDS_SNAPSHOT_ERROR', {
          match_id: dbMatchId,
          error: e?.message || String(e)
        });
      }
    }

    if (liveOddsSnapshotRows.length === 0) {
      Logger.info('LIVE_ODDS_SNAPSHOT_SKIPPED', {
        match_id: dbMatchId,
        league_id: league.id,
        normalized_state: normalizeSnapshotState(comp),
        has_espn_odds: !!espnOdds,
        has_parsed_live: !!parsedOdds.odds_live,
        has_effective_odds: !!effectiveOdds,
        has_final_market_odds: !!finalMarketOdds
      });
    }

    if (_liveOddsSnapshotsAvailable && liveOddsSnapshotRows.length > 0) {
      const { error: liveOddsSnapshotError } = await supabase
        .from('live_odds_snapshots')
        .insert(liveOddsSnapshotRows);

      if (!liveOddsSnapshotError) {
        stats.live_odds_snapshots_written += liveOddsSnapshotRows.length;
        Logger.info('LIVE_ODDS_SNAPSHOT_WRITTEN', {
          match_id: dbMatchId,
          league_id: league.id,
          rows: liveOddsSnapshotRows.length,
          providers: Array.from(new Set(liveOddsSnapshotRows.map((row: any) => row.provider)))
        });
      } else {
        const errMsg = liveOddsSnapshotError.message || String(liveOddsSnapshotError);
        if (errMsg.toLowerCase().includes('live_odds_snapshots') && errMsg.toLowerCase().includes('does not exist')) {
          _liveOddsSnapshotsAvailable = false;
          Logger.warn('LIVE_ODDS_SNAPSHOT_DISABLED', {
            reason: 'table_missing',
            error: errMsg
          });
        } else {
          Logger.warn('LIVE_ODDS_SNAPSHOT_INSERT_FAILED', {
            match_id: dbMatchId,
            league_id: league.id,
            rows: liveOddsSnapshotRows.length,
            error: errMsg
          });
        }
      }
    }

    if (_contextSnapshotAvailable) {
      const supabase = getSupabaseClient();
      const { error: contextSnapshotError } = await supabase
        .from('live_context_snapshots')
        .insert(contextSnapshotPayload);

      if (!contextSnapshotError) {
        stats.context_snapshots++;
      } else {
        const errMsg = contextSnapshotError.message || String(contextSnapshotError);
        if (errMsg.toLowerCase().includes('live_context_snapshots') && errMsg.toLowerCase().includes('does not exist')) {
          _contextSnapshotAvailable = false;
          Logger.warn('CONTEXT_SNAPSHOT_DISABLED', {
            reason: 'table_missing',
            error: errMsg
          });
        } else {
          // Non-fatal: never block ingest on snapshot archive write.
          Logger.warn('CONTEXT_SNAPSHOT_INSERT_FAILED', {
            match_id: dbMatchId,
            league_id: league.id,
            error: errMsg
          });
        }
      }
    }
    stats.processed++;
    stats.live++;
  } catch (e: any) {
    stats.failed++;
    stats.errors.push(`${league.id}/${dbMatchId}: ${e.message || String(e)}`);
    Logger.error('ProcessGame Failed', { matchId: dbMatchId, error: e.message || e });
  }
}
