// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { executeAnalyticalQuery, safeJsonParse, Type } from "../_shared/gemini.ts";
import { getCanonicalMatchId, toLocalGameDate } from "../_shared/match-registry.ts";
import { normalizeTennisOdds } from "../_shared/tennis-odds-normalizer.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-client-info, apikey, x-client-timeout, x-trace-id",
};

const APEX_CONFIG = {
    INJURY_WEIGHT: 0.4,
    MAX_INJURY_SCORE: 10.0,
    FATIGUE_BASE_PENALTY: 2.0,
    APRON_TAX_MULTIPLIER: 1.75,
    ATS_THRESHOLD: 0.6,
    ATS_BONUS_POINTS: 3.0,
    HOME_COURT: 2.6,
};

// -------------------------------------------------------------------------
// MODULE: INTEL GUARDS (SERVER-SIDE EDITOR)
// -------------------------------------------------------------------------
namespace IntelGuards {
    const NERD_WORDS = [
        "fair line",
        "delta",
        "dislocation",
        "priors",
        "projected",
        "expected value",
        "expected",
        "ev",
        "clv",
        "regression",
        "algorithm",
        "kernel",
        "confidence",
        "system",
        "framework",
        "variance",
        "model",
        "probability",
        "pricing",
        "signal",
    ];

    const HEADLINE_FALLBACKS = [
        "Prime spot for {team} tonight",
        "Setup favors {team} in this matchup",
        "Why the value is on {team} today",
        "{team} set up well in this spot",
        "Points look mispriced on {team}",
        "Lean: {team} in this matchup",
    ];

    function escapeRegexLiteral(input: string): string {
        return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // Sort by length DESC so "expected value" matches before "expected"
    const SORTED_TERMS = [...NERD_WORDS].sort((a, b) => b.length - a.length);
    const NERD_REGEX = new RegExp(
        `\\b(${SORTED_TERMS.map(escapeRegexLiteral).join("|")})\\b`,
        "gi"
    );

    function getStableIndex(str: string, max: number): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash += str.charCodeAt(i);
        return Math.abs(hash) % max;
    }

    function polishGrammar(input: string): string {
        return input
            .replace(/\s+/g, " ")
            .replace(/\s([,.!?;:])/g, "$1")
            .replace(/\.{2,}/g, ".")
            .replace(/,\s*,+/g, ",")
            .trim();
    }

    export function cleanHeadline(raw: string, team: string): string {
        if (!raw) return "";

        NERD_REGEX.lastIndex = 0;
        const isContaminated = NERD_REGEX.test(raw);
        const isTooLong = raw.length > 85;
        const hasColon = raw.includes(":");

        if (isContaminated || isTooLong || hasColon) {
            const index = getStableIndex(team || "team", HEADLINE_FALLBACKS.length);
            return HEADLINE_FALLBACKS[index].replace("{team}", team || "this side");
        }

        return raw.replace(/["']/g, "").trim();
    }

    export function cleanCardThesis(category: string, thesis: string): string {
        if (!thesis) return "";

        // Safe zone for math/engine terms
        if (category === "The Engine") return thesis;

        let clean = thesis.replace(NERD_REGEX, "");
        clean = polishGrammar(clean);

        if (clean.length < 15) return "The numbers favor this side.";

        return clean.charAt(0).toUpperCase() + clean.slice(1);
    }
}

// -------------------------------------------------------------------------
// LEAGUE & SPORT DEFINITIONS
// -------------------------------------------------------------------------
const SOCCER_LEAGUES = [
    "ita.1",
    "seriea",
    "eng.1",
    "epl",
    "ger.1",
    "bundesliga",
    "esp.1",
    "laliga",
    "fra.1",
    "ligue1",
    "usa.1",
    "mls",
    "uefa.champions",
    "ucl",
    "uefa.europa",
    "uel",
    "caf.nations",
    "copa",
    "conmebol",
    "concacaf",
    "afc",
];
const FOOTBALL_LEAGUES = ["nfl", "college-football", "ncaaf"];
const HOCKEY_LEAGUES = ["nhl"];
const BASEBALL_LEAGUES = ["mlb"];
const BASKETBALL_LEAGUES = [
    "nba",
    "wnba",
    "mens-college-basketball",
    "ncaab",
    "ncaam",
    "womens-college-basketball",
];
const TENNIS_LEAGUES = ["atp", "wta", "tennis"];

const detectSportFromLeague = (league: string | null | undefined): string => {
    if (!league) return "nba";
    const l = league.toLowerCase();
    if (TENNIS_LEAGUES.some((t) => l.includes(t))) return "tennis";
    if (SOCCER_LEAGUES.some((s) => l.includes(s))) return "soccer";
    if (FOOTBALL_LEAGUES.some((f) => l.includes(f))) return "football";
    if (HOCKEY_LEAGUES.some((h) => l.includes(h))) return "hockey";
    if (BASEBALL_LEAGUES.some((b) => l.includes(b))) return "baseball";
    if (BASKETBALL_LEAGUES.some((b) => l.includes(b)))
        return l.includes("college") ? "college_basketball" : "nba";
    return "nba";
};

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
    league: z.string().nullable().optional().transform((v: any) => v || "nba"),
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
// OUTPUT SCHEMA (KEEP SHAPE; DO NOT PRUNE FIELDS)
// -------------------------------------------------------------------------
const INTEL_OUTPUT_SCHEMA_BASE = {
    type: Type.OBJECT,
    properties: {
        selected_offer_id: { type: Type.STRING }, // enum injected dynamically
        headline: { type: Type.STRING },
        briefing: { type: Type.STRING },
        cards: {
            type: Type.ARRAY,
            minItems: 3,
            maxItems: 5,
            items: {
                type: Type.OBJECT,
                properties: {
                    category: {
                        type: Type.STRING,
                        enum: ["The Spot", "The Trend", "The Engine", "The Trap", "X-Factor"],
                    },
                    thesis: { type: Type.STRING },
                    impact: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },

                    // keep legacy shape
                    market_implication: { type: Type.STRING },
                    details: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                    },
                },
                required: ["category", "thesis", "impact"],
            },
        },
        logic_group: {
            type: Type.STRING,
            enum: ["SCHEDULE_SPOT", "MARKET_DISLOCATION", "KEY_INJURY", "MODEL_EDGE", "SITUATIONAL"],
        },
        confidence_tier: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
        pick_summary: { type: Type.STRING },
    },
    required: ["selected_offer_id", "headline", "briefing", "cards", "logic_group", "confidence_tier", "pick_summary"],
};

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
                    await processSingleIntel(p, supabase, `job-${item.id.slice(0, 4)}`);
                    await supabase.from("intel_job_items").update({ status: "success" }).eq("id", item.id);
                } catch (e: any) {
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
        if (!p.home_team || !p.away_team) {
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

        const dossier = await processSingleIntel(p, supabase, requestId);
        return new Response(JSON.stringify(dossier), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    } catch (err: any) {
        console.error(`[${crypto.randomUUID().slice(0, 8)}] ❌ FATAL:`, err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
});

// -------------------------------------------------------------------------
// CORE ENGINE (Design-Aware)
// -------------------------------------------------------------------------
async function processSingleIntel(p: any, supabase: any, requestId: string) {
    const dbId = getCanonicalMatchId(p.match_id, p.league);
    const gameDate = p.start_time ? toLocalGameDate(p.start_time) : new Date().toISOString().split("T")[0];
    const league = String(p.league || "nba").toLowerCase();

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

    // 2. DATA FETCH & MATH
    const [matchRecord, homeContext, awayContext, hP, aP] = await Promise.all([
        supabase.from("matches").select("odds_api_event_id").eq("id", dbId).maybeSingle().then((r: any) => r.data),
        supabase.from("team_game_context").select("*").eq("team", p.home_team).eq("game_date", gameDate).single().then((r: any) => r.data),
        supabase.from("team_game_context").select("*").eq("team", p.away_team).eq("game_date", gameDate).single().then((r: any) => r.data),
        league === "nba"
            ? supabase.from("nba_team_priors").select("*").eq("team", p.home_team).eq("season", "2025-26").single().then((r: any) => r.data)
            : Promise.resolve(null),
        league === "nba"
            ? supabase.from("nba_team_priors").select("*").eq("team", p.away_team).eq("season", "2025-26").single().then((r: any) => r.data)
            : Promise.resolve(null),
    ]);

    const oddsEventId = matchRecord?.odds_api_event_id || null;

    let h_o = 110,
        h_d = 110,
        a_o = 110,
        a_d = 110;
    if (hP) {
        h_o = hP.o_rating;
        h_d = hP.d_rating;
    }
    if (aP) {
        a_o = aP.o_rating;
        a_d = aP.d_rating;
    }

    const forensic = {
        home: {
            injury_impact: homeContext?.injury_impact || 0,
            situation: homeContext?.situation || "Normal",
            rest_days: homeContext?.rest_days ?? 2,
            ats_pct: homeContext?.ats_last_10 || 0.5,
            fatigue_score: homeContext?.fatigue_score || 0,
            injury_notes: homeContext?.injury_notes || "None",
            ats_last_10: homeContext?.ats_last_10 || 0.5,
        },
        away: {
            injury_impact: awayContext?.injury_impact || 0,
            situation: awayContext?.situation || "Normal",
            rest_days: awayContext?.rest_days ?? 2,
            ats_pct: awayContext?.ats_last_10 || 0.5,
            fatigue_score: awayContext?.fatigue_score || 0,
            injury_notes: awayContext?.injury_notes || "None",
            ats_last_10: awayContext?.ats_last_10 || 0.5,
        },
    };

    const calcEff = (o: number, d: number, f: any) => {
        let r = o - d;
        r -= f.injury_impact * APEX_CONFIG.INJURY_WEIGHT;
        const sit = (f.situation || "").toUpperCase();
        r -=
            (f.fatigue_score > 0 ? f.fatigue_score / 50 : ["B2B", "3IN4"].some((k) => sit.includes(k)) ? 1 : 0) *
            APEX_CONFIG.FATIGUE_BASE_PENALTY;
        if (f.ats_pct >= APEX_CONFIG.ATS_THRESHOLD) r += APEX_CONFIG.ATS_BONUS_POINTS;
        return r;
    };

    const h_eff = calcEff(h_o, h_d, forensic.home);
    const a_eff = calcEff(a_o, a_d, forensic.away);

    const hasModelPriors = p.league === "nba" && !!hP && !!aP;
    const rawFairLine = -1 * ((h_eff - a_eff) + APEX_CONFIG.HOME_COURT);
    const hasMarket = isFiniteNumber(p.current_spread);

    // Core behavior: non-NBA or missing priors anchors fairLine to market
    const fairLine = hasModelPriors ? rawFairLine : hasMarket ? p.current_spread : 0;
    const delta = hasMarket && hasModelPriors ? Math.abs(p.current_spread - fairLine) : 0;
    const edge = delta.toFixed(1);

    const odds = p.current_odds || {};
    const home_ml = safeJuiceFmt(p.home_ml ?? odds.homeWin ?? odds.home_ml ?? odds.best_h2h?.home?.price);
    const away_ml = safeJuiceFmt(p.away_ml ?? odds.awayWin ?? odds.away_ml ?? odds.best_h2h?.away?.price);

    const marketOffers = buildMarketSnapshot(p, odds);

    // LOCK: No market
    if (!marketOffers.length) {
        console.warn(`[${requestId}] ⚠️ No market offers. LOCKING.`);
        const noMarketDossier = {
            match_id: dbId,
            game_date: gameDate,
            sport: p.sport,
            league_id: p.league,
            home_team: p.home_team,
            away_team: p.away_team,
            odds_event_id: oddsEventId,
            selected_offer_id: "NO_MARKET",
            headline: `${p.away_team} @ ${p.home_team}`,
            briefing: "Market data incomplete. Analysis paused.",
            cards: [{ category: "The Engine", thesis: "Missing Data", impact: "LOW" }],
            logic_group: "SITUATIONAL",
            confidence_tier: "LOW",
            pick_summary: "NO_MARKET",
            recommended_pick: "NO_MARKET",
            generated_at: new Date().toISOString(),
            analyzed_spread: safeNumOrNull(p.current_spread),
            analyzed_total: safeNumOrNull(p.current_total),
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

    const marketMenu = marketOffers.map((o) => `- ID: "${o.id}" | ${o.label}`).join("\n");

    // 3. AI PROMPT (keep constraints; bettor-facing headline rules)
    const systemInstruction = `<role>Institutional Investment Strategist</role>
<constraints>
1. Select EXACTLY ONE "selected_offer_id" from the Snapshot.
2. Prefer SPREAD when the pricing feels off; otherwise consider TOTAL/ML.
3. Trust Snapshot prices.
4. Output valid JSON.
</constraints>

<headline_rules>
- Target: bettor-facing. punchy. 1 sentence.
- Banned words: model, fair line, delta, edge, dislocation, priors, projected, expected, ev, clv, regression, algorithm, kernel, confidence, system, framework, signal, variance.
- No colons.
</headline_rules>

<card_rules>
- "The Engine": technical is allowed here.
- Other cards: plain English only.
</card_rules>`;

    const synthesisPrompt = `<context>
${p.away_team} @ ${p.home_team}
Fair Line: ${fairLine.toFixed(2)} | Edge: ${edge}
=== MARKET SNAPSHOT ===
${marketMenu}
=======================
</context>
<task>Select best offer.</task>`;

    const dynamicSchema: any = JSON.parse(JSON.stringify(INTEL_OUTPUT_SCHEMA_BASE));
    dynamicSchema.properties.selected_offer_id.enum = marketOffers.map((o) => o.id);

    const { text, sources, thoughts } = await executeAnalyticalQuery(synthesisPrompt, {
        model: "gemini-3-flash-preview",
        systemInstruction,
        responseSchema: dynamicSchema,
    });

    const { analyzeMatchup } = await import("../_shared/intel-analyst.ts");
    const summary = await analyzeMatchup({
        home_team: p.home_team,
        away_team: p.away_team,
        home_context: forensic.home,
        away_context: forensic.away,
    });

    const intel = safeJsonParse(text) || {
        selected_offer_id: "FALLBACK",
        headline: "Automated Analysis",
        briefing: "Parse failed.",
        cards: [],
        logic_group: "SITUATIONAL",
        confidence_tier: "LOW",
        pick_summary: "Fallback",
    };

    if (intel && summary) intel.briefing = summary;

    // 4. RESOLUTION (deterministic safety)
    let selectedOffer = marketOffers.find((o) => o.id === intel.selected_offer_id);
    let method = "AI_SELECTION";

    if (!selectedOffer) {
        selectedOffer = pickFallbackOffer(marketOffers, fairLine, p.current_spread) || marketOffers[0];
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
    // This guarantees hero headline fallbacks reference the picked team.
    const teamForFallback = selectedOffer?.selection || p.home_team || "this side";
    intel.headline = IntelGuards.cleanHeadline(intel.headline, teamForFallback);

    if (Array.isArray(intel.cards)) {
        intel.cards = intel.cards.map((c: any) => ({
            ...c,
            thesis: IntelGuards.cleanCardThesis(c.category, c.thesis),
        }));
    }

    // 6. Bind juice fields to selected offer where applicable
    const spreadJuiceRaw = parseAmericanOdds(p.spread_juice || odds.homeSpreadOdds || odds.spread_best?.home?.price);
    const totalJuiceRaw = parseAmericanOdds(p.total_juice || odds.overOdds || odds.total_best?.over?.price);

    const bound_spread_juice =
        selectedOffer.type === "SPREAD" ? selectedOffer.price : isFiniteNumber(p.current_spread) && spreadJuiceRaw !== null ? fmtAmerican(spreadJuiceRaw) : null;

    const bound_total_juice =
        selectedOffer.type === "TOTAL" ? selectedOffer.price : isFiniteNumber(p.current_total) && totalJuiceRaw !== null ? fmtAmerican(totalJuiceRaw) : null;

    // remove the AI-only selected_offer_id & pick_summary from stored surface object (your choice)
    const { selected_offer_id, pick_summary, ...cleanIntel } = intel as any;

    const dossier = {
        match_id: dbId,
        game_date: gameDate,
        sport: p.sport || "basketball",
        league_id: p.league || "nba",
        home_team: p.home_team,
        away_team: p.away_team,
        odds_event_id: oddsEventId,

        ...cleanIntel,

        recommended_pick: pickString,
        grading_metadata: gradingMeta,
        sources: sources || [],
        generated_at: new Date().toISOString(),

        analyzed_spread: selectedOffer.type === "SPREAD" ? selectedOffer.line : safeNumOrNull(p.current_spread),
        analyzed_total: selectedOffer.type === "TOTAL" ? selectedOffer.line : safeNumOrNull(p.current_total),
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

    const upsertResult = await stripUnknownColumnsAndRetryUpsert(supabase, "pregame_intel", dossier, {
        onConflict: "match_id,game_date",
        ignoreDuplicates: false,
    });

    if (!upsertResult.ok) {
        throw new Error(`Upsert failed: ${upsertResult.error?.message}`);
    }

    console.log(`[${requestId}] 🎉 Saved: ${dossier.recommended_pick} (${selectedOffer.price})`);
    return dossier;
}
