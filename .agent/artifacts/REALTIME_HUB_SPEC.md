# Real-Time Hub Architecture Specification
## Version 1.0 | January 2026

---

## Executive Summary

Transform the current polling-based architecture into a **Server-Sent Events (SSE) / WebSocket push model** using Supabase Realtime. A single backend "Ingestion Worker" will stream play-by-play deltas to subscribed clients, eliminating redundant API calls and enabling instant UI updates.

---

## Current State (Problems)

```
┌─────────────┐     Poll Every 2min      ┌─────────────┐
│   Client 1  │ ──────────────────────── │  ESPN API   │
├─────────────┤                          └─────────────┘
│   Client 2  │ ──────────────────────── │  ESPN API   │
├─────────────┤                          └─────────────┘
│   Client N  │ ──────────────────────── │  ESPN API   │
└─────────────┘                          └─────────────┘
```

**Issues:**
1. **N × M API calls**: Each of N clients polls M games every 2 minutes.
2. **Stale Data Window**: Up to 2 minutes of latency before a scoring play is reflected.
3. **CPU Waste**: Each client runs `gameStateEngine.ts` independently for the same game.
4. **Rate Limits**: ESPN may throttle high-volume polling.

---

## Target State (Solution)

```
                                    ┌─────────────────────┐
                                    │  Supabase Realtime  │
                                    │  (WebSocket Hub)    │
                                    └──────────┬──────────┘
                                               │
                  ┌────────────────────────────┼────────────────────────────┐
                  │                            │                            │
          ┌───────▼───────┐            ┌───────▼───────┐            ┌───────▼───────┐
          │   Client 1    │            │   Client 2    │            │   Client N    │
          │  (Subscribe)  │            │  (Subscribe)  │            │  (Subscribe)  │
          └───────────────┘            └───────────────┘            └───────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Supabase Edge)                                   │
│  ┌───────────────────────┐       ┌───────────────────────┐       ┌───────────────┐  │
│  │  Ingestion Worker     │──────▶│  `live_game_state`    │◀──────│  AI Auditor   │  │
│  │  (CRON: Every 30s)    │       │  (Postgres Table)     │       │  (On Insert)  │  │
│  └───────────────────────┘       └───────────────────────┘       └───────────────┘  │
│           │                                                                         │
│           ▼                                                                         │
│  ┌───────────────────────┐                                                          │
│  │      ESPN API         │                                                          │
│  └───────────────────────┘                                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Benefits:**
1. **1 API Call per Game**: The Ingestion Worker is the single source of truth.
2. **Instant Propagation**: Supabase Realtime pushes to all clients in <100ms.
3. **Server-Side Computation**: The "Blueprint" (Fair Total) is computed once on the edge.
4. **Trigger-Based AI**: The AI Auditor only runs when a "Significant Event" occurs.

---

## Database Schema

### Table: `live_game_state`

This table holds the **canonical, server-computed state** for every active game.

```sql
-- Migration: supabase/migrations/20260103_live_game_state.sql

CREATE TABLE IF NOT EXISTS public.live_game_state (
    -- Primary Key: Composite of match_id and league for uniqueness
    match_id TEXT NOT NULL,
    league_id TEXT NOT NULL,
    
    -- Core State (from ESPN)
    home_score INTEGER NOT NULL DEFAULT 0,
    away_score INTEGER NOT NULL DEFAULT 0,
    period INTEGER NOT NULL DEFAULT 0,
    display_clock TEXT,
    game_status TEXT NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED, LIVE, HALFTIME, FINISHED
    last_play_id TEXT, -- ID of the most recent play (for delta detection)
    last_play_text TEXT,

    -- Server-Computed Signals (from gameStateEngine)
    fair_total NUMERIC(5, 2),
    market_total NUMERIC(5, 2),
    edge_points NUMERIC(5, 2),
    edge_state TEXT, -- 'PLAY', 'LEAN', 'NEUTRAL'
    pace NUMERIC(5, 2),
    efficiency NUMERIC(5, 2),
    
    -- AI Analysis (from analyze-match)
    ai_headline TEXT,
    ai_analysis TEXT,
    ai_confidence INTEGER,
    ai_orientation TEXT, -- 'OVER', 'UNDER', 'NEUTRAL'
    ai_updated_at TIMESTAMPTZ,

    -- Metadata
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (match_id, league_id)
);

-- Index for fast lookups by status
CREATE INDEX idx_live_game_state_status ON public.live_game_state(game_status);

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_game_state;
```

---

## Backend Components

### 1. Ingestion Worker (Edge Function)

**Path:** `supabase/functions/ingest-live-games/index.ts`

**Trigger:** Supabase CRON (every 30 seconds)

**Responsibility:**
1. Fetch the scoreboard for all active leagues (NFL, NBA, NHL, etc.).
2. For each game in `LIVE` status, compute the `AISignals` using the server-side engine.
3. `UPSERT` the result into `live_game_state`.
4. If `last_play_id` has changed, trigger the AI Auditor.

```typescript
// Pseudocode
import { computeAISignals } from "../_shared/gameStateEngine.ts"; // Server-side engine module

Deno.serve(async () => {
  const leagues = ['nfl', 'nba', 'nhl', 'college-football', 'mens-college-basketball'];
  
  for (const league of leagues) {
    const games = await fetchESPNScoreboard(league);
    
    for (const game of games.filter(g => g.status === 'LIVE')) {
      const detailedData = await fetchESPNSummary(game.id, league);
      const signals = computeAISignals(detailedData); // Server-side math
      
      const currentPlayId = detailedData.lastPlay?.id;
      const { data: existing } = await supabase
        .from('live_game_state')
        .select('last_play_id')
        .eq('match_id', game.id)
        .single();
      
      const isNewPlay = existing?.last_play_id !== currentPlayId;

      await supabase.from('live_game_state').upsert({
        match_id: game.id,
        league_id: league,
        home_score: game.homeScore,
        away_score: game.awayScore,
        period: game.period,
        display_clock: game.displayClock,
        game_status: game.status,
        last_play_id: currentPlayId,
        last_play_text: detailedData.lastPlay?.text,
        fair_total: signals.deterministic_fair_total,
        market_total: signals.market_snapshot?.cur?.total,
        edge_points: signals.edge_points,
        edge_state: signals.edge_state,
        pace: signals.blueprint?.pace,
        efficiency: signals.blueprint?.efficiency,
        updated_at: new Date().toISOString()
      });

      // If a new play occurred, invoke the AI Auditor asynchronously
      if (isNewPlay && signals.edge_state === 'PLAY') {
        await supabase.functions.invoke('analyze-match', {
          body: { match_id: game.id, league_id: league }
        });
      }
    }
  }

  return new Response(JSON.stringify({ success: true }));
});
```

### 2. AI Auditor (Edge Function - Modified)

**Path:** `supabase/functions/analyze-match/index.ts` (Existing)

**Modification:**
Instead of receiving `ai_signals` from the client, read the pre-computed signals directly from `live_game_state`. Write the AI result *back* to `live_game_state`.

```typescript
// After AI analysis is complete:
await supabase.from('live_game_state').update({
  ai_headline: result.headline,
  ai_analysis: result.analysis,
  ai_confidence: result.confidence,
  ai_orientation: result.market_signal.orientation,
  ai_updated_at: new Date().toISOString()
}).eq('match_id', match_id).eq('league_id', league_id);
```

---

## Frontend Components

### 1. New Hook: `useLiveGameState`

**Path:** `src/hooks/useLiveGameState.ts`

This hook subscribes to the `live_game_state` table via Supabase Realtime.

```typescript
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

interface LiveGameState {
  match_id: string;
  home_score: number;
  away_score: number;
  period: number;
  display_clock: string;
  game_status: string;
  fair_total: number;
  market_total: number;
  edge_points: number;
  edge_state: 'PLAY' | 'LEAN' | 'NEUTRAL';
  ai_headline: string | null;
  ai_analysis: string | null;
  ai_confidence: number | null;
  ai_orientation: 'OVER' | 'UNDER' | 'NEUTRAL' | null;
  updated_at: string;
}

export function useLiveGameState(matchId: string, leagueId: string) {
  const [state, setState] = useState<LiveGameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let channel: RealtimeChannel;

    const setupSubscription = async () => {
      // 1. Initial Fetch
      const { data } = await supabase
        .from('live_game_state')
        .select('*')
        .eq('match_id', matchId)
        .eq('league_id', leagueId)
        .single();
      
      if (data) setState(data);
      setIsLoading(false);

      // 2. Subscribe to changes
      channel = supabase.channel(`game:${matchId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'live_game_state',
            filter: `match_id=eq.${matchId}`
          },
          (payload) => {
            console.log('[Realtime] Game state updated:', payload.new);
            setState(payload.new as LiveGameState);
          }
        )
        .subscribe();
    };

    setupSubscription();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [matchId, leagueId]);

  return { state, isLoading };
}
```

### 2. Update `LiveAIInsight.tsx`

Remove the polling logic. Use the new `useLiveGameState` hook.

```tsx
// Before (Old)
// const POLL_INTERVAL_MS = 120_000;
// useEffect(() => { setInterval(fetchData, POLL_INTERVAL_MS) }, []);

// After (New)
import { useLiveGameState } from '../../hooks/useLiveGameState';

export const LiveAIInsight: React.FC<{ match: Match }> = ({ match }) => {
  const { state, isLoading } = useLiveGameState(match.id, match.leagueId);

  // The `state` object now contains pre-computed AI data from the server.
  // No client-side fetching or polling is required.

  if (isLoading) {
    return <LoadingSpinner />; // The Bot Spinner
  }

  if (!state?.ai_headline) {
    return <AwaitingAnalysis />; // The AI hasn't run yet for this game
  }

  // Render the full analysis using state.ai_headline, state.ai_analysis, etc.
  // ...
};
```

---

## CRON Setup

**Path:** `supabase/migrations/20260103_realtime_cron.sql`

```sql
-- Schedule the Ingestion Worker to run every 30 seconds
SELECT cron.schedule(
  'ingest-live-games-cron',
  '*/30 * * * * *', -- Every 30 seconds (if using pg_cron extension that supports seconds, otherwise '* * * * *' for every minute)
  $$
  SELECT net.http_post(
      url:='https://<project-ref>.supabase.co/functions/v1/ingest-live-games',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer <service_role_key>"}'::jsonb,
      body:='{}'::jsonb
  ) AS request_id;
  $$
);
```

---

## Implementation Checklist

| Phase | Task | File(s) |
|-------|------|---------|
| **1. Schema** | Create `live_game_state` table | `supabase/migrations/20260103_live_game_state.sql` |
| **2. Backend Engine** | Port `gameStateEngine.ts` to Deno-compatible module | `supabase/functions/_shared/gameStateEngine.ts` |
| **3. Ingestion Worker** | Create the CRON-triggered Edge Function | `supabase/functions/ingest-live-games/index.ts` |
| **4. AI Auditor Update** | Modify `analyze-match` to read/write from `live_game_state` | `supabase/functions/analyze-match/index.ts` |
| **5. Frontend Hook** | Create `useLiveGameState` | `src/hooks/useLiveGameState.ts` |
| **6. UI Update** | Refactor `LiveAIInsight.tsx` to use the new hook | `src/components/analysis/LiveAIInsight.tsx` |
| **7. CRON Schedule** | Deploy the CRON job | `supabase/migrations/20260103_realtime_cron.sql` |
| **8. Cleanup** | Remove old polling logic from all components | Various |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| **Supabase Realtime Latency** | The hook has a fallback `initial fetch` to ensure there's always data on mount. |
| **CRON Failure** | The Ingestion Worker logs every run. A separate health-check CRON can alert if no updates occur for 5 minutes. |
| **ESPN API Changes** | The Ingestion Worker uses the same `espnAdapters.ts` logic, minimizing divergence. |
| **Edge Function Cold Starts** | The CRON runs frequently enough to keep the function warm. |

---

## Next Steps

1.  **Approve this Spec**: Confirm the architecture is correct.
2.  **Begin Phase 1**: I will create the `live_game_state` migration.
3.  **Port the Engine**: The biggest task is porting `gameStateEngine.ts` to Deno.

Ready for your go-ahead.
