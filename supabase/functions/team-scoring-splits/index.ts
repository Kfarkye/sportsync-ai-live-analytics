
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

// Helper to determine correct season year for ESPN API
function getSeasonYear(sport: string, explicitSeason?: string): string {
    if (explicitSeason) return explicitSeason;
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    if (sport === 'football') {
        // NFL season spans years, usually treat Jan/Feb as previous year's season for fetching standings
        if (currentMonth < 8) return (currentYear - 1).toString();
        return currentYear.toString();
    }

    if (sport === 'basketball' || sport === 'hockey') {
        if (currentMonth >= 10) return (currentYear + 1).toString();
        return currentYear.toString();
    }

    if (sport === 'baseball') {
        return currentYear.toString();
    }

    if (sport === 'soccer') {
        if (currentMonth < 7) return (currentYear - 1).toString();
        return currentYear.toString();
    }

    return currentYear.toString();
}

// Timeout Fetch Wrapper
const fetchWithTimeout = async (url: string, ms: number) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(id);
    }
};

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let body: any = {};
    try {
        const text = await req.text();
        if (text) body = JSON.parse(text);
    } catch {
        // Body parsing failed, ignore
    }

    const url = new URL(req.url);
    const league_id = body.league_id || url.searchParams.get('league_id');
    const seasonParam = body.season || url.searchParams.get('season');
    const sortBy = body.sort_by || url.searchParams.get('sort_by') || 'delta';
    const sortOrder = body.sort_order || url.searchParams.get('sort_order') || 'desc';
    const limit = parseInt(body.limit || url.searchParams.get('limit') || '50');

    if (!league_id) {
        return new Response(JSON.stringify({ meta: { count: 0 }, data: [] }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });
    }

    let sport = 'basketball';
    let league = 'nba';

    switch(league_id) {
        case 'nfl': sport = 'football'; league = 'nfl'; break;
        case 'nba': sport = 'basketball'; league = 'nba'; break;
        case 'mlb': sport = 'baseball'; league = 'mlb'; break;
        case 'nhl': sport = 'hockey'; league = 'nhl'; break;
        case 'wnba': sport = 'basketball'; league = 'wnba'; break;
        case 'ncaaf': sport = 'football'; league = 'college-football'; break;
        case 'ncaab': sport = 'basketball'; league = 'mens-college-basketball'; break;
        case 'epl': sport = 'soccer'; league = 'eng.1'; break;
        case 'laliga': sport = 'soccer'; league = 'esp.1'; break;
        case 'bundesliga': sport = 'soccer'; league = 'ger.1'; break;
        case 'seriea': sport = 'soccer'; league = 'ita.1'; break;
        case 'ligue1': sport = 'soccer'; league = 'fra.1'; break;
        case 'mls': sport = 'soccer'; league = 'usa.1'; break;
        case 'ucl': sport = 'soccer'; league = 'uefa.champions'; break;
        case 'uel': sport = 'soccer'; league = 'uefa.europa'; break;
        // Legacy support
        case 'eng.1': sport = 'soccer'; league = 'eng.1'; break;
        case 'esp.1': sport = 'soccer'; league = 'esp.1'; break;
        case 'ger.1': sport = 'soccer'; league = 'ger.1'; break;
        case 'ita.1': sport = 'soccer'; league = 'ita.1'; break;
        case 'fra.1': sport = 'soccer'; league = 'fra.1'; break;
        case 'usa.1': sport = 'soccer'; league = 'usa.1'; break;
        case 'uefa.champions': sport = 'soccer'; league = 'uefa.champions'; break;
        case 'uefa.europa': sport = 'soccer'; league = 'uefa.europa'; break;
        case 'college-football': sport = 'football'; league = 'college-football'; break;
        case 'mens-college-basketball': sport = 'basketball'; league = 'mens-college-basketball'; break;
        default: sport = 'basketball'; league = 'nba'; break;
    }

    const year = getSeasonYear(sport, seasonParam);
    const espnUrl = `https://site.api.espn.com/apis/v2/sports/${sport}/${league}/standings?season=${year}`;
    
    // Use timeout to prevent edge function hard kill
    const res = await fetchWithTimeout(espnUrl, 8000);
    
    if (!res.ok) {
        console.warn(`ESPN API Error: ${res.status} for URL: ${espnUrl}`);
        // Return empty 200 OK instead of 500 to keep UI alive
        return new Response(JSON.stringify({
            meta: { season: year, league_id, count: 0, error: `ESPN Error ${res.status}` },
            data: []
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
        });
    }

    const data = await res.json();
    const teams: any[] = [];
    const entries: any[] = [];

    const recurse = (node: any) => {
        if (node.standings?.entries) {
            entries.push(...node.standings.entries);
        }
        if (node.children) {
            node.children.forEach(recurse);
        }
    };
    
    if (data.children) {
        data.children.forEach(recurse);
    } else if (data.standings?.entries) {
        entries.push(...data.standings.entries);
    }

    const getStat = (record: any, statNames: string[]) => {
        if (!record?.stats) return 0;
        for (const name of statNames) {
            const s = record.stats.find((item: any) => item.name === name || item.shortDisplayName === name || item.displayName === name);
            if (s) return s.value;
        }
        return 0;
    };

    const POINT_KEYS = ['pointsFor', 'goalsFor', 'runsFor', 'Points For', 'PF'];
    const GAME_KEYS = ['gamesPlayed', 'games', 'GP'];

    for (const entry of entries) {
        const team = entry.team;
        const homeRec = entry.records?.find((r: any) => r.type === 'home');
        const awayRec = entry.records?.find((r: any) => r.type === 'road' || r.type === 'away');
        const totalRec = entry.records?.find((r: any) => r.type === 'total');

        if (!homeRec || !awayRec) continue;

        const homePF = getStat(homeRec, POINT_KEYS);
        const homeGP = getStat(homeRec, GAME_KEYS);
        const awayPF = getStat(awayRec, POINT_KEYS);
        const awayGP = getStat(awayRec, GAME_KEYS);
        const totalGP = getStat(totalRec, GAME_KEYS);

        const homeAvg = homeGP > 0 ? homePF / homeGP : 0;
        const awayAvg = awayGP > 0 ? awayPF / awayGP : 0;
        // Total avg calculation
        const totalAvg = totalGP > 0 ? (getStat(totalRec, POINT_KEYS) / totalGP) : ((homeAvg + awayAvg) / 2);

        teams.push({
            team: {
                id: team.id,
                name: team.displayName,
                abbreviation: team.abbreviation || team.shortDisplayName,
                logo_url: team.logos?.[0]?.href
            },
            league_id,
            games: {
                total: totalGP,
                home: homeGP,
                away: awayGP
            },
            scoring: {
                total: totalAvg,
                home: homeAvg,
                away: awayAvg,
                delta: homeAvg - awayAvg
            },
            defense: { total: 0, home: 0, away: 0 },
            recency: {
                last_1: null,
                last_3_avg: totalAvg,
                last_3_home_avg: homeAvg,
                last_3_away_avg: awayAvg
            },
            updated_at: new Date().toISOString()
        });
    }

    teams.sort((a, b) => {
        let valA = 0, valB = 0;
        if (sortBy === 'delta') { valA = a.scoring.delta; valB = b.scoring.delta; }
        else if (sortBy === 'home_ppg') { valA = a.scoring.home; valB = b.scoring.home; }
        else if (sortBy === 'away_ppg') { valA = a.scoring.away; valB = b.scoring.away; }
        return sortOrder === 'asc' ? valA - valB : valB - valA;
    });

    return new Response(JSON.stringify({
        meta: { season: year, league_id, count: teams.length },
        data: teams.slice(0, limit)
    }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("Function Crash:", error);
    // Return empty success so client doesn't break
    return new Response(JSON.stringify({ 
        meta: { count: 0, error: error.message }, 
        data: [] 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200, 
    })
  }
})
    