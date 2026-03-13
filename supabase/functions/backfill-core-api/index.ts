import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CORE_BASE = 'https://sports.core.api.espn.com/v2/sports';

interface BackfillConfig {
  sport: string;       // 'basketball' | 'baseball' | 'hockey' | 'football'
  league: string;      // 'nba' | 'mlb' | 'nhl' | 'nfl' | 'mens-college-basketball'
  db_sport: string;    // 'basketball' | 'baseball' | 'hockey' | 'football'
  league_id: string;   // our DB league ID
  startDate: string;   // YYYYMMDD
  endDate: string;     // YYYYMMDD
  batchSize: number;   // games per batch
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url: string, timeout = 8000): Promise<any> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getGameIds(config: BackfillConfig): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `${CORE_BASE}/${config.sport}/leagues/${config.league}/events?dates=${config.startDate}-${config.endDate}&limit=50&page=${page}`;
    const data = await fetchJson(url);
    if (!data || !data.items?.length) break;

    for (const item of data.items) {
      const ref = item.$ref || '';
      const id = ref.split('/events/')[1]?.split('?')[0];
      if (id) ids.push(id);
    }

    hasMore = data.items.length === 50;
    page++;
    await sleep(200); // rate limit
  }

  return ids;
}

async function backfillGame(eventId: string, config: BackfillConfig, log: string[]) {
  const compBase = `${CORE_BASE}/${config.sport}/leagues/${config.league}/events/${eventId}/competitions/${eventId}`;

  // 1. Get competition details (teams, scores, status)
  const compData = await fetchJson(compBase);
  if (!compData) {
    log.push(`  SKIP ${eventId}: no competition data`);
    return;
  }

  const competitors = compData.competitors || [];
  const home = competitors.find((c: any) => c.homeAway === 'home');
  const away = competitors.find((c: any) => c.homeAway === 'away');
  if (!home || !away) {
    log.push(`  SKIP ${eventId}: no competitors`);
    return;
  }

  const homeId = home.id;
  const awayId = away.id;

  // Resolve team names (Core API returns $ref links)
  let homeTeam = home.team?.displayName || home.team?.name || null;
  let awayTeam = away.team?.displayName || away.team?.name || null;
  if (!homeTeam && home.team?.$ref) {
    const teamData = await fetchJson(home.team.$ref);
    homeTeam = teamData?.displayName || teamData?.name || `Team ${homeId}`;
  }
  if (!awayTeam && away.team?.$ref) {
    const teamData = await fetchJson(away.team.$ref);
    awayTeam = teamData?.displayName || teamData?.name || `Team ${awayId}`;
  }
  homeTeam = homeTeam || `Team ${homeId}`;
  awayTeam = awayTeam || `Team ${awayId}`;

  // Resolve scores
  let homeScore = typeof home.score === 'number' ? home.score : parseInt(home.score || '0');
  let awayScore = typeof away.score === 'number' ? away.score : parseInt(away.score || '0');
  if (isNaN(homeScore) && home.score?.$ref) {
    const scoreData = await fetchJson(home.score.$ref);
    homeScore = scoreData?.value ?? 0;
  }
  if (isNaN(awayScore) && away.score?.$ref) {
    const scoreData = await fetchJson(away.score.$ref);
    awayScore = scoreData?.value ?? 0;
  }
  homeScore = isNaN(homeScore) ? 0 : homeScore;
  awayScore = isNaN(awayScore) ? 0 : awayScore;

  // Resolve status
  let status = compData.status?.type?.name || null;
  if (!status && compData.status?.$ref) {
    const statusData = await fetchJson(compData.status.$ref);
    status = statusData?.type?.name || 'UNKNOWN';
  }
  status = status || 'UNKNOWN';

  const startDate = compData.date || compData.startDate;

  const dbMatchId = `${eventId}_${config.league_id}`;

  // 2. Fetch all 12 endpoints in parallel
  const [
    homeStatsRes, awayStatsRes, homeLeadersRes, awayLeadersRes,
    homeRosterRes, awayRosterRes, situationRes,
    officialsRes, broadcastsRes, homeLinescoresRes, awayLinescoresRes,
    predictorRes, oddsRes, probsRes
  ] = await Promise.all([
    fetchJson(`${compBase}/competitors/${homeId}/statistics`),
    fetchJson(`${compBase}/competitors/${awayId}/statistics`),
    fetchJson(`${compBase}/competitors/${homeId}/leaders`),
    fetchJson(`${compBase}/competitors/${awayId}/leaders`),
    fetchJson(`${compBase}/competitors/${homeId}/roster`),
    fetchJson(`${compBase}/competitors/${awayId}/roster`),
    fetchJson(`${compBase}/situation`),
    fetchJson(`${compBase}/officials`),
    fetchJson(`${compBase}/broadcasts`),
    fetchJson(`${compBase}/competitors/${homeId}/linescores`),
    fetchJson(`${compBase}/competitors/${awayId}/linescores`),
    fetchJson(`${compBase}/predictor`),
    fetchJson(`${compBase}/odds`),
    fetchJson(`${compBase}/probabilities?limit=500`),
  ]);

  // 3. Parse statistics
  const parseStats = (data: any) => {
    if (!data?.splits?.categories) return null;
    const result: Record<string, any> = {};
    for (const cat of data.splits.categories) {
      for (const stat of (cat.stats || [])) {
        if (stat.name && stat.value != null) {
          result[stat.name] = stat.value;
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  };
  const homeStats = parseStats(homeStatsRes);
  const awayStats = parseStats(awayStatsRes);

  // 4. Parse leaders
  const parseLeaders = (data: any) => {
    const result: Record<string, any> = {};
    const categories = Array.isArray(data?.leaders)
      ? data.leaders
      : (Array.isArray(data?.categories) ? data.categories : []);

    for (const cat of categories) {
      const top = cat?.leaders?.[0];
      if (!top) continue;
      const key = cat?.name ?? cat?.displayName ?? cat?.shortDisplayName ?? 'unknown';
      result[key] = {
        displayValue: top?.displayValue ?? null,
        value: top?.value ?? null,
        athleteRef: top?.athlete?.$ref ?? null,
        teamRef: top?.team?.$ref ?? null
      };
    }
    return Object.keys(result).length > 0 ? result : null;
  };
  const homeLeaders = parseLeaders(homeLeadersRes);
  const awayLeaders = parseLeaders(awayLeadersRes);

  // 5. Parse roster
  const parseRoster = (data: any) => {
    const items = data?.entries ?? data?.items ?? [];
    if (!Array.isArray(items) || items.length === 0) return null;
    return items
      .filter((p: any) => p?.playerId || p?.athlete || p?.id)
      .map((p: any) => ({
        id: p.playerId ?? p.id ?? null,
        athleteRef: p.athlete?.$ref ?? null,
        statsRef: p.statistics?.$ref ?? null,
        name: p.fullName ?? p.displayName ?? null,
        jersey: p.jersey ?? null,
        position: p.position?.abbreviation ?? null,
        starter: p.starter ?? false
      }));
  };
  const homeRoster = parseRoster(homeRosterRes);
  const awayRoster = parseRoster(awayRosterRes);

  // 6. Parse officials
  const officials = (officialsRes?.items || []).map((o: any) => ({
    id: o.id ?? null,
    name: o.fullName ?? o.displayName ?? null,
    position: o.position?.name ?? null,
    order: o.order ?? null
  }));

  // 7. Parse broadcasts
  const broadcasts = (broadcastsRes?.items || []).map((b: any) => ({
    station: b.station ?? null,
    type: b.type?.shortName ?? null,
    market: b.market?.type ?? null
  }));

  // 8. Parse linescores
  const parseLinescores = (data: any) => {
    if (!data?.items) return null;
    return data.items.map((item: any) => item?.value ?? null);
  };
  const homeLinescores = parseLinescores(homeLinescoresRes);
  const awayLinescores = parseLinescores(awayLinescoresRes);

  // 9. Parse predictor/powerindex
  let powerindex: any = null;
  if (predictorRes) {
    const extractPredStats = (stats: any[]) => {
      const result: Record<string, any> = {};
      for (const s of (stats || [])) {
        if (s?.name && s?.displayValue != null) result[s.name] = s.displayValue;
      }
      return Object.keys(result).length > 0 ? result : null;
    };
    powerindex = {
      home: extractPredStats(predictorRes?.homeTeam?.statistics || predictorRes?.homeTeam?.team?.statistics || []),
      away: extractPredStats(predictorRes?.awayTeam?.statistics || predictorRes?.awayTeam?.team?.statistics || []),
      name: predictorRes?.name ?? null,
      lastModified: predictorRes?.lastModified ?? null
    };
  }

  // 10. Parse odds (open/close)
  let oddsData: any = null;
  if (oddsRes?.items?.length) {
    const o = oddsRes.items[0];
    oddsData = {
      provider: o.provider?.name ?? null,
      provider_id: o.provider?.id ?? null,
      spread: o.spread ?? null,
      overUnder: o.overUnder ?? null,
      homeML: o.homeTeamOdds?.moneyLine ?? null,
      awayML: o.awayTeamOdds?.moneyLine ?? null,
      open: o.open ?? null,
      close: o.close ?? null,
      spreadWinner: o.spreadWinner ?? null,
      moneylineWinner: o.moneylineWinner ?? null
    };
  }

  // 11. Parse probabilities (BPI win% history)
  let probabilities: any[] = [];
  if (probsRes?.items?.length) {
    probabilities = probsRes.items.map((p: any) => ({
      homeWinPct: p.homeWinPercentage ?? null,
      awayWinPct: p.awayWinPercentage ?? null,
      tieWinPct: p.tiePercentage ?? null,
      secondsLeft: p.secondsLeft ?? null,
      playId: p.playId ?? null,
      sequenceNumber: p.sequenceNumber ?? null
    }));
  }

  // ═══ UPSERT match ═══
  const { error: matchError } = await supabase.from('matches').upsert({
    id: dbMatchId,
    league_id: config.league_id,
    sport: config.db_sport,
    home_team: homeTeam,
    away_team: awayTeam,
    home_score: homeScore,
    away_score: awayScore,
    status,
    start_time: startDate
  }, { onConflict: 'id' });

  if (matchError) {
    log.push(`  ERROR matches upsert ${dbMatchId}: ${matchError.message}`);
    return; // Fast fail if matches table refuses it
  }

  // ═══ UPSERT live_game_state ═══
  const { error: lgsError } = await supabase.from('live_game_state').upsert({
    id: dbMatchId,
    league_id: config.league_id,
    sport: config.db_sport,
    game_status: status,
    home_score: homeScore,
    away_score: awayScore,
    stats: { home: homeStats, away: awayStats },
    leaders: null,
    advanced_metrics: (homeStats || awayStats) ? {
      core_api_efficiency: {
        home: homeStats ? {
          ppep: homeStats.pointsPerEstimatedPossessions,
          pace: homeStats.estimatedPossessions,
          shootingEff: homeStats.shootingEfficiency,
          offRebPct: homeStats.offensiveReboundPct,
          astToRatio: homeStats.assistTurnoverRatio
        } : null,
        away: awayStats ? {
          ppep: awayStats.pointsPerEstimatedPossessions,
          pace: awayStats.estimatedPossessions,
          shootingEff: awayStats.shootingEfficiency,
          offRebPct: awayStats.offensiveReboundPct,
          astToRatio: awayStats.assistTurnoverRatio
        } : null
      }
    } : null,
    extra_data: {
      roster: { home: homeRoster, away: awayRoster },
      core_api_leaders: { home: homeLeaders, away: awayLeaders },
      officials: officials.length > 0 ? officials : null,
      broadcasts: broadcasts.length > 0 ? broadcasts : null,
      linescores: { home: homeLinescores, away: awayLinescores },
      powerindex,
      backfilled: true,
      backfill_date: new Date().toISOString()
    },
    updated_at: new Date().toISOString()
  }, { onConflict: 'id' });

  if (lgsError) {
    log.push(`  ERROR live_game_state upsert ${dbMatchId}: ${lgsError.message}`);
    // If live_game_state fails (e.g. trigger error), we MUST skip game_events to prevent orphan records 
    // and allow future backfill retries to pick it up.
    return;
  }

  // ═══ INSERT box_snapshot marker (always) ═══
  // We intentionally write a marker row even when provider stats are missing so
  // idempotency tracking can mark this game as backfilled.
  const epochSeconds = Math.floor(new Date(startDate).getTime() / 1000);
  const { error: boxError } = await supabase.from('game_events').upsert({
    match_id: dbMatchId,
    league_id: config.league_id,
    sport: config.db_sport,
    event_type: 'box_snapshot',
    sequence: epochSeconds,
    home_score: homeScore,
    away_score: awayScore,
    box_snapshot: {
      sport: config.db_sport,
      home: homeStats,
      away: awayStats
    },
    odds_live: oddsData ? {
      homeSpread: oddsData.spread,
      total: oddsData.overUnder,
      home_ml: oddsData.homeML,
      away_ml: oddsData.awayML,
      provider: oddsData.provider,
      provider_id: String(oddsData.provider_id)
    } : null,
    source: 'backfill'
  }, {
    onConflict: 'match_id,event_type,sequence',
    ignoreDuplicates: true
  });

  if (boxError) {
    log.push(`  ERROR game_events (box_snapshot) upsert ${dbMatchId}: ${boxError.message}`);
  }

  // ═══ INSERT odds_snapshot (open + close) ═══
  if (oddsData) {
    const epochSeconds = Math.floor(new Date(startDate).getTime() / 1000);
    const { error: oddsError } = await supabase.from('game_events').upsert({
      match_id: dbMatchId,
      league_id: config.league_id,
      sport: config.db_sport,
      event_type: 'odds_snapshot',
      sequence: epochSeconds,
      odds_live: {
        homeSpread: oddsData.spread,
        total: oddsData.overUnder,
        home_ml: oddsData.homeML,
        away_ml: oddsData.awayML,
        provider: oddsData.provider,
        provider_id: String(oddsData.provider_id)
      },
      source: 'backfill'
    }, {
      onConflict: 'match_id,event_type,sequence',
      ignoreDuplicates: true
    });
    
    if (oddsError) {
      log.push(`  ERROR game_events (odds_snapshot) upsert ${dbMatchId}: ${oddsError.message}`);
    }
  }

  // ═══ INSERT bpi_probability (timeline) ═══
  if (probabilities.length > 0) {
    const epochSeconds = Math.floor(new Date(startDate).getTime() / 1000);
    const bpiPayloads = probabilities.map((p: any, index: number) => ({
      // Keep sequence int32-safe for game_events unique index
      sequence: (() => {
        const parsed = parseInt(String(p.sequenceNumber ?? ''), 10);
        if (Number.isFinite(parsed) && parsed > 0 && parsed <= 2147483647) return parsed;
        return epochSeconds + index;
      })(),
      match_id: dbMatchId,
      league_id: config.league_id,
      sport: config.db_sport,
      event_type: 'bpi_probability',
      home_score: homeScore,
      away_score: awayScore,
      play_data: {
        homeWinPct: p.homeWinPct,
        awayWinPct: p.awayWinPct,
        tieWinPct: p.tieWinPct,
        secondsLeft: p.secondsLeft,
        sequenceNumber: p.sequenceNumber,
        playId: p.playId
      },
      source: 'backfill'
    }));

    const { error: bpiError } = await supabase.from('game_events').upsert(bpiPayloads, {
      onConflict: 'match_id,event_type,sequence',
      ignoreDuplicates: true
    });
    
    if (bpiError) {
      log.push(`  ERROR game_events (bpi_probability) upsert ${dbMatchId}: ${bpiError.message}`);
    }
  }

  log.push(`  ✓ ${dbMatchId} mapped cleanly`);
}

Deno.serve(async (req: Request) => {
  try {
    const params = new URL(req.url).searchParams;
    const sport = params.get('sport') || 'basketball';
    const league = params.get('league') || 'nba';
    const db_sport = params.get('db_sport') || 'basketball';
    const league_id = params.get('league_id') || 'nba';
    const startDate = params.get('start') || '20260301';
    const endDate = params.get('end') || '20260312';
    const batchSize = parseInt(params.get('batch') || '10');

    const config: BackfillConfig = {
      sport, league, db_sport, league_id, startDate, endDate, batchSize
    };

    const log: string[] = [];
    log.push(`Backfill: ${sport}/${league} from ${startDate} to ${endDate}`);

    // Get all game IDs
    const gameIds = await getGameIds(config);
    log.push(`Found ${gameIds.length} games`);

    const allMatchIds = gameIds.map(id => `${id}_${league_id}`);
    const CHUNK_SIZE = 200;

    // Check which ones we already have in game_events (ground truth for episodic data)
    const existingEventsIds = new Set<string>();
    for (let i = 0; i < allMatchIds.length; i += CHUNK_SIZE) {
      const chunkIds = allMatchIds.slice(i, i + CHUNK_SIZE);
      const { data: existingEventsChunk, error: existingEventsErr } = await supabase
        .from('game_events')
        .select('match_id')
        .eq('event_type', 'box_snapshot')
        .eq('source', 'backfill')
        .in('match_id', chunkIds);
      if (existingEventsErr) {
        log.push(`WARN existing game_events chunk query failed: ${existingEventsErr.message}`);
        continue;
      }
      for (const row of (existingEventsChunk || [])) {
        if (row?.match_id) existingEventsIds.add(row.match_id);
      }
    }

    // Enforce dual-idempotency: MUST exist in live_game_state to prevent partial backfills where
    // triggers roll back live_game_state but game_events succeed.
    const existingLgsIds = new Set<string>();
    for (let i = 0; i < allMatchIds.length; i += CHUNK_SIZE) {
      const chunkIds = allMatchIds.slice(i, i + CHUNK_SIZE);
      const { data: existingLgsChunk, error: existingLgsErr } = await supabase
        .from('live_game_state')
        .select('id')
        .in('id', chunkIds);
      if (existingLgsErr) {
        log.push(`WARN existing live_game_state chunk query failed: ${existingLgsErr.message}`);
        continue;
      }
      for (const row of (existingLgsChunk || [])) {
        if (row?.id) existingLgsIds.add(row.id);
      }
    }
    
    // Strict union needed. If either is missing, we re-run the backfill.
    const toBackfill = gameIds.filter(id => {
      const fullId = `${id}_${league_id}`;
      return !(existingEventsIds.has(fullId) && existingLgsIds.has(fullId));
    });
    log.push(`Already backfilled (in game_events): ${existingEventsIds.size}, remaining: ${toBackfill.length}`);

    // Process in batches
    const batch = toBackfill.slice(0, batchSize);
    log.push(`Processing batch of ${batch.length}:`);

    for (const eventId of batch) {
      await backfillGame(eventId, config, log);
      await sleep(300); // rate limit between games
    }

    const remaining = toBackfill.length - batch.length;
    log.push(`\nDone. ${remaining} games remaining.`);
    if (remaining > 0) {
      log.push(`Run again to continue backfill.`);
    }

    return new Response(JSON.stringify({
      status: 'ok',
      total: gameIds.length,
      backfilled: existingEventsIds.size,
      processed: batch.length,
      remaining,
      log
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
