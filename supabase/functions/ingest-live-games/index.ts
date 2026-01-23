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
const SERVICE_NAME = 'ingest-service-v1.2.0';
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const CONCURRENCY_LIMIT = 5; // Process 5 games concurrently to balance freshness vs. rate limits

// Env Validation: Fail fast if critical config is missing
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

// Helper: Extract name from competitor (supports both team and athlete for tennis)
const getCompetitorName = (comp: any): string => {
  if (!comp) return 'Unknown';
  // Tennis uses competitor.athlete (individual), other sports use competitor.team
  const entity = comp.team || comp.athlete || {};
  return entity.displayName || entity.fullName || entity.name || 'Unknown';
};

// --- SRE Utilities ---

// Structured Logger for Observability
const Logger = {
  info: (msg: string, data: Record<string, any> = {}) => console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), msg, ...data })),
  warn: (msg: string, data: Record<string, any> = {}) => console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), msg, ...data })),
  error: (msg: string, error: any) => console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), msg, error: error.message || error })),
};

// Resilient Network Fetcher
async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  let attempt = 0;
  while (attempt < retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        // Retry on rate limits (429) or server errors (5xx)
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res; // Return 4xx errors immediately (client error)
      }
      return res;
    } catch (err: any) {
      clearTimeout(timeoutId);
      attempt++;
      const isLastAttempt = attempt === retries;
      // Exponential backoff with jitter
      const delay = Math.min(1000 * (2 ** attempt), 8000) + (Math.random() * 100);

      if (isLastAttempt) {
        throw new Error(`Fetch failed after ${retries} attempts: ${err.message} (${url})`);
      }

      Logger.warn(`Fetch retry ${attempt}/${retries}`, { url, error: err.message });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable code');
}

// Optimization: Pre-compute reverse map once for O(1) lookups
const REVERSE_LEAGUE_MAP: Record<string, string> = Object.entries(LEAGUE_SUFFIX_MAP).reduce((acc, [k, v]) => ({
  ...acc,
  [v.replace('_', '')]: k
}), {});

// --- Main Handler ---

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startTime = performance.now();
  const stats = { processed: 0, live: 0, plays: 0, errors: [] as string[] };

  try {
    const { target_match_id, dates: requestedDate } = await req.json().catch(() => ({}));
    Logger.info(`[Start] Ingest Cycle`, { target_match_id, service: SERVICE_NAME });

    let leaguesToScan = MONITOR_LEAGUES;

    // Smart Targeting Optimization
    if (target_match_id) {
      const suffix = target_match_id.includes('_') ? target_match_id.split('_').pop() : null;
      if (suffix && REVERSE_LEAGUE_MAP[suffix]) {
        leaguesToScan = MONITOR_LEAGUES.filter(l => l.id === REVERSE_LEAGUE_MAP[suffix]);
      }
      Logger.info(`Target Mode Active`, { leagues: leaguesToScan.map(l => l.id) });
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

        // Tennis-specific: ESPN nests matches inside tournaments
        if (league.sport_type === Sport.TENNIS) {
          events = events.flatMap((tournament: any) =>
            (tournament.groupings || []).flatMap((group: any) =>
              (group.competitions || []).map((comp: any) => ({
                ...tournament,
                id: comp.id,
                date: comp.date || comp.startDate,
                status: comp.status,
                competitions: [comp],
              }))
            )
          );
        }

        // Filter events relevant for processing
        const eventsToProcess = events.filter((event: any) => {
          stats.processed++;
          if (target_match_id) {
            return target_match_id.startsWith(event.id);
          }
          return ['in', 'post'].includes(event.status?.type?.state); // LIVE + FINAL games for grading
        });

        // Concurrency Control: Process in batches to manage rate limits
        const chunks = [];
        for (let i = 0; i < eventsToProcess.length; i += CONCURRENCY_LIMIT) {
          chunks.push(eventsToProcess.slice(i, i + CONCURRENCY_LIMIT));
        }

        for (const chunk of chunks) {
          await Promise.allSettled(chunk.map((event: any) => {
            stats.live++;
            return processLiveGame(event, league, stats);
          }));
        }

      } catch (err: any) {
        Logger.error(`League Scan Failed: ${league.id}`, err);
        stats.errors.push(`${league.id}: ${err.message}`);
      }
    }

    const duration = performance.now() - startTime;
    Logger.info(`[Complete] Ingest Cycle`, { ...stats, duration_ms: duration.toFixed(0) });

    return new Response(JSON.stringify({ ...stats, duration_ms: duration }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    Logger.error('Fatal Service Error', error);
    return new Response(JSON.stringify({ error: error.message, fatal: true }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function processLiveGame(event: any, league: any, stats: any) {
  const matchId = event.id;
  const dbMatchId = getCanonicalMatchId(matchId, league.id);
  const trace: string[] = [];
  trace.push(`[Init] Match ${matchId} for league ${league.id} (Canonical: ${dbMatchId})`);
  const summaryUrl = `${ESPN_BASE_URL}/${league.endpoint}/summary?event=${matchId}&_t=${Date.now()}`;

  try {
    const res = await fetchWithRetry(summaryUrl);
    const data = await res.json();
    trace.push(`[ESPN] Response Status: ${res.status}`);

    const header = data.header || {};
    const competition = header.competitions?.[0];
    if (!competition) {
      trace.push(`[ESPN] Critical: No competition data found in summary.`);
      return;
    }

    const homeComp = competition.competitors.find((c: any) => c.homeAway === 'home');
    const awayComp = competition.competitors.find((c: any) => c.homeAway === 'away');
    trace.push(`[ESPN] Event State: ${competition.status?.type?.name}, Score: ${awayComp?.score}-${homeComp?.score}`);
    const pickcenter = data.pickcenter;

    // --- Odds Logic ---
    const currentOdds = EspnAdapters.Odds(competition, pickcenter);
    let openingOdds = data.header?.competitions?.[0]?.odds?.[1] || data.header?.competitions?.[0]?.odds?.[0] || {};

    // Heuristic: If we have valid current odds but empty opening, assume current are effectively opening (prevents 0s)
    if ((!openingOdds.overUnder && !openingOdds.spread) && (currentOdds.overUnder || currentOdds.spread)) {
      openingOdds = currentOdds;
    }

    // --- Knowledge Graph Resolution ---
    let canonicalId = await resolveCanonicalMatch(supabase, getCompetitorName(homeComp), getCompetitorName(awayComp), event.date, league.id);

    // Audit Log: Time Drift (SRE Check)
    if (canonicalId) {
      const { data: existingEntity } = await supabase.from('canonical_games').select('commence_time').eq('id', canonicalId).single();
      if (existingEntity) {
        const drift = Math.abs(new Date(existingEntity.commence_time).getTime() - new Date(event.date).getTime());
        if (drift > 1000 * 60 * 15) {
          Logger.warn(`Time Drift Detected`, { canonicalId, diff_mins: drift / 60000 });
          // Async fire-and-forget log
          supabase.from('canonical_property_log').insert({
            canonical_id: canonicalId,
            property_name: 'commence_time',
            old_value: existingEntity.commence_time,
            new_value: event.date,
            provider: 'ESPN'
          }).then();
        }
      }
    } else {
      canonicalId = generateDeterministicId(getCompetitorName(homeComp), getCompetitorName(awayComp), event.date, league.id);
      Logger.info(`New Canonical Entity`, { canonicalId });
    }

    // Venue & Officials Resolution (Parallel)
    const venueData = competition.venue;
    const [canonicalVenueId, canonicalOfficialIds] = await Promise.all([
      resolveCanonicalVenue(supabase, venueData?.fullName, venueData?.address?.city),
      Promise.all((competition.officials || []).map(async (off: any) => ({
        id: await resolveCanonicalOfficial(supabase, off.displayName, league.id, league.sport_type),
        position: off.position?.name || off.position?.displayName
      })))
    ]);

    // Upsert Knowledge Graph Data (Parallel Ops)
    const upserts = [
      supabase.from('canonical_games').upsert({
        id: canonicalId,
        league_id: league.id,
        sport: league.sport_type,
        home_team_name: getCompetitorName(homeComp),
        away_team_name: getCompetitorName(awayComp),
        commence_time: event.date,
        status: competition.status?.type?.name,
        canonical_venue_id: canonicalVenueId
      }),
      supabase.from('entity_mappings').upsert({
        canonical_id: canonicalId,
        provider: 'ESPN',
        external_id: matchId,
        discovery_method: 'automated'
      }, { onConflict: 'provider,external_id' })
    ];

    // Link Officials
    if (canonicalOfficialIds.length > 0) {
      const validOfficials = canonicalOfficialIds.filter((o: any) => o.id).map((o: any) => ({
        canonical_game_id: canonicalId,
        official_id: o.id,
        position: o.position
      }));
      if (validOfficials.length) {
        upserts.push(supabase.from('game_officials').upsert(validOfficials, { onConflict: 'canonical_game_id,official_id' }));
      }
    }
    await Promise.all(upserts);

    // --- Match Data Construction ---
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
    // Fetch existing state to detect score volatility
    const { data: existingMatch } = await supabase
      .from('matches')
      .select('home_score, away_score, current_odds, opening_odds, is_closing_locked, status')
      .eq('id', dbMatchId)
      .maybeSingle();

    const { data: premiumFeed } = await supabase.rpc('resolve_market_feed', {
      p_match_id: matchId,
      p_canonical_id: canonicalId
    });
    trace.push(`[SRE] resolve_market_feed call: ${premiumFeed ? 'Found ' + premiumFeed.provider : 'Not Found'}`);

    let finalMarketOdds = match.current_odds;
    let isStale = false;

    if (premiumFeed) {
      // 1. VOLATILITY SAFETY VALVE:
      // If we have a score change (In Play) but the market feed provider is lagging,
      // we fallback to ESPN Pulse for the "Immediate Truth" until the provider catches up.
      const lastUpdate = new Date(premiumFeed.last_updated).getTime();
      const ageInSeconds = (Date.now() - lastUpdate) / 1000;

      // Detection: 
      // A) Score changed just now (transient volatility) -> 90s threshold
      // B) Long term drift -> 600s threshold
      const scoreChanged = existingMatch && (match.home_score !== existingMatch.home_score || match.away_score !== existingMatch.away_score);
      const isVolatilityEvent = (match.home_score > 0 || match.away_score > 0);

      const stalenessThreshold = scoreChanged ? 90 : 600;

      if (isVolatilityEvent && ageInSeconds > stalenessThreshold && !match.status?.includes('COMPLETED')) {
        isStale = true;
        Logger.warn(`Volatility Drift: Market feed lagging (${Math.floor(ageInSeconds)}s). Falling back to ESPN Pulse Safety Valve.`, { dbMatchId });
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
        Logger.info(`SRE Resolution: ${finalMarketOdds.provider} Mapping Succesful`, { dbMatchId });
        trace.push(`[SRE] Resolution: ${finalMarketOdds.provider} mapping successful. Provider Last Updated: ${premiumFeed.last_updated}`);
      }
    }

    if (!premiumFeed || isStale) {
      if (!premiumFeed) {
        Logger.warn(`Identity Gap: No premium mapping found. Using ESPN Pulse fallback.`, { dbMatchId });
        trace.push(`[SRE] Identity Gap: No premium feed found. Falling back to ESPN.`);
      }

      // Inject safety valve metadata if stale
      if (isStale) {
        finalMarketOdds.provider = `ESPN (SRE Safety Valve)`;
        finalMarketOdds.isStale = true;
        finalMarketOdds.isInstitutional = false;
        trace.push(`[SRE] Safety Valve Activated: Institutional feed was stale.`);
      }
    }

    match.current_odds = finalMarketOdds;

    if (data.gameInfo?.weather) {
      match.weather_info = {
        temp: data.gameInfo.weather.temperature,
        condition: data.gameInfo.weather.condition,
        wind_speed: data.gameInfo.weather.windSpeed
      };
    }

    // (Moved earlier for Volatility check)

    let finalCurrentOdds = match.current_odds;
    let finalOpeningOdds = match.opening_odds;

    // Preserve opening odds from existing record if the new sync is just ESPN
    if (existingMatch?.opening_odds && (!match.opening_odds || match.opening_odds.provider === 'ESPN')) {
      finalOpeningOdds = existingMatch.opening_odds;
    }

    // Preserve existing institutional odds if the new sync failed AND isStale wasn't triggered
    if (!premiumFeed && !isStale && existingMatch?.current_odds?.isInstitutional) {
      finalCurrentOdds = existingMatch.current_odds;
    }

    match.current_odds = finalCurrentOdds;
    match.opening_odds = finalOpeningOdds;

    const isLiveGame = ['LIVE', 'IN_PROGRESS', 'HALFTIME', 'STATUS_IN_PROGRESS', 'STATUS_HALFTIME'].some(k => match.status?.toUpperCase().includes(k));
    if (isLiveGame && match.current_odds) {
      match.current_odds.isLive = true;
    }

    // --- Closing Line Logic ---
    let closingOdds = null;
    let isClosingLocked = existingMatch?.is_closing_locked || false;

    if (!isClosingLocked && isLiveGame) {
      closingOdds = finalCurrentOdds;
      isClosingLocked = true;
      Logger.info(`❄️ Closing Lines Frozen`, { dbMatchId });

      // Persist closing line immediately to specialist table
      supabase.from('closing_lines').upsert({
        match_id: dbMatchId,
        league_id: league.id,
        total: finalCurrentOdds.total,
        home_spread: finalCurrentOdds.homeSpread,
        away_spread: finalCurrentOdds.awaySpread,
        home_ml: finalCurrentOdds.homeWin,
        away_ml: finalCurrentOdds.awayWin
      }, { onConflict: 'match_id' }).then();
    }

    // --- SRE: SCORE MONOTONICITY GUARD ---
    // Prevent stale ESPN Summary API from regressing scores already in the DB (from Scoreboard API)
    let homeScore = match.home_score;
    let awayScore = match.away_score;

    if (existingMatch) {
      const dbHome = existingMatch.home_score || 0;
      const dbAway = existingMatch.away_score || 0;

      if (dbHome > homeScore || dbAway > awayScore) {
        Logger.warn(`MONOTONICITY_GUARD: Stale Summary Rejected`, {
          id: dbMatchId,
          db: `${dbAway}-${dbHome}`,
          summary: `${awayScore}-${homeScore}`
        });
        homeScore = Math.max(homeScore, dbHome);
        awayScore = Math.max(awayScore, dbAway);
        trace.push(`[SRE] Monotonicity Guard: Preserving higher DB score ${awayScore}-${homeScore}`);
      }
    }

    // --- DB Write: Matches ---
    const matchPayload = {
      id: dbMatchId,
      league_id: league.id,
      sport: league.sport_type,
      home_team_id: (match as any).home_team_id,
      away_team_id: (match as any).away_team_id,
      home_team: match.home_team,
      away_team: match.away_team,
      start_time: event.date,
      status: match.status,
      period: match.period,
      display_clock: match.displayClock,
      home_score: homeScore,
      away_score: awayScore,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      leagueId: league.id,
      current_odds: finalCurrentOdds,
      opening_odds: finalOpeningOdds,
      closing_odds: closingOdds || undefined,
      is_closing_locked: isClosingLocked,
      canonical_id: canonicalId,
      ingest_trace: trace,
      last_updated: new Date().toISOString()
    };

    console.log(`[Matches] Upserting ${dbMatchId} (${matchPayload.home_team} vs ${matchPayload.away_team})`);
    const { error: matchError } = await supabase.from('matches').upsert(matchPayload);
    if (matchError) {
      console.error(`[Matches] Upsert FAILED for ${dbMatchId}:`, matchError.message, matchError.details, matchError.hint);
      throw new Error(`Match upsert failed: ${matchError.message}`);
    }

    // --- SRE: SKIP SIGNAL ENGINE FOR COMPLETED GAMES ---
    const isCompleted = match.status?.toUpperCase().includes('FINAL') ||
      match.status?.toUpperCase().includes('COMPLETED') ||
      match.status?.toUpperCase().includes('POST');

    if (isCompleted) {
      Logger.info(`Game Completed. Skipping AI Engine.`, { dbMatchId });
      return; // Stop here for finished games
    }

    // --- AI/Signal Engine ---
    const aiSignals = computeAISignals(match);
    if (aiSignals.edge_state === 'PLAY') stats.plays++;

    // --- DB Write: Live State (Forensics & UI) ---
    const { error: stateError } = await supabase.from('live_game_state').upsert({
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
      odds: { current: match.current_odds, opening: match.opening_odds },
      updated_at: new Date().toISOString()
    });

    if (stateError) throw new Error(`Live state upsert failed: ${stateError.message}`);
    stats.snapshots = (stats.snapshots || 0);

    // --- DB Write: Live Forecast Snapshot (History) ---
    // Throttling Logic: Snapshot if:
    // 1. Score changed
    // 2. Period changed
    // 3. Status is FINAL (Final capture)
    // 4. At least 60s have passed since last snapshot
    try {
      const { data: lastSnapshot } = await supabase
        .from('live_forecast_snapshots')
        .select('created_at, home_score, away_score, period')
        .eq('match_id', dbMatchId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const timeElapsed = lastSnapshot ? (Date.now() - new Date(lastSnapshot.created_at).getTime()) / 1000 : 999;
      const scoreChanged = !lastSnapshot || (homeScore !== lastSnapshot.home_score || awayScore !== lastSnapshot.away_score);
      const periodChanged = !lastSnapshot || (match.period !== lastSnapshot.period);
      const isFinal = match.status?.toUpperCase().includes('FINAL') || match.status?.toUpperCase().includes('COMPLETED');

      if (scoreChanged || periodChanged || isFinal || timeElapsed >= 60) {
        const { error: snapshotError } = await supabase.from('live_forecast_snapshots').upsert({
          match_id: dbMatchId,
          league_id: league.id,
          period: match.period,
          clock: match.displayClock,
          home_score: homeScore,
          away_score: awayScore,
          market_total: aiSignals.market_total,
          fair_total: aiSignals.deterministic_fair_total,
          p10_total: aiSignals.p10_total,
          p90_total: aiSignals.p90_total,
          variance_sd: aiSignals.variance_sd,
          edge_points: aiSignals.edge_points,
          edge_state: aiSignals.edge_state,
          regime: aiSignals.deterministic_regime,
          observed_ppm: aiSignals.ppm?.observed,
          projected_ppm: aiSignals.ppm?.projected
        }, { onConflict: 'match_id,period,clock' });

        if (!snapshotError) {
          stats.snapshots++;
          Logger.info('Snapshot recorded', { match_id: dbMatchId, clock: match.displayClock, edge: aiSignals.edge_points });
        } else {
          // Log but don't fail ingest for snapshot errors
          Logger.warn('Snapshot insert failed', { match_id: dbMatchId, error: snapshotError.message });
        }
      }
    } catch (snapshotErr: any) {
      Logger.error('Snapshot logic failure', snapshotErr);
    }

    // --- PROACTIVE AI ANALYSIS TRIGGER (v6.8) ---
    // Fire analyze-match at key moments to pre-compute AI narrative in database
    // This eliminates on-demand wait times in the UI
    try {
      const isHalftime = match.status?.toUpperCase().includes('HALFTIME') ||
        match.status?.toUpperCase().includes('HT') ||
        match.displayClock?.toUpperCase().includes('HALF');

      // Check if we already have recent AI analysis for this game
      const { data: existingAnalysis } = await supabase
        .from('live_game_state')
        .select('ai_analysis')
        .eq('id', dbMatchId)
        .maybeSingle();

      const existingMoment = existingAnalysis?.ai_analysis?.analysis_moment;
      const previousPeriod = existingAnalysis?.ai_analysis?.snapshot?.period || 0;
      const periodChangedForAI = match.period !== previousPeriod && match.period > 1;
      const analysisFreshness = existingAnalysis?.ai_analysis?.generated_at
        ? (Date.now() - new Date(existingAnalysis.ai_analysis.generated_at).getTime()) / 1000 / 60 // minutes
        : 999;

      // Trigger conditions:
      // 1. Halftime with no halftime analysis yet, OR stale (>10 mins old)
      // 2. Period changed and no recent analysis (>5 mins)
      // 3. Game just started (period 1, clock > 10:00) with no analysis
      const shouldTriggerAnalysis = (
        (isHalftime && (existingMoment !== 'HALFTIME' || analysisFreshness > 10)) ||
        (periodChangedForAI && analysisFreshness > 5) ||
        (match.period === 1 && !existingMoment && isLiveGame)
      );

      if (shouldTriggerAnalysis) {
        Logger.info(`🧠 [AI-TRIGGER] Proactive analysis for ${dbMatchId}`, {
          reason: isHalftime ? 'HALFTIME' : (periodChangedForAI ? 'PERIOD_CHANGE' : 'GAME_START'),
          stale_mins: analysisFreshness.toFixed(1)
        });

        // Fire-and-forget: Don't await to avoid blocking ingest
        supabase.functions.invoke('analyze-match', {
          body: {
            match_id: dbMatchId,
            snapshot: {
              score: `${awayScore}-${homeScore}`,
              away_team: match.away_team,
              home_team: match.home_team,
              away_score: awayScore,
              home_score: homeScore,
              clock: match.displayClock,
              period: match.period,
              market_total: aiSignals.market_total,
              fair_total: aiSignals.deterministic_fair_total,
              deterministic_signals: aiSignals,
              last_play: match.lastPlay,
              home_stats: match.homeTeamStats,
              away_stats: match.awayTeamStats,
              sport: league.sport_type,
              league_id: league.id
            }
          }
        }).then(({ error }: { error: any }) => {
          if (error) Logger.warn(`[AI-TRIGGER] Failed for ${dbMatchId}: ${error.message}`);
          else Logger.info(`[AI-TRIGGER] ✅ Analysis queued for ${dbMatchId}`);
        }).catch((e: any) => Logger.warn(`[AI-TRIGGER] Network error: ${e.message}`));

        stats.ai_triggers = (stats.ai_triggers || 0) + 1;
      }
    } catch (aiTriggerErr: any) {
      Logger.error('AI analysis trigger failure', aiTriggerErr);
    }

  } catch (err: any) {
    Logger.error(`Error processing match ${matchId}`, err);
    trace.push(`[Fatal] Ingest Failed: ${err.message}`);

    // Attempt persist error to match record
    supabase.from('matches').update({
      last_ingest_error: err.message,
      ingest_trace: trace,
      last_updated: new Date().toISOString()
    }).eq('id', dbMatchId).then();
  }
}
