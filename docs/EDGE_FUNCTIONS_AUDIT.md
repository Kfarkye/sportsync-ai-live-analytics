# EDGE Functions Audit

_Generated: 2026-03-02 (local inventory + caller scan)_

## Inventory

| Function | Route | Auth | Callers | DB Calls (#) | External Calls | Request Shape | Response Shape | Est Payload | Cacheability | Error Model | p95 Target | Known Bottlenecks |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| ai-chat | /functions/v1/ai-chat | jwt | scripts/audit_chat_stream.ts,scripts/debug_chat.ts,scripts/debug_ncaaf_chat.ts,scripts/verify_chat_fix.ts | 13 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| analyze-match | /functions/v1/analyze-match | jwt | supabase/functions/batch-recap-generator/index.ts,src/services/geminiService.ts,supabase/functions/nightly-alpha-sync/index.ts,src/components/analysis/LiveAIInsight.tsx,scripts/archive/backfill_clean.sh | 1 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| analyze-referees | /functions/v1/analyze-referees | jwt | - | 0 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| batch-news-generator | /functions/v1/batch-news-generator | jwt | - | 6 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| batch-recap-generator | /functions/v1/batch-recap-generator | jwt | - | 2 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| capture-opening-lines | /functions/v1/capture-opening-lines | jwt | scripts/force_serie_a.ts,scripts/force_backfill.ts,scripts/force_ncaab.ts | 4 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| debug-gemini-config | /functions/v1/debug-gemini-config | jwt | - | 0 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| espn-proxy | /functions/v1/espn-proxy | jwt | src/services/espnService.ts | 0 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| espn-sync | /functions/v1/espn-sync | jwt | - | 6 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| fetch-matches | /functions/v1/fetch-matches | jwt | src/hooks/useMatchData.ts,src/hooks/useMatches.ts | 5 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| fetch-starting-goalies | /functions/v1/fetch-starting-goalies | jwt | - | 2 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| finalize-games-cron | /functions/v1/finalize-games-cron | jwt | api/cron/finalize-games.js | 4 | 2 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| generate-daily-thesis | /functions/v1/generate-daily-thesis | jwt | - | 1 | 2 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| generate-news | /functions/v1/generate-news | jwt | - | 1 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| generate-pregame-context | /functions/v1/generate-pregame-context | jwt | - | 3 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| get-odds | /functions/v1/get-odds | jwt | src/services/oddsApiService.ts,src/hooks/useEnhancedOdds.ts | 0 | 9 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| grade-chat-picks | /functions/v1/grade-chat-picks | jwt | - | 3 | 2 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| grade-picks-cron | /functions/v1/grade-picks-cron | jwt | scripts/debug_grading.ts,supabase/functions/finalize-games-cron/index.ts | 14 | 2 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| grade-tennis-backfill | /functions/v1/grade-tennis-backfill | jwt | - | 2 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| history-janitor | /functions/v1/history-janitor | jwt | - | 2 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| ingest-live-games | /functions/v1/ingest-live-games | jwt | - | 4 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| ingest-odds | /functions/v1/ingest-odds | anon_or_custom | api/cron/ingest-odds.js,src/components/TechnicalDebugView.tsx,scripts/trigger_ingest_manual.ts | 17 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| ingest-poly-sports | /functions/v1/ingest-poly-sports | jwt | - | 5 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| ingest-team-tempo | /functions/v1/ingest-team-tempo | jwt | - | 1 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| live-edge-calculator | /functions/v1/live-edge-calculator | jwt | - | 2 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| live-odds-tracker | /functions/v1/live-odds-tracker | jwt | - | 6 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| live-snapshot-capture | /functions/v1/live-snapshot-capture | jwt | - | 1 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| multimodal | /functions/v1/multimodal | jwt | src/services/geminiService.ts | 0 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| nba-backtest | /functions/v1/nba-backtest | jwt | - | 5 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| nba-bridge | /functions/v1/nba-bridge | jwt | - | 4 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| nba-calibrate-weekly | /functions/v1/nba-calibrate-weekly | jwt | - | 8 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| nba-ingest-tick | /functions/v1/nba-ingest-tick | jwt | supabase/functions/nba-bridge/index.ts | 7 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| nba-run-model | /functions/v1/nba-run-model | jwt | supabase/functions/nba-bridge/index.ts | 15 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| news-generator | /functions/v1/news-generator | jwt | src/components/PreGameView.tsx | 1 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| nightly-alpha-sync | /functions/v1/nightly-alpha-sync | jwt | - | 2 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| pregame-intel | /functions/v1/pregame-intel | anon_or_custom | supabase/functions/pregame-intel/index.ts,api/cron/pregame-intel.js,src/services/pregameIntelService.ts,scripts/force_serie_a.ts,scripts/audit_hybrid_intel.ts,supabase/functions/pregame-intel-dispatcher/index.ts,scripts/redo_mavs_intel.ts,scripts/force_intel.ts,scripts/regenerate_apex_intel.ts,supabase/functions/pregame-intel-cron/index.ts,scripts/test_fetch_intel.ts,scripts/archive/trigger_cron.sql,scripts/force_backfill.ts,scripts/test_pregame_intel.ts,scripts/trigger_refresh.ts | 0 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| pregame-intel-cron | /functions/v1/pregame-intel-cron | anon_or_custom | api/cron/pregame-intel.js,scripts/trigger_cron_manual.ts,scripts/force_serie_a.ts,scripts/trigger_refresh.ts,scripts/force_backfill.ts,scripts/archive/trigger_cron.sql | 10 | 2 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| pregame-intel-dispatcher | /functions/v1/pregame-intel-dispatcher | jwt | - | 2 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| pregame-intel-worker | /functions/v1/pregame-intel-worker | anon_or_custom | supabase/functions/pregame-intel/index.ts,supabase/functions/pregame-intel-dispatcher/index.ts,supabase/functions/pregame-intel-cron/index.ts,scripts/debug_intel_worker.ts | 12 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| scan-injuries | /functions/v1/scan-injuries | jwt | - | 1 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| scan-team-context | /functions/v1/scan-team-context | jwt | - | 7 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| sharp-intel | /functions/v1/sharp-intel | jwt | - | 10 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| sharp-picks-cron | /functions/v1/sharp-picks-cron | jwt | api/cron/sharp-picks.js | 2 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| sharp-picks-worker | /functions/v1/sharp-picks-worker | anon_or_custom | supabase/functions/sharp-picks-cron/index.ts | 1 | 0 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| sync-player-props | /functions/v1/sync-player-props | jwt | api/cron/sync-player-props.js | 2 | 3 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| team-scoring-splits | /functions/v1/team-scoring-splits | jwt | src/hooks/useScoringSplits.ts | 0 | 1 | json_or_query | json | 2k-50k | depends | http_4xx_5xx_json_error | <1200 | unprofiled |
| titan-analytics | /functions/v1/titan-analytics | jwt | src/pages/TitanAnalytics.tsx | 5 | 0 | json_or_query | json | 2k-50k | public_max_age_20_swr_60 | http_4xx_5xx_json_error_code | <500 | trend_window_scan_on_large_history |

## Endpoint Contracts (Hot Paths)

### `fetch-matches` (`/functions/v1/fetch-matches`)
- Auth: `jwt`.
- Request:
  - Query: `date=YYYY-MM-DD`, optional `league`, optional `limit`.
  - Body (optional JSON): `{ date?: string, leagueId?: string, leagues?: (string|{id:string})[], limit?: number }`.
- Response: `Match[]` with normalized odds (`match.odds`) and source fields (`current_odds`, `closing_odds` when present).
- Deterministic errors:
  - `400` invalid JSON / invalid body.
  - `500` internal error with `{ error, matches: [] }`.
- Cache policy:
  - Live slates: `public, max-age=3, stale-while-revalidate=7`.
  - Non-live slates: `public, max-age=20, stale-while-revalidate=60`.
  - `ETag` + `304` support.
- Instrumentation:
  - `X-Request-Id`, `Server-Timing`, `X-Payload-Bytes`, `X-Elapsed-Ms`, structured logs.
- Current bottlenecks:
  - Fuzzy odds reconciliation on large feed buckets.
  - Closing-line fanout for larger match sets.

### `get-odds` (`/functions/v1/get-odds`)
- Auth: `jwt`.
- Request: JSON body with `action` plus action-specific fields:
  - `featured_odds/events/scores`: `sport`, optional `limit`, optional `regions`, optional `daysFrom`.
  - `player_props/alternate_lines/available_markets`: requires `eventId`.
  - `historical`: requires `date` (ISO-8601).
  - `find_event`: requires `homeTeam`, `awayTeam`.
- Response: action-specific JSON payload, always via normalized edge response wrapper.
- Deterministic errors:
  - `400` for invalid action or missing required fields.
  - `500` for upstream/API failures.
- Cache policy:
  - Action-specific TTL (`featured_odds` 10s, `events` 60s, `historical` 300s, etc.), error responses `no-store`.
- Instrumentation:
  - `X-Request-Id`, `Server-Timing`, `X-Payload-Bytes`, `X-Action`, structured logs.
- Current bottlenecks:
  - `player_props` can still expand when requesting many markets with `includeRaw=true`.

### `titan-analytics` (`/functions/v1/titan-analytics`)
- Auth: `jwt`.
- Request:
  - `GET` query: `trend_days` (7-90, default 21).
  - `POST` body (optional): `{ trend_days?: number }`.
- Response:
  - `{ summary, leagues, buckets, heatmap, trends, metadata }` from five TITAN views in one payload.
- Deterministic errors:
  - `400` invalid JSON body.
  - `500` view/query failure with `error_code` (`DB_QUERY_FAILED`/`INTERNAL`).
- Cache policy:
  - `public, max-age=20, stale-while-revalidate=60`.
  - `ETag` + `304` support.
- Instrumentation:
  - `X-Request-Id`, `Server-Timing`, `X-Payload-Bytes`, `X-League-Count`, `X-Trend-Points`, structured logs.
- Current bottlenecks:
  - View complexity in Postgres for large trend windows.

## Before vs After (Hot Endpoints)
- `fetch-matches`:
  - Before: broad selects + cache-busting client requests.
  - After: explicit column selects, capped pagination, live/non-live cache headers, ETag/304, structured timing.
- `get-odds`:
  - Before: inconsistent contracts/caching across actions.
  - After: action validation, action-level cache policy, consistent headers and structured timing/logging.
- TITAN dashboard:
  - Before: 5 client-side Supabase view calls every 30s.
  - After: 1 edge call (`titan-analytics`) every 30s with shared cache/etag semantics.
