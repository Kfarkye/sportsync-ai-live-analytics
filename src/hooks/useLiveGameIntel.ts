/**
 * useLiveGameIntel — React hook for the unified live game intelligence endpoint
 * 
 * Fetches from /api/live/game/{gameId} — the SAME endpoint that Gemini reads.
 * One source of truth, two consumers: UI and AI.
 * 
 * Returns: scores, PBP, player stats, momentum, odds, advanced metrics.
 * Auto-polls every 15s for live games, 60s for scheduled/final.
 */

import { useQuery } from '@tanstack/react-query';

export interface PlayEvent {
  id: string;
  text: string;
  type: string;
  clock: string;
  period: number;
  teamId?: string;
}

export interface PlayerStat {
  id: string | null;
  name: string;
  short_name: string | null;
  position: string | null;
  headshot: string | null;
  stats: Record<string, string | null>;
}

export interface GameIntel {
  game_id: string;
  sport: string;
  league: string;
  status: string;
  period: number | null;
  clock: string | null;
  start_time: string | null;
  score: {
    home: { team: string; score: number };
    away: { team: string; score: number };
  };
  last_play: PlayEvent | null;
  recent_plays: PlayEvent[];
  player_stats: {
    home: PlayerStat[];
    away: PlayerStat[];
  } | null;
  team_stats: Array<{ stat: string; home: string | null; away: string | null }> | null;
  momentum: Array<{ value: number; minute: number; winProb: number }> | null;
  advanced_metrics: Record<string, unknown> | null;
  odds: {
    current: {
      spread_home: number | null;
      total: number | null;
      moneyline_home: number | null;
      moneyline_away: number | null;
      provider: string | null;
      is_live: boolean;
      updated_at: string | null;
    };
    opening: {
      spread_home: number | null;
      total: number | null;
      moneyline_home: number | null;
      moneyline_away: number | null;
    };
  };
  match_context: Record<string, unknown> | null;
  predictor: Record<string, unknown> | null;
  updated_at: string;
  _meta: {
    version: string;
    endpoint: string;
    description: string;
    consumers: string[];
  };
}

const LIVE_STATUSES = new Set([
  'STATUS_IN_PROGRESS',
  'STATUS_HALFTIME',
  'STATUS_END_PERIOD',
  'in',
  'in_progress',
  'live',
]);

async function fetchGameIntel(gameId: string): Promise<GameIntel | null> {
  const res = await fetch(`/api/live/game/${encodeURIComponent(gameId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Game intel fetch failed: ${res.status}`);
  return res.json();
}

export function useLiveGameIntel(gameId: string | null | undefined) {
  return useQuery<GameIntel | null>({
    queryKey: ['live-game-intel', gameId],
    queryFn: () => {
      if (!gameId) return null;
      return fetchGameIntel(gameId);
    },
    enabled: Boolean(gameId),
    staleTime: 10_000,        // 10s — slightly less than CDN cache
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 30_000;
      if (LIVE_STATUSES.has(data.status)) return 15_000; // Live: 15s
      return 60_000; // Pregame/Final: 60s
    },
    refetchIntervalInBackground: false,
  });
}

export default useLiveGameIntel;
