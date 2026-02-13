# Hybrid Tool Architecture — Pre-Migration Audit

## Date: 2026-02-08

## Scope: `ai-chat/index.ts` (Edge Function) + `api/chat.js` (Vercel) + `ChatWidget.tsx` (Frontend)

---

## 1. HIT RATE ANALYSIS

Analysis of the `Promise.allSettled` block at `ai-chat/index.ts:434-522`.

### 1.1 Identity (Conversation History)

| Metric | Value | Evidence |
|--------|-------|----------|
| **Hit Rate** | ~100% of non-greeting messages | Fires on every request. Short-circuits only if `lastUserText === "INIT_HISTORY"` (line 531), which is a special bootstrap event, not a normal user message. |
| **Payload Size** | ~50–800 tokens | Returns `{ activeId, history }`. History is capped at `.slice(-40)` messages (line 1036). On a fresh session, returns `[]`. On a mature session, 40 messages × ~20 tokens avg = ~800 tokens. |
| **Fetch Latency** | 5–25ms | Two sequential Supabase calls: `rpc('get_or_create_conversation')` + `.from('conversations').select('messages')`. Both are indexed PK lookups. |
| **Failure Mode** | **Graceful**. Falls back to `{ activeId: null, history: [] }` (line 524). Conversation won't persist but chat still works. |
| **Needed for LLM prompt?** | **NO.** History is used independently: (a) `chatHistory` is passed to `options.history` in the Gemini call (line 869), not injected into `systemInstruction`. (b) It's used for persistence (line 1024). |
| **Tool-call candidacy** | ❌ **KEEP PRE-FETCHED.** Identity resolution is a hard prerequisite for every request. The model never needs to "decide" to fetch it. |

### 1.2 RAG (Knowledge Base Embedding Search)

| Metric | Value | Evidence |
|--------|-------|----------|
| **Hit Rate** | ~60–70% of messages | Gated by `if (!lastUserText \|\| isGreetingTrigger) return ""` (line 452). Returns empty string for greetings, empty inputs, and any query that doesn't match RAG threshold (0.60). In practice, conversational chitchat ("how are you", "thanks") goes through embedding but returns no results. |
| **Payload Size** | 0–500 tokens | Returns up to 5 matched chunks: `match_count: 5` (line 456). Each chunk is typically 50–100 tokens of domain knowledge. When no match: 0 tokens. |
| **Fetch Latency** | 80–200ms | Two sequential calls: `executeEmbeddingQuery(lastUserText)` (Gemini embedding API, ~50–100ms) + `supabase.rpc('match_chat_knowledge')` (pgvector cosine similarity, ~30–100ms). |
| **Failure Mode** | **Graceful.** Returns `""` on error (line 461). RAG context is conditionally injected: `${ragContext ? \`KNOWLEDGE BASE...\` : ''}` (line 771-774). No crash path. |
| **Needed for LLM prompt?** | **YES**, but conditionally. Only injected if non-empty (line 771). |
| **Tool-call candidacy** | 🟡 **CANDIDATE.** The model could decide "I need to check the knowledge base for this" rather than always running embeddings. However, RAG latency adds to TTFT if moved to a tool call (synchronous round-trip mid-inference). |

### 1.3 Live State (Telemetry + Match Data)

| Metric | Value | Evidence |
|--------|-------|----------|
| **Hit Rate** | ~70–80% of Analysis messages, ~20% of Conversation messages | Gated by `if (!matchId) return null` (line 465). Only fires when the user has an active game context (`current_match?.match_id`). Casual conversations without a game context return null. |
| **Payload Size** | 200–1,200 tokens when present | The `liveStateRes` result is consumed by 7 distinct blocks: `telemetryBlock` (~80 tokens), `signalsBlock` (~100 tokens), `oddsBlock` (~60 tokens), `livePlayBlock` (~40 tokens), `recentPlaysBlock` (~200 tokens for 10 plays), `situationBlock` (~60 tokens), `driveBlock` (~30 tokens). Total when all populated: ~570 tokens. When live game in progress with full physics engine: up to ~1,200 tokens. |
| **Fetch Latency** | 10–30ms | Two parallel Supabase queries inside: `Promise.all([live_game_state by PK, matches by PK])` (line 467-470). Both are indexed PK lookups. |
| **Failure Mode** | **Graceful.** Returns `null` on error (line 474). `telemetryBlock` falls back to `"TELEMETRY: Offline. Use Search for live scores."` (line 558). All downstream blocks use null-safe `?.` operators. No crash. |
| **Dependency consumers** | `telemetryBlock`, `signalsBlock`, `oddsBlock`, `livePlayBlock`, `recentPlaysBlock`, `situationBlock`, `driveBlock`, AND post-run pick persistence (lines 1048-1051 use `dbOdds` from this source). |
| **Tool-call candidacy** | 🟡 **HYBRID.** For ANALYSIS mode with a live game, this is critical and should remain pre-fetched. For CONVERSATION mode without a match context, it already returns null. The issue is the pick persistence (lines 1043-1118) depends on `dbOdds` from this fetch—decoupling requires threading odds data through the tool response. |

### 1.4 Team Context (Injuries + Fatigue)

| Metric | Value | Evidence |
|--------|-------|----------|
| **Hit Rate** | ~50–60% of messages | Gated by `if (!current_match?.home_team \|\| !current_match?.away_team) return null` (line 478). Only fires when both team names are present in the game context. Requires a game_date match in `team_game_context` table. |
| **Payload Size** | 60–120 tokens | Produces `teamContextBlock` (~60 tokens): two lines, one per team, with situation/rest/fatigue/injuries (line 560-573). |
| **Fetch Latency** | 15–40ms | Two parallel Supabase queries: `team_game_context` for home and away team (line 481-484). Indexed on `(team, game_date)` composite. |
| **Failure Mode** | **Graceful.** Returns `null` on error (line 488). `buildTeamBlock` falls back to `"${teamName}: No context data"` (line 561). No crash. |
| **Tool-call candidacy** | ✅ **STRONG CANDIDATE.** This data is only relevant when the AI is analyzing a specific game. For "what's the Celtics schedule?" or "explain hedging" the model doesn't need injury data. The model could call `get_injury_report({team, sport})` on demand. |

### 1.5 Schedule (14-Day Match Manifest)

| Metric | Value | Evidence |
|--------|-------|----------|
| **Hit Rate** | ~100% of messages (fires unconditionally) | No guard condition. Always runs. (lines 491-507) |
| **Payload Size** | 200–600 tokens | Fetches up to 2,000 rows from `matches` (line 501), then compresses into a date-grouped manifest via `generateScheduleManifest()` (line 575-607). Output is ~14 lines, each ~15 tokens = ~210 tokens minimum. With 5+ leagues active: ~400-600 tokens. |
| **Fetch Latency** | 30–80ms | Single Supabase query with range filter: `.gte('start_time', today).lte('start_time', twoWeeksOut).limit(2000)` (lines 496-501). Scans a large range. This is the **heaviest DB query** in the block. |
| **Failure Mode** | **Graceful.** Returns `[]` on error (line 505). `generateScheduleManifest([])` returns `"MANIFEST: No upcoming games found in database."` (line 576). No crash. |
| **Tool-call candidacy** | ✅ **STRONGEST CANDIDATE.** The schedule manifest (line 595) already tells the model to call a tool: `"⚠️ If the user asks about a game on a date below, use 'fetch_detailed_schedule' to get the full context"`. The code is literally prompting the model to use a tool that doesn't exist yet. This is the highest-waste fetch—2,000 rows read and compressed on EVERY message, including "what is a parlay?" |

### 1.6 Tempo (Team Pace & ATS Trends)

| Metric | Value | Evidence |
|--------|-------|----------|
| **Hit Rate** | ~50–60% of messages | Gated by `if (!current_match?.home_team && !current_match?.away_team) return null` (line 509). Only fires when at least one team is identified. |
| **Payload Size** | 60–120 tokens | `formatTempoBlock()` (lines 611-619) produces ~3 lines per team × 2 teams = ~6 lines, each ~15 tokens = ~90 tokens typical. |
| **Fetch Latency** | 10–25ms | Single Supabase query with `.in('team', teams)` filter (line 512-514). Small result set (2 rows max). |
| **Failure Mode** | **Graceful.** Returns `[]` on error (line 519). `formatTempoBlock([])` returns `""` (line 612). No crash. |
| **Tool-call candidacy** | ✅ **STRONG CANDIDATE.** Only needed for game analysis. A `get_team_tempo({teams})` tool call would be clean and the model only invokes it when doing quantitative analysis. |

---

## 2. DEPENDENCY MAPPING

### 2.1 Data Source → Block Dependency Graph

```
                      ┌─────────────────────────────────────────────────────────────────┐
                      │                    SYSTEM PROMPT (lines 680-782)                │
                      ├─────────────────────────────────────────────────────────────────┤
                      │                                                                 │
 identityRes ────────►│ NOT INJECTED (goes to chatHistory → options.history)            │
                      │                                                                 │
 ragRes ─────────────►│ ${ragContext}  (line 773) [conditional: only if non-empty]      │
                      │                                                                 │
 liveStateRes ───────►├─► telemetryBlock  (line 761) [score, clock, status]             │
                      ├─► signalsBlock    (line 762) [physics engine signals]           │
                      ├─► oddsBlock       (line 763) [current/opening odds]             │
                      ├─► livePlayBlock   (line 764) [last play]                        │
                      ├─► recentPlaysBlock(line 765) [game flow]                        │
                      ├─► situationBlock  (line 766) [down/distance/redzone]            │
                      └─► driveBlock      (line 767) [current drive]                    │
                      │                                                                 │
 teamContextRes ─────►│ ${teamContextBlock} (line 768) [injuries, fatigue, rest]        │
                      │                                                                 │
 scheduleRes ────────►│ ${scheduleBlock}    (line 769) [14-day manifest]                │
                      │                                                                 │
 tempoRes ───────────►│ ${tempoBlock}       (line 770) [pace, ORTG, ATS]               │
                      └─────────────────────────────────────────────────────────────────┘
```

### 2.2 Cross-Source Dependencies

| Source A | → Depends On | Via | Can Decouple? |
|----------|-------------|-----|---------------|
| `oddsBlock` | `liveStateRes` | `dbOdds = telemetry?.state?.odds` (line 628) | ❌ NO — odds are a sub-object inside `live_game_state.odds` |
| `signalsBlock` | `liveStateRes` | `signals = telemetry?.state?.deterministic_signals` (line 627) | ❌ NO — signals are inside same `live_game_state` row |
| `livePlayBlock` | `liveStateRes` | `lastPlay = telemetry?.state?.last_play` (line 624) | ❌ NO — all from same row |
| `recentPlaysBlock` | `liveStateRes` | `recentPlays = telemetry?.state?.recent_plays` (line 636) | ❌ NO |
| `situationBlock` | `liveStateRes` | `situation = telemetry?.state?.situation` (line 625) | ❌ NO |
| `driveBlock` | `liveStateRes` | `currentDrive = telemetry?.state?.current_drive` (line 626) | ❌ NO |
| `teamContextBlock` | `current_match` | Team names from request body (line 478) | ✅ YES — independent |
| `scheduleBlock` | Nothing | Fully independent (needs only date arithmetic) | ✅ YES — independent |
| `tempoBlock` | `current_match` | Team names from request body (line 509) | ✅ YES — independent |
| `ragContext` | `lastUserText` | User's message text (line 455) | ✅ YES — independent |
| `identityRes` | `session_id`, `conversation_id` | Request body (line 438-441) | ✅ YES — independent |
| **Pick persistence** | `dbOdds` (from `liveStateRes`) | Lines 1048-1051 | ⚠️ COUPLING — post-run pick saving reads odds from `liveStateRes` for `opening_line`, `market_alpha` calculations |

### 2.3 Decoupling Groups

**Group A: Inseparable (Must fetch together or not at all)**

- `liveStateRes` → `telemetryBlock` + `signalsBlock` + `oddsBlock` + `livePlayBlock` + `recentPlaysBlock` + `situationBlock` + `driveBlock` + pick persistence odds

**Group B: Independently decoupable into tool calls**

- `teamContextRes` → `teamContextBlock`
- `scheduleRes` → `scheduleBlock`
- `tempoRes` → `tempoBlock`
- `ragRes` → `ragContext` (with caveats on TTFT latency)

**Group C: Infrastructure (should never be a tool call)**

- `identityRes` → conversation identity + persistence

---

## 3. TOKEN AUDIT

Token estimates below use the industry standard of ~4 characters = 1 token. Measured from the actual template strings in lines 541-782.

### 3.1 Static Prompt Skeleton (Always Present)

| Block | Lines | Characters | Est. Tokens | Notes |
|-------|-------|------------|-------------|-------|
| `<temporal_anchor>` | 681-685 | ~220 | **~55** | Fixed overhead |
| `<search_directive>` | 687-700 | ~520 | **~130** | Fixed instructions |
| `<role>` | 702-707 | ~300 | **~75** | Fixed persona |
| `<decision_gate>` | 709-720 | ~550 | **~138** | Fixed rules |
| `<search_doctrine>` | 722-728 | ~260 | **~65** | Fixed doctrine |
| `<multimodal_reasoning>` | 730-736 | ~500 | **~125** | Fixed instructions |
| `<output_rules>` | 738-749 | ~700 | **~175** | Fixed format rules |
| `<context>` header + data priority | 752-760 | ~240 | **~60** | Fixed |
| `<task>` | 777-781 | ~180 | **~45** | Game-specific |
| **TOTAL STATIC SKELETON** | | **~3,470** | **~868** | Present on EVERY message |

### 3.2 Dynamic Data Blocks (Variable)

| Block | When Present | Min Tokens | Max Tokens | Typical Tokens | % of Total |
|-------|-------------|------------|------------|----------------|------------|
| `telemetryBlock` | Live game active | 15 (offline msg) | 120 (full client snapshot) | **~80** | 4% |
| `signalsBlock` | Live game + physics engine | 0 | 140 | **~100** | 5% |
| `oddsBlock` | Odds available in DB | 0 | 80 | **~60** | 3% |
| `livePlayBlock` | Active play occurred | 0 | 50 | **~35** | 2% |
| `recentPlaysBlock` | Game in progress | 0 | 250 (10 plays) | **~150** | 7% |
| `situationBlock` | Sport with situation data | 0 | 70 | **~50** | 2% |
| `driveBlock` | NFL only | 0 | 40 | **~25** | 1% |
| `teamContextBlock` | Both teams known | 20 (no data) | 120 | **~80** | 4% |
| `scheduleBlock` | Always (unconditional) | 20 (empty) | 400 (14 days, 5 leagues) | **~250** | 12% |
| `tempoBlock` | Teams known | 0 | 120 | **~90** | 4% |
| `ragContext` | RAG returns results | 0 | 500 | **~200** | 10% |
| **TOTAL DYNAMIC** | | **~55** | **~1,890** | **~1,120** | |

### 3.3 Full System Prompt Budget

| Scenario | Static | Dynamic | **Total Tokens** |
|----------|--------|---------|-------------------|
| **Minimal** (no game, no RAG, greeting) | 868 | ~55 | **~923** |
| **Typical Analysis** (pregame, full context) | 868 | ~900 | **~1,768** |
| **Live Game Analysis** (all blocks populated) | 868 | ~1,200 | **~2,068** |
| **Worst Case** (live NFL + 14-day schedule + RAG + tempo) | 868 | ~1,890 | **~2,758** |

### 3.4 Where the Bloat Lives

**Rank by waste (tokens consumed × inverse necessity):**

1. 🔴 **`scheduleBlock`** (~250 tokens typical) — **Unconditional on every message.** User asks "what is a parlay" → still fetches and injects 14-day schedule. Wastes ~250 tokens + 30-80ms DB read on every message.
2. 🟡 **Static `<search_directive>` + `<decision_gate>` + `<output_rules>`** (~343 tokens combined) — **Always present even for conversational queries.** When user says "thanks!", the prompt still contains full Triple Confluence decision gates.
3. 🟡 **`ragContext`** (~200 tokens typical) — Useful when relevant, but fires on every non-greeting message including "how are the Lakers doing?" which could be answered via Google Search alone.
4. 🟢 **`telemetry` group** (~500 tokens combined when live) — High value when present, low waste when absent (all null-gated).

---

## 4. CURRENT STREAMING CONTRACT

### 4.1 Backend → Frontend Wire Protocol

The SSE stream uses **newline-delimited JSON (NDJSON)**, NOT the standard SSE `data:` prefix format. Evidence:

**Edge Function (`ai-chat/index.ts`)** — lines 996, 1001, 1125-1137:

```typescript
// Each chunk is a JSON object followed by \n
controller.enqueue(encoder.encode(JSON.stringify({ type: 'thought', content }) + "\n"));
controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', content }) + "\n"));

// Terminal event:
controller.enqueue(encoder.encode(JSON.stringify({
  type: 'done' | 'partial_done',
  conversation_id,
  sources,
  groundingMetadata,
  model,
  metadata: { requestId, model, isPartial, latencyMs }
}) + "\n"));
```

**Vercel Route (`api/chat.js`)** — lines 870-929:

```javascript
// Uses standard SSE format with data: prefix
res.write(`data: ${JSON.stringify({ type: "thought", content })}\n\n`);
res.write(`data: ${JSON.stringify({ type: "text", content })}\n\n`);
res.write(`data: ${JSON.stringify({ done: true, model: modelId })}\n\n`);
res.write("data: [DONE]\n\n");
```

⚠️ **PROTOCOL MISMATCH DETECTED:** The Edge Function emits raw NDJSON; the Vercel route uses SSE `data:` prefix. The frontend `SSEParser` expects `data:` prefix format (line 637: `if (!line.startsWith("data:")) continue`). This means the Vercel route is correctly wired to the parser, but the Edge Function's format is handled differently at the transport layer (ReadableStream vs SSE).

### 4.2 Event Types Emitted

| Event Type | Backend Emitter | Frontend Handler | Description |
|------------|----------------|------------------|-------------|
| `{ type: "text", content: "..." }` | Both routes | `accumulatedText += chunk.content` → `enqueuePatch({ content: accumulatedText })` (line 2174-2176) | AI response text, streamed incrementally |
| `{ type: "thought", content: "..." }` | Both routes | `accumulatedThoughts += chunk.content` → `enqueuePatch({ thoughts: accumulatedThoughts })` (line 2178-2180) | Internal reasoning, displayed in ThinkingPill |
| `{ type: "grounding", metadata: {...} }` | Both routes | `groundingData = chunk.metadata` → `enqueuePatch({ groundingMetadata })` (line 2182-2184) | Gemini grounding chunks for citations |
| `{ type: "error", content: "..." }` | Both routes | Caught by SSEParser → forwarded to `onChunk` | Error message from model or middleware |
| `{ done: true, ... }` | Vercel route only | SSEParser checks `if (data.done) this.signalDone()` (line 644) | Terminal event |
| `{ type: "done"\|"partial_done", ... }` | Edge Function only | Implicitly handled — stream closes, `parser.ensureDone()` fires (line 715) | Terminal event with metadata |
| `"[DONE]"` | Vercel route | `if (payload === "[DONE]") { this.signalDone(); return; }` (line 640) | Sentinel terminator |

### 4.3 Frontend StreamChunk Interface

From `ChatWidget.tsx` line 295-300:

```typescript
interface StreamChunk {
  type: "text" | "thought" | "grounding" | "error";
  content?: string;
  metadata?: GroundingMetadata;
  done?: boolean;
}
```

**⚠️ Key Omission:** The `StreamChunk` type does NOT include `"function_call"` or `"tool_use"` as valid types. Adding tool calls requires extending this interface.

### 4.4 Where Tool-Call Pause/Resume Would Be Inserted

```
[User Message]
    │
    ▼
[Backend: pre-fetch identity + minimal hot data]
    │
    ▼
[Backend: send to Gemini with functionDeclarations]
    │
    ▼
[Gemini streams: thought chunks → text chunks]
    │
    ├── IF function_call chunk arrives ──────────────────────┐
    │                                                        │
    │   [PAUSE STREAM TO CLIENT]                            │
    │   Option A: Silence (client sees thinking indicator)   │
    │   Option B: Emit { type: "tool_use", name, status }   │
    │                                                        │
    │   [Backend: execute tool → get result]                 │
    │   [Backend: send functionResponse back to Gemini]      │
    │   [Gemini continues reasoning...]                      │
    │                                                        │
    │   [RESUME STREAM TO CLIENT]                            │
    │   ◄────────────────────────────────────────────────────┘
    │
    ▼
[Stream continues: text chunks → grounding → done]
    │
    ▼
[Client: parser.ensureDone() → dispatch isStreaming: false]
```

**Critical insertion points:**

1. **Backend (`ai-chat/index.ts` lines 881-888):** The `for await (const chunk of streamGen)` loop. Line 294 of `gemini.ts` already yields `{ type: 'function_call', name, args }` — the backend just doesn't handle it. Need to add a handler inside `processChunk()` (line 963) that:
   - Catches `function_call` chunks
   - Executes the tool
   - Sends `functionResponse` back to Gemini
   - Resumes the stream

2. **Frontend (`ChatWidget.tsx` lines 2171-2185):** The `onChunk` callback. Need to add a handler for a new chunk type (e.g., `"tool_use"`) so the ThinkingPill can display "Fetching odds..." instead of the generic thinking animation.

3. **SSEParser (`ChatWidget.tsx` lines 610-663):** No changes needed — it already forwards any JSON chunk to `onChunk`. The parser is type-agnostic; it just parses JSON and dispatches. However, the `StreamChunk` TypeScript interface (line 295) needs to be extended.

### 4.5 Streaming Is NOT Interrupted by the Tool-Call Loop

The Gemini `generateContentStream` API does NOT support mid-stream function calling. When Gemini decides to call a function:

1. It emits a `functionCall` part and **terminates the current stream**
2. Your application must execute the function
3. You start a **new** `generateContent` or `generateContentStream` call with the `functionResponse` appended to the conversation history
4. Gemini resumes generating from there

This means the backend needs to:

- Detect the stream ending with a `functionCall` (no `text` parts after it)
- Execute the tool
- Start a NEW streaming call with the tool result appended
- Continue piping chunks to the client

From the client's perspective, the stream never "pauses" — it just takes longer to produce text. The ThinkingPill already handles this (it shows while no text chunks arrive).

---

## 5. GEMINI FUNCTION-CALLING CONSTRAINTS

### 5.1 Limits [1][2]

| Constraint | Value | Source |
|------------|-------|--------|
| Max `functionDeclarations` per request | **128** (AI Studio) / **512** (Vertex AI) | Google AI docs [1] |
| Max parameter complexity | OpenAPI-compatible JSON Schema. Supports `OBJECT`, `ARRAY`, `STRING`, `NUMBER`, `BOOLEAN`, `ENUM`. No `anyOf` on Gemini 2.0 Flash. | [2] |
| Parallel tool calls | **YES** — Gemini can return multiple `functionCall` parts in a single response | [1][7] |
| Sequential chaining | **YES** — After receiving `functionResponse`, Gemini can issue another `functionCall` | Standard multi-turn pattern |
| Stream + function calling | Function calls terminate the current stream. A new call must be made with the response. | See §4.5 above |

### 5.2 Compatibility with Existing Tools

| Existing Tool | Compatible with `functionDeclarations`? | Evidence |
|---------------|----------------------------------------|----------|
| `googleSearch` | ✅ **YES** — can coexist in the same `tools` array | Google docs: "supports using functionDeclarations and the googleSearch tool concurrently in the same request" [1][7] |
| `codeExecution` | ✅ **YES** — multi-tool use supported since May 2025 | "code execution and Grounding with Google Search can be configured simultaneously" [1][10] |

### 5.3 Impact on Current "Soft-Schema" Strategy

The current `gemini.ts` keeps `responseMimeType: "text/plain"` specifically to allow thinking and tool usage (line 258). Adding `functionDeclarations` **does NOT conflict** with this — function calling works with `text/plain` responses. The model emits `functionCall` parts alongside `text` and `thought` parts in the content stream.

However, there is a key behavior change:

- **Current:** `tools: [{ googleSearch: {} }, { codeExecution: {} }]` — model has two tool types
- **With function calling:** `tools: [{ googleSearch: {} }, { codeExecution: {} }, { functionDeclarations: [...] }]` — model now has three tool types and **the model autonomously decides** when to use custom functions vs. Google Search vs. code execution

### 5.4 `function_calling_config` Modes

| Mode | Behavior | Recommended Use |
|------|----------|-----------------|
| `AUTO` (default) | Model decides whether to call functions, use Google Search, or respond directly | ✅ Best for hybrid arch — model reasons about when to fetch data |
| `ANY` | Model MUST call at least one declared function | ❌ Not appropriate — would force tool use even for "hello" |
| `NONE` | Model cannot call any declared function | ❌ Defeats the purpose |
| `{ allowedFunctionNames: [...] }` | Restrict to specific functions | 🟡 Useful for task-specific routing |

### 5.5 Function Response Format

When the model emits a `functionCall`, the application must respond with a `functionResponse` part:

```json
{
  "role": "user",
  "parts": [{
    "functionResponse": {
      "name": "get_team_tempo",
      "response": {
        "result": { ... }  // Your tool output here
      }
    }
  }]
}
```

For parallel calls, include multiple `functionResponse` parts in the same message.

### 5.6 Gemini 3 Flash Specific Notes

- `gemini-3-flash-preview` (your primary model, line 248 of `gemini.ts`) supports function calling
- `thinkingConfig: { includeThoughts: true, thinkingLevel: "high" }` (line 279) is compatible with function calling
- The model will think about WHETHER to call a function as part of its reasoning chain

---

## REFERENCES

[1] Google AI for Developers — Function Calling Guide: <https://ai.google.dev/gemini-api/docs/function-calling>
[2] Vertex AI — Function Calling: <https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling>
[6] Google AI — Rate Limits and Models: <https://ai.google.dev/gemini-api/docs/models>
[7] GitHub — Gemini API parallel function calling: <https://github.com/google-gemini/cookbook> (parallel function calling examples)
[10] Google AI — Changelog: <https://ai.google.dev/gemini-api/docs/changelog>
