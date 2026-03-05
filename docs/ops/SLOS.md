# SLOs and Alert Thresholds

## Service Level Objectives

### 1) Live ingest freshness
- **SLI:** max age of `live_game_state.updated_at` for active games.
- **Target:** 99% of active games updated within 5 minutes.
- **Page:** live feed + match detail.

### 2) Edge ingest availability
- **SLI:** successful `ingest-live-games` invocations / total invocations.
- **Target:** 99.5% success over 30-day window.

### 3) Match page performance
- **SLI:** p95 page load time (core route + critical data query).
- **Target:** p95 < 2.5s on broadband/mobile median.

### 4) AI analysis responsiveness
- **SLI:** p95 edge AI function completion latency.
- **Target:** p95 < 8s, timeout < 15s.

## Alerting Policy

### Critical (page immediately)
- Ingest success rate < 95% for 10 minutes.
- Active-game freshness > 10 minutes across 20%+ of live games.
- AI endpoint error rate > 15% for 10 minutes.

### Warning (investigate during current cycle)
- Ingest success rate < 99% for 30 minutes.
- p95 page load > 3s for 30 minutes.
- p95 AI latency > 10s for 30 minutes.

## Operational Notes
- Alerts should include:
  - environment
  - affected leagues
  - top failing function names
  - first seen + last seen
- Every critical incident requires a brief postmortem entry.
