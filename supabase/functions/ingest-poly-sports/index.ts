// ============================================================================
// EDGE FUNCTION: ingest-poly-sports v5
// Polymarket → poly_odds pipeline
//
// v5: Multi-market ingestion
//   - Iterates ALL markets per event (moneyline, spread, total)
//   - Classifies market_type from outcome names
//   - Extracts spread_line and total_line from outcome text
//   - Upserts on poly_condition_id (market-level, not event-level)
//   - Parses game_date from slug for timezone-aware matching
// ============================================================================

export {};
declare const Deno: any;

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const log = {
  info: (event: string, data: Record<string, any> = {}) =>
    console.log(JSON.stringify({ level: 'INFO', ts: new Date().toISOString(), fn: 'ingest-poly-sports', event, ...data })),
  warn: (event: string, data: Record<string, any> = {}) =>
    console.warn(JSON.stringify({ level: 'WARN', ts: new Date().toISOString(), fn: 'ingest-poly-sports', event, ...data })),
  error: (event: string, data: Record<string, any> = {}) =>
    console.error(JSON.stringify({ level: 'ERROR', ts: new Date().toISOString(), fn: 'ingest-poly-sports', event, ...data })),
};

const GAMMA_API = 'https://gamma-api.polymarket.com';
const GAME_BET_TAG = '100639';
const API_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^the/, '');
}

function parseDateFromSlug(slug: string): string | null {
  const match = slug.match(/(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : null;
}

// ── Market classification ───────────────────────────────────────────────

interface ClassifiedMarket {
  market_type: 'moneyline' | 'spread' | 'total' | 'prop';
  home_team_name: string;
  away_team_name: string;
  home_prob: number;
  away_prob: number;
  draw_prob: number | null;
  spread_line: number | null;
  total_line: number | null;
  volume: number;
  poly_condition_id: string;
}

function classifyMarket(market: any): ClassifiedMarket | null {
  try {
    const outcomes: string[] = JSON.parse(market.outcomes || '[]');
    const prices: string[] = JSON.parse(market.outcomePrices || '[]');
    if (outcomes.length < 2 || prices.length < 2) return null;

    const homeProb = parseFloat(prices[0]) || 0;
    const awayProb = parseFloat(prices[1]) || 0;
    const drawProb = prices.length > 2 ? (parseFloat(prices[2]) || null) : null;
    const volume = parseFloat(market.volume || '0');
    const conditionId = market.conditionId || null;
    if (!conditionId) return null;

    const o0 = outcomes[0] || '';
    const o1 = outcomes[1] || '';
    const o0Lower = o0.toLowerCase();
    const o1Lower = o1.toLowerCase();

    // Total: "Over X" / "Under X"
    if (o0Lower === 'over' || o0Lower === 'under' || o1Lower === 'over' || o1Lower === 'under') {
      const lineMatch = (market.question || '').match(/(\d+\.?\d*)/);
      return {
        market_type: 'total',
        home_team_name: o0,
        away_team_name: o1,
        home_prob: Math.round(homeProb * 10000) / 10000,
        away_prob: Math.round(awayProb * 10000) / 10000,
        draw_prob: null,
        spread_line: null,
        total_line: lineMatch ? parseFloat(lineMatch[1]) : null,
        volume,
        poly_condition_id: conditionId,
      };
    }

    // Spread: outcomes contain +/- numbers like "Thunder -6.5"
    const spreadMatch0 = o0.match(/([+-]\d+\.?\d*)/);
    const spreadMatch1 = o1.match(/([+-]\d+\.?\d*)/);
    if (spreadMatch0 || spreadMatch1) {
      const line = spreadMatch0 ? parseFloat(spreadMatch0[1]) : (spreadMatch1 ? parseFloat(spreadMatch1[1]) : null);
      const cleanHome = o0.replace(/\s*[+-]\d+\.?\d*\s*/, '').trim();
      const cleanAway = o1.replace(/\s*[+-]\d+\.?\d*\s*/, '').trim();
      return {
        market_type: 'spread',
        home_team_name: cleanHome || o0,
        away_team_name: cleanAway || o1,
        home_prob: Math.round(homeProb * 10000) / 10000,
        away_prob: Math.round(awayProb * 10000) / 10000,
        draw_prob: drawProb !== null ? Math.round(drawProb * 10000) / 10000 : null,
        spread_line: line,
        total_line: null,
        volume,
        poly_condition_id: conditionId,
      };
    }

    // Moneyline: team names as outcomes
    return {
      market_type: 'moneyline',
      home_team_name: o0,
      away_team_name: o1,
      home_prob: Math.round(homeProb * 10000) / 10000,
      away_prob: Math.round(awayProb * 10000) / 10000,
      draw_prob: drawProb !== null ? Math.round(drawProb * 10000) / 10000 : null,
      spread_line: null,
      total_line: null,
      volume,
      poly_condition_id: conditionId,
    };
  } catch (err: any) {
    log.warn('CLASSIFY_FAIL', { error: err.message });
    return null;
  }
}

async function matchToGame(
  supabase: any,
  homeTeam: string,
  awayTeam: string,
  gameDate: string | null,
  leagueId: string
): Promise<string | null> {
  try {
    if (!gameDate) return null;
    if (homeTeam === 'Over' || homeTeam === 'Under') return null;

    const nextDate = new Date(gameDate + 'T00:00:00Z');
    nextDate.setUTCDate(nextDate.getUTCDate() + 2);
    const endDateStr = nextDate.toISOString().split('T')[0];

    const { data: matches, error } = await supabase
      .from('matches')
      .select('id, home_team, away_team, start_time, league_id')
      .eq('league_id', leagueId)
      .gte('start_time', gameDate + 'T00:00:00Z')
      .lt('start_time', endDateStr + 'T00:00:00Z');

    if (error || !matches?.length) return null;

    const normHome = normalizeTeamName(homeTeam);
    const normAway = normalizeTeamName(awayTeam);

    for (const match of matches) {
      const mHome = normalizeTeamName(match.home_team || '');
      const mAway = normalizeTeamName(match.away_team || '');

      if ((mHome.includes(normHome) || normHome.includes(mHome)) &&
          (mAway.includes(normAway) || normAway.includes(mAway))) {
        return match.id;
      }
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const runStart = Date.now();
  const errors: any[] = [];
  let leaguesQueried = 0;
  let eventsFound = 0;
  let marketsFound = 0;
  let marketsUpserted = 0;
  let marketsMatched = 0;
  const typeCounts: Record<string, number> = { moneyline: 0, spread: 0, total: 0, prop: 0 };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl!, supabaseKey!);
    log.info('START');

    const { data: leagueMaps, error: mapErr } = await supabase
      .from('poly_league_map')
      .select('*')
      .eq('active', true);

    if (mapErr || !leagueMaps?.length) {
      log.error('NO_LEAGUE_MAPS', { error: mapErr?.message });
      throw new Error('No active league mappings found');
    }

    log.info('LEAGUE_MAPS_LOADED', { count: leagueMaps.length });

    const allRows: any[] = [];
    const gameIdCache: Record<string, string | null> = {};

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
        const markets = event.markets || [];
        const slug = event.slug || '';
        const gameDate = parseDateFromSlug(slug);
        const eventId = String(event.id);

        for (const market of markets) {
          marketsFound++;
          const classified = classifyMarket(market);
          if (!classified) continue;

          typeCounts[classified.market_type] = (typeCounts[classified.market_type] || 0) + 1;

          let gameId: string | null = null;
          if (slug in gameIdCache) {
            gameId = gameIdCache[slug];
          } else if (classified.market_type === 'moneyline') {
            gameId = await matchToGame(supabase, classified.home_team_name, classified.away_team_name, gameDate, map.local_league_id);
            gameIdCache[slug] = gameId;
            if (gameId) marketsMatched++;
          }
          if (!gameId && slug in gameIdCache) {
            gameId = gameIdCache[slug];
          }

          allRows.push({
            poly_event_id: eventId,
            poly_event_slug: slug,
            poly_condition_id: classified.poly_condition_id,
            market_type: classified.market_type,
            home_prob: classified.home_prob,
            away_prob: classified.away_prob,
            draw_prob: classified.draw_prob,
            spread_line: classified.spread_line,
            total_line: classified.total_line,
            volume: classified.volume,
            home_team_name: classified.home_team_name,
            away_team_name: classified.away_team_name,
            local_league_id: map.local_league_id,
            poly_series_id: map.poly_series_id,
            game_start_time: event.startDate || event.endDate || new Date().toISOString(),
            game_date: gameDate,
            game_id: gameId || null,
            market_active: true,
            poly_updated_at: new Date().toISOString(),
          });
        }
      }

      await sleep(API_DELAY_MS);
    }

    log.info('MARKETS_PARSED', { events: eventsFound, markets: marketsFound, rows: allRows.length, types: typeCounts, matched: marketsMatched });

    if (allRows.length > 0) {
      const BATCH = 50;
      for (let i = 0; i < allRows.length; i += BATCH) {
        const batch = allRows.slice(i, i + BATCH);

        const { error: upsertErr } = await supabase
          .from('poly_odds')
          .upsert(batch, {
            onConflict: 'poly_condition_id',
            count: 'exact',
          });

        if (upsertErr) {
          log.error('UPSERT_FAIL', { batch: i / BATCH, error: upsertErr.message });
          errors.push({ batch: i / BATCH, error: upsertErr.message });
        } else {
          marketsUpserted += batch.length;
        }
      }
    }

    // Mark stale
    const staleThreshold = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('poly_odds')
      .update({ market_active: false })
      .lt('game_start_time', staleThreshold)
      .eq('market_active', true)
      .lt('poly_updated_at', new Date(runStart).toISOString());

    // Telemetry
    const duration = Date.now() - runStart;
    const status = errors.length === 0 ? 'success' : (marketsUpserted > 0 ? 'partial' : 'failure');

    await supabase.from('poly_ingest_log').insert({
      leagues_queried: leaguesQueried,
      events_found: eventsFound,
      events_upserted: marketsUpserted,
      events_matched: marketsMatched,
      errors: errors,
      duration_ms: duration,
      status,
    });

    log.info('COMPLETE', {
      leagues: leaguesQueried,
      events: eventsFound,
      markets: marketsFound,
      upserted: marketsUpserted,
      matched: marketsMatched,
      types: typeCounts,
      errors: errors.length,
      ms: duration,
      status,
    });

    return new Response(JSON.stringify({
      status,
      leagues_queried: leaguesQueried,
      events_found: eventsFound,
      markets_found: marketsFound,
      markets_upserted: marketsUpserted,
      markets_matched: marketsMatched,
      types: typeCounts,
      errors: errors.length,
      duration_ms: duration,
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
