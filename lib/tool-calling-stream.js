import { stableStringify } from "./tool-result-cache.js";
import { TOOL_HANDLERS } from "./tool-handlers.js";
import { sanitizeToolError } from "./tool-error-sanitizer.js";
import {
  MAX_TOOL_ROUNDS,
  MAX_CONCURRENT_TOOLS,
  TOOL_TIMEOUT_MS,
  DEADLINE_BUFFER_MS
} from "./tool-registry.js";
import { parseGeminiSSEPayload } from "./ai-provider.js";
function createToolCallingStream(chatStreamFn, initialContents, config, toolCache, toolContext, requestStartTime, requestId) {
  const abortController = new AbortController();
  const { signal } = abortController;
  if (toolContext.signal) {
    if (toolContext.signal.aborted) {
      abortController.abort(toolContext.signal.reason);
    } else {
      toolContext.signal.addEventListener("abort", () => abortController.abort(toolContext.signal.reason), { once: true });
    }
  }
  const mergedContext = { ...toolContext, signal };
  let closed = false;
  const telemetry = {
    tool_rounds: 0,
    tool_calls: [],
    tool_calls_total: 0,
    cache_hit_rate: 0,
    tool_latency_ms_total: 0,
    text_gated_rounds: 0
  };
  return new ReadableStream({
    async start(controller) {
      let round = 0;
      const conversationHistory = [...initialContents];
      let cacheHits = 0;
      let cacheMisses = 0;
      try {
        while (round < MAX_TOOL_ROUNDS && !signal.aborted) {
          round++;
          telemetry.tool_rounds = round;
          const elapsed = Date.now() - requestStartTime;
          const remaining = 3e5 - elapsed;
          if (remaining < DEADLINE_BUFFER_MS) {
            telemetry.deadline_skip = true;
            console.warn(`[TOOL_STREAM] [${requestId}] Deadline approaching (${remaining}ms remaining). Skipping tool round ${round}.`);
            break;
          }
          const rawStream = await chatStreamFn(conversationHistory);
          const reader = rawStream.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = "";
          const roundTextBuffer = [];
          const pendingCalls = [];
          try {
            while (!signal.aborted) {
              const { done, value } = await reader.read();
              if (done) break;
              sseBuffer += decoder.decode(value, { stream: true });
              // DIAG: log first 200 chars of raw stream data on first read
              if (round === 1 && roundTextBuffer.length === 0 && pendingCalls.length === 0) {
                console.log(`[TOOL_DIAG] [${requestId}] Raw SSE chunk (first 200): ${sseBuffer.slice(0, 200).replace(/\n/g, "\\n")}`);
              }
              const events = sseBuffer.split("\n\n");
              sseBuffer = events.pop() || "";
              for (const event of events) {
                for (const line of event.split("\n")) {
                  if (!line.startsWith("data:")) continue;
                  const payload = line.slice(5).trim();
                  if (!payload || payload === "[DONE]") continue;
                  let parsed;
                  try {
                    parsed = JSON.parse(payload);
                  } catch (parseErr) {
                    // DIAG: log JSON parse failures
                    console.warn(`[TOOL_DIAG] [${requestId}] JSON parse failed: ${payload.slice(0, 100)}`, parseErr.message);
                    continue;
                  }
                  const chunk = parseGeminiSSEPayload(parsed);
                  if (!chunk) continue;
                  if (chunk.type === "function_call" && chunk.functionCalls) {
                    pendingCalls.push(...chunk.functionCalls);
                  } else if (chunk.type === "text" || chunk.type === "thought") {
                    roundTextBuffer.push(chunk);
                  } else if (chunk.type === "grounding") {
                    if (!closed && !signal.aborted) {
                      chunk.servedBy = config.provider;
                      chunk.model = config.model;
                      controller.enqueue(chunk);
                    }
                  }
                }
              }
            }
          } finally {
            reader.releaseLock();
          }
          if (pendingCalls.length === 0) {
            for (const chunk of roundTextBuffer) {
              if (!closed && !signal.aborted) {
                chunk.servedBy = config.provider;
                chunk.model = config.model;
                controller.enqueue(chunk);
              }
            }
            break;
          }
          telemetry.text_gated_rounds++;
          if (!closed && !signal.aborted) {
            controller.enqueue({
              type: "tool_status",
              tools: [...new Set(pendingCalls.map((fc) => fc.name))],
              status: "calling"
            });
          }
          telemetry.tool_calls_total += pendingCalls.length;
          telemetry.tool_calls.push(...pendingCalls.map((fc) => fc.name));
          const toolResults = await executeAndMapResults(
            pendingCalls,
            mergedContext,
            toolCache,
            signal,
            requestId
          );
          for (const r of toolResults) {
            if (r.cached) cacheHits++;
            else cacheMisses++;
            if (r.latency_ms) telemetry.tool_latency_ms_total += r.latency_ms;
          }
          if (!closed && !signal.aborted) {
            controller.enqueue({
              type: "tool_status",
              tools: [...new Set(pendingCalls.map((fc) => fc.name))],
              status: "complete"
            });
          }
          conversationHistory.push({
            role: "model",
            parts: pendingCalls.map((fc) => fc.rawPart)
          });
          conversationHistory.push({
            role: "user",
            parts: pendingCalls.map((fc, i) => ({
              functionResponse: {
                name: fc.name,
                response: toolResults[i].success ? toolResults[i].data || { success: true } : { success: false, error: toolResults[i].error || "Unknown error" }
              }
            }))
          });
        }
        const totalCacheOps = cacheHits + cacheMisses;
        telemetry.cache_hit_rate = totalCacheOps > 0 ? cacheHits / totalCacheOps : 0;
        if (!signal.aborted) {
          console.log(`[TOOL_TELEMETRY] [${requestId}]`, JSON.stringify(telemetry));
        }
      } catch (err) {
        if (!signal.aborted && !closed) {
          console.error(`[TOOL_STREAM_ERROR] [${requestId}]`, err);
          controller.enqueue({
            type: "error",
            content: "Analysis interrupted. Please retry."
          });
        }
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.enqueue({ type: "done" });
            controller.close();
          } catch {
          }
        }
      }
    },
    cancel(reason) {
      closed = true;
      abortController.abort(reason);
      telemetry.abort_reason = String(reason);
      console.log(`[TOOL_TELEMETRY] [${requestId}] Cancelled:`, JSON.stringify(telemetry));
    }
  });
}
async function executeAndMapResults(calls, ctx, cache, signal, requestId) {
  const uniqueMap = /* @__PURE__ */ new Map();
  for (const call of calls) {
    const key = `${call.name}:${stableStringify(call.args)}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, { call });
    }
  }
  const uniqueEntries = Array.from(uniqueMap.entries());
  for (let i = 0; i < uniqueEntries.length; i += MAX_CONCURRENT_TOOLS) {
    if (signal.aborted) break;
    const batch = uniqueEntries.slice(i, i + MAX_CONCURRENT_TOOLS);
    const batchResults = await Promise.allSettled(
      batch.map(([_, entry]) => executeSingleTool(entry.call, ctx, cache, requestId))
    );
    for (let j = 0; j < batch.length; j++) {
      const r = batchResults[j];
      batch[j][1].result = r.status === "fulfilled" ? r.value : {
        success: false,
        data: null,
        error: sanitizeToolError(batch[j][1].call.name, r.reason, requestId)
      };
    }
  }
  return calls.map((call) => {
    const key = `${call.name}:${stableStringify(call.args)}`;
    return uniqueMap.get(key).result;
  });
}
async function executeSingleTool(call, ctx, cache, requestId) {
  const cached = cache.get(call.name, call.args);
  if (cached) {
    return { ...cached, cached: true };
  }
  const handler = TOOL_HANDLERS[call.name];
  if (!handler) {
    return { success: false, data: null, error: `Unknown tool: ${call.name}` };
  }
  const start = Date.now();
  try {
    let timeoutId;
    const result = await Promise.race([
      handler(call.args, ctx),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Tool ${call.name} timed out after ${TOOL_TIMEOUT_MS}ms`)),
          TOOL_TIMEOUT_MS
        );
      })
    ]);
    clearTimeout(timeoutId);
    result.latency_ms = Date.now() - start;
    result.fetched_at = Date.now();
    if (result.success) {
      cache.set(call.name, call.args, result);
    }
    return result;
  } catch (err) {
    return {
      success: false,
      data: null,
      error: sanitizeToolError(call.name, err, requestId),
      latency_ms: Date.now() - start
    };
  }
}
export {
  createToolCallingStream
};
