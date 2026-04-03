/**
 * VERDICT Protocol Boundary Test
 *
 * Contract rule: raw model protocol tokens (VERDICT:, THE PLAY:)
 * must NEVER appear in rendered UI output.
 *
 * This test reproduces the exact parser functions from ChatWidget.tsx
 * and proves the boundary holds for representative model responses.
 */

// ── Reproduce parser functions from ChatWidget.tsx (parser layer) ──────────

const REGEX_VERDICT_MATCH = /^[\s*•·\-]*\**\s*verdict\s*:/im;

const REGEX_PROTOCOL_TOKENS = /\b(?:VERDICT|THE PLAY)\s*:/gi;

function stripProtocolTokens(text: string): string {
  return text.replace(REGEX_PROTOCOL_TOKENS, "").replace(/^\s*\**\s*/, "").trim();
}

function extractVerdictPayload(text: string): string {
  if (!text) return "";
  const verdictIdx = text.toLowerCase().indexOf("verdict:");
  if (verdictIdx === -1) return text.trim();
  return text.slice(verdictIdx + "verdict:".length).trim();
}

type ConfidenceLevel = "high" | "medium" | "low";

function extractConfidence(text: string): ConfidenceLevel {
  const match = /\(confidence:\s*(high|medium|med|low)\)/i.exec(text);
  if (!match) return "high";
  const level = match[1].toLowerCase();
  if (level === "medium" || level === "med") return "medium";
  if (level === "low") return "low";
  return "high";
}

interface PreParsedPick {
  payload: string;
  confidence: ConfidenceLevel;
  synopsis: string;
  matchupLine: string;
}

interface RenderBlock {
  type: "prose" | "pick";
  content: string;
  pickIndex: number;
}

function buildRenderBlocks(
  content: string,
  synopses: string[],
  matchups: string[],
): { blocks: RenderBlock[]; picks: PreParsedPick[] } {
  if (!content) return { blocks: [], picks: [] };

  const lines = content.split("\n");
  const blocks: RenderBlock[] = [];
  const picks: PreParsedPick[] = [];
  let currentProse: string[] = [];

  for (const line of lines) {
    if (REGEX_VERDICT_MATCH.test(line)) {
      const prose = currentProse.join("\n").trim();
      if (prose) blocks.push({ type: "prose", content: prose, pickIndex: -1 });
      currentProse = [];

      const payload = extractVerdictPayload(line);
      const confidence = extractConfidence(payload);
      const pickIdx = picks.length;
      picks.push({
        payload,
        confidence,
        synopsis: synopses[pickIdx] || "",
        matchupLine: matchups[pickIdx] || "",
      });
      blocks.push({ type: "pick", content: "", pickIndex: pickIdx });
    } else {
      currentProse.push(line);
    }
  }

  const remaining = currentProse.join("\n").trim();
  if (remaining) blocks.push({ type: "prose", content: remaining, pickIndex: -1 });

  return { blocks, picks };
}

// ── Test Cases ────────────────────────────────────────────────────────────

const SAMPLE_MODEL_RESPONSES = [
  // Case 1: Single pick with analysis
  `**VERDICT:** Lakers -3.5 (-110) (Confidence: High)

The Lakers have a significant rest advantage heading into this matchup.

**KEY FACTORS:**
- Back-to-back for the Celtics
- Lakers 8-2 ATS at home this month`,

  // Case 2: Multi-pick response
  `**MATCHUP 1: Lakers vs Celtics — Apr 2, 7:30 PM ET**

**VERDICT:** Lakers -3.5 (-110) (Confidence: High)

Rest advantage is the primary driver.

**MATCHUP 2: Bucks vs Heat — Apr 2, 8:00 PM ET**

**VERDICT:** Heat +2.5 (-105) (Confidence: Medium)

Butler returns from injury tonight.`,

  // Case 3: Conversational response with "verdict" in prose (regression test)
  `Based on my analysis, there is no clear verdict on this game yet. The line hasn't moved significantly.

I'd recommend waiting until closer to tip-off for a sharper read on the market.`,

  // Case 4: Bullet-prefixed verdict
  `• **Verdict:** Dodgers -1.5 (+130) (Confidence: Low)

This is a lower-confidence play based on pitching matchup advantages.`,

  // Case 5: Empty response
  ``,
];

// ── Run Tests ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, description: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${description}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${description}`);
  }
}

console.log("\n═══ VERDICT Protocol Boundary Test ═══\n");

// Test 1: Protocol tokens stripped from pick payloads
console.log("Test 1: Pick payloads contain zero protocol tokens");
for (let i = 0; i < SAMPLE_MODEL_RESPONSES.length; i++) {
  const response = SAMPLE_MODEL_RESPONSES[i];
  const { picks } = buildRenderBlocks(response, [], []);
  for (const pick of picks) {
    assert(
      !REGEX_PROTOCOL_TOKENS.test(pick.payload),
      `Response ${i + 1}, pick "${pick.payload.slice(0, 40)}..." has no protocol tokens`,
    );
    // Reset regex lastIndex (global flag)
    REGEX_PROTOCOL_TOKENS.lastIndex = 0;
  }
}

// Test 2: Prose blocks contain zero VERDICT lines
console.log("\nTest 2: Prose blocks contain zero VERDICT lines");
for (let i = 0; i < SAMPLE_MODEL_RESPONSES.length; i++) {
  const response = SAMPLE_MODEL_RESPONSES[i];
  const { blocks } = buildRenderBlocks(response, [], []);
  for (const block of blocks) {
    if (block.type === "prose") {
      const lines = block.content.split("\n");
      for (const line of lines) {
        assert(
          !REGEX_VERDICT_MATCH.test(line),
          `Response ${i + 1}, prose line "${line.slice(0, 50)}..." has no VERDICT match`,
        );
      }
    }
  }
}

// Test 3: stripProtocolTokens catches any survivors
console.log("\nTest 3: stripProtocolTokens sanitizer catches edge cases");
const edgeCases = [
  "VERDICT: Lakers -3.5",
  "**VERDICT:** Heat ML",
  "THE PLAY: Dodgers -1.5",
  "verdict: Celtics +2.5",
  "Clean text with no protocol tokens",
];
for (const input of edgeCases) {
  const result = stripProtocolTokens(input);
  REGEX_PROTOCOL_TOKENS.lastIndex = 0;
  assert(
    !REGEX_PROTOCOL_TOKENS.test(result),
    `"${input.slice(0, 30)}..." → "${result.slice(0, 30)}..." (sanitized)`,
  );
  REGEX_PROTOCOL_TOKENS.lastIndex = 0;
}

// Test 4: Case 3 (conversational "verdict" in prose) does NOT produce a pick
console.log("\nTest 4: Conversational 'verdict' in prose does not trigger pick extraction");
{
  const { picks } = buildRenderBlocks(SAMPLE_MODEL_RESPONSES[2], [], []);
  assert(picks.length === 0, `Case 3 produces 0 picks (got ${picks.length})`);
}

// Test 5: Multi-pick response produces correct count
console.log("\nTest 5: Multi-pick response produces correct pick count");
{
  const { picks, blocks } = buildRenderBlocks(SAMPLE_MODEL_RESPONSES[1], [], []);
  assert(picks.length === 2, `Case 2 produces 2 picks (got ${picks.length})`);
  const proseBlocks = blocks.filter((b) => b.type === "prose");
  const pickBlocks = blocks.filter((b) => b.type === "pick");
  assert(pickBlocks.length === 2, `Case 2 has 2 pick blocks (got ${pickBlocks.length})`);
  assert(proseBlocks.length > 0, `Case 2 has prose blocks (got ${proseBlocks.length})`);
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
if (failed > 0) {
  process.exit(1);
}
