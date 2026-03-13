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
  { id: 'atp', db_sport: 'tennis', espn_sport: 'tennis', endpoint: 'tennis/atp' },
  { id: 'wta', db_sport: 'tennis', espn_sport: 'tennis', endpoint: 'tennis/wta' }
];

const Logger = {
  info: (msg: string, data?: any) => console.log(JSON.stringify({ level: 'INFO', msg, ...(data || {}) })),
  warn: (msg: string, data?: any) => console.warn(JSON.stringify({ level: 'WARN', msg, ...(data || {}) })),
  debug: (msg: string, data?: any) => console.log(JSON.stringify({ level: 'DEBUG', msg, ...(data || {}) })),
  error: (msg: string, error?: any) => console.error(JSON.stringify({ level: 'ERROR', msg, error: error?.message || error }))
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

function computeAISignalsSafely(matchPayload: any, context: { matchId: string; leagueId: string; mode: 'dry' | 'persist' }) {
  try { return { value: computeAISignals(matchPayload), error: null as string | null }; }
  catch (e: any) { Logger.error('AI_SIGNAL_COMPUTE_FAILED', { matchId: context.matchId, league_id: context.leagueId, error: e.message || String(e) }); return { value: null, error: String(e) }; }
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

// ─── MAIN EXECUTION ───────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const reqUrl = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const rawTarget = body?.target_match_id ?? reqUrl.searchParams.get('target_match_id');
  const targetArray = Array.isArray(rawTarget) ? rawTarget : (rawTarget ? String(rawTarget).split(',') : []);
  const targetSet = new Set(targetArray.map(s => String(s).trim()).filter(Boolean));

  const dates = body?.dates ?? reqUrl.searchParams.get('dates');
  const dryRun = parseBool(body?.dry ?? reqUrl.searchParams.get('dry'));
  const debug = parseBool(body?.debug ?? reqUrl.searchParams.get('debug'));
  const maxGamesGlobalParam = parsePositiveInt(body?.max_games ?? body?.max_games_total ?? reqUrl.searchParams.get('max_games') ?? reqUrl.searchParams.get('max_games_total'));
  const maxGamesGlobal = maxGamesGlobalParam ? Math.min(maxGamesGlobalParam, 50) : null;

  const leagueParamRaw = body?.league ?? reqUrl.searchParams.get('league') ?? '';
  const leagueFilter = new Set(String(leagueParamRaw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

  const startedAt = Date.now();
  const stats = {
    attempted: 0, processed: 0, live: 0, failed: 0, errors: [] as string[],
    snapshots: 0, odds_snapshots_written: 0, bpi_snapshots: 0, context_snapshots: 0,
    degraded_transactions: 0, dry_run: dryRun, max_games_requested: maxGamesGlobal,
    league_filter: [...leagueFilter], dry_samples: [] as any[],
  };

  try { getSupabaseClient(); } catch (e: any) {
    Logger.error('BOOT_INIT_FAILED', { error: e.message || e });
    return new Response(JSON.stringify({ ok: false, error: e.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabase = getSupabaseClient();
  let globalAttempted = 0;

  leagueLoop:
  for (const league of MONITOR_LEAGUES) {
    if (maxGamesGlobal && globalAttempted >= maxGamesGlobal) break;
    if (leagueFilter.size > 0 && !leagueFilter.has(league.id)) continue;

    try {
      const dateQuery = dates ? `?dates=${dates}` : '';
      const groupsParam = league.groups ? `${dateQuery ? '&' : '?'}groups=${league.groups}` : '';
      const res = await fetchWithRetry(`${SCOREBOARD_BASE}/${league.endpoint}/scoreboard${dateQuery}${groupsParam}`);
      const data = await res.json();
      let events = data.events || [];

      if (league.db_sport === 'tennis') {
        events = events.flatMap((t: any) => (t.groupings || []).flatMap((g: any) => (g.competitions || []).map((c: any) => ({ ...t, id: c.id, date: c.date, status: c.status, competitions: [c] }))));
      }

      let processableEvents = [];
      for (const event of events) {
        const state = event.status?.type?.state;
        if (!['in', 'post'].includes(state)) {
          const mins = (new Date(event.date).getTime() - Date.now()) / 60000;
          if (state !== 'pre' || mins > 75 || mins < -20) continue;
        }
        const dbMatchId = getCanonicalMatchId(event.id, league.id);
        if (targetSet.size > 0 && !targetSet.has(String(event.id)) && !targetSet.has(dbMatchId)) continue;
        processableEvents.push(event);
      }

      const CONCURRENCY = 5;
      for (let i = 0; i < processableEvents.length; i += CONCURRENCY) {
        if (maxGamesGlobal && globalAttempted >= maxGamesGlobal) break leagueLoop;
        const chunk = processableEvents.slice(i, i + CONCURRENCY);
        const executing = chunk.map(async (event) => {
          if (maxGamesGlobal && globalAttempted >= maxGamesGlobal) return;
          const dbMatchId = getCanonicalMatchId(event.id, league.id);
          if (_localLocks.has(dbMatchId)) return;
          _localLocks.add(dbMatchId);

          let hasDbLock = false;
          let dbLockUnavailable = false;
          try {
            const { data, error } = await supabase.rpc('acquire_ingest_lock', { p_match_id: dbMatchId, p_ttl_seconds: 45 });
            if (!error && data === true) { hasDbLock = true; }
            else if (error) { const errStr = JSON.stringify(error).toLowerCase(); if (errStr.includes('42883') || errStr.includes('42p01') || errStr.includes('could not find function')) { dbLockUnavailable = true; } }
          } catch { dbLockUnavailable = true; }

          if (!hasDbLock && !dbLockUnavailable && !dryRun) { _localLocks.delete(dbMatchId); return; }

          globalAttempted++;
          stats.attempted++;
          await processGame(supabase, event, dbMatchId, league, stats, { dryRun, debug }).finally(async () => {
            _localLocks.delete(dbMatchId);
            if (hasDbLock) { try { await supabase.rpc('release_ingest_lock', { p_match_id: dbMatchId }); } catch { } }
          });
        });
        await Promise.all(executing);
      }
    } catch (e: any) { stats.errors.push(`${league.id}: ${e.message}`); Logger.warn('LEAGUE_LOOP_FAILED', { league: league.id, error: e.message }); }
  }

  (stats as any).elapsed_ms = Date.now() - startedAt;
  if (!debug && stats.dry_samples.length > 5) stats.dry_samples = stats.dry_samples.slice(0, 5);
  return new Response(JSON.stringify(stats), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
      const drySignalsProbe = computeAISignalsSafely({ id: dbMatchId, league_id: league.id, sport: league.db_sport, status: comp.status?.type?.name, period: comp.status?.period, display_clock: comp.status?.displayClock, home_score: homeScore, away_score: awayScore, current_odds: null }, { matchId: dbMatchId, leagueId: league.id, mode: 'dry' });
      stats.processed++; if (isLiveGame) stats.live++;
      if (stats.dry_samples.length < 10) stats.dry_samples.push({ match_id: dbMatchId, status: comp.status?.type?.name, signal_guard: { ok: drySignalsProbe.error === null, error: drySignalsProbe.error } });
      return;
    }

    const canonicalId = (await resolveCanonicalMatch(supabase, homeNameStr, awayNameStr, event.date, league.id)) ?? generateDeterministicId(homeNameStr, awayNameStr, event.date, league.id);
    try { await upsertWithRetry('canonical_games', { id: canonicalId, league_id: league.id, sport: league.db_sport, home_team_name: homeNameStr, away_team_name: awayNameStr, commence_time: event.date, status: comp.status?.type?.name }); } catch { }

    const { data: existingMatch } = await supabase.from('matches').select('status, home_score, away_score, period, current_odds, opening_odds, closing_odds, is_closing_locked').eq('id', dbMatchId).maybeSingle();
    let premiumFeed = null;
    try { const { data: rpcData, error: rpcError } = await supabase.rpc('resolve_market_feed', { p_match_id: matchId, p_canonical_id: canonicalId }); if (!rpcError && rpcData) premiumFeed = Array.isArray(rpcData) ? rpcData[0] : rpcData; } catch { }

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

    if (!isSoccer) {
      const endpointParts = String(league.endpoint || '').split('/');
      const espnLeagueId = endpointParts.length > 1 ? endpointParts[1] : null;
      if (espnLeagueId && home?.id && away?.id) {
        const coreBase = `https://sports.core.api.espn.com/v2/sports/${league.espn_sport}/leagues/${espnLeagueId}/events/${matchId}/competitions/${matchId}`;
        const [coreOddsData, probData, predictorData, homeStatsData, awayStatsData, homeLeadersData, awayLeadersData, homeRosterData, awayRosterData, situationData] = await Promise.all([
          fetchCoreJson(`${coreBase}/odds`), fetchCoreJson(`${coreBase}/probabilities?limit=5`), fetchCoreJson(`${coreBase}/predictor`),
          fetchCoreJson(`${coreBase}/competitors/${home.id}/statistics`), fetchCoreJson(`${coreBase}/competitors/${away.id}/statistics`),
          fetchCoreJson(`${coreBase}/competitors/${home.id}/leaders`), fetchCoreJson(`${coreBase}/competitors/${away.id}/leaders`),
          fetchCoreJson(`${coreBase}/competitors/${home.id}/roster`), fetchCoreJson(`${coreBase}/competitors/${away.id}/roster`),
          fetchCoreJson(`${coreBase}/situation`)
        ]);

        if (coreOddsData && Array.isArray(coreOddsData.items)) {
          const items = coreOddsData.items;
          const extractCoreOdds = (source: any, type: 'current' | 'open' | 'close') => {
            if (!source || !source[type]) return null;
            const d = source[type];
            return { homeWin: parsePrice(d.homeTeamOdds?.moneyLine ?? d.moneyLine), awayWin: parsePrice(d.awayTeamOdds?.moneyLine), homeSpread: parsePoints(d.homeTeamOdds?.spread ?? d.spread), awaySpread: parsePoints(d.awayTeamOdds?.spread), total: parsePoints(d.overUnder ?? d.total?.alternateDisplayValue ?? d.total?.american ?? d.total?.value ?? (typeof d.total === 'number' ? d.total : null)), overOdds: parsePrice(d.overOdds ?? d.overUnderOdds ?? d.over?.american ?? d.over?.alternateDisplayValue), underOdds: parsePrice(d.underOdds ?? d.under?.american ?? d.under?.alternateDisplayValue), homeSpreadOdds: parsePrice(d.homeTeamOdds?.spreadOdds ?? d.spreadOdds), awaySpreadOdds: parsePrice(d.awayTeamOdds?.spreadOdds), provider: source.provider?.name || 'ESPN' };
          };
          const liveItem = [...items].filter(p => p?.current).sort((a, b) => getLiveProviderScore(a) - getLiveProviderScore(b))[0];
          parsedCoreOdds = liveItem ? extractCoreOdds(liveItem, 'current') : null;
        }

        if (predictorData) {
          const getStatValue = (team: any, name: string) => { const statsArray = Array.isArray(team?.statistics) ? team.statistics : (Array.isArray(team?.team?.statistics) ? team.team.statistics : []); return statsArray.find((s: any) => s.name === name)?.value ?? null; };
          bpiPayloadData = { homePredMov: getStatValue(predictorData.homeTeam, 'teampredmov'), homePredWinPct: getStatValue(predictorData.homeTeam, 'teampredwinpct'), awayPredWinPct: getStatValue(predictorData.awayTeam, 'teampredwinpct'), matchupQuality: getStatValue(predictorData.homeTeam, 'matchupquality'), lastUpdated: predictorData.lastModified ?? null };
        }

        if (probData) {
          bpiProbData = probData; let latestItems = bpiProbData.items ?? [];
          if ((bpiProbData.pageCount ?? 0) > 1) { const lastPage = await fetchCoreJson(`${coreBase}/probabilities?limit=5&page=${bpiProbData.pageCount}`); if (lastPage) { latestItems = lastPage.items ?? latestItems; bpiProbData = lastPage; } }
          bpiLatestItem = latestItems.length > 0 ? latestItems[latestItems.length - 1] : null;
        }

        const extractStats = (json: any) => { const r: any = {}; (json?.splits?.categories ?? []).forEach((c: any) => (c?.stats ?? []).forEach((s: any) => { if (s?.name && s?.value != null) r[s.name] = s.value; })); return Object.keys(r).length > 0 ? r : null; };
        homeStatsRaw = extractStats(homeStatsData); awayStatsRaw = extractStats(awayStatsData);
        if (homeStatsRaw || awayStatsRaw) { coreEnrichment.advanced_metrics = { core_api_efficiency: { home: homeStatsRaw ? { ppep: homeStatsRaw.pointsPerEstimatedPossessions, pace: homeStatsRaw.estimatedPossessions, shootingEff: homeStatsRaw.shootingEfficiency, offRebPct: homeStatsRaw.offensiveReboundPct, astToRatio: homeStatsRaw.assistTurnoverRatio } : null, away: awayStatsRaw ? { ppep: awayStatsRaw.pointsPerEstimatedPossessions, pace: awayStatsRaw.estimatedPossessions, shootingEff: awayStatsRaw.shootingEfficiency, offRebPct: awayStatsRaw.offensiveReboundPct, astToRatio: awayStatsRaw.assistTurnoverRatio } : null } }; }

        const extractLeaders = (json: any) => { const result: Record<string, any> = {}; for (const cat of (json?.leaders ?? [])) { const topPlayer = cat?.leaders?.[0]; if (topPlayer) result[cat?.name ?? cat?.displayName ?? 'unknown'] = { displayValue: topPlayer.displayValue, value: topPlayer.value, athleteRef: topPlayer.athlete?.$ref ?? null }; } return Object.keys(result).length > 0 ? result : null; };
        const homeLeadersRaw = homeLeadersData ? extractLeaders(homeLeadersData) : null;
        const awayLeadersRaw = awayLeadersData ? extractLeaders(awayLeadersData) : null;
        const extractRoster = (json: any) => (json?.entries ?? json?.items ?? []).filter((e: any) => e?.playerId || e?.athlete).map((e: any) => ({ id: e.playerId ?? null, athleteRef: e.athlete?.$ref ?? null, statsRef: e.statistics?.$ref ?? null })).slice(0, 20);
        const homeRosterRaw = homeRosterData ? extractRoster(homeRosterData) : null;
        const awayRosterRaw = awayRosterData ? extractRoster(awayRosterData) : null;
        if (homeRosterRaw || awayRosterRaw || homeLeadersRaw || awayLeadersRaw) { coreEnrichment.extra_data = { ...(coreEnrichment.extra_data || {}), ...(homeRosterRaw || awayRosterRaw ? { roster: { home: homeRosterRaw, away: awayRosterRaw } } : {}), ...(homeLeadersRaw || awayLeadersRaw ? { core_api_leaders: { home: homeLeadersRaw, away: awayLeadersRaw } } : {}) }; }
        if (situationData) { coreEnrichment.situation = { homeTimeouts: situationData.homeTimeouts?.timeoutsRemainingCurrent ?? null, awayTimeouts: situationData.awayTimeouts?.timeoutsRemainingCurrent ?? null, homeFouls: situationData.homeFouls?.teamFoulsCurrent ?? null, awayFouls: situationData.awayFouls?.teamFoulsCurrent ?? null, homeFoulsToGive: situationData.homeFouls?.foulsToGive ?? null, awayFoulsToGive: situationData.awayFouls?.foulsToGive ?? null, homeBonusState: situationData.homeFouls?.bonusState ?? null, awayBonusState: situationData.awayFouls?.bonusState ?? null }; }
      }
    }

    if (parsedCoreOdds) finalMarketOdds = { ...finalMarketOdds, ...parsedCoreOdds };
    if (premiumFeed && !premiumFeed.is_stale) { finalMarketOdds = { homeSpread: parsePoints(premiumFeed.spread?.home?.point), awaySpread: parsePoints(premiumFeed.spread?.away?.point), total: parsePoints(premiumFeed.total?.over?.point), homeWin: parsePrice(premiumFeed.h2h?.home?.price), awayWin: parsePrice(premiumFeed.h2h?.away?.price), isInstitutional: true, provider: "Institutional" }; }
    else { const hasEspnOdds = espnOdds.homeSpread != null || espnOdds.homeWin != null || espnOdds.total != null; const isExistingExternalDb = isExternalProvider(existingMatch?.current_odds?.provider); if (hasEspnOdds && (!isExistingExternalDb || isExternalProvider(espnOdds.provider))) { finalMarketOdds = { ...espnOdds, provider: espnOdds.provider || 'ESPN' }; } }

    const isExistingExternalDb = isExternalProvider(existingMatch?.current_odds?.provider);
    let canonicalOddsPayload = null;
    const finalOddsHasKeys = Object.keys(finalMarketOdds).length > 0 && (finalMarketOdds.homeWin != null || finalMarketOdds.homeSpread != null || finalMarketOdds.total != null);
    if (finalOddsHasKeys && (!isExistingExternalDb || isExternalProvider(finalMarketOdds.provider))) {
      canonicalOddsPayload = toCanonicalOdds(finalMarketOdds, { provider: finalMarketOdds.provider || 'ESPN', isLive: isLiveGame, updatedAt: new Date().toISOString() });
    }
    const effectiveOdds = (isExistingExternalDb && !isExternalProvider(finalMarketOdds.provider) && existingMatch?.current_odds) ? existingMatch.current_odds : (canonicalOddsPayload ?? existingMatch?.current_odds ?? null);

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

    // Engine-compatible aliases: computeAISignals expects Match interface with camelCase fields
    matchPayload.homeScore = homeScore;
    matchPayload.awayScore = awayScore;
    matchPayload.displayClock = comp.status?.displayClock;
    matchPayload.leagueId = league.id;
    matchPayload.homeTeam = { id: home?.id, name: homeNameStr, shortName: homeNameStr, logo: '', score: homeScore };
    matchPayload.awayTeam = { id: away?.id, name: awayNameStr, shortName: awayNameStr, logo: '', score: awayScore };
    matchPayload.startTime = event.date;

    const aiSignalResult = computeAISignalsSafely(matchPayload, { matchId: dbMatchId, leagueId: league.id, mode: 'persist' });
    const aiSignals = aiSignalResult.value;
    if (aiSignalResult.error) { stats.errors.push(`SIGNAL_ERR/${dbMatchId}: ${aiSignalResult.error}`); }
    if (!aiSignals) { stats.errors.push(`SIGNAL_NULL/${dbMatchId}: sport=${matchPayload.sport} homeScore=${matchPayload.homeScore} awayScore=${matchPayload.awayScore} clock=${matchPayload.displayClock} odds_total=${matchPayload.current_odds?.total}`); }
    delete matchPayload.current_odds;
    // Clean engine-only aliases before DB write
    delete matchPayload.homeScore; delete matchPayload.awayScore; delete matchPayload.displayClock;
    delete matchPayload.leagueId; delete matchPayload.homeTeam; delete matchPayload.awayTeam; delete matchPayload.startTime;

    const finalSituation = { ...(typeof mergedSituation === 'object' && mergedSituation ? mergedSituation : {}), ...(coreEnrichment.situation || {}) };
    const finalAdvancedMetrics = { ...(typeof extractedAdvancedMetrics === 'object' && extractedAdvancedMetrics ? extractedAdvancedMetrics : {}), ...(coreEnrichment.advanced_metrics || {}) };
    const finalExtraData = { ...(typeof manualSituationData === 'object' && manualSituationData ? manualSituationData : {}), ...(coreEnrichment.extra_data || {}) };

    const statePayload: any = {
      id: dbMatchId, league_id: league.id, sport: league.db_sport, game_status: matchPayload.status || 'SCHEDULED',
      canonical_id: canonicalId, period: finalPeriod, clock: comp.status?.displayClock, home_score: homeScore, away_score: awayScore,
      situation: Object.keys(finalSituation).length > 0 ? finalSituation : null,
      last_play: extractedLastPlay, current_drive: extractedDrive, recent_plays: extractedRecentPlays, stats: extractedStats,
      player_stats: extractedPlayerStats, leaders: extractedLeaders, momentum: extractedMomentum,
      advanced_metrics: Object.keys(finalAdvancedMetrics).length > 0 ? finalAdvancedMetrics : null,
      match_context: extractedContext, predictor: extractedPredictor,
      extra_data: Object.keys(finalExtraData).length > 0 ? finalExtraData : null,
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

    if (canonicalOddsPayload && finalOddsHasKeys) {
      await writeCurrentOdds({ supabase, matchId: dbMatchId, normalizedOdds: canonicalOddsPayload, rawOdds: finalMarketOdds, provider: finalMarketOdds.provider || 'ESPN', isLive: isLiveGame, updatedAt: new Date().toISOString() } as any).catch((e: any) => Logger.warn('WRITE_CURRENT_ODDS_ERROR', { match_id: dbMatchId, error: e.message }));
    }

    // ═══ EVENT HISTORY ═══
    if (homeStatsRaw || awayStatsRaw) { try { await supabase.from('game_events').upsert({ match_id: dbMatchId, league_id: league.id, sport: league.db_sport, event_type: 'box_snapshot', sequence: generateSequence(), period: finalPeriod ?? null, clock: comp.status?.displayClock ?? null, home_score: homeScore, away_score: awayScore, box_snapshot: { sport: league.db_sport, home: homeStatsRaw, away: awayStatsRaw }, source: 'core_api_stats' }, { onConflict: 'match_id,event_type,sequence' }); } catch { } }

    // Bridge: If summary API returned no live odds but Core API or premium feed has them, use those
    if (!parsedOdds.odds_live && isLiveGame && effectiveOdds && (effectiveOdds.total != null || effectiveOdds.homeSpread != null || effectiveOdds.homeWin != null)) {
      parsedOdds.odds_live = {
        total: effectiveOdds.total ?? null,
        homeSpread: effectiveOdds.homeSpread ?? effectiveOdds.spread ?? null,
        awaySpread: effectiveOdds.awaySpread ?? null,
        home_ml: effectiveOdds.homeWin ?? effectiveOdds.homeML ?? effectiveOdds.home_ml ?? null,
        away_ml: effectiveOdds.awayWin ?? effectiveOdds.awayML ?? effectiveOdds.away_ml ?? null,
        overOdds: effectiveOdds.overOdds ?? null,
        underOdds: effectiveOdds.underOdds ?? null,
        homeSpreadOdds: effectiveOdds.homeSpreadOdds ?? null,
        awaySpreadOdds: effectiveOdds.awaySpreadOdds ?? null,
        provider: effectiveOdds.provider ?? 'Core API',
        provider_id: null,
        captured_at: new Date().toISOString(),
      };
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

    if (Array.isArray(data?.plays) && data.plays.length > 0) {
      try {
        const playRows = data.plays.filter((p: any) => p?.id && p?.text).map((p: any, index: number) => {
          let seq = parseInt(p.sequenceNumber, 10); if (isNaN(seq) || seq > 2147483647) { const fallbackFromId = parseInt(String(p.id || '').replace(/\D/g, '').slice(-8), 10); seq = (Number.isFinite(fallbackFromId) && fallbackFromId > 0) ? fallbackFromId : (generateSequence() + index); }
          return { match_id: dbMatchId, league_id: league.id, sport: league.db_sport, event_type: 'play', sequence: seq, period: p.period?.number ?? finalPeriod ?? null, clock: p.clock?.displayValue ?? null, home_score: parseInt(p.homeScore?.toString() || '0', 10) || 0, away_score: parseInt(p.awayScore?.toString() || '0', 10) || 0, play_data: { id: p.id, text: p.text, type: p.type?.text ?? null, scoringPlay: !!p.scoringPlay, statYardage: p.statYardage ?? 0, down: p.start?.down ?? null, distance: p.start?.distance ?? null, yardLine: p.start?.yardLine ?? null }, source: 'espn' };
        });
        if (playRows.length > 0) { for (let i = 0; i < playRows.length; i += 200) await supabase.from('game_events').upsert(playRows.slice(i, i + 200), { onConflict: 'match_id,event_type,sequence' }); }
      } catch { }
    }

    if (_contextSnapshotAvailable) {
      try {
        const contextSnapshotPayload = { match_id: dbMatchId, league_id: league.id, sport: league.db_sport, game_status: matchPayload.status || 'SCHEDULED', period: finalPeriod ?? null, clock: comp.status?.displayClock ?? null, home_score: homeScore, away_score: awayScore, odds_current: effectiveOdds || null, odds_total: safeExtractFlatOdds(effectiveOdds, 'total'), odds_home_ml: safeExtractFlatOdds(effectiveOdds, 'homeMl'), odds_away_ml: safeExtractFlatOdds(effectiveOdds, 'awayMl'), situation: statePayload.situation, last_play: extractedLastPlay, recent_plays: extractedRecentPlays, stats: extractedStats, leaders: extractedLeaders, momentum: extractedMomentum, advanced_metrics: statePayload.advanced_metrics, match_context: extractedContext, predictor: extractedPredictor, deterministic_signals: aiSignals, captured_at: new Date().toISOString() };
        const { error: contextSnapshotError } = await supabase.from('live_context_snapshots').insert(contextSnapshotPayload);
        if (!contextSnapshotError) { stats.context_snapshots++; } else { const errMsg = contextSnapshotError.message || String(contextSnapshotError); Logger.warn('CONTEXT_SNAPSHOT_INSERT_FAILED', { match_id: dbMatchId, error: errMsg }); if (errMsg.toLowerCase().includes('does not exist')) _contextSnapshotAvailable = false; }
      } catch (e: any) { Logger.warn('CONTEXT_SNAPSHOT_INSERT_EXCEPTION', { match_id: dbMatchId, error: e.message }); }
    }

    stats.processed++; if (isLiveGame) stats.live++;
  } catch (e: any) { stats.failed++; stats.errors.push(`${league.id}/${dbMatchId}: ${e.message || String(e)}`); }
}
