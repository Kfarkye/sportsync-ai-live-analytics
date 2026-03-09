import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface LiveScore {
  match_id: string;
  league_id: string;
  sport: string | null;
  home_team: string | null;
  away_team: string | null;
  home_score: number;
  away_score: number;
  period: number | null;
  clock: string | null;
  display_clock: string | null;
  game_status: string | null;
  spread: number | null;
  total: number | null;
  home_ml: number | null;
  away_ml: number | null;
  over_odds: number | null;
  under_odds: number | null;
  home_win_prob: number | null;
  last_play_text: string | null;
  last_play_type: string | null;
  updated_at: string | null;
}

const LIVE_STATUSES = [
  'STATUS_IN_PROGRESS',
  'STATUS_HALFTIME',
  'STATUS_FIRST_HALF',
  'STATUS_SECOND_HALF',
  'STATUS_END_PERIOD',
];

export function useRealtimeScores(leagueId?: string) {
  const [scores, setScores] = useState<Map<string, LiveScore>>(new Map());
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchInitial = useCallback(async () => {
    let query = supabase
      .from('live_scores')
      .select('*')
      .in('game_status', LIVE_STATUSES)
      .order('updated_at', { ascending: false });

    if (leagueId) query = query.eq('league_id', leagueId);

    const { data } = await query;
    if (!data) return;

    const next = new Map<string, LiveScore>();
    (data as LiveScore[]).forEach((row) => {
      next.set(row.match_id, row);
    });
    setScores(next);
  }, [leagueId]);

  useEffect(() => {
    void fetchInitial();

    const filter = leagueId ? `league_id=eq.${leagueId}` : undefined;
    const channel = supabase
      .channel(`live-scores:${leagueId || 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_scores',
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { match_id?: string };
            if (!oldRow.match_id) return;
            setScores((prev) => {
              const next = new Map(prev);
              next.delete(oldRow.match_id);
              return next;
            });
            return;
          }

          const nextRow = payload.new as LiveScore;
          if (!nextRow?.match_id) return;
          setScores((prev) => {
            const next = new Map(prev);
            next.set(nextRow.match_id, nextRow);
            return next;
          });
        },
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [leagueId, fetchInitial]);

  useEffect(() => {
    if (connected) return;
    const timer = window.setInterval(() => {
      void fetchInitial();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [connected, fetchInitial]);

  return {
    scores: useMemo(() => Array.from(scores.values()), [scores]),
    connected,
    refetchScores: fetchInitial,
  };
}
