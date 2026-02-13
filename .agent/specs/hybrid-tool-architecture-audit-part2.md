# Hybrid Tool Architecture — Second Pass (Institutional Grade)

## Date: 2026-02-08

## Scope: Full stack — 8 files, 2 runtimes, 3 providers

**Part 1 covered:** hit rate, dependency map, token audit, streaming contract, Gemini FC constraints.
**Part 2 covers:** everything else you need before writing the first line of refactor code.

---

## 6. DUAL-ROUTE DIVERGENCE AUDIT

You have **two completely separate** backend routes serving the same frontend component. This is the single biggest structural hazard for the refactor.

### 6.1 Route Comparison Matrix

| Dimension | Edge Function (`ai-chat/index.ts`) | Vercel Route (`api/chat.js`) |
|-----------|--------------------------------------|-------------------------------|
| **Runtime** | Deno (Supabase Edge) | Node.js (Vercel Serverless) |
| **Timeout** | 55s hard (60s platform kill) | 300s (Vercel Pro) / 10s (Hobby) |
| **AI SDK** | `@google/genai` SDK via `gemini.ts` | Raw `fetch()` via `ai-provider.ts` |
| **Model Router** | `model-registry.ts` → manual failover cascade (lines 855-960) | `ai-provider.ts` → `orchestrateStream()` with chain resolution + circuit breaker |
| **Data Sources** | 6 parallel fetches in `Promise.allSettled` (lines 434-522) | `scanForLiveGame()` + `buildEvidencePacket()` (lines 274-436) |
| **Injury Data** | `team_game_context` table (pre-computed, from sync cron) | **ESPN API direct** (lines 311-353) with in-memory 5m cache |
| **Schedule** | `matches` table, 14-day window, up to 2000 rows | **Not fetched at all** |
| **Tempo** | `team_tempo` table | **Not fetched at all** |
| **RAG** | Embedding → `match_chat_knowledge` pgvector search | **Not used** |
| **System Prompt** | ~780 lines, XML-tagged, ~2,758 token worst case | ~80 lines, HTML-tagged, ~900 token worst case |
| **Stream Format** | Raw NDJSON (`JSON.stringify(...) + "\n"`) | SSE (`data: JSON.stringify(...)\n\n`) |
| **Pick Extraction** | Inline regex + JSON parsing → `ai_chat_picks` + `llm_model_picks` | LLM-based structured extraction → `ai_chat_picks` via `persistRun()` |
| **Mode Detection** | None (always full analysis prompt) | `detectMode()` + `detectTaskType()` (lines 103-124) |
| **Conversation Persist** | `conversations.update()` with messages + sources + thoughts (line 1035) | `conversations.update()` with messages + sources + thoughts (line 912) |
| **Grounding** | `googleSearch` + `codeExecution` always enabled | `googleSearch` only, via `enableGrounding` flag |
| **Provider Failover** | `getActiveModel()` → `getFallbackModel()` → last resort (3-deep) | `orchestrateStream()` → full chain (Google→OpenAI→Anthropic) with circuit breaker |

### 6.2 What This Means for the Refactor

**⚠️ CRITICAL FINDING: The frontend hits `/api/chat` (Vercel route).** The `edgeService.chat` function (line 685) does `fetch("/api/chat", ...)`. The Edge Function is called via a different path (direct Supabase Edge Function URL), presumably from a different client or for a different purpose.

This means:

1. **Tool calling must be implemented on the Vercel route first** — that's what the ChatWidget actually uses.
2. The Vercel route uses `ai-provider.ts`, which uses **raw REST API calls** (not the `@google/genai` SDK). Function calling via raw REST requires different payload construction than the SDK.
3. The Edge Function's `gemini.ts` already yields `function_call` chunks (line 294) because it uses the SDK. The Vercel route's `parseProviderSSELine()` (line 913) does **NOT** handle `functionCall` parts at all.

### 6.3 Divergence Risk: Pick Extraction

| | Edge Function | Vercel Route |
|---|---|---|
| **Extraction Method** | `extractPicksFromResponse()` — regex + JSON parsing on the raw AI text output (lines 167-358) | `extractPickStructured()` — sends AI text to a SECOND LLM call for structured extraction (lines 525-617) |
| **Validation** | No schema validation (raw insert) | `BettingPickSchema.safeParse()` via Zod (line 581) |
| **Tables Written** | `ai_chat_picks` + `llm_model_picks` (dual write) | `ai_chat_picks` only (via `persistRun()`) + `ai_chat_runs` |
| **Odds Data** | Uses `dbOdds` from pre-fetched `liveStateRes` for `opening_line` + `market_alpha` | No odds data attached (context only) |

**Implication:** When adding tool-calling for odds, the tool response data needs to be threaded to the pick persistence layer. Currently `dbOdds` is a closure variable captured from the pre-fetch. In a tool-calling model, it comes from the function response and must be stored for post-stream use.

---

## 7. AI-PROVIDER ORCHESTRATOR AUDIT

The `lib/ai-provider.ts` (1,306 lines) is your Vercel-side "Iron Curtain" orchestration layer. This is where tool-calling must be wired for the production frontend path.

### 7.1 Architecture Gaps for Function Calling

| Gap | Location | Impact | Severity |
|-----|----------|--------|----------|
| **`ProviderRequest` has no `tools` field** | Line 152-159 | Cannot pass `functionDeclarations` to provider clients | 🔴 Blocking |
| **`googleClient.chatStream()` has no `functionDeclarations` support** | Lines 360-391 | The raw Gemini REST body only adds `googleSearch` to `body.tools` (line 372-374). No `functionDeclarations` array. | 🔴 Blocking |
| **`parseProviderSSELine()` doesn't handle `functionCall` parts** | Lines 912-918 | When Gemini returns a `functionCall` part, the parser ignores it (only looks for `.text` and `.groundingMetadata`) | 🔴 Blocking |
| **`NormalizedStreamChunk` type doesn't include `function_call`** | Lines 111-118 | Type union is `"text" | "thought" | "grounding" | "done" | "error"` — no `"function_call"` or `"function_response"` | 🔴 Blocking |
| **`createNormalizingStream()` is a one-way pipe** | Lines 832-892 | It converts `ReadableStream<Uint8Array>` → `ReadableStream<NormalizedStreamChunk>`. Tool calling requires a **bidirectional** loop: read stream → detect function_call → execute tool → send response → get new stream → resume. The current architecture doesn't support this. | 🔴 Architectural |
| **No `functionResponse` sending mechanism** | N/A | After executing a tool, you need to send the result back to the same conversation turn. The current client only does `chatStream()` (fire-and-forget). | 🔴 Blocking |
| **OpenAI/Anthropic clients also lack tool support** | Lines 396-544 | When Gemini fails over to OpenAI or Anthropic, your custom `functionDeclarations` won't be passed. Each provider has its own tool format. | 🟡 Failover degradation |
| **Circuit breaker records on connection, not on content** | Line 803 | `circuitBreaker.recordSuccess()` fires when the HTTP connection succeeds, not when the model produces useful output. A model that always returns `function_call` but never `text` would be considered "healthy". | 🟢 Low risk |

### 7.2 The Streaming Architecture Problem

The current `orchestrateStream()` → `createNormalizingStream()` pipeline is a **unidirectional streaming pipe**:

```
Request → Provider.chatStream() → ReadableStream<Uint8Array>
                                         │
                                         ▼
                                  createNormalizingStream()
                                         │
                                         ▼
                          ReadableStream<NormalizedStreamChunk> → Consumer
```

Tool calling requires a **multi-turn loop**:

```
Request → Provider.chatStream() → Stream → text/thought chunks → Consumer
                                     │
                                     └── functionCall chunk detected
                                              │
                                              ▼
                              [Execute tool, get result]
                                              │
                                              ▼
                              Provider.chatStream() [NEW CALL with functionResponse]
                                              │
                                              ▼
                              Stream → text/thought chunks → Consumer
                                              │
                                              └── (potentially more function calls)
```

**This means `orchestrateStream()` must return a `ReadableStream` that internally manages the multi-turn loop.** The consumer (`api/chat.js`) sees a single, continuous stream. The loop is invisible to it.

### 7.3 `enableGrounding` Flag Interaction

Currently (line 798):

```typescript
enableGrounding: config.supportsGrounding && taskType === "grounding"
```

This means `googleSearch` is only enabled for the `"grounding"` task type. For `"analysis"` and `"chat"`, no tools are sent at all. When you add `functionDeclarations`, you need to decide:

- Do custom functions activate for ALL task types?
- Or only for specific ones (e.g., `"grounding"` and `"analysis"` but not `"chat"`)?

**Recommendation:** Custom functions should be available for `"grounding"` and `"analysis"` task types. For `"chat"` (general conversation), no functions — the model should respond directly.

---

## 8. MODEL REGISTRY & FAILOVER AUDIT

You have **two separate model registry systems** that don't know about each other.

### 8.1 Registry Comparison

| | `model-registry.ts` (Edge Function) | `ai-provider.ts` (Vercel Route) |
|---|---|---|
| **Models** | `gemini-3-flash-preview`, `gpt-5.2` | `gemini-3-pro`, `gemini-3-flash`, `gpt-5`, `gpt-5-mini`, `claude-sonnet-4-5`, `claude-haiku-4-5`, `claude-opus-4-6` |
| **Failover** | Manual: `getActiveModel()` → `getFallbackModel()` → last resort (3 try-catches) | Automatic: `resolveChain()` → `for` loop with circuit breaker |
| **Config** | `ModelConfig` interface with `reasoningEffort`, `verbosity`, `systemPromptOverride` | `ProviderConfig` interface with `costPer1kInput/Output`, `supportsGrounding` |
| **Function calling support** | N/A — not wired | N/A — not wired |
| **Cost tracking** | None | `MetricsCollector` with $50/hr ceiling |
| **Circuit breaker** | None | 3-failure threshold, 60s cooldown |

### 8.2 Model ID Mismatch

| Edge Function | Vercel Route | Same Model? |
|---------------|--------------|-------------|
| `gemini-3-flash-preview` | `gemini-3-flash` | ❓ Unclear — preview vs stable may differ |
| `gpt-5.2` | `gpt-5` / `gpt-5-mini` | ❌ Different models |
| N/A | `claude-sonnet-4-5-20250929` | Edge Function has no Anthropic |

**Implication:** Function calling behavior may differ between these model versions. `gemini-3-flash-preview` may have different FC capabilities than `gemini-3-flash`. Must verify both support FC for the same function schemas.

### 8.3 Failover and Function Calling

When Gemini fails and the system falls back to OpenAI or Anthropic:

- OpenAI has its own function calling format (`tools: [{ type: "function", function: {...} }]`)
- Anthropic has its own tool use format (`tools: [{ name: "...", input_schema: {...} }]`)
- Each returns tool calls differently: OpenAI uses `tool_calls` in `delta`, Anthropic uses `content_block` events

**Decision required:** When falling back to a non-Gemini provider, should function calling:

1. **Degrade gracefully** — system pre-fetches data and injects it into the prompt (current behavior, no tool calling)
2. **Map function schemas** — translate `functionDeclarations` into each provider's tool format
3. **Skip tool calls** — fall back without function calling capability

**Recommendation:** Option 1 (degrade gracefully) for MVP. Option 2 for v2 only if you have production evidence that fallbacks are frequent enough to warrant the complexity.

---

## 9. FRONTEND REQUEST LIFECYCLE AUDIT

### 9.1 Request Payload Construction

From `ChatWidget.tsx` line 2160-2162:

```typescript
const context: ChatContextPayload = {
  session_id, conversation_id, gameContext: currentMatch, run_id: generateId(),
};
```

And line 688: `body: JSON.stringify({ messages, ...context })`

This means the Vercel route receives:

```json
{
  "messages": [{ "role": "user", "content": "..." }, ...],
  "session_id": "uuid",
  "conversation_id": "uuid",
  "gameContext": {
    "match_id": "uuid",
    "home_team": "Lakers",
    "away_team": "Celtics",
    "league": "NBA",
    "start_time": "2026-02-08T19:00:00Z",
    "status": "SCHEDULED",
    "current_odds": { ... }
  },
  "run_id": "uuid"
}
```

**Key observations:**

1. `gameContext` is a **rich object** with `match_id`, team names, league, start_time, status, and `current_odds`. This means the frontend already knows which game is being discussed.
2. The Edge Function receives a slightly different payload: `{ messages, session_id, current_match, conversation_id, live_snapshot }` (line 398). Note: `current_match` vs `gameContext`, and `live_snapshot` is Edge-only.
3. The `current_odds` field in `gameContext` means the frontend may already have odds data at the time of the request. However, this is UI-state odds (from the last render), not necessarily real-time. **Do not trust this for analysis — the tool should always fetch fresh odds from the DB.**

### 9.2 Frontend Stream Consumption (No Changes Needed for MVP)

The `SSEParser` (lines 610-663) is **type-agnostic**. It:

1. Splits incoming bytes into lines
2. Strips `data:` prefix
3. `JSON.parse(payload) as StreamChunk`
4. Calls `onChunk(data)` for any parsed chunk

Because it casts to `StreamChunk` with `as`, it will happily pass through any JSON object, including ones with new types like `"tool_use"`. The `onChunk` handler (lines 2171-2185) uses `if (chunk.type === "...")` checks, so unknown types are silently ignored.

**This means:** For MVP, you don't need to change the frontend at all. The tool call/response cycle happens entirely on the backend. The user sees normal thinking → text behavior. If you later want to show "Fetching odds..." status, you add it as a new chunk type and a new `if` branch.

### 9.3 Retry Logic Interaction

`edgeService.chat()` retries up to `RETRY_CONFIG.maxAttempts` times (line 682). Each retry is a **completely new request** with fresh `AbortSignal` and fresh SSE parser state. This means:

- A tool call that times out will cause the entire request to retry, not just the tool
- The retry restarts from scratch (new message payload, new stream)
- This is actually fine — tool calls don't introduce new failure modes at the retry level

---

## 10. DATA SOURCE SCHEMA AUDIT (Tool Input/Output Contracts)

For each tool you'll define, here are the exact Supabase queries and their return shapes, verified from the codebase.

### 10.1 `get_schedule` Tool

**Current query** (Edge Function, lines 495-501):

```sql
SELECT id, home_team, away_team, start_time, sport, league_id
FROM matches
WHERE start_time >= $today AND start_time <= $twoWeeksOut
ORDER BY start_time ASC
LIMIT 2000
```

**Tool schema proposal:**

```json
{
  "name": "get_schedule",
  "description": "Get upcoming scheduled matches. Use when user asks about games, matchups, or slate.",
  "parameters": {
    "type": "object",
    "properties": {
      "sport": { "type": "string", "enum": ["NBA", "NFL", "NHL", "NCAAB", "MLB", "SOCCER"], "description": "Sport to filter by. Omit for all sports." },
      "date": { "type": "string", "description": "ISO date (YYYY-MM-DD). Default: today ET." },
      "days_ahead": { "type": "integer", "description": "Days forward from date. Default: 1, Max: 14." },
      "team": { "type": "string", "description": "Filter by team name (partial match)." }
    }
  }
}
```

**Return shape** (what the tool function returns to the model):

```json
{
  "matches": [
    { "id": "uuid", "home_team": "Lakers", "away_team": "Celtics", "start_time": "2026-02-08T19:00:00Z", "sport": "NBA", "league_id": "nba" }
  ],
  "count": 12,
  "date_range": "2026-02-08 to 2026-02-09"
}
```

### 10.2 `get_team_injuries` Tool

**Current query** (Edge Function, lines 481-484):

```sql
SELECT injury_notes, injury_impact, situation, rest_days, fatigue_score
FROM team_game_context
WHERE team = $team AND game_date = $today
```

**Alternative** (Vercel route, lines 311-353): ESPN API direct with 5m cache.

**Tool schema proposal:**

```json
{
  "name": "get_team_injuries",
  "description": "Get injury report and fatigue data for a team. Use before analyzing any specific matchup.",
  "parameters": {
    "type": "object",
    "properties": {
      "team": { "type": "string", "description": "Full team name (e.g., 'Los Angeles Lakers')" },
      "sport": { "type": "string", "enum": ["NBA", "NFL", "NHL", "NCAAB"], "description": "Sport league" }
    },
    "required": ["team"]
  }
}
```

**Implementation decision:** Use the DB-backed `team_game_context` table (more reliable, pre-computed by sync cron) over ESPN API direct (subject to rate limits, 5s timeout).

### 10.3 `get_team_tempo` Tool

**Current query** (Edge Function, lines 512-514):

```sql
SELECT team, pace, ortg, drtg, net_rtg, ats_record, ats_l10,
       over_record, under_record, over_l10, under_l10, rank
FROM team_tempo
WHERE team IN ($teams)
```

**Tool schema proposal:**

```json
{
  "name": "get_team_tempo",
  "description": "Get team pace, efficiency, and ATS/O-U trends. Use for quantitative analysis of team performance.",
  "parameters": {
    "type": "object",
    "properties": {
      "teams": {
        "type": "array",
        "items": { "type": "string" },
        "description": "List of team names to look up"
      }
    },
    "required": ["teams"]
  }
}
```

### 10.4 `get_live_odds` Tool

**Current source:** Embedded in `liveStateRes` → `telemetry?.state?.odds` (from `live_game_state` table).

**Tool schema proposal:**

```json
{
  "name": "get_live_odds",
  "description": "Get current and opening odds for a specific match. Use when analyzing betting value or market movement.",
  "parameters": {
    "type": "object",
    "properties": {
      "match_id": { "type": "string", "description": "UUID of the match" }
    },
    "required": ["match_id"]
  }
}
```

**⚠️ Coupling alert:** The post-stream pick persistence (lines 1048-1051, 1085-1087) depends on `dbOdds` from this source for `opening_line` and `market_alpha`. If odds become a tool response, the tool executor must cache the result for post-stream use.

### 10.5 `search_knowledge_base` Tool (RAG)

**Current source:** `executeEmbeddingQuery()` + `match_chat_knowledge` RPC (lines 455-458).

**Tool schema proposal:**

```json
{
  "name": "search_knowledge_base",
  "description": "Search the internal knowledge base for betting strategy, terminology, or historical patterns.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Natural language search query" }
    },
    "required": ["query"]
  }
}
```

### 10.6 `get_live_game_state` Tool

This is the BIG ONE. The `liveStateRes` fetch returns a complex object that feeds 7 blocks. As documented in Part 1, this should remain pre-fetched when a `match_id` is present, but could be a tool for when the model wants live data for a game the user hasn't explicitly selected.

**Tool schema proposal:**

```json
{
  "name": "get_live_game_state",
  "description": "Get live telemetry for a specific match. Includes score, clock, physics signals, recent plays, situation, and odds.",
  "parameters": {
    "type": "object",
    "properties": {
      "match_id": { "type": "string", "description": "UUID of the match" }
    },
    "required": ["match_id"]
  }
}
```

---

## 11. PICK EXTRACTION PIPELINE AUDIT

The pick extraction system is the highest-risk component in the refactor because it sits **downstream** of the data that tools provide.

### 11.1 Current Extraction Methods (Edge Function)

**Method 1: JSON block parsing** (lines 180-201)

- Regex: `/```json\s*([\s\S]*?)```/i`
- Parses AI response looking for JSON blocks with `picks` array
- Priority: Tried first

**Method 2: Raw JSON parsing** (lines 205-224)

- `JSON.parse(safeResponse.trim())`
- Falls back to trying the entire response as JSON
- Priority: Tried second

**Method 3: Regex extraction** (lines 228-355)

- Multiple regex patterns for spread, total, moneyline, verdict-specific formats
- Strips markdown bold/italic before matching
- Most fragile, most commonly triggered

### 11.2 Downstream Data Dependencies

The pick persistence logic (lines 1058-1089) constructs pick records that need:

| Field | Source | Tool Impact |
|-------|--------|-------------|
| `match_id` | From request body (`current_match.match_id`) | ✅ No change |
| `home_team` | From request body (`current_match.home_team`) | ✅ No change |
| `away_team` | From request body (`current_match.away_team`) | ✅ No change |
| `league` | From request body (`current_match.league`) | ✅ No change |
| `opening_line` | From `dbOdds?.opening?.homeSpread` (line 1048) | ⚠️ Must thread from tool response |
| `market_alpha` | Calculated from `dbOdds` (lines 1062-1066) | ⚠️ Must thread from tool response |
| `implied_probability` | Calculated from `pick_line` (line 1086) | ✅ No change (derived from pick) |
| `game_start_time` | From request body (`current_match.start_time`) | ✅ No change |

### 11.3 Refactor Strategy for Pick Persistence

**Problem:** In the current architecture, `dbOdds` is a closure variable available at pick-save time. In the tool-calling architecture, odds data comes from a tool response mid-stream.

**Solution:** Create a `ToolResultCache` that stores tool responses keyed by tool name:

```typescript
const toolCache = new Map<string, any>();
// During tool execution:
toolCache.set('get_live_odds', oddsResult);
// During pick persistence:
const dbOdds = toolCache.get('get_live_odds');
```

This is cleaner than trying to thread the data through the streaming pipeline.

---

## 12. TIMEOUT & DEADLINE AUDIT

### 12.1 Current Deadline Architecture (Edge Function)

```
Request Start ─────────────────────────────────────────────► 60s Platform Kill
   │                                                    ▲
   │                                                    │ 5s grace
   │                                            hardDeadline (55s)
   │                                        ▲
   │                                        │ 3s cleanup
   │                                DEADLINE_GRACE_MS
   │
   ├─ Pre-fetch (identity, RAG, live, etc.) ─── ~200ms typical
   ├─ System prompt construction ─── ~1ms
   ├─ Gemini TTFT ─── ~1-5s
   ├─ Gemini streaming ─── ~10-30s
   └─ Post-stream (save conv, extract picks, persist picks) ─── ~100-500ms
```

### 12.2 Tool Call Latency Impact

Each tool call adds:

1. **Tool detection** from stream: ~0ms (just reading a chunk)
2. **Tool execution** (Supabase query): 10-80ms per tool
3. **New Gemini call** with `functionResponse`: TTFT ~1-5s + streaming ~5-20s

**Worst case with chaining:** If the model calls 3 tools sequentially:

- 3 × (tool execution: 80ms + new TTFT: 3s + streaming: 10s) = ~39s
- Plus initial: pre-fetch (200ms) + first TTFT (3s) = ~3.2s
- **Total: ~42s** — within the 55s deadline, but tight.

**Worst case with parallel calls:** If the model returns 3 function calls in one response:

- Max tool execution: 80ms (parallel)
- One new TTFT: 3s + streaming: 15s
- Plus initial: pre-fetch (200ms) + first TTFT (3s) + initial streaming (1s) = ~4.2s
- **Total: ~22s** — comfortable margin.

### 12.3 Deadline Check Placement for Tool Calls

The `checkDeadline()` function (line 821) runs inside the stream iteration loop. For tool calls, you need an **additional deadline check**:

- Before executing each tool
- Before starting a new Gemini call with `functionResponse`

If the deadline is approaching, skip the tool call and continue with whatever data the model already has.

---

## 13. SUPABASE TABLE DEPENDENCY MAP

Tables that tools would query, with their key characteristics.

| Table | Used By | Primary Key | Estimated Rows | Indexed Columns | Tool Candidate |
|-------|---------|-------------|----------------|-----------------|----------------|
| `conversations` | Identity fetch | `id` (UUID) | ~10K | `id`, `session_id` | ❌ Infrastructure |
| `live_game_state` | Live telemetry | `id` (UUID) | ~50-200 active | `id`, `game_status` | 🟡 `get_live_game_state` |
| `matches` | Schedule, live match | `id` (UUID) | ~50K | `id`, `start_time`, `sport` | ✅ `get_schedule` |
| `team_game_context` | Injuries/fatigue | `(team, game_date)` composite | ~5K | `team`, `game_date` | ✅ `get_team_injuries` |
| `team_tempo` | ATS/pace data | `team` | ~100 (30 NBA + others) | `team` | ✅ `get_team_tempo` |
| `ai_chat_picks` | Pick persistence | `id` (UUID) | ~5K | `match_id`, `session_id` | ❌ Write-only |
| `llm_model_picks` | Model tracking | `id` (UUID) | ~5K | `model_id`, `match_id` | ❌ Write-only |
| `ai_chat_runs` | Run tracking | `id` (UUID) | ~5K | `conversation_id` | ❌ Write-only |

### 13.1 RPC Functions

| RPC | Purpose | Parameters | Return | Tool Candidate |
|-----|---------|------------|--------|----------------|
| `get_or_create_conversation` | Session identity | `p_session_id`, `p_match_id` | UUID | ❌ Infrastructure |
| `match_chat_knowledge` | RAG vector search | `query_embedding` (float8[]), `match_threshold`, `match_count` | `{ content, similarity }[]` | ✅ `search_knowledge_base` |

---

## 14. PROMPT ARCHITECTURE FOR TOOL CALLING

### 14.1 System Prompt Restructuring

The current system prompt (lines 680-782) includes data blocks inline. In the tool-calling model, the prompt needs to:

1. **Remove dynamic data blocks** that tools will provide
2. **Add tool-use instructions** so the model knows when to call functions
3. **Keep static instructions** (role, rules, output format)

**Before (current):**

```
<temporal_anchor>...</temporal_anchor>
<search_directive>...</search_directive>
<role>...</role>
<decision_gate>...</decision_gate>
<context>
  1. LIVE DATA: ${telemetryBlock}
  2. SIGNALS: ${signalsBlock}
  3. ODDS: ${oddsBlock}
  ...
  7. SCHEDULE: ${scheduleBlock}
  ...
</context>
<task>...</task>
```

**After (hybrid):**

```
<temporal_anchor>...</temporal_anchor>
<search_directive>...</search_directive>
<role>...</role>
<decision_gate>...</decision_gate>

<tool_guidance>
You have access to the following data tools. Call them when you need specific data:
- get_schedule: Use when user asks about upcoming games/matchups/slate
- get_team_injuries: Use BEFORE analyzing any matchup
- get_team_tempo: Use when evaluating team trends (ATS, pace, efficiency)
- get_live_odds: Use when analyzing betting value or market movement
- search_knowledge_base: Use when user asks about strategy or terminology
- get_live_game_state: Use to get live telemetry for a specific game

DO NOT call tools unless the data is needed for your response.
For greetings, general questions, or follow-ups, respond directly.
</tool_guidance>

<pre_loaded_context>
1. LIVE DATA: ${telemetryBlock}  ← ONLY when match_id is present (pre-fetched)
</pre_loaded_context>

<task>...</task>
```

### 14.2 Token Budget After Refactor

| Component | Before (tokens) | After (tokens) | Delta |
|-----------|-----------------|----------------|-------|
| Static skeleton | 868 | 868 | 0 |
| Tool guidance block | 0 | ~100 | +100 |
| `telemetryBlock` (pre-fetched, when live) | 80-500 | 80-500 | 0 |
| `signalsBlock` (pre-fetched, part of telemetry) | 0-140 | 0-140 | 0 |
| `oddsBlock` (pre-fetched, part of telemetry) | 0-80 | 0-80 | 0 |
| `scheduleBlock` (NOW A TOOL) | 200-600 | **0** | **-200 to -600** |
| `teamContextBlock` (NOW A TOOL) | 20-120 | **0** | **-20 to -120** |
| `tempoBlock` (NOW A TOOL) | 0-120 | **0** | **-0 to -120** |
| `ragContext` (NOW A TOOL) | 0-500 | **0** | **-0 to -500** |
| **TOTAL** | **1,168–2,758** | **948–1,588** | **-220 to -1,170** |

**Result:** 15-40% reduction in prompt tokens on every request. Biggest win: `scheduleBlock` no longer burns ~250 tokens on "what is a parlay?"

---

## 15. IMPLEMENTATION PRIORITY MATRIX

Based on all findings from Part 1 and Part 2:

### Phase 0: Prerequisites (Before Any Tool Code)

| Task | File(s) | Why |
|------|---------|-----|
| Resolve which route the frontend uses | `ChatWidget.tsx` line 685 | Must confirm `/api/chat` is the production path |
| Add `tools`/`functionDeclarations` to `ProviderRequest` interface | `lib/ai-provider.ts` line 152 | Type-level prerequisite |
| Add `"function_call"` to `NormalizedStreamChunk.type` | `lib/ai-provider.ts` line 112 | Type-level prerequisite |
| Add `functionCall` handling to `parseProviderSSELine()` for Google | `lib/ai-provider.ts` line 913 | Parser must recognize the chunk |

### Phase 1: Tool Execution Engine (Backend Core)

| Task | File(s) | Why |
|------|---------|-----|
| Create `tools/` directory with tool executor functions | New files | Each tool = one function returning structured data |
| Create `tool-registry.ts` with `FunctionDeclaration[]` | New file | Central source of truth for all tool schemas |
| Refactor `createNormalizingStream()` into a multi-turn loop | `lib/ai-provider.ts` lines 832-892 | Architectural change: detect `functionCall`, execute, re-call |
| Add `ToolResultCache` for post-stream data access | New utility | Thread tool results (odds) to pick persistence |

### Phase 2: Integration (Wiring)

| Task | File(s) | Why |
|------|---------|-----|
| Add `functionDeclarations` to Google REST payload | `lib/ai-provider.ts` lines 360-391 | Actually send tool schemas to Gemini |
| Remove `scheduleBlock` from system prompt on Vercel route | `api/chat.js` | Already doesn't fetch schedule — clean up prompt |
| Thread `ToolResultCache` → pick persistence | `api/chat.js` lines 900-918 | Odds from tool response → `opening_line`, `market_alpha` |
| Add deadline checks around tool execution | `api/chat.js` or `ai-provider.ts` | Prevent tool calls from blowing the timeout |

### Phase 3: Edge Function Parity (Optional)

| Task | File(s) | Why |
|------|---------|-----|
| Add function call handling in `processChunk()` | `ai-chat/index.ts` line 963 | Edge Function already detects FC chunks but ignores them |
| Remove unconditional schedule fetch | `ai-chat/index.ts` lines 491-507 | Biggest single waste |
| Add `ToolResultCache` → pick persistence | `ai-chat/index.ts` lines 1043-1118 | Thread odds data |

### Phase 4: Frontend Polish (Optional)

| Task | File(s) | Why |
|------|---------|-----|
| Extend `StreamChunk` type | `ChatWidget.tsx` line 295 | Add `"tool_use"` type |
| Handle `tool_use` chunks in `onChunk` | `ChatWidget.tsx` line 2174 | Show "Fetching odds..." in ThinkingPill |

---

## 16. RISK REGISTER

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Tool calls push response past 55s Edge Function deadline | Medium | High (truncated response) | Deadline check before each tool call; limit to 2 sequential calls max |
| 2 | Model calls unnecessary tools (e.g., `get_schedule` for "hello") | Medium | Medium (wasted latency, tokens) | Clear `<tool_guidance>` in prompt; consider `function_calling_config: { allowedFunctionNames: [...] }` per mode |
| 3 | Odds data from tool response not threaded to pick persistence | High if overlooked | High (missing `opening_line`, `market_alpha`) | `ToolResultCache` pattern documented above |
| 4 | Failover to OpenAI/Anthropic drops tool calling silently | Medium | Medium (degraded analysis quality) | Log `isFallback` + `tools_skipped` flag; pre-fetch critical data on fallback path |
| 5 | `parseProviderSSELine()` doesn't handle multi-part chunks (text + functionCall in same chunk) | Low | High (lost function call) | Parse ALL parts in Gemini response, not just the first one (line 914-918 only reads `parts?.map(p => p.text)`) |
| 6 | Two separate pick extraction pipelines (Edge regex vs Vercel LLM) diverge further | Medium | Medium (inconsistent picks) | Unify to single extraction method in Phase 3 |
| 7 | `model-registry.ts` and `ai-provider.ts` model IDs drift | Already happening | Medium (wrong model used) | SSOT: single model registry, imported by both routes |
| 8 | Adding tools increases Gemini token usage (function schemas count as input tokens) | Certain | Low (~200 extra tokens from 6 tool schemas) | Minimal — well within budget |

---

## REFERENCES

All line numbers reference the codebase at commit-time (2026-02-08). File paths are relative to project root.

- `ai-chat/index.ts` — Supabase Edge Function (1,155 lines)
- `api/chat.js` — Vercel API Route (938 lines)
- `lib/ai-provider.ts` — Multi-provider orchestrator (1,306 lines)
- `_shared/gemini.ts` — Gemini SDK wrapper (368 lines)
- `_shared/openai.ts` — GPT-5.2 adapter (62 lines)
- `_shared/llm-adapter.ts` — Unified LLM interfaces (134 lines)
- `_shared/model-registry.ts` — Edge Function model config (68 lines)
- `src/components/ChatWidget.tsx` — Frontend chat component (2,418 lines)
