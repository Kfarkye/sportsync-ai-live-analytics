import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { executeAnalyticalQuery, safeJsonParse, Type } from "../_shared/gemini.ts";
import { getCanonicalMatchId, toLocalGameDate } from "../_shared/match-registry.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-client-info, apikey, x-client-timeout, x-trace-id",
};

/**
 * APEX ENGINE v3.3.2 - Snapshot-Selection Hardened
 * Core guarantees:
 * - If a pick is persisted, its price is verified (no default "-110")
 * - recommended_pick is always numeric for SPREAD/TOTAL (no "PK")
 * - MONEYLINE prices are numeric American odds (no "N/A")
 * - AI never generates pick syntax; it selects an offer ID
 */
const APEX_CONFIG = {
    INJURY_WEIGHT: 0.4,
    MAX_INJURY_SCORE: 10.0,
    FATIGUE_BASE_PENALTY: 2.0,
    APRON_TAX_MULTIPLIER: 1.75,
    ATS_THRESHOLD: 0.6,
    ATS_BONUS_POINTS: 3.0,
    HOME_COURT: 2.6,
};

// COMPREHENSIVE LEAGUE LIST
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

const RequestSchema = z.object({
    job_id: z.string().optional(),
    match_id: z.string().min(1),
    league: z
        .string()
        .nullable()
        .optional()
        .transform((v: string | null | undefined) => v || "nba"),
    sport: z.string().nullable().optional(),
    start_time: z.string().optional(),
    current_spread: z.number().nullable().optional(),
    current_total: z.number().nullable().optional(),
    home_team: z.string().optional(),
    away_team: z.string().optional(),
    home_net_rating: z.number().optional().default(0),
    away_net_rating: z.number().optional().default(0),
    current_odds: z.any().optional(),
    home_ml: z
        .union([z.string(), z.number()])
        .nullable()
        .optional()
        .transform((v) => (v != null ? String(v) : null)),
    away_ml: z
        .union([z.string(), z.number()])
        .nullable()
        .optional()
        .transform((v) => (v != null ? String(v) : null)),
    spread_juice: z
        .union([z.string(), z.number()])
        .nullable()
        .optional()
        .transform((v) => (v != null ? String(v) : null)),
    total_juice: z
        .union([z.string(), z.number()])
        .nullable()
        .optional()
        .transform((v) => (v != null ? String(v) : null)),
    force_refresh: z.boolean().optional().default(false),
});

const INTEL_OUTPUT_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        selected_offer_id: { type: Type.STRING }, // required; must match snapshot ID or "NO_MARKET"
        headline: { type: Type.STRING },
        briefing: { type: Type.STRING },
        cards: {
            type: Type.ARRAY,
            minItems: 2,
            items: {
                type: Type.OBJECT,
                properties: {
                    category: {
                        type: Type.STRING,
                        enum: ["The Spot", "The Trend", "The Engine", "The Trap", "X-Factor"],
                    },
                    thesis: { type: Type.STRING },
                    market_implication: { type: Type.STRING },
                    impact: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
                    details: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["category", "thesis", "market_implication", "impact", "details"],
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
// Helpers: numeric hardening
// -------------------------------------------------------------------------
const isFiniteNumber = (v: any): v is number => typeof v === "number" && Number.isFinite(v);

const parseAmericanOdds = (v: any): number | null => {
    if (v == null) return null;
    const raw = typeof v === "number" ? String(v) : String(v).trim();
    if (!raw) return null;

    // Reject placeholders
    const lowered = raw.toLowerCase();
    if (lowered === "n/a" || lowered === "na" || lowered === "none" || lowered === "null") return null;

    // Remove whitespace and any non-sign numeric junk, keep leading sign
    const cleaned = raw.replace(/[^\d+\-]/g, "");
    if (!cleaned) return null;

    const n = parseInt(cleaned, 10);
    if (!Number.isFinite(n)) return null;

    // American odds sanity: exclude 0 and absurd values
    if (n === 0) return null;
    if (Math.abs(n) < 100) return null;      // -105, +110 etc are valid; <100 is not American odds
    if (Math.abs(n) > 10000) return null;

    return n;
};

const fmtAmerican = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

const fmtLine = (n: number): string => {
    // Preserve common quarter/half lines without forcing extra decimals
    if (Number.isInteger(n)) return n.toFixed(0);
    const q = Math.round(n * 4);
    if (Math.abs(n * 4 - q) < 1e-9) return (q / 4).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    const h = Math.round(n * 2);
    if (Math.abs(n * 2 - h) < 1e-9) return (h / 2).toFixed(1);
    return String(n);
};

// -------------------------------------------------------------------------
// MARKET SNAPSHOT: Deterministic Menu of Valid Bets
// No defaults. If price is missing, offer is excluded.
// -------------------------------------------------------------------------
type MarketOffer = {
    id: string;
    type: "SPREAD" | "TOTAL" | "MONEYLINE";
    side: "HOME" | "AWAY" | "OVER" | "UNDER";
    selection: string;
    line: number | null;
    price_american: number;
    price: string; // formatted for model + storage
    label: string; // what AI sees
};

const makeOfferId = (type: MarketOffer["type"], side: MarketOffer["side"], line: number | null, priceA: number) => {
    const linePart = line == null ? "NA" : fmtLine(line).replace(/\+/g, "");
    return `${type}_${side}_${linePart}_${priceA}`.replace(/\s+/g, "");
};

const buildMarketSnapshot = (p: any, odds: any): MarketOffer[] => {
    const offers: MarketOffer[] = [];
    const hTeam = p.home_team || "Home";
    const aTeam = p.away_team || "Away";

    // Extract raw prices from any known fields
    const homeSpreadRaw = p.spread_juice ?? odds?.homeSpreadOdds ?? odds?.spread_best?.home?.price;
    const awaySpreadRaw = odds?.awaySpreadOdds ?? odds?.spread_best?.away?.price;

    const overRaw = p.total_juice ?? odds?.overOdds ?? odds?.total_best?.over?.price;
    const underRaw = odds?.underOdds ?? odds?.total_best?.under?.price;

    const homeMlRaw = p.home_ml ?? odds?.homeWin ?? odds?.home_ml ?? odds?.best_h2h?.home?.price;
    const awayMlRaw = p.away_ml ?? odds?.awayWin ?? odds?.away_ml ?? odds?.best_h2h?.away?.price;

    // 1) SPREAD (requires line + a verified price)
    if (isFiniteNumber(p.current_spread)) {
        const spread = p.current_spread;
        const homePriceA = parseAmericanOdds(homeSpreadRaw);
        const awayPriceA = parseAmericanOdds(awaySpreadRaw);

        // Home spread offer
        if (homePriceA != null) {
            const price = fmtAmerican(homePriceA);
            const line = spread;
            offers.push({
                id: makeOfferId("SPREAD", "HOME", line, homePriceA),
                type: "SPREAD",
                side: "HOME",
                selection: hTeam,
                line,
                price_american: homePriceA,
                price,
                label: `${hTeam} ${line >= 0 ? "+" : ""}${fmtLine(line)} (${price})`,
            });
        }

        // Away spread offer (line inversion) requires away price; otherwise exclude to preserve 100% integrity
        if (awayPriceA != null) {
            const price = fmtAmerican(awayPriceA);
            const line = spread * -1;
            offers.push({
                id: makeOfferId("SPREAD", "AWAY", line, awayPriceA),
                type: "SPREAD",
                side: "AWAY",
                selection: aTeam,
                line,
                price_american: awayPriceA,
                price,
                label: `${aTeam} ${line >= 0 ? "+" : ""}${fmtLine(line)} (${price})`,
            });
        }
    }

    // 2) TOTAL (requires total + verified over/under price per side)
    if (isFiniteNumber(p.current_total)) {
        const total = p.current_total;
        const overA = parseAmericanOdds(overRaw);
        const underA = parseAmericanOdds(underRaw);

        if (overA != null) {
            const price = fmtAmerican(overA);
            offers.push({
                id: makeOfferId("TOTAL", "OVER", total, overA),
                type: "TOTAL",
                side: "OVER",
                selection: "OVER",
                line: total,
                price_american: overA,
                price,
                label: `OVER ${fmtLine(total)} (${price})`,
            });
        }

        if (underA != null) {
            const price = fmtAmerican(underA);
            offers.push({
                id: makeOfferId("TOTAL", "UNDER", total, underA),
                type: "TOTAL",
                side: "UNDER",
                selection: "UNDER",
                line: total,
                price_american: underA,
                price,
                label: `UNDER ${fmtLine(total)} (${price})`,
            });
        }
    }

    // 3) MONEYLINE (requires verified price)
    const homeMlA = parseAmericanOdds(homeMlRaw);
    const awayMlA = parseAmericanOdds(awayMlRaw);

    if (homeMlA != null) {
        const price = fmtAmerican(homeMlA);
        offers.push({
            id: makeOfferId("MONEYLINE", "HOME", null, homeMlA),
            type: "MONEYLINE",
            side: "HOME",
            selection: hTeam,
            line: null,
            price_american: homeMlA,
            price,
            label: `${hTeam} ML (${price})`,
        });
    }

    if (awayMlA != null) {
        const price = fmtAmerican(awayMlA);
        offers.push({
            id: makeOfferId("MONEYLINE", "AWAY", null, awayMlA),
            type: "MONEYLINE",
            side: "AWAY",
            selection: aTeam,
            line: null,
            price_american: awayMlA,
            price,
            label: `${aTeam} ML (${price})`,
        });
    }

    return offers;
};

const formatPick = (o: MarketOffer): string => {
    // Never output "PK". Always numeric for SPREAD/TOTAL.
    if (o.type === "MONEYLINE") return `${o.selection} ML`;
    if (o.type === "TOTAL") return `${o.side} ${fmtLine(o.line ?? 0)}`;
    const line = o.line ?? 0;
    return `${o.selection} ${line >= 0 ? "+" : ""}${fmtLine(line)}`;
};

const pickFallbackOffer = (offers: MarketOffer[], fairLine: number, currentSpread: number | null | undefined): MarketOffer | null => {
    if (!offers.length) return null;

    const spreadOffers = offers.filter((o) => o.type === "SPREAD");
    if (spreadOffers.length && isFiniteNumber(currentSpread)) {
        // Determine side by your existing logic
        const pickSide: "HOME" | "AWAY" = fairLine < currentSpread ? "HOME" : "AWAY";
        const candidate = spreadOffers.find((o) => o.side === pickSide);
        if (candidate) return candidate;
        return spreadOffers[0];
    }

    // Next: TOTAL
    const totalOffers = offers.filter((o) => o.type === "TOTAL");
    if (totalOffers.length) return totalOffers[0];

    // Last: ML
    const mlOffers = offers.filter((o) => o.type === "MONEYLINE");
    if (mlOffers.length) return mlOffers[0];

    return offers[0];
};

const buildMarketMenu = (offers: MarketOffer[]) =>
    offers.map((o) => `- ID: "${o.id}" | ${o.label}`).join("\n");

const stripUnknownColumnsAndRetryUpsert = async (
    supabase: any,
    table: string,
    payload: any,
    opts: { onConflict: string; ignoreDuplicates: boolean }
) => {
    // Attempt up to 5 strips
    let attempt = 0;
    let working = { ...payload };

    while (attempt < 5) {
        const { error } = await supabase.from(table).upsert(working, opts);
        if (!error) return { ok: true as const, payload: working };

        const msg = String(error.message || "");
        // Schema cache special-case (kept from your pattern)
        if (msg.includes("schema cache")) return { ok: false as const, error, payload: working, schemaCache: true as const };

        // Column does not exist => strip that column and retry
        const m = msg.match(/column "([^"]+)" of relation "[^"]+" does not exist/i);
        if (m && m[1]) {
            const col = m[1];
            delete (working as any)[col];
            attempt++;
            continue;
        }

        return { ok: false as const, error, payload: working };
    }

    return { ok: false as const, error: new Error("Upsert failed after stripping unknown columns"), payload: working };
};

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

        // 1) Health Check
        if (Object.keys(body).length === 0) {
            return new Response(JSON.stringify({ status: "ok", msg: "Architect Worker Alive" }), { headers: CORS_HEADERS });
        }

        // 2) Handle Job-based invocation (Queue)
        if (body.job_id) {
            console.log(`WORKER: Processing Job ${body.job_id}`);
            await supabase
                .from("intel_jobs")
                .update({ status: "running", updated_at: new Date().toISOString() })
                .eq("id", body.job_id)
                .eq("status", "queued");

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

        // Direct invocation
        const validation = RequestSchema.safeParse(body);
        if (!validation.success) throw new Error("Invalid Input Schema: " + validation.error.message);
        let p = validation.data;

        // HYDRATION
        if (!p.home_team || !p.away_team) {
            console.log(`[${requestId}] 💧 [HYDRATION-START] Fetching team names for ${p.match_id}...`);
            const { data: match, error: matchErr } = await supabase
                .from("matches")
                .select("home_team, away_team, league_id, sport, start_time, odds_home_spread_safe, odds_total_safe, current_odds")
                .eq("id", p.match_id)
                .single();

            if (matchErr || !match) throw new Error(`Self-Healing Failed: Match ${p.match_id} not found.`);

            p = {
                ...p,
                home_team: p.home_team || match.home_team,
                away_team: p.away_team || match.away_team,
                league: p.league || match.league_id,
                sport: p.sport || match.sport || detectSportFromLeague(p.league || match.league_id),
                start_time: p.start_time || match.start_time,
                current_spread:
                    p.current_spread ?? match.odds_home_spread_safe ?? match.current_odds?.homeSpread ?? match.current_odds?.spread_home_value,
                current_total: p.current_total ?? match.odds_total_safe ?? match.current_odds?.total ?? match.current_odds?.total_value,
                current_odds: p.current_odds || match.current_odds,
            } as any;
        }

        if (!p.sport || p.sport === "basketball") {
            const derivedSport = detectSportFromLeague(p.league);
            if (derivedSport !== "basketball") p = { ...p, sport: derivedSport } as any;
        }

        const dossier = await processSingleIntel(p, supabase, requestId);
        return new Response(JSON.stringify(dossier), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    } catch (err: any) {
        console.error(`[${requestId}] ❌ [FATAL-ERROR]`, err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
});

async function processSingleIntel(p: any, supabase: any, requestId: string) {
    const dbId = getCanonicalMatchId(p.match_id, p.league);
    const gameDate = p.start_time ? toLocalGameDate(p.start_time) : new Date().toISOString().split("T")[0];

    const { data: matchRecord } = await supabase.from("matches").select("odds_api_event_id").eq("id", dbId).maybeSingle();
    const oddsEventId = matchRecord?.odds_api_event_id || null;

    // FRESHNESS GUARD
    if (!p.force_refresh) {
        const FRESHNESS_TTL_MS = 2 * 60 * 60 * 1000;
        const { data: existingIntel } = await supabase.from("pregame_intel").select("*").eq("match_id", dbId).eq("game_date", gameDate).maybeSingle();
        if (existingIntel?.generated_at) {
            const ageMs = Date.now() - new Date(existingIntel.generated_at).getTime();
            if (ageMs < FRESHNESS_TTL_MS) {
                console.log(`[${requestId}] ♻️ [FRESHNESS-HIT] Intel valid. Skipping.`);
                return existingIntel;
            }
        }
    }

    // CONTEXT & RATINGS
    let h_o = 110,
        h_d = 110,
        a_o = 110,
        a_d = 110;

    if (p.league === "nba") {
        const { data: hP } = await supabase.from("nba_team_priors").select("*").eq("team", p.home_team).eq("season", "2025-26").single();
        const { data: aP } = await supabase.from("nba_team_priors").select("*").eq("team", p.away_team).eq("season", "2025-26").single();
        if (hP) {
            h_o = hP.o_rating;
            h_d = hP.d_rating;
        }
        if (aP) {
            a_o = aP.o_rating;
            a_d = aP.d_rating;
        }
    }

    const h_base = h_o - h_d;
    const a_base = a_o - a_d;

    const { data: homeContext } = await supabase.from("team_game_context").select("*").eq("team", p.home_team).eq("game_date", gameDate).single();
    const { data: awayContext } = await supabase.from("team_game_context").select("*").eq("team", p.away_team).eq("game_date", gameDate).single();

    const forensic = {
        home: {
            injury_impact: homeContext?.injury_impact || 0,
            situation: homeContext?.situation || "Normal",
            rest_days: homeContext?.rest_days ?? 2,
            ats_pct: homeContext?.ats_last_10 || 0.5,
            fatigue_score: homeContext?.fatigue_score || 0,
        },
        away: {
            injury_impact: awayContext?.injury_impact || 0,
            situation: awayContext?.situation || "Normal",
            rest_days: awayContext?.rest_days ?? 2,
            ats_pct: awayContext?.ats_last_10 || 0.5,
            fatigue_score: awayContext?.fatigue_score || 0,
        },
    };

    // APEX PHYSICS
    const calculateEffective = (base: number, f: any) => {
        let rating = base;
        rating -= f.injury_impact * APEX_CONFIG.INJURY_WEIGHT;
        let fatHit = 0;
        if (f.fatigue_score > 0) fatHit = (f.fatigue_score / 50) * APEX_CONFIG.FATIGUE_BASE_PENALTY;
        else if (["B2B", "3IN4"].some((k) => (f.situation || "").toUpperCase().includes(k))) fatHit = APEX_CONFIG.FATIGUE_BASE_PENALTY;
        rating -= fatHit;
        if (f.ats_pct >= APEX_CONFIG.ATS_THRESHOLD) rating += APEX_CONFIG.ATS_BONUS_POINTS;
        return rating;
    };

    const h_eff = calculateEffective(h_base, forensic.home);
    const a_eff = calculateEffective(a_base, forensic.away);

    const rawFairLine = -1 * ((h_eff - a_eff) + APEX_CONFIG.HOME_COURT);
    const hasModelData = Math.abs(rawFairLine) > 0.5 || h_base !== 0 || a_base !== 0;
    const hasMarket = p.current_spread !== null && p.current_spread !== undefined;

    const fairLine = hasModelData ? rawFairLine : hasMarket ? p.current_spread : 0;
    const delta = hasMarket && hasModelData ? Math.abs(p.current_spread - fairLine) : 0;
    const edge = delta.toFixed(1);

    const pickSide = fairLine < (p.current_spread || 0) ? "HOME" : "AWAY";
    const pickTeam = pickSide === "HOME" ? p.home_team : p.away_team;
    const leagueDisplay = (p.league || "nba").toUpperCase();

    // ODDS EXTRACTION (no "N/A"; null if missing)
    const odds = p.current_odds || {};
    const home_ml_A = parseAmericanOdds(p.home_ml ?? odds.homeWin ?? odds.home_ml ?? odds.best_h2h?.home?.price);
    const away_ml_A = parseAmericanOdds(p.away_ml ?? odds.awayWin ?? odds.away_ml ?? odds.best_h2h?.away?.price);

    const home_ml = home_ml_A != null ? fmtAmerican(home_ml_A) : null;
    const away_ml = away_ml_A != null ? fmtAmerican(away_ml_A) : null;

    const spread_juice_A = parseAmericanOdds(p.spread_juice ?? odds.homeSpreadOdds ?? odds.spread_best?.home?.price);
    const total_juice_A = parseAmericanOdds(p.total_juice ?? odds.overOdds ?? odds.total_best?.over?.price);

    const spread_juice = spread_juice_A != null ? fmtAmerican(spread_juice_A) : null;
    const total_juice = total_juice_A != null ? fmtAmerican(total_juice_A) : null;

    // -------------------------------------------------------------------------
    // BUILD MARKET SNAPSHOT (pre-validated menu)
    // -------------------------------------------------------------------------
    const marketOffers = buildMarketSnapshot(p, odds);
    const marketMenu = buildMarketMenu(marketOffers);

    // If no verified offers exist, skip AI and persist safe dossier (no pick, no juice)
    if (!marketOffers.length) {
        console.warn(`[${requestId}] ⚠️ No VERIFIED market offers (missing price or line). Persisting NO_MARKET intel.`);

        const emptyIntel = {
            selected_offer_id: "NO_MARKET",
            headline: `${p.away_team} @ ${p.home_team}`,
            briefing: "No verified market snapshot available for this matchup.",
            cards: [
                {
                    category: "The Engine",
                    thesis: "Market data missing or incomplete.",
                    market_implication: "No pick produced.",
                    impact: "LOW",
                    details: ["No verified offer prices available."],
                },
                {
                    category: "The Trap",
                    thesis: "Defaulting prices creates false juice.",
                    market_implication: "Integrity override: no pick saved.",
                    impact: "LOW",
                    details: ["Offers excluded instead of defaulting to -110."],
                },
            ],
            logic_group: "SITUATIONAL",
            confidence_tier: "LOW",
            pick_summary: "NO_MARKET",
            recommended_pick: "NO_MARKET",
            grading_metadata: null,
        };

        const dossierNoMarket = {
            match_id: dbId,
            game_date: gameDate,
            sport: p.sport || "basketball",
            league_id: p.league || "nba",
            home_team: p.home_team,
            away_team: p.away_team,
            odds_event_id: oddsEventId,
            ...emptyIntel,
            sources: [],
            generated_at: new Date().toISOString(),
            analyzed_spread: typeof p.current_spread === "number" ? p.current_spread : null,
            analyzed_total: typeof p.current_total === "number" ? p.current_total : null,
            spread_juice: null,
            total_juice: null,
            home_ml,
            away_ml,
            logic_authority: `${pickTeam} ${fairLine.toFixed(1)} | ${edge}-pt edge`,
            kernel_trace: `[ARCHITECT TRACE]\nNO_MARKET`,
        };

        const up = await stripUnknownColumnsAndRetryUpsert(supabase, "pregame_intel", dossierNoMarket, {
            onConflict: "match_id,game_date",
            ignoreDuplicates: false,
        });

        if (!up.ok && (up as any).schemaCache) {
            console.warn(`[${requestId}] ⚠️ Schema cache issue, stripping new columns...`);
            const fallback = { ...(up as any).payload };
            delete (fallback as any).confidence_tier;
            delete (fallback as any).logic_group;
            delete (fallback as any).pick_summary;
            await supabase.from("pregame_intel").upsert(fallback, { onConflict: "match_id,game_date" });
        } else if (!up.ok) {
            throw (up as any).error;
        }

        console.log(`[${requestId}] 🎉 [SUCCESS] Saved NO_MARKET dossier.`);
        return dossierNoMarket;
    }

    // -------------------------------------------------------------------------
    // SYSTEM INSTRUCTION (Selection-based)
    // -------------------------------------------------------------------------
    const systemInstruction = `<role>
You are a senior sports betting analyst with access to Google Search.
</role>

<temporal_context>
TODAY IS: ${gameDate} (It is currently January 2026, in the 2025-26 ${p.sport === "football" ? "NFL" : p.league || "Sports"
        } season)
Your knowledge cutoff date is January 2025. Use Google Search to get current information.
</temporal_context>

<constraints>
1. You MUST select exactly ONE "selected_offer_id" from the MARKET SNAPSHOT list provided.
2. The ID must match exactly. Do not invent new IDs.
3. Prefer SPREAD when available, then TOTAL, then MONEYLINE.
4. Trust the verified market data provided in the snapshot.
5. Use Google Search to validate injuries/status/news/line context.
6. Output must be valid JSON only (no markdown, no extra keys outside schema).
</constraints>

<output_format>
See INTEL_OUTPUT_SCHEMA.
</output_format>`;

    const synthesisPrompt = `<context>
${p.away_team} @ ${p.home_team} | ${gameDate} | ${leagueDisplay}
MODEL FAIR LINE (home spread): ${fairLine.toFixed(2)}
MODEL EDGE (spread): ${edge} points

=== MARKET SNAPSHOT (SELECT ONE ID) ===
${marketMenu}
=======================================
</context>

<task>
Analyze and select the best selected_offer_id from the MARKET SNAPSHOT.
Return JSON matching the schema.
</task>`;

    const { text, sources, thoughts } = await executeAnalyticalQuery(synthesisPrompt, {
        model: "gemini-3-flash-preview",
        systemInstruction,
        responseSchema: INTEL_OUTPUT_SCHEMA,
    });

    const { analyzeMatchup } = await import("../_shared/intel-analyst.ts");
    const summary = await analyzeMatchup({
        home_team: p.home_team,
        away_team: p.away_team,
        home_context: { ...forensic.home, injury_notes: homeContext?.injury_notes || "No major reports" },
        away_context: { ...forensic.away, injury_notes: awayContext?.injury_notes || "No major reports" },
    });

    const parsed = safeJsonParse(text);
    const intel =
        parsed || ({
            selected_offer_id: "NO_MARKET",
            headline: `${p.away_team} @ ${p.home_team}`,
            briefing: "Model output parse failed. Using deterministic fallback selection.",
            cards: [
                {
                    category: "The Engine",
                    thesis: "LLM output parse failed.",
                    market_implication: "Fallback selection applied.",
                    impact: "LOW",
                    details: ["safeJsonParse returned null."],
                },
                {
                    category: "The Trap",
                    thesis: "Parsing free-form pick text breaks integrity.",
                    market_implication: "Offer selection contract enforced.",
                    impact: "LOW",
                    details: ["Pick and price are reconstructed deterministically."],
                },
            ],
            logic_group: "SITUATIONAL",
            confidence_tier: "LOW",
            pick_summary: "FALLBACK",
        } as any);

    if (intel && summary) intel.briefing = summary;

    // -------------------------------------------------------------------------
    // MARKET SNAPSHOT RESOLUTION: Server-side reconstruction
    // -------------------------------------------------------------------------
    let selectedOffer = marketOffers.find((o) => o.id === intel.selected_offer_id) || null;

    if (!selectedOffer) {
        console.warn(`[${requestId}] ⚠️ Invalid selected_offer_id "${intel.selected_offer_id}". Applying deterministic fallback.`);
        selectedOffer = pickFallbackOffer(marketOffers, fairLine, p.current_spread);
    }

    if (!selectedOffer) {
        // Should be unreachable because we already returned on empty snapshot
        selectedOffer = marketOffers[0];
    }

    // Deterministic outputs (no syntax failures)
    (intel as any).recommended_pick = formatPick(selectedOffer);
    (intel as any).grading_metadata = {
        type: selectedOffer.type,
        side: selectedOffer.side,
        selection: selectedOffer.selection,
        line: selectedOffer.line,
        price: selectedOffer.price,
    };

    console.log(
        `[${requestId}] 🛡️ [VERIFIED] Pick: "${(intel as any).recommended_pick}" | Type: ${selectedOffer.type} | Price: ${selectedOffer.price}`
    );

    // -------------------------------------------------------------------------
    // PERFECT JUICE MAPPING:
    // - Bind spread_juice/total_juice ONLY when the selected offer is that market
    // - Do not overwrite unrelated juice fields
    // -------------------------------------------------------------------------
    const bound_spread_juice = selectedOffer.type === "SPREAD" ? selectedOffer.price : spread_juice;
    const bound_total_juice = selectedOffer.type === "TOTAL" ? selectedOffer.price : total_juice;

    const dossier = {
        match_id: dbId,
        game_date: gameDate,
        sport: p.sport || "basketball",
        league_id: p.league || "nba",
        home_team: p.home_team,
        away_team: p.away_team,
        odds_event_id: oddsEventId,

        ...intel,

        sources: sources || [],
        generated_at: new Date().toISOString(),

        analyzed_spread: selectedOffer.type === "SPREAD" ? selectedOffer.line : typeof p.current_spread === "number" ? p.current_spread : null,
        analyzed_total: selectedOffer.type === "TOTAL" ? selectedOffer.line : typeof p.current_total === "number" ? p.current_total : null,

        spread_juice: bound_spread_juice,
        total_juice: bound_total_juice,

        home_ml,
        away_ml,

        logic_authority: `${selectedOffer.label} | ${edge}-pt edge`,
        kernel_trace: `[ARCHITECT TRACE]\n${thoughts || ""}`,
    };

    // Upsert with unknown-column stripping + schema-cache fallback
    const up = await stripUnknownColumnsAndRetryUpsert(supabase, "pregame_intel", dossier, {
        onConflict: "match_id,game_date",
        ignoreDuplicates: false,
    });

    if (!up.ok && (up as any).schemaCache) {
        console.warn(`[${requestId}] ⚠️ Schema cache issue, stripping new columns...`);
        const fallback = { ...(up as any).payload };
        delete (fallback as any).confidence_tier;
        delete (fallback as any).logic_group;
        delete (fallback as any).pick_summary;
        await supabase.from("pregame_intel").upsert(fallback, { onConflict: "match_id,game_date" });
    } else if (!up.ok) {
        throw (up as any).error;
    }

    console.log(`[${requestId}] 🎉 [SUCCESS] Saved.`);
    return dossier;
}
