import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getCanonicalMatchId } from '../_shared/match-registry.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-client-timeout, x-trace-id',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff'
}

// Fallback configuration if client payload is missing/malformed
const DEFAULT_LEAGUES = [
    { id: 'nfl', sport: 'NFL', apiEndpoint: 'football/nfl', oddsKey: 'americanfootball_nfl' },
    { id: 'nba', sport: 'NBA', apiEndpoint: 'basketball/nba', oddsKey: 'basketball_nba' },
    { id: 'mlb', sport: 'BASEBALL', apiEndpoint: 'baseball/mlb', oddsKey: 'baseball_mlb' },
    { id: 'nhl', sport: 'HOCKEY', apiEndpoint: 'hockey/nhl', oddsKey: 'icehockey_nhl' },
    { id: 'college-football', sport: 'COLLEGE_FOOTBALL', apiEndpoint: 'football/college-football', oddsKey: 'americanfootball_ncaaf' },
    { id: 'mens-college-basketball', sport: 'COLLEGE_BASKETBALL', apiEndpoint: 'basketball/mens-college-basketball', oddsKey: 'basketball_ncaab' },
    { id: 'eng.1', sport: 'SOCCER', apiEndpoint: 'soccer/eng.1', oddsKey: 'soccer_epl' },
    { id: 'ita.1', sport: 'SOCCER', apiEndpoint: 'soccer/ita.1', oddsKey: 'soccer_italy_serie_a' },
    { id: 'esp.1', sport: 'SOCCER', apiEndpoint: 'soccer/esp.1', oddsKey: 'soccer_spain_la_liga' },
    { id: 'ger.1', sport: 'SOCCER', apiEndpoint: 'soccer/ger.1', oddsKey: 'soccer_germany_bundesliga' },
    { id: 'uefa.champions', sport: 'SOCCER', apiEndpoint: 'soccer/uefa.champions', oddsKey: 'soccer_uefa_champs_league' }
];

declare const Deno: any;

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY');

        if (!SUPABASE_URL || !SUPABASE_KEY) {
            console.error("Missing Supabase Keys");
            return new Response(JSON.stringify({
                error: "Server Configuration Error",
                matches: []
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        // --- ROBUST BODY PARSING ---
        let body: any = {};
        try {
            // Try reading as text first to avoid stream issues
            const text = await req.text();
            if (text && text.trim().length > 0) {
                body = JSON.parse(text);
            }
        } catch (e) {
            console.warn("Body parsing failed:", e);
            // Try invalidating body
            body = {};
        }

        // --- DEFAULTS & VALIDATION ---
        let { date, leagues, oddsSportKey, clientTimezoneOffset } = body;

        // CHECK URL PARAMS FOR DATE (Prioritize Query Param)
        const urlObj = new URL(req.url);
        const urlDate = urlObj.searchParams.get('date');
        if (urlDate) {
            date = urlDate;
            console.log(`[Info] Date found in URL Query: ${date}`);
        }

        // Default to TODAY if date is still missing
        if (!date) {
            date = new Date().toISOString().split('T')[0];
            console.log(`[Warn] Date missing in payload/query, defaulting to ${date}`);
        } else {
            console.log(`[Info] Using Date: ${date}`);
        }

        // Default to configured leagues if missing
        if (!leagues || !Array.isArray(leagues) || leagues.length === 0) {
            console.log("[Warn] Leagues parameter missing or invalid. Using default list.");
            leagues = DEFAULT_LEAGUES;
        }

        // 1. Fetch ESPN Data
        const espnMatches = await fetchEspnData(leagues, new Date(date));

        // 2. Fetch Closing Lines from DB
        let closingLinesMap = new Map();
        try {
            const matchIds = espnMatches.map((m: any) => m.id);
            if (matchIds.length > 0) {
                // Fetch in chunks to avoid URL length limits if any
                const chunkSize = 50;
                for (let i = 0; i < matchIds.length; i += chunkSize) {
                    const chunk = matchIds.slice(i, i + chunkSize);

                    const { data: dbData } = await supabase
                        .from('closing_lines')
                        .select('*')
                        .in('match_id', chunk);

                    if (dbData) {
                        dbData.forEach((row: any) => {
                            closingLinesMap.set(row.match_id, {
                                provider: row.provider,
                                homeSpread: row.home_spread,
                                awaySpread: row.away_spread,
                                overUnder: row.total,
                                homeWin: row.home_ml,
                                awayWin: row.away_ml,
                                draw: row.draw_ml,
                                spread: row.home_spread
                            });
                        });
                    }
                }
            }
        } catch (e) {
            console.error("Closing Lines Fetch Error:", e);
        }

        // 3. Fetch Live Odds from DB Cache (Market Feeds)
        let oddsData: any[] = [];
        let feedsCount = 0;
        let oldestDataAt = new Date().toISOString();
        let keysToFetch: string[] = [];
        if (ODDS_API_KEY) {
            try {
                if (oddsSportKey && oddsSportKey !== 'all') {
                    keysToFetch = [oddsSportKey];
                } else {
                    keysToFetch = leagues.map((l: any) => l.oddsKey).filter((k: any) => k);
                }
                keysToFetch = [...new Set(keysToFetch)];

                if (keysToFetch.length > 0) {
                    // Fetch from market_feeds which is the active ingestion table
                    const { data: feeds } = await supabase
                        .from('market_feeds')
                        .select('home_team, away_team, raw_bookmakers, last_updated, sport_key, best_spread, best_total, best_h2h')
                        .in('sport_key', keysToFetch)
                        .gte('commence_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
                        .order('last_updated', { ascending: false });

                    if (feeds && feeds.length > 0) {
                        feedsCount = feeds.length;
                        oldestDataAt = feeds[feeds.length - 1].last_updated;
                        oddsData = feeds.map((f: any) => ({
                            home_team: f.home_team,
                            away_team: f.away_team,
                            sport_key: f.sport_key,
                            bookmakers: typeof f.raw_bookmakers === 'string' ? JSON.parse(f.raw_bookmakers) : f.raw_bookmakers,
                            best_spread: f.best_spread,
                            best_total: f.best_total,
                            best_h2h: f.best_h2h,
                            last_updated: f.last_updated
                        }));
                    }
                }

                // --- IMPROVED STALE CHECK: Check PER SPORT ---
                const STALE_THRESHOLD_MS = 30 * 1000; // Lowered to 30s for real-time responsiveness
                const sportsToRefresh = [];
                for (const key of keysToFetch) {
                    const sportFeeds = oddsData.filter(o => o.sport_key === key);
                    // CRITICAL: Use Math.min to ensure that if even ONE game in the sport is stale, 
                    // we trigger a refresh. Taking the max (newest) can hide stale games for the rest of the league.
                    const oldestForSport = sportFeeds.length > 0
                        ? Math.min(...sportFeeds.map(o => new Date(o.last_updated).getTime()))
                        : 0;

                    if (oldestForSport < Date.now() - STALE_THRESHOLD_MS) {
                        sportsToRefresh.push(key);
                    }
                }

                if (sportsToRefresh.length > 0) {
                    console.log(`[Odds] Refreshing ${sportsToRefresh.length} stale sports: ${sportsToRefresh.join(', ')}`);
                    supabase.functions.invoke('ingest-odds', {
                        body: { sport_keys: sportsToRefresh }
                    }).catch((e: any) => console.error("Sync trigger failed", e));
                }
            } catch (e) {
                console.error("Odds feed fetch failed", e);
            }
        }

        // 4. Merge Data
        const mergedData = espnMatches.map((match: any) => {
            // A. Attach Closing Odds
            const closing = closingLinesMap.get(match.id);
            if (closing) {
                match.closing_odds = closing;
            }

            // B. Attach Live Odds
            if (!oddsData.length) {
                return { ...match, odds: { hasOdds: false } };
            }

            const matchHome = normalize(match.homeTeam.name);
            const matchAway = normalize(match.awayTeam.name);

            const oddsMatch = oddsData.find((o: any) => {
                const oHome = normalize(o.home_team);
                const oAway = normalize(o.away_team);
                // Simple fuzzy match or check if either contains the other
                return (oHome.includes(matchHome) || matchHome.includes(oHome)) &&
                    (oAway.includes(matchAway) || matchAway.includes(oAway));
            });

            if (oddsMatch) {
                // PRIMARY SOURCE: Pre-calculated "Best Lines" from Ingest Service (includes Zombie Filter)
                const precalc = {
                    spread: oddsMatch.best_spread,
                    total: oddsMatch.best_total,
                    h2h: oddsMatch.best_h2h
                };

                // Fallback: Re-derive from raw books (Legacy behavior)
                // Sort by last_update descending to get the most real-time data
                const sortedBooks = [...(oddsMatch.bookmakers || [])].sort((a: any, b: any) =>
                    new Date(b.last_update).getTime() - new Date(a.last_update).getTime()
                );
                const freshestBook = sortedBooks[0];

                if (precalc.spread || precalc.total || precalc.h2h) {
                    // Extract Point/Price from Best Line Structure
                    const homeSpread = precalc.spread?.home?.point;
                    const overUnder = precalc.total?.over?.point;
                    const homeML = precalc.h2h?.home?.price;
                    const awayML = precalc.h2h?.away?.price;

                    // Provider preference: Spread -> Total -> ML -> Freshest Book
                    const provider = precalc.spread?.home?.bookmaker ||
                        precalc.total?.over?.bookmaker ||
                        precalc.h2h?.home?.bookmaker ||
                        freshestBook?.title ||
                        'Consensus';

                    return {
                        ...match,
                        odds_api_event_id: oddsMatch.id,
                        odds: {
                            hasOdds: true,
                            provider: provider,
                            homeSpread: homeSpread !== undefined ? (homeSpread > 0 ? `+${homeSpread}` : `${homeSpread}`) : null,
                            overUnder: overUnder !== undefined ? `${overUnder}` : null,
                            moneylineHome: formatPrice(homeML),
                            moneylineAway: formatPrice(awayML),
                            homeML: formatPrice(homeML),
                            awayML: formatPrice(awayML),
                            lastUpdated: oddsMatch.last_updated
                        }
                    };
                } else if (freshestBook) {
                    // LEGACY FALLBACK
                    const homeML = getMarket(freshestBook, 'h2h', oddsMatch.home_team, 'price');
                    const awayML = getMarket(freshestBook, 'h2h', oddsMatch.away_team, 'price');

                    return {
                        ...match,
                        odds_api_event_id: oddsMatch.id,
                        odds: {
                            hasOdds: true,
                            provider: freshestBook.title,
                            homeSpread: getMarket(freshestBook, 'spreads', oddsMatch.home_team),
                            overUnder: getMarket(freshestBook, 'totals', 'Over'),
                            moneylineHome: homeML,
                            moneylineAway: awayML,
                            homeML: homeML, // Alias
                            awayML: awayML, // Alias
                            lastUpdated: oddsMatch.last_updated
                        }
                    };
                }
            }

            return { ...match, odds: { hasOdds: false } };
        });

        return new Response(JSON.stringify(mergedData), {
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });

    } catch (err: any) {
        console.error("Critical Error:", err);
        // Return empty matches array instead of erroring out completely to keep UI alive
        return new Response(JSON.stringify({ error: err.message, matches: [] }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
})

// --- HELPERS ---

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const getMarket = (book: any, key: string, outcomeName: string, mode: 'point' | 'price' = 'point') => {
    const m = book.markets.find((x: any) => x.key === key);
    if (!m) return null;
    const o = m.outcomes.find((x: any) => x.name === outcomeName || (key === 'spreads' && normalize(x.name) === normalize(outcomeName)));
    if (!o) return null;

    if (mode === 'price') {
        const p = o.price;
        if (p === undefined || p === null) return null;
        // Handle American odds formatting
        if (Math.abs(p) >= 100) return p > 0 ? `+${Math.round(p)}` : `${Math.round(p)}`;
        // Handle Decimal -> American conversion
        return p >= 2.0 ? `+${Math.round((p - 1) * 100)}` : `${Math.round(-100 / (p - 1))}`;
    }

    return o.point != null ? (o.point > 0 ? `+${o.point}` : `${o.point}`) : null;
};

function getFootballDateRange(date: Date): string {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun ... 4=Thu
    const diff = (day + 7 - 4) % 7;
    const start = new Date(d);
    start.setDate(d.getDate() - diff);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const fmt = (dt: Date) => {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const dy = String(dt.getDate()).padStart(2, '0');
        return `${y}${m}${dy}`;
    };
    return `${fmt(start)}-${fmt(end)}`;
}

const formatPrice = (p: any) => {
    if (p === undefined || p === null) return null;
    // Handle American odds formatting
    if (Math.abs(p) >= 100) return p > 0 ? `+${Math.round(p)}` : `${Math.round(p)}`;
    // Handle Decimal -> American conversion
    return p >= 2.0 ? `+${Math.round((p - 1) * 100)}` : `${Math.round(-100 / (p - 1))}`;
};

async function fetchEspnData(leagues: any[], date: Date) {
    const defaultDateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    console.log(`[ESPN] Parallel fetch for ${leagues.length} leagues, date: ${date.toISOString()}`);

    const tasks = leagues.map(async (league) => {
        try {
            let dateParam = defaultDateStr;
            if (league.sport === 'NFL' || league.sport === 'COLLEGE_FOOTBALL') {
                dateParam = getFootballDateRange(date);
            }

            const url = `https://site.api.espn.com/apis/site/v2/sports/${league.apiEndpoint}/scoreboard?dates=${dateParam}&limit=100&_t=${Date.now()}`;
            const res = await fetch(url);

            if (res.ok) {
                const data = await res.json();
                return (data.events || []).map((e: any) => {
                    const c = e.competitions?.[0];
                    if (!c) return null;
                    const h = c.competitors?.find((x: any) => x.homeAway === 'home');
                    const a = c.competitors?.find((x: any) => x.homeAway === 'away');
                    if (!h || !a) return null;

                    return {
                        id: getCanonicalMatchId(e.id, league.id),
                        leagueId: league.id,
                        sport: league.sport,
                        startTime: e.date,
                        status: e.status.type.name,
                        displayClock: e.status.displayClock,
                        period: e.status.period,
                        homeTeam: { id: h.team.id, name: h.team.displayName, logo: h.team.logo, score: h.score, record: h.records?.[0]?.summary },
                        awayTeam: { id: a.team.id, name: a.team.displayName, logo: a.team.logo, score: a.score, record: a.records?.[0]?.summary },
                        homeScore: parseInt(h.score || '0'),
                        awayScore: parseInt(a.score || '0')
                    };
                }).filter((e: any) => e !== null);
            }
            return [];
        } catch (e) {
            console.error(`ESPN Fail ${league.id}`, e);
            return [];
        }
    });

    const nestedResults = await Promise.all(tasks);
    const results = nestedResults.flat();
    return results.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}
