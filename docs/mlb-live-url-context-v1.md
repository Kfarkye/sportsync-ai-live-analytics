# MLB Live URL Context System V1

## Canonical URL
- Pattern: `/mlb/game/{game_id}`
- Same URL is used pregame, live, and final.
- Source object is always `canonical_game` from `mlb-live-url-context`.

## Canonical Object (SSOT)
Top-level required keys:
- `game_id`
- `game_url`
- `start_time_utc`
- `status`
- `teams`
- `market`
- `environment`
- `lineups`
- `starters`
- `bullpens`
- `pregame_edges`
- `live_state`
- `data_gaps`

The same object feeds:
- MLB game page (`/mlb/game/:gameId`)
- Trigger engine
- AI output formatter
- Replay/receipt log insert payload

## Object-to-Page Mapping
| Page Section | Canonical object fields |
|---|---|
| Scoreboard header | `teams`, `status`, `start_time_utc` |
| Lines | `market.opening`, `market.current` |
| Lineups / availability | `lineups.home`, `lineups.away` |
| Run environment | `environment.pregame`, `environment.live`, `environment.delta_run_environment` |
| Starter context | `starters.home`, `starters.away`, `live_state.current_pitcher` |
| Bullpen context | `bullpens.home`, `bullpens.away` |
| Pregame edges | `pregame_edges` |

## Trigger-to-Data Mapping (V1)
| Trigger | Inputs | Source |
|---|---|---|
| `starter_command_loss` | `ball_rate_last_15`, `first_strike_rate_last_15` | ESPN summary plays → `canonical.live_state.recent_pitch_sequence` / `recent_control_state` |
| `pitch_count_stress` | `pitch_count`, `inning` | ESPN summary situation + `live_game_state.period` |
| `weak_escape_inning` | baserunner traffic + escape event text | ESPN summary play text + canonical live sequence |
| `bullpen_fragility_now_live` | starter exit `<6`, high bullpen fatigue | canonical starters/current pitcher + bullpen fatigue context |
| `run_environment_boost_live` | pregame vs live run environment delta | canonical environment pregame/live indices |
| `platoon_pressure_window` | next hitters hand vs pitcher hand | canonical due-up hitters + current pitcher hand |

Triggers with missing required inputs are emitted as `implemented=false` and include `partial_reason`.

## Fixed AI Output Contract
Always exactly:
- `What changed: ...`
- `Why it matters: ...`
- `What to watch now: ...`

No AI self-reference, no long narration, no uncontrolled prose.

## Example Outputs (5)
### 1) Starter command loss
What changed: Starter command slipped in the last pitch window (ball rate 46.7% and first-strike rate 44.4%).  
Why it matters: Command loss raises walk traffic and pitch inflation risk, which increases run-scoring pressure before full bullpen stabilization.  
What to watch now: Watch the bottom of inning 5 for leverage bullpen usage and market reaction.

### 2) Pitch count stress
What changed: Current pitcher reached 93 pitches by inning 5.  
Why it matters: Early pitch-count stress increases probability of a bullpen handoff before the game stabilizes.  
What to watch now: Watch the bottom of inning 5 for leverage bullpen usage and market reaction.

### 3) Weak escape inning
What changed: A high-traffic inning escaped on noise events after 3 recent baserunner events.  
Why it matters: Escape variance can mask underlying run prevention stress and leave totals vulnerable to the next clean-contact sequence.  
What to watch now: Watch the next inning boundary for bullpen handoff and line movement confirmation.

### 4) Bullpen fragility now live
What changed: home starter exited before the sixth and bullpen exposure is now live (fatigue score 78).  
Why it matters: Early bullpen demand with a fatigued relief profile increases late-inning run volatility.  
What to watch now: Watch the next inning boundary for bullpen handoff and line movement confirmation.

### 5) Run environment boost live
What changed: Live run environment index increased by 0.31 versus pregame baseline.  
Why it matters: A higher run environment increases expected scoring efficiency and can shift fair live totals upward.  
What to watch now: Watch the next inning boundary for bullpen handoff and line movement confirmation.

## Speak/Silent Rules
- Speak only when:
  - trigger fired
  - `implemented=true`
  - `confidence_inputs.score >= 0.62`
  - `market_relevance=true`
- Silent when state changes but no market relevance or confidence threshold miss.
- Cooldown: 15 minutes on same trigger.
- Cooldown bypass only when severity escalates (`low -> medium` or `medium -> high`).

## Replay/Receipt Log
Table: `public.mlb_live_insight_receipts`

Required fields:
- `ts_utc`
- `game_id`
- `game_url`
- `inning_state`
- `market_state`
- `trigger`
- `ai_summary`
- `confidence`
- `outcome_snapshot_later`

Query examples:
```sql
SELECT *
FROM public.mlb_live_insight_receipts
WHERE game_id = '401696999_mlb'
ORDER BY ts_utc DESC;
```

```sql
SELECT trigger, count(*)::bigint AS emits
FROM public.mlb_live_insight_receipts
WHERE ts_utc::date = CURRENT_DATE
GROUP BY trigger
ORDER BY emits DESC;
```

## QA Guardrails
### Commands
```bash
npm run typecheck
npm run test
npm run check:migrations
node scripts/smoke_mlb_live_url_context.mjs
```

### Pass / Fail Criteria
- Pass: `typecheck` exits `0`.
- Pass: `test` exits `0` and includes `supabase/functions/_shared/mlb_live/mlb_live_v1.test.ts`.
- Pass: `check:migrations` exits `0`.
- Pass: smoke script exits `0` and confirms canonical sections on one scheduled + one in-progress MLB game.

Fail if any command returns non-zero, or if smoke output reports missing canonical sections.
