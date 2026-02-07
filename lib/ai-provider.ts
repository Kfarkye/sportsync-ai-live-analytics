/* ═══════════════════════════════════════════════════════════════════════════
   ai-provider.ts
   Iron Curtain — Multi-Provider AI Orchestration Layer  v2.1

   Production-grade fallback engine with per-provider circuit breakers,
   abort-aware jittered retry, cost tracking, and unified streaming normalization.

   Architecture
   ├─ §0  Types & Configuration
   │   ├─ §0.1  Public Types
   │   ├─ §0.2  Internal Types
   │   └─ §0.3  Provider Registry & Fallback Chains
   ├─ §1  Provider Clients
   │   ├─ §1.1  Resilient Fetch (Timeout + Abort-Aware Retry + Backoff)
   │   ├─ §1.2  Google (Gemini) — Safety Filter Handling
   │   ├─ §1.3  OpenAI
   │   └─ §1.4  Anthropic
   ├─ §2  Message Adapters
   ├─ §3  Prompt Shaping
   ├─ §4  Fallback Engine
   │   ├─ §4.1  orchestrate()   — Request/Response
   │   ├─ §4.2  orchestrateStream() — SSE Streaming
   │   └─ §4.3  Stream Normalization & SSE Parsing
   ├─ §5  Observability
   │   ├─ §5.1  Metrics Collector (Ring Buffer)
   │   ├─ §5.2  Circuit Breaker (Closed → Open → Half-Open)
   │   └─ §5.3  Health Report
   ├─ §6  Utilities
   ├─ §7  API Handlers
   │   ├─ §7.1  Pages Router (Node.js)
   │   └─ §7.2  App Router (Edge / Web Standard)
   └─ §8  Exports
   ═══════════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════════════
// §0  TYPES & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

// ── §0.1  Public Types ─────────────────────────────────────────────────────

export type ProviderName = "google" | "openai" | "anthropic";

export type TaskType =
  | "grounding"    // Live data: scores, odds, stats (Gemini w/ Google Search)
  | "analysis"     // Edge detection, reasoning, structured output
  | "chat"         // General conversation (fast models)
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
  role: "system" | "user" | "assistant";
  content: string | MessagePart[];
}

export interface MessagePart {
  type: "text" | "image" | "file";
  text?: string;
  source?: { type: "base64"; media_type: string; data: string };
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
  type: "text" | "thought" | "grounding" | "done" | "error";
  content?: string;
  metadata?: GroundingMetadata;
  servedBy?: ProviderName;
  model?: string;
  isFallback?: boolean;
}

export interface GroundingMetadata {
  groundingChunks?: Array<{ web?: { uri: string; title?: string } }>;
  searchEntryPoint?: { renderedContent: string };
  webSearchQueries?: string[];
}

export interface OrchestrateOptions {
  gameContext?: Record<string, unknown> | null;
  signal?: AbortSignal;
  systemPrompt?: string;
  onFallback?: (from: ProviderConfig, to: ProviderConfig, reason: string) => void;
  temperature?: number;
  maxTokens?: number;
  forceProvider?: ProviderName;
}

export interface HealthReport {
  circuits: Record<ProviderName, CircuitState>;
  enabled: Record<ProviderName, boolean>;
  metrics: MetricsSummary;
  costCeiling: {
    limitPerHour: number;
    currentHourlySpend: number;
    isOverBudget: boolean;
  };
}

export interface MetricsSummary {
  totalCostUsd: number;
  totalRequests: number;
  byProvider: Record<string, ProviderMetrics>;
}

export interface ProviderMetrics {
  requests: number;
  failures: number;
  avgLatencyMs: number;
  costUsd: number;
}

// ── §0.2  Internal Types ───────────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half-open";
type ErrorType = "auth" | "rate_limit" | "server" | "timeout" | "stream_error" | "circuit_open" | "safety_block" | "unknown";

interface ProviderClient {
  chat(request: ProviderRequest): Promise<ProviderRawResponse>;
  chatStream(request: ProviderRequest): Promise<ReadableStream<Uint8Array>>;
}

interface ProviderRequest {
  model: string;
  messages: WireMessage[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
  enableGrounding?: boolean;
  retries: number;
}

interface ProviderRawResponse {
  content: string;
  groundingMetadata?: GroundingMetadata;
  thoughts?: string;
  inputTokens: number;
  outputTokens: number;
}

interface MetricsEntry {
  provider: ProviderName;
  model: string;
  taskType: string;
  status: string;
  latencyMs: number;
  costUsd: number;
  timestamp: number;
}

interface PickExtractionResult {
  ok: boolean;
  data: unknown;
  raw?: string;
  provider: ProviderName;
  model: string;
}

/** Shape returned by Google's generateContent endpoint. */
interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: GroundingMetadata;
    finishReason?: string;
  }>;
  groundingMetadata?: GroundingMetadata;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/** Shape returned by Google's streamGenerateContent SSE chunks. */
interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: GroundingMetadata;
  }>;
}

/** Shape returned by OpenAI's chat completions endpoint. */
interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Shape of an OpenAI streaming delta. */
interface OpenAIStreamChunk {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
}

/** Shape returned by Anthropic's messages endpoint. */
interface AnthropicResponse {
  content?: Array<{ type: string; text?: string; thinking?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Shape of an Anthropic streaming event. */
interface AnthropicStreamChunk {
  type: string;
  delta?: { type?: string; text?: string; thinking?: string };
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

/** Provider-level defaults. Overrides merge on top. */
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
    supportsGrounding: false,
    supportsStreaming: true,
    maxRetries: 1,
  },
  anthropic: {
    timeoutMs: 60_000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    supportsGrounding: false,
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
    makeConfig("google",    MODELS.google.fast,      { timeoutMs: 15_000 }),
    makeConfig("openai",    MODELS.openai.fast,      { timeoutMs: 20_000 }),
    makeConfig("anthropic", MODELS.anthropic.fast,    { timeoutMs: 20_000 }),
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
  grounding: 0.3,
  analysis: 0.5,
  chat: 0.7,
  vision: 0.2,
  code: 0.3,
  recruiting: 0.5,
};

const TASK_MAX_TOKENS: Record<TaskType, number> = {
  grounding: 4_000,
  analysis: 8_000,
  chat: 2_000,
  vision: 2_000,
  code: 8_000,
  recruiting: 4_000,
};

// ═══════════════════════════════════════════════════════════════════════════
// §1  PROVIDER CLIENTS
// ═══════════════════════════════════════════════════════════════════════════

// ── §1.1  Resilient Fetch (Abort-Aware) ────────────────────────────────────

function env(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) return process.env[key];
  return undefined;
}

const ENV_KEYS: Record<ProviderName, string> = {
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

function isProviderEnabled(provider: ProviderName): boolean {
  return !!env(ENV_KEYS[provider]);
}

function requireKey(provider: ProviderName): string {
  const key = env(ENV_KEYS[provider]);
  if (!key) throw new ProviderError(provider, `${ENV_KEYS[provider]} not set`, "auth");
  return key;
}

/**
 * Fetch with hard timeout. Returns the provider name in timeout errors
 * so the fallback engine can attribute failures correctly.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  provider: ProviderName,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new DOMException("Aborted", "AbortError");
    }
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new ProviderError(provider, `Timeout after ${timeoutMs}ms`, "timeout");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retries on 429/5xx with jittered exponential backoff.
 * Ceiling: 3 000 ms. Abort-aware: cancellation during backoff rejects immediately.
 */
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

      if (res.ok || (res.status >= 400 && res.status < 429)) return res;
      if (attempt >= retries) return res;

      const delay = Math.min(1_000 * Math.pow(2, attempt), 3_000) + Math.random() * 100;
      await sleepWithSignal(delay, options.signal ?? undefined);
      attempt++;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (attempt >= retries) throw err;

      await sleepWithSignal(500 + Math.random() * 100, options.signal ?? undefined);
      attempt++;
    }
  }
}

/**
 * Read error body from a failed response, capped to 512 chars.
 */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 512);
  } catch {
    return "";
  }
}

// ── §1.2  Google (Gemini) — Safety Filter Handling ─────────────────────────

const googleClient: ProviderClient = {
  async chat(req) {
    const apiKey = requireKey("google");

    const body: Record<string, unknown> = {
      contents: toGeminiFormat(req.messages),
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens,
      },
    };

    // Inject system instruction via Gemini's dedicated field
    const systemText = extractSystemText(req.messages);
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }

    if (req.enableGrounding) {
      body.tools = [{ googleSearch: {} }];
    }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${apiKey}`;

    const res = await fetchWithRetry(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: req.signal },
      30_000,
      req.retries,
      "google",
    );

    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("google", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }

    const data = (await res.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    // Gemini returns HTTP 200 with empty content when safety filters trigger.
    // Treat as a typed error so the fallback engine cascades without tripping the circuit breaker.
    if (!content && candidate?.finishReason === "SAFETY") {
      throw new ProviderError("google", "Safety filter triggered", "safety_block");
    }

    const metadata = candidate?.groundingMetadata ?? data.groundingMetadata ?? null;
    const usage = data.usageMetadata;

    return {
      content,
      groundingMetadata: metadata ?? undefined,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    };
  },

  async chatStream(req) {
    const apiKey = requireKey("google");

    const body: Record<string, unknown> = {
      contents: toGeminiFormat(req.messages),
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens,
      },
    };

    const systemText = extractSystemText(req.messages);
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }

    if (req.enableGrounding) {
      body.tools = [{ googleSearch: {} }];
    }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const res = await fetchWithRetry(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: req.signal },
      30_000,
      req.retries,
      "google",
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

    const res = await fetchWithRetry(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: req.model,
          messages: toOpenAIFormat(req.messages),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: false,
        }),
        signal: req.signal,
      },
      60_000,
      req.retries,
      "openai",
    );

    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("openai", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }

    const data = (await res.json()) as OpenAIResponse;
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  },

  async chatStream(req) {
    const apiKey = requireKey("openai");

    const res = await fetchWithRetry(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: req.model,
          messages: toOpenAIFormat(req.messages),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true,
        }),
        signal: req.signal,
      },
      60_000,
      req.retries,
      "openai",
    );

    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("openai", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }
    if (!res.body) throw new ProviderError("openai", "Empty response body", "server");
    return res.body;
  },
};

// ── §1.4  Anthropic ────────────────────────────────────────────────────────

const anthropicClient: ProviderClient = {
  async chat(req) {
    const apiKey = requireKey("anthropic");
    const { systemPrompt, messages } = splitSystemPrompt(req.messages);

    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: req.model,
          system: systemPrompt,
          messages: toAnthropicFormat(messages),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
        }),
        signal: req.signal,
      },
      60_000,
      req.retries,
      "anthropic",
    );

    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("anthropic", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }

    const data = (await res.json()) as AnthropicResponse;
    const textBlocks = data.content?.filter((b) => b.type === "text") ?? [];
    const thinkBlocks = data.content?.filter((b) => b.type === "thinking") ?? [];

    return {
      content: textBlocks.map((b) => b.text ?? "").join(""),
      thoughts: thinkBlocks.length > 0 ? thinkBlocks.map((b) => b.thinking ?? "").join("") : undefined,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  },

  async chatStream(req) {
    const apiKey = requireKey("anthropic");
    const { systemPrompt, messages } = splitSystemPrompt(req.messages);

    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: req.model,
          system: systemPrompt,
          messages: toAnthropicFormat(messages),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true,
        }),
        signal: req.signal,
      },
      60_000,
      req.retries,
      "anthropic",
    );

    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("anthropic", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }
    if (!res.body) throw new ProviderError("anthropic", "Empty response body", "server");
    return res.body;
  },
};

const CLIENTS: Record<ProviderName, ProviderClient> = {
  google: googleClient,
  openai: openaiClient,
  anthropic: anthropicClient,
};

// ═══════════════════════════════════════════════════════════════════════════
// §2  MESSAGE ADAPTERS
// ═══════════════════════════════════════════════════════════════════════════

/** Extract the first system message's text content. */
function extractSystemText(messages: WireMessage[]): string {
  const system = messages.find((m) => m.role === "system");
  if (!system) return "";
  return typeof system.content === "string" ? system.content : "";
}

/** Split system prompt out for Anthropic's dedicated `system` field. */
function splitSystemPrompt(messages: WireMessage[]): { systemPrompt: string; messages: WireMessage[] } {
  return {
    systemPrompt: extractSystemText(messages),
    messages: messages.filter((m) => m.role !== "system"),
  };
}

/** Convert to Gemini's `contents` format. System messages are handled via systemInstruction. */
function toGeminiFormat(messages: WireMessage[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts:
        typeof m.content === "string"
          ? [{ text: m.content }]
          : m.content.map((p) => {
              if (p.type === "text") return { text: p.text ?? "" };
              if ((p.type === "image" || p.type === "file") && p.source) {
                return { inlineData: { mimeType: p.source.media_type, data: p.source.data } };
              }
              return { text: "" };
            }),
    }));
}

/** Convert to OpenAI's `messages` format. */
function toOpenAIFormat(messages: WireMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content.map((p) =>
            p.type === "image" && p.source
              ? { type: "image_url" as const, image_url: { url: `data:${p.source.media_type};base64,${p.source.data}` } }
              : { type: "text" as const, text: p.text ?? "" },
          ),
  }));
}

/** Convert to Anthropic's `messages` format (system stripped separately). */
function toAnthropicFormat(messages: WireMessage[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content
          : m.content.map((p) =>
              p.type === "image" && p.source
                ? { type: "image" as const, source: { type: "base64" as const, media_type: p.source.media_type, data: p.source.data } }
                : { type: "text" as const, text: p.text ?? "" },
            ),
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
// §3  PROMPT SHAPING
// ═══════════════════════════════════════════════════════════════════════════

/** Regex patterns that reference provider-specific grounding capabilities. */
const GROUNDING_PATTERNS = [
  /search (?:for |the )?(?:current|latest|live|real[- ]time)\b[^.]*\./gi,
  /use (?:google )?search (?:grounding|to find)\b[^.]*\./gi,
  /look up (?:current|latest|live)\b[^.]*\./gi,
  /verify (?:with|using|via) (?:search|grounding|google)\b[^.]*\./gi,
] as const;

function shapePrompt(
  messages: WireMessage[],
  config: ProviderConfig,
  taskType: TaskType,
  options: OrchestrateOptions,
): WireMessage[] {
  // Explicit system prompt override takes precedence
  if (options.systemPrompt) {
    return [
      { role: "system", content: options.systemPrompt },
      ...messages.filter((m) => m.role !== "system"),
    ];
  }

  const existing = messages.find((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  let systemContent = typeof existing?.content === "string" ? existing.content : "";

  // Strip grounding directives when falling back to a non-grounding provider
  if (!config.supportsGrounding && taskType === "grounding") {
    for (const pattern of GROUNDING_PATTERNS) {
      systemContent = systemContent.replace(pattern, "");
    }
    systemContent = systemContent.replace(/\n{3,}/g, "\n\n").trim();

    // Inject pre-fetched game context so the model has data to work with
    if (options.gameContext) {
      systemContent +=
        `\n\n--- CURRENT GAME CONTEXT (injected, not live) ---\n` +
        `${JSON.stringify(options.gameContext, null, 2)}\n` +
        `--- END CONTEXT ---\n` +
        `Note: This data was provided at request time and may not reflect real-time changes.`;
    }
  }

  // Anthropic benefits from explicit formatting directives on structured tasks
  if (config.provider === "anthropic" && (taskType === "vision" || taskType === "analysis")) {
    systemContent +=
      "\n\nWhen providing structured analysis, use clear section headers and maintain consistent formatting.";
  }

  return [{ role: "system", content: systemContent }, ...nonSystem];
}

// ═══════════════════════════════════════════════════════════════════════════
// §4  FALLBACK ENGINE
// ═══════════════════════════════════════════════════════════════════════════

// ── §4.1  orchestrate() — Request/Response ─────────────────────────────────

export async function orchestrate(
  taskType: TaskType,
  messages: WireMessage[],
  options: OrchestrateOptions = {},
): Promise<NormalizedResponse> {
  const chain = resolveChain(taskType, options);
  if (chain.length === 0) {
    throw new Error("No AI providers enabled. Set at least one API key.");
  }

  let lastError: Error | null = null;
  const temperature = options.temperature ?? TASK_TEMPERATURES[taskType];
  const maxTokens = options.maxTokens ?? TASK_MAX_TOKENS[taskType];

  for (let i = 0; i < chain.length; i++) {
    const config = chain[i];

    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    // Circuit breaker: skip providers in open state, allow probe in half-open
    if (circuitBreaker.isOpen(config.provider)) {
      metrics.record(config, taskType, "circuit_open", 0, 0);
      continue;
    }

    if (metrics.isOverBudget()) {
      throw new Error(`Cost ceiling reached ($${COST_CEILING_PER_HOUR}/hr).`);
    }

    const shaped = shapePrompt(messages, config, taskType, options);
    const start = performance.now();

    try {
      const client = CLIENTS[config.provider];
      const raw = await client.chat({
        model: config.model,
        messages: shaped,
        temperature,
        maxTokens,
        signal: options.signal,
        enableGrounding: config.supportsGrounding && taskType === "grounding",
        retries: config.maxRetries,
      });

      const latencyMs = Math.round(performance.now() - start);
      const normalized = normalizeResponse(raw, config, i, latencyMs);

      metrics.record(config, taskType, "success", latencyMs, normalized.estimatedCostUsd);
      circuitBreaker.recordSuccess(config.provider);
      return normalized;
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      lastError = err instanceof Error ? err : new Error(String(err));

      const errorType: ErrorType = err instanceof ProviderError ? (err.errorType as ErrorType) : "unknown";
      metrics.record(config, taskType, errorType, latencyMs, 0);

      // Safety blocks are prompt-specific (not provider degradation) — don't trip the circuit breaker
      if (errorType !== "safety_block") {
        circuitBreaker.recordFailure(config.provider);
      }

      if (err instanceof DOMException && err.name === "AbortError") throw err;

      if (i < chain.length - 1) {
        options.onFallback?.(config, chain[i + 1], lastError.message);
      }
    }
  }

  throw lastError ?? new Error("All providers failed.");
}

// ── §4.2  orchestrateStream() — SSE Streaming ─────────────────────────────

export async function orchestrateStream(
  taskType: TaskType,
  messages: WireMessage[],
  options: OrchestrateOptions = {},
): Promise<ReadableStream<NormalizedStreamChunk>> {
  const chain = resolveChain(taskType, options);
  if (chain.length === 0) {
    throw new Error("No AI providers enabled.");
  }

  let lastError: Error | null = null;
  const temperature = options.temperature ?? TASK_TEMPERATURES[taskType];
  const maxTokens = options.maxTokens ?? TASK_MAX_TOKENS[taskType];

  for (let i = 0; i < chain.length; i++) {
    const config = chain[i];

    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (circuitBreaker.isOpen(config.provider)) continue;
    if (metrics.isOverBudget()) throw new Error("Cost ceiling reached.");

    const shaped = shapePrompt(messages, config, taskType, options);
    const start = performance.now();

    try {
      const client = CLIENTS[config.provider];
      const rawStream = await client.chatStream({
        model: config.model,
        messages: shaped,
        temperature,
        maxTokens,
        signal: options.signal,
        enableGrounding: config.supportsGrounding && taskType === "grounding",
        retries: config.maxRetries,
      });

      circuitBreaker.recordSuccess(config.provider);
      return createNormalizingStream(rawStream, config, i, start);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      circuitBreaker.recordFailure(config.provider);

      if (err instanceof DOMException && err.name === "AbortError") throw err;

      if (i < chain.length - 1) {
        options.onFallback?.(config, chain[i + 1], lastError.message);
      }
    }
  }

  throw lastError ?? new Error("All providers failed.");
}

// ── §4.3  Stream Normalization & SSE Parsing ───────────────────────────────

function createNormalizingStream(
  rawStream: ReadableStream<Uint8Array>,
  config: ProviderConfig,
  chainPosition: number,
  startMs: number,
): ReadableStream<NormalizedStreamChunk> {
  const decoder = new TextDecoder();
  let buffer = "";
  let charCount = 0; // Approximate token tracking via character count

  return new ReadableStream<NormalizedStreamChunk>({
    async start(controller) {
      const reader = rawStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Handle TCP fragmentation: only process complete lines
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            try {
              const chunk = parseSSELine(line, config.provider);
              if (chunk) {
                chunk.servedBy = config.provider;
                chunk.model = config.model;
                chunk.isFallback = chainPosition > 0;

                if (chunk.type === "text" && chunk.content) {
                  charCount += chunk.content.length;
                }

                controller.enqueue(chunk);
              }
            } catch {
              // Malformed SSE line — drop it, keep stream alive
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
          } catch {
            // Discard malformed tail
          }
        }

        const latencyMs = Math.round(performance.now() - startMs);
        // Estimate cost from character count (≈4 chars/token)
        const estimatedOutputTokens = Math.ceil(charCount / 4);
        const estimatedCost = (estimatedOutputTokens / 1_000) * config.costPer1kOutput;
        metrics.record(config, "chat", "success", latencyMs, estimatedCost);

        controller.enqueue({ type: "done" });
        controller.close();
      } catch (err) {
        const latencyMs = Math.round(performance.now() - startMs);
        metrics.record(config, "chat", "stream_error", latencyMs, 0);
        controller.enqueue({
          type: "error",
          content: err instanceof Error ? err.message : "Stream error",
        });
        controller.close();
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* lock may already be released */
        }
      }
    },
  });
}

/**
 * Parse a single SSE line into a normalized stream chunk.
 * Each provider has its own wire format — this function unifies them.
 */
function parseSSELine(line: string, provider: ProviderName): NormalizedStreamChunk | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;

  // Anthropic emits `event: ...` lines before `data: ...` — skip them
  if (trimmed.startsWith("event:")) return null;

  let payload = trimmed;
  if (trimmed.startsWith("data:")) {
    payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return { type: "done" };
  }

  // Throws on malformed JSON — caller catches
  const data = JSON.parse(payload);

  switch (provider) {
    case "google":
      return parseGeminiChunk(data);
    case "openai":
      return parseOpenAIChunk(data);
    case "anthropic":
      return parseAnthropicChunk(data);
    default:
      return null;
  }
}

function parseGeminiChunk(data: GeminiStreamChunk): NormalizedStreamChunk | null {
  const candidate = data.candidates?.[0];
  const grounding = candidate?.groundingMetadata;
  if (grounding) return { type: "grounding", metadata: grounding };

  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("");
  if (text) return { type: "text", content: text };

  return null;
}

function parseOpenAIChunk(data: OpenAIStreamChunk): NormalizedStreamChunk | null {
  const choice = data.choices?.[0];
  if (choice?.delta?.content) return { type: "text", content: choice.delta.content };
  if (choice?.finish_reason === "stop") return { type: "done" };
  return null;
}

function parseAnthropicChunk(data: AnthropicStreamChunk): NormalizedStreamChunk | null {
  if (data.type === "content_block_delta") {
    if (data.delta?.type === "text_delta") return { type: "text", content: data.delta.text };
    if (data.delta?.type === "thinking_delta") return { type: "thought", content: data.delta.thinking };
  }
  if (data.type === "message_stop") return { type: "done" };
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// §5  OBSERVABILITY
// ═══════════════════════════════════════════════════════════════════════════

const COST_CEILING_PER_HOUR = 50;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
const METRICS_RING_SIZE = 1_000;

// ── §5.1  Metrics Collector ────────────────────────────────────────────────

class MetricsCollector {
  /** Fixed-size ring buffer. O(1) insert via index wrap. */
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

    const entry: MetricsEntry = {
      provider: config.provider,
      model: config.model,
      taskType,
      status,
      latencyMs,
      costUsd,
      timestamp: Date.now(),
    };

    this.ring[this.cursor] = entry;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;

    this.emitTelemetry(entry);
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

    return {
      totalCostUsd: Math.round(totalCost * 10_000) / 10_000,
      totalRequests,
      byProvider,
    };
  }

  private resetHourIfStale(): void {
    if (Date.now() - this.lastHourReset > 3_600_000) {
      this.hourlyCost = 0;
      this.lastHourReset = Date.now();
    }
  }

  private emitTelemetry(entry: MetricsEntry): void {
    if (typeof globalThis !== "undefined") {
      const telemetry = (globalThis as Record<string, unknown>).__aiProviderTelemetry as
        | { emit?: (e: MetricsEntry) => void }
        | undefined;
      telemetry?.emit?.(entry);
    }
  }
}

// ── §5.2  Circuit Breaker ──────────────────────────────────────────────────

/**
 * Three-state circuit breaker per provider:
 *   CLOSED  → all traffic flows normally
 *   OPEN    → all requests skip this provider (fast-fail)
 *   HALF-OPEN → one probe request allowed; success → closed, failure → open
 *
 * Transitions:
 *   closed  + N consecutive failures  → open
 *   open    + cooldown elapsed        → half-open
 *   half-open + success               → closed
 *   half-open + failure               → open (reset cooldown)
 */
class CircuitBreakerManager {
  private failures: Record<string, number> = {};
  private lastFailure: Record<string, number> = {};
  private halfOpenProbe: Record<string, boolean> = {};

  recordSuccess(provider: ProviderName): void {
    this.failures[provider] = 0;
    this.halfOpenProbe[provider] = false;
  }

  recordFailure(provider: ProviderName): void {
    this.failures[provider] = (this.failures[provider] ?? 0) + 1;
    this.lastFailure[provider] = Date.now();
    this.halfOpenProbe[provider] = false;
  }

  /**
   * Returns true if the circuit is OPEN (skip this provider).
   * When cooldown expires, transitions to half-open and allows one probe.
   */
  isOpen(provider: ProviderName): boolean {
    const fails = this.failures[provider] ?? 0;
    if (fails < CIRCUIT_BREAKER_THRESHOLD) return false;

    const elapsed = Date.now() - (this.lastFailure[provider] ?? 0);
    if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      // Transition to half-open: allow exactly one probe request
      if (!this.halfOpenProbe[provider]) {
        this.halfOpenProbe[provider] = true;
        return false; // Allow probe
      }
      return true; // Probe already in flight, block additional requests
    }

    return true; // Still in cooldown
  }

  getState(provider: ProviderName): CircuitState {
    const fails = this.failures[provider] ?? 0;
    if (fails < CIRCUIT_BREAKER_THRESHOLD) return "closed";

    const elapsed = Date.now() - (this.lastFailure[provider] ?? 0);
    if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) return "half-open";

    return "open";
  }

  getStatus(): Record<ProviderName, CircuitState> {
    return {
      google: this.getState("google"),
      openai: this.getState("openai"),
      anthropic: this.getState("anthropic"),
    };
  }
}

const metrics = new MetricsCollector();
const circuitBreaker = new CircuitBreakerManager();

// ── §5.3  Health Report ────────────────────────────────────────────────────

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
    estimatedCostUsd: inputCost + outputCost,
  };
}

function resolveChain(taskType: TaskType, options: OrchestrateOptions): ProviderConfig[] {
  if (options.forceProvider) {
    const chain = FALLBACK_CHAINS[taskType];
    const forced = chain.find((c) => c.provider === options.forceProvider);
    if (forced && isProviderEnabled(forced.provider)) return [forced];
  }
  return FALLBACK_CHAINS[taskType].filter((c) => isProviderEnabled(c.provider));
}

/**
 * Abort-aware sleep. If the request is cancelled during backoff,
 * the promise rejects immediately instead of hanging until the timer fires.
 */
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

/**
 * Safely parse JSON from AI model output.
 * Handles markdown fences, leading prose, and trailing garbage.
 */
function safeParseJSON(raw: string): { success: true; data: unknown } | { success: false; raw: string } {
  if (!raw || typeof raw !== "string") return { success: false, raw: String(raw ?? "") };

  let text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  // Find the first JSON structure
  const first = text.search(/[\[{]/);
  if (first > 0) text = text.slice(first);

  // Find the matching closing bracket
  const lastBrace = text.lastIndexOf("}");
  const lastBracket = text.lastIndexOf("]");
  const last = Math.max(lastBrace, lastBracket);
  if (last >= 0) text = text.slice(0, last + 1);

  try {
    return { success: true, data: JSON.parse(text) };
  } catch {
    return { success: false, raw };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// §7  API HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

// ── §7.1  Pages Router (Node.js) ───────────────────────────────────────────

/** Keyword signals for automatic task type detection. */
const GROUNDING_SIGNALS = [
  "odds", "score", "line", "spread", "injury", "live",
  "current", "today", "tonight", "slate", "starting", "status",
] as const;

const ANALYSIS_SIGNALS = [
  "edge", "analyze", "analysis", "sharp", "value", "fade",
  "why", "compare", "should i", "recommend",
] as const;

function detectTaskType(messages: Array<{ role: string; content: unknown }>): TaskType {
  const last = messages[messages.length - 1];
  const text = typeof last?.content === "string" ? last.content.toLowerCase() : "";

  if (GROUNDING_SIGNALS.some((s) => text.includes(s))) return "grounding";
  if (ANALYSIS_SIGNALS.some((s) => text.includes(s))) return "analysis";
  return "chat";
}

async function extractPickStructured(args: {
  prompt: string;
  systemPrompt?: string;
  gameContext?: Record<string, unknown> | null;
  signal?: AbortSignal;
}): Promise<PickExtractionResult> {
  const messages: WireMessage[] = [
    ...(args.systemPrompt ? [{ role: "system" as const, content: args.systemPrompt }] : []),
    { role: "user" as const, content: args.prompt },
  ];

  const result = await orchestrate("analysis", messages, {
    gameContext: args.gameContext ?? null,
    signal: args.signal,
  });

  const parsed = safeParseJSON(result.content);
  if (!parsed.success) {
    console.warn(
      `[Pick:Parse] provider=${result.servedBy} model=${result.model} raw=${result.content.slice(0, 200)}`,
    );
    return { ok: false, data: null, raw: result.content, provider: result.servedBy, model: result.model };
  }

  return { ok: true, data: parsed.data, provider: result.servedBy, model: result.model };
}

/** Read JSON body from a Node.js IncomingMessage or pre-parsed body. */
async function readJsonBody(req: NodeLikeRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, unknown>;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Minimal shape for Node.js http.IncomingMessage compatibility. */
interface NodeLikeRequest {
  method?: string;
  body?: unknown;
  on?(event: string, cb: () => void): void;
  [Symbol.asyncIterator]?(): AsyncIterator<Buffer | string>;
}

interface NodeLikeResponse {
  statusCode?: number;
  setHeader(name: string, value: string): void;
  flushHeaders?(): void;
  write(chunk: string): boolean;
  end(data?: string): void;
}

/**
 * Main HTTP handler. Supports two modes:
 *   - `mode: "extract_pick"` → JSON response with structured pick
 *   - default → SSE stream of NormalizedStreamChunks
 */
export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJSON(res, 405, { error: "Method not allowed" });
    return;
  }

  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const gameContext = (body.gameContext ?? body.game_context ?? null) as Record<string, unknown> | null;
  const systemPrompt = (body.systemPrompt ?? body.system_prompt) as string | undefined;
  const mode = (body.mode ?? body.task ?? "chat") as string;
  const runId = (body.run_id ?? crypto.randomUUID?.() ?? "unknown") as string;

  const health = getProviderHealth();
  console.info("[AI:Health]", {
    run_id: runId,
    enabled: health.enabled,
    circuits: health.circuits,
    costCeiling: health.costCeiling,
  });

  // ── Pick Extraction Mode ───────────────────────────────────────────────

  if (mode === "extract_pick" || mode === "pick") {
    if (!body.prompt || typeof body.prompt !== "string") {
      sendJSON(res, 400, { error: "Missing or invalid `prompt` field." });
      return;
    }

    try {
      const controller = new AbortController();
      req.on?.("close", () => controller.abort());
      req.on?.("aborted", () => controller.abort());

      const result = await extractPickStructured({
        prompt: body.prompt as string,
        systemPrompt: systemPrompt ? String(systemPrompt) : undefined,
        gameContext,
        signal: controller.signal,
      });

      sendJSON(res, 200, result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Pick extraction failed.";
      sendJSON(res, 500, { error: message });
    }
    return;
  }

  // ── Streaming Chat Mode ────────────────────────────────────────────────

  if (!messages.length) {
    sendJSON(res, 400, { error: "Missing `messages` array." });
    return;
  }

  const taskType = detectTaskType(messages);

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const controller = new AbortController();
  req.on?.("close", () => controller.abort());
  req.on?.("aborted", () => controller.abort());

  try {
    const stream = await orchestrateStream(taskType, messages as WireMessage[], {
      gameContext,
      signal: controller.signal,
      systemPrompt,
      onFallback: (from, to, reason) => {
        console.warn(`[${runId}] Fallback: ${from.provider}/${from.model} → ${to.provider}/${to.model}: ${reason}`);
      },
    });

    const reader = stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = value;
      const wireChunk = {
        type:
          chunk.type === "thought"
            ? "thought"
            : chunk.type === "grounding"
              ? "grounding"
              : chunk.type === "error"
                ? "error"
                : "text",
        content: chunk.content,
        metadata: chunk.metadata,
        done: chunk.type === "done",
      };

      res.write(`data: ${JSON.stringify(wireChunk)}\n\n`);
      if (chunk.type === "done") res.write("data: [DONE]\n\n");
    }

    res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Stream failed.";
    res.write(`data: ${JSON.stringify({ type: "error", content: message })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

function sendJSON(res: NodeLikeResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

// ── Next.js App Router (Edge) Handler ────────────────────────────────────

interface AppRouterBody {
  messages?: WireMessage[];
  gameContext?: Record<string, unknown> | null;
  game_context?: Record<string, unknown> | null;
  systemPrompt?: string;
  system_prompt?: string;
  mode?: string;
  task?: string;
  prompt?: string;
}

/**
 * App Router export. Use in `app/api/chat/route.ts`:
 *   export { POST } from "@/lib/ai-provider";
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as AppRouterBody;
  const messages = body.messages ?? [];
  const gameContext = body.gameContext ?? body.game_context ?? null;
  const systemPrompt = body.systemPrompt ?? body.system_prompt;
  const mode = body.mode ?? body.task ?? "chat";
  const prompt = body.prompt;

  // ── Pick Extraction ──────────────────────────────────────────────────

  if (mode === "extract_pick" || mode === "pick") {
    if (!prompt || typeof prompt !== "string") {
      return Response.json({ error: "Missing or invalid `prompt` field." }, { status: 400 });
    }

    try {
      const result = await extractPickStructured({
        prompt,
        systemPrompt: systemPrompt ? String(systemPrompt) : undefined,
        gameContext,
        signal: req.signal,
      });
      return Response.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Pick extraction failed.";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  // ── Streaming Chat ───────────────────────────────────────────────────

  if (!messages.length) {
    return Response.json({ error: "Missing `messages` array." }, { status: 400 });
  }

  const taskType = detectTaskType(messages);
  const encoder = new TextEncoder();

  try {
    const stream = await orchestrateStream(taskType, messages, {
      gameContext,
      systemPrompt,
      signal: req.signal,
    });

    const sseStream = new ReadableStream({
      async start(controller) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const wireChunk = {
              type: value.type,
              content: value.content,
              metadata: value.metadata,
              done: value.type === "done",
            };

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(wireChunk)}\n\n`));
            if (value.type === "done") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            }
          }
          controller.close();
        } catch (err) {
          const message = err instanceof Error ? err.message : "Stream error.";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", content: message })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } finally {
          try { reader.releaseLock(); } catch { /* already released */ }
        }
      },
    });

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Stream initialization failed.";
    return Response.json({ error: message }, { status: 500 });
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
  safeParseJSON,
  extractPickStructured,
  detectTaskType,
};
