declare const Deno: any;

import { createClient } from 'npm:@supabase/supabase-js@2'
import { EspnAdapters, Safe } from '../_shared/espnAdapters.ts'
import { getCanonicalLeagueId, getCanonicalMatchId, generateDeterministicId, resolveCanonicalMatch } from '../_shared/match-registry.ts'
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

const _localLocks = new Set<string>();

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
  { id: 'ned.1', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/ned.1' },
  { id: 'por.1', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/por.1' },
  { id: 'bel.1', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/bel.1' },
  { id: 'tur.1', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/tur.1' },
  { id: 'bra.1', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/bra.1' },
  { id: 'arg.1', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/arg.1' },
  { id: 'sco.1', db_sport: 'soccer', espn_sport: 'soccer', endpoint: 'soccer/sco.1' },
  { id: 'atp', db_sport: 'tennis', espn_sport: 'tennis', endpoint: 'tennis/atp' },
  { id: 'wta', db_sport: 'tennis', espn_sport: 'tennis', endpoint: 'tennis/wta' }
];

const Logger = {
  info: (msg: string, data?: any) => console.log(JSON.stringify({ level: 'INFO', msg, ...(data || {}) })),
  warn: (msg: string, data?: any) => console.warn(JSON.stringify({ level: 'WARN', msg, ...(data || {}) })),
  debug: (msg: string, data?: any) => console.log(JSON.stringify({ level: 'DEBUG', msg, ...(data || {}) })),
  error: (msg: string, error?: any) => console.error(JSON.stringify({ level: 'ERROR', msg, error: error?.message || error }))
};

function envInt(name: string, fallback: number, min = 1) {
  const raw = Deno.env.get(name);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.floor(n);
}

function envNonNegativeInt(name: string, fallback: number) {
  const raw = Deno.env.get(name);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function envFloat(name: string, fallback: number, min = 0, max = 100) {
  const raw = Deno.env.get(name);
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

const LIVE_RUNTIME = {
  snapshotStaleSeconds: envInt('LIVE_SNAPSHOT_STALE_SECONDS', 90, 30),
  pbpStaleSeconds: envInt('LIVE_PBP_STALE_SECONDS', 60, 30),
  startGraceMinutes: envInt('LIVE_START_GRACE_MINUTES', 5, 1),
  discoveryLookbackMinutes: envInt('LIVE_DISCOVERY_LOOKBACK_MINUTES', 360, 30),
  preWindowMinutes: envInt('LIVE_PRE_WINDOW_MINUTES', 25, 5),
  perLeagueMaxGames: envInt('LIVE_PER_LEAGUE_MAX_GAMES', 40, 1),
  concurrency: envInt('LIVE_INGEST_CONCURRENCY', 4, 1),
  maxRuntimeMs: envInt('LIVE_MAX_RUNTIME_MS', 50000, 5000),
  dedupeSeconds: envInt('LIVE_SNAPSHOT_DEDUPE_SECONDS', 20, 5),
  degradedRepeatSeconds: envInt('LIVE_DEGRADED_REPEAT_SECONDS', 120, 30),
  sloWindowMinutes: envInt('LIVE_SLO_WINDOW_MINUTES', 240, 30),
  sloMinSnapshotCoveragePct: envFloat('LIVE_SLO_MIN_SNAPSHOT_COVERAGE_PCT', 100),
  sloMinStateCoveragePct: envFloat('LIVE_SLO_MIN_STATE_COVERAGE_PCT', 100),
  sloMinPbpCoveragePct: envFloat('LIVE_SLO_MIN_PBP_COVERAGE_PCT', 100),
  sloMaxMissingGames: envNonNegativeInt('LIVE_SLO_MAX_MISSING_GAMES', 0),
  sloMaxStaleGames: envNonNegativeInt('LIVE_SLO_MAX_STALE_GAMES', 0),
};

const STATUS_KEYS = {
  inProgress: ['IN_PROGRESS', 'STATUS_IN_PROGRESS', 'LIVE', 'HALFTIME', 'STATUS_HALFTIME'],
  final: ['FINAL', 'STATUS_FINAL', 'POST', 'STATUS_FULL_TIME', 'FULL_TIME'],
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

const safeExtract = (name: string, fn: () => any) => {
  try { const value = fn(); return value === undefined ? null : value; }
  catch (e: any) { Logger.warn(`EXTRACTION_FAILED`, { field: name, error: e.message || String(e) }); return null; }
};

const getCompetitorName = (c: any) => c?.team?.displayName || c?.athlete?.displayName || 'Unknown';

let _seqCounter = 0;
function generateSequence(): number {
  const base = Math.floor(Date.now() / 1000) % 2000000;
  return (base * 1000) + (_seqCounter++ % 1000);
}

function parsePrice(val: any): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? Math.trunc(val) : null;
  if (typeof val === 'string') {
    const s = val.trim().toUpperCase();
    if (s === 'EV' || s === 'EVEN') return 100;
    const n = parseInt(s.replace(/[+,]/g, ''), 10);
    return Number.isNaN(n) ? null : n;
  }
  if (typeof val === 'object') {
    if (val.american != null) return parsePrice(val.american);
    if (val.value != null) return parsePrice(val.value);
  }
  return null;
}

function parsePoints(val: any): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'string') {
    const s = val.trim().toUpperCase();
    if (s === 'PK' || s === 'PICK' || s === 'EVEN') return 0;
    if (/^[+-]\d{3,}$/.test(s)) return null;
    const n = parseFloat(s.replace(/[+,]/g, ''));
    return Number.isNaN(n) ? null : n;
  }
  if (typeof val === 'object') {
    if (val.value != null) return parsePoints(val.value);
    if (val.points != null) return parsePoints(val.points);
    if (val.line != null) return parsePoints(val.line);
  }
  return null;
}

function isExternalProvider(provider: unknown): boolean {
  const s = String(provider || '').toLowerCase().trim();
  if (!s) return false;
  return !['espn', 'espnbet', 'espn bet', 'pickcenter', 'consensus'].includes(s);
}

const getLiveProviderScore = (provider: any) => {
  const id = String(provider?.provider?.id || '');
  const name = String(provider?.provider?.name || '').toLowerCase();
  if (id === '200' || name.includes('live')) return 1;
  if (id === '100' || name.includes('draftkings')) return 2;
  if (id === '115' || name.includes('espn')) return 3;
  if (name.includes('fanduel')) return 4;
  if (name.includes('betmgm') || name.includes('mgm')) return 5;
  if (name.includes('caesars')) return 6;
  if (name.includes('consensus')) return 99;
  return 10;
};

const getPregameProviderScore = (provider: any) => {
  const id = String(provider?.provider?.id || '');
  const name = String(provider?.provider?.name || '').toLowerCase();
  if (id === '100' || (name.includes('draftkings') && !name.includes('live'))) return 1;
  if (id === '200' || name.includes('live')) return 2;
  if (id === '115' || name.includes('espn')) return 3;
  if (name.includes('fanduel')) return 4;
  if (name.includes('betmgm') || name.includes('mgm')) return 5;
  if (name.includes('caesars')) return 6;
  if (name.includes('consensus')) return 99;
  return 10;
};

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

interface ParsedProviderOdds {
  odds_open: any; odds_close: any; odds_live: any; bet365_live: any | null; dk_live_200: any | null; player_props: any | null;
}

function parseMultiProviderOdds(summaryData: any, comp: any, isSoccer: boolean): ParsedProviderOdds {
  const result: ParsedProviderOdds = { odds_open: null, odds_close: null, odds_live: null, bet365_live: null, dk_live_200: null, player_props: null };
  const oddsArray = Array.isArray(summaryData?.odds) ? summaryData.odds : [];
  const compOdds = Array.isArray(comp?.odds) ? comp.odds : [];
  const allProviders = [...oddsArray, ...compOdds];
  const pregameSorted = [...allProviders].sort((a, b) => getPregameProviderScore(a) - getPregameProviderScore(b));
  const liveSorted = [...allProviders].sort((a, b) => getLiveProviderScore(a) - getLiveProviderScore(b));

  for (const provider of pregameSorted) {
    const name = String(provider?.provider?.name || '').toLowerCase();
    const id = String(provider?.provider?.id || '');
    const providerLabel = provider?.provider?.name || 'ESPN';
    if (isSoccer && (name.includes('bet365') || id === '2000' || id === '200')) continue;
    if (!result.odds_open && provider?.open) {
      result.odds_open = { home_ml: parsePrice(provider.open?.homeTeamOdds?.moneyLine ?? provider.open?.moneyLine), away_ml: parsePrice(provider.open?.awayTeamOdds?.moneyLine), homeSpread: parsePoints(provider.open?.homeTeamOdds?.spread ?? provider.open?.spread), awaySpread: parsePoints(provider.open?.awayTeamOdds?.spread), total: parsePoints(provider.open?.overUnder), overOdds: parsePrice(provider.open?.overOdds ?? provider.open?.overUnderOdds), underOdds: parsePrice(provider.open?.underOdds), homeSpreadOdds: parsePrice(provider.open?.homeTeamOdds?.spreadOdds ?? provider.open?.spreadOdds), awaySpreadOdds: parsePrice(provider.open?.awayTeamOdds?.spreadOdds), provider: providerLabel, provider_id: id || null };
    }
    if (!result.odds_close && provider?.close) {
      result.odds_close = { home_ml: parsePrice(provider.close?.homeTeamOdds?.moneyLine ?? provider.close?.moneyLine), away_ml: parsePrice(provider.close?.awayTeamOdds?.moneyLine), homeSpread: parsePoints(provider.close?.homeTeamOdds?.spread ?? provider.close?.spread), awaySpread: parsePoints(provider.close?.awayTeamOdds?.spread), total: parsePoints(provider.close?.overUnder), overOdds: parsePrice(provider.close?.overOdds ?? provider.close?.overUnderOdds), underOdds: parsePrice(provider.close?.underOdds), homeSpreadOdds: parsePrice(provider.close?.homeTeamOdds?.spreadOdds ?? provider.close?.spreadOdds), awaySpreadOdds: parsePrice(provider.close?.awayTeamOdds?.spreadOdds), provider: providerLabel, provider_id: id || null };
    }
  }

  for (const provider of liveSorted) {
    const name = String(provider?.provider?.name || '').toLowerCase();
    const id = String(provider?.provider?.id || '');
    const providerLabel = provider?.provider?.name || 'ESPN';
    if (isSoccer && (name.includes('bet365') || id === '2000')) {
      if (!result.bet365_live) {
        const teamOdds = provider?.teamOdds || provider?.bettingOdds || {};
        result.bet365_live = { home_1x2: parsePrice(teamOdds?.home?.moneyLine), draw_1x2: parsePrice(teamOdds?.draw?.moneyLine), away_1x2: parsePrice(teamOdds?.away?.moneyLine), total: parsePoints(provider?.overUnder), over_under: parsePoints(provider?.overUnder), double_chance: provider?.doubleChance ?? null, is_live: !!provider?.current, provider: 'Bet365', provider_id: id || '2000', captured_at: new Date().toISOString() };
        const playerOdds = provider?.playerOdds || provider?.bettingOdds?.players || [];
        if (Array.isArray(playerOdds) && playerOdds.length > 0) {
          result.player_props = { market: 'ATGS', players: playerOdds.map((p: any) => ({ name: p?.athlete?.displayName || p?.name || 'Unknown', team: p?.team?.displayName || null, odds_fractional: p?.odds || null, odds_american: p?.odds ? fractionalToAmerican(String(p.odds)) : null })).filter((p: any) => p.odds_fractional), count: playerOdds.length, captured_at: new Date().toISOString() };
        }
      }
    } else if (isSoccer && id === '200') {
      if (!result.dk_live_200) { result.dk_live_200 = { home_ml: parsePrice(provider?.homeTeamOdds?.moneyLine), away_ml: parsePrice(provider?.awayTeamOdds?.moneyLine), spread: parsePoints(provider?.spread), total: parsePoints(provider?.overUnder), provider: 'DraftKings Live', provider_id: '200', captured_at: new Date().toISOString() }; }
    } else if (!isSoccer) {
      if (!result.odds_live && provider?.current) {
        result.odds_live = { home_ml: parsePrice(provider.current?.homeTeamOdds?.moneyLine ?? provider.current?.moneyLine), away_ml: parsePrice(provider.current?.awayTeamOdds?.moneyLine), homeSpread: parsePoints(provider.current?.homeTeamOdds?.spread ?? provider.current?.spread), awaySpread: parsePoints(provider.current?.awayTeamOdds?.spread), total: parsePoints(provider.current?.overUnder), overOdds: parsePrice(provider.current?.overOdds ?? provider.current?.overUnderOdds), underOdds: parsePrice(provider.current?.underOdds), homeSpreadOdds: parsePrice(provider.current?.homeTeamOdds?.spreadOdds ?? provider.current?.spreadOdds), awaySpreadOdds: parsePrice(provider.current?.awayTeamOdds?.spreadOdds), provider: providerLabel, provider_id: id || null, captured_at: new Date().toISOString() };
      }
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

function statusIncludesAny(rawStatus: any, keys: string[]): boolean {
  const status = String(rawStatus || '').toUpperCase();
  return keys.some((key) => status.includes(key));
}

function isInProgressStatus(rawStatus: any): boolean {
  return statusIncludesAny(rawStatus, STATUS_KEYS.inProgress);
}

function isFinalStatus(rawStatus: any): boolean {
  return statusIncludesAny(rawStatus, STATUS_KEYS.final);
}

function parseEventStartMs(event: any): number | null {
  const startMs = new Date(event?.date || 0).getTime();
  return Number.isFinite(startMs) && startMs > 0 ? startMs : null;
}

function isLikelyStartedEvent(event: any): boolean {
  const state = String(event?.status?.type?.state || '').toLowerCase();
  if (state === 'in' || state === 'post') return true;
  const rawStatus = event?.status?.type?.name ?? event?.status?.type?.description ?? '';
  if (isInProgressStatus(rawStatus) || isFinalStatus(rawStatus)) return true;
  const startMs = parseEventStartMs(event);
  if (startMs === null) return false;
  const minutesSinceStart = (Date.now() - startMs) / 60000;
  return minutesSinceStart >= LIVE_RUNTIME.startGraceMinutes;
}

function isLikelyInProgressEvent(event: any): boolean {
  const state = String(event?.status?.type?.state || '').toLowerCase();
  if (state === 'in') return true;
  const rawStatus = event?.status?.type?.name ?? event?.status?.type?.description ?? '';
  return isInProgressStatus(rawStatus);
}

function extractEventIdFromMatchId(matchId: string): string {
  const raw = String(matchId || '');
  const idx = raw.indexOf('_');
  if (idx <= 0) return raw;
  return raw.slice(0, idx);
}

function pushLimited(list: any[], value: any, max = 50) {
  if (list.length < max) list.push(value);
}

async function safeLogJobRunStart(supabase: any, input: {
  triggerType: 'scheduled' | 'watchdog' | 'replay' | 'manual';
  leagueFilter: string[];
  scoreboardDates: string[];
  dryRun: boolean;
  targetCount: number;
}) {
  const runId = crypto.randomUUID();
  try {
    const { error } = await supabase.from('job_runs').insert({
      id: runId,
      job_id: 'ingest-live-games',
      job_name: 'ingest-live-games',
      target_object: 'HUB_GAMES_LIVE',
      status: 'running',
      started_at: new Date().toISOString(),
      trigger_type: input.triggerType,
      metadata: {
        league_filter: input.leagueFilter,
        scoreboard_dates: input.scoreboardDates,
        dry_run: input.dryRun,
        target_count: input.targetCount,
        freshness_thresholds: {
          snapshot_stale_seconds: LIVE_RUNTIME.snapshotStaleSeconds,
          pbp_stale_seconds: LIVE_RUNTIME.pbpStaleSeconds,
        },
      }
    });
    if (error) throw error;
    return runId;
  } catch (e: any) {
    Logger.warn('JOB_RUN_START_LOG_FAILED', { error: e?.message || String(e) });
    return null;
  }
}

async function safeLogJobRunEnd(supabase: any, runId: string | null, input: {
  status: 'succeeded' | 'failed' | 'replayed';
  rowsRead: number;
  rowsWritten: number;
  errorMessage?: string | null;
  metadata: any;
}) {
  if (!runId) return;
  try {
    const { error } = await supabase.from('job_runs').update({
      status: input.status,
      finished_at: new Date().toISOString(),
      rows_read: input.rowsRead,
      rows_written: input.rowsWritten,
      row_count: input.rowsWritten,
      error_message: input.errorMessage ?? null,
      metadata: input.metadata,
    }).eq('id', runId);
    if (error) throw error;
  } catch (e: any) {
    Logger.warn('JOB_RUN_END_LOG_FAILED', { run_id: runId, error: e?.message || String(e) });
  }
}

async function safeInsertLiveReliabilityLog(supabase: any, payload: any) {
  try {
    const { error } = await supabase.from('live_pipeline_reliability_logs').insert(payload);
    if (error) throw error;
  } catch (e: any) {
    Logger.warn('LIVE_RELIABILITY_LOG_FAILED', { error: e?.message || String(e) });
  }
}

type CoverageProbe = {
  hasLiveOddsSnapshot: boolean;
  hasLiveState: boolean;
  hasPbp: boolean;
  latestSnapshotAt: string | null;
  latestLiveStateAt: string | null;
  latestPbpAt: string | null;
  staleSecondsSnapshot: number | null;
  staleSecondsPbp: number | null;
  coverageStatus: 'OK' | 'MISSING_SNAPSHOT' | 'MISSING_PBP' | 'MISSING_BOTH' | 'STALE_SNAPSHOT' | 'STALE_PBP';
};

type LiveCapability = {
  league_id: string;
  sport: string;
  live_odds_supported: boolean;
  live_state_supported: boolean;
  pbp_supported: boolean;
  auto_recovery_enabled: boolean;
  slo_enforced: boolean;
};

type CapabilityAdjustedProbe = CoverageProbe & {
  liveOddsRequired: boolean;
  liveStateRequired: boolean;
  pbpRequired: boolean;
  autoRecoveryEnabled: boolean;
  sloEnforced: boolean;
  effectiveCoverageStatus: CoverageProbe['coverageStatus'];
};

function defaultCapability(leagueId: string, sport: string): LiveCapability {
  const s = String(sport || '').toLowerCase();
  const l = String(leagueId || '').toLowerCase();
  const pbpUnsupportedSports = new Set(['tennis', 'mma', 'golf', 'boxing', 'racing']);
  const pbpUnsupportedLeagues = new Set(['atp', 'wta', 'ufc', 'pga']);
  const pbpSupported = !pbpUnsupportedSports.has(s) && !pbpUnsupportedLeagues.has(l);
  return {
    league_id: leagueId,
    sport,
    live_odds_supported: true,
    live_state_supported: true,
    pbp_supported: pbpSupported,
    auto_recovery_enabled: true,
    slo_enforced: true,
  };
}

async function loadCapabilitiesByLeague(supabase: any): Promise<Map<string, LiveCapability>> {
  const map = new Map<string, LiveCapability>();
  try {
    const { data, error } = await supabase
      .from('live_pipeline_capabilities')
      .select('league_id,sport,live_odds_supported,live_state_supported,pbp_supported,auto_recovery_enabled,slo_enforced')
      .eq('is_active', true);
    if (error) throw error;
    for (const row of (data || [])) {
      const leagueId = String(row?.league_id || '').trim();
      if (!leagueId) continue;
      map.set(leagueId, {
        league_id: leagueId,
        sport: String(row?.sport || '').trim(),
        live_odds_supported: row?.live_odds_supported !== false,
        live_state_supported: row?.live_state_supported !== false,
        pbp_supported: row?.pbp_supported !== false,
        auto_recovery_enabled: row?.auto_recovery_enabled !== false,
        slo_enforced: row?.slo_enforced !== false,
      });
    }
  } catch (e: any) {
    Logger.warn('LIVE_CAPABILITIES_LOAD_FAILED', { error: e?.message || String(e) });
  }
  return map;
}

function adjustProbeWithCapability(
  probe: CoverageProbe,
  capability: LiveCapability,
  opts: { started: boolean; inProgress: boolean },
): CapabilityAdjustedProbe {
  const missingSnapshot = opts.started && capability.live_odds_supported && !probe.hasLiveOddsSnapshot;
  const missingState = opts.started && capability.live_state_supported && !probe.hasLiveState;
  const missingPbp = opts.started && capability.pbp_supported && !probe.hasPbp;
  const staleSnapshot = opts.inProgress
    && capability.live_odds_supported
    && probe.staleSecondsSnapshot !== null
    && probe.staleSecondsSnapshot > LIVE_RUNTIME.snapshotStaleSeconds;
  const stalePbp = opts.inProgress
    && capability.pbp_supported
    && probe.staleSecondsPbp !== null
    && probe.staleSecondsPbp > LIVE_RUNTIME.pbpStaleSeconds;

  let effectiveCoverageStatus: CoverageProbe['coverageStatus'] = 'OK';
  if (missingSnapshot && (missingState || missingPbp)) effectiveCoverageStatus = 'MISSING_BOTH';
  else if (missingSnapshot) effectiveCoverageStatus = 'MISSING_SNAPSHOT';
  else if (missingState || missingPbp) effectiveCoverageStatus = 'MISSING_PBP';
  else if (staleSnapshot) effectiveCoverageStatus = 'STALE_SNAPSHOT';
  else if (stalePbp) effectiveCoverageStatus = 'STALE_PBP';

  return {
    ...probe,
    liveOddsRequired: capability.live_odds_supported,
    liveStateRequired: capability.live_state_supported,
    pbpRequired: capability.pbp_supported,
    autoRecoveryEnabled: capability.auto_recovery_enabled,
    sloEnforced: capability.slo_enforced,
    effectiveCoverageStatus,
  };
}

async function evaluateCurrentSlo(input: {
  supabase: any;
  leagueIds: string[];
  capabilityByLeague: Map<string, LiveCapability>;
}) {
  const { supabase, capabilityByLeague } = input;
  const leagueIds = [...new Set(input.leagueIds.filter(Boolean))];
  const thresholds = {
    windowMinutes: LIVE_RUNTIME.sloWindowMinutes,
    minSnapshotCoveragePct: LIVE_RUNTIME.sloMinSnapshotCoveragePct,
    minStateCoveragePct: LIVE_RUNTIME.sloMinStateCoveragePct,
    minPbpCoveragePct: LIVE_RUNTIME.sloMinPbpCoveragePct,
    maxMissingGames: LIVE_RUNTIME.sloMaxMissingGames,
    maxStaleGames: LIVE_RUNTIME.sloMaxStaleGames,
    snapshotStaleSeconds: LIVE_RUNTIME.snapshotStaleSeconds,
    pbpStaleSeconds: LIVE_RUNTIME.pbpStaleSeconds,
  };
  try {
    const { data: cfgRow, error: cfgErr } = await supabase
      .from('live_pipeline_slo_config')
      .select('window_minutes,min_snapshot_coverage_pct,min_state_coverage_pct,min_pbp_coverage_pct,max_missing_games,max_stale_games')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!cfgErr && cfgRow) {
      const num = (val: any, fallback: number) => {
        const n = Number(val);
        return Number.isFinite(n) ? n : fallback;
      };
      thresholds.windowMinutes = Math.max(30, Math.floor(num(cfgRow.window_minutes, thresholds.windowMinutes)));
      thresholds.minSnapshotCoveragePct = Math.max(0, Math.min(100, num(cfgRow.min_snapshot_coverage_pct, thresholds.minSnapshotCoveragePct)));
      thresholds.minStateCoveragePct = Math.max(0, Math.min(100, num(cfgRow.min_state_coverage_pct, thresholds.minStateCoveragePct)));
      thresholds.minPbpCoveragePct = Math.max(0, Math.min(100, num(cfgRow.min_pbp_coverage_pct, thresholds.minPbpCoveragePct)));
      thresholds.maxMissingGames = Math.max(0, Math.floor(num(cfgRow.max_missing_games, thresholds.maxMissingGames)));
      thresholds.maxStaleGames = Math.max(0, Math.floor(num(cfgRow.max_stale_games, thresholds.maxStaleGames)));
    }
  } catch {
    // Fallback to env-configured thresholds if table does not exist yet.
  }
  try {
    const { data: freshRow, error: freshErr } = await supabase
      .from('live_pipeline_config')
      .select('snapshot_stale_seconds,pbp_stale_seconds')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!freshErr && freshRow) {
      const snap = Number(freshRow.snapshot_stale_seconds);
      const pbp = Number(freshRow.pbp_stale_seconds);
      if (Number.isFinite(snap) && snap > 0) thresholds.snapshotStaleSeconds = Math.floor(snap);
      if (Number.isFinite(pbp) && pbp > 0) thresholds.pbpStaleSeconds = Math.floor(pbp);
    }
  } catch {
    // Keep runtime defaults if config table lookup fails.
  }
  const windowStartIso = new Date(Date.now() - thresholds.windowMinutes * 60000).toISOString();

  let query = supabase
    .from('vw_live_pipeline_coverage')
    .select('match_id,league_id,sport,start_time,started,game_phase,has_live_odds_snapshot,has_live_state,has_pbp,stale_seconds_snapshot,stale_seconds_pbp')
    .gte('start_time', windowStartIso)
    .eq('started', true);
  if (leagueIds.length > 0) query = query.in('league_id', leagueIds);

  const { data: rows, error } = await query;
  if (error) throw error;

  const summaryByLeague = new Map<string, any>();
  const breachRows: any[] = [];
  for (const row of (rows || [])) {
    const leagueId = String(row?.league_id || '');
    const sport = String(row?.sport || '');
    const capability = capabilityByLeague.get(leagueId) || defaultCapability(leagueId, sport);
    if (!capability.slo_enforced) continue;

    const key = `${sport}__${leagueId}`;
    const cur = summaryByLeague.get(key) || {
      sport,
      league_id: leagueId,
      started_games: 0,
      required_snapshot_games: 0,
      covered_snapshot_games: 0,
      required_state_games: 0,
      covered_state_games: 0,
      required_pbp_games: 0,
      covered_pbp_games: 0,
      missing_required_games: 0,
      stale_required_games: 0,
    };

    cur.started_games++;
    if (capability.live_odds_supported) {
      cur.required_snapshot_games++;
      if (row.has_live_odds_snapshot) cur.covered_snapshot_games++;
    }
    if (capability.live_state_supported) {
      cur.required_state_games++;
      if (row.has_live_state) cur.covered_state_games++;
    }
    if (capability.pbp_supported) {
      cur.required_pbp_games++;
      if (row.has_pbp) cur.covered_pbp_games++;
    }

    const missingRequired =
      (capability.live_odds_supported && !row.has_live_odds_snapshot)
      || (capability.live_state_supported && !row.has_live_state)
      || (capability.pbp_supported && !row.has_pbp);
    if (missingRequired) cur.missing_required_games++;

    const staleRequired =
      (String(row.game_phase || '').toUpperCase() === 'IN_PROGRESS')
      && (
        (capability.live_odds_supported && Number(row.stale_seconds_snapshot || 0) > thresholds.snapshotStaleSeconds)
        || (capability.pbp_supported && Number(row.stale_seconds_pbp || 0) > thresholds.pbpStaleSeconds)
      );
    if (staleRequired) cur.stale_required_games++;

    summaryByLeague.set(key, cur);
  }

  const summaryRows = Array.from(summaryByLeague.values()).map((r) => {
    const snapshotCoveragePct = r.required_snapshot_games > 0
      ? Number((100 * r.covered_snapshot_games / r.required_snapshot_games).toFixed(2))
      : 100;
    const stateCoveragePct = r.required_state_games > 0
      ? Number((100 * r.covered_state_games / r.required_state_games).toFixed(2))
      : 100;
    const pbpCoveragePct = r.required_pbp_games > 0
      ? Number((100 * r.covered_pbp_games / r.required_pbp_games).toFixed(2))
      : 100;

    const breachReasons: string[] = [];
    if (snapshotCoveragePct < thresholds.minSnapshotCoveragePct) breachReasons.push('SNAPSHOT_COVERAGE');
    if (stateCoveragePct < thresholds.minStateCoveragePct) breachReasons.push('STATE_COVERAGE');
    if (pbpCoveragePct < thresholds.minPbpCoveragePct) breachReasons.push('PBP_COVERAGE');
    if (r.missing_required_games > thresholds.maxMissingGames) breachReasons.push('MISSING_REQUIRED');
    if (r.stale_required_games > thresholds.maxStaleGames) breachReasons.push('STALE_REQUIRED');

    const out = {
      ...r,
      snapshot_coverage_pct: snapshotCoveragePct,
      state_coverage_pct: stateCoveragePct,
      pbp_coverage_pct: pbpCoveragePct,
      breach_reasons: breachReasons,
      slo_breach: breachReasons.length > 0,
    };
    if (out.slo_breach) breachRows.push(out);
    return out;
  });

  return {
    window_minutes: thresholds.windowMinutes,
    min_snapshot_coverage_pct: thresholds.minSnapshotCoveragePct,
    min_state_coverage_pct: thresholds.minStateCoveragePct,
    min_pbp_coverage_pct: thresholds.minPbpCoveragePct,
    max_missing_games: thresholds.maxMissingGames,
    max_stale_games: thresholds.maxStaleGames,
    snapshot_stale_seconds: thresholds.snapshotStaleSeconds,
    pbp_stale_seconds: thresholds.pbpStaleSeconds,
    rows: summaryRows,
    breached: breachRows.length > 0,
    breaches: breachRows.slice(0, 50),
  };
}

async function probeCoverageForMatch(supabase: any, matchId: string, opts: { started: boolean; inProgress: boolean }): Promise<CoverageProbe> {
  const [snapshotRes, stateRes, playRes] = await Promise.all([
    supabase.from('live_odds_snapshots')
      .select('captured_at')
      .eq('match_id', matchId)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('live_game_state')
      .select('updated_at,recent_plays')
      .eq('id', matchId)
      .maybeSingle(),
    supabase.from('game_events')
      .select('created_at')
      .eq('match_id', matchId)
      .eq('event_type', 'play')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const latestSnapshotAt = snapshotRes?.data?.captured_at ?? null;
  const latestLiveStateAt = stateRes?.data?.updated_at ?? null;
  const latestPlayAt = playRes?.data?.created_at ?? null;

  const hasRecentPlaysInState = (() => {
    const recent = stateRes?.data?.recent_plays;
    if (!recent) return false;
    if (Array.isArray(recent)) return recent.length > 0;
    return true;
  })();

  const hasLiveOddsSnapshot = !!latestSnapshotAt;
  const hasLiveState = !!latestLiveStateAt;
  const hasPbp = !!latestPlayAt || hasRecentPlaysInState;
  const latestPbpAt = latestPlayAt || (hasRecentPlaysInState ? latestLiveStateAt : null);

  const staleSecondsSnapshot = (opts.inProgress && latestSnapshotAt)
    ? Math.max(0, Math.floor((Date.now() - new Date(latestSnapshotAt).getTime()) / 1000))
    : null;
  const staleSecondsPbp = (opts.inProgress && (latestPbpAt || latestLiveStateAt))
    ? Math.max(0, Math.floor((Date.now() - new Date(String(latestPbpAt || latestLiveStateAt)).getTime()) / 1000))
    : null;

  let coverageStatus: CoverageProbe['coverageStatus'] = 'OK';
  if (opts.started && !hasLiveOddsSnapshot && !hasLiveState && !hasPbp) {
    coverageStatus = 'MISSING_BOTH';
  } else if (opts.started && !hasLiveOddsSnapshot) {
    coverageStatus = 'MISSING_SNAPSHOT';
  } else if (opts.started && !(hasLiveState || hasPbp)) {
    coverageStatus = 'MISSING_PBP';
  } else if (opts.inProgress && staleSecondsSnapshot !== null && staleSecondsSnapshot > LIVE_RUNTIME.snapshotStaleSeconds) {
    coverageStatus = 'STALE_SNAPSHOT';
  } else if (opts.inProgress && staleSecondsPbp !== null && staleSecondsPbp > LIVE_RUNTIME.pbpStaleSeconds) {
    coverageStatus = 'STALE_PBP';
  }

  return {
    hasLiveOddsSnapshot,
    hasLiveState,
    hasPbp,
    latestSnapshotAt,
    latestLiveStateAt,
    latestPbpAt,
    staleSecondsSnapshot,
    staleSecondsPbp,
    coverageStatus,
  };
}

function extractSnapshotMarket(effectiveOdds: any, parsedOdds: ParsedProviderOdds, finalMarketOdds: any) {
  const homeMl = parsePrice(
    effectiveOdds?.main?.h2h?.home?.price
    ?? effectiveOdds?.homeML
    ?? effectiveOdds?.homeWin
    ?? effectiveOdds?.home_ml
    ?? parsedOdds?.odds_live?.home_ml
    ?? parsedOdds?.odds_live?.homeWin
    ?? finalMarketOdds?.homeWin
  );
  const awayMl = parsePrice(
    effectiveOdds?.main?.h2h?.away?.price
    ?? effectiveOdds?.awayML
    ?? effectiveOdds?.awayWin
    ?? effectiveOdds?.away_ml
    ?? parsedOdds?.odds_live?.away_ml
    ?? parsedOdds?.odds_live?.awayWin
    ?? finalMarketOdds?.awayWin
  );
  const total = parsePoints(
    effectiveOdds?.main?.total?.line
    ?? effectiveOdds?.total
    ?? effectiveOdds?.overUnder
    ?? parsedOdds?.odds_live?.total
    ?? finalMarketOdds?.total
  );
  const homeSpread = parsePoints(
    effectiveOdds?.main?.spread?.home?.point
    ?? effectiveOdds?.homeSpread
    ?? effectiveOdds?.spread
    ?? parsedOdds?.odds_live?.homeSpread
    ?? finalMarketOdds?.homeSpread
  );
  const awaySpread = parsePoints(
    effectiveOdds?.main?.spread?.away?.point
    ?? effectiveOdds?.awaySpread
    ?? parsedOdds?.odds_live?.awaySpread
    ?? finalMarketOdds?.awaySpread
    ?? (homeSpread !== null ? -homeSpread : null)
  );
  const overPrice = parsePrice(
    effectiveOdds?.main?.total?.over?.price
    ?? effectiveOdds?.overOdds
    ?? parsedOdds?.odds_live?.overOdds
    ?? finalMarketOdds?.overOdds
  );
  const underPrice = parsePrice(
    effectiveOdds?.main?.total?.under?.price
    ?? effectiveOdds?.underOdds
    ?? parsedOdds?.odds_live?.underOdds
    ?? finalMarketOdds?.underOdds
  );
  const provider = String(
    effectiveOdds?.market_source_book
    ?? effectiveOdds?.provider
    ?? parsedOdds?.odds_live?.provider
    ?? finalMarketOdds?.provider
    ?? ''
  ).trim();

  const hasMarketData = [homeMl, awayMl, total, homeSpread, awaySpread, overPrice, underPrice].some((v) => v !== null && v !== undefined);

  return {
    homeMl,
    awayMl,
    total,
    homeSpread,
    awaySpread,
    overPrice,
    underPrice,
    provider,
    hasMarketData,
  };
}

async function writeLiveOddsSnapshotWithGuard(input: {
  supabase: any;
  matchId: string;
  leagueId: string;
  sport: string;
  status: string;
  period: number | null;
  clock: string | null;
  homeScore: number;
  awayScore: number;
  homeTeam: string | null;
  awayTeam: string | null;
  effectiveOdds: any;
  parsedOdds: ParsedProviderOdds;
  finalMarketOdds: any;
  isLiveGame: boolean;
  source: string;
  degradeReason?: string | null;
}) {
  const market = extractSnapshotMarket(input.effectiveOdds, input.parsedOdds, input.finalMarketOdds);
  const provider = market.hasMarketData
    ? (market.provider || 'UNKNOWN_PROVIDER')
    : `DEGRADED_${String(input.degradeReason || 'NO_MARKET_DATA').toUpperCase()}`;
  const degradeReason = market.hasMarketData ? null : (input.degradeReason || 'NO_MARKET_DATA');
  const nowIso = new Date().toISOString();

  const { data: latestRow } = await input.supabase
    .from('live_odds_snapshots')
    .select('captured_at,provider,status,period,clock,home_score,away_score,total,home_ml,away_ml,spread_home,spread_away')
    .eq('match_id', input.matchId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRow?.captured_at) {
    const ageSec = Math.max(0, Math.floor((Date.now() - new Date(latestRow.captured_at).getTime()) / 1000));
    const sameState = Number(latestRow?.home_score ?? -9999) === Number(input.homeScore)
      && Number(latestRow?.away_score ?? -9999) === Number(input.awayScore)
      && Number(latestRow?.period ?? -9999) === Number(input.period ?? -9999)
      && String(latestRow?.clock ?? '') === String(input.clock ?? '')
      && String(latestRow?.status ?? '') === String(input.status ?? '');

    const sameMarket = Number(latestRow?.total ?? NaN) === Number(market.total ?? NaN)
      && Number(latestRow?.home_ml ?? NaN) === Number(market.homeMl ?? NaN)
      && Number(latestRow?.away_ml ?? NaN) === Number(market.awayMl ?? NaN)
      && Number(latestRow?.spread_home ?? NaN) === Number(market.homeSpread ?? NaN)
      && Number(latestRow?.spread_away ?? NaN) === Number(market.awaySpread ?? NaN)
      && String(latestRow?.provider ?? '') === provider;

    if (sameState && sameMarket && ageSec <= LIVE_RUNTIME.dedupeSeconds) {
      return { inserted: false, degraded: !market.hasMarketData, providerFailure: !market.hasMarketData, skippedDuplicate: true };
    }
    if (!market.hasMarketData && sameState && String(latestRow?.provider || '').toUpperCase().includes('DEGRADED') && ageSec <= LIVE_RUNTIME.degradedRepeatSeconds) {
      return { inserted: false, degraded: true, providerFailure: true, skippedDuplicate: true };
    }
  }

  const payload: any = {
    match_id: input.matchId,
    league_id: input.leagueId,
    sport: input.sport,
    provider,
    captured_at: nowIso,
    status: input.status,
    period: input.period,
    clock: input.clock,
    home_score: input.homeScore,
    away_score: input.awayScore,
    home_team: input.homeTeam,
    away_team: input.awayTeam,
    home_ml: market.homeMl,
    away_ml: market.awayMl,
    spread_home: market.homeSpread,
    spread_away: market.awaySpread,
    total: market.total,
    over_price: market.overPrice,
    under_price: market.underPrice,
    is_live: input.isLiveGame,
    market_type: market.hasMarketData ? 'live_ingest' : 'provider_degradation',
    source: input.source,
  };

  const { error } = await input.supabase.from('live_odds_snapshots').insert(payload);
  if (error) {
    if (degradeReason) {
      Logger.warn('LIVE_SNAPSHOT_INSERT_FAILED_DEGRADED', { match_id: input.matchId, error: error.message });
    } else {
      Logger.warn('LIVE_SNAPSHOT_INSERT_FAILED', { match_id: input.matchId, error: error.message });
    }
    return { inserted: false, degraded: !market.hasMarketData, providerFailure: !market.hasMarketData, skippedDuplicate: false, error: error.message };
  }

  return {
    inserted: true,
    degraded: !market.hasMarketData,
    providerFailure: !market.hasMarketData,
    skippedDuplicate: false,
  };
}

function formatYmdInTz(date: Date, timeZone = 'America/New_York'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const d = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}${m}${d}`;
}

function resolveScoreboardDates(rawDates: any): string[] {
  if (rawDates !== null && rawDates !== undefined && String(rawDates).trim() !== '') {
    return [...new Set(String(rawDates).split(',').map((d) => d.trim()).filter(Boolean))];
  }
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return [...new Set([
    formatYmdInTz(yesterday),
    formatYmdInTz(now),
    formatYmdInTz(tomorrow),
  ])];
}

function eventStateRank(event: any): number {
  const state = String(event?.status?.type?.state || '').toLowerCase();
  if (state === 'in') return 0;
  if (state === 'pre') return 1;
  if (state === 'post') return 2;
  return 3;
}

function parseDisplayClockToSeconds(clockRaw: string | null | undefined): number {
  const raw = String(clockRaw || '').trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/['"]/g, '');
  const mmss = cleaned.match(/^(\d{1,3}):(\d{1,2})$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const mins = cleaned.match(/^(\d{1,3})(?:\+(\d{1,2}))?$/);
  if (mins) return Number(mins[1]) * 60 + Number(mins[2] ?? 0);
  return 0;
}

function deriveStablePlaySequence(play: any, index: number, salt = ''): number {
  const rawSeq = parseInt(String(play?.sequenceNumber ?? ''), 10);
  if (Number.isFinite(rawSeq) && rawSeq > 0 && rawSeq <= 2147483647) return rawSeq;

  const idDigits = parseInt(String(play?.id || '').replace(/\D/g, '').slice(-9), 10);
  if (Number.isFinite(idDigits) && idDigits > 0 && idDigits <= 2147483647) return idDigits;

  const seed = `${salt}|${play?.id ?? ''}|${play?.clock?.displayValue ?? play?.clock ?? ''}|${play?.text ?? ''}|${play?.period?.number ?? play?.period ?? ''}|${index}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 2147483000;
  return hash > 0 ? hash : (generateSequence() + index);
}

async function buildMarketPassthroughSignals(input: {
  leagueId: string;
  dbSport: string;
  statusName?: string;
  period?: number;
  displayClock?: string;
  homeScore: number;
  awayScore: number;
  effectiveOdds: any;
  bpiPayloadData: any;
  dbMatchId: string;
  supabase: any;
}) {
  const { leagueId, dbSport, statusName, period = 0, displayClock, homeScore, awayScore, effectiveOdds, bpiPayloadData, dbMatchId, supabase } = input;
  const sport = String(dbSport || '').toLowerCase();
  const gameTotalMins =
    ['basketball'].includes(sport) ? (leagueId === 'mens-college-basketball' ? 40 : 48)
      : ['hockey', 'icehockey'].includes(sport) ? 60
        : ['soccer'].includes(sport) ? 90
          : ['baseball'].includes(sport) ? 54
            : ['football', 'americanfootball'].includes(sport) ? 60
              : 48;

  const elapsedSecs = (() => {
    const clockSecs = parseDisplayClockToSeconds(displayClock);
    if (!displayClock) return 0;
    if (['basketball'].includes(sport)) {
      const periodMins = leagueId === 'mens-college-basketball' ? 20 : 12;
      const completedPeriods = Math.max(0, Number(period || 0) - 1);
      return completedPeriods * periodMins * 60 + Math.max(0, periodMins * 60 - clockSecs);
    }
    if (['soccer'].includes(sport)) {
      return clockSecs;
    }
    return 0;
  })();

  const elapsedMins = Math.max(1, elapsedSecs / 60);
  const currentTotal = (homeScore ?? 0) + (awayScore ?? 0);
  let dkTotal = parsePoints(effectiveOdds?.total ?? effectiveOdds?.overUnder ?? effectiveOdds?.main?.total?.line);
  let dkSpread = parsePoints(effectiveOdds?.homeSpread ?? effectiveOdds?.spread ?? effectiveOdds?.main?.spread?.home?.point);
  let dkHomeML = parsePrice(effectiveOdds?.homeML ?? effectiveOdds?.moneylineHome ?? effectiveOdds?.homeWin ?? effectiveOdds?.home_ml ?? effectiveOdds?.main?.h2h?.home?.price);
  let dkAwayML = parsePrice(effectiveOdds?.awayML ?? effectiveOdds?.moneylineAway ?? effectiveOdds?.awayWin ?? effectiveOdds?.away_ml ?? effectiveOdds?.main?.h2h?.away?.price);
  const debugTrace = ['source:market_passthrough'];

  if (dkTotal == null || dkSpread == null || dkHomeML == null || dkAwayML == null) {
    try {
      const { data: matchRow } = await supabase
        .from('matches')
        .select('current_odds, opening_odds')
        .eq('id', dbMatchId)
        .maybeSingle();

      if (matchRow) {
        const cur = matchRow.current_odds || {};
        const open = matchRow.opening_odds || {};

        if (dkTotal == null) dkTotal = parsePoints(cur?.total ?? cur?.overUnder ?? open?.total ?? open?.overUnder);
        if (dkSpread == null) dkSpread = parsePoints(cur?.homeSpread ?? cur?.spread ?? open?.homeSpread ?? open?.spread);
        if (dkHomeML == null) dkHomeML = parsePrice(cur?.homeML ?? cur?.moneylineHome ?? cur?.homeWin ?? open?.homeML ?? open?.moneylineHome ?? open?.homeWin);
        if (dkAwayML == null) dkAwayML = parsePrice(cur?.awayML ?? cur?.moneylineAway ?? cur?.awayWin ?? open?.awayML ?? open?.moneylineAway ?? open?.awayWin);

        if (dkTotal != null) {
          debugTrace.push('odds_source:matches_fallback');
        }
      }
    } catch (e: any) {
      Logger.warn('MARKET_PASSTHROUGH_FALLBACK_FAILED', { match_id: dbMatchId, error: e?.message || String(e) });
    }
  }

  const observedPPM = elapsedSecs > 60 ? currentTotal / elapsedMins : 0;
  const projectedPPM = dkTotal ? dkTotal / gameTotalMins : 0;
  const ppmDelta = observedPPM - projectedPPM;

  const espnHomeWinPct = bpiPayloadData?.homePredWinPct ?? null;
  const espnAwayWinPct = bpiPayloadData?.awayPredWinPct ?? null;
  const isLive = String(statusName || '').toUpperCase() === 'STATUS_IN_PROGRESS';
  const isBlowout = Math.abs((homeScore ?? 0) - (awayScore ?? 0)) > (['basketball'].includes(sport) ? 20 : ['soccer'].includes(sport) ? 3 : 4);
  const regime = isBlowout ? 'BLOWOUT' : (elapsedSecs > gameTotalMins * 55) ? 'ENDGAME' : 'NORMAL';
  const edgeState = isLive && projectedPPM > 0 && Math.abs(ppmDelta / projectedPPM) > 0.12 ? 'LEAN' : 'NEUTRAL';
  const marketSourceType = String(effectiveOdds?.market_source_type || 'unknown');
  const marketSourceBook = String(effectiveOdds?.market_source_book || effectiveOdds?.provider || 'unknown');
  const marketSourceConfidence = String(effectiveOdds?.market_source_confidence || 'unknown');
  debugTrace.push(`regime:${regime}`);
  debugTrace.push(`ppm_delta:${ppmDelta.toFixed(3)}`);
  debugTrace.push(`book:${marketSourceBook}`);

  return {
    market_total: dkTotal,
    market_spread: dkSpread,
    market_home_ml: dkHomeML,
    market_away_ml: dkAwayML,
    market_source_type: marketSourceType,
    market_source_book: marketSourceBook,
    market_source_confidence: marketSourceConfidence,
    espn_home_win_pct: espnHomeWinPct,
    espn_away_win_pct: espnAwayWinPct,
    deterministic_fair_total: dkTotal,
    ppm: {
      observed: Number(observedPPM.toFixed(4)),
      projected: Number(projectedPPM.toFixed(4)),
      delta: Number(ppmDelta.toFixed(4))
    },
    edge_state: edgeState,
    edge_points: 0,
    deterministic_regime: regime,
    system_state: isLive ? 'ACTIVE' : 'SILENT',
    game_progress: Math.min(1, elapsedSecs / (gameTotalMins * 60)),
    variance_sd: null,
    p10_total: null,
    p90_total: null,
    narrative: {
      market_lean: ppmDelta > 0.05 ? 'OVER' : ppmDelta < -0.05 ? 'UNDER' : 'NEUTRAL',
      signal_label: isLive ? 'LIVE READ' : 'PREGAME'
    },
    debug_trace: debugTrace
  };
}

// ─── RESILIENT NETWORK FETCHERS ──────────────────────────────
async function fetchWithRetry(url: string, retries = 3) {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      const c = new AbortController();
      const id = setTimeout(() => c.abort(), 8000);
      const res = await fetch(url, { signal: c.signal });
      clearTimeout(id);
      if (res.ok) return res;
      if (res.status === 429) {
        const retryAfterStr = res.headers.get('retry-after');
        const wait = retryAfterStr ? parseInt(retryAfterStr, 10) * 1000 : 2000 * Math.pow(2, i);
        Logger.warn('RATE_LIMIT_429', { url: url.split('?')[0], attempt: i + 1, waitMs: wait });
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (res.status >= 500) {
        Logger.warn(`HTTP_5XX`, { url: url.split('?')[0], status: res.status });
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (e: any) {
      lastErr = e;
      if (i === retries - 1) throw e;
    }
    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
  }
  throw new Error(`Failed after ${retries} retries: ${url} - ${lastErr?.message || 'Timeout'}`);
}

async function fetchCoreJson(url: string, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) return await res.json();
      if (res.status === 429) { const retryAfter = res.headers.get('retry-after'); const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000 * Math.pow(2, attempt); await new Promise(r => setTimeout(r, delay)); continue; }
      if (res.status >= 500) { await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); continue; }
      break;
    } catch (e: any) { await new Promise(r => setTimeout(r, 500 * (attempt + 1))); }
  }
  return null;
}

async function fetchSummaryWithFallback(endpoint: string, matchId: string) {
  let lastError: any = null;
  for (const base of SUMMARY_BASES) {
    const urls = [`${base}/${endpoint}/summary?event=${matchId}`, `${base}/${endpoint}/summary?event=${matchId}&region=us&lang=en&contentorigin=espn`];
    for (const url of urls) {
      try { const res = await fetchWithRetry(url, 2); if (res.ok) return { res, url }; } catch (e: any) { lastError = e; }
    }
  }
  throw new Error(`Summary fetch failed for ${endpoint}/${matchId}: ${lastError?.message || 'unknown error'}`);
}

async function upsertWithRetry(table: string, payload: any, retries = 3) {
  const supabase = getSupabaseClient();
  const onConflict = table === 'closing_lines' ? 'match_id' : 'id';
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { error } = await supabase.from(table).upsert(payload, { onConflict });
    if (!error) return;
    Logger.error(`DB_UPSERT_RETRY`, { table, attempt, maxRetries: retries, error: error.message });
    if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    else throw new Error(`${table} upsert failed after ${retries} attempts: ${error.message}`);
  }
}

async function seedMissingStartedEventsFromMatches(supabase: any, league: any, mergedEvents: Map<string, any>, targetSet: Set<string>) {
  const windowStartIso = new Date(Date.now() - (LIVE_RUNTIME.discoveryLookbackMinutes * 60000)).toISOString();
  const windowEndIso = new Date(Date.now() + (30 * 60000)).toISOString();
  const seeded: any[] = [];

  try {
    const { data: rows, error } = await supabase
      .from('matches')
      .select('id,start_time,status')
      .eq('league_id', league.id)
      .gte('start_time', windowStartIso)
      .lte('start_time', windowEndIso)
      .order('start_time', { ascending: true });

    if (error || !rows) return seeded;

    for (const row of rows) {
      const dbMatchId = String(row?.id || '');
      if (!dbMatchId) continue;
      const eventId = extractEventIdFromMatchId(dbMatchId);
      if (!eventId) continue;
      if (mergedEvents.has(eventId)) continue;
      if (targetSet.size > 0 && !targetSet.has(eventId) && !targetSet.has(dbMatchId)) continue;

      const startMs = new Date(row.start_time).getTime();
      const minutesToStart = Number.isFinite(startMs) ? ((startMs - Date.now()) / 60000) : null;
      const startedByClock = minutesToStart !== null && minutesToStart <= -LIVE_RUNTIME.startGraceMinutes;
      const likelyStarted = startedByClock || isInProgressStatus(row.status) || isFinalStatus(row.status);
      if (!likelyStarted && (minutesToStart === null || minutesToStart > 30)) continue;

      const syntheticEvent = {
        id: eventId,
        date: row.start_time,
        status: {
          type: {
            state: startedByClock ? 'in' : 'pre',
            name: row.status || (startedByClock ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED'),
          }
        },
        competitions: []
      };
      mergedEvents.set(eventId, syntheticEvent);
      seeded.push({ match_id: dbMatchId, event_id: eventId, status: row.status, start_time: row.start_time });
    }
  } catch (e: any) {
    Logger.warn('DB_DISCOVERY_SEED_FAILED', { league_id: league.id, error: e?.message || String(e) });
  }

  return seeded;
}

async function recoverCoverageForMatch(input: {
  supabase: any;
  event: any;
  dbMatchId: string;
  league: any;
  reason: string;
  stats: any;
}) {
  const { supabase, event, dbMatchId, league, reason, stats } = input;
  const matchId = String(event?.id || extractEventIdFromMatchId(dbMatchId));

  try {
    let summaryData: any = null;
    let comp: any = null;
    try {
      const { res } = await fetchSummaryWithFallback(league.endpoint, matchId);
      summaryData = await res.json();
      comp = summaryData?.header?.competitions?.[0] || null;
    } catch (e: any) {
      Logger.warn('RECOVERY_SUMMARY_FETCH_FAILED', { match_id: dbMatchId, reason, error: e?.message || String(e) });
    }

    const competition = comp || event?.competitions?.[0] || null;
    const home = competition?.competitors?.find((c: any) => c.homeAway === 'home') || null;
    const away = competition?.competitors?.find((c: any) => c.homeAway === 'away') || null;

    const fallbackStatus = event?.status?.type?.name || event?.status?.name || (isLikelyStartedEvent(event) ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED');
    const statusName = String(competition?.status?.type?.name || fallbackStatus);
    const isLiveGame = isInProgressStatus(statusName) || isLikelyInProgressEvent(event);
    const period = parseInt(competition?.status?.period, 10) || 0;
    const clock = competition?.status?.displayClock ?? event?.status?.displayClock ?? null;

    const homeScore = Safe.score(home?.score) ?? (parseInt(String(event?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'home')?.score || '0'), 10) || 0);
    const awayScore = Safe.score(away?.score) ?? (parseInt(String(event?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'away')?.score || '0'), 10) || 0);
    const homeName = getCompetitorName(home);
    const awayName = getCompetitorName(away);

    const { data: existingMatch } = await supabase
      .from('matches')
      .select('current_odds,opening_odds')
      .eq('id', dbMatchId)
      .maybeSingle();

    let parsedOdds: ParsedProviderOdds = { odds_open: null, odds_close: null, odds_live: null, bet365_live: null, dk_live_200: null, player_props: null };
    if (summaryData && competition) {
      try {
        parsedOdds = parseMultiProviderOdds(summaryData, competition, league.db_sport === 'soccer');
      } catch { }
    }

    const effectiveOdds = existingMatch?.current_odds ?? existingMatch?.opening_odds ?? parsedOdds?.odds_live ?? null;

    const matchPayload: any = {
      id: dbMatchId,
      league_id: league.id,
      sport: league.db_sport,
      status: statusName,
      period,
      display_clock: clock,
      home_score: homeScore,
      away_score: awayScore,
      last_updated: new Date().toISOString(),
    };
    if (homeName !== 'Unknown') matchPayload.home_team = homeName;
    if (awayName !== 'Unknown') matchPayload.away_team = awayName;
    if (effectiveOdds) matchPayload.current_odds = effectiveOdds;

    await upsertWithRetry('matches', matchPayload);

    const recentPlays = summaryData ? safeExtract('RecoveryRecentPlays', () => EspnAdapters.RecentPlays(summaryData, toAdapterSport(league.espn_sport))) : null;
    const lastPlay = summaryData ? safeExtract('RecoveryLastPlay', () => EspnAdapters.LastPlay(summaryData)) : null;

    const nowIso = new Date().toISOString();
    await upsertWithRetry('live_game_state', {
      id: dbMatchId,
      league_id: league.id,
      sport: league.db_sport,
      game_status: statusName,
      period,
      clock,
      home_score: homeScore,
      away_score: awayScore,
      recent_plays: recentPlays ?? null,
      last_play: lastPlay ?? null,
      odds: { current: effectiveOdds ?? null },
      extra_data: {
        capture_mode: 'repair',
        capture_source: 'ingest-live-games-recovery',
        capture_reason: reason,
        repaired_at: nowIso,
      },
      updated_at: nowIso,
    });

    stats.reliability.live_state_writes++;
    const recoveryPlayRows = Array.isArray(recentPlays)
      ? recentPlays
        .filter((p: any) => String(p?.text || '').trim().length > 0)
        .map((p: any, index: number) => ({
          match_id: dbMatchId,
          league_id: league.id,
          sport: league.db_sport,
          event_type: 'play',
          sequence: deriveStablePlaySequence(p, index, 'recovery'),
          period: p?.period ?? period ?? null,
          clock: p?.clock ?? clock ?? null,
          home_score: parseInt((p?.home_score ?? p?.homeScore ?? homeScore)?.toString() || '0', 10) || 0,
          away_score: parseInt((p?.away_score ?? p?.awayScore ?? awayScore)?.toString() || '0', 10) || 0,
          play_data: {
            id: p?.id ?? `recovery:${index}`,
            text: String(p?.text || '').trim(),
            type: p?.type ?? null,
            scoringPlay: !!p?.scoringPlay,
          },
          source: 'recent_live_repair',
        }))
      : [];

    if (recoveryPlayRows.length > 0) {
      try {
        for (let i = 0; i < recoveryPlayRows.length; i += 200) {
          await supabase.from('game_events').upsert(recoveryPlayRows.slice(i, i + 200), { onConflict: 'match_id,event_type,sequence' });
        }
      } catch (playErr: any) {
        Logger.warn('RECOVERY_PBP_UPSERT_FAILED', { match_id: dbMatchId, error: playErr?.message || String(playErr) });
      }
    }
    const pbpWriteCount = recoveryPlayRows.length;
    if (pbpWriteCount > 0) stats.reliability.pbp_writes += pbpWriteCount;

    const snapshotWrite = await writeLiveOddsSnapshotWithGuard({
      supabase,
      matchId: dbMatchId,
      leagueId: league.id,
      sport: league.db_sport,
      status: statusName,
      period: Number.isFinite(period) ? period : null,
      clock,
      homeScore,
      awayScore,
      homeTeam: homeName !== 'Unknown' ? homeName : null,
      awayTeam: awayName !== 'Unknown' ? awayName : null,
      effectiveOdds,
      parsedOdds,
      finalMarketOdds: effectiveOdds,
      isLiveGame,
      source: 'ingest-live-games-recovery',
      degradeReason: reason,
    });

    if (snapshotWrite.inserted) {
      stats.snapshots++;
      stats.reliability.snapshot_writes++;
      if (snapshotWrite.degraded) stats.reliability.degraded_snapshot_writes++;
    }
    if (snapshotWrite.providerFailure) stats.reliability.provider_failures++;

    return {
      recovered: true,
      snapshotInserted: !!snapshotWrite.inserted,
      liveStateWritten: true,
      pbpWritten: pbpWriteCount > 0,
    };
  } catch (e: any) {
    Logger.warn('RECOVERY_ATTEMPT_FAILED', { match_id: dbMatchId, reason, error: e?.message || String(e) });
    return {
      recovered: false,
      snapshotInserted: false,
      liveStateWritten: false,
      pbpWritten: false,
      error: e?.message || String(e),
    };
  }
}

// ─── MAIN EXECUTION ───────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const reqUrl = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const rawTarget = body?.target_match_id ?? reqUrl.searchParams.get('target_match_id');
  const targetArray = Array.isArray(rawTarget) ? rawTarget : (rawTarget ? String(rawTarget).split(',') : []);
  const targetSet = new Set(targetArray.map(s => String(s).trim()).filter(Boolean));

  const dates = body?.dates ?? reqUrl.searchParams.get('dates');
  const scoreboardDates = resolveScoreboardDates(dates);
  const dryRun = parseBool(body?.dry ?? reqUrl.searchParams.get('dry'));
  const debug = parseBool(body?.debug ?? reqUrl.searchParams.get('debug'));
  const forceRecovery = !parseBool(body?.disable_recovery ?? reqUrl.searchParams.get('disable_recovery'));
  const skipCoverageAudit = parseBool(body?.skip_coverage_audit ?? reqUrl.searchParams.get('skip_coverage_audit'));
  const disableSloGuard = parseBool(body?.disable_slo_guard ?? reqUrl.searchParams.get('disable_slo_guard'));
  const allowSloBreach = parseBool(body?.allow_slo_breach ?? reqUrl.searchParams.get('allow_slo_breach'));
  const maxGamesGlobalParam = parsePositiveInt(body?.max_games ?? body?.max_games_total ?? reqUrl.searchParams.get('max_games') ?? reqUrl.searchParams.get('max_games_total'));
  const perLeagueMaxGamesParam = parsePositiveInt(body?.per_league_max_games ?? reqUrl.searchParams.get('per_league_max_games'));
  const concurrencyParam = parsePositiveInt(body?.concurrency ?? reqUrl.searchParams.get('concurrency'));
  const preWindowMinutesParam = parsePositiveInt(body?.pre_window_minutes ?? reqUrl.searchParams.get('pre_window_minutes'));
  const maxRuntimeMsParam = parsePositiveInt(body?.max_runtime_ms ?? reqUrl.searchParams.get('max_runtime_ms'));
  const maxGamesGlobal = maxGamesGlobalParam ? Math.min(maxGamesGlobalParam, 300) : null;
  const perLeagueMaxGames = Math.max(1, Math.min(perLeagueMaxGamesParam ?? LIVE_RUNTIME.perLeagueMaxGames, 200));
  const concurrency = Math.max(1, Math.min(concurrencyParam ?? LIVE_RUNTIME.concurrency, 16));
  const preWindowMinutes = Math.max(5, Math.min(preWindowMinutesParam ?? LIVE_RUNTIME.preWindowMinutes, 120));
  const maxRuntimeMs = Math.max(5000, Math.min(maxRuntimeMsParam ?? LIVE_RUNTIME.maxRuntimeMs, 180000));

  const leagueParamRaw = body?.league ?? reqUrl.searchParams.get('league') ?? '';
  const leagueFilter = new Set(String(leagueParamRaw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const triggerType = (parseBool(body?.is_watchdog ?? reqUrl.searchParams.get('is_watchdog')) ? 'watchdog' :
    parseBool(body?.is_replay ?? reqUrl.searchParams.get('is_replay')) ? 'replay' :
      (req.headers.get('x-cron-secret') ? 'scheduled' : 'manual')) as 'scheduled' | 'watchdog' | 'replay' | 'manual';

  const startedAt = Date.now();
  const hardDeadlineMs = startedAt + maxRuntimeMs;
  const stats: any = {
    attempted: 0, processed: 0, live: 0, failed: 0, errors: [] as string[],
    snapshots: 0, odds_snapshots_written: 0, bpi_snapshots: 0, context_snapshots: 0,
    degraded_transactions: 0, dry_run: dryRun, max_games_requested: maxGamesGlobal,
    runtime_limit_ms: maxRuntimeMs,
    pre_window_minutes: preWindowMinutes,
    per_league_max_games: perLeagueMaxGames,
    concurrency,
    runtime_truncated: false,
    disable_slo_guard: disableSloGuard,
    allow_slo_breach: allowSloBreach,
    league_filter: [...leagueFilter], dry_samples: [] as any[],
    trigger_type: triggerType,
    freshness_thresholds: {
      snapshot_stale_seconds: LIVE_RUNTIME.snapshotStaleSeconds,
      pbp_stale_seconds: LIVE_RUNTIME.pbpStaleSeconds,
    },
    reliability: {
      games_scanned: 0,
      games_started: 0,
      snapshot_writes: 0,
      live_state_writes: 0,
      pbp_writes: 0,
      missing_games: 0,
      stale_games: 0,
      retries_attempted: 0,
      retries_recovered: 0,
      provider_failures: 0,
      degraded_snapshot_writes: 0,
      discovery_seeded_from_matches: 0,
      db_lock_bypass: 0,
      stale_matches_by_threshold: {
        snapshot_stale_seconds: LIVE_RUNTIME.snapshotStaleSeconds,
        pbp_stale_seconds: LIVE_RUNTIME.pbpStaleSeconds,
      },
      coverage_issues: [] as any[],
      recovered_match_ids: [] as string[],
    }
  };

  try { getSupabaseClient(); } catch (e: any) {
    Logger.error('BOOT_INIT_FAILED', { error: e.message || e });
    return new Response(JSON.stringify({ ok: false, error: e.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabase = getSupabaseClient();
  const runId = await safeLogJobRunStart(supabase, {
    triggerType,
    leagueFilter: [...leagueFilter],
    scoreboardDates,
    dryRun,
    targetCount: targetSet.size,
  });
  const capabilityByLeague = await loadCapabilitiesByLeague(supabase);
  stats.capabilities_loaded = capabilityByLeague.size;
  stats.capability_defaults_used = 0;

  const missingMatches = new Set<string>();
  const staleMatches = new Set<string>();
  const recoveredMatches = new Set<string>();
  let globalAttempted = 0;

  leagueLoop:
  for (const league of MONITOR_LEAGUES) {
    if (Date.now() >= hardDeadlineMs) {
      stats.runtime_truncated = true;
      break;
    }
    if (maxGamesGlobal && globalAttempted >= maxGamesGlobal) break;
    if (leagueFilter.size > 0 && !leagueFilter.has(league.id)) continue;
    const leagueCapability = capabilityByLeague.get(league.id) || defaultCapability(league.id, league.db_sport);
    if (!capabilityByLeague.has(league.id)) stats.capability_defaults_used++;
    let leagueAttempted = 0;

    try {
      const mergedEvents = new Map<string, any>();
      for (const scoreboardDate of scoreboardDates) {
        if (Date.now() >= hardDeadlineMs) {
          stats.runtime_truncated = true;
          break leagueLoop;
        }
        const dateQuery = `?limit=300&dates=${scoreboardDate}`;
        const groupsParam = league.groups ? `&groups=${league.groups}` : '';
        const res = await fetchWithRetry(`${SCOREBOARD_BASE}/${league.endpoint}/scoreboard${dateQuery}${groupsParam}`);
        const data = await res.json();
        let events = data.events || [];

        if (league.db_sport === 'tennis') {
          events = events.flatMap((t: any) => (t.groupings || []).flatMap((g: any) => (g.competitions || []).map((c: any) => ({ ...t, id: c.id, date: c.date, status: c.status, competitions: [c] }))));
        }

        for (const event of events) {
          const eventId = String(event?.id || '').trim();
          if (!eventId) continue;
          const existing = mergedEvents.get(eventId);
          if (!existing) {
            mergedEvents.set(eventId, event);
            continue;
          }
          if (eventStateRank(event) < eventStateRank(existing)) {
            mergedEvents.set(eventId, event);
          }
        }
      }

      if (!dryRun) {
        const seeded = await seedMissingStartedEventsFromMatches(supabase, league, mergedEvents, targetSet);
        if (seeded.length > 0) {
          stats.reliability.discovery_seeded_from_matches += seeded.length;
          pushLimited(stats.reliability.coverage_issues, {
            league_id: league.id,
            issue: 'DB_DISCOVERY_SEEDED',
            count: seeded.length,
          }, 20);
        }
      }

      let events = Array.from(mergedEvents.values());

      let processableEvents = [];
      for (const event of events) {
        const state = String(event?.status?.type?.state || '').toLowerCase();
        const startMs = parseEventStartMs(event);
        const minutesToStart = startMs === null ? null : ((startMs - Date.now()) / 60000);
        const startedByClock = minutesToStart !== null && minutesToStart <= -LIVE_RUNTIME.startGraceMinutes;
        const nearKickoffWindow = minutesToStart !== null && minutesToStart <= preWindowMinutes;
        const shouldInclude = ['in', 'post'].includes(state) || startedByClock || (state === 'pre' && nearKickoffWindow);
        if (!shouldInclude) continue;
        const dbMatchId = getCanonicalMatchId(event.id, league.id);
        if (targetSet.size > 0 && !targetSet.has(String(event.id)) && !targetSet.has(dbMatchId)) continue;
        processableEvents.push(event);
      }
      processableEvents.sort((a: any, b: any) => {
        const rankDelta = eventStateRank(a) - eventStateRank(b);
        if (rankDelta !== 0) return rankDelta;
        const ta = new Date(a?.date || 0).getTime();
        const tb = new Date(b?.date || 0).getTime();
        return ta - tb;
      });
      if (processableEvents.length > perLeagueMaxGames) {
        pushLimited(stats.reliability.coverage_issues, {
          league_id: league.id,
          issue: 'PER_LEAGUE_CAP_APPLIED',
          requested_games: processableEvents.length,
          capped_to: perLeagueMaxGames,
        }, 20);
        processableEvents = processableEvents.slice(0, perLeagueMaxGames);
      }
      stats.reliability.games_scanned += processableEvents.length;

      for (let i = 0; i < processableEvents.length; i += concurrency) {
        if (Date.now() >= hardDeadlineMs) {
          stats.runtime_truncated = true;
          break leagueLoop;
        }
        if (leagueAttempted >= perLeagueMaxGames) break;
        if (maxGamesGlobal && globalAttempted >= maxGamesGlobal) break leagueLoop;
        const chunk = processableEvents.slice(i, i + concurrency);
        const executing = chunk.map(async (event) => {
          if (Date.now() >= hardDeadlineMs) return;
          if (maxGamesGlobal && globalAttempted >= maxGamesGlobal) return;
          if (leagueAttempted >= perLeagueMaxGames) return;
          const dbMatchId = getCanonicalMatchId(event.id, league.id);
          if (_localLocks.has(dbMatchId)) return;
          _localLocks.add(dbMatchId);

          const startedGame = isLikelyStartedEvent(event);
          const inProgressGame = isLikelyInProgressEvent(event);
          let hasDbLock = false;
          let dbLockUnavailable = false;
          try {
            try {
              const { data, error } = await supabase.rpc('acquire_ingest_lock', { p_match_id: dbMatchId, p_ttl_seconds: 45 });
              if (!error && data === true) { hasDbLock = true; }
              else if (error) {
                const errStr = JSON.stringify(error).toLowerCase();
                if (errStr.includes('42883') || errStr.includes('42p01') || errStr.includes('could not find function')) { dbLockUnavailable = true; }
              }
            } catch { dbLockUnavailable = true; }

            let bypassDbLock = false;
            if (!hasDbLock && !dbLockUnavailable && !dryRun) {
              const manualOrTargeted = triggerType !== 'scheduled' || targetSet.size > 0;
              if (startedGame && manualOrTargeted) {
                bypassDbLock = true;
              } else if (startedGame) {
                const probe = await probeCoverageForMatch(supabase, dbMatchId, { started: true, inProgress: inProgressGame });
                const adjustedProbe = adjustProbeWithCapability(probe, leagueCapability, { started: true, inProgress: inProgressGame });
                if (adjustedProbe.effectiveCoverageStatus !== 'OK') bypassDbLock = true;
              }

              if (!bypassDbLock) return;
              stats.reliability.db_lock_bypass++;
              Logger.warn('DB_LOCK_BYPASS', {
                match_id: dbMatchId,
                league_id: league.id,
                trigger_type: triggerType,
                started: startedGame,
              });
            }

            globalAttempted++;
            leagueAttempted++;
            stats.attempted++;
            if (startedGame) stats.reliability.games_started++;

            await processGame(supabase, event, dbMatchId, league, stats, { dryRun, debug });

            if (!dryRun && !skipCoverageAudit && startedGame) {
              const probe = await probeCoverageForMatch(supabase, dbMatchId, { started: true, inProgress: inProgressGame });
              const adjustedProbe = adjustProbeWithCapability(probe, leagueCapability, { started: true, inProgress: inProgressGame });
              if (adjustedProbe.effectiveCoverageStatus !== 'OK') {
                if (adjustedProbe.effectiveCoverageStatus.startsWith('MISSING')) missingMatches.add(dbMatchId);
                if (adjustedProbe.effectiveCoverageStatus.startsWith('STALE')) staleMatches.add(dbMatchId);
                pushLimited(stats.reliability.coverage_issues, {
                  match_id: dbMatchId,
                  league_id: league.id,
                  raw_status: probe.coverageStatus,
                  status: adjustedProbe.effectiveCoverageStatus,
                  stale_seconds_snapshot: adjustedProbe.staleSecondsSnapshot,
                  stale_seconds_pbp: adjustedProbe.staleSecondsPbp,
                  latest_snapshot_at: adjustedProbe.latestSnapshotAt,
                  latest_pbp_at: adjustedProbe.latestPbpAt,
                  live_odds_required: adjustedProbe.liveOddsRequired,
                  live_state_required: adjustedProbe.liveStateRequired,
                  pbp_required: adjustedProbe.pbpRequired,
                  auto_recovery_enabled: adjustedProbe.autoRecoveryEnabled,
                });

                if (forceRecovery && adjustedProbe.autoRecoveryEnabled) {
                  stats.reliability.retries_attempted++;
                  const recovery = await recoverCoverageForMatch({
                    supabase,
                    event,
                    dbMatchId,
                    league,
                    reason: adjustedProbe.effectiveCoverageStatus,
                    stats,
                  });

                  if (recovery.recovered) {
                    recoveredMatches.add(dbMatchId);
                  } else {
                    pushLimited(stats.errors, `${league.id}/${dbMatchId}: recovery_failed:${adjustedProbe.effectiveCoverageStatus}`);
                  }
                } else if (!adjustedProbe.autoRecoveryEnabled) {
                  pushLimited(stats.reliability.coverage_issues, {
                    match_id: dbMatchId,
                    league_id: league.id,
                    status: adjustedProbe.effectiveCoverageStatus,
                    issue: 'AUTO_RECOVERY_DISABLED_BY_CAPABILITY',
                  });
                }
              }
            }
          } finally {
            _localLocks.delete(dbMatchId);
            if (hasDbLock) { try { await supabase.rpc('release_ingest_lock', { p_match_id: dbMatchId }); } catch { } }
          }
        });
        await Promise.all(executing);
      }
    } catch (e: any) { stats.errors.push(`${league.id}: ${e.message}`); Logger.warn('LEAGUE_LOOP_FAILED', { league: league.id, error: e.message }); }
  }

  stats.reliability.missing_games = missingMatches.size;
  stats.reliability.stale_games = staleMatches.size;
  stats.reliability.retries_recovered = recoveredMatches.size;
  stats.reliability.recovered_match_ids = Array.from(recoveredMatches).slice(0, 50);

  stats.elapsed_ms = Date.now() - startedAt;
  if (!debug && stats.dry_samples.length > 5) stats.dry_samples = stats.dry_samples.slice(0, 5);
  if (!debug && stats.reliability.coverage_issues.length > 50) {
    stats.reliability.coverage_issues = stats.reliability.coverage_issues.slice(0, 50);
  }

  if (!dryRun) {
    try { await supabase.rpc('refresh_mv_live_pipeline_coverage_summary'); } catch { }
  }

  let sloGuard: any = null;
  let sloBreached = false;
  let sloGuardFailed = false;
  if (!dryRun && !disableSloGuard) {
    try {
      sloGuard = await evaluateCurrentSlo({
        supabase,
        leagueIds: leagueFilter.size > 0 ? [...leagueFilter] : MONITOR_LEAGUES.map((l) => l.id),
        capabilityByLeague,
      });
      sloBreached = !!sloGuard?.breached;

      await safeInsertLiveReliabilityLog(supabase, {
        run_id: runId,
        function_name: 'live-slo-guard',
        status: sloBreached ? 'failed' : 'succeeded',
        trigger_type: triggerType,
        scanned_games: Number(sloGuard?.rows?.reduce((acc: number, row: any) => acc + Number(row.started_games || 0), 0) || 0),
        started_games: Number(sloGuard?.rows?.reduce((acc: number, row: any) => acc + Number(row.started_games || 0), 0) || 0),
        snapshot_writes: 0,
        live_state_writes: 0,
        pbp_writes: 0,
        missing_games: Number(sloGuard?.rows?.reduce((acc: number, row: any) => acc + Number(row.missing_required_games || 0), 0) || 0),
        stale_games: Number(sloGuard?.rows?.reduce((acc: number, row: any) => acc + Number(row.stale_required_games || 0), 0) || 0),
        retries_attempted: 0,
        retries_recovered: 0,
        provider_failures: 0,
        degraded_snapshot_writes: 0,
        metadata: {
          window_minutes: sloGuard?.window_minutes ?? LIVE_RUNTIME.sloWindowMinutes,
          thresholds: {
            min_snapshot_coverage_pct: sloGuard?.min_snapshot_coverage_pct ?? LIVE_RUNTIME.sloMinSnapshotCoveragePct,
            min_state_coverage_pct: sloGuard?.min_state_coverage_pct ?? LIVE_RUNTIME.sloMinStateCoveragePct,
            min_pbp_coverage_pct: sloGuard?.min_pbp_coverage_pct ?? LIVE_RUNTIME.sloMinPbpCoveragePct,
            max_missing_games: sloGuard?.max_missing_games ?? LIVE_RUNTIME.sloMaxMissingGames,
            max_stale_games: sloGuard?.max_stale_games ?? LIVE_RUNTIME.sloMaxStaleGames,
          },
          breached: sloBreached,
          breach_count: Array.isArray(sloGuard?.breaches) ? sloGuard.breaches.length : 0,
          breaches: Array.isArray(sloGuard?.breaches) ? sloGuard.breaches : [],
          rows: Array.isArray(sloGuard?.rows) ? sloGuard.rows : [],
        },
      });
    } catch (sloErr: any) {
      sloGuardFailed = true;
      const errMsg = sloErr?.message || String(sloErr);
      pushLimited(stats.errors, `slo_guard:${errMsg}`);
      await safeInsertLiveReliabilityLog(supabase, {
        run_id: runId,
        function_name: 'live-slo-guard',
        status: 'failed',
        trigger_type: triggerType,
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
        metadata: { error: errMsg },
      });
    }
  }

  stats.slo_guard = disableSloGuard
    ? { enabled: false, reason: 'disabled_by_request' }
    : dryRun
      ? { enabled: false, reason: 'dry_run' }
      : {
        enabled: true,
        breached: sloBreached,
        guard_failed: sloGuardFailed,
        window_minutes: sloGuard?.window_minutes ?? LIVE_RUNTIME.sloWindowMinutes,
        rows: sloGuard?.rows ?? [],
        breaches: sloGuard?.breaches ?? [],
      };

  let runStatus: 'succeeded' | 'failed' | 'replayed' = 'succeeded';
  if (stats.failed > 0 && stats.processed === 0) runStatus = 'failed';
  else if (sloGuardFailed) runStatus = 'failed';
  else if (sloBreached && !allowSloBreach) runStatus = 'failed';
  else if (stats.runtime_truncated) runStatus = 'replayed';
  else if (stats.reliability.retries_attempted > 0 || sloBreached) runStatus = 'replayed';

  const rowsRead = stats.reliability.games_scanned;
  const rowsWritten = stats.reliability.snapshot_writes + stats.reliability.live_state_writes + stats.reliability.pbp_writes;
  const runMetadata = {
    ...stats.freshness_thresholds,
    attempted: stats.attempted,
    processed: stats.processed,
    live: stats.live,
    failed: stats.failed,
    reliability: stats.reliability,
    dry_run: stats.dry_run,
    league_filter: stats.league_filter,
    runtime_limit_ms: stats.runtime_limit_ms,
    runtime_truncated: stats.runtime_truncated,
    per_league_max_games: stats.per_league_max_games,
    concurrency: stats.concurrency,
    pre_window_minutes: stats.pre_window_minutes,
    disable_slo_guard: stats.disable_slo_guard,
    allow_slo_breach: stats.allow_slo_breach,
    capabilities_loaded: stats.capabilities_loaded,
    capability_defaults_used: stats.capability_defaults_used,
    slo_guard: stats.slo_guard,
    elapsed_ms: stats.elapsed_ms,
  };

  await safeLogJobRunEnd(supabase, runId, {
    status: runStatus,
    rowsRead,
    rowsWritten,
    errorMessage: runStatus === 'failed' ? (stats.errors[0] || 'ingest-live-games failed') : null,
    metadata: runMetadata,
  });

  await safeInsertLiveReliabilityLog(supabase, {
    run_id: runId,
    function_name: 'ingest-live-games',
    status: runStatus,
    trigger_type: triggerType,
    scanned_games: stats.reliability.games_scanned,
    started_games: stats.reliability.games_started,
    snapshot_writes: stats.reliability.snapshot_writes,
    live_state_writes: stats.reliability.live_state_writes,
    pbp_writes: stats.reliability.pbp_writes,
    missing_games: stats.reliability.missing_games,
    stale_games: stats.reliability.stale_games,
    retries_attempted: stats.reliability.retries_attempted,
    retries_recovered: stats.reliability.retries_recovered,
    provider_failures: stats.reliability.provider_failures,
    degraded_snapshot_writes: stats.reliability.degraded_snapshot_writes,
    metadata: runMetadata,
  });

  return new Response(JSON.stringify({ ...stats, run_id: runId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

async function processGame(supabase: any, event: any, dbMatchId: string, league: any, stats: any, options: { dryRun?: boolean; debug?: boolean } = {}) {
  const isDryRun = options.dryRun === true;
  const matchId = event.id;

  try {
    const { res } = await fetchSummaryWithFallback(league.endpoint, matchId);
    const data = await res.json();
    const comp = data.header?.competitions?.[0];
    if (!comp) return;

    const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
    const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
    const homeNameStr = getCompetitorName(home);
    const awayNameStr = getCompetitorName(away);
    const statusState = String(comp.status?.type?.state || '').toLowerCase();
    const statusName = String(comp.status?.type?.name || '').toLowerCase();
    const isLiveGame = ['in', 'in progress', 'halftime', 'status_in_progress'].some(k => statusState.includes(k) || statusName.includes(k));
    const adapterSport = toAdapterSport(league.espn_sport);
    const isSoccer = league.db_sport === 'soccer';

    let parsedOdds: ParsedProviderOdds = { odds_open: null, odds_close: null, odds_live: null, bet365_live: null, dk_live_200: null, player_props: null };
    try { parsedOdds = parseMultiProviderOdds(data, comp, isSoccer); } catch (e: any) { Logger.warn('PARSE_MULTI_PROVIDER_ODDS_FAILED', { match_id: matchId, league_id: league.id, error: e?.message || String(e) }); }

    let homeScore = Safe.score(home?.score) ?? 0;
    let awayScore = Safe.score(away?.score) ?? 0;
    let manualSituationData: any = {};
    if (league.db_sport === 'tennis') {
      const hGames = (home?.linescores || []).reduce((a: number, b: any) => a + (parseInt(b.value) || 0), 0);
      const aGames = (away?.linescores || []).reduce((a: number, b: any) => a + (parseInt(b.value) || 0), 0);
      manualSituationData = { home_games_won: hGames, away_games_won: aGames };
    }

    const espnSituation = safeExtract('Situation', () => EspnAdapters.Situation(data)) || {};
    const mergedSituation = { ...espnSituation, ...manualSituationData };
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
      const drySignalsProbe = buildMarketPassthroughSignals({
        leagueId: league.id,
        dbSport: league.db_sport,
        statusName: comp.status?.type?.name,
        period: comp.status?.period,
        displayClock: comp.status?.displayClock,
        homeScore,
        awayScore,
        effectiveOdds: null,
        bpiPayloadData: null,
      });
      stats.processed++; if (isLiveGame) stats.live++;
      if (stats.dry_samples.length < 10) {
        stats.dry_samples.push({
          match_id: dbMatchId,
          status: comp.status?.type?.name,
          signal_guard: { ok: true, error: null, source: drySignalsProbe?.debug_trace?.[0] ?? null }
        });
      }
      return;
    }

    const canonicalLeagueId = getCanonicalLeagueId(league.id);
    const canonicalId = (await resolveCanonicalMatch(supabase, homeNameStr, awayNameStr, event.date, league.id))
      ?? generateDeterministicId(homeNameStr, awayNameStr, event.date, league.id);
    let canonicalIdForState: string | null = canonicalId;
    try {
      await upsertWithRetry('canonical_games', {
        id: canonicalId,
        league_id: canonicalLeagueId,
        sport: league.db_sport,
        home_team_name: homeNameStr,
        away_team_name: awayNameStr,
        commence_time: event.date,
        status: comp.status?.type?.name
      });
    } catch (e: any) {
      canonicalIdForState = null;
      Logger.warn('CANONICAL_GAME_UPSERT_FAILED', { match_id: dbMatchId, league_id: league.id, canonical_league_id: canonicalLeagueId, canonical_id: canonicalId, error: e?.message || String(e) });
    }

    const { data: existingMatch } = await supabase.from('matches').select('status, home_score, away_score, period, current_odds, opening_odds, closing_odds, is_closing_locked').eq('id', dbMatchId).maybeSingle();
    let premiumFeed = null;
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('resolve_market_feed', { p_match_id: matchId, p_canonical_id: canonicalIdForState ?? canonicalId });
      if (!rpcError && rpcData) premiumFeed = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    } catch { }

    let finalMarketOdds: any = { provider: 'ESPN' };
    let espnOdds = EspnAdapters.Odds(comp, data.pickcenter) || {};
    if (espnOdds.homeSpread == null && espnOdds.homeWin == null && espnOdds.total == null) {
      const sbOdds = event.competitions?.[0]?.odds?.[0] || comp.odds?.[0];
      if (sbOdds) {
        espnOdds = { total: parsePoints(sbOdds.overUnder), homeWin: parsePrice(sbOdds.homeTeamOdds?.moneyLine ?? sbOdds.moneyline?.home), awayWin: parsePrice(sbOdds.awayTeamOdds?.moneyLine ?? sbOdds.moneyline?.away), homeSpread: parsePoints(sbOdds.homeTeamOdds?.spread ?? sbOdds.spread?.home), awaySpread: parsePoints(sbOdds.awayTeamOdds?.spread ?? sbOdds.spread?.away), provider: sbOdds.provider?.name || 'ESPN' };
        if (typeof sbOdds.details === 'string' && espnOdds.homeSpread == null) {
          const detailStr = sbOdds.details.toUpperCase();
          if (detailStr === 'EVEN' || detailStr === 'PK' || detailStr.includes('PICK')) { espnOdds.homeSpread = 0; espnOdds.awaySpread = 0; }
          else { const match = sbOdds.details.match(/([A-Z0-9]+)\s+([+-]?\d+\.?\d*)/i); if (match) { const val = parseFloat(match[2]); const teamAbbr = match[1].toUpperCase(); const homeAbbr = (home?.team?.abbreviation || '').toUpperCase(); const awayAbbr = (away?.team?.abbreviation || '').toUpperCase(); if (homeAbbr === teamAbbr && homeAbbr !== '') { espnOdds.homeSpread = val; espnOdds.awaySpread = -val; } else if (awayAbbr === teamAbbr && awayAbbr !== '') { espnOdds.awaySpread = val; espnOdds.homeSpread = -val; } } }
        }
      }
    }

    // ═══ CORE API PARALLEL ENRICHMENT ═══
    let coreEnrichment: Record<string, any> = {};
    let bpiPayloadData: any = null; let bpiLatestItem: any = null; let bpiProbData: any = null;
    let homeStatsRaw: any = null; let awayStatsRaw: any = null; let parsedCoreOdds: any = null;
    let corePlaysData: any = null;
    let coreBase: string | null = null;

    if (!isSoccer) {
      const endpointParts = String(league.endpoint || '').split('/');
      const espnLeagueId = endpointParts.length > 1 ? endpointParts[1] : null;
      if (espnLeagueId && home?.id && away?.id) {
        coreBase = `https://sports.core.api.espn.com/v2/sports/${league.espn_sport}/leagues/${espnLeagueId}/events/${matchId}/competitions/${matchId}`;
        const [coreOddsData, probData, predictorData, homeStatsData, awayStatsData, homeLeadersData, awayLeadersData, homeRosterData, awayRosterData, situationData, officialsData, broadcastsData, homeLinescoresData, awayLinescoresData, playsData] = await Promise.all([
          fetchCoreJson(`${coreBase}/odds`), fetchCoreJson(`${coreBase}/probabilities?limit=5`), fetchCoreJson(`${coreBase}/predictor`),
          fetchCoreJson(`${coreBase}/competitors/${home.id}/statistics`), fetchCoreJson(`${coreBase}/competitors/${away.id}/statistics`),
          fetchCoreJson(`${coreBase}/competitors/${home.id}/leaders`), fetchCoreJson(`${coreBase}/competitors/${away.id}/leaders`),
          fetchCoreJson(`${coreBase}/competitors/${home.id}/roster`), fetchCoreJson(`${coreBase}/competitors/${away.id}/roster`),
          fetchCoreJson(`${coreBase}/situation`),
          fetchCoreJson(`${coreBase}/officials`), fetchCoreJson(`${coreBase}/broadcasts`),
          fetchCoreJson(`${coreBase}/competitors/${home.id}/linescores`), fetchCoreJson(`${coreBase}/competitors/${away.id}/linescores`),
          fetchCoreJson(`${coreBase}/plays?limit=200`)
        ]);
        corePlaysData = playsData;

        if (coreOddsData && Array.isArray(coreOddsData.items)) {
          const items = coreOddsData.items;
          const extractCoreOdds = (source: any, type: 'current' | 'open' | 'close') => {
            if (!source) return null;
            const d = source[type] || {};
            const hto = source.homeTeamOdds?.[type] || source.homeTeamOdds || {};
            const ato = source.awayTeamOdds?.[type] || source.awayTeamOdds || {};
            const homeSpread = parsePoints(hto.pointSpread?.american ?? hto.pointSpread?.alternateDisplayValue ?? hto.pointSpread?.value ?? source.spread ?? d.homeTeamOdds?.spread ?? d.spread);
            const awaySpreadDirect = parsePoints(ato.pointSpread?.american ?? ato.pointSpread?.alternateDisplayValue ?? ato.pointSpread?.value ?? d.awayTeamOdds?.spread ?? d.spread);
            const awaySpread = awaySpreadDirect ?? (typeof homeSpread === 'number' ? -homeSpread : null);
            return {
              homeWin: parsePrice(hto.moneyLine?.american ?? hto.moneyLine?.value ?? hto.moneyLine ?? source.homeTeamOdds?.moneyLine ?? d.homeTeamOdds?.moneyLine ?? d.moneyLine),
              awayWin: parsePrice(ato.moneyLine?.american ?? ato.moneyLine?.value ?? ato.moneyLine ?? source.awayTeamOdds?.moneyLine ?? d.awayTeamOdds?.moneyLine),
              homeSpread,
              awaySpread,
              total: parsePoints(source.overUnder ?? d.overUnder ?? source.total?.alternateDisplayValue ?? source.total?.american ?? source.total?.value ?? d.total?.alternateDisplayValue ?? d.total?.american ?? d.total?.value ?? (typeof d.total === 'number' ? d.total : null)),
              overOdds: parsePrice(source.overOdds ?? d.overOdds ?? source.over?.american ?? d.overUnderOdds ?? d.over?.american ?? d.over?.alternateDisplayValue),
              underOdds: parsePrice(source.underOdds ?? d.underOdds ?? source.under?.american ?? d.under?.american ?? d.under?.alternateDisplayValue),
              homeSpreadOdds: parsePrice(hto.spread?.american ?? hto.spread?.alternateDisplayValue ?? hto.spreadOdds ?? source.homeTeamOdds?.spreadOdds ?? d.homeTeamOdds?.spreadOdds ?? d.spreadOdds),
              awaySpreadOdds: parsePrice(ato.spread?.american ?? ato.spread?.alternateDisplayValue ?? ato.spreadOdds ?? source.awayTeamOdds?.spreadOdds ?? d.awayTeamOdds?.spreadOdds ?? d.spreadOdds),
              provider: source.provider?.name || 'ESPN'
            };
          };
          const liveItem = [...items].filter(p => p?.current).sort((a, b) => getLiveProviderScore(a) - getLiveProviderScore(b))[0];
          parsedCoreOdds = liveItem ? extractCoreOdds(liveItem, 'current') : null;
        }

        if (predictorData) {
          const toNum = (v: any): number | null => {
            if (v === null || v === undefined) return null;
            if (typeof v === 'number') return Number.isFinite(v) ? v : null;
            if (typeof v === 'string') {
              const n = parseFloat(v.replace('%', '').trim());
              return Number.isFinite(n) ? n : null;
            }
            return null;
          };
          const normalizeStatName = (v: any) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const getStatValue = (team: any, aliases: string[]) => {
            const statsArray = Array.isArray(team?.statistics) ? team.statistics : (Array.isArray(team?.team?.statistics) ? team.team.statistics : []);
            const wanted = aliases.map(normalizeStatName);
            for (const stat of statsArray) {
              const key = normalizeStatName(stat?.name ?? stat?.displayName ?? stat?.shortDisplayName);
              if (!key) continue;
              if (wanted.includes(key)) {
                const parsed = toNum(stat?.value ?? stat?.displayValue);
                if (parsed !== null) return parsed;
              }
            }
            return null;
          };
          const homePredMovRaw = getStatValue(predictorData.homeTeam, ['teampredmov', 'teamPredPtDiff', 'predPtDiff']);
          const awayPredMovRaw = getStatValue(predictorData.awayTeam, ['teampredmov', 'teamPredPtDiff', 'predPtDiff']);
          const homeWinPctRaw = getStatValue(predictorData.homeTeam, ['teampredwinpct', 'gameProjection']);
          const awayWinPctRaw = getStatValue(predictorData.awayTeam, ['teampredwinpct', 'gameProjection']);
          const homeChanceLoss = getStatValue(predictorData.homeTeam, ['teamChanceLoss']);
          const awayChanceLoss = getStatValue(predictorData.awayTeam, ['teamChanceLoss']);
          const matchupQuality = getStatValue(predictorData.homeTeam, ['matchupquality']) ?? getStatValue(predictorData.awayTeam, ['matchupquality']);

          const resolvedHomeWinPct = homeWinPctRaw ?? awayChanceLoss ?? (awayWinPctRaw !== null ? (100 - awayWinPctRaw) : null);
          const resolvedAwayWinPct = awayWinPctRaw ?? homeChanceLoss ?? (resolvedHomeWinPct !== null ? (100 - resolvedHomeWinPct) : null);
          const resolvedHomePredMov = homePredMovRaw ?? (awayPredMovRaw !== null ? -awayPredMovRaw : null);

          bpiPayloadData = {
            homePredMov: resolvedHomePredMov,
            homePredWinPct: resolvedHomeWinPct,
            awayPredWinPct: resolvedAwayWinPct,
            matchupQuality,
            lastUpdated: predictorData.lastModified ?? null
          };
        }

        if (probData) {
          bpiProbData = probData; let latestItems = bpiProbData.items ?? [];
          if ((bpiProbData.pageCount ?? 0) > 1) { const lastPage = await fetchCoreJson(`${coreBase}/probabilities?limit=5&page=${bpiProbData.pageCount}`); if (lastPage) { latestItems = lastPage.items ?? latestItems; bpiProbData = lastPage; } }
          bpiLatestItem = latestItems.length > 0 ? latestItems[latestItems.length - 1] : null;
        }

        const extractStats = (json: any) => { const r: any = {}; (json?.splits?.categories ?? []).forEach((c: any) => (c?.stats ?? []).forEach((s: any) => { if (s?.name && s?.value != null) r[s.name] = s.value; })); return Object.keys(r).length > 0 ? r : null; };
        homeStatsRaw = extractStats(homeStatsData); awayStatsRaw = extractStats(awayStatsData);
        if (homeStatsRaw || awayStatsRaw) { coreEnrichment.advanced_metrics = { core_api_efficiency: { home: homeStatsRaw ? { ppep: homeStatsRaw.pointsPerEstimatedPossessions, pace: homeStatsRaw.estimatedPossessions, shootingEff: homeStatsRaw.shootingEfficiency, offRebPct: homeStatsRaw.offensiveReboundPct, astToRatio: homeStatsRaw.assistTurnoverRatio } : null, away: awayStatsRaw ? { ppep: awayStatsRaw.pointsPerEstimatedPossessions, pace: awayStatsRaw.estimatedPossessions, shootingEff: awayStatsRaw.shootingEfficiency, offRebPct: awayStatsRaw.offensiveReboundPct, astToRatio: awayStatsRaw.assistTurnoverRatio } : null } }; }

        const extractLeaders = (json: any) => {
          const result: Record<string, any> = {};
          const categories = Array.isArray(json?.leaders) ? json.leaders : (Array.isArray(json?.categories) ? json.categories : []);
          for (const cat of categories) {
            const topPlayer = cat?.leaders?.[0];
            if (!topPlayer) continue;
            result[cat?.name ?? cat?.displayName ?? cat?.shortDisplayName ?? 'unknown'] = {
              displayValue: topPlayer.displayValue ?? null,
              value: topPlayer.value ?? null,
              athleteRef: topPlayer.athlete?.$ref ?? null,
              teamRef: topPlayer.team?.$ref ?? null,
            };
          }
          return Object.keys(result).length > 0 ? result : null;
        };
        const homeLeadersRaw = homeLeadersData ? extractLeaders(homeLeadersData) : null;
        const awayLeadersRaw = awayLeadersData ? extractLeaders(awayLeadersData) : null;
        const extractRoster = (json: any) => (json?.entries ?? json?.items ?? []).filter((e: any) => e?.playerId || e?.athlete).map((e: any) => ({ id: e.playerId ?? null, athleteRef: e.athlete?.$ref ?? null, statsRef: e.statistics?.$ref ?? null })).slice(0, 20);
        const homeRosterRaw = homeRosterData ? extractRoster(homeRosterData) : null;
        const awayRosterRaw = awayRosterData ? extractRoster(awayRosterData) : null;
        const officialsRaw = Array.isArray(officialsData?.items)
          ? officialsData.items
            .map((o: any) => ({
              id: o?.id ?? null,
              name: o?.fullName ?? o?.displayName ?? null,
              position: o?.position?.name ?? o?.position?.displayName ?? null,
              order: o?.order ?? null,
            }))
            .filter((o: any) => o.id || o.name)
          : null;
        const broadcastsRaw = Array.isArray(broadcastsData?.items)
          ? broadcastsData.items
            .map((b: any) => ({
              station: b?.station ?? b?.media?.shortName ?? b?.media?.name ?? null,
              type: b?.type?.shortName ?? b?.type?.longName ?? null,
              market: b?.market?.type ?? b?.market?.displayName ?? null,
              channel: b?.channel ?? null,
              lang: b?.lang ?? null,
              region: b?.region ?? null,
            }))
            .filter((b: any) => b.station || b.type || b.market)
          : null;
        const parseLinescores = (json: any) => Array.isArray(json?.items)
          ? json.items
            .map((item: any) => ({
              period: item?.period ?? null,
              value: item?.value ?? null,
              displayValue: item?.displayValue ?? null,
              source: item?.source?.description ?? null
            }))
            .filter((ls: any) => ls.value !== null || ls.displayValue !== null)
          : null;
        const homeLinescoresRaw = parseLinescores(homeLinescoresData);
        const awayLinescoresRaw = parseLinescores(awayLinescoresData);
        const extractPredictorStats = (team: any) => {
          const statsArray = Array.isArray(team?.statistics) ? team.statistics : (Array.isArray(team?.team?.statistics) ? team.team.statistics : []);
          const result: Record<string, any> = {};
          for (const stat of statsArray) {
            const key = stat?.name ?? stat?.displayName ?? stat?.shortDisplayName;
            if (!key) continue;
            result[String(key)] = (stat?.value ?? stat?.displayValue ?? null);
          }
          return Object.keys(result).length > 0 ? result : null;
        };
        const powerindexRaw = predictorData
          ? {
            home: extractPredictorStats(predictorData.homeTeam),
            away: extractPredictorStats(predictorData.awayTeam),
            name: predictorData?.name ?? null,
            lastModified: predictorData?.lastModified ?? null
          }
          : null;
        if (homeRosterRaw || awayRosterRaw || homeLeadersRaw || awayLeadersRaw || officialsRaw || broadcastsRaw || homeLinescoresRaw || awayLinescoresRaw || powerindexRaw) {
          coreEnrichment.extra_data = {
            ...(coreEnrichment.extra_data || {}),
            ...(homeRosterRaw || awayRosterRaw ? { roster: { home: homeRosterRaw, away: awayRosterRaw } } : {}),
            ...(homeLeadersRaw || awayLeadersRaw ? { core_api_leaders: { home: homeLeadersRaw, away: awayLeadersRaw } } : {}),
            ...(officialsRaw && officialsRaw.length > 0 ? { officials: officialsRaw } : {}),
            ...(broadcastsRaw && broadcastsRaw.length > 0 ? { broadcasts: broadcastsRaw } : {}),
            ...((homeLinescoresRaw && homeLinescoresRaw.length > 0) || (awayLinescoresRaw && awayLinescoresRaw.length > 0) ? { linescores: { home: homeLinescoresRaw || [], away: awayLinescoresRaw || [] } } : {}),
            ...((powerindexRaw?.home || powerindexRaw?.away) ? { powerindex: powerindexRaw } : {}),
          };
        }
        if (situationData) {
          coreEnrichment.situation = {
            homeTimeouts: situationData.homeTimeouts?.timeoutsRemainingCurrent ?? null,
            awayTimeouts: situationData.awayTimeouts?.timeoutsRemainingCurrent ?? null,
            homeFouls: situationData.homeFouls?.teamFoulsCurrent ?? null,
            awayFouls: situationData.awayFouls?.teamFoulsCurrent ?? null,
            homeFoulsToGive: situationData.homeFouls?.foulsToGive ?? null,
            awayFoulsToGive: situationData.awayFouls?.foulsToGive ?? null,
            homeBonusState: situationData.homeFouls?.bonusState ?? null,
            awayBonusState: situationData.awayFouls?.bonusState ?? null,
            isPowerPlay: typeof situationData.powerPlay === 'boolean' ? situationData.powerPlay : null,
            emptyNet: typeof situationData.emptyNet === 'boolean' ? situationData.emptyNet : null,
            situationLastPlayRef: situationData.lastPlay?.$ref ?? null
          };
        }
      }
    }

    if (parsedCoreOdds) finalMarketOdds = { ...finalMarketOdds, ...parsedCoreOdds };
    if (premiumFeed && !premiumFeed.is_stale) {
      const totalBook = String(premiumFeed.total?.bookmaker || premiumFeed.total?.over?.bookmaker || '').trim() || null;
      const mlBook = String(premiumFeed.h2h?.bookmaker || premiumFeed.h2h?.home?.bookmaker || premiumFeed.h2h?.away?.bookmaker || '').trim() || null;
      const spreadBook = String(premiumFeed.spread?.bookmaker || premiumFeed.spread?.home?.bookmaker || premiumFeed.spread?.away?.bookmaker || '').trim() || null;
      const primaryBook = totalBook || mlBook || spreadBook || 'unknown';
      const sharpBooks = ['pinnacle', 'lowvig', 'betonlineag', 'gtbets'];
      const isSharp = sharpBooks.includes(String(primaryBook).toLowerCase());

      finalMarketOdds = {
        homeSpread: parsePoints(premiumFeed.spread?.home?.point),
        awaySpread: parsePoints(premiumFeed.spread?.away?.point),
        total: parsePoints(premiumFeed.total?.over?.point),
        homeWin: parsePrice(premiumFeed.h2h?.home?.price),
        awayWin: parsePrice(premiumFeed.h2h?.away?.price),
        isInstitutional: true,
        provider: 'Institutional',
        market_source_type: 'odds_api_best',
        market_source_book: primaryBook,
        market_source_confidence: isSharp ? 'sharp' : 'mainstream',
        market_source_total_book: totalBook,
        market_source_ml_book: mlBook,
        market_source_spread_book: spreadBook
      };
    } else {
      const hasEspnOdds = espnOdds.homeSpread != null || espnOdds.homeWin != null || espnOdds.total != null;
      const isExistingExternalDb = isExternalProvider(existingMatch?.current_odds?.provider);
      if (hasEspnOdds && (!isExistingExternalDb || isExternalProvider(espnOdds.provider))) {
        finalMarketOdds = {
          ...espnOdds,
          provider: espnOdds.provider || 'ESPN',
          market_source_type: 'espn_scoreboard',
          market_source_book: espnOdds.provider || 'ESPN',
          market_source_confidence: 'fallback'
        };
      }
    }

    const isExistingExternalDb = isExternalProvider(existingMatch?.current_odds?.provider);
    let canonicalOddsPayload = null;
    const finalOddsHasKeys = Object.keys(finalMarketOdds).length > 0 && (finalMarketOdds.homeWin != null || finalMarketOdds.homeSpread != null || finalMarketOdds.total != null);
    if (finalOddsHasKeys && (!isExistingExternalDb || isExternalProvider(finalMarketOdds.provider))) {
      canonicalOddsPayload = toCanonicalOdds(finalMarketOdds, { provider: finalMarketOdds.provider || 'ESPN', isLive: isLiveGame, updatedAt: new Date().toISOString() });
    }
    let effectiveOdds = (isExistingExternalDb && !isExternalProvider(finalMarketOdds.provider) && existingMatch?.current_odds) ? existingMatch.current_odds : (canonicalOddsPayload ?? existingMatch?.current_odds ?? null);
    if (effectiveOdds && typeof effectiveOdds === 'object') {
      effectiveOdds = {
        ...effectiveOdds,
        market_source_type: finalMarketOdds?.market_source_type ?? effectiveOdds?.market_source_type ?? 'unknown',
        market_source_book: finalMarketOdds?.market_source_book ?? effectiveOdds?.market_source_book ?? finalMarketOdds?.provider ?? effectiveOdds?.provider ?? 'unknown',
        market_source_confidence: finalMarketOdds?.market_source_confidence ?? effectiveOdds?.market_source_confidence ?? 'unknown',
      };
    }

    let finalPeriod = parseInt(comp.status?.period, 10) || 0;
    if (existingMatch) {
      if ((existingMatch.home_score || 0) > homeScore) homeScore = existingMatch.home_score;
      if ((existingMatch.away_score || 0) > awayScore) awayScore = existingMatch.away_score;
      const dbPeriod = parseInt(existingMatch.period, 10) || 0;
      if (dbPeriod > finalPeriod && finalPeriod !== 0) finalPeriod = dbPeriod;
      const existingIsPost = String(existingMatch.status).toLowerCase().includes('final') || String(existingMatch.status).toLowerCase().includes('post');
      const incomingIsPreOrIn = ['pre', 'in'].some(s => String(comp.status?.type?.state).toLowerCase().includes(s));
      if (existingIsPost && incomingIsPreOrIn) { if (comp.status && comp.status.type) { comp.status.type.name = existingMatch.status; comp.status.type.state = 'post'; } }
    }

    const hasOpeningOdds = existingMatch?.opening_odds && Object.keys(existingMatch.opening_odds).length > 0;
    const cleanFinalOdds = effectiveOdds;
    const matchPayload: any = { id: dbMatchId, league_id: league.id, sport: league.db_sport, status: comp.status?.type?.name, period: finalPeriod, display_clock: comp.status?.displayClock, home_score: homeScore, away_score: awayScore, last_updated: new Date().toISOString(), opening_odds: hasOpeningOdds ? existingMatch.opening_odds : cleanFinalOdds, current_odds: effectiveOdds };
    if (homeNameStr !== 'Unknown') matchPayload.home_team = homeNameStr;
    if (awayNameStr !== 'Unknown') matchPayload.away_team = awayNameStr;

    let isClosingLocked = existingMatch?.is_closing_locked || !!existingMatch?.closing_odds;
    const hasMarketOdds = cleanFinalOdds && (cleanFinalOdds?.main?.total?.line != null || cleanFinalOdds?.total != null || cleanFinalOdds?.homeWin != null);
    let closingPayload: any = null;
    const safeExtractFlatOdds = (oddsObj: any, field: 'total' | 'homeSpread' | 'awaySpread' | 'homeMl' | 'awayMl') => {
      if (!oddsObj) return null;
      if (oddsObj.main) { if (field === 'total') return parsePoints(oddsObj.main.total?.line); if (field === 'homeSpread') return parsePoints(oddsObj.main.spread?.home?.point); if (field === 'awaySpread') return parsePoints(oddsObj.main.spread?.away?.point); if (field === 'homeMl') return parsePrice(oddsObj.main.h2h?.home?.price); if (field === 'awayMl') return parsePrice(oddsObj.main.h2h?.away?.price); }
      if (field === 'total') return parsePoints(oddsObj.total); if (field === 'homeSpread') return parsePoints(oddsObj.homeSpread); if (field === 'awaySpread') return parsePoints(oddsObj.awaySpread); if (field === 'homeMl') return parsePrice(oddsObj.homeWin ?? oddsObj.home_ml); if (field === 'awayMl') return parsePrice(oddsObj.awayWin ?? oddsObj.away_ml); return null;
    };

    if (!isClosingLocked && isLiveGame && hasMarketOdds) {
      matchPayload.closing_odds = cleanFinalOdds; matchPayload.is_closing_locked = true;
      closingPayload = { match_id: dbMatchId, league_id: league.id, home_spread: safeExtractFlatOdds(cleanFinalOdds, 'homeSpread'), away_spread: safeExtractFlatOdds(cleanFinalOdds, 'awaySpread'), total: safeExtractFlatOdds(cleanFinalOdds, 'total'), home_ml: safeExtractFlatOdds(cleanFinalOdds, 'homeMl'), away_ml: safeExtractFlatOdds(cleanFinalOdds, 'awayMl') };
    } else if (isClosingLocked && existingMatch?.closing_odds) { matchPayload.closing_odds = existingMatch.closing_odds; }

    const minsToStart = (new Date(event.date).getTime() - Date.now()) / 60000;
    const { data: s } = await supabase.from('live_game_state').select('odds').eq('id', dbMatchId).maybeSingle();
    const currentOddsState = s?.odds || {};
    let t60_snapshot = currentOddsState.t60_snapshot; let t0_snapshot = currentOddsState.t0_snapshot;
    if (cleanFinalOdds) {
      if (minsToStart > 50 && minsToStart < 75 && !t60_snapshot) t60_snapshot = { odds: cleanFinalOdds, timestamp: new Date().toISOString() };
      if (minsToStart > -10 && minsToStart < 15 && !t0_snapshot) t0_snapshot = { odds: cleanFinalOdds, timestamp: new Date().toISOString() };
    }

    const aiSignals: any = await buildMarketPassthroughSignals({
      leagueId: league.id,
      dbSport: league.db_sport,
      statusName: comp.status?.type?.name,
      period: finalPeriod,
      displayClock: comp.status?.displayClock,
      homeScore,
      awayScore,
      effectiveOdds,
      bpiPayloadData,
      dbMatchId,
      supabase,
    });

    if (['nba', 'mens-college-basketball', 'nfl'].includes(league.id)) {
      try {
        const { data: latestProb } = await supabase
          .from('espn_probabilities')
          .select('total_over_prob, spread_cover_prob_home, home_win_pct, sequence_number')
          .eq('espn_event_id', event.id)
          .eq('league_id', league.id)
          .order('sequence_number', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestProb) {
          aiSignals.espn_total_over_prob = latestProb.total_over_prob != null ? Number(latestProb.total_over_prob) : null;
          aiSignals.espn_spread_cover_prob = latestProb.spread_cover_prob_home != null ? Number(latestProb.spread_cover_prob_home) : null;
          aiSignals.espn_home_win_pct = latestProb.home_win_pct != null ? Number(latestProb.home_win_pct) : aiSignals.espn_home_win_pct;
          aiSignals.espn_sequence = latestProb.sequence_number ?? null;

          if (aiSignals.espn_total_over_prob != null && aiSignals.market_total != null) {
            const dkImpliedOverProb = 0.50;
            aiSignals.espn_total_edge = aiSignals.espn_total_over_prob - dkImpliedOverProb;
            aiSignals.calibration_zone =
              aiSignals.espn_total_over_prob >= 0.60 ? 'ESPN_OVERESTIMATES'
                : aiSignals.espn_total_over_prob <= 0.35 ? 'ESPN_UNDERESTIMATES'
                  : 'ESPN_CALIBRATED';
          }
        }
      } catch (e: any) {
        Logger.warn('ESPN_PROB_LOOKUP_FAILED', { match_id: dbMatchId, league_id: league.id, error: e?.message || String(e) });
      }
    }

    if (
      league.id === 'nba' &&
      String(comp.status?.type?.name || '').toUpperCase() === 'STATUS_IN_PROGRESS' &&
      aiSignals.espn_total_over_prob != null &&
      aiSignals.market_total != null
    ) {
      const sourceBook = String(effectiveOdds?.market_source_book || '').toLowerCase();
      const isAlreadyPinnacle = sourceBook === 'pinnacle' || sourceBook === 'lowvig';

      if (!isAlreadyPinnacle) {
        try {
          const { data: pinSnap } = await supabase
            .from('live_odds_snapshots')
            .select('total')
            .eq('match_id', dbMatchId)
            .eq('provider', 'Pinnacle')
            .not('total', 'is', null)
            .order('captured_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const pinTotal = pinSnap?.total != null ? Number(pinSnap.total) : null;
          const dkTotal = aiSignals.market_total != null ? Number(aiSignals.market_total) : null;
          const espnProb = aiSignals.espn_total_over_prob != null ? Number(aiSignals.espn_total_over_prob) : null;

          if (pinTotal != null && dkTotal != null && espnProb != null) {
            const espnOver = espnProb > 0.55;
            const espnUnder = espnProb < 0.45;
            const pinOver = pinTotal > dkTotal + 2;
            const pinUnder = pinTotal < dkTotal - 2;

            if ((espnOver && pinOver) || (espnUnder && pinUnder)) {
              aiSignals.confluence_tier = (espnProb >= 0.65 || espnProb <= 0.35) ? 'CONFLUENCE_STRONG' : 'CONFLUENCE_LEAN';
              aiSignals.confluence_direction = espnOver ? 'OVER' : 'UNDER';
              aiSignals.confluence_espn_prob = espnProb;
              aiSignals.confluence_pinnacle_total = pinTotal;
            } else if ((espnOver && pinUnder) || (espnUnder && pinOver)) {
              aiSignals.confluence_tier = 'CONFLICT';
              aiSignals.confluence_direction = null;
              aiSignals.confluence_espn_prob = espnProb;
              aiSignals.confluence_pinnacle_total = pinTotal;
            }
          }
        } catch (e: any) {
          Logger.warn('CONFLUENCE_EVAL_FAILED', { match_id: dbMatchId, error: e?.message || String(e) });
        }
      } else {
        if (Array.isArray(aiSignals.debug_trace)) {
          aiSignals.debug_trace.push('confluence:skipped_pinnacle_is_source');
        }
      }
    }

    const finalSituation = { ...(typeof mergedSituation === 'object' && mergedSituation ? mergedSituation : {}), ...(coreEnrichment.situation || {}) };
    const finalAdvancedMetrics = { ...(typeof extractedAdvancedMetrics === 'object' && extractedAdvancedMetrics ? extractedAdvancedMetrics : {}), ...(coreEnrichment.advanced_metrics || {}) };
    const finalExtraData = { ...(typeof manualSituationData === 'object' && manualSituationData ? manualSituationData : {}), ...(coreEnrichment.extra_data || {}) };
    const finalPredictor = (typeof extractedPredictor === 'object' && extractedPredictor)
      ? extractedPredictor
      : (bpiPayloadData ? {
        homeTeamChance: bpiPayloadData.homePredWinPct,
        awayTeamChance: bpiPayloadData.awayPredWinPct,
        homeTeamLine: bpiPayloadData.homePredMov,
        matchupQuality: bpiPayloadData.matchupQuality,
        lastUpdated: bpiPayloadData.lastUpdated
      } : null);

    const stateCaptureSource = !isSoccer && coreBase ? 'espn_core' : 'espn_summary';
    const stateExtraData = {
      ...(Object.keys(finalExtraData).length > 0 ? finalExtraData : {}),
      capture_mode: 'native',
      capture_source: stateCaptureSource,
      capture_reason: 'scheduled_ingest',
      captured_at: new Date().toISOString(),
    };

    const statePayload: any = {
      id: dbMatchId, league_id: league.id, sport: league.db_sport, game_status: matchPayload.status || 'SCHEDULED',
      canonical_id: canonicalIdForState, period: finalPeriod, clock: comp.status?.displayClock, home_score: homeScore, away_score: awayScore,
      situation: Object.keys(finalSituation).length > 0 ? finalSituation : null,
      last_play: extractedLastPlay, current_drive: extractedDrive, recent_plays: extractedRecentPlays, stats: extractedStats,
      player_stats: extractedPlayerStats, leaders: extractedLeaders, momentum: extractedMomentum,
      advanced_metrics: Object.keys(finalAdvancedMetrics).length > 0 ? finalAdvancedMetrics : null,
      match_context: extractedContext, predictor: finalPredictor,
      extra_data: stateExtraData,
      deterministic_signals: aiSignals, odds: { current: effectiveOdds, t60_snapshot: t60_snapshot || null, t0_snapshot: t0_snapshot || null }, updated_at: new Date().toISOString()
    };

    try {
      const { error: txError } = await supabase.rpc('upsert_game_state_atomic', { p_match_payload: matchPayload, p_state_payload: statePayload, p_closing_payload: closingPayload });
      if (txError) throw txError;
    } catch (rpcErr: any) {
      stats.degraded_transactions++;
      Logger.warn('NON_ATOMIC_FALLBACK', { match_id: dbMatchId, error: rpcErr.message });
      await upsertWithRetry('matches', matchPayload);
      if (closingPayload) await upsertWithRetry('closing_lines', closingPayload);
      await upsertWithRetry('live_game_state', statePayload);
    }
    stats.reliability.live_state_writes++;

    if (canonicalOddsPayload && finalOddsHasKeys) {
      await writeCurrentOdds({ supabase, matchId: dbMatchId, normalizedOdds: canonicalOddsPayload, rawOdds: finalMarketOdds, provider: finalMarketOdds.provider || 'ESPN', isLive: isLiveGame, updatedAt: new Date().toISOString() } as any).catch((e: any) => Logger.warn('WRITE_CURRENT_ODDS_ERROR', { match_id: dbMatchId, error: e.message }));
    }

    // ═══ EVENT HISTORY ═══
    if (homeStatsRaw || awayStatsRaw) { try { await supabase.from('game_events').upsert({ match_id: dbMatchId, league_id: league.id, sport: league.db_sport, event_type: 'box_snapshot', sequence: generateSequence(), period: finalPeriod ?? null, clock: comp.status?.displayClock ?? null, home_score: homeScore, away_score: awayScore, box_snapshot: { sport: league.db_sport, home: homeStatsRaw, away: awayStatsRaw }, source: 'core_api_stats' }, { onConflict: 'match_id,event_type,sequence' }); } catch { } }

    // Bridge: If summary API returned no live odds but Core API or premium feed has them, use those
    // Merge all sources: effectiveOdds (Institutional/canonical) + parsedCoreOdds (ESPN Core API with ML/juice)
    if (!parsedOdds.odds_live && isLiveGame) {
      const eo = effectiveOdds || {};
      const co = parsedCoreOdds || {};
      const eoTotal = eo.total ?? eo.main?.total?.line ?? null;
      const eoHomeSpread = eo.homeSpread ?? eo.main?.spread?.home?.point ?? eo.spread ?? null;
      const eoAwaySpread = eo.awaySpread ?? eo.main?.spread?.away?.point ?? null;
      const bridgedHomeSpread = eoHomeSpread ?? co.homeSpread ?? null;
      const bridgedAwaySpread = eoAwaySpread ?? co.awaySpread ?? (typeof bridgedHomeSpread === 'number' ? -bridgedHomeSpread : null);
      const eoHomeMl = eo.homeML ?? eo.main?.h2h?.home?.price ?? eo.homeWin ?? eo.home_ml ?? null;
      const eoAwayMl = eo.awayML ?? eo.main?.h2h?.away?.price ?? eo.awayWin ?? eo.away_ml ?? null;
      const eoOverOdds = eo.overOdds ?? eo.main?.total?.over?.price ?? null;
      const eoUnderOdds = eo.underOdds ?? eo.main?.total?.under?.price ?? null;
      const hasData = bridgedHomeSpread != null || bridgedAwaySpread != null || eoTotal != null || eoHomeMl != null || eoAwayMl != null || co.total != null || co.homeWin != null || co.awayWin != null;
      if (hasData) {
        parsedOdds.odds_live = {
          total: eoTotal ?? co.total ?? null,
          homeSpread: bridgedHomeSpread,
          awaySpread: bridgedAwaySpread,
          home_ml: eoHomeMl ?? co.homeWin ?? null,
          away_ml: eoAwayMl ?? co.awayWin ?? null,
          overOdds: eoOverOdds ?? co.overOdds ?? null,
          underOdds: eoUnderOdds ?? co.underOdds ?? null,
          homeSpreadOdds: eo.homeSpreadOdds ?? co.homeSpreadOdds ?? null,
          awaySpreadOdds: eo.awaySpreadOdds ?? co.awaySpreadOdds ?? null,
          provider: eo.provider ?? co.provider ?? 'Core API',
          provider_id: null,
          captured_at: new Date().toISOString(),
        };
      }
    }

    const eventStartMs = parseEventStartMs(event);
    const startedByClock = eventStartMs !== null && eventStartMs <= (Date.now() + 60000);
    const shouldCaptureLiveSnapshot = isLiveGame || startedByClock || isFinalStatus(comp.status?.type?.name);
    if (shouldCaptureLiveSnapshot) {
      const snapshotWrite = await writeLiveOddsSnapshotWithGuard({
        supabase,
        matchId: dbMatchId,
        leagueId: league.id,
        sport: league.db_sport,
        status: String(comp.status?.type?.name || matchPayload.status || 'STATUS_SCHEDULED'),
        period: finalPeriod ?? null,
        clock: comp.status?.displayClock ?? null,
        homeScore,
        awayScore,
        homeTeam: homeNameStr !== 'Unknown' ? homeNameStr : null,
        awayTeam: awayNameStr !== 'Unknown' ? awayNameStr : null,
        effectiveOdds,
        parsedOdds,
        finalMarketOdds,
        isLiveGame,
        source: 'ingest-live-games',
        degradeReason: 'NO_MARKET_DATA_PRIMARY_PASS',
      });

      if (snapshotWrite.inserted) {
        stats.snapshots++;
        stats.reliability.snapshot_writes++;
        if (snapshotWrite.degraded) stats.reliability.degraded_snapshot_writes++;
      }
      if (snapshotWrite.providerFailure) stats.reliability.provider_failures++;
    }

    const hasAnyOdds = !!(parsedOdds.odds_live || parsedOdds.odds_open || parsedOdds.odds_close || parsedOdds.bet365_live || parsedOdds.dk_live_200);
    if (hasAnyOdds) {
      const oddsSnapshotPayload: any = { match_id: dbMatchId, league_id: league.id, sport: league.db_sport, event_type: 'odds_snapshot', sequence: generateSequence(), period: finalPeriod ?? null, clock: comp.status?.displayClock ?? null, home_score: homeScore, away_score: awayScore, odds_open: parsedOdds.odds_open, odds_close: parsedOdds.odds_close, odds_live: parsedOdds.odds_live, bet365_live: parsedOdds.bet365_live, dk_live_200: parsedOdds.dk_live_200, player_props: parsedOdds.player_props, match_state: { status: comp.status?.type?.name ?? null, home_team: homeNameStr, away_team: awayNameStr, score: `${homeScore}-${awayScore}`, period: finalPeriod ?? null, clock: comp.status?.displayClock ?? null }, source: 'espn_live_odds' };
      try { const { error: geError } = await supabase.from('game_events').upsert(oddsSnapshotPayload, { onConflict: 'match_id,event_type,sequence' }); if (!geError) stats.odds_snapshots_written++; } catch { }
    }

    if (bpiLatestItem && bpiLatestItem.homeWinPercentage != null) {
      let bpiSeq = parseInt(bpiLatestItem.sequenceNumber, 10); if (isNaN(bpiSeq) || bpiSeq > 2147483647) bpiSeq = generateSequence();
      try { await supabase.from('game_events').upsert({ match_id: dbMatchId, league_id: league.id, sport: league.db_sport, event_type: 'bpi_probability', sequence: bpiSeq, period: finalPeriod ?? null, clock: comp.status?.displayClock ?? null, home_score: homeScore, away_score: awayScore, play_data: { homeWinPct: bpiLatestItem.homeWinPercentage, awayWinPct: bpiLatestItem.awayWinPercentage, tieWinPct: bpiLatestItem.tiePercentage ?? 0, sequenceNumber: bpiLatestItem.sequenceNumber, lastModified: bpiLatestItem.lastModified, ...(bpiPayloadData ? { bpiPredictedMov: bpiPayloadData.homePredMov, bpiPregameWinPct: bpiPayloadData.homePredWinPct, bpiAwayPregameWinPct: bpiPayloadData.awayPredWinPct, matchupQuality: bpiPayloadData.matchupQuality, predictorLastUpdated: bpiPayloadData.lastUpdated } : {}) }, odds_live: cleanFinalOdds, source: 'espn_bpi' }, { onConflict: 'match_id,event_type,sequence' }); stats.bpi_snapshots++; } catch { }
    }

    let selectedPlays = Array.isArray(data?.plays) ? data.plays : [];
    let playSource = 'espn';
    if (coreBase && Array.isArray(corePlaysData?.items) && corePlaysData.items.length > 0) {
      const summaryMaxHome = selectedPlays.reduce((m: number, p: any) => Math.max(m, parseInt(String(p?.homeScore ?? 0), 10) || 0), 0);
      const summaryMaxAway = selectedPlays.reduce((m: number, p: any) => Math.max(m, parseInt(String(p?.awayScore ?? 0), 10) || 0), 0);
      const summaryStale = selectedPlays.length === 0 || summaryMaxHome < homeScore || summaryMaxAway < awayScore;
      if (summaryStale) {
        let coreItems = corePlaysData.items;
        if ((corePlaysData.pageCount ?? 0) > 1) {
          const lastPage = await fetchCoreJson(`${coreBase}/plays?limit=200&page=${corePlaysData.pageCount}`);
          if (Array.isArray(lastPage?.items) && lastPage.items.length > 0) {
            coreItems = lastPage.items;
          }
        }
        selectedPlays = Array.isArray(coreItems) ? coreItems : selectedPlays;
        playSource = 'espn_core';
      }
    }

    try {
      const primaryPlayRows = Array.isArray(selectedPlays)
        ? selectedPlays
          .filter((p: any) => p?.id && p?.text)
          .map((p: any, index: number) => {
            const seq = deriveStablePlaySequence(p, index, 'primary');
            return {
              match_id: dbMatchId,
              league_id: league.id,
              sport: league.db_sport,
              event_type: 'play',
              sequence: seq,
              period: p.period?.number ?? finalPeriod ?? null,
              clock: p.clock?.displayValue ?? null,
              home_score: parseInt(p.homeScore?.toString() || '0', 10) || 0,
              away_score: parseInt(p.awayScore?.toString() || '0', 10) || 0,
              play_data: {
                id: p.id,
                text: p.text,
                type: p.type?.text ?? p.type ?? null,
                scoringPlay: !!p.scoringPlay,
                statYardage: p.statYardage ?? p.scoreValue ?? 0,
                down: p.start?.down ?? null,
                distance: p.start?.distance ?? null,
                yardLine: p.start?.yardLine ?? null
              },
              source: playSource
            };
          })
        : [];

      const recentFallbackRows = Array.isArray(extractedRecentPlays)
        ? extractedRecentPlays
          .filter((p: any) => p?.text)
          .map((p: any, index: number) => {
            const text = String(p.text || '').trim();
            if (!text) return null;
            const seq = deriveStablePlaySequence(p, index + 5000, 'recent');
            const inferredScoring = !!p.scoringPlay || /(goal|scores|makes|touchdown|penalty kick goal|own goal|free throw)/i.test(text);
            return {
              match_id: dbMatchId,
              league_id: league.id,
              sport: league.db_sport,
              event_type: 'play',
              sequence: seq,
              period: p.period ?? finalPeriod ?? null,
              clock: p.clock ?? comp.status?.displayClock ?? null,
              home_score: parseInt((p.home_score ?? p.homeScore ?? homeScore)?.toString() || '0', 10) || 0,
              away_score: parseInt((p.away_score ?? p.awayScore ?? awayScore)?.toString() || '0', 10) || 0,
              play_data: {
                id: p.id ?? `recent:${seq}`,
                text,
                type: p.type ?? null,
                scoringPlay: inferredScoring
              },
              source: 'espn_recent_fallback'
            };
          })
          .filter((row: any) => row !== null)
        : [];

      const bySequence = new Map<number, any>();
      for (const row of primaryPlayRows) bySequence.set(row.sequence, row);
      for (const row of recentFallbackRows) {
        if (!bySequence.has(row.sequence)) bySequence.set(row.sequence, row);
      }

      const playRows = Array.from(bySequence.values());
      if (playRows.length > 0) {
        for (let i = 0; i < playRows.length; i += 200) {
          await supabase.from('game_events').upsert(playRows.slice(i, i + 200), { onConflict: 'match_id,event_type,sequence' });
        }
        stats.reliability.pbp_writes += playRows.length;
      }
    } catch { }

    if (_contextSnapshotAvailable) {
      try {
        const contextSnapshotPayload = { match_id: dbMatchId, league_id: league.id, sport: league.db_sport, game_status: matchPayload.status || 'SCHEDULED', period: finalPeriod ?? null, clock: comp.status?.displayClock ?? null, home_score: homeScore, away_score: awayScore, odds_current: effectiveOdds || null, odds_total: safeExtractFlatOdds(effectiveOdds, 'total'), odds_home_ml: safeExtractFlatOdds(effectiveOdds, 'homeMl'), odds_away_ml: safeExtractFlatOdds(effectiveOdds, 'awayMl'), situation: statePayload.situation, last_play: extractedLastPlay, recent_plays: extractedRecentPlays, stats: extractedStats, leaders: extractedLeaders, momentum: extractedMomentum, advanced_metrics: statePayload.advanced_metrics, match_context: extractedContext, predictor: finalPredictor, deterministic_signals: aiSignals, captured_at: new Date().toISOString() };
        const { error: contextSnapshotError } = await supabase.from('live_context_snapshots').insert(contextSnapshotPayload);
        if (!contextSnapshotError) { stats.context_snapshots++; } else { const errMsg = contextSnapshotError.message || String(contextSnapshotError); Logger.warn('CONTEXT_SNAPSHOT_INSERT_FAILED', { match_id: dbMatchId, error: errMsg }); if (errMsg.toLowerCase().includes('does not exist')) _contextSnapshotAvailable = false; }
      } catch (e: any) { Logger.warn('CONTEXT_SNAPSHOT_INSERT_EXCEPTION', { match_id: dbMatchId, error: e.message }); }
    }

    stats.processed++; if (isLiveGame) stats.live++;
  } catch (e: any) { stats.failed++; stats.errors.push(`${league.id}/${dbMatchId}: ${e.message || String(e)}`); }
}
