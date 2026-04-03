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
 *   2. If not cached, fetch the hinted slate date (with nearby fallback days)
 *   3. If still not found, show a clean error state
 *
 * The ChatWidget is mounted alongside MatchDetails so that the chat
 * is permanently grounded to this game object via useActiveObject().
 */

import React, { type FC, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import SEOHead from '@/components/seo/SEOHead';
import MatchDetails from '@/components/match/MatchDetails';
import ChatWidget from '@/components/ChatWidget';
import { useAppStore } from '@/store/appStore';
import type { Match } from '@/types';
import { cn } from '@/lib/essence';
import { isSupabaseConfigured, getSupabaseUrl } from '@/lib/supabase';
import { formatLocalDate } from '@/utils/dateUtils';
import { SLUG_TO_SPORT } from '@/lib/sportSlugs';
import { fetchAllMatches } from '@/services/espnService';
import { LEAGUES } from '@/constants';

// ═══════════════════════════════════════════════════════════════════════════
// §  Direct game fetch (when not in cache)
// ═══════════════════════════════════════════════════════════════════════════

const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseDateHint = (raw: string | null): Date | null => {
  if (!raw || !DATE_PARAM_RE.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shiftDateKey = (dateKey: string, days: number): string => {
  const base = parseDateHint(dateKey);
  if (!base) return dateKey;
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return formatLocalDate(next);
};

const normalizeGameId = (value: string): string => String(value || '').trim();
const toGameBaseId = (value: string): string => normalizeGameId(value).split('_')[0];
const gameIdsMatch = (a: string, b: string): boolean => {
  const left = normalizeGameId(a);
  const right = normalizeGameId(b);
  if (!left || !right) return false;
  return left === right || toGameBaseId(left) === toGameBaseId(right);
};
const FALLBACK_LEAGUE_IDS = new Set([
  'nba',
  'nhl',
  'nfl',
  'college-football',
  'mens-college-basketball',
  'mlb',
  'eng.1',
  'usa.1',
  'ita.1',
  'esp.1',
  'ger.1',
  'fra.1',
  'ned.1',
  'por.1',
  'bel.1',
  'tur.1',
  'bra.1',
  'arg.1',
  'sco.1',
  'uefa.champions',
  'uefa.europa',
  'mex.1',
]);
const FALLBACK_LEAGUES = LEAGUES.filter((league) => FALLBACK_LEAGUE_IDS.has(league.id));
const toDateFromKey = (dateKey: string): Date => {
  const hinted = parseDateHint(dateKey);
  if (hinted) return hinted;
  const parsed = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const fetchMatchesForDate = async (dateKey: string, limit = 300): Promise<Match[]> => {
  if (!isSupabaseConfigured()) return [];
  const baseUrl = getSupabaseUrl();
  if (!baseUrl) return [];
  const anonKey = (
    typeof import.meta.env.VITE_SUPABASE_ANON_KEY === 'string'
      ? import.meta.env.VITE_SUPABASE_ANON_KEY
      : typeof (import.meta as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY === 'string'
        ? (import.meta as any).env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        : ''
  ).trim();
  if (!anonKey) return [];

  try {
    const response = await fetch(`${baseUrl}/functions/v1/fetch-matches?date=${encodeURIComponent(dateKey)}&limit=${limit}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: dateKey,
        limit,
      }),
    });

    if (!response.ok) return [];
    const payload = await response.json();
    const rawMatches = Array.isArray(payload)
      ? payload
      : (payload && typeof payload === 'object' && Array.isArray(payload.data))
        ? payload.data
        : (payload && typeof payload === 'object' && Array.isArray(payload.matches))
          ? payload.matches
          : [];
    if (!Array.isArray(rawMatches)) return [];
    const fetchedAt = Date.now();
    return rawMatches.map((item: Match) => (
      typeof item?.fetched_at === 'number'
        ? item
        : { ...item, fetched_at: fetchedAt }
    ));
  } catch {
    return [];
  }
};

const fetchFallbackMatchesForDate = async (dateKey: string): Promise<Match[]> => {
  try {
    const fallback = await fetchAllMatches(FALLBACK_LEAGUES, toDateFromKey(dateKey));
    const fetchedAt = Date.now();
    return (fallback || []).map((item: Match) => (
      typeof item?.fetched_at === 'number'
        ? item
        : { ...item, fetched_at: fetchedAt }
    ));
  } catch {
    return [];
  }
};

const buildCandidateDateKeys = (hintedDate: Date | null): string[] => {
  const todayKey = formatLocalDate(new Date());
  if (hintedDate) {
    const hintKey = formatLocalDate(hintedDate);
    return [...new Set([hintKey, shiftDateKey(hintKey, -1), shiftDateKey(hintKey, 1), todayKey])];
  }
  return [...new Set([todayKey, shiftDateKey(todayKey, -1), shiftDateKey(todayKey, 1)])];
};

const fetchSingleGame = async (gameId: string, hintedDate: Date | null): Promise<Match | null> => {
  if (!normalizeGameId(gameId)) return null;
  const candidateDateKeys = buildCandidateDateKeys(hintedDate);
  for (const dateKey of candidateDateKeys) {
    const matches = await fetchMatchesForDate(dateKey, 300);
    const found = matches.find((m) => gameIdsMatch(String(m.id || ''), gameId));
    if (found) return found;

    const fallbackMatches = await fetchFallbackMatchesForDate(dateKey);
    const fallbackFound = fallbackMatches.find((m) => gameIdsMatch(String(m.id || ''), gameId));
    if (fallbackFound) return fallbackFound;
  }
  return null;
};

// ═══════════════════════════════════════════════════════════════════════════
// §  Game Page Component
// ═══════════════════════════════════════════════════════════════════════════

const GamePage: FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSelectedMatch = useAppStore((s) => s.setSelectedMatch);
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const hintedDate = useMemo(() => parseDateHint(query.get('date')), [query]);
  const hintedDateKey = useMemo(() => (hintedDate ? formatLocalDate(hintedDate) : 'none'), [hintedDate]);
  const hintedSportSlug = useMemo(() => {
    const raw = (query.get('sport') || '').toLowerCase().trim();
    return raw && SLUG_TO_SPORT[raw] ? raw : null;
  }, [query]);
  const hintedView = useMemo<'live' | 'feed'>(() => {
    const raw = (query.get('view') || '').toLowerCase();
    return raw === 'live' ? 'live' : 'feed';
  }, [query]);
  const fallbackSlateHref = useMemo(() => {
    const dateKey = hintedDate ? formatLocalDate(hintedDate) : formatLocalDate(new Date());
    const params = new URLSearchParams();
    params.set('date', dateKey);
    params.set('view', hintedView);
    const pathname = hintedSportSlug ? `/${hintedSportSlug}` : '/';
    return `${pathname}?${params.toString()}`;
  }, [hintedDate, hintedView, hintedSportSlug]);

  // 1) Try to resolve from existing useMatches cache first
  const cachedMatch = useMemo((): Match | null => {
    if (!gameId) return null;

    // Check all cached match queries
    const allQueries = queryClient.getQueriesData<Match[]>({ queryKey: ['matches'] });
    for (const [, matches] of allQueries) {
      if (!matches) continue;
      const found = matches.find((m) => gameIdsMatch(String(m.id || ''), gameId));
      if (found) return found;
    }
    return null;
  }, [gameId, queryClient]);

  // 2) If not in cache, fetch directly
  const { data: fetchedMatch, isLoading: isFetching } = useQuery({
    queryKey: ['game', gameId, hintedDateKey],
    queryFn: () => fetchSingleGame(gameId!, hintedDate),
    enabled: !!gameId && !cachedMatch,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const match = cachedMatch ?? fetchedMatch ?? null;

  useEffect(() => {
    if (!match || !gameId) return;
    if (String(match.id) === gameId) return;
    navigate(`/game/${match.id}${location.search || ''}`, { replace: true });
  }, [match, gameId, location.search, navigate]);

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
      navigate(fallbackSlateHref);
    }
  }, [navigate, fallbackSlateHref]);

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
          onClick={() => navigate(fallbackSlateHref)}
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
