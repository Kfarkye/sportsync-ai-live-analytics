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
function safeJsonStringify(obj, maxLen = 1200) {
    try {
        const s = JSON.stringify(obj);
        return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
    } catch {
        return '';
    }
}

function clampText(s, maxLen = 1200) {
    if (!s) return '';
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

// === LIVE STATE FETCH (Phase 1: DB > Frontend) ===
async function fetchLiveState(supabaseClient, matchId) {
    if (!matchId) return { ok: false, reason: 'no_match_id', data: null };

    const t0 = Date.now();
    try {
        const { data, error } = await supabaseClient
            .from('live_game_state')
            .select('id, home_team, away_team, home_score, away_score, display_clock, game_status, period, odds, ai_analysis, updated_at')
            .eq('id', matchId)
            .maybeSingle();

        const ms = Date.now() - t0;

        if (error) {
            console.log(`[live-state] error matchId=${matchId} ms=${ms} err=${error.message}`);
            return { ok: false, reason: 'db_error', data: null, ms };
        }
        if (!data) return { ok: false, reason: 'not_found', data: null, ms };

        const updatedAt = new Date(data.updated_at).getTime();
        const ageMs = Date.now() - updatedAt;

        // Stale guard: ignore if older than 5 minutes
        if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) {
            console.log(`[live-state] stale matchId=${matchId} ageSec=${Math.round(ageMs / 1000)} ms=${ms}`);
            return { ok: false, reason: 'stale', data: null, ms, ageMs };
        }

        console.log(
            `[live-state] ok matchId=${matchId} ${data.home_score}-${data.away_score} | ${data.display_clock} | ageSec=${Math.round(ageMs / 1000)} ms=${ms}`
        );

        return { ok: true, reason: 'ok', data, ms, ageMs };
    } catch (e) {
        const ms = Date.now() - t0;
        console.log(`[live-state] exception matchId=${matchId} ms=${ms} err=${String(e)}`);
        return { ok: false, reason: 'exception', data: null, ms };
    }
}

// === PHASE 2: LIVE GAME AUTO-DETECTION ===
function extractTeamHint(query) {
    if (!query) return null;
    const q = query.toLowerCase();

    // Only attempt if query includes live-intent keywords
    const intent = /(vs|versus|game|score|live|quarter|q[1-4]|half|period|inning|overtime)/i.test(q);
    if (!intent) return null;

    // Pick longest word token as a hint (reduces noise, avoids short words like "heat")
    const tokens = q.split(/[^a-z0-9]+/).filter(Boolean);
    const candidates = tokens.filter(t => t.length >= 4);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0];
}

async function detectLiveGame(supabaseClient, userQuery, gameContext) {
    // Already have context
    if (gameContext?.match_id) return { ok: true, data: gameContext, reason: 'already_has_context' };

    const hint = extractTeamHint(userQuery);
    if (!hint) return { ok: false, data: null, reason: 'no_hint' };

    const t0 = Date.now();
    try {
        const { data, error } = await supabaseClient
            .from('live_game_state')
            .select('id, home_team, away_team, home_score, away_score, display_clock, game_status, period, odds, updated_at')
            .eq('game_status', 'IN_PROGRESS')
            .or(`home_team.ilike.%${hint}%,away_team.ilike.%${hint}%`)
            .order('updated_at', { ascending: false })
            .limit(1);

        const ms = Date.now() - t0;

        if (error || !data?.length) {
            console.log(`[live-detect] no_match hint=${hint} ms=${ms}`);
            return { ok: false, data: null, reason: 'no_match', ms };
        }

        console.log(`[live-detect] FOUND hint=${hint} matchId=${data[0].id} ${data[0].home_score}-${data[0].away_score} ms=${ms}`);
        return { ok: true, data: data[0], reason: 'match', ms };
    } catch (e) {
        console.log(`[live-detect] exception hint=${hint} err=${String(e)}`);
        return { ok: false, data: null, reason: 'exception' };
    }
}

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

// === HARDENED INJURY FETCH (3s timeout, status normalization, token cap) ===
const INJURY_STATUSES = ['OUT', 'DOUBTFUL', 'QUESTIONABLE', 'DAY-TO-DAY', 'GTD', 'SUSPENSION', 'PROBABLE'];
const SPORT_CONFIG = {
    NBA: { sport: 'basketball', league: 'nba' },
    NFL: { sport: 'football', league: 'nfl' },
    NHL: { sport: 'hockey', league: 'nhl' },
    HOCKEY: { sport: 'hockey', league: 'nhl' }
};

// === INJURY CACHE (5-minute TTL) ===
const INJURY_CACHE = new Map(); // Key: teamId, Value: { data, timestamp }
const INJURY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchESPNInjuries(teamId, sportKey = 'NBA') {
    // Check cache first
    const cacheKey = `${sportKey}_${teamId}`;
    const cached = INJURY_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < INJURY_CACHE_TTL_MS) {
        console.log(`[injury-cache] HIT: ${cacheKey} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
        return { ...cached.data, cached: true };
    }

    const start = Date.now();
    const config = SPORT_CONFIG[sportKey?.toUpperCase()] || SPORT_CONFIG.NBA;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout

    try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/teams/${teamId}?enable=injuries`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) return { ok: false, ms: Date.now() - start, injuries: [], error: `HTTP ${res.status}` };

        const data = await res.json();
        const injuries = (data.team?.injuries || [])
            .map(i => ({
                name: i.athlete?.displayName || 'Unknown',
                status: (i.status || '').toUpperCase().replace(/-/g, ''),
                desc: (i.description || '').slice(0, 40)
            }))
            .filter(i => INJURY_STATUSES.some(s => i.status.includes(s.replace(/-/g, ''))))
            .slice(0, 6); // Cap at 6 per team

        const result = { ok: true, ms: Date.now() - start, injuries };

        // Cache successful results
        INJURY_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
        console.log(`[injury-cache] MISS: ${cacheKey} - cached ${injuries.length} injuries`);

        return result;
    } catch (e) {
        clearTimeout(timeout);
        return { ok: false, ms: Date.now() - start, injuries: [], error: e.name };
    }
}

function formatInjuryContext(homeResult, awayResult, homeName, awayName) {
    const formatTeam = (r, name) => {
        if (!r.ok) return `${name}: ⚠️ FETCH FAILED (${r.error || 'timeout'})`;
        if (!r.injuries.length) return `${name}: No injuries returned by ESPN`;
        return `${name}: ${r.injuries.map(i => `${i.name} (${i.status})`).join(', ')}`;
    };

    const status = (homeResult.ok && awayResult.ok) ? 'ok' : 'partial_fail';
    const totalMs = (homeResult.ms || 0) + (awayResult.ms || 0);

    return `
🚨 LIVE INJURY REPORT (${new Date().toISOString().slice(11, 19)} UTC):
${formatTeam(homeResult, homeName)}
${formatTeam(awayResult, awayName)}
[INJURY_FETCH: ${status} | ${totalMs}ms | home:${homeResult.injuries.length} away:${awayResult.injuries.length}]`;
}

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

        let matchId = gameContext?.match_id || gameContext?.id;

        // === PHASE 2: AUTO-DETECT LIVE GAME ===
        // If no explicit game context, try to detect from user query
        if (!matchId) {
            const userQuery = messages.filter(m => m.role === 'user').pop()?.content || '';
            const detectRes = await detectLiveGame(supabase, userQuery, gameContext);
            if (detectRes.ok && detectRes.data && detectRes.reason === 'match') {
                // Hydrate gameContext from detected live game
                const d = detectRes.data;
                gameContext = {
                    match_id: d.id,
                    home_team: d.home_team,
                    away_team: d.away_team,
                    home_score: d.home_score,
                    away_score: d.away_score,
                    clock: d.display_clock,
                    status: d.game_status,
                    period: d.period,
                    current_odds: d.odds
                };
                matchId = d.id;
                console.log(`[live-detect] 🎯 Auto-hydrated context: ${d.home_team} vs ${d.away_team}`);
            }
        }

        // Retry Ladder Logic
        const attemptNumber = parseInt(req.headers['x-retry-attempt'] || '1');
        const retryStrategy = CONFIG.RETRY_LADDER.find(r => r.attempt === attemptNumber) || CONFIG.RETRY_LADDER[0];
        console.log(`[run] 🪜 Attempt ${attemptNumber} | Budget: ${retryStrategy.maxChars} chars`);

        const marketPhase = getMarketPhase(gameContext || {});
        const isLive = marketPhase.includes('LIVE');
        const estTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

        // === INJURY PRE-FLIGHT FETCH ===
        let injuryContext = '';
        if (gameContext?.home_team_id && gameContext?.away_team_id) {
            const sport = gameContext?.sport || 'NBA';
            const [homeInjuries, awayInjuries] = await Promise.all([
                fetchESPNInjuries(gameContext.home_team_id, sport),
                fetchESPNInjuries(gameContext.away_team_id, sport)
            ]);
            injuryContext = formatInjuryContext(
                homeInjuries, awayInjuries,
                gameContext.home_team, gameContext.away_team
            );
            console.log(`[injury-fetch] sport=${sport} home:${homeInjuries.injuries.length} away:${awayInjuries.injuries.length} ms:${(homeInjuries.ms || 0) + (awayInjuries.ms || 0)}`);
        } else {
            console.log('[injury-fetch] Skipped - no team IDs in context');
        }

        // === LIVE STATE INJECTION (Phase 1: DB > Frontend) ===
        let liveContext = '';
        let liveStateMeta = { ok: false, reason: 'not_attempted' };

        const fetchMatchId = gameContext?.match_id ?? gameContext?.id ?? null;
        const liveRes = await fetchLiveState(supabase, fetchMatchId);
        liveStateMeta = { ok: liveRes.ok, reason: liveRes.reason, ms: liveRes.ms, ageMs: liveRes.ageMs };

        if (liveRes.ok && liveRes.data) {
            const d = liveRes.data;

            // Override gameContext with fresh DB state
            gameContext = {
                ...gameContext,
                match_id: d.id,
                home_team: gameContext?.home_team ?? d.home_team,
                away_team: gameContext?.away_team ?? d.away_team,
                home_score: d.home_score,
                away_score: d.away_score,
                clock: d.display_clock,
                status: d.game_status,
                period: d.period,
                current_odds: d.odds,
                ai_analysis: d.ai_analysis
            };

            const ageSec = Math.round((liveRes.ageMs ?? 0) / 1000);
            const oddsSummary = safeJsonStringify(d.odds, 900);
            const aiBrief = clampText(d.ai_analysis, 900);

            liveContext = `
📡 LIVE DB SNAPSHOT (source=live_game_state)
timestamp_utc: ${new Date().toISOString()}
updated_at_utc: ${new Date(d.updated_at).toISOString()}
age_seconds: ${ageSec}
status: ${d.game_status}
period: ${d.period ?? ''}
clock: ${d.display_clock}
score: ${d.home_team ?? 'HOME'} ${d.home_score} — ${d.away_score} ${d.away_team ?? 'AWAY'}
odds_json: ${oddsSummary || 'n/a'}
precomputed_ai_analysis: ${aiBrief || 'n/a'}

RULES:
- Treat LIVE DB SNAPSHOT as the single source of truth for score/clock/status/odds.
- If any other context conflicts, ignore it and reference LIVE DB SNAPSHOT.`;
        } else {
            // Always include a small footer so "no live context" isn't mistaken for "no changes"
            liveContext = `
📡 LIVE DB SNAPSHOT
timestamp_utc: ${new Date().toISOString()}
fetch_status: ${liveStateMeta.reason}
NOTE: If fetch_status is not "ok", do not assume current score/clock is known.`;
        }

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
            systemInstruction += `\nODDS: ${safeJsonStringify(gameContext.current_odds, 600)}`;
        }

        // Inject injury context
        if (injuryContext) {
            systemInstruction += injuryContext;
        }

        // Inject live state context (critical for source-of-truth enforcement)
        systemInstruction += liveContext;

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
        const userQuery = messages.filter(m => m.role === 'user').pop()?.content || '';
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
                    user_query: userQuery.slice(0, 500),
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
