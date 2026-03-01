// Fix: Add Deno & EdgeRuntime global declarations for TypeScript compatibility
declare const Deno: any;
declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void };

/**
 * PREGAME INTEL CRON (Mission Critical Discovery & Rectification)
 * v6.0 - Production Master (Self-DDOS Protection & Resiliency)
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCanonicalMatchId, toLocalGameDate } from "../_shared/match-registry.ts";
import { validateEdgeAuth } from "../_shared/env.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey, x-pipeline-secret, x-cron-secret",
    "Content-Type": "application/json",
};

// === OPTIMIZED CONFIGURATION ===
const CONFIG = {
    LOOKAHEAD_HOURS: 120,
    FETCH_LIMIT: 350,
    BATCH_SIZE: 50,
    // 🚨 Self-DDOS Fix: Lowered to 3 to align with the Worker's max concurrency limit (2)
    CONCURRENCY: 3,
    TIMEOUT_MS: 180_000,
    STALE_HOURS: 12,
    THROTTLE_MINS: 14
};

const VOLATILITY_THRESHOLDS: Record<string, { spread: number, total: number }> = {
    'nba': { spread: 1.0, total: 2.0 },
    'nfl': { spread: 0.5, total: 1.0 },
    'mlb': { spread: 0.5, total: 0.5 },
    'ncaab': { spread: 1.5, total: 2.5 },
    'default': { spread: 1.0, total: 1.5 }
};

// === UTILITIES ===

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: number | undefined;
    const timeout = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} (>${ms}ms)`)), ms) as unknown as number;
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const safeParseFloat = (v: unknown): number | null => {
    if (isFiniteNumber(v)) return v;
    if (typeof v === "string") {
        const parsed = parseFloat(v.replace(/[^\d.-]/g, ""));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

// Controlled Concurrency Processor
async function processInBatches<T, R>(
    items: T[],
    batchSize: number,
    processor: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const chunk = items.slice(i, i + batchSize);
        const chunkResults = await Promise.allSettled(chunk.map(processor));
        results.push(...chunkResults);
    }
    return results;
}

// 🚨 WORKER RETRY GUARD: Catches 429s, 503s, and network drops to prevent batch failures
async function fetchWorkerWithRetry(url: string, payload: any, headers: any, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
            const text = await res.text().catch(() => "");

            if (res.status === 429 || res.status === 503) {
                if (i < maxRetries - 1) {
                    console.warn(`[Worker:${payload.match_id}] ${res.status} returned. Retrying (${i + 1}/${maxRetries})...`);
                    await sleep(3000 + Math.random() * 2000);
                    continue;
                }
            }

            if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 150)}`);

            try {
                return JSON.parse(text);
            } catch (e) {
                throw new Error(`Invalid JSON returned: ${text.substring(0, 100)}`);
            }
        } catch (e: any) {
            // Catch raw DNS/Network exceptions
            if (i < maxRetries - 1) {
                console.warn(`[Worker:${payload.match_id}] Network Exception: ${e.message}. Retrying (${i + 1}/${maxRetries})...`);
                await sleep(3000 + Math.random() * 2000);
                continue;
            }
            throw e;
        }
    }
    throw new Error(`Failed after ${maxRetries} retries.`);
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    const authError = validateEdgeAuth(req);
    if (authError) return authError;

    const supabaseUrlRaw = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseUrl = supabaseUrlRaw.replace(/\/$/, "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const supabase = createClient(
        supabaseUrl,
        serviceRoleKey,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const body = await req.json().catch(() => ({}));
    const userAgent = req.headers.get("user-agent") || "";
    const cronSecret = req.headers.get("x-cron-secret");

    const isCron = body.is_cron === true ||
        userAgent.includes("PostgREST") ||
        userAgent.includes("pg_net") ||
        (userAgent.includes("Deno") && Object.keys(body).length === 0) ||
        cronSecret === Deno.env.get("CRON_SECRET");

    const isForce = body.force === true;
    const triggerLabel = isCron ? (isForce ? "CRON_FORCE" : "CRON") : "MANUAL";
    const batchId = `cron_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const startTime = new Date();

    console.log(`[pulse] 💓 HEARTBEAT: ${triggerLabel} | Start: ${startTime.toISOString()}`);

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
            console.error("[pulse-err] Failed heartbeat log:", e?.message || String(e));
        }
    }

    // === MANUAL HANDLER (Proxies to pregame-intel-worker) ===
    if ((body.match_id || body.job_id) && !isCron) {
        console.log(`[originator] 🔬 Targeted Dossier Request proxy to worker: ${body.match_id || body.job_id}`);
        try {
            const fetchPromise = fetch(`${supabaseUrl}/functions/v1/pregame-intel-worker`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${serviceRoleKey}`,
                    "apikey": serviceRoleKey
                },
                body: JSON.stringify({ ...body, force_refresh: true })
            });

            // 🚨 Proxy Hang Fix: Ensure UI manual requests don't hang infinitely if Worker crashes
            const proxyRes = await withTimeout(fetchPromise, 45000, "Manual Proxy Request");

            const textRes = await proxyRes.text();

            // Transparent proxy status pass-through
            if (!proxyRes.ok) {
                console.warn(`[originator-proxy] Worker returned ${proxyRes.status}: ${textRes.substring(0, 100)}`);
                return new Response(textRes, { headers: CORS_HEADERS, status: proxyRes.status });
            }

            return new Response(textRes, { headers: CORS_HEADERS, status: 200 });
        } catch (manualErr: any) {
            const errStr = manualErr?.message || String(manualErr);
            console.error(`[originator-error]`, errStr);
            return new Response(JSON.stringify({ error: errStr }), { status: 500, headers: CORS_HEADERS });
        }
    }

    // === CRON HANDLER ===
    if (isCron) {
        try {
            const { data: sentinel } = await supabase
                .from("pregame_intel")
                .select("generated_at")
                .eq("match_id", "CRON_SENTINEL")
                .eq("game_date", "2099-12-31")
                .maybeSingle();

            if (sentinel && sentinel?.generated_at) {
                const ageMins = (Date.now() - new Date(sentinel.generated_at).getTime()) / (1000 * 60);
                if (ageMins < CONFIG.THROTTLE_MINS && !isForce) {
                    console.log(`[guard] 🛑 Throttling: Last run ${ageMins.toFixed(1)}m ago`);
                    return new Response(JSON.stringify({
                        status: "THROTTLED",
                        age_mins: ageMins,
                        batchId
                    }), { status: 200, headers: CORS_HEADERS });
                }
            }

            const lockDossier = {
                match_id: "CRON_SENTINEL",
                sport: "SYSTEM",
                league_id: "SYSTEM",
                home_team: "SYSTEM",
                away_team: "SYSTEM",
                game_date: "2099-12-31",
                headline: "Cron Sentinel [LOCKED]",
                briefing: "Execution tracking active.",
                cards: [{ category: 'SITUATIONAL', thesis: 'Throttling guard heartbeat.', impact: 'LOW' }],
                logic_group: "SITUATIONAL",
                confidence_tier: "LOW",
                pick_summary: "N/A",
                recommended_pick: "N/A",
                generated_at: new Date().toISOString()
            };
            await supabase.from("pregame_intel").upsert(lockDossier, { onConflict: 'match_id,game_date' });
            console.log(`[guard] 🔒 Lock acquired. Starting Batch: ${batchId}`);

            const backgroundWork = runBatchProcessing(supabase, batchId, isForce, startTime, supabaseUrl, serviceRoleKey)
                .catch(err => {
                    console.error(`[background] ❌ Batch failed:`, err?.message || String(err));
                });

            if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
                EdgeRuntime.waitUntil(backgroundWork);
            }

            return new Response(JSON.stringify({
                status: "ACCEPTED",
                batchId,
                message: "Processing started in background",
                ts: new Date().toISOString()
            }), { status: 202, headers: CORS_HEADERS });

        } catch (e: any) {
            const errStr = e?.message || String(e);
            console.error(`[cron-error]`, errStr);
            return new Response(JSON.stringify({ error: errStr }), { status: 500, headers: CORS_HEADERS });
        }
    }

    return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: CORS_HEADERS });
});

// === BACKGROUND BATCH PROCESSING ===
async function runBatchProcessing(supabase: any, batchId: string, isForce: boolean, startTime: Date, supabaseUrl: string, serviceRoleKey: string) {
    const trace: string[] = [];
    const debug_logs: string[] = [];
    let rectifiedCount = 0;
    let queueLength = 0;
    let slateCount = 0;

    try {
        trace.push(`[boot] Background batch started: ${batchId}`);
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
        slateCount = slate?.length || 0;

        if (slate?.length) {
            const canonicalIds = (slate as any[]).map(s => getCanonicalMatchId(s.id, s.league_id));

            const { data: existingIntel, error: intelErr } = await supabase
                .from("pregame_intel")
                .select("match_id, game_date, generated_at, freshness, analyzed_spread, analyzed_total")
                .in("match_id", canonicalIds)
                .order("generated_at", { ascending: true });

            if (!intelErr) {
                debug_logs.push(`[discovery] 🔍 Cache hit: ${existingIntel?.length || 0} existing records.`);

                const queue = (slate as any[]).map(game => {
                    const canonicalId = getCanonicalMatchId(game.id, game.league_id);
                    const gameDate = toLocalGameDate(game.start_time);

                    const intel: any = (existingIntel || []).find((i: any) =>
                        i.match_id === canonicalId && i.game_date === gameDate
                    );

                    let priority = 0;
                    const hoursToStart = (new Date(game.start_time).getTime() - Date.now()) / (1000 * 60 * 60);

                    if (!intel || isForce) {
                        priority = 100;
                    } else {
                        const ageHours = intel?.generated_at ? (Date.now() - new Date(intel.generated_at).getTime()) / (1000 * 60 * 60) : 999;

                        let staleThreshold = CONFIG.STALE_HOURS;
                        if (hoursToStart < 4) staleThreshold = 1;
                        else if (hoursToStart < 24) staleThreshold = 4;

                        if (ageHours > staleThreshold) {
                            priority = 50;
                        }

                        // 🚨 STRING PARSING FIX: Safeguard the Volatility Math from NaN crashes
                        const leagueKey = (game.league_id || 'default').toLowerCase();
                        const thresholds = VOLATILITY_THRESHOLDS[leagueKey] || VOLATILITY_THRESHOLDS['default'];
                        const oddsObj = (game as any).current_odds || {};

                        const currentSpread = safeParseFloat((game as any).odds_home_spread_safe ?? oddsObj?.homeSpread ?? oddsObj?.spread);
                        const currentTotal = safeParseFloat((game as any).odds_total_safe ?? oddsObj?.total ?? oddsObj?.overUnder);

                        const analyzedSpread = safeParseFloat(intel.analyzed_spread);
                        const analyzedTotal = safeParseFloat(intel.analyzed_total);

                        if (currentSpread != null && analyzedSpread != null) {
                            const spreadDelta = Math.abs(currentSpread - analyzedSpread);
                            if (spreadDelta > thresholds.spread) {
                                priority = 100;
                                trace.push(`[volatility] Spread: ${game.id} (Δ${spreadDelta.toFixed(1)})`);
                            }
                        }
                        if (currentTotal != null && analyzedTotal != null) {
                            const totalDelta = Math.abs(currentTotal - analyzedTotal);
                            if (totalDelta > thresholds.total) {
                                priority = 100;
                                trace.push(`[volatility] Total: ${game.id} (Δ${totalDelta.toFixed(1)})`);
                            }
                        }
                    }

                    if (priority > 0) priority += Math.max(0, 24 - hoursToStart);
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

                    const headers = {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${serviceRoleKey}`,
                        "apikey": serviceRoleKey
                    };

                    const results = await processInBatches(uniqueQueue, CONFIG.CONCURRENCY, async ({ game }) => {
                        const odds = (game as any).current_odds || {};
                        const workerPayload = {
                            match_id: game.id,
                            home_team: game.home_team,
                            away_team: game.away_team,
                            sport: game.sport,
                            league: game.league_id,
                            start_time: game.start_time,
                            current_spread: (game as any).odds_home_spread_safe ?? odds?.homeSpread ?? odds?.spread ?? null,
                            current_total: (game as any).odds_total_safe ?? odds?.total ?? odds?.overUnder ?? null,
                            current_odds: odds,
                            spread_juice: odds?.homeSpreadOdds ?? odds?.spread_best?.home?.price ?? odds?.spreadHomeOdds ?? null,
                            total_juice: odds?.overOdds ?? odds?.total_best?.over?.price ?? odds?.totalOverOdds ?? null,
                            home_ml: odds?.homeWin ?? odds?.home_ml ?? odds?.best_h2h?.home?.price ?? null,
                            away_ml: odds?.awayWin ?? odds?.away_ml ?? odds?.best_h2h?.away?.price ?? null,
                            force_refresh: true
                        };

                        const fetchPromise = fetchWorkerWithRetry(`${supabaseUrl}/functions/v1/pregame-intel-worker`, workerPayload, headers, 3);
                        const result = await withTimeout(fetchPromise, CONFIG.TIMEOUT_MS, `Worker: ${game.id}`) as any;

                        if (result?.error) throw new Error(result.error);
                        console.log(`[gap-fix] ✅ ${game.id}: Success`);
                        return result;
                    });

                    rectifiedCount = results.filter(r => r.status === 'fulfilled').length;
                    console.log(`[discovery] 📊 Rectification Complete: ${rectifiedCount}/${uniqueQueue.length} succeeded.`);
                }
            }
        }

        // === EDGE OF DAY LOGIC ===
        // 🚨 Stagnant Rank Fix: Unwrapped from `if (rectifiedCount > 0)` so it analyzes drift on every cron pulse
        try {
            const todayStr = toLocalGameDate(now.toISOString());
            const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            const tomorrowStr = toLocalGameDate(tomorrow.toISOString());

            const { data: upcomingIntel } = await supabase
                .from("pregame_intel")
                .select("match_id, logic_authority, game_date, headline, confidence_score, confidence_tier, is_edge_of_day")
                .in("game_date", [todayStr, tomorrowStr]);

            if (upcomingIntel && upcomingIntel.length > 0) {
                const dateGroups: Record<string, any[]> = {};
                for (const intel of upcomingIntel) {
                    if (!dateGroups[intel.game_date]) dateGroups[intel.game_date] = [];
                    dateGroups[intel.game_date].push(intel);
                }

                for (const date of Object.keys(dateGroups)) {
                    const candidates = dateGroups[date].map((intel: any) => {
                        const text = ((intel.logic_authority || "") + " " + (intel.headline || "")).toLowerCase();
                        let rawDelta = 0;
                        let detectionMethod = "None";

                        const evMatch = text.match(/(?:expected value|ev|roi)[^\d+-]*([+-]?\s*[\d.]+)/i);
                        if (evMatch) {
                            rawDelta = parseFloat(evMatch[1].replace(/\s+/g, "")) || 0;
                            detectionMethod = "Explicit_EV";
                        }

                        if (rawDelta === 0) {
                            const suffixMatch = text.match(/([+-]?\s*[\d.]+)\s*%?\s*(?:pts?|points?|goals?|%|sigma|probability|ev|roi)?\s*(?:edge|delta|discrepancy|inflation|advantage|friction)/i);
                            if (suffixMatch) {
                                rawDelta = parseFloat(suffixMatch[1].replace(/\s+/g, "")) || 0;
                                detectionMethod = "Explicit_Suffix";
                            }
                        }

                        if (rawDelta === 0) {
                            const prefixMatch = text.match(/(?:delta|edge|discrepancy|inflation|advantage|friction|ev|roi|expected value)\s*(?:of|:|-)?\s*([+-]?\s*[\d.]+)/i);
                            if (prefixMatch) {
                                rawDelta = parseFloat(prefixMatch[1].replace(/\s+/g, "")) || 0;
                                detectionMethod = "Explicit_Prefix";
                            }
                        }

                        if (rawDelta === 0) {
                            const vsMatch = text.match(/(?:fair|true|model|implied|projected|internal|internal value).*?([+-]?\s*[\d.]+).*?(?:vs|market|vegas|market line).*?([+-]?\s*[\d.]+)/i);
                            if (vsMatch) {
                                const v1 = parseFloat(vsMatch[1].replace(/\s+/g, "")) || 0;
                                const v2 = parseFloat(vsMatch[2].replace(/\s+/g, "")) || 0;
                                rawDelta = Math.abs(v1 - v2);
                                detectionMethod = `Implied_VS(${v1}/${v2})`;
                            }
                        }

                        let isNegativeEV = false;
                        if (rawDelta < 0) {
                            isNegativeEV = true;
                            rawDelta = 0;
                            detectionMethod = "Negative_EV_Discarded";
                        } else if (rawDelta > 40) {
                            rawDelta = 0;
                            detectionMethod = "Discarded_Hallucination";
                        }

                        let confidence = 50;
                        if (intel.confidence_score != null) {
                            confidence = Number(intel.confidence_score);
                            if (confidence > 0 && confidence <= 1.0) confidence *= 100;
                            else if (confidence > 1.0 && confidence <= 5) confidence *= 20;
                        } else if (intel.confidence_tier) {
                            const tier = String(intel.confidence_tier).toUpperCase();
                            if (tier === 'HIGH') confidence = 85;
                            else if (tier === 'MEDIUM') confidence = 65;
                            else if (tier === 'LOW') confidence = 40;
                        }

                        let score = (rawDelta * 2) + ((confidence - 50) / 10);
                        if (isNegativeEV) score = -99;

                        return {
                            id: intel.match_id,
                            score: Number.isFinite(score) ? score : 0,
                            delta: Number.isFinite(rawDelta) ? rawDelta : 0,
                            method: detectionMethod,
                            confidence: Number.isFinite(confidence) ? confidence : 50
                        };
                    });

                    const validCandidates = candidates.filter((c: any) => c.score > 0);

                    // Tie-Breaker Fix: Fallback to confidence, then delta
                    validCandidates.sort((a: any, b: any) => b.score - a.score || b.confidence - a.confidence || b.delta - a.delta);

                    const winner = validCandidates[0];

                    if (winner) {
                        const currentWinner = dateGroups[date].find((i: any) => i.is_edge_of_day);
                        if (currentWinner?.match_id !== winner.id) {
                            console.log(`[EdgeOfDay] 🏆 New Edge for ${date}: ${winner.id} (Score: ${winner.score.toFixed(1)} | Method: ${winner.method})`);

                            await Promise.all([
                                supabase.from("pregame_intel").update({ is_edge_of_day: false }).eq("game_date", date).neq("match_id", winner.id),
                                supabase.from("pregame_intel").update({ is_edge_of_day: true }).eq("match_id", winner.id).eq("game_date", date)
                            ]).catch((err: any) => {
                                console.error(`[EdgeOfDay] Failed to update DB for ${winner.id}:`, err?.message || String(err));
                            });
                        }
                    }
                }
            }
        } catch (e: any) {
            console.error(`[EdgeOfDay] Error:`, e?.message || String(e));
        }

        await supabase.from("pregame_intel_log").insert({
            batch_id: batchId,
            matches_processed: queueLength,
            matches_succeeded: rectifiedCount,
            matches_failed: (queueLength - rectifiedCount),
            trace: trace.slice(0, 100),
            duration_ms: Date.now() - startTime.getTime()
        });

    } catch (err: any) {
        const errStr = err?.message || String(err);
        console.error(`[background] ❌ Critical Failure:`, errStr);
        await supabase.from("pregame_intel_log").insert({
            batch_id: batchId,
            matches_processed: queueLength,
            matches_succeeded: rectifiedCount,
            matches_failed: (queueLength - rectifiedCount),
            trace: [`[error] ${errStr}`],
            duration_ms: Date.now() - startTime.getTime()
        });
    }
}
