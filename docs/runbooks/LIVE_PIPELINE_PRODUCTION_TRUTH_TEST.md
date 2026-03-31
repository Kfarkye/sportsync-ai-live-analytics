# Live Pipeline Production Truth Test

## Purpose
This runbook turns the live-path validation into one repeatable production check instead of a loose set of spot checks.

The SQL pack lives at:

- [live_pipeline_production_truth_pack.sql](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/supabase/sql/live_pipeline_production_truth_pack.sql)

## When To Run It
Run the pack:

1. right after deploy
2. once during the live slate
3. once 30-45 minutes after the main games finish

## What It Tests
The pack covers the six things that matter:

1. cron wiring
2. runtime freshness and latest core run health
3. league SLO breach state
4. final-game leakage
5. active-game leakage
6. joined market/state drift

## How To Use It
Open the Supabase SQL editor and run the full pack top to bottom.

The sections are ordered for operational flow:

1. threshold ledger
2. current config
3. cron baseline diff
4. runtime freshness
5. active SLO state
6. finals older than 30 minutes that are not clean
7. in-progress leakage
8. join drift
9. unified alert deck

## Severity Rules
Use these rules exactly:

- `P1`: page-worthy, production truth is broken
- `P2`: investigate during the slate, but not necessarily page immediately
- `P3`: watch item, not currently used in the pack

## Binary Success Criteria
Tonight is a pass if all of these are true:

1. no `P1` rows in the unified alert deck
2. no final games older than 30 minutes remain non-`OK`
3. no active league in `vw_live_pipeline_slo_current` is in breach
4. `ingest-live-games`, `history-janitor`, and rolling closure are all fresh and their latest core runs are not failed
5. cron jobs match the expected baseline

## Binary Failure Criteria
Tonight is a fail if any of these happen:

1. a required cron job is missing, inactive, or drifted
2. `ingest-live-games` goes stale or its latest run fails
3. `history-janitor` or rolling closure goes stale
4. a final game sits dirty more than 30 minutes after its match row was last touched
5. any active league remains in SLO breach
6. join drift crosses the paging threshold

## Important Implementation Detail
The repo does not currently expose a dedicated `finalized_at` on the live coverage view.

Because of that, the pack uses:

- the latest of `matches.updated_at` and `matches.last_updated`

as the production proxy for the “final older than 30 minutes” test.

That is honest enough for operations, but it is still a proxy. If we later add a true finalized timestamp to the coverage surface, this check should be upgraded.

The final/leakage checks are also intentionally scoped to:

- active, SLO-enforced leagues

so unsupported or intentionally exempt leagues do not create false red rows in the alert deck.

## Expected Cron Baseline
These are the pinned expectations baked into the SQL pack:

| Job | Expected schedule | Severity |
|---|---|---|
| `high-frequency-live-ingest` | every minute | `P1` |
| `live-history-janitor-every-10-min` | every 10 minutes | `P1` |
| `live-rolling-historical-closure-every-20-min` | every 20 minutes | `P1` |
| `drain-espn-probs` | every 2 minutes | `P2` |

## Runtime Freshness Thresholds
These are also encoded directly in the pack:

| Runtime | Freshness requirement | Severity |
|---|---|---|
| `ingest-live-games` | last run within 5 minutes | `P1` |
| `history-janitor` | last run within 20 minutes | `P1` |
| `backfill-historical-live-odds:rolling_historical_closure` | last run within 40 minutes | `P1` |

## Join Drift Thresholds
These thresholds are encoded in the pack:

| Degraded join % over last 2h | Severity |
|---|---|
| `>= 20%` | `P1` |
| `>= 10% and < 20%` | `P2` |

## What To Do If It Fails
If the pack returns `P1` rows:

1. fix cron or function health first
2. rerun the pack
3. inspect final dirty rows and active leakage rows directly
4. do not treat the live-path layer as trusted until the `P1` deck is empty

If the pack returns only `P2` rows:

1. stay on the slate
2. inspect the detailed sections below the alert deck
3. confirm whether the issue clears on the next cadence

## Why This Runbook Exists
The purpose is not to create more process.

It is to answer one operational question cleanly:

- can we trust tonight’s live-path collection layer, yes or no?
