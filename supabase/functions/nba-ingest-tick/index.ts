/**
 * nba-ingest-tick - Supabase Edge Function
 * 
 * Ingests live feed data into nba_ticks table with:
 * - Idempotent upsert (unique key: game_id + ts + score + elapsed)
 * - Monotonicity guards (score/elapsed/poss cannot decrease)
 * - Normalization to canonical tick schema
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getBaseId } from "../_shared/match-registry.ts";

declare const Deno: any;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
};

interface LiveFeedTick {
    gameId: string;
    timestamp: string;
    elapsedMinutes: number;
    remainingMinutes: number;
    homeScore: number;
    awayScore: number;
    homeStats: {
        fga: number;
        fgm: number;
        threePA: number;
        threePM: number;
        fta: number;
        ftm: number;
        tov: number;
        orb: number;
    };
    awayStats: {
        fga: number;
        fgm: number;
        threePA: number;
        threePM: number;
        fta: number;
        ftm: number;
        tov: number;
        orb: number;
    };
    timeoutsHome?: number;
    timeoutsAway?: number;
    teamFoulsQHome?: number;
    teamFoulsQAway?: number;
    inBonusHome?: boolean;
    inBonusAway?: boolean;
    homeOnCourt?: string[];
    awayOnCourt?: string[];
}

// Implementation for actual live feed integration via ESPN
async function fetchLiveFeed(gameId: string): Promise<LiveFeedTick | null> {
    try {
        // Handle IDs with suffixes (e.g., 401704771_nba -> 401704771)
        const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${getBaseId(gameId)}`;

        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`ESPN API error: ${resp.status}`);

        const data = await resp.json();
        const competition = data.header?.competitions?.[0];
        if (!competition) return null;

        const home = competition.competitors.find((c: any) => c.homeAway === 'home');
        const away = competition.competitors.find((c: any) => c.homeAway === 'away');

        const boxscore = data.boxscore?.teams;
        const findStat = (stats: any[], name: string) => {
            const s = stats.find(x => x.name === name);
            return s ? parseFloat(s.displayValue) : 0;
        };

        const mapTeamStats = (teamId: string) => {
            const team = boxscore?.find((t: any) => t.team.id === teamId);
            if (!team) return { fga: 0, fgm: 0, threePA: 0, threePM: 0, fta: 0, ftm: 0, tov: 0, orb: 0 };

            // ESPN stat names: 'fieldGoalsMade-fieldGoalsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted'
            const fg = team.statistics.find((s: any) => s.name === 'fieldGoalsMade-fieldGoalsAttempted')?.displayValue || "0-0";
            const [fgm, fga] = fg.split('-').map(Number);

            const tp = team.statistics.find((s: any) => s.name === 'threePointFieldGoalsMade-threePointFieldGoalsAttempted')?.displayValue || "0-0";
            const [tpm, tpa] = tp.split('-').map(Number);

            const ft = team.statistics.find((s: any) => s.name === 'freeThrowsMade-freeThrowsAttempted')?.displayValue || "0-0";
            const [ftm, fta] = ft.split('-').map(Number);

            return {
                fga, fgm,
                threePA: tpa, threePM: tpm,
                fta, ftm,
                tov: findStat(team.statistics, 'turnovers'),
                orb: findStat(team.statistics, 'offensiveRebounds')
            };
        };

        const status = data.header.competitions[0].status;
        const elapsedMinutes = (status.period - 1) * 12 + (12 - (status.displayClock.includes(':') ? parseInt(status.displayClock.split(':')[0]) + parseInt(status.displayClock.split(':')[1]) / 60 : 0));
        const remainingMinutes = Math.max(0, 48 - elapsedMinutes);

        return {
            gameId,
            timestamp: new Date().toISOString(),
            elapsedMinutes,
            remainingMinutes,
            homeScore: parseInt(home.score),
            awayScore: parseInt(away.score),
            homeStats: mapTeamStats(home.id),
            awayStats: mapTeamStats(away.id)
        };
    } catch (e) {
        console.error(`Error fetching ESPN live feed for ${gameId}:`, e);
        return null;
    }
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: CORS_HEADERS });
    }

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    try {
        const body = await req.json();
        const { gameId, tick: providedTick } = body;

        if (!gameId) {
            return new Response(JSON.stringify({ error: "Missing gameId" }), {
                status: 400,
                headers: CORS_HEADERS,
            });
        }

        // Get tick data (either provided or fetched)
        let tick: LiveFeedTick | null = providedTick;
        if (!tick) {
            tick = await fetchLiveFeed(gameId);
            if (!tick) {
                return new Response(JSON.stringify({ error: "No tick data available" }), {
                    status: 404,
                    headers: CORS_HEADERS,
                });
            }
        }

        // Fetch previous tick for monotonicity check
        const { data: prevTick } = await supabase
            .from("nba_ticks")
            .select("*")
            .eq("game_id", gameId)
            .order("ts", { ascending: false })
            .limit(1)
            .single();

        // Monotonicity guards
        if (prevTick) {
            const prevTotal = prevTick.pts_home + prevTick.pts_away;
            const currTotal = tick.homeScore + tick.awayScore;

            if (currTotal < prevTotal) {
                return new Response(JSON.stringify({
                    error: "Score decreased - possible stat correction",
                    shouldFreeze: true,
                    prev: prevTotal,
                    curr: currTotal
                }), {
                    status: 422,
                    headers: CORS_HEADERS,
                });
            }

            if (tick.elapsedMinutes < prevTick.elapsed_min) {
                return new Response(JSON.stringify({
                    error: "Elapsed time decreased - invalid tick",
                    shouldFreeze: true
                }), {
                    status: 422,
                    headers: CORS_HEADERS,
                });
            }

            // Check possessions (computed)
            const computePoss = (s: any) => s.fga + s.tov + 0.44 * s.fta - s.orb;
            const prevPoss = computePoss({
                fga: prevTick.home_fga + prevTick.away_fga,
                tov: prevTick.home_tov + prevTick.away_tov,
                fta: prevTick.home_fta + prevTick.away_fta,
                orb: prevTick.home_orb + prevTick.away_orb
            });
            const currPoss = computePoss({
                fga: tick.homeStats.fga + tick.awayStats.fga,
                tov: tick.homeStats.tov + tick.awayStats.tov,
                fta: tick.homeStats.fta + tick.awayStats.fta,
                orb: tick.homeStats.orb + tick.awayStats.orb
            });

            if (currPoss < prevPoss - 1) {
                return new Response(JSON.stringify({
                    error: "Possessions decreased - possible stat correction",
                    shouldFreeze: true
                }), {
                    status: 422,
                    headers: CORS_HEADERS,
                });
            }
        }

        // Normalize to DB schema
        const tickRow = {
            game_id: tick.gameId,
            ts: tick.timestamp,
            elapsed_min: tick.elapsedMinutes,
            rem_min: tick.remainingMinutes,
            pts_home: tick.homeScore,
            pts_away: tick.awayScore,
            home_fga: tick.homeStats.fga,
            home_fgm: tick.homeStats.fgm,
            home_3pa: tick.homeStats.threePA,
            home_3pm: tick.homeStats.threePM,
            home_fta: tick.homeStats.fta,
            home_ftm: tick.homeStats.ftm,
            home_tov: tick.homeStats.tov,
            home_orb: tick.homeStats.orb,
            away_fga: tick.awayStats.fga,
            away_fgm: tick.awayStats.fgm,
            away_3pa: tick.awayStats.threePA,
            away_3pm: tick.awayStats.threePM,
            away_fta: tick.awayStats.fta,
            away_ftm: tick.awayStats.ftm,
            away_tov: tick.awayStats.tov,
            away_orb: tick.awayStats.orb,
            timeouts_home: tick.timeoutsHome,
            timeouts_away: tick.timeoutsAway,
            team_fouls_q_home: tick.teamFoulsQHome,
            team_fouls_q_away: tick.teamFoulsQAway,
            in_bonus_home: tick.inBonusHome,
            in_bonus_away: tick.inBonusAway,
            home_on_court: tick.homeOnCourt,
            away_on_court: tick.awayOnCourt,
        };

        // CRITICAL FIX: Ensure game status is updated to IN_PROGRESS so it appears in Live UI
        if (tick.elapsedMinutes > 0 && tick.remainingMinutes > 0) {
            await supabase.from("nba_games").update({ status: "STATUS_IN_PROGRESS" }).eq("game_id", tick.gameId);
            await supabase.from("matches").update({ status: "STATUS_IN_PROGRESS" }).eq("id", tick.gameId);
        } else if (tick.remainingMinutes === 0 && tick.elapsedMinutes >= 48) {
            await supabase.from("nba_games").update({ status: "STATUS_FINAL" }).eq("game_id", tick.gameId);
            await supabase.from("matches").update({ status: "STATUS_FINAL" }).eq("id", tick.gameId);
        }

        // Upsert with idempotency key
        const { data, error } = await supabase
            .from("nba_ticks")
            .upsert(tickRow, {
                onConflict: "game_id,ts,pts_home,pts_away,elapsed_min",
                ignoreDuplicates: true,
            })
            .select("tick_id")
            .single();

        if (error) {
            // Check if it's a duplicate (which is fine)
            if (error.code === "23505") {
                const { data: existing } = await supabase
                    .from("nba_ticks")
                    .select("tick_id")
                    .eq("game_id", tick.gameId)
                    .eq("ts", tick.timestamp)
                    .eq("pts_home", tick.homeScore)
                    .eq("pts_away", tick.awayScore)
                    .single();

                return new Response(JSON.stringify({
                    success: true,
                    tickId: existing?.tick_id,
                    status: "duplicate",
                }), {
                    headers: CORS_HEADERS,
                });
            }
            throw error;
        }

        return new Response(JSON.stringify({
            success: true,
            tickId: data?.tick_id,
            status: "inserted",
        }), {
            headers: CORS_HEADERS,
        });

    } catch (error: any) {
        console.error("[nba-ingest-tick] Error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: CORS_HEADERS,
        });
    }
});
