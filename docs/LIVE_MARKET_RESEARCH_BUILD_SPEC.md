# Live Market Research Build Spec

## Purpose
This document is not marketing copy. It is the system doctrine for a solo builder plus coding agent.

Its job is to preserve the edge thesis, define what the system is actually trying to do, and constrain implementation so the build stays aligned with the real opportunity.

The core principle is simple:

> Raw odds are commodity data. The value is in what happens after ingestion: normalization, lineage, historical tagging, structural edge detection, opponent-context overlays, referee layers, fatigue splits, and pregame match labeling. That is what transforms public fragments into private utility.

## System Thesis
There is a widespread assumption in sports betting that once a game starts, sportsbooks are dynamically repricing markets using deeply contextual models.

The working thesis behind this build is narrower and more useful:

- Pregame markets are opinion markets shaped by public money, narrative bias, and sharp positioning.
- Many live derivative markets behave more like state markets anchored to pregame lines plus score and clock.
- Scoreboard-driven repricing leaves blind spots because it does not fully reflect possession quality, player burden, foul state, tempo shifts, shot quality, or other play-by-play context.
- The sportsbook price is not the final signal. It is a calibration baseline.
- The edge comes from identifying where structural price, live state, and market price diverge.

This system exists to build that calibration and divergence layer.

## Strategic Architecture

### 1. Historical Trends vs Live Execution
The system is intentionally split into two layers.

#### Layer 1: Historical Ledger
A backend data pipeline calculates verified postgame outcomes and trend performance.

This layer exists to answer questions like:
- Which structural environments have persistent ROI?
- Which leagues, totals buckets, favorite/dog regimes, or draw setups are historically positive or negative?
- Which patterns are real and which are sample noise?

Accounting rule:
- Never average American odds to calculate ROI.
- ROI is cumulative profit divided by total units risked.

#### Layer 2: Pregame Tagging
A pregame automation job evaluates structural conditions and attaches metadata to upcoming matches.

Examples:
- `EPL Totals > 2.5`
- `Serie A Away Favorite`
- `Heavy Favorite | High Total`
- fatigue or travel tags
- opponent context
- referee context

The UI and downstream research layers should render pre-computed tags, not re-derive them at read time.

Price-dependent signals that require the current number stay in the live ingestion path.

### 2. Structural Pricing Baseline
The system assumes that many live derivatives can be approximated from full-game priors plus game state.

Working examples:
- 1H spread derived from full-game spread
- 1Q spread derived from full-game spread
- derivative totals derived from full-game total with simple rounding

This does not need to be universally true to be useful. It only needs to be stable enough to create a baseline model that can be compared against live market prices.

The target output is not “the perfect sportsbook simulator.”
The target output is a baseline structural price that is directionally reliable enough to detect divergence.

### 3. Play-by-Play Advantage
If books are visibly anchored to score plus clock, the advantage has to come from richer inputs.

That means ingesting and normalizing:
- play-by-play events
- box score state
- live context snapshots
- odds snapshots
- provider lineage

Examples of state information the scoreboard does not capture cleanly:
- possession pressure
- offensive collapse into one shot creator
- foul accumulation and penalty state
- late-clock inefficiency
- shot-quality deterioration
- rebounding imbalance
- substitutions and fatigue signals
- red cards, penalties, and momentum swings in soccer

A score-only model sees a tied game.
A PBP-aware model sees which side is controlling the game state.

### 4. AI Snapshot Layer
Humans cannot monitor the full slate in real time.

The AI layer exists to compress the game into structured state summaries over short windows. It should not replace the structured data model. It should sit on top of it.

Required behavior:
- summarize 10-15 minute windows or other bounded intervals
- interpret state shifts causally, not narratively
- output structured observations that can be logged and backtested

Examples:
- defensive pressure increasing
- late-clock rate increasing
- foul burden concentrated on one side
- transition opportunities rising
- rebounding imbalance widening

No LLM layer should exist without underlying structured state data and postgame evaluation hooks.

### 5. Prediction Market / Exchange Divergence
The structural pricing layer becomes most useful when compared to markets that expose crowd probability directly.

The operating idea is a four-stage pipeline:

1. ingest game state
2. compute sportsbook-style structural baseline
3. ingest live market price
4. calculate divergence and rank opportunity

Example:
- structural baseline says 62%
- live prediction market says 54%
- divergence is 8%

The market price alone is not enough.
The structural baseline alone is not enough.
The value comes from the gap.

## What The System Must Build

### Data Layers
- historical postgame ledger
- pregame structural labels
- live odds persistence
- live context persistence
- cross-sport normalized PBP schema
- event-to-market join layer
- provider lineage layer
- postgame grading and evaluation layer

### Research Layers
- structural trend registry
- pregame tag backtests
- event-to-price reaction studies
- first-goal and red-card repricing studies
- timeout / scoring-run repricing studies
- market stale-line detection
- provider lag and provider disagreement studies

### Execution Layers
- divergence scoring
- thresholding and ranking
- alert surfaces
- trade logging
- post-trade evaluation

## Current State

### Confirmed
- historical soccer and multi-sport non-AI trend mining is working against stored postgame and line tables
- `game_events` contains rich PBP, especially for soccer, and usable PBP for basketball and hockey
- `v_pbp_events_normalized` exists in production and exposes cross-sport normalized PBP
- `v_pbp_event_market_context` exists in production and joins PBP to `matches`, `live_context_snapshots`, and `live_odds_snapshots`
- lineage and quality labels now exist in the normalized PBP layer
- pregame structural labels now exist in the market-context view

### Observed But Not Yet Hardened
- `live_odds_snapshots` schema is deployed, but snapshot production is not yet filling reliably
- basketball and hockey non-scoring play attribution still has meaningful gaps
- soccer live-context coverage is effectively absent relative to PBP volume
- nearest-snapshot joins work structurally, but the density of source snapshots is not yet good enough for robust event-to-price research

### Hypotheses To Test
- full-game to derivative price approximations are stable enough by sport/book/market to use as structural baseline
- PBP-driven state features can explain meaningful divergence beyond score and clock alone
- prediction markets and some live books will periodically lag structural plus contextual fair price
- certain game-state regimes produce recurring mispricing that is measurable and tradable after costs

## Immediate Gaps
These are the current blockers.

1. `live_odds_snapshots` write path is not yet producing rows consistently.
2. Soccer `live_context_snapshots` density is too low.
3. Basketball and hockey team attribution remains incomplete for many non-scoring plays.
4. There is no roster-aware entity resolution layer yet.
5. There are no referee overlays, fatigue overlays, or travel/rest overlays yet.
6. There is no calibrated spread-to-win-probability conversion layer yet.
7. There are no hardened divergence thresholds yet.
8. There is no trade logging or execution evaluation layer yet.

## Order Of Operations
This is the build order.

1. Make `live_odds_snapshots` populate reliably.
2. Fix soccer live-context persistence so joins are not empty.
3. Continue attribution hardening for non-scoring basketball and hockey plays.
4. Build event-to-price research views on top of reliable snapshot density.
5. Build pregame overlays: fatigue, opponent context, referee context, travel/rest.
6. Build structural pricing baselines by sport and market.
7. Build divergence scoring and thresholding.
8. Build alerting and trade/evaluation logging.

## Non-Negotiables
- No live-edge claims without persisted timestamped odds.
- No ROI claims from averaged American odds.
- No AI summary layer without structured underlying state.
- No research view without lineage and quality labels.
- No execution logic without post-trade evaluation hooks.
- No assumption that all books or all markets are naive; calibration must be empirical.

## Immediate Next Tasks
These are the next implementation targets for the agent.

1. Fix `live_odds_snapshots` until the 24-hour health query returns rows by `league_id` and `provider`.
2. Audit why soccer has effectively zero `live_context_snapshots` relative to PBP.
3. Build the first event-to-market research views:
   - `v_first_goal_repricing`
   - `v_red_card_market_shift`
   - `v_timeout_response_basketball`
4. Add roster-aware attribution for basketball and hockey if non-scoring play resolution is still materially weak.
5. Start pregame overlays only after live joins are stable enough to support downstream research.

## Success Criteria
The system is not “done” when it has a dashboard.
It is done when it can answer these questions with timestamped evidence:

- What did the market price before the event?
- What did the structural baseline imply?
- What did the actual game state imply?
- How quickly did each provider react?
- Did the divergence produce repeatable post-cost edge?

If the system cannot answer those five questions, it is still an ingestion stack, not a research environment.
