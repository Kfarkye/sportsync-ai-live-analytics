/* ============================================================================
   api/chat.js
   "Obsidian Ledger" — Gemini 3 Production Backend (v17.2)
   
   ENGINE: Gemini 3 Flash Preview (Native Google SDK v1.0+)
   OUTPUT: Exact "Analytical Walkthrough" Report Format
   LOGIC: Triple Confluence Gate (Pass if edge is thin)
============================================================================ */

import { GoogleGenAI } from "@google/genai";
import { createClient } from '@supabase/supabase-js';

// 1. CONFIGURATION
const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CONFIG = {
    MODEL_ID: "gemini-3-flash-preview",
    TIMEOUT_MS: 55000,
    THINKING_CONFIG: {
        includeThoughts: true,
        thinkingLevel: "high"
    },
    RETRY_LADDER: [
        { attempt: 1, maxEvidence: 8, maxChars: 15000, useSearch: true },
        { attempt: 2, maxEvidence: 4, maxChars: 6000, useSearch: true },
        { attempt: 3, maxEvidence: 0, maxChars: 2000, useSearch: false } // Fail-closed PASS
    ]
};

// 2. LOGIC UTILITIES
const getETDate = (offsetDays = 0) => {
    const now = new Date();
    now.setDate(now.getDate() + offsetDays);
    return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
};

const getMarketPhase = (match) => {
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

// 3. PICK EXTRACTION
function extractPicksFromResponse(response, thoughts = "") {
    const picks = [];
    const cleanText = response.replace(/[*_]+/g, '');
    const lowerText = (response + thoughts).toLowerCase();

    if (lowerText.includes('verdict: pass') || lowerText.includes('verdict: **pass**')) return [];

    let confidence = 'medium';
    if (lowerText.includes('high confidence')) confidence = 'high';
    if (lowerText.includes('low confidence')) confidence = 'low';

    const verdictSpreadRegex = /verdict[:\s]+([A-Za-z0-9\s]+?)\s*([-+]\d+\.?\d*)/gi;
    let match;
    while ((match = verdictSpreadRegex.exec(cleanText)) !== null) {
        const team = match[1].trim();
        if (!team.toLowerCase().includes('over') && !team.toLowerCase().includes('under')) {
            picks.push({ type: 'spread', side: team, line: parseFloat(match[2]), confidence });
        }
    }

    const verdictTotalRegex = /verdict[:\s]+(over|under)\s*(\d+\.?\d*)/gi;
    while ((match = verdictTotalRegex.exec(cleanText)) !== null) {
        picks.push({ type: 'total', side: match[1].toUpperCase(), line: parseFloat(match[2]), confidence });
    }

    const verdictMLRegex = /verdict[:\s]+([A-Za-z0-9\s]+?)\s*(?:ML|moneyline)/gi;
    while ((match = verdictMLRegex.exec(cleanText)) !== null) {
        picks.push({ type: 'moneyline', side: match[1].trim(), line: null, confidence });
    }

    return picks;
}

// 4. MAIN HANDLER
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { messages, session_id, conversation_id: inputConversationId, gameContext, run_id } = req.body;

        // Reliability Guard: Ensure run_id exists
        const currentRunId = run_id || crypto.randomUUID();

        // Auto-create conversation if not provided
        let activeConversationId = inputConversationId;
        if (!activeConversationId && session_id) {
            try {
                const { data: newConv, error: convError } = await supabase
                    .from('conversations')
                    .insert({
                        session_id,
                        messages: [],
                        created_at: new Date().toISOString(),
                        last_message_at: new Date().toISOString()
                    })
                    .select('id')
                    .single();

                if (!convError && newConv) {
                    activeConversationId = newConv.id;
                    console.log(`[run] 🆕 Created conversation: ${activeConversationId}`);
                }
            } catch (e) {
                console.error('[run] Failed to create conversation:', e);
            }
        }

        // Idempotency Skeleton (to be expanded in 2B)
        console.log(`[run] 🆔 ${currentRunId} | Session: ${session_id} | Conv: ${activeConversationId}`);

        const matchId = gameContext?.match_id || gameContext?.id;

        // Retry Ladder Logic
        const attemptNumber = parseInt(req.headers['x-retry-attempt'] || '1');
        const retryStrategy = CONFIG.RETRY_LADDER.find(r => r.attempt === attemptNumber) || CONFIG.RETRY_LADDER[0];
        console.log(`[run] 🪜 Attempt ${attemptNumber} | Budget: ${retryStrategy.maxChars} chars`);

        const marketPhase = getMarketPhase(gameContext || {});
        const isLive = marketPhase.includes('LIVE');
        const estTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

        let systemInstruction = `
<temporal_anchor>
TODAY: ${getETDate()} | TIME: ${estTime} ET
PHASE: ${marketPhase}
</temporal_anchor>

<context>
MATCH: ${gameContext?.away_team || 'Unknown'} @ ${gameContext?.home_team || 'Unknown'}`;

        if (isLive && gameContext?.home_score !== undefined) {
            systemInstruction += `\nLIVE SCORE: ${gameContext.away_score} - ${gameContext.home_score} | ${gameContext.clock || 'Active'}`;
        }

        if (gameContext?.current_odds) {
            systemInstruction += `\nODDS: ${JSON.stringify(gameContext.current_odds)}`;
        }

        systemInstruction += `
</context>

<role>
You are "The Obsidian Ledger," an elite sports analytics engine powered by **Gemini 3**.
You do not predict the game. You predict where the *Line* is wrong using the "Triple Confluence" framework.
</role>

<methodology>
**THE DECISION GATE:**
Your Default State is **PASS**.
To recommend a play, you must prove a **TRIPLE CONFLUENCE**:
1. 💰 **Price Error:** Model Delta > Market Line.
2. 📉 **Sentiment Signal:** Weaponized search confirms Sharp/Public split.
3. 🏗️ **Structural Support:** Fatigue, Injuries, or Tactical mismatch supports the angle.
**IF ANY CONDITION FAILS -> VERDICT: PASS.**
</methodology>

<output_rules>
You must output your analysis in this **EXACT** structure:

**Analytical Walkthrough**
1. **Market Dynamics & Price Verification**
   [Analyze the implied probability vs. reality. Mention the delta.]
2. **Sentiment Signal (Weaponized Search)**
   [Public Perception vs. Sharp Lean. Reverse Line Movement analysis.]
3. **Structural Assessment (Game Physics)**
   [Fatigue, Injuries, "Road Paradox", or Tactical Mismatch.]

**Triple Confluence Evaluation**
[Summarize: Do we have all 3 pillars (Price, Sentiment, Structure)? If not, why?]

**Final Determination**
[Synthesize the risk profile.]

**VERDICT:** [The Play] OR [PASS]
**CONFIDENCE:** [High/Medium/Low] OR [N/A]
**THE RULE:** [One-sentence generalized betting principle derived from this spot.]
</output_rules>
`;

        const geminiHistory = messages.map((m) => {
            const role = m.role === 'assistant' ? 'model' : 'user';
            if (Array.isArray(m.content)) {
                const parts = m.content.map((c) => {
                    if (c.type === 'image' && c.source?.data) return { inlineData: { mimeType: c.source.media_type, data: c.source.data } };
                    if (c.type === 'file' && c.source?.data) return { inlineData: { mimeType: c.source.media_type, data: c.source.data } };
                    return { text: c.text || '' };
                });
                return { role, parts };
            }
            return { role, parts: [{ text: String(m.content) }] };
        });

        const tools = retryStrategy.useSearch ? [{ googleSearch: {} }] : [];

        const result = await genAI.models.generateContentStream({
            model: CONFIG.MODEL_ID,
            contents: geminiHistory.slice(-retryStrategy.maxEvidence), // Prune history for retry
            config: {
                systemInstruction: { parts: [{ text: systemInstruction.slice(0, retryStrategy.maxChars) }] }, // Cap instruction
                thinkingConfig: CONFIG.THINKING_CONFIG,
                tools
            }
        });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let fullText = "";
        let rawThoughts = "";
        let sources = [];

        for await (const chunk of result) {
            const parts = chunk.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
                if (part.text) {
                    if (part.thought) {
                        rawThoughts += part.text;
                        res.write(`data: ${JSON.stringify({ type: 'thought', content: part.text })}\n\n`);
                    } else {
                        fullText += part.text;
                        res.write(`data: ${JSON.stringify({ type: 'text', content: part.text })}\n\n`);
                    }
                }
            }
            if (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks) {
                const newSources = chunk.candidates[0].groundingMetadata.groundingChunks
                    .map((c) => ({ title: c.web?.title || 'Source', uri: c.web?.uri }))
                    .filter((s) => s.uri);
                sources = [...sources, ...newSources];
            }
        }

        // Extract and save picks
        const picks = extractPicksFromResponse(fullText, rawThoughts);
        console.log(`[pick-extraction] Found ${picks.length} picks, matchId=${matchId || 'null'}`);

        if (picks.length > 0) {
            try {
                const { error: pickError } = await supabase.from('ai_chat_picks').insert(picks.map(p => ({
                    match_id: matchId || null,
                    pick_type: p.type,
                    pick_side: p.side,
                    pick_line: p.line,
                    ai_confidence: p.confidence,
                    reasoning_summary: fullText.slice(0, 500),
                    session_id,
                    conversation_id: activeConversationId,
                    model_id: CONFIG.MODEL_ID,
                    run_id: currentRunId
                })));
                if (pickError) console.error('[pick-extraction] DB Error:', pickError);
                else console.log(`[pick-extraction] ✅ Saved ${picks.length} picks with run_id=${currentRunId}`);
            } catch (e) { console.error("[pick-extraction] Exception:", e); }
        }

        // Idempotent Run Tracking: Mark run as completed
        console.log(`[run-tracking] conversation_id=${activeConversationId}, run_id=${currentRunId}, attempt=${attemptNumber}`);
        if (activeConversationId) {
            try {
                const { error: runError } = await supabase.from('ai_chat_runs').upsert({
                    conversation_id: activeConversationId,
                    run_id: currentRunId,
                    status: 'completed',
                    attempt_number: attemptNumber,
                    metadata: { model: CONFIG.MODEL_ID, sources_count: sources.length }
                }, { onConflict: 'conversation_id,run_id' });
                if (runError) console.error("[run-tracking] Upsert Error:", runError);
                else console.log("[run-tracking] ✅ Run logged successfully");
            } catch (e) { console.error("DB Run Tracking Error", e); }
        } else {
            console.warn("[run-tracking] ⚠️ Skipped - no conversation_id");
        }

        if (activeConversationId) {
            const uniqueSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());
            try {
                await supabase.from('conversations').update({
                    messages: [...messages, { role: 'assistant', content: fullText, thoughts: rawThoughts, sources: uniqueSources, model: CONFIG.MODEL_ID }].slice(-40),
                    last_message_at: new Date().toISOString()
                }).eq('id', activeConversationId);
            } catch (e) { console.error("DB Conv Error", e); }
        }

        res.write(`data: ${JSON.stringify({ done: true, model: CONFIG.MODEL_ID, sources, conversation_id: activeConversationId })}\n\n`);
        res.end();

    } catch (error) {
        console.error("[Gemini 3 Error]", error);
        res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
        res.end();
    }
}
