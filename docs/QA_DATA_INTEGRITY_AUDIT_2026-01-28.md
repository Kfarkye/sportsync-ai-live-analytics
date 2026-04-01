# 🔬 QA DATA INTEGRITY AUDIT

## SportsSync AI - Pick Performance Analytics

**Audit Date:** 2026-01-28  
**Auditor:** Claude (AI Assistant)  
**Requested By:** User  
**Status:** PENDING APPROVAL

---

## 📋 EXECUTIVE SUMMARY

This audit identified **3 categories of data pollution** affecting **96+ graded picks** (7.8% of dataset). Fixes have been applied to the grading pipeline. However, **critical gaps remain** that require engineering action before the analytics can be considered production-grade.

| Category | Severity | Status |
|----------|----------|--------|
| Fake Underdogs (+0/PK/DNB) | HIGH | ⚠️ PARTIALLY FIXED |
| Misclassified Moneylines | HIGH | ✅ FIXED (Grader) |
| Missing Odds at Pick Time | CRITICAL | ❌ NOT FIXED |
| CLV Validation | CRITICAL | ❌ NOT IMPLEMENTED |

---

## 🔍 FINDINGS

### 1. FAKE UNDERDOG POLLUTION (70 picks)

**Description:** Picks labeled as `+0`, `PK` (Pick'em), or `Draw No Bet` were being counted as "underdog" picks in spread analysis.

**Example:**

```
Pick: "Paris Saint-Germain +0"
Market Reality: PSG was -1.5 favorite
Impact: Inflates "Home Underdog" win rate with near-free wins
```

**Root Cause:** AI model generates `+0` or `PK` picks without validation against actual market lines.

**Fix Applied:**

- ✅ Grader now parses `PK`, `Pick'em`, `DNB` as spread = 0.0
- ✅ Analysis queries exclude `+0` from underdog buckets
- ⚠️ Worker prompt updated to discourage this pattern

**Gaps Remaining:**

- ❌ **No ingestion-time validation** against actual market lines
- ❌ **No rejection of hallucinated lines** (AI can still pick +0 on a -1.5 favorite)
- ❌ **No price attached** to +0/DNB picks (cannot calculate ROI)

---

### 2. MISCLASSIFIED MONEYLINES (23 picks)

**Description:** NHL and Tennis picks with text like `"Team Moneyline (-115)"` were being graded as `type: SPREAD` and failing or producing wrong results.

**Example:**

```
Pick: "Utah Mammoth Moneyline (-170)"
grading_metadata.type: "SPREAD"  ← WRONG
```

**Root Cause:**

1. AI outputs `type: SPREAD` even when pick text says "Moneyline"
2. Odds value (-170) was being parsed as a spread number

**Fix Applied:**

- ✅ Grader now detects `"Moneyline"` or `"ML"` in pick text and overrides type to MONEYLINE
- ✅ Worker prompt updated with explicit rule: "If picking a winner straight up, use type: MONEYLINE"

**Gaps Remaining:**

- ⚠️ Fix is post-hoc (grader overrides bad AI output) rather than preventive
- ❌ Schema validation does not enforce consistency between pick text and type field

---

### 3. ODDS IN PICK TEXT (3 picks)

**Description:** Picks included odds values like `-115`, `-142` in the `recommended_pick` string, causing parsing confusion.

**Fix Applied:**

- ✅ Worker prompt now states: "DO NOT include odds (like -110 or -150) in the recommended_pick text"

**Gaps Remaining:**

- ❌ No regex-based rejection at ingestion time
- ❌ AI may still violate this rule; no enforcement mechanism

---

## 🚨 CRITICAL GAPS (Blocking Production-Grade Analytics)

### GAP 1: NO ODDS CAPTURE AT PICK TIME

**Current State:**

- `pregame_intel.analyzed_spread` and `analyzed_total` exist but are often NULL
- No `odds_at_pick` or `juice_at_pick` column
- No snapshot of `closing_line` for CLV calculation

**Impact:**

- Cannot calculate true ROI (assuming all bets are -110 is incorrect)
- Cannot distinguish -800 alt lines from -110 standard lines
- All "Win Rate" metrics are **misleading without price context**

**Recommendation:**

```sql
ALTER TABLE pregame_intel ADD COLUMN IF NOT EXISTS odds_at_pick NUMERIC;
ALTER TABLE pregame_intel ADD COLUMN IF NOT EXISTS line_at_pick NUMERIC;
ALTER TABLE pregame_intel ADD COLUMN IF NOT EXISTS closing_line NUMERIC;
ALTER TABLE pregame_intel ADD COLUMN IF NOT EXISTS clv NUMERIC; -- Closing Line Value
```

**Priority:** P0 (CRITICAL)

---

### GAP 2: NO LINE VALIDATION AT INGESTION

**Current State:**

- AI generates pick with arbitrary line (e.g., `+0`)
- Worker accepts and stores without checking if that line exists in market
- Later analysis is polluted

**Recommendation:**

1. At pick generation, query `matches` table for current market line
2. If AI pick line differs from market by > 2 points, **reject pick** or **force requote**
3. Store `market_line_at_pick` for audit

```typescript
// In pregame-intel-worker
const marketLine = match.current_odds?.spread_home_value;
const pickLine = parsedPick.line;
if (Math.abs(marketLine - pickLine) > 2.0) {
    throw new Error(`Invalid Line: Market is ${marketLine}, pick is ${pickLine}`);
}
```

**Priority:** P0 (CRITICAL)

---

### GAP 3: NO CLV (CLOSING LINE VALUE) TRACKING

**Current State:**

- No comparison between time-of-pick line and closing line
- Cannot measure if model is beating the market

**Recommendation:**

1. After game starts, record closing line from odds API
2. Calculate CLV = `closing_line - pick_line`
3. Positive CLV = beating the market (the true measure of sharp betting)

**Priority:** P1 (HIGH)

---

### GAP 4: GRADER SYNTAX ERROR (TypeScript)

**Current State:**

- `grade-picks-cron/index.ts` has unresolved lint errors:
  - `'}' expected` at line 711
  - `Function lacks ending return statement` at line 103
  - Type comparison warnings

**Impact:** Function may fail to deploy or have runtime errors.

**Recommendation:** Fix syntax errors before deploying.

**Priority:** P0 (BLOCKING DEPLOYMENT)

---

## ✅ WHAT WAS FIXED

| Fix | File | Status |
|-----|------|--------|
| Grader detects Moneyline from pick text | `grade-picks-cron/index.ts` | ✅ Applied |
| Grader parses PK/DNB as spread 0 | `grade-picks-cron/index.ts` | ✅ Applied |
| Worker prompt forbids odds in pick text | `pregame-intel-worker/index.ts` | ✅ Applied |
| Worker prompt clarifies bet type rules | `pregame-intel-worker/index.ts` | ✅ Applied |
| Polluted picks reset to PENDING | `pregame_intel` table | ✅ Applied (207 picks) |

---

## 📊 DATA QUALITY METRICS (Post-Fix)

| Metric | Before Fix | After Fix | Target |
|--------|------------|-----------|--------|
| Clean Picks (%) | 92.2% | ~95%+ | 99%+ |
| Fake Dog Pollution | 70 picks | ~0 new | 0 |
| Misclassified ML | 23 picks | ~0 new | 0 |
| Picks with Odds Captured | ~5% | ~5% | 100% |
| CLV Tracked | 0% | 0% | 100% |

---

## 🎯 RECOMMENDED NEXT STEPS

### Immediate (Before Next Pick Cycle)

1. [ ] **Fix TypeScript syntax errors** in `grade-picks-cron/index.ts`
2. [ ] **Deploy updated workers** (`pregame-intel-worker`, `grade-picks-cron`)
3. [ ] **Verify no new pollution** after 24h of picks

### Short-Term (This Week)

4. [ ] **Add `odds_at_pick` column** to `pregame_intel`
2. [ ] **Capture odds at pick generation** from `matches.current_odds`
3. [ ] **Add line validation** to reject hallucinated lines

### Medium-Term (This Month)

7. [ ] **Implement CLV tracking** (closing line capture + calculation)
2. [ ] **Build ROI dashboard** using actual odds, not assumed -110
3. [ ] **Create data quality monitoring** (daily pollution check query)

---

## 🔐 APPROVAL CHECKLIST

Before approving this audit, please confirm:

- [ ] TypeScript syntax errors in grader have been reviewed
- [ ] Worker deployment has been approved
- [ ] `odds_at_pick` schema change is scoped for implementation
- [ ] Line validation feature is prioritized

---

**Prepared by:** Claude AI Assistant  
**Date:** 2026-01-28 02:07 PT  
**Version:** 1.0
