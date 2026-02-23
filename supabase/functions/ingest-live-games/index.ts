declare const Deno: any;

import { createClient } from 'npm:@supabase/supabase-js@2'
import { computeAISignals } from '../_shared/gameStateEngine.ts'
import { EspnAdapters, Safe } from '../_shared/espnAdapters.ts'
import { Sport } from '../_shared/types.ts'
import { getCanonicalMatchId, LEAGUE_SUFFIX_MAP, generateDeterministicId, resolveCanonicalMatch } from '../_shared/match-registry.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const MONITOR_LEAGUES = [
  { id: 'nfl', sport_type: Sport.NFL, endpoint: 'football/nfl' },
  { id: 'nba', sport_type: Sport.NBA, endpoint: 'basketball/nba' },
  { id: 'mlb', sport_type: Sport.BASEBALL, endpoint: 'baseball/mlb' },
  { id: 'nhl', sport_type: Sport.HOCKEY, endpoint: 'hockey/nhl' },
  { id: 'ncaab', sport_type: Sport.COLLEGE_BASKETBALL, endpoint: 'basketball/mens-college-basketball' },
  { id: 'epl', sport_type: Sport.SOCCER, endpoint: 'soccer/eng.1' },
  { id: 'seriea', sport_type: Sport.SOCCER, endpoint: 'soccer/ita.1' },
  { id: 'bundesliga', sport_type: Sport.SOCCER, endpoint: 'soccer/ger.1' },
  { id: 'worldcup', sport_type: Sport.SOCCER, endpoint: 'soccer/fifa.world' },
  { id: 'atp', sport_type: Sport.TENNIS, endpoint: 'tennis/atp' },
  { id: 'wta', sport_type: Sport.TENNIS, endpoint: 'tennis/wta' }
];

const Logger = {
  info: (msg: string, data: any) => console.log(JSON.stringify({ level: 'INFO', msg, ...data })),
  error: (msg: string, error: any) => console.error(JSON.stringify({ level: 'ERROR', msg, error: error.message }))
};

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
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { error } = await supabase.from(table).upsert(payload);
    if (!error) return;
    Logger.error(`DB_UPSERT_RETRY`, { table, attempt, maxRetries: retries, error: error.message } as any);
    if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    else throw new Error(`${table} upsert failed after ${retries} attempts: ${error.message}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  const stats = { processed: 0, live: 0, errors: [] as string[], snapshots: 0 };
  const { target_match_id, dates } = await req.json().catch(() => ({}));

  for (const league of MONITOR_LEAGUES) {
    try {
      const dateParam = dates || new Date().toISOString().split('T')[0].replace(/-/g, '');
      const res = await fetchWithRetry(`${ESPN_BASE}/${league.endpoint}/scoreboard?dates=${dateParam}`);
      const data = await res.json();
      let events = data.events || [];

      // FLATTEN TENNIS
      if (league.sport_type === Sport.TENNIS) {
        events = events.flatMap((t: any) =>
          (t.groupings || []).flatMap((g: any) =>
            (g.competitions || []).map((c: any) => ({
              ...t, id: c.id, date: c.date, status: c.status, competitions: [c]
            }))
          )
        );
      }

      for (const event of events) {
        if (target_match_id && !target_match_id.includes(event.id)) continue;
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
  return new Response(JSON.stringify(stats), { headers: { 'Content-Type': 'application/json' } });
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

    let homeScore = Safe.score(home?.score);
    let awayScore = Safe.score(away?.score);
    let extraData: any = {};

    // TENNIS GAME COUNTING
    if (league.sport_type === Sport.TENNIS) {
      const hGames = (home?.linescores || []).reduce((a: number, b: any) => a + (parseInt(b.value) || 0), 0);
      const aGames = (away?.linescores || []).reduce((a: number, b: any) => a + (parseInt(b.value) || 0), 0);
      extraData = { home_games_won: hGames, away_games_won: aGames };
    }

    let canonicalId = await resolveCanonicalMatch(supabase, getCompetitorName(home), getCompetitorName(away), event.date, league.id);
    if (!canonicalId) canonicalId = generateDeterministicId(getCompetitorName(home), getCompetitorName(away), event.date, league.id);

    await upsertWithRetry('canonical_games', {
      id: canonicalId, league_id: league.id, sport: league.sport_type,
      home_team_name: getCompetitorName(home), away_team_name: getCompetitorName(away),
      commence_time: event.date, status: comp.status?.type?.name
    });

    // SRE: AUTHORITY MERGE
    const { data: existingMatch } = await supabase.from('matches').select('home_score, away_score, current_odds, opening_odds, is_closing_locked').eq('id', dbMatchId).maybeSingle();
    const { data: premiumFeed } = await supabase.rpc('resolve_market_feed', { p_match_id: matchId, p_canonical_id: canonicalId });

    let finalMarketOdds = EspnAdapters.Odds(comp, data.pickcenter);
    if (premiumFeed && !premiumFeed.is_stale) {
      finalMarketOdds = {
        homeSpread: premiumFeed.spread?.home?.point,
        awaySpread: premiumFeed.spread?.away?.point,
        total: premiumFeed.total?.over?.point,
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

    const match: any = {
      id: dbMatchId, canonical_id: canonicalId, league_id: league.id, sport: league.sport_type,
      status: comp.status?.type?.name, home_team: getCompetitorName(home), away_team: getCompetitorName(away),
      home_score: homeScore, away_score: awayScore, extra_data: extraData,
      current_odds: finalMarketOdds, last_updated: new Date().toISOString()
    };

    match.opening_odds = existingMatch?.opening_odds || match.current_odds;

    // CLOSING LINE LOGIC
    let isClosingLocked = existingMatch?.is_closing_locked || false;
    const isLiveGame = ['LIVE', 'IN_PROGRESS', 'HALFTIME', 'STATUS_IN_PROGRESS'].some(k => match.status?.toUpperCase().includes(k));

    if (!isClosingLocked && isLiveGame && finalMarketOdds.homeSpread) {
      match.closing_odds = finalMarketOdds;
      isClosingLocked = true;
      await upsertWithRetry('closing_lines', { match_id: dbMatchId, league_id: league.id, ...finalMarketOdds });
    }
    match.is_closing_locked = isClosingLocked;

    // SNAPSHOTS (T-60 / T-0)
    const minsToStart = (new Date(event.date).getTime() - Date.now()) / 60000;
    const inT60 = minsToStart > 50 && minsToStart < 75;
    const inT0 = minsToStart > -10 && minsToStart < 15;
    let t60_snapshot, t0_snapshot;

    if ((inT60 || inT0) && finalMarketOdds.homeSpread) {
      const { data: s } = await supabase.from('live_game_state').select('t60_snapshot, t0_snapshot').eq('id', dbMatchId).maybeSingle();
      if (inT60 && !s?.t60_snapshot) {
        t60_snapshot = { odds: finalMarketOdds, timestamp: new Date().toISOString() };
        stats.snapshots++;
        Logger.info("T-60 Captured", { dbMatchId });
      }
      if (inT0 && !s?.t0_snapshot) {
        t0_snapshot = { odds: finalMarketOdds, timestamp: new Date().toISOString() };
        stats.snapshots++;
        Logger.info("T-0 Captured", { dbMatchId });
      }
    }

    await upsertWithRetry('matches', match);
    const aiSignals = computeAISignals(match);

    const statePayload: any = {
      id: dbMatchId, home_score: homeScore, away_score: awayScore, extra_data: extraData,
      deterministic_signals: aiSignals, odds: { current: match.current_odds }, updated_at: new Date().toISOString()
    };
    if (t60_snapshot) statePayload.t60_snapshot = t60_snapshot;
    if (t0_snapshot) statePayload.t0_snapshot = t0_snapshot;

    await upsertWithRetry('live_game_state', statePayload);
    stats.processed++;
    stats.live++;
  } catch (e: any) {
    supabase.from('matches').update({ last_ingest_error: e.message }).eq('id', dbMatchId);
  }
}
