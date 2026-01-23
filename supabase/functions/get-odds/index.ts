// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

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

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request body - handle empty body gracefully
    let body: any = {};
    try {
      const text = await req.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch (e) {
      // Empty or invalid JSON body - use defaults
    }

    const {
      action,
      sport,
      homeTeam,
      awayTeam,
      eventId,
      markets,
      regions,
      date,
      daysFrom
    } = body;

    // Get API key
    const API_KEY = Deno.env.get('ODDS_API_KEY');
    if (!API_KEY) {
      return new Response(JSON.stringify({ error: 'Missing ODDS_API_KEY in Supabase Secrets' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve sport key
    const sportStr = String(sport || 'nba').toLowerCase();
    const sportKey = SPORT_KEYS[sportStr] || sportStr || 'basketball_nba';
    const requestRegions = regions || 'us,us2';

    // =========================================================================
    // ACTION: Get Featured Odds (h2h, spreads, totals) - DEFAULT for no action
    // =========================================================================
    if (!action || action === 'featured_odds') {
      const url = `${BASE_URL}/sports/${sportKey}/odds?apiKey=${API_KEY}&regions=${requestRegions}&markets=h2h,spreads,totals&oddsFormat=american&includeLinks=true&_t=${Date.now()}`;
      const res = await fetch(url);

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Odds API error:', res.status, errorText);
        return new Response(JSON.stringify({ error: `Odds API error: ${res.status}`, events: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // ACTION: Get all events for a sport
    // =========================================================================
    if (action === 'events') {
      const url = `${BASE_URL}/sports/${sportKey}/events?apiKey=${API_KEY}`;
      const res = await fetch(url);

      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Events API error: ${res.status}`, events: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // ACTION: Get Player Props for a specific event
    // =========================================================================
    if (action === 'player_props') {
      if (!eventId) {
        return new Response(JSON.stringify({ error: 'eventId required for player_props', props: [] }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const propMarkets = markets || PLAYER_PROP_MARKETS[sportKey] || 'player_points';
      const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/odds?apiKey=${API_KEY}&regions=us&markets=${propMarkets}&oddsFormat=american&_t=${Date.now()}`;

      const res = await fetch(url);
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Props API error: ${res.status}`, props: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json();

      // Process into structured props
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

      return new Response(JSON.stringify({ props: Object.values(playerProps), raw: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // ACTION: Get Alternate Lines
    // =========================================================================
    if (action === 'alternate_lines') {
      if (!eventId) {
        return new Response(JSON.stringify({ error: 'eventId required for alternate_lines' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/odds?apiKey=${API_KEY}&regions=us&markets=alternate_spreads,alternate_totals&oddsFormat=american`;

      const res = await fetch(url);
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Alternates API error: ${res.status}` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // ACTION: Get Historical Odds (Line Movement)
    // =========================================================================
    if (action === 'historical') {
      if (!date) {
        return new Response(JSON.stringify({ error: 'date required for historical odds (ISO 8601 format)' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const url = `${BASE_URL}/historical/sports/${sportKey}/odds?apiKey=${API_KEY}&date=${date}&regions=us&markets=h2h,spreads,totals`;

      const res = await fetch(url);
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Historical API error: ${res.status}` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // ACTION: Get Live Scores from Odds API
    // =========================================================================
    if (action === 'scores') {
      const days = daysFrom || 1;
      const url = `${BASE_URL}/sports/${sportKey}/scores?apiKey=${API_KEY}&daysFrom=${days}`;

      const res = await fetch(url);
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Scores API error: ${res.status}`, scores: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // ACTION: Get All Available Markets for an Event
    // =========================================================================
    if (action === 'available_markets') {
      if (!eventId) {
        return new Response(JSON.stringify({ error: 'eventId required for available_markets' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/markets?apiKey=${API_KEY}`;

      const res = await fetch(url);
      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Markets API error: ${res.status}` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // ACTION: Find event by team names and return props
    // =========================================================================
    if (action === 'find_event' || (homeTeam && awayTeam)) {
      if (!homeTeam || !awayTeam) {
        return new Response(JSON.stringify({ error: 'homeTeam and awayTeam required for find_event', eventId: null, props: {} }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Find the event ID first
      const eventsRes = await fetch(`${BASE_URL}/sports/${sportKey}/events?apiKey=${API_KEY}`);
      if (!eventsRes.ok) {
        return new Response(JSON.stringify({ error: 'Failed to fetch events', eventId: null, props: {} }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const events = await eventsRes.json();

      const h = normalize(homeTeam);
      const a = normalize(awayTeam);

      const match = events.find((e: any) => {
        const eh = normalize(e.home_team);
        const ea = normalize(e.away_team);
        return (eh && (eh.includes(h) || h.includes(eh))) && (ea && (ea.includes(a) || a.includes(ea)));
      });

      if (!match) {
        return new Response(JSON.stringify({ eventId: null, props: {}, message: 'No matching event found' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Fetch props for this event
      const propMarkets = PLAYER_PROP_MARKETS[sportKey] || 'player_points';
      const oddsUrl = `${BASE_URL}/sports/${sportKey}/events/${match.id}/odds?apiKey=${API_KEY}&regions=us&markets=${propMarkets}&oddsFormat=american`;

      const oddsRes = await fetch(oddsUrl);
      const oddsData = await oddsRes.json();

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

      return new Response(JSON.stringify({ eventId: match.id, props: playerProps }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // UNKNOWN ACTION - Return helpful error
    // =========================================================================
    return new Response(JSON.stringify({
      error: `Unknown action: ${action}`,
      availableActions: [
        'featured_odds (default)',
        'events',
        'player_props (requires eventId)',
        'alternate_lines (requires eventId)',
        'historical (requires date)',
        'scores',
        'available_markets (requires eventId)',
        'find_event (requires homeTeam, awayTeam)'
      ]
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
