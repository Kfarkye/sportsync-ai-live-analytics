/* ============================================================================
   ai-provider.ts
   "Iron Curtain" — Multi-Provider AI Orchestration Layer (v1.0)

   Architecture:
   ├─ §0  Config & Types — Canonical shapes, provider registry, chain definitions
   ├─ §1  Provider Clients — Unified interface over Gemini, OpenAI, Anthropic
   ├─ §2  Response Normalization — Map every provider to one canonical shape
   ├─ §3  Prompt Shaping — Provider-specific system prompt adaptation
   ├─ §4  Fallback Engine — Sequential cascade with abort, timeout, classification
   ├─ §5  Observability — Cost tracking, latency, circuit breakers
   ├─ §6  Exports — Public API surface

   Design Principles:
   - Zero UI coupling. This module returns data, never React elements.
   - Provider-agnostic at the boundary. Consumers see NormalizedResponse only.
   - Fail-open with degradation, not fail-closed with errors.
   - Every provider call is metered, timed, and logged.
   - Streaming and non-streaming through the same interface.

   Usage:
     import { orchestrate, orchestrateStream } from "@/lib/ai-provider";

     // Non-streaming (recruiting app, background jobs)
     const result = await orchestrate("analysis", messages, { gameContext });

     // Streaming (The Drip chat, real-time UI)
     const stream = await orchestrateStream("grounding", messages, {
       gameContext,
       signal: abortController.signal,
       onFallback: (from, to, reason) => console.warn(`${from} → ${to}: ${reason}`),
     });

   Requirements:
     Environment variables: GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
     At least ONE provider key must be set. Module degrades gracefully per-provider.

   CSP: Requires fetch access to:
     - generativelanguage.googleapis.com
     - api.openai.com
     - api.anthropic.com
============================================================================ */


// ═══════════════════════════════════════════════════════════════════════════
// §0  CONFIG & TYPES
// ═══════════════════════════════════════════════════════════════════════════

// ── Provider Registry ────────────────────────────────────────────────────

export type ProviderName = "google" | "openai" | "anthropic";

export type TaskType =
  | "grounding"    // Live data: scores, odds, stats (Gemini primary — has search grounding)
  | "analysis"     // Edge detection, reasoning (Claude primary — strongest reasoning)
  | "chat"         // General conversation, low-latency (Flash/mini primary)
  | "vision"       // Image classification, screenshots (Claude primary — best vision)
  | "code"         // Code generation, refactoring (Claude primary)
  | "recruiting";  // Candidate sourcing, market analysis (GPT-5 primary — broad knowledge)

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  /** Max time before this provider is considered failed (ms). */
  timeoutMs: number;
  /** Cost per 1K input tokens (USD). */
  costPer1kInput: number;
  /** Cost per 1K output tokens (USD). */
  costPer1kOutput: number;
  /** Whether this provider supports native search grounding. */
  supportsGrounding: boolean;
  /** Whether this provider supports streaming. */
  supportsStreaming: boolean;
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

// ── Canonical Response Shape ─────────────────────────────────────────────
// Every provider response is normalized to this before reaching consumers.

export interface NormalizedResponse {
  /** The text content of the response. */
  content: string;
  /** Grounding metadata (Gemini-native, synthesized for others). */
  groundingMetadata: GroundingMetadata | null;
  /** Thinking/reasoning content (Anthropic-native, null for others). */
  thoughts: string | null;
  /** Which provider actually served this request. */
  servedBy: ProviderName;
  /** Which model specifically. */
  model: string;
  /** Whether this was a fallback (not the primary provider). */
  isFallback: boolean;
  /** Position in the chain (0 = primary). */
  chainPosition: number;
  /** Latency of the successful call (ms). */
  latencyMs: number;
  /** Estimated cost of this call (USD). */
  estimatedCostUsd: number;
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

// ── Orchestration Options ────────────────────────────────────────────────

export interface OrchestrateOptions {
  /** Game context for sports betting tasks. */
  gameContext?: Record<string, unknown> | null;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Custom system prompt override (skips prompt shaping if provided). */
  systemPrompt?: string;
  /** Callback when fallback occurs. */
  onFallback?: (from: ProviderConfig, to: ProviderConfig, reason: string) => void;
  /** Temperature override (default: per-task). */
  temperature?: number;
  /** Max output tokens override (default: per-task). */
  maxTokens?: number;
  /** Force a specific provider (bypasses chain). */
  forceProvider?: ProviderName;
}

// ── Internal Types ───────────────────────────────────────────────────────

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
}

interface ProviderRawResponse {
  content: string;
  groundingMetadata?: GroundingMetadata;
  thoughts?: string;
  inputTokens: number;
  outputTokens: number;
}


// ═══════════════════════════════════════════════════════════════════════════
// §0.1  PROVIDER DEFINITIONS & FALLBACK CHAINS
// ═══════════════════════════════════════════════════════════════════════════

// Models — update these as providers release new versions.
// Single source of truth. No model strings scattered across the codebase.

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

function makeConfig(
  provider: ProviderName,
  model: string,
  overrides: Partial<ProviderConfig> = {}
): ProviderConfig {
  const defaults: Record<ProviderName, Omit<ProviderConfig, "provider" | "model">> = {
    google: {
      timeoutMs: 30_000,
      costPer1kInput: 0.00125,
      costPer1kOutput: 0.005,
      supportsGrounding: true,
      supportsStreaming: true,
    },
    openai: {
      timeoutMs: 60_000,
      costPer1kInput: 0.003,
      costPer1kOutput: 0.015,
      supportsGrounding: false,
      supportsStreaming: true,
    },
    anthropic: {
      timeoutMs: 60_000,
      costPer1kInput: 0.003,
      costPer1kOutput: 0.015,
      supportsGrounding: false,
      supportsStreaming: true,
    },
  };
  return { provider, model, ...defaults[provider], ...overrides };
}

/**
 * Fallback chains per task type.
 *
 * Order matters. First entry is primary. Each subsequent entry is tried
 * only if all previous entries failed (timeout, 5xx, rate limit).
 *
 * Design rationale:
 * - grounding: Gemini is the only provider with native search grounding.
 *   Falling back to OpenAI/Claude loses grounding but keeps the response alive.
 * - analysis: Claude's reasoning is strongest for edge detection.
 * - chat: Latency matters most. Flash/mini variants first.
 * - vision: Claude's vision is most accurate for structured classification.
 * - code: Claude produces the cleanest TypeScript/React.
 * - recruiting: GPT-5 has broadest general knowledge for candidate analysis.
 */
const FALLBACK_CHAINS: Record<TaskType, ProviderConfig[]> = {
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
    makeConfig("google",    MODELS.google.fast, { timeoutMs: 15_000 }),
    makeConfig("openai",    MODELS.openai.fast, { timeoutMs: 20_000 }),
    makeConfig("anthropic", MODELS.anthropic.fast, { timeoutMs: 20_000 }),
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

/** Default temperatures per task. */
const TASK_TEMPERATURES: Record<TaskType, number> = {
  grounding: 0.3,    // Factual, low creativity
  analysis: 0.5,     // Balanced reasoning
  chat: 0.7,         // Conversational
  vision: 0.2,       // Classification needs precision
  code: 0.3,         // Code needs determinism
  recruiting: 0.5,   // Balanced
};

/** Default max tokens per task. */
const TASK_MAX_TOKENS: Record<TaskType, number> = {
  grounding: 4000,
  analysis: 8000,
  chat: 2000,
  vision: 2000,
  code: 8000,
  recruiting: 4000,
};


// ═══════════════════════════════════════════════════════════════════════════
// §1  PROVIDER CLIENTS
// ═══════════════════════════════════════════════════════════════════════════

// Environment variable access — works in both Node.js and Edge Runtime.

function env(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) return process.env[key];
  return undefined;
}

function isProviderEnabled(provider: ProviderName): boolean {
  const keys: Record<ProviderName, string> = {
    google: "GEMINI_API_KEY",
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
  };
  return !!env(keys[provider]);
}

// ── Google (Gemini) ──────────────────────────────────────────────────────

const googleClient: ProviderClient = {
  async chat(req) {
    const apiKey = env("GEMINI_API_KEY");
    if (!apiKey) throw new ProviderError("google", "GEMINI_API_KEY not set", "auth");

    const body: Record<string, unknown> = {
      contents: convertToGeminiFormat(req.messages),
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens,
      },
    };

    // Enable grounding with Google Search when task requires it
    if (req.enableGrounding) {
      body.tools = [{ googleSearch: {} }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${apiKey}`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal,
    }, 30_000);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderError("google", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
    const metadata = candidate?.groundingMetadata || data.groundingMetadata || null;
    const usage = data.usageMetadata || {};

    return {
      content,
      groundingMetadata: metadata,
      inputTokens: usage.promptTokenCount || estimateTokens(req.messages),
      outputTokens: usage.candidatesTokenCount || estimateTokens(content),
    };
  },

  async chatStream(req) {
    const apiKey = env("GEMINI_API_KEY");
    if (!apiKey) throw new ProviderError("google", "GEMINI_API_KEY not set", "auth");

    const body: Record<string, unknown> = {
      contents: convertToGeminiFormat(req.messages),
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens,
      },
    };

    if (req.enableGrounding) {
      body.tools = [{ googleSearch: {} }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal,
    }, 30_000);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderError("google", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }

    if (!res.body) throw new ProviderError("google", "No response body", "server");
    return res.body;
  },
};

// ── OpenAI ───────────────────────────────────────────────────────────────

const openaiClient: ProviderClient = {
  async chat(req) {
    const apiKey = env("OPENAI_API_KEY");
    if (!apiKey) throw new ProviderError("openai", "OPENAI_API_KEY not set", "auth");

    const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: convertToOpenAIFormat(req.messages),
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: false,
      }),
      signal: req.signal,
    }, 60_000);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderError("openai", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const usage = data.usage || {};

    return {
      content: choice?.message?.content || "",
      inputTokens: usage.prompt_tokens || estimateTokens(req.messages),
      outputTokens: usage.completion_tokens || estimateTokens(choice?.message?.content || ""),
    };
  },

  async chatStream(req) {
    const apiKey = env("OPENAI_API_KEY");
    if (!apiKey) throw new ProviderError("openai", "OPENAI_API_KEY not set", "auth");

    const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: convertToOpenAIFormat(req.messages),
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: true,
      }),
      signal: req.signal,
    }, 60_000);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderError("openai", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }

    if (!res.body) throw new ProviderError("openai", "No response body", "server");
    return res.body;
  },
};

// ── Anthropic ────────────────────────────────────────────────────────────

const anthropicClient: ProviderClient = {
  async chat(req) {
    const apiKey = env("ANTHROPIC_API_KEY");
    if (!apiKey) throw new ProviderError("anthropic", "ANTHROPIC_API_KEY not set", "auth");

    const { systemPrompt, messages } = extractSystemPrompt(req.messages);

    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        system: systemPrompt,
        messages: convertToAnthropicFormat(messages),
        temperature: req.temperature,
        max_tokens: req.maxTokens,
      }),
      signal: req.signal,
    }, 60_000);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderError("anthropic", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }

    const data = await res.json();
    const content = data.content
      ?.filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("") || "";
    const thoughts = data.content
      ?.filter((b: { type: string }) => b.type === "thinking")
      .map((b: { thinking: string }) => b.thinking)
      .join("") || null;
    const usage = data.usage || {};

    return {
      content,
      thoughts: thoughts || undefined,
      inputTokens: usage.input_tokens || estimateTokens(req.messages),
      outputTokens: usage.output_tokens || estimateTokens(content),
    };
  },

  async chatStream(req) {
    const apiKey = env("ANTHROPIC_API_KEY");
    if (!apiKey) throw new ProviderError("anthropic", "ANTHROPIC_API_KEY not set", "auth");

    const { systemPrompt, messages } = extractSystemPrompt(req.messages);

    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        system: systemPrompt,
        messages: convertToAnthropicFormat(messages),
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: true,
      }),
      signal: req.signal,
    }, 60_000);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ProviderError("anthropic", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }

    if (!res.body) throw new ProviderError("anthropic", "No response body", "server");
    return res.body;
  },
};

// ── Client Registry ──────────────────────────────────────────────────────

const CLIENTS: Record<ProviderName, ProviderClient> = {
  google: googleClient,
  openai: openaiClient,
  anthropic: anthropicClient,
};


// ═══════════════════════════════════════════════════════════════════════════
// §2  RESPONSE NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a raw provider response into the canonical shape.
 *
 * Key behavior:
 * - Gemini: groundingMetadata passes through natively.
 * - OpenAI/Claude: groundingMetadata is null. The UI layer handles this
 *   gracefully (EvidenceDeck doesn't render, citations don't hydrate).
 * - Claude: thoughts field passes through. Others return null.
 * - Cost is estimated from token counts and provider pricing.
 */
function normalizeResponse(
  raw: ProviderRawResponse,
  config: ProviderConfig,
  chainPosition: number,
  latencyMs: number,
): NormalizedResponse {
  const inputCost = (raw.inputTokens / 1000) * config.costPer1kInput;
  const outputCost = (raw.outputTokens / 1000) * config.costPer1kOutput;

  return {
    content: raw.content,
    groundingMetadata: raw.groundingMetadata || null,
    thoughts: raw.thoughts || null,
    servedBy: config.provider,
    model: config.model,
    isFallback: chainPosition > 0,
    chainPosition,
    latencyMs,
    estimatedCostUsd: inputCost + outputCost,
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// §3  PROMPT SHAPING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Adapt the system prompt based on which provider is serving.
 *
 * Critical for correctness:
 * - Gemini with grounding: Can reference live data, include "search for current" instructions.
 * - OpenAI/Claude without grounding: Must NOT include grounding instructions.
 *   These providers will hallucinate live data if told to "search for current odds."
 *   Instead, inject context from gameContext directly into the system prompt.
 *
 * This function mutates nothing. Returns a new message array.
 */
function shapePrompt(
  messages: WireMessage[],
  config: ProviderConfig,
  taskType: TaskType,
  options: OrchestrateOptions,
): WireMessage[] {
  // If caller provided a custom system prompt, use it directly
  if (options.systemPrompt) {
    return [{ role: "system", content: options.systemPrompt }, ...messages.filter(m => m.role !== "system")];
  }

  const existing = messages.find(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");
  let systemContent = typeof existing?.content === "string" ? existing.content : "";

  // Strip grounding-specific instructions for providers that don't support it
  if (!config.supportsGrounding && taskType === "grounding") {
    systemContent = stripGroundingInstructions(systemContent);

    // Inject game context as static data since we can't ground
    if (options.gameContext) {
      const contextBlock = [
        "\n\n--- CURRENT GAME CONTEXT (injected, not live) ---",
        JSON.stringify(options.gameContext, null, 2),
        "--- END CONTEXT ---",
        "\nNote: This data was provided at request time and may not reflect real-time changes.",
      ].join("\n");
      systemContent += contextBlock;
    }
  }

  // Provider-specific formatting hints
  if (config.provider === "anthropic") {
    // Claude responds better with explicit JSON formatting instructions
    if (taskType === "vision" || taskType === "analysis") {
      systemContent += "\n\nWhen providing structured analysis, use clear section headers and maintain consistent formatting.";
    }
  }

  return [{ role: "system", content: systemContent }, ...nonSystem];
}

/** Remove grounding-specific instructions that would cause hallucination on non-grounding providers. */
function stripGroundingInstructions(prompt: string): string {
  const GROUNDING_PATTERNS = [
    /search (?:for |the )?(?:current|latest|live|real[- ]time)\b[^.]*\./gi,
    /use (?:google )?search (?:grounding|to find)\b[^.]*\./gi,
    /look up (?:current|latest|live)\b[^.]*\./gi,
    /verify (?:with|using|via) (?:search|grounding|google)\b[^.]*\./gi,
  ];

  let result = prompt;
  for (const pattern of GROUNDING_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.replace(/\n{3,}/g, "\n\n").trim();
}


// ═══════════════════════════════════════════════════════════════════════════
// §4  FALLBACK ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute a request against the fallback chain for a given task type.
 *
 * Behavior:
 * 1. Resolve the chain (filter disabled providers, apply forceProvider).
 * 2. Try each provider sequentially.
 * 3. On success: normalize response, record metrics, return.
 * 4. On failure: classify error, decide whether to fallback or throw.
 * 5. If all providers fail: throw the last error.
 *
 * Never runs providers in parallel. Parallel would waste tokens/money
 * and complicate abort handling.
 */
export async function orchestrate(
  taskType: TaskType,
  messages: WireMessage[],
  options: OrchestrateOptions = {},
): Promise<NormalizedResponse> {
  const chain = resolveChain(taskType, options);
  if (chain.length === 0) throw new Error("No AI providers are enabled. Set at least one API key.");

  let lastError: Error | null = null;
  const temperature = options.temperature ?? TASK_TEMPERATURES[taskType];
  const maxTokens = options.maxTokens ?? TASK_MAX_TOKENS[taskType];

  for (let i = 0; i < chain.length; i++) {
    const config = chain[i];
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    // Circuit breaker check
    if (circuitBreaker.isOpen(config.provider)) {
      metrics.record(config, taskType, "circuit_open", 0, 0);
      if (i > 0) options.onFallback?.(chain[i - 1], config, "circuit open, skipping");
      continue;
    }

    // Cost ceiling check
    if (metrics.isOverBudget()) {
      throw new Error(`Cost ceiling reached ($${COST_CEILING_PER_HOUR}/hr). Degrading to prevent overrun.`);
    }

    const shaped = shapePrompt(messages, config, taskType, options);
    const start = Date.now();

    try {
      const client = CLIENTS[config.provider];
      const raw = await client.chat({
        model: config.model,
        messages: shaped,
        temperature,
        maxTokens,
        signal: options.signal,
        enableGrounding: config.supportsGrounding && taskType === "grounding",
      });

      const latency = Date.now() - start;
      const normalized = normalizeResponse(raw, config, i, latency);

      // Record success
      metrics.record(config, taskType, "success", latency, normalized.estimatedCostUsd);
      circuitBreaker.recordSuccess(config.provider);

      return normalized;

    } catch (err) {
      const latency = Date.now() - start;
      lastError = err instanceof Error ? err : new Error(String(err));

      // Record failure
      const errorType = err instanceof ProviderError ? err.errorType : "unknown";
      metrics.record(config, taskType, errorType, latency, 0);
      circuitBreaker.recordFailure(config.provider);

      // Don't fallback on user-initiated abort
      if (err instanceof DOMException && err.name === "AbortError") throw err;

      // Log and notify
      if (i < chain.length - 1) {
        options.onFallback?.(config, chain[i + 1], lastError.message);
      }

      continue;
    }
  }

  throw lastError ?? new Error("All providers failed");
}

/**
 * Streaming variant of orchestrate.
 *
 * Returns a ReadableStream of NormalizedStreamChunk objects.
 * The consumer (ChatWidget, API route) reads chunks and dispatches to the UI.
 *
 * Fallback in streaming is trickier: if the primary starts streaming then dies
 * mid-response, we DON'T fall back (partial data already sent to the user).
 * Fallback only happens on connection-level failures (timeout, 5xx before first byte).
 */
export async function orchestrateStream(
  taskType: TaskType,
  messages: WireMessage[],
  options: OrchestrateOptions = {},
): Promise<ReadableStream<NormalizedStreamChunk>> {
  const chain = resolveChain(taskType, options);
  if (chain.length === 0) throw new Error("No AI providers are enabled.");

  let lastError: Error | null = null;
  const temperature = options.temperature ?? TASK_TEMPERATURES[taskType];
  const maxTokens = options.maxTokens ?? TASK_MAX_TOKENS[taskType];

  for (let i = 0; i < chain.length; i++) {
    const config = chain[i];
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (circuitBreaker.isOpen(config.provider)) continue;
    if (metrics.isOverBudget()) throw new Error("Cost ceiling reached.");

    const shaped = shapePrompt(messages, config, taskType, options);
    const start = Date.now();

    try {
      const client = CLIENTS[config.provider];
      const rawStream = await client.chatStream({
        model: config.model,
        messages: shaped,
        temperature,
        maxTokens,
        signal: options.signal,
        enableGrounding: config.supportsGrounding && taskType === "grounding",
      });

      // Connection succeeded — wrap the raw stream in a normalizing transformer.
      // From this point, NO fallback. If the stream dies mid-response, error propagates.
      circuitBreaker.recordSuccess(config.provider);

      return createNormalizingStream(rawStream, config, i, start);

    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      circuitBreaker.recordFailure(config.provider);

      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (i < chain.length - 1) {
        options.onFallback?.(config, chain[i + 1], lastError.message);
      }
      continue;
    }
  }

  throw lastError ?? new Error("All providers failed");
}

/**
 * Wrap a raw provider stream in a TransformStream that emits NormalizedStreamChunks.
 *
 * Each provider has a different SSE format:
 * - Gemini: JSON objects with candidates[0].content.parts
 * - OpenAI: SSE with data: {"choices": [{"delta": {"content": "..."}}]}
 * - Anthropic: SSE with event types (content_block_delta, etc.)
 *
 * This normalizer handles all three.
 */
function createNormalizingStream(
  rawStream: ReadableStream<Uint8Array>,
  config: ProviderConfig,
  chainPosition: number,
  startMs: number,
): ReadableStream<NormalizedStreamChunk> {
  const decoder = new TextDecoder();
  let buffer = "";

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
            const chunk = parseProviderSSELine(line, config.provider);
            if (chunk) {
              chunk.servedBy = config.provider;
              chunk.model = config.model;
              chunk.isFallback = chainPosition > 0;
              controller.enqueue(chunk);
            }
          }
        }

        // Flush remaining buffer
        if (buffer.trim()) {
          const chunk = parseProviderSSELine(buffer, config.provider);
          if (chunk) {
            chunk.servedBy = config.provider;
            chunk.model = config.model;
            chunk.isFallback = chainPosition > 0;
            controller.enqueue(chunk);
          }
        }

        // Emit done chunk with timing
        const latency = Date.now() - startMs;
        metrics.record(config, "chat", "success", latency, 0);
        controller.enqueue({ type: "done" });
        controller.close();

      } catch (err) {
        const latency = Date.now() - startMs;
        metrics.record(config, "chat", "stream_error", latency, 0);
        controller.enqueue({ type: "error", content: err instanceof Error ? err.message : "Stream error" });
        controller.close();
      } finally {
        try { reader.releaseLock(); } catch { /* */ }
      }
    },
  });
}

/** Parse a single SSE line from any provider into a NormalizedStreamChunk. */
function parseProviderSSELine(line: string, provider: ProviderName): NormalizedStreamChunk | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;

  // Handle SSE data: prefix
  let payload = trimmed;
  if (trimmed.startsWith("data:")) {
    payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return { type: "done" };
  }

  // Handle Anthropic event: prefix (skip, we process data: lines)
  if (trimmed.startsWith("event:")) return null;

  try {
    const data = JSON.parse(payload);

    switch (provider) {
      case "google": {
        const parts = data.candidates?.[0]?.content?.parts;
        const text = parts?.map((p: { text?: string }) => p.text || "").join("");
        const grounding = data.candidates?.[0]?.groundingMetadata;
        if (grounding) return { type: "grounding", metadata: grounding };
        if (text) return { type: "text", content: text };
        return null;
      }

      case "openai": {
        const delta = data.choices?.[0]?.delta;
        if (delta?.content) return { type: "text", content: delta.content };
        if (data.choices?.[0]?.finish_reason === "stop") return { type: "done" };
        return null;
      }

      case "anthropic": {
        if (data.type === "content_block_delta") {
          if (data.delta?.type === "text_delta") return { type: "text", content: data.delta.text };
          if (data.delta?.type === "thinking_delta") return { type: "thought", content: data.delta.thinking };
        }
        if (data.type === "message_stop") return { type: "done" };
        return null;
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// §5  OBSERVABILITY — Metrics, Cost Tracking, Circuit Breakers
// ═══════════════════════════════════════════════════════════════════════════

/** Hourly cost ceiling in USD. Prevents runaway spend during outages. */
const COST_CEILING_PER_HOUR = 50;

/** Circuit breaker: open after N consecutive failures, half-open after cooldown. */
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000; // 1 minute

// ── Metrics Singleton ────────────────────────────────────────────────────

interface MetricEntry {
  provider: ProviderName;
  model: string;
  taskType: TaskType;
  status: string;
  latencyMs: number;
  costUsd: number;
  timestamp: number;
}

class MetricsCollector {
  private entries: MetricEntry[] = [];
  private hourlyCost = 0;
  private lastHourReset = Date.now();

  record(
    config: ProviderConfig,
    taskType: TaskType | string,
    status: string,
    latencyMs: number,
    costUsd: number,
  ): void {
    const now = Date.now();

    // Reset hourly counter
    if (now - this.lastHourReset > 3_600_000) {
      this.hourlyCost = 0;
      this.lastHourReset = now;
    }

    this.hourlyCost += costUsd;

    const entry: MetricEntry = {
      provider: config.provider,
      model: config.model,
      taskType: taskType as TaskType,
      status,
      latencyMs,
      costUsd,
      timestamp: now,
    };

    this.entries.push(entry);

    // Keep last 1000 entries in memory
    if (this.entries.length > 1000) {
      this.entries = this.entries.slice(-500);
    }

    // Emit to external telemetry if available
    if (typeof globalThis !== "undefined" && (globalThis as Record<string, unknown>).__aiProviderTelemetry) {
      const tel = (globalThis as Record<string, unknown>).__aiProviderTelemetry as {
        emit?: (entry: MetricEntry) => void;
      };
      tel.emit?.(entry);
    }
  }

  isOverBudget(): boolean {
    if (Date.now() - this.lastHourReset > 3_600_000) {
      this.hourlyCost = 0;
      this.lastHourReset = Date.now();
    }
    return this.hourlyCost > COST_CEILING_PER_HOUR;
  }

  /** Get summary stats for the last N minutes. */
  getSummary(windowMinutes = 60): {
    totalCost: number;
    totalRequests: number;
    byProvider: Record<string, { requests: number; failures: number; avgLatencyMs: number; cost: number }>;
  } {
    const cutoff = Date.now() - windowMinutes * 60_000;
    const recent = this.entries.filter(e => e.timestamp > cutoff);

    const byProvider: Record<string, { requests: number; failures: number; totalLatency: number; cost: number }> = {};

    for (const entry of recent) {
      const key = entry.provider;
      if (!byProvider[key]) byProvider[key] = { requests: 0, failures: 0, totalLatency: 0, cost: 0 };
      byProvider[key].requests++;
      if (entry.status !== "success") byProvider[key].failures++;
      byProvider[key].totalLatency += entry.latencyMs;
      byProvider[key].cost += entry.costUsd;
    }

    const summary: Record<string, { requests: number; failures: number; avgLatencyMs: number; cost: number }> = {};
    for (const [key, val] of Object.entries(byProvider)) {
      summary[key] = {
        requests: val.requests,
        failures: val.failures,
        avgLatencyMs: val.requests > 0 ? Math.round(val.totalLatency / val.requests) : 0,
        cost: Math.round(val.cost * 10000) / 10000,
      };
    }

    return {
      totalCost: Math.round(recent.reduce((s, e) => s + e.costUsd, 0) * 10000) / 10000,
      totalRequests: recent.length,
      byProvider: summary,
    };
  }
}

const metrics = new MetricsCollector();

// ── Circuit Breaker ──────────────────────────────────────────────────────

class CircuitBreakerManager {
  private failures: Record<string, number> = {};
  private lastFailure: Record<string, number> = {};

  recordSuccess(provider: ProviderName): void {
    this.failures[provider] = 0;
  }

  recordFailure(provider: ProviderName): void {
    this.failures[provider] = (this.failures[provider] || 0) + 1;
    this.lastFailure[provider] = Date.now();
  }

  isOpen(provider: ProviderName): boolean {
    const fails = this.failures[provider] || 0;
    if (fails < CIRCUIT_BREAKER_THRESHOLD) return false;

    // Check if cooldown has elapsed (half-open state)
    const lastFail = this.lastFailure[provider] || 0;
    if (Date.now() - lastFail > CIRCUIT_BREAKER_COOLDOWN_MS) {
      // Allow one attempt (half-open)
      return false;
    }

    return true;
  }

  getStatus(): Record<ProviderName, "closed" | "open" | "half-open"> {
    const result: Record<string, "closed" | "open" | "half-open"> = {};
    for (const provider of ["google", "openai", "anthropic"] as ProviderName[]) {
      const fails = this.failures[provider] || 0;
      if (fails < CIRCUIT_BREAKER_THRESHOLD) {
        result[provider] = "closed";
      } else {
        const lastFail = this.lastFailure[provider] || 0;
        result[provider] = Date.now() - lastFail > CIRCUIT_BREAKER_COOLDOWN_MS ? "half-open" : "open";
      }
    }
    return result as Record<ProviderName, "closed" | "open" | "half-open">;
  }
}

const circuitBreaker = new CircuitBreakerManager();


// ═══════════════════════════════════════════════════════════════════════════
// §6  INTERNAL UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

// ── Error Classification ─────────────────────────────────────────────────

type ProviderErrorType = "auth" | "rate_limit" | "server" | "timeout" | "unknown";

class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    message: string,
    public readonly errorType: ProviderErrorType,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

function classifyHttpError(status: number): ProviderErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "unknown";
}

function isAuthError(err: unknown): boolean {
  return err instanceof ProviderError && err.errorType === "auth";
}

function isRateLimitError(err: unknown): boolean {
  return err instanceof ProviderError && err.errorType === "rate_limit";
}

// ── Fetch with Timeout ───────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;

  // Combine external abort signal with timeout
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
      throw new ProviderError("google", `Timeout after ${timeoutMs}ms`, "timeout");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Message Format Converters ────────────────────────────────────────────

function convertToGeminiFormat(messages: WireMessage[]): Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> {
  return messages
    .filter(m => m.role !== "system") // Gemini handles system via systemInstruction, not in contents
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: typeof m.content === "string"
        ? [{ text: m.content }]
        : m.content.map(part => {
            if (part.type === "text") return { text: part.text || "" };
            if ((part.type === "image" || part.type === "file") && part.source) {
              return { inlineData: { mimeType: part.source.media_type, data: part.source.data } };
            }
            return { text: "" };
          }),
    }));
}

function convertToOpenAIFormat(messages: WireMessage[]): Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> {
  return messages.map(m => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: m.content.map(part => {
        if (part.type === "text") return { type: "text" as const, text: part.text || "" };
        if (part.type === "image" && part.source) {
          return { type: "image_url" as const, image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` } };
        }
        return { type: "text" as const, text: "[unsupported content]" };
      }),
    };
  });
}

function convertToAnthropicFormat(messages: WireMessage[]): Array<{ role: string; content: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> }> {
  return messages
    .filter(m => m.role !== "system")
    .map(m => {
      if (typeof m.content === "string") return { role: m.role, content: m.content };
      return {
        role: m.role,
        content: m.content.map(part => {
          if (part.type === "text") return { type: "text" as const, text: part.text || "" };
          if (part.type === "image" && part.source) {
            return { type: "image" as const, source: { type: "base64", media_type: part.source.media_type, data: part.source.data } };
          }
          return { type: "text" as const, text: "[unsupported content]" };
        }),
      };
    });
}

function extractSystemPrompt(messages: WireMessage[]): { systemPrompt: string; messages: WireMessage[] } {
  const system = messages.find(m => m.role === "system");
  const rest = messages.filter(m => m.role !== "system");
  return {
    systemPrompt: typeof system?.content === "string" ? system.content : "",
    messages: rest,
  };
}

// ── Token Estimation ─────────────────────────────────────────────────────

function estimateTokens(input: string | WireMessage[]): number {
  if (typeof input === "string") return Math.ceil(input.length / 4);
  return input.reduce((sum, m) => {
    if (typeof m.content === "string") return sum + Math.ceil(m.content.length / 4);
    return sum + m.content.reduce((s, p) => s + (p.text?.length || 200) / 4, 0);
  }, 0);
}

// ── Chain Resolution ─────────────────────────────────────────────────────

function resolveChain(taskType: TaskType, options: OrchestrateOptions): ProviderConfig[] {
  // Force a specific provider
  if (options.forceProvider) {
    const chain = FALLBACK_CHAINS[taskType];
    const forced = chain.find(c => c.provider === options.forceProvider);
    if (forced && isProviderEnabled(forced.provider)) return [forced];
    // If forced provider not in chain or disabled, fall through to full chain
  }

  // Filter to enabled providers only
  return FALLBACK_CHAINS[taskType].filter(c => isProviderEnabled(c.provider));
}


// ═══════════════════════════════════════════════════════════════════════════
// §7  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

export {
  orchestrate,
  orchestrateStream,
  metrics,
  circuitBreaker,
  FALLBACK_CHAINS,
  MODELS,
  TASK_TEMPERATURES,
  TASK_MAX_TOKENS,
  ProviderError,
};

/** Convenience: get a health snapshot for dashboards or debugging. */
export function getProviderHealth(): {
  circuits: Record<ProviderName, "closed" | "open" | "half-open">;
  enabled: Record<ProviderName, boolean>;
  metrics: ReturnType<MetricsCollector["getSummary"]>;
  costCeiling: { limit: number; currentHourlySpend: number; isOverBudget: boolean };
} {
  return {
    circuits: circuitBreaker.getStatus(),
    enabled: {
      google: isProviderEnabled("google"),
      openai: isProviderEnabled("openai"),
      anthropic: isProviderEnabled("anthropic"),
    },
    metrics: metrics.getSummary(),
    costCeiling: {
      limit: COST_CEILING_PER_HOUR,
      currentHourlySpend: metrics.getSummary(60).totalCost,
      isOverBudget: metrics.isOverBudget(),
    },
  };
}
