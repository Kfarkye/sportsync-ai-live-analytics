/* ============================================================================
   api/chat.ts
   "Obsidian Ledger" — Gemini 3 Production Backend (v17.0)

   ENGINE: Gemini 3 Flash Preview (Native Google SDK)
   FEATURES:
   ├─ THINKING: Enabled (High Level) via 'thinkingConfig'
   ├─ STREAMING: Separates 'thought' (Internal Monologue) from 'text' (Verdict)
   ├─ LOGIC: Full Deno Logic Ported (Phase Detection, Pick Extraction, DB)
   └─ MULTIMODAL: Handles Images/Screenshots via inlineData
============================================================================ */

const { GoogleGenAI } = require("@google/genai");
const { createClient } = require('@supabase/supabase-js');

// 1. CONFIGURATION
// Initialize Native Gemini Client
const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CONFIG = {
    MODEL_ID: "gemini-3-flash-preview",
    TIMEOUT_MS: 55000,
    THINKING_CONFIG: {
        includeThoughts: true,
        thinkingLevel: "high" as const // Force maximum reasoning depth
    }
};

// 2. LOGIC UTILITIES (Ported from your Deno code)
const getETDate = (offsetDays = 0): string => {
    const now = new Date();
    now.setDate(now.getDate() + offsetDays);
    return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
};

const getMarketPhase = (match: any): string => {
    if (!match) return "UNKNOWN";
    const status = (match.status || match.game_status || "").toUpperCase();

    if (status.includes("IN_PROGRESS") || status.includes("LIVE") || status.includes("HALFTIME")) {
        return `🔴 LIVE_IN_PLAY [${match.clock || "Active"}]`;
    }
    if (status.includes("FINAL") || status.includes("FINISHED")) return "🏁 FINAL_SCORE";

    if (match.start_time) {
        const diff = (new Date(match.start_time).getTime() - Date.now()) / 36e5;
        if (diff < 0 && diff > -4) return "🔴 LIVE_IN_PLAY (Calculated)";
        if (diff <= -4) return "🏁 FINAL_SCORE";
        if (diff < 1) return "⚡ CLOSING_LINE (Volatile)";
        if (diff < 24) return "🌊 DAY_OF_GAME";
    }
    return "🔭 OPENING_MARKET";
};

// 3. PICK EXTRACTION (Robust Regex Suite)
function extractPicksFromResponse(response: string, thoughts: string = ""): any[] {
    const picks: any[] = [];
    const cleanText = response.replace(/[*_]+/g, '');
    const lowerText = (response + thoughts).toLowerCase();

    // Hard Gate: If "PASS", return empty
    if (lowerText.includes('verdict: pass') || lowerText.includes('verdict: **pass**')) return [];

    let confidence = 'medium';
    if (lowerText.includes('high confidence')) confidence = 'high';
    if (lowerText.includes('low confidence')) confidence = 'low';

    // Regex 1: Spread ("Lakers -4.5")
    const verdictSpreadRegex = /verdict[:\s]+([A-Za-z0-9\s]+?)\s*([-+]\d+\.?\d*)/gi;
    let match;
    while ((match = verdictSpreadRegex.exec(cleanText)) !== null) {
        const team = match[1].trim();
        // Filter out totals misidentified as teams
        if (!team.toLowerCase().includes('over') && !team.toLowerCase().includes('under')) {
            picks.push({ type: 'spread', side: team, line: parseFloat(match[2]), confidence });
        }
    }

    // Regex 2: Total ("Over 220.5")
    const verdictTotalRegex = /verdict[:\s]+(over|under)\s*(\d+\.?\d*)/gi;
    while ((match = verdictTotalRegex.exec(cleanText)) !== null) {
        picks.push({ type: 'total', side: match[1].toUpperCase(), line: parseFloat(match[2]), confidence });
    }

    // Regex 3: Moneyline ("Lakers ML")
    const verdictMLRegex = /verdict[:\s]+([A-Za-z0-9\s]+?)\s*(?:ML|moneyline)/gi;
    while ((match = verdictMLRegex.exec(cleanText)) !== null) {
        picks.push({ type: 'moneyline', side: match[1].trim(), line: null, confidence });
    }

    return picks;
}

// 4. MAIN HANDLER
module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { messages, session_id, conversation_id, gameContext } = req.body;
        const matchId = gameContext?.match_id || gameContext?.id;

        // --- CONTEXT BUILDER ---
        const marketPhase = getMarketPhase(gameContext);
        const isLive = marketPhase.includes('LIVE');
        const estTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

        const systemInstruction = `
<temporal_anchor>
TODAY: ${getETDate()} | TIME: ${estTime} ET
PHASE: ${marketPhase}
</temporal_anchor>

<context>
MATCH: ${gameContext?.away_team} @ ${gameContext?.home_team}
${isLive && gameContext?.home_score ? `LIVE SCORE: ${gameContext.away_score} - ${gameContext.home_score} | ${gameContext.clock}` : ''}
${gameContext?.current_odds ? `ODDS: ${JSON.stringify(gameContext.current_odds)}` : ''}
</context>

<role>
You are "The Obsidian Ledger," an elite sports analytics engine powered by **Gemini 3**.
You utilize your "Thinking Process" to simulate the game physics before rendering a verdict.
</role>

<output_rules>
FORMAT IS NON-NEGOTIABLE:
1. **VERDICT:** [Team/Total] [Line] (e.g. "Lakers -4.5" or "Over 210.5") or [PASS].
2. **EVIDENCE:**
   - **Context:** Narrative/Trap.
   - **Fundamentals:** Physics/Stats.
   - **Flow:** Market/Splits.
3. **CONFIDENCE:** [High/Medium/Low].
</output_rules>
`;

        // --- MULTIMODAL HISTORY MAPPER ---
        // Converts frontend message format to Google SDK format (handling images/files)
        const geminiHistory = messages.map((m: any) => {
            const role = m.role === 'assistant' ? 'model' : 'user';

            // Handle array content (Text + Images)
            if (Array.isArray(m.content)) {
                const parts = m.content.map((c: any) => {
                    // Map Base64 Images to inlineData
                    if (c.type === 'image' && c.source?.data) {
                        return { inlineData: { mimeType: c.source.media_type, data: c.source.data } };
                    }
                    if (c.type === 'file' && c.source?.data) {
                        return { inlineData: { mimeType: c.source.media_type, data: c.source.data } };
                    }
                    return { text: c.text || '' };
                });
                return { role, parts };
            }

            // Handle simple string content
            return { role, parts: [{ text: String(m.content) }] };
        });

        // --- GEMINI 3 EXECUTION (Native SDK) ---
        const result = await genAI.models.generateContentStream({
            model: CONFIG.MODEL_ID,
            contents: geminiHistory,
            config: {
                systemInstruction: { parts: [{ text: systemInstruction }] },
                thinkingConfig: CONFIG.THINKING_CONFIG, // <--- NATIVE THINKING ENABLED
                tools: [{ googleSearch: {} }] // Native Grounding
            }
        });

        // Setup SSE Stream
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let fullText = "";
        let rawThoughts = "";
        let sources: any[] = [];

        // --- STREAM LOOP ---
        for await (const chunk of result) {
            const parts = chunk.candidates?.[0]?.content?.parts || [];

            for (const part of parts) {
                if (part.text) {
                    if (part.thought) {
                        // 🧠 THOUGHT STREAM (Purple Text for Dynamic Island)
                        rawThoughts += part.text;
                        res.write(`data: ${JSON.stringify({ type: 'thought', content: part.text })}\n\n`);
                    } else {
                        // 📝 VERDICT STREAM (White Text for Chat)
                        fullText += part.text;
                        res.write(`data: ${JSON.stringify({ type: 'text', content: part.text })}\n\n`);
                    }
                }
            }

            // Capture Grounding (Citations)
            if (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks) {
                const newSources = chunk.candidates[0].groundingMetadata.groundingChunks
                    .map((c: any) => ({
                        title: c.web?.title || 'Source',
                        uri: c.web?.uri
                    }))
                    .filter((s: any) => s.uri);
                sources = [...sources, ...newSources];
            }
        }

        // --- PERSISTENCE (Restored Deno Logic) ---

        // 1. Save Picks
        if (matchId) {
            const picks = extractPicksFromResponse(fullText, rawThoughts);
            if (picks.length > 0) {
                await supabase.from('ai_chat_picks').insert(picks.map(p => ({
                    match_id: matchId,
                    pick_type: p.type,
                    pick_side: p.side,
                    pick_line: p.line,
                    ai_confidence: p.confidence,
                    reasoning_summary: fullText.slice(0, 500),
                    session_id,
                    conversation_id,
                    model_id: CONFIG.MODEL_ID
                })));
            }
        }

        // 2. Save Conversation (Including Thoughts)
        if (conversation_id) {
            const uniqueSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());
            await supabase.from('conversations').update({
                messages: [
                    ...messages,
                    {
                        role: 'assistant',
                        content: fullText,
                        thoughts: rawThoughts, // Saved to DB for audit
                        sources: uniqueSources,
                        model: CONFIG.MODEL_ID
                    }
                ].slice(-40),
                last_message_at: new Date().toISOString()
            }).eq('id', conversation_id);
        }

        // Finalize
        res.write(`data: ${JSON.stringify({
            done: true,
            model: CONFIG.MODEL_ID,
            sources
        })}\n\n`);

        res.end();

    } catch (error: any) {
        console.error("[Gemini 3 Error]", error);
        res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
        res.end();
    }
}
