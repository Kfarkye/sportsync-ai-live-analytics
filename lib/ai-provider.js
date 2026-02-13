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
    supportsGrounding: true,
    supportsStreaming: true,
    maxRetries: 1
  },
  anthropic: {
    timeoutMs: 6e4,
    costPer1kInput: 3e-3,
    costPer1kOutput: 0.015,
    supportsGrounding: true,
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
    makeConfig("google", MODELS.google.primary),
    makeConfig("anthropic", MODELS.anthropic.primary),
    makeConfig("openai", MODELS.openai.primary)
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
  if (typeof globalThis !== "undefined") {
    return globalThis.Deno?.env?.get(key) ?? void 0;
  }
  return void 0;
}
const ENV_KEYS = {
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY"
};
const ENV_ALIASES = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY"
};
function isProviderEnabled(provider) {
  return !!(env(ENV_KEYS[provider]) || env(ENV_ALIASES[provider] ?? ""));
}
function requireKey(provider) {
  const key = env(ENV_KEYS[provider]) || env(ENV_ALIASES[provider] ?? "");
  if (!key) throw new ProviderError(provider, `${ENV_KEYS[provider]} not set`, "auth");
  return key;
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
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}
async function fetchWithRetry(url, options, timeoutMs, retries = 3, provider = "unknown") {
  // Safety: cap retries to prevent infinite loop (e.g. if caller passes undefined/NaN/Infinity)
  retries = typeof retries === "number" && Number.isFinite(retries) ? Math.min(retries, 10) : 3;
  let attempt = 0;
  while (true) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs, provider);
      if (res.ok || res.status >= 400 && res.status < 429 && res.status !== 408) {
        return res;
      }
      if (attempt >= retries) return res;
      const delay = Math.min(1e3 * Math.pow(2, attempt), 3e3) + Math.random() * 100;
      log.warn("fetch_retry", { provider, attempt, status: res.status, delayMs: Math.round(delay) });
      await sleepWithSignal(delay, options.signal ?? void 0);
      attempt++;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (attempt >= retries) throw err;
      log.warn("fetch_retry_error", {
        provider,
        attempt,
        error: err instanceof Error ? err.message : String(err)
      });
      await sleepWithSignal(500 + Math.random() * 100, options.signal ?? void 0);
      attempt++;
    }
  }
}
async function readErrorBody(res) {
  try {
    return (await res.text()).slice(0, 512);
  } catch {
    return "";
  }
}
const googleClient = {
  async chat(req) {
    const apiKey = requireKey("google");
    const body = {
      contents: toGeminiFormat(req.messages),
      generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens }
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
        signal: req.signal
      },
      3e4,
      req.retries,
      "google"
    );
    if (!res.ok) {
      const errorBody = await readErrorBody(res);
      throw new ProviderError("google", `${res.status}: ${errorBody}`, classifyHttpError(res.status));
    }
    const data = await res.json();
    assertGeminiShape(data);
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!content && candidate?.finishReason === "SAFETY") {
      throw new ProviderError("google", "Safety filter triggered", "safety_block");
    }
    return {
      content,
      groundingMetadata: candidate?.groundingMetadata ?? data.groundingMetadata ?? void 0,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0
    };
  },
  async chatStream(req) {
    const apiKey = requireKey("google");
    const body = {
      contents: toGeminiFormat(req.messages),
      generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens }
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
        signal: req.signal
      },
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
  },
  /**
   * Stream with raw GeminiContent[] for multi-turn function call/response cycles.
   * After a tool round, conversation history includes functionCall and functionResponse
   * parts that cannot be represented as WireMessage[]. This method accepts raw format.
   */
  async chatStreamRaw(contents, req) {
    const apiKey = requireKey("google");
    const body = {
      contents,
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens,
        ...(req.thinkingLevel ? { thinkingConfig: { thinkingLevel: req.thinkingLevel } } : {})
      }
    };
    if (req.systemInstruction) {
      body.systemInstruction = { parts: [{ text: req.systemInstruction }] };
    }
    // Build merged tool object: functionDeclarations + googleSearch can coexist
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
    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: req.signal
      },
      3e4,
      3,  // Explicit retry cap: 3 retries = 4 total attempts max
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
    if (req.enableGrounding) {
      const systemText = extractSystemText(req.messages);
      const body = {
        model: req.model,
        input: toOpenAIResponsesInput(req.messages),
        tools: [{ type: "web_search" }],
        stream: false,
        store: false
      };
      if (systemText) body.instructions = systemText;
      const res2 = await fetchWithRetry(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: req.signal
        },
        6e4,
        req.retries,
        "openai"
      );
      if (!res2.ok) throw new ProviderError("openai", `${res2.status}: ${await readErrorBody(res2)}`, classifyHttpError(res2.status));
      const data2 = await res2.json();
      assertOpenAIResponsesShape(data2);
      const messageItem = data2.output?.find((o) => o.type === "message");
      const textBlock = messageItem?.content?.find((c) => c.type === "output_text");
      const searchCalls = data2.output?.filter((o) => o.type === "web_search_call").length ?? 0;
      return {
        content: textBlock?.text ?? "",
        groundingMetadata: openaiAnnotationsToGrounding(textBlock?.annotations ?? []),
        inputTokens: data2.usage?.input_tokens ?? 0,
        outputTokens: data2.usage?.output_tokens ?? 0,
        _searchCost: searchCalls * 0.01
      };
    }
    const res = await fetchWithRetry(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildOpenAIChatBody(req, false)),
        signal: req.signal
      },
      6e4,
      req.retries,
      "openai"
    );
    if (!res.ok) throw new ProviderError("openai", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    const data = await res.json();
    assertOpenAIChatShape(data);
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0
    };
  },
  async chatStream(req) {
    const apiKey = requireKey("openai");
    const endpoint = req.enableGrounding ? "https://api.openai.com/v1/responses" : "https://api.openai.com/v1/chat/completions";
    let body;
    if (req.enableGrounding) {
      const systemText = extractSystemText(req.messages);
      body = {
        model: req.model,
        input: toOpenAIResponsesInput(req.messages),
        tools: [{ type: "web_search" }],
        stream: true,
        store: false
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
        signal: req.signal
      },
      6e4,
      req.retries,
      "openai"
    );
    if (!res.ok) throw new ProviderError("openai", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    if (!res.body) throw new ProviderError("openai", "Empty response body", "server");
    return res.body;
  }
};
function toOpenAIResponsesInput(messages) {
  return messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: typeof m.content === "string" ? m.content : m.content.map(
      (p) => p.type === "text" ? { type: "input_text", text: p.text } : { type: "input_image", image_url: `data:${p.source.media_type};base64,${p.source.data}` }
    )
  }));
}
function openaiAnnotationsToGrounding(annotations) {
  if (!annotations?.length) return void 0;
  const urls = annotations.filter((a) => a.type === "url_citation").map((a) => ({ web: { uri: a.url, title: a.title } }));
  return urls.length ? { groundingChunks: urls, webSearchQueries: [] } : void 0;
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
const ANTHROPIC_WEB_SEARCH_BETA = "web-search-2025-03-05";
const anthropicClient = {
  async chat(req) {
    const apiKey = requireKey("anthropic");
    const { systemPrompt, messages } = splitSystemPrompt(req.messages);
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    };
    const body = {
      model: req.model,
      system: systemPrompt,
      messages: toAnthropicFormat(messages),
      temperature: req.temperature,
      max_tokens: req.maxTokens
    };
    if (req.enableGrounding) {
      headers["anthropic-beta"] = ANTHROPIC_WEB_SEARCH_BETA;
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
    }
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      { method: "POST", headers, body: JSON.stringify(body), signal: req.signal },
      6e4,
      req.retries,
      "anthropic"
    );
    if (!res.ok) throw new ProviderError("anthropic", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    const data = await res.json();
    assertAnthropicShape(data);
    const textBlocks = data.content?.filter((b) => b.type === "text") ?? [];
    const thinkBlocks = data.content?.filter((b) => b.type === "thinking") ?? [];
    const grounding = req.enableGrounding ? anthropicCitationsToGrounding(data.content ?? []) : void 0;
    const searchCalls = data.usage?.server_tool_use?.web_search_requests ?? 0;
    return {
      content: textBlocks.map((b) => b.text ?? "").join(""),
      thoughts: thinkBlocks.length > 0 ? thinkBlocks.map((b) => b.thinking ?? "").join("") : void 0,
      groundingMetadata: grounding,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      _searchCost: searchCalls * 0.01
    };
  },
  async chatStream(req) {
    const apiKey = requireKey("anthropic");
    const { systemPrompt, messages } = splitSystemPrompt(req.messages);
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    };
    const body = {
      model: req.model,
      system: systemPrompt,
      messages: toAnthropicFormat(messages),
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      stream: true
    };
    if (req.enableGrounding) {
      headers["anthropic-beta"] = ANTHROPIC_WEB_SEARCH_BETA;
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
    }
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      { method: "POST", headers, body: JSON.stringify(body), signal: req.signal },
      6e4,
      req.retries,
      "anthropic"
    );
    if (!res.ok) throw new ProviderError("anthropic", `${res.status}: ${await readErrorBody(res)}`, classifyHttpError(res.status));
    if (!res.body) throw new ProviderError("anthropic", "Empty response body", "server");
    return res.body;
  }
};
function anthropicCitationsToGrounding(contentBlocks) {
  const urls = [];
  const queries = [];
  for (const block of contentBlocks) {
    if (block.type === "server_tool_use" && block.name === "web_search") queries.push(block.input?.query ?? "");
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
  }
  return urls.length || queries.length ? { groundingChunks: urls, webSearchQueries: queries } : void 0;
}
const CLIENTS = {
  google: googleClient,
  openai: openaiClient,
  anthropic: anthropicClient
};
function assertGeminiShape(data) {
  if (!data || typeof data !== "object") {
    throw new ProviderError("google", "Response is not an object", "server");
  }
  const d = data;
  if (d.candidates !== void 0 && !Array.isArray(d.candidates)) {
    throw new ProviderError("google", `Unexpected candidates type: ${typeof d.candidates}`, "server");
  }
}
function assertOpenAIChatShape(data) {
  if (!data || typeof data !== "object") {
    throw new ProviderError("openai", "Response is not an object", "server");
  }
  const d = data;
  if (d.choices !== void 0 && !Array.isArray(d.choices)) {
    throw new ProviderError("openai", `Unexpected choices type: ${typeof d.choices}`, "server");
  }
}
function assertOpenAIResponsesShape(data) {
  if (!data || typeof data !== "object") {
    throw new ProviderError("openai", "Responses API: not an object", "server");
  }
  const d = data;
  if (d.output !== void 0 && !Array.isArray(d.output)) {
    throw new ProviderError("openai", `Responses API: unexpected output type: ${typeof d.output}`, "server");
  }
}
function assertAnthropicShape(data) {
  if (!data || typeof data !== "object") {
    throw new ProviderError("anthropic", "Response is not an object", "server");
  }
  const d = data;
  if (d.content !== void 0 && !Array.isArray(d.content)) {
    throw new ProviderError("anthropic", `Unexpected content type: ${typeof d.content}`, "server");
  }
}
function extractSystemText(messages) {
  const system = messages.find((m) => m.role === "system");
  return typeof system?.content === "string" ? system.content : "";
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
function toAnthropicFormat(messages) {
  return messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map(
      (p) => p.type === "text" ? { type: "text", text: p.text } : { type: "image", source: p.source }
    )
  }));
}
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
  if (config.provider === "google" && taskType === "grounding") {
    systemContent += "\n\nCite your sources. Include specific numbers, timestamps, and data points from search results.";
  }
  if (config.provider === "openai" && taskType === "analysis") {
    systemContent += "\n\nBe precise with numerical claims. Structure your reasoning step by step.";
  }
  return [{ role: "system", content: systemContent }, ...nonSystem];
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
        retries: config.maxRetries
      });
      const latencyMs = Math.round(performance.now() - start);
      const normalized = normalizeResponse(raw, config, i, latencyMs);
      metrics.record(config, taskType, "success", latencyMs, normalized.estimatedCostUsd);
      circuitBreaker.recordSuccess(config.provider);
      log.info("orchestrate_success", {
        provider: config.provider,
        model: config.model,
        taskType,
        latencyMs,
        costUsd: normalized.estimatedCostUsd,
        chainPosition: i
      });
      return normalized;
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorType = err instanceof ProviderError ? err.errorType : "unknown";
      metrics.record(config, taskType, errorType, latencyMs, 0);
      if (errorType !== "safety_block") circuitBreaker.recordFailure(config.provider);
      log.error("orchestrate_failure", {
        provider: config.provider,
        model: config.model,
        taskType,
        errorType,
        latencyMs,
        message: lastError.message,
        chainPosition: i
      });
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (i < chain.length - 1) options.onFallback?.(config, chain[i + 1], lastError.message);
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
      log.info("stream_connected", { provider: config.provider, model: config.model, taskType, chainPosition: i });
      return createNormalizingStream(rawStream, config, i, start, taskType);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      circuitBreaker.recordFailure(config.provider);
      log.error("stream_connect_failure", {
        provider: config.provider,
        model: config.model,
        taskType,
        message: lastError.message,
        chainPosition: i
      });
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (i < chain.length - 1) options.onFallback?.(config, chain[i + 1], lastError.message);
    }
  }
  throw lastError ?? new Error("All providers failed.");
}
function createNormalizingStream(rawStream, config, chainPosition, startMs, taskType) {
  const decoder = new TextDecoder();
  let buffer = "";
  let charCount = 0;
  let droppedChunks = 0;
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
                if (chunk.type === "text" && chunk.content) charCount += chunk.content.length;
                controller.enqueue(chunk);
              }
            } catch (parseErr) {
              droppedChunks++;
              log.warn("sse_parse_error", {
                provider: config.provider,
                line: line.slice(0, 200),
                error: parseErr instanceof Error ? parseErr.message : String(parseErr),
                droppedTotal: droppedChunks
              });
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
          } catch (parseErr) {
            droppedChunks++;
            log.warn("sse_parse_error_flush", {
              provider: config.provider,
              error: parseErr instanceof Error ? parseErr.message : String(parseErr)
            });
          }
        }
        const latencyMs = Math.round(performance.now() - startMs);
        const estCost = Math.ceil(charCount / 4) / 1e3 * config.costPer1kOutput;
        metrics.record(config, taskType, "success", latencyMs, estCost);
        if (droppedChunks > 0) {
          log.warn("stream_completed_with_drops", {
            provider: config.provider,
            droppedChunks,
            charCount,
            latencyMs
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
          latencyMs
        });
        controller.enqueue({ type: "error", content: err instanceof Error ? err.message : "Stream error" });
        controller.close();
      } finally {
        reader.releaseLock();
      }
    }
  });
}
function parseSSELine(line, provider) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) return null;
  let payload = trimmed;
  if (trimmed.startsWith("data:")) {
    payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return { type: "done" };
  }
  const data = JSON.parse(payload);
  if (provider === "google") {
    const c = data.candidates?.[0];
    if (c?.groundingMetadata) return { type: "grounding", metadata: c.groundingMetadata };
    const t = c?.content?.parts?.map((p) => p.text ?? "").join("");
    return t ? { type: "text", content: t } : null;
  }
  if (provider === "openai") {
    if (data.type?.startsWith("response.")) {
      const evt = data;
      if (evt.type === "response.output_text.delta") return { type: "text", content: evt.delta };
      if (evt.type === "response.completed") return { type: "done" };
      return null;
    }
    const t = data.choices?.[0]?.delta?.content;
    return t ? { type: "text", content: t } : null;
  }
  if (provider === "anthropic") {
    const d = data;
    if (d.type === "content_block_delta") {
      if (d.delta?.type === "text_delta") return { type: "text", content: d.delta.text };
      if (d.delta?.type === "thinking_delta") return { type: "thought", content: d.delta.thinking };
    }
    if (d.type === "content_block_start" && d.content_block?.type === "web_search_tool_result") {
      const urls = d.content_block.content?.filter((r) => r.type === "web_search_result").map((r) => ({ web: { uri: r.url, title: r.title } }));
      if (urls?.length) return { type: "grounding", metadata: { groundingChunks: urls, webSearchQueries: [] } };
    }
    return d.type === "message_stop" ? { type: "done" } : null;
  }
  return null;
}
const COST_CEILING_PER_HOUR = 50;
const METRICS_RING_SIZE = 1e3;
const log = {
  info(event, data) {
    console.log(JSON.stringify({ level: "INFO", event, ts: (/* @__PURE__ */ new Date()).toISOString(), ...data }));
  },
  warn(event, data) {
    console.warn(JSON.stringify({ level: "WARN", event, ts: (/* @__PURE__ */ new Date()).toISOString(), ...data }));
  },
  error(event, data) {
    console.error(JSON.stringify({ level: "ERROR", event, ts: (/* @__PURE__ */ new Date()).toISOString(), ...data }));
  }
};
let persistence = null;
function installPersistence(adapter) {
  persistence = adapter;
  log.info("persistence_installed", { adapter: adapter.constructor?.name ?? "custom" });
}
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
    if (persistence && costUsd > 0) {
      persistence.incrHourlyCost(costUsd, 36e5).catch(
        (e) => log.warn("persistence_cost_write_failed", { error: String(e) })
      );
    }
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
    return { totalCostUsd: totalCost, totalRequests, byProvider };
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
    if (persistence) {
      persistence.setCircuitFailures(provider, 0).catch(
        (e) => log.warn("persistence_circuit_write_failed", { provider, error: String(e) })
      );
    }
  }
  recordFailure(provider) {
    this.failures[provider] = (this.failures[provider] ?? 0) + 1;
    this.lastFailure[provider] = Date.now();
    this.halfOpenProbe[provider] = false;
    if (persistence) {
      persistence.setCircuitFailures(provider, this.failures[provider], 12e4).catch(
        (e) => log.warn("persistence_circuit_write_failed", { provider, error: String(e) })
      );
    }
  }
  isOpen(provider) {
    const fails = this.failures[provider] ?? 0;
    if (fails < 3) return false;
    const elapsed = Date.now() - (this.lastFailure[provider] ?? 0);
    if (elapsed >= 6e4) {
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
    estimatedCostUsd: inputCost + outputCost + (raw._searchCost ?? 0)
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
  if (!raw) return { success: false, raw: "" };
  let text = raw.trim().replace(/^`+(?:json)?/i, "").replace(/`+$/i, "").trim();
  const first = text.search(/[\[{]/);
  if (first > 0) text = text.slice(first);
  const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (last >= 0) text = text.slice(0, last + 1);
  try {
    return { success: true, data: JSON.parse(text) };
  } catch {
    return { success: false, raw };
  }
}
const GROUNDING_LEXICON = [
  // ── Live data / scores ──
  ["odds", 3],
  ["score", 3],
  ["line", 2],
  ["spread", 3],
  ["moneyline", 3],
  ["over under", 3],
  ["o/u", 3],
  ["total", 1],
  ["prop", 2],
  ["parlay", 2],
  ["injury", 2],
  ["injured", 2],
  ["questionable", 2],
  ["doubtful", 2],
  ["probable", 1],
  ["out for", 2],
  ["game time", 2],
  ["tip off", 2],
  ["tipoff", 2],
  ["kickoff", 2],
  ["first pitch", 2],
  ["puck drop", 2],
  // ── Recency signals ──
  ["live", 2],
  ["current", 2],
  ["right now", 3],
  ["tonight", 2],
  ["today", 2],
  ["this week", 1],
  ["latest", 2],
  ["real time", 3],
  ["slate", 2],
  ["starting", 1],
  ["status", 1],
  ["update", 1],
  // ── Market signals ──
  ["vig", 3],
  ["juice", 2],
  ["sharp", 2],
  ["steam", 3],
  ["movement", 2],
  ["line move", 3],
  ["opener", 2],
  ["closing", 2],
  ["consensus", 2],
  ["public", 1],
  ["handle", 2],
  ["book", 1],
  ["sportsbook", 3],
  ["fanduel", 3],
  ["draftkings", 3],
  ["betmgm", 3],
  ["bovada", 3],
  ["pinnacle", 3],
  ["bet365", 3],
  // ── Sport-specific live queries ──
  ["roster", 1],
  ["lineup", 2],
  ["rotation", 2],
  ["scratched", 2],
  ["weather", 1],
  ["wind", 1],
  ["pitch count", 2]
];
const ANALYSIS_LEXICON = [
  // ── Reasoning / evaluation ──
  ["edge", 3],
  ["analyze", 3],
  ["analysis", 3],
  ["sharp", 2],
  ["value", 2],
  ["fade", 3],
  ["lean", 2],
  ["like", 1],
  ["love", 1],
  ["hate", 1],
  ["avoid", 1],
  // ── Decision-making ──
  ["why", 1],
  ["compare", 2],
  ["should i", 3],
  ["recommend", 2],
  ["better bet", 3],
  ["best bet", 3],
  ["pick", 2],
  ["prediction", 2],
  ["handicap", 2],
  ["cap", 1],
  ["model", 2],
  ["projection", 2],
  // ── Betting strategy ──
  ["expected value", 3],
  ["ev", 2],
  ["roi", 2],
  ["clv", 3],
  ["closing line", 3],
  ["bankroll", 2],
  ["unit", 1],
  ["kelly", 3],
  ["variance", 2],
  ["regression", 2],
  ["trend", 1],
  ["correlation", 2],
  ["strength of schedule", 3],
  ["sos", 2],
  ["ats", 3],
  ["against the spread", 3],
  // ── Structured output ──
  ["breakdown", 2],
  ["deep dive", 2],
  ["report", 1],
  ["summary", 1],
  ["thesis", 2],
  ["conviction", 2]
];
const CODE_LEXICON = [
  ["code", 3],
  ["function", 2],
  ["debug", 3],
  ["error", 1],
  ["bug", 2],
  ["script", 2],
  ["api", 1],
  ["endpoint", 1],
  ["deploy", 2],
  ["sql", 3],
  ["query", 1],
  ["migration", 2],
  ["component", 2],
  ["refactor", 3],
  ["typescript", 3],
  ["javascript", 3],
  ["python", 3],
  ["react", 2],
  ["supabase", 2],
  ["regex", 3],
  ["fix", 1],
  ["implement", 2],
  ["build", 1]
];
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
  if (typeof lastMsg.content === "string") {
    text = lastMsg.content;
  } else if (Array.isArray(lastMsg.content)) {
    text = lastMsg.content.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text).join(" ");
  }
  if (!text) return "chat";
  if (Array.isArray(lastMsg.content) && lastMsg.content.some((p) => p.type === "image")) {
    return "vision";
  }
  const scores = {
    grounding: scoreText(text, GROUNDING_LEXICON),
    analysis: scoreText(text, ANALYSIS_LEXICON),
    code: scoreText(text, CODE_LEXICON)
  };
  const winner = Object.entries(scores).reduce((a, b) => a[1] >= b[1] ? a : b);
  if (winner[1] < 3) return "chat";
  log.info("task_detected", { taskType: winner[0], scores, textPreview: text.slice(0, 80) });
  return winner[0];
}
async function extractPickStructured(args) {
  const messages = [
    ...args.systemPrompt ? [{ role: "system", content: args.systemPrompt }] : [],
    { role: "user", content: args.prompt }
  ];
  const result = await orchestrate("analysis", messages, { gameContext: args.gameContext, signal: args.signal });
  const parsed = safeParseJSON(result.content);
  return { ok: parsed.success, data: parsed.data, raw: result.content, provider: result.servedBy, model: result.model };
}
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
  const { messages, gameContext, systemPrompt, mode, prompt } = body;
  if (mode === "pick" || mode === "extract_pick") {
    try {
      const out = await extractPickStructured({ prompt, systemPrompt, gameContext });
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(out));
    } catch (e) {
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
      gameContext,
      systemPrompt,
      signal: controller.signal
    });
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const wireChunk = {
        type: value.type === "thought" ? "thought" : value.type === "grounding" ? "grounding" : value.type === "error" ? "error" : "text",
        content: value.content,
        metadata: value.metadata,
        done: value.type === "done"
      };
      res.write(`data: ${JSON.stringify(wireChunk)}

`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    log.error("handler_stream_error", { error: e.message });
    res.write(`data: ${JSON.stringify({ type: "error", content: e.message })}

`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
}
async function POST(req) {
  const body = await req.json();
  const messages = body.messages ?? [];
  const gameContext = body.gameContext ?? body.game_context ?? null;
  const systemPrompt = body.systemPrompt ?? body.system_prompt;
  const mode = body.mode ?? body.task ?? "chat";
  const prompt = body.prompt;
  if (mode === "pick" || mode === "extract_pick") {
    try {
      const out = await extractPickStructured({ prompt, systemPrompt, gameContext, signal: req.signal });
      return Response.json(out);
    } catch (e) {
      log.error("edge_pick_error", { error: e.message });
      return Response.json({ error: e.message }, { status: 500 });
    }
  }
  const enc = new TextEncoder();
  try {
    const stream = await orchestrateStream(detectTaskType(messages), messages, {
      gameContext,
      systemPrompt,
      signal: req.signal
    });
    const sse = new ReadableStream({
      async start(ctl) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = { ...value, done: false };
            ctl.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}

`));
          }
          ctl.enqueue(enc.encode("data: [DONE]\n\n"));
          ctl.close();
        } catch (e) {
          log.error("edge_stream_error", { error: e.message });
          ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: "error", content: e.message })}

`));
          ctl.enqueue(enc.encode("data: [DONE]\n\n"));
          ctl.close();
        } finally {
          reader.releaseLock();
        }
      }
    });
    return new Response(sse, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  } catch (e) {
    log.error("edge_orchestrate_error", { error: e.message });
    return Response.json({ error: e.message }, { status: 500 });
  }
}

/**
 * Parse a Gemini SSE payload into a NormalizedStreamChunk.
 * Single source of truth for Gemini SSE parsing.
 * Handles: text, thoughts, function calls, grounding metadata.
 */
function parseGeminiSSEPayload(parsed) {
  const candidate = parsed?.candidates?.[0];
  if (!candidate) return null;

  const parts = candidate?.content?.parts || [];
  const textParts = [];
  const thoughtParts = [];
  const functionCalls = [];
  let groundingMetadata = null;

  for (const part of parts) {
    if (part.text !== undefined && part.text !== null) {
      if (part.thought) {
        thoughtParts.push(part.text);
      } else {
        textParts.push(part.text);
      }
    }
    if (part.functionCall) {
      functionCalls.push({
        name: part.functionCall.name,
        args: part.functionCall.args || {},
        rawPart: part,
      });
    }
  }

  if (candidate.groundingMetadata) {
    groundingMetadata = candidate.groundingMetadata;
  }

  if (functionCalls.length > 0) {
    return { type: "function_call", functionCalls };
  }
  if (textParts.length > 0) {
    return {
      type: "text",
      content: textParts.join(""),
      ...(groundingMetadata ? { metadata: groundingMetadata } : {}),
    };
  }
  if (groundingMetadata) {
    return { type: "grounding", metadata: groundingMetadata };
  }
  if (thoughtParts.length > 0) {
    return { type: "thought", content: thoughtParts.join("") };
  }

  return null;
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
  googleClient,
  installPersistence,
  log,
  metrics,
  orchestrate,
  orchestrateStream,
  parseGeminiSSEPayload,
  persistence,
  safeParseJSON
};
