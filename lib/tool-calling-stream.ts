/* ============================================================================
   tool-calling-stream.ts
   Hybrid Tool-Calling Architecture — Multi-Turn Execution Loop

   Implements: Spec Section 5.2, 5.3, 5.4
   Lockdowns: 2 (role: "user"), 3 (thoughtSignature), 4 (raw parts),
              5 (1:1 mapping), 6 (single parser), 9 (cancellation), 10 (telemetry)

   This is the architectural centerpiece. Key behaviors:
   - Turn-level text gating: buffer text per round, flush ONLY if no function
     calls detected, discard if function calls present
   - 1:1 call-response mapping: execute unique calls once, but map results
     back to every call in original order (Gemini requires a functionResponse
     for every functionCall)
   - Raw part replay: conversation history uses fc.rawPart directly
     (preserves thoughtSignature at part level)
   - Tool response role: role "user" with functionResponse parts
     (NOT role "function" — REST API requirement)
   - AbortController: cancel() handler aborts everything
   - try/catch/finally with closed guard: always close the stream
============================================================================ */

import type { ToolResult, ToolContext, ToolHandler } from "./tool-handlers.js";
import type { ToolResultCache } from "./tool-result-cache.js";
import { stableStringify } from "./tool-result-cache.js";
import { TOOL_HANDLERS } from "./tool-handlers.js";
import { sanitizeToolError } from "./tool-error-sanitizer.js";
import {
    MAX_TOOL_ROUNDS,
    MAX_CONCURRENT_TOOLS,
    TOOL_TIMEOUT_MS,
    DEADLINE_BUFFER_MS,
} from "./tool-registry.js";
import type {
    NormalizedStreamChunk,
    CapturedFunctionCall,
    GeminiContent,
    ProviderConfig,
} from "./ai-provider.js";
import { parseGeminiSSEPayload } from "./ai-provider.js";

// ── Telemetry ────────────────────────────────────────────────────────────

/**
 * Tool-calling telemetry logged on every request that uses tool-calling.
 * Logged as JSON to console for structured log ingestion.
 * Implements: Spec Lockdown 10.
 */
export interface ToolTelemetry {
    tool_rounds: number;
    tool_calls: string[];
    tool_calls_total: number;
    cache_hit_rate: number;
    tool_latency_ms_total: number;
    fallback_provider?: string;
    abort_reason?: string;
    deadline_skip?: boolean;
    text_gated_rounds: number;
}

// ── Config for provider streaming ────────────────────────────────────────

/**
 * Options for the tool-calling stream, passed from the orchestrator.
 */
export interface ToolCallingStreamOptions {
    /** Gemini model to use. */
    model: string;
    /** Max output tokens per Gemini call. */
    maxTokens: number;
    /** Temperature for generation. */
    temperature: number;
    /** System instruction for the Gemini request. */
    systemInstruction?: string;
    /** Tool declarations + grounding config for the request body. */
    tools: Record<string, unknown>[];
    /** Tool config (functionCallingConfig). */
    toolConfig: Record<string, unknown>;
    /** Generation config overrides. */
    generationConfig?: Record<string, unknown>;
}

// ── Stream Creator ───────────────────────────────────────────────────────

/**
 * Create a ReadableStream that manages the multi-turn tool-calling loop.
 *
 * The consumer sees a single continuous stream of NormalizedStreamChunks.
 * Tool call/response cycles happen internally and are invisible to the consumer,
 * except for `tool_status` events.
 *
 * @param chatStreamFn - Function that calls Gemini with GeminiContent[] and returns a raw byte stream
 * @param initialContents - Initial conversation contents (system + user messages)
 * @param config - Provider configuration (for logging)
 * @param toolCache - Request-scoped tool result cache
 * @param toolContext - Shared context for tool handlers (supabase, signal, etc.)
 * @param requestStartTime - Timestamp when the request started (for deadline checks)
 * @param requestId - Optional request ID for log correlation
 * @returns ReadableStream of NormalizedStreamChunks
 */
export function createToolCallingStream(
    chatStreamFn: (contents: GeminiContent[]) => Promise<ReadableStream<Uint8Array>>,
    initialContents: GeminiContent[],
    config: ProviderConfig,
    toolCache: ToolResultCache,
    toolContext: ToolContext,
    requestStartTime: number,
    requestId?: string,
): ReadableStream<NormalizedStreamChunk> {

    const abortController = new AbortController();
    const { signal } = abortController;

    // Merge with existing signal from caller
    if (toolContext.signal) {
        if (toolContext.signal.aborted) {
            abortController.abort(toolContext.signal.reason);
        } else {
            toolContext.signal.addEventListener("abort", () => abortController.abort(toolContext.signal.reason), { once: true });
        }
    }
    const mergedContext: ToolContext = { ...toolContext, signal };

    let closed = false;

    // Telemetry accumulator
    const telemetry: ToolTelemetry = {
        tool_rounds: 0,
        tool_calls: [],
        tool_calls_total: 0,
        cache_hit_rate: 0,
        tool_latency_ms_total: 0,
        text_gated_rounds: 0,
    };

    return new ReadableStream<NormalizedStreamChunk>({

        async start(controller) {
            let round = 0;
            const conversationHistory: GeminiContent[] = [...initialContents];
            let cacheHits = 0;
            let cacheMisses = 0;

            try {
                while (round < MAX_TOOL_ROUNDS && !signal.aborted) {
                    round++;
                    telemetry.tool_rounds = round;

                    // ── Deadline check ──────────────────────────────────────
                    // Vercel serverless timeout is ~300s. Check remaining time.
                    const elapsed = Date.now() - requestStartTime;
                    const remaining = 300_000 - elapsed;
                    if (remaining < DEADLINE_BUFFER_MS) {
                        telemetry.deadline_skip = true;
                        console.warn(`[TOOL_STREAM] [${requestId}] Deadline approaching (${remaining}ms remaining). Skipping tool round ${round}.`);
                        break;
                    }

                    // ── Stream from provider ────────────────────────────────
                    const rawStream = await chatStreamFn(conversationHistory);
                    const reader = rawStream.getReader();
                    const decoder = new TextDecoder();
                    let sseBuffer = "";
                    const roundTextBuffer: NormalizedStreamChunk[] = [];
                    const pendingCalls: CapturedFunctionCall[] = [];

                    try {
                        while (!signal.aborted) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            sseBuffer += decoder.decode(value, { stream: true });

                            // Split on double-newline (SSE event boundary)
                            const events = sseBuffer.split("\n\n");
                            sseBuffer = events.pop() || "";

                            for (const event of events) {
                                for (const line of event.split("\n")) {
                                    if (!line.startsWith("data:")) continue;
                                    const payload = line.slice(5).trim();
                                    if (!payload || payload === "[DONE]") continue;

                                    let parsed: unknown;
                                    try { parsed = JSON.parse(payload); }
                                    catch { continue; }

                                    // Shared parser — Lockdown 6: single source of truth
                                    const chunk = parseGeminiSSEPayload(parsed);
                                    if (!chunk) continue;

                                    if (chunk.type === "function_call" && chunk.functionCalls) {
                                        pendingCalls.push(...chunk.functionCalls);
                                    } else if (chunk.type === "text" || chunk.type === "thought") {
                                        // BUFFER — do not emit yet (text gating)
                                        roundTextBuffer.push(chunk);
                                    } else if (chunk.type === "grounding") {
                                        // Grounding metadata passes through immediately
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

                    // ── Round resolution ────────────────────────────────────

                    if (pendingCalls.length === 0) {
                        // Final round — no function calls detected. Flush buffered text.
                        for (const chunk of roundTextBuffer) {
                            if (!closed && !signal.aborted) {
                                chunk.servedBy = config.provider;
                                chunk.model = config.model;
                                controller.enqueue(chunk);
                            }
                        }
                        break;
                    }

                    // Function calls detected — DISCARD buffered text (text gating)
                    // The model's text in this round was prefatory; the real response comes after tools run.
                    telemetry.text_gated_rounds++;

                    // ── Tool status event (aggregated, one per round) ───────
                    if (!closed && !signal.aborted) {
                        controller.enqueue({
                            type: "tool_status",
                            tools: [...new Set(pendingCalls.map(fc => fc.name))],
                            status: "calling",
                        });
                    }

                    // ── Execute tools (deduped, 1:1 response mapping) ──────
                    telemetry.tool_calls_total += pendingCalls.length;
                    telemetry.tool_calls.push(...pendingCalls.map(fc => fc.name));

                    const toolResults = await executeAndMapResults(
                        pendingCalls, mergedContext, toolCache, signal, requestId
                    );

                    // Track cache metrics
                    for (const r of toolResults) {
                        if (r.cached) cacheHits++;
                        else cacheMisses++;
                        if (r.latency_ms) telemetry.tool_latency_ms_total += r.latency_ms;
                    }

                    if (!closed && !signal.aborted) {
                        controller.enqueue({
                            type: "tool_status",
                            tools: [...new Set(pendingCalls.map(fc => fc.name))],
                            status: "complete",
                        });
                    }

                    // ── Append to conversation history ─────────────────────

                    // Model's function call turn — use raw parts (preserves thoughtSignature)
                    // Lockdown 3+4: rawPart includes { functionCall: {...}, thoughtSignature: "..." }
                    conversationHistory.push({
                        role: "model",
                        parts: pendingCalls.map(fc => fc.rawPart),
                    });

                    // Tool response turn — role: "user" (NOT "function")
                    // Lockdown 2: REST API requires role "user" for functionResponse
                    // Lockdown 5: 1:1 mapping — every functionCall gets a functionResponse in order
                    conversationHistory.push({
                        role: "user",
                        parts: pendingCalls.map((fc, i) => ({
                            functionResponse: {
                                name: fc.name,
                                response: toolResults[i].success
                                    ? (toolResults[i].data || { success: true })
                                    : { success: false, error: toolResults[i].error || "Unknown error" },
                            },
                        })),
                    });
                }

                // Compute final cache rate
                const totalCacheOps = cacheHits + cacheMisses;
                telemetry.cache_hit_rate = totalCacheOps > 0 ? cacheHits / totalCacheOps : 0;

                // Log telemetry (skip if aborted — cancel() already logged it)
                if (!signal.aborted) {
                    console.log(`[TOOL_TELEMETRY] [${requestId}]`, JSON.stringify(telemetry));
                }

            } catch (err) {
                if (!signal.aborted && !closed) {
                    console.error(`[TOOL_STREAM_ERROR] [${requestId}]`, err);
                    controller.enqueue({
                        type: "error",
                        content: "Analysis interrupted. Please retry.",
                    });
                }
            } finally {
                if (!closed) {
                    closed = true;
                    try {
                        controller.enqueue({ type: "done" });
                        controller.close();
                    } catch { /* controller already closed by cancel() */ }
                }
            }
        },

        cancel(reason) {
            closed = true;
            abortController.abort(reason);
            telemetry.abort_reason = String(reason);
            console.log(`[TOOL_TELEMETRY] [${requestId}] Cancelled:`, JSON.stringify(telemetry));
        },
    });
}

// ── Batched Tool Execution with 1:1 Mapping ─────────────────────────────

/**
 * Execute tool calls with deduplication and 1:1 result mapping.
 *
 * Gemini requires a functionResponse for EVERY functionCall in the same order.
 * We execute unique calls once but replay the same result for each duplicate.
 *
 * Implements: Spec Lockdown 5.
 *
 * @param calls - All function calls from the model (may contain duplicates)
 * @param ctx - Tool context with supabase client, signal
 * @param cache - Request-scoped tool result cache
 * @param signal - Abort signal
 * @param requestId - Optional request ID for log correlation
 * @returns Array of ToolResults in the same order as the input calls
 */
async function executeAndMapResults(
    calls: CapturedFunctionCall[],
    ctx: ToolContext,
    cache: ToolResultCache,
    signal: AbortSignal,
    requestId?: string,
): Promise<ToolResult[]> {

    // 1. Identify unique calls by name + canonical args
    const uniqueMap = new Map<string, { call: CapturedFunctionCall; result?: ToolResult }>();
    for (const call of calls) {
        const key = `${call.name}:${stableStringify(call.args)}`;
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, { call });
        }
    }

    // 2. Execute unique calls in batches of MAX_CONCURRENT_TOOLS
    const uniqueEntries = Array.from(uniqueMap.entries());
    for (let i = 0; i < uniqueEntries.length; i += MAX_CONCURRENT_TOOLS) {
        if (signal.aborted) break;

        const batch = uniqueEntries.slice(i, i + MAX_CONCURRENT_TOOLS);
        const batchResults = await Promise.allSettled(
            batch.map(([_, entry]) => executeSingleTool(entry.call, ctx, cache, requestId))
        );

        for (let j = 0; j < batch.length; j++) {
            const r = batchResults[j];
            batch[j][1].result = r.status === "fulfilled"
                ? r.value
                : {
                    success: false,
                    data: null,
                    error: sanitizeToolError(batch[j][1].call.name, r.reason, requestId),
                };
        }
    }

    // 3. Map back to original order — EVERY call gets a response (1:1)
    return calls.map(call => {
        const key = `${call.name}:${stableStringify(call.args)}`;
        return uniqueMap.get(key)!.result!;
    });
}

/**
 * Execute a single tool call with caching and timeout.
 */
async function executeSingleTool(
    call: CapturedFunctionCall,
    ctx: ToolContext,
    cache: ToolResultCache,
    requestId?: string,
): Promise<ToolResult> {

    // Check cache first
    const cached = cache.get(call.name, call.args);
    if (cached) {
        return { ...cached, cached: true };
    }

    // Look up handler
    const handler = TOOL_HANDLERS[call.name];
    if (!handler) {
        return { success: false, data: null, error: `Unknown tool: ${call.name}` };
    }

    const start = Date.now();

    try {
        // Race between handler execution and timeout.
        // CRITICAL: clearTimeout after race settles to prevent orphaned timers.
        // In serverless (Vercel), orphaned timers keep the event loop alive,
        // causing billing overruns and cold start delays.
        let timeoutId: ReturnType<typeof setTimeout>;
        const result = await Promise.race([
            handler(call.args, ctx),
            new Promise<ToolResult>((_, reject) => {
                timeoutId = setTimeout(
                    () => reject(new Error(`Tool ${call.name} timed out after ${TOOL_TIMEOUT_MS}ms`)),
                    TOOL_TIMEOUT_MS
                );
            }),
        ]);
        clearTimeout(timeoutId!);

        result.latency_ms = Date.now() - start;
        result.fetched_at = Date.now();

        // Cache successful results
        if (result.success) {
            cache.set(call.name, call.args, result);
        }

        return result;

    } catch (err) {
        return {
            success: false,
            data: null,
            error: sanitizeToolError(call.name, err, requestId),
            latency_ms: Date.now() - start,
        };
    }
}
