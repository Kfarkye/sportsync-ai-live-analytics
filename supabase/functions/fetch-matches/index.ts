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
    const n = Number(p);
    if (isNaN(n)) return null;
    if (Math.abs(n) >= 100) return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
    // Decimal odds → American conversion (rare; most pipelines store American)
    return n >= 2.0 ? `+${Math.round((n - 1) * 100)}` : `${Math.round(-100 / (n - 1))}`;
}

function formatSpread(v: any): string | null {
    if (v === undefined || v === null) return null;
    const n = Number(v);
    if (isNaN(n)) return null;
    if (n === 0) return 'PK';
    return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Extract a normalized match.odds object from the current_odds JSONB column.
 * current_odds is written by ingest-live-games and contains institutional-grade
 * data (BallDontLie + The Odds API consensus).
 */
function extractFromCurrentOdds(raw: any, source: string): any | null {
    const co = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!co) return null;

    // Schema-agnostic field resolution:
    // ingest-odds writes:       homeWin, homeSpread, homeSpreadOdds, overOdds, drawWin
    // live-odds-tracker writes: home_ml, spread_home/spread_home_value, spread_best.home.price, total_best.over.price, draw_ml
    const homeML   = co.homeWin ?? co.home_ml ?? co.moneylineHome;
    const awayML   = co.awayWin ?? co.away_ml ?? co.moneylineAway;
    const drawML   = co.drawWin ?? co.draw_ml ?? co.draw;
    const homeSpr  = co.homeSpread ?? co.spread_home ?? co.spread_home_value;
    const awaySpr  = co.awaySpread ?? co.spread_away;
    const total    = co.total ?? co.total_value ?? co.overUnder;
    const hSprOdds = co.homeSpreadOdds ?? co.spread_best?.home?.price;
    const aSprOdds = co.awaySpreadOdds ?? co.spread_best?.away?.price;
    const oOdds    = co.overOdds ?? co.total_best?.over?.price;
    const uOdds    = co.underOdds ?? co.total_best?.under?.price;

    // Must have at least one meaningful field
    if (homeML == null && awayML == null && homeSpr == null && total == null) return null;

    return {
        hasOdds: true,
        provider: co.provider || 'Consensus',
        oddsSource: source,
        homeSpread: formatSpread(homeSpr),
        awaySpread: formatSpread(awaySpr),
        overUnder: total != null ? `${total}` : null,
        moneylineHome: formatPrice(homeML),
        moneylineAway: formatPrice(awayML),
        homeML: formatPrice(homeML),
        awayML: formatPrice(awayML),
        drawML: formatPrice(drawML),
        homeSpreadOdds: formatPrice(hSprOdds),
        awaySpreadOdds: formatPrice(aSprOdds),
        overOdds: formatPrice(oOdds),
        underOdds: formatPrice(uOdds),
        lastUpdated: co.lastUpdated ?? co.updated_at ?? null,
    };
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

            // ── Attach Closing Lines (always, if available) ─────────────────
            const closing = closingMap.get(m.id);
            if (closing) {
                match.closing_odds = closing;
            }

            // ── Always pass current_odds to frontend for detail view ──────
            if (m.current_odds) {
                match.current_odds = typeof m.current_odds === 'string'
                    ? JSON.parse(m.current_odds)
                    : m.current_odds;
            }

            // ── Determine game phase ─────────────────────────────────────────
            const isFinal = m.status?.includes('FINAL') || m.status?.includes('POSTPONED');
            const isInProgress = m.status?.includes('IN_PROGRESS') || m.status?.includes('HALFTIME') || m.status?.includes('END_PERIOD');

            // ── FINAL GAMES ──────────────────────────────────────────────────
            // Priority: closing_lines → current_odds snapshot → nothing
            if (isFinal) {
                if (closing) {
                    match.odds = {
                        hasOdds: true,
                        provider: 'Closing',
                        oddsSource: 'closing',
                        homeSpread: formatSpread(closing.homeSpread),
                        awaySpread: formatSpread(closing.awaySpread),
                        overUnder: closing.overUnder != null ? `${closing.overUnder}` : null,
                        moneylineHome: formatPrice(closing.homeWin),
                        moneylineAway: formatPrice(closing.awayWin),
                        homeML: formatPrice(closing.homeWin),
                        awayML: formatPrice(closing.awayWin),
                        drawML: formatPrice(closing.draw),
                        homeSpreadOdds: formatPrice(closing.homeSpreadOdds),
                        awaySpreadOdds: formatPrice(closing.awaySpreadOdds),
                        overOdds: formatPrice(closing.overOdds),
                        underOdds: formatPrice(closing.underOdds),
                    };
                } else {
                    // Fallback: current_odds has the last pre-final snapshot
                    match.odds = extractFromCurrentOdds(m.current_odds, 'current_odds_final') || { hasOdds: false };
                }
            }
            // ── LIVE GAMES ───────────────────────────────────────────────────
            // current_odds has real-time institutional data — use it
            else if (isInProgress) {
                const co = extractFromCurrentOdds(m.current_odds, 'live_current_odds');
                if (co) {
                    co.isLive = true;
                    match.odds = co;
                } else {
                    match.odds = { hasOdds: false };
                }
            }
            // ── SCHEDULED GAMES ──────────────────────────────────────────────
            // Priority: current_odds → safe columns → market_feeds
            else {
                // Priority 1: current_odds JSONB (BDL/Odds API consensus)
                const co = extractFromCurrentOdds(m.current_odds, 'current_odds');
                if (co) {
                    match.odds = co;
                }
                // Priority 2: Safe columns (legacy path)
                else if (m.odds_home_ml_safe || m.odds_home_spread_safe || m.odds_total_safe) {
                    const homeSprNum = m.odds_home_spread_safe != null ? Number(m.odds_home_spread_safe) : null;
                    const awaySprNum = homeSprNum != null && !isNaN(homeSprNum) ? homeSprNum * -1 : null;
                    match.odds = {
                        hasOdds: true,
                        provider: 'Consensus',
                        oddsSource: 'safe_columns',
                        homeSpread: formatSpread(m.odds_home_spread_safe),
                        awaySpread: formatSpread(awaySprNum),
                        overUnder: m.odds_total_safe != null ? `${m.odds_total_safe}` : null,
                        moneylineHome: formatPrice(m.odds_home_ml_safe),
                        moneylineAway: formatPrice(m.odds_away_ml_safe),
                        homeML: formatPrice(m.odds_home_ml_safe),
                        awayML: formatPrice(m.odds_away_ml_safe),
                        lastUpdated: m.last_odds_update,
                    };
                }
                // Priority 3: market_feeds fuzzy match
                else {
                    const matchHome = normalize(homeDisplayName);
                    const matchAway = normalize(awayDisplayName);

                    let oddsMatch: any = null;
                    const exactKey = `${matchHome}|${matchAway}`;
                    if (oddsMap.has(exactKey)) {
                        oddsMatch = oddsMap.get(exactKey);
                    } else {
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
                        const precalc = { spread: oddsMatch.best_spread, total: oddsMatch.best_total, h2h: oddsMatch.best_h2h };

                        if (precalc.spread || precalc.total || precalc.h2h) {
                            const homeSpreadPt = precalc.spread?.home?.point;
                            const homeSpreadPx = precalc.spread?.home?.price;
                            const awaySpreadPx = precalc.spread?.away?.price;
                            const totalPt = precalc.total?.over?.point;
                            const overPx = precalc.total?.over?.price;
                            const underPx = precalc.total?.under?.price;
                            const homeMLPx = precalc.h2h?.home?.price;
                            const awayMLPx = precalc.h2h?.away?.price;
                            const drawMLPx = precalc.h2h?.draw?.price;

                            const provider = precalc.spread?.home?.bookmaker || precalc.total?.over?.bookmaker || precalc.h2h?.bookmaker || 'Consensus';

                            match.odds = {
                                hasOdds: true, provider, oddsSource: 'market_feeds',
                                homeSpread: formatSpread(homeSpreadPt),
                                homeSpreadOdds: formatPrice(homeSpreadPx),
                                awaySpreadOdds: formatPrice(awaySpreadPx),
                                overUnder: totalPt !== undefined ? `${totalPt}` : null,
                                overOdds: formatPrice(overPx),
                                underOdds: formatPrice(underPx),
                                moneylineHome: formatPrice(homeMLPx),
                                moneylineAway: formatPrice(awayMLPx),
                                homeML: formatPrice(homeMLPx),
                                awayML: formatPrice(awayMLPx),
                                drawML: formatPrice(drawMLPx),
                                lastUpdated: oddsMatch.last_updated,
                            };
                        } else {
                            const sortedBooks = [...(oddsMatch.bookmakers || [])].sort((a: any, b: any) =>
                                new Date(b.last_update).getTime() - new Date(a.last_update).getTime()
                            );
                            const freshestBook = sortedBooks[0];
                            if (freshestBook) {
                                const getMarket = (book: any, key: string, outcomeName: string, mode: 'point' | 'price' = 'point') => {
                                    const mkt = book.markets?.find((x: any) => x.key === key);
                                    if (!mkt) return null;
                                    const outcome = mkt.outcomes?.find((x: any) => x.name === outcomeName || normalize(x.name) === normalize(outcomeName));
                                    if (!outcome) return null;
                                    return mode === 'price' ? formatPrice(outcome.price) : formatSpread(outcome.point);
                                };
                                const getDrawPrice = (book: any) => {
                                    const mkt = book.markets?.find((x: any) => x.key === 'h2h');
                                    if (!mkt) return null;
                                    const draw = mkt.outcomes?.find((o: any) => ['Draw', 'Tie', 'X'].includes(o.name));
                                    return draw ? formatPrice(draw.price) : null;
                                };
                                match.odds = {
                                    hasOdds: true, provider: freshestBook.title, oddsSource: 'raw_bookmakers',
                                    homeSpread: getMarket(freshestBook, 'spreads', oddsMatch.home_team),
                                    overUnder: getMarket(freshestBook, 'totals', 'Over'),
                                    moneylineHome: getMarket(freshestBook, 'h2h', oddsMatch.home_team, 'price'),
                                    moneylineAway: getMarket(freshestBook, 'h2h', oddsMatch.away_team, 'price'),
                                    homeML: getMarket(freshestBook, 'h2h', oddsMatch.home_team, 'price'),
                                    awayML: getMarket(freshestBook, 'h2h', oddsMatch.away_team, 'price'),
                                    drawML: getDrawPrice(freshestBook),
                                    homeSpreadOdds: getMarket(freshestBook, 'spreads', oddsMatch.home_team, 'price'),
                                    awaySpreadOdds: getMarket(freshestBook, 'spreads', oddsMatch.away_team, 'price'),
                                    overOdds: getMarket(freshestBook, 'totals', 'Over', 'price'),
                                    underOdds: getMarket(freshestBook, 'totals', 'Under', 'price'),
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
