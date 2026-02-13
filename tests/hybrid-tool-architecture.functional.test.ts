import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FUNCTION_DECLARATIONS, TOOL_CONFIG, MAX_CONCURRENT_TOOLS } from '../lib/tool-registry.ts';
import { parseGeminiSSEPayload, googleClient, orchestrate } from '../lib/ai-provider.ts';
import { createSupabaseMock, makeGeminiPayload, sseFromPayload, streamFromStrings, readObjectStream } from './helpers.ts';
import type { GeminiContent, ProviderConfig, NormalizedStreamChunk } from '../lib/ai-provider.ts';
import type { ToolResult, ToolContext } from '../lib/tool-handlers.ts';

/**
 * These tests directly invoke createToolCallingStream. That module imports
 * from './ai-provider.js', './tool-handlers.js', etc. (the .js extension
 * convention for ESM). Vitest with moduleResolution:"bundler" resolves
 * .js → .ts, but vi.mock creates separate module identities for .js vs .ts
 * paths. Without explicit passthrough mocks, parseGeminiSSEPayload becomes
 * undefined inside the stream because tool-calling-stream.ts resolves
 * "./ai-provider.js" to a different module instance than this test's
 * "../lib/ai-provider.ts" import.
 *
 * Fix: Explicit passthrough mocks for every .js import in tool-calling-stream.ts.
 * This forces Vitest's mock system to unify .js and .ts module identities.
 */

// ── Shared test handler registry ─────────────────────────────────────────
const testHandlers: Record<string, (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>> = {};

// ── Module mocks ─────────────────────────────────────────────────────────
// CRITICAL: tool-calling-stream.ts imports with .js extensions.
// Vitest's mock system must resolve ALL of them consistently.
// Without these passthroughs, .js imports create separate module instances
// where exports are undefined.

// The one we actually mock — replace TOOL_HANDLERS with test-controlled proxy
vi.mock('../lib/tool-handlers.js', () => ({
  TOOL_HANDLERS: new Proxy({} as Record<string, any>, {
    get(_target, prop: string) {
      return testHandlers[prop];
    },
    has(_target, prop: string) {
      return prop in testHandlers;
    },
  }),
}));

// Passthroughs — force Vitest to unify .js and .ts module identities.
// CRITICAL: importOriginal() returns a namespace object with non-enumerable
// getters that neither direct return nor ...spread copies. The unit test's
// pattern of `await import('../lib/X.ts')` works because it creates a
// module instance Vitest can properly wire up.
vi.mock('../lib/ai-provider.js', async () => {
  return await import('../lib/ai-provider.ts');
});

vi.mock('../lib/tool-error-sanitizer.js', async () => {
  return await import('../lib/tool-error-sanitizer.ts');
});

vi.mock('../lib/tool-result-cache.js', async () => {
  return await import('../lib/tool-result-cache.ts');
});

vi.mock('../lib/tool-registry.js', async () => {
  return await import('../lib/tool-registry.ts');
});


// Dynamic import AFTER mocks are registered
const { createToolCallingStream } = await import('../lib/tool-calling-stream.ts');

const providerConfig: ProviderConfig = {
  provider: 'google',
  model: 'gemini-test',
  timeoutMs: 1000,
  costPer1kInput: 0,
  costPer1kOutput: 0,
  supportsGrounding: true,
  supportsStreaming: true,
};

const functionCallPart = (name: string, args: Record<string, unknown>, thoughtSignature?: string) => (
  thoughtSignature
    ? { functionCall: { name, args }, thoughtSignature }
    : { functionCall: { name, args } }
);

const textPart = (text: string) => ({ text });

// ── Default test handlers ────────────────────────────────────────────────
const defaultScheduleHandler = async (_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
  const supabase = ctx.supabase as any;
  const { data, error } = await supabase.from('matches').select('*');
  return {
    success: !error,
    data: { matches: data || [], count: (data || []).length, date_range: 'test' },
  };
};

const defaultTempoHandler = async (): Promise<ToolResult> => ({
  success: true,
  data: { teams: [], metrics: {} },
});

const defaultInjuriesHandler = async (): Promise<ToolResult> => ({
  success: true,
  data: { injuries: [], team: 'test' },
});

const defaultOddsHandler = async (_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
  const supabase = ctx.supabase as any;
  const { data } = await supabase.from('live_game_state').select('*');
  return {
    success: true,
    data: data || { odds: {} },
  };
};

function buildStreamForRounds(rounds: Array<Array<string>>) {
  let callIndex = 0;
  const calls: GeminiContent[][] = [];
  const chatStreamFn = vi.fn(async (contents: GeminiContent[]) => {
    calls.push(JSON.parse(JSON.stringify(contents)));
    const events = rounds[callIndex] ?? [];
    callIndex += 1;
    return streamFromStrings(events);
  });
  return { chatStreamFn, calls };
}

async function runToolStream(
  rounds: Array<Array<string>>,
  supabaseMock = createSupabaseMock({ matches: [] })
) {
  const { chatStreamFn, calls } = buildStreamForRounds(rounds);
  const { ToolResultCache } = await import('../lib/tool-result-cache.ts');
  const toolCache = new ToolResultCache();
  const toolContext: ToolContext = { supabase: supabaseMock as any, signal: new AbortController().signal };
  const stream = createToolCallingStream(
    chatStreamFn,
    [{ role: 'user', parts: [{ text: 'hi' }] }],
    providerConfig,
    toolCache,
    toolContext,
    Date.now(),
    'req-func'
  );
  const chunks = await readObjectStream(stream);
  return { chatStreamFn, calls, chunks };
}

describe('Hybrid Tool Architecture — Functional Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    testHandlers.get_schedule = defaultScheduleHandler;
    testHandlers.get_team_tempo = defaultTempoHandler;
    testHandlers.get_team_injuries = defaultInjuriesHandler;
    testHandlers.get_live_odds = defaultOddsHandler;
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const key of Object.keys(testHandlers)) {
      delete testHandlers[key];
    }
  });

  it('F2: get_schedule called and schedule returned in functionResponse', async () => {
    const matches = [{ id: 'm1', home_team: 'Boston', away_team: 'NYK' }];
    const supabase = createSupabaseMock({ matches });
    const rounds = [
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {})]))],
      [sseFromPayload(makeGeminiPayload([textPart('schedule ok')]))],
    ];

    const { calls } = await runToolStream(rounds, supabase);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const secondCall = calls[1];
    const toolResponseTurn = secondCall[secondCall.length - 1];
    expect(toolResponseTurn.role).toBe('user');
    const response = (toolResponseTurn.parts[0] as any).functionResponse.response;
    expect(response.matches).toEqual(matches);
  });

  it('F3: multi-round chained calls (3+ across 2+ rounds)', async () => {
    let scheduleCalled = false;
    let tempoCalled = false;
    let injuriesCalled = false;

    testHandlers.get_schedule = async (_args, ctx) => {
      scheduleCalled = true;
      return defaultScheduleHandler(_args, ctx);
    };
    testHandlers.get_team_tempo = async () => {
      tempoCalled = true;
      return defaultTempoHandler();
    };
    testHandlers.get_team_injuries = async () => {
      injuriesCalled = true;
      return defaultInjuriesHandler();
    };

    const rounds = [
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {})]))],
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_team_tempo', { teams: ['A', 'B'] })]))],
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_team_injuries', { team: 'A' })]))],
      [sseFromPayload(makeGeminiPayload([textPart('analysis')]))],
    ];

    const { chatStreamFn } = await runToolStream(rounds);
    expect(chatStreamFn).toHaveBeenCalledTimes(4);
    expect(scheduleCalled).toBe(true);
    expect(tempoCalled).toBe(true);
    expect(injuriesCalled).toBe(true);
  });

  it('F4: get_schedule → get_live_odds chain', async () => {
    const supabase = createSupabaseMock({
      matches: [{ id: 'match-1', home_team: 'LAL', away_team: 'BOS' }],
      live_game_state: { odds: { homeSpread: -2.5 } },
    });

    const calls: GeminiContent[][] = [];
    let callIndex = 0;

    const chatStreamFn = vi.fn(async (contents: GeminiContent[]) => {
      calls.push(JSON.parse(JSON.stringify(contents)));
      callIndex += 1;
      if (callIndex === 1) {
        return streamFromStrings([
          sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {})])),
        ]);
      }
      if (callIndex === 2) {
        return streamFromStrings([
          sseFromPayload(makeGeminiPayload([functionCallPart('get_live_odds', { match_id: 'match-1' })])),
        ]);
      }
      return streamFromStrings([
        sseFromPayload(makeGeminiPayload([textPart('odds ok')]))
      ]);
    });

    const { ToolResultCache } = await import('../lib/tool-result-cache.ts');
    const toolCache = new ToolResultCache();
    const toolContext: ToolContext = { supabase: supabase as any, signal: new AbortController().signal };
    const stream = createToolCallingStream(
      chatStreamFn,
      [{ role: 'user', parts: [{ text: 'line?' }] }],
      providerConfig,
      toolCache,
      toolContext,
      Date.now(),
      'req-chain'
    );
    const chunks = await readObjectStream(stream);

    expect(chatStreamFn).toHaveBeenCalledTimes(3);
    const textChunks = chunks.filter((c: any) => c.type === 'text');
    expect(textChunks.length).toBeGreaterThan(0);
  });

  it('F5: batch execution respects MAX_CONCURRENT_TOOLS', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    testHandlers.get_schedule = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      return { success: true, data: { matches: [], count: 0, date_range: 'x' } };
    };

    const callParts = Array.from({ length: 6 }, (_, i) => functionCallPart('get_schedule', { date: `2026-02-0${i + 1}` }));
    const rounds = [
      [sseFromPayload(makeGeminiPayload(callParts))],
      [sseFromPayload(makeGeminiPayload([textPart('done')]))],
    ];

    await runToolStream(rounds);
    expect(maxInFlight).toBeLessThanOrEqual(MAX_CONCURRENT_TOOLS);
  });

  it('F6: Supabase down yields sanitized error (no infra leak)', async () => {
    testHandlers.get_schedule = async () => {
      throw new Error('postgres://user:pass@host/db');
    };

    const rounds = [
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {})]))],
      [sseFromPayload(makeGeminiPayload([textPart('done')]))],
    ];

    const { calls } = await runToolStream(rounds);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const secondCall = calls[1];
    const toolResponseTurn = secondCall[secondCall.length - 1] as any;
    const response = toolResponseTurn.parts[0].functionResponse.response;
    expect(response.error).toBe('Schedule data temporarily unavailable.');
    expect(response.error).not.toMatch(/postgres|supabase/i);
  });

  it('F7: model loops tools — terminates at MAX_TOOL_ROUNDS (4)', async () => {
    const rounds = [
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {})]))],
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {})]))],
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {})]))],
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {})]))],
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {})]))],
    ];

    const { chatStreamFn, chunks } = await runToolStream(rounds);
    expect(chatStreamFn).toHaveBeenCalledTimes(4);
    expect(chunks.some((c: any) => c.type === 'done')).toBe(true);
  });

  it('F8: Gemini down → fallback to OpenAI via orchestrate()', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        return new Response('error', { status: 503 });
      }
      if (String(url).includes('api.openai.com')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
      }
      return new Response('error', { status: 500 });
    }) as any;

    process.env.GEMINI_API_KEY = 'test';
    process.env.OPENAI_API_KEY = 'test';

    const result = await orchestrate('grounding', [{ role: 'user', content: 'test' }]);
    expect(result.servedBy).toBe('openai');
    expect(result.isFallback).toBe(true);

    globalThis.fetch = originalFetch;
  });

  it('F11: cancel() stops stream without executing tools', async () => {
    let scheduleCalled = false;
    testHandlers.get_schedule = async (_args, ctx) => {
      scheduleCalled = true;
      return defaultScheduleHandler(_args, ctx);
    };

    const chatStreamFn = vi.fn(async () => streamFromStrings([]));
    const { ToolResultCache } = await import('../lib/tool-result-cache.ts');
    const toolCache = new ToolResultCache();
    const toolContext: ToolContext = { supabase: createSupabaseMock({ matches: [] }) as any, signal: new AbortController().signal };
    const stream = createToolCallingStream(
      chatStreamFn,
      [{ role: 'user', parts: [{ text: 'hi' }] }],
      providerConfig,
      toolCache,
      toolContext,
      Date.now(),
      'req-cancel'
    );

    const reader = stream.getReader();
    await reader.cancel('nav');
    expect(scheduleCalled).toBe(false);
  });

  it('F13: text gating drops pre-tool text when functionCall present', async () => {
    const rounds = [
      [sseFromPayload(makeGeminiPayload([
        textPart('preface'),
        functionCallPart('get_schedule', {}),
      ]))],
      [sseFromPayload(makeGeminiPayload([textPart('final')]))],
    ];

    const { chunks } = await runToolStream(rounds);
    const textChunks = chunks.filter((c: any) => c.type === 'text').map((c: any) => c.content);
    expect(textChunks).toEqual(['final']);
  });

  it('F14: duplicate functionCalls execute handler only once, mapped 1:1 in response', async () => {
    let callCount = 0;
    testHandlers.get_schedule = async () => {
      callCount += 1;
      return { success: true, data: { matches: [{ id: 'x' }], count: 1, date_range: 'test' } };
    };

    const rounds = [
      [sseFromPayload(makeGeminiPayload([
        functionCallPart('get_schedule', { date: '2026-02-08' }),
        functionCallPart('get_schedule', { date: '2026-02-08' }),
        functionCallPart('get_schedule', { date: '2026-02-08' }),
      ]))],
      [sseFromPayload(makeGeminiPayload([textPart('done')]))],
    ];

    const { calls } = await runToolStream(rounds);
    expect(callCount).toBe(1);
    const secondCall = calls[1];
    const toolResponseTurn = secondCall[secondCall.length - 1];
    expect(toolResponseTurn.parts).toHaveLength(3);
  });

  it('F15: tool response turns use role "user"', async () => {
    const rounds = [
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {})]))],
      [sseFromPayload(makeGeminiPayload([textPart('ok')]))],
    ];

    const { calls } = await runToolStream(rounds);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const secondCall = calls[1];
    const toolResponseTurn = secondCall[secondCall.length - 1];
    expect(toolResponseTurn.role).toBe('user');
  });

  it('F16: tool-calling request does not include codeExecution when functionDeclarations present', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async (_url: any, init: any) => {
      (fetchSpy as any).body = JSON.parse(init.body);
      return new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n', { status: 200 });
    });
    globalThis.fetch = fetchSpy as any;
    process.env.GEMINI_API_KEY = 'test-key';

    await googleClient.chatStreamRaw([{ role: 'user', parts: [{ text: 'hi' }] }], {
      model: 'gemini-test',
      messages: [],
      temperature: 0.2,
      maxTokens: 64,
      tools: { functionDeclarations: FUNCTION_DECLARATIONS },
      toolConfig: TOOL_CONFIG,
      thinkingLevel: 'MEDIUM',
    });

    const body = (fetchSpy as any).body;
    expect(body.tools[0].codeExecution).toBeUndefined();

    globalThis.fetch = originalFetch;
  });

  it('F17: finishReason STOP does not block functionCall detection', () => {
    const payload = {
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              { functionCall: { name: 'get_schedule', args: {} }, thoughtSignature: 'x' },
            ],
          },
        },
      ],
    };
    const chunk = parseGeminiSSEPayload(payload as any);
    expect(chunk?.type).toBe('function_call');
  });

  it('F18: request body keys are camelCase (toolConfig/functionCallingConfig/functionDeclarations/googleSearch)', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async (_url: any, init: any) => {
      (fetchSpy as any).body = JSON.parse(init.body);
      return new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n', { status: 200 });
    });
    globalThis.fetch = fetchSpy as any;
    process.env.GEMINI_API_KEY = 'test-key';

    await googleClient.chatStreamRaw([{ role: 'user', parts: [{ text: 'hi' }] }], {
      model: 'gemini-test',
      messages: [],
      temperature: 0.2,
      maxTokens: 64,
      tools: { functionDeclarations: FUNCTION_DECLARATIONS, enableGrounding: true },
      toolConfig: TOOL_CONFIG,
      thinkingLevel: 'LOW',
    });

    const body = (fetchSpy as any).body;
    expect(body.toolConfig).toBeTruthy();
    expect(body.toolConfig.functionCallingConfig).toBeTruthy();
    expect(body.tools[0].functionDeclarations).toBeTruthy();
    expect(body.tools[0].googleSearch).toBeTruthy();

    globalThis.fetch = originalFetch;
  });
});
