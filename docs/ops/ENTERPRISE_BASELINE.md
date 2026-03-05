# Enterprise Engineering Baseline

This repo now treats reliability, security, and delivery as first-class features.

## 1) Environment Strategy
- `dev`: fast iteration, non-critical data.
- `staging`: production-like validation, release candidate verification.
- `prod`: protected, audited, rollback-ready.

Required:
- Separate Supabase projects and Vercel projects for each environment.
- No shared secrets across environments.
- Rotation cadence for service keys and external API tokens.

## 2) Release Discipline
- Trunk-based development with short-lived feature branches.
- No direct pushes to `main` for risky runtime changes.
- Mandatory PR checks:
  - `ci` workflow (lint, typecheck, build)
  - `migration-guard` (when migrations change)
- Runtime-critical paths are ownership-scoped through `CODEOWNERS`.

## 3) Runtime Safety
- Feature flags for behavior-changing rollouts (ingest logic, AI prompts, odds transforms).
- Canary deployments for edge functions before full production rollout.
- Runbooks required for all critical workflows:
  - ingest failures
  - stale feed
  - cron drift
  - schema rollback

## 4) Data & Schema Governance
- Schema changes via migrations only.
- Migration naming and uniqueness validated in CI.
- Idempotent ingest writes and deterministic dedupe keys.
- Backfills must be auditable (`scope`, `who`, `when`, `row count`).

## 5) SLO-Driven Operations
- Define and monitor SLOs for:
  - ingest freshness
  - edge function success rate
  - page render latency
  - AI response latency
- Trigger alerting off SLO burn, not isolated raw errors.

## 6) Security Controls
- No secrets in source, logs, or prompts.
- Least-privilege service accounts for automation.
- Dependency update automation (`dependabot`).
- Production access is break-glass only and auditable.

## 7) Performance Discipline
- Hard timeout budgets and concurrency caps per function.
- League-split ingestion and controlled batch sizing.
- P95/P99 latency tracked for key endpoints and pages.

## 8) AI Reliability Discipline
- Prompt versions tracked as code.
- Regression eval set required before prompt changes.
- Fallback behavior defined when context is stale/incomplete.

## 9) Ownership Model
- Product/UI: consistent UX and visual contracts.
- Data/ID: stable contracts and mapping correctness.
- Ops/SRE: availability, freshness, and incident response.

This baseline is the minimum. New systems should be added only if they improve reliability without lowering speed-to-ship.
