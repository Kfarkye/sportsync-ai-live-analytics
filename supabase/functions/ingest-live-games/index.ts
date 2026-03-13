/**
 * LIVE GAME STATE INGESTION ENGINE
 * Version: 9.0.0 - Golden Master Release
 * 
 * REQUIRED DATABASE INFRASTRUCTURE:
 * 
 * 1. INGESTION LOCKS TABLE (For cross-container concurrency safety)
 *    CREATE TABLE ingestion_locks (id TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL);
 * 
 * 2. ATOMIC UPSERT RPC (For transactional core writes)
 *    CREATE OR REPLACE FUNCTION upsert_game_state_atomic(
 *      p_match_payload jsonb, p_state_payload jsonb, p_closing_payload jsonb
 *    ) RETURNS void LANGUAGE plpgsql AS $$
 *    BEGIN
 *      INSERT INTO matches (id, league_id, sport, status, period, display_clock, home_score, away_score, current_odds, closing_odds, is_closing_locked, last_updated, home_team, away_team, opening_odds)
 *      SELECT * FROM jsonb_populate_record(null::matches, p_match_payload)
 *      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, period = EXCLUDED.period, display_clock = EXCLUDED.display_clock, home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score, current_odds = EXCLUDED.current_odds, closing_odds = EXCLUDED.closing_odds, is_closing_locked = EXCLUDED.is_closing_locked, last_updated = EXCLUDED.last_updated, opening_odds = EXCLUDED.opening_odds;
 *      
 *      INSERT INTO live_game_state (id, league_id, sport, game_status, period, clock, home_score, away_score, odds, deterministic_signals, situation, last_play, current_drive, recent_plays, stats, player_stats, leaders, momentum, advanced_metrics, match_context, predictor, updated_at, canonical_id)
 *      SELECT * FROM jsonb_populate_record(null::live_game_state, p_state_payload)
 *      ON CONFLICT (id) DO UPDATE SET game_status = EXCLUDED.game_status, period = EXCLUDED.period, clock = EXCLUDED.clock, home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score, odds = EXCLUDED.odds, deterministic_signals = EXCLUDED.deterministic_signals, situation = EXCLUDED.situation, last_play = EXCLUDED.last_play, current_drive = EXCLUDED.current_drive, recent_plays = EXCLUDED.recent_plays, stats = EXCLUDED.stats, player_stats = EXCLUDED.player_stats, leaders = EXCLUDED.leaders, momentum = EXCLUDED.momentum, advanced_metrics = EXCLUDED.advanced_metrics, match_context = EXCLUDED.match_context, predictor = EXCLUDED.predictor, updated_at = EXCLUDED.updated_at;
 *      
 *      IF p_closing_payload IS NOT NULL THEN
 *        INSERT INTO closing_lines (match_id, league_id, home_spread, away_spread, total, home_ml, away_ml)
 *        SELECT * FROM jsonb_populate_record(null::closing_lines, p_closing_payload)
 *        ON CONFLICT (match_id) DO UPDATE SET home_spread = EXCLUDED.home_spread, away_spread = EXCLUDED.away_spread, total = EXCLUDED.total, home_ml = EXCLUDED.home_ml, away_ml = EXCLUDED.away_ml;
 *      END IF;
 *    END;
 *    $$;
 * 
 * ARCHITECTURE NOTE: ASYMMETRIC INTEGRITY POLICY
 * - Concurrency Locks: STRICT FAIL-CLOSED. If `ingestion_locks` is missing, ingestion halts. 
 *   Un-locked concurrent workers guarantee data corruption.
 * - Atomic Persistence: OPPORTUNISTIC FAIL-OPEN. If `upsert_game_state_atomic` is missing, 
 *   it degrades to sequential writes. This risks split-brain state upon partial network 
 *   failure, but is an acceptable operational fallback compared to total outage. Tracked 
 *   accurately via `atomic_core_persisted` vs `degraded_fallback_writes`.
 */
declare const Deno: any;

import { createClient } from 'npm:@supabase/supabase-js@2'
import { computeAISignals } from '../_shared/gameStateEngine.ts'
import { EspnAdapters, Safe } from '../_shared/espnAdapters.ts'
import { getCanonicalMatchId, generateDeterministicId, resolveCanonicalMatch } from '../_shared/match-registry.ts'
import { writeCurrentOdds } from '../_shared/current-odds-writer.ts'
import { Sport } from '../_shared/types.ts'

const VERSION = '9.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

let _supabase: ReturnType<typeof createClient> | null = null;
let _contextSnapshotAvailable = true;

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

// ==========================================
// 1. STRICT INTERNAL CONTRACTS
// ==========================================

export interface LeagueConfig {
  id: string;
  db_sport: string;
  espn_sport: string;
  endpoint: string;
  groups?: string;
}

export interface NormalizedOdds {
  provider: string;
  provider_id: number | null;
  is_live: boolean;
  captured_at: string;
  source: string;
  moneyline: { home: number | null; away: number | null; draw: number | null };
  spread: { home: number | null; away: number | null; home_price: number | null; away_price: number | null };
  total: { points: number | null; over_price: number | null; under_price: number | null };
}

export interface TelemetryState {
  summary: { req: number; ok: number; fail: number; rate_limit: number };
  core_odds: { req: number; ok: number; fail: number; rate_limit: number };
  bpi: { req: number; ok: number; fail: number; rate_limit: number };
  pbp: { req: number; ok: number; fail: number; rate_limit: number };
  enrichment: { req: number; ok: number; fail: number; rate_limit: number };
}

const SCOREBOARD_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const SUMMARY_BASES = [
  'https://site.api.espn.com/apis/site/v2/sports',
  'https://site.web.api.espn.com/apis/site/v2/sports'
];

const MONITOR_LEAGUES: LeagueConfig[] = [
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
  info: (msg: string, data?: any) => console.log(JSON.stringify({ level: 'INFO', v: VERSION, msg, ...data })),
  warn: (msg: string, data?: any) => console.warn(JSON.stringify({ level: 'WARN', v: VERSION, msg, ...data })),
  error: (msg: string, data?: any) => console.error(JSON.stringify({ level: 'ERROR', v: VERSION, msg, error: data?.error?.message || data?.error || data }))
};

// ==========================================
// 2. PARSERS & STRICT SCHEMA GUARDS
// ==========================================

function isNormalizedOdds(odds: any): odds is NormalizedOdds {
  if (!odds || typeof odds !== 'object' || Array.isArray(odds)) return false;
  
  const hasBaseKeys = 'provider' in odds && 'moneyline' in odds && 'spread' in odds && 'total' in odds;
  if (!hasBaseKeys) return false;
  
  if (typeof odds.provider !== 'string') return false;
  
  const isObj = (val: any) => val && typeof val === 'object' && !Array.isArray(val);
  if (!isObj(odds.moneyline) || !isObj(odds.spread) || !isObj(odds.total)) return false;
  
  const isNumOrNull = (val: any) => val === null || typeof val === 'number';
  
  const ml = odds.moneyline;
  if (!('home' in ml) || !isNumOrNull(ml.home) || !('away' in ml) || !isNumOrNull(ml.away)) return false;
  
  const sp = odds.spread;
  if (!('home' in sp) || !isNumOrNull(sp.home) || 
      !('away' in sp) || !isNumOrNull(sp.away) ||
      !('home_price' in sp) || !isNumOrNull(sp.home_price) ||
      !('away_price' in sp) || !isNumOrNull(sp.away_price)) return false;
      
  const tot = odds.total;
  if (!('points' in tot) || !isNumOrNull(tot.points) ||
      !('over_price' in tot) || !isNumOrNull(tot.over_price) ||
      !('under_price' in tot) || !isNumOrNull(tot.under_price)) return false;

  return true;
}

const parseAmerican = (val: any): number | null => {
  if (val == null) return null;
  if (typeof val === 'object') {
    val = val?.value ?? val?.american ?? val?.displayValue ?? null;
    if (typeof val === 'object') return null; // Reject unresolved structures
  }
  const str = String(val).trim().toLowerCase();
  if (str === 'ev' || str === 'even' || str === 'pk' || str === 'pick') return 100;
  const n = parseInt(str.replace('+', ''), 10);
  return isNaN(n) ? null : n;
};

const parseLine = (val: any): number | null => {
  if (val == null) return null;
  if (typeof val === 'object') {
    val = val?.value ?? val?.displayValue ?? null;
    if (typeof val === 'object') return null; 
  }
  const str = String(val).trim().toLowerCase();
  if (str === 'pk' || str === 'even' || str === 'pick') return 0;
  
  // STRICT GUARD: Reject American odds (e.g. -110, +150) masquerading as line points
  if (/^[+-]\d{3,}$/.test(str)) return null; 
  
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
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

let _seqCounter = 0;
function getSafeSequenceId(): number {
  // Expanded collision bounds: 1000/sec per container. Max value safely fits in Postgres INT4 (2B limit).
  const base = Math.floor(Date.now() / 1000) % 2000000;
  return (base * 1000) + (_seqCounter++ % 1000);
}

function normalizeOdds(sourceObj: any, providerName: string, providerId: number | null, isLive: boolean, sourceTag: string): NormalizedOdds | null {
  if (!sourceObj) return null;

  const homeLine = parseLine(sourceObj.homeTeamOdds?.spread ?? sourceObj.spread?.home ?? sourceObj.homeTeamOdds?.pointSpread?.value ?? sourceObj.spread);
  const awayLine = parseLine(sourceObj.awayTeamOdds?.spread ?? sourceObj.spread?.away ?? sourceObj.awayTeamOdds?.pointSpread?.value) ?? (homeLine !== null ? -homeLine : null);

  return {
    provider: providerName,
    provider_id: providerId,
    is_live: isLive,
    captured_at: new Date().toISOString(),
    source: sourceTag,
    moneyline: {
      home: parseAmerican(sourceObj.homeTeamOdds?.moneyLine ?? sourceObj.moneyline?.home ?? sourceObj.homeTeamOdds?.moneyLine?.value),
      away: parseAmerican(sourceObj.awayTeamOdds?.moneyLine ?? sourceObj.moneyline?.away ?? sourceObj.awayTeamOdds?.moneyLine?.value),
      draw: parseAmerican(sourceObj.drawOdds?.moneyLine ?? sourceObj.moneyline?.draw)
    },
    spread: {
      home: homeLine,
      away: awayLine,
      home_price: parseAmerican(sourceObj.homeTeamOdds?.spreadOdds ?? sourceObj.homeTeamOdds?.pointSpread?.american),
      away_price: parseAmerican(sourceObj.awayTeamOdds?.spreadOdds ?? sourceObj.awayTeamOdds?.pointSpread?.american)
    },
    total: {
      points: parseLine(sourceObj.overUnder ?? sourceObj.total?.points ?? sourceObj.total?.value),
      over_price: parseAmerican(sourceObj.overOdds ?? sourceObj.over?.american ?? sourceObj.total?.over?.american),
      under_price: parseAmerican(sourceObj.underOdds ?? sourceObj.under?.american ?? sourceObj.total?.under?.american)
    }
  };
}

const safeExtract = (name: string, fn: () => any) => {
  try { return fn() ?? null; } catch (e: any) { 
    Logger.warn(`Extraction Failed: ${name}`, { error: e.message || String(e) });
    return null; 
  }
};

const getCompetitorName = (c: any) => c?.team?.displayName || c?.athlete?.displayName || 'Unknown';

// ==========================================
// 3. TELEMETRY & NETWORK (REQUEST SCOPED)
// ==========================================

async function fetchWithTelemetry(url: string, telemetryState: TelemetryState, endpointKey: keyof TelemetryState, retries = 2) {
  telemetryState[endpointKey].req++;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) { telemetryState[endpointKey].ok++; return res; }
      
      // Fast fail on missing resources to prevent wasteful backoff
      if (res.status === 404) break; 
      
      if (res.status === 429) {
        telemetryState[endpointKey].rate_limit++;
        await new Promise(r => setTimeout(r, parseInt(res.headers.get('retry-after') || '2') * 1000));
        continue;
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break; 
    } catch (e: any) {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') continue;
    }
    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
  telemetryState[endpointKey].fail++;
  return null;
}

// Optimistic Concurrency Control (OCC) ensures exclusive lock acquisition across containers
async function acquireLock(supabase: any, matchId: string): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60000).toISOString(); 
  
  try {
    const { error } = await supabase.from('ingestion_locks').insert({ id: matchId, expires_at: expiresAt });
    if (!error) return true;
    
    // STRICT FAIL-CLOSED: Missing lock table breaks global integrity. Refuse to proceed.
    if (error.code === '42P01') {
      Logger.error('FATAL: ingestion_locks table is missing. Failing closed to guarantee cross-instance integrity.', { match_id: matchId });
      return false; 
    }
    
    if (error.code === '23505') { 
      // Compare-and-Swap: Reclaim only if lock actively expired
      const { data } = await supabase.from('ingestion_locks')
        .update({ expires_at: expiresAt })
        .eq('id', matchId)
        .lt('expires_at', now.toISOString())
        .select('id');
      return !!(data && data.length > 0); 
    }
    return false;
  } catch (e: any) { 
    Logger.error('Lock Acquisition Network Failure, failing closed', { match_id: matchId, error: e.message });
    return false; // Fail CLOSED on network errors to preserve data integrity
  }
}

// ==========================================
// 4. ORCHESTRATOR
// ==========================================

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const reqUrl = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  
  // Strict Comma-Separated Target Parsing
  const targetIdsRaw = body?.target_match_id ?? reqUrl.searchParams.get('target_match_id');
  const targetIds = targetIdsRaw
    ? (Array.isArray(targetIdsRaw)
        ? targetIdsRaw.flatMap((v: any) => String(v).split(','))
        : String(targetIdsRaw).split(','))
        .map(s => s.trim())
        .filter(Boolean)
    : [];
  
  const maxTotal = parseInt(body?.max_games_total ?? reqUrl.searchParams.get('max_games_total'), 10) || null;
  const maxPerLeague = parseInt(body?.max_games_per_league ?? reqUrl.searchParams.get('max_games_per_league'), 10) || null;
  
  const Telemetry: TelemetryState = {
    summary: { req: 0, ok: 0, fail: 0, rate_limit: 0 },
    core_odds: { req: 0, ok: 0, fail: 0, rate_limit: 0 },
    bpi: { req: 0, ok: 0, fail: 0, rate_limit: 0 },
    pbp: { req: 0, ok: 0, fail: 0, rate_limit: 0 },
    enrichment: { req: 0, ok: 0, fail: 0, rate_limit: 0 }
  };

  const stats = { 
    version: VERSION, 
    attempted: 0, 
    core_persisted: 0, 
    atomic_core_persisted: 0,
    degraded_fallback_writes: 0, 
    processed: 0, 
    locks_prevented: 0, 
    errors: [] as string[], 
    telemetry: Telemetry 
  };
  
  const startedAt = Date.now();
  let globalEnqueued = 0;

  try { getSupabaseClient(); } catch (e: any) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders }); }

  for (const league of MONITOR_LEAGUES) {
    if (maxTotal && globalEnqueued >= maxTotal) break;
    
    try {
      const dateParam = body?.dates ?? reqUrl.searchParams.get('dates') ?? new Date().toISOString().split('T')[0].replace(/-/g, '');
      const groupsParam = league.groups ? `&groups=${league.groups}` : '';
      const res = await fetchWithTelemetry(`${SCOREBOARD_BASE}/${league.endpoint}/scoreboard?dates=${dateParam}${groupsParam}`, Telemetry, 'summary');
      if (!res) continue;
      
      let events = (await res.json())?.events || [];
      if (league.db_sport === 'tennis') {
        events = events.flatMap((t: any) => (t.groupings || []).flatMap((g: any) => (g.competitions || []).map((c: any) => ({ ...t, id: c.id, date: c.date, status: c.status, competitions: [c] }))));
      }

      // Restored Dual-Target Filtering (ESPN Event ID + Canonical DB ID)
      let validEvents = events.filter((e: any) => {
        if (targetIds.length > 0) {
          const derivedId = getCanonicalMatchId(String(e.id), league.id);
          if (!targetIds.includes(String(e.id)) && !targetIds.includes(derivedId)) return false;
        }
        const state = e.status?.type?.state;
        return ['pre', 'in', 'post'].includes(state);
      });

      let remainingAllowed = validEvents.length;
      if (maxPerLeague !== null) remainingAllowed = Math.min(remainingAllowed, maxPerLeague);
      if (maxTotal !== null) remainingAllowed = Math.min(remainingAllowed, maxTotal - globalEnqueued);
      
      if (remainingAllowed <= 0) continue;
      validEvents = validEvents.slice(0, remainingAllowed);

      const batchPromises = [];
      for (const event of validEvents) {
        globalEnqueued++;
        stats.attempted++;
        batchPromises.push(processGame(event, league, stats, Telemetry));
        
        if (batchPromises.length >= 5) {
          await Promise.allSettled(batchPromises);
          batchPromises.length = 0;
        }
      }
      if (batchPromises.length > 0) await Promise.allSettled(batchPromises);

    } catch (e: any) { stats.errors.push(`League ${league.id}: ${e.message}`); }
  }

  return new Response(JSON.stringify({ 
    ...stats, 
    degraded_fallback_used: stats.degraded_fallback_writes > 0,
    elapsed_ms: Date.now() - startedAt 
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

// ==========================================
// 5. CORE GAME PROCESSING (ATOMIC PIPELINE)
// ==========================================

async function processGame(event: any, league: LeagueConfig, stats: any, telemetry: TelemetryState) {
  const matchId = String(event.id);
  const supabase = getSupabaseClient();
  
  // 1. DUAL IDENTITY: DB Event ID vs Canonical Target ID
  const dbMatchId = getCanonicalMatchId(matchId, league.id);
  const compHeader = event.competitions?.[0];
  const homeName = getCompetitorName(compHeader?.competitors?.find((c: any) => c.homeAway === 'home'));
  const awayName = getCompetitorName(compHeader?.competitors?.find((c: any) => c.homeAway === 'away'));

  let canonicalId = await resolveCanonicalMatch(supabase, homeName, awayName, event.date, league.id).catch(() => null);
  if (!canonicalId) canonicalId = generateDeterministicId(homeName, awayName, event.date, league.id);

  // 2. Lock Acquisition
  const hasLock = await acquireLock(supabase, dbMatchId);
  if (!hasLock) { stats.locks_prevented++; return; }

  try {
    // 3. Summary Fetch with Extended Depth Fallback Loops
    let summaryRes = null;
    let data = null;
    for (const base of SUMMARY_BASES) {
      const urls = [
        `${base}/${league.endpoint}/summary?event=${matchId}`,
        `${base}/${league.endpoint}/summary?event=${matchId}&region=us&lang=en&contentorigin=espn`
      ];
      for (const url of urls) {
        summaryRes = await fetchWithTelemetry(url, telemetry, 'summary');
        if (summaryRes) {
          data = await summaryRes.json();
          break;
        }
      }
      if (data) break;
    }
    
    if (!data) throw new Error("Summary API failed on all fallbacks");
    const comp = data.header?.competitions?.[0];
    if (!comp) return;

    const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
    const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
    let homeScore = parseInt(home?.score, 10) || 0;
    let awayScore = parseInt(away?.score, 10) || 0;
    const currentStatus = comp.status?.type?.name || 'SCHEDULED';
    const currentPeriod = comp.status?.period || 0;
    const isNowLive = ['IN_PROGRESS', 'HALFTIME', 'LIVE', 'STATUS_IN_PROGRESS'].some(s => currentStatus.toUpperCase().includes(s));

    const { error: canonicalErr } = await supabase.from('canonical_games').upsert({
      id: canonicalId, league_id: league.id, sport: league.db_sport,
      home_team_name: homeName, away_team_name: awayName,
      commence_time: event.date, status: currentStatus
    });
    if (canonicalErr) Logger.warn("Canonical game upsert failed", { matchId: dbMatchId, error: canonicalErr.message });

    const { data: existingMatch } = await supabase.from('matches').select('home_score, away_score, period, status, opening_odds, closing_odds, is_closing_locked, current_odds').eq('id', dbMatchId).maybeSingle();
    
    if (existingMatch) {
      if (homeScore < existingMatch.home_score) homeScore = existingMatch.home_score;
      if (awayScore < existingMatch.away_score) awayScore = existingMatch.away_score;
      
      if (currentPeriod < (existingMatch.period || 0)) throw new Error(`Period regression blocked (${existingMatch.period} -> ${currentPeriod})`);
      const wasFinal = ['FINAL', 'STATUS_FINAL', 'POST'].includes((existingMatch.status || '').toUpperCase());
      const isNowScheduledOrLive = ['SCHEDULED', 'PRE_GAME', 'IN_PROGRESS', 'HALFTIME'].includes(currentStatus.toUpperCase());
      if (wasFinal && isNowScheduledOrLive) throw new Error("Status regression blocked (FINAL -> LIVE/PRE)");
    }

    let liveOdds: NormalizedOdds | null = null;
    let pregameOdds: NormalizedOdds | null = null;
    let rawLiveSource: any = null;

    if (league.db_sport !== 'soccer') {
      const espnLeagueId = String(league.endpoint || '').split('/')[1];
      if (espnLeagueId) {
        const coreRes = await fetchWithTelemetry(`https://sports.core.api.espn.com/v2/sports/${league.espn_sport}/leagues/${espnLeagueId}/events/${matchId}/competitions/${matchId}/odds`, telemetry, 'core_odds');
        if (coreRes) {
          const coreItems = (await coreRes.json())?.items || [];
          const liveProv = coreItems.find((p: any) => String(p?.provider?.id) === '200') || coreItems.find((p: any) => String(p?.provider?.id) === '100');
          const preProv = coreItems.find((p: any) => String(p?.provider?.id) === '100');
          if (liveProv?.current) { liveOdds = normalizeOdds(liveProv.current, liveProv.provider?.name || 'DK Live', liveProv.provider?.id, true, 'core_live'); rawLiveSource = liveProv.current; }
          if (preProv?.open) pregameOdds = normalizeOdds(preProv.open, preProv.provider?.name || 'DK Pregame', preProv.provider?.id, false, 'core_pregame');
        }
      }
    }

    if (!liveOdds) {
      const summaryOdds = comp.odds?.find((o: any) => o.current) || data.pickcenter?.find((o: any) => o.current);
      if (summaryOdds) { liveOdds = normalizeOdds(summaryOdds, summaryOdds.provider?.name || 'ESPN', summaryOdds.provider?.id, isNowLive, 'summary_live'); rawLiveSource = summaryOdds; }
    }

    const dbCurrentOdds = isNormalizedOdds(existingMatch?.current_odds) ? existingMatch.current_odds : null;
    const dbOpeningOdds = isNormalizedOdds(existingMatch?.opening_odds) ? existingMatch.opening_odds : null;

    const effectiveOdds = liveOdds || pregameOdds || dbCurrentOdds;

    let closingLinesPayload = null;
    let isClosingLocked = existingMatch?.is_closing_locked || !!existingMatch?.closing_odds;
    const wasPregame = !existingMatch || ['SCHEDULED', 'PRE_GAME', 'STATUS_SCHEDULED'].some(s => (existingMatch.status || 'SCHEDULED').toUpperCase().includes(s));
    let finalStoredClosingOdds = isNormalizedOdds(existingMatch?.closing_odds) ? existingMatch.closing_odds : null;

    if (!isClosingLocked && isNowLive && wasPregame) {
      const lockTarget = pregameOdds || dbCurrentOdds || dbOpeningOdds;
      if (lockTarget && (lockTarget.spread?.home != null || lockTarget.moneyline?.home != null)) {
        isClosingLocked = true;
        finalStoredClosingOdds = lockTarget;
        closingLinesPayload = {
          match_id: dbMatchId, league_id: league.id,
          home_spread: lockTarget.spread.home, away_spread: lockTarget.spread.away, total: lockTarget.total?.points,
          home_ml: lockTarget.moneyline.home, away_ml: lockTarget.moneyline.away
        };
      }
    }

    const adapterSport = toAdapterSport(league.espn_sport);
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

    const matchPayload: any = {
      id: dbMatchId, league_id: league.id, sport: league.db_sport,
      status: currentStatus, period: currentPeriod, display_clock: comp.status?.displayClock,
      home_score: homeScore, away_score: awayScore, last_updated: new Date().toISOString(),
      current_odds: effectiveOdds,
      is_closing_locked: isClosingLocked,
      closing_odds: finalStoredClosingOdds,
      opening_odds: dbOpeningOdds || effectiveOdds
    };
    if (homeName !== 'Unknown') matchPayload.home_team = homeName;
    if (awayName !== 'Unknown') matchPayload.away_team = awayName;

    const aiSignals = computeAISignalsSafely(matchPayload, { matchId: dbMatchId, leagueId: league.id, mode: 'persist' }).value;

    const statePayload = {
      id: dbMatchId, league_id: league.id, sport: league.db_sport, game_status: currentStatus, canonical_id: canonicalId,
      period: currentPeriod, clock: comp.status?.displayClock, home_score: homeScore, away_score: awayScore,
      odds: { current: effectiveOdds }, deterministic_signals: aiSignals,
      situation: Object.keys(mergedSituation).length > 0 ? mergedSituation : null,
      last_play: extractedLastPlay, current_drive: extractedDrive, recent_plays: extractedRecentPlays,
      stats: extractedStats, player_stats: extractedPlayerStats, leaders: extractedLeaders,
      momentum: extractedMomentum, advanced_metrics: extractedAdvancedMetrics, match_context: extractedContext, predictor: extractedPredictor,
      updated_at: new Date().toISOString()
    };

    const atomicPayload = { p_match_payload: matchPayload, p_state_payload: statePayload, p_closing_payload: closingLinesPayload };

    // --- 7. DEGRADED FALLBACK BOUNDARY ---
    let transactionSuccess = false;
    let usedDegradedFallback = false;

    const { error: rpcErr } = await supabase.rpc('upsert_game_state_atomic', atomicPayload);
    
    if (rpcErr) {
      usedDegradedFallback = true;
      stats.degraded_fallback_writes++;
      
      if (rpcErr.code !== '42883' && rpcErr.code !== '42P01') {
        Logger.warn("[SUPPORTED DEGRADED MODE] RPC atomic write failed. Falling back to non-atomic sequential writes. Risk of split-brain state.", { error: rpcErr.message });
      } else {
        Logger.warn("[SUPPORTED DEGRADED MODE] RPC missing. Falling back to non-atomic sequential writes. Please deploy upsert_game_state_atomic.");
      }
      
      const { error: matchErr } = await supabase.from('matches').upsert(matchPayload);
      if (matchErr) throw new Error(`Primary match write failed: ${matchErr.message}`);
      
      const { error: stateErr } = await supabase.from('live_game_state').upsert(statePayload);
      if (stateErr) throw new Error(`Live state write failed: ${stateErr.message}`);

      if (closingLinesPayload) {
        await supabase.from('closing_lines').upsert(closingLinesPayload, { onConflict: 'match_id' }).catch(()=>{});
      }
      transactionSuccess = true;
    } else {
      stats.atomic_core_persisted++;
      transactionSuccess = true;
    }

    if (transactionSuccess) {
      stats.core_persisted++;

      if (effectiveOdds) {
        try {
          await writeCurrentOdds({ 
            supabase, 
            matchId: dbMatchId, 
            rawOdds: rawLiveSource || effectiveOdds,
            provider: effectiveOdds.provider || 'ESPN', 
            isLive: isNowLive, 
            updatedAt: new Date().toISOString() 
          });
        } catch (e: any) { Logger.warn("writeCurrentOdds failed", { error: e.message }); }
      }

      // 8. EVENTUAL CONSISTENCY BACKGROUND DELEGATIONS
      const promises = [];
      
      if (effectiveOdds) {
        promises.push(supabase.from('game_events').upsert({
          match_id: dbMatchId, league_id: league.id, sport: league.db_sport, event_type: 'odds_snapshot', sequence: getSafeSequenceId(),
          period: currentPeriod, clock: comp.status?.displayClock, home_score: homeScore, away_score: awayScore,
          odds_live: effectiveOdds, source: 'strict_normalization'
        }, { onConflict: 'match_id,event_type,sequence' }));
      }

      if (_contextSnapshotAvailable) {
        const csPayload = {
          ...statePayload, match_id: dbMatchId, captured_at: new Date().toISOString(), odds_current: effectiveOdds || null,
          odds_total: effectiveOdds?.total?.points ?? null, odds_home_ml: effectiveOdds?.moneyline?.home ?? null, odds_away_ml: effectiveOdds?.moneyline?.away ?? null
        };
        delete (csPayload as any).id;
        promises.push((async () => {
          const { error: csErr } = await supabase.from('live_context_snapshots').insert(csPayload);
          if (csErr?.message?.includes('does not exist')) _contextSnapshotAvailable = false;
        })());
      }

      if (data.plays && data.plays.length > 0) {
        promises.push(ingestPlayByPlay(supabase, league, dbMatchId, data.plays, currentPeriod, homeScore, awayScore, telemetry));
      }
      
      if (league.db_sport !== 'soccer') {
        promises.push(ingestBPI(supabase, league, matchId, dbMatchId, currentPeriod, comp.status?.displayClock, homeScore, awayScore, effectiveOdds, telemetry));
        promises.push(ingestCoreAPIEnrichment(supabase, league, matchId, dbMatchId, canonicalId, home?.id, away?.id, currentPeriod, comp.status?.displayClock, homeScore, awayScore, mergedSituation, extractedAdvancedMetrics, effectiveOdds, telemetry));
      }

      await Promise.allSettled(promises);
      
      stats.processed++;
    }

  } catch (e: any) {
    stats.errors.push(`${dbMatchId}: ${e.message}`);
  } finally {
    await supabase.from('ingestion_locks').delete().eq('id', dbMatchId).catch(() => {});
  }
}

// ==========================================
// 8. SUBROUTINES
// ==========================================

async function ingestPlayByPlay(supabase: any, league: LeagueConfig, dbMatchId: string, plays: any[], currentPeriod: number, homeScore: number, awayScore: number, telemetry: TelemetryState) {
  if (!Array.isArray(plays) || plays.length === 0) return;
  telemetry.pbp.req++;
  try {
    const playRows = plays.filter((p: any) => p?.text).map((p: any, index: number) => {
      let seq = parseInt(p.sequenceNumber, 10);
      if (isNaN(seq) || seq > 2147483647 || seq < -2147483648) {
        seq = parseInt(String(p.id).replace(/\D/g, '').slice(-8), 10);
        if (isNaN(seq)) seq = getSafeSequenceId() + index;
      }

      return {
        match_id: dbMatchId, league_id: league.id, sport: league.db_sport, event_type: 'play', sequence: seq,
        period: p.period?.number ?? currentPeriod, clock: p.clock?.displayValue,
        home_score: parseInt(p.homeScore, 10) || homeScore, away_score: parseInt(p.awayScore, 10) || awayScore,
        play_data: { id: p.id, text: p.text, type: p.type?.text, scoringPlay: !!p.scoringPlay, down: p.start?.down ?? p.down, distance: p.start?.distance ?? p.distance },
        source: 'espn'
      };
    });

    for (let i = 0; i < playRows.length; i += 200) {
      await supabase.from('game_events').upsert(playRows.slice(i, i + 200), { onConflict: 'match_id,event_type,sequence' });
    }
    telemetry.pbp.ok++;
  } catch (e: any) {
    telemetry.pbp.fail++;
    Logger.warn('PBP_WRITE_ERROR', { match_id: dbMatchId, error: e.message });
  }
}

async function ingestBPI(supabase: any, league: LeagueConfig, matchId: string, dbMatchId: string, period: number, clock: string, homeScore: number, awayScore: number, effectiveOdds: any, telemetry: TelemetryState) {
  const espnLeagueId = String(league.endpoint || '').split('/')[1];
  if (!espnLeagueId) return;

  try {
    const probUrl = `https://sports.core.api.espn.com/v2/sports/${league.espn_sport}/leagues/${espnLeagueId}/events/${matchId}/competitions/${matchId}/probabilities?limit=5`;
    const predUrl = `https://sports.core.api.espn.com/v2/sports/${league.espn_sport}/leagues/${espnLeagueId}/events/${matchId}/competitions/${matchId}/predictor`;
    
    const [probRes, predRes] = await Promise.all([
      fetchWithTelemetry(probUrl, telemetry, 'bpi'),
      fetchWithTelemetry(predUrl, telemetry, 'bpi')
    ]);

    let predictorData: any = null;
    if (predRes) {
      try {
        const predJson = await predRes.json();
        const getStatValue = (team: any, name: string) => team?.statistics?.find?.((s: any) => s.name === name)?.value ?? null;
        predictorData = {
          homePredMov: getStatValue(predJson?.homeTeam, 'teampredmov'), homePredWinPct: getStatValue(predJson?.homeTeam, 'teampredwinpct'),
          awayPredWinPct: getStatValue(predJson?.awayTeam, 'teampredwinpct'), matchupQuality: getStatValue(predJson?.homeTeam, 'matchupquality'),
          lastUpdated: predJson?.lastModified ?? null
        };
      } catch {}
    }

    if (probRes) {
      const probData = await probRes.json();
      const totalPages = probData?.pageCount ?? 0;
      let latestItems = probData?.items ?? [];
      
      if (totalPages > 1) {
        const lastPageRes = await fetchWithTelemetry(`${probUrl}&page=${totalPages}`, telemetry, 'bpi');
        if (lastPageRes) latestItems = (await lastPageRes.json())?.items || latestItems;
      }

      const latest = latestItems.length > 0 ? latestItems[latestItems.length - 1] : null;
      if (latest && latest.homeWinPercentage != null) {
        
        let safeSeq = parseInt(latest.sequenceNumber, 10);
        if (isNaN(safeSeq) || safeSeq > 2147483647 || safeSeq < -2147483648) safeSeq = getSafeSequenceId();

        const bpiPayload: any = {
          match_id: dbMatchId, league_id: league.id, sport: league.db_sport, event_type: 'bpi_probability', sequence: safeSeq,
          period, clock, home_score: homeScore, away_score: awayScore,
          play_data: {
            homeWinPct: latest.homeWinPercentage, awayWinPct: latest.awayWinPercentage, tieWinPct: latest.tiePercentage ?? 0,
            sequenceNumber: latest.sequenceNumber, lastModified: latest.lastModified, totalProbabilityEntries: probData?.count ?? null,
            ...(predictorData ? { bpiPredictedMov: predictorData.homePredMov, bpiPregameWinPct: predictorData.homePredWinPct, bpiAwayPregameWinPct: predictorData.awayPredWinPct, matchupQuality: predictorData.matchupQuality, predictorLastUpdated: predictorData.lastUpdated } : {})
          },
          odds_live: effectiveOdds,
          source: 'espn_bpi'
        };

        await supabase.from('game_events').upsert(bpiPayload, { onConflict: 'match_id,event_type,sequence' });
      }
    }
  } catch { } 
}

async function ingestCoreAPIEnrichment(supabase: any, league: LeagueConfig, matchId: string, dbMatchId: string, canonicalId: string, homeId: string, awayId: string, period: number, clock: string, homeScore: number, awayScore: number, mergedSituation: any, extractedAdvancedMetrics: any, effectiveOdds: any, telemetry: TelemetryState) {
  const espnLeagueId = String(league.endpoint || '').split('/')[1];
  if (!espnLeagueId || !homeId || !awayId) return;

  try {
    const coreBase = `https://sports.core.api.espn.com/v2/sports/${league.espn_sport}/leagues/${espnLeagueId}/events/${matchId}/competitions/${matchId}`;

    const [homeStats, awayStats, homeLeaders, awayLeaders, homeRoster, awayRoster, situationJson, officialsJson, broadcastsJson, predictorJson] = await Promise.all([
      fetchWithTelemetry(`${coreBase}/competitors/${homeId}/statistics`, telemetry, 'enrichment').then(r => r?.json().catch(()=>null)),
      fetchWithTelemetry(`${coreBase}/competitors/${awayId}/statistics`, telemetry, 'enrichment').then(r => r?.json().catch(()=>null)),
      fetchWithTelemetry(`${coreBase}/competitors/${homeId}/leaders`, telemetry, 'enrichment').then(r => r?.json().catch(()=>null)),
      fetchWithTelemetry(`${coreBase}/competitors/${awayId}/leaders`, telemetry, 'enrichment').then(r => r?.json().catch(()=>null)),
      fetchWithTelemetry(`${coreBase}/competitors/${homeId}/roster`, telemetry, 'enrichment').then(r => r?.json().catch(()=>null)),
      fetchWithTelemetry(`${coreBase}/competitors/${awayId}/roster`, telemetry, 'enrichment').then(r => r?.json().catch(()=>null)),
      fetchWithTelemetry(`${coreBase}/situation`, telemetry, 'enrichment').then(r => r?.json().catch(()=>null)),
      fetchWithTelemetry(`${coreBase}/officials`, telemetry, 'enrichment').then(r => r?.json().catch(()=>null)),
      fetchWithTelemetry(`${coreBase}/broadcasts`, telemetry, 'enrichment').then(r => r?.json().catch(()=>null)),
      fetchWithTelemetry(`${coreBase}/predictor`, telemetry, 'enrichment').then(r => r?.json().catch(()=>null))
    ]);

    const extractStats = (json: any) => {
      if (!json) return null;
      const allStats: Record<string, number | null> = {};
      for (const cat of (json?.splits?.categories ?? [])) {
        for (const stat of (cat?.stats ?? [])) {
          if (stat?.name && stat?.value != null) allStats[stat.name] = stat.value;
        }
      }
      return Object.keys(allStats).length > 0 ? allStats : null;
    };

    const hs = extractStats(homeStats);
    const as = extractStats(awayStats);

    if (hs || as) {
      const boxPayload = {
        match_id: dbMatchId, league_id: league.id, sport: league.db_sport, event_type: 'box_snapshot', sequence: getSafeSequenceId(),
        period, clock, home_score: homeScore, away_score: awayScore,
        box_snapshot: { sport: league.db_sport, home: hs, away: as }, odds_live: effectiveOdds,
        source: 'core_api_stats'
      };
      await supabase.from('game_events').upsert(boxPayload, { onConflict: 'match_id,event_type,sequence' });
    }

    const enrichment: any = {};
    
    const parseLeaders = (json: any) => {
      if (!json) return null;
      const res: Record<string, any> = {};
      (json.leaders || []).forEach((cat: any) => {
        const p = cat?.leaders?.[0];
        if (p) res[cat.name || cat.displayName || 'unknown'] = { displayValue: p.displayValue, value: p.value, athleteRef: p.athlete?.$ref ?? null };
      });
      return Object.keys(res).length > 0 ? res : null;
    };
    
    const hl = parseLeaders(homeLeaders); const al = parseLeaders(awayLeaders);
    const parseRoster = (json: any) => json ? (json.entries || json.items || []).filter((e: any) => e?.playerId || e?.athlete).map((e: any) => ({ id: e.playerId ?? null, athleteRef: e.athlete?.$ref ?? null, statsRef: e.statistics?.$ref ?? null })).slice(0, 20) : null;
    const hr = parseRoster(homeRoster); const ar = parseRoster(awayRoster);

    const extra_data: any = {};
    if (hr || ar) extra_data.roster = { home: hr, away: ar };
    if (hl || al) extra_data.core_api_leaders = { home: hl, away: al };
    if (officialsJson?.items) extra_data.officials = officialsJson.items.map((o: any) => ({ id: o.id ?? null, name: o.fullName ?? o.displayName ?? null, position: o.position?.name ?? null, order: o.order ?? null }));
    if (broadcastsJson?.items) extra_data.broadcasts = broadcastsJson.items.map((b: any) => ({ station: b.station ?? null, type: b.type?.shortName ?? null, market: b.market?.type ?? null }));

    if (predictorJson) {
      const extractPredStats = (stats: any[]) => {
        const res: Record<string, any> = {};
        for (const s of (stats || [])) { if (s?.name && s?.displayValue != null) res[s.name] = s.displayValue; }
        return Object.keys(res).length > 0 ? res : null;
      };
      const pd = {
        home: extractPredStats(predictorJson?.homeTeam?.statistics ?? predictorJson?.homeTeam?.team?.statistics),
        away: extractPredStats(predictorJson?.awayTeam?.statistics ?? predictorJson?.awayTeam?.team?.statistics),
        name: predictorJson?.name ?? null, lastModified: predictorJson?.lastModified ?? null
      };
      if (pd.home || pd.away) extra_data.powerindex = pd;
    }

    if (Object.keys(extra_data).length > 0) {
      extra_data.captured_at = new Date().toISOString();
      enrichment.extra_data = extra_data;
    }

    if (situationJson) {
      enrichment.situation = {
        ...(typeof mergedSituation === 'object' && mergedSituation ? mergedSituation : {}),
        homeTimeouts: situationJson?.homeTimeouts?.timeoutsRemainingCurrent ?? null, awayTimeouts: situationJson?.awayTimeouts?.timeoutsRemainingCurrent ?? null,
        homeFouls: situationJson?.homeFouls?.teamFoulsCurrent ?? null, awayFouls: situationJson?.awayFouls?.teamFoulsCurrent ?? null,
        homeFoulsToGive: situationJson?.homeFouls?.foulsToGive ?? null, awayFoulsToGive: situationJson?.awayFouls?.foulsToGive ?? null,
        homeBonusState: situationJson?.homeFouls?.bonusState ?? null, awayBonusState: situationJson?.awayFouls?.bonusState ?? null
      };
    }

    if (hs || as) {
      enrichment.advanced_metrics = {
        ...(typeof extractedAdvancedMetrics === 'object' && extractedAdvancedMetrics ? extractedAdvancedMetrics : {}),
        core_api_efficiency: {
          home: hs ? { ppep: hs.pointsPerEstimatedPossessions, pace: hs.estimatedPossessions, shootingEff: hs.shootingEfficiency, offRebPct: hs.offensiveReboundPct, astToRatio: hs.assistTurnoverRatio } : null,
          away: as ? { ppep: as.pointsPerEstimatedPossessions, pace: as.estimatedPossessions, shootingEff: as.shootingEfficiency, offRebPct: as.offensiveReboundPct, astToRatio: as.assistTurnoverRatio } : null
        }
      };
    }

    if (Object.keys(enrichment).length > 0) {
      await supabase.from('live_game_state').update(enrichment).eq('id', dbMatchId);
    }
  } catch { } // Non-fatal background enrichment
}

function computeAISignalsSafely(matchPayload: any, context: { matchId: string; leagueId: string; mode: 'dry' | 'persist' }) {
  try { return { value: computeAISignals(matchPayload), error: null }; }
  catch (e: any) { return { value: null, error: e.message || String(e) }; }
}
