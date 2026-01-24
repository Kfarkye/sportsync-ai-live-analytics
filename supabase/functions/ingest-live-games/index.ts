// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

import { createClient } from 'npm:@supabase/supabase-js@2'
import { computeAISignals } from '../_shared/gameStateEngine.ts'
import { EspnAdapters, Safe } from '../_shared/espnAdapters.ts'
import { Sport } from '../_shared/types.ts'
import {
  getCanonicalMatchId,
  LEAGUE_SUFFIX_MAP,
  generateDeterministicId,
  resolveCanonicalMatch,
  resolveCanonicalVenue,
  resolveCanonicalOfficial
} from '../_shared/match-registry.ts'

// --- SRE Configuration & Constants ---
const SERVICE_NAME = 'ingest-service-v1.9.3-surgical';
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const CONCURRENCY_LIMIT = 5;

// Env Validation
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(JSON.stringify({ level: 'CRITICAL', msg: 'Missing Supabase Configuration', service: SERVICE_NAME }));
  Deno.exit(1);
}

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'public' }
});

const MONITOR_LEAGUES = [
  { id: 'nfl', sport_type: Sport.NFL, endpoint: 'football/nfl' },
  { id: 'college-football', sport_type: Sport.COLLEGE_FOOTBALL, endpoint: 'football/college-football' },
  { id: 'nba', sport_type: Sport.NBA, endpoint: 'basketball/nba' },
  { id: 'mens-college-basketball', sport_type: Sport.COLLEGE_BASKETBALL, endpoint: 'basketball/mens-college-basketball' },
  { id: 'mlb', sport_type: Sport.BASEBALL, endpoint: 'baseball/mlb' },
  { id: 'nhl', sport_type: Sport.HOCKEY, endpoint: 'hockey/nhl' },
  { id: 'wnba', sport_type: Sport.WNBA, endpoint: 'basketball/wnba' },
  { id: 'eng.1', sport_type: Sport.SOCCER, endpoint: 'soccer/eng.1' },
  { id: 'esp.1', sport_type: Sport.SOCCER, endpoint: 'soccer/esp.1' },
  { id: 'usa.1', sport_type: Sport.SOCCER, endpoint: 'soccer/usa.1' },
  { id: 'mex.1', sport_type: Sport.SOCCER, endpoint: 'soccer/mex.1' },
  { id: 'ger.1', sport_type: Sport.SOCCER, endpoint: 'soccer/ger.1' },
  { id: 'ita.1', sport_type: Sport.SOCCER, endpoint: 'soccer/ita.1' },
  { id: 'fra.1', sport_type: Sport.SOCCER, endpoint: 'soccer/fra.1' },
  { id: 'uefa.champions', sport_type: Sport.SOCCER, endpoint: 'soccer/uefa.champions' },
  { id: 'uefa.europa', sport_type: Sport.SOCCER, endpoint: 'soccer/uefa.europa' },
  { id: 'caf.nations', sport_type: Sport.SOCCER, endpoint: 'soccer/caf.nations' },
  { id: 'atp', sport_type: Sport.TENNIS, endpoint: 'tennis/atp' },
  { id: 'wta', sport_type: Sport.TENNIS, endpoint: 'tennis/wta' }
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const getCompetitorName = (comp: any): string => {
  if (!comp) return 'Unknown';
  const entity = comp.team || comp.athlete || {};
  return entity.displayName || entity.fullName || entity.name || 'Unknown';
};

// --- SRE Utilities ---
const Logger = {
  info: (msg: string, data: Record<string, any> = {}) => console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), msg, ...data })),
  warn: (msg: string, data: Record<string, any> = {}) => console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), msg, ...data })),
  error: (msg: string, error: any) => console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), msg, error: error.message || error })),
};

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  let attempt = 0;
  while (attempt < retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        return res;
      }
      return res;
    } catch (err: any) {
      clearTimeout(timeoutId);
      attempt++;
      const isLastAttempt = attempt === retries;
      const delay = Math.min(1000 * (2 ** attempt), 8000) + (Math.random() * 100);

      if (isLastAttempt) throw new Error(`Fetch failed after ${retries} attempts: ${err.message} (${url})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable code');
}

const REVERSE_LEAGUE_MAP: Record<string, string> = Object.entries(LEAGUE_SUFFIX_MAP).reduce((acc, [k, v]) => ({ ...acc, [v.replace('_', '')]: k }), {});

// --- Main Handler ---
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startTime = performance.now();
  const stats = { processed: 0, live: 0, plays: 0, snapshots: 0, errors: [] as string[], ai_triggers: 0 };

  try {
    const { target_match_id, dates: requestedDate } = await req.json().catch(() => ({}));
    let leaguesToScan = MONITOR_LEAGUES;

    if (target_match_id) {
      const suffix = target_match_id.includes('_') ? target_match_id.split('_').pop() : null;
      if (suffix && REVERSE_LEAGUE_MAP[suffix]) leaguesToScan = MONITOR_LEAGUES.filter(l => l.id === REVERSE_LEAGUE_MAP[suffix]);
    }

    for (const league of leaguesToScan) {
      try {
        // Build date query: if date provided use it, otherwise fetch today AND yesterday (PT timezone coverage)
        const today = new Date();
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const todayStr = requestedDate || today.toISOString().split('T')[0].replace(/-/g, '');
        const yesterdayStr = yesterday.toISOString().split('T')[0].replace(/-/g, '');
        const dateParam = requestedDate ? `dates=${requestedDate}` : `dates=${yesterdayStr}-${todayStr}`;
        const scoreboardUrl = `${ESPN_BASE_URL}/${league.endpoint}/scoreboard?${dateParam}&_t=${Date.now()}`;

        const res = await fetchWithRetry(scoreboardUrl);
        const data = await res.json();
        let events = data.events || [];

        if (league.sport_type === Sport.TENNIS) {
          events = events.flatMap((tournament: any) => (tournament.groupings || []).flatMap((group: any) => (group.competitions || []).map((comp: any) => ({ ...tournament, id: comp.id, date: comp.date || comp.startDate, status: comp.status, competitions: [comp] }))));
        }

        const eventsToProcess = events.filter((event: any) => {
          stats.processed++;
          if (target_match_id) return target_match_id.startsWith(event.id);

          const state = event.status?.type?.state;
          // LIVE + FINAL + PRE-GAME (Within 75 mins for T-60 snapshot)
          if (['in', 'post'].includes(state)) return true;
          const minsToStart = (new Date(event.date).getTime() - Date.now()) / 60000;
          return state === 'pre' && minsToStart < 75 && minsToStart > -20;
        });

        const chunks = [];
        for (let i = 0; i < eventsToProcess.length; i += CONCURRENCY_LIMIT) chunks.push(eventsToProcess.slice(i, i + CONCURRENCY_LIMIT));

        for (const chunk of chunks) {
          await Promise.allSettled(chunk.map((event: any) => {
            stats.live++;
            return processLiveGame(event, league, stats);
          }));
        }
      } catch (err: any) {
        stats.errors.push(`${league.id}: ${err.message}`);
      }
    }

    const duration = performance.now() - startTime;
    return new Response(JSON.stringify({ ...stats, duration_ms: duration }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message, fatal: true }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function processLiveGame(event: any, league: any, stats: any) {
  const matchId = event.id;
  const dbMatchId = getCanonicalMatchId(matchId, league.id);
  const trace: string[] = [];

  try {
    const res = await fetchWithRetry(`${ESPN_BASE_URL}/${league.endpoint}/summary?event=${matchId}&_t=${Date.now()}`);
    const data = await res.json();
    const header = data.header || {};
    const competition = header.competitions?.[0];
    if (!competition) return;

    const homeComp = competition.competitors.find((c: any) => c.homeAway === 'home');
    const awayComp = competition.competitors.find((c: any) => c.homeAway === 'away');
    const pickcenter = data.pickcenter;

    const currentOdds = EspnAdapters.Odds(competition, pickcenter);
    let openingOdds = data.header?.competitions?.[0]?.odds?.[1] || data.header?.competitions?.[0]?.odds?.[0] || {};
    if ((!openingOdds.overUnder && !openingOdds.spread) && (currentOdds.overUnder || currentOdds.spread)) openingOdds = currentOdds;

    // --- Knowledge Graph Resolution (Preserved) ---
    let canonicalId = await resolveCanonicalMatch(supabase, getCompetitorName(homeComp), getCompetitorName(awayComp), event.date, league.id);

    // Audit Log: Time Drift (SRE Check)
    if (canonicalId) {
      const { data: existingEntity } = await supabase.from('canonical_games').select('commence_time').eq('id', canonicalId).single();
      if (existingEntity) {
        const drift = Math.abs(new Date(existingEntity.commence_time).getTime() - new Date(event.date).getTime());
        if (drift > 1000 * 60 * 15) {
          supabase.from('canonical_property_log').insert({ canonical_id: canonicalId, property_name: 'commence_time', old_value: existingEntity.commence_time, new_value: event.date, provider: 'ESPN' }).then();
        }
      }
    } else {
      canonicalId = generateDeterministicId(getCompetitorName(homeComp), getCompetitorName(awayComp), event.date, league.id);
    }

    // Venue & Officials (Preserved)
    const venueData = competition.venue;
    const [canonicalVenueId, canonicalOfficialIds] = await Promise.all([
      resolveCanonicalVenue(supabase, venueData?.fullName, venueData?.address?.city),
      Promise.all((competition.officials || []).map(async (off: any) => ({
        id: await resolveCanonicalOfficial(supabase, off.displayName, league.id, league.sport_type),
        position: off.position?.name || off.position?.displayName
      })))
    ]);

    // UPSERTS (Canonical)
    const upserts = [
      supabase.from('canonical_games').upsert({ id: canonicalId, league_id: league.id, sport: league.sport_type, home_team_name: getCompetitorName(homeComp), away_team_name: getCompetitorName(awayComp), commence_time: event.date, status: competition.status?.type?.name, canonical_venue_id: canonicalVenueId }),
      supabase.from('entity_mappings').upsert({ canonical_id: canonicalId, provider: 'ESPN', external_id: matchId, discovery_method: 'automated' }, { onConflict: 'provider,external_id' })
    ];
    if (canonicalOfficialIds.length > 0) {
      const validOfficials = canonicalOfficialIds.filter((o: any) => o.id).map((o: any) => ({ canonical_game_id: canonicalId, official_id: o.id, position: o.position }));
      if (validOfficials.length) upserts.push(supabase.from('game_officials').upsert(validOfficials, { onConflict: 'canonical_game_id,official_id' }));
    }
    await Promise.all(upserts);

    const boxscore = data.boxscore;
    const match: any = {
      id: dbMatchId,
      league_id: league.id,
      sport: league.sport_type,
      status: competition.status?.type?.name || 'LIVE',
      period: Safe.number(competition.status?.period),
      displayClock: Safe.string(competition.status?.displayClock),
      home_team: getCompetitorName(homeComp),
      away_team: getCompetitorName(awayComp),
      homeTeam: EspnAdapters.Team(homeComp, league.sport_type),
      awayTeam: EspnAdapters.Team(awayComp, league.sport_type),
      home_team_id: homeComp?.id,
      away_team_id: awayComp?.id,
      home_score: Safe.score(homeComp?.score),
      away_score: Safe.score(awayComp?.score),
      homeTeamStats: boxscore?.teams?.find((t: any) => t?.team?.id === homeComp?.id),
      awayTeamStats: boxscore?.teams?.find((t: any) => t?.team?.id === awayComp?.id),
      opening_odds: openingOdds,
      current_odds: currentOdds,
      situation: EspnAdapters.Situation(data),
      currentDrive: EspnAdapters.Drive(data),
      lastPlay: EspnAdapters.LastPlay(data),
      recentPlays: EspnAdapters.RecentPlays(data),
      venue: { is_indoor: data.gameInfo?.venue?.indoor },
      notes: competition.notes?.[0]?.headline
    };

    // --- SRE: AUTHORITY MERGE & VOLATILITY SAFETY VALVE ---
    const { data: existingMatch } = await supabase.from('matches').select('home_score, away_score, current_odds, opening_odds, is_closing_locked, status').eq('id', dbMatchId).maybeSingle();
    const { data: premiumFeed } = await supabase.rpc('resolve_market_feed', { p_match_id: matchId, p_canonical_id: canonicalId });

    let finalMarketOdds = match.current_odds;
    let isStale = false;

    if (premiumFeed) {
      const lastUpdate = new Date(premiumFeed.last_updated).getTime();
      const ageInSeconds = (Date.now() - lastUpdate) / 1000;
      const scoreChanged = existingMatch && (match.home_score !== existingMatch.home_score || match.away_score !== existingMatch.away_score);
      const isVolatilityEvent = (match.home_score > 0 || match.away_score > 0);
      const stalenessThreshold = scoreChanged ? 90 : 600;

      if (isVolatilityEvent && ageInSeconds > stalenessThreshold && !match.status?.includes('COMPLETED')) {
        isStale = true;
      } else {
        finalMarketOdds = {
          homeSpread: premiumFeed.spread?.home?.point,
          awaySpread: premiumFeed.spread?.away?.point,
          homeSpreadOdds: premiumFeed.spread?.home?.price,
          awaySpreadOdds: premiumFeed.spread?.away?.price,
          total: premiumFeed.total?.over?.point,
          overOdds: premiumFeed.total?.over?.price,
          underOdds: premiumFeed.total?.under?.price,
          homeWin: premiumFeed.h2h?.home?.price,
          awayWin: premiumFeed.h2h?.away?.price,
          drawWin: premiumFeed.h2h?.draw?.price,
          provider: premiumFeed.spread?.home?.bookmaker || "Institutional",
          isLive: premiumFeed.is_live,
          isInstitutional: true,
          isStale: false,
          lastUpdated: premiumFeed.last_updated
        };
      }
    }

    if (!premiumFeed || isStale) {
      if (isStale) {
        finalMarketOdds.provider = `ESPN (SRE Safety Valve)`;
        finalMarketOdds.isStale = true;
        finalMarketOdds.isInstitutional = false;
      }
    }

    let finalCurrentOdds = finalMarketOdds;
    let finalOpeningOdds = match.opening_odds;

    if (existingMatch?.opening_odds && (!match.opening_odds || match.opening_odds.provider === 'ESPN')) {
      finalOpeningOdds = existingMatch.opening_odds;
    }
    if (!premiumFeed && !isStale && existingMatch?.current_odds?.isInstitutional) {
      finalCurrentOdds = existingMatch.current_odds;
    }

    match.current_odds = finalCurrentOdds;
    match.opening_odds = finalOpeningOdds;

    const isLiveGame = ['LIVE', 'IN_PROGRESS', 'HALFTIME', 'STATUS_IN_PROGRESS', 'STATUS_HALFTIME'].some(k => match.status?.toUpperCase().includes(k));
    if (isLiveGame && match.current_odds) match.current_odds.isLive = true;

    // --- Closing Line Logic ---
    let closingOdds = null;
    let isClosingLocked = existingMatch?.is_closing_locked || false;

    if (!isClosingLocked && isLiveGame && finalCurrentOdds.homeSpread) {
      closingOdds = finalCurrentOdds;
      isClosingLocked = true;
      supabase.from('closing_lines').upsert({ match_id: dbMatchId, league_id: league.id, ...finalCurrentOdds }, { onConflict: 'match_id' }).then();
    }

    // --- SRE: SCORE MONOTONICITY GUARD ---
    let homeScore = match.home_score;
    let awayScore = match.away_score;
    if (existingMatch) {
      const dbHome = existingMatch.home_score || 0;
      const dbAway = existingMatch.away_score || 0;
      if (dbHome > homeScore || dbAway > awayScore) {
        homeScore = Math.max(homeScore, dbHome);
        awayScore = Math.max(awayScore, dbAway);
      }
    }

    if (data.gameInfo?.weather) {
      match.weather_info = { temp: data.gameInfo.weather.temperature, condition: data.gameInfo.weather.condition, wind_speed: data.gameInfo.weather.windSpeed };
    }

    // --- 📸 THE PATCH: T-60 / T-0 SNAPSHOTS (Inserted Here) ---
    const minsToStart = (new Date(event.date).getTime() - Date.now()) / 60000;
    let t60_snapshot = undefined;
    let t0_snapshot = undefined;

    const inT60 = minsToStart > 50 && minsToStart < 75;
    const inT0 = minsToStart > -10 && minsToStart < 15;

    if ((inT60 || inT0) && finalCurrentOdds.homeSpread) {
      const { data: existingState } = await supabase.from('live_game_state').select('t60_snapshot, t0_snapshot').eq('id', dbMatchId).maybeSingle();

      if (inT60 && !existingState?.t60_snapshot) {
        t60_snapshot = { odds: finalCurrentOdds, timestamp: new Date().toISOString() };
        stats.snapshots = (stats.snapshots || 0) + 1;
        Logger.info(`📸 Captured T-60 Snapshot`, { dbMatchId });
      }
      if (inT0 && !existingState?.t0_snapshot) {
        t0_snapshot = { odds: finalCurrentOdds, timestamp: new Date().toISOString() };
        stats.snapshots = (stats.snapshots || 0) + 1;
        Logger.info(`📸 Captured T-0 Snapshot`, { dbMatchId });
      }
    }

    // --- Upserts ---
    await supabase.from('matches').upsert({ ...match, id: dbMatchId, home_score: homeScore, away_score: awayScore, start_time: event.date, canonical_id: canonicalId, is_closing_locked: isClosingLocked, closing_odds: closingOdds || undefined, ingest_trace: trace, last_updated: new Date().toISOString() });

    const aiSignals = computeAISignals(match);
    if (aiSignals.edge_state === 'PLAY') stats.plays++;

    const statePayload: any = {
      id: dbMatchId,
      league_id: league.id,
      sport: league.sport_type,
      game_status: match.status,
      period: match.period,
      clock: match.displayClock,
      home_score: homeScore,
      away_score: awayScore,
      opening_odds: match.opening_odds,
      situation: match.situation,
      last_play: match.lastPlay,
      recent_plays: match.recentPlays,
      current_drive: match.currentDrive,
      deterministic_signals: aiSignals,
      logic_trace: aiSignals.debug_trace,
      odds: { current: finalCurrentOdds, opening: openingOdds },
      updated_at: new Date().toISOString()
    };

    if (t60_snapshot) { statePayload.t60_snapshot = t60_snapshot; statePayload.t60_captured_at = new Date().toISOString(); }
    if (t0_snapshot) { statePayload.t0_snapshot = t0_snapshot; statePayload.t0_captured_at = new Date().toISOString(); }

    await supabase.from('live_game_state').upsert(statePayload);
    stats.processed++;

    // --- Live Forecast Snapshots (History) ---
    try {
      const { data: lastSnapshot } = await supabase.from('live_forecast_snapshots').select('created_at').eq('match_id', dbMatchId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const timeElapsed = lastSnapshot ? (Date.now() - new Date(lastSnapshot.created_at).getTime()) / 1000 : 999;
      const isFinal = match.status?.toUpperCase().includes('FINAL') || match.status?.toUpperCase().includes('COMPLETED');
      if ((timeElapsed >= 60 && isLiveGame) || isFinal) {
        await supabase.from('live_forecast_snapshots').upsert({
          match_id: dbMatchId, league_id: league.id, period: match.period, clock: match.displayClock, home_score: homeScore, away_score: awayScore,
          market_total: aiSignals.market_total, fair_total: aiSignals.deterministic_fair_total, p10_total: aiSignals.p10_total, p90_total: aiSignals.p90_total,
          variance_sd: aiSignals.variance_sd, edge_points: aiSignals.edge_points, edge_state: aiSignals.edge_state, regime: aiSignals.deterministic_regime,
          observed_ppm: aiSignals.ppm?.observed, projected_ppm: aiSignals.ppm?.projected
        }, { onConflict: 'match_id,period,clock' });
      }
    } catch { }

    // --- Proactive AI Trigger ---
    const isHalftime = match.status?.toUpperCase().includes('HALFTIME') || match.displayClock?.toUpperCase().includes('HALF');
    if (isHalftime || (match.period > 1 && match.displayClock === '12:00')) {
      supabase.functions.invoke('analyze-match', { body: { match_id: dbMatchId, snapshot: { score: `${awayScore}-${homeScore}`, clock: match.displayClock, period: match.period, deterministic_signals: aiSignals } } }).then(({ error }: any) => { if (!error) stats.ai_triggers++; });
    }

  } catch (err: any) {
    Logger.error(`Error processing match ${matchId}`, err);
    trace.push(`[Fatal] Ingest Failed: ${err.message}`);
    supabase.from('matches').update({ last_ingest_error: err.message, ingest_trace: trace, last_updated: new Date().toISOString() }).eq('id', dbMatchId).then();
  }
}
