# AI Live Quality Gates (P0)

## Status
This document defines the minimum production gates for packet-first live answers.

## Failure Taxonomy
- `F1_STALE_CONFIDENT_ANSWER`: Packet is stale and answer quality was not downgraded.
- `F2_PARTIAL_PACKET_OVERREACH`: Required packet fields missing for requested question type.
- `F3_SNAPSHOT_AS_TRANSITION`: Transition-level claim attempted while only snapshot evidence exists.
- `F4_CAUSAL_WITHOUT_EXECUTION`: Causal market explanation without execution-quality evidence.
- `F5_SILENT_FALLBACK`: System downgraded quality path without explicit user-visible downgrade.
- `F6_PACKET_BYPASS`: Live response path executed without trusted match packet.

## Severity Model
- `S0`: `F1`, `F6`
- `S1`: `F2`, `F3`, `F4`, `F5`
- `S2`: telemetry-only quality notes

## SLO Targets
- Packet tool success: `> 99.5%`
- Packet freshness p95: `< 20s`
- Packet freshness p99: `< 45s`
- S0 failure rate: `0`
- S1 failure rate: `< 0.5%` of live answers

## Required Field Contract
Question type to required answerability flags:
- `top_scorer` -> `can_answer_top_scorer`
- `rebounds` -> `can_answer_rebounds_leader`
- `assists` -> `can_answer_assists_leader`
- `events` -> `can_answer_recent_events`
- `market` -> `can_answer_market_movement`
- `general` -> `can_answer_scoreboard`

## Hard Boundary Rules
- Live response path must use trusted packet first.
- If packet missing on live path -> hard stop (`F6`).
- If packet stale beyond threshold -> hard stop (`F1`).
- If required fields missing -> hard stop (`F2`).
- If inference mode is snapshot-only -> no transition-causality claim.

## Decision Object Contract (next layer)
Each response should include a validated decision object with:
- `inference_mode`: `transition_grounded | snapshot_only`
- `quality_tier`: `A | B | C`
- `scores`: `pressure, flow, wall_quality, toxicity, reversion, breakout`
- `execution`: `fill_prob, expected_slippage, post_vs_take`
- `evidence_ids`
- `constraints`
- `as_of`, `freshness_seconds`

## Telemetry Sink
All guardrail outcomes are logged to `ai_tool_logs`:
- `tool_name`: `response_guard` or `get_live_context`
- `meta.failure_code`
- `meta.severity`
- `meta.inference_mode`
- `meta.is_live_intent`
- `meta.requires_packet`
- `missing_fields`
- `packet_freshness_seconds`

