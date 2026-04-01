# 🔍 QA AUDIT: Tennis Grading Files (v2.1)

**Auditor:** Lead Data Scientist (AI)
**Date:** 2026-01-28
**Files Under Review:**

1. `grade-picks-cron.ts` (Proposed v2.1)
2. `ingest-live-games.ts` (Proposed v2.1-tennis)

---

## 🚨 CRITICAL FINDINGS

### **1. FEATURE LOSS: `sharp_intel` and `ai_chat_picks` Grading REMOVED**

| Feature | Current v2.0 | Proposed v2.1 | Impact |
|---------|--------------|---------------|--------|
| **sharp_intel grading** | ✅ Lines 523-607 | ❌ **MISSING** | **CRITICAL**: Sharp picks will accumulate as PENDING forever |
| **ai_chat_picks grading** | ✅ Lines 611-694 | ❌ **MISSING** | **CRITICAL**: Chat picks will accumulate as PENDING forever |
| **Stale pick → MANUAL_REVIEW** | ✅ Lines 486-509 | ❌ **MISSING** | **HIGH**: Old picks won't be flagged for review |
| **Canonical team name matching** | ✅ Lines 285-357 | ❌ **MISSING** | **HIGH**: Fallback matching for CBB/NBA without odds_event_id is gone |
| **ESPN matches table update** | ✅ Lines 435-439 | ❌ **MISSING** | **MEDIUM**: ESPN fallback won't persist scores to matches table |

**Verdict:** The proposed `grade-picks-cron.ts` is a **MAJOR REGRESSION**. It adds Tennis support but **removes 3 critical grading pipelines**.

---

### **2. SCHEMA DISCREPANCIES**

| Column/Table | Used In Proposed | Exists in Schema? | Issue |
|--------------|------------------|-------------------|-------|
| `matches.extra_data` | ✅ (Tennis games) | ❓ **UNVERIFIED** | Needs schema check |
| `matches.extra_data.home_games_won` | ✅ | ❓ **UNVERIFIED** | New JSONB field for Tennis |
| `matches.extra_data.away_games_won` | ✅ | ❓ **UNVERIFIED** | New JSONB field for Tennis |
| `pregame_intel.final_home_score` | ✅ | ✅ Exists | OK |
| `pregame_intel.final_away_score` | ✅ | ✅ Exists | OK |
| `live_game_state.extra_data` | ✅ (ingest) | ❓ **UNVERIFIED** | New field in ingest |

**Action Required:** Run schema check for `matches.extra_data` column.

---

### **3. LOGIC ISSUES IN PROPOSED GRADER**

#### A. Tennis Alignment Function (`alignScoreToPick`)

- **Good:** Handles swap when feed order differs from pick.
- **Risk:** Uses `includes()` for name matching. "Novak Djokovic" vs "N. Djokovic" may fail.
- **Recommendation:** Add fuzzy matching or first-last-name extraction.

#### B. Missing `resolveTeam()` for Canonical Matching

- Current v2.0 pre-caches `canonical_teams` for CBB/NBA fallback matching.
- Proposed v2.1 **removes this entirely**.
- This will cause grading failures for picks without `odds_event_id`.

#### C. Tennis Games Fallback Logic

- **Good:** ESPN fallback parses `linescores` to sum games.
- **Risk:** If ESPN returns Sets (2-1) without linescores, the fallback returns 0-0 games.
- **Mitigation:** Add guard for `linescores` length before summing.

---

### **4. POSITIVE CHANGES (Tennis Support)**

| Feature | Status | Notes |
|---------|--------|-------|
| `ScoreBundle.isTennis` flag | ✅ Good | Separates Tennis from Team Sports |
| Games vs Sets logic | ✅ Good | ML uses Sets, Spread/Total uses Games |
| `alignScoreToPick()` | ✅ Good | Handles P1/P2 order mismatch |
| ATP/WTA score fetching | ✅ Good | Added to sports array |
| Higher spread limit (50 for Tennis) | ✅ Good | Tennis games can be 30+ |

---

### **5. INGEST FILE CHANGES**

| Change | Status | Notes |
|--------|--------|-------|
| Tennis flattening (groupings) | ✅ Good | Handles ESPN's nested Tournament structure |
| `extra_data.home_games_won` | ✅ Good | Stores Games for grading |
| `extra_data.away_games_won` | ✅ Good | Stores Games for grading |
| Removed Logger utility | ⚠️ Minor | Existing uses `Logger.info/warn/error` |
| Removed SRE Authority Merge | ⚠️ **HIGH** | Premium feed resolution logic is GONE |
| Removed T-60/T-0 Snapshots | ⚠️ **HIGH** | Pre-game odds snapshots are GONE |
| Removed Live Forecast Snapshots | ⚠️ **HIGH** | Historical snapshot logging is GONE |
| Removed AI Trigger at Halftime | ⚠️ **MEDIUM** | Auto-analysis trigger is GONE |

---

## 🛠️ RECOMMENDED ACTIONS

### **MUST FIX (Before Deployment)**

1. **Restore `sharp_intel` grading** (lines 523-607 from current v2.0)
2. **Restore `ai_chat_picks` grading** (lines 611-694 from current v2.0)
3. **Restore Stale Pick → MANUAL_REVIEW** (lines 486-509 from current v2.0)
4. **Restore Canonical Team Matching** (lines 285-357 from current v2.0)
5. **Run schema migration for `matches.extra_data`** (if not exists)

### **SHOULD FIX (Pre-Production)**

1. **Restore SRE Authority Merge in ingest** (premium feed resolution)
2. **Restore T-60/T-0 Snapshots in ingest** (odds history)
3. **Add linescores guard in ESPN fallback** (prevent 0 games)

### **NICE TO HAVE**

1. Add fuzzy name matching for Tennis alignment
2. Add `sport_key` to OddsAPIScore for debugging

---

## 🎯 VERDICT

| File | Ready for Production? | Blocking Issues |
|------|----------------------|-----------------|
| `grade-picks-cron.ts` | ❌ **NO** | Missing sharp/chat grading, stale handling, canonical matching |
| `ingest-live-games.ts` | ⚠️ **PARTIAL** | Missing SRE authority merge, snapshots, AI triggers |

**Recommendation:** Merge the Tennis-specific additions into the existing v2.0 files rather than replacing them entirely.

---

**Signed:**  
*Antigravity, Lead AI Architect / QA Auditor*
