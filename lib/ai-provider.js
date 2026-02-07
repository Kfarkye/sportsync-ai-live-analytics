const MODELS = {
  google: {
    primary: "gemini-3-pro",
    fast: "gemini-3-flash"
  },
  openai: {
    primary: "gpt-5",
    fast: "gpt-5-mini"
  },
  anthropic: {
    primary: "claude-sonnet-4-5-20250929",
    fast: "claude-haiku-4-5",
    deep: "claude-opus-4-6"
  }
};
const PROVIDER_DEFAULTS = {
  google: {
    timeoutMs: 3e4,
    costPer1kInput: 125e-5,
    costPer1kOutput: 5e-3,
    supportsGrounding: true,
    supportsStreaming: true,
    maxRetries: 1
  },
  openai: {
    timeoutMs: 6e4,
    costPer1kInput: 3e-3,
    costPer1kOutput: 0.015,
    supportsGrounding: false,
    supportsStreaming: true,
    maxRetries: 1
  },
  anthropic: {
    timeoutMs: 6e4,
    costPer1kInput: 3e-3,
    costPer1kOutput: 0.015,
    supportsGrounding: false,
    supportsStreaming: true,
    maxRetries: 1
  }
};
function makeConfig(provider, model, overrides = {}) {
  return Object.freeze({ provider, model, ...PROVIDER_DEFAULTS[provider], ...overrides });
}
const FALLBACK_CHAINS = {
  grounding: [
    makeConfig("google", MODELS.google.primary),
    makeConfig("openai", MODELS.openai.primary),
    makeConfig("anthropic", MODELS.anthropic.primary)
  ],
  analysis: [
    makeConfig("anthropic", MODELS.anthropic.primary),
    makeConfig("openai", MODELS.openai.primary),
    makeConfig("google", MODELS.google.primary)
  ],
  chat: [
    makeConfig("google", MODELS.google.fast, { timeoutMs: 15e3 }),
    makeConfig("openai", MODELS.openai.fast, { timeoutMs: 2e4 }),
    makeConfig("anthropic", MODELS.anthropic.fast, { timeoutMs: 2e4 })
  ],
  vision: [
    makeConfig("anthropic", MODELS.anthropic.primary),
    makeConfig("openai", MODELS.openai.primary),
    makeConfig("google", MODELS.google.primary)
  ],
  code: [
    makeConfig("anthropic", MODELS.anthropic.primary),
    makeConfig("openai", MODELS.openai.primary),
    makeConfig("google", MODELS.google.primary)
  ],
  recruiting: [
    makeConfig("openai", MODELS.openai.primary),
    makeConfig("anthropic", MODELS.anthropic.primary),
    makeConfig("google", MODELS.google.primary)
  ]
};
const TASK_TEMPERATURES = {
  grounding: 0.3,
  analysis: 0.5,
  chat: 0.7,
  vision: 0.2,
  code: 0.3,
  recruiting: 0.5
};
const TASK_MAX_TOKENS = {
  grounding: 4e3,
  analysis: 8e3,
  chat: 2e3,
  vision: 2e3,
  code: 8e3,
  recruiting: 4e3
};
function env(key) {
  if (typeof process !== "undefined" && process.env) return process.env[key];
  return void 0;
}
const ENV_KEYS = {
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY"
};
function isProviderEnabled(provider) {
  return !!env(ENV_KEYS[provider]);
}
function requireKey(provider) {
  const key = env(ENV_KEYS[provider]);
  if (!key) throw new ProviderError(provider, `${ENV_KEYS[provider]} not set`, "auth");
  return key;
}
async function fetchWithTimeout(url, init, timeoutMs, provider) {
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
async function fetchWithRetry(url, options, timeoutMs, retries, provider) {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs, provider);
      if (res.ok || res.status >= 400 && res.status < 429) return res;
      if (attempt >= retries) return res;
      const delay = Math.min(1e3 * Math.pow(2, attempt), 3e3) + Math.random() * 100;
      await sleepWithSignal(delay, options.signal ?? void 0);
      attempt++;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (attempt >= retries) throw err;
      await sleepWithSignal(500 + Math.random() * 100, options.signal ?? void 0);
      attempt++;
    }
  }
}
async function readErrorBody(res) {
  try {
    const text = await res.text();
    return text.slice(0, 512);
  } catch {
    return "";
  }
}
const googleClient = {
  async chat(req) {
    const apiKey = requireKey("google");
    const body = {
      contents: toGeminiFormat(req.messages),
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens
      }
    };
    const systemText = extractSystemText(req.messages);
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }
    if (req.enableGrounding) {
      body.tools = [{ googleSearch: {} }];
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${apiKey}`;
    const res = await fetchWithRetry(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: req.signal },
      3e4,
      req.retries,
      "google"
    );
    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("google", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }
    const data = await res.json();
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!content && candidate?.finishReason === "SAFETY") {
      throw new ProviderError("google", "Safety filter triggered", "safety_block");
    }
    const metadata = candidate?.groundingMetadata ?? data.groundingMetadata ?? null;
    const usage = data.usageMetadata;
    return {
      content,
      groundingMetadata: metadata ?? void 0,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0
    };
  },
  async chatStream(req) {
    const apiKey = requireKey("google");
    const body = {
      contents: toGeminiFormat(req.messages),
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens
      }
    };
    const systemText = extractSystemText(req.messages);
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }
    if (req.enableGrounding) {
      body.tools = [{ googleSearch: {} }];
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const res = await fetchWithRetry(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: req.signal },
      3e4,
      req.retries,
      "google"
    );
    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("google", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }
    if (!res.body) throw new ProviderError("google", "Empty response body", "server");
    return res.body;
  }
};
const openaiClient = {
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
          stream: false
        }),
        signal: req.signal
      },
      6e4,
      req.retries,
      "openai"
    );
    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("openai", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }
    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0
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
          stream: true
        }),
        signal: req.signal
      },
      6e4,
      req.retries,
      "openai"
    );
    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("openai", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }
    if (!res.body) throw new ProviderError("openai", "Empty response body", "server");
    return res.body;
  }
};
const anthropicClient = {
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
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: req.model,
          system: systemPrompt,
          messages: toAnthropicFormat(messages),
          temperature: req.temperature,
          max_tokens: req.maxTokens
        }),
        signal: req.signal
      },
      6e4,
      req.retries,
      "anthropic"
    );
    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("anthropic", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }
    const data = await res.json();
    const textBlocks = data.content?.filter((b) => b.type === "text") ?? [];
    const thinkBlocks = data.content?.filter((b) => b.type === "thinking") ?? [];
    return {
      content: textBlocks.map((b) => b.text ?? "").join(""),
      thoughts: thinkBlocks.length > 0 ? thinkBlocks.map((b) => b.thinking ?? "").join("") : void 0,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0
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
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: req.model,
          system: systemPrompt,
          messages: toAnthropicFormat(messages),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true
        }),
        signal: req.signal
      },
      6e4,
      req.retries,
      "anthropic"
    );
    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("anthropic", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }
    if (!res.body) throw new ProviderError("anthropic", "Empty response body", "server");
    return res.body;
  }
};
const CLIENTS = {
  google: googleClient,
  openai: openaiClient,
  anthropic: anthropicClient
};
function extractSystemText(messages) {
  const system = messages.find((m) => m.role === "system");
  if (!system) return "";
  return typeof system.content === "string" ? system.content : "";
}
function splitSystemPrompt(messages) {
  return {
    systemPrompt: extractSystemText(messages),
    messages: messages.filter((m) => m.role !== "system")
  };
}
function toGeminiFormat(messages) {
  return messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: typeof m.content === "string" ? [{ text: m.content }] : m.content.map((p) => {
      if (p.type === "text") return { text: p.text ?? "" };
      if ((p.type === "image" || p.type === "file") && p.source) {
        return { inlineData: { mimeType: p.source.media_type, data: p.source.data } };
      }
      return { text: "" };
    })
  }));
}
function toOpenAIFormat(messages) {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map(
      (p) => p.type === "image" && p.source ? { type: "image_url", image_url: { url: `data:${p.source.media_type};base64,${p.source.data}` } } : { type: "text", text: p.text ?? "" }
    )
  }));
}
function toAnthropicFormat(messages) {
  return messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map(
      (p) => p.type === "image" && p.source ? { type: "image", source: { type: "base64", media_type: p.source.media_type, data: p.source.data } } : { type: "text", text: p.text ?? "" }
    )
  }));
}
const GROUNDING_PATTERNS = [
  /search (?:for |the )?(?:current|latest|live|real[- ]time)\b[^.]*\./gi,
  /use (?:google )?search (?:grounding|to find)\b[^.]*\./gi,
  /look up (?:current|latest|live)\b[^.]*\./gi,
  /verify (?:with|using|via) (?:search|grounding|google)\b[^.]*\./gi
];
function shapePrompt(messages, config, taskType, options) {
  if (options.systemPrompt) {
    return [
      { role: "system", content: options.systemPrompt },
      ...messages.filter((m) => m.role !== "system")
    ];
  }
  const existing = messages.find((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  let systemContent = typeof existing?.content === "string" ? existing.content : "";
  if (!config.supportsGrounding && taskType === "grounding") {
    for (const pattern of GROUNDING_PATTERNS) {
      systemContent = systemContent.replace(pattern, "");
    }
    systemContent = systemContent.replace(/\n{3,}/g, "\n\n").trim();
    if (options.gameContext) {
      systemContent += `

--- CURRENT GAME CONTEXT (injected, not live) ---
${JSON.stringify(options.gameContext, null, 2)}
--- END CONTEXT ---
Note: This data was provided at request time and may not reflect real-time changes.`;
    }
  }
  if (config.provider === "anthropic" && (taskType === "vision" || taskType === "analysis")) {
    systemContent += "\n\nWhen providing structured analysis, use clear section headers and maintain consistent formatting.";
  }
  return [{ role: "system", content: systemContent }, ...nonSystem];
}
async function orchestrate(taskType, messages, options = {}) {
  const chain = resolveChain(taskType, options);
  if (chain.length === 0) {
    throw new Error("No AI providers enabled. Set at least one API key.");
  }
  let lastError = null;
  const temperature = options.temperature ?? TASK_TEMPERATURES[taskType];
  const maxTokens = options.maxTokens ?? TASK_MAX_TOKENS[taskType];
  for (let i = 0; i < chain.length; i++) {
    const config = chain[i];
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
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
        retries: config.maxRetries
      });
      const latencyMs = Math.round(performance.now() - start);
      const normalized = normalizeResponse(raw, config, i, latencyMs);
      metrics.record(config, taskType, "success", latencyMs, normalized.estimatedCostUsd);
      circuitBreaker.recordSuccess(config.provider);
      return normalized;
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorType = err instanceof ProviderError ? err.errorType : "unknown";
      metrics.record(config, taskType, errorType, latencyMs, 0);
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
async function orchestrateStream(taskType, messages, options = {}) {
  const chain = resolveChain(taskType, options);
  if (chain.length === 0) {
    throw new Error("No AI providers enabled.");
  }
  let lastError = null;
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
        retries: config.maxRetries
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
function createNormalizingStream(rawStream, config, chainPosition, startMs) {
  const decoder = new TextDecoder();
  let buffer = "";
  let charCount = 0;
  return new ReadableStream({
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
                if (chunk.type === "text" && chunk.content) {
                  charCount += chunk.content.length;
                }
                controller.enqueue(chunk);
              }
            } catch {
            }
          }
        }
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
          }
        }
        const latencyMs = Math.round(performance.now() - startMs);
        const estimatedOutputTokens = Math.ceil(charCount / 4);
        const estimatedCost = estimatedOutputTokens / 1e3 * config.costPer1kOutput;
        metrics.record(config, "chat", "success", latencyMs, estimatedCost);
        controller.enqueue({ type: "done" });
        controller.close();
      } catch (err) {
        const latencyMs = Math.round(performance.now() - startMs);
        metrics.record(config, "chat", "stream_error", latencyMs, 0);
        controller.enqueue({
          type: "error",
          content: err instanceof Error ? err.message : "Stream error"
        });
        controller.close();
      } finally {
        try {
          reader.releaseLock();
        } catch {
        }
      }
    }
  });
}
function parseSSELine(line, provider) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  if (trimmed.startsWith("event:")) return null;
  let payload = trimmed;
  if (trimmed.startsWith("data:")) {
    payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return { type: "done" };
  }
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
function parseGeminiChunk(data) {
  const candidate = data.candidates?.[0];
  const grounding = candidate?.groundingMetadata;
  if (grounding) return { type: "grounding", metadata: grounding };
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("");
  if (text) return { type: "text", content: text };
  return null;
}
function parseOpenAIChunk(data) {
  const choice = data.choices?.[0];
  if (choice?.delta?.content) return { type: "text", content: choice.delta.content };
  if (choice?.finish_reason === "stop") return { type: "done" };
  return null;
}
function parseAnthropicChunk(data) {
  if (data.type === "content_block_delta") {
    if (data.delta?.type === "text_delta") return { type: "text", content: data.delta.text };
    if (data.delta?.type === "thinking_delta") return { type: "thought", content: data.delta.thinking };
  }
  if (data.type === "message_stop") return { type: "done" };
  return null;
}
const COST_CEILING_PER_HOUR = 50;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 6e4;
const METRICS_RING_SIZE = 1e3;
class MetricsCollector {
  constructor(capacity = METRICS_RING_SIZE) {
    this.capacity = capacity;
    this.cursor = 0;
    this.count = 0;
    this.hourlyCost = 0;
    this.lastHourReset = Date.now();
    this.ring = new Array(capacity).fill(null);
  }
  record(config, taskType, status, latencyMs, costUsd) {
    this.resetHourIfStale();
    this.hourlyCost += costUsd;
    const entry = {
      provider: config.provider,
      model: config.model,
      taskType,
      status,
      latencyMs,
      costUsd,
      timestamp: Date.now()
    };
    this.ring[this.cursor] = entry;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    this.emitTelemetry(entry);
  }
  isOverBudget() {
    this.resetHourIfStale();
    return this.hourlyCost > COST_CEILING_PER_HOUR;
  }
  getSummary(windowMinutes = 60) {
    const cutoff = Date.now() - windowMinutes * 6e4;
    const byProvider = {};
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
      totalCostUsd: Math.round(totalCost * 1e4) / 1e4,
      totalRequests,
      byProvider
    };
  }
  resetHourIfStale() {
    if (Date.now() - this.lastHourReset > 36e5) {
      this.hourlyCost = 0;
      this.lastHourReset = Date.now();
    }
  }
  emitTelemetry(entry) {
    if (typeof globalThis !== "undefined") {
      const telemetry = globalThis.__aiProviderTelemetry;
      telemetry?.emit?.(entry);
    }
  }
}
class CircuitBreakerManager {
  constructor() {
    this.failures = {};
    this.lastFailure = {};
    this.halfOpenProbe = {};
  }
  recordSuccess(provider) {
    this.failures[provider] = 0;
    this.halfOpenProbe[provider] = false;
  }
  recordFailure(provider) {
    this.failures[provider] = (this.failures[provider] ?? 0) + 1;
    this.lastFailure[provider] = Date.now();
    this.halfOpenProbe[provider] = false;
  }
  /**
   * Returns true if the circuit is OPEN (skip this provider).
   * When cooldown expires, transitions to half-open and allows one probe.
   */
  isOpen(provider) {
    const fails = this.failures[provider] ?? 0;
    if (fails < CIRCUIT_BREAKER_THRESHOLD) return false;
    const elapsed = Date.now() - (this.lastFailure[provider] ?? 0);
    if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      if (!this.halfOpenProbe[provider]) {
        this.halfOpenProbe[provider] = true;
        return false;
      }
      return true;
    }
    return true;
  }
  getState(provider) {
    const fails = this.failures[provider] ?? 0;
    if (fails < CIRCUIT_BREAKER_THRESHOLD) return "closed";
    const elapsed = Date.now() - (this.lastFailure[provider] ?? 0);
    if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) return "half-open";
    return "open";
  }
  getStatus() {
    return {
      google: this.getState("google"),
      openai: this.getState("openai"),
      anthropic: this.getState("anthropic")
    };
  }
}
const metrics = new MetricsCollector();
const circuitBreaker = new CircuitBreakerManager();
function getProviderHealth() {
  const summary = metrics.getSummary(60);
  return {
    circuits: circuitBreaker.getStatus(),
    enabled: {
      google: isProviderEnabled("google"),
      openai: isProviderEnabled("openai"),
      anthropic: isProviderEnabled("anthropic")
    },
    metrics: summary,
    costCeiling: {
      limitPerHour: COST_CEILING_PER_HOUR,
      currentHourlySpend: summary.totalCostUsd,
      isOverBudget: metrics.isOverBudget()
    }
  };
}
class ProviderError extends Error {
  constructor(provider, message, errorType) {
    super(`[${provider}] ${message}`);
    this.provider = provider;
    this.errorType = errorType;
    this.name = "ProviderError";
  }
}
function classifyHttpError(status) {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "unknown";
}
function normalizeResponse(raw, config, chainPosition, latencyMs) {
  const inputCost = raw.inputTokens / 1e3 * config.costPer1kInput;
  const outputCost = raw.outputTokens / 1e3 * config.costPer1kOutput;
  return {
    content: raw.content,
    groundingMetadata: raw.groundingMetadata ?? null,
    thoughts: raw.thoughts ?? null,
    servedBy: config.provider,
    model: config.model,
    isFallback: chainPosition > 0,
    chainPosition,
    latencyMs,
    estimatedCostUsd: inputCost + outputCost
  };
}
function resolveChain(taskType, options) {
  if (options.forceProvider) {
    const chain = FALLBACK_CHAINS[taskType];
    const forced = chain.find((c) => c.provider === options.forceProvider);
    if (forced && isProviderEnabled(forced.provider)) return [forced];
  }
  return FALLBACK_CHAINS[taskType].filter((c) => isProviderEnabled(c.provider));
}
function sleepWithSignal(ms, signal) {
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
function safeParseJSON(raw) {
  if (!raw || typeof raw !== "string") return { success: false, raw: String(raw ?? "") };
  let text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = text.search(/[\[{]/);
  if (first > 0) text = text.slice(first);
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
const GROUNDING_SIGNALS = [
  "odds",
  "score",
  "line",
  "spread",
  "injury",
  "live",
  "current",
  "today",
  "tonight",
  "slate",
  "starting",
  "status"
];
const ANALYSIS_SIGNALS = [
  "edge",
  "analyze",
  "analysis",
  "sharp",
  "value",
  "fade",
  "why",
  "compare",
  "should i",
  "recommend"
];
function detectTaskType(messages) {
  const last = messages[messages.length - 1];
  const text = typeof last?.content === "string" ? last.content.toLowerCase() : "";
  if (GROUNDING_SIGNALS.some((s) => text.includes(s))) return "grounding";
  if (ANALYSIS_SIGNALS.some((s) => text.includes(s))) return "analysis";
  return "chat";
}
async function extractPickStructured(args) {
  const messages = [
    ...args.systemPrompt ? [{ role: "system", content: args.systemPrompt }] : [],
    { role: "user", content: args.prompt }
  ];
  const result = await orchestrate("analysis", messages, {
    gameContext: args.gameContext ?? null,
    signal: args.signal
  });
  const parsed = safeParseJSON(result.content);
  if (!parsed.success) {
    console.warn(
      `[Pick:Parse] provider=${result.servedBy} model=${result.model} raw=${result.content.slice(0, 200)}`
    );
    return { ok: false, data: null, raw: result.content, provider: result.servedBy, model: result.model };
  }
  return { ok: true, data: parsed.data, provider: result.servedBy, model: result.model };
}
async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
async function handler(req, res) {
  if (req.method !== "POST") {
    sendJSON(res, 405, { error: "Method not allowed" });
    return;
  }
  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const gameContext = body.gameContext ?? body.game_context ?? null;
  const systemPrompt = body.systemPrompt ?? body.system_prompt;
  const mode = body.mode ?? body.task ?? "chat";
  const runId = body.run_id ?? crypto.randomUUID?.() ?? "unknown";
  const health = getProviderHealth();
  console.info("[AI:Health]", {
    run_id: runId,
    enabled: health.enabled,
    circuits: health.circuits,
    costCeiling: health.costCeiling
  });
  if (mode === "extract_pick" || mode === "pick") {
    if (!body.prompt || typeof body.prompt !== "string") {
      sendJSON(res, 400, { error: "Missing or invalid `prompt` field." });
      return;
    }
    try {
      const controller2 = new AbortController();
      req.on?.("close", () => controller2.abort());
      req.on?.("aborted", () => controller2.abort());
      const result = await extractPickStructured({
        prompt: body.prompt,
        systemPrompt: systemPrompt ? String(systemPrompt) : void 0,
        gameContext,
        signal: controller2.signal
      });
      sendJSON(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Pick extraction failed.";
      sendJSON(res, 500, { error: message });
    }
    return;
  }
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
    const stream = await orchestrateStream(taskType, messages, {
      gameContext,
      signal: controller.signal,
      systemPrompt,
      onFallback: (from, to, reason) => {
        console.warn(`[${runId}] Fallback: ${from.provider}/${from.model} \u2192 ${to.provider}/${to.model}: ${reason}`);
      }
    });
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value;
      const wireChunk = {
        type: chunk.type === "thought" ? "thought" : chunk.type === "grounding" ? "grounding" : chunk.type === "error" ? "error" : "text",
        content: chunk.content,
        metadata: chunk.metadata,
        done: chunk.type === "done"
      };
      res.write(`data: ${JSON.stringify(wireChunk)}

`);
      if (chunk.type === "done") res.write("data: [DONE]\n\n");
    }
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stream failed.";
    res.write(`data: ${JSON.stringify({ type: "error", content: message })}

`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
}
function sendJSON(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}
async function POST(req) {
  const body = await req.json();
  const messages = body.messages ?? [];
  const gameContext = body.gameContext ?? body.game_context ?? null;
  const systemPrompt = body.systemPrompt ?? body.system_prompt;
  const mode = body.mode ?? body.task ?? "chat";
  const prompt = body.prompt;
  if (mode === "extract_pick" || mode === "pick") {
    if (!prompt || typeof prompt !== "string") {
      return Response.json({ error: "Missing or invalid `prompt` field." }, { status: 400 });
    }
    try {
      const result = await extractPickStructured({
        prompt,
        systemPrompt: systemPrompt ? String(systemPrompt) : void 0,
        gameContext,
        signal: req.signal
      });
      return Response.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Pick extraction failed.";
      return Response.json({ error: message }, { status: 500 });
    }
  }
  if (!messages.length) {
    return Response.json({ error: "Missing `messages` array." }, { status: 400 });
  }
  const taskType = detectTaskType(messages);
  const encoder = new TextEncoder();
  try {
    const stream = await orchestrateStream(taskType, messages, {
      gameContext,
      systemPrompt,
      signal: req.signal
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
              done: value.type === "done"
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(wireChunk)}

`));
            if (value.type === "done") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            }
          }
          controller.close();
        } catch (err) {
          const message = err instanceof Error ? err.message : "Stream error.";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", content: message })}

`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } finally {
          try {
            reader.releaseLock();
          } catch {
          }
        }
      }
    });
    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive"
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stream initialization failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
export {
  FALLBACK_CHAINS,
  MODELS,
  POST,
  ProviderError,
  TASK_MAX_TOKENS,
  TASK_TEMPERATURES,
  circuitBreaker,
  handler as default,
  detectTaskType,
  extractPickStructured,
  getProviderHealth,
  metrics,
  orchestrate,
  orchestrateStream,
  safeParseJSON
};
