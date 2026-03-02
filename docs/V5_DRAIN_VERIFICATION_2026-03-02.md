# v5 Drain Verification (March 2, 2026)

## Scope
Validated that the soccer postgame drain endpoint is live and that v5 game-flow fields are being written to `soccer_postgame`.

## Commands Run

### Drain endpoint checks
- `GET /functions/v1/soccer-postgame-drain?league=seriea,laliga&days=1`
- `GET /functions/v1/soccer-postgame-drain?league=epl&days=1`

### Data validation query target
- `soccer_postgame` rows where `start_time > 2026-03-02T00:00:00Z`

### Manual summary cross-check
- ESPN summary endpoint using event id from the latest row in `soccer_postgame`.

## Observed Results

### Drain endpoint responses
- Serie A + La Liga request returned:
  - `success: true`
  - `version: v5`
  - `totalFound: 2`
  - `totalDrained: 0`
  - matches were skipped as not yet finalized when checked.
- EPL request returned:
  - `success: true`
  - `version: v5`
  - `totalFound: 0`
  - `totalDrained: 0`

### `soccer_postgame` verification
At check time, one fresh row existed after March 2 in the project data:
- `id`: `761468_mls`
- `home_team`: San Diego FC
- `away_team`: St. Louis CITY SC
- `home_score`: 2
- `away_score`: 0
- `drain_version`: `v5`
- `ht_ft_result`: `H/H`
- `btts`: `false`
- `first_goal_minute`: 3

### v5 consistency checks passed on that row
- `drain_version = 'v5'`
- `ht_ft_result` populated
- `btts` populated
- `first_goal_minute` populated
- Half split sum equals final score total:
  - `home_goals_1h + away_goals_1h + home_goals_2h + away_goals_2h == home_score + away_score`

### Manual cross-check passed
For event `761468`, summary endpoint values matched key persisted fields:
- Final score matched
- First goal minute matched
- Last goal minute matched
- BTTS derivation matched (`false`)

## Architecture Decision: Single-Source Pipeline

Recommended path:
1. Scoreboard endpoint: discover completed fixtures and write/update canonical match identity rows.
2. Summary endpoint: enrich full postgame payload and write `soccer_postgame` v5 fields.
3. UI and postgame pages read only from `soccer_postgame`.

Rationale:
- Removes dual-source reconciliation drift.
- Keeps postgame page contracts stable.
- Preserves a clear separation between discovery (`matches`-like identity feed) and postgame analytics (`soccer_postgame`).

## Follow-up
Re-run the same verification after each target slate finalizes:
- Serie A / La Liga on March 2
- EPL slate on March 3

The checks in this file can be reused as an operations runbook.
