# MLB ESPN Offerings Matrix (Verified March 27, 2026)

## Endpoint coverage we verified

- `GET https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=YYYYMMDD&limit=200`
- `GET https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event={eventId}`

Verified example event IDs:

- Final: `401814693` (PIT @ NYM, March 26, 2026)
- Scheduled: `401814721` (NYY @ SF, March 27, 2026)

## What ESPN MLB summary provides directly

| Layer | Status | ESPN fields (summary payload) | Notes |
|---|---|---|---|
| Starting pitcher baseline | Available | `boxscore.players[*].statistics[*].athletes[*]` with `starter`, `stats` (`IP`, `H`, `ER`, `BB`, `K`, `PC-ST`, `ERA`, `PC`) | Strong for postgame starter performance + efficiency. |
| Pitch count / leash | Available (derived) | Starter row `PC`/`PC-ST`, `IP`, inning outs derived from `IP` | Leash can be modeled from pitch count + outs + removal timing. |
| Bullpen state | Available (derived) | Same pitching rows with `starter=false` and pitch stats | Bullpen usage can be built from reliever count, outs, pitches. |
| Weather | Partial | `gameInfo.weather.{temperature,gust,precipitation,conditionId}` | Often present for scheduled/outdoor games, can be `null` for indoor/closed roof feeds. |
| Park / stadium effects | Available | `gameInfo.venue.{fullName,city,state,address,indoor}` | Venue + indoor flag are present. |
| L/R matchup | Available | `plays[*].bats.abbreviation` + participants (`pitcher`,`batter`) | Side-at-bat available at pitch/play level. |
| Pitch type + velocity | Available | `plays[*].pitchType.{id,text,abbreviation}`, `plays[*].pitchVelocity`, `plays[*].pitchCoordinate.{x,y}` | Includes type mix, velo, and location coordinate proxies. |
| Umpire crew | Available | `gameInfo.officials[*].{displayName,position,id,order}` | Home plate umpire is identifiable via position/order. |
| Umpire zone effect | Partial (derived) | `plays[*].type.type` (e.g., `strike-looking`, `ball`) | Called-strike and ball rates are derivable; true strike-zone calibration needs more history. |
| Betting lines | Available | `pickcenter[0]` (`homeTeamOdds.moneyLine`, `awayTeamOdds.moneyLine`, `spread`, `overUnder`, `overOdds`, `underOdds`) | Good for snapshot lines; not a full historical line movement feed alone. |
| Win probability | Available | `winprobability[]` | Strong live/postgame trajectory signal. |
| Injuries | Available | `injuries[]` | Present on summary for scheduled/final contexts. |
| Predictive pregame panel | Available | `predictor`, `lastFiveGames`, `leaders`, `seasonseries` | Good context layer; not a full proprietary model breakdown. |

## Gaps / caveats

- ESPN summary does **not** guarantee all weather fields for every game.
- `$ref` links are not consistently exposed for all nested MLB summary objects, so enrichment should treat summary as the primary contract.
- Pitch-level granularity is strong, but true biomechanical fields (release extension, spin axis, movement profile) are not consistently in this summary contract.

## Use-case ranking (recommended operational order)

### Totals

1. Bullpen state
2. Starter leash / pitch count
3. Weather + park
4. L/R + pitch-type lineup fit
5. Umpire zone

### Side

1. Starting pitcher baseline
2. Starter leash / pitch count
3. Bullpen state
4. L/R + pitch-type lineup fit
5. Weather + park
6. Umpire zone

### First 5

1. Starting pitcher baseline
2. Starter leash / pitch count
3. L/R + pitch-type lineup fit
4. Umpire zone
5. Weather + park

### Live inning-by-inning

1. Starter leash / transition timing
2. Bullpen state (live usage + remaining quality)
3. Umpire zone drift (called strike vs ball profile)
4. L/R + pitch-type matchup evolution
5. Weather + park

## Practical modeling note

The highest-value transition is starter -> bullpen timing. In MLB, many pricing errors come from this transition being treated as static instead of dynamic.
