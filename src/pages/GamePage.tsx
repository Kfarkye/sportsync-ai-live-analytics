/**
 * GamePage — Public object surface for a single game.
 *
 * CONTRACT:
 *   /game/:gameId → GamePage resolves match → MatchDetails renders
 *
 * This is the first real "object surface" in the product.
 * A game now has a URL. It is shareable, bookmarkable, deep-linkable.
 *
 * Resolution strategy:
 *   1. Attempt to find the match in the already-loaded feed (from useMatches cache)
 *   2. If not cached, fetch today's slate and resolve from it
 *   3. If still not found, show a clean error state
 *
 * The ChatWidget is mounted alongside MatchDetails so that the chat
 * is permanently grounded to this game object via useActiveObject().
 */

import React, { type FC, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import SEOHead from '@/components/seo/SEOHead';
import MatchDetails from '@/components/match/MatchDetails';
import ChatWidget from '@/components/ChatWidget';
import { useAppStore } from '@/store/appStore';
import type { Match } from '@/types';
import { cn } from '@/lib/essence';
import { isSupabaseConfigured, getSupabaseUrl } from '@/lib/supabase';
import { formatLocalDate, safeParseDate } from '@/utils/dateUtils';

// ═══════════════════════════════════════════════════════════════════════════
// §  Direct game fetch (when not in cache)
// ═══════════════════════════════════════════════════════════════════════════

const fetchSingleGame = async (gameId: string): Promise<Match | null> => {
  // Strategy: fetch today's full slate and find the game.
  // This reuses the same Edge function as useMatches, so cache is shared.
  if (!isSupabaseConfigured()) return null;

  const today = formatLocalDate(new Date());
  const baseUrl = getSupabaseUrl();
  if (!baseUrl) return null;
  const anonKey = (
    typeof import.meta.env.VITE_SUPABASE_ANON_KEY === 'string'
      ? import.meta.env.VITE_SUPABASE_ANON_KEY
      : typeof (import.meta as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY === 'string'
        ? (import.meta as any).env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        : ''
  ).trim();
  if (!anonKey) return null;

  try {
    const response = await fetch(`${baseUrl}/functions/v1/fetch-matches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: today,
        oddsSportKey: 'all',
      }),
    });

    if (!response.ok) return null;
    const data: Match[] = await response.json();
    return data.find((m) => m.id === gameId) ?? null;
  } catch {
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// §  Game Page Component
// ═══════════════════════════════════════════════════════════════════════════

const GamePage: FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSelectedMatch = useAppStore((s) => s.setSelectedMatch);

  // 1) Try to resolve from existing useMatches cache first
  const cachedMatch = useMemo((): Match | null => {
    if (!gameId) return null;

    // Check all cached match queries
    const allQueries = queryClient.getQueriesData<Match[]>({ queryKey: ['matches'] });
    for (const [, matches] of allQueries) {
      if (!matches) continue;
      const found = matches.find((m) => m.id === gameId);
      if (found) return found;
    }
    return null;
  }, [gameId, queryClient]);

  // 2) If not in cache, fetch directly
  const { data: fetchedMatch, isLoading: isFetching } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => fetchSingleGame(gameId!),
    enabled: !!gameId && !cachedMatch,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const match = cachedMatch ?? fetchedMatch ?? null;

  // 3) Sync the resolved match into appStore so useActiveObject picks it up
  useEffect(() => {
    if (match) {
      setSelectedMatch(match);
    }
    return () => {
      // When leaving the game page, clear the selection
      setSelectedMatch(null);
    };
  }, [match, setSelectedMatch]);

  const handleBack = useCallback(() => {
    // Navigate back: if there's history, go back. Otherwise go to feed.
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  }, [navigate]);

  // ── Loading state ──────────────────────────────────────────────────────
  if (!gameId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <p className="text-slate-500 text-sm font-medium">No game ID provided.</p>
      </div>
    );
  }

  if (isFetching && !match) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAFAF8]">
        <div className="w-6 h-6 border-2 border-blue-200 border-t-[#0B63F6] rounded-full animate-spin mb-4" />
        <p className="text-slate-500 text-[13px] font-medium tracking-tight">Loading game…</p>
      </div>
    );
  }

  // ── Not found state ────────────────────────────────────────────────────
  if (!match) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAFAF8] gap-4">
        <SEOHead
          title="Game Not Found | The Drip"
          description="The requested game could not be found."
          canonicalPath={`/game/${gameId}`}
        />
        <div className="w-14 h-14 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
          <span className="text-2xl">🏟️</span>
        </div>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Game not found</h1>
        <p className="text-slate-500 text-[13px] max-w-[280px] text-center leading-relaxed">
          This game may have ended or the link may be outdated. Check the live board for current games.
        </p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className={cn(
            'mt-2 px-5 py-2 rounded-full',
            'border border-slate-200 bg-white',
            'text-[11px] font-bold uppercase tracking-[0.06em] text-slate-700',
            'hover:bg-slate-50 hover:border-slate-300 active:scale-95',
            'transition-all'
          )}
        >
          Back to Board
        </button>
      </div>
    );
  }

  // ── Resolved state — render the game surface ───────────────────────────
  const homeTeamName = match.homeTeam?.name || 'Home';
  const awayTeamName = match.awayTeam?.name || 'Away';
  const title = `${awayTeamName} @ ${homeTeamName} | The Drip`;
  const description = `Live analysis for ${awayTeamName} vs ${homeTeamName}. Odds, trends, and AI-powered insights.`;

  return (
    <div className={cn('min-h-screen relative flex flex-col', 'bg-[#FAFAF8] text-[#1A1A18]')}>
      <SEOHead
        title={title}
        description={description}
        canonicalPath={`/game/${gameId}`}
      />

      {/* Game detail — full page, not an overlay */}
      <div className="flex-1 overflow-y-auto">
        <MatchDetails
          match={match}
          onBack={handleBack}
        />
      </div>

      {/* Chat is grounded to this game via useActiveObject */}
      <ChatWidget currentMatch={match} matches={[]} />
    </div>
  );
};

export default GamePage;
