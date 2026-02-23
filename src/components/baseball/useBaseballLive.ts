// ============================================================================
// src/components/baseball/useBaseballLive.ts
// React Query hook — Supabase edge function for baseball-specific live data
// ============================================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { MatchStatus } from '@/types';
import type { BaseballLiveData } from './types';

/**
 * Polling intervals by game state.
 * Live: aggressive (10s). Scheduled: lazy (60s). Final: disabled.
 */
const POLL_INTERVALS: Record<string, number | false> = {
  LIVE: 10_000,
  HALFTIME: 15_000,
  SCHEDULED: 60_000,
  FINISHED: false,
  POSTPONED: false,
  CANCELLED: false,
};

function getRefetchInterval(status: MatchStatus | string): number | false {
  return POLL_INTERVALS[status] ?? 30_000;
}

/**
 * Fetch baseball-specific live data from the Supabase edge function.
 *
 * The edge function is expected to return the `BaseballLiveData` shape:
 * pitch tracking, matchup state, edge signals, timestamps.
 *
 * Falls back gracefully: if the edge function hasn't been deployed yet
 * or returns null, the component renders with Match data alone.
 */
async function fetchBaseballLiveData(matchId: string): Promise<BaseballLiveData | null> {
  try {
    const { data, error } = await supabase.functions.invoke('baseball-live', {
      body: { matchId },
    });

    if (error) {
      // Non-fatal: edge function may not be deployed yet
      if (process.env.NODE_ENV === 'development') {
        console.warn('[useBaseballLive] Edge function error:', error.message);
      }
      return null;
    }

    if (!data || typeof data !== 'object') return null;

    return data as BaseballLiveData;
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[useBaseballLive] Fetch failed:', err);
    }
    return null;
  }
}

/**
 * Hook: useBaseballLive
 *
 * Provides baseball-specific live data (pitch tracking, edge signals,
 * matchup state) via React Query with status-aware polling.
 *
 * @param matchId  - The match identifier
 * @param status   - Current game status (controls polling interval)
 * @param enabled  - Whether to fetch at all (false for non-baseball sports)
 *
 * @returns {
 *   data: BaseballLiveData | null,
 *   isLoading: boolean,
 *   isError: boolean,
 *   error: Error | null,
 *   dataUpdatedAt: number  // React Query's last successful fetch timestamp
 * }
 */
export function useBaseballLive(
  matchId: string,
  status: MatchStatus | string,
  enabled = true,
) {
  const refetchInterval = getRefetchInterval(status);

  return useQuery<BaseballLiveData | null>({
    queryKey: ['baseball-live', matchId],
    queryFn: () => fetchBaseballLiveData(matchId),
    enabled: enabled && !!matchId,
    refetchInterval: refetchInterval || undefined,
    refetchIntervalInBackground: false,
    staleTime: typeof refetchInterval === 'number' ? refetchInterval * 0.8 : 30_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    // Don't throw — the component handles null gracefully
    throwOnError: false,
  });
}

export default useBaseballLive;
