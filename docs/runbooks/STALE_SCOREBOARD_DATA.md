# Runbook: Scoreboard shows stale or wrong game status

## Symptoms
- List view shows `scheduled` while match detail shows `final` or live.
- `Last updated` in UI is old.
- Recent backfill rows exist but UI has not reflected them.

## Immediate triage
1. Confirm database freshness:
   - `max(updated_at)` for affected league in `live_game_state`.
2. Confirm ingest cron currently active and successful.
3. Confirm frontend query source/table for that screen.

## Likely causes
- Ingest lag or failed cron runs.
- UI reading cached stale data window.
- League not included in cron schedule.
- Date-window mismatch (UTC vs local day boundary).

## Recovery steps
1. Trigger one manual league ingest run.
2. If stale is historical, run one targeted backfill.
3. Refresh materialized views if reports/edge pages depend on them.
4. Bust app query cache and force fresh read for affected route.

## UX guardrails
- Show a stale badge when data age > 10 minutes.
- Show explicit last updated time.
- Avoid silently presenting stale state as real-time.

## Validation
- Compare list vs detail on 3 affected games.
- Confirm status and score consistency.
- Confirm stale badge clears after fresh ingest.

## Post-incident follow-up
- Add or tune alert for freshness drift.
- Update cron coverage (league and cadence).
- Document time-zone window assumptions.
