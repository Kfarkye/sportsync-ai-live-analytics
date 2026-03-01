declare const Deno: any;

import { createClient } from 'npm:@supabase/supabase-js@2'
import { computeAISignals } from '../_shared/gameStateEngine.ts'
import { EspnAdapters, Safe } from '../_shared/espnAdapters.ts'
import { getCanonicalMatchId, generateDeterministicId, resolveCanonicalMatch } from '../_shared/match-registry.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

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

// Extraction Wrapper to prevent a single bad metric from tanking the whole game payload
const safeExtract = (name: string, fn: () => any) => {
  try { return fn() || null; }
  catch (e: any) {
    Logger.error(`Extraction Failed: ${name}`, { error: e.message || String(e) });
    return null;
  }
};

// Safe DB Type Converters
function parseAmerican(val: any): number | null {
  if (val === null || val === undefined) return null;
  const strVal = String(val).trim().toLowerCase();
  if (strVal === 'ev' || strVal === 'even') return 100;
  const num = parseInt(strVal.replace('+', ''), 10);
  return isNaN(num) ? null : num;
}

function parseLine(val: any): number | null {
  if (val == null) return null;
  if (typeof val === 'string' && val.toLowerCase() === 'pk') return 0;
  const num = parseFloat(String(val));
  return isNaN(num) ? null : num;
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

const getCompetitorName = (c: any) => c?.team?.displayName || c?.athlete?.displayName || 'Unknown';

/** Retry a Supabase upsert up to 3 times with exponential backoff. */
async function upsertWithRetry(table: string, payload: any, retries = 3) {
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

  const stats = { processed: 0, live: 0, errors: [] as string[], snapshots: 0 };
  const { target_match_id, dates } = await req.json().catch(() => ({}));

  for (const league of MONITOR_LEAGUES) {
    try {
      const dateParam = dates || new Date().toISOString().split('T')[0].replace(/-/g, '');
      const groupsParam = league.groups ? `&groups=${league.groups}` : '';
      const res = await fetchWithRetry(`${ESPN_BASE}/${league.endpoint}/scoreboard?dates=${dateParam}${groupsParam}`);
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
        // Safe robust check for string OR array targets
        if (target_match_id) {
          const targets = Array.isArray(target_match_id) ? target_match_id : [target_match_id];
          if (!targets.some((t: string) => t.includes(event.id))) continue;
        }

        const state = event.status?.type?.state;
        if (!['in', 'post'].includes(state)) {
          const mins = (new Date(event.date).getTime() - Date.now()) / 60000;
          if (mins > 75 || mins < -20) continue;
        }
        await processGame(event, league, stats);
      }
    } catch (e: any) {
      stats.errors.push(`${league.id}: ${e.message}`);
    }
  }
  return new Response(JSON.stringify(stats), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

async function processGame(event: any, league: any, stats: any) {
  const matchId = event.id;
  const dbMatchId = getCanonicalMatchId(matchId, league.id);

  try {
    const res = await fetchWithRetry(`${ESPN_BASE}/${league.endpoint}/summary?event=${matchId}`);
    const data = await res.json();
    const comp = data.header?.competitions?.[0];
    if (!comp) return;

    const home = comp.competitors.find((c: any) => c.homeAway === 'home');
    const away = comp.competitors.find((c: any) => c.homeAway === 'away');

    let homeScore = Safe.score(home?.score) ?? 0;
    let awayScore = Safe.score(away?.score) ?? 0;

    let manualSituationData: any = {};

    // TENNIS GAME COUNTING
    if (league.db_sport === 'tennis') {
      const hGames = (home?.linescores || []).reduce((a: number, b: any) => a + (parseInt(b.value) || 0), 0);
      const aGames = (away?.linescores || []).reduce((a: number, b: any) => a + (parseInt(b.value) || 0), 0);
      manualSituationData = { home_games_won: hGames, away_games_won: aGames };
    }

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

    let finalMarketOdds = EspnAdapters.Odds(comp, data.pickcenter) || {};
    if (premiumFeed && !premiumFeed.is_stale) {
      finalMarketOdds = {
        homeSpread: premiumFeed.spread?.home?.point,
        awaySpread: premiumFeed.spread?.away?.point,
        total: premiumFeed.total?.over?.point,
        homeWin: premiumFeed.h2h?.home?.price,
        awayWin: premiumFeed.h2h?.away?.price,
        isInstitutional: true,
        provider: "Institutional"
      };
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
    const matchPayload: any = {
      id: dbMatchId,
      league_id: league.id,
      sport: league.db_sport,
      status: comp.status?.type?.name,
      period: comp.status?.period,
      display_clock: comp.status?.displayClock,
      home_score: homeScore,
      away_score: awayScore,
      current_odds: finalMarketOdds,
      last_updated: new Date().toISOString(),
      opening_odds: existingMatch?.opening_odds || finalMarketOdds,
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
    const hasMarketOdds = finalMarketOdds?.homeSpread != null || finalMarketOdds?.homeWin != null;

    if (!isClosingLocked && isLiveGame && hasMarketOdds) {
      matchPayload.closing_odds = finalMarketOdds;
      matchPayload.is_closing_locked = true;

      const closingPayload = {
        match_id: dbMatchId,
        league_id: league.id,
        home_spread: parseLine(finalMarketOdds.homeSpread),
        away_spread: parseLine(finalMarketOdds.awaySpread),
        total: parseLine(finalMarketOdds.total),
        home_ml: parseAmerican(finalMarketOdds.homeWin), // 🚨 Ensures safe INTEGER cast
        away_ml: parseAmerican(finalMarketOdds.awayWin)  // 🚨 Ensures safe INTEGER cast
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
        t60_snapshot = { odds: finalMarketOdds, timestamp: new Date().toISOString() };
        stats.snapshots++;
        Logger.info("T-60 Captured", { dbMatchId });
      }
      if (inT0 && !currentOddsState.t0_snapshot) {
        t0_snapshot = { odds: finalMarketOdds, timestamp: new Date().toISOString() };
        stats.snapshots++;
        Logger.info("T-0 Captured", { dbMatchId });
      }
    }

    await upsertWithRetry('matches', matchPayload);
    const aiSignals = computeAISignals(matchPayload);

    // Context Retrieval using safeExtract
    const espnSituation = safeExtract('Situation', () => EspnAdapters.Situation(data)) || {};
    const mergedSituation = { ...espnSituation, ...manualSituationData };

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
      last_play: safeExtract('LastPlay', () => EspnAdapters.LastPlay(data)),
      current_drive: safeExtract('Drive', () => EspnAdapters.Drive(data)),
      recent_plays: safeExtract('RecentPlays', () => EspnAdapters.RecentPlays(data)),
      stats: safeExtract('Stats', () => EspnAdapters.Stats(data, league.espn_sport)),
      player_stats: safeExtract('PlayerStats', () => EspnAdapters.PlayerStats(data)),
      leaders: safeExtract('Leaders', () => EspnAdapters.Leaders(data)),
      momentum: safeExtract('Momentum', () => EspnAdapters.Momentum(data)),
      advanced_metrics: safeExtract('AdvancedMetrics', () => EspnAdapters.AdvancedMetrics(data)),
      match_context: safeExtract('Context', () => EspnAdapters.Context(data)),
      predictor: safeExtract('Predictor', () => EspnAdapters.Predictor(data)),

      deterministic_signals: aiSignals,
      odds: {
        current: matchPayload.current_odds,
        t60_snapshot: t60_snapshot || currentOddsState.t60_snapshot,
        t0_snapshot: t0_snapshot || currentOddsState.t0_snapshot
      },
      updated_at: new Date().toISOString()
    };

    await upsertWithRetry('live_game_state', statePayload);
    stats.processed++;
    stats.live++;
  } catch (e: any) {
    Logger.error('ProcessGame Failed', { matchId: dbMatchId, error: e.message || e });
  }
}
