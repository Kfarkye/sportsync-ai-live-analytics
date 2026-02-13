#!/usr/bin/env node
/* ============================================================================
   smoke-test-tool-calling.js
   End-to-End Smoke Test — Tool-Calling Architecture vs. Gemini API
   
   Tests:
   1. Real Gemini API connection (chatStreamRaw)
   2. Real Supabase queries via tool handlers
   3. Multi-turn tool loop (model calls tools → tools execute → model responds)
   4. SSE parsing, text gating, telemetry
   
   Usage:
     node scripts/smoke-test-tool-calling.js
   
   Requires in .env.local:
     GEMINI_API_KEY
     NEXT_PUBLIC_SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY
============================================================================ */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ── Verify environment ──────────────────────────────────────────────────

const requiredKeys = ['GEMINI_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = requiredKeys.filter(k => !process.env[k]);
if (missing.length > 0) {
    console.error(`\n❌ Missing environment variables: ${missing.join(', ')}`);
    console.error('   Add them to .env.local and try again.\n');
    process.exit(1);
}

console.log('\n🔧 Environment check passed.\n');

// ── Import the tool-calling architecture ──────────────────────────────────

// We import dynamically after env check so modules that read env at import time get the values

const { googleClient } = await import('../lib/ai-provider.js');
const { FUNCTION_DECLARATIONS, TOOL_CONFIG } = await import('../lib/tool-registry.js');
const { ToolResultCache } = await import('../lib/tool-result-cache.js');
const { createToolCallingStream } = await import('../lib/tool-calling-stream.js');
const { parseGeminiSSEPayload } = await import('../lib/ai-provider.js');

// ── Setup ────────────────────────────────────────────────────────────────

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MODEL_ID = 'gemini-3-flash-preview';

const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' });
const time = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });

// ── Test Queries ─────────────────────────────────────────────────────────

const TEST_QUERIES = [
    {
        name: 'Schedule Discovery',
        message: "What NBA games are on today?",
        taskType: 'grounding',
        expectTools: ['get_schedule'],
    },
    {
        name: 'Analysis with Tool Use',
        message: "Give me your best NBA bet for tonight. Full analysis with edge factors.",
        taskType: 'analysis',
        expectTools: ['get_schedule', 'get_team_injuries', 'get_team_tempo'],
    },
];

// ── Run Tests ────────────────────────────────────────────────────────────

async function runSmokeTest(test) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🧪 TEST: ${test.name}`);
    console.log(`   Query: "${test.message}"`);
    console.log(`   Expected tools: [${test.expectTools.join(', ')}]`);
    console.log(`${'═'.repeat(70)}\n`);

    const requestStartTime = Date.now();
    const requestId = `smoke-${Date.now()}`;
    const abortController = new AbortController();

    // Timeout safeguard — 60 seconds max
    const timeout = setTimeout(() => {
        console.error('\n⏰ Test timed out after 60s');
        abortController.abort('timeout');
    }, 60_000);

    const systemInstruction = `
<temporal>
TODAY: ${today}
TIME: ${time} ET
</temporal>

You are "The Obsidian Ledger," a forensic sports analyst.
You have access to data tools. When you need schedule, injury, tempo, or odds data:
1. Call get_schedule to find today's games.
2. Call get_team_injuries for injury/rest data.
3. Call get_team_tempo for pace, efficiency, ATS/O-U trends.
4. Call get_live_odds with a match_id for current odds.
Do NOT guess data. Always call tools before generating analysis.
`;

    const initialContents = [
        {
            role: 'user',
            parts: [{ text: test.message }],
        },
    ];

    const providerConfig = {
        provider: 'google',
        model: MODEL_ID,
        supportsGrounding: true,
        supportsStreaming: true,
        timeoutMs: 30000,
        costPer1kInput: 0.00125,
        costPer1kOutput: 0.005,
    };

    const toolCache = new ToolResultCache();
    const toolContext = {
        supabase,
        matchId: null,
        signal: abortController.signal,
        requestId,
    };

    const thinkingLevel = test.taskType === 'analysis' ? 'HIGH' : 'MEDIUM';

    const chatStreamFn = async (contents) => {
        return googleClient.chatStreamRaw(contents, {
            model: MODEL_ID,
            messages: [],
            temperature: 0.7,
            maxTokens: 8192,
            signal: abortController.signal,
            enableGrounding: test.taskType === 'grounding',
            tools: {
                functionDeclarations: FUNCTION_DECLARATIONS,
                enableGrounding: test.taskType === 'grounding',
            },
            toolConfig: TOOL_CONFIG,
            thinkingLevel,
            systemInstruction,
        });
    };

    // ── Stream and collect output ────────────────────────────────────────

    const stream = createToolCallingStream(
        chatStreamFn,
        initialContents,
        providerConfig,
        toolCache,
        toolContext,
        requestStartTime,
        requestId,
    );

    const reader = stream.getReader();
    let fullText = '';
    let toolsCalled = [];
    let chunkCount = 0;
    let thoughtText = '';

    const results = {
        success: false,
        error: null,
        toolsCalled: [],
        textLength: 0,
        latencyMs: 0,
        chunkCount: 0,
    };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = value;
            if (!chunk) continue;
            chunkCount++;

            switch (chunk.type) {
                case 'tool_status':
                    const status = chunk.status === 'calling' ? '🔧 CALLING' : '✅ COMPLETE';
                    console.log(`   ${status}: [${(chunk.tools || []).join(', ')}]`);
                    if (chunk.status === 'calling') {
                        toolsCalled.push(...(chunk.tools || []));
                    }
                    break;
                case 'thought':
                    thoughtText += chunk.content || '';
                    // Show first 100 chars of thought
                    if (thoughtText.length <= 100) {
                        process.stdout.write(`💭 `);
                    }
                    break;
                case 'text':
                    fullText += chunk.content || '';
                    process.stdout.write(chunk.content || '');
                    break;
                case 'grounding':
                    const sources = chunk.metadata?.groundingChunks?.length || 0;
                    console.log(`\n   🌐 Grounding: ${sources} sources`);
                    break;
                case 'error':
                    console.error(`\n   ❌ ERROR: ${chunk.content}`);
                    results.error = chunk.content;
                    break;
                case 'done':
                    break;
            }
        }
    } catch (err) {
        results.error = err.message;
        console.error(`\n   ❌ STREAM ERROR: ${err.message}`);
    } finally {
        clearTimeout(timeout);
        try { reader.releaseLock(); } catch { }
    }

    const latencyMs = Date.now() - requestStartTime;

    // ── Results ──────────────────────────────────────────────────────────

    console.log('\n');
    console.log(`${'─'.repeat(70)}`);
    console.log(`📊 RESULTS: ${test.name}`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`   Latency:       ${latencyMs}ms`);
    console.log(`   Chunks:        ${chunkCount}`);
    console.log(`   Text length:   ${fullText.length} chars`);
    console.log(`   Thought length: ${thoughtText.length} chars`);
    console.log(`   Tools called:  [${[...new Set(toolsCalled)].join(', ')}]`);
    console.log(`   Cache size:    ${toolCache.size}`);

    // Validate expected tools
    const uniqueToolsCalled = [...new Set(toolsCalled)];
    const missingTools = test.expectTools.filter(t => !uniqueToolsCalled.includes(t));
    const unexpectedTools = uniqueToolsCalled.filter(t => !test.expectTools.includes(t));

    if (missingTools.length > 0) {
        console.log(`   ⚠️  Missing expected tools: [${missingTools.join(', ')}]`);
    }
    if (unexpectedTools.length > 0) {
        console.log(`   ℹ️  Additional tools used: [${unexpectedTools.join(', ')}]`);
    }

    const passed = !results.error && fullText.length > 50;
    console.log(`   Status:        ${passed ? '✅ PASS' : '❌ FAIL'}`);

    if (results.error) {
        console.log(`   Error:         ${results.error}`);
    }

    return passed;
}

// ── Main ─────────────────────────────────────────────────────────────────

console.log('🏈 SportsSync AI — Tool-Calling Architecture Smoke Test');
console.log(`   Model: ${MODEL_ID}`);
console.log(`   Date: ${today} ${time} ET`);

// Run just the first test (schedule discovery) — fast, validates the core loop
const passed = await runSmokeTest(TEST_QUERIES[0]);

if (passed) {
    console.log('\n\n✅ Smoke test PASSED — tool-calling architecture works end-to-end.\n');

    // Ask if they want the full analysis test
    console.log('Run with the analysis query too? (re-run with --full)');

    if (process.argv.includes('--full')) {
        const passed2 = await runSmokeTest(TEST_QUERIES[1]);
        if (!passed2) {
            console.log('\n❌ Analysis test FAILED.\n');
            process.exit(1);
        }
    }
} else {
    console.log('\n\n❌ Smoke test FAILED.\n');
    process.exit(1);
}

process.exit(0);
