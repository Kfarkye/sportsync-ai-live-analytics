import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export function useRealtimeGameDetail(matchId: string | null) {
  const [gameState, setGameState] = useState<Record<string, unknown> | null>(null);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refetch = useCallback(async () => {
    if (!matchId) return;
    const { data } = await supabase
      .from('live_game_state')
      .select('*')
      .eq('id', matchId)
      .maybeSingle();
    setGameState((data as Record<string, unknown> | null) ?? null);
  }, [matchId]);

  useEffect(() => {
    if (!matchId) {
      setGameState(null);
      setConnected(false);
      return;
    }

    void refetch();

    const channel = supabase
      .channel(`game-detail:${matchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_game_state',
          filter: `id=eq.${matchId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setGameState(null);
            return;
          }
          setGameState((payload.new as Record<string, unknown>) ?? null);
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
  }, [matchId, refetch]);

  useEffect(() => {
    if (!matchId || connected) return;
    const timer = window.setInterval(() => {
      void refetch();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [matchId, connected, refetch]);

  return { gameState, connected, refetchGameState: refetch };
}
