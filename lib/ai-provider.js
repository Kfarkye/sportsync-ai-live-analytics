const MODELS = {
  google: { primary: "gemini-3-pro", fast: "gemini-3-flash" },
  openai: { primary: "gpt-5", fast: "gpt-5-mini" },
  anthropic: { primary: "claude-sonnet-4-5-20250929", fast: "claude-haiku-4-5", deep: "claude-opus-4-6" }
};
const PROVIDER_DEFAULTS = {
  google: { timeoutMs: 3e4, costPer1kInput: 125e-5, costPer1kOutput: 5e-3, supportsGrounding: true, supportsStreaming: true, maxRetries: 1 },
  openai: { timeoutMs: 6e4, costPer1kInput: 3e-3, costPer1kOutput: 0.015, supportsGrounding: true, supportsStreaming: true, maxRetries: 1 },
  anthropic: { timeoutMs: 6e4, costPer1kInput: 3e-3, costPer1kOutput: 0.015, supportsGrounding: true, supportsStreaming: true, maxRetries: 1 }
};
function makeConfig(provider, model, overrides = {}) {
  return Object.freeze({ provider, model, ...PROVIDER_DEFAULTS[provider], ...overrides });
}
const FALLBACK_CHAINS = {
  grounding: [makeConfig("google", MODELS.google.primary), makeConfig("openai", MODELS.openai.primary), makeConfig("anthropic", MODELS.anthropic.primary)],
  analysis: [makeConfig("google", MODELS.google.primary), makeConfig("anthropic", MODELS.anthropic.primary), makeConfig("openai", MODELS.openai.primary)],
  chat: [makeConfig("google", MODELS.google.fast, { timeoutMs: 15e3 }), makeConfig("openai", MODELS.openai.fast, { timeoutMs: 2e4 }), makeConfig("anthropic", MODELS.anthropic.fast, { timeoutMs: 2e4 })],
  vision: [makeConfig("anthropic", MODELS.anthropic.primary), makeConfig("openai", MODELS.openai.primary), makeConfig("google", MODELS.google.primary)],
  code: [makeConfig("anthropic", MODELS.anthropic.primary), makeConfig("openai", MODELS.openai.primary), makeConfig("google", MODELS.google.primary)],
  recruiting: [makeConfig("openai", MODELS.openai.primary), makeConfig("anthropic", MODELS.anthropic.primary), makeConfig("google", MODELS.google.primary)]
};
const TASK_TEMPERATURES = { grounding: 0.3, analysis: 0.5, chat: 0.7, vision: 0.2, code: 0.3, recruiting: 0.5 };
const TASK_MAX_TOKENS = { grounding: 4e3, analysis: 8e3, chat: 2e3, vision: 2e3, code: 8e3, recruiting: 4e3 };
const COST_CEILING_PER_HOUR = 50;
const ANTHROPIC_WEB_SEARCH_BETA = "web-search-2025-03-05";
let log = {
  info: (event, data) => console.log(JSON.stringify({ level: "INFO", event, ts: (/* @__PURE__ */ new Date()).toISOString(), ...data })),
  warn: (event, data) => console.warn(JSON.stringify({ level: "WARN", event, ts: (/* @__PURE__ */ new Date()).toISOString(), ...data })),
  error: (event, data) => console.error(JSON.stringify({ level: "ERROR", event, ts: (/* @__PURE__ */ new Date()).toISOString(), ...data }))
};
let persistence = null;
function installPersistence(adapter) {
  persistence = adapter;
  log.info("persistence_installed", { adapter: adapter.constructor?.name ?? "custom" });
}
class MetricsCollector {
  constructor(capacity = 1e3) {
    this.cursor = 0;
    this.count = 0;
    this.hourlyCost = 0;
    this.lastHourReset = Date.now();
    this.capacity = capacity;
    this.ring = new Array(capacity).fill(null);
  }
  record(config, taskType, status, latencyMs, costUsd) {
    this.resetHourIfStale();
    this.hourlyCost += costUsd;
    if (persistence && costUsd > 0) {
      persistence.incrHourlyCost(costUsd, 36e5).catch((e) => log.warn("persistence_cost_write_failed", { error: String(e) }));
    }
    this.ring[this.cursor] = { provider: config.provider, model: config.model, taskType, status, latencyMs, costUsd, timestamp: Date.now() };
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  isOverBudget() {
    this.resetHourIfStale();
    return this.hourlyCost > COST_CEILING_PER_HOUR;
  }
  getSummary(windowMinutes = 60) {
    const cutoff = Date.now() - windowMinutes * 6e4;
    const byProvider = {};
    let totalCostUsd = 0;
    let totalRequests = 0;
    for (let i = 0; i < this.count; i++) {
      const entry = this.ring[i];
      if (!entry || entry.timestamp <= cutoff) continue;
      totalRequests++;
      totalCostUsd += entry.costUsd;
      if (!byProvider[entry.provider]) {
        byProvider[entry.provider] = { requests: 0, failures: 0, avgLatencyMs: 0, costUsd: 0 };
      }
      const p = byProvider[entry.provider];
      p.avgLatencyMs = Math.round((p.avgLatencyMs * p.requests + entry.latencyMs) / (p.requests + 1));
      p.requests++;
      if (entry.status !== "success") p.failures++;
      p.costUsd += entry.costUsd;
    }
    return { totalCostUsd, totalRequests, byProvider };
  }
  resetHourIfStale() {
    if (Date.now() - this.lastHourReset > 36e5) {
      this.hourlyCost = 0;
      this.lastHourReset = Date.now();
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
    persistence?.setCircuitFailures(provider, 0).catch(() => {
    });
  }
  recordFailure(provider) {
    this.failures[provider] = (this.failures[provider] ?? 0) + 1;
    this.lastFailure[provider] = Date.now();
    this.halfOpenProbe[provider] = false;
    persistence?.setCircuitFailures(provider, this.failures[provider], 12e4).catch(() => {
    });
  }
  isOpen(provider) {
    const fails = this.failures[provider] ?? 0;
    if (fails < 3) return false;
    if (Date.now() - (this.lastFailure[provider] ?? 0) >= 6e4) {
      if (!this.halfOpenProbe[provider]) {
        this.halfOpenProbe[provider] = true;
        return false;
      }
      return true;
    }
    return true;
  }
  getStatus() {
    const s = {};
    for (const p of ["google", "openai", "anthropic"]) {
      if ((this.failures[p] ?? 0) < 3) s[p] = "closed";
      else s[p] = Date.now() - (this.lastFailure[p] ?? 0) >= 6e4 ? "half-open" : "open";
    }
    return s;
  }
}
const metrics = new MetricsCollector();
const circuitBreaker = new CircuitBreakerManager();
class ProviderError extends Error {
  constructor(provider, message, errorType) {
    super(`[${provider}] ${message}`);
    this.provider = provider;
    this.errorType = errorType;
    this.name = "ProviderError";
  }
}
function env(key) {
  if (typeof process !== "undefined" && process.env) return process.env[key];
  if (typeof globalThis !== "undefined" && globalThis.Deno) {
    return globalThis.Deno.env.get(key);
  }
  return void 0;
}
const ENV_KEYS = { google: "GEMINI_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
const ENV_ALIASES = { google: "GOOGLE_GENERATIVE_AI_API_KEY" };
function isProviderEnabled(provider) {
  return !!(env(ENV_KEYS[provider]) || env(ENV_ALIASES[provider] ?? ""));
}
function requireKey(provider) {
  const key = env(ENV_KEYS[provider]) || env(ENV_ALIASES[provider] ?? "");
  if (!key) throw new ProviderError(provider, `API Key not set for ${provider}`, "auth");
  return key;
}
function classifyHttpError(status) {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "unknown";
}
async function sleepWithSignal(ms, signal) {
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
async function fetchWithTimeout(url, init, timeoutMs, provider) {
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
  } catch (err) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new ProviderError(provider, `Timeout after ${timeoutMs}ms`, "timeout");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}
async function fetchWithRetry(url, options, timeoutMs, retries = 3, provider) {
  const maxAttempts = typeof retries === "number" && Number.isFinite(retries) ? Math.min(retries, 5) : 3;
  let attempt = 0;
  while (true) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs, provider);
      if (res.status === 429 && attempt < maxAttempts) {
        const retryAfter = res.headers.get("Retry-After");
        let delay2 = retryAfter ? parseInt(retryAfter, 10) * 1e3 : Math.min(1e3 * Math.pow(2, attempt), 5e3);
        delay2 = delay2 / 2 + Math.random() * (delay2 / 2);
        log.warn("fetch_retry", { provider, attempt, status: res.status, delayMs: Math.round(delay2) });
        await sleepWithSignal(delay2, options.signal ?? void 0);
        attempt++;
        continue;
      }
      if (res.ok || res.status >= 400 && res.status < 429 && res.status !== 408) {
        return res;
      }
      if (attempt >= maxAttempts) return res;
      const baseDelay = Math.min(1e3 * Math.pow(2, attempt), 5e3);
      const delay = baseDelay / 2 + Math.random() * (baseDelay / 2);
      log.warn("fetch_retry", { provider, attempt, status: res.status, delayMs: Math.round(delay) });
      await sleepWithSignal(delay, options.signal ?? void 0);
      attempt++;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (attempt >= maxAttempts) throw err;
      const delay = 500 + Math.random() * 1e3;
      log.warn("fetch_retry_error", { provider, attempt, error: err instanceof Error ? err.message : String(err) });
      await sleepWithSignal(delay, options.signal ?? void 0);
      attempt++;
    }
  }
}
function safeParseJSON(raw) {
  if (!raw) return { success: false, raw: "" };
  let text = raw.trim().replace(/^`+(?:json)?/i, "").replace(/`+$/i, "").trim();
  const first = text.search(/[\[{]/);
  if (first > 0) text = text.slice(first);
  const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (last >= 0) text = text.slice(0, last + 1);
  try {
    return { success: true, data: JSON.parse(text), raw };
  } catch {
    return { success: false, raw };
  }
}
async function readErrorBody(res) {
  try {
    return (await res.text()).slice(0, 512);
  } catch {
    return "";
  }
}
function parseGeminiSSEPayload(parsed) {
  const candidates = parsed?.candidates;
  const candidate = candidates?.[0];
  if (!candidate) return null;
  const content = candidate.content;
  const parts = content?.parts || [];
  const textParts = [];
  const thoughtParts = [];
  const functionCalls = [];
  const metadata = candidate.groundingMetadata || null;
  for (const part of parts) {
    if (part.text !== void 0 && part.text !== null) {
      if (part.thought || part.executableCode) thoughtParts.push(part.text);
      else textParts.push(part.text);
    }
    if (part.functionCall) {
      const fc = part.functionCall;
      functionCalls.push({ name: fc.name, args: fc.args || {} });
    }
  }
  if (functionCalls.length > 0) return { type: "function_call", functionCalls };
  if (textParts.length > 0) return { type: "text", content: textParts.join(""), ...metadata ? { metadata } : {} };
  if (metadata) return { type: "grounding", metadata };
  if (thoughtParts.length > 0) return { type: "thought", content: thoughtParts.join("") };
  return null;
}
function parseEventBlock(block, provider) {
  const lines = block.split(/\r?\n/);
  const dataLines = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  if (!dataLines.length) return null;
  const payload = dataLines.join("\n").trim();
  if (payload === "[DONE]") return { type: "done" };
  try {
    const data = JSON.parse(payload);
    if (provider === "google") return parseGeminiSSEPayload(data);
    if (provider === "openai") {
      if (data.type?.startsWith("response.")) {
        if (data.type === "response.output_text.delta") return { type: "text", content: data.delta };
        if (data.type === "response.completed") return { type: "done" };
        return null;
      }
      const delta = data.choices?.[0]?.delta;
      if (delta?.reasoning_content) return { type: "thought", content: delta.reasoning_content };
      if (delta?.content) return { type: "text", content: delta.content };
      return null;
    }
    if (provider === "anthropic") {
      if (data.type === "content_block_delta") {
        if (data.delta?.type === "text_delta") return { type: "text", content: data.delta.text };
        if (data.delta?.type === "thinking_delta") return { type: "thought", content: data.delta.thinking };
      }
      if (data.type === "content_block_start" && data.content_block?.type === "web_search_tool_result") {
        const urls = data.content_block.content?.filter((r) => r.type === "web_search_result").map((r) => ({ web: { uri: r.url, title: r.title } }));
        if (urls?.length) return { type: "grounding", metadata: { groundingChunks: urls, webSearchQueries: [] } };
      }
      if (data.type === "message_stop") return { type: "done" };
      return null;
    }
  } catch {
  }
  return null;
}
class SSEParser {
  constructor() {
    this.buffer = "";
  }
  parse(chunk) {
    this.buffer += chunk;
    const events = [];
    let index;
    while ((index = this.buffer.indexOf("\n\n")) !== -1) {
      events.push(this.buffer.slice(0, index));
      this.buffer = this.buffer.slice(index + 2);
    }
    return events;
  }
  flush() {
    if (this.buffer.trim()) {
      const event = this.buffer;
      this.buffer = "";
      return [event];
    }
    return [];
  }
}
function extractSystemText(messages) {
  const system = messages.find((m) => m.role === "system");
  return typeof system?.content === "string" ? system.content : "";
}
function splitSystemPrompt(messages) {
  return { systemPrompt: extractSystemText(messages), messages: messages.filter((m) => m.role !== "system") };
}
function toGeminiFormat(messages) {
  return messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: typeof m.content === "string" ? [{ text: m.content }] : m.content.map(
      (p) => p.type === "text" ? { text: p.text } : { inlineData: { mimeType: p.source.media_type, data: p.source.data } }
    )
  }));
}
function toOpenAIFormat(messages) {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map(
      (p) => p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.source.media_type};base64,${p.source.data}` } }
    )
  }));
}
function toOpenAIResponsesInput(messages) {
  return messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: typeof m.content === "string" ? m.content : m.content.map(
      (p) => p.type === "text" ? { type: "input_text", text: p.text } : { type: "input_image", image_url: `data:${p.source.media_type};base64,${p.source.data}` }
    )
  }));
}
function buildOpenAIChatBody(req, stream) {
  return {
    model: req.model,
    messages: toOpenAIFormat(req.messages),
    temperature: req.temperature,
    max_completion_tokens: req.maxTokens,
    stream
  };
}
function toAnthropicFormat(messages) {
  return messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map(
      (p) => p.type === "text" ? { type: "text", text: p.text } : { type: "image", source: p.source }
    )
  }));
}
const googleClient = {
  async chat(req) {
    const apiKey = requireKey("google");
    const body = { contents: toGeminiFormat(req.messages), generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens } };
    const sys = extractSystemText(req.messages);
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    if (req.enableGrounding) body.tools = [{ googleSearch: {} }];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent`;
    const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body), signal: req.signal }, 3e4, req.retries ?? 3, "google");
    if (!res.ok) throw new ProviderError("google", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    const data = await res.json();
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!content && candidate?.finishReason === "SAFETY") throw new ProviderError("google", "Safety filter triggered", "safety_block");
    return { content, groundingMetadata: candidate?.groundingMetadata ?? data.groundingMetadata ?? null, inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 };
  },
  async chatStream(req) {
    const apiKey = requireKey("google");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:streamGenerateContent?alt=sse`;
    const body = { contents: toGeminiFormat(req.messages), generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens } };
    const sys = extractSystemText(req.messages);
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    if (req.enableGrounding) body.tools = [{ googleSearch: {} }];
    const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body), signal: req.signal }, 3e4, req.retries ?? 3, "google");
    if (!res.ok) throw new ProviderError("google", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    if (!res.body) throw new ProviderError("google", "Empty body", "server");
    return res.body;
  },
  async chatStreamRaw(contents, req) {
    const apiKey = requireKey("google");
    const body = {
      contents,
      generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens, ...req.thinkingLevel ? { thinkingConfig: { thinkingLevel: req.thinkingLevel } } : {} }
    };
    if (req.systemInstruction) body.systemInstruction = { parts: [{ text: req.systemInstruction }] };
    const toolObj = {};
    let hasTools = false;
    if (req.enableGrounding || req.tools?.enableGrounding) {
      toolObj.googleSearch = {};
      hasTools = true;
    }
    if (req.tools?.functionDeclarations && req.tools.functionDeclarations.length > 0) {
      toolObj.functionDeclarations = req.tools.functionDeclarations;
      hasTools = true;
    }
    if (hasTools) body.tools = [toolObj];
    if (req.toolConfig) body.toolConfig = req.toolConfig;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:streamGenerateContent?alt=sse`;
    const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body), signal: req.signal }, 3e4, 3, "google");
    if (!res.ok) throw new ProviderError("google", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    if (!res.body) throw new ProviderError("google", "Empty body", "server");
    return res.body;
  }
};
const openaiClient = {
  async chat(req) {
    const apiKey = requireKey("openai");
    if (req.enableGrounding) {
      const body = { model: req.model, input: toOpenAIResponsesInput(req.messages), tools: [{ type: "web_search" }], stream: false, store: false };
      const sys = extractSystemText(req.messages);
      if (sys) body.instructions = sys;
      const res2 = await fetchWithRetry("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: req.signal }, 6e4, req.retries ?? 3, "openai");
      if (!res2.ok) throw new ProviderError("openai", `${res2.status}: ${await readErrorBody(res2)}`, classifyHttpError(res2.status));
      const data2 = await res2.json();
      const textBlock = data2.output?.find((o) => o.type === "message")?.content?.find((c) => c.type === "output_text");
      const urls = textBlock?.annotations?.filter((a) => a.type === "url_citation").map((a) => ({ web: { uri: a.url, title: a.title } })) ?? [];
      return { content: textBlock?.text ?? "", groundingMetadata: urls.length ? { groundingChunks: urls, webSearchQueries: [] } : null, inputTokens: data2.usage?.input_tokens ?? 0, outputTokens: data2.usage?.output_tokens ?? 0, _searchCost: (data2.output?.filter((o) => o.type === "web_search_call").length ?? 0) * 0.01 };
    }
    const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(buildOpenAIChatBody(req, false)), signal: req.signal }, 6e4, req.retries ?? 3, "openai");
    if (!res.ok) throw new ProviderError("openai", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content ?? "", inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
  },
  async chatStream(req) {
    const apiKey = requireKey("openai");
    const isGrounding = req.enableGrounding;
    const endpoint = isGrounding ? "https://api.openai.com/v1/responses" : "https://api.openai.com/v1/chat/completions";
    let body;
    if (isGrounding) {
      body = { model: req.model, input: toOpenAIResponsesInput(req.messages), tools: [{ type: "web_search" }], stream: true, store: false };
      const sys = extractSystemText(req.messages);
      if (sys) body.instructions = sys;
    } else {
      body = buildOpenAIChatBody(req, true);
    }
    const res = await fetchWithRetry(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: req.signal }, 6e4, req.retries ?? 3, "openai");
    if (!res.ok) throw new ProviderError("openai", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    if (!res.body) throw new ProviderError("openai", "Empty body", "server");
    return res.body;
  }
};
const anthropicClient = {
  async chat(req) {
    const apiKey = requireKey("anthropic");
    const { systemPrompt, messages } = splitSystemPrompt(req.messages);
    const headers = { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    const body = { model: req.model, system: systemPrompt, messages: toAnthropicFormat(messages), temperature: req.temperature, max_tokens: req.maxTokens };
    if (req.enableGrounding) {
      headers["anthropic-beta"] = ANTHROPIC_WEB_SEARCH_BETA;
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
    }
    const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body), signal: req.signal }, 6e4, req.retries ?? 3, "anthropic");
    if (!res.ok) throw new ProviderError("anthropic", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    const data = await res.json();
    const textBlocks = data.content?.filter((b) => b.type === "text") ?? [];
    const thinkBlocks = data.content?.filter((b) => b.type === "thinking") ?? [];
    const urls = [];
    if (req.enableGrounding) {
      data.content?.forEach((block) => {
        if (block.type === "web_search_tool_result" && block.content) {
          block.content.forEach((r) => {
            if (r.url) urls.push({ web: { uri: r.url, title: r.title } });
          });
        }
        if (block.type === "text" && block.citations) {
          block.citations.forEach((c) => {
            if (c.url) urls.push({ web: { uri: c.url, title: c.title } });
          });
        }
      });
    }
    return {
      content: textBlocks.map((b) => b.text ?? "").join(""),
      thoughts: thinkBlocks.length > 0 ? thinkBlocks.map((b) => b.thinking ?? "").join("") : null,
      groundingMetadata: urls.length ? { groundingChunks: urls, webSearchQueries: [] } : null,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      _searchCost: (data.usage?.server_tool_use?.web_search_requests ?? 0) * 0.01
    };
  },
  async chatStream(req) {
    const apiKey = requireKey("anthropic");
    const { systemPrompt, messages } = splitSystemPrompt(req.messages);
    const headers = { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    const body = { model: req.model, system: systemPrompt, messages: toAnthropicFormat(messages), temperature: req.temperature, max_tokens: req.maxTokens, stream: true };
    if (req.enableGrounding) {
      headers["anthropic-beta"] = ANTHROPIC_WEB_SEARCH_BETA;
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
    }
    const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body), signal: req.signal }, 6e4, req.retries ?? 3, "anthropic");
    if (!res.ok) throw new ProviderError("anthropic", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    if (!res.body) throw new ProviderError("anthropic", "Empty body", "server");
    return res.body;
  }
};
const CLIENTS = { google: googleClient, openai: openaiClient, anthropic: anthropicClient };
const GROUNDING_PATTERNS = [
  /search (?:for |the )?(?:current|latest|live|real[- ]time)\b[^.]*./gi,
  /use (?:google )?search (?:grounding|to find)\b[^.]*./gi,
  /look up (?:current|latest|live)\b[^.]*./gi,
  /verify (?:with|using|via) (?:search|grounding|google)\b[^.]*./gi
];
function shapePrompt(messages, config, taskType, options) {
  let systemContent = options.systemPrompt ?? extractSystemText(messages);
  const nonSystem = messages.filter((m) => m.role !== "system");
  if (!config.supportsGrounding && taskType === "grounding") {
    GROUNDING_PATTERNS.forEach((p) => systemContent = systemContent.replace(p, ""));
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
  if (config.provider === "google" && taskType === "grounding") systemContent += "\n\nCite your sources. Include specific numbers, timestamps, and data points from search results.";
  if (config.provider === "openai" && taskType === "analysis") systemContent += "\n\nBe precise with numerical claims. Structure your reasoning step by step.";
  return [{ role: "system", content: systemContent }, ...nonSystem];
}
function resolveChain(taskType, options) {
  if (options.forceProvider) {
    const forced = FALLBACK_CHAINS[taskType].find((c) => c.provider === options.forceProvider);
    if (forced && isProviderEnabled(forced.provider)) return [forced];
  }
  return FALLBACK_CHAINS[taskType].filter((c) => isProviderEnabled(c.provider));
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
    estimatedCostUsd: inputCost + outputCost + (raw._searchCost ?? 0)
  };
}
async function orchestrate(taskType, messages, options = {}) {
  const chain = resolveChain(taskType, options);
  if (!chain.length) throw new Error("No active providers enabled. Set at least one API key.");
  let lastError = null;
  const defaults = { temperature: TASK_TEMPERATURES[taskType], maxTokens: TASK_MAX_TOKENS[taskType] };
  for (let i = 0; i < chain.length; i++) {
    const config = chain[i];
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (circuitBreaker.isOpen(config.provider)) {
      log.info("circuit_open_skip", { provider: config.provider, taskType });
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
      if (errorType !== "safety_block") circuitBreaker.recordFailure(config.provider);
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (i < chain.length - 1) options.onFallback?.(config, chain[i + 1], lastError?.message || "");
    }
  }
  throw lastError ?? new Error("All providers failed.");
}
async function orchestrateStream(taskType, messages, options = {}) {
  const chain = resolveChain(taskType, options);
  if (!chain.length) throw new Error("No active providers enabled.");
  let lastError = null;
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
        retries: config.maxRetries
      });
      circuitBreaker.recordSuccess(config.provider);
      return createNormalizingStream(rawStream, config, i, start, taskType);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      circuitBreaker.recordFailure(config.provider);
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (i < chain.length - 1) options.onFallback?.(config, chain[i + 1], lastError.message);
    }
  }
  throw lastError ?? new Error("All providers failed.");
}
function createNormalizingStream(rawStream, config, chainPosition, startMs, taskType) {
  let charCount = 0;
  return new ReadableStream({
    async start(controller) {
      const reader = rawStream.getReader();
      const decoder = new TextDecoder("utf-8");
      const parser = new SSEParser();
      const processEventBlocks = (blocks) => {
        for (const block of blocks) {
          const chunk = parseEventBlock(block, config.provider);
          if (chunk) {
            chunk.servedBy = config.provider;
            chunk.model = config.model;
            chunk.isFallback = chainPosition > 0;
            if (chunk.type === "text" && chunk.content) charCount += chunk.content.length;
            controller.enqueue(chunk);
          }
        }
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const decoded = decoder.decode(value, { stream: true });
          processEventBlocks(parser.parse(decoded));
        }
        processEventBlocks(parser.flush());
        const latencyMs = Math.round(performance.now() - startMs);
        const estCost = Math.ceil(charCount / 4) / 1e3 * config.costPer1kOutput;
        metrics.record(config, taskType, "success", latencyMs, estCost);
        controller.enqueue({ type: "done", servedBy: config.provider, model: config.model, isFallback: chainPosition > 0 });
      } catch (err) {
        metrics.record(config, taskType, "stream_error", Math.round(performance.now() - startMs), 0);
        controller.enqueue({ type: "error", content: err instanceof Error ? err.message : "Stream interrupted." });
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
    cancel(reason) {
      rawStream.cancel(reason).catch(() => {
      });
    }
  });
}
const GROUNDING_LEXICON = [["odds", 3], ["score", 3], ["line", 2], ["spread", 3], ["moneyline", 3], ["live", 2], ["current", 2], ["right now", 3]];
const ANALYSIS_LEXICON = [["edge", 3], ["analyze", 3], ["sharp", 2], ["value", 2], ["expected value", 3], ["ev", 2], ["roi", 2], ["clv", 3], ["model", 2], ["handicap", 2]];
const CODE_LEXICON = [["code", 3], ["function", 2], ["debug", 3], ["error", 1], ["bug", 2], ["typescript", 3], ["sql", 3], ["react", 2], ["regex", 3]];
function scoreText(text, lexicon) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const [term, weight] of lexicon) {
    if (lower.includes(term)) score += weight;
  }
  return score;
}
function detectTaskType(messages) {
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return "chat";
  let text = "";
  if (typeof lastMsg.content === "string") text = lastMsg.content;
  else if (Array.isArray(lastMsg.content)) text = lastMsg.content.filter((p) => p.type === "text").map((p) => p.text).join(" ");
  if (!text) return Array.isArray(lastMsg.content) && lastMsg.content.some((p) => p.type === "image") ? "vision" : "chat";
  const scores = { grounding: scoreText(text, GROUNDING_LEXICON), analysis: scoreText(text, ANALYSIS_LEXICON), code: scoreText(text, CODE_LEXICON) };
  const winner = Object.entries(scores).reduce((a, b) => a[1] >= b[1] ? a : b);
  return winner[1] >= 3 ? winner[0] : "chat";
}
async function extractPickStructured(args) {
  const messages = [...args.systemPrompt ? [{ role: "system", content: args.systemPrompt }] : [], { role: "user", content: args.prompt }];
  const result = await orchestrate("analysis", messages, { gameContext: args.gameContext, signal: args.signal });
  const parsed = safeParseJSON(result.content);
  return { ok: parsed.success, data: parsed.data, raw: result.content, provider: result.servedBy, model: result.model };
}
function getProviderHealth() {
  const summary = metrics.getSummary(60);
  return {
    circuits: circuitBreaker.getStatus(),
    enabled: { google: isProviderEnabled("google"), openai: isProviderEnabled("openai"), anthropic: isProviderEnabled("anthropic") },
    metrics: summary,
    costCeiling: { limitPerHour: COST_CEILING_PER_HOUR, currentHourlySpend: summary.totalCostUsd, isOverBudget: metrics.isOverBudget() }
  };
}
async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const taskType = body.mode ?? body.task ?? detectTaskType(body.messages || []);
  if (taskType === "pick" || taskType === "extract_pick") {
    try {
      const out = await extractPickStructured({ prompt: body.prompt, systemPrompt: body.systemPrompt, gameContext: body.gameContext, signal: req.signal });
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }
  const enc = new TextEncoder();
  try {
    const stream = await orchestrateStream(taskType, body.messages ?? [], {
      gameContext: body.gameContext,
      systemPrompt: body.systemPrompt,
      signal: req.signal
    });
    const sse = new ReadableStream({
      async start(ctl) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            ctl.enqueue(enc.encode(`data: ${JSON.stringify({ ...value, done: false })}

`));
          }
          ctl.enqueue(enc.encode("data: [DONE]\n\n"));
        } catch (e) {
          log.error("edge_stream_error", { error: e instanceof Error ? e.message : String(e) });
          ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: "error", content: e instanceof Error ? e.message : String(e) })}

data: [DONE]

`));
        } finally {
          reader.releaseLock();
          ctl.close();
        }
      }
    });
    return new Response(sse, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }
    });
  } catch (e) {
    log.error("edge_orchestrate_error", { error: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end();
  }
  const decoder = new TextDecoder();
  let bodyText = "";
  for await (const chunk of req) {
    bodyText += decoder.decode(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk), { stream: true });
  }
  bodyText += decoder.decode();
  const body = JSON.parse(bodyText || "{}");
  const taskType = body.mode || body.task || detectTaskType(body.messages || []);
  if (taskType === "pick" || taskType === "extract_pick") {
    try {
      const out = await extractPickStructured({ prompt: body.prompt, systemPrompt: body.systemPrompt, gameContext: body.gameContext });
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(out));
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const controller = new AbortController();
  const onSocketClose = () => controller.abort();
  req.on("close", onSocketClose);
  try {
    const stream = await orchestrateStream(taskType, body.messages || [], {
      gameContext: body.gameContext,
      systemPrompt: body.systemPrompt,
      signal: controller.signal
    });
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(`data: ${JSON.stringify({ ...value, done: value.type === "done" })}

`);
    }
    res.write("data: [DONE]\n\n");
  } catch (e) {
    log.error("node_stream_error", { error: e instanceof Error ? e.message : String(e) });
    res.write(`data: ${JSON.stringify({ type: "error", content: e instanceof Error ? e.message : String(e) })}

data: [DONE]

`);
  } finally {
    req.removeListener("close", onSocketClose);
    res.end();
  }
}
export {
  CLIENTS,
  FALLBACK_CHAINS,
  MODELS,
  POST,
  ProviderError,
  TASK_MAX_TOKENS,
  TASK_TEMPERATURES,
  anthropicClient,
  circuitBreaker,
  handler as default,
  detectTaskType,
  extractPickStructured,
  getProviderHealth,
  googleClient,
  installPersistence,
  isProviderEnabled,
  log,
  metrics,
  openaiClient,
  orchestrate,
  orchestrateStream,
  parseGeminiSSEPayload,
  persistence,
  safeParseJSON
};
