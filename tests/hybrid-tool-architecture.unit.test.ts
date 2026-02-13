import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createToolCallingStream } from '../lib/tool-calling-stream.ts';
import { ToolResultCache } from '../lib/tool-result-cache.ts';
import { TOOL_HANDLERS } from '../lib/tool-handlers.ts';
import { TOOL_CONFIG, FUNCTION_DECLARATIONS } from '../lib/tool-registry.ts';
import { googleClient, parseGeminiSSEPayload } from '../lib/ai-provider.ts';
import { sanitizeToolError } from '../lib/tool-error-sanitizer.ts';
import { stableStringify, ToolResultCache as CacheClass } from '../lib/tool-result-cache.ts';
import { createSupabaseMock, makeGeminiPayload, sseFromPayload, streamFromStrings, readObjectStream } from './helpers.ts';
import type { GeminiContent, ProviderConfig } from '../lib/ai-provider.ts';

vi.mock('../lib/ai-provider.js', async () => {
  const actual = await import('../lib/ai-provider.ts');
  return actual;
});

const providerConfig: ProviderConfig = {
  provider: 'google',
  model: 'gemini-test',
  timeoutMs: 1000,
  costPer1kInput: 0,
  costPer1kOutput: 0,
  supportsGrounding: true,
  supportsStreaming: true,
};

const baseContext = {
  supabase: createSupabaseMock({ matches: [] }),
  signal: new AbortController().signal,
};

function buildStreamForRounds(rounds: Array<Array<string>>) {
  let callIndex = 0;
  const calls: GeminiContent[][] = [];
  const chatStreamFn = vi.fn(async (contents: GeminiContent[]) => {
    calls.push(contents);
    const events = rounds[callIndex] ?? [];
    callIndex += 1;
    return streamFromStrings(events);
  });
  return { chatStreamFn, calls };
}

async function drainToolCallingStream(rounds: Array<Array<string>>) {
  const { chatStreamFn, calls } = buildStreamForRounds(rounds);
  const toolCache = new ToolResultCache();
  const stream = createToolCallingStream(
    chatStreamFn,
    [{ role: 'user', parts: [{ text: 'hi' }] }],
    providerConfig,
    toolCache,
    baseContext,
    Date.now(),
    'req-test'
  );
  await readObjectStream(stream);
  return { chatStreamFn, calls };
}

const functionCallPart = (name: string, args: Record<string, unknown>, thoughtSignature?: string) => (
  thoughtSignature
    ? { functionCall: { name, args }, thoughtSignature }
    : { functionCall: { name, args } }
);

const textPart = (text: string) => ({ text });

describe('Hybrid Tool Architecture — Unit Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('U1: Serialize 3-round GeminiContent with role "user" for functionResponse and camelCase keys', async () => {
    const rounds = [
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {}, 'ts-1')]))],
      [sseFromPayload(makeGeminiPayload([textPart('ok')]))],
    ];

    const { calls } = await drainToolCallingStream(rounds);
    const secondCall = calls[1];
    expect(secondCall).toBeTruthy();

    const toolResponseTurn = secondCall[secondCall.length - 1];
    expect(toolResponseTurn.role).toBe('user');
    expect('functionResponse' in toolResponseTurn.parts[0]).toBe(true);

    const serialized = JSON.stringify(secondCall);
    expect(serialized).toContain('functionResponse');
    expect(serialized).not.toContain('function_response');
  });

  it('U2: thoughtSignature preserved at part level across capture → replay', async () => {
    const rounds = [
      [sseFromPayload(makeGeminiPayload([functionCallPart('get_schedule', {}, 'sig-123')]))],
      [sseFromPayload(makeGeminiPayload([textPart('final')]))],
    ];

    const { calls } = await drainToolCallingStream(rounds);
    const secondCall = calls[1];
    const modelTurn = secondCall.find(turn => turn.role === 'model');
    expect(modelTurn).toBeTruthy();
    const rawPart = modelTurn?.parts?.[0] as any;
    expect(rawPart?.thoughtSignature).toBe('sig-123');
  });

  it('U3: stableStringify produces deterministic keys regardless of order', () => {
    const a = { z: 1, a: { b: 2, a: 1 } };
    const b = { a: { a: 1, b: 2 }, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('U4: sanitizeToolError hides infra details', () => {
    const err = new Error('Supabase connection failed: postgres://user:pass@host');
    const safe = sanitizeToolError('get_schedule', err, 'req-1');
    expect(safe).toBe('Schedule data temporarily unavailable.');
    expect(safe).not.toMatch(/postgres|supabase/i);
  });

  it('U5: 1:1 call-response mapping after dedup (3 calls, 2 unique)', async () => {
    const spy = vi.spyOn(TOOL_HANDLERS, 'get_schedule').mockResolvedValue({
      success: true,
      data: { matches: [{ id: 'm1' }], count: 1, date_range: '2026-02-08 to 2026-02-08' },
    });

    const rounds = [
      [
        sseFromPayload(makeGeminiPayload([
          functionCallPart('get_schedule', { date: '2026-02-08' }),
          functionCallPart('get_schedule', { date: '2026-02-08' }),
          functionCallPart('get_schedule', { date: '2026-02-08' }),
        ])),
      ],
      [sseFromPayload(makeGeminiPayload([textPart('done')]))],
    ];

    const { calls } = await drainToolCallingStream(rounds);
    expect(spy).toHaveBeenCalledTimes(1);

    const secondCall = calls[1];
    const toolResponseTurn = secondCall[secondCall.length - 1];
    expect(toolResponseTurn.parts).toHaveLength(3);
    const responses = toolResponseTurn.parts.map((p: any) => p.functionResponse?.response);
    expect(responses[0]).toEqual(responses[1]);
    expect(responses[1]).toEqual(responses[2]);
  });

  it('U6: ToolResultCache TTL expiry + max entry eviction', () => {
    vi.useFakeTimers();
    const cache = new CacheClass();

    cache.set('get_live_odds', { match_id: 'a' }, { success: true, data: { id: 'a' } });
    vi.advanceTimersByTime(31_000);
    expect(cache.get('get_live_odds', { match_id: 'a' })).toBeNull();

    for (let i = 0; i < 257; i += 1) {
      cache.set('get_team_tempo', { id: i }, { success: true, data: { id: i } });
    }
    expect(cache.size).toBeLessThanOrEqual(256);
  });

  it('U7: parseGeminiSSEPayload preserves raw part with thoughtSignature', () => {
    const payload = makeGeminiPayload([
      { functionCall: { name: 'get_schedule', args: {} }, thoughtSignature: 'ts-999' },
    ]);
    const chunk = parseGeminiSSEPayload(payload as any);
    expect(chunk?.type).toBe('function_call');
    const raw = chunk?.functionCalls?.[0]?.rawPart as any;
    expect(raw?.thoughtSignature).toBe('ts-999');
  });

  it('U8: TOOL_CONFIG uses uppercase AUTO mode', () => {
    expect(TOOL_CONFIG.functionCallingConfig.mode).toBe('AUTO');
  });

  it('U9: get_schedule with empty args defaults to today ET only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-08T12:00:00Z'));

    const supabase = createSupabaseMock({ matches: [] });
    const result = await TOOL_HANDLERS.get_schedule({}, { supabase, signal: new AbortController().signal });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    expect(result.success).toBe(true);
    expect((result.data as any).date_range).toBe(`${today} to ${today}`);
  });

  it('U10/U11/U12: Gemini tools object merged + camelCase + no codeExecution with functionDeclarations', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      (fetchSpy as any).body = body;
      return new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n', { status: 200 });
    });
    globalThis.fetch = fetchSpy as any;
    process.env.GEMINI_API_KEY = 'test-key';

    const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: 'hi' }] }];
    await googleClient.chatStreamRaw(contents, {
      model: 'gemini-test',
      messages: [],
      temperature: 0.2,
      maxTokens: 64,
      tools: {
        functionDeclarations: FUNCTION_DECLARATIONS,
        enableGrounding: true,
      },
      toolConfig: TOOL_CONFIG,
      thinkingLevel: 'LOW',
    });

    const body = (fetchSpy as any).body;
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].functionDeclarations).toBeTruthy();
    expect(body.tools[0].googleSearch).toBeTruthy();
    expect(body.tools[0].codeExecution).toBeUndefined();

    expect(body.toolConfig).toBeTruthy();
    expect(body.toolConfig.functionCallingConfig).toBeTruthy();
    expect(body.toolConfig.functionCallingConfig.mode).toBe('AUTO');

    expect(body.generationConfig).toBeTruthy();
    expect(body.generationConfig.thinkingConfig).toBeTruthy();
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('LOW');

    const topKeys = Object.keys(body);
    expect(topKeys).toContain('toolConfig');
    expect(topKeys).toContain('generationConfig');
    expect(topKeys).toContain('contents');

    globalThis.fetch = originalFetch;
  });
});
