# 🎾 TENNIS GRADING AUDIT REPORT

**Target:** Verify grading status of 26 "Skipped" Tennis picks
**Date:** 2026-01-28
**Auditor:** Claude (AI Assistant)

---

## 🔍 FINDINGS

### 1. The "Missing Metadata" Myth

- **Observation:** The grader logged "Skipped: Missing grading_metadata.side" for 26 picks.
- **Reality:** These picks HAVE metadata, but it follows a **Tennis Schema** (`winner`, `loser`, `margin`, `source`) rather than the **Standard Schema** (`side`, `type`, `selection`).
- **Verdict:** The `grade-picks-cron` function (v2.0-strict) only understands `HOME/AWAY` sports. It does not know how to handle Tennis.

### 2. Double-Grading Risk

- **Observation:** The metadata already contains a result conclusion:
  - `reason: "Jasmine Paolini lost (ML)"`
  - `winner: "Iva Jovic"`
- **Implication:** Some *other* process (likely `tennis-grader` or an older version of the worker) has ALREADY determined the outcome and written it to `grading_metadata`, but failed to update the `pick_result` column to WIN/LOSS.
- **State:** These picks are stuck in purgatory: We know who won, but `pick_result` is still `PENDING`.

### 3. The Gap

- `grade-picks-cron` checks for `side: HOME|AWAY`. If missing, it skips.
- The Tennis logic is completely absent from the new strict grader.

---

## 🛠️ RECOMMENDED REMEDIATION

### Option A: Retroactive Cleanup (Fastest)

Write a one-time SQL script to parse the existing tennis metadata and set `pick_result`.

- If `reason` contains "won", set `WIN`.
- If `reason` contains "lost", set `LOSS`.

### Option B: System Integration (Robust)

Update `grade-picks-cron` to handle `sport = 'tennis'`.

- Tennis doesn't use Home/Away.
- Logic: `if (sport === 'tennis') checkWinner(selection, winner_name)`

---

## 🚀 EXECUTION PLAN (Immediate)

Since these are only ~26 picks and likely part of a legacy experiment or separate flow, I recommend **Option A (SQL Cleanup)** to get them out of the "Pending" queue instantly.

```sql
-- 🧹 TENNIS CLEANUP SCRIPT
UPDATE pregame_intel
SET pick_result = CASE 
    WHEN grading_metadata->>'reason' ILIKE '%won%' AND grading_metadata->>'reason' NOT ILIKE '%lost%' THEN 'WIN'
    WHEN grading_metadata->>'reason' ILIKE '%lost%' THEN 'LOSS'
    ELSE pick_result
END
WHERE pick_result = 'PENDING'
  AND match_id LIKE '%_tennis%'
  AND grading_metadata->>'reason' IS NOT NULL;
```

---

## 📝 APPROVAL REQUEST

**Action:** Run the SQL cleanup script to resolve the ~26 stuck tennis picks.
**Risk:** Low (uses existing logic already written in the metadata).

**Approve?**
