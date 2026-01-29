# 🔍 QA AUDIT: Production-Hardened Files (v2.1 Revised)

**Auditor:** Lead Data Scientist (AI)
**Date:** 2026-01-28
**Files Under Review:**

1. `pregame-intel-worker/index.ts` (Proposed)
2. `grade-picks-cron/index.ts` (Proposed)
3. `ingest-live-games/index.ts` (Proposed)

---

## 📋 SUMMARY OF CHANGES

| File | Key Changes | Risk Level |
|------|-------------|------------|
| **pregame-intel-worker** | Phase 1.2 Normalization, `jsr:@supabase` import | ✅ LOW |
| **grade-picks-cron** | Tennis ScoreBundle, alignScoreToPick | ⚠️ MEDIUM |
| **ingest-live-games** | Tennis flattening, extra_data | ⚠️ MEDIUM |

---

## 🔴 CRITICAL FINDINGS

### **1. grade-picks-cron: STILL MISSING CRITICAL FEATURES**

| Feature | Current v2.0 | Proposed v2.1 | Status |
|---------|--------------|---------------|--------|
| **sharp_intel grading** | ✅ Lines 523-607 | ❌ **STILL MISSING** | 🔴 CRITICAL |
| **ai_chat_picks grading** | ✅ Lines 611-694 | ❌ **STILL MISSING** | 🔴 CRITICAL |
| **Stale → MANUAL_REVIEW** | ✅ Lines 486-509 | ❌ **STILL MISSING** | 🔴 HIGH |
| **Canonical team matching** | ✅ Lines 285-357 | ❌ **STILL MISSING** | 🔴 HIGH |
| **WIN/LOSS counter** | ✅ `wins++, losses++` | ❌ **MISSING** | ⚠️ MEDIUM |
| **manualReview counter** | ✅ Tracked | ❌ **MISSING** | ⚠️ MEDIUM |
| **Response format** | ✅ `{pregame, sharp, chat, trace}` | ❌ `{status, graded, trace}` | ⚠️ BREAKING |

**Verdict:** The proposed grader still removes 3 critical pipelines. **DO NOT DEPLOY.**

---

### **2. ingest-live-games: STILL MISSING CRITICAL FEATURES**

| Feature | Current v1.9.3 | Proposed v2.1 | Status |
|---------|----------------|---------------|--------|
| **SRE Authority Merge** | ✅ Lines 260-313 | ❌ **MISSING** | 🔴 HIGH |
| **Premium Feed Resolution** | ✅ `resolve_market_feed` RPC | ❌ **MISSING** | 🔴 HIGH |
| **T-60/T-0 Snapshots** | ✅ Lines 347-368 | ❌ **MISSING** | 🟠 MEDIUM |
| **Live Forecast Snapshots** | ✅ Lines 402-415 | ❌ **MISSING** | 🟠 MEDIUM |
| **AI Halftime Trigger** | ✅ Lines 417-421 | ❌ **MISSING** | 🟠 MEDIUM |
| **Closing Line Logic** | ✅ Lines 321-329 | ❌ **MISSING** | 🔴 HIGH |
| **Score Monotonicity Guard** | ✅ Lines 331-341 | ❌ **MISSING** | 🟠 MEDIUM |
| **Weather Info** | ✅ Lines 343-345 | ❌ **MISSING** | 🟡 LOW |
| **entity_mappings upsert** | ✅ Line 224 | ❌ **MISSING** | 🟠 MEDIUM |
| **game_officials resolution** | ✅ Lines 226-229 | ❌ **MISSING** | 🟡 LOW |
| **Logger utility** | ✅ Lines 72-76 | ❌ **MISSING** | 🟡 LOW |

**Verdict:** The proposed ingest strips out the SRE Authority Merge (premium odds resolution), Closing Line capture, and T-60/T-0 snapshots. **DO NOT DEPLOY.**

---

### **3. pregame-intel-worker: LOOKS GOOD ✅**

| Feature | Current | Proposed | Status |
|---------|---------|----------|--------|
| **Phase 1.2 Normalization** | ❌ Not present | ✅ Added at line ~300 | ✅ GOOD |
| **Odds stripping** | ❌ | ✅ `(-110)`, `(Ev)`, etc. | ✅ GOOD |
| **PK normalization** | ❌ | ✅ `+0 → PK` | ✅ GOOD |
| **Type inference** | ❌ | ✅ Overwrites grading_metadata | ✅ GOOD |
| **odds_event_id fetch** | ✅ | ✅ Preserved | ✅ GOOD |
| **Freshness guard** | ✅ | ✅ Preserved | ✅ GOOD |
| **Job queue handling** | ✅ | ✅ Preserved | ✅ GOOD |

**Minor Issue:** Import changed from `npm:@supabase/supabase-js@2` to `jsr:@supabase/supabase-js@2`.

- JSR (JavaScript Registry) is newer. Should work but verify Supabase Edge Functions support it.

**Verdict:** Pregame-intel-worker is **SAFE TO DEPLOY.**

---

## 📊 SCHEMA DISCREPANCY CHECK

### New Columns/Fields Referenced

| Column/Field | Table | Used In | Exists? | Action |
|--------------|-------|---------|---------|--------|
| `matches.extra_data` | matches | ingest | ❓ **VERIFY** | Check schema |
| `matches.extra_data.home_games_won` | matches (JSONB) | ingest, grader | ❓ **VERIFY** | Check schema |
| `matches.extra_data.away_games_won` | matches (JSONB) | ingest, grader | ❓ **VERIFY** | Check schema |
| `live_game_state.extra_data` | live_game_state | ingest | ❓ **VERIFY** | Check schema |
| `pregame_intel.final_home_score` | pregame_intel | grader | ✅ Exists | OK |
| `pregame_intel.final_away_score` | pregame_intel | grader | ✅ Exists | OK |
| `pregame_intel.odds_event_id` | pregame_intel | worker | ✅ Exists | OK |

**Action Required:** Run this query to verify:

```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'matches' AND column_name = 'extra_data';

SELECT column_name FROM information_schema.columns 
WHERE table_name = 'live_game_state' AND column_name = 'extra_data';
```

---

## 🛠️ RECOMMENDED ACTIONS

### **MUST FIX BEFORE DEPLOYMENT**

**For grade-picks-cron:**

1. ❌ Restore `sharp_intel` grading (copy lines 523-607 from current)
2. ❌ Restore `ai_chat_picks` grading (copy lines 611-694 from current)
3. ❌ Restore `Stale → MANUAL_REVIEW` logic (copy lines 486-509 from current)
4. ❌ Restore Canonical Team Matching (copy lines 285-357 from current)
5. ❌ Restore response format with `{pregame, sharp, chat}` object

**For ingest-live-games:**

1. ❌ Restore SRE Authority Merge (copy lines 260-313 from current)
2. ❌ Restore Closing Line Logic (copy lines 321-329 from current)
3. ❌ Restore T-60/T-0 Snapshots (copy lines 347-368 from current)
4. ❌ Restore Score Monotonicity Guard (copy lines 331-341 from current)

### **CAN DEPLOY NOW**

| File | Status |
|------|--------|
| **pregame-intel-worker** | ✅ **READY** |
| **grade-picks-cron** | ❌ **BLOCKED** |
| **ingest-live-games** | ❌ **BLOCKED** |

---

## 🎯 VERDICT

| File | Ready for Production? | Blocking Issues |
|------|----------------------|-----------------|
| `pregame-intel-worker/index.ts` | ✅ **YES** | None |
| `grade-picks-cron/index.ts` | ❌ **NO** | sharp/chat/stale/canonical MISSING |
| `ingest-live-games/index.ts` | ❌ **NO** | SRE/Closing/Snapshots MISSING |

**Recommendation:**

- Deploy `pregame-intel-worker` now (Phase 1.2 complete)
- Merge Tennis additions into existing grader/ingest files rather than replacing

---

**Signed:**  
*Antigravity, Lead AI Architect / QA Auditor*
