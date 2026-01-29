import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { executeAnalyticalQuery, safeJsonParse, Type } from "../_shared/gemini.ts";
import { getCanonicalMatchId, toLocalGameDate } from "../_shared/match-registry.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey, x-client-timeout, x-trace-id",
};

/**
 * APEX ENGINE v3.3.1 - Production Hardened
 * - Fix: Defined systemInstruction before query (CRITICAL)
 * - Fix: Reverted to npm: import (compatibility)
 * - Fix: Restored spread_juice/total_juice/ml output fields
 * - Feat: Phase 1.2 Deterministic Normalization
 * - Feat: Tennis Support
 */
const APEX_CONFIG = {
    INJURY_WEIGHT: 0.40,
    MAX_INJURY_SCORE: 10.0,
    FATIGUE_BASE_PENALTY: 2.0,
    APRON_TAX_MULTIPLIER: 1.75,
    ATS_THRESHOLD: 0.60,
    ATS_BONUS_POINTS: 3.0,
    HOME_COURT: 2.6
};

// COMPREHENSIVE LEAGUE LIST
const SOCCER_LEAGUES = ['ita.1', 'seriea', 'eng.1', 'epl', 'ger.1', 'bundesliga', 'esp.1', 'laliga', 'fra.1', 'ligue1', 'usa.1', 'mls', 'uefa.champions', 'ucl', 'uefa.europa', 'uel', 'caf.nations', 'copa', 'conmebol', 'concacaf', 'afc'];
const FOOTBALL_LEAGUES = ['nfl', 'college-football', 'ncaaf'];
const HOCKEY_LEAGUES = ['nhl'];
const BASEBALL_LEAGUES = ['mlb'];
const BASKETBALL_LEAGUES = ['nba', 'wnba', 'mens-college-basketball', 'ncaab', 'ncaam', 'womens-college-basketball'];
const TENNIS_LEAGUES = ['atp', 'wta', 'tennis'];

const detectSportFromLeague = (league: string | null | undefined): string => {
    if (!league) return 'nba';
    const l = league.toLowerCase();
    if (TENNIS_LEAGUES.some(t => l.includes(t))) return 'tennis';
    if (SOCCER_LEAGUES.some(s => l.includes(s))) return 'soccer';
    if (FOOTBALL_LEAGUES.some(f => l.includes(f))) return 'football';
    if (HOCKEY_LEAGUES.some(h => l.includes(h))) return 'hockey';
    if (BASEBALL_LEAGUES.some(b => l.includes(b))) return 'baseball';
    if (BASKETBALL_LEAGUES.some(b => l.includes(b))) return l.includes('college') ? 'college_basketball' : 'nba';
    return 'nba';
};

const RequestSchema = z.object({
    job_id: z.string().optional(),
    match_id: z.string().min(1),
    league: z.string().nullable().optional().transform((v: string | null | undefined) => v || 'nba'),
    sport: z.string().nullable().optional(),
    start_time: z.string().optional(),
    current_spread: z.number().nullable().optional(),
    current_total: z.number().nullable().optional(),
    home_team: z.string().optional(),
    away_team: z.string().optional(),
    home_net_rating: z.number().optional().default(0),
    away_net_rating: z.number().optional().default(0),
    current_odds: z.any().optional(),
    home_ml: z.union([z.string(), z.number()]).nullable().optional().transform(v => v != null ? String(v) : null),
    away_ml: z.union([z.string(), z.number()]).nullable().optional().transform(v => v != null ? String(v) : null),
    spread_juice: z.union([z.string(), z.number()]).nullable().optional().transform(v => v != null ? String(v) : null),
    total_juice: z.union([z.string(), z.number()]).nullable().optional().transform(v => v != null ? String(v) : null),
    force_refresh: z.boolean().optional().default(false)
});

const INTEL_OUTPUT_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        recommended_pick: { type: Type.STRING },
        headline: { type: Type.STRING },
        briefing: { type: Type.STRING },
        grading_metadata: {
            type: Type.OBJECT,
            properties: {
                side: { type: Type.STRING, enum: ["HOME", "AWAY", "OVER", "UNDER"] },
                type: { type: Type.STRING, enum: ["SPREAD", "TOTAL", "MONEYLINE"] },
                selection: { type: Type.STRING }
            },
            required: ["side", "type", "selection"]
        },
        cards: {
            type: Type.ARRAY,
            minItems: 2,
            items: {
                type: Type.OBJECT,
                properties: {
                    category: { type: Type.STRING, enum: ["The Spot", "The Trend", "The Engine", "The Trap", "X-Factor"] },
                    thesis: { type: Type.STRING },
                    market_implication: { type: Type.STRING },
                    impact: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
                    details: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["category", "thesis", "market_implication", "impact", "details"]
            }
        },
        logic_group: {
            type: Type.STRING,
            enum: ["SCHEDULE_SPOT", "MARKET_DISLOCATION", "KEY_INJURY", "MODEL_EDGE", "SITUATIONAL"]
        },
        confidence_tier: {
            type: Type.STRING,
            enum: ["HIGH", "MEDIUM", "LOW"]
        },
        pick_summary: { type: Type.STRING }
    },
    required: ["recommended_pick", "headline", "briefing", "cards", "grading_metadata", "logic_group", "confidence_tier", "pick_summary"]
};

// @ts-ignore: Deno is global
Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

    const supabase = createClient(
        // @ts-ignore
        Deno.env.get('SUPABASE_URL') ?? '',
        // @ts-ignore
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const requestId = crypto.randomUUID().slice(0, 8);
    console.log(`[${requestId}] 🚀 [WORKER-START] Request received`);

    try {
        const body = await req.json().catch(() => ({}));

        // 1. Health Check
        if (Object.keys(body).length === 0) {
            return new Response(JSON.stringify({ status: "ok", msg: "Architect Worker Alive" }), { headers: CORS_HEADERS });
        }

        // 2. Handle Job-based invocation (Queue) 
        if (body.job_id) {
            console.log(`WORKER: Processing Job ${body.job_id}`);
            await supabase.from('intel_jobs').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', body.job_id).eq('status', 'queued');
            const { data: items } = await supabase.from('intel_job_items').select('*').eq('job_id', body.job_id).eq('status', 'pending');
            if (!items || items.length === 0) {
                await supabase.from('intel_jobs').update({ status: 'completed' }).eq('id', body.job_id);
                return new Response(JSON.stringify({ note: "Job Empty" }), { status: 200, headers: CORS_HEADERS });
            }
            for (const item of items) {
                try {
                    const { data: match } = await supabase.from('matches').select('*').eq('id', item.match_id).single();
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
                        current_odds: match.current_odds
                    };
                    await processSingleIntel(p, supabase, `job-${item.id.slice(0, 4)}`);
                    await supabase.from('intel_job_items').update({ status: 'success' }).eq('id', item.id);
                } catch (e: any) {
                    console.error(`Item Fail: ${item.match_id}`, e.message);
                    await supabase.from('intel_job_items').update({ status: 'failed', error: e.message }).eq('id', item.id);
                }
            }
            await supabase.from('intel_jobs').update({ status: 'completed' }).eq('id', body.job_id);
            return new Response(JSON.stringify({ status: "Job Completed" }), { headers: CORS_HEADERS });
        }

        // Handle Direct invocation
        const validation = RequestSchema.safeParse(body);
        if (!validation.success) throw new Error("Invalid Input Schema: " + validation.error.message);
        let p = validation.data;

        // HYDRATION
        if (!p.home_team || !p.away_team) {
            console.log(`[${requestId}] 💧 [HYDRATION-START] Fetching team names for ${p.match_id}...`);
            const { data: match, error: matchErr } = await supabase
                .from('matches')
                .select('home_team, away_team, league_id, sport, start_time, odds_home_spread_safe, odds_total_safe, current_odds')
                .eq('id', p.match_id)
                .single();

            if (matchErr || !match) throw new Error(`Self-Healing Failed: Match ${p.match_id} not found.`);

            p = {
                ...p,
                home_team: p.home_team || match.home_team,
                away_team: p.away_team || match.away_team,
                league: p.league || match.league_id,
                sport: p.sport || match.sport || detectSportFromLeague(p.league || match.league_id),
                start_time: p.start_time || match.start_time,
                current_spread: p.current_spread ?? match.odds_home_spread_safe ?? (match.current_odds?.homeSpread || match.current_odds?.spread_home_value),
                current_total: p.current_total ?? match.odds_total_safe ?? (match.current_odds?.total || match.current_odds?.total_value),
                current_odds: p.current_odds || match.current_odds
            } as any;
        }

        if (!p.sport || p.sport === 'basketball') {
            const derivedSport = detectSportFromLeague(p.league);
            if (derivedSport !== 'basketball') p = { ...p, sport: derivedSport } as any;
        }

        const dossier = await processSingleIntel(p, supabase, requestId);
        return new Response(JSON.stringify(dossier), {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });

    } catch (err: any) {
        console.error(`[${requestId}] ❌ [FATAL-ERROR]`, err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
});

async function processSingleIntel(p: any, supabase: any, requestId: string) {
    const dbId = getCanonicalMatchId(p.match_id, p.league);
    const gameDate = p.start_time ? toLocalGameDate(p.start_time) : new Date().toISOString().split('T')[0];

    const { data: matchRecord } = await supabase.from('matches').select('odds_api_event_id').eq('id', dbId).maybeSingle();
    const oddsEventId = matchRecord?.odds_api_event_id || null;

    // FRESHNESS GUARD
    if (!p.force_refresh) {
        const FRESHNESS_TTL_MS = 2 * 60 * 60 * 1000;
        const { data: existingIntel } = await supabase.from('pregame_intel').select('*').eq('match_id', dbId).eq('game_date', gameDate).maybeSingle();
        if (existingIntel?.generated_at) {
            const ageMs = Date.now() - new Date(existingIntel.generated_at).getTime();
            if (ageMs < FRESHNESS_TTL_MS) {
                console.log(`[${requestId}] ♻️ [FRESHNESS-HIT] Intel valid. Skipping.`);
                return existingIntel;
            }
        }
    }

    // CONTEXT & RATINGS
    let h_o = 110, h_d = 110, a_o = 110, a_d = 110;
    if (p.league === 'nba') {
        const { data: hP } = await supabase.from('nba_team_priors').select('*').eq('team', p.home_team).eq('season', '2025-26').single();
        const { data: aP } = await supabase.from('nba_team_priors').select('*').eq('team', p.away_team).eq('season', '2025-26').single();
        if (hP) { h_o = hP.o_rating; h_d = hP.d_rating; }
        if (aP) { a_o = aP.o_rating; a_d = aP.d_rating; }
    }
    const h_base = h_o - h_d;
    const a_base = a_o - a_d;

    const { data: homeContext } = await supabase.from('team_game_context').select('*').eq('team', p.home_team).eq('game_date', gameDate).single();
    const { data: awayContext } = await supabase.from('team_game_context').select('*').eq('team', p.away_team).eq('game_date', gameDate).single();

    const forensic = {
        home: {
            injury_impact: homeContext?.injury_impact || 0,
            situation: homeContext?.situation || "Normal",
            rest_days: homeContext?.rest_days ?? 2,
            ats_pct: homeContext?.ats_last_10 || 0.50,
            fatigue_score: homeContext?.fatigue_score || 0
        },
        away: {
            injury_impact: awayContext?.injury_impact || 0,
            situation: awayContext?.situation || "Normal",
            rest_days: awayContext?.rest_days ?? 2,
            ats_pct: awayContext?.ats_last_10 || 0.50,
            fatigue_score: awayContext?.fatigue_score || 0
        }
    };

    // APEX PHYSICS
    const calculateEffective = (base: number, f: any) => {
        let rating = base;
        rating -= (f.injury_impact * APEX_CONFIG.INJURY_WEIGHT);
        let fatHit = 0;
        if (f.fatigue_score > 0) fatHit = (f.fatigue_score / 50) * APEX_CONFIG.FATIGUE_BASE_PENALTY;
        else if (['B2B', '3IN4'].some(k => (f.situation || '').toUpperCase().includes(k))) fatHit = APEX_CONFIG.FATIGUE_BASE_PENALTY;
        rating -= fatHit;
        if (f.ats_pct >= APEX_CONFIG.ATS_THRESHOLD) rating += APEX_CONFIG.ATS_BONUS_POINTS;
        return rating;
    };

    const h_eff = calculateEffective(h_base, forensic.home);
    const a_eff = calculateEffective(a_base, forensic.away);
    const rawFairLine = -1 * ((h_eff - a_eff) + APEX_CONFIG.HOME_COURT);
    const hasModelData = Math.abs(rawFairLine) > 0.5 || (h_base !== 0 || a_base !== 0);
    const hasMarket = p.current_spread !== null && p.current_spread !== undefined;
    const fairLine = hasModelData ? rawFairLine : (hasMarket ? p.current_spread : 0);
    const delta = hasMarket && hasModelData ? Math.abs(p.current_spread - fairLine) : 0;
    const edge = delta.toFixed(1);
    const pickSide = fairLine < (p.current_spread || 0) ? 'HOME' : 'AWAY';
    const pickTeam = pickSide === 'HOME' ? p.home_team : p.away_team;
    const leagueDisplay = (p.league || 'nba').toUpperCase();

    // ODDS EXTRACTION (Restored for Dosage)
    const odds = p.current_odds || {};
    const rawHomeMl = p.home_ml || odds.homeWin || odds.home_ml || odds.best_h2h?.home?.price;
    const rawAwayMl = p.away_ml || odds.awayWin || odds.away_ml || odds.best_h2h?.away?.price;

    const formatML = (val: any) => {
        if (!val) return 'N/A';
        const num = parseFloat(val);
        return isNaN(num) ? String(val) : (num > 0 ? `+${num}` : String(num));
    };

    const home_ml = formatML(rawHomeMl);
    const away_ml = formatML(rawAwayMl);
    const spread_juice = p.spread_juice || (odds.homeSpreadOdds ? String(odds.homeSpreadOdds) : (odds.spread_best?.home?.price ? (odds.spread_best.home.price > 0 ? '+' + Math.round(odds.spread_best.home.price) : String(Math.round(odds.spread_best.home.price))) : '-110'));
    const total_juice = p.total_juice || (odds.overOdds ? String(odds.overOdds) : (odds.total_best?.over?.price ? (odds.total_best.over.price > 0 ? '+' + Math.round(odds.total_best.over.price) : String(Math.round(odds.total_best.over.price))) : '-110'));

    // -------------------------------------------------------------------------
    // SYSTEM INSTRUCTION DEFINITION (FIXED)
    // -------------------------------------------------------------------------
    const systemInstruction = `<role>
You are a senior sports betting analyst with access to Google Search.
You analyze matchup data and generate structured betting intel cards.
</role>

<temporal_context>
For time-sensitive queries, you MUST follow the provided current time when formulating search queries.
TODAY IS: ${gameDate} (It is currently January 2026, in the 2025-26 ${p.sport === 'football' ? 'NFL' : (p.league || 'Sports')} season)
Your knowledge cutoff date is January 2025. Use Google Search to get current information.
</temporal_context>

<constraints>
1. Trust the VERIFIED MARKET DATA in the user prompt as your baseline
2. Use Google Search to find current injuries/status, news, and line movements
3. If search finds MAJOR discrepancies (e.g. key injury/withdrawal we missed), adjust your analysis
4. Output must be valid JSON - no markdown, no asterisks, no formatting
5. Every stat must include a NUMBER or PERCENTAGE
</constraints>

<search_strategy>
Search to enhance and validate:
1. Current injury/availability reports for both ${p.sport === 'tennis' ? 'players' : 'teams'}
2. Recent performance and betting trends
3. Line movement and sharp money signals
Use search to ADD context. The baseline data is already verified.
</search_strategy>

<output_format>
See INTEL_OUTPUT_SCHEMA.
RULES FOR PICK FORMATTING:
1. DO NOT include odds (like -110 or -150) in the "recommended_pick" text.
2. If picking a winner straight up, use type: "MONEYLINE".
3. If picking a spread of 0 or PK, treat it as a spread of 0.
</output_format>`;

    const synthesisPrompt = `<context>
${p.away_team} @ ${p.home_team} | ${gameDate} | ${leagueDisplay}
SPREAD: ${p.home_team} ${p.current_spread ?? 'N/A'} (Juice: ${spread_juice})
TOTAL: ${p.current_total ?? 'N/A'} (Juice: ${total_juice})
MONEYLINE: ${home_ml} / ${away_ml}
MODEL FAIR: ${fairLine.toFixed(1)}
</context>
<task>
Synthesize analysis and output JSON.
</task>`;

    const { text, sources, thoughts } = await executeAnalyticalQuery(synthesisPrompt, {
        model: "gemini-3-flash-preview",
        systemInstruction, // ✅ NOW DEFINED
        responseSchema: INTEL_OUTPUT_SCHEMA,
    });

    const { analyzeMatchup } = await import("../_shared/intel-analyst.ts");
    const summary = await analyzeMatchup({
        home_team: p.home_team,
        away_team: p.away_team,
        home_context: { ...forensic.home, injury_notes: homeContext?.injury_notes || "No major reports" },
        away_context: { ...forensic.away, injury_notes: awayContext?.injury_notes || "No major reports" }
    });

    const intel = safeJsonParse(text);
    if (intel && summary) intel.briefing = summary;

    // DETERMINISTIC NORMALIZATION (Phase 1.2)
    if (intel && intel.recommended_pick) {
        let pick = intel.recommended_pick;
        pick = pick.replace(/\s*\((?:[+-]?\d+(?:\.\d+)?|Ev|even|Eve|[-+]\d{3,}).*?\)/gi, '');
        pick = pick.replace(/\s*\+0(\.0)?\s*$/i, ' PK');
        pick = pick.replace(/\s*-0(\.0)?\s*$/i, ' PK');
        pick = pick.replace(/\s+0\s*$/i, ' PK');
        pick = pick.replace(/\s*Draw No Bet\s*/i, ' PK');
        pick = pick.replace(/\s*DNB\s*/i, ' PK');
        intel.recommended_pick = pick.trim();

        if (intel.grading_metadata) {
            const lowerPick = pick.toLowerCase();
            if (lowerPick.includes('moneyline') || lowerPick.includes(' ml') || lowerPick.match(/ml\s*\(/i)) {
                intel.grading_metadata.type = 'MONEYLINE';
            } else if (lowerPick.includes('over') || lowerPick.includes('under')) {
                intel.grading_metadata.type = 'TOTAL';
                if (lowerPick.includes('over')) intel.grading_metadata.side = 'OVER';
                if (lowerPick.includes('under')) intel.grading_metadata.side = 'UNDER';
            } else if (/[+-]\d/.test(pick) || lowerPick.includes('pk')) {
                intel.grading_metadata.type = 'SPREAD';
            }
        }
        console.log(`[${requestId}] 🧹 [NORMALIZE] Pick: "${intel.recommended_pick}" | Type: ${intel.grading_metadata?.type}`);
    }

    const dossier = {
        match_id: dbId,
        game_date: gameDate,
        sport: p.sport || 'basketball',
        league_id: p.league || 'nba',
        home_team: p.home_team,
        away_team: p.away_team,
        odds_event_id: oddsEventId,
        ...intel,
        sources: sources,
        generated_at: new Date().toISOString(),
        // SPREAD HIERARCHY (in order of authority):
        // 1. Odds API via current_spread (from pregame-intel-cron: odds_home_spread_safe)
        // 2. ESPN/Feeds via current_spread (from pregame-intel-cron: current_odds.homeSpread)
        // 3. AI recommendation text (last resort fallback, grounded to what AI cited)
        analyzed_spread: (() => {
            // Priority 1 & 2: current_spread already contains Odds API -> ESPN fallback from cron
            if (typeof p.current_spread === 'number') return p.current_spread;

            // Priority 3: Extract from AI's recommended_pick (e.g., "Team +5.5 Games")
            const pickText = intel?.recommended_pick || '';
            const spreadMatch = pickText.match(/([+-]\d+\.?\d*)/);
            if (spreadMatch) {
                const num = parseFloat(spreadMatch[1]);
                if (!isNaN(num) && Math.abs(num) < 50) return num;
            }

            // Check for Pick'em
            if (/pk|pick'?em/i.test(pickText)) return 0;

            return null;
        })(),
        analyzed_total: p.current_total,
        home_ml: home_ml, // Restored
        away_ml: away_ml, // Restored
        spread_juice: spread_juice, // Restored
        total_juice: total_juice, // Restored
        logic_authority: `${pickTeam} ${fairLine.toFixed(1)} | ${edge}-pt edge`,
        kernel_trace: `[ARCHITECT TRACE]\n${thoughts}`
    };

    let { error: dbError } = await supabase.from('pregame_intel').upsert(dossier, {
        onConflict: 'match_id,game_date',
        ignoreDuplicates: false
    });

    if (dbError?.message?.includes('schema cache')) {
        console.warn(`[${requestId}] ⚠️ Schema cache issue, stripping new columns...`);
        const fallback = { ...dossier };
        delete (fallback as any).confidence_tier;
        delete (fallback as any).logic_group;
        delete (fallback as any).pick_summary;
        await supabase.from('pregame_intel').upsert(fallback, { onConflict: 'match_id,game_date' });
    } else if (dbError) {
        throw dbError;
    }

    console.log(`[${requestId}] 🎉 [SUCCESS] Saved.`);
    return dossier;
}
