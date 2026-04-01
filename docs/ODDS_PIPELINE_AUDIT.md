# Odds Pipeline Audit

**Date**: 2026-02-16
**Scope**: Full ingestion-to-delivery audit of the odds pipeline
**Standard**: Stripe execution, Netflix reliability, Cloudflare edge, Apple interaction

---

## Architecture Summary

```
Ingestion (1-2 min cron) --> Processing (normalize) --> Storage (Supabase) --> Delivery (client)
     |                             |                         |                      |
  ingest-odds              oddsUtils.ts              market_feeds            oddsService.ts
  live-odds-tracker     soccer-normalizer            matches table        /api/live/odds/[slug]
  capture-opening-lines  normalizeOdds.ts         opening_lines           useEnhancedOdds hooks
                                                  closing_lines           get-odds edge function
                                                  live_odds_snapshots
```

---

## CRITICAL FINDINGS (P0)

### 1. `is_live` is ALWAYS `true` on market_feeds upserts

**File**: `supabase/functions/ingest-odds/index.ts:139`
**File**: `supabase/functions/live-odds-tracker/index.ts:456`

Both ingestion paths hardcode `is_live: true` when writing to `market_feeds`:

```typescript
// ingest-odds/index.ts:139
is_live: true, // BUG: should check if event.commence_time < now
```

```typescript
// live-odds-tracker/index.ts:456
is_live: true, // BUG: should check isLive status from ESPN
```

**Impact**: Every event in `market_feeds` is marked live regardless of actual state. The `is_live` column is meaningless. Any downstream consumer filtering by `is_live` will get pre-game events too. The `oddsService.ts` client passes `_isLive` to set provider label as "Live" vs "Consensus" - this means pre-game odds can be incorrectly tagged as "Live" in the UI.

**Fix**: Set `is_live` based on actual event state: `is_live: new Date(event.commence_time) < new Date()` for ingest-odds, or derive from ESPN status for live-odds-tracker.

---

### 2. Fatal errors return HTTP 200

**File**: `supabase/functions/ingest-odds/index.ts:174`

```typescript
} catch (e: any) {
    return new Response(JSON.stringify({
        error: e.message,
        debug,
        stack: e.stack
    }), {
        status: 200, // <-- FATAL: masks all crashes from monitoring
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
}
```

**Impact**: Any monitoring, alerting, or pg_cron health check that relies on HTTP status codes will never detect a total ingestion failure. The entire pipeline could be broken and return 200. Stack traces are also leaked to the caller.

**Fix**: Return `status: 500`. Remove `stack` from production responses.

---

### 3. Hardcoded cron secret in source code

**File**: `supabase/functions/ingest-odds/index.ts:50`

```typescript
const cronSecret = Deno.env.get('CRON_SECRET') || "XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ"
```

**Impact**: The secret is committed to the repo. If `CRON_SECRET` env var is not set, anyone with this constant can trigger the ingestion endpoint. The `timingSafeEqual` check on line 69 is properly constant-time, but the default value negates the security.

**Fix**: Remove the hardcoded fallback. If `CRON_SECRET` is not set, reject all cron-secret auth attempts.

---

### 4. `calculateAnchorLines` picks "most recent" bookmaker, not "best line"

**File**: `supabase/functions/ingest-odds/index.ts:456-503`

```typescript
if (bookTs > timestamps[type]) {
    timestamps[type] = bookTs
    // ... replaces best line with this bookmaker's line
```

Despite the function name "anchor lines", it selects the bookmaker with the **most recent `last_update`** timestamp, not the sharpest or best-priced line. This is a selection strategy that could pick a slow-updating, wide-juice book over Pinnacle.

**Impact**: The "consensus" line displayed to users may be from a secondary bookmaker (e.g., BetRivers) that updated 1 second after Pinnacle, rather than the sharpest market line.

**Fix**: Either rename to `calculateMostRecentLines()` for honesty, or implement a proper anchor strategy: prefer sharp books (Pinnacle > Circa > Bookmaker) by priority, falling back to most recent.

**Contrast**: `live-odds-tracker/index.ts:500-504` uses a prioritized book list (`preferredBooks`), which is the correct approach but only for its own extraction path. The two ingestion paths use different selection strategies.

---

### 5. `awaySpread` assigned `home.point` instead of `away.point` in oddsService

**File**: `src/services/oddsService.ts:243`

```typescript
homeSpread: feed._bestSpread?.home?.point,
awaySpread: feed._bestSpread?.home?.point, // BUG: should be away?.point
```

Both `homeSpread` and `awaySpread` are set to the home team's spread point.

**Impact**: The away spread is wrong for every match enriched through this path. The `normalizeEnhancedOdds` call on line 239 will propagate this into `match.odds`, so the client-side display of the away spread will show the home spread value.

**Fix**: `awaySpread: feed._bestSpread?.away?.point`

---

### 6. `normalizeOpeningLines` filters out moneylines <= 101

**File**: `packages/shared/src/oddsUtils.ts:229-233`

```typescript
const isExtremeML = (ml: number | undefined) => {
    if (ml === undefined) return true;
    const absVal = Math.abs(ml);
    return absVal >= 4000 || absVal <= 101;
};
```

The `<= 101` filter discards moneylines like -101, +101, -100, EVEN. These are perfectly valid, common lines in close matchups.

**Impact**: Any matchup priced near even money (common in NFL, NCAAF, soccer) will have its opening moneylines silently dropped. The user sees no moneyline for the opener despite one existing.

**Fix**: Remove the `<= 101` lower bound, or set it to something meaningful like `<= 50` (no real American odds exist below +/- 100 except EVEN).

---

## HIGH FINDINGS (P1)

### 7. Two ingestion paths with divergent logic

**Files**: `supabase/functions/ingest-odds/index.ts` and `supabase/functions/live-odds-tracker/index.ts`

These two edge functions both write to `matches.current_odds` and `market_feeds`, but use entirely different:
- Team matching: trigram similarity + entity_mappings vs. Dice coefficient + hardcoded aliases
- Line extraction: `calculateAnchorLines` (most-recent book) vs. `extractOdds` (preferred-book ranking)
- Identity resolution: 4-step cascade (entity_mappings -> registry -> fuzzy -> trigram) vs. inline `getSimilarity > 0.6`
- Closing line capture: `ingest-odds` does NOT capture closing lines; `live-odds-tracker` does

**Impact**: The same match can receive different odds values depending on which cron fires last. Race conditions between the two writers are mitigated only by a 30-second throttle in `ingest-odds` (line 423), but `live-odds-tracker` has no such guard. Last-writer-wins semantics on `matches.current_odds`.

**Recommendation**: Consolidate into a single ingestion path, or establish clear ownership (e.g., `ingest-odds` for pre-game, `live-odds-tracker` for live-only).

---

### 8. `fmt()` decimal-to-American conversion is wrong for negative American odds

**File**: `supabase/functions/live-odds-tracker/index.ts:574-578`

```typescript
function fmt(p: number | undefined) {
    if (p === undefined || p === null) return null
    if (Math.abs(p) >= 100) return p > 0 ? `+${Math.round(p)}` : `${Math.round(p)}`
    return p >= 2.0 ? `+${Math.round((p - 1) * 100)}` : `${Math.round(-100 / (p - 1))}`
}
```

When `p` is between -100 and +100 (e.g., `-110` as a raw price from a misparse), the first condition `Math.abs(p) >= 100` catches it and formats directly. But if `p` is a decimal odds value like `1.5`, it falls to the second branch: `Math.round(-100 / (1.5 - 1))` = `-200`. That's correct.

However, `p = 1.0` yields division by zero (`-100 / 0`), and `p < 1.0` yields positive values from the negative branch. The Odds API sends American format (`oddsFormat=american`) so prices should already be American. The decimal conversion code is dead code that could produce wrong results if triggered.

**Fix**: Since the API is called with `oddsFormat=american`, the decimal conversion branch should never trigger. Add a guard: `if (p > 1 && p < 100)` for the decimal path.

---

### 9. Opening lines use ESPN raw event IDs, not canonical match IDs

**File**: `supabase/functions/capture-opening-lines/index.ts:419`

```typescript
return {
    match_id: event.id, // Raw ESPN ID like "401810427", NOT "401810427_nba"
    ...
}
```

But in `oddsService.ts:151`, opening lines are queried using the match's `id` field, which IS canonical (e.g., `401810427_nba`).

```typescript
const openingPromise = Promise.all(matchesChunks.map(chunk =>
    supabase.from('opening_lines').select('*').in('match_id', chunk.map(m => m.id))
));
```

**Impact**: Opening lines will never match their parent match in the client merge. The `match_id` in `opening_lines` is `401810427` but the lookup uses `401810427_nba`. All CLV tracking based on opening lines is broken.

**Note**: The `extractMatch` function on line 299 DOES canonicalize the ID for the `matches` upsert, but `extractOpeningLine` on line 341 uses `event.id` directly.

**Fix**: Use the canonicalized ID in `extractOpeningLine`: `match_id: finalId` (from `extractMatch`).

---

### 10. Live soccer spread correction has directional ambiguity

**File**: `packages/shared/src/oddsUtils.ts:374-388`

```typescript
if (match.sport === Sport.SOCCER && isLive && spreadRes[0] !== null) {
    const scoreDiff = aScore - hScore;
    if (Math.abs(scoreDiff) > 0) {
        if (Math.abs(spreadRes[0]) < Math.abs(scoreDiff)) {
            spreadRes[0] = spreadRes[0] + scoreDiff;
            if (spreadRes[1] !== null) spreadRes[1] = spreadRes[1] - scoreDiff;
        }
    }
}
```

The heuristic assumes: if `|line| < |scoreDiff|`, it's a Rest-of-Game line and needs score adjustment. But:
- `scoreDiff = aScore - hScore` (away minus home) is added to the HOME spread
- If home is winning 2-0, `scoreDiff = -2`, so `homeSpread = line + (-2)`. If the REST OF GAME line is `+0.5`, the "full game" line becomes `-1.5`. This is correct.
- But if the REST OF GAME line is `-0.5` (home still favored for remaining time), `|-0.5| < |2|` triggers, producing `-0.5 + (-2) = -2.5`. This is also correct.
- However, when the score is tight (e.g., 1-0) and the line is small (e.g., home at -0.25 REST), `|-0.25| < |1|` triggers. The "corrected" full-game line becomes `-0.25 + (-1) = -1.25`. But if the API was actually sending the FULL GAME line of -0.25 (common for in-play Asian handicaps), this correction would be wrong.

**Impact**: No way to distinguish REST OF GAME from FULL GAME lines without metadata from the API. The heuristic will sometimes over-correct tight soccer games.

**Recommendation**: Log this correction with the raw and adjusted values. The Odds API `h2h` market is always full-game; the `spreads` market can vary. Document the assumption.

---

### 11. `useLineMovement` fires N sequential API calls

**File**: `src/hooks/useEnhancedOdds.ts:126-161`

```typescript
for (let i = hoursBack; i >= 0; i -= 6) {
    const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);
    const { data, error } = await supabase.functions.invoke('get-odds', {
        body: { action: 'historical', sport: ..., date: timestamp.toISOString() }
    });
}
```

With `hoursBack = 24`, this fires 5 sequential edge function invocations, each calling The Odds API historical endpoint. Sequential, not parallel.

**Impact**: 5 API calls in series = 5x latency for the user. Each historical call also costs Odds API quota. If the user views 10 games, that's 50 API calls just for line movement.

**Fix**: Use `Promise.all()` to parallelize. Better yet, pre-compute movement from `live_odds_snapshots` table data.

---

### 12. `normalizeTeam` strips "inter", "real", "united", "city" as noise words

**File**: `supabase/functions/_shared/match-registry.ts:191`

```typescript
clean = clean.replace(/\b(the|fc|afc|sc|club|cf|united|city|real|inter|ac)\b/g, '');
```

**Impact**: "Inter Milan" normalizes by first resolving the alias to "inter" (`TEAM_ALIASES` on line 122-123), then the noise-word strip removes "inter" entirely, leaving an empty string that becomes "unknown". Similarly, "Real Madrid" becomes "madrid", but "Real Sociedad" also becomes "sociedad" which is correct but fragile.

The alias `'monza': 'ac monza'` on line 141 expands "monza" to "ac monza", but then the noise-word strip removes "ac", giving back "monza". This is a no-op alias.

**Fix**: Move the noise-word strip BEFORE the alias lookup, or remove "inter" and "real" from the noise list and handle them in the alias table.

---

## MEDIUM FINDINGS (P2)

### 13. No rate limiting on The Odds API calls

Neither `ingest-odds` nor `live-odds-tracker` tracks remaining API quota from response headers (`x-requests-remaining`, `x-requests-used`). With 14 leagues in `live-odds-tracker` and an unknown number in `ingest-odds`, each running every 1-2 minutes, the monthly quota burn is:

```
ingest-odds: ~N leagues/min * 1440 min/day * 30 days
live-odds-tracker: ~14 leagues/2min * 720 cycles/day * 30 days = ~302,400 calls/month
```

**Recommendation**: Read `x-requests-remaining` from response headers and pause ingestion if below threshold.

---

### 14. `capture-opening-lines` scans 10 days x 18 leagues = 180+ ESPN API calls per invocation

Each invocation walks `generateDateRange(10)` for all `MONITORED_LEAGUES`. That's 10 * 18 = 180 HTTP requests to ESPN per cron trigger, plus individual DB operations per event.

**Impact**: Slow execution, ESPN rate-limit risk, unnecessary re-scanning of dates already processed.

**Recommendation**: Track the last-scanned date per league and only scan forward from there.

---

### 15. `oddsService.ts` memory cache is process-level and never invalidated

**File**: `src/services/oddsService.ts:26-28`

```typescript
const MEMORY_CACHE = {
  feeds: null as { data: MarketFeed[], timestamp: number } | null,
  processed: new Map<string, { data: Match, timestamp: number }>()
};
```

The `processed` map grows without bound. In a long-lived Vercel Edge Function or a persistent browser tab, this leaks memory. The 30-second TTL prevents stale reads but not unbounded growth.

**Fix**: Add a max-size eviction policy or use an LRU cache.

---

### 16. `live-odds-tracker` module-level `supabase` variable and `oddsCache`

**File**: `supabase/functions/live-odds-tracker/index.ts:172-173`

```typescript
let supabase: any;
const oddsCache = new Map<string, { data: any[], fetchedAt: number }>();
```

These are module-level in a Deno edge function. Supabase edge functions can be kept warm across invocations. The `oddsCache` persists between invocations and is never explicitly cleared (only per-key TTL of 60s). If the function stays warm for minutes, old cached odds from a previous cycle can be served to new invocations that start within the 60s window.

**Fix**: Reset `oddsCache` at the start of each invocation, or move it inside the handler.

---

### 17. Spread fallback in `calculateAnchorLines` ignores team identity for non-soccer

**File**: `supabase/functions/ingest-odds/index.ts:488-491`

```typescript
if (!resolvedHome && !resolvedAway && market.outcomes.length === 2 && !sport.includes('soccer')) {
    resolvedHome = market.outcomes[0];
    resolvedAway = market.outcomes[1];
}
```

When name matching fails for both teams, the function assumes the first outcome is home and second is away. But The Odds API doesn't guarantee outcome ordering.

**Impact**: 50% chance of assigning the spread to the wrong team when name matching fails.

**Fix**: Log when this fallback triggers. Better: check if `outcome.name` contains any substring of the home/away team name before position-based assignment.

---

### 18. `get-odds` edge function has no authentication

**File**: `supabase/functions/get-odds/index.ts`

The function handles CORS preflight but performs no authentication check. Any caller with the Supabase anon key (public) can invoke any action including `player_props`, `alternate_lines`, `historical`, etc.

**Impact**: Public users can burn The Odds API quota by calling expensive endpoints directly. Each `player_props` or `historical` call consumes paid API quota.

**Fix**: Add auth check (require authenticated Supabase user) for quota-heavy actions, or implement per-user rate limiting.

---

### 19. `live_odds_snapshots` table grows unbounded

The `live-odds-tracker` inserts a snapshot every 2 minutes for every live game, with no cleanup. For a busy sports day with 30 live games, that's 30 * 30 cycles/hour * 5 hours = 4,500 rows per day. Over a season, this table can grow to millions of rows.

**Recommendation**: Add a retention policy (e.g., keep 30 days, aggregate older data).

---

## LOW FINDINGS (P3)

### 20. Debug logging in production

- `ingest-odds/index.ts:465`: NBA-specific debug log fires for every NBA event on every cron cycle
- `match-registry.ts:288-406`: Extensive `resolveCanonicalMatch` comparison logs for every resolution attempt
- `ingest-odds/index.ts:382-390`: Live soccer raw trace for every live soccer match
- `ingest-odds/index.ts:85-86`: `debug_relation_matches` RPC called on every invocation

**Impact**: Log volume and noise. The `debug_relation_matches` RPC on every invocation adds an unnecessary DB round-trip.

---

### 21. `getOddsValue` strips total prefixes but not spread prefixes correctly

**File**: `packages/shared/src/oddsUtils.ts:116`

```typescript
.replace(/^(O|U|OVER|UNDER)\s*/i, '')  // Strip Total prefixes
```

This only strips Over/Under prefixes. If a spread comes in as "HOM -3.5" or "H -3.5" (some providers), it won't be cleaned. The function handles team abbreviations on line 109-111 but only for multi-word strings.

---

### 22. `chooseBetterOdds` uses `updated_at` for recency but doesn't validate timezone

**File**: `src/lib/odds/normalizeOdds.ts:134-135`

```typescript
const prevT = prev.updated_at ? Date.parse(prev.updated_at) : 0;
const nextT = next.updated_at ? Date.parse(next.updated_at) : 0;
```

If `updated_at` strings are in different timezone formats (ISO vs. local), `Date.parse` could produce incorrect comparisons.

---

### 23. Tennis odds key mapping is hardcoded to tournaments

**File**: `supabase/functions/get-odds/index.ts:46-47`

```typescript
'tennis_atp': 'tennis_atp_us_open',
'tennis_wta': 'tennis_wta_us_open',
```

These map to US Open specifically. During other tournaments (Australian Open, French Open, Wimbledon), the tennis odds will be fetched for the wrong event or return empty.

**Fix**: Make tournament-aware, or use the Odds API's sport listing endpoint to discover active tennis tournaments.

---

### 24. `analyzeMoneyline` favorite detection is simplified

**File**: `packages/shared/src/oddsUtils.ts:558-563`

```typescript
if (source.homeML < source.awayML) fav = 'home';
```

This works for standard American odds (e.g., -150 < +130 = home is fav). But if both are negative (both favorites is impossible, but if data is dirty), or both are positive (e.g., +105 vs +110), the comparison still works but may not match user expectations for near-even markets.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| P0 (Critical) | 6 | is_live always true, 200 on fatal, leaked secret, wrong awaySpread, broken opening line join, ML filter too aggressive |
| P1 (High) | 6 | Divergent ingestion paths, incorrect decimal conversion, soccer spread correction, sequential API calls, normalizeTeam strips real teams |
| P2 (Medium) | 7 | No API quota tracking, memory leaks, no auth on get-odds, unbounded snapshots, position-based spread fallback |
| P3 (Low) | 5 | Debug logging, timezone handling, hardcoded tournaments, simplified favorite detection |

**Highest-impact fixes** (speed-ordered for execution):
1. Fix `awaySpread` assignment in `oddsService.ts` (1 line)
2. Remove hardcoded cron secret (1 line)
3. Return 500 on fatal errors in `ingest-odds` (1 line)
4. Fix `is_live` flag in both ingestion paths (2 lines)
5. Fix opening lines `match_id` to use canonical ID (1 line)
6. Fix `isExtremeML` lower bound (1 line)
