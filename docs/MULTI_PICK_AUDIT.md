# Multi-Pick Audit — Accuracy Review

**Commit under review:** 105d194 (and subsequent HEAD dd67ffa)
**Date:** 2026-02-15
**Scope:** Verify claims about single-pick vs multi-pick behavior across UI and backend

---

## Files Audited

- `src/components/ChatWidget.tsx` (v29.5 "Obsidian Weissach")
- `api/chat.js` (v26.1 "Obsidian Citadel")
- `lib/schemas/picks.js` (BettingPickSchema)

---

## Claim-by-Claim Verification

### 1. "No picks[] concept in the UI"

**ACCURATE.** The word "picks" does not appear in ChatWidget.tsx. No picks array, state, or map exists in the UI layer.

### 2. "ChatWidget.tsx renders one EdgeVerdictCard when it sees VERDICT:"

**PARTIALLY INACCURATE.** The `p` component override (line 1797-1813) runs for every `<p>` element in the ReactMarkdown output. It tests each paragraph against `REGEX_VERDICT_MATCH` (`/^\*{0,2}verdict:/i`) and renders an `EdgeVerdictCard` for **every match**, not just the first.

If the model outputs two paragraphs starting with `**VERDICT:**`, two cards render.

The actual UI bottleneck for multi-pick is `verdictOutcome` tracking — stored as a single value per message (`message.verdictOutcome`), so all verdict cards within one message share the same hit/miss state.

### 3. "System prompt defines only a single VERDICT block"

**ACCURATE.** The system prompt at chat.js:748-777 defines one VERDICT line in the output format template. The model is not instructed to produce multiple verdict blocks.

### 4. "Only the first pick matches the VERDICT pattern"

**WRONG LAYER.** The UI would match any paragraph starting with VERDICT. The single-pick bottleneck is in the **backend**:

| Location | Constraint |
|----------|-----------|
| `buildClaimMap()` (chat.js:428-434) | `response.match()` returns first match, then `break` |
| `BettingPickSchema` (picks.js) | Single Zod object, not `z.array()` |
| `extractPickStructured()` (chat.js:538) | Returns `[object]` — always single-element array |
| `persistRun()` (chat.js:582-583) | Passes `map.verdict` (single string) to extraction |

### 5. "Contract mismatch" diagnosis

**MOSTLY ACCURATE but misattributed.** The audit says the mismatch is between "a single-verdict renderer" and "a multi-pick response." The renderer is already multi-verdict-capable. The mismatch is between:
- A **single-verdict system prompt + single-verdict backend extraction pipeline**
- A user query ("edge today") that implicitly expects multiple picks

### 6. Game plan sequence assessment

- **Step 1 (Lock output contract):** Correct and necessary.
- **Step 2 (Split response into pick blocks):** Partially unnecessary for UI — `p` component already renders N cards. The real need is per-card state isolation.
- **Step 3 (Render one card per pick):** Already partially works in the renderer.
- **"Why not quick fix first":** Correct reasoning — deterministic contract must come first.

---

## Actual Fix Surface (Corrected)

1. **System prompt** (chat.js): Define multi-pick output format
2. **`buildClaimMap()`** (chat.js): Extract all verdicts, not just first
3. **`BettingPickSchema`** (picks.js): Change to array schema
4. **`verdictOutcome`** (ChatWidget.tsx): Change from per-message to per-card state (e.g., `Map<number, VerdictOutcome>`)
5. **UI wiring** (ChatWidget.tsx): Pass per-card outcome to each EdgeVerdictCard — minimal work since the renderer already creates N cards
