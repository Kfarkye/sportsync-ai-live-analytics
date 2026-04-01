# 🛠️ DATA INTEGRITY REMEDIATION PLAN: PROJECT TITAN

**Target:** Production-Grade Data Science Standards (DraftKings/ESPN Level)
**Version:** 2.0 (Verified via Expert Audit)
**Owner:** SportsSync Engineering

---

## 🧭 OBJECTIVE

Transform the pick generation and grading pipeline from "text-based generative AI" to "odds-aware, line-validated financial modeling." Eliminate all hallucinations (`+0` on favorites) and track rigorous ROI using real time-of-pick odds.

---

## 🚦 PHASE 1: THE FOUNDATION (Immediate - 24 Hours)

*Goal: Stop the bleeding (poisoned data) and stabilize the infrastructure via deterministic code.*

### 1.1 Fix TypeScript Syntax Errors (BLOCKER)

- **Problem:** `grade-picks-cron/index.ts` has syntax errors preventing deployment.
- **Action:** Fix missing braces `}` and `return` statements in the grader.
- **Validation:** Successful lint check and `supabase functions deploy`.

### 1.2 Deterministic Normalization (Drift Protection)

- **Problem:** `pregame-intel-worker` relies on LLM formatted output which drifts (e.g. `+0` vs `PK`, `SPREAD` vs `MONEYLINE`).
- **Action:** Implement post-generation middleware in the worker code (not just prompt):
  - **Normalize Text:** Regex transform `+0`, `-0`, or `Draw No Bet` -> `PK`.
  - **Strip Odds:** Remove anything looking like `(-110)` from pick text via regex.
  - **Enforce Type:** Infer type from text properties (`ML` vs `PK` vs `+/-`). Overwrite `grading_metadata.type` with the inferred type.
- **Why:** Code invariants are superior to prompt probabilistic guidance.

### 1.3 Targeted Quarantine

- **Problem:** Broad quarantine of `PK` deletes valid pick'em data.
- **Action:** Quarantine ONLY objectively corrupt records:
  - Picks where text contains odds-like tokens (e.g., `-115`).
  - Picks where stored `type` contradicts text (e.g., text has "Moneyline" but type is SPREAD).
  - Picks with ambiguous text (no spread number AND no ML marker).

---

## 🏗️ PHASE 2: THE "GOLDEN SOURCE" (Week 1)

*Goal: Every pick must be tied to a verifiable market price at ingestion time.*

### 2.1 Schema Migration (Odds Binding)

- **Action:** Add critical columns to `pregame_intel` (Nullable first to support legacy data):

  ```sql
  ALTER TABLE pregame_intel 
  ADD COLUMN odds_at_pick NUMERIC,  -- e.g. -110 or +140
  ADD COLUMN line_at_pick NUMERIC,  -- e.g. -1.5 or 145.5
  ADD COLUMN closing_odds NUMERIC,  -- For CLV tracking
  ADD COLUMN closing_line NUMERIC;
  ```

### 2.2 Golden Source Lookup & Binding

- **Action:** Update `pregame-intel-worker` to **FETCH** current odds from `matches` table immediately upon invalidating an AI pick.
- **Logic:**
  1. Worker normalizes text + infers `type`.
  2. Worker fetches current market line for that match/market.
  3. Worker binds `odds_at_pick` and `line_at_pick` from market data.
  4. **Validation:** If pick line differs from market line by > 1.5 pts, reject or force re-eval.

---

## 🛡️ PHASE 3: GATEKEEPING & EXPANSION (Week 2)

*Goal: Formalize the firewall and expand to new bet types.*

### 3.1 Validation Middleware

- **Action:** Extract normalization logic into a shared middleware library.
- **Expansion:** Add support for `TOTAL` and `DRAW_NO_BET` only after grader is updated to handle them.

---

## 📈 PHASE 4: FINANCIAL METRICS (Month 1)

*Goal: Report ROI and CLV like a hedge fund.*

### 4.1 True ROI Dashboard

- **Action:** Deprecate "Win Rate" as the primary metric.
- **New Metric:** **Units Won/Lost** based on `odds_at_pick`.
  - Win @ +150 = +1.5 units
  - Win @ -200 = +0.5 units
  - Loss = -1.0 unit (or risk amount)

### 4.2 CLV (Closing Line Value) Tracking

- **Action:** Build a cron job `capture-closing-lines` that runs at game start time.
- **Metric:** `CLV = (Closing Line Probability) - (Pick Line Probability)`
- **Why:** Proves if the model has a true edge (beating the market moves), which predicts future success better than W/L record.

---

## 📝 APPROVAL REQUEST

| Item | Priority | Effort | Risk |
|------|----------|--------|------|
| **Phase 1 (Fix Syntax/Deploy)** | 🚨 P0 | Low | High (System currently broken) |
| **Phase 2 (Odds Schema Mig)** | 🔥 P0 | Med | Med (DB Migration) |
| **Phase 3 (Validation Middleware)** | 🛡️ P1 | High | Low |
| **Phase 4 (ROI/CLV)** | 📊 P2 | Med | Low |

**Recommendation:** Approve immediate execution of **Phase 1** to restore grader function, followed by **Phase 2** sprint start on Monday.

---
**Prepared By:** Antigravity (AI Architect)
**Status:** READY FOR EXECUTION
