/* ============================================================================
   functions/handlers/chatHandler.js
   "Obsidian Citadel" — Migrated to Firebase Cloud Functions (v29.1)

   Migrated from api/chat.js:
   - Removed @vercel/functions (waitUntil) → inline fire-and-forget
   - Changed from Web API Response to Express-style res.write() for SSE
   - Changed req.headers.get() → req.headers[] (Express standard)
   - All business logic preserved 1:1
============================================================================ */

import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { randomUUID } from 'node:crypto';

import { BettingPickSchema } from '../lib/picks.js';
import { generateSatelliteSlug, isSatelliteConfigured } from '../lib/satellite.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { LruTtlCache } from '../lib/lruTtlCache.js';
import { buildNbaPromptContextBlock } from '../lib/nbaContextPolicy.js';

// =============================================================================
// CONFIG (identical to api/chat.js)
// =============================================================================
const CONFIG = Object.freeze({
  MODEL_ID: 'gemini-3.1-pro-preview',
  THINKING_CONFIG: Object.freeze({ includeThoughts: true, thinkingLevel: 'high' }),
  ANALYSIS_TRIGGERS: Object.freeze([
    'edge','best bet','should i bet','picks','prediction','analyze','analysis',
    'spread','over','under','moneyline','verdict','play','handicap','sharp',
    'odds','line','lean','lock','parlay','action','value','bet','pick'
  ]),
  TOOLS: Object.freeze([{ googleSearch: {} }, { urlContext: {} }]),
  STALE_THRESHOLD_MS: 15 * 60 * 1000,
  INJURY_CACHE_TTL_MS: 5 * 60 * 1000,
  MAX_PAYLOAD_SIZE: 2 * 1024 * 1024,
  MAX_MESSAGES: 40,
  MAX_HISTORY: 8,
  MAX_MESSAGE_CHARS: 6000,
  NON_FATAL_LOG_INTERVAL_MS: 2 * 60 * 1000
});

const VERDICT_PATTERNS = Object.freeze([
  /\*\*verdict[:\s*]*\*\*\s*(.+?)(?:\n|$)/i,
  /verdict[:\s*]+\*\*(.+?)\*\*/i,
  /verdict[:\s*]+(.+?)(?:\n|$)/i
]);
const ANALYSIS_TRIGGER_RE = new RegExp(
  `\\b(${CONFIG.ANALYSIS_TRIGGERS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i'
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENCODER = new TextEncoder();
const NON_FATAL_LOG_STATE = new Map();

// Lazy singletons (initialized on first invocation to read secrets)
let _genAI = null;
let _supabase = null;

function getGenAI() {
  if (!_genAI) {
    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!key) return null;
    _genAI = new GoogleGenAI({ apiKey: key });
  }
  return _genAI;
}

function getSupabase() {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    _supabase = createClient(url, key);
  }
  return _supabase;
}

const INJURY_CACHE = new LruTtlCache({ maxEntries: 512, ttlMs: CONFIG.INJURY_CACHE_TTL_MS });

function getPublicOrigin() {
  if (process.env.SATELLITE_ORIGIN) return process.env.SATELLITE_ORIGIN.replace(/\/+$/, '');
  return 'https://thedrip.web.app';
}

// =============================================================================
// PURE UTILITIES (1:1 from chat.js)
// =============================================================================
const isValidUUID = (id) => typeof id === 'string' && UUID_RE.test(id);
const safeJsonStringify = (obj, maxLen = 1200) => { try { if (obj == null) return ''; const s = JSON.stringify(obj); return s.length > maxLen ? s.slice(0, maxLen) + '…' : s; } catch { return '[Unparseable]'; } };
const truncateText = (text, maxLen = CONFIG.MAX_MESSAGE_CHARS) => { if (!text) return ''; return text.length > maxLen ? text.slice(0, maxLen) + '…' : text; };
const detectMode = (query, hasImage) => { if (hasImage) return 'ANALYSIS'; if (!query) return 'CONVERSATION'; return ANALYSIS_TRIGGER_RE.test(query) ? 'ANALYSIS' : 'CONVERSATION'; };
const normalizeOddsNumber = (val) => { if (val == null) return null; if (typeof val === 'number' && Number.isFinite(val)) return val; if (typeof val === 'string') { const c = val.replace(/[^\d.+-]/g, ''); if (!c || c === '+' || c === '-') return null; const n = Number(c); return Number.isFinite(n) ? n : null; } return null; };
const formatErrorMessage = (err) => {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err?.message === 'string') return err.message;
  return safeJsonStringify(err);
};
const isTransientFailure = (err) => {
  const msg = formatErrorMessage(err).toLowerCase();
  return ['fetch failed', 'network', 'timeout', 'timed out', 'econnreset', 'enotfound', 'ecanceled'].some(s => msg.includes(s));
};
const warnThrottled = (key, message, meta = null) => {
  const now = Date.now();
  const state = NON_FATAL_LOG_STATE.get(key) || { lastLoggedAt: 0, suppressed: 0 };
  if ((now - state.lastLoggedAt) >= CONFIG.NON_FATAL_LOG_INTERVAL_MS) {
    const payload = state.suppressed > 0 ? { ...(meta || {}), suppressed_since_last: state.suppressed } : (meta || undefined);
    logger.warn(message, payload);
    NON_FATAL_LOG_STATE.set(key, { lastLoggedAt: now, suppressed: 0 });
    return;
  }
  NON_FATAL_LOG_STATE.set(key, { lastLoggedAt: state.lastLoggedAt, suppressed: state.suppressed + 1 });
};

const getMarketPhase = (match) => {
  if (!match) return 'UNKNOWN';
  const status = (match.status || match.game_status || '').toUpperCase();
  if (status.includes('IN_PROGRESS') || status.includes('LIVE') || status.includes('HALFTIME')) return `🔴 LIVE_IN_PLAY [${match.clock || match.display_clock || 'Active'}]`;
  if (status.includes('FINAL') || status.includes('FINISHED') || status.includes('COMPLETE')) return '🏁 FINAL_SCORE';
  if (match.start_time) {
    const h = (new Date(match.start_time).getTime() - Date.now()) / 3.6e6;
    if (h < 0 && h > -4) return '🔴 LIVE_IN_PLAY (Inferred)';
    if (h <= -4) return '🏁 FINAL_SCORE';
    if (h < 1) return '⚡ CLOSING_LINE';
    if (h < 6) return '🎯 SHARP_WINDOW';
    if (h < 24) return '🌊 DAY_OF_GAME';
  }
  return '🔭 OPENING_MARKET';
};

const isContextStale = (ctx) => {
  if (!ctx?.start_time) return false;
  const gs = new Date(ctx.start_time);
  if (Number.isNaN(gs.getTime())) return false;
  const st = (ctx.status || ctx.game_status || '').toUpperCase();
  return (Date.now() - gs.getTime()) > CONFIG.STALE_THRESHOLD_MS && !['IN_PROGRESS','LIVE','HALFTIME','FINAL','FINISHED'].some(s => st.includes(s));
};

const calculateLineMovement = (cur, t60) => {
  if (!cur || !t60?.odds) return { available: false, signal: null };
  const cs = normalizeOddsNumber(cur.spread), os = normalizeOddsNumber(t60.odds.spread);
  const ct = normalizeOddsNumber(cur.total), ot = normalizeOddsNumber(t60.odds.total);
  const mvs = [];
  if (cs !== null && os !== null) { const d = cs - os; if (Math.abs(d) >= 0.5) mvs.push({ type: 'SPREAD', delta: Math.abs(d).toFixed(1), direction: d < 0 ? 'HOME' : 'AWAY', signal: Math.abs(d) >= 1.5 ? '🚨 SHARP_STEAM' : '📊 LINE_MOVE' }); }
  if (ct !== null && ot !== null) { const d = ct - ot; if (Math.abs(d) >= 1) mvs.push({ type: 'TOTAL', delta: Math.abs(d).toFixed(1), direction: d > 0 ? 'UP' : 'DOWN', signal: Math.abs(d) >= 2.5 ? '🚨 SHARP_STEAM' : '📊 LINE_MOVE' }); }
  if (!mvs.length) return { available: true, signal: 'STABLE_MARKET', movements: [] };
  return { available: true, movements: mvs, signal: mvs.some(m => m.signal === '🚨 SHARP_STEAM') ? 'SHARP_ACTION_DETECTED' : 'MODERATE_MOVEMENT' };
};

// =============================================================================
// IP / NETWORK
// =============================================================================
const isValidIPv4 = (ip) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(n => Number(n) >= 0 && Number(n) <= 255);
const isValidIPv6 = (ip) => /^[0-9a-fA-F:]{2,39}$/.test(ip);
const isPrivateIp = (ip) => { if (!ip || ip === '::1') return true; if (isValidIPv4(ip)) { const [a, b] = ip.split('.').map(Number); if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return true; } return ip.startsWith('fc') || ip.startsWith('fd'); };

function getClientIp(headers) {
  // Cloud Functions: headers is plain object, not a Headers instance
  const get = (k) => headers[k] || headers[k.toLowerCase()] || '';
  const xff = get('x-forwarded-for');
  if (xff) {
    const candidates = String(xff).split(',').map(v => v.trim()).filter(ip => isValidIPv4(ip) || isValidIPv6(ip));
    const pub = candidates.find(ip => !isPrivateIp(ip));
    if (pub) return pub;
    if (candidates.length) return candidates[0];
  }
  const realIp = get('x-real-ip');
  if (realIp) return String(realIp).trim();
  return '127.0.0.1';
}

// =============================================================================
// PROMPT BUILDERS (1:1 from chat.js)
// =============================================================================
const buildStaticInstruction = (MODE) => `
<prime_directive>
You are "The Obsidian Ledger," a forensic sports analyst.

**RULE 1 (ENTITY FIREWALL - STATUS CLAIMS ONLY):**
- For **injury/availability/status claims**, you MUST verify via grounded search.
- **FALLBACK:** If you cannot verify a player's STATUS, use their role instead of their name.
- **NO GUESSING on injury/availability.**

**RULE 2 (SOURCE AUTHORITY):**
- For live scores, odds, and play-by-play: use the data from the provided live endpoint URLs. These are real-time authenticated feeds refreshed every 15-30 seconds.
- For narratives, trends, injury context, and historical performance: use Google Search.
- If a web search result conflicts with the live endpoint data on score, odds, or play-by-play, the live endpoint is authoritative.

**RULE 3 (ZERO HALLUCINATION):**
- You have NO internal knowledge of today's specific lines, scores, or results.
- **MANDATORY:** Use grounded tools to verify current event claims.
- Do NOT output bracket citation tokens like [1] or [1.x].

**RULE 4 (MATCHUP LINE - DATE/TIME):**
- For each pick, output a MATCHUP line that includes matchup + date + time + timezone.
- You MUST ground the date/time via tools. If not grounded, write "Time TBD".
</prime_directive>

${MODE === 'ANALYSIS' ? `
<mode_analysis>
**OUTPUT FORMAT (STRICT - VERDICT FIRST):**

**MATCHUP:** [Away] vs [Home] — [Month Day, Time TZ or "Time TBD"]
**VERDICT:** [Team/Side] [Line/Price] ([Confidence: High/Med/Low])

**THE EDGE**
(2-3 sentences max. State the market inefficiency directly. No hedging.)

**KEY FACTORS**
- [Factor 1]
- [Factor 2]
- [Factor 3]

**MARKET DYNAMICS**
(Line movement direction, opening vs current, sharp vs public splits.)

**WHAT TO WATCH LIVE**
IF [Trigger Condition] → THEN [Action/Adjustment]

**STYLE RULES:**
- HEADERS: ALL CAPS with colons.
- Be ASSERTIVE. No "I think" or "It seems".
- Verdict must include exact line/price when available.
- No labeled bullets.
- NEVER include meta-commentary about your methodology.
</mode_analysis>
` : `
<mode_conversation>
Role: Field Reporter. Direct, factual, concise.
- Answer the question directly.
- Keep responses focused and efficient.
- Do NOT output bracket citation tokens.
</mode_conversation>
`}
`.trim();

const buildDynamicInstruction = ({ marketPhase, MODE, activeContext, isLive, liveDataUrls, evidence, lineMovementIntel, staleWarning, nbaProductContext }) => {
  const now = new Date();
  const nbaContextBrief = buildNbaPromptContextBlock(nbaProductContext);
  return `
<temporal>
TODAY: ${now.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
TIME: ${now.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET
MARKET_PHASE: ${marketPhase}
MODE: ${MODE}
</temporal>

<context>
${[
  `MATCHUP: ${activeContext?.away_team || 'TBD'} @ ${activeContext?.home_team || 'TBD'}`,
  isLive ? `🔴 LIVE: ${activeContext?.away_score || 0}-${activeContext?.home_score || 0} | ${activeContext?.clock || ''}` : '',
  ...(liveDataUrls.length > 0
    ? [`LIVE_DATA_URLS: ${liveDataUrls.join(', ')}`, '(Fetch these endpoints via URL Context for authoritative real-time data)']
    : ['LIVE_DATA_URLS: none provided for this request. Use snapshot and stats context only.']),
  `ODDS: ${safeJsonStringify(activeContext?.current_odds, 600)}`,
  lineMovementIntel ? `LINE_MOVEMENT: ${lineMovementIntel}` : '',
  `INJURIES_HOME: ${safeJsonStringify(evidence.injuries.home, 400)}`,
  `INJURIES_AWAY: ${safeJsonStringify(evidence.injuries.away, 400)}`,
  evidence.temporal?.t60 ? `T-60_ODDS: ${safeJsonStringify(evidence.temporal.t60.odds, 300)}` : '',
  nbaContextBrief || '',
  staleWarning
].filter(Boolean).join('\n')}
</context>
`.trim();
};

// =============================================================================
// MULTIMODAL + HISTORY NORMALIZATION (1:1)
// =============================================================================
const extractVisionParts = (content) => {
  if (typeof content === 'string') return [{ text: truncateText(content) }];
  if (Array.isArray(content)) {
    return content.map(c => {
      if (typeof c === 'string') return { text: truncateText(c) };
      if (c.type === 'text' || c.text) return { text: truncateText(c.text || '') };
      if (c.type === 'image_url' && c.image_url?.url) { const m = c.image_url.url.match(/^data:(.*?);base64,(.*)$/); if (m) return { inlineData: { mimeType: m[1], data: m[2] } }; }
      if (c.inlineData) return c;
      return { text: '' };
    }).filter(p => p.text !== '' || p.inlineData);
  }
  return [{ text: truncateText(safeJsonStringify(content)) }];
};

const normalizeGeminiHistory = (messages, liveDataUrls) => {
  const raw = messages.map((m, i) => {
    const parts = extractVisionParts(m.content);
    if (i === messages.length - 1 && m.role === 'user' && liveDataUrls.length > 0) {
      const tp = parts.find(p => p.text !== undefined);
      if (tp) tp.text += `\n\nLive data sources:\n${liveDataUrls.join('\n')}`;
      else parts.push({ text: `Live data sources:\n${liveDataUrls.join('\n')}` });
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });
  const normalized = [];
  let expectedRole = 'user';
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i].role === expectedRole) {
      normalized.unshift({ role: raw[i].role, parts: [...raw[i].parts] });
      expectedRole = expectedRole === 'user' ? 'model' : 'user';
    } else if (raw[i].role === 'user' && expectedRole === 'model') {
      const ct = raw[i].parts.filter(p => p.text).map(p => p.text).join('\n');
      const tp = normalized[0].parts.find(p => p.text !== undefined);
      if (tp) tp.text = ct + '\n\n' + tp.text;
      else if (ct) normalized[0].parts.unshift({ text: ct + '\n\n' });
      const imgs = raw[i].parts.filter(p => p.inlineData);
      if (imgs.length) normalized[0].parts.push(...imgs);
    }
    if (normalized.length >= CONFIG.MAX_HISTORY) break;
  }
  if (normalized.length > 0 && normalized[0].role === 'model') normalized.shift();
  return normalized;
};

// =============================================================================
// DATA FETCHERS (1:1)
// =============================================================================
async function scanForLiveGame(userQuery) {
  const supabase = getSupabase();
  if (!userQuery || !supabase) return { ok: false };
  const hints = userQuery.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4).sort((a, b) => b.length - a.length).slice(0, 3);
  if (!hints.length) return { ok: false };
  try {
    const orClauses = hints.map(h => `home_team.ilike.%${h}%,away_team.ilike.%${h}%`).join(',');
    const { data, error } = await supabase.from('live_game_state').select('*').in('game_status', ['IN_PROGRESS','HALFTIME','END_PERIOD','LIVE']).or(orClauses).order('updated_at', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(3000));
    if (error) throw new Error(error.message);
    return data?.[0] ? { ok: true, data: data[0], isLiveOverride: true } : { ok: false };
  } catch (e) {
    warnThrottled('live-sentinel-scan', '[Live Sentinel] Scan failed (non-fatal)', { message: formatErrorMessage(e) });
    return { ok: false };
  }
}

async function fetchESPNInjuries(teamId, sportKey) {
  if (!teamId) return { injuries: [] };
  const ck = `${sportKey}_${teamId}`;
  const cached = INJURY_CACHE.get(ck);
  if (cached) return structuredClone({ ...cached, cached: true });
  const sc = { NBA: { sport: 'basketball', league: 'nba' }, NFL: { sport: 'football', league: 'nfl' }, NHL: { sport: 'hockey', league: 'nhl' }, NCAAB: { sport: 'basketball', league: 'mens-college-basketball' }, CBB: { sport: 'basketball', league: 'mens-college-basketball' } }[sportKey] || { sport: 'basketball', league: 'nba' };
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sc.sport}/${sc.league}/teams/${teamId}?enable=injuries`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const injuries = (data.team?.injuries || []).map(i => ({ name: i.athlete?.displayName, status: i.status?.toUpperCase(), position: i.athlete?.position?.abbreviation })).filter(i => i.name && i.status).slice(0, 8);
    const result = { injuries };
    INJURY_CACHE.set(ck, result);
    return structuredClone(result);
  } catch (e) {
    warnThrottled(`injury-fetch:${teamId}`, `[Injury Fetch] Failed for ${teamId} (non-fatal)`, { message: formatErrorMessage(e) });
    return { injuries: [] };
  }
}

async function buildEvidencePacket(context) {
  const supabase = getSupabase();
  const packet = { injuries: { home: [], away: [] }, liveState: null, temporal: { t60: null, t0: null }, lineMovement: null };
  const promises = [];
  if (context?.home_team_id && context?.away_team_id) {
    promises.push(Promise.allSettled([fetchESPNInjuries(context.home_team_id, context.sport || context.league), fetchESPNInjuries(context.away_team_id, context.sport || context.league)]).then(([h, a]) => { packet.injuries.home = h.status === 'fulfilled' ? (h.value.injuries || []) : []; packet.injuries.away = a.status === 'fulfilled' ? (a.value.injuries || []) : []; }));
  }
  if (context?.match_id && supabase) {
    promises.push(
      supabase.from('live_game_state').select('*').eq('id', String(context.match_id)).maybeSingle().abortSignal(AbortSignal.timeout(3000))
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          if (data) {
            packet.liveState = { score: { home: data.home_score, away: data.away_score }, clock: data.display_clock, period: data.period, status: data.game_status, odds: data.odds };
            packet.temporal.t60 = data.t60_snapshot;
            packet.temporal.t0 = data.t0_snapshot;
            if (data.odds && data.t60_snapshot) packet.lineMovement = calculateLineMovement(data.odds, data.t60_snapshot);
          }
        })
        .catch(e => warnThrottled('evidence-live-state-fetch', '[Evidence] Live state fetch failed (non-fatal)', { message: formatErrorMessage(e) }))
    );
  }
  await Promise.allSettled(promises);
  return packet;
}

function buildClaimMap(response, thoughts) {
  const evalText = truncateText(response + ' ' + thoughts, 12000).toLowerCase();
  const map = { verdict: null, confidence: 'medium', confluence: { price: false, sentiment: false, structure: false } };
  for (const pattern of VERDICT_PATTERNS) { const m = response.match(pattern); if (m) { const e = m[1].trim().replace(/\*+/g, '').trim(); map.verdict = e.toLowerCase().includes('pass') ? 'PASS' : e; break; } }
  if (/(high confidence|confidence: high|\(high\))/i.test(evalText)) map.confidence = 'high';
  else if (/(low confidence|confidence: low|\(low\))/i.test(evalText)) map.confidence = 'low';
  map.confluence.price = /(market|price|clv|delta|line move|steam|reverse|closing)/i.test(evalText);
  map.confluence.sentiment = /(sentiment|sharp|public|split|money|ticket|fade|action)/i.test(evalText);
  map.confluence.structure = /(structural|injury|rotation|rest|b2b|travel|revenge|matchup)/i.test(evalText);
  return map;
}

function gateDecision(map, strict) {
  const score = Object.values(map.confluence).filter(Boolean).length;
  if (map.verdict === 'PASS') return { approved: true, reason: 'INTENTIONAL_PASS', score };
  if (strict && score < 2) return { approved: false, reason: `WEAK_CONFLUENCE (${score}/3)`, score };
  return { approved: true, reason: 'APPROVED', score };
}

async function extractPickStructured(text, context) {
  if (!context?.home_team || !context?.away_team) return [];
  const prompt = `GAME CONTEXT:\n- Home Team: "${context.home_team}"\n- Away Team: "${context.away_team}"\n- League: ${context.league || 'Unknown'}\n\nTASK: Extract betting verdict from analysis.\nRULES:\n1. pick_team MUST exactly match Home or Away (null for Totals).\n2. If verdict is PASS or NO BET, set verdict="PASS".\n3. For Totals: pick_type="total", pick_direction="over" or "under".\nANALYSIS:\n${truncateText(text, 2500)}`;
  try {
    const { object } = await generateObject({ model: google(CONFIG.MODEL_ID), schema: BettingPickSchema, prompt, mode: 'json', abortSignal: AbortSignal.timeout(15000) });
    if (object.verdict === 'BET' || object.verdict === 'FADE') {
      if (object.pick_type !== 'total' && object.pick_team) {
        const pn = object.pick_team.toLowerCase().replace(/[^a-z0-9]/g, '');
        const hn = context.home_team.toLowerCase().replace(/[^a-z0-9]/g, '');
        const an = context.away_team.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (pn && hn && (pn.includes(hn) || hn.includes(pn))) object.pick_team = context.home_team;
        else if (pn && an && (pn.includes(an) || an.includes(pn))) object.pick_team = context.away_team;
        else return [];
      }
    }
    return [object];
  } catch (e) { logger.warn('[Pick Extraction] Failed:', e?.message); return []; }
}

// =============================================================================
// CLOUD FUNCTION HANDLER (replaces Vercel export async function POST)
// =============================================================================
export const chatHandler = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 300,
    memory: '1GiB',
    cors: true,
    secrets: ['GOOGLE_GENERATIVE_AI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SATELLITE_SECRET'],
  },
  async (req, res) => {
    // CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const genAI = getGenAI();
    const supabase = getSupabase();
    if (!genAI || !supabase) { res.status(500).json({ error: 'Server misconfigured: missing required env vars.' }); return; }

    // Payload size check
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    if (rawBody.length > CONFIG.MAX_PAYLOAD_SIZE) { res.status(413).json({ error: 'Payload too large (Max 2MB)' }); return; }

    // Rate limit
    if (!checkRateLimit(req)) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }

    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
    catch { res.status(400).json({ error: 'Invalid JSON payload' }); return; }

    const convoIdRaw = body.conversation_id;
    const runIdRaw = body.run_id;
    const conversation_id = isValidUUID(convoIdRaw) ? String(convoIdRaw) : null;
    const currentRunId = isValidUUID(runIdRaw) ? String(runIdRaw) : randomUUID();

    const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-CONFIG.MAX_MESSAGES) : [];
    const messages = rawMessages.map(m => { if (!m || typeof m !== 'object') return null; return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }; }).filter(Boolean);

    let activeContext = body.gameContext || {};
    const nbaProductContext = body.nba_product_context && typeof body.nba_product_context === 'object' ? body.nba_product_context : null;

    const lastMsgContent = messages.length > 0 ? messages[messages.length - 1].content : '';
    let userQuery = '';
    let hasImage = false;
    if (typeof lastMsgContent === 'string') { userQuery = lastMsgContent; }
    else if (Array.isArray(lastMsgContent)) { userQuery = lastMsgContent.find(c => c.type === 'text' || c.text)?.text || ''; hasImage = lastMsgContent.some(c => c.type === 'image' || c.type === 'image_url'); }

    const MODE = detectMode(userQuery, hasImage);

    // ── SSE STREAMING (open immediately to avoid client TTFB timeout) ──
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write(':ok\n\n');

    // Parallel: live sentinel + evidence
    let liveScan = { ok: false }, evidence = { injuries: { home: [], away: [] }, liveState: null, temporal: { t60: null, t0: null }, lineMovement: null };
    try { [liveScan, evidence] = await Promise.all([scanForLiveGame(userQuery), buildEvidencePacket(activeContext)]); }
    catch (e) { logger.warn('[WARN] Middle logic failed:', e?.message); }

    let isLive = false;
    if (liveScan.ok) { activeContext = { ...activeContext, ...liveScan.data, match_id: String(liveScan.data.id), clock: liveScan.data.display_clock, status: liveScan.data.game_status, current_odds: liveScan.data.odds }; isLive = true; }
    if (evidence.liveState) activeContext = { ...activeContext, ...evidence.liveState, current_odds: evidence.liveState.odds };
    isLive = isLive || ['IN_PROGRESS','LIVE','HALFTIME','END_PERIOD'].some(st => (activeContext?.status || '').toUpperCase().includes(st));

    const marketPhase = getMarketPhase(activeContext);
    const lineMovementIntel = (evidence.lineMovement?.available && evidence.lineMovement.movements?.length > 0)
      ? evidence.lineMovement.movements.map(m => `${m.signal} ${m.type}: ${m.direction} ${m.delta}pts`).join(' | ') : '';

    const liveDataUrls = [];
    if (activeContext?.match_id && isSatelliteConfigured()) {
      const origin = getPublicOrigin();
      const gid = encodeURIComponent(String(activeContext.match_id));
      const [scores, odds, pbp] = ['scores','odds','pbp'].map(t => generateSatelliteSlug(String(activeContext.match_id), t));
      if (scores.slug && odds.slug && pbp.slug) {
        liveDataUrls.push(
          `${origin}/api/live/scores/${scores.slug}?g=${gid}&n=${scores.nonce}`,
          `${origin}/api/live/odds/${odds.slug}?g=${gid}&n=${odds.nonce}`,
          `${origin}/api/live/pbp/${pbp.slug}?g=${gid}&n=${pbp.nonce}`
        );
      }
    }

    const geminiHistory = normalizeGeminiHistory(messages, liveDataUrls);

    let fullText = '';
    let rawThoughts = '';
    let finalMetadata = null;
    let streamActive = true;
    const heartbeat = setInterval(() => {
      if (!streamActive) return;
      try { res.write(':hb\n\n'); }
      catch { streamActive = false; }
    }, 15000);
    req.on('close', () => {
      streamActive = false;
      clearInterval(heartbeat);
    });

    const safeWrite = (payload) => {
      if (!streamActive) return;
      try { res.write(`data: ${JSON.stringify(payload)}\n\n`); }
      catch { streamActive = false; }
    };

    const sendDone = (() => {
      let sent = false;
      return (payload = {}) => { if (sent) return; sent = true; safeWrite({ done: true, model: CONFIG.MODEL_ID, ...payload }); };
    })();

    try {
      const systemPrompt = `${buildStaticInstruction(MODE)}\n\n${buildDynamicInstruction({
        marketPhase, MODE, activeContext, isLive, liveDataUrls, evidence, lineMovementIntel,
        staleWarning: isContextStale(activeContext) ? '\n⚠️ DATA WARNING: Context may be stale.' : '',
        nbaProductContext
      })}`;

      const result = await genAI.models.generateContentStream({
        model: CONFIG.MODEL_ID,
        contents: geminiHistory,
        config: {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          thinkingConfig: CONFIG.THINKING_CONFIG,
          tools: CONFIG.TOOLS
        },
      });

      for await (const chunk of result) {
        if (!streamActive) break;
        if (chunk.candidates?.[0]?.groundingMetadata) { finalMetadata = chunk.candidates[0].groundingMetadata; safeWrite({ type: 'grounding', metadata: finalMetadata }); }
        for (const part of (chunk.candidates?.[0]?.content?.parts || [])) {
          if (!part.text) continue;
          if (part.thought) { rawThoughts += part.text; safeWrite({ type: 'thought', content: part.text }); }
          else { fullText += part.text; safeWrite({ type: 'text', content: part.text }); }
        }
      }

      sendDone();
      clearInterval(heartbeat);
      res.end();

      // ── BACKGROUND DB TASKS (fire-and-forget, replaces waitUntil) ──
      if (fullText) {
        (async () => {
          try {
            const dbTasks = [];
            const cleanMatchId = activeContext?.match_id ? String(activeContext.match_id) : null;
            if (MODE === 'ANALYSIS') {
              dbTasks.push((async () => {
                const map = buildClaimMap(fullText, rawThoughts);
                const gate = gateDecision(map, true);
                const grounding = finalMetadata ? { chunk_count: finalMetadata.groundingChunks?.length || 0, support_count: finalMetadata.groundingSupports?.length || 0, sources: (finalMetadata.groundingChunks || []).map(c => c.web?.uri).filter(Boolean).slice(0, 10), supports: (finalMetadata.groundingSupports || []).map(s => ({ text: s.segment?.text?.slice(0, 100), chunks: s.groundingChunkIndices })).slice(0, 20) } : null;
                const { error: upsertErr } = await supabase.from('ai_chat_runs').upsert({ id: currentRunId, conversation_id, confluence_met: gate.approved, confluence_score: gate.score, verdict: map.verdict, confidence: map.confidence, gate_reason: gate.reason, match_context: cleanMatchId ? { id: cleanMatchId, home: activeContext.home_team, away: activeContext.away_team } : null, grounding_provenance: grounding }, { onConflict: 'id' });
                if (upsertErr) throw new Error(`Run Upsert Failed: ${upsertErr.message}`);
                if (gate.approved && map.verdict && map.verdict !== 'PASS' && activeContext?.home_team && activeContext?.away_team) {
                  const picks = await extractPickStructured(fullText, activeContext);
                  if (picks.length > 0) {
                    const { error: picksErr } = await supabase.from('ai_chat_picks').insert(picks.map(p => {
                      const side = p.pick_type === 'total' ? (p.pick_direction ? p.pick_direction.toUpperCase() : 'UNKNOWN') : p.pick_team;
                      return { run_id: currentRunId, conversation_id, match_id: cleanMatchId, home_team: activeContext.home_team, away_team: activeContext.away_team, league: activeContext?.league, game_start_time: activeContext?.start_time || activeContext?.game_start_time, pick_type: p.pick_type, pick_side: side, pick_line: p.pick_line, ai_confidence: p.confidence || map.confidence || 'medium', model_id: CONFIG.MODEL_ID, reasoning_summary: p.reasoning_summary, extraction_method: 'structured_v29.1_firebase' };
                    }));
                    if (picksErr) throw new Error(`Picks Insert Failed: ${picksErr.message}`);
                  }
                }
              })());
            }
            if (conversation_id) {
              const sources = finalMetadata?.groundingChunks?.map(c => ({ title: c.web?.title, uri: c.web?.uri })).filter(s => s.uri) || [];
              dbTasks.push(supabase.from('conversations').update({ messages: [...rawMessages, { role: 'assistant', content: fullText, thoughts: rawThoughts, groundingMetadata: finalMetadata, sources, model: CONFIG.MODEL_ID }].slice(-CONFIG.MAX_MESSAGES), last_message_at: new Date().toISOString() }).eq('id', conversation_id).then(({ error }) => { if (error) throw new Error(`Conversation Update Failed: ${error.message}`); }));
            }
            const results = await Promise.allSettled(dbTasks);
            results.forEach((r, idx) => {
              if (r.status !== 'rejected') return;
              const reason = formatErrorMessage(r.reason);
              const meta = { task_index: idx, reason };
              if (isTransientFailure(r.reason)) {
                warnThrottled(`background-task:${idx}`, `[Chat Background] Task ${idx} failed (transient/non-fatal)`, meta);
                return;
              }
              logger.error(`[Chat Background] Task ${idx} failed`, meta);
            });
          } catch (dbErr) {
            if (isTransientFailure(dbErr)) {
              warnThrottled('background-setup', '[Chat Background] Setup failed (transient/non-fatal)', { reason: formatErrorMessage(dbErr) });
              return;
            }
            logger.error('[Chat Background] Setup failed', { reason: formatErrorMessage(dbErr) });
          }
        })();
      }

    } catch (e) {
      clearInterval(heartbeat);
      if (!streamActive) return;
      logger.error('🔥 Stream Generation Error:', e);
      safeWrite({ type: 'error', content: e?.message || 'An unexpected error occurred.' });
      sendDone({ ok: false });
      res.end();
    }
  }
);
