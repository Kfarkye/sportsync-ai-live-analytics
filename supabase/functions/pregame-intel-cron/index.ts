// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

/**
 * PREGAME INTEL CRON (Mission Critical Discovery & Rectification)
 * 
 * Objectives:
 *  - Identify gaps in pregame_intel coverage for the upcoming slate.
 *  - Rectify intel deficiencies via prioritized batching.
 *  - Act as a Targeted Originator for on-demand requests.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";
import { getCanonicalMatchId, toLocalGameDate } from "../_shared/match-registry.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
};

/**
 * CLINICAL TACTICAL SCHEMA (The Computer Group Standard)
 */
const QUANT_INTEL_SCHEMA = {
    type: "object",
    description: "A clinical tactical audit of a sports matchup for the syndicate.",
    properties: {
        recommended_pick: {
            type: "string",
            description: "A concise, command-level betting pick for the syndicate. Format: 'TEAM +/-SPREAD', 'TEAM ML', or 'O/U VALUE'. e.g. 'MAGIC -3' or 'UNDER 220.5'."
        },
        logic_authority: {
            type: "string",
            description: "Binary reasoning chain: Variables -> Python Simulation Results -> Friction Identification. Max 500 chars."
        },
        executive_summary: {
            type: "object",
            properties: {
                spot: { type: "string", description: "Situational context (e.g. Back-to-back, altitude, revenge spot)" },
                driver: { type: "string", description: "Primary tactical reason for the edge (e.g. Poisson simulation delta)" },
                verdict: { type: "string", description: "Final clinical verdict on market efficiency." }
            },
            required: ["spot", "driver", "verdict"]
        },
        derived_scorecard: {
            type: "object",
            properties: {
                headline: { type: "string" },
                briefing: { type: "string" },
                cards: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            category: {
                                type: "string",
                                enum: ["CONTRARIAN", "PLAYER_TREND", "INJURY", "ATS_TRENDS", "SCHEDULE", "LINE_MOVEMENT", "SHARP_ACTION", "WEATHER", "REFEREE", "SITUATIONAL", "STORYLINE"],
                            },
                            thesis: { type: "string" },
                            market_implication: { type: "string" },
                            details: { type: "array", items: { type: "string" } },
                            impact: { type: "string", enum: ["HIGH", "MEDIUM", "NEUTRAL"] },
                            confidence_score: { type: "number", description: "1-100 scale of conviction." },
                            true_probability: { type: "number" }
                        },
                        required: ["category", "thesis", "market_implication", "impact", "confidence_score", "true_probability"]
                    }
                }
            },
            required: ["headline", "briefing", "cards"]
        }
    },
    required: ["recommended_pick", "logic_authority", "executive_summary", "derived_scorecard"]
};

const CONFIG = {
    LOOKAHEAD_HOURS: 120,
    FETCH_LIMIT: 100,  // Increased to see more games
    BATCH_SIZE: 20,    // Increased from 6 to speed up coverage
    TIMEOUT_MS: 150_000,
    STALE_HOURS: 12,
};

// Volatility Guard Thresholds (in points)
const VOLATILITY_THRESHOLDS: Record<string, { spread: number, total: number }> = {
    'nba': { spread: 1.0, total: 2.0 },
    'nfl': { spread: 0.5, total: 1.0 },
    'mlb': { spread: 0.5, total: 0.5 },
    'default': { spread: 1.0, total: 1.5 }
};

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: number | undefined;
    const timeout = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} (>${ms}ms)`)), ms) as unknown as number;
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

/**
 * DOSSIER GENERATOR (Targeted Originator Mode)
 */
async function generateDossier(body: any) {
    const { home_team, away_team, league, match_metadata } = body;

    const SYSTEM_INSTRUCTION = `ROLE: Lead Originator for The Computer Group.
MISSION: Identify mathematical friction via deep reasoning and forensic grounding.
OPERATING PRINCIPLES:
1. AXIOMATIC TRUTH: The provided Fair Value is the core mathematical truth.
2. MATH INTERNAL: Use codeExecution (scipy.stats.poisson) to verify the 'True Edge'.
3. COMMAND-LEVEL PICK: Consolidate findings into a concise, professional bet (e.g., "MAGIC -3", "UNDER 214.5").
4. CLINICAL TONE: Arrogant, institutional, and precise. Speak as the Syndicate.`;

    const prompt = `### TARGET: ${away_team} @ ${home_team} | Delta: ${match_metadata?.delta || 'Situational'}
    Identify logical friction and perform a clinical audit.

    ### EXAMPLE OUTPUT
    {
      "recommended_pick": "MAGIC -3",
      "logic_authority": "Python simulation (scipy.stats.poisson) confirms internal number line at 112.5. Market lagging by 4.2pts. Simulation results appended: Edge 1.82 sigma.",
      "executive_summary": {
        "spot": "Revenge spot for Magic after last week's home loss.",
        "driver": "Poisson simulation reveals significant spread friction.",
        "verdict": "EDGE DETECTED: Magic -3 represents high mathematical value."
      },
      "derived_scorecard": {
        "headline": "Magic Defensive Friction Detected",
        "briefing": "Magic holding opponents to 32% from three over last 5 games.",
        "cards": [
          {
            "category": "THE TREND",
            "thesis": "Defensive Surge",
            "market_implication": "Magic expected to cover spread in 68% of simulations",
            "details": ["Top 5 defensive rating this month"],
            "impact": "HIGH",
            "confidence_score": 85,
            "true_probability": 0.68
          }
        ]
      }
    }`;

    const { text } = await executeAnalyticalQuery([{ text: prompt }], {
        model: "gemini-3-flash-preview",
        systemInstruction: SYSTEM_INSTRUCTION,
        responseSchema: QUANT_INTEL_SCHEMA,
        thinkingBudget: 32768,
        tools: [{ googleSearch: {} }]
    });

    return safeJsonParse(text);
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const debug_logs: string[] = [];
    try {
        const body = await req.json().catch(() => ({}));
        const userAgent = req.headers.get("user-agent") || "";
        const cronSecret = req.headers.get("x-cron-secret");

        // SRE: Heartbeat Logic (Immediate observability)
        const isCron = body.is_cron === true ||
            userAgent.includes("PostgREST") ||
            userAgent.includes("pg_net") ||
            (userAgent.includes("Deno") && Object.keys(body).length === 0) ||
            cronSecret === Deno.env.get("CRON_SECRET");

        const isForce = body.force === true;
        const triggerLabel = isCron ? (isForce ? "CRON_FORCE" : "CRON") : "MANUAL";
        const batchId = `cron_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        const trace: string[] = [];
        console.log(`[pulse] 💓 HEARTBEAT: ${triggerLabel} | Start: ${new Date().toISOString()}`);

        // Immediate Heartbeat Log to DB for 100% observability
        if (isCron) {
            try {
                await supabase.from("pregame_intel_log").insert({
                    batch_id: batchId,
                    matches_processed: 0,
                    matches_succeeded: 0,
                    matches_failed: 0,
                    trace: [`[pulse] Heartbeat Triggered via ${userAgent}`],
                    duration_ms: 0
                });
            } catch (e: any) {
                console.error("[pulse-err] Failed heartbeat log:", e.message);
            }
        }

        trace.push(`[boot] Trigger: ${triggerLabel}, Force: ${isForce}, Batch: ${batchId}`);

        if (isCron) {
            const { data: sentinel, error: guardErr } = await supabase
                .from("pregame_intel")
                .select("generated_at")
                .eq("match_id", "CRON_SENTINEL")
                .single();

            if (guardErr && guardErr.code !== 'PGRST116') {
                console.error(`[guard] ⚠️ Error querying sentinel:`, guardErr);
                debug_logs.push(`[guard] ⚠️ Error querying sentinel: ${guardErr.message}`);
            }

            if (sentinel && sentinel?.generated_at) {
                const ageMins = (Date.now() - new Date(sentinel.generated_at).getTime()) / (1000 * 60);
                trace.push(`[guard] Last sentinel sync was ${ageMins.toFixed(1)}m ago.`);
                if (ageMins < 14 && !isForce) {
                    trace.push(`[guard] Throttling active. Exiting.`);
                    return new Response(JSON.stringify({ status: "THROTTLED", age_mins: ageMins, debug_logs, trace }), { headers: CORS_HEADERS });
                }
            } else {
                console.log(`[guard] 🟢 No previous sentinel found.`);
                debug_logs.push(`[guard] 🟢 No previous sentinel found.`);
            }

            const lockDossier = {
                match_id: "CRON_SENTINEL",
                sport: "SYSTEM",
                league_id: "SYSTEM",
                home_team: "SYSTEM",
                away_team: "SYSTEM",
                game_date: new Date().toISOString().split('T')[0],
                headline: "Cron Sentinel [LOCKED]",
                briefing: "Execution tracking active.",
                cards: [{ title: 'Sentinel', body: 'Throttling guard heartbeat.', category: 'SYSTEM' }],
                generated_at: new Date().toISOString(),
                freshness: 'LIVE'
            };
            await supabase.from("pregame_intel").upsert(lockDossier, { onConflict: 'match_id,game_date' });
            debug_logs.push(`[guard] 🔒 Lock acquired at ${new Date().toISOString()}`);
        }

        debug_logs.push(`[log] 📝 Run initialized: ${batchId}`);
        trace.push(`[log] Run initialized: ${batchId}`);

        if (body.match_id && !body.is_cron) {
            console.log(`[originator] 🔬 Targeted Dossier Request: ${body.match_id}`);
            const dossier = await generateDossier(body);
            return new Response(JSON.stringify(dossier), { headers: CORS_HEADERS });
        }

        console.log(`[discovery] 🛰️ Initiating Slate Audit: Lookahead=${CONFIG.LOOKAHEAD_HOURS}h`);
        const now = new Date();
        const windowEnd = new Date(now.getTime() + CONFIG.LOOKAHEAD_HOURS * 60 * 60 * 1000);

        const { data: slate, error: slateErr } = await supabase
            .from("v_ready_for_intel")
            .select("id, home_team, away_team, start_time, sport, league_id, odds_home_spread_safe, odds_total_safe, current_odds")
            .gte("start_time", now.toISOString())
            .lt("start_time", windowEnd.toISOString())
            .order("start_time", { ascending: true })
            .limit(CONFIG.FETCH_LIMIT);

        if (slateErr) throw slateErr;

        let rectifiedCount = 0;
        let queueLength = 0;

        if (slate?.length) {
            const { data: existingIntel, error: intelErr } = await supabase
                .from("pregame_intel")
                .select("match_id, generated_at, freshness, analyzed_spread, analyzed_total")
                .in("match_id", (slate as any[]).map(s => s.id))
                .order("generated_at", { ascending: true });

            if (!intelErr) {
                debug_logs.push(`[discovery] 🔍 Cache hit: ${existingIntel?.length || 0} existing records.`);

                const queue = (slate as any[]).map(game => {
                    const canonicalId = getCanonicalMatchId(game.id, game.league_id);
                    const gameDate = toLocalGameDate(game.start_time);

                    // Match by BOTH ID and standardized Date to prevent loops
                    const intel: any = (existingIntel as any[]).find(i =>
                        i.match_id === canonicalId && i.game_date === gameDate
                    );

                    let priority = 0;
                    const hoursToStart = (new Date(game.start_time).getTime() - Date.now()) / (1000 * 60 * 60);

                    if (!intel) {
                        priority = 100;
                    } else {
                        const lastGen = intel?.generated_at;
                        const ageHours = lastGen ? (Date.now() - new Date(lastGen).getTime()) / (1000 * 60 * 60) : 999;

                        let staleThreshold = CONFIG.STALE_HOURS;
                        if (hoursToStart < 4) staleThreshold = 1;
                        else if (hoursToStart < 24) staleThreshold = 4;

                        if (ageHours > staleThreshold) {
                            priority = 50;
                        }

                        // ═══ VOLATILITY GUARD ═══
                        // Check if the market line has moved significantly since last analysis
                        const leagueKey = (game.league_id || 'default').toLowerCase();
                        const thresholds = VOLATILITY_THRESHOLDS[leagueKey] || VOLATILITY_THRESHOLDS['default'];

                        const currentSpread = (game as any).odds_home_spread_safe;
                        const currentTotal = (game as any).odds_total_safe;
                        const analyzedSpread = intel.analyzed_spread;
                        const analyzedTotal = intel.analyzed_total;

                        if (currentSpread != null && analyzedSpread != null) {
                            const spreadDelta = Math.abs(currentSpread - analyzedSpread);
                            if (spreadDelta > thresholds.spread) {
                                priority = 100; // Force re-analysis
                                trace.push(`[volatility] 📊 DRASTIC SPREAD MOVE: ${game.id} | ${analyzedSpread} → ${currentSpread} (Δ${spreadDelta.toFixed(1)})`);
                            }
                        }
                        if (currentTotal != null && analyzedTotal != null) {
                            const totalDelta = Math.abs(currentTotal - analyzedTotal);
                            if (totalDelta > thresholds.total) {
                                priority = 100; // Force re-analysis
                                trace.push(`[volatility] 📊 DRASTIC TOTAL MOVE: ${game.id} | ${analyzedTotal} → ${currentTotal} (Δ${totalDelta.toFixed(1)})`);
                            }
                        }
                    }

                    if (priority > 0) {
                        priority += Math.max(0, 24 - hoursToStart);
                    }
                    trace.push(`[Evaluate] Match ${game.id}: Priority=${priority.toFixed(1)} (HoursToStart=${hoursToStart.toFixed(1)})`);
                    return { game, priority };
                })
                    .filter(q => q.priority > 0)
                    .sort((a, b) => b.priority - a.priority);

                const seenCanonicalIds = new Set<string>();
                const uniqueQueue = [];
                for (const item of queue) {
                    const canonicalId = getCanonicalMatchId(item.game.id, item.game.league_id);
                    if (!seenCanonicalIds.has(canonicalId)) {
                        seenCanonicalIds.add(canonicalId);
                        uniqueQueue.push(item);
                    }
                    if (uniqueQueue.length >= CONFIG.BATCH_SIZE) break;
                }

                queueLength = uniqueQueue.length;

                if (uniqueQueue.length > 0) {
                    console.log(`[discovery] 🛠️ Rectifying ${uniqueQueue.length} Intelligence Gaps`);
                    debug_logs.push(`[discovery] 🛠️ Gaps: ${uniqueQueue.map(q => q.game.id).join(', ')}`);

                    const results = await Promise.allSettled(uniqueQueue.map(async ({ game }) => {
                        console.log(`[gap-fix] 🚀 Launching rectification for ${game.id} (${game.away_team} @ ${game.home_team})`);
                        // DISPATCH TO NEW WORKER (v4.2 Architecture)
                        // Using direct fetch for reliable function-to-function auth
                        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
                        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

                        const workerPayload = {
                            match_id: game.id,
                            home_team: game.home_team,
                            away_team: game.away_team,
                            sport: game.sport,
                            league: game.league_id,
                            start_time: game.start_time,
                            current_spread: (game as any).odds_home_spread_safe,
                            current_total: (game as any).odds_total_safe,
                            current_odds: (game as any).current_odds,
                            home_ml: (game as any).current_odds?.homeWin || (game as any).current_odds?.home_ml,
                            away_ml: (game as any).current_odds?.awayWin || (game as any).current_odds?.away_ml,
                            force_refresh: isForce
                        };

                        const invocation = fetch(`${supabaseUrl}/functions/v1/pregame-intel-worker`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${serviceRoleKey}`,
                                "apikey": serviceRoleKey
                            },
                            body: JSON.stringify(workerPayload)
                        }).then(async (res) => {
                            if (!res.ok) {
                                const errText = await res.text();
                                throw new Error(`Worker returned ${res.status}: ${errText}`);
                            }
                            return { data: await res.json(), error: null };
                        }).catch((err) => ({ data: null, error: err }));

                        const result = await withTimeout(invocation, CONFIG.TIMEOUT_MS, `Dossier Generation: ${game.id}`) as any;

                        if (result.error || result.data?.error) {
                            const err = result.error || result.data?.error;
                            const errMsg = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
                            console.error(`[discovery] ❌ Gap Failure ${game.id}:`, errMsg);
                            debug_logs.push(`[gap-err] ${game.id}: ${errMsg}`);
                            throw err;
                        }

                        console.log(`[gap-fix] ✅ ${game.id}: Success`);
                        debug_logs.push(`[gap-fix] ✅ ${game.id}: Success`);
                        return result;
                    }));
                    rectifiedCount = results.filter(r => r.status === 'fulfilled').length;
                    console.log(`[discovery] 📊 Rectification Batch Complete: ${rectifiedCount}/${uniqueQueue.length} succeeded.`);
                }
            }
        }

        try {
            // Resilient Edge of Day Selection: Capture games in the current "Sports Day" window
            const todayStr = now.toISOString().split('T')[0];
            const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];

            const { data: upcomingIntel } = await supabase
                .from("pregame_intel")
                .select("match_id, logic_authority, game_date, headline, confidence_score, is_edge_of_day")
                .in("game_date", [todayStr, tomorrowStr]);

            if (upcomingIntel && upcomingIntel.length > 0) {
                const dateGroups: Record<string, any[]> = {};
                for (const intel of upcomingIntel) {
                    if (!dateGroups[intel.game_date]) dateGroups[intel.game_date] = [];
                    dateGroups[intel.game_date].push(intel);
                }

                for (const date in dateGroups) {
                    try {
                        const candidates = dateGroups[date].map(intel => {
                            const text = ((intel.logic_authority || "") + " " + (intel.headline || "")).toLowerCase();
                            let rawDelta = 0;
                            let detectionMethod = "None";

                            const suffixMatch = text.match(/([\d.]+)\s*%?\s*(?:pts?|points?|goals?|%|sigma|probability)?\s*(?:edge|delta|discrepancy|inflation|advantage|friction)/);
                            if (suffixMatch) {
                                rawDelta = parseFloat(suffixMatch[1]) || 0;
                                detectionMethod = "Explicit_Suffix";
                            }

                            if (rawDelta === 0) {
                                const prefixMatch = text.match(/(?:delta|edge|discrepancy|inflation|advantage|friction)\s*(?:of|:)?\s*([\d.]+)/);
                                if (prefixMatch) {
                                    rawDelta = parseFloat(prefixMatch[1]) || 0;
                                    detectionMethod = "Explicit_Prefix";
                                }
                            }

                            if (rawDelta === 0) {
                                const vsMatch = text.match(/(?:fair|true|model|implied|projected|internal|internal value).*?([\d.]+).*?(?:vs|market|vegas|market line).*?([\d.]+)/);
                                if (vsMatch) {
                                    const v1 = parseFloat(vsMatch[1]) || 0;
                                    const v2 = parseFloat(vsMatch[2]) || 0;
                                    rawDelta = Math.abs(v1 - v2);
                                    detectionMethod = `Implied_VS(${v1}/${v2})`;
                                }
                            }

                            if (rawDelta > 40) { rawDelta = 0; detectionMethod = "Discarded_Hallucination"; }

                            let confidence = Number(intel.confidence_score) || 50;
                            if (confidence > 0 && confidence <= 1.0) {
                                confidence *= 100;
                            } else if (confidence > 1.0 && confidence < 5) {
                                confidence *= 20;
                            }

                            const score = (rawDelta * 2) + ((confidence - 50) / 10);

                            return {
                                id: intel.match_id,
                                score: isNaN(score) ? 0 : score,
                                delta: isNaN(rawDelta) ? 0 : rawDelta,
                                method: detectionMethod,
                                confidence: isNaN(confidence) ? 50 : confidence
                            };
                        });

                        candidates.sort((a, b) => b.score - a.score);
                        debug_logs.push(`[${date}] 📊 Evaluation: ${candidates.length} candidates found.`);
                        if (candidates.length > 0) {
                            const top = candidates[0];
                            debug_logs.push(`[${date}] 🔍 Top: ${top.id} | Score: ${top.score.toFixed(1)} | Edge: ${top.delta.toFixed(2)} | Method: ${top.method} | Conf: ${top.confidence}`);
                        }

                        const winner = candidates[0];

                        if (winner && winner.score > 0) {
                            debug_logs.push(`[${date}] 🏆 Crowned: ${winner.id} (Score: ${winner.score.toFixed(1)})`);

                            const currentWinner = dateGroups[date].find(i => i.is_edge_of_day);
                            if (currentWinner?.match_id !== winner.id) {
                                debug_logs.push(`[${date}] 🏆 New Winner: ${winner.id} (Old: ${currentWinner?.match_id || 'None'})`);
                                await Promise.all([
                                    supabase.from("pregame_intel")
                                        .update({ is_edge_of_day: false })
                                        .eq("game_date", date)
                                        .neq("match_id", winner.id),

                                    supabase.from("pregame_intel")
                                        .update({ is_edge_of_day: true })
                                        .eq("match_id", winner.id)
                                        .eq("game_date", date)
                                ]);
                            } else {
                                debug_logs.push(`[${date}] ✅ Edge Stable: ${winner.id}`);
                            }
                        } else {
                            debug_logs.push(`[${date}] No clear edge found.`);
                        }
                    } catch (innerErr: any) {
                        console.error(`[EdgeOfDay] Error processing ${date}:`, innerErr);
                        debug_logs.push(`Error on ${date}: ${innerErr.message}`);
                    }
                }
            } else {
                debug_logs.push("No upcoming intel found in DB.");
            }
        } catch (e: any) {
            console.error(`[EdgeOfDay] System Fault:`, e);
            debug_logs.push(`Selection critical error: ${e.message}`);
        }

        await supabase.from("pregame_intel_log").insert({
            batch_id: batchId,
            matches_processed: slate?.length || 0,
            matches_succeeded: rectifiedCount,
            matches_failed: (queueLength - rectifiedCount),
            trace: trace,
            duration_ms: Date.now() - now.getTime()
        });

        return new Response(JSON.stringify({
            status: "SUCCESS",
            rectified: rectifiedCount,
            batch_size: queueLength,
            debug_logs,
            trace
        }), { headers: CORS_HEADERS });

    } catch (err: any) {
        console.error(`[discovery] ❌ Critical System Failure:`, err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
});
