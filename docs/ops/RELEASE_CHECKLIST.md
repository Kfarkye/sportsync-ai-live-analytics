# Release Checklist

Use this for any production-impacting release.

## Pre-merge
- [ ] PR has clear rollback note.
- [ ] CI checks green (`lint`, `typecheck`, `build`).
- [ ] Migration changes validated (`check:migrations`).
- [ ] Runtime-critical files reviewed by owner.

## Pre-deploy
- [ ] Feature flags set for risky behavior changes.
- [ ] Environment variables verified in target environment.
- [ ] Dashboard/alerts open for live monitoring.

## Deploy
- [ ] Deploy staging first (if available).
- [ ] Run smoke checks:
  - live feed loads
  - match detail loads
  - ingest function invocation succeeds
- [ ] Deploy production.

## Post-deploy (first 30 minutes)
- [ ] Watch ingest success rate and freshness.
- [ ] Watch JS runtime errors and edge function 5xx.
- [ ] Validate one match per active league.

## Rollback trigger conditions
- [ ] sustained ingest 5xx
- [ ] freshness SLO breach
- [ ] critical UI rendering failure

If rollback is triggered, revert to last known-good commit and re-run smoke checks.
