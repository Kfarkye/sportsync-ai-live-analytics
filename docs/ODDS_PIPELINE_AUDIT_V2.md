# Odds API Pipeline Audit V2

**Date**: 2026-02-23
**Scope**: Full 7-layer audit of The Odds API data pipeline — ingestion through edge calculation
**Supersedes**: `ODDS_PIPELINE_AUDIT.md` (2026-02-16)

---

## Architecture Overview

```
The Odds API (v4)
     │
     ├─ ingest-odds (1-min pg_cron + 6h Vercel cron)
     ├─ live-odds-tracker (2-min cron, concurrency: 2)
     ├─ capture-opening-lines (ESPN source)
     ├─ sync-player-props (4h cron)
     └─ get-odds (on-demand proxy)
          │
          ▼
    ┌─────────────────────────────────────────────┐
    │  Processing / Normalization                 │
    │  oddsUtils.ts (normalizeSource priority     │
    │    stack: Live > Consensus > Opening)       │
    │  soccer-odds-normalizer.ts                  │
    │  normalizeOdds.ts (American format)         │
    │  parseAmericanOdds() (pregame-intel-worker)  │
    └─────────────┬───────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────────────┐
    │  Storage (Supabase)                         │
    │  matches.current_odds / opening_odds /      │
    │    closing_odds (JSONB)                     │
    │  market_feeds (raw bookmaker data)          │
    │  raw_odds_log (per-book event store)        │
    │  market_history (append-only ledger)        │
    │  derived_consensus_log (true price shifts)  │
    │  live_market_state (mutable O(1) lookup)    │
    │  opening_lines / closing_lines (legacy)     │
    │  nba_market_history / nba_market_snapshots  │
    └─────────────┬───────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────────────┐
    │  Edge / Fair Value Calculation              │
    │  gameStateEngine.ts (computeAISignals)      │
    │  Sport physics: basketball / football /     │
    │    hockey / soccer / baseball               │
    │  live-edge-calculator (real-time alerts)    │
    └─────────────┬───────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────────────┐
    │  Frontend Delivery                          │
    │  useEnhancedOdds (6 query hooks)            │
    │  oddsService.ts (mergePremiumOdds)          │
    │  Supabase Realtime (live_game_state)        │
    │  Adaptive polling: 3s live / 60s pregame    │
    │  OddsCard / PregameOdds / LiveAnalysisCard  │
    └─────────────────────────────────────────────┘
```

---

## 1. ODDS API INGESTION

**STATUS:** ✅ BUILT

### Provider
**The Odds API** — `https://api.the-odds-api.com/v4`

### Authentication
- **Env variable:** `ODDS_API_KEY` (Supabase Edge Function Secrets)
- **Cron auth:** `CRON_SECRET` header on Vercel cron triggers
- **Retrieval:** `Deno.env.get('ODDS_API_KEY')` — `ingest-odds/index.ts:96`

### Endpoints Hit

| Endpoint | URL Pattern | File | Line |
|---|---|---|---|
| Featured Odds | `/v4/sports/{key}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=american` | `ingest-odds/index.ts` | 107 |
| Live Scores | `/v4/sports/{key}/scores?daysFrom=3` | `live-odds-tracker/index.ts` | 287 |
| Player Props | `/v4/sports/{key}/events/{id}/odds?markets={propMarkets}` | `get-odds/index.ts` | 178 |
| Alternate Lines | `/v4/sports/{key}/events/{id}/odds?markets=alternate_spreads,alternate_totals` | `get-odds/index.ts` | 241 |
| Historical | `/v4/historical/sports/{key}/odds?date={date}` | `get-odds/index.ts` | 267 |
| Available Markets | `/v4/sports/{key}/events/{id}/markets` | `get-odds/index.ts` | 313 |
| Events List | `/v4/sports/{key}/events` | `get-odds/index.ts` | 151 |

### Polling Frequency

| Function | Schedule | Source |
|---|---|---|
| `ingest-odds` (pg_cron) | Every minute `* * * * *` | `20260112000015_cron_overhaul.sql:125` |
| `ingest-odds` (Vercel) | Every 6h `0 4,10,16,22 * * *` | `vercel.json:14` |
| `live-odds-tracker` | Every 2 min `*/2 * * * *` | `20251219000003_odds_cron_setup.sql` |
| `sync-player-props` | Every 4h `0 2,6,10,14,18,22 * * *` | `vercel.json:20` |
| `pregame-intel` | Every 5 min `*/5 * * * *` | `vercel.json:16` |
| `sharp-picks` | Hourly `0 * * * *` | `vercel.json:18` |

### Sports/Leagues Covered

| Sport | Odds API Key | File |
|---|---|---|
| NBA | `basketball_nba` | `get-odds/index.ts:22` |
| NFL | `americanfootball_nfl` | `get-odds/index.ts:23` |
| NCAAB | `basketball_ncaab` | `get-odds/index.ts:24` |
| NCAAF | `americanfootball_ncaaf` | `get-odds/index.ts:25` |
| MLB | `baseball_mlb` | `get-odds/index.ts:26` |
| NHL | `icehockey_nhl` | `get-odds/index.ts:27` |
| EPL | `soccer_epl` | `get-odds/index.ts:28` |
| La Liga | `soccer_spain_la_liga` | `get-odds/index.ts:29` |
| Bundesliga | `soccer_germany_bundesliga` | `get-odds/index.ts:30` |
| Serie A | `soccer_italy_serie_a` | `get-odds/index.ts:31` |
| Ligue 1 | `soccer_france_ligue_one` | `get-odds/index.ts:32` |
| MLS | `soccer_usa_mls` | `get-odds/index.ts:33` |
| Champions League | `soccer_uefa_champs_league` | `get-odds/index.ts:34` |
| Europa League | `soccer_uefa_europa_league` | `get-odds/index.ts:35` |
| ATP Tennis | `tennis_atp_*` | `get-odds/index.ts:37` |
| WTA Tennis | `tennis_wta_*` | `get-odds/index.ts:39` |
| UFC/MMA | `mma_mixed_martial_arts` | `get-odds/index.ts:42` |

**League config is also database-driven:** `league_config` table with `id`, `odds_api_key`, `is_active` — `ingest-odds/index.ts:88`

### GAPS
- **No `soccer_fifa_world_cup` key** in any config — must be added for World Cup
- No `remainingRequests` tracking from Odds API response headers
- No monthly budget or cost cap enforcement

---

## 2. BOOKS COVERAGE

**STATUS:** ✅ BUILT

### Sportsbooks Fetched

**Primary book preference (for line selection):**
```typescript
// live-odds-tracker/index.ts:20
preferredBooks: ['pinnacle', 'circa', 'bookmaker', 'bet365',
                 'draftkings', 'fanduel', 'betmgm', 'bovada']
```

**Props book preference:**
```typescript
// sync-player-props/index.ts:216
const preferred = ['draftkings', 'fanduel', 'bovada', 'betmgm', 'betrivers', 'caesars'];
```

**ESPN book priority:**
```typescript
// espnAdapters.ts:61
const PRIORITY = ['draftkings', 'draft kings', 'fanduel', 'william hill',
                  'williamhill', 'betmgm', 'pinnacle', 'consensus'];
```

### Configurable?
Yes — preference lists are hardcoded but the sort logic picks the highest-priority available book dynamically:
```typescript
// sync-player-props/index.ts:217-221
const book = bookmakers.sort((a, b) => {
    const ia = preferred.indexOf(a.key);
    const ib = preferred.indexOf(b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
})[0];
```

### Markets Fetched

| Category | Markets | Scope |
|---|---|---|
| **Core** | `h2h`, `spreads`, `totals` | All sports |
| **NBA Props** | `player_points`, `player_rebounds`, `player_assists`, `player_threes`, `player_points_rebounds_assists` | NBA only |
| **NFL Props** | `player_pass_yds`, `player_pass_tds`, `player_rush_yds`, `player_receptions`, `player_reception_yds`, `player_anytime_td` | NFL only |
| **MLB Props** | `batter_hits`, `batter_total_bases`, `pitcher_strikeouts` | MLB only |
| **NHL Props** | `player_points`, `player_goals`, `player_shots_on_goal` | NHL only |
| **Alternates** | `alternate_spreads`, `alternate_totals` | On-demand |

### Regions
```typescript
// live-odds-tracker/index.ts:19
regions: 'us,us2,uk,eu,au'
```

### GAPS
- **No soccer player props** (goal scorer, assists, shots) — would need adding for World Cup
- Book preference lists hardcoded, not configurable via DB

---

## 3. DATA TRANSFORMATION

**STATUS:** 🔄 PARTIAL

### American Odds Parsing
**File:** `pregame-intel-worker/index.ts:118-158`
```typescript
const parseAmericanOdds = (v: any): number | null => {
    // Handles: numbers, strings, "EV"/"EVEN" (-> 100), parenthesized
    // Validates bounds: [-20000, -100] or [100, 20000]
    // Filters: 0, NaN, sub-100 absolute values
};
```

### American Odds Normalization
**File:** `src/lib/odds/normalizeOdds.ts:35-44`
```typescript
const normalizeAmerican = (v) => {
    // Standardizes: "110" -> "+110", validates format
};
```

### Odds Source Priority Stack
**File:** `packages/shared/src/oddsUtils.ts:277-420` — `normalizeSource()`
- **Live match:** Only live odds, no fallback to pre-game
- **Final match:** Closing (priority 100) -> Consensus (95)
- **Pre-game:** Current (80) -> Consensus (70) -> Opening (40)
- Resolves field aliases across multiple key variants (homeSpread, home_spread, spread_home, spread.home, etc.)
- **Soccer special case:** Corrects "Rest of Game" spreads to "Full Game" by applying score differential (lines 371-388)

### Soccer-Specific Normalizer
**File:** `supabase/functions/_shared/soccer-odds-normalizer.ts:24-78`
```typescript
export function normalizeSoccerOdds(current_odds): NormalizedSoccerMarkets {
    // Handles 3-way moneyline (home, away, draw)
    // Normalizes handicap + match total goals
}
```

### Implied Probability
**File:** `ai-chat/index.ts:1087-1092`
```typescript
const calcImpliedProb = (spread: number | null): number | null => {
    if (spread === null) return null;
    return Math.round(50 - (spread * 3));  // Simplified heuristic
};
```

### GAPS — CRITICAL
- **No standard American->Probability conversion.** The formula `P = 100 / (|odds| + 100)` for negative, `P = odds / (odds + 100)` for positive — NOT IMPLEMENTED anywhere.
- **No devig/vig removal.** Odds preserved with juice intact. No fair odds extraction from moneyline pairs.
- **Juice tracked as metadata** (`homeJuice`, `awayJuice` in `SpreadAnalysis` interface) but never removed.
- **Spread-only probability.** The `calcImpliedProb()` is a crude `50 - (spread * 3)` heuristic — not real implied probability.

---

## 4. STORAGE

**STATUS:** ✅ BUILT (Professional Event-Sourcing Architecture)

### Table Inventory

| Table | Type | Purpose | Key File |
|---|---|---|---|
| `matches` | Mutable | Core match record with `current_odds`, `opening_odds`, `closing_odds` JSONB | `fix_all_tables.sql:16-42` |
| `market_feeds` | Mutable | Raw bookmaker data from Odds API | `ingest-odds/index.ts` |
| `raw_odds_log` | Append-only | Per-book, per-market, per-side granular event store | `20260109000009_telemetry_schema.sql:6-24` |
| `market_history` | Append-only | Timestamped odds ledger for full audit trail | `20260107000003_odds_resilience_ledger.sql:7-34` |
| `derived_consensus_log` | Append-only | Records when consensus price shifts | `20260109000009_telemetry_schema.sql:49-64` |
| `live_market_state` | Mutable | Current snapshot for O(1) lookup | `20260109000009_telemetry_schema.sql:29-44` |
| `opening_lines` | Immutable | Single opening line per match | `fix_all_tables.sql:163-173` |
| `closing_lines` | Immutable | Single closing line per match | `fix_all_tables.sql:175-185` |
| `live_edge_alerts` | Append-only | Executable edge events | `live-edge-calculator/index.ts:552` |
| `nba_market_history` | Append-only | NBA-specific odds timeline with delta tracking | `20251231000002_comprehensive_data_lake.sql:94-120` |
| `nba_market_snapshots` | Immutable | Window snapshots (OPEN, Q1_END, HALFTIME, Q3_END) | `20251231000005_market_movement.sql:15-26` |

### Timestamps Preserved?
**Yes — comprehensive:**
- `matches.last_odds_update` — TIMESTAMPTZ
- `market_history.ts` — DEFAULT NOW()
- `raw_odds_log.ts` — API timestamp + `ingested_at` (DEFAULT NOW())
- `nba_market_history.ts` — DEFAULT NOW()
- Deduplication: `UNIQUE (game_id, market, side, book, ts)` on `raw_odds_log`

### Opening Line Protection
**File:** `20260107000003_odds_resilience_ledger.sql:41-43`
```sql
ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS is_opening_locked BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_closing_locked BOOLEAN DEFAULT FALSE;
```

### Bulk Update RPC
**File:** `20260120000001_fix_data_flow_safe_columns.sql`
```sql
-- Opening odds protection: only set if currently null
opening_odds = coalesce(m.opening_odds, (item->'opening_odds')::jsonb),
```

### GAPS
- `live_odds_snapshots` table referenced in `live-odds-tracker` but schema not found in migrations
- No TTL / partition-based cleanup for `raw_odds_log` or `market_history` — will grow unbounded

---

## 5. REFRESH STRATEGY

**STATUS:** ✅ BUILT (Multi-Tier)

### Cron Architecture

**Vercel Cron -> Handler -> Supabase Edge Function**
```
vercel.json schedule -> api/cron/ingest-odds.js (50s timeout)
                        -> /functions/v1/ingest-odds (actual work)
```

**pg_cron (backup/autonomous):**
```sql
-- 20260112000015_cron_overhaul.sql:125-147
'ingest-odds-high-frequency': '* * * * *'     -- Every minute
'high-frequency-live-ingest': '* * * * *'     -- Every minute
'pregame-intel-research-cron': '*/10 * * * *' -- Every 10 minutes
```

### Rate Limiting
**Client-side:** `api/lib/rateLimit.js`
- 60 requests / 60-second sliding window per IP
- Auto-eviction of stale entries every 5 minutes

**Server-side retry:** `supabase/functions/_shared/retry.ts`
```typescript
maxAttempts: 3, baseDelayMs: 400, maxDelayMs: 8000, timeoutBudgetMs: 9000
// Retryable: 503, UNAVAILABLE, "User rate limit exceeded"
```

**Circuit breaker:** `supabase/functions/_shared/resilience.ts`
- CLOSED -> OPEN -> HALF_OPEN state machine (available but not actively used in odds path)

### Caching Layers

| Layer | TTL | Location |
|---|---|---|
| Edge Function in-memory | 1 min | `live-odds-tracker/index.ts:431` |
| HTTP Cache-Control | 30s fresh + 60s SWR | `api/live/odds/[slug].js:71` |
| Browser localStorage | 15 min fresh / 24h stale | `pregameIntelService.ts:68-74` |
| React Query staleTime | 15-30s for live data | `useEnhancedOdds.ts:63,96` |

### No External Cache
- No Redis
- No Vercel Edge Cache middleware
- No CDN-level odds caching

### GAPS — COST CONCERN
- **No Odds API quota tracking.** No `remainingRequests` header inspection.
- **Estimated cost at 1-min polling:** 1,440 calls/day x 10 leagues = **~14,400 requests/day**
- At typical Odds API pricing (~$0.0008/req): **~$11/day or $330/month** just for odds polling
- **World Cup addition** would add another sport key at 1-min polling — marginal cost increase
- **30-second polling was attempted** (`20260109000001_staggered_odds_cron.sql`) but abandoned

---

## 6. FRONTEND CONSUMPTION

**STATUS:** ✅ BUILT

### Primary Hook: `useEnhancedOdds`
**File:** `src/hooks/useEnhancedOdds.ts`

| Export | Refresh | staleTime | Purpose |
|---|---|---|---|
| `usePlayerProps()` | On-demand | 60s | Player prop markets |
| `useAlternateLines()` | On-demand | 60s | Alt spread/total lines |
| `useLineMovement()` | On-demand | 5 min | Historical odds timeline |
| `useOddsScores()` | **30s polling** | 30s | Live scores + odds |
| `useFeaturedOdds()` | **15s polling** | 15s | Featured games best lines |
| `useFindEvent()` | On-demand | 5 min | Team-name event lookup |

### Real-Time Subscriptions (Supabase Realtime)
```typescript
// useLiveGameState.ts:54-68
.channel(`live_game_state:${id}`)
.on('postgres_changes', { event: '*', table: 'live_game_state', filter: `id=eq.${id}` })

// ForecastHistoryTable.tsx:49-63
.channel(`forecast_snapshots:${matchId}`)
.on('postgres_changes', { event: 'INSERT', table: 'live_forecast_snapshots' })
```

### Adaptive Polling (MatchDetails)
```typescript
// MatchDetails.tsx:178-183
LIVE_MS: 3000,        // 3-second live game polling
PREGAME_MS: 60000,    // 60-second pre-game polling
SOCKET_FRESH_MS: 8000 // 8-second socket freshness threshold
```
Only polls when `document.visibilityState === 'visible'`.

### Odds Display Components

| Component | File | Purpose |
|---|---|---|
| `OddsCard` | `src/components/betting/OddsCard.tsx` | Main odds grid (spread/total/ML) |
| `PregameOdds` | `src/components/pregame/PregameOdds.tsx` | Pre-game lines with opening comparison |
| `OddsCell` | `src/components/betting/OddsCell.tsx` | Individual cell with flash animation |
| `LiveAnalysisCard` | `src/components/analysis/LiveAnalysisCard.tsx` | Odds anchor grid in analysis view |
| `EdgeAnalysis` | `src/components/analysis/EdgeAnalysis.tsx` | Edge display (calls `computeAISignals()`) |

### Odds Merging Service
**File:** `src/services/oddsService.ts:114-264` — `mergePremiumOdds()`
1. Fetches `market_feeds` (raw bookmaker data)
2. Fetches `opening_lines` table
3. Fetches `closing_lines` table
4. Merges via strict -> fuzzy -> canonical team matching
5. Returns enhanced Match with unified odds

### GAPS
- No `useOdds()` hook — consumers must know to use `useEnhancedOdds` sub-hooks
- Value flash animation exists (`useValueFlash.ts`) but no audio/haptic alert on big moves

---

## 7. EDGE / GAP CALCULATION

**STATUS:** ✅ BUILT (Sport-Specific Physics)

### Where Edge Is Calculated

**Server (primary):** `packages/shared/src/gameStateEngine.ts` — `computeAISignals()`
```typescript
// Line 375-380
const edgePoints = isActive && resolvedMarketTotal > 0
    ? Math.abs(fair.fair_total - resolvedMarketTotal) : 0;
```

**Live edge calculator:** `supabase/functions/live-edge-calculator/index.ts`
```typescript
// Scoring-rate approach
R_real = totalScore / elapsedMinutes           // Actual scoring rate
R_market = impliedRemaining / timeRemaining    // Market-implied rate
fairValue = totalScore + (R_real * timeRemaining)
edge = fairValue - liveTotal
```

**Client:** `src/components/analysis/EdgeAnalysis.tsx` — calls `computeAISignals()` (same function, no recalculation)

### Sport-Specific Fair Total Engines

| Sport | Engine File | Method |
|---|---|---|
| NBA/NCAAB | `engine/physics/basketball.ts` | PPP x remaining possessions, blowout/endgame scalars |
| NFL/NCAAF | `engine/physics/football.ts` | PPD x remaining drives, drive efficiency blend |
| NHL | `engine/physics/hockey.ts` | Goal-based with power play decay |
| Soccer | `engine/physics/soccer.ts` | Goal expectation model |
| MLB | `engine/physics/baseball.ts` | Run expectation model |

### Edge State Gating
```typescript
// gameStateEngine.ts:394-404
// Default thresholds:
PLAY  >= 2.0 points (NHL: 0.65, raised to 6.0 during high uncertainty)
LEAN  >= 1.0 points (raised to 3.0 during high uncertainty)
NEUTRAL < LEAN threshold
```

### Market Lean Direction
```typescript
// Only set if edge_state !== 'NEUTRAL' and not a pace hallucination
if (delta > 0.45) marketLean = 'OVER';
else if (delta < -0.45) marketLean = 'UNDER';
```

### Storage
- **Computed on render** for display (cheap, deterministic)
- **Stored to `live_edge_alerts`** only when `priceBreak.isExecutable === true` (high confidence + meets gating)

### GAPS
- Soccer physics engine exists but **not validated against World Cup match patterns** (120-min matches, penalty shootouts)
- No edge calculation for moneyline or spread markets — **totals only**
- No CLV (Closing Line Value) calculation post-game

---

## Summary Table

| Area | Status | Key Files | Critical Gap |
|---|---|---|---|
| **1. Ingestion** | ✅ BUILT | `ingest-odds/index.ts`, `get-odds/index.ts` | No `soccer_fifa_world_cup` key |
| **2. Books** | ✅ BUILT | `live-odds-tracker/index.ts:20`, `sync-player-props/index.ts:216` | No soccer player props |
| **3. Transformation** | 🔄 PARTIAL | `oddsUtils.ts`, `normalizeOdds.ts`, `soccer-odds-normalizer.ts` | **No devig. No real implied probability.** |
| **4. Storage** | ✅ BUILT | `telemetry_schema.sql`, `odds_resilience_ledger.sql` | No TTL/cleanup for append-only tables |
| **5. Refresh** | ✅ BUILT | `vercel.json`, `cron_overhaul.sql`, `rateLimit.js` | **No quota tracking. ~$330/mo cost.** |
| **6. Frontend** | ✅ BUILT | `useEnhancedOdds.ts`, `oddsService.ts`, `OddsCard.tsx` | No push alerts on big line moves |
| **7. Edge/Gap** | ✅ BUILT | `gameStateEngine.ts`, `live-edge-calculator/index.ts` | **Totals only. No spread/ML edge. No CLV.** |

---

## Files/Functions to Port for World Cup (drip-wc)

### P0 — Must Have

| Task | File to Modify | Change |
|---|---|---|
| Add `soccer_fifa_world_cup` sport key | `get-odds/index.ts:19-48` | Add to sport key mapping |
| Add World Cup to monitored leagues | `ingest-odds/index.ts` (cron payload) | Add `"soccer_fifa_world_cup"` to default leagues |
| Add World Cup to live ingestion | `ingest-live-games/index.ts:13-24` | Add `{ id: 'fifawc', sport_type: Sport.SOCCER, endpoint: 'soccer/fifa.world' }` |
| Add World Cup to ESPN sync | `espn-sync/index.ts:26-37` | Add `{ sport: 'soccer', league: 'fifa.world' }` |
| Add to `league_config` table | New migration | INSERT row with `odds_api_key = 'soccer_fifa_world_cup'` |
| Validate soccer-odds-normalizer for WC | `_shared/soccer-odds-normalizer.ts` | Test 3-way ML + handicap with WC data |

### P1 — Should Have

| Task | File to Modify | Change |
|---|---|---|
| Add `americanToImpliedProbability()` | `packages/shared/src/oddsUtils.ts` | Standard formula: `100 / (|odds| + 100)` |
| Add devig function | `packages/shared/src/oddsUtils.ts` | Shin method or multiplicative devig |
| Validate soccer physics for 120-min matches | `engine/physics/soccer.ts` | Handle extra time + penalty shootout edge cases |
| Add soccer player props | `get-odds/index.ts:51-56` | Add `player_goal_scorer`, `player_shots`, `player_assists` |
| Add capture-opening-lines for WC | `capture-opening-lines/index.ts` | Ensure WC matches captured |
| Wire WC to `live-odds-tracker` | `live-odds-tracker/index.ts` | Add to sport config array |

### P2 — Nice to Have

| Task | File to Modify | Change |
|---|---|---|
| Add Odds API quota tracking | `ingest-odds/index.ts` | Parse `x-requests-remaining` response header |
| Add TTL/partition for raw_odds_log | New migration | Partition by month or add retention policy |
| Build CLV calculator | New function | Compare `closing_lines` vs `opening_lines` per match |
| Add spread/ML edge calculation | `gameStateEngine.ts` | Extend beyond totals-only edge |
| Add line movement alerts | New component | Push notification when line moves >1pt |

---

## Rate Limit & Cost Concerns for World Cup Scale

### Current Cost Baseline
- **1-min polling x 10 leagues = ~14,400 requests/day ~ $11/day**
- **Adding 1 World Cup key = ~1,440 more requests/day ~ +$1.15/day**
- **Marginal World Cup cost: ~$35/month** (negligible)

### Risk Scenarios

| Scenario | Requests/Day | Monthly Cost | Risk |
|---|---|---|---|
| Current (10 leagues, 1-min) | 14,400 | ~$330 | Baseline |
| +World Cup (11 leagues, 1-min) | 15,840 | ~$365 | Low |
| +World Cup + 30s polling | 17,280 | ~$400 | Medium |
| +World Cup + player props (4h) | 16,200 | ~$375 | Low |
| Burst (all endpoints, peak day) | 25,000+ | ~$580 | High |

### Recommendations
1. **Parse `x-requests-remaining` header** from Odds API responses — add to ingest-odds logging
2. **Add monthly budget alarm** — if remaining < 20% of plan, reduce polling to 5-min
3. **World Cup matches only during tournament window** — gate by date range to avoid wasting calls
4. **Cache player props aggressively** — 4h refresh is fine for pre-game props
5. **Consider Odds API "usage" endpoint** for daily cost dashboards
