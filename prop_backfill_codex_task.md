# Codex Task: Full-Season NBA Prop Backfill (Oct 22, 2025 -> Jan 3, 2026)

## Objective
Backfill `player_prop_bets` with historical closing/near-closing DraftKings-first lines from The Odds API, then rebuild:
1. `player_prop_outcomes`
2. `prop_hit_rate_cache`

## Script
- Path: `scripts/backfill/backfill_historical_props.ts`
- Package command: `npm run backfill:historical-props`

## Scope
- Sport key: `basketball_nba`
- Date range: `2025-10-22` through `2026-01-03`
- Markets:
  - `player_points` -> `points`
  - `player_rebounds` -> `rebounds`
  - `player_assists` -> `assists`
  - `player_threes` -> `threes_made`
  - `player_points_rebounds_assists` -> `pra`
- Book priority: `draftkings > fanduel > bovada > betmgm`
- Upsert conflict key: `(match_id, player_name, bet_type, side, provider)`

## Data Sources
- Historical events endpoint:
  - `GET /v4/historical/sports/basketball_nba/events?date={ISO_TS}`
- Historical event odds endpoint:
  - `GET /v4/historical/sports/basketball_nba/events/{event_id}/odds?...`
- DB joins:
  - `matches` for canonical `match_id` mapping
  - `player_game_stats` for player identity/team/opponent enrichment

## Environment
Required:
- `ODDS_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (preferred)
- `SUPABASE_URL` or `VITE_SUPABASE_URL`

Fallback supported (read-only / may fail on writes due RLS):
- `SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY`

## Run Modes
Dry-run sample:
```bash
npm run backfill:historical-props -- --dry-run --limit-dates=3
```

Full backfill:
```bash
npm run backfill:historical-props
```

Custom range:
```bash
npm run backfill:historical-props -- --start=2025-10-22 --end=2026-01-03
```

Skip rebuild stage:
```bash
npm run backfill:historical-props -- --skip-refresh
```

## Rebuild Stage (automatic unless `--skip-refresh`)
The script runs:
- `refresh_player_prop_outcomes(NULL)`
- `refresh_prop_hit_rate_cache(NULL)`

## Expected Validation
- Earliest `event_date` reaches `2025-10-22`
- Coverage extends continuously through `2026-01-03`
- Significant sample growth in `prop_hit_rate_cache` (example: Kevin Durant threes line buckets)
