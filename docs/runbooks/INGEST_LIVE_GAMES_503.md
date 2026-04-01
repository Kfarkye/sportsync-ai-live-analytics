# Runbook: `ingest-live-games` returning 503

## Symptoms
- Cron runs but returns 5xx.
- `live_game_state` freshness drifts rapidly.
- Match list shows stale statuses.

## Immediate triage
1. Confirm function deployment version:
   - `supabase functions list`
   - `supabase functions download ingest-live-games` (or fetch source via dashboard)
2. Check invocation logs in Supabase Edge Functions.
3. Verify cron command URL and auth header are valid.

## Fast checks
- Confirm `verify_jwt` setting matches caller type (cron/internal vs external).
- Confirm no boot-time import crash in shared modules.
- Confirm function timeout is sufficient for batch size.

## Recovery steps
1. Reduce invocation load:
   - league-scoped cron jobs
   - lower `max_games` temporarily
2. Redeploy known-good function version.
3. Run one controlled dry invocation:
   - `league=nba,nhl&max_games=5&dry=true`
4. Re-enable cron only after successful controlled run.

## Validation queries
- Recent cron outcomes and return messages.
- `live_game_state` max `updated_at` by league.
- Spot-check active matches now show in-progress status.

## Rollback
- Revert function to previous stable commit.
- Restore previous cron cadence and batch sizing.

## Post-incident follow-up
- Capture root cause (boot crash vs payload parsing vs auth).
- Add guard/monitor to detect same class of failure.
- Update this runbook with exact fix details.
