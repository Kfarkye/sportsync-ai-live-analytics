
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import fs from 'fs';

// --- ENV SETUP ---
try {
    const envContent = fs.readFileSync('.env', 'utf8');
    console.log("DEBUG: .env content length:", envContent.length);

    envContent.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            let key = parts[0].trim().replace(/^export\s+/, '');
            let val = parts.slice(1).join('=').trim().replace(/['"]/g, '');
            process.env[key] = val;
        }
    });

    // Debugging Keys (Masked)
    const keys = Object.keys(process.env).filter(k => k.includes('API') || k.includes('SUPABASE'));
    console.log("DEBUG: Available Env Keys:", keys);
    keys.forEach(k => {
        const v = process.env[k] || "";
        console.log(`Key: ${k} | Len: ${v.length} | Prefix: ${v.substring(0, 3)}...`);
    });

} catch (e: any) {
    console.warn("No .env file found or read error:", e.message);
}

// --- DEFINITIONS ---

const APEX_CONFIG = {
    INJURY_WEIGHT: 0.40,
    FATIGUE_BASE_PENALTY: 2.0,
    APRON_TAX_MULTIPLIER: 1.75,
    ATS_THRESHOLD: 0.60,
    ATS_BONUS_POINTS: 3.0,
    HOME_COURT: 2.6,
    AVG_PACE: 100.8,
    HEAVE_PROB: 0.045
};

interface TeamInput { name: string; net_rating: number; market_injury_val: number; situation: string; is_apron_team: boolean; ats_pct: number; }
interface GameMarket { matchup: string; vegas_line: number; ticket_pct: number; last_5_diff: number; underdog: string; home_inj_val: number; away_inj_val: number; }
interface SimulationResult { fairLine: number; homeNotes: string[]; awayNotes: string[]; }
interface AnalysisResult { story: string; action: string; size: string; }

class ApexGameEngine {
    private getEffectiveRating(team: TeamInput): { rating: number, notes: string[] } {
        let rating = team.net_rating;
        const notes: string[] = [];
        const injuryHit = team.market_injury_val * APEX_CONFIG.INJURY_WEIGHT;
        rating -= injuryHit;
        if (injuryHit > 0) notes.push(`Injury Dampened (Market:-${team.market_injury_val} -> Model:-${injuryHit.toFixed(1)})`);
        if (['B2B', '3in4', 'EndRoadTrip'].includes(team.situation)) {
            let penalty = APEX_CONFIG.FATIGUE_BASE_PENALTY;
            if (team.is_apron_team) {
                penalty *= APEX_CONFIG.APRON_TAX_MULTIPLIER;
                notes.push("APRON FATIGUE CRUSH");
            } else {
                notes.push("Standard Fatigue");
            }
            rating -= penalty;
        }
        if (team.ats_pct >= APEX_CONFIG.ATS_THRESHOLD) {
            rating += APEX_CONFIG.ATS_BONUS_POINTS;
            notes.push(`ATS WAGON (+${APEX_CONFIG.ATS_BONUS_POINTS})`);
        }
        return { rating, notes };
    }
    public simulate(home: TeamInput, away: TeamInput): SimulationResult {
        const h = this.getEffectiveRating(home);
        const a = this.getEffectiveRating(away);
        const fairLine = -1 * ((h.rating - a.rating) + APEX_CONFIG.HOME_COURT);
        return { fairLine: Number(fairLine.toFixed(1)), homeNotes: h.notes, awayNotes: a.notes };
    }
}

class ApexMarketReader {
    public analyze(market: GameMarket, sim: SimulationResult): AnalysisResult {
        const { vegas_line, ticket_pct, last_5_diff, underdog } = market;
        const { fairLine, homeNotes, awayNotes } = sim;
        const recencyBias = last_5_diff * 0.35;
        const publicPrice = fairLine + recencyBias;
        const deltaMath = vegas_line - fairLine;
        let story = "Standard Market";
        let action = "PASS";
        let size = "1 Unit";
        const allNotes = [...homeNotes, ...awayNotes].join(' ');

        if (Math.abs(deltaMath) > 4.0 && allNotes.includes("APRON FATIGUE CRUSH")) {
            story = "STRUCTURAL MISMATCH (Apron/Fatigue)";
            action = "BET MODEL (Fade the Tired Team)";
            size = "2 UNITS (Hammer)";
        } else if (ticket_pct > 75 && Math.abs(vegas_line - publicPrice) > 3.0 && Math.abs(deltaMath) < 1.0) {
            story = "THE STINK (Vegas Trap)";
            action = `FADE PUBLIC (Bet ${underdog})`;
            size = "1.5 Units";
        } else if (Math.abs(deltaMath) > 2.5 && (market.home_inj_val > 4 || market.away_inj_val > 4)) {
            story = "INJURY OVERREACTION (Ewing Theory)";
            action = "BET MODEL (Take the Points)";
            size = "1 Unit";
        } else if (allNotes.includes("ATS WAGON")) {
            story = "MARKET LAG (Ride the Trend)";
            action = "BET MODEL (Don't step in front of train)";
            size = "1 Unit";
        }
        return { story, action, size };
    }
}

// Inline Helper
async function executeAnalyticalQuery(prompt: string | any[], options: any = {}) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
    if (!apiKey) console.warn("No GEMINI_API_KEY found");
    const genAI = new GoogleGenAI({ apiKey });
    const modelName = options.model || 'gemini-3-pro-preview';
    const contents = [{ role: 'user', parts: [{ text: String(prompt) }] }];
    try {
        const response = await genAI.models.generateContent({
            model: modelName,
            contents,
            config: {
                systemInstruction: options.systemInstruction,
                tools: options.tools,
                generationConfig: {
                    responseMimeType: options.responseSchema ? "application/json" : "text/plain",
                    responseSchema: options.responseSchema,
                },
                thinkingConfig: {
                    includeThoughts: true,
                    thinkingLevel: options.thinkingLevel || "high"
                }
            } as any,
        });
        const text = response.text || "";
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        const groundingUrls = groundingChunks?.map((chunk: any) => ({
            title: chunk.web?.title || 'Source',
            uri: chunk.web?.uri
        })).filter((c: any) => c.uri) || [];
        return { text, groundingUrls };
    } catch (error: any) {
        console.error("Gemini API Error:", error.message);
        if (error.status === 403) {
            console.error("403 FORBIDDEN - Check API Key permissions for model:", modelName);
        }
        return { text: "", groundingUrls: [] };
    }
}

function safeJsonParse(text: string): any {
    if (!text) return null;
    try { return JSON.parse(text); } catch { }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
        try { return JSON.parse(text.substring(start, end + 1)); } catch { }
    }
    return null;
}

// --- SETUP ---
const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || ""
);

const DATA_EXTRACTION_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        briefing: { type: Type.STRING, description: "Contextual briefing." },
        home_stats: {
            type: Type.OBJECT,
            properties: {
                net_rating: { type: Type.NUMBER, description: "Current Net Rating from 2026 season." },
                ats_pct: { type: Type.NUMBER, description: "Against The Spread % (0.0 to 1.0)." },
                injury_impact: { type: Type.NUMBER, description: "Estimated point drop due to injuries (0 to 10)." },
                situation: { type: Type.STRING, description: "One of: Home_Rest, B2B, 3in4, EndRoadTrip." },
                is_apron_team: { type: Type.BOOLEAN, description: "Is this a 'Second Apron' roster?" }
            },
            required: ["net_rating", "ats_pct", "injury_impact", "situation"]
        },
        away_stats: {
            type: Type.OBJECT,
            properties: {
                net_rating: { type: Type.NUMBER },
                ats_pct: { type: Type.NUMBER },
                injury_impact: { type: Type.NUMBER },
                situation: { type: Type.STRING },
                is_apron_team: { type: Type.BOOLEAN }
            },
            required: ["net_rating", "ats_pct", "injury_impact", "situation"]
        },
        market_context: {
            type: Type.OBJECT,
            properties: {
                ticket_pct: { type: Type.NUMBER, description: "Public ticket % on Home Team (0-100)." },
                last_5_diff: { type: Type.NUMBER, description: "Avg Point Differential last 5 games." }
            }
        }
    },
    required: ["briefing", "home_stats", "away_stats", "market_context"]
};

// Narrative Schema ... (simplified)
const NARRATIVE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        headline: { type: Type.STRING, description: "Punchy title." },
        cards: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    category: { type: Type.STRING },
                    thesis: { type: Type.STRING },
                    market_implication: { type: Type.STRING },
                    impact: { type: Type.STRING },
                    details: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
            }
        },
        logic_authority: { type: Type.STRING }
    },
    required: ["headline", "cards", "logic_authority"]
};

// --- LOGIC ---
async function processGame(match: any) {
    const { match_id, home_team, away_team, league } = match;
    console.log(`\n>>> ANALYZING: ${away_team} @ ${home_team} (${match_id})`);

    const current_spread = match.match_metadata?.home_spread || match.current_odds?.spread || 0;
    const current_total = match.match_metadata?.total || match.current_odds?.overUnder || 0;

    // STEP 1: RESEARCH PHASE
    console.log("... Researching Stats (Gemini 3 Pro) ...");
    const DATA_PROMPT = `TARGET: ${away_team} @ ${home_team} (${league}) | DATE: 2026-01-14
        
    TASK: Search for and extract precise metrics for the "Apex" model:
    1. Net Rating (season) & ATS % for both teams.
    2. Injury Situation: Convert key absences into a 0-10 "Market Impact" score (e.g. Star out = 4.5).
    3. Scheduling Spot: Identify if B2B, 3in4, or End of Road Trip.
    4. "Apron" Status: Are they a deep tax team with thin bench?
    
    RETURN ONLY JSON. If unsure, use conservative estimates (NetRtg 0, Impact 0).`;

    const { text: dataText, groundingUrls } = await executeAnalyticalQuery(DATA_PROMPT, {
        model: "gemini-3-pro-preview",
        systemInstruction: "You are a Research Assistant for a Quant Fund. Extract accurate 2026 data.",
        responseSchema: DATA_EXTRACTION_SCHEMA,
        tools: [{ googleSearch: {} }],
        thinkingBudget: 0
    });

    const data = safeJsonParse(dataText);
    if (!data) {
        console.error("LLM extraction failed", dataText);
        return;
    }

    // STEP 2: ENGINE PHASE
    console.log("... Running Apex Engine ...");
    const engine = new ApexGameEngine();
    const reader = new ApexMarketReader();

    const homeInput: TeamInput = {
        name: home_team,
        net_rating: data.home_stats.net_rating,
        market_injury_val: data.home_stats.injury_impact,
        situation: data.home_stats.situation,
        is_apron_team: data.home_stats.is_apron_team || false,
        ats_pct: data.home_stats.ats_pct
    };

    const awayInput: TeamInput = {
        name: away_team,
        net_rating: data.away_stats.net_rating,
        market_injury_val: data.away_stats.injury_impact,
        situation: data.away_stats.situation,
        is_apron_team: data.away_stats.is_apron_team || false,
        ats_pct: data.away_stats.ats_pct
    };

    const marketInput: GameMarket = {
        matchup: `${away_team} @ ${home_team}`,
        vegas_line: current_spread,
        ticket_pct: data.market_context.ticket_pct || 50,
        last_5_diff: data.market_context.last_5_diff || 0,
        underdog: current_spread < 0 ? away_team : home_team,
        home_inj_val: homeInput.market_injury_val,
        away_inj_val: awayInput.market_injury_val
    };

    const simResult = engine.simulate(homeInput, awayInput);
    const analysis = reader.analyze(marketInput, simResult);

    console.log(`   FAIR: ${simResult.fairLine} | MKT: ${current_spread} | EDGE: ${(current_spread - simResult.fairLine).toFixed(1)}`);
    console.log(`   ACTION: ${analysis.action}`);

    // STEP 3: NARRATIVE PHASE
    console.log("... Writing Narrative ...");
    const NARRATIVE_PROMPT = `
    ROLE: Lead Analyst (ESPN meets Sharp Bettor).
    MATCH: ${away_team} @ ${home_team}
    
    <APEX_ENGINE_FINDING>
    MATH FAIR PRICE: ${simResult.fairLine} (Vegas: ${current_spread})
    EDGE: ${(current_spread - simResult.fairLine).toFixed(1)} points
    ACTION_CODE: ${analysis.action}
    RECOMMENDED_SIZE: ${analysis.size}
    CORE_REASON: ${analysis.story}
    FLAGS: ${[...simResult.homeNotes, ...simResult.awayNotes].join(', ')}
    </APEX_ENGINE_FINDING>

    TASK: Write the official pre-game dossier.
    1. HEADLINE: Must be punchy and reference the edge (e.g. "The Apron Mismatch").
    2. LOGIC CARDS: Translate the "Core Reason" into a detailed thesis. Use the FLAGS to support your case.
    3. TONE: Authoritative. Do NOT mention "AI" or "Simulation". Speak as an insider detecting a market flaw.
    
    IMPORTANT: You MUST recommended exactly what the Engine found (Action: ${analysis.action}). Do not deviate.
    `;

    const { text: narrativeText } = await executeAnalyticalQuery(NARRATIVE_PROMPT, {
        model: "gemini-3-pro-preview",
        systemInstruction: "You generate clinical sports intelligence dossiers. Strict Adherence to Engine Findings.",
        responseSchema: NARRATIVE_SCHEMA,
        thinkingBudget: 0
    });

    const narrative = safeJsonParse(narrativeText);

    // Construct Final Dossier
    const dossier: any = {
        match_id: match_id,
        game_date: match.date ? match.date.split('T')[0] : '2026-01-14',
        sport: 'basketball',
        league_id: league,
        home_team,
        away_team,
        headline: narrative?.headline || `${analysis.action} (${analysis.size})`,
        briefing: data.briefing,
        recommended_pick: "PASS",
        cards: narrative?.cards || [],
        logic_authority: narrative?.logic_authority || `Apex 2026 Engine`,
        is_edge_of_day: analysis.size.includes("Hammer"),
        sources: groundingUrls || [],
        generated_at: new Date().toISOString(),
        analyzed_spread: current_spread,
        analyzed_total: current_total,
        grading_metadata: null,
        executive_summary: {},
        simulation_data: {
            projected_home_score: 0,
            projected_away_score: 0,
            projected_total: 0,
            edge_sigma: (current_spread - simResult.fairLine) / 13.0
        },
        source_count: groundingUrls.length || 0,
        confidence_score: 85
    };

    if (analysis.action.includes("BET") || analysis.action.includes("FADE")) {
        const homeEdge = current_spread - simResult.fairLine;
        if (homeEdge > 0) {
            dossier.recommended_pick = `${home_team} ${current_spread > 0 ? '+' : ''}${current_spread}`;
            dossier.grading_metadata = { type: "SPREAD", side: "HOME", selection: home_team };
        } else {
            dossier.recommended_pick = `${away_team} ${current_spread * -1 > 0 ? '+' : ''}${current_spread * -1}`;
            dossier.grading_metadata = { type: "SPREAD", side: "AWAY", selection: away_team };
        }
    } else {
        dossier.recommended_pick = "NO PLAY";
        dossier.grading_metadata = null;
    }

    const { error } = await supabase.from('pregame_intel').upsert(dossier, { onConflict: 'match_id,game_date' });
    if (error) {
        console.error("DB Upsert Error:", error);
    } else {
        console.log(`✅ SAVED INTEL for ${home_team}`);
        console.log(`   PICK: ${dossier.recommended_pick}`);
    }
}

async function run() {
    console.log("Searching for games specifically on Jan 14, 2026...");

    // Explicit Range Query
    const { data: matches, error } = await supabase
        .from('matches')
        .select('*')
        .gte('start_time', '2026-01-14T00:00:00Z')
        .lt('start_time', '2026-01-15T00:00:00Z')
        .order('start_time', { ascending: true }); // Get earliest first in that window

    if (error) {
        console.error("Query Error:", error);
        return;
    }

    if (!matches || matches.length === 0) {
        console.error("No matches found in strictly Jan 14 window.");
        // Fallback: Check 'date' string column just in case
        console.log("Checking 'date' column for '2026-01-14'...");
        const { data: matchesDate } = await supabase
            .from('matches')
            .select('*')
            .eq('date', '2026-01-14');

        if (matchesDate && matchesDate.length > 0) {
            console.log(`Found ${matchesDate.length} matches by date string.`);
            for (const m of matchesDate) await processMatchWrapper(m);
        }
        return;
    }

    console.log(`Found ${matches.length} matches on Jan 14.`);
    matches.forEach(m => console.log(`${m.id} | ${m.start_time} | ${m.away_team} @ ${m.home_team}`));

    for (const m of matches) {
        await processMatchWrapper(m);
    }
}

async function processMatchWrapper(m: any) {
    const mappedMatch = {
        ...m,
        match_id: m.id,
        league: m.league_id || 'basketball_nba'
    };
    await processGame(mappedMatch);
}

run();
