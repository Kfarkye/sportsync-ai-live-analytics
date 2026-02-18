# Database & Data Flow Audit Report

**Date:** 2026-02-18
**Scope:** Full audit of Supabase database layer, data access patterns, migrations, security, and flow issues.

---

## Executive Summary

This audit identified **28 issues** across 7 categories. The most critical findings are:
- 5 database tables referenced in application code with no migration definitions
- 14+ overly permissive RLS policies allowing unrestricted writes
- Duplicate match-fetching hooks causing architectural confusion
- Missing GIN indexes on 12+ JSONB columns
- 16 ON DELETE CASCADE references risking unintended data loss
- localStorage-based API key override creating a client-side security bypass

---

## 1. CRITICAL: Missing Table Definitions

**Severity: P0**

The following tables are actively queried in `src/services/dbService.ts` but have **no corresponding CREATE TABLE migration**:

| Table | Service Method | Line |
|-------|---------------|------|
| `daily_thesis` | `getDailyAngle()` | dbService.ts:318 |
| `team_metrics` | `getTeamMetrics()` | dbService.ts:357 |
| `ai_signal_snapshots` | `storeAISignalSnapshot()` | dbService.ts:295 |
| `news_intel` | `getTeamNews()` | dbService.ts:131 |
| `deep_intel` | `getCachedIntel()` | dbService.ts:289 |

**Impact:** Queries against these tables will silently fail (returning null/empty), causing data to never load for daily angles, team metrics, and AI signal archiving. New deployments or environments will have no schema for these tables.

**Recommendation:** Create migration files for all 5 tables immediately, or remove the dead code paths if these features have been deprecated.

---

## 2. CRITICAL: Overly Permissive RLS Policies

**Severity: P0**

14+ Row-Level Security policies use `USING (true)` for write operations, meaning **any user with the anon key can INSERT, UPDATE, or DELETE rows**.

### FOR ALL USING (true) — Full Unrestricted Access:

| Table | Migration File |
|-------|---------------|
| `nba_games` | `20251231000009_nba_model_core.sql` |
| `nba_ticks` | `20251231000009_nba_model_core.sql` |
| `nba_snapshots` | `20251231000009_nba_model_core.sql` |
| `nba_decisions` | `20251231000009_nba_model_core.sql` |
| `nba_team_priors` | `20251231000009_nba_model_core.sql` |
| `nba_player_epm` | `20251231000009_nba_model_core.sql` |
| `nba_calibration_runs` | `20251231000009_nba_model_core.sql` |
| `raw_odds_log` | `20260109000009_telemetry_schema.sql` |
| `live_market_state` | `20260109000009_telemetry_schema.sql` |
| `derived_consensus_log` | `20260109000009_telemetry_schema.sql` |
| `derived_lag_metrics` | `20260109000009_telemetry_schema.sql` |
| `sharp_movements` | `20260109000008_grading_schema_rls.sql` |

### FOR INSERT WITH CHECK (true) — Unrestricted Inserts:

| Table | Migration File |
|-------|---------------|
| `starting_goalies` | `20260101000004_starting_goalies.sql` |
| `ai_chat_picks` | `20260116000002_fix_conversation_persistence.sql` |

**Impact:** Anyone with the public anon key (exposed in client-side JavaScript) can write arbitrary data to these tables. This enables data poisoning of model predictions, telemetry corruption, and injection of fake game state.

**Recommendation:** Replace `USING (true)` with `USING (auth.role() = 'service_role')` for all backend-only tables. Only keep `USING (true)` for SELECT policies on public read tables.

---

## 3. HIGH: Duplicate Match-Fetching Architecture

**Severity: P1**

Two completely independent match-fetching hooks exist:

### Hook A: `useMatchData` (src/hooks/useMatchData.ts)
- Manual state management (`useState`, `useEffect`, `useRef`)
- Fetches via Supabase Edge Function (`fetch-matches`)
- Custom polling logic (15s live, 60s today, 5min future)
- Has fallback to client-side ESPN fetch
- **NOT imported anywhere** — dead code

### Hook B: `useMatches` (src/hooks/useMatches.ts)
- Uses React Query (`useQuery`)
- Fetches via client-side ESPN service first, then merges premium odds
- Aggressive polling (5s live, 15s otherwise)
- **Actually used** in `AppShell.tsx`

**Issues:**
1. `useMatchData` is dead code — it was likely the original implementation that was superseded by `useMatches` but never cleaned up.
2. The two hooks take fundamentally different approaches (Edge Function vs client-side), creating confusion about the canonical data flow.
3. `useMatches` polls at 5s during live games — this is very aggressive and will generate significant Supabase function invocations and API costs.

**Recommendation:** Delete `useMatchData.ts`. If Edge Function fetching is the desired architecture, refactor `useMatches` to use it instead of client-side ESPN.

---

## 4. HIGH: Security — localStorage API Key Override

**Severity: P1**

**File:** `src/lib/supabase.ts:10-11`

```typescript
const storedKey = typeof window !== 'undefined'
  ? localStorage.getItem('sharpedge_supabase_key') : null;
const supabaseAnonKey = storedKey || (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';
```

The Supabase client allows the anon key to be overridden via `localStorage`. The `setSupabaseKey()` function (line 40) makes this a deliberate feature.

**Risk:** If an attacker gains XSS access, they can:
1. Replace the anon key with a service_role key (if they obtain one)
2. Redirect all Supabase traffic to a malicious project URL
3. Exfiltrate the stored key from localStorage

**Recommendation:** Remove the localStorage override. Use environment variables exclusively. If multi-environment switching is needed, implement it server-side or via build-time configuration.

---

## 5. HIGH: Edge Functions Without JWT Verification

**Severity: P1**

**File:** `supabase/config.toml`

| Function | verify_jwt |
|----------|-----------|
| `pregame-intel` | `false` |
| `pregame-intel-worker` | `false` |
| `sharp-picks-worker` | `false` |
| `pregame-intel-cron` | `false` |
| `ingest-odds` | `false` |

**Impact:** These functions can be invoked by anyone without authentication. If they perform write operations to the database using the service_role key (which Edge Functions typically use), this is a privilege escalation vector.

**Recommendation:** Either enable JWT verification, or implement explicit bearer token / cron secret validation inside each function. Document which functions are intentionally public.

---

## 6. HIGH: ON DELETE CASCADE Risks

**Severity: P1**

16 foreign key references use `ON DELETE CASCADE`. Key risks:

| Parent Table | Child Table | Risk |
|-------------|------------|------|
| `matches` | `live_forecast_snapshots` | Deleting a match destroys all forecast analytics |
| `matches` | `match_status_log` | Deleting a match destroys audit trail |
| `auth.users` | `conversations` | User deletion destroys all chat history |
| `nba_games` | `nba_ticks` | Game deletion destroys all tick-level data (training data loss) |
| `nba_games` | `nba_snapshots` | Game deletion destroys model snapshots |
| `nba_games` | `nba_decisions` | Game deletion destroys decision audit trail |
| `conversations` | `ai_chat_runs` | Conversation deletion cascades run history |

**Recommendation:** Replace `ON DELETE CASCADE` with `ON DELETE RESTRICT` or `ON DELETE SET NULL` for analytics/audit tables. Only use CASCADE for true parent-child ownership (e.g., aliases → canonical entities).

---

## 7. MEDIUM: Missing JSONB GIN Indexes

**Severity: P2**

12+ JSONB columns lack GIN indexes, causing full table scans when querying JSON content:

| Table | Column | Migration |
|-------|--------|-----------|
| `venue_intel` | `content` | `2025121805_intel_infrastructure_expanded.sql` |
| `match_news` | `key_injuries` | `2025121805_intel_infrastructure_expanded.sql` |
| `match_news` | `betting_factors` | `2025121805_intel_infrastructure_expanded.sql` |
| `match_news` | `line_movement` | `2025121805_intel_infrastructure_expanded.sql` |
| `match_news` | `weather_forecast` | `2025121805_intel_infrastructure_expanded.sql` |
| `match_news` | `fatigue` | `2025121805_intel_infrastructure_expanded.sql` |
| `match_news` | `officials` | `2025121805_intel_infrastructure_expanded.sql` |
| `match_thesis` | `content` | `2025121805_intel_infrastructure_expanded.sql` |
| `narrative_intel` | `content` | `2025121805_intel_infrastructure_expanded.sql` |
| `edge_analysis` | `content` | `2025121805_intel_infrastructure_expanded.sql` |
| `box_scores` | `content` | `2025121805_intel_infrastructure_expanded.sql` |
| `conversations` | `messages` | `20260101000001_conversations.sql` (commented out) |

**Note:** These columns are primarily queried by `match_id` (not by JSON content), so the performance impact is limited to cases where JSON-path queries are used. However, adding GIN indexes is low cost and protects against future query patterns.

---

## 8. MEDIUM: useDbFirst Hook — Stale Closure Risk

**Severity: P2**

**File:** `src/hooks/useDbFirst.ts:95`

```typescript
}, dependencies);  // useCallback with external dependency array
```

The `fetchData` callback depends on the caller's `dependencies` array, but `fetchFromApi` (which `fetchData` calls) has its own closure over `data` state. This creates a stale closure where `fetchFromApi` may reference outdated `data` when checking `if (!data)` on line 43.

**Recommendation:** Use a ref for the `data` state check inside `fetchFromApi`, or restructure to avoid the stale closure.

---

## 9. MEDIUM: Inconsistent Error Handling in dbService

**Severity: P2**

**File:** `src/services/dbService.ts`

The `cacheData` function (line 92) performs upserts but discards all errors:

```typescript
export async function cacheData(
  table: string,
  conflictField: string,
  payload: Record<string, DbValue>
): Promise<void> {
  await supabase
    .from(table)
    .upsert({ ...payload, fetched_at: new Date().toISOString() },
      { onConflict: conflictField });
  // No error check — silent failure
}
```

Similarly, `storeAISignalSnapshot` (line 295) discards the insert result.

**Recommendation:** At minimum, log errors from write operations. Consider returning success/failure to callers.

---

## 10. MEDIUM: ILIKE Wildcard Queries Without Indexes

**Severity: P2**

**File:** `src/services/dbService.ts`

Two queries use `ILIKE` with leading wildcards, which cannot use B-tree indexes:

1. **Line 198:** `getPlayerProps` — `.ilike('match_id', \`${matchId}%\`)` (trailing wildcard only — this is fine)
2. **Line 252:** `getRefIntel` — `.ilike('match_id', \`${matchId}%\`)` (trailing wildcard only — this is fine)
3. **Line 367:** `getTeamMetrics` — `.ilike('team_name', \`%${shortName}%\`)` (BOTH wildcards — full table scan)
4. **Line 388:** `getPlayerPropStreaks` — `.ilike('team', \`%${teamName}%\`)` (BOTH wildcards — full table scan)

**Recommendation:** For team name lookups, consider a trigram index (`pg_trgm` extension) or a normalized lookup table instead of ILIKE with double wildcards.

---

## 11. LOW: Deprecated / Dead Code

**Severity: P3**

| File | Issue |
|------|-------|
| `src/hooks/useMatchData.ts` | Entire file is dead code (not imported anywhere) |
| `src/contexts/DataContext.tsx` | Marked as DEPRECATED in line 1 comment |
| `src/services/dbService.ts:129` | `getTeamNews` marked "Legacy - kept for reference" |
| `src/types/schema.ts` | Contains SQL proposal comments but no runtime code |

---

## 12. LOW: React Query + localStorage Persistence — Cache Staleness

**Severity: P3**

**File:** `src/lib/queryClient.ts`

The React Query cache persists to localStorage with a 24-hour TTL:

```typescript
persistQueryClient({
  queryClient,
  persister: localStoragePersister,
  maxAge: 1000 * 60 * 60 * 24, // 24 hours
});
```

Combined with the `staleTime: 5 minutes` default, this means:
- A user who closes and reopens the app will see potentially 24-hour-old data as "fresh" for 5 minutes before refetching
- For live sports data, stale cached results can show wrong scores

**Recommendation:** Set a shorter `maxAge` for the persister (e.g., 1 hour), or use `buster` versioning to invalidate cache across deployments.

---

## Architecture Diagram — Current Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT (React)                        │
│                                                          │
│  useMatches ──→ ESPN Service ──→ mergePremiumOdds       │
│       │              │                   │               │
│       │              ▼                   ▼               │
│       │        espnService.ts     oddsService.ts         │
│       │                                  │               │
│       ▼                                  ▼               │
│  React Query ◄── localStorage ──► Supabase Client       │
│  (5min stale)    (24h persist)     (anon key)           │
│                                          │               │
│  useDbFirst ──→ dbService.ts ──→ Supabase .from()       │
│  (stale-while-   (cache TTLs)                           │
│   revalidate)                                            │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│               SUPABASE (PostgreSQL)                      │
│                                                          │
│  Edge Functions (48) ──→ service_role client ──→ Tables  │
│  ├─ fetch-matches (JWT disabled)                        │
│  ├─ pregame-intel (JWT disabled)                        │
│  ├─ ingest-odds (JWT disabled)                          │
│  ├─ ai-chat (JWT enabled)                               │
│  └─ get-odds (default)                                  │
│                                                          │
│  RLS: 14+ tables with USING(true) for writes           │
│  Cascades: 16 ON DELETE CASCADE references              │
│  Missing: 5 tables in code but not in migrations        │
└──────────────────────────────────────────────────────────┘
```

---

## Prioritized Fix Order

1. **P0:** Create migrations for 5 missing tables (or remove dead code)
2. **P0:** Tighten RLS policies — restrict writes to `service_role`
3. **P1:** Remove localStorage API key override
4. **P1:** Delete dead `useMatchData.ts` hook and `DataContext.tsx`
5. **P1:** Add JWT verification or token validation to exposed Edge Functions
6. **P1:** Review CASCADE policies on analytics/audit tables
7. **P2:** Add GIN indexes to JSONB columns
8. **P2:** Add error handling to `cacheData()` and `storeAISignalSnapshot()`
9. **P2:** Fix stale closure in `useDbFirst`
10. **P3:** Reduce localStorage cache persistence maxAge
