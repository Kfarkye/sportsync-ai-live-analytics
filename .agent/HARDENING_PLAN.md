# NBA 3-Window Signal System - Hardening Plan
## Date: 2025-12-31

---

## PHASE 1: CORE FUNCTIONS (KEEP & HARDEN)

### Critical Path (Signal Generation):
| Function | Purpose | Action |
|----------|---------|--------|
| `nba-bridge` | Orchestrator - triggers tick ingestion + model | HARDEN |
| `nba-ingest-tick` | Fetches live data from ESPN | HARDEN |
| `nba-run-model` | Computes model + emits window signals | HARDEN |

### Supporting (Keep):
| Function | Purpose | Action |
|----------|---------|--------|
| `nba-calibrate-weekly` | Weekly model tuning | KEEP |
| `ingest-live-games` | Global game discovery | KEEP |

---

## PHASE 2: LEGACY/UNUSED (CANDIDATES FOR REMOVAL)

### Likely Deprecated:
| Function | Reason |
|----------|--------|
| `live-edge-calculator` | Replaced by nba-run-model |
| `live-odds-tracker` | May be redundant |
| `live-snapshot-capture` | Replaced by nba-run-model |
| `nba-backtest` | Dev tool, not production |

### Investigate:
| Function | Status |
|----------|--------|
| `ai-chat` | Separate feature? |
| `analyze-match` | Pregame analysis? |
| `batch-recap-generator` | Post-game content? |
| `generate-pregame-context` | Used by PreGameView? |

---

## PHASE 3: HARDENING CHECKLIST

### 1. LOGGING (Add to all core functions):
- [ ] Request timestamp
- [ ] Game ID processed
- [ ] Success/failure status
- [ ] Processing duration (ms)
- [ ] Error stack traces

### 2. ERROR HANDLING:
- [ ] Wrap all DB operations in try/catch
- [ ] Return structured error responses
- [ ] Don't expose internal errors to clients

### 3. SECURITY:
- [ ] RLS on all tables
- [ ] Anon role = SELECT only
- [ ] Service role for writes
- [ ] Remove hardcoded keys from cron SQL

### 4. SCALABILITY:
- [ ] Add indexes on frequently queried columns
- [ ] Add retention policy (delete old ticks after 30 days)
- [ ] Partition nba_ticks by month if needed

### 5. MONITORING:
- [ ] Create audit_log table
- [ ] Log all signal emissions
- [ ] Track function execution times

---

## PHASE 4: UI CLEANUP

### Components to Review:
- [ ] Remove ControlTablePanel.tsx (uses old snapshot logic)
- [ ] Remove WhyPanel.tsx (uses old snapshot logic)
- [ ] Keep NbaCommandCenter.tsx (new 3-window design)

---

## EXECUTION ORDER:
1. Create audit_log table
2. Harden nba-bridge with logging
3. Harden nba-ingest-tick with logging
4. Harden nba-run-model with logging
5. Add RLS policies
6. Add data retention job
7. Test end-to-end
8. Remove deprecated functions
