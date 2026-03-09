import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface RealtimePlayEvent {
  id: number;
  match_id: string;
  event_type: string;
  sequence: number;
  period: number | null;
  clock: string | null;
  home_score: number;
  away_score: number;
  play_data: {
    text?: string;
    type?: string;
    player?: string;
    team?: string;
    scoring_play?: boolean;
  } | null;
  source?: string | null;
  created_at: string;
}

const MAX_EVENTS = 100;

export function useRealtimePlayFeed(matchId: string | null) {
  const [plays, setPlays] = useState<RealtimePlayEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchExisting = useCallback(async () => {
    if (!matchId) return;
    const { data } = await supabase
      .from('game_events')
      .select('*')
      .eq('match_id', matchId)
      .order('sequence', { ascending: false })
      .limit(MAX_EVENTS);

    if (data) setPlays(data as RealtimePlayEvent[]);
  }, [matchId]);

  useEffect(() => {
    if (!matchId) {
      setPlays([]);
      setConnected(false);
      return;
    }

    void fetchExisting();

    const channel = supabase
      .channel(`play-feed:${matchId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'game_events',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const nextPlay = payload.new as RealtimePlayEvent;
          if (!nextPlay?.match_id) return;
          setPlays((prev) => {
            const exists = prev.some((p) => p.sequence === nextPlay.sequence && p.event_type === nextPlay.event_type);
            if (exists) return prev;
            return [nextPlay, ...prev].slice(0, MAX_EVENTS);
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
  }, [matchId, fetchExisting]);

  useEffect(() => {
    if (!matchId || connected) return;
    const timer = window.setInterval(() => {
      void fetchExisting();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [matchId, connected, fetchExisting]);

  return { plays, connected, refetchPlays: fetchExisting };
}
