// ============================================================================
// EDGE FUNCTION: ingest-poly-sports
// Polymarket → poly_odds pipeline
// 
// Architecture:
//   1. GET gamma-api.polymarket.com/sports → discover series_ids
//   2. For each mapped league: GET /events?series_id=X&active=true&tag_id=100639
//   3. Parse outcomePrices (share price = probability, no conversion needed)
//   4. Upsert to poly_odds with fuzzy team-name matching to games table
//
// Trigger: Cron every 5 minutes during active game windows
// Auth: CRON_SECRET header validation
// ============================================================================

export {};
declare const Deno: any;

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// Structured logging — no silent failures
const log = {
  info: (event: string, data: Record<string, any> = {}) =>
    console.log(JSON.stringify({ level: 'INFO', ts: new Date().toISOString(), fn: 'ingest-poly-sports', event, ...data })),
  warn: (event: string, data: Record<string, any> = {}) =>
    console.warn(JSON.stringify({ level: 'WARN', ts: new Date().toISOString(), fn: 'ingest-poly-sports', event, ...data })),
  error: (event: string, data: Record<string, any> = {}) =>
    console.error(JSON.stringify({ level: 'ERROR', ts: new Date().toISOString(), fn: 'ingest-poly-sports', event, ...data })),
};

// ── Constants ──────────────────────────────────────────────────────────────
const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API  = 'https://clob.polymarket.com';

// tag_id=100639 filters to individual game bets (not futures/props)
const GAME_BET_TAG = '100639';

// Rate limiting: 100ms between API calls to be respectful
const API_DELAY_MS = 100;

// ── Helpers ────────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function fetchJSON(url: string, label: string): Promise<any> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      log.warn('FETCH_NON_OK', { url: label, status: res.status, ms: Date.now() - start });
      return null;
    }
    const data = await res.json();
    log.info('FETCH_OK', { url: label, ms: Date.now() - start, count: Array.isArray(data) ? data.length : 1 });
    return data;
  } catch (err: any) {
    log.error('FETCH_FAIL', { url: label, error: err.message, ms: Date.now() - start });
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalize team name for fuzzy matching.
 * "Los Angeles Lakers" → "losangeleslakers"
 * "LA Lakers"          → "lalakers"
 * Used to match Polymarket team names to our games table.
 */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^the/, '');
}

/**
 * Parse Polymarket event into structured probability data.
 * 
 * Polymarket events contain:
 *   - title: "Team A vs Team B" 
 *   - outcomes: ["Team A", "Team B"] or ["Team A", "Team B", "Draw"]
 *   - outcomePrices: ["0.5800", "0.4200"] — these ARE probabilities
 */
function parsePolyEvent(event: any): {
  poly_event_id: string;
  poly_event_slug: string;
  home_team_name: string;
  away_team_name: string;
  home_prob: number;
  away_prob: number;
  draw_prob: number | null;
  volume: number;
  game_start_time: string;
  poly_condition_id: string | null;
} | null {
  try {
    const markets = event.markets || [];
    if (!markets.length) return null;

    // Primary market is the moneyline/match winner
    const market = markets[0];
    const outcomes: string[] = JSON.parse(market.outcomes || '[]');
    const prices: string[] = JSON.parse(market.outcomePrices || '[]');

    if (outcomes.length < 2 || prices.length < 2) return null;

    // Determine home/away from outcome order (Polymarket: home first)
    const homeProb = parseFloat(prices[0]) || 0;
    const awayProb = parseFloat(prices[1]) || 0;
    const drawProb = prices.length > 2 ? (parseFloat(prices[2]) || null) : null;

    // Volume in USD
    const volume = parseFloat(market.volume || event.volume || '0');

    return {
      poly_event_id: String(event.id),
      poly_event_slug: event.slug || '',
      home_team_name: outcomes[0] || 'Unknown',
      away_team_name: outcomes[1] || 'Unknown',
      home_prob: Math.round(homeProb * 10000) / 10000,  // 4 decimal precision
      away_prob: Math.round(awayProb * 10000) / 10000,
      draw_prob: drawProb !== null ? Math.round(drawProb * 10000) / 10000 : null,
      volume,
      game_start_time: event.startDate || event.endDate || new Date().toISOString(),
      poly_condition_id: market.conditionId || null,
    };
  } catch (err: any) {
    log.warn('PARSE_EVENT_FAIL', { event_id: event?.id, error: err.message });
    return null;
  }
}

/**
 * Try to match a Polymarket event to an existing game in our matches table.
 * Uses fuzzy team name matching + date proximity.
 */
async function matchToGame(
  supabase: any,
  parsed: { home_team_name: string; away_team_name: string; game_start_time: string; },
  leagueId: string
): Promise<string | null> {
  try {
    const gameDate = new Date(parsed.game_start_time);
    const dayStart = new Date(gameDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(gameDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Query matches for this league on this date
    const { data: matches, error } = await supabase
      .from('matches')
      .select('id, home_team, away_team, start_time, league_id')
      .eq('league_id', leagueId)
      .gte('start_time', dayStart.toISOString())
      .lte('start_time', dayEnd.toISOString());

    if (error || !matches?.length) return null;

    const normHome = normalizeTeamName(parsed.home_team_name);
    const normAway = normalizeTeamName(parsed.away_team_name);

    // Try exact normalized match first
    for (const match of matches) {
      const mHome = normalizeTeamName(match.home_team || '');
      const mAway = normalizeTeamName(match.away_team || '');

      // Direct match
      if ((mHome.includes(normHome) || normHome.includes(mHome)) &&
          (mAway.includes(normAway) || normAway.includes(mAway))) {
        return match.id;
      }
      // Reversed (home/away flip between sources)
      if ((mHome.includes(normAway) || normAway.includes(mHome)) &&
          (mAway.includes(normHome) || normHome.includes(mAway))) {
        return match.id;
      }
    }

    return null;
  } catch (err: any) {
    log.warn('MATCH_FAIL', { error: err.message });
    return null;
  }
}

// ── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const runStart = Date.now();
  const errors: any[] = [];
  let leaguesQueried = 0;
  let eventsFound = 0;
  let eventsUpserted = 0;
  let eventsMatched = 0;

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const cronSecret  = Deno.env.get('CRON_SECRET') || '';
    const reqSecret   = req.headers.get('x-cron-secret') ?? '';

    if (cronSecret && !timingSafeEqual(cronSecret, reqSecret)) {
      log.warn('AUTH_FAIL');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl!, supabaseKey!);
    log.info('START');

    // ── Step 1: Get league mappings ───────────────────────────────────────
    const { data: leagueMaps, error: mapErr } = await supabase
      .from('poly_league_map')
      .select('*')
      .eq('active', true);

    if (mapErr || !leagueMaps?.length) {
      log.error('NO_LEAGUE_MAPS', { error: mapErr?.message });
      throw new Error('No active league mappings found');
    }

    log.info('LEAGUE_MAPS_LOADED', { count: leagueMaps.length });

    // ── Step 2: Discover sports from Polymarket (optional refresh) ────────
    // We rely on poly_league_map seed data rather than live /sports discovery
    // to avoid schema drift. /sports endpoint used only for initial seeding.

    // ── Step 3: Fetch events per league ───────────────────────────────────
    const allParsed: any[] = [];

    for (const map of leagueMaps) {
      leaguesQueried++;
      
      const url = `${GAMMA_API}/events?series_id=${map.poly_series_id}&active=true&closed=false&tag_id=${GAME_BET_TAG}&limit=50`;
      const events = await fetchJSON(url, `events:${map.display_name}`);
      
      if (!events || !Array.isArray(events)) {
        errors.push({ league: map.display_name, error: 'null_response' });
        await sleep(API_DELAY_MS);
        continue;
      }

      for (const event of events) {
        eventsFound++;
        const parsed = parsePolyEvent(event);
        if (!parsed) continue;

        // Attach league context
        const enriched = {
          ...parsed,
          local_league_id: map.local_league_id,
          poly_series_id: map.poly_series_id,
        };

        // Try to match to existing game
        const gameId = await matchToGame(supabase, parsed, map.local_league_id);
        if (gameId) {
          enriched.game_id = gameId;
          eventsMatched++;
        }

        allParsed.push(enriched);
      }

      await sleep(API_DELAY_MS);
    }

    log.info('EVENTS_PARSED', { total: eventsFound, parsed: allParsed.length, matched: eventsMatched });

    // ── Step 4: Batch upsert to poly_odds ─────────────────────────────────
    if (allParsed.length > 0) {
      // Upsert in batches of 50
      const BATCH = 50;
      for (let i = 0; i < allParsed.length; i += BATCH) {
        const batch = allParsed.slice(i, i + BATCH).map(p => ({
          poly_event_id:     p.poly_event_id,
          poly_event_slug:   p.poly_event_slug,
          poly_condition_id: p.poly_condition_id,
          home_prob:         p.home_prob,
          away_prob:         p.away_prob,
          draw_prob:         p.draw_prob,
          volume:            p.volume,
          home_team_name:    p.home_team_name,
          away_team_name:    p.away_team_name,
          local_league_id:   p.local_league_id,
          poly_series_id:    p.poly_series_id,
          game_start_time:   p.game_start_time,
          game_id:           p.game_id || null,
          market_active:     true,
          poly_updated_at:   new Date().toISOString(),
        }));

        const { error: upsertErr, count } = await supabase
          .from('poly_odds')
          .upsert(batch, { 
            onConflict: 'poly_event_id',
            count: 'exact',
          });

        if (upsertErr) {
          log.error('UPSERT_FAIL', { batch: i / BATCH, error: upsertErr.message });
          errors.push({ batch: i / BATCH, error: upsertErr.message });
        } else {
          eventsUpserted += batch.length;
        }
      }
    }

    // ── Step 5: Mark stale markets as inactive ────────────────────────────
    // Any poly_odds row not updated in this run and starting > 4hrs ago = stale
    const staleThreshold = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('poly_odds')
      .update({ market_active: false })
      .lt('game_start_time', staleThreshold)
      .eq('market_active', true)
      .lt('poly_updated_at', new Date(runStart).toISOString());

    // ── Step 6: Write telemetry ───────────────────────────────────────────
    const duration = Date.now() - runStart;
    const status = errors.length === 0 ? 'success' : (eventsUpserted > 0 ? 'partial' : 'failure');

    await supabase.from('poly_ingest_log').insert({
      leagues_queried: leaguesQueried,
      events_found:    eventsFound,
      events_upserted: eventsUpserted,
      events_matched:  eventsMatched,
      errors:          errors,
      duration_ms:     duration,
      status,
    });

    log.info('COMPLETE', { 
      leagues: leaguesQueried, 
      found: eventsFound, 
      upserted: eventsUpserted, 
      matched: eventsMatched,
      errors: errors.length,
      ms: duration,
      status,
    });

    return new Response(JSON.stringify({
      status,
      leagues_queried: leaguesQueried,
      events_found:    eventsFound,
      events_upserted: eventsUpserted,
      events_matched:  eventsMatched,
      errors:          errors.length,
      duration_ms:     duration,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err: any) {
    const duration = Date.now() - runStart;
    log.error('FATAL', { error: err.message, stack: err.stack, ms: duration });

    return new Response(JSON.stringify({ 
      status: 'failure', 
      error: err.message,
      duration_ms: duration,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
