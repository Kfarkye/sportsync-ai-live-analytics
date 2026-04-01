import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI, Type } from "@google/genai";
import * as fs from 'fs';

/**
 * APEX BETTING ENGINE v3.0 - INSTITUTIONAL GRADE
 * 
 * DESIGN PHILOSOPHY:
 * 1. AXIOMATIC TRUTH: Use local deterministic physics (Apex Engine).
 * 2. GROUNDED SEARCH: Real-time intelligence via Gemini Search.
 * 3. THINKING BUDGET: Allow the model to "reason" through market friction before output.
 */

const APEX_CONFIG = {
    INJURY_WEIGHT: 0.40,
    FATIGUE_BASE_PENALTY: 2.0,
    APRON_TAX_MULTIPLIER: 1.75,
    ATS_THRESHOLD: 0.60,
    ATS_BONUS_POINTS: 3.0,
    HOME_COURT: 2.6,
    AVG_PACE: 100.8,
};

interface TeamInput {
    name: string;
    net_rating: number;
    market_injury_val: number;
    situation: string;
    is_apron_team: boolean;
    ats_pct: number;
}

interface GameMarket {
    matchup: string;
    vegas_line: number;
    ticket_pct: number;
    last_5_diff: number;
    underdog: string;
    home_inj_val: number;
    away_inj_val: number;
}

interface SimulationResult {
    fairLine: number;
    homeNotes: string[];
    awayNotes: string[];
}

interface AnalysisResult {
    story: string;
    action: string;
    size: string;
}

/**
 * Deterministic Apex Physics Engine
 */
class ApexGameEngine {
    private getEffectiveRating(team: TeamInput): { rating: number, notes: string[] } {
        let rating = team.net_rating;
        const notes: string[] = [];

        const injuryHit = team.market_injury_val * APEX_CONFIG.INJURY_WEIGHT;
        rating -= injuryHit;
        if (injuryHit > 0) notes.push(`Injury Dampened (-${injuryHit.toFixed(1)})`);

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
        // Fair Line = -1 * (Diff in Ratings + Home Court)
        const fairLine = -1 * ((h.rating - a.rating) + APEX_CONFIG.HOME_COURT);
        return {
            fairLine: Number(fairLine.toFixed(1)),
            homeNotes: h.notes,
            awayNotes: a.notes
        };
    }
}

/**
 * Market Logic Layer
 */
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
            action = "BET MODEL (Trend)";
            size = "1 Unit";
        }

        return { story, action, size };
    }
}

// --- ENV LOADING ---
try {
    if (fs.existsSync('.env')) {
        const envContent = fs.readFileSync('.env', 'utf8');
        envContent.split('\n').forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2) {
                let key = parts[0].trim().replace(/^export\s+/, '');
                let val = parts.slice(1).join('=').trim().replace(/['"]/g, '');
                process.env[key] = val;
            }
        });
    }
} catch (e) { }

// --- INITIALIZE API & CLIENTS ---
// Use environment variable - set via: export GEMINI_API_KEY=your_key
const API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
if (!API_KEY) console.warn("⚠️ No GEMINI_API_KEY found in environment");
const ai = new GoogleGenAI({ apiKey: API_KEY });

const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || ""
);

/**
 * Execute a clinical, grounded search for real-time team stats.
 */
async function fetchGroundedIntelligence(home: string, away: string) {
    console.log(`   [SEARCH] Gathering grounded intel...`);

    const prompt = `
        Conduct a clinical tactical audit for ${away} at ${home}.
        TODAY IS JANUARY 15, 2026. This is the 2025-26 NBA Regular Season.
        
        1. SEARCH: Current net rating, ATS percentage, and injury news for both teams.
        2. VERIFY: Situationals (Back-to-back, end of road trip).
        3. EXTRACT: Market sentiment (Ticket vs Money percentages).
        
        Return strictly JSON with REAL current season data.
    `;

    const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: prompt,
        config: {
            systemInstruction: "You are the Lead Analyst for an institutional betting syndicate. You provide clinical, data-driven intelligence. Never hallucinate. Use real 2026 stats.",
            tools: [{ googleSearch: {} }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        home_stats: {
                            type: Type.OBJECT,
                            properties: {
                                net_rating: { type: Type.NUMBER },
                                ats_pct: { type: Type.NUMBER },
                                injury_impact: { type: Type.NUMBER },
                                situation: { type: Type.STRING },
                                is_apron_team: { type: Type.BOOLEAN }
                            },
                            required: ["net_rating", "ats_pct", "injury_impact", "situation", "is_apron_team"]
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
                            required: ["net_rating", "ats_pct", "injury_impact", "situation", "is_apron_team"]
                        },
                        market: {
                            type: Type.OBJECT,
                            properties: {
                                ticket_pct: { type: Type.NUMBER },
                                vegas_line: { type: Type.NUMBER }
                            },
                            required: ["ticket_pct", "vegas_line"]
                        },
                        briefing: { type: Type.STRING }
                    },
                    required: ["home_stats", "away_stats", "market", "briefing"]
                }
            },
            thinkingConfig: {
                includeThoughts: true,
                thinkingLevel: "high"
            }
        } as any
    });

    return JSON.parse(response.text || "{}");
}

/**
 * Process a single game through the Apex Pipeline
 */
async function processGame(match: any) {
    const { id: match_id, home_team, away_team, league_id, start_time } = match;
    console.log(`\n>>> AUDITING: ${away_team} @ ${home_team}`);

    try {
        // 1. GATHER GROUNDED DATA
        const intel = await fetchGroundedIntelligence(home_team, away_team);

        // 2. COMPUTE DETERMINISTIC PHYSICS (APEX ENGINE)
        const engine = new ApexGameEngine();
        const reader = new ApexMarketReader();

        const homeInput: TeamInput = {
            name: home_team,
            ...intel.home_stats,
            market_injury_val: intel.home_stats?.injury_impact || 0
        };
        const awayInput: TeamInput = {
            name: away_team,
            ...intel.away_stats,
            market_injury_val: intel.away_stats?.injury_impact || 0
        };

        const simResult = engine.simulate(homeInput, awayInput);

        const marketInput: GameMarket = {
            matchup: `${away_team} @ ${home_team}`,
            vegas_line: intel.market?.vegas_line || -4.5,
            ticket_pct: intel.market?.ticket_pct || 50,
            last_5_diff: 0,
            underdog: simResult.fairLine > 0 ? away_team : home_team,
            home_inj_val: homeInput.market_injury_val,
            away_inj_val: awayInput.market_injury_val
        };

        const analysis = reader.analyze(marketInput, simResult);
        console.log(`   SIGNAL: ${analysis.action} [${analysis.size}]`);

        // 3. GENERATE FINAL DOSSIER
        const dossier = {
            match_id,
            game_date: start_time ? start_time.split('T')[0] : '2026-01-15',
            home_team,
            away_team,
            league_id,
            sport: 'basketball',
            headline: `${analysis.action}: ${away_team} @ ${home_team}`,
            briefing: intel.briefing || "Intel gathering in progress.",
            recommended_pick: analysis.action,
            cards: [
                { category: "The Spot", thesis: analysis.story, impact: "HIGH" },
                { category: "The Engine", thesis: `Fair Line: ${simResult.fairLine}`, impact: "MEDIUM" }
            ],
            grading_metadata: {
                type: "SPREAD",
                side: analysis.action.includes(home_team) ? "HOME" : "AWAY",
                selection: analysis.action
            },
            logic_authority: `Apex Logic Engine v3.0 | Delta: ${Math.abs((intel.market?.vegas_line || -4.5) - simResult.fairLine).toFixed(1)}`,
            generated_at: new Date().toISOString()
        };

        const { error } = await supabase.from('pregame_intel').upsert(dossier, { onConflict: 'match_id,game_date' });
        if (error) throw error;
        console.log("   ✅ Dossier Persisted");

    } catch (err: any) {
        console.error(`   ❌ Pipeline Failure [${match_id}]:`, err.message);
    }
}

/**
 * Main Run Loop
 */
async function main() {
    console.log("🏀 Initiating Jan 15 Apex Sync...");

    const { data: matches } = await supabase
        .from('matches')
        .select('*')
        .ilike('league_id', '%nba%')
        .gte('start_time', '2026-01-15T00:00:00Z')
        .lt('start_time', '2026-01-16T00:00:00Z');

    if (!matches || matches.length === 0) {
        console.warn("No games found for targeted date. Check Supabase 'matches' table.");
        return;
    }

    console.log(`Analyzing ${matches.length} matches.`);
    for (const match of matches) {
        await processGame(match);
    }

    console.log("\n✨ Apex Sync Complete.");
}

main().catch(console.error);
