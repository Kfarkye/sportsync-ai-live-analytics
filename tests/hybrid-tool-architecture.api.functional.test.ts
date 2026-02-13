import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers.ts';

// vi.mock is hoisted ABOVE const declarations.
// vi.hoisted() runs before mocks, ensuring these fns exist when factories execute.
const { orchestrateStreamMock, orchestrateMock, createToolCallingStreamMock } = vi.hoisted(() => ({
  orchestrateStreamMock: vi.fn(),
  orchestrateMock: vi.fn(),
  createToolCallingStreamMock: vi.fn(),
}));


const supabaseState = {
  insertedPicks: [] as any[],
  upserts: [] as any[],
};

vi.mock('../lib/ai-provider.js', () => ({
  orchestrateStream: orchestrateStreamMock,
  orchestrate: orchestrateMock,
  getProviderHealth: () => ({
    enabled: { google: true, openai: true, anthropic: true },
    circuits: { google: 'closed', openai: 'closed', anthropic: 'closed' },
    costCeiling: { limit: 50, currentHourlySpend: 0, isOverBudget: false },
  }),
  googleClient: { chatStreamRaw: vi.fn() },
}));

vi.mock('../lib/tool-calling-stream.js', () => ({
  createToolCallingStream: createToolCallingStreamMock,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const supabase = createSupabaseMock({
      live_game_state: [],
      matches: [],
      team_game_context: [],
      team_tempo: [],
    });
    return {
      ...supabase,
      from(table: string) {
        const builder: any = (supabase as any).from(table);
        builder.insert = (rows: any[]) => {
          if (table === 'ai_chat_picks') supabaseState.insertedPicks.push(...rows);
          return Promise.resolve({ data: rows, error: null });
        };
        builder.upsert = (rows: any[]) => {
          if (table === 'ai_chat_runs') supabaseState.upserts.push(rows);
          return Promise.resolve({ data: rows, error: null });
        };
        builder.update = (rows: any[]) => ({ eq: () => Promise.resolve({ data: rows, error: null }) });
        return builder;
      },
    };
  },
}));

import handler from '../api/chat.js';

function makeReq(body: any) {
  return {
    method: 'POST',
    body,
    on: vi.fn(),
  } as any;
}

function makeRes() {
  const chunks: string[] = [];
  return {
    headers: {} as Record<string, string>,
    statusCode: 200,
    setHeader(key: string, value: string) { this.headers[key] = value; },
    write(chunk: string) { chunks.push(chunk); },
    end(chunk?: string) { if (chunk) chunks.push(chunk); },
    json(payload: any) { this.jsonBody = payload; return this; },
    status(code: number) { this.statusCode = code; return this; },
    get chunks() { return chunks; },
  } as any;
}

function makeStream(chunks: any[]) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('Hybrid Tool Architecture — API-level Functional Tests', () => {
  beforeEach(() => {
    orchestrateStreamMock.mockReset();
    orchestrateMock.mockReset();
    createToolCallingStreamMock.mockReset();
    supabaseState.insertedPicks = [];
    supabaseState.upserts = [];
    process.env.ENABLE_TOOL_CALLING = 'true';
  });

  it('F1: chat input routes to orchestrateStream with no tools', async () => {
    orchestrateStreamMock.mockResolvedValueOnce(
      makeStream([{ type: 'text', content: 'hey' }, { type: 'done' }])
    );

    const req = makeReq({ messages: [{ role: 'user', content: 'Hey whats up' }] });
    const res = makeRes();

    await handler(req, res);

    expect(orchestrateStreamMock).toHaveBeenCalled();
    expect(createToolCallingStreamMock).not.toHaveBeenCalled();
    expect(orchestrateStreamMock.mock.calls[0][0]).toBe('chat');
  });

  it.skip('F9: single-game analysis persists pick with opening_line from match_id (expected to fail until wired)', async () => {
    orchestrateStreamMock.mockResolvedValueOnce(
      makeStream([
        { type: 'text', content: '**VERDICT:** BET\nMarket edge and injury news indicate value.' },
        { type: 'done' },
      ])
    );
    orchestrateMock.mockResolvedValueOnce({
      content: JSON.stringify({
        verdict: 'BET',
        pick_type: 'spread',
        pick_team: 'Boston Celtics',
        pick_direction: 'home',
        pick_line: -3.5,
        confidence: 'high',
        reasoning_summary: 'Edge.',
        edge_factors: ['market', 'injury'],
      }),
      servedBy: 'openai',
      model: 'gpt-test',
      isFallback: false,
      chainPosition: 0,
      latencyMs: 1,
      estimatedCostUsd: 0,
      groundingMetadata: null,
      thoughts: null,
    });

    const req = makeReq({
      messages: [{ role: 'user', content: 'Analyze this matchup and give a pick' }],
      gameContext: {
        match_id: 'match-1',
        home_team: 'Boston Celtics',
        away_team: 'New York Knicks',
        league: 'NBA',
      },
    });
    const res = makeRes();

    await handler(req, res);

    expect(supabaseState.insertedPicks.length).toBeGreaterThan(0);
    const pick = supabaseState.insertedPicks[0];
    expect(pick.opening_line).toBe(-3.5);
  });

  it.skip('F10: full slate inserts 4 picks with match-scoped odds (expected to fail until multi-pick support)', async () => {
    orchestrateStreamMock.mockResolvedValueOnce(
      makeStream([
        { type: 'text', content: '**VERDICT:** BET\nMarket and sentiment.' },
        { type: 'done' },
      ])
    );
    orchestrateMock.mockResolvedValueOnce({
      content: JSON.stringify({
        verdict: 'BET',
        pick_type: 'spread',
        pick_team: 'Team A',
        pick_direction: 'home',
        pick_line: -2.0,
        confidence: 'medium',
        reasoning_summary: 'Edge.',
        edge_factors: ['market', 'structure'],
      }),
      servedBy: 'openai',
      model: 'gpt-test',
      isFallback: false,
      chainPosition: 0,
      latencyMs: 1,
      estimatedCostUsd: 0,
      groundingMetadata: null,
      thoughts: null,
    });

    const req = makeReq({
      messages: [{ role: 'user', content: 'Break down tonight\'s slate' }],
      gameContext: {
        match_id: 'match-1',
        home_team: 'Team A',
        away_team: 'Team B',
        league: 'NBA',
      },
    });
    const res = makeRes();

    await handler(req, res);

    expect(supabaseState.insertedPicks).toHaveLength(4);
  });

  it('F12: tool loop throw triggers fallback with full evidence (expected to fail until implemented)', async () => {
    createToolCallingStreamMock.mockImplementation(() => {
      throw new Error('tool loop failed');
    });
    orchestrateStreamMock.mockResolvedValueOnce(
      makeStream([{ type: 'text', content: 'fallback' }, { type: 'done' }])
    );

    const req = makeReq({ messages: [{ role: 'user', content: 'Give me a pick' }], gameContext: { match_id: 'match-1' } });
    const res = makeRes();

    await handler(req, res);

    expect(orchestrateStreamMock).toHaveBeenCalled();
  });
});
