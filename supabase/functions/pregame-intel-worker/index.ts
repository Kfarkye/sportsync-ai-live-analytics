import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { executeAnalyticalQuery, safeJsonParse, Type } from "../_shared/gemini.ts";
import { getCanonicalMatchId, toLocalGameDate } from "../_shared/match-registry.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey, x-client-timeout, x-trace-id",
};

/**
 * APEX ENGINE v3.0 - Logic Core
 * Architect Pattern v4.0
 */
const APEX_CONFIG = {
    INJURY_WEIGHT: 0.40,
    MAX_INJURY_SCORE: 10.0, // Standardized 0-10 scale
    FATIGUE_BASE_PENALTY: 2.0,
    APRON_TAX_MULTIPLIER: 1.75,
    ATS_THRESHOLD: 0.60,
    ATS_BONUS_POINTS: 3.0,
    HOME_COURT: 2.6
};

// Sport detection from league ID
// Sport detection from league ID - COMPREHENSIVE LIST
const SOCCER_LEAGUES = ['ita.1', 'seriea', 'eng.1', 'epl', 'ger.1', 'bundesliga', 'esp.1', 'laliga', 'fra.1', 'ligue1', 'usa.1', 'mls', 'uefa.champions', 'ucl', 'uefa.europa', 'uel', 'caf.nations', 'copa', 'conmebol', 'concacaf', 'afc'];
const FOOTBALL_LEAGUES = ['nfl', 'college-football', 'ncaaf'];
const HOCKEY_LEAGUES = ['nhl'];
const BASEBALL_LEAGUES = ['mlb'];
const BASKETBALL_LEAGUES = ['nba', 'wnba', 'mens-college-basketball', 'ncaab', 'ncaam', 'womens-college-basketball'];
const TENNIS_LEAGUES = ['atp', 'wta'];

const detectSportFromLeague = (league: string | null | undefined): string => {
    if (!league) return 'nba'; // Explicit NBA default for null
    const l = league.toLowerCase();
    if (TENNIS_LEAGUES.some(t => l.includes(t))) return 'tennis';
    if (SOCCER_LEAGUES.some(s => l.includes(s))) return 'soccer';
    if (FOOTBALL_LEAGUES.some(f => l.includes(f))) return 'football';
    if (HOCKEY_LEAGUES.some(h => l.includes(h))) return 'hockey';
    if (BASEBALL_LEAGUES.some(b => l.includes(b))) return 'baseball';
    if (BASKETBALL_LEAGUES.some(b => l.includes(b))) return l.includes('college') ? 'college_basketball' : 'nba';
    return 'nba'; // Default for unrecognized leagues
};


const RequestSchema = z.object({
    job_id: z.string().optional(), // For queue-based workers
    match_id: z.string().min(1),
    league: z.string().nullable().optional().transform((v: string | null | undefined) => v || 'nba'),
    sport: z.string().nullable().optional(), // Will be derived from league if not provided
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
    force_refresh: z.boolean().optional().default(false) // Bypass freshness guard
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
        console.log(`[${requestId}] 📥 [PAYLOAD]`, JSON.stringify(body));

        // 1. Health Check / Ping
        if (Object.keys(body).length === 0) {
            return new Response(JSON.stringify({ status: "ok", msg: "Architect Worker Alive" }), { headers: CORS_HEADERS });
        }

        // 2. Handle Job-based invocation (Queue) 
        if (body.job_id) {
            // ...
            console.log(`WORKER: Processing Job ${body.job_id}`);
            // Claim Job
            await supabase.from('intel_jobs').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', body.job_id).eq('status', 'queued');

            // Fetch Items
            const { data: items } = await supabase.from('intel_job_items').select('*').eq('job_id', body.job_id).eq('status', 'pending');
            if (!items || items.length === 0) {
                await supabase.from('intel_jobs').update({ status: 'completed' }).eq('id', body.job_id);
                return new Response(JSON.stringify({ note: "Job Empty" }), { status: 200, headers: CORS_HEADERS });
            }

            for (const item of items) {
                try {
                    const { data: match } = await supabase.from('matches').select('*').eq('id', item.match_id).single();
                    if (!match) continue;

                    // Hydrate Request Data
                    const p = {
                        match_id: item.match_id,
                        league: match.league_id,
                        sport: detectSportFromLeague(match.league_id),
                        start_time: match.start_time,
                        current_spread: match.odds?.spread,
                        current_total: match.odds?.total,
                        home_team: match.home_team,
                        away_team: match.away_team,
                        // Feature Engineering: In real production, we'd fetch ratings from a table here
                        home_net_rating: 0,
                        away_net_rating: 0,
                        current_odds: match.current_odds
                    };

                    const result = await processSingleIntel(p, supabase, `job-${item.id.slice(0, 4)}`);
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

        // HYDRATION: Self-Healing Registry Pattern (Direct Invocations)
        if (!p.home_team || !p.away_team) {
            console.log(`[${requestId}] 💧 [HYDRATION-START] Fetching team names for ${p.match_id}...`);
            const { data: match, error: matchErr } = await supabase
                .from('matches')
                .select('home_team, away_team, league_id, sport, start_time, odds_home_spread_safe, odds_total_safe, current_odds')
                .eq('id', p.match_id)
                .single();

            if (matchErr || !match) {
                console.error(`[${requestId}] ❌ [HYDRATION-FAIL] Match ${p.match_id} not found.`);
                throw new Error(`Self-Healing Failed: Match ${p.match_id} not found.`);
            }

            // Hydrate missing fields
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

            console.log(`[${requestId}] 💧 [HYDRATION-SUCCESS] Resolved ${p.away_team} @ ${p.home_team} | Spread: ${p.current_spread}`);
        }

        // Ensure sport is correctly derived from league (fix for soccer leagues labeled as basketball)
        if (!p.sport || p.sport === 'basketball') {
            const derivedSport = detectSportFromLeague(p.league);
            if (derivedSport !== 'basketball') {
                console.log(`[${requestId}] 🔧 [SPORT-FIX] Correcting sport: ${p.sport} -> ${derivedSport} (league: ${p.league})`);
                p = { ...p, sport: derivedSport } as any;
            }
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

/**
 * Core Logic: The Architect v4.0 (Full Physics Audit)
 */
async function processSingleIntel(p: any, supabase: any, requestId: string) {
    const dbId = getCanonicalMatchId(p.match_id, p.league);

    const gameDate = p.start_time ? toLocalGameDate(p.start_time) : new Date().toISOString().split('T')[0];
    console.log(`[${requestId}] 📅 [DATE-RESOLVE] UTC: ${p.start_time} -> Local Game Day: ${gameDate}`);

    // FRESHNESS GUARD: Skip regeneration if recent intel exists (2-hour TTL)
    // Can be bypassed with force_refresh=true
    if (!p.force_refresh) {
        const FRESHNESS_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
        const { data: existingIntel } = await supabase
            .from('pregame_intel')
            .select('*')
            .eq('match_id', dbId)
            .eq('game_date', gameDate)
            .maybeSingle();

        if (existingIntel?.generated_at) {
            const generatedAt = new Date(existingIntel.generated_at).getTime();
            const ageMs = Date.now() - generatedAt;
            const ageMinutes = Math.round(ageMs / 60000);

            if (ageMs < FRESHNESS_TTL_MS) {
                console.log(`[${requestId}] ♻️ [FRESHNESS-HIT] Intel for ${dbId} is ${ageMinutes}m old. Skipping regeneration.`);
                return existingIntel;
            }
            console.log(`[${requestId}] 🔄 [FRESHNESS-MISS] Intel for ${dbId} is ${ageMinutes}m old (>${FRESHNESS_TTL_MS / 60000}m). Regenerating.`);
        }
    }

    // STAGE 1: HYDRATION (Base Ratings)

    let h_o = 110, h_d = 110, a_o = 110, a_d = 110;
    if (p.league === 'nba') {
        const { data: hP } = await supabase.from('nba_team_priors').select('*').eq('team', p.home_team).eq('season', '2025-26').single();
        const { data: aP } = await supabase.from('nba_team_priors').select('*').eq('team', p.away_team).eq('season', '2025-26').single();
        if (hP) {
            h_o = hP.o_rating; h_d = hP.d_rating;
            console.log(`[${requestId}] 📊 [PRIORS-HOME] ${p.home_team}: O(${h_o}) D(${h_d})`);
        }
        if (aP) {
            a_o = aP.o_rating; a_d = aP.d_rating;
            console.log(`[${requestId}] 📊 [PRIORS-AWAY] ${p.away_team}: O(${a_o}) D(${a_d})`);
        }
    }
    const h_base = h_o - h_d;
    const a_base = a_o - a_d;

    // STAGE 2: HYDRATE CONTEXT FROM DATABASE (Fast lookup vs slow Gemini call)
    console.log(`[${requestId}] 🔍 [CONTEXT-HYDRATE] Fetching team context from database...`);

    const { data: homeContext } = await supabase
        .from('team_game_context')
        .select('injury_impact, injury_notes, situation, rest_days, ats_last_10, fatigue_score')
        .eq('team', p.home_team)
        .eq('game_date', gameDate)
        .single();

    const { data: awayContext } = await supabase
        .from('team_game_context')
        .select('injury_impact, injury_notes, situation, rest_days, ats_last_10, fatigue_score')
        .eq('team', p.away_team)
        .eq('game_date', gameDate)
        .single();

    // 🏀 TEMPO DATA: Fetch team analytics for betting context
    const { data: tempoData } = await supabase
        .from('team_tempo')
        .select('team, pace, ortg, drtg, net_rtg, ats_record, ats_l10, over_record, under_record, over_l10, under_l10')
        .in('team', [p.home_team, p.away_team].filter(Boolean));

    const homeTempo = tempoData?.find((t: any) => t.team === p.home_team);
    const awayTempo = tempoData?.find((t: any) => t.team === p.away_team);
    console.log(`[${requestId}] 🏀 [TEMPO] Home: ${homeTempo?.pace || 'N/A'} pace | Away: ${awayTempo?.pace || 'N/A'} pace`);

    const forensic = {
        home: homeContext
            ? {
                injury_impact: homeContext.injury_impact || 0,
                situation: homeContext.situation || "Normal",
                rest_days: homeContext.rest_days ?? 2,
                ats_pct: homeContext.ats_last_10 || 0.50,
                fatigue_score: homeContext.fatigue_score || 0
            }
            : { injury_impact: 0, situation: "Normal", rest_days: 2, ats_pct: 0.50, fatigue_score: 0 },
        away: awayContext
            ? {
                injury_impact: awayContext.injury_impact || 0,
                situation: awayContext.situation || "Normal",
                rest_days: awayContext.rest_days ?? 2,
                ats_pct: awayContext.ats_last_10 || 0.50,
                fatigue_score: awayContext.fatigue_score || 0
            }
            : { injury_impact: 0, situation: "Normal", rest_days: 2, ats_pct: 0.50, fatigue_score: 0 }
    };

    if (homeContext) console.log(`[${requestId}] 📋 [CONTEXT-HOME] ${p.home_team}: Inj=${forensic.home.injury_impact}, Sit=${forensic.home.situation}, ATS=${forensic.home.ats_pct}`);
    if (awayContext) console.log(`[${requestId}] 📋 [CONTEXT-AWAY] ${p.away_team}: Inj=${forensic.away.injury_impact}, Sit=${forensic.away.situation}, ATS=${forensic.away.ats_pct}`);
    if (!homeContext && !awayContext) console.log(`[${requestId}] ⚠️ [CONTEXT-MISS] No context found, using defaults`);

    // STAGE 3: APEX PHYSICS ENGINE (Deterministic Math)
    const calculateEffective = (base: number, f: any) => {
        let rating = base;
        const notes = [];

        // Injury Hit
        const injHit = f.injury_impact * APEX_CONFIG.INJURY_WEIGHT;
        rating -= injHit;
        if (injHit > 0) notes.push(`Injury Hit: -${injHit.toFixed(1)}`);

        // Fatigue Penalty
        let fatHit = 0;
        if (f.fatigue_score && f.fatigue_score > 0) {
            // High-fidelity User Data (0-100 scale)
            // Scaling: 50 score = BASE_PENALTY (2.0)
            fatHit = (f.fatigue_score / 50) * APEX_CONFIG.FATIGUE_BASE_PENALTY;
            notes.push(`High-Q Fatigue (${f.fatigue_score}): -${fatHit.toFixed(1)}`);
        } else {
            // Case-insensitive check for codes or descriptions
            const sit = (f.situation || 'Normal').toUpperCase();
            const fatigueKeywords = ['B2B', '3IN4', 'ROADTRIP', 'BACK', '3-IN-4', '4-IN-5'];
            if (fatigueKeywords.some(k => sit.includes(k))) {
                fatHit = APEX_CONFIG.FATIGUE_BASE_PENALTY;
                notes.push(`Fatigue Penalty: -${fatHit.toFixed(1)}`);
            }
        }
        rating -= fatHit;

        // ATS Bonus
        if (f.ats_pct >= APEX_CONFIG.ATS_THRESHOLD) {
            rating += APEX_CONFIG.ATS_BONUS_POINTS;
            notes.push(`ATS Wagon: +${APEX_CONFIG.ATS_BONUS_POINTS}`);
        }

        return { rating, notes };
    };

    const h_eff = calculateEffective(h_base, forensic.home);
    const a_eff = calculateEffective(a_base, forensic.away);

    // Fair Line = -1 * (Home_Eff - Away_Eff + Home Court)
    const rawFairLine = -1 * ((h_eff.rating - a_eff.rating) + APEX_CONFIG.HOME_COURT);

    // FALLBACK: If no model data (rawFairLine ~= 0), use market spread as fair value
    // This prevents showing "Fair: 0" for non-NBA leagues without priors
    const hasModelData = Math.abs(rawFairLine) > 0.5 || (h_base !== 0 || a_base !== 0);
    const hasMarket = p.current_spread !== null && p.current_spread !== undefined;
    const fairLine = hasModelData ? rawFairLine : (hasMarket ? p.current_spread : 0);

    const delta = hasMarket && hasModelData ? Math.abs(p.current_spread - fairLine) : 0;
    const deltaDisplay = hasMarket && hasModelData ? delta.toFixed(1) : (hasMarket ? 'MARKET' : 'OFF');

    // Calculate edge
    const edge = delta.toFixed(1);
    const pickSide = fairLine < (p.current_spread || 0) ? 'HOME' : 'AWAY';
    const pickTeam = pickSide === 'HOME' ? p.home_team : p.away_team;
    const pickLine = pickSide === 'HOME' ? fairLine.toFixed(1) : `+${(-fairLine).toFixed(1)}`;
    const isActionable = hasMarket && delta >= 2;

    const odds = p.current_odds || {};
    // Extract ML from multiple possible field names in the odds object
    const rawHomeMl = p.home_ml || odds.homeWin || odds.home_ml || odds.best_h2h?.home?.price;
    const rawAwayMl = p.away_ml || odds.awayWin || odds.away_ml || odds.best_h2h?.away?.price;
    const home_ml = rawHomeMl ? (rawHomeMl > 0 ? `+${rawHomeMl}` : String(rawHomeMl)) : 'N/A';
    const away_ml = rawAwayMl ? (rawAwayMl > 0 ? `+${rawAwayMl}` : String(rawAwayMl)) : 'N/A';
    const spread_juice = p.spread_juice || (odds.homeSpreadOdds ? String(odds.homeSpreadOdds) : (odds.spread_best?.home?.price ? (odds.spread_best.home.price > 0 ? '+' + Math.round(odds.spread_best.home.price) : String(Math.round(odds.spread_best.home.price))) : '-110'));
    const total_juice = p.total_juice || (odds.overOdds ? String(odds.overOdds) : (odds.total_best?.over?.price ? (odds.total_best.over.price > 0 ? '+' + Math.round(odds.total_best.over.price) : String(Math.round(odds.total_best.over.price))) : '-110'));

    // STAGE 4: PRODUCTION SYNTHESIS
    // Dynamic season context based on league
    const leagueDisplay = (p.league || 'nba').toUpperCase();
    const sportDisplay = p.sport === 'football' ? 'NFL' : p.sport === 'baseball' ? 'MLB' : p.sport === 'hockey' ? 'NHL' : leagueDisplay;
    const seasonYear = '2025-26';

    const systemInstruction = `<role>
You are a senior sports betting analyst with access to Google Search.
You analyze matchup data and generate structured betting intel cards.
</role>

<temporal_context>
For time-sensitive queries, you MUST follow the provided current time when formulating search queries.
TODAY IS: ${gameDate} (It is currently January 2026, in the 2025-26 ${sportDisplay} season)
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
Structure your JSON output with these fields:

recommended_pick: "[${p.sport === 'tennis' ? 'Player' : 'Team'} Name] [+/-Line]"
headline: "4-6 words. Punchy hook. No names."
briefing: "" (leave empty - we use cards instead)
cards: Array of exactly 4 cards:

1. "The Spot" - Schedule/situational edge (rest, surface, travel)
2. "The Trend" - Momentum (Recent records, streaks)
3. "The Engine" - Efficiency metrics (ELO, Pace, Holding/Breaking % for Tennis)
4. "The Trap" - Market positioning (line vs fair value, edge, mispricing reason)

Each card has: category, thesis (max 15 words), market_implication, impact (HIGH/MEDIUM/LOW), details (3-4 bullets with numbers)

grading_metadata: { side: "HOME" or "AWAY", type: "SPREAD" or "MONEYLINE", selection: "[${p.sport === 'tennis' ? 'Player' : 'Team'} Name]" }

sources: Array of web sources you found. For each source include: { title: "Article title", uri: "https://..." }
IMPORTANT: Cite your sources! Include at least 2-3 sources from your Google searches in the sources array.
</output_format>`;

    // Determine favorite based on spread sign
    const homeSpread = typeof p.current_spread === 'number' ? p.current_spread : 0;
    const awaySpread = -homeSpread; // Opposite of home spread
    const homeFavored = homeSpread < 0;
    const awayFavored = awaySpread < 0;

    const synthesisPrompt = `<context>
<matchup>${p.away_team} @ ${p.home_team}</matchup>
<game_date>${gameDate}</game_date>
<league>${p.league?.toUpperCase() || 'NBA'}</league>
<sport>${p.sport?.toUpperCase() || 'BASKETBALL'}</sport>
<season>${seasonYear}</season>

<market_data>
SPREAD:
  ${p.home_team} (HOME): ${homeSpread > 0 ? '+' : ''}${homeSpread} ${homeFavored ? '(FAVORITE)' : '(UNDERDOG)'}
  ${p.away_team} (AWAY): ${awaySpread > 0 ? '+' : ''}${awaySpread} ${awayFavored ? '(FAVORITE)' : '(UNDERDOG)'}
  Juice: ${spread_juice}
MONEYLINE: ${p.home_team} ${home_ml} | ${p.away_team} ${away_ml}
TOTAL: ${typeof p.current_total === 'number' ? p.current_total : 'N/A'} (Over: ${total_juice})
MODEL FAIR LINE: ${fairLine.toFixed(1)}
EDGE: ${deltaDisplay} points
</market_data>

<efficiency_metrics>
${homeTempo ? `${p.home_team}: Pace ${homeTempo.pace || 'N/A'} | ORTG ${homeTempo.ortg || 'N/A'} | DRTG ${homeTempo.drtg || 'N/A'} | Net ${(homeTempo.net_rtg > 0 ? '+' : '')}${homeTempo.net_rtg || 0} | ATS ${homeTempo.ats_record || 'N/A'} | L10 ${homeTempo.ats_l10 || 'N/A'}` : `${p.home_team}: No data`}
${awayTempo ? `${p.away_team}: Pace ${awayTempo.pace || 'N/A'} | ORTG ${awayTempo.ortg || 'N/A'} | DRTG ${awayTempo.drtg || 'N/A'} | Net ${(awayTempo.net_rtg > 0 ? '+' : '')}${awayTempo.net_rtg || 0} | ATS ${awayTempo.ats_record || 'N/A'} | L10 ${awayTempo.ats_l10 || 'N/A'}` : `${p.away_team}: No data`}
</efficiency_metrics>

<situational_data>
${p.home_team}: ${forensic.home.rest_days}d rest | Injury: ${forensic.home.injury_impact}/10 | Situation: ${forensic.home.situation}
${p.away_team}: ${forensic.away.rest_days}d rest | Injury: ${forensic.away.injury_impact}/10 | Situation: ${forensic.away.situation}
</situational_data>
</context>

<task>
Based on the context above:
1. Search for "${p.away_team} ${p.home_team} ${p.sport === 'tennis' ? 'tennis preview injuries' : 'injury report'}" to verify status
2. Search for "${p.away_team} ${p.home_team} betting odds movement" to check liquidity
3. Synthesize all data into your analysis
4. Output your structured JSON analysis now
</task>`;



    console.log(`[${requestId}] 🧠 [SYNTHESIS-START] Invoking Architect Dossier...`);
    const { text, sources, thoughts, rawText } = await executeAnalyticalQuery(synthesisPrompt, {
        model: "gemini-3-pro-preview",
        systemInstruction,
        responseSchema: INTEL_OUTPUT_SCHEMA,
        // thinkingLevel defaults to "high" for deep reasoning
    });


    console.log(`[${requestId}] 🧠 [ANALYST-START] Generating Pro Intel Summary...`);
    const { analyzeMatchup } = await import("../_shared/intel-analyst.ts");
    const summary = await analyzeMatchup({
        home_team: p.home_team,
        away_team: p.away_team,
        home_context: {
            injury_impact: forensic.home.injury_impact,
            situation: forensic.home.situation,
            rest_days: homeContext?.rest_days || 2,
            ats_last_10: forensic.home.ats_pct,
            injury_notes: homeContext?.injury_notes || "No major reports"
        },
        away_context: {
            injury_impact: forensic.away.injury_impact,
            situation: forensic.away.situation,
            rest_days: awayContext?.rest_days || 2,
            ats_last_10: forensic.away.ats_pct,
            injury_notes: awayContext?.injury_notes || "No major reports"
        }
    });


    console.log(`[${requestId}] ✅ [SYNTHESIS-SUCCESS] Dossier generated.`);

    const intel = safeJsonParse(text);
    console.log(`[${requestId}] 📦 [PARSE] ${intel ? 'OK - ' + Object.keys(intel).length + ' fields' : 'FAILED'}`);

    if (intel && summary) {
        intel.briefing = summary; // Replace technical briefing with professional analyst summary
    }

    // Calculate SIGNED spread for the picked side (critical for grading accuracy)
    // HOME picks use the home spread as-is
    // AWAY picks use the negated home spread (away line = -home line)
    const pickedSide = intel?.grading_metadata?.side;
    const homeSpreadNum = typeof p.current_spread === 'number' ? p.current_spread : null;
    let signedSpread = homeSpreadNum;
    if (pickedSide === 'AWAY' && homeSpreadNum !== null) {
        signedSpread = -homeSpreadNum; // AWAY spread is opposite of home spread
        console.log(`[${requestId}] 📐 [SPREAD-SIGN] Pick is AWAY, flipping spread: ${homeSpreadNum} → ${signedSpread}`);
    }

    const dossier = {
        match_id: dbId,
        game_date: gameDate,
        sport: p.sport || 'basketball',
        league_id: p.league || 'nba',
        home_team: p.home_team,
        away_team: p.away_team,
        ...intel,
        sources: sources,
        generated_at: new Date().toISOString(),
        analyzed_spread: signedSpread, // SIGNED spread for the picked side
        analyzed_total: p.current_total,
        spread_juice: spread_juice,
        total_juice: total_juice,
        home_ml: home_ml,
        away_ml: away_ml,
        logic_authority: `${pickTeam} ${fairLine.toFixed(1)} | ${edge}-pt edge | Fair: ${fairLine.toFixed(1)}`,
        kernel_trace: `[ARCHITECT TRACE]\n${thoughts}`
    };

    // Quality Control Logging
    console.log(`[${requestId}] 📈 [MARKET-DATA] Spread: ${p.current_spread ?? 'MISSING'} | Total: ${p.current_total ?? 'MISSING'}`);
    console.log(`[${requestId}] 📊 [TEMPO-HOME] ${homeTempo ? `Pace: ${homeTempo.pace}, O/U: ${homeTempo.over_record}/${homeTempo.under_record}` : 'NO DATA'}`);
    console.log(`[${requestId}] 📊 [TEMPO-AWAY] ${awayTempo ? `Pace: ${awayTempo.pace}, O/U: ${awayTempo.over_record}/${awayTempo.under_record}` : 'NO DATA'}`);


    console.log(`[${requestId}] 💾 [DB-WRITE] Upserting to pregame_intel...`);
    let { error: dbError } = await supabase.from('pregame_intel').upsert(dossier, {
        onConflict: 'match_id,game_date',
        ignoreDuplicates: false
    });
    // Fallback: If new columns don't exist yet, strip them and retry
    if (dbError?.message?.includes('schema cache')) {
        console.warn(`[${requestId}] ⚠️ Schema cache issue, stripping new columns...`);
        const fallbackDossier = { ...dossier };
        delete (fallbackDossier as any).confidence_tier;
        delete (fallbackDossier as any).logic_group;
        delete (fallbackDossier as any).pick_summary;
        const retryResult = await supabase.from('pregame_intel').upsert(fallbackDossier, {
            onConflict: 'match_id,game_date',
            ignoreDuplicates: false
        });
        dbError = retryResult.error;
    }
    if (dbError) throw dbError;
    console.log(`[${requestId}] 🎉 [SUCCESS] Report generated and saved.`);


    return dossier;
}
