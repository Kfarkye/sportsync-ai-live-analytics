// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";
import { buildMatchDossier, detectSportFromLeague } from "../_shared/match-dossier.ts";
import { cleanHeadline, cleanCardThesis } from "../_shared/intel-guards.ts";
import { PREGAME_INTEL_SCHEMA_BASE, PREGAME_INTEL_SYSTEM_INSTRUCTION } from "../_shared/prompts/pregame-intel-v1.ts";
import { normalizeTennisOdds } from "../_shared/tennis-odds-normalizer.ts";
import { normalizeSoccerOdds } from "../_shared/soccer-odds-normalizer.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-client-info, apikey, x-client-timeout, x-trace-id",
};

// -------------------------------------------------------------------------
// GLOBAL CONCURRENCY GUARD (Queue + Lease)
// -------------------------------------------------------------------------
const INTEL_CONCURRENCY = Number(Deno.env.get("PREGAME_INTEL_MAX_CONCURRENCY") ?? "2");
const INTEL_LEASE_TTL_SEC = Number(Deno.env.get("PREGAME_INTEL_LEASE_TTL_SEC") ?? "150");
const INTEL_MAX_WAIT_MS = Number(Deno.env.get("PREGAME_INTEL_MAX_WAIT_MS") ?? "8000");
const INTEL_WAIT_STEP_MS = Number(Deno.env.get("PREGAME_INTEL_WAIT_STEP_MS") ?? "1200");
const INTEL_PRIMARY_MODEL = Deno.env.get("PREGAME_INTEL_MODEL") ?? "gemini-3-flash-preview";
const INTEL_FALLBACK_MODEL = Deno.env.get("PREGAME_INTEL_FALLBACK_MODEL") ?? "gemini-2.0-flash";

class QueueFullError extends Error {}
class OverloadedError extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isOverloadedError = (err: any) => {
    const msg = String(err?.message || "");
    return msg.includes("UNAVAILABLE") || msg.includes("503") || msg.toLowerCase().includes("overloaded");
};

async function acquireIntelLeaseWithBackoff(supabase: any, requestId: string) {
    const start = Date.now();
    let attempts = 0;

    while (Date.now() - start < INTEL_MAX_WAIT_MS) {
        const { data, error } = await supabase.rpc("acquire_intel_lease", {
            p_request_id: requestId,
            p_limit: INTEL_CONCURRENCY,
            p_ttl_seconds: INTEL_LEASE_TTL_SEC,
        });

        if (error) {
            const msg = String(error.message || "");
            if (msg.includes("acquire_intel_lease") && msg.includes("does not exist")) {
                console.warn(`[Intel:${requestId}] Lease RPC missing. Bypassing concurrency guard until migration applied.`);
                return { leaseId: null, bypass: true };
            }
            console.warn(`[Intel:${requestId}] Lease RPC error: ${msg}`);
        } else if (data) {
            return { leaseId: data as string, bypass: false };
        }

        attempts += 1;
        const jitter = Math.floor(Math.random() * 250);
        const waitMs = Math.min(INTEL_WAIT_STEP_MS * attempts + jitter, 2500);
        await sleep(waitMs);
    }

    return { leaseId: null, bypass: false };
}

async function releaseIntelLease(supabase: any, leaseId: string, requestId: string) {
    const { error } = await supabase.rpc("release_intel_lease", { p_lease_id: leaseId });
    if (error) {
        console.warn(`[Intel:${requestId}] Lease release error: ${error.message}`);
    }
}

// -------------------------------------------------------------------------
// INPUT SCHEMA
// -------------------------------------------------------------------------
const coerceNullableNumber = () =>
    z.preprocess((v: any) => {
        if (v === null || v === undefined) return null;
        if (typeof v === "string") {
            const s = v.trim().toLowerCase();
            if (s === "" || s === "null" || s === "undefined" || s === "na" || s === "n/a")
                return null;
        }
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }, z.number().nullable());

const RequestSchema = z.object({
    job_id: z.string().optional(),
    match_id: z.string().min(1),
    league: z.string().nullable().optional().transform((v: any) => (v == null || v === "" ? null : v)),
    sport: z.string().nullable().optional(),
    start_time: z.string().optional(),
    current_spread: coerceNullableNumber().optional(),
    current_total: coerceNullableNumber().optional(),
    home_team: z.string().optional(),
    away_team: z.string().optional(),
    home_net_rating: coerceNullableNumber().optional().default(0),
    away_net_rating: coerceNullableNumber().optional().default(0),
    current_odds: z.any().optional(),
    home_ml: z.union([z.string(), z.number()]).nullable().optional().transform((v: any) => (v != null ? String(v) : null)),
    away_ml: z.union([z.string(), z.number()]).nullable().optional().transform((v: any) => (v != null ? String(v) : null)),
    spread_juice: z.union([z.string(), z.number()]).nullable().optional().transform((v: any) => (v != null ? String(v) : null)),
    total_juice: z.union([z.string(), z.number()]).nullable().optional().transform((v: any) => (v != null ? String(v) : null)),
    force_refresh: z.boolean().optional().default(false),
});

// -------------------------------------------------------------------------
// ODDS HELPERS (Preserving Original Math)
// -------------------------------------------------------------------------
const isFiniteNumber = (v: any): v is number => typeof v === "number" && Number.isFinite(v);
const safeNumOrNull = (x: any) => (isFiniteNumber(x) ? x : null);

const parseAmericanOdds = (v: any): number | null => {
    if (v == null) return null;
    const raw = typeof v === "number" ? String(v) : String(v).trim();
    if (!raw) return null;
    const lowered = raw.trim().toLowerCase();
    if (["n/a", "na", "none", "null", "-", "undefined"].includes(lowered)) return null;
    if (["ev", "even", "evens"].includes(lowered)) return 100;

    if (raw.includes(".")) {
        const m = raw.match(/^\(?([+\-]?\d+)(?:\.0+)?\)?$/);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        if (!Number.isFinite(n)) return null;
        if (n === 0) return null;
        if (Math.abs(n) < 100) return null;
        if (Math.abs(n) > 20000) return null;
        return n;
    }

    const cleaned = raw.replace(/[^\d+\-]/g, "");
    if (!cleaned) return null;
    const n = parseInt(cleaned, 10);
    if (!Number.isFinite(n)) return null;
    if (n === 0) return null;
    if (Math.abs(n) < 100) return null;
    if (Math.abs(n) > 20000) return null;
    return n;
};

const fmtAmerican = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
const fmtLine = (n: number): string => {
    if (Object.is(n, -0)) return "0";
    if (Number.isInteger(n)) return n.toFixed(0);
    const q = Math.round(n * 4);
    if (Math.abs(n * 4 - q) < 1e-9) return (q / 4).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return n.toFixed(1);
};
const safeJuiceFmt = (val: any): string | null => {
    const n = parseAmericanOdds(val);
    return n !== null ? fmtAmerican(n) : null;
};

// -------------------------------------------------------------------------
// MARKET SNAPSHOT
// -------------------------------------------------------------------------
type MarketOffer = {
    id: string;
    type: "SPREAD" | "TOTAL" | "MONEYLINE";
    side: "HOME" | "AWAY" | "OVER" | "UNDER";
    selection: string;
    line: number | null;
    price_american: number;
    price: string;
    label: string;
};

const lineKey = (line: number | null): string => {
    if (line == null) return "na";
    const normalized = Math.abs(line) < 0.25 ? 0 : line;
    const abs = fmtLine(Math.abs(normalized)).replace(/[^\d.]/g, "");
    if (normalized === 0) return "z0";
    return normalized > 0 ? `p${abs}` : `m${abs}`;
};

const makeOfferId = (type: string, side: string, line: number | null, priceA: number) => {
    const linePart = lineKey(line);
    const pricePart = priceA > 0 ? `p${priceA}` : `m${Math.abs(priceA)}`;
    return `${type}_${side}_${linePart}_${pricePart}`.replace(/\s+/g, "").toLowerCase();
};

const buildMarketSnapshot = (p: any, odds: any): MarketOffer[] => {
    const offers: MarketOffer[] = [];
    const hTeam = p.home_team || "Home";
    const aTeam = p.away_team || "Away";

    const homeSpreadRaw = p.spread_juice ?? odds?.homeSpreadOdds ?? odds?.spread_best?.home?.price;
    const awaySpreadRaw = odds?.awaySpreadOdds ?? odds?.spread_best?.away?.price;
    const overRaw = p.total_juice ?? odds?.overOdds ?? odds?.total_best?.over?.price;
    const underRaw = odds?.underOdds ?? odds?.total_best?.under?.price;
    const homeMlRaw = p.home_ml ?? odds?.homeWin ?? odds?.home_ml ?? odds?.best_h2h?.home?.price;
    const awayMlRaw = p.away_ml ?? odds?.awayWin ?? odds?.away_ml ?? odds?.best_h2h?.away?.price;

    if (isFiniteNumber(p.current_spread)) {
        const spread = p.current_spread;
        const homePriceA = parseAmericanOdds(homeSpreadRaw);
        const awayPriceA = parseAmericanOdds(awaySpreadRaw);

        if (homePriceA != null) {
            const isPk = Math.abs(spread) < 0.25;
            offers.push({
                id: makeOfferId("SPREAD", "HOME", spread, homePriceA),
                type: "SPREAD",
                side: "HOME",
                selection: hTeam,
                line: spread,
                price_american: homePriceA,
                price: fmtAmerican(homePriceA),
                label: `${hTeam} ${isPk ? "Pick'em" : (spread > 0 ? "+" : "") + fmtLine(spread)} (${fmtAmerican(homePriceA)})`,
            });
        }
        if (awayPriceA != null) {
            const line = spread * -1;
            const isPk = Math.abs(line) < 0.25;
            offers.push({
                id: makeOfferId("SPREAD", "AWAY", line, awayPriceA),
                type: "SPREAD",
                side: "AWAY",
                selection: aTeam,
                line,
                price_american: awayPriceA,
                price: fmtAmerican(awayPriceA),
                label: `${aTeam} ${isPk ? "Pick'em" : (line > 0 ? "+" : "") + fmtLine(line)} (${fmtAmerican(awayPriceA)})`,
            });
        }
    }

    if (isFiniteNumber(p.current_total)) {
        const total = p.current_total;
        const overA = parseAmericanOdds(overRaw);
        const underA = parseAmericanOdds(underRaw);

        if (overA != null) {
            offers.push({
                id: makeOfferId("TOTAL", "OVER", total, overA),
                type: "TOTAL",
                side: "OVER",
                selection: "OVER",
                line: total,
                price_american: overA,
                price: fmtAmerican(overA),
                label: `OVER ${fmtLine(total)} (${fmtAmerican(overA)})`,
            });
        }
        if (underA != null) {
            offers.push({
                id: makeOfferId("TOTAL", "UNDER", total, underA),
                type: "TOTAL",
                side: "UNDER",
                selection: "UNDER",
                line: total,
                price_american: underA,
                price: fmtAmerican(underA),
                label: `UNDER ${fmtLine(total)} (${fmtAmerican(underA)})`,
            });
        }
    }

    const homeMlA = parseAmericanOdds(homeMlRaw);
    const awayMlA = parseAmericanOdds(awayMlRaw);

    if (homeMlA != null) {
        offers.push({
            id: makeOfferId("MONEYLINE", "HOME", null, homeMlA),
            type: "MONEYLINE",
            side: "HOME",
            selection: hTeam,
            line: null,
            price_american: homeMlA,
            price: fmtAmerican(homeMlA),
            label: `${hTeam} Moneyline (${fmtAmerican(homeMlA)})`,
        });
    }
    if (awayMlA != null) {
        offers.push({
            id: makeOfferId("MONEYLINE", "AWAY", null, awayMlA),
            type: "MONEYLINE",
            side: "AWAY",
            selection: aTeam,
            line: null,
            price_american: awayMlA,
            price: fmtAmerican(awayMlA),
            label: `${aTeam} Moneyline (${fmtAmerican(awayMlA)})`,
        });
    }

    return offers;
};

const formatPick = (o: MarketOffer): string => {
    if (o.type === "MONEYLINE") return `${o.selection} ML`;
    if (o.type === "TOTAL") return `${o.side} ${fmtLine(o.line ?? 0)}`;
    const line = o.line ?? 0;
    const numericLine = Math.abs(line) < 0.25 ? 0 : line;
    return `${o.selection} ${numericLine >= 0 ? "+" : ""}${fmtLine(numericLine)}`;
};

const pickFallbackOffer = (offers: MarketOffer[], fairLine: number, currentSpread: number | null | undefined): MarketOffer | null => {
    if (!offers.length) return null;
    const spreadOffers = offers.filter((o) => o.type === "SPREAD");
    if (spreadOffers.length && isFiniteNumber(currentSpread)) {
        const pickSide = fairLine < currentSpread ? "HOME" : "AWAY";
        const candidate = spreadOffers.find((o) => o.side === pickSide);
        if (candidate) return candidate;
        return spreadOffers[0];
    }
    const totalOffers = offers.filter((o) => o.type === "TOTAL");
    if (totalOffers.length) return totalOffers[0];
    return offers[0];
};

const stripUnknownColumnsAndRetryUpsert = async (supabase: any, table: string, payload: any, opts: any) => {
    let attempt = 0;
    let working = { ...payload };
    while (attempt < 4) {
        const { error } = await supabase.from(table).upsert(working, opts);
        if (!error) return { ok: true, payload: working };
        const msg = String(error.message || "");
        if (msg.includes("schema cache")) return { ok: false, error, payload: working, schemaCache: true };
        const m = msg.match(/column "([^"]+)" of relation/i);
        if (m && m[1]) {
            delete (working as any)[m[1]];
            attempt++;
            continue;
        }
        return { ok: false, error, payload: working };
    }
    return { ok: false, error: new Error("Upsert failed after stripping"), payload: working };
};

// -------------------------------------------------------------------------
// SERVER ENTRY
// -------------------------------------------------------------------------
// @ts-ignore: Deno is global
Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    const supabase = createClient(
        // @ts-ignore
        Deno.env.get("SUPABASE_URL") ?? "",
        // @ts-ignore
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const requestId = crypto.randomUUID().slice(0, 8);
    console.log(`[${requestId}] 🚀 [WORKER-START] Request received`);

    try {
        const body = await req.json().catch(() => ({}));
        if (Object.keys(body).length === 0) {
            return new Response(JSON.stringify({ status: "ok", msg: "Architect Alive" }), { headers: CORS_HEADERS });
        }

        // JOB QUEUE
        if (body.job_id) {
            console.log(`WORKER: Processing Job ${body.job_id}`);
            await supabase.from("intel_jobs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", body.job_id);
            const { data: items } = await supabase.from("intel_job_items").select("*").eq("job_id", body.job_id).eq("status", "pending");

            if (!items || items.length === 0) {
                await supabase.from("intel_jobs").update({ status: "completed" }).eq("id", body.job_id);
                return new Response(JSON.stringify({ note: "Job Empty" }), { status: 200, headers: CORS_HEADERS });
            }

            for (const item of items) {
                try {
                    const { data: match } = await supabase.from("matches").select("*").eq("id", item.match_id).single();
                    if (!match) continue;
                    const p = {
                        match_id: item.match_id,
                        league: match.league_id,
                        sport: detectSportFromLeague(match.league_id),
                        start_time: match.start_time,
                        current_spread: match.odds?.spread,
                        current_total: match.odds?.total,
                        home_team: match.home_team,
                        away_team: match.away_team,
                        current_odds: match.current_odds,
                    };
                    await processSingleIntel(p, supabase, `job-${item.id.slice(0, 4)}`, { mode: "job" });
                    await supabase.from("intel_job_items").update({ status: "success" }).eq("id", item.id);
                } catch (e: any) {
                    if (e instanceof QueueFullError || e instanceof OverloadedError) {
                        console.warn(`Item Deferred: ${item.match_id} (${e.message})`);
                        // Leave status as pending so dispatcher can retry later.
                        continue;
                    }
                    console.error(`Item Fail: ${item.match_id}`, e.message);
                    await supabase.from("intel_job_items").update({ status: "failed", error: e.message }).eq("id", item.id);
                }
            }
            await supabase.from("intel_jobs").update({ status: "completed" }).eq("id", body.job_id);
            return new Response(JSON.stringify({ status: "Job Completed" }), { headers: CORS_HEADERS });
        }

        // DIRECT REQUEST
        const validation = RequestSchema.safeParse(body);
        if (!validation.success) throw new Error("Invalid Schema: " + validation.error.message);
        let p = validation.data as any;

        // HYDRATION
        if (!p.home_team || !p.away_team || !p.league) {
            console.log(`[${requestId}] 💧 [HYDRATION] Fetching details...`);
            const { data: match, error: matchErr } = await supabase
                .from("matches")
                .select("home_team, away_team, league_id, sport, start_time, odds_home_spread_safe, odds_total_safe, current_odds")
                .eq("id", p.match_id)
                .single();

            if (matchErr || !match) throw new Error(`Match ${p.match_id} not found.`);
            p = {
                ...p,
                home_team: p.home_team || match.home_team,
                away_team: p.away_team || match.away_team,
                league: p.league || match.league_id,
                sport: p.sport || match.sport || detectSportFromLeague(p.league || match.league_id),
                start_time: p.start_time || match.start_time,
                current_spread: p.current_spread ?? match.odds_home_spread_safe ?? match.current_odds?.homeSpread ?? match.current_odds?.spread_home_value,
                current_total: p.current_total ?? match.odds_total_safe ?? match.current_odds?.total ?? match.current_odds?.total_value,
                current_odds: p.current_odds || match.current_odds,
            };
        }

        if (!p.sport || p.sport === "basketball") {
            const derived = detectSportFromLeague(p.league);
            if (derived !== "basketball") p = { ...p, sport: derived };
        }

        // TENNIS NORMALIZATION: Map tennis-specific odds keys to standard fields
        if ((p.sport || "").toLowerCase() === "tennis") {
            const n = normalizeTennisOdds(p.current_odds || {});
            p = {
                ...p,
                current_spread: p.current_spread ?? n.spread,
                current_total: p.current_total ?? n.total,
                home_ml: (p.home_ml ?? n.homeMl) as any,
                away_ml: (p.away_ml ?? n.awayMl) as any,
            };
            console.log(`[${requestId}] 🎾 [TENNIS] Normalized: spread=${p.current_spread}, total=${p.current_total}, ML=${n.homeMl}/${n.awayMl}`);
        }

        // SOCCER NORMALIZATION: Map soccer-specific odds keys (Bundesliga, Liga MX, etc.)
        if ((p.sport || "").toLowerCase() === "soccer") {
            const n = normalizeSoccerOdds(p.current_odds || {});
            p = {
                ...p,
                current_spread: p.current_spread ?? n.spread,
                current_total: p.current_total ?? n.total,
                home_ml: (p.home_ml ?? n.homeMl) as any,
                away_ml: (p.away_ml ?? n.awayMl) as any,
            };
            console.log(`[${requestId}] ⚽ [SOCCER] Normalized: spread=${p.current_spread}, total=${p.current_total}, ML=${n.homeMl}/${n.awayMl}`);
        }

        try {
            const dossier = await processSingleIntel(p, supabase, requestId, { mode: "direct" });
            return new Response(JSON.stringify(dossier), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        } catch (err: any) {
            if (err instanceof QueueFullError) {
                console.warn(`[Intel:${requestId}] Queue full. Deferring request.`);
                return new Response(JSON.stringify({ status: "queued", match_id: p.match_id }), {
                    status: 429,
                    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
                });
            }
            if (err instanceof OverloadedError) {
                console.warn(`[Intel:${requestId}] Model overloaded. Deferring request.`);
                return new Response(JSON.stringify({ status: "overloaded", match_id: p.match_id }), {
                    status: 503,
                    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
                });
            }
            throw err;
        }
    } catch (err: any) {
        console.error(`[${crypto.randomUUID().slice(0, 8)}] ❌ FATAL:`, err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
});

// -------------------------------------------------------------------------
// CORE ENGINE (Design-Aware)
// -------------------------------------------------------------------------
function buildFallbackIntel(dossier: { home_team: string; away_team: string }) {
    return {
        selected_offer_id: "FALLBACK",
        headline: `${dossier.away_team} @ ${dossier.home_team}`,
        briefing: "Intelligence unavailable. Displaying market data only.",
        cards: [
            {
                category: "The Engine",
                thesis: "AI offline. Market snapshot only.",
                impact: "LOW",
                market_implication: "N/A",
                details: [],
            },
        ],
        logic_group: "SITUATIONAL",
        confidence_tier: "LOW",
        pick_summary: "Fallback",
    };
}

async function processSingleIntel(
    p: any,
    supabase: any,
    requestId: string,
    opts: { mode: "job" | "direct" } = { mode: "direct" }
) {
    const dossier = await buildMatchDossier(
        p.match_id,
        supabase,
        {
            league: p.league,
            league_id: p.league,
            sport: p.sport,
            start_time: p.start_time,
            home_team: p.home_team,
            away_team: p.away_team,
            current_spread: p.current_spread ?? null,
            current_total: p.current_total ?? null,
            current_odds: p.current_odds ?? null,
            home_ml: p.home_ml ?? null,
            away_ml: p.away_ml ?? null,
            spread_juice: p.spread_juice ?? null,
            total_juice: p.total_juice ?? null,
        },
        { season: "2025-26" }
    );

    console.log(`[Context:${requestId}] Dossier assembled: ${dossier.match_id}`);

    const dbId = dossier.match_id;
    const gameDate = dossier.game_date;

    // 1. FRESHNESS CHECK
    let existingIntel: any = null;
    if (!p.force_refresh) {
        existingIntel = await supabase
            .from("pregame_intel")
            .select("*")
            .eq("match_id", dbId)
            .eq("game_date", gameDate)
            .maybeSingle()
            .then((r: any) => r.data);
    }
    if (existingIntel?.generated_at) {
        const ageMs = Date.now() - new Date(existingIntel.generated_at).getTime();
        if (ageMs < 2 * 60 * 60 * 1000) {
            console.log(`[${requestId}] ♻️ Freshness Hit.`);
            return existingIntel;
        }
    }

    const odds = p.current_odds || {};
    const marketInput = {
        ...p,
        home_team: dossier.home_team,
        away_team: dossier.away_team,
        current_spread: dossier.market_snapshot.spread,
        current_total: dossier.market_snapshot.total,
        spread_juice: dossier.market_snapshot.spread_juice,
        total_juice: dossier.market_snapshot.total_juice,
        home_ml: dossier.market_snapshot.home_ml,
        away_ml: dossier.market_snapshot.away_ml,
    };

    const home_ml = safeJuiceFmt(marketInput.home_ml ?? odds.homeWin ?? odds.home_ml ?? odds.best_h2h?.home?.price);
    const away_ml = safeJuiceFmt(marketInput.away_ml ?? odds.awayWin ?? odds.away_ml ?? odds.best_h2h?.away?.price);

    const marketOffers = buildMarketSnapshot(marketInput, odds);

    // LOCK: No market
    if (!marketOffers.length) {
        console.warn(`[${requestId}] ⚠️ No market offers. LOCKING.`);
        const noMarketDossier = {
            match_id: dbId,
            game_date: gameDate,
            sport: dossier.sport,
            league_id: dossier.league_id,
            home_team: dossier.home_team,
            away_team: dossier.away_team,
            odds_event_id: dossier.odds_event_id,
            selected_offer_id: "NO_MARKET",
            headline: `${dossier.away_team} @ ${dossier.home_team}`,
            briefing: "Market data incomplete. Analysis paused.",
            cards: [{ category: "The Engine", thesis: "Missing Data", impact: "LOW" }],
            logic_group: "SITUATIONAL",
            confidence_tier: "LOW",
            pick_summary: "NO_MARKET",
            recommended_pick: "NO_MARKET",
            generated_at: new Date().toISOString(),
            analyzed_spread: safeNumOrNull(marketInput.current_spread),
            analyzed_total: safeNumOrNull(marketInput.current_total),
            spread_juice: null,
            total_juice: null,
            home_ml,
            away_ml,
            logic_authority: "NO_MARKET",
            kernel_trace: "ABORT_NO_OFFERS",
        };
        await stripUnknownColumnsAndRetryUpsert(supabase, "pregame_intel", noMarketDossier, {
            onConflict: "match_id,game_date",
            ignoreDuplicates: false,
        });
        return noMarketDossier;
    }

    // GLOBAL CONCURRENCY GUARD: Acquire lease before any AI call
    const leaseAttempt = await acquireIntelLeaseWithBackoff(supabase, requestId);
    if (!leaseAttempt.bypass && !leaseAttempt.leaseId) {
        throw new QueueFullError("Queue full");
    }
    const leaseId = leaseAttempt.leaseId;

    const marketMenu = marketOffers.map((o) => `- ID: "${o.id}" | ${o.label}`).join("\n");
    const edge = Number.isFinite(dossier.valuation.delta) ? dossier.valuation.delta.toFixed(1) : "0.0";

    // 3. AI PROMPT (single call)
    const systemInstruction = PREGAME_INTEL_SYSTEM_INSTRUCTION(dossier.current_date, dossier.game_date);
    const synthesisPrompt = `<matchup>${dossier.away_team} @ ${dossier.home_team}</matchup>
<forensic_context>
HOME (${dossier.home_team}):
- Situation: ${dossier.forensic.home.situation}
- Rest: ${dossier.forensic.home.rest_days} days
- Injury Score: ${dossier.forensic.home.injury_score}/10
- Notes: ${dossier.forensic.home.notes}
AWAY (${dossier.away_team}):
- Situation: ${dossier.forensic.away.situation}
- Rest: ${dossier.forensic.away.rest_days} days
- Injury Score: ${dossier.forensic.away.injury_score}/10
- Notes: ${dossier.forensic.away.notes}
</forensic_context>
<valuation>
Market Spread: ${dossier.market_snapshot.spread ?? "N/A"}
Fair Line: ${dossier.valuation.fair_line}
Delta: ${dossier.valuation.delta}
</valuation>
<market_snapshot>
Spread: ${dossier.market_snapshot.spread ?? "N/A"}
Total: ${dossier.market_snapshot.total ?? "N/A"}
Home ML: ${dossier.market_snapshot.home_ml ?? "N/A"}
Away ML: ${dossier.market_snapshot.away_ml ?? "N/A"}
</market_snapshot>
<market_offers>
${marketMenu}
</market_offers>
<task>Select the best offer. Justify using the forensic context.</task>`;

    const dynamicSchema: any = JSON.parse(JSON.stringify(PREGAME_INTEL_SCHEMA_BASE));
    dynamicSchema.properties.selected_offer_id.enum = marketOffers.map((o) => o.id);

    let intel: any;
    let sources: any[] = [];
    let thoughts = "";

    try {
        const runGemini = async (modelName: string, thinkingLevel: string) => {
            const aiStart = Date.now();
            const aiResult = await executeAnalyticalQuery(synthesisPrompt, {
                model: modelName,
                systemInstruction,
                responseSchema: dynamicSchema,
                thinkingLevel,
                maxOutputTokens: 12000,
            });
            const durationMs = Date.now() - aiStart;
            console.log(`[Intel:${requestId}] Gemini call (${modelName}): ${durationMs}ms`);
            return aiResult;
        };

        let aiResult = await runGemini(INTEL_PRIMARY_MODEL, "high");
        sources = aiResult.sources || [];
        if (sources.length === 0) {
            console.warn(`[Intel:${requestId}] ⚠️ No grounding sources returned. Fact claims may be ungrounded.`);
        }
        thoughts = aiResult.thoughts || "";
        intel = safeJsonParse(aiResult.text);

        if (!intel) {
            throw new Error("Invalid JSON from AI");
        }
    } catch (err: any) {
        if (isOverloadedError(err)) {
            try {
                console.warn(`[Intel:${requestId}] Gemini overloaded. Retrying with fallback model.`);
                const retryResult = await executeAnalyticalQuery(synthesisPrompt, {
                    model: INTEL_FALLBACK_MODEL,
                    systemInstruction,
                    responseSchema: dynamicSchema,
                    thinkingLevel: "medium",
                    maxOutputTokens: 8000,
                });
                const retrySources = retryResult.sources || [];
                if (retrySources.length === 0) {
                    console.warn(`[Intel:${requestId}] ⚠️ No grounding sources returned (fallback).`);
                }
                sources = retrySources;
                thoughts = retryResult.thoughts || "";
                intel = safeJsonParse(retryResult.text);
                if (!intel) throw new Error("Invalid JSON from fallback AI");
            } catch (fallbackErr: any) {
                throw new OverloadedError(fallbackErr?.message || "AI overloaded");
            }
        } else {
            const reason = err?.message || "AI failure";
            console.error(`[Intel:${requestId}] Fallback triggered: ${reason}`);
            intel = buildFallbackIntel(dossier);
        }
    } finally {
        if (leaseId) {
            await releaseIntelLease(supabase, leaseId, requestId);
        }
    }

    // 4. RESOLUTION (deterministic safety)
    let selectedOffer = marketOffers.find((o) => o.id === intel.selected_offer_id);
    let method = "AI_SELECTION";

    if (!selectedOffer) {
        selectedOffer = pickFallbackOffer(marketOffers, dossier.valuation.fair_line, marketInput.current_spread) || marketOffers[0];
        method = "DETERMINISTIC_FALLBACK";
    }

    const pickString = formatPick(selectedOffer);
    const gradingMeta = {
        type: selectedOffer.type,
        side: selectedOffer.side,
        selection: selectedOffer.selection,
        line: selectedOffer.line,
        price: selectedOffer.price,
    };

    // 5. SANITIZATION (AFTER offer resolution so team fallback is correct)
    const teamForFallback = selectedOffer?.selection || dossier.home_team || "this side";
    intel.headline = cleanHeadline(intel.headline, teamForFallback);

    if (Array.isArray(intel.cards)) {
        intel.cards = intel.cards.map((c: any) => ({
            ...c,
            thesis: cleanCardThesis(c.category, c.thesis),
        }));
    }

    // 6. Bind juice fields to selected offer where applicable
    const spreadJuiceRaw = parseAmericanOdds(marketInput.spread_juice || odds.homeSpreadOdds || odds.spread_best?.home?.price);
    const totalJuiceRaw = parseAmericanOdds(marketInput.total_juice || odds.overOdds || odds.total_best?.over?.price);

    const bound_spread_juice =
        selectedOffer.type === "SPREAD"
            ? selectedOffer.price
            : isFiniteNumber(marketInput.current_spread) && spreadJuiceRaw !== null
            ? fmtAmerican(spreadJuiceRaw)
            : null;

    const bound_total_juice =
        selectedOffer.type === "TOTAL"
            ? selectedOffer.price
            : isFiniteNumber(marketInput.current_total) && totalJuiceRaw !== null
            ? fmtAmerican(totalJuiceRaw)
            : null;

    // remove the AI-only selected_offer_id & pick_summary from stored surface object (your choice)
    const { selected_offer_id, pick_summary, ...cleanIntel } = intel as any;

    const output = {
        match_id: dbId,
        game_date: gameDate,
        sport: dossier.sport,
        league_id: dossier.league_id,
        home_team: dossier.home_team,
        away_team: dossier.away_team,
        odds_event_id: dossier.odds_event_id,

        ...cleanIntel,

        recommended_pick: pickString,
        grading_metadata: gradingMeta,
        sources: sources || [],
        generated_at: new Date().toISOString(),

        analyzed_spread: selectedOffer.type === "SPREAD" ? selectedOffer.line : safeNumOrNull(marketInput.current_spread),
        analyzed_total: selectedOffer.type === "TOTAL" ? selectedOffer.line : safeNumOrNull(marketInput.current_total),
        spread_juice: bound_spread_juice,
        total_juice: bound_total_juice,
        home_ml,
        away_ml,

        confidence_tier: intel.confidence_tier || null,
        logic_group: intel.logic_group || null,

        // Keep this internal; UI should not display it.
        logic_authority: `${selectedOffer.label} | ${edge} edge`,
        kernel_trace: `[METHOD:${method}]\n${thoughts || ""}`,
    };

    const upsertResult = await stripUnknownColumnsAndRetryUpsert(supabase, "pregame_intel", output, {
        onConflict: "match_id,game_date",
        ignoreDuplicates: false,
    });

    if (!upsertResult.ok) {
        throw new Error(`Upsert failed: ${upsertResult.error?.message}`);
    }

    console.log(`[${requestId}] 🎉 Saved: ${output.recommended_pick} (${selectedOffer.price})`);
    return output;
}
