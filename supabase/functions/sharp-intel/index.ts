// sharp-intel/index.ts
// The "Sharp Engine" - Triple Confluence Gate
// Runs parallel to existing pregame-intel (the fade engine)

declare const Deno: any;

import { createClient } from "@supabase/supabase-js";
import { executeStreamingAnalyticalQuery, executeAnalyticalQuery, executeEmbeddingQuery, safeJsonParse } from "../_shared/gemini.ts";

const CONFIG = {
    TIMEOUT_MS: 45000,
    MODELS: {
        PRIMARY: "gemini-3-flash-preview",
        FALLBACK: "gemini-3-flash-preview"
    }
};

// 🔒 SECURITY: Gate thought streaming to prevent leaking the "Logic Waterfall"
const STREAM_THOUGHTS = (Deno.env.get("STREAM_THOUGHTS") ?? "").toLowerCase() === "true";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-client-timeout, x-trace-id, baggage, sentry-trace, priority",
    "Access-Control-Max-Age": "86400",
};

// ═══════════════════════════════════════════════════════════════════════════
// 🧮 SHARP MATH UTILS: The Anchor
// ═══════════════════════════════════════════════════════════════════════════
const calculateImpliedProb = (odds: number | string | null | undefined): string => {
    if (!odds) return "N/A";
    const num = Number(odds);
    if (isNaN(num)) return "N/A";

    let prob = 0;
    if (num < 0) {
        prob = Math.abs(num) / (Math.abs(num) + 100);
    } else {
        prob = 100 / (num + 100);
    }
    return (prob * 100).toFixed(1) + "%";
};

// ═══════════════════════════════════════════════════════════════════════════
// 🧠 MARKET PHASE: Context Awareness
// ═══════════════════════════════════════════════════════════════════════════
const getMarketPhase = (match: any): string => {
    if (!match) return "UNKNOWN - VERIFY EXTERNAL";
    const status = (match.status || match.game_status || "").toUpperCase();

    if (status.includes("IN_PROGRESS") || status.includes("LIVE") || status.includes("HALFTIME")) {
        return `🔴 LIVE_IN_PLAY [${match.clock || "Active"}]`;
    }
    if (status.includes("FINAL") || status.includes("FINISHED")) return "🏁 FINAL_SCORE";

    if (match.start_time) {
        const start = new Date(match.start_time).getTime();
        const now = Date.now();
        const diffHours = (start - now) / 36e5;

        if (diffHours < 0 && diffHours > -4) return "🔴 LIVE_IN_PLAY (Calculated)";
        if (diffHours < 1) return "⚡ CLOSING_LINE (Maximum Efficiency)";
        if (diffHours < 24) return "🌊 DAY_OF_GAME (Public Liquidity Influx)";
        return "🔭 OPENING_MARKET (Price Discovery)";
    }
    return "💤 OFFSEASON";
};

// ═══════════════════════════════════════════════════════════════════════════
// 🛡️ DATA EXTRACTION UTILS
// ═══════════════════════════════════════════════════════════════════════════
const extractUserParts = (msg: any): any[] => {
    if (!msg) return [{ text: " " }];
    if (Array.isArray(msg.parts)) return msg.parts;
    if (typeof msg.content === 'string') return [{ text: msg.content }];
    return [{ text: String(msg) }];
};

const logger = {
    info: (msg: string, data?: any) => console.log(JSON.stringify({ level: 'INFO', msg, ...data, timestamp: new Date().toISOString() })),
    error: (msg: string, data?: any) => console.error(JSON.stringify({ level: 'ERROR', msg, ...data, timestamp: new Date().toISOString() })),
};

const getETDate = (offsetDays = 0): string => {
    const now = new Date();
    now.setDate(now.getDate() + offsetDays);
    return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
};

// ═══════════════════════════════════════════════════════════════════════════
// 🧠 PICK EXTRACTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════
interface ExtractedPick {
    pick_type: string;
    pick_side: string;
    pick_line: number | null;
    pick_odds: number | null;
    ai_confidence: string;
    reasoning_summary: string;
}

function extractPicksFromResponse(response: string, thoughts: string): ExtractedPick[] {
    const picks: ExtractedPick[] = [];
    const combinedText = `${response}\n${thoughts}`.toLowerCase();

    // ⛔ HARD GATE: If verdict is PASS, do not extract any picks.
    if (combinedText.includes('verdict: pass') || combinedText.includes('verdict: **pass**')) {
        return [];
    }

    const pickIndicators = [
        'i recommend', 'my pick', 'take the', 'bet on', 'lean towards', 'strong edge',
        'play:', 'pick:', 'recommendation:', 'best bet', 'value on',
        'dislocation on', 'ev+', 'fair price shows', 'variance favors',
        'structural edge', 'market mismatch', 'verdict:'
    ];

    const hasPick = pickIndicators.some(indicator => combinedText.includes(indicator));
    if (!hasPick) return picks;

    let confidence = 'medium';
    if (combinedText.includes('high confidence') || combinedText.includes('strong conviction') || combinedText.includes('structural edge')) {
        confidence = 'high';
    } else if (combinedText.includes('low confidence') || combinedText.includes('marginal lean')) {
        confidence = 'low';
    }

    // Clean Markdown (* and _) for cleaner matching
    const cleanResponse = response.replace(/[\*_]/g, '');

    // 1. Totals Picks (Higher Priority)
    const totalPattern = /(?:take|bet|recommend|pick|play|verdict|recommendation|forecast)[:\s]*(?:the\s+)?(?:\s*[\w\/\-]+\s+){0,3}(over|under)\s*(\d+\.?\d*)/gi;
    let match;
    while ((match = totalPattern.exec(cleanResponse)) !== null) {
        const side = match[1].toUpperCase();
        const line = parseFloat(match[2]);
        if (line > 2.0 && line < 400) {
            picks.push({
                pick_type: 'total', pick_side: side, pick_line: line, pick_odds: -110,
                ai_confidence: confidence, reasoning_summary: extractReasoning(response, thoughts)
            });
        }
    }

    // 2. Spread Picks
    const spreadPattern = /(?:take|bet|recommend|pick|play|verdict|recommendation|forecast)[:\s]*(?:the\s+)?(?!(?:over|under))([\w\s\/\.]{2,25}?)\s*([-+]\d+\.?\d*)/gi;
    while ((match = spreadPattern.exec(cleanResponse)) !== null) {
        const team = match[1].trim();
        const line = parseFloat(match[2]);
        if (!/over|under|pass|verdict|evidence|narrative|reality|market/i.test(team) && team.length > 2) {
            picks.push({
                pick_type: 'spread', pick_side: team, pick_line: line, pick_odds: -110,
                ai_confidence: confidence, reasoning_summary: extractReasoning(response, thoughts)
            });
        }
    }

    // 3. Moneyline Picks
    const mlPattern = /(?:take|bet|recommend|pick|play|verdict|recommendation|forecast)[:\s]*(?:the\s+)?([\w\s\/\.]{2,25}?)\s*(?:ML|moneyline)/gi;
    while ((match = mlPattern.exec(cleanResponse)) !== null) {
        const team = match[1].trim();
        if (!/over|under|pass|verdict|evidence|narrative|reality|market/i.test(team) && team.length > 2) {
            picks.push({
                pick_type: 'moneyline', pick_side: team, pick_line: null, pick_odds: null,
                ai_confidence: confidence, reasoning_summary: extractReasoning(response, thoughts)
            });
        }
    }

    return picks;
}

function extractReasoning(response: string, thoughts: string): string {
    const evidenceMatch = response.match(/\*\*EVIDENCE:\*\*\s*([\s\S]*?)(?=\*\*CONFIDENCE)/);
    if (evidenceMatch) {
        return evidenceMatch[1].replace(/\n/g, ' ').replace(/-/g, '').substring(0, 250).trim();
    }

    const reasoningPatterns = [
        /structural\s+edge\s*:?\s*([^.]+\.)/i,
        /public\s+bias\s*:?\s*([^.]+\.)/i,
        /dislocation\s*:?\s*([^.]+\.)/i,
        /market\s+pricing\s*:?\s*([^.]+\.)/i,
        /the\s+rule\s*:?\s*([^.]+\.)/i
    ];

    for (const pattern of reasoningPatterns) {
        const match = (thoughts || response).match(pattern);
        if (match) return match[1].substring(0, 200);
    }
    const sentences = response.split(/[.!?]/).filter(s => s.length > 30);
    return sentences[0]?.substring(0, 200) || 'Structural market analysis';
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 MAIN SERVER LOGIC
// ═══════════════════════════════════════════════════════════════════════════
Deno.serve(async (req: Request) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    try {
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        const body = await req.json();
        const { messages, session_id, current_match, conversation_id, live_snapshot } = body;

        if (!messages?.length) return new Response(JSON.stringify({ content: "Link idle." }), { headers: CORS_HEADERS });

        const matchId = current_match?.match_id;
        const lastUserMessage = messages[messages.length - 1];
        const lastUserParts = extractUserParts(lastUserMessage);
        const lastUserText = lastUserParts.find(p => p.text)?.text || "";

        // 1. Context Hydration
        const [identityRes, liveStateRes, teamContextRes, tempoRes] = await Promise.allSettled([
            (async () => {
                let activeId = conversation_id;
                let history = [];
                if (session_id && !activeId) {
                    const { data } = await supabase.rpc('get_or_create_conversation', { p_session_id: session_id, p_match_id: matchId || null });
                    if (data) activeId = data;
                }
                if (activeId) {
                    const { data } = await supabase.from('conversations').select('messages').eq('id', activeId).single();
                    if (data) history = data.messages || [];
                }
                return { activeId, history };
            })(),
            (async () => {
                if (!matchId) return null;
                try {
                    const [state, match] = await Promise.all([
                        supabase.from('live_game_state').select('*').eq('id', matchId).maybeSingle(),
                        supabase.from('matches').select('home_score, away_score, display_clock, status, current_odds').eq('id', matchId).maybeSingle()
                    ]);
                    return { state: state.data, match: match.data };
                } catch { return null; }
            })(),
            (async () => {
                if (!current_match?.home_team) return null;
                const today = getETDate();
                try {
                    const [homeCtx, awayCtx] = await Promise.all([
                        supabase.from('team_game_context').select('*').eq('team', current_match.home_team).eq('game_date', today).maybeSingle(),
                        supabase.from('team_game_context').select('*').eq('team', current_match.away_team).eq('game_date', today).maybeSingle()
                    ]);
                    return { home: homeCtx.data, away: awayCtx.data };
                } catch { return null; }
            })(),
            (async () => {
                if (!current_match?.home_team) return null;
                try {
                    const teams = [current_match.home_team, current_match.away_team].filter(Boolean);
                    const { data } = await supabase.from('team_tempo').select('*').in('team', teams);
                    return data || [];
                } catch { return []; }
            })()
        ]);

        const { activeId, history: storedHistory } = identityRes.status === 'fulfilled' ? identityRes.value : { activeId: null, history: [] };
        const telemetry = liveStateRes.status === 'fulfilled' ? liveStateRes.value : null;
        const teamContextData = teamContextRes.status === 'fulfilled' ? teamContextRes.value : null;
        const tempoData = tempoRes.status === 'fulfilled' ? tempoRes.value : [];

        // 2. Data Block Assembly
        const now = new Date();
        const estTime = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
        const marketPhase = getMarketPhase(current_match);

        const useLiveSnapshot = live_snapshot && (Date.now() - live_snapshot.timestamp) / 1000 < 30;

        const telemetryBlock = useLiveSnapshot ? `
      LIVE DATA [CLIENT STREAM]:
      Scores: ${current_match?.away_team} ${live_snapshot.away_score} - ${current_match?.home_team} ${live_snapshot.home_score}
      Clock: ${live_snapshot.clock} | Period: ${live_snapshot.period}
      Lines: Spread ${live_snapshot.spread} | Total ${live_snapshot.total}
    ` : `
      LIVE DATA [DB SNAPSHOT]:
      Scores: ${telemetry?.match?.away_score || 0} - ${telemetry?.match?.home_score || 0}
      Clock: ${telemetry?.match?.display_clock || 'Pregame'}
    `;

        const oddsBlock = telemetry?.state?.odds ? `
      MARKET ODDS (The Efficient Frontier):
      Spread: ${telemetry.state.odds.current?.homeSpread || 'OFF'}
      Total: ${telemetry.state.odds.current?.total || 'OFF'}
      
      IMPLIED PROBABILITIES (Vegas Confidence):
      Home (${telemetry.state.odds.current?.homeWin}): ${calculateImpliedProb(telemetry.state.odds.current?.homeWin)}
      Away (${telemetry.state.odds.current?.awayWin}): ${calculateImpliedProb(telemetry.state.odds.current?.awayWin)}
    ` : 'ODDS: N/A';

        const analyticsBlock = `
      GAME PHYSICS (Structural Reality):
      Pace: ${telemetry?.state?.deterministic_signals?.ppm?.observed?.toFixed(2) || 0} (Proj: ${telemetry?.state?.deterministic_signals?.ppm?.projected?.toFixed(2) || 0})
      Home ORTG: ${tempoData?.find((t: any) => t.team === current_match?.home_team)?.ortg || 0} | Away ORTG: ${tempoData?.find((t: any) => t.team === current_match?.away_team)?.ortg || 0}
      Home ATS L10: ${tempoData?.find((t: any) => t.team === current_match?.home_team)?.ats_l10 || 'N/A'}
    `;

        const injuryBlock = `
      ROSTER CONTEXT (Known Factors):
      Home: ${teamContextData?.home?.injury_notes || 'Clean Report'}
      Away: ${teamContextData?.away?.injury_notes || 'Clean Report'}
    `;

        // 🏆 THE "TRIPLE CONFLUENCE GATE" SYSTEM PROMPT
        const systemInstruction = `
<role>
You are "The Edge" - a Market Structuralist & Risk Manager.
You do not predict the game. You predict where the *Line* is wrong.
You adhere to the **Efficient Market Hypothesis**.
Your Default State is **PASS**. You only recommend a play if a "Triple Confluence" is met.
</role>

<decision_gate>
⛔ **HARD GATE:**
Your DEFAULT output must be **VERDICT: PASS**.
To override this and recommend a play, you MUST prove a **TRIPLE CONFLUENCE**:

1.  💰 **Price Error:** Implied Probability vs Model Reality has a distinct delta (e.g., Market implies 60%, Model sees 52%).
2.  📉 **Sentiment Signal:** WEAPONIZED SEARCH must find >70% Public on the *Losing* side OR Sharp Money on the *Winning* side.
3.  🏗️ **Structural Support:** Game Physics (Pace, Defense, Possession) must support the contrarian view.

**IF ANY CONDITION IS MISSING -> VERDICT: PASS.**
Do not force a bet. Real sharps pass on 90% of games.
</decision_gate>

<search_doctrine>
🔥 **WEAPONIZED SEARCH:**
Search for:
1. "Public betting splits [Matchup]" (Identify the Square side).
2. "Reverse line movement [Matchup]" (Identify the Sharp side).
3. "Referee assignment [Matchup] tendencies".
</search_doctrine>

<output_rules>
**FORMAT IS NON-NEGOTIABLE:**

**VERDICT:** [The Play] OR [PASS] (e.g., Structural Under 3.5)
**EVIDENCE:**
- **The Narrative:** [What the squares believe].
- **The Structural Reality:** [Why physics/math contradicts the narrative].
- **The Market Read:** [Splits/Movement].
**CONFIDENCE:** [High/Medium/Low] (High only if Triple Confluence is met).
**GAPS:** [Missing intel].
**THE RULE:** [The generalized principle, e.g., "Fade public overs on slow-paced teams"].
</output_rules>

<context>
MARKET_PHASE: ${marketPhase}
TIME: ${estTime} ET
${telemetryBlock}
${oddsBlock}
${analyticsBlock}
${injuryBlock}
</context>

<task>
Analyze ${current_match?.away_team} @ ${current_match?.home_team}.
Apply the **Triple Confluence Gate**. If the edge isn't structural, PASS.
</task>
    `;

        const chatHistory = messages.slice(0, -1).map((m: any) => ({
            role: m.role === 'model' ? 'model' : 'user',
            parts: extractUserParts(m)
        }));

        // 3. Streaming Response
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                let fullReply = "";
                let fullThoughts = "";
                let groundingUrls: any[] = [];

                try {
                    const streamGen = executeStreamingAnalyticalQuery(lastUserParts, {
                        model: CONFIG.MODELS.PRIMARY,
                        systemInstruction,
                        tools: [{ googleSearch: {} }],
                        history: chatHistory,
                        thinkingLevel: "high"
                    });

                    for await (const chunk of streamGen) {
                        const chunkType = (chunk as any).type;
                        const chunkContent = (chunk as any).content;

                        if (chunkType === 'thought' && chunkContent) {
                            fullThoughts += chunkContent;
                            if (STREAM_THOUGHTS) {
                                controller.enqueue(encoder.encode(JSON.stringify({ type: 'thoughts', content: chunkContent }) + "\n"));
                            }
                            continue;
                        }

                        if (chunkType === 'text' && chunkContent) {
                            fullReply += chunkContent;
                            controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', content: chunkContent }) + "\n"));
                            continue;
                        }

                        if (chunkType === 'grounding' && (chunk as any).metadata?.groundingChunks) {
                            const refs = (chunk as any).metadata.groundingChunks
                                .map((c: any) => ({ title: c.web?.title || 'Source', uri: c.web?.uri }))
                                .filter((c: any) => c.uri);
                            groundingUrls = [...groundingUrls, ...refs];
                            continue;
                        }
                    }

                    const uniqueSources = Array.from(new Map(groundingUrls.map(u => [u.uri, u])).values());

                    // ───────────────────────────────────────────────────────────────
                    // 4. NON-BLOCKING PERSISTENCE (Vercel Production Quality)
                    // ───────────────────────────────────────────────────────────────
                    const persistencePromises = [];

                    // Task A: History
                    if (activeId) {
                        const updatePayload = [...storedHistory];
                        updatePayload.push({ role: 'user', content: lastUserText, timestamp: new Date().toISOString() });
                        updatePayload.push({
                            role: 'model',
                            content: fullReply,
                            thoughts: fullThoughts,
                            sources: uniqueSources,
                            metadata: { requestId, latencyTotal: Date.now() - startTime },
                            timestamp: new Date().toISOString()
                        });

                        persistencePromises.push(
                            supabase.from('conversations').update({
                                messages: updatePayload.slice(-40),
                                last_message_at: new Date().toISOString()
                            }).eq('id', activeId)
                                .then(({ error }: any) => { if (error) console.error("HISTORY_SAVE_FAIL", error); })
                        );
                    }

                    // Task B: Picks
                    if (matchId && current_match) {
                        persistencePromises.push((async () => {
                            try {
                                const picks = extractPicksFromResponse(fullReply, fullThoughts);
                                if (picks.length) {
                                    const home_team = current_match.home_team || current_match.homeTeam || 'Unknown';
                                    const away_team = current_match.away_team || current_match.awayTeam || 'Unknown';
                                    const league = current_match.league || current_match.league_id || 'Unknown';

                                    const insertData = picks.map(p => ({
                                        session_id: session_id || 'unknown',
                                        conversation_id: activeId,
                                        match_id: matchId,
                                        home_team,
                                        away_team,
                                        league,
                                        pick_type: p.pick_type,
                                        pick_side: p.pick_side,
                                        pick_line: p.pick_line,
                                        pick_odds: p.pick_odds,
                                        user_query: lastUserText?.substring(0, 500) || '',
                                        ai_response_snippet: fullReply?.substring(0, 500) || '',
                                        reasoning_summary: p.reasoning_summary,
                                        ai_confidence: p.ai_confidence,
                                        game_start_time: current_match.start_time || current_match.startTime || current_match.commence_time,
                                        result: 'pending'
                                    }));

                                    const { error: insertErr } = await supabase.from('ai_chat_picks').insert(insertData);
                                    if (insertErr) console.error(`[pick-persist] INSERT ERROR:`, insertErr);
                                    else console.log(`[pick-persist] ✅ Successfully saved ${insertData.length} picks`, { requestId });
                                }
                            } catch (e: any) {
                                console.warn(`[pick-persist] EXTRACTION ERROR:`, e.message);
                            }
                        })());
                    }

                    // ⚡ HIGH PERFORMANCE: Send "done" signal before waiting for DB
                    controller.enqueue(encoder.encode(JSON.stringify({
                        type: 'done',
                        conversation_id: activeId,
                        sources: uniqueSources,
                        metadata: { requestId, latency: Date.now() - startTime }
                    }) + "\n"));

                    // Wait for background tasks before closing (Deno Deploy safety)
                    await Promise.allSettled(persistencePromises);
                    controller.close();

                } catch (e: any) {
                    logger.error("STREAM_ERROR", { requestId, error: e.message });
                    controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', content: e.message }) + "\n"));
                    controller.close();
                }
            }
        });

        return new Response(stream, { headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream" } });

    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
    }
});
