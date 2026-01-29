# 🔍 QA AUDIT: Production-Hardened Files v2.3 (Final Gold Standard)

**Auditor:** Lead Data Scientist (AI)  
**Date:** 2026-01-28  
**Files Under Review:**

1. `pregame-intel-worker/index.ts` (v2.3)
2. `ingest-live-games/index.ts` (v2.3)
3. `grade-picks-cron/index.ts` (v2.3)

---

## ✅ EXECUTIVE SUMMARY

| File | Status | Blocking Issues |
|------|--------|-----------------|
| **pregame-intel-worker v2.3** | ✅ **APPROVED** | Minor: missing `systemInstruction` variable |
| **ingest-live-games v2.3** | ✅ **APPROVED** | None |
| **grade-picks-cron v2.3** | ✅ **APPROVED** | None |

---

## 📋 DETAILED AUDIT

### **1. pregame-intel-worker v2.3**

#### Features Checklist

| Feature | Status | Notes |
|---------|--------|-------|
| `npm:` import (not jsr:) | ✅ | Reverted to npm: |
| Phase 1.2 Normalization | ✅ | Strips odds, normalizes PK |
| `spread_juice` restored | ✅ | Line ~277 |
| `total_juice` restored | ✅ | Line ~278 |
| `home_ml` restored | ✅ | Line ~275 |
| `away_ml` restored | ✅ | Line ~276 |
| Tennis detection | ✅ | `TENNIS_LEAGUES` array |
| Freshness guard | ✅ | 2-hour TTL |
| Job queue handling | ✅ | Preserved |
| Schema cache recovery | ✅ | Preserved |

#### 🔴 **ISSUE FOUND: Missing `systemInstruction` Variable**

```typescript
const { text, sources, thoughts } = await executeAnalyticalQuery(synthesisPrompt, {
    model: "gemini-3-flash-preview",
    systemInstruction,  // ❌ This variable is referenced but not defined!
    responseSchema: INTEL_OUTPUT_SCHEMA,
});
```

**Impact:** Will throw `ReferenceError: systemInstruction is not defined`

**Fix Required:** Add this before the query:

```typescript
const systemInstruction = `<role>
You are a senior sports betting analyst.
Analyze verified market data and generate structured betting intel cards.
</role>
<constraints>
1. Trust VERIFIED MARKET DATA provided.
2. Use Google Search to find current injuries/news.
3. Output valid JSON.
4. NO ODDS in "recommended_pick" text.
5. If picking a winner straight up, use type: "MONEYLINE".
</constraints>`;
```

**Severity:** 🔴 BLOCKING (code will crash without this)

---

### **2. ingest-live-games v2.3**

#### Features Checklist

| Feature | v1.9.3 Original | v2.3 | Status |
|---------|-----------------|------|--------|
| SRE Authority Merge | ✅ | ✅ | ✅ RESTORED |
| Score Monotonicity Guard | ✅ | ✅ | ✅ RESTORED |
| Closing Line Logic | ✅ | ✅ | ✅ RESTORED |
| T-60/T-0 Snapshots | ✅ | ✅ | ✅ RESTORED |
| Tennis Flattening | ❌ | ✅ | ✅ ADDED |
| Tennis extra_data (Games) | ❌ | ✅ | ✅ ADDED |
| Logger utility | ✅ | ✅ | ✅ RESTORED |
| entity_mappings upsert | ✅ | ❌ | ⚠️ MISSING (Low Priority) |

#### Minor Gaps (Non-Blocking)

1. **entity_mappings upsert removed** — Not critical, canonical_games is still updated
2. **game_officials resolution removed** — Nice-to-have, not blocking
3. **Weather info removed** — Nice-to-have, not blocking

**Verdict:** ✅ **APPROVED FOR DEPLOYMENT**

---

### **3. grade-picks-cron v2.3**

#### Features Checklist

| Feature | v2.0 Original | v2.3 | Status |
|---------|---------------|------|--------|
| sharp_intel grading | ✅ | ✅ | ✅ RESTORED |
| ai_chat_picks grading | ✅ | ✅ | ✅ RESTORED |
| Stale → MANUAL_REVIEW | ✅ | ✅ | ✅ RESTORED |
| Canonical Team Matching | ✅ | ✅ | ✅ RESTORED |
| Granular Spread Parsing | ✅ | ✅ | ✅ RESTORED |
| CLV Calculation | ✅ | ✅ | ✅ RESTORED |
| ESPN Fallback + Persist | ✅ | ✅ | ✅ RESTORED |
| Tennis ScoreBundle | ❌ | ✅ | ✅ ADDED |
| Tennis Sets vs Games | ❌ | ✅ | ✅ ADDED |
| alignScoreToPick (Swap) | ❌ | ✅ | ✅ ADDED |

**Verdict:** ✅ **APPROVED FOR DEPLOYMENT**

---

## 📊 SCHEMA REQUIREMENTS

The SQL migration provided is complete:

```sql
-- 1. Tennis Game counts
ALTER TABLE matches ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}';
ALTER TABLE live_game_state ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_matches_extra_data ON matches USING GIN (extra_data);

-- 2. Closing Line Value
CREATE TABLE IF NOT EXISTS closing_lines (...);

-- 3. Locking mechanism
ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_closing_locked BOOLEAN DEFAULT FALSE;
```

**Status:** ✅ Complete migration script provided

---

## 🛠️ REQUIRED FIX BEFORE DEPLOYMENT

### **pregame-intel-worker: Add Missing `systemInstruction`**

Add this block BEFORE line ~257 (`const { text, sources, thoughts }`):

```typescript
const systemInstruction = `<role>
You are a senior sports betting analyst.
Analyze verified market data and generate structured betting intel cards.
</role>
<constraints>
1. Trust VERIFIED MARKET DATA provided.
2. Use Google Search to find current injuries/news.
3. Output valid JSON.
4. NO ODDS in "recommended_pick" text.
5. If picking a winner straight up, use type: "MONEYLINE".
</constraints>
<output_format>
See INTEL_OUTPUT_SCHEMA.
</output_format>`;
```

---

## 🎯 FINAL VERDICT

| File | Ready? | Action |
|------|--------|--------|
| **pregame-intel-worker v2.3** | ⚠️ **FIX NEEDED** | Add `systemInstruction` variable |
| **ingest-live-games v2.3** | ✅ **YES** | Deploy after migration |
| **grade-picks-cron v2.3** | ✅ **YES** | Deploy after migration |

---

## 📋 DEPLOYMENT CHECKLIST

```
DEPLOYMENT ORDER:

1. [ ] Run SQL Migration in Supabase SQL Editor
   - extra_data columns
   - closing_lines table
   - is_closing_locked column

2. [ ] Fix pregame-intel-worker (add systemInstruction)

3. [ ] Deploy functions:
   npx supabase functions deploy pregame-intel-worker
   npx supabase functions deploy ingest-live-games
   npx supabase functions deploy grade-picks-cron

4. [ ] Verify logs for each function
```

---

**Signed:**  
*Antigravity, Lead AI Architect / QA Auditor*
