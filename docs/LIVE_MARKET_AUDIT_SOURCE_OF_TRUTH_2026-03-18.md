# Live Market Audit Source Of Truth

Audit timestamp: `2026-03-18 05:36 UTC`

Purpose: preserve the corrected internal truth version of the March 18 live-market audit, with rerunnable checks and short interpretations.

Project: `qffzvrnbzabcokqqrwbv`

How to rerun SQL:
- Preferred: run these statements in `psql` against the project database.
- Fallback: use the remote `sql-executor-temp` function if direct SQL access is not available.
- Runtime checks that are not stored in Postgres are called out as `CLI` checks instead of `SQL`.

## Confirmed

### Confluence experiment is live and reproducible
Result:
- `CONFLUENCE_STRONG`: `14/14`
- `CONFLUENCE_LEAN`: `7/8`
- `CONFLICT`: `2/7`
- Confluence total: `21/22`
- Clean confluence after circularity removal: `19/20`

SQL:
```sql
select
  confluence_tier,
  count(*)::int as games,
  count(*) filter (where signal_correct is true)::int as correct,
  count(*) filter (where signal_correct is false)::int as wrong
from public.confluence_signals
group by confluence_tier
order by confluence_tier;
```

Interpretation:
- The live experiment table matches the corrected audit exactly.

### Circularity count is real, but one match ID was previously wrong
Result:
- Circular confluence games: `2`
- Correct live IDs: `401810817_nba`, `401810822_nba`
- Clean confluence result: `19/20`

SQL:
```sql
select
  c.match_id,
  c.confluence_tier,
  c.signal_correct,
  (v.live_signals->>'market_total')::numeric as signal_market_total,
  v.pinnacle_total,
  v.market_total as view_market_total
from public.confluence_signals c
join public.v_ai_match_context v
  on v.match_id = c.match_id
where c.confluence_tier in ('CONFLUENCE_STRONG', 'CONFLUENCE_LEAN')
  and (v.live_signals->>'market_total') is not null
  and (v.live_signals->>'market_total')::numeric = v.pinnacle_total
  and (v.market_total is null or v.market_total <> v.pinnacle_total)
order by c.match_id;
```

SQL:
```sql
with circular as (
  select c.match_id
  from public.confluence_signals c
  join public.v_ai_match_context v
    on v.match_id = c.match_id
  where c.confluence_tier in ('CONFLUENCE_STRONG', 'CONFLUENCE_LEAN')
    and (v.live_signals->>'market_total') is not null
    and (v.live_signals->>'market_total')::numeric = v.pinnacle_total
    and (v.market_total is null or v.market_total <> v.pinnacle_total)
)
select
  count(*)::int as games,
  count(*) filter (where c.signal_correct is true)::int as correct,
  count(*) filter (where c.signal_correct is false)::int as wrong
from public.confluence_signals c
where c.confluence_tier in ('CONFLUENCE_STRONG', 'CONFLUENCE_LEAN')
  and c.match_id not in (select match_id from circular);
```

Interpretation:
- The circularity claim survives, but the corrected second ID is `401810822_nba`, not `401810804_nba`.

### Market passthrough cutover is real
Result:
- Last non-passthrough row: `2026-03-18T04:50:00.177999Z`
- First passthrough row: `2026-03-18T04:52:00.208754Z`
- No non-passthrough rows appear after cutover

SQL:
```sql
select
  count(*)::int as total_rows,
  count(*) filter (where drivers ? 'source:market_passthrough')::int as passthrough_rows,
  count(*) filter (where not (drivers ? 'source:market_passthrough'))::int as non_passthrough_rows,
  max(created_at) filter (where not (drivers ? 'source:market_passthrough')) as last_non_passthrough_at,
  min(created_at) filter (where drivers ? 'source:market_passthrough') as first_passthrough_at
from public.live_signal_snapshots;
```

SQL:
```sql
select
  count(*)::int as rows_after_cutover,
  count(*) filter (where drivers ? 'source:market_passthrough')::int as passthrough_after_cutover,
  count(*) filter (where not (drivers ? 'source:market_passthrough'))::int as non_passthrough_after_cutover
from public.live_signal_snapshots
where created_at >= '2026-03-18T04:52:00Z'::timestamptz;
```

Interpretation:
- The exact count moved as new rows landed, but the structural cutover is clean.

### `v_ai_match_context` includes the Pinnacle context columns
Result:
- Present: `pinnacle_total`, `pinnacle_over_price`, `pinnacle_under_price`, `pinnacle_captured_at`, `pinnacle_dk_gap`, `has_pinnacle`

SQL:
```sql
select
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'v_ai_match_context'
  and column_name in (
    'pinnacle_total',
    'pinnacle_over_price',
    'pinnacle_under_price',
    'pinnacle_captured_at',
    'pinnacle_dk_gap',
    'has_pinnacle'
  )
order by column_name;
```

Interpretation:
- The product view really does expose the Pinnacle comparison fields live.

### “Institutional” masking is real
Result:
- `resolve_market_feed` returns best-price market-feed payload
- `ingest-live-games` hardcodes `provider: 'Institutional'`
- Live `market_feeds` shows rotating underlying books by sport

SQL:
```sql
select
  sport_key,
  coalesce(
    best_total->'over'->>'bookmaker',
    best_total->>'bookmaker',
    best_h2h->'home'->>'bookmaker',
    best_h2h->>'bookmaker'
  ) as bookmaker,
  count(*)::int as rows
from public.market_feeds
where sport_key in (
  'basketball_nba',
  'basketball_ncaab',
  'icehockey_nhl',
  'soccer_epl',
  'soccer_uefa_champs_league',
  'soccer_italy_serie_a'
)
group by 1, 2
order by sport_key, rows desc;
```

Code checks:
- Resolver reads `best_total`, `best_spread`, and `best_h2h` in [20260107001000_sre_odds_resilience.sql](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/supabase/migrations/20260107001000_sre_odds_resilience.sql#L28).
- Ingest hardcodes `provider: 'Institutional'` in [ingest-live-games/index.ts](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/supabase/functions/ingest-live-games/index.ts#L921).

Interpretation:
- “Institutional” is a label, not a stable bookmaker identity.

## Corrected

### Earlier passthrough counts were stale, not wrong in structure
Corrected statement:
- The cutover happened cleanly, but the row count changed as live rows continued to arrive.

SQL:
```sql
select
  count(*)::int as total_rows,
  count(*) filter (where model_source = 'deterministic_signals_v1')::int as deterministic_rows,
  count(*) filter (where signal_hit is null)::int as ungraded_rows,
  min(created_at) as min_created_at,
  max(created_at) as max_created_at
from public.live_signal_snapshots;
```

Interpretation:
- The table is still moving, so absolute counts from an earlier minute should be treated as snapshots, not fixed truths.

### The `market_total` NULL bug is real, but the broad cross-sport version is not reproducible
Corrected statement:
- The strongest confirmed bug is narrower: `market_total` is null in the probability-bearing basketball backfill path inside `espn_enrichment`.

SQL:
```sql
select
  sport,
  count(*)::int as rows,
  count(*) filter (where market_total is not null)::int as market_total_present,
  count(*) filter (where market_total is null)::int as market_total_null,
  count(*) filter (
    where espn_win_prob->>'home' is not null
  )::int as espn_home_present
from public.espn_enrichment
where probabilities_raw is not null
  and probabilities_raw::text <> '{}'
group by sport
order by sport;
```

Code check:
- `market_total` is populated in the backfill worker upsert payload in [backfill-endpoint-worker/index.ts](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/supabase/functions/backfill-endpoint-worker/index.ts#L689).

Interpretation:
- The confirmed issue is in the basketball probability/backfill path, not yet a clean all-sports `market_total` failure story.

## Unconfirmed

### Pinnacle directional-accuracy table is not live-verified from this project
Current state:
- The earlier percentages should be treated as unsupported until rebuilt from live-accessible tables.

SQL:
```sql
select to_regclass('public.pinnacle_divergence_signals') as table_name;
```

SQL:
```sql
select
  proname
from pg_proc
where proname in (
  'get_pinnacle_divergence_accuracy',
  'get_pinnacle_divergence_context'
)
order by proname;
```

Interpretation:
- The expected table and helper RPCs are not present in the live project state that was audited, so the reported accuracy table is not audit-grade yet.

### `live-edge-calculator` is still deployed, but writer attribution is not proven
Current state:
- Deployment is confirmed
- Writer attribution into `live_signal_snapshots` is not

CLI check:
```bash
supabase functions list --project-ref qffzvrnbzabcokqqrwbv
```

Expected runtime fact:
- `live-edge-calculator` appears as `ACTIVE`, version `85`

SQL:
```sql
select
  jobid::text as jobid,
  jobname,
  schedule,
  active,
  command
from cron.job
where position('live-edge' in jobname) > 0
   or position('live-edge-calculator' in command) > 0
order by jobid;
```

CLI/code check:
```bash
supabase functions download live-edge-calculator --project-ref qffzvrnbzabcokqqrwbv --workdir /tmp/live-edge-calculator-remote
rg -n "live_edge_alerts|live_signal_snapshots" /tmp/live-edge-calculator-remote/supabase/functions/live-edge-calculator/index.ts
```

Interpretation:
- The function still exists remotely, but the audited runtime evidence does not prove it is the current `live_signal_snapshots` writer.

## Rebuild Targets

### Writer provenance for `live_signal_snapshots`
Needed:
- Function logs or row-level provenance metadata

### Live-table replacement for the Pinnacle directional study
Needed:
- A verified table or a rebuilt report from live-accessible sources only

### Path-level `market_total` null reconciliation
Needed:
- A side-by-side check across `live_signal_snapshots`, `espn_enrichment`, and the backfill worker path

## Working Rule

Use this memo as the internal source of truth for the March 18 live-market audit.

Do not cite the older blended report without applying these corrections first.
