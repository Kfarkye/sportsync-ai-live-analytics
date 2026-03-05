# AGENTS.md — The Drip (thedrip.to)

## What This Project Is

A sports betting intelligence platform. We don't just show scores — we explain why results happen structurally, calibrated against league-wide baselines (draw rates, foul rates, SOT rates, goal distributions). The product moat: Yahoo/ESPN show what happened; The Drip explains why it matters for betting.

## Task Format

When you receive a task, it will be in one of two formats:

### Product Brief (short form)
```
Brief: <name>
What: <plain language description>
Why: <urgency / context>
Done when: <observable proof>
Don't break: <blast radius>
Priority: now | soon | later
```

When you receive a Product Brief, expand it into a full Task Batch before executing. Map fields as follows:
- "What" → Objective + Requirements
- "Why" → Context
- "Done when" → Acceptance Criteria (binary pass/fail, each with verification)
- "Don't break" → Constraints
- "Priority" → P0 (now, blocking) | P1 (now) | P2 (soon) | P3 (later)

### Task Batch (full spec)
If the task is already a full Task Batch with Objective, Scope, Requirements, Acceptance Criteria, Constraints, Validation, and Delivery sections — execute directly against the spec.

## Stack

- **Frontend**: React (Vite), deployed on Vercel
- **Backend**: Supabase (Postgres + Edge Functions, project ref: qffzvrnbzabcokqqrwbv)
- **Design System**: Obsidian Weissach v7 — dark ground, monospace accents, minimal chrome, team accent colors, Porsche-level craft
- **Data Sources**: ESPN APIs, Bet365 (via soccer_player_odds), The Odds API (US sports), Polymarket
- **AI Analysis**: Pregame intel pipeline (pregame_intel table)

## Build & Test

```bash
npm run typecheck      # TypeScript checks
npm run test           # Unit tests
npm run check:migrations  # Validate migration naming (warnings OK, errors not)
npm run lint           # Lint
```

Always run `typecheck` and `test` before committing.
Exception: for emergency hotfixes, you may ship with partial checks only if explicitly documented in the PR/task output with risk + follow-up verification plan.

Legacy migration naming produces warnings — these are acceptable, not blockers.

## Database Conventions

- Always search tables by domain pattern: `%soccer%`, `%nba%`, `%ncaamb%` — never assume naming conventions.
- Verify current row counts with SQL before making data-volume decisions; do not rely on static numbers in docs.
- Materialized views: `mv_league_structural_profiles`, `mv_team_rolling_form`, `mv_h2h_summary`.
- Refresh schedules must be verified from `cron.job` by `jobname` (IDs can change).
- The `key_events` JSONB column in `soccer_match_result` requires `REGEXP_REPLACE(minute, '[^0-9]', '', 'g')::int` for minute parsing.
- ESPN uses DraftKings as provider 100 for soccer odds (American format).
- Bet365 name matching requires whitespace stripping.

## Edge Functions

Deployed to Supabase. Key functions:
- `backfill-pickcenter-odds` (v8): universal odds extraction, DraftKings-first with Bet365 fallback for soccer
- `ncaamb-ingest`: college basketball pipeline
- `reddit-ingest` / `reddit-batch-ingest`: Reddit signal ingestion
- ESPN scoreboard endpoint: `site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard`

## Code Standards

- **No stubs, TODOs, placeholders, or mock logic.** Every function complete, every error path handled, every edge case covered.
- **No unverifiable architecture claims.** Do not claim multi-model orchestration unless it is implemented and provably traceable in code.
- **No fabricated performance stats.** Do not cite hit rates unless backed by verified data.
- **Obsidian Weissach v7** is the canonical design for all edge cards (Pregame, Prop, Live). Dark aesthetic, earned minimalism, team accent colors, monospace data, luxury engineered not announced.

## PR & Commit Conventions

- Commit format: `type: description` (e.g., `feat: add lock detection engine`, `fix: bet365 name matching`).
- PR template exists at `.github/pull_request_template.md` — use it.
- Branch protection requires PR with approval + passing CI.

## What NOT to Touch

Unless the task explicitly says otherwise:
- Do not modify working pipelines for other sports when fixing one sport.
- Do not change the Obsidian Weissach v7 design tokens without explicit approval.
- Do not alter materialized view refresh schedules.
- Do not modify CODEOWNERS without approval.

## Validation Checklist

After every task, before committing:
1. `npm run typecheck` passes.
2. `npm run test` passes.
3. If DB changes: verify with a SELECT query that data looks correct.
4. If UI changes: visually confirm on the affected page.
5. If edge function changes: check Supabase logs for successful execution.
