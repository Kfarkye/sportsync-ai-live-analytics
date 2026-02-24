import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

declare const Deno: any;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPORT_TO_LEAGUE: Record<string, string> = {
  'basketball_nba': 'nba', 'nba': 'nba', 'basketball': 'nba',
  'americanfootball_nfl': 'nfl', 'nfl': 'nfl', 'football': 'nfl',
  'baseball_mlb': 'mlb', 'mlb': 'mlb', 'baseball': 'mlb',
  'icehockey_nhl': 'nhl', 'nhl': 'nhl', 'hockey': 'nhl',
  'basketball_ncaab': 'mens-college-basketball', 'ncaab': 'mens-college-basketball', 'mens-college-basketball': 'mens-college-basketball',
  'americanfootball_ncaaf': 'college-football', 'ncaaf': 'college-football', 'college-football': 'college-football',
  'soccer_epl': 'eng.1', 'eng.1': 'eng.1', 'epl': 'eng.1', 'soccer': 'eng.1',
  'soccer_spain_la_liga': 'esp.1', 'esp.1': 'esp.1', 'laliga': 'esp.1',
  'soccer_italy_serie_a': 'ita.1', 'ita.1': 'ita.1', 'seriea': 'ita.1',
  'soccer_germany_bundesliga': 'ger.1', 'ger.1': 'ger.1', 'bundesliga': 'ger.1',
  'soccer_france_ligue_one': 'fra.1', 'fra.1': 'fra.1', 'ligue1': 'fra.1',
  'soccer_usa_mls': 'usa.1', 'usa.1': 'usa.1', 'mls': 'usa.1',
  'soccer_uefa_champs_league': 'uefa.champions', 'uefa.champions': 'uefa.champions', 'ucl': 'uefa.champions',
};

const nameOf = (t: any): string =>
  typeof t === 'string' ? t : t?.displayName || t?.name || '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let body: any = {};
    try { const t = await req.text(); if (t?.trim()) body = JSON.parse(t); } catch { body = {}; }

    const { action, sport, homeTeam, awayTeam, eventId, daysFrom } = body;
    const lid = SPORT_TO_LEAGUE[String(sport || 'nba').toLowerCase()] || String(sport || 'nba').toLowerCase();

    // === DEFAULT / featured_odds ===
    if (!action || action === 'featured_odds') {
      const { data, error } = await sb
        .from('matches')
        .select('id, home_team, away_team, start_time, status, current_odds, last_odds_update, odds_api_event_id')
        .eq('league_id', lid)
        .gte('start_time', new Date(Date.now() - 12 * 3600000).toISOString())
        .lte('start_time', new Date(Date.now() + 7 * 86400000).toISOString())
        .not('status', 'in', '("STATUS_FINAL","FINAL")')
        .order('start_time', { ascending: true })
        .limit(50);

      if (error) return new Response(JSON.stringify({ error: error.message, events: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });

      const events = (data || []).map((m: any) => {
        const o = m.current_odds;
        const h = nameOf(m.home_team), a = nameOf(m.away_team);
        const mkts: any[] = [];

        if (o?.homeWin != null) {
          const oc: any[] = [{ name: h, price: o.homeWin }, { name: a, price: o.awayWin }];
          if (o.drawWin != null) oc.push({ name: 'Draw', price: o.drawWin });
          mkts.push({ key: 'h2h', last_update: o.lastUpdated, outcomes: oc });
        }
        if (o?.homeSpread != null) {
          mkts.push({
            key: 'spreads', last_update: o.lastUpdated, outcomes: [
              { name: h, price: o.homeSpreadOdds ?? -110, point: o.homeSpread },
              { name: a, price: o.awaySpreadOdds ?? -110, point: o.awaySpread ?? (o.homeSpread != null ? -1 * o.homeSpread : null) }
            ]
          });
        }
        if (o?.total != null) {
          mkts.push({
            key: 'totals', last_update: o.lastUpdated, outcomes: [
              { name: 'Over', price: o.overOdds ?? -110, point: o.total },
              { name: 'Under', price: o.underOdds ?? -110, point: o.total }
            ]
          });
        }

        return {
          id: m.odds_api_event_id || m.id,
          sport_key: lid, sport_title: lid,
          commence_time: m.start_time,
          home_team: h, away_team: a,
          bookmakers: mkts.length ? [{
            key: (o?.provider || 'consensus').toLowerCase().replace(/\s/g, ''),
            title: o?.provider || 'Consensus',
            last_update: o?.lastUpdated || m.last_odds_update,
            markets: mkts
          }] : [],
          ...(o?.vendors?.length ? { all_vendors: o.vendors } : {})
        };
      });

      return new Response(JSON.stringify(events), {
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }
      });
    }

    // === find_event ===
    if (action === 'find_event' || (homeTeam && awayTeam)) {
      if (!homeTeam || !awayTeam) return new Response(
        JSON.stringify({ error: 'homeTeam and awayTeam required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );

      const norm = (s: string) => s?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
      const h = norm(homeTeam), a = norm(awayTeam);

      const { data } = await sb.from('matches')
        .select('id, home_team, away_team, current_odds, odds_api_event_id')
        .eq('league_id', lid)
        .gte('start_time', new Date(Date.now() - 24 * 3600000).toISOString())
        .lte('start_time', new Date(Date.now() + 7 * 86400000).toISOString())
        .limit(100);

      const m = (data || []).find((m: any) => {
        const mh = norm(nameOf(m.home_team)), ma = norm(nameOf(m.away_team));
        return (mh.includes(h) || h.includes(mh)) && (ma.includes(a) || a.includes(ma));
      });

      return new Response(JSON.stringify(m
        ? { eventId: m.odds_api_event_id || m.id, odds: m.current_odds }
        : { eventId: null, message: 'No matching event' }
      ), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // === events ===
    if (action === 'events') {
      const { data } = await sb.from('matches')
        .select('id, home_team, away_team, start_time, odds_api_event_id')
        .eq('league_id', lid)
        .gte('start_time', new Date(Date.now() - 6 * 3600000).toISOString())
        .order('start_time', { ascending: true }).limit(100);

      return new Response(JSON.stringify((data || []).map((m: any) => ({
        id: m.odds_api_event_id || m.id, sport_key: lid,
        commence_time: m.start_time,
        home_team: nameOf(m.home_team), away_team: nameOf(m.away_team),
      }))), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // === player_props ===
    if (action === 'player_props') {
      if (!eventId) return new Response(JSON.stringify({ error: 'eventId required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
      const { data } = await sb.from('player_prop_bets').select('*')
        .or(`match_id.eq.${eventId},external_event_id.eq.${eventId}`).limit(200);
      return new Response(JSON.stringify({ props: data || [] }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // === scores ===
    if (action === 'scores') {
      const lb = (daysFrom || 1) * 86400000;
      const { data } = await sb.from('matches')
        .select('id, home_team, away_team, start_time, status, home_score, away_score, odds_api_event_id')
        .eq('league_id', lid)
        .gte('start_time', new Date(Date.now() - lb).toISOString())
        .order('start_time', { ascending: false }).limit(100);
      return new Response(JSON.stringify((data || []).map((m: any) => ({
        id: m.odds_api_event_id || m.id, sport_key: lid,
        commence_time: m.start_time,
        home_team: nameOf(m.home_team), away_team: nameOf(m.away_team),
        completed: m.status === 'STATUS_FINAL',
        scores: m.status !== 'STATUS_SCHEDULED' ? [
          { name: nameOf(m.home_team), score: String(m.home_score || 0) },
          { name: nameOf(m.away_team), score: String(m.away_score || 0) }
        ] : null
      }))), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      error: `Unknown action: ${action}`,
      available: ['featured_odds', 'events', 'player_props', 'find_event', 'scores']
    }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (e: any) {
    console.error('get-odds error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
    });
  }
});
