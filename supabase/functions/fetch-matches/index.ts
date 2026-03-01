/**
 * fetch-matches v2 — DB-First Architecture
 * 
 * WHAT CHANGED (v127 → v2):
 *   Old: 17 parallel ESPN API calls per page load → race conditions → flickering UI
 *   New: 1 Supabase query → deterministic, instant, zero external dependency
 *
 * WHY:
 *   The matches table is already populated by ingest-live-games (cron, every minute).
 *   It contains full team JSONB (logo, color, displayName), scores, status, periods.
 *   Reading from DB instead of ESPN eliminates:
 *     - 17+ network round-trips per page load
 *     - ESPN rate-limiting causing "No Games Today" flashes
 *     - Race conditions from parallel fetches resolving at different times
 *     - The entire espn-proxy edge function as a frontend dependency
 *
 * ARCHITECTURE:
 *   Browser → fetch-matches (1 call) → matches table (DB)
 *                                     → market_feeds table (odds)
 *                                     → closing_lines table (closing odds)
 *   
 *   ESPN is NO LONGER called at read-time.
 *   ingest-live-games writes to matches table on a cron schedule.
 *   This function only reads.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

declare const Deno: any;

// ─── CORS ────────────────────────────────────────────────────────────────────

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-client-timeout, x-trace-id',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
};

// ─── LEAGUE CONFIG ───────────────────────────────────────────────────────────

const LEAGUE_ODDS_MAP: Record<string, string> = {
    'nfl': 'americanfootball_nfl',
    'nba': 'basketball_nba',
    'mlb': 'baseball_mlb',
    'nhl': 'icehockey_nhl',
    'college-football': 'americanfootball_ncaaf',
    'mens-college-basketball': 'basketball_ncaab',
    'eng.1': 'soccer_epl',
    'ita.1': 'soccer_italy_serie_a',
    'esp.1': 'soccer_spain_la_liga',
    'ger.1': 'soccer_germany_bundesliga',
    'uefa.champions': 'soccer_uefa_champs_league',
};

const ALL_LEAGUE_IDS = Object.keys(LEAGUE_ODDS_MAP);

// ─── DATE UTILITIES ──────────────────────────────────────────────────────────

/**
 * Betting Slate Date — mirrors frontend getBettingSlateDate().
 * Uses Pacific Time with the "3 AM Rule": games from 12AM–3AM PT belong to
 * the previous calendar day's betting slate.
 */
function toBettingSlateDate(dateStr: string): { windowStart: string; windowEnd: string } {
    // Parse the requested date as a calendar day
    const [year, month, day] = dateStr.split('-').map(Number);

    // Betting slate window: requested day 10:00 UTC (3AM PT) through next day 10:00 UTC
    // This captures all games that a Pacific Time user would consider "today's games"
    const windowStart = new Date(Date.UTC(year, month - 1, day, 10, 0, 0));
    const windowEnd = new Date(Date.UTC(year, month - 1, day + 1, 10, 0, 0));

    return {
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
    };
}

/**
 * Football-specific: expand date to Thu–Wed week window.
 * NFL/CFB games span Thu through Mon, so a single date query misses the slate.
 */
function toFootballWeekWindow(dateStr: string): { windowStart: string; windowEnd: string } {
    const d = new Date(dateStr + 'T12:00:00Z');
    const dayOfWeek = d.getDay(); // 0=Sun, 4=Thu
    const daysFromThursday = (dayOfWeek + 7 - 4) % 7;

    const thursday = new Date(d);
    thursday.setDate(d.getDate() - daysFromThursday);
    thursday.setUTCHours(10, 0, 0, 0); // 3AM PT

    const wednesday = new Date(thursday);
    wednesday.setDate(thursday.getDate() + 7);

    return {
        windowStart: thursday.toISOString(),
        windowEnd: wednesday.toISOString(),
    };
}

// ─── ODDS HELPERS ────────────────────────────────────────────────────────────

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function formatPrice(p: any): string | null {
    if (p === undefined || p === null) return null;
    if (Math.abs(p) >= 100) return p > 0 ? `+${Math.round(p)}` : `${Math.round(p)}`;
    return p >= 2.0 ? `+${Math.round((p - 1) * 100)}` : `${Math.round(-100 / (p - 1))}`;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const t0 = Date.now();

    try {
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!SUPABASE_URL || !SUPABASE_KEY) {
            return errorResponse('Server configuration error', 500);
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        // ── Parse Request ──────────────────────────────────────────────────────

        let body: any = {};
        try {
            const text = await req.text();
            if (text?.trim()) body = JSON.parse(text);
        } catch { body = {}; }

        // Date: URL param > body > today
        const urlDate = new URL(req.url).searchParams.get('date');
        const date = urlDate || body.date || new Date().toISOString().split('T')[0];

        // Leagues: body > all
        let leagueIds: string[] = ALL_LEAGUE_IDS;
        if (body.leagues && Array.isArray(body.leagues) && body.leagues.length > 0) {
            leagueIds = body.leagues.map((l: any) => typeof l === 'string' ? l : l.id).filter(Boolean);
        }

        // Single league filter (for league-specific views)
        const leagueFilter = body.leagueId || new URL(req.url).searchParams.get('league');
        if (leagueFilter) {
            leagueIds = [leagueFilter];
        }

        console.log(`[fetch-matches-v2] date=${date} leagues=${leagueIds.length}`);

        // ── 1. Fetch Matches from DB ───────────────────────────────────────────

        // Separate football leagues (week window) from daily leagues
        const footballLeagues = leagueIds.filter(id => id === 'nfl' || id === 'college-football');
        const dailyLeagues = leagueIds.filter(id => id !== 'nfl' && id !== 'college-football');

        const matchPromises: Promise<any[]>[] = [];

        // Daily leagues — single day window
        if (dailyLeagues.length > 0) {
            const { windowStart, windowEnd } = toBettingSlateDate(date);
            matchPromises.push(
                supabase
                    .from('matches')
                    .select('*')
                    .in('league_id', dailyLeagues)
                    .gte('start_time', windowStart)
                    .lt('start_time', windowEnd)
                    .order('start_time', { ascending: true })
                    .then(({ data, error }: any) => {
                        if (error) { console.error('[DB] Daily query error:', error); return []; }
                        return data || [];
                    })
            );
        }

        // Football leagues — week window
        if (footballLeagues.length > 0) {
            const { windowStart, windowEnd } = toFootballWeekWindow(date);
            matchPromises.push(
                supabase
                    .from('matches')
                    .select('*')
                    .in('league_id', footballLeagues)
                    .gte('start_time', windowStart)
                    .lt('start_time', windowEnd)
                    .order('start_time', { ascending: true })
                    .then(({ data, error }: any) => {
                        if (error) { console.error('[DB] Football query error:', error); return []; }
                        return data || [];
                    })
            );
        }

        const matchResults = await Promise.all(matchPromises);
        const dbMatches = matchResults.flat();

        console.log(`[fetch-matches-v2] DB returned ${dbMatches.length} matches`);

        // ── 2. Fetch Odds (parallel with matches, from market_feeds) ───────────

        const oddsKeys = [...new Set(
            leagueIds.map(id => LEAGUE_ODDS_MAP[id]).filter(Boolean)
        )];

        let oddsMap = new Map<string, any>();

        if (oddsKeys.length > 0) {
            try {
                const { data: feeds } = await supabase
                    .from('market_feeds')
                    .select('home_team, away_team, raw_bookmakers, last_updated, sport_key, best_spread, best_total, best_h2h')
                    .in('sport_key', oddsKeys)
                    .gte('commence_time', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
                    .order('last_updated', { ascending: false });

                if (feeds) {
                    for (const f of feeds) {
                        // Key by normalized team names for fuzzy matching
                        const key = `${normalize(f.home_team)}|${normalize(f.away_team)}`;
                        if (!oddsMap.has(key)) {
                            oddsMap.set(key, {
                                home_team: f.home_team,
                                away_team: f.away_team,
                                sport_key: f.sport_key,
                                bookmakers: typeof f.raw_bookmakers === 'string' ? JSON.parse(f.raw_bookmakers) : f.raw_bookmakers,
                                best_spread: f.best_spread,
                                best_total: f.best_total,
                                best_h2h: f.best_h2h,
                                last_updated: f.last_updated,
                            });
                        }
                    }
                }
            } catch (e) {
                console.error('[Odds] Feed fetch failed:', e);
            }
        }

        // ── 3. Fetch Closing Lines ─────────────────────────────────────────────

        let closingMap = new Map<string, any>();

        if (dbMatches.length > 0) {
            try {
                const matchIds = dbMatches.map(m => m.id);
                const chunkSize = 50;

                for (let i = 0; i < matchIds.length; i += chunkSize) {
                    const chunk = matchIds.slice(i, i + chunkSize);
                    const { data } = await supabase
                        .from('closing_lines')
                        .select('*')
                        .in('match_id', chunk);

                    if (data) {
                        for (const row of data) {
                            closingMap.set(row.match_id, {
                                provider: row.provider,
                                homeSpread: row.home_spread,
                                awaySpread: row.away_spread,
                                overUnder: row.total,
                                homeWin: row.home_ml,
                                awayWin: row.away_ml,
                                draw: row.draw_ml,
                                spread: row.home_spread,
                            });
                        }
                    }
                }
            } catch (e) {
                console.error('[Closing] Fetch failed:', e);
            }
        }

        // ── 4. Shape Response ──────────────────────────────────────────────────

        const matches = dbMatches.map(m => {
            // Extract team display names for odds matching
            const homeDisplayName = m.homeTeam?.displayName || m.home_team || '';
            const awayDisplayName = m.awayTeam?.displayName || m.away_team || '';

            // Build the match object in the shape the frontend expects
            const match: any = {
                id: m.id,
                leagueId: m.leagueId || m.league_id,
                sport: m.sport,
                startTime: m.startTime || m.start_time,
                status: m.status,
                displayClock: m.display_clock,
                period: m.period,
                homeTeam: m.homeTeam || {
                    id: m.home_team_id,
                    name: m.home_team,
                    displayName: m.home_team,
                },
                awayTeam: m.awayTeam || {
                    id: m.away_team_id,
                    name: m.away_team,
                    displayName: m.away_team,
                },
                homeScore: m.home_score ?? 0,
                awayScore: m.away_score ?? 0,
            };

            // Ensure team objects have required fields
            if (match.homeTeam && !match.homeTeam.score) {
                match.homeTeam.score = String(m.home_score ?? 0);
            }
            if (match.awayTeam && !match.awayTeam.score) {
                match.awayTeam.score = String(m.away_score ?? 0);
            }

            // Attach closing odds
            const closing = closingMap.get(m.id);
            if (closing) {
                match.closing_odds = closing;
            }

            // Attach live odds — try safe columns first, then market_feeds fuzzy match
            if (m.odds_home_ml_safe || m.odds_home_spread_safe || m.odds_total_safe) {
                match.odds = {
                    hasOdds: true,
                    provider: 'Consensus',
                    homeSpread: m.odds_home_spread_safe != null
                        ? (m.odds_home_spread_safe > 0 ? `+${m.odds_home_spread_safe}` : `${m.odds_home_spread_safe}`)
                        : null,
                    overUnder: m.odds_total_safe != null ? `${m.odds_total_safe}` : null,
                    moneylineHome: formatPrice(m.odds_home_ml_safe),
                    moneylineAway: formatPrice(m.odds_away_ml_safe),
                    homeML: formatPrice(m.odds_home_ml_safe),
                    awayML: formatPrice(m.odds_away_ml_safe),
                    lastUpdated: m.last_odds_update,
                };
            } else {
                // Fuzzy match against market_feeds
                const matchHome = normalize(homeDisplayName);
                const matchAway = normalize(awayDisplayName);

                let oddsMatch: any = null;

                // Try exact key match first
                const exactKey = `${matchHome}|${matchAway}`;
                if (oddsMap.has(exactKey)) {
                    oddsMatch = oddsMap.get(exactKey);
                } else {
                    // Fuzzy scan
                    for (const [, o] of oddsMap) {
                        const oHome = normalize(o.home_team);
                        const oAway = normalize(o.away_team);
                        if ((oHome.includes(matchHome) || matchHome.includes(oHome)) &&
                            (oAway.includes(matchAway) || matchAway.includes(oAway))) {
                            oddsMatch = o;
                            break;
                        }
                    }
                }

                if (oddsMatch) {
                    const precalc = {
                        spread: oddsMatch.best_spread,
                        total: oddsMatch.best_total,
                        h2h: oddsMatch.best_h2h,
                    };

                    if (precalc.spread || precalc.total || precalc.h2h) {
                        const homeSpread = precalc.spread?.home?.point;
                        const overUnder = precalc.total?.over?.point;
                        const homeML = precalc.h2h?.home?.price;
                        const awayML = precalc.h2h?.away?.price;

                        const provider = precalc.spread?.home?.bookmaker ||
                            precalc.total?.over?.bookmaker ||
                            precalc.h2h?.home?.bookmaker ||
                            'Consensus';

                        match.odds = {
                            hasOdds: true,
                            provider,
                            homeSpread: homeSpread !== undefined ? (homeSpread > 0 ? `+${homeSpread}` : `${homeSpread}`) : null,
                            overUnder: overUnder !== undefined ? `${overUnder}` : null,
                            moneylineHome: formatPrice(homeML),
                            moneylineAway: formatPrice(awayML),
                            homeML: formatPrice(homeML),
                            awayML: formatPrice(awayML),
                            lastUpdated: oddsMatch.last_updated,
                        };
                    } else {
                        // Try raw bookmakers fallback
                        const sortedBooks = [...(oddsMatch.bookmakers || [])].sort((a: any, b: any) =>
                            new Date(b.last_update).getTime() - new Date(a.last_update).getTime()
                        );
                        const freshestBook = sortedBooks[0];

                        if (freshestBook) {
                            const getMarket = (book: any, key: string, outcomeName: string, mode: 'point' | 'price' = 'point') => {
                                const mkt = book.markets?.find((x: any) => x.key === key);
                                if (!mkt) return null;
                                const outcome = mkt.outcomes?.find((x: any) =>
                                    x.name === outcomeName || normalize(x.name) === normalize(outcomeName)
                                );
                                if (!outcome) return null;
                                if (mode === 'price') return formatPrice(outcome.price);
                                return outcome.point != null ? (outcome.point > 0 ? `+${outcome.point}` : `${outcome.point}`) : null;
                            };

                            match.odds = {
                                hasOdds: true,
                                provider: freshestBook.title,
                                homeSpread: getMarket(freshestBook, 'spreads', oddsMatch.home_team),
                                overUnder: getMarket(freshestBook, 'totals', 'Over'),
                                moneylineHome: getMarket(freshestBook, 'h2h', oddsMatch.home_team, 'price'),
                                moneylineAway: getMarket(freshestBook, 'h2h', oddsMatch.away_team, 'price'),
                                homeML: getMarket(freshestBook, 'h2h', oddsMatch.home_team, 'price'),
                                awayML: getMarket(freshestBook, 'h2h', oddsMatch.away_team, 'price'),
                                lastUpdated: oddsMatch.last_updated,
                            };
                        } else {
                            match.odds = { hasOdds: false };
                        }
                    }
                } else {
                    match.odds = { hasOdds: false };
                }
            }

            return match;
        });

        // ── 5. Trigger Stale Odds Refresh (fire-and-forget) ────────────────────

        const STALE_THRESHOLD_MS = 60_000; // 60s
        const sportsToRefresh: string[] = [];

        for (const key of oddsKeys) {
            const feeds = [...oddsMap.values()].filter(o => o.sport_key === key);
            const oldest = feeds.length > 0
                ? Math.min(...feeds.map((o: any) => new Date(o.last_updated).getTime()))
                : 0;
            if (oldest < Date.now() - STALE_THRESHOLD_MS) {
                sportsToRefresh.push(key);
            }
        }

        if (sportsToRefresh.length > 0) {
            supabase.functions.invoke('ingest-odds-v3', {
                body: { sport_keys: sportsToRefresh },
            }).catch((e: any) => console.error('[Odds] Refresh trigger failed:', e));
        }

        // ── 6. Return ──────────────────────────────────────────────────────────

        const elapsed = Date.now() - t0;
        console.log(`[fetch-matches-v2] Returning ${matches.length} matches in ${elapsed}ms`);

        return new Response(JSON.stringify(matches), {
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'X-Matches-Count': String(matches.length),
                'X-Source': 'db',
                'X-Elapsed-Ms': String(elapsed),
            },
        });

    } catch (err: any) {
        console.error('[fetch-matches-v2] Critical error:', err);
        return errorResponse(err.message, 200); // 200 to keep UI alive
    }
});

// ─── ERROR RESPONSE ──────────────────────────────────────────────────────────

function errorResponse(message: string, status: number) {
    return new Response(JSON.stringify({ error: message, matches: [] }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
