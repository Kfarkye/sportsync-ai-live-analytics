# 🔍 QA AUDIT: Production-Hardened Files v2.2 (Final Review)

**Auditor:** Lead Data Scientist (AI)
**Date:** 2026-01-28
**Files Under Review:**

1. `grade-picks-cron/index.ts` (v2.2)
2. `ingest-live-games/index.ts` (v2.2)

---

## 📊 RESTORATION CHECKLIST

### **grade-picks-cron v2.2**

| Feature | v2.0 (Current) | v2.1 (Broken) | v2.2 (Proposed) | Status |
|---------|----------------|---------------|-----------------|--------|
| **sharp_intel grading** | ✅ | ❌ | ✅ Lines 299-335 | ✅ **RESTORED** |
| **ai_chat_picks grading** | ✅ | ❌ | ✅ Lines 341-375 | ✅ **RESTORED** |
| **Stale → MANUAL_REVIEW** | ✅ | ❌ | ✅ Lines 288-296 | ✅ **RESTORED** |
| **Canonical Team Matching** | ✅ | ❌ | ✅ Lines 197-225 | ✅ **RESTORED** |
| **Granular Spread Parsing (.25/.5)** | ✅ | ❌ | ✅ Lines 148-157 | ✅ **RESTORED** |
| **CLV Calculation (sharp)** | ✅ | ❌ | ✅ Lines 320-323 | ✅ **RESTORED** |
| **CLV Calculation (chat)** | ✅ | ❌ | ✅ Lines 365-367 | ✅ **RESTORED** |
| **WIN/LOSS counters** | ✅ | ❌ | ✅ Line 269-270 | ✅ **RESTORED** |
| **manualReview counter** | ✅ | ❌ | ✅ Line 294 | ✅ **RESTORED** |
| **ESPN Fallback + Persist** | ✅ | ❌ | ✅ Lines 239-254 | ✅ **RESTORED** |
| **Response format with stats** | ✅ | ❌ | ✅ Lines 380-384 | ✅ **RESTORED** |
| **Tennis ScoreBundle** | ❌ | ✅ | ✅ | ✅ **ADDED** |
| **Tennis Sets vs Games** | ❌ | ✅ | ✅ | ✅ **ADDED** |
| **alignScoreToPick (Swap)** | ❌ | ✅ | ✅ | ✅ **ADDED** |

**grade-picks-cron v2.2 Verdict:** ✅ **ALL FEATURES RESTORED + TENNIS ADDED**

---

### **ingest-live-games v2.2**

| Feature | v1.9.3 (Current) | v2.1 (Broken) | v2.2 (Proposed) | Status |
|---------|------------------|---------------|-----------------|--------|
| **SRE Authority Merge** | ✅ | ❌ | ✅ Lines 193-224 | ✅ **RESTORED** |
| **Premium Feed Resolution** | ✅ | ❌ | ✅ Line 195 `resolve_market_feed` | ✅ **RESTORED** |
| **T-60/T-0 Snapshots** | ✅ | ❌ | ✅ Lines 229-244 | ✅ **RESTORED** |
| **Logger utility** | ✅ | ❌ | ✅ Lines 77-81 | ✅ **RESTORED** |
| **entity_mappings upsert** | ✅ | ❌ | ✅ Line 175 | ✅ **RESTORED** |
| **AI Halftime Trigger** | ✅ | ❌ | ✅ Lines 268-270 | ✅ **RESTORED** |
| **Tennis Flatten Structure** | ❌ | ✅ | ✅ Lines 119-131 | ✅ **ADDED** |
| **Tennis extra_data (Games)** | ❌ | ✅ | ✅ Lines 157-161 | ✅ **ADDED** |

**Potential Missing Items (Comparing to Current):**

| Feature | Current v1.9.3 | v2.2 | Status |
|---------|----------------|------|--------|
| **Closing Line Logic** | ✅ Lines 321-329 | ❓ Not visible | ⚠️ **VERIFY** |
| **Score Monotonicity Guard** | ✅ Lines 331-341 | ❓ Not visible | ⚠️ **VERIFY** |
| **Weather Info** | ✅ Lines 343-345 | ❓ Not visible | 🟡 LOW |
| **game_officials resolution** | ✅ Lines 226-229 | ❓ Not visible | 🟡 LOW |
| **live_forecast_snapshots** | ✅ Lines 402-415 | ❓ Not visible | 🟡 MEDIUM |

---

## 🔴 REMAINING GAPS (ingest-live-games v2.2)

Based on comparison with current production file:

### **1. Missing Closing Line Logic**

```typescript
// CURRENT v1.9.3 (Lines 321-329)
let closingOdds = null;
let isClosingLocked = existingMatch?.is_closing_locked || false;

if (!isClosingLocked && isLiveGame && finalCurrentOdds.homeSpread) {
    closingOdds = finalCurrentOdds;
    isClosingLocked = true;
    supabase.from('closing_lines').upsert({...});
}
```

**Impact:** Closing line won't be captured for CLV calculation.
**Severity:** 🔴 HIGH

### **2. Missing Score Monotonicity Guard**

```typescript
// CURRENT v1.9.3 (Lines 331-341)
if (existingMatch) {
    const dbHome = existingMatch.home_score || 0;
    const dbAway = existingMatch.away_score || 0;
    if (dbHome > homeScore || dbAway > awayScore) {
        homeScore = Math.max(homeScore, dbHome);
        awayScore = Math.max(awayScore, dbAway);
    }
}
```

**Impact:** Score could regress if ESPN briefly reports wrong data.
**Severity:** 🟠 MEDIUM

### **3. Missing is_closing_locked in Upsert**

The match upsert should include `is_closing_locked` field.
**Severity:** 🟠 MEDIUM

### **4. Missing live_forecast_snapshots**

Historical snapshot logging for backtesting.
**Severity:** 🟡 LOW (nice-to-have)

---

## 📊 SCHEMA DISCREPANCIES

| Column/Field | Table | Used In v2.2 | Exists? |
|--------------|-------|--------------|---------|
| `matches.extra_data` | matches | ✅ | ❓ VERIFY |
| `live_game_state.extra_data` | live_game_state | ✅ | ❓ VERIFY |
| `matches.is_closing_locked` | matches | ✅ | ✅ Exists |
| `closing_lines` table | N/A | Referenced | ✅ Exists |

**Action Required:**

```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'matches' AND column_name = 'extra_data';

SELECT column_name FROM information_schema.columns 
WHERE table_name = 'live_game_state' AND column_name = 'extra_data';
```

---

## 🎯 FINAL VERDICT

| File | Ready for Production? | Issues |
|------|----------------------|--------|
| **grade-picks-cron v2.2** | ✅ **YES** | None - All features restored + Tennis added |
| **ingest-live-games v2.2** | ⚠️ **CONDITIONAL** | Missing Closing Line Logic, Score Guard |

---

## 📋 SEND THIS TO DEVELOPER

```
FINAL v2.2 REVIEW NOTES:

✅ grade-picks-cron v2.2: APPROVED FOR DEPLOYMENT
   - All v2.0 features restored
   - Tennis support added
   - No blocking issues

⚠️ ingest-live-games v2.2: NEEDS 2 ADDITIONS

1. ADD CLOSING LINE LOGIC (Critical for CLV):
   let isClosingLocked = existingMatch?.is_closing_locked || false;
   const isLiveGame = ['LIVE', 'IN_PROGRESS', 'HALFTIME'].some(k => match.status?.toUpperCase().includes(k));
   if (!isClosingLocked && isLiveGame && finalMarketOdds.homeSpread) {
       match.closing_odds = finalMarketOdds;
       isClosingLocked = true;
       await supabase.from('closing_lines').upsert({ match_id: dbMatchId, ...finalMarketOdds });
   }
   match.is_closing_locked = isClosingLocked;

2. ADD SCORE MONOTONICITY GUARD (Data Safety):
   if (existingMatch) {
       const dbHome = existingMatch.home_score || 0;
       const dbAway = existingMatch.away_score || 0;
       if (dbHome > match.home_score || dbAway > match.away_score) {
           match.home_score = Math.max(match.home_score, dbHome);
           match.away_score = Math.max(match.away_score, dbAway);
       }
   }

3. SCHEMA MIGRATION (Run before deploy):
   ALTER TABLE matches ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}';
   ALTER TABLE live_game_state ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}';
```

---

**Signed:**  
*Antigravity, Lead AI Architect / QA Auditor*
