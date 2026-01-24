/* ============================================================================
   api/chat.js
   "Obsidian Ledger" — Production Backend (v18.5 JS)
   
   ARCHITECTURE: DUAL-MODE ROUTER
   ├─ ROUTER: Forks intent into "STRICT_PICK" or "FLEX_INFO".
   ├─ STRICT MODE: Enforces "Analytical Walkthrough" + "Tactical HUD" + "Verdict".
   ├─ FLEX MODE: Conversational, direct, citation-heavy (Field Reporter).
   └─ CORE: Preserves OCR Vision, Injury Cache, Live State, Persistence.
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
    MODEL_ID: "gemini-3-flash-preview", // Native Gemini 3
    TIMEOUT_MS: 55000,
    THINKING_CONFIG: { includeThoughts: true, thinkingLevel: "high" },
    // 🔀 ROUTER TRIGGERS: Keywords that force "Strict Ledger Mode"
    PICK_TRIGGERS: [
        'pick', 'bet', 'prediction', 'analyze', 'analysis', 'thoughts on',
        'who wins', 'best bet', 'edge', 'value', 'spread', 'over', 'under',
        'moneyline', 'parlay', 'outlook', 'verdict', 'play', 'handicap', 'sharp',
        'odds', 'line', 'fade', 'tail'
    ]
};

// 2. INTENT ROUTER
function detectIntent(query, hasImage) {
    if (hasImage) return 'STRICT_PICK'; // Always analyze betting slips strictly
    if (!query) return 'FLEX_INFO';

    const q = query.toLowerCase();
    // If the user uses any action keyword, we lock them into Strict Mode
    if (CONFIG.PICK_TRIGGERS.some(t => q.includes(t))) return 'STRICT_PICK';

    return 'FLEX_INFO';
}

// 3. UTILITIES
function safeJsonStringify(obj, maxLen = 1200) {
    try {
        const s = JSON.stringify(obj);
        return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
    } catch { return ''; }
}

const getETDate = (offsetDays = 0) => {
    const now = new Date();
    now.setDate(now.getDate() + offsetDays);
    return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
};

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

// 4. DATA FETCHERS (Preserving your logic)
const INJURY_CACHE = new Map();
async function fetchESPNInjuries(teamId, sportKey = 'NBA') {
    const cacheKey = `${sportKey}_${teamId}`;
    const cached = INJURY_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < 300000) return { ...cached.data, cached: true };

    try {
        const config = {
            NBA: { s: 'basketball', l: 'nba' },
            NFL: { s: 'football', l: 'nfl' },
            NHL: { s: 'hockey', l: 'nhl' }
        }[sportKey?.toUpperCase()] || { s: 'basketball', l: 'nba' };

        const controller = new AbortController();
        setTimeout(() => controller.abort(), 3000);

        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${config.s}/${config.l}/teams/${teamId}?enable=injuries`, { signal: controller.signal });
        if (!res.ok) return { ok: false, injuries: [] };

        const data = await res.json();
        const injuries = (data.team?.injuries || []).map(i => ({
            name: i.athlete?.displayName || 'Unknown',
            status: (i.status || '').toUpperCase(),
            desc: (i.description || '').slice(0, 40)
        })).slice(0, 6);

        const result = { ok: true, injuries };
        INJURY_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
    } catch (e) { return { ok: false, injuries: [] }; }
}

async function fetchLiveState(matchId) {
    if (!matchId) return { ok: false };
    try {
        const { data, error } = await supabase.from('live_game_state').select('*').eq('id', matchId).maybeSingle();
        if (error || !data) return { ok: false, reason: 'db_miss' };
        return { ok: true, data };
    } catch (e) { return { ok: false, reason: 'exception' }; }
}

function extractTeamHint(query) {
    if (!query) return null;
    const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4);
    if (!tokens.length) return null;
    return tokens.sort((a, b) => b.length - a.length)[0];
}

async function detectLiveGame(userQuery, currentContext) {
    if (currentContext?.match_id) return { ok: true, data: currentContext };
    const hint = extractTeamHint(userQuery);
    if (!hint) return { ok: false };

    try {
        const { data } = await supabase.from('live_game_state')
            .select('*')
            .eq('game_status', 'IN_PROGRESS')
            .or(`home_team.ilike.%${hint}%,away_team.ilike.%${hint}%`)
            .limit(1);
        return data?.[0] ? { ok: true, data: data[0] } : { ok: false };
    } catch (e) { return { ok: false }; }
}

// 🔴 LIVE SENTINEL: Aggressive live game scanner
// Always checks for live games matching query, even when context exists
async function scanForLiveGame(userQuery) {
    const hints = extractAllTeamHints(userQuery);
    if (!hints.length) return { ok: false };

    try {
        // Build OR clause for all team hints
        const orClauses = hints.map(h => `home_team.ilike.%${h}%,away_team.ilike.%${h}%`).join(',');
        const { data } = await supabase.from('live_game_state')
            .select('*')
            .in('game_status', ['IN_PROGRESS', 'HALFTIME', 'END_PERIOD'])
            .or(orClauses)
            .order('updated_at', { ascending: false })
            .limit(1);

        if (data?.[0]) {
            console.log(`[LiveSentinel] ⚡ Found LIVE game: ${data[0].away_team} @ ${data[0].home_team} (${data[0].home_score}-${data[0].away_score})`);
            return { ok: true, data: data[0], isLiveOverride: true };
        }
        return { ok: false };
    } catch (e) {
        console.error('[LiveSentinel] Scan error:', e.message);
        return { ok: false };
    }
}

// Extract multiple team hints from query (supports "Lakers vs Celtics" style)
function extractAllTeamHints(query) {
    if (!query) return [];
    const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4);
    // Return top 3 longest tokens as potential team names
    return tokens.sort((a, b) => b.length - a.length).slice(0, 3);
}

// Check if frontend context is stale (game started but still marked as scheduled)
function isContextStale(context) {
    if (!context?.start_time) return false;
    const gameStart = new Date(context.start_time);
    const now = new Date();
    const status = (context.status || context.game_status || '').toUpperCase();

    // Game should have started but status is still pre-match
    if (gameStart < now && !['IN_PROGRESS', 'LIVE', 'HALFTIME', 'FINAL', 'FINISHED', 'END_PERIOD'].includes(status)) {
        console.log(`[LiveSentinel] 🔄 Stale context detected: game started ${Math.round((now - gameStart) / 60000)}min ago but status is '${status}'`);
        return true;
    }
    return false;
}

// ============================================================================
// 🔧 THE 4-TOOL SPINE: Structured Evidence → Claim → Gate → Persist Pipeline
// ============================================================================

/**
 * TOOL 1: buildEvidencePacket
 * Collects all data sources with token budget enforcement.
 */
async function buildEvidencePacket(context, budget = 2000) {
    const packet = {
        injuries: { home: [], away: [] },
        liveState: null,
        temporal: { opening: null, t60: null, t0: null },
        searchGrounding: true,
        tokenUsage: { injuries: 0, live: 0, temporal: 0, total: 0 }
    };

    // Fetch injuries if team IDs available
    if (context?.home_team_id && context?.away_team_id) {
        const sport = context.sport || 'NBA';
        const [h, a] = await Promise.all([
            fetchESPNInjuries(context.home_team_id, sport),
            fetchESPNInjuries(context.away_team_id, sport)
        ]);
        packet.injuries.home = h.injuries || [];
        packet.injuries.away = a.injuries || [];
        packet.tokenUsage.injuries = JSON.stringify(packet.injuries).length;
    }

    // Fetch live state if match ID available
    if (context?.match_id) {
        const liveRes = await fetchLiveState(context.match_id);
        if (liveRes.ok) {
            const d = liveRes.data;
            packet.liveState = {
                score: { home: d.home_score, away: d.away_score },
                clock: d.display_clock,
                status: d.game_status,
                odds: d.odds
            };
            packet.temporal.opening = d.opening_odds;
            packet.temporal.t60 = d.t60_snapshot;
            packet.temporal.t0 = d.t0_snapshot;
            packet.tokenUsage.live = JSON.stringify(packet.liveState).length;
            packet.tokenUsage.temporal = JSON.stringify(packet.temporal).length;
        }
    }

    packet.tokenUsage.total = packet.tokenUsage.injuries + packet.tokenUsage.live + packet.tokenUsage.temporal;

    // Budget enforcement: trim if over budget
    if (packet.tokenUsage.total > budget) {
        console.log(`[4-Tool] ⚠️ Evidence packet (${packet.tokenUsage.total}) exceeds budget (${budget}), trimming...`);
        // Prioritize: live > temporal > injuries
        if (packet.tokenUsage.injuries > budget * 0.3) {
            packet.injuries.home = packet.injuries.home.slice(0, 3);
            packet.injuries.away = packet.injuries.away.slice(0, 3);
        }
    }

    console.log(`[4-Tool] 📦 Evidence packet built: ${packet.tokenUsage.total} tokens`);
    return packet;
}

/**
 * TOOL 2: buildClaimMap
 * Parses AI response into structured claims with evidence references.
 */
function buildClaimMap(response, thoughts = "") {
    const fullText = (response + thoughts).toLowerCase();
    const cleanText = response.replace(/[*_]+/g, '');

    const claimMap = {
        verdict: null,
        confidence: 'medium',
        claims: [],
        tripleConfluence: { price: false, sentiment: false, structure: false }
    };

    // Extract verdict
    const verdictMatch = cleanText.match(/verdict[:\s]+(.+?)(?:\n|$)/i);
    if (verdictMatch) {
        const v = verdictMatch[1].trim();
        claimMap.verdict = v.toLowerCase().includes('pass') ? 'PASS' : v;
    }

    // Extract confidence
    if (fullText.includes('high confidence')) claimMap.confidence = 'high';
    else if (fullText.includes('low confidence')) claimMap.confidence = 'low';

    // Detect Triple Confluence
    claimMap.tripleConfluence.price =
        fullText.includes('market dynamics') ||
        fullText.includes('price verification') ||
        fullText.includes('clv') ||
        fullText.includes('delta');

    claimMap.tripleConfluence.sentiment =
        fullText.includes('sentiment') ||
        fullText.includes('sharp') ||
        fullText.includes('public') ||
        fullText.includes('splits');

    claimMap.tripleConfluence.structure =
        fullText.includes('structural') ||
        fullText.includes('injury') ||
        fullText.includes('rotation') ||
        fullText.includes('rest');

    // Extract claims with citations
    const citationMatches = response.matchAll(/([^.]+)\s*\[(\d+)\]/g);
    let claimId = 1;
    for (const match of citationMatches) {
        claimMap.claims.push({
            id: `CLAIM_${String(claimId++).padStart(3, '0')}`,
            text: match[1].trim(),
            citation: parseInt(match[2])
        });
    }

    console.log(`[4-Tool] 📋 ClaimMap built: verdict="${claimMap.verdict}", confluence=${JSON.stringify(claimMap.tripleConfluence)}`);
    return claimMap;
}

/**
 * TOOL 3: gateDecision
 * Validates Triple Confluence before finalizing verdict.
 */
function gateDecision(claimMap, strictMode = true) {
    const result = {
        approved: false,
        reason: null,
        confluenceScore: 0
    };

    // Count how many confluence factors are met
    const { price, sentiment, structure } = claimMap.tripleConfluence;
    result.confluenceScore = [price, sentiment, structure].filter(Boolean).length;

    // If verdict is PASS, always approve (intentional pass)
    if (claimMap.verdict === 'PASS') {
        result.approved = true;
        result.reason = 'INTENTIONAL_PASS';
        return result;
    }

    // Strict mode requires 2/3 confluence for approval
    if (strictMode) {
        if (result.confluenceScore >= 2) {
            result.approved = true;
            result.reason = 'CONFLUENCE_MET';
        } else {
            result.approved = false;
            result.reason = `CONFLUENCE_NOT_MET (${result.confluenceScore}/3)`;
        }
    } else {
        // Flex mode: approve any verdict
        result.approved = true;
        result.reason = 'FLEX_MODE';
    }

    console.log(`[4-Tool] 🚦 Gate: ${result.approved ? '✅ APPROVED' : '❌ BLOCKED'} - ${result.reason}`);
    return result;
}

/**
 * TOOL 4: persistRun
 * Idempotent database commit with conflict resolution.
 */
async function persistRun(runId, claimMap, gateResult, context, conversationId) {
    try {
        // 1. Upsert to ai_chat_runs
        const { error: runError } = await supabase.from('ai_chat_runs').upsert({
            id: runId,
            conversation_id: conversationId,
            confluence_met: gateResult.approved,
            confluence_score: gateResult.confluenceScore,
            verdict: claimMap.verdict,
            confidence: claimMap.confidence,
            claims: claimMap.claims,
            gate_reason: gateResult.reason,
            match_context: context ? {
                match_id: context.match_id,
                home_team: context.home_team,
                away_team: context.away_team
            } : null,
            created_at: new Date().toISOString()
        }, { onConflict: 'id' });

        if (runError) {
            console.error(`[4-Tool] ❌ Failed to persist run: ${runError.message}`);
            return { success: false, error: runError.message };
        }

        // 2. Only persist picks if gate approved AND verdict is not PASS
        if (gateResult.approved && claimMap.verdict && claimMap.verdict !== 'PASS') {
            // Extract detailed pick info
            const picks = extractPicksFromResponse(claimMap.verdict);
            for (const pick of picks) {
                await supabase.from('ai_chat_picks').insert({
                    run_id: runId,
                    conversation_id: conversationId,
                    pick_type: pick.pick_type,
                    pick_side: pick.pick_side,
                    pick_line: pick.pick_line,
                    ai_confidence: claimMap.confidence,
                    match_id: context?.match_id,
                    game_date: context?.start_time ? new Date(context.start_time).toISOString().split('T')[0] : null
                });
            }
            console.log(`[4-Tool] 💾 Persisted ${picks.length} picks for run ${runId}`);
        }

        console.log(`[4-Tool] ✅ Run ${runId} persisted successfully`);
        return { success: true };
    } catch (e) {
        console.error(`[4-Tool] ❌ Persist exception: ${e.message}`);
        return { success: false, error: e.message };
    }
}

// 5. PICK EXTRACTION (Strict Mode Only)
function extractPicksFromResponse(response, thoughts = "") {

    const picks = [];
    const cleanText = response.replace(/[*_]+/g, '');
    const lowerText = (response + thoughts).toLowerCase();

    if (lowerText.includes('verdict: pass') || lowerText.includes('verdict: **pass**')) return [];

    let confidence = 'medium';
    if (lowerText.includes('high confidence')) confidence = 'high';
    if (lowerText.includes('low confidence')) confidence = 'low';

    const patterns = [
        { type: 'spread', re: /verdict[:\s]+([A-Za-z0-9\s]+?)\s*([-+]\d+\.?\d*)/gi },
        { type: 'total', re: /verdict[:\s]+(over|under)\s*(\d+\.?\d*)/gi },
        { type: 'moneyline', re: /verdict[:\s]+([A-Za-z0-9\s]+?)\s*(?:ML|moneyline)/gi }
    ];

    patterns.forEach(({ type, re }) => {
        let match;
        while ((match = re.exec(cleanText)) !== null) {
            const side = match[1].trim();
            const line = match[2] ? parseFloat(match[2]) : null;
            if (type !== 'moneyline' || (!side.toLowerCase().includes('over') && !side.toLowerCase().includes('under'))) {
                picks.push({ pick_type: type, pick_side: side, pick_line: line, ai_confidence: confidence });
            }
        }
    });
    return picks;
}

// 6. MAIN HANDLER
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { messages, session_id, conversation_id, gameContext, run_id } = req.body;
        const currentRunId = run_id || crypto.randomUUID();

        // A. INTENT & CONTEXT HYDRATION
        const lastMsg = messages[messages.length - 1];
        const userQuery = typeof lastMsg.content === 'string' ? lastMsg.content : '';
        const hasImage = Array.isArray(lastMsg.content) && lastMsg.content.some(c => c.type === 'image' || c.type === 'file');

        // 🔀 THE FORK: Smart Router
        const INTENT = detectIntent(userQuery, hasImage);
        console.log(`[Obsidian] Intent: ${INTENT} | Query: "${userQuery.slice(0, 30)}..."`);

        let activeContext = gameContext;
        let isLiveOverride = false;

        // 🔴 LIVE SENTINEL: Always scan for live games first
        const liveScan = await scanForLiveGame(userQuery);
        if (liveScan.ok) {
            // Live game found - override any stale context
            const d = liveScan.data;
            activeContext = {
                ...activeContext,
                ...d,
                match_id: d.id,
                clock: d.display_clock,
                status: d.game_status,
                current_odds: d.odds,
                home_score: d.home_score,
                away_score: d.away_score,
                _liveOverride: true
            };
            isLiveOverride = true;
        } else if (!activeContext?.match_id || isContextStale(activeContext)) {
            // No live game found, try regular detection if context is missing/stale
            const detect = await detectLiveGame(userQuery, activeContext);
            if (detect.ok) {
                const d = detect.data;
                activeContext = { ...d, match_id: d.id, clock: d.display_clock, status: d.game_status, current_odds: d.odds };
            }
        }


        // B. DATA FETCHING
        const matchId = activeContext?.match_id;
        let injuryText = '', liveText = '';

        if (activeContext?.home_team_id && activeContext?.away_team_id) {
            const sport = activeContext.sport || 'NBA';
            const [h, a] = await Promise.all([
                fetchESPNInjuries(activeContext.home_team_id, sport),
                fetchESPNInjuries(activeContext.away_team_id, sport)
            ]);
            injuryText = `\nINJURIES:\n${activeContext.home_team}: ${h.injuries.map(i => `${i.name} (${i.status})`).join(', ') || 'Clean'}\n${activeContext.away_team}: ${a.injuries.map(i => `${i.name} (${i.status})`).join(', ') || 'Clean'}`;
        }

        // 🕐 TEMPORAL STATE INJECTION: Fetch live state with T-60/T-0 snapshots
        let temporalText = '';
        if (matchId) {
            const liveRes = await fetchLiveState(matchId);
            if (liveRes.ok) {
                const d = liveRes.data;
                liveText = `\n📡 LIVE DB SNAPSHOT: ${d.home_team} ${d.home_score} - ${d.away_score} ${d.away_team} | ${d.display_clock} | Status: ${d.game_status}\nODDS: ${safeJsonStringify(d.odds, 500)}`;
                activeContext = { ...activeContext, ...d };

                // Inject temporal snapshots for CLV analysis
                if (d.t0_snapshot || d.t60_snapshot || d.opening_odds) {
                    temporalText = `\n<temporal_state>`;
                    if (d.t60_snapshot) {
                        temporalText += `\nT-60 (Pre-Match): ${safeJsonStringify(d.t60_snapshot, 300)}`;
                    }
                    if (d.opening_odds) {
                        temporalText += `\nOPENING ODDS: ${safeJsonStringify(d.opening_odds, 300)}`;
                    }
                    if (d.t0_snapshot) {
                        temporalText += `\nT-0 (Tipoff): ${safeJsonStringify(d.t0_snapshot, 300)}`;
                    }
                    temporalText += `\n</temporal_state>`;
                    console.log(`[LiveSentinel] 🕐 Temporal data injected for ${matchId}`);
                }
            }
        }

        // C. SYSTEM PROMPT CONSTRUCTION
        const estTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
        const marketPhase = getMarketPhase(activeContext || {});
        const isLive = marketPhase.includes('LIVE') || isLiveOverride;

        let systemInstruction = `
<temporal_anchor>
TODAY: ${getETDate()} | TIME: ${estTime} ET
PHASE: ${marketPhase}
</temporal_anchor>

<context>
MATCH: ${activeContext?.away_team || 'Unknown'} @ ${activeContext?.home_team || 'Unknown'}
${isLive && activeContext?.home_score !== undefined ? `LIVE SCORE: ${activeContext.away_score} - ${activeContext.home_score} | ${activeContext?.clock}` : ''}
${activeContext?.current_odds ? `ODDS: ${safeJsonStringify(activeContext.current_odds, 600)}` : ''}
${injuryText}
${liveText}
${temporalText}
</context>


<citation_directive>
🛡️ **AUDITABLE TRUTH:** 
You are connected to Google Search. You MUST verify injuries, line moves, and stats.
You MUST include citations [1] for every factual claim.
</citation_directive>
`;

        // 🔴 LIVE SENTINEL: Inject live-only directive when game is in progress
        if (isLive) {
            systemInstruction += `
<live_sentinel_directive>
⚠️ **LIVE GAME ACTIVE** ⚠️
This game is CURRENTLY IN PROGRESS. You MUST:
1. ALWAYS reference the LIVE SCORE: ${activeContext?.away_team} ${activeContext?.away_score} - ${activeContext?.home_score} ${activeContext?.home_team}
2. ALWAYS reference the LIVE CLOCK: ${activeContext?.clock || activeContext?.display_clock || 'In Progress'}
3. NEVER discuss "closing line value" or "pre-match analysis" - the game has STARTED
4. Focus on LIVE MOMENTUM, current game flow, and in-play dynamics
5. Any betting analysis must be for LIVE/IN-PLAY markets only
6. If user asks about pre-game value, explain the game is already live and shift to live analysis
</live_sentinel_directive>
`;
        }



        if (INTENT === 'STRICT_PICK') {
            // === MODE A: THE LEDGER (Strict) ===
            systemInstruction += `
<role>
You are "The Obsidian Ledger," an elite sports analytics engine.
You are STRICT, DISCIPLINED, and BOUND by the "Triple Confluence" framework.
</role>

<output_rules>
FORMAT IS NON-NEGOTIABLE:

**Analytical Walkthrough**
1. **Market Dynamics & Price Verification** [Delta analysis]
2. **Sentiment Signal** [Public vs Sharp splits - Cite Sources]
3. **Structural Assessment** [Physics/Injuries]

**WHAT TO WATCH LIVE**
[REQUIRED: Provide 2-3 specific in-game triggers. E.g., "If Pace > 100 in Q1, hedge."]

**Triple Confluence Evaluation**
[Do we have Price + Sentiment + Structure? YES/NO]

**VERDICT:** [The Play] OR [PASS]
**CONFIDENCE:** [High/Medium/Low]
**THE RULE:** [Generalized betting principle]
</output_rules>
`;
            if (hasImage) systemInstruction += `\n<vision_mode>EXTRACT ALL ODDS FROM IMAGE AND COMPARE TO MARKET. GRADE THE SLIP.</vision_mode>`;

            // 🕐 CLV Analysis when temporal data is available
            if (temporalText) {
                systemInstruction += `
<clv_analysis>
TEMPORAL DATA AVAILABLE. You MUST analyze Closing Line Value (CLV):
1. Compare OPENING ODDS to CURRENT ODDS - identify the steam direction
2. If line moved IN our favor: "Positive CLV captured" 
3. If line moved AGAINST us: "Negative CLV - market corrected against this position"
4. Reference T-60 snapshot for late scratches or lineup changes
5. This temporal shift is CRITICAL for the Market Dynamics section
</clv_analysis>
`;
            }

        } else {
            // === MODE B: THE REPORTER (Flexible) ===
            systemInstruction += `
<role>
You are a Senior Sports Analyst and Field Reporter.
Your goal is to provide high-quality, factual information (injuries, stats, news) without forcing a "Verdict".
</role>

<guidelines>
- Answer the question directly and conversationally.
- Use bullet points for clarity.
- **MANDATORY:** Cite sources for every factual claim (injuries, line moves, news).
- Do NOT use the "Verdict" or "Analytical Walkthrough" headers unless explicitly asked.
</guidelines>
`;
        }

        // D. GEMINI EXECUTION
        const geminiHistory = messages.map(m => {
            const role = m.role === 'assistant' ? 'model' : 'user';
            if (Array.isArray(m.content)) {
                const parts = m.content.map(c => {
                    if (c.type === 'image' && c.source?.data) return { inlineData: { mimeType: c.source.media_type, data: c.source.data } };
                    if (c.type === 'file' && c.source?.data) return { inlineData: { mimeType: c.source.media_type, data: c.source.data } };
                    return { text: c.text || '' };
                });
                return { role, parts };
            }
            return { role, parts: [{ text: String(m.content) }] };
        });

        const result = await genAI.models.generateContentStream({
            model: CONFIG.MODEL_ID,
            contents: geminiHistory.slice(-8),
            config: {
                systemInstruction: { parts: [{ text: systemInstruction }] },
                thinkingConfig: CONFIG.THINKING_CONFIG,
                tools: [{ googleSearch: {} }]
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
                    .map(c => ({ title: c.web?.title || 'Source', uri: c.web?.uri }))
                    .filter(s => s.uri);
                sources = [...sources, ...newSources];
            }
        }

        // E. 4-TOOL SPINE: Claim → Gate → Persist Pipeline
        if (INTENT === 'STRICT_PICK') {
            const claimMap = buildClaimMap(fullText, rawThoughts);
            const gateResult = gateDecision(claimMap, true);
            await persistRun(currentRunId, claimMap, gateResult, activeContext, conversation_id);
        }


        if (conversation_id) {
            const uniqueSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());
            await supabase.from('conversations').update({
                messages: [...messages, { role: 'assistant', content: fullText, thoughts: rawThoughts, sources: uniqueSources, model: CONFIG.MODEL_ID }].slice(-40),
                last_message_at: new Date().toISOString()
            }).eq('id', conversation_id);
        }

        res.write(`data: ${JSON.stringify({ done: true, model: CONFIG.MODEL_ID, sources })}\n\n`);
        res.end();

    } catch (error) {
        console.error("[Gemini 3 Error]", error);
        res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
        res.end();
    }
}
