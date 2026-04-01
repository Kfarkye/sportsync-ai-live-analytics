/* ============================================================================
   functions/handlers/liveGameIntel.js
   
   LIVE GAME INTELLIGENCE ENDPOINT
   ────────────────────────────────
   Public, unauthenticated JSON endpoint serving the full game intelligence
   packet for a given game ID. One endpoint, three consumers:
   
     🧑 Human  → React UI fetches this for the PBP feed & match detail page
     🤖 AI     → Gemini's urlContext fetches this for zero-hallucination analysis
     🕷️ Bots   → Crawlers read the structured JSON for SEO/indexing
   
   Endpoint: /api/live/game/{gameId}
   Method: GET
   Auth: None (public, CDN-cached)
   
   Shape: Complete game state including scores, plays, player stats,
          team stats, momentum, advanced metrics, and odds.
============================================================================ */

import { createClient } from '@supabase/supabase-js';
import * as logger from 'firebase-functions/logger';

// Supabase client — matches liveSatellite pattern
// Note: .env may contain placeholder values that Firebase loads at deploy time
const SUPABASE_PROJECT_URL = 'https://qffzvrnbzabcokqqrwbv.supabase.co';

function getSupabase() {
  const envUrl = process.env.SUPABASE_URL;
  // Only use env URL if it's not a placeholder
  const url = (envUrl && !envUrl.includes('your-project')) ? envUrl : SUPABASE_PROJECT_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!key) return null;
  return createClient(url, key);
}

/**
 * Shape raw player_stats from ESPN format into a clean, flat array per team.
 * Input: [{teamId, categories: [{labels, athletes: [{id, name, stats, headshot, position, shortName}]}]}]
 * Output: {home: [{name, headshot, position, stats: {MIN, PTS, ...}}], away: [...]}
 */
function shapePlayerStats(rawStats, homeTeamId, awayTeamId) {
  if (!Array.isArray(rawStats) || rawStats.length === 0) return null;

  const result = { home: [], away: [] };

  for (const teamBlock of rawStats) {
    const teamId = teamBlock?.teamId;
    const categories = teamBlock?.categories;
    if (!Array.isArray(categories) || categories.length === 0) continue;

    // First category has the labels and athletes
    const mainCategory = categories[0];
    const labels = mainCategory?.labels;
    const athletes = mainCategory?.athletes;
    if (!Array.isArray(labels) || !Array.isArray(athletes)) continue;

    const side = teamId === homeTeamId ? 'home' : teamId === awayTeamId ? 'away' : null;
    if (!side) continue;

    for (const athlete of athletes) {
      if (!athlete?.name) continue;
      const statValues = athlete.stats;
      if (!Array.isArray(statValues) || statValues.length === 0) continue;

      // Map labels → values into a clean object
      const stats = {};
      labels.forEach((label, idx) => {
        stats[label] = statValues[idx] ?? null;
      });

      result[side].push({
        id: athlete.id || null,
        name: athlete.name,
        short_name: athlete.shortName || null,
        position: athlete.position || null,
        headshot: athlete.headshot || null,
        stats,
      });
    }
  }

  return result;
}

/**
 * Shape team comparison stats.
 * Input: [{label, homeValue, awayValue}]
 * Output: [{stat, home, away}]
 */
function shapeTeamStats(rawStats) {
  if (!Array.isArray(rawStats)) return null;
  return rawStats.map(s => ({
    stat: s?.label || 'Unknown',
    home: s?.homeValue ?? null,
    away: s?.awayValue ?? null,
  }));
}

/**
 * Shape momentum/win probability timeline.
 * Input: [{value, minute, winProb}]
 * Output: as-is, already clean
 */
function shapeMomentum(rawMomentum) {
  if (!Array.isArray(rawMomentum)) return null;
  return rawMomentum;
}

/**
 * Shape odds with opening snapshots.
 */
function shapeOdds(rawOdds, t0Snapshot, t60Snapshot) {
  const current = rawOdds?.current || rawOdds || {};
  const opening = t0Snapshot?.odds || t60Snapshot?.odds || {};
  
  return {
    current: {
      spread_home: current.homeSpread ?? current.spread ?? null,
      total: current.total ?? null,
      moneyline_home: current.homeML ?? current.moneylineHome ?? current.moneyline_home ?? null,
      moneyline_away: current.awayML ?? current.moneylineAway ?? current.moneyline_away ?? null,
      provider: current.provider ?? current.market_source_book ?? null,
      is_live: current.isLive ?? false,
      updated_at: current.updatedAt ?? null,
    },
    opening: {
      spread_home: opening.homeSpread ?? opening.spread ?? null,
      total: opening.total ?? null,
      moneyline_home: opening.homeML ?? opening.moneylineHome ?? null,
      moneyline_away: opening.awayML ?? opening.moneylineAway ?? null,
    },
  };
}

/**
 * Main handler for /api/live/game/{gameId}
 */
export async function handleLiveGameIntel(req, res) {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Parse gameId from path: /api/live/game/{gameId} or just /{gameId}
  // Firebase Hosting passes the full path through the rewrite
  const pathParts = (req.path || '').replace(/^\/+/, '').split('/').filter(Boolean);
  let gameId = null;
  
  if (pathParts.length >= 4 && pathParts[0] === 'api' && pathParts[1] === 'live' && pathParts[2] === 'game') {
    // Full path: /api/live/game/{gameId}
    gameId = pathParts[3];
  } else if (pathParts.length === 1) {
    // Direct invocation: /{gameId}
    gameId = pathParts[0];
  } else if (pathParts.length >= 2 && pathParts[0] === 'game') {
    // Partial path: /game/{gameId}
    gameId = pathParts[1];
  }
  
  // Fallback to query param
  if (!gameId) gameId = req.query.gameId || req.query.id;

  if (!gameId) {
    res.status(400).json({ error: 'gameId required', usage: '/api/live/game/{gameId}' });
    return;
  }

  const supabase = getSupabase();
  if (!supabase) {
    logger.error('Supabase credentials not configured for liveGameIntel');
    res.status(500).json({ error: 'Server not configured' });
    return;
  }

  try {
    const { data, error } = await supabase
      .from('live_game_state')
      .select(`
        id, sport, league_id, game_status, period, clock, display_clock,
        home_team, away_team, home_score, away_score,
        recent_plays, last_play, player_stats, leaders,
        stats, momentum, advanced_metrics,
        odds, t0_snapshot, t60_snapshot,
        match_context, predictor,
        start_time, updated_at
      `)
      .eq('id', gameId)
      .maybeSingle();

    if (error) throw error;
    
    // Fallback: if exact match fails and gameId is purely numeric (no league suffix),
    // try a prefix match (e.g., "401810959" → "401810959_nba")
    let row = data;
    if (!row && /^\d+$/.test(gameId)) {
      logger.info(`Exact match not found for ${gameId}, trying prefix match`);
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('live_game_state')
        .select(`
          id, sport, league_id, game_status, period, clock, display_clock,
          home_team, away_team, home_score, away_score,
          recent_plays, last_play, player_stats, leaders,
          stats, momentum, advanced_metrics,
          odds, t0_snapshot, t60_snapshot,
          match_context, predictor,
          start_time, updated_at
        `)
        .like('id', `${gameId}_%`)
        .maybeSingle();
      if (fallbackError) throw fallbackError;
      row = fallbackData;
    }
    
    if (!row) {
      res.status(404).json({ error: 'Game not found', game_id: gameId });
      return;
    }

    // Determine team IDs from player_stats blocks (ESPN uses teamId in the data)
    let homeTeamId = null;
    let awayTeamId = null;
    if (Array.isArray(row.player_stats) && row.player_stats.length >= 2) {
      // Convention: first block is away, second is home (ESPN pattern)
      // We identify by checking if team names match
      for (const block of row.player_stats) {
        if (!block?.teamId) continue;
        // We can't definitively map without team IDs in the main row,
        // so we use position: first block = away team in ESPN data
      }
      // Heuristic: just use the teamIds from the blocks
      awayTeamId = row.player_stats[0]?.teamId || null;
      homeTeamId = row.player_stats[1]?.teamId || null;
    }

    // Determine league from id suffix or league_id
    const idParts = (row.id || '').split('_');
    const leagueSuffix = idParts.length > 1 ? idParts[idParts.length - 1] : null;
    const league = row.league_id || leagueSuffix || 'unknown';

    // Build the response — the single source of truth
    const gameIntel = {
      // === Identity ===
      game_id: row.id,
      sport: row.sport || 'unknown',
      league,
      status: row.game_status,
      
      // === Game Clock ===
      period: row.period,
      clock: row.display_clock || row.clock || null,
      start_time: row.start_time,
      
      // === Score ===
      score: {
        home: { team: row.home_team, score: row.home_score },
        away: { team: row.away_team, score: row.away_score },
      },
      
      // === Play-by-Play ===
      last_play: row.last_play || null,
      recent_plays: Array.isArray(row.recent_plays) ? row.recent_plays : [],
      
      // === Player Stats (full box score) ===
      player_stats: shapePlayerStats(row.player_stats, homeTeamId, awayTeamId),
      
      // === Team Comparison Stats ===
      team_stats: shapeTeamStats(row.stats),
      
      // === Momentum / Win Probability ===
      momentum: shapeMomentum(row.momentum),
      
      // === Advanced Metrics ===
      advanced_metrics: row.advanced_metrics || null,
      
      // === Odds ===
      odds: shapeOdds(row.odds, row.t0_snapshot, row.t60_snapshot),
      
      // === Context ===
      match_context: row.match_context || null,
      predictor: row.predictor || null,
      
      // === Metadata ===
      updated_at: row.updated_at,
      
      // === Machine Contract ===
      _meta: {
        version: '1.0',
        endpoint: `/api/live/game/${row.id}`,
        description: 'Live game intelligence packet. Same data powers the UI and AI analysis.',
        consumers: ['human_ui', 'gemini_urlcontext', 'seo_crawlers'],
      },
    };

    // Cache: 15s fresh, 30s stale-while-revalidate
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
    res.json(gameIntel);

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
    console.error(`[liveGameIntel] gameId=${gameId} error=${errMsg}`);
    res.status(500).json({ error: 'Internal error' });
  }
}
