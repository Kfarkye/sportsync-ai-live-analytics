// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;
import { getRequestId, jsonResponse, safeJsonBody, weakEtag, type TimingMetric } from "../_shared/http.ts";

/**
 * Enhanced Edge Function for The Odds API - Paid Tier
 * 
 * This function securely proxies requests to The Odds API,
 * keeping the API key server-side and enabling all paid features.
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BASE_URL = 'https://api.the-odds-api.com/v4';

// Full sport key mapping
const SPORT_KEYS: Record<string, string> = {
  // Core US Sports
  'nba': 'basketball_nba',
  'basketball': 'basketball_nba',
  'wnba': 'basketball_wnba',
  'ncaab': 'basketball_ncaab',
  'mens-college-basketball': 'basketball_ncaab',
  'nfl': 'americanfootball_nfl',
  'football': 'americanfootball_nfl',
  'ncaaf': 'americanfootball_ncaaf',
  'college-football': 'americanfootball_ncaaf',
  'mlb': 'baseball_mlb',
  'baseball': 'baseball_mlb',
  'nhl': 'icehockey_nhl',
  'hockey': 'icehockey_nhl',
  // Soccer
  'soccer': 'soccer_epl',
  'eng.1': 'soccer_epl',
  'usa.1': 'soccer_usa_mls',
  'esp.1': 'soccer_spain_la_liga',
  'ger.1': 'soccer_germany_bundesliga',
  'ita.1': 'soccer_italy_serie_a',
  'fra.1': 'soccer_france_ligue_one',
  'uefa.champions': 'soccer_uefa_champs_league',
  // Other
  'ufc': 'mma_mixed_martial_arts',
  'mma': 'mma_mixed_martial_arts',
  'tennis_atp': 'tennis_atp_us_open',
  'tennis_wta': 'tennis_wta_us_open',
};

// Player prop markets by sport
const PLAYER_PROP_MARKETS: Record<string, string> = {
  'basketball_nba': 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists',
  'americanfootball_nfl': 'player_pass_yds,player_pass_tds,player_rush_yds,player_receptions,player_reception_yds,player_anytime_td',
  'baseball_mlb': 'batter_hits,batter_total_bases,pitcher_strikeouts',
  'icehockey_nhl': 'player_points,player_goals,player_shots_on_goal',
};

const MARKET_LABELS: Record<string, string> = {
  'player_points': 'PTS',
  'player_rebounds': 'REB',
  'player_assists': 'AST',
  'player_threes': '3PM',
  'player_points_rebounds_assists': 'PRA',
  'player_pass_yds': 'PASS YD',
  'player_pass_tds': 'PASS TD',
  'player_rush_yds': 'RUSH YD',
  'player_receptions': 'REC',
  'player_reception_yds': 'REC YD',
  'player_anytime_td': 'ANY TD',
  'batter_hits': 'HITS',
  'batter_total_bases': 'TB',
  'pitcher_strikeouts': 'Ks',
  'player_goals': 'GOALS',
  'player_shots_on_goal': 'SOG',
};

const normalize = (name: any): string => {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const ACTIONS = new Set([
  'featured_odds',
  'events',
  'player_props',
  'alternate_lines',
  'historical',
  'scores',
  'available_markets',
  'find_event',
]);

const CACHE_POLICIES: Record<string, string> = {
  featured_odds: 'public, max-age=10, stale-while-revalidate=20',
  events: 'public, max-age=60, stale-while-revalidate=180',
  player_props: 'public, max-age=20, stale-while-revalidate=40',
  alternate_lines: 'public, max-age=20, stale-while-revalidate=40',
  historical: 'public, max-age=300, stale-while-revalidate=600',
  scores: 'public, max-age=10, stale-while-revalidate=20',
  available_markets: 'public, max-age=120, stale-while-revalidate=300',
  find_event: 'public, max-age=60, stale-while-revalidate=120',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const requestId = getRequestId(req);
  const tStart = Date.now();
  const timings: TimingMetric[] = [];

  const respond = (
    payload: unknown,
    status = 200,
    action = 'featured_odds',
    extraHeaders: Record<string, string> = {}
  ) => {
    const cacheControl = status >= 400 ? 'no-store' : (CACHE_POLICIES[action] || 'public, max-age=15, stale-while-revalidate=30');
    const etag = status >= 400 ? null : weakEtag(`${action}|${JSON.stringify(payload).slice(0, 8192)}`);

    if (etag && req.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          'X-Request-Id': requestId,
          'X-Action': action,
          'Cache-Control': cacheControl,
          ETag: etag,
        },
      });
    }

    return jsonResponse(payload, {
      status,
      cors: corsHeaders,
      requestId,
      cacheControl,
      timings: [...timings, { name: 'total', dur: Date.now() - tStart, desc: 'request total' }],
      extraHeaders: { ...extraHeaders, 'X-Action': action, ...(etag ? { ETag: etag } : {}) },
    });
  };

  const fetchJson = async (url: string, action: string) => {
    const t0 = Date.now();
    const res = await fetch(url);
    timings.push({ name: `upstream_${action}`, dur: Date.now() - t0, desc: 'odds-api' });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[${action}] Odds API error ${res.status}: ${errText.slice(0, 250)}`);
    }
    return await res.json();
  };

  try {
    const parseStart = Date.now();
    const parsedBody = await safeJsonBody<any>(req, 64 * 1024);
    if (!parsedBody.ok) return respond({ error: parsedBody.error }, 400, 'featured_odds');
    const body = parsedBody.value || {};
    timings.push({ name: 'parse', dur: Date.now() - parseStart, desc: 'parse+validate' });

    const action = String(body.action || 'featured_odds').toLowerCase();
    if (!ACTIONS.has(action)) {
      return respond({
        error: `Unknown action: ${action}`,
        availableActions: Array.from(ACTIONS),
      }, 400, 'featured_odds');
    }

    const sportStr = String(body.sport || 'nba').toLowerCase();
    const sportKey = SPORT_KEYS[sportStr] || sportStr || 'basketball_nba';
    const requestRegions = typeof body.regions === 'string' && body.regions.trim() ? body.regions : 'us,us2';
    const eventId = typeof body.eventId === 'string' ? body.eventId : '';
    const homeTeam = typeof body.homeTeam === 'string' ? body.homeTeam : '';
    const awayTeam = typeof body.awayTeam === 'string' ? body.awayTeam : '';
    const includeRaw = body.includeRaw === true;
    const limit = Math.max(1, Math.min(250, Number(body.limit || 60) || 60));
    const daysFrom = Math.max(1, Math.min(7, Number(body.daysFrom || 1) || 1));

    const API_KEY = Deno.env.get('ODDS_API_KEY');
    if (!API_KEY) {
      return respond({ error: 'Missing ODDS_API_KEY in Supabase Secrets', error_code: 'MISSING_ODDS_API_KEY' }, 500, action);
    }

    if (action === 'featured_odds') {
      const url = `${BASE_URL}/sports/${sportKey}/odds?apiKey=${API_KEY}&regions=${requestRegions}&markets=h2h,spreads,totals&oddsFormat=american&includeLinks=true`;
      const data = await fetchJson(url, action);
      const slimmed = Array.isArray(data) ? data.slice(0, limit) : [];
      return respond(slimmed, 200, action, { 'X-Result-Count': String(slimmed.length) });
    }

    if (action === 'events') {
      const url = `${BASE_URL}/sports/${sportKey}/events?apiKey=${API_KEY}`;
      const data = await fetchJson(url, action);
      const slimmed = Array.isArray(data) ? data.slice(0, limit) : [];
      return respond(slimmed, 200, action, { 'X-Result-Count': String(slimmed.length) });
    }

    if (action === 'player_props') {
      if (!eventId) {
        return respond({ error: 'eventId required for player_props', error_code: 'MISSING_EVENT_ID', props: [] }, 400, action);
      }

      const propMarkets = body.markets || PLAYER_PROP_MARKETS[sportKey] || 'player_points';
      const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/odds?apiKey=${API_KEY}&regions=us&markets=${propMarkets}&oddsFormat=american`;
      const data = await fetchJson(url, action);

      const playerProps: Record<string, any> = {};
      const bookmakers = data.bookmakers || [];
      const book = bookmakers.find((b: any) => b.key === 'draftkings') ||
        bookmakers.find((b: any) => b.key === 'fanduel') ||
        bookmakers[0];

      if (book) {
        for (const market of book.markets || []) {
          const label = MARKET_LABELS[market.key] || market.key.replace(/_/g, ' ').toUpperCase();
          for (const outcome of market.outcomes || []) {
            const playerName = outcome.description;
            if (!playerName) continue;

            const key = normalize(playerName);
            if (!key) continue;

            if (!playerProps[key]) {
              playerProps[key] = {
                name: playerName,
                market: market.key,
                label,
                line: outcome.point,
                overPrice: '',
                underPrice: '',
                bookmaker: book.title
              };
            }

            if (outcome.name === 'Over') playerProps[key].overPrice = String(outcome.price);
            if (outcome.name === 'Under') playerProps[key].underPrice = String(outcome.price);
          }
        }
      }

      return respond(
        includeRaw
          ? { props: Object.values(playerProps), raw: data }
          : { props: Object.values(playerProps) },
        200,
        action,
        { 'X-Result-Count': String(Object.keys(playerProps).length) }
      );
    }

    if (action === 'alternate_lines') {
      if (!eventId) {
        return respond({ error: 'eventId required for alternate_lines', error_code: 'MISSING_EVENT_ID' }, 400, action);
      }
      const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/odds?apiKey=${API_KEY}&regions=us&markets=alternate_spreads,alternate_totals&oddsFormat=american`;
      const data = await fetchJson(url, action);
      return respond(data, 200, action);
    }

    if (action === 'historical') {
      const date = typeof body.date === 'string' ? body.date : '';
      if (!date) {
        return respond({ error: 'date required for historical odds (ISO 8601 format)', error_code: 'MISSING_DATE' }, 400, action);
      }
      const url = `${BASE_URL}/historical/sports/${sportKey}/odds?apiKey=${API_KEY}&date=${date}&regions=us&markets=h2h,spreads,totals`;
      const data = await fetchJson(url, action);
      return respond(data, 200, action);
    }

    if (action === 'scores') {
      const url = `${BASE_URL}/sports/${sportKey}/scores?apiKey=${API_KEY}&daysFrom=${daysFrom}`;
      const data = await fetchJson(url, action);
      const slimmed = Array.isArray(data) ? data.slice(0, limit) : [];
      return respond(slimmed, 200, action, { 'X-Result-Count': String(slimmed.length) });
    }

    if (action === 'available_markets') {
      if (!eventId) {
        return respond({ error: 'eventId required for available_markets', error_code: 'MISSING_EVENT_ID' }, 400, action);
      }
      const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/markets?apiKey=${API_KEY}`;
      const data = await fetchJson(url, action);
      return respond(data, 200, action);
    }

    // find_event
    if (!homeTeam || !awayTeam) {
      return respond({ error: 'homeTeam and awayTeam required for find_event', error_code: 'MISSING_TEAMS', eventId: null, props: {} }, 400, action);
    }

    const events = await fetchJson(`${BASE_URL}/sports/${sportKey}/events?apiKey=${API_KEY}`, action);
    const h = normalize(homeTeam);
    const a = normalize(awayTeam);

    const match = Array.isArray(events) ? events.find((e: any) => {
      const eh = normalize(e.home_team);
      const ea = normalize(e.away_team);
      return (eh && (eh.includes(h) || h.includes(eh))) && (ea && (ea.includes(a) || a.includes(ea)));
    }) : null;

    if (!match) {
      return respond({ eventId: null, props: {}, message: 'No matching event found' }, 200, action);
    }

    const propMarkets = PLAYER_PROP_MARKETS[sportKey] || 'player_points';
    const oddsData = await fetchJson(
      `${BASE_URL}/sports/${sportKey}/events/${match.id}/odds?apiKey=${API_KEY}&regions=us&markets=${propMarkets}&oddsFormat=american`,
      action
    );

    const bookmakers = oddsData.bookmakers || [];
    const book = bookmakers.find((b: any) => b.key === 'draftkings') ||
      bookmakers.find((b: any) => b.key === 'fanduel') ||
      bookmakers[0];

    const playerProps: Record<string, any> = {};
    if (book) {
      for (const m of book.markets || []) {
        const label = MARKET_LABELS[m.key] || 'PROP';
        for (const outcome of m.outcomes || []) {
          const playerName = outcome.description || outcome.name;
          if (!playerName) continue;
          const key = normalize(playerName);
          if (!key) continue;
          if (!playerProps[key]) {
            playerProps[key] = {
              label,
              line: outcome.point,
              overPrice: '',
              underPrice: '',
              bookmaker: book.title
            };
          }
          if (outcome.name === 'Over') playerProps[key].overPrice = String(outcome.price);
          if (outcome.name === 'Under') playerProps[key].underPrice = String(outcome.price);
        }
      }
    }

    const response = { eventId: match.id, props: playerProps };
    console.log(JSON.stringify({
      level: 'info',
      requestId,
      fn: 'get-odds',
      action,
      sportKey,
      resultCount: Object.keys(playerProps).length,
      elapsedMs: Date.now() - tStart,
    }));
    return respond(response, 200, action, { 'X-Result-Count': String(Object.keys(playerProps).length) });
  } catch (error: any) {
    console.error(JSON.stringify({
      level: 'error',
      requestId,
      fn: 'get-odds',
      message: error?.message || 'Internal server error',
      elapsedMs: Date.now() - tStart,
    }));
    return respond({ error: error?.message || 'Internal server error', error_code: 'INTERNAL' }, 500, 'featured_odds');
  }
});
