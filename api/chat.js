/* ============================================================================
   api/chat.js
   "Obsidian Ledger" — Production Backend (v19.2 Fixed)
============================================================================ */
import { GoogleGenAI } from "@google/genai";
import { createClient } from '@supabase/supabase-js';

const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CONFIG = {
    MODEL_ID: "gemini-3-flash-preview",
    THINKING_CONFIG: { includeThoughts: true, thinkingLevel: "high" },
    PICK_TRIGGERS: ['pick', 'bet', 'prediction', 'analyze', 'analysis', 'edge', 'spread', 'over', 'under', 'moneyline', 'verdict', 'play', 'handicap', 'sharp', 'odds', 'line']
};

// --- UTILITIES ---
function safeJsonStringify(obj, maxLen = 1200) {
    try { const s = JSON.stringify(obj); return s.length > maxLen ? s.slice(0, maxLen) + '…' : s; } catch { return ''; }
}

function detectIntent(query, hasImage) {
    if (hasImage) return 'STRICT_PICK';
    if (!query) return 'FLEX_INFO';
    const q = query.toLowerCase();
    return CONFIG.PICK_TRIGGERS.some(t => q.includes(t)) ? 'STRICT_PICK' : 'FLEX_INFO';
}

const getMarketPhase = (match) => {
    if (!match) return "UNKNOWN";
    const status = (match.status || match.game_status || "").toUpperCase();
    if (status.includes("IN_PROGRESS") || status.includes("LIVE") || status.includes("HALFTIME")) return `🔴 LIVE_IN_PLAY [${match.clock || "Active"}]`;
    if (status.includes("FINAL") || status.includes("FINISHED")) return "🏁 FINAL_SCORE";
    if (match.start_time) {
        const diff = (new Date(match.start_time).getTime() - Date.now()) / 36e5;
        if (diff < 0 && diff > -4) return "🔴 LIVE_IN_PLAY (Calculated)";
        if (diff <= -4) return "🏁 FINAL_SCORE";
        if (diff < 1) return "⚡ CLOSING_LINE";
        if (diff < 24) return "🌊 DAY_OF_GAME";
    }
    return "🔭 OPENING_MARKET";
};

// --- LIVE SENTINEL ---
function extractAllTeamHints(query) {
    if (!query) return [];
    const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4);
    return tokens.sort((a, b) => b.length - a.length).slice(0, 3);
}

async function scanForLiveGame(userQuery) {
    const hints = extractAllTeamHints(userQuery);
    if (!hints.length) return { ok: false };
    try {
        const orClauses = hints.map(h => `home_team.ilike.%${h}%,away_team.ilike.%${h}%`).join(',');
        const { data } = await supabase.from('live_game_state')
            .select('*')
            .in('game_status', ['IN_PROGRESS', 'HALFTIME', 'END_PERIOD', 'LIVE'])
            .or(orClauses)
            .order('updated_at', { ascending: false })
            .limit(1);
        if (data?.[0]) return { ok: true, data: data[0], isLiveOverride: true };
        return { ok: false };
    } catch (e) { return { ok: false }; }
}

function isContextStale(context) {
    if (!context?.start_time) return false;
    const gameStart = new Date(context.start_time);
    const now = new Date();
    const status = (context.status || context.game_status || '').toUpperCase();
    if ((now - gameStart) > 15 * 60000 && !['IN_PROGRESS', 'LIVE', 'HALFTIME', 'FINAL'].includes(status)) return true;
    return false;
}

// --- DATA FETCHERS ---
const INJURY_CACHE = new Map();
async function fetchESPNInjuries(teamId, sportKey) {
    const cacheKey = `${sportKey}_${teamId}`;
    const cached = INJURY_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < 300000) return { ...cached.data, cached: true };
    const config = { NBA: { s: 'basketball', l: 'nba' }, NFL: { s: 'football', l: 'nfl' }, NHL: { s: 'hockey', l: 'nhl' } }[sportKey] || { s: 'basketball', l: 'nba' };
    try {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${config.s}/${config.l}/teams/${teamId}?enable=injuries`);
        const data = await res.json();
        const result = { injuries: (data.team?.injuries || []).map(i => ({ name: i.athlete?.displayName, status: i.status?.toUpperCase() })).slice(0, 6) };
        INJURY_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
    } catch { return { injuries: [] }; }
}

async function fetchLiveState(matchId) {
    if (!matchId) return { ok: false };
    const { data, error } = await supabase.from('live_game_state').select('*').eq('id', matchId).maybeSingle();
    return (data && !error) ? { ok: true, data } : { ok: false };
}

// --- 4-TOOL SPINE ---
async function buildEvidencePacket(context, budget = 2000) {
    const packet = { injuries: { home: [], away: [] }, liveState: null, temporal: { t60: null, t0: null } };
    const promises = [];

    if (context?.home_team_id && context?.away_team_id) {
        promises.push(Promise.all([
            fetchESPNInjuries(context.home_team_id, context.sport),
            fetchESPNInjuries(context.away_team_id, context.sport)
        ]).then(([h, a]) => { packet.injuries.home = h.injuries; packet.injuries.away = a.injuries; }));
    }

    if (context?.match_id) {
        promises.push(fetchLiveState(context.match_id).then(({ ok, data }) => {
            if (ok && data) {
                packet.liveState = { score: { h: data.home_score, a: data.away_score }, clock: data.display_clock, status: data.game_status, odds: data.odds };
                packet.temporal.t60 = data.t60_snapshot;
                packet.temporal.t0 = data.t0_snapshot;
            }
        }));
    }
    await Promise.allSettled(promises);
    return packet;
}

function buildClaimMap(response, thoughts) {
    const text = (response + thoughts).toLowerCase();
    const map = { verdict: null, confidence: 'medium', confluence: { price: false, sentiment: false, structure: false } };

    const vMatch = response.match(/verdict[:\s]+(.+?)(?:\n|$)/i);
    if (vMatch) map.verdict = vMatch[1].trim().toLowerCase().includes('pass') ? 'PASS' : vMatch[1].trim();

    if (text.includes('high confidence')) map.confidence = 'high';
    map.confluence.price = /(market|price|clv|delta)/i.test(text);
    map.confluence.sentiment = /(sentiment|sharp|public|split)/i.test(text);
    map.confluence.structure = /(structural|injury|rotation|rest)/i.test(text);
    return map;
}

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { BettingPickSchema } from '../lib/schemas/picks.js';

// Elite Pick Extraction - Two-Phase Structural Generation
async function extractPickStructured(text, context) {
    if (!context) return [];

    // 1. Construct strict context-aware prompt
    const contextPrompt = `
    GAME CONTEXT:
    Home Team: "${context.home_team}"
    Away Team: "${context.away_team}"
    
    TASK:
    Extract the "Verdict" or final betting recommendation from the analysis below.
    
    STRICT RULES:
    1. "pick_team" MUST be EXACTLY "${context.home_team}" or "${context.away_team}" (or null for Totals).
    2. If the verdict is "PASS", set verdict="PASS".
    3. For Totals (Over/Under), set pick_type="total" and pick_direction="over" or "under".
    4. Ignore "lean" or "slight preference". Only extract explicit "VERDICT" or "BET".
    `;

    try {
        const { object } = await generateObject({
            model: google('gemini-1.5-flash'), // Use Flash for speed/cost efficiency in extraction
            schema: BettingPickSchema,
            prompt: `${contextPrompt}\n\nANALYSIS TEXT:\n${text}`,
            mode: 'json'
        });

        // 2. Application-Level Validation (Defense in Depth) (Self-Correction)
        // Ensure strictly valid pick_team if not a total
        if (object.verdict === 'BET' || object.verdict === 'FADE') {
            if (object.pick_type !== 'total') {
                const tNorm = (object.pick_team || '').toLowerCase().replace(/[^a-z]/g, '');
                const hNorm = (context.home_team || '').toLowerCase().replace(/[^a-z]/g, '');
                const aNorm = (context.away_team || '').toLowerCase().replace(/[^a-z]/g, '');

                // Fuzzy match fallback if exact match failed but AI implies it
                let matchedTeam = null;
                if (tNorm.includes(hNorm) || hNorm.includes(tNorm)) matchedTeam = context.home_team;
                else if (tNorm.includes(aNorm) || aNorm.includes(tNorm)) matchedTeam = context.away_team;

                if (matchedTeam) object.pick_team = matchedTeam; // Auto-correct
                else if (!object.pick_team) {
                    // Critical failure for team bet without team
                    return [];
                }
            }
        }

        return [object]; // Return as array to maintain interface compatibility
    } catch (e) {
        console.error("Structured Extraction Failed:", e);
        return [];
    }
}

async function persistRun(runId, map, gate, context, convoId, modelId) {
    await supabase.from('ai_chat_runs').upsert({
        id: runId, conversation_id: convoId,
        confluence_met: gate.approved, confluence_score: gate.score,
        verdict: map.verdict, confidence: map.confidence, gate_reason: gate.reason,
        match_context: context ? { id: context.match_id, home: context.home_team } : null
    }, { onConflict: 'id' });

    if (gate.approved && map.verdict && map.verdict !== 'PASS') {
        const structuralPicks = await extractPickStructured(map.verdict, context); // Now passing full text really (map.verdict usually contains snippet)

        if (structuralPicks.length > 0) {
            await supabase.from('ai_chat_picks').insert(structuralPicks.map(p => {
                // Adapter: Map 2.0 Schema to DB Columns
                let side = p.pick_team;
                if (p.pick_type === 'total') {
                    side = p.pick_direction ? p.pick_direction.toUpperCase() : 'UNKNOWN';
                }

                return {
                    run_id: runId,
                    conversation_id: convoId,
                    match_id: context?.match_id,
                    home_team: context?.home_team,
                    away_team: context?.away_team,
                    league: context?.league, // If available
                    game_start_time: context?.start_time || context?.game_start_time,

                    pick_type: p.pick_type,
                    pick_side: side,
                    pick_line: p.pick_line,
                    ai_confidence: p.confidence || map.confidence,
                    model_id: modelId,

                    // Audit columns (new)
                    reasoning_summary: p.reasoning_summary,
                    extraction_method: 'structured_v2_gemini'
                };
            }));
        }
    }
}

function gateDecision(map, strict) {
    const score = Object.values(map.confluence).filter(Boolean).length;
    if (map.verdict === 'PASS') return { approved: true, reason: 'INTENTIONAL_PASS', score };
    if (strict && score < 2) return { approved: false, reason: `WEAK_CONFLUENCE (${score}/3)`, score };
    return { approved: true, reason: 'APPROVED', score };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { messages, session_id, conversation_id, gameContext, run_id } = req.body;
        const currentRunId = run_id || crypto.randomUUID();

        const lastMsg = messages[messages.length - 1];
        const userQuery = typeof lastMsg.content === 'string' ? lastMsg.content : '';
        const hasImage = Array.isArray(lastMsg.content) && lastMsg.content.some(c => c.type === 'image');
        const INTENT = detectIntent(userQuery, hasImage);

        // Live Sentinel Logic
        let activeContext = gameContext;
        const liveScan = await scanForLiveGame(userQuery);
        let isLive = false;
        if (liveScan.ok) {
            const d = liveScan.data;
            activeContext = { ...activeContext, ...d, match_id: d.id, clock: d.display_clock, status: d.game_status, current_odds: d.odds };
            isLive = true;
        } else if (isContextStale(activeContext)) {
            // Fallback logic
        }
        isLive = isLive || (activeContext?.status || '').includes('IN_PROGRESS');

        const evidence = await buildEvidencePacket(activeContext);
        if (evidence.liveState) activeContext = { ...activeContext, ...evidence.liveState, current_odds: evidence.liveState.odds };

        const systemInstruction = `
<temporal>TODAY: ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })} | TIME: ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET</temporal>
<context>
MATCH: ${activeContext?.away_team} @ ${activeContext?.home_team}
${isLive ? `LIVE: ${activeContext?.away_score}-${activeContext?.home_score} | ${activeContext?.clock}` : ''}
ODDS: ${safeJsonStringify(activeContext?.current_odds, 600)}
INJURIES: ${safeJsonStringify(evidence.injuries, 800)}
${evidence.temporal.t60 ? `T-60 ODDS: ${safeJsonStringify(evidence.temporal.t60.odds, 400)}` : ''}
</context>
${INTENT === 'STRICT_PICK' ? `
<role>The Obsidian Ledger. Strict. Cynical.</role>
<output_rules>
FORMAT IS NON-NEGOTIABLE:
**Analytical Walkthrough**
1. **Market Dynamics**
2. **Sentiment Signal**
3. **Structural Assessment**
**WHAT TO WATCH LIVE** [Triggers]
**Triple Confluence Evaluation**
**VERDICT:** [Pick] OR [PASS]
**CONFIDENCE:** [High/Med/Low]
**THE RULE:** [Principle]
</output_rules>` : `<role>Field Reporter. Direct, factual.</role>`}
<citations>Cite sources [1].</citations>
`;

        const geminiHistory = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: JSON.stringify(m.content) }] }));
        const result = await genAI.models.generateContentStream({
            model: CONFIG.MODEL_ID, contents: geminiHistory.slice(-8),
            config: { systemInstruction: { parts: [{ text: systemInstruction }] }, thinkingConfig: CONFIG.THINKING_CONFIG, tools: [{ googleSearch: {} }] }
        });

        res.setHeader('Content-Type', 'text/event-stream');
        let fullText = "", rawThoughts = "", sources = [];

        for await (const chunk of result) {
            const p = chunk.candidates?.[0]?.content?.parts?.[0];
            if (p?.text) {
                if (p.thought) { rawThoughts += p.text; res.write(`data: ${JSON.stringify({ type: 'thought', content: p.text })}\n\n`); }
                else { fullText += p.text; res.write(`data: ${JSON.stringify({ type: 'text', content: p.text })}\n\n`); }
            }
            if (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks) {
                sources = [...sources, ...chunk.candidates[0].groundingMetadata.groundingChunks.map(c => ({ title: c.web?.title, uri: c.web?.uri })).filter(s => s.uri)];
            }
        }

        if (INTENT === 'STRICT_PICK') {
            const map = buildClaimMap(fullText, rawThoughts);
            const gate = gateDecision(map, true);
            await persistRun(currentRunId, map, gate, activeContext, conversation_id, CONFIG.MODEL_ID);
        }

        if (conversation_id) {
            // FIXED: Variable name corrected
            const uniqueSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());
            await supabase.from('conversations').update({
                messages: [...messages, { role: 'assistant', content: fullText, thoughts: rawThoughts, sources: uniqueSources, model: CONFIG.MODEL_ID }].slice(-40),
                last_message_at: new Date().toISOString()
            }).eq('id', conversation_id);
        }

        res.write(`data: ${JSON.stringify({ done: true, model: CONFIG.MODEL_ID, sources })}`);
        res.end();

    } catch (e) { res.write(`data: ${JSON.stringify({ type: 'error', content: e.message })}`); res.end(); }
}
