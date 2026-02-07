/* ═══════════════════════════════════════════════════════════════════════════
   ai-provider.ts
   Iron Curtain — Multi-Provider AI Orchestration Layer  v5.0

   Production-grade fallback engine with per-provider circuit breakers,
   abort-aware jittered retry, cost tracking, unified streaming normalization,
   and three-provider web search grounding (Google Search, OpenAI Responses API,
   Anthropic Web Search Tool).

   v5.0 Changelog (Hardening Pass)
   ├─ FIX   Google API key moved from URL query param → x-goog-api-key header
   ├─ FIX   Silent catch blocks → structured diagnostic logging
   ├─ FIX   Serverless-aware observability (documented per-instance limits,
   │         optional PersistenceAdapter hook for Redis/Supabase)
   ├─ FIX   detectTaskType rewritten with weighted scoring + expanded lexicon
   ├─ ADD   Response shape guards per provider (fail-fast on malformed JSON)
   ├─ ADD   Structured logger (log.info / log.warn / log.error) — JSON format
   └─ ADD   Provider-specific prompt tuning in shapePrompt()

   Architecture
   ├─ §0  Types & Configuration
   │   ├─ §0.1  Public Types (Strict Readonly)
   │   ├─ §0.2  Internal Types (incl. Responses API + Web Search types)
   │   └─ §0.3  Provider Registry & Fallback Chains
   ├─ §1  Provider Clients
   │   ├─ §1.1  Resilient Fetch (Timeout + Abort-Aware Retry + Backoff)
   │   ├─ §1.2  Google (Gemini) — Google Search Grounding + Safety Filter
   │   ├─ §1.3  OpenAI — Chat Completions + Responses API (Web Search)
   │   └─ §1.4  Anthropic — Messages API + Web Search Tool
   ├─ §2  Message Adapters
   ├─ §3  Prompt Shaping
   ├─ §4  Fallback Engine
   │   ├─ §4.1  orchestrate()    — Request/Response
   │   ├─ §4.2  orchestrateStream() — SSE Streaming
   │   └─ §4.3  Stream Normalization & SSE Parsing
   ├─ §5  Observability
   │   ├─ §5.1  Structured Logger
   │   ├─ §5.2  Metrics Collector (Ring Buffer)
   │   ├─ §5.3  Circuit Breaker (Closed → Open → Half-Open)
   │   └─ §5.4  Health Report
   ├─ §6  Utilities
   │   ├─ §6.1  Task Detection (Weighted Scoring)
   │   └─ §6.2  Pick Extraction
   ├─ §7  API Handlers
   │   ├─ §7.1  Node.js Handler (Universal)
   │   └─ §7.2  App Router (Edge)
   └─ §8  Exports
═══════════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════════════
// §0  TYPES & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

// ── §0.1  Public Types ─────────────────────────────────────────────────────

export type ProviderName = "google" | "openai" | "anthropic";

export type TaskType =
  | "grounding"    // Live data: scores, odds, stats
  | "analysis"     // Edge detection, reasoning, structured output
  | "chat"         // General conversation
  | "vision"       // Image classification / OCR
  | "code"         // Code generation, debugging
  | "recruiting";  // Candidate sourcing & matching

export interface ProviderConfig {
  readonly provider: ProviderName;
  readonly model: string;
  readonly timeoutMs: number;
  readonly costPer1kInput: number;
  readonly costPer1kOutput: number;
  readonly supportsGrounding: boolean;
  readonly supportsStreaming: boolean;
  readonly maxRetries: number;
}

export interface WireMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string | ReadonlyArray<MessagePart>;
}

export interface MessagePart {
  readonly type: "text" | "image" | "file";
  readonly text?: string;
  readonly source?: {
    readonly type: "base64";
    readonly media_type: string;
    readonly data: string;
  };
}

export interface NormalizedResponse {
  readonly content: string;
  readonly groundingMetadata: GroundingMetadata | null;
  readonly thoughts: string | null;
  readonly servedBy: ProviderName;
  readonly model: string;
  readonly isFallback: boolean;
  readonly chainPosition: number;
  readonly latencyMs: number;
  readonly estimatedCostUsd: number;
}

export interface NormalizedStreamChunk {
  readonly type: "text" | "thought" | "grounding" | "done" | "error";
  readonly content?: string;
  readonly metadata?: GroundingMetadata;
  servedBy?: ProviderName;
  model?: string;
  isFallback?: boolean;
}

export interface GroundingMetadata {
  readonly groundingChunks?: ReadonlyArray<{
    readonly web?: {
      readonly uri: string;
      readonly title?: string;
    };
  }>;
  readonly searchEntryPoint?: { readonly renderedContent: string };
  readonly webSearchQueries?: ReadonlyArray<string>;
}

export interface OrchestrateOptions {
  readonly gameContext?: Record<string, unknown> | null;
  readonly signal?: AbortSignal;
  readonly systemPrompt?: string;
  readonly onFallback?: (from: ProviderConfig, to: ProviderConfig, reason: string) => void;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly forceProvider?: ProviderName;
}

export interface HealthReport {
  readonly circuits: Record<ProviderName, CircuitState>;
  readonly enabled: Record<ProviderName, boolean>;
  readonly metrics: MetricsSummary;
  readonly costCeiling: {
    readonly limitPerHour: number;
    readonly currentHourlySpend: number;
    readonly isOverBudget: boolean;
  };
}

export interface MetricsSummary {
  readonly totalCostUsd: number;
  readonly totalRequests: number;
  readonly byProvider: Record<string, ProviderMetrics>;
}

export interface ProviderMetrics {
  requests: number;
  failures: number;
  avgLatencyMs: number;
  costUsd: number;
}

/**
 * Optional persistence adapter for serverless environments.
 *
 * In serverless (Vercel, Cloudflare Workers), module-level singletons reset
 * on every cold start. Circuit breaker state and cost ceilings are therefore
 * per-instance — NOT global.
 *
 * To get true cross-instance observability, implement this interface with
 * Redis, Supabase, or Upstash and call `installPersistence()`.
 * Without it, circuit breakers and cost ceilings still work within a warm
 * instance's lifetime (typically 5–15 minutes on Vercel).
 */
export interface PersistenceAdapter {
  getCircuitFailures(provider: ProviderName): Promise<number>;
  setCircuitFailures(provider: ProviderName, count: number, ttlMs?: number): Promise<void>;
  getHourlyCost(): Promise<number>;
  incrHourlyCost(amount: number, ttlMs?: number): Promise<void>;
}

// ── §0.2  Internal Types ───────────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half-open";
type ErrorType = "auth" | "rate_limit" | "server" | "timeout" | "stream_error" | "circuit_open" | "safety_block" | "unknown";

interface ProviderClient {
  chat(request: ProviderRequest): Promise<ProviderRawResponse>;
  chatStream(request: ProviderRequest): Promise<ReadableStream<Uint8Array>>;
}

interface ProviderRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<WireMessage>;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
  readonly enableGrounding?: boolean;
  readonly retries: number;
}

interface ProviderRawResponse {
  readonly content: string;
  readonly groundingMetadata?: GroundingMetadata;
  readonly thoughts?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly _searchCost?: number;
}

interface MetricsEntry {
  readonly provider: ProviderName;
  readonly model: string;
  readonly taskType: string;
  readonly status: string;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly timestamp: number;
}

interface PickExtractionResult {
  readonly ok: boolean;
  readonly data: unknown;
  readonly raw?: string;
  readonly provider: ProviderName;
  readonly model: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: GroundingMetadata;
    finishReason?: string;
  }>;
  groundingMetadata?: GroundingMetadata;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: GroundingMetadata;
  }>;
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAIStreamChunk {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
}

interface AnthropicStreamChunk {
  type: string;
  delta?: { type?: string; text?: string; thinking?: string };
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    content?: Array<AnthropicWebSearchResult>;
  };
}

interface AnthropicWebSearchResult {
  type: string;
  url?: string;
  title?: string;
}

interface AnthropicCitation {
  type: string;
  cited_text?: string;
  url?: string;
  title?: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  citations?: AnthropicCitation[];
  name?: string;
  input?: { query?: string };
  content?: Array<AnthropicWebSearchResult>;
}

interface OpenAIResponsesResult {
  output?: Array<OpenAIResponsesOutputItem>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

interface OpenAIResponsesOutputItem {
  type: string;
  content?: Array<{
    type: string;
    text?: string;
    annotations?: Array<OpenAIAnnotation>;
  }>;
}

interface OpenAIAnnotation {
  type: string;
  url?: string;
  title?: string;
}

interface OpenAIResponsesStreamEvent {
  type: string;
  delta?: string;
}

// ── §0.3  Provider Registry & Fallback Chains ──────────────────────────────

const MODELS = {
  google: {
    primary: "gemini-3-pro",
    fast: "gemini-3-flash",
  },
  openai: {
    primary: "gpt-5",
    fast: "gpt-5-mini",
  },
  anthropic: {
    primary: "claude-sonnet-4-5-20250929",
    fast: "claude-haiku-4-5",
    deep: "claude-opus-4-6",
  },
} as const;

const PROVIDER_DEFAULTS: Record<ProviderName, Omit<ProviderConfig, "provider" | "model">> = {
  google: {
    timeoutMs: 30_000,
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
    supportsGrounding: true,
    supportsStreaming: true,
    maxRetries: 1,
  },
  openai: {
    timeoutMs: 60_000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    supportsGrounding: true,
    supportsStreaming: true,
    maxRetries: 1,
  },
  anthropic: {
    timeoutMs: 60_000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    supportsGrounding: true,
    supportsStreaming: true,
    maxRetries: 1,
  },
};

function makeConfig(
  provider: ProviderName,
  model: string,
  overrides: Partial<Omit<ProviderConfig, "provider" | "model">> = {},
): ProviderConfig {
  return Object.freeze({ provider, model, ...PROVIDER_DEFAULTS[provider], ...overrides });
}

const FALLBACK_CHAINS: Record<TaskType, readonly ProviderConfig[]> = {
  grounding: [
    makeConfig("google",    MODELS.google.primary),
    makeConfig("openai",    MODELS.openai.primary),
    makeConfig("anthropic", MODELS.anthropic.primary),
  ],
  analysis: [
    makeConfig("anthropic", MODELS.anthropic.primary),
    makeConfig("openai",    MODELS.openai.primary),
    makeConfig("google",    MODELS.google.primary),
  ],
  chat: [
    makeConfig("google",    MODELS.google.fast,     { timeoutMs: 15_000 }),
    makeConfig("openai",    MODELS.openai.fast,     { timeoutMs: 20_000 }),
    makeConfig("anthropic", MODELS.anthropic.fast,  { timeoutMs: 20_000 }),
  ],
  vision: [
    makeConfig("anthropic", MODELS.anthropic.primary),
    makeConfig("openai",    MODELS.openai.primary),
    makeConfig("google",    MODELS.google.primary),
  ],
  code: [
    makeConfig("anthropic", MODELS.anthropic.primary),
    makeConfig("openai",    MODELS.openai.primary),
    makeConfig("google",    MODELS.google.primary),
  ],
  recruiting: [
    makeConfig("openai",    MODELS.openai.primary),
    makeConfig("anthropic", MODELS.anthropic.primary),
    makeConfig("google",    MODELS.google.primary),
  ],
};

const TASK_TEMPERATURES: Record<TaskType, number> = {
  grounding: 0.3, analysis: 0.5, chat: 0.7, vision: 0.2, code: 0.3, recruiting: 0.5,
};

const TASK_MAX_TOKENS: Record<TaskType, number> = {
  grounding: 4_000, analysis: 8_000, chat: 2_000, vision: 2_000, code: 8_000, recruiting: 4_000,
};

// ═══════════════════════════════════════════════════════════════════════════
// §1  PROVIDER CLIENTS
// ═══════════════════════════════════════════════════════════════════════════

// ── §1.1  Resilient Fetch (Abort-Aware) ────────────────────────────────────

function env(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) return process.env[key];
  if (typeof globalThis !== "undefined") {
    // @ts-ignore - Build time agnostic env access
    return (globalThis as any).Deno?.env?.get(key) ?? undefined;
  }
  return undefined;
}

const ENV_KEYS: Record<ProviderName, string> = {
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const ENV_ALIASES: Partial<Record<ProviderName, string>> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

function isProviderEnabled(provider: ProviderName): boolean {
  return !!(env(ENV_KEYS[provider]) || env(ENV_ALIASES[provider] ?? ""));
}

function requireKey(provider: ProviderName): string {
  const key = env(ENV_KEYS[provider]) || env(ENV_ALIASES[provider] ?? "");
  if (!key) throw new ProviderError(provider, `${ENV_KEYS[provider]} not set`, "auth");
  return key;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  provider: ProviderName,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new DOMException("Aborted", "AbortError");
    }
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new ProviderError(provider, `Timeout after ${timeoutMs}ms`, "timeout");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  retries: number,
  provider: ProviderName,
): Promise<Response> {
  let attempt = 0;

  while (true) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs, provider);
      if (res.ok || (res.status >= 400 && res.status < 429 && res.status !== 408)) {
        return res;
      }
      if (attempt >= retries) return res;

      const delay = Math.min(1_000 * Math.pow(2, attempt), 3_000) + Math.random() * 100;
      log.warn("fetch_retry", { provider, attempt, status: res.status, delayMs: Math.round(delay) });
      await sleepWithSignal(delay, options.signal ?? undefined);
      attempt++;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (attempt >= retries) throw err;

      log.warn("fetch_retry_error", {
        provider, attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      await sleepWithSignal(500 + Math.random() * 100, options.signal ?? undefined);
      attempt++;
    }
  }
}

async function readErrorBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 512); } catch { return ""; }
}

// ── §1.2  Google (Gemini) ──────────────────────────────────────────────────
// v5.0 FIX: API key moved from URL query param to x-goog-api-key header.
// Query params leak into CDN logs, proxy logs, and Vercel function logs.

const googleClient: ProviderClient = {
  async chat(req) {
    const apiKey = requireKey("google");
    const body: Record<string, unknown> = {
      contents: toGeminiFormat(req.messages),
      generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
    };

    const systemText = extractSystemText(req.messages);
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    if (req.enableGrounding) body.tools = [{ googleSearch: {} }];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent`;
    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: req.signal,
      },
      30_000, req.retries, "google"
    );

    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("google", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }

    const data = (await res.json()) as GeminiResponse;
    assertGeminiShape(data);

    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    if (!content && candidate?.finishReason === "SAFETY") {
      throw new ProviderError("google", "Safety filter triggered", "safety_block");
    }

    return {
      content,
      groundingMetadata: candidate?.groundingMetadata ?? data.groundingMetadata ?? undefined,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },

  async chatStream(req) {
    const apiKey = requireKey("google");
    const body: Record<string, unknown> = {
      contents: toGeminiFormat(req.messages),
      generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
    };

    const systemText = extractSystemText(req.messages);
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    if (req.enableGrounding) body.tools = [{ googleSearch: {} }];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:streamGenerateContent?alt=sse`;
    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: req.signal,
      },
      30_000, req.retries, "google"
    );

    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("google", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }
    if (!res.body) throw new ProviderError("google", "Empty response body", "server");
    return res.body;
  },
};

// ── §1.3  OpenAI ───────────────────────────────────────────────────────────

const openaiClient: ProviderClient = {
  async chat(req) {
    const apiKey = requireKey("openai");

    if (req.enableGrounding) {
      const systemText = extractSystemText(req.messages);
      const body: Record<string, unknown> = {
        model: req.model,
        input: toOpenAIResponsesInput(req.messages),
        tools: [{ type: "web_search" }],
        stream: false,
        store: false,
      };
      if (systemText) body.instructions = systemText;

      const res = await fetchWithRetry(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: req.signal,
        },
        60_000, req.retries, "openai"
      );

      if (!res.ok) throw new ProviderError("openai", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));

      const data = (await res.json()) as OpenAIResponsesResult;
      assertOpenAIResponsesShape(data);

      const messageItem = data.output?.find((o) => o.type === "message");
      const textBlock = messageItem?.content?.find((c) => c.type === "output_text");
      const searchCalls = data.output?.filter((o) => o.type === "web_search_call").length ?? 0;

      return {
        content: textBlock?.text ?? "",
        groundingMetadata: openaiAnnotationsToGrounding(textBlock?.annotations ?? []),
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        _searchCost: searchCalls * 0.01,
      };
    }

    const res = await fetchWithRetry(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildOpenAIChatBody(req, false)),
        signal: req.signal,
      },
      60_000, req.retries, "openai"
    );

    if (!res.ok) throw new ProviderError("openai", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));

    const data = (await res.json()) as OpenAIResponse;
    assertOpenAIChatShape(data);

    return {
      content: data.choices?.[0]?.message?.content ?? "",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  },

  async chatStream(req) {
    const apiKey = requireKey("openai");
    const endpoint = req.enableGrounding
      ? "https://api.openai.com/v1/responses"
      : "https://api.openai.com/v1/chat/completions";

    let body: any;
    if (req.enableGrounding) {
      const systemText = extractSystemText(req.messages);
      body = {
        model: req.model,
        input: toOpenAIResponsesInput(req.messages),
        tools: [{ type: "web_search" }],
        stream: true,
        store: false,
      };
      if (systemText) body.instructions = systemText;
    } else {
      body = buildOpenAIChatBody(req, true);
    }

    const res = await fetchWithRetry(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: req.signal,
      },
      60_000, req.retries, "openai"
    );

    if (!res.ok) throw new ProviderError("openai", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    if (!res.body) throw new ProviderError("openai", "Empty response body", "server");
    return res.body;
  },
};

function toOpenAIResponsesInput(messages: ReadonlyArray<WireMessage>): Array<Record<string, unknown>> {
  return messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: typeof m.content === "string"
      ? m.content
      : m.content.map(p =>
          p.type === "text"
            ? { type: "input_text", text: p.text }
            : { type: "input_image", image_url: `data:${p.source!.media_type};base64,${p.source!.data}` }
        ),
  }));
}

function openaiAnnotationsToGrounding(annotations: OpenAIAnnotation[]): GroundingMetadata | undefined {
  if (!annotations?.length) return undefined;
  const urls = annotations
    .filter((a) => a.type === "url_citation")
    .map(a => ({ web: { uri: a.url!, title: a.title } }));
  return urls.length ? { groundingChunks: urls, webSearchQueries: [] } : undefined;
}

function buildOpenAIChatBody(req: ProviderRequest, stream: boolean) {
  return {
    model: req.model,
    messages: toOpenAIFormat(req.messages),
    temperature: req.temperature,
    max_completion_tokens: req.maxTokens,
    stream,
  };
}

// ── §1.4  Anthropic ────────────────────────────────────────────────────────

const ANTHROPIC_WEB_SEARCH_BETA = "web-search-2025-03-05";

const anthropicClient: ProviderClient = {
  async chat(req) {
    const apiKey = requireKey("anthropic");
    const { systemPrompt, messages } = splitSystemPrompt(req.messages);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
    const body: Record<string, unknown> = {
      model: req.model,
      system: systemPrompt,
      messages: toAnthropicFormat(messages),
      temperature: req.temperature,
      max_tokens: req.maxTokens,
    };

    if (req.enableGrounding) {
      headers["anthropic-beta"] = ANTHROPIC_WEB_SEARCH_BETA;
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
    }

    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      { method: "POST", headers, body: JSON.stringify(body), signal: req.signal },
      60_000, req.retries, "anthropic"
    );

    if (!res.ok) throw new ProviderError("anthropic", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));

    const data = (await res.json()) as AnthropicResponse;
    assertAnthropicShape(data);

    const textBlocks = data.content?.filter((b) => b.type === "text") ?? [];
    const thinkBlocks = data.content?.filter((b) => b.type === "thinking") ?? [];
    const grounding = req.enableGrounding ? anthropicCitationsToGrounding(data.content ?? []) : undefined;
    const searchCalls = data.usage?.server_tool_use?.web_search_requests ?? 0;

    return {
      content: textBlocks.map((b) => b.text ?? "").join(""),
      thoughts: thinkBlocks.length > 0 ? thinkBlocks.map((b) => b.thinking ?? "").join("") : undefined,
      groundingMetadata: grounding,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      _searchCost: searchCalls * 0.01,
    };
  },

  async chatStream(req) {
    const apiKey = requireKey("anthropic");
    const { systemPrompt, messages } = splitSystemPrompt(req.messages);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
    const body: Record<string, unknown> = {
      model: req.model,
      system: systemPrompt,
      messages: toAnthropicFormat(messages),
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      stream: true,
    };

    if (req.enableGrounding) {
      headers["anthropic-beta"] = ANTHROPIC_WEB_SEARCH_BETA;
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
    }

    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      { method: "POST", headers, body: JSON.stringify(body), signal: req.signal },
      60_000, req.retries, "anthropic"
    );

    if (!res.ok) throw new ProviderError("anthropic", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    if (!res.body) throw new ProviderError("anthropic", "Empty response body", "server");
    return res.body;
  },
};

function anthropicCitationsToGrounding(contentBlocks: AnthropicContentBlock[]): GroundingMetadata | undefined {
  const urls: Array<{ web: { uri: string; title?: string } }> = [];
  const queries: string[] = [];
  for (const block of contentBlocks) {
    if (block.type === "server_tool_use" && block.name === "web_search") queries.push(block.input?.query ?? "");
    if (block.type === "web_search_tool_result" && block.content) {
      block.content.forEach((r) => { if (r.url) urls.push({ web: { uri: r.url, title: r.title } }); });
    }
    if (block.type === "text" && block.citations) {
      block.citations.forEach((c) => { if (c.url) urls.push({ web: { uri: c.url, title: c.title } }); });
    }
  }
  return (urls.length || queries.length) ? { groundingChunks: urls, webSearchQueries: queries } : undefined;
}

const CLIENTS: Record<ProviderName, ProviderClient> = {
  google: googleClient,
  openai: openaiClient,
  anthropic: anthropicClient,
};

// ═══════════════════════════════════════════════════════════════════════════
// §1.5  Response Shape Guards
// ═══════════════════════════════════════════════════════════════════════════
// v5.0: Fail fast on malformed provider responses instead of silently
// returning empty strings. Each guard checks minimum structure required.

function assertGeminiShape(data: unknown): asserts data is GeminiResponse {
  if (!data || typeof data !== "object") {
    throw new ProviderError("google", "Response is not an object", "server");
  }
  const d = data as Record<string, unknown>;
  if (d.candidates !== undefined && !Array.isArray(d.candidates)) {
    throw new ProviderError("google", `Unexpected candidates type: ${typeof d.candidates}`, "server");
  }
}

function assertOpenAIChatShape(data: unknown): asserts data is OpenAIResponse {
  if (!data || typeof data !== "object") {
    throw new ProviderError("openai", "Response is not an object", "server");
  }
  const d = data as Record<string, unknown>;
  if (d.choices !== undefined && !Array.isArray(d.choices)) {
    throw new ProviderError("openai", `Unexpected choices type: ${typeof d.choices}`, "server");
  }
}

function assertOpenAIResponsesShape(data: unknown): asserts data is OpenAIResponsesResult {
  if (!data || typeof data !== "object") {
    throw new ProviderError("openai", "Responses API: not an object", "server");
  }
  const d = data as Record<string, unknown>;
  if (d.output !== undefined && !Array.isArray(d.output)) {
    throw new ProviderError("openai", `Responses API: unexpected output type: ${typeof d.output}`, "server");
  }
}

function assertAnthropicShape(data: unknown): asserts data is AnthropicResponse {
  if (!data || typeof data !== "object") {
    throw new ProviderError("anthropic", "Response is not an object", "server");
  }
  const d = data as Record<string, unknown>;
  if (d.content !== undefined && !Array.isArray(d.content)) {
    throw new ProviderError("anthropic", `Unexpected content type: ${typeof d.content}`, "server");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// §2  MESSAGE ADAPTERS
// ═══════════════════════════════════════════════════════════════════════════

function extractSystemText(messages: ReadonlyArray<WireMessage>): string {
  const system = messages.find((m) => m.role === "system");
  return typeof system?.content === "string" ? system.content : "";
}

function splitSystemPrompt(messages: ReadonlyArray<WireMessage>): { systemPrompt: string; messages: WireMessage[] } {
  return {
    systemPrompt: extractSystemText(messages),
    messages: messages.filter((m) => m.role !== "system"),
  };
}

function toGeminiFormat(messages: ReadonlyArray<WireMessage>) {
  return messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: typeof m.content === "string"
      ? [{ text: m.content }]
      : m.content.map(p =>
          p.type === "text"
            ? { text: p.text }
            : { inlineData: { mimeType: p.source!.media_type, data: p.source!.data } }
        ),
  }));
}

function toOpenAIFormat(messages: ReadonlyArray<WireMessage>) {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string"
      ? m.content
      : m.content.map(p =>
          p.type === "text"
            ? { type: "text", text: p.text }
            : { type: "image_url", image_url: { url: `data:${p.source!.media_type};base64,${p.source!.data}` } }
        ),
  }));
}

function toAnthropicFormat(messages: ReadonlyArray<WireMessage>) {
  return messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role,
    content: typeof m.content === "string"
      ? m.content
      : m.content.map(p =>
          p.type === "text"
            ? { type: "text", text: p.text }
            : { type: "image", source: p.source }
        ),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// §3  PROMPT SHAPING
// ═══════════════════════════════════════════════════════════════════════════

const GROUNDING_PATTERNS = [
  /search (?:for |the )?(?:current|latest|live|real[- ]time)\b[^.]*./gi,
  /use (?:google )?search (?:grounding|to find)\b[^.]*./gi,
  /look up (?:current|latest|live)\b[^.]*./gi,
  /verify (?:with|using|via) (?:search|grounding|google)\b[^.]*./gi,
] as const;

function shapePrompt(
  messages: ReadonlyArray<WireMessage>,
  config: ProviderConfig,
  taskType: TaskType,
  options: OrchestrateOptions,
): WireMessage[] {
  let systemContent = options.systemPrompt ?? extractSystemText(messages);
  const nonSystem = messages.filter((m) => m.role !== "system");

  // ── Strip grounding instructions from non-grounding providers ──
  if (!config.supportsGrounding && taskType === "grounding") {
    for (const pattern of GROUNDING_PATTERNS) {
      systemContent = systemContent.replace(pattern, "");
    }
    systemContent = systemContent.replace(/\n{3,}/g, "\n\n").trim();

    if (options.gameContext) {
      systemContent += `\n\n--- CURRENT GAME CONTEXT (injected, not live) ---\n` +
        `${JSON.stringify(options.gameContext, null, 2)}\n` +
        `--- END CONTEXT ---\n` +
        `Note: This data was provided at request time and may not reflect real-time changes.`;
    }
  }

  // ── Provider-specific prompt tuning ──
  if (config.provider === "anthropic" && (taskType === "vision" || taskType === "analysis")) {
    systemContent += "\n\nWhen providing structured analysis, use clear section headers and maintain consistent formatting.";
  }

  if (config.provider === "google" && taskType === "grounding") {
    systemContent += "\n\nCite your sources. Include specific numbers, timestamps, and data points from search results.";
  }

  if (config.provider === "openai" && taskType === "analysis") {
    systemContent += "\n\nBe precise with numerical claims. Structure your reasoning step by step.";
  }

  return [{ role: "system", content: systemContent }, ...nonSystem];
}

// ═══════════════════════════════════════════════════════════════════════════
// §4  FALLBACK ENGINE
// ═══════════════════════════════════════════════════════════════════════════

// ── §4.1  orchestrate() ────────────────────────────────────────────────────

export async function orchestrate(
  taskType: TaskType,
  messages: ReadonlyArray<WireMessage>,
  options: OrchestrateOptions = {},
): Promise<NormalizedResponse> {
  const chain = resolveChain(taskType, options);
  if (!chain.length) throw new Error("No active providers enabled. Set at least one API key.");

  let lastError: Error | null = null;
  const defaults = { temperature: TASK_TEMPERATURES[taskType], maxTokens: TASK_MAX_TOKENS[taskType] };

  for (let i = 0; i < chain.length; i++) {
    const config = chain[i];
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (circuitBreaker.isOpen(config.provider)) {
      log.info("circuit_open_skip", { provider: config.provider, taskType });
      metrics.record(config, taskType, "circuit_open", 0, 0);
      continue;
    }
    if (metrics.isOverBudget()) throw new Error(`Cost ceiling ($${COST_CEILING_PER_HOUR}/hr) reached.`);

    const shaped = shapePrompt(messages, config, taskType, options);
    const start = performance.now();

    try {
      const raw = await CLIENTS[config.provider].chat({
        model: config.model,
        messages: shaped,
        temperature: options.temperature ?? defaults.temperature,
        maxTokens: options.maxTokens ?? defaults.maxTokens,
        signal: options.signal,
        enableGrounding: config.supportsGrounding && taskType === "grounding",
        retries: config.maxRetries,
      });

      const latencyMs = Math.round(performance.now() - start);
      const normalized = normalizeResponse(raw, config, i, latencyMs);

      metrics.record(config, taskType, "success", latencyMs, normalized.estimatedCostUsd);
      circuitBreaker.recordSuccess(config.provider);

      log.info("orchestrate_success", {
        provider: config.provider, model: config.model, taskType,
        latencyMs, costUsd: normalized.estimatedCostUsd, chainPosition: i,
      });

      return normalized;
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorType: ErrorType = err instanceof ProviderError ? (err.errorType as ErrorType) : "unknown";

      metrics.record(config, taskType, errorType, latencyMs, 0);
      if (errorType !== "safety_block") circuitBreaker.recordFailure(config.provider);

      log.error("orchestrate_failure", {
        provider: config.provider, model: config.model, taskType,
        errorType, latencyMs, message: lastError.message, chainPosition: i,
      });

      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (i < chain.length - 1) options.onFallback?.(config, chain[i + 1], lastError.message);
    }
  }

  throw lastError ?? new Error("All providers failed.");
}

// ── §4.2  orchestrateStream() ──────────────────────────────────────────────

export async function orchestrateStream(
  taskType: TaskType,
  messages: ReadonlyArray<WireMessage>,
  options: OrchestrateOptions = {},
): Promise<ReadableStream<NormalizedStreamChunk>> {
  const chain = resolveChain(taskType, options);
  if (!chain.length) throw new Error("No active providers enabled.");

  let lastError: Error | null = null;
  const defaults = { temperature: TASK_TEMPERATURES[taskType], maxTokens: TASK_MAX_TOKENS[taskType] };

  for (let i = 0; i < chain.length; i++) {
    const config = chain[i];
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (circuitBreaker.isOpen(config.provider)) continue;
    if (metrics.isOverBudget()) throw new Error("Cost ceiling reached.");

    const shaped = shapePrompt(messages, config, taskType, options);
    const start = performance.now();

    try {
      const rawStream = await CLIENTS[config.provider].chatStream({
        model: config.model,
        messages: shaped,
        temperature: options.temperature ?? defaults.temperature,
        maxTokens: options.maxTokens ?? defaults.maxTokens,
        signal: options.signal,
        enableGrounding: config.supportsGrounding && taskType === "grounding",
        retries: config.maxRetries,
      });

      circuitBreaker.recordSuccess(config.provider);
      log.info("stream_connected", { provider: config.provider, model: config.model, taskType, chainPosition: i });
      return createNormalizingStream(rawStream, config, i, start, taskType);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      circuitBreaker.recordFailure(config.provider);

      log.error("stream_connect_failure", {
        provider: config.provider, model: config.model, taskType,
        message: lastError.message, chainPosition: i,
      });

      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (i < chain.length - 1) options.onFallback?.(config, chain[i + 1], lastError.message);
    }
  }

  throw lastError ?? new Error("All providers failed.");
}

// ── §4.3  Stream Normalization ─────────────────────────────────────────────

function createNormalizingStream(
  rawStream: ReadableStream<Uint8Array>,
  config: ProviderConfig,
  chainPosition: number,
  startMs: number,
  taskType: string,
): ReadableStream<NormalizedStreamChunk> {
  const decoder = new TextDecoder();
  let buffer = "";
  let charCount = 0;
  let droppedChunks = 0;

  return new ReadableStream<NormalizedStreamChunk>({
    async start(controller) {
      const reader = rawStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            try {
              const chunk = parseSSELine(line, config.provider);
              if (chunk) {
                chunk.servedBy = config.provider;
                chunk.model = config.model;
                chunk.isFallback = chainPosition > 0;
                if (chunk.type === "text" && chunk.content) charCount += chunk.content.length;
                controller.enqueue(chunk);
              }
            } catch (parseErr) {
              droppedChunks++;
              log.warn("sse_parse_error", {
                provider: config.provider,
                line: line.slice(0, 200),
                error: parseErr instanceof Error ? parseErr.message : String(parseErr),
                droppedTotal: droppedChunks,
              });
            }
          }
        }

        // Flush remaining buffer
        if (buffer.trim()) {
          try {
            const chunk = parseSSELine(buffer, config.provider);
            if (chunk) {
              chunk.servedBy = config.provider;
              chunk.model = config.model;
              chunk.isFallback = chainPosition > 0;
              controller.enqueue(chunk);
            }
          } catch (parseErr) {
            droppedChunks++;
            log.warn("sse_parse_error_flush", {
              provider: config.provider,
              error: parseErr instanceof Error ? parseErr.message : String(parseErr),
            });
          }
        }

        const latencyMs = Math.round(performance.now() - startMs);
        const estCost = (Math.ceil(charCount / 4) / 1000) * config.costPer1kOutput;
        metrics.record(config, taskType, "success", latencyMs, estCost);

        if (droppedChunks > 0) {
          log.warn("stream_completed_with_drops", {
            provider: config.provider, droppedChunks, charCount, latencyMs,
          });
        }

        controller.enqueue({ type: "done" });
        controller.close();
      } catch (err) {
        const latencyMs = Math.round(performance.now() - startMs);
        metrics.record(config, taskType, "stream_error", latencyMs, 0);

        log.error("stream_read_error", {
          provider: config.provider,
          error: err instanceof Error ? err.message : "Stream error",
          charCountBeforeError: charCount,
          latencyMs,
        });

        controller.enqueue({ type: "error", content: err instanceof Error ? err.message : "Stream error" });
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });
}

function parseSSELine(line: string, provider: ProviderName): NormalizedStreamChunk | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) return null;

  let payload = trimmed;
  if (trimmed.startsWith("data:")) {
    payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return { type: "done" };
  }

  // JSON.parse will throw on malformed data — caught by caller with structured logging
  const data = JSON.parse(payload);

  if (provider === "google") {
    const c = (data as GeminiStreamChunk).candidates?.[0];
    if (c?.groundingMetadata) return { type: "grounding", metadata: c.groundingMetadata };
    const t = c?.content?.parts?.map((p) => p.text ?? "").join("");
    return t ? { type: "text", content: t } : null;
  }

  if (provider === "openai") {
    if ((data as any).type?.startsWith("response.")) {
      const evt = data as OpenAIResponsesStreamEvent;
      if (evt.type === "response.output_text.delta") return { type: "text", content: evt.delta };
      if (evt.type === "response.completed") return { type: "done" };
      return null;
    }
    const t = (data as OpenAIStreamChunk).choices?.[0]?.delta?.content;
    return t ? { type: "text", content: t } : null;
  }

  if (provider === "anthropic") {
    const d = data as AnthropicStreamChunk;
    if (d.type === "content_block_delta") {
      if (d.delta?.type === "text_delta") return { type: "text", content: d.delta.text };
      if (d.delta?.type === "thinking_delta") return { type: "thought", content: d.delta.thinking };
    }
    if (d.type === "content_block_start" && d.content_block?.type === "web_search_tool_result") {
      const urls = d.content_block.content
        ?.filter((r) => r.type === "web_search_result")
        .map((r) => ({ web: { uri: r.url!, title: r.title } }));
      if (urls?.length) return { type: "grounding", metadata: { groundingChunks: urls, webSearchQueries: [] } };
    }
    return d.type === "message_stop" ? { type: "done" } : null;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// §5  OBSERVABILITY
// ═══════════════════════════════════════════════════════════════════════════

const COST_CEILING_PER_HOUR = 50;
const METRICS_RING_SIZE = 1000;

// ── §5.1  Structured Logger ────────────────────────────────────────────────
// JSON-formatted structured logging. In serverless (Vercel), console output
// goes to the function's log stream and is searchable in the dashboard.
// Filter with: {"level":"ERROR"} or {"event":"orchestrate_failure"}

const log = {
  info(event: string, data?: Record<string, unknown>): void {
    console.log(JSON.stringify({ level: "INFO", event, ts: new Date().toISOString(), ...data }));
  },
  warn(event: string, data?: Record<string, unknown>): void {
    console.warn(JSON.stringify({ level: "WARN", event, ts: new Date().toISOString(), ...data }));
  },
  error(event: string, data?: Record<string, unknown>): void {
    console.error(JSON.stringify({ level: "ERROR", event, ts: new Date().toISOString(), ...data }));
  },
} as const;

// ── §5.2  Metrics Collector ────────────────────────────────────────────────
//
// ⚠ SERVERLESS CAVEAT: This ring buffer resets on every cold start.
// In Vercel/Cloudflare, each instance maintains its own counter.
// Cost ceiling enforcement is per-instance, not global.
//
// For global enforcement, implement PersistenceAdapter with Redis or
// Supabase and call installPersistence(). Without it, these metrics
// are best-effort within a warm instance's lifetime (~5–15 min).

let persistence: PersistenceAdapter | null = null;

export function installPersistence(adapter: PersistenceAdapter): void {
  persistence = adapter;
  log.info("persistence_installed", { adapter: adapter.constructor?.name ?? "custom" });
}

class MetricsCollector {
  private ring: Array<MetricsEntry | null>;
  private cursor = 0;
  private count = 0;
  private hourlyCost = 0;
  private lastHourReset = Date.now();

  constructor(private readonly capacity = METRICS_RING_SIZE) {
    this.ring = new Array(capacity).fill(null);
  }

  record(config: ProviderConfig, taskType: string, status: string, latencyMs: number, costUsd: number): void {
    this.resetHourIfStale();
    this.hourlyCost += costUsd;

    // Fire-and-forget persistence write (non-blocking)
    if (persistence && costUsd > 0) {
      persistence.incrHourlyCost(costUsd, 3_600_000).catch((e) =>
        log.warn("persistence_cost_write_failed", { error: String(e) })
      );
    }

    const entry: MetricsEntry = {
      provider: config.provider, model: config.model, taskType,
      status, latencyMs, costUsd, timestamp: Date.now(),
    };

    this.ring[this.cursor] = entry;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  isOverBudget(): boolean {
    this.resetHourIfStale();
    return this.hourlyCost > COST_CEILING_PER_HOUR;
  }

  getSummary(windowMinutes = 60): MetricsSummary {
    const cutoff = Date.now() - windowMinutes * 60_000;
    const byProvider: Record<string, ProviderMetrics> = {};
    let totalCost = 0;
    let totalRequests = 0;

    for (let i = 0; i < this.count; i++) {
      const entry = this.ring[i];
      if (!entry || entry.timestamp <= cutoff) continue;

      totalRequests++;
      totalCost += entry.costUsd;

      if (!byProvider[entry.provider]) {
        byProvider[entry.provider] = { requests: 0, failures: 0, avgLatencyMs: 0, costUsd: 0 };
      }
      const p = byProvider[entry.provider];

      const prevTotal = p.avgLatencyMs * p.requests;
      p.requests++;
      if (entry.status !== "success") p.failures++;
      p.avgLatencyMs = Math.round((prevTotal + entry.latencyMs) / p.requests);
      p.costUsd += entry.costUsd;
    }

    return { totalCostUsd: totalCost, totalRequests, byProvider };
  }

  private resetHourIfStale(): void {
    if (Date.now() - this.lastHourReset > 3_600_000) {
      this.hourlyCost = 0;
      this.lastHourReset = Date.now();
    }
  }
}

// ── §5.3  Circuit Breaker ──────────────────────────────────────────────────
// Same serverless caveat as metrics: failure counts reset on cold start.
// With PersistenceAdapter, failure counts survive across instances.

class CircuitBreakerManager {
  private failures: Record<string, number> = {};
  private lastFailure: Record<string, number> = {};
  private halfOpenProbe: Record<string, boolean> = {};

  recordSuccess(provider: ProviderName): void {
    this.failures[provider] = 0;
    this.halfOpenProbe[provider] = false;

    if (persistence) {
      persistence.setCircuitFailures(provider, 0).catch((e) =>
        log.warn("persistence_circuit_write_failed", { provider, error: String(e) })
      );
    }
  }

  recordFailure(provider: ProviderName): void {
    this.failures[provider] = (this.failures[provider] ?? 0) + 1;
    this.lastFailure[provider] = Date.now();
    this.halfOpenProbe[provider] = false;

    if (persistence) {
      persistence.setCircuitFailures(provider, this.failures[provider], 120_000).catch((e) =>
        log.warn("persistence_circuit_write_failed", { provider, error: String(e) })
      );
    }
  }

  isOpen(provider: ProviderName): boolean {
    const fails = this.failures[provider] ?? 0;
    if (fails < 3) return false;

    const elapsed = Date.now() - (this.lastFailure[provider] ?? 0);
    if (elapsed >= 60_000) {
      if (!this.halfOpenProbe[provider]) {
        this.halfOpenProbe[provider] = true;
        return false; // Allow probe
      }
      return true; // Probe in flight
    }
    return true; // Cooldown active
  }

  getStatus(): Record<ProviderName, CircuitState> {
    const s: any = {};
    for (const p of ["google", "openai", "anthropic"] as ProviderName[]) {
      if ((this.failures[p] ?? 0) < 3) s[p] = "closed";
      else s[p] = (Date.now() - (this.lastFailure[p] ?? 0) >= 60_000) ? "half-open" : "open";
    }
    return s;
  }
}

const metrics = new MetricsCollector();
const circuitBreaker = new CircuitBreakerManager();

// ═══════════════════════════════════════════════════════════════════════════
// §6  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export class ProviderError extends Error {
  public readonly name = "ProviderError" as const;
  constructor(
    public readonly provider: ProviderName,
    message: string,
    public readonly errorType: string,
  ) {
    super(`[${provider}] ${message}`);
  }
}

function classifyHttpError(status: number): ErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "unknown";
}

function normalizeResponse(
  raw: ProviderRawResponse,
  config: ProviderConfig,
  chainPosition: number,
  latencyMs: number,
): NormalizedResponse {
  const inputCost = (raw.inputTokens / 1_000) * config.costPer1kInput;
  const outputCost = (raw.outputTokens / 1_000) * config.costPer1kOutput;

  return {
    content: raw.content,
    groundingMetadata: raw.groundingMetadata ?? null,
    thoughts: raw.thoughts ?? null,
    servedBy: config.provider,
    model: config.model,
    isFallback: chainPosition > 0,
    chainPosition,
    latencyMs,
    estimatedCostUsd: inputCost + outputCost + (raw._searchCost ?? 0),
  };
}

function resolveChain(taskType: TaskType, options: OrchestrateOptions): ProviderConfig[] {
  if (options.forceProvider) {
    const chain = FALLBACK_CHAINS[taskType];
    const forced = chain.find((c) => c.provider === options.forceProvider);
    if (forced && isProviderEnabled(forced.provider)) return [forced];
  }
  return FALLBACK_CHAINS[taskType].filter((c) => isProviderEnabled(c.provider)) as ProviderConfig[];
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function safeParseJSON(raw: string): { success: true; data: unknown } | { success: false; raw: string } {
  if (!raw) return { success: false, raw: "" };
  let text = raw.trim().replace(/^`+(?:json)?/i, "").replace(/`+$/i, "").trim();
  const first = text.search(/[\[{]/);
  if (first > 0) text = text.slice(first);
  const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (last >= 0) text = text.slice(0, last + 1);
  try { return { success: true, data: JSON.parse(text) }; } catch { return { success: false, raw }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// §6.1  Task Detection (Weighted Scoring)
// ═══════════════════════════════════════════════════════════════════════════
//
// v5.0: Replaced brittle keyword list with weighted scoring system.
// Each signal word adds weight to its category. Highest total wins.
// Compound phrases (2+ words) get bonus weight for precision.
// Minimum threshold of 3 prevents false routing on ambiguous queries.

const GROUNDING_LEXICON: ReadonlyArray<readonly [string, number]> = [
  // ── Live data / scores ──
  ["odds",        3], ["score",       3], ["line",        2], ["spread",      3],
  ["moneyline",   3], ["over under",  3], ["o/u",         3], ["total",       1],
  ["prop",        2], ["parlay",      2], ["injury",      2], ["injured",     2],
  ["questionable",2], ["doubtful",    2], ["probable",    1], ["out for",     2],
  ["game time",   2], ["tip off",     2], ["tipoff",      2], ["kickoff",     2],
  ["first pitch", 2], ["puck drop",   2],
  // ── Recency signals ──
  ["live",        2], ["current",     2], ["right now",   3], ["tonight",     2],
  ["today",       2], ["this week",   1], ["latest",      2], ["real time",   3],
  ["slate",       2], ["starting",    1], ["status",      1], ["update",      1],
  // ── Market signals ──
  ["vig",         3], ["juice",       2], ["sharp",       2], ["steam",       3],
  ["movement",    2], ["line move",   3], ["opener",      2], ["closing",     2],
  ["consensus",   2], ["public",      1], ["handle",      2], ["book",        1],
  ["sportsbook",  3], ["fanduel",     3], ["draftkings",  3], ["betmgm",      3],
  ["bovada",      3], ["pinnacle",    3], ["bet365",      3],
  // ── Sport-specific live queries ──
  ["roster",      1], ["lineup",      2], ["rotation",    2], ["scratched",   2],
  ["weather",     1], ["wind",        1], ["pitch count", 2],
] as const;

const ANALYSIS_LEXICON: ReadonlyArray<readonly [string, number]> = [
  // ── Reasoning / evaluation ──
  ["edge",        3], ["analyze",     3], ["analysis",    3], ["sharp",       2],
  ["value",       2], ["fade",        3], ["lean",        2], ["like",        1],
  ["love",        1], ["hate",        1], ["avoid",       1],
  // ── Decision-making ──
  ["why",         1], ["compare",     2], ["should i",    3], ["recommend",   2],
  ["better bet",  3], ["best bet",    3], ["pick",        2], ["prediction",  2],
  ["handicap",    2], ["cap",         1], ["model",       2], ["projection",  2],
  // ── Betting strategy ──
  ["expected value", 3], ["ev",       2], ["roi",         2], ["clv",         3],
  ["closing line",   3], ["bankroll", 2], ["unit",        1], ["kelly",       3],
  ["variance",    2], ["regression",  2], ["trend",       1], ["correlation", 2],
  ["strength of schedule", 3], ["sos", 2], ["ats",        3], ["against the spread", 3],
  // ── Structured output ──
  ["breakdown",   2], ["deep dive",   2], ["report",      1], ["summary",     1],
  ["thesis",      2], ["conviction",  2],
] as const;

const CODE_LEXICON: ReadonlyArray<readonly [string, number]> = [
  ["code",        3], ["function",    2], ["debug",       3], ["error",       1],
  ["bug",         2], ["script",      2], ["api",         1], ["endpoint",    1],
  ["deploy",      2], ["sql",         3], ["query",       1], ["migration",   2],
  ["component",   2], ["refactor",    3], ["typescript",  3], ["javascript",  3],
  ["python",      3], ["react",       2], ["supabase",    2], ["regex",       3],
  ["fix",         1], ["implement",   2], ["build",       1],
] as const;

function scoreText(text: string, lexicon: ReadonlyArray<readonly [string, number]>): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const [term, weight] of lexicon) {
    if (lower.includes(term)) score += weight;
  }
  return score;
}

export function detectTaskType(messages: Array<{ role: string; content: unknown }>): TaskType {
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return "chat";

  let text = "";
  if (typeof lastMsg.content === "string") {
    text = lastMsg.content;
  } else if (Array.isArray(lastMsg.content)) {
    text = lastMsg.content
      .filter((p: any) => p.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text)
      .join(" ");
  }

  if (!text) return "chat";

  // Vision: presence of image parts is definitive
  if (Array.isArray(lastMsg.content) && lastMsg.content.some((p: any) => p.type === "image")) {
    return "vision";
  }

  const scores: Record<string, number> = {
    grounding: scoreText(text, GROUNDING_LEXICON),
    analysis:  scoreText(text, ANALYSIS_LEXICON),
    code:      scoreText(text, CODE_LEXICON),
  };

  const winner = Object.entries(scores).reduce((a, b) => a[1] >= b[1] ? a : b);

  // Minimum threshold: need at least 3 weight to trigger non-chat routing.
  // Below that, intent is ambiguous — default to chat (fastest, cheapest).
  if (winner[1] < 3) return "chat";

  log.info("task_detected", { taskType: winner[0], scores, textPreview: text.slice(0, 80) });
  return winner[0] as TaskType;
}

// ═══════════════════════════════════════════════════════════════════════════
// §6.2  Pick Extraction
// ═══════════════════════════════════════════════════════════════════════════

export async function extractPickStructured(args: {
  prompt: string;
  systemPrompt?: string;
  gameContext?: Record<string, unknown> | null;
  signal?: AbortSignal;
}): Promise<PickExtractionResult> {
  const messages: WireMessage[] = [
    ...(args.systemPrompt ? [{ role: "system" as const, content: args.systemPrompt }] : []),
    { role: "user" as const, content: args.prompt },
  ];
  const result = await orchestrate("analysis", messages, { gameContext: args.gameContext, signal: args.signal });
  const parsed = safeParseJSON(result.content);
  return { ok: parsed.success, data: parsed.data, raw: result.content, provider: result.servedBy, model: result.model };
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.4  Health Report
// ═══════════════════════════════════════════════════════════════════════════

export function getProviderHealth(): HealthReport {
  const summary = metrics.getSummary(60);
  return {
    circuits: circuitBreaker.getStatus(),
    enabled: {
      google: isProviderEnabled("google"),
      openai: isProviderEnabled("openai"),
      anthropic: isProviderEnabled("anthropic"),
    },
    metrics: summary,
    costCeiling: {
      limitPerHour: COST_CEILING_PER_HOUR,
      currentHourlySpend: summary.totalCostUsd,
      isOverBudget: metrics.isOverBudget(),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §7  API HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

// ── §7.1  Node.js Handler (Universal) ──────────────────────────────────────

/** Node.js HTTP Handler. Uses TextDecoder for universal compatibility (no Buffer). */
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }

  const decoder = new TextDecoder();
  let bodyText = "";
  for await (const chunk of req) {
    bodyText += decoder.decode(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk), { stream: true });
  }
  bodyText += decoder.decode(); // flush
  const body = JSON.parse(bodyText || "{}");

  const { messages, gameContext, systemPrompt, mode, prompt } = body;

  if (mode === "pick" || mode === "extract_pick") {
    try {
      const out = await extractPickStructured({ prompt, systemPrompt, gameContext });
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(out));
    } catch (e: any) {
      log.error("handler_pick_error", { error: e.message });
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    const stream = await orchestrateStream(detectTaskType(messages), messages, {
      gameContext, systemPrompt, signal: controller.signal,
    });
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const wireChunk = {
        type: value.type === "thought" ? "thought" : value.type === "grounding" ? "grounding" : value.type === "error" ? "error" : "text",
        content: value.content,
        metadata: value.metadata,
        done: value.type === "done",
      };
      res.write(`data: ${JSON.stringify(wireChunk)}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e: any) {
    log.error("handler_stream_error", { error: e.message });
    res.write(`data: ${JSON.stringify({ type: "error", content: e.message })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

// ── §7.2  App Router (Edge) ────────────────────────────────────────────────

/** Next.js App Router (Edge) Handler */
export async function POST(req: Request): Promise<Response> {
  const body = await req.json() as any;
  const messages = body.messages ?? [];
  const gameContext = body.gameContext ?? body.game_context ?? null;
  const systemPrompt = body.systemPrompt ?? body.system_prompt;
  const mode = body.mode ?? body.task ?? "chat";
  const prompt = body.prompt;

  if (mode === "pick" || mode === "extract_pick") {
    try {
      const out = await extractPickStructured({ prompt, systemPrompt, gameContext, signal: req.signal });
      return Response.json(out);
    } catch (e: any) {
      log.error("edge_pick_error", { error: e.message });
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  const enc = new TextEncoder();
  try {
    const stream = await orchestrateStream(detectTaskType(messages), messages, {
      gameContext, systemPrompt, signal: req.signal,
    });
    const sse = new ReadableStream({
      async start(ctl) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = { ...value, done: false };
            ctl.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
          ctl.enqueue(enc.encode("data: [DONE]\n\n"));
          ctl.close();
        } catch (e: any) {
          log.error("edge_stream_error", { error: e.message });
          ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: "error", content: e.message })}\n\n`));
          ctl.enqueue(enc.encode("data: [DONE]\n\n"));
          ctl.close();
        } finally {
          reader.releaseLock();
        }
      },
    });
    return new Response(sse, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  } catch (e: any) {
    log.error("edge_orchestrate_error", { error: e.message });
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// §8  EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export {
  metrics,
  circuitBreaker,
  FALLBACK_CHAINS,
  MODELS,
  TASK_TEMPERATURES,
  TASK_MAX_TOKENS,
  log,
  persistence,
};
