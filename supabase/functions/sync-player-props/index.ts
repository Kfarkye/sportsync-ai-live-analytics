// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getBaseId } from "../_shared/match-registry.ts";

interface PropMatch {
    id: string;
    odds_api_event_id: string;
    league_id: string;
    home_team: string;
    away_team: string;
    start_time: string;
}

interface Outcome {
    name: string;
    description?: string;
    price: number;
    point?: number;
}

interface Market {
    key: string;
    outcomes: Outcome[];
}

interface Athlete {
    id: string | number;
    headshot: string;
    team?: string;
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CONFIG = {
    oddsApi: {
        baseUrl: 'https://api.the-odds-api.com/v4',
        timeout: 15000,
    }
}

// Map sport league IDs to The Odds API sport keys
const LEAGUE_MAP: Record<string, string> = {
    'nba': 'basketball_nba',
    'nfl': 'americanfootball_nfl',
    'mlb': 'baseball_mlb',
    'nhl': 'icehockey_nhl',
    'college-football': 'americanfootball_ncaaf',
    'mens-college-basketball': 'basketball_ncaab',
};

// Map The Odds API market keys to database prop_bet_type enum
const MARKET_TO_ENUM: Record<string, string> = {
    'player_points': 'points',
    'player_rebounds': 'rebounds',
    'player_assists': 'assists',
    'player_threes': 'threes_made',
    'player_points_rebounds_assists': 'pra',
    'player_pass_yds': 'passing_yards',
    'player_pass_tds': 'passing_tds',
    'player_rush_yds': 'rushing_yards',
    'player_receptions': 'receptions',
    'player_reception_yds': 'receiving_yards',
    'player_anytime_td': 'anytime_td',
    'player_pass_interceptions': 'interceptions',
    'pitcher_strikeouts': 'strikeouts',
    'batter_hits': 'hits',
    'batter_total_bases': 'total_bases',
    'player_goals': 'goals',
    'player_shots_on_goal': 'shots_on_goal',
};

const PLAYER_PROP_MARKETS: Record<string, string> = {
    'americanfootball_nfl': 'player_pass_yds,player_pass_tds,player_rush_yds,player_receptions,player_reception_yds,player_anytime_td,player_pass_interceptions',
    'americanfootball_ncaaf': 'player_pass_yds,player_pass_tds,player_rush_yds,player_receptions,player_reception_yds,player_anytime_td',
    'basketball_nba': 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists',
    'basketball_ncaab': 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists',
    'baseball_mlb': 'batter_hits,batter_total_bases,pitcher_strikeouts',
    'icehockey_nhl': 'player_points,player_goals,player_shots_on_goal',
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('ODDS_API_KEY');

    if (!oddsApiKey) {
        return new Response(JSON.stringify({ error: "Missing ODDS_API_KEY" }), { status: 500, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const logs: { event: string;[key: string]: any }[] = [];

    try {
        // 1. Get matches that have an Odds API Event ID and are today/tomorrow
        const now = new Date();
        const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        const { data: matches, error: matchesError } = await supabase
            .from('matches')
            .select('id, odds_api_event_id, league_id, home_team, away_team, start_time')
            .not('odds_api_event_id', 'is', null)
            .gte('start_time', twelveHoursAgo.toISOString())
            .lte('start_time', tomorrow.toISOString());

        if (matchesError) throw matchesError;

        if (!matches || matches.length === 0) {
            return new Response(JSON.stringify({ message: "No matches found for prop sync", logs }), { headers: corsHeaders });
        }

        logs.push({ event: "matches_found", count: matches.length });

        // 2. Process each match
        for (const match of (matches as PropMatch[])) {
            const sportKey = LEAGUE_MAP[match.league_id];
            const markets = PLAYER_PROP_MARKETS[sportKey];

            if (!markets) {
                logs.push({ event: "skipping_match", matchId: match.id, reason: "No prop markets configured for league" });
                continue;
            }

            try {
                // --- ARCHITECTURE UPGRADE: Resolve Athletes from ESPN ---
                // For pre-game matches, boxscore/leaders won't exist yet.
                // We need to fetch actual team rosters to get headshots.
                const athleteMap = new Map();
                const sportPath = match.league_id === 'nfl' ? 'football/nfl' :
                    match.league_id === 'nba' ? 'basketball/nba' :
                        match.league_id === 'nhl' ? 'hockey/nhl' :
                            match.league_id === 'college-football' ? 'football/college-football' :
                                match.league_id === 'mens-college-basketball' ? 'basketball/mens-college-basketball' :
                                    `${match.league_id}`;

                // Step 1: Try to get team IDs from event summary
                const espnSummaryUrl = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${getBaseId(match.id)}`;
                const summaryRes = await fetch(espnSummaryUrl);

                if (summaryRes.ok) {
                    const summaryData = await summaryRes.json();

                    // First try boxscore/leaders (for live/finished games)
                    const liveMembers = [
                        ...(summaryData?.boxscore?.players?.flatMap((p: any) => p.athletes) || []),
                        ...(summaryData?.leaders?.flatMap((l: any) => l.leaders?.map((ll: any) => ll.athlete)) || [])
                    ].filter(Boolean);

                    liveMembers.forEach(a => {
                        const norm = a.displayName?.toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (norm && a.headshot?.href) {
                            // Robust ID comparison (cast to string)
                            const teamMatch = summaryData?.header?.competitions?.[0]?.competitors?.find((c: any) => String(c.id) === String(a.teamId));
                            athleteMap.set(norm, {
                                id: String(a.id),
                                headshot: a.headshot.href,
                                team: teamMatch?.team?.displayName
                            } as Athlete);
                        }
                    });

                    // If no athletes found (pre-game), fetch full rosters
                    if (athleteMap.size === 0) {
                        const competitors = summaryData?.header?.competitions?.[0]?.competitors || [];
                        for (const comp of competitors) {
                            const teamId = comp.id;
                            if (!teamId) continue;

                            try {
                                const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamId}/roster`;
                                const rosterRes = await fetch(rosterUrl);
                                if (rosterRes.ok) {
                                    const rosterData = await rosterRes.json();
                                    const athletes = rosterData.athletes || rosterData.groups?.flatMap((g: any) => g.athletes) || [];
                                    athletes.forEach((a: any) => {
                                        const norm = a.displayName?.toLowerCase().replace(/[^a-z0-9]/g, '');
                                        const headshot = a.headshot?.href || `https://a.espncdn.com/combiner/i?img=/i/headshots/${match.league_id}/players/full/${a.id}.png&w=96&h=96`;
                                        if (norm) {
                                            athleteMap.set(norm, {
                                                id: a.id,
                                                headshot,
                                                team: comp.team?.displayName
                                            });
                                        }
                                    });
                                }
                            } catch (rosterErr) {
                                // Skip roster fetch errors silently
                            }
                        }
                    }
                }

                const url = `${CONFIG.oddsApi.baseUrl}/sports/${sportKey}/events/${match.odds_api_event_id}/odds?apiKey=${oddsApiKey}&regions=us&markets=${markets}&oddsFormat=american&_t=${Date.now()}`;
                console.log(`[Props] Fetching: ${match.home_team} vs ${match.away_team} | URL: ${url.replace(oddsApiKey, 'REDACTED')}`);

                const res = await fetch(url);
                if (!res.ok) {
                    const errText = await res.text();
                    logs.push({ event: "api_error", matchId: match.id, status: res.status, error: errText });
                    continue;
                }

                const data = await res.json();
                const bookmakers = data.bookmakers || [];
                console.log(`[Props] API returned ${bookmakers.length} bookmakers for ${match.home_team}`);

                // Select best available bookmaker for props (Preference: DraftKings, FanDuel, Bovada)
                const preferred = ['draftkings', 'fanduel', 'bovada', 'betmgm', 'betrivers', 'caesars'];
                const book = bookmakers.sort((a: any, b: any) => {
                    const ia = preferred.indexOf(a.key);
                    const ib = preferred.indexOf(b.key);
                    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
                })[0];

                if (!book) {
                    logs.push({ event: "no_prop_books", matchId: match.id });
                    continue;
                }

                const propUpserts: any[] = [];
                const eventDate = match.start_time.split('T')[0];

                for (const market of book.markets) {
                    const betType = MARKET_TO_ENUM[market.key];
                    if (!betType) continue;

                    for (const outcome of market.outcomes) {
                        // Outcome usually has: name (Over/Under/Yes/No), description (Player Name), price, point
                        const playerName = outcome.description || outcome.name;
                        const side = (outcome.name === 'Over' || outcome.name === 'Under') ? outcome.name.toLowerCase() : 'yes';

                        // Link Athlete Data
                        const normName = playerName.toLowerCase().replace(/[^a-z0-9]/g, '');
                        const athlete = athleteMap.get(normName);

                        if (!athlete) {
                            console.warn(`[Props: ${match.id}] ⚠️ Player mismatch: "${playerName}" not found in ESPN roster.`);
                        }

                        // Format for player_prop_bets schema
                        propUpserts.push({
                            match_id: match.id,
                            player_id: athlete?.id,
                            player_name: playerName,
                            headshot_url: athlete?.headshot,
                            team: athlete?.team || (outcome.name?.includes('(') ? outcome.name.split('(')[1].replace(')', '') : null),
                            bet_type: betType,
                            market_label: `${market.key.replace(/_/g, ' ').toUpperCase()} ${outcome.point || ''}`,
                            line_value: outcome.point || 1, // Anytime TD might not have point
                            odds_american: outcome.price,
                            side: side,
                            provider: book.key,
                            sportsbook: book.title,
                            event_date: eventDate,
                            league: match.league_id.toUpperCase()
                        });
                    }
                }

                if (propUpserts.length > 0) {
                    const { error: upsertError } = await supabase
                        .from('player_prop_bets')
                        .upsert(propUpserts, {
                            onConflict: 'match_id, player_name, bet_type, side, provider'
                        });

                    if (upsertError) {
                        logs.push({ event: "upsert_error", matchId: match.id, error: upsertError.message });
                        console.error(`[Props: ${match.id}] ❌ Upsert failed: ${upsertError.message}`);
                    } else {
                        logs.push({ event: "props_synced", matchId: match.id, count: propUpserts.length });
                        const overs = propUpserts.filter(p => p.side === 'over').length;
                        const unders = propUpserts.filter(p => p.side === 'under').length;
                        console.log(`[Props: ${match.id}] ✅ Synced ${propUpserts.length} props (${overs} Over, ${unders} Under).`);
                    }
                }

            } catch (e: any) {
                logs.push({ event: "match_process_exception", matchId: match.id, error: e.message });
            }
        }

        return new Response(JSON.stringify({ success: true, logs }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message, logs }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
