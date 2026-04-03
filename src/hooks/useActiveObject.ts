/**
 * useActiveObject — Single resolution point for the product's active context.
 *
 * CONTRACT:
 *   URL → object → packet → page / chat / API / SEO
 *
 * This hook answers ONE question: "What object am I on?"
 * It does NOT build the packet. It resolves the locator.
 *
 * Resolution priority:
 *   1. URL-resolved routes (/game/:id, /team/:slug, /match/:slug, /trends, /edge)
 *   2. Legacy in-memory selected match (fallback only)
 *   3. Default: URL-bound live slate (sport + date + view from URL)
 */

import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppStore, type ViewType } from '@/store/appStore';
import type { Sport, Match } from '@/types';
import { SLUG_TO_SPORT, resolveSportFromPath } from '@/lib/sportSlugs';

// ═══════════════════════════════════════════════════════════════════════════
// §  Object Types
// ═══════════════════════════════════════════════════════════════════════════

export type ActiveObjectType =
  | 'game'
  | 'live_slate'
  | 'team'
  | 'postgame'
  | 'league'
  | 'trend'
  | 'report';

export interface ActiveObject {
  /** What kind of object is active */
  type: ActiveObjectType;

  /** Stable identifier for this object instance */
  id: string;

  /** The URL that resolved this object */
  source_url: string;

  // ── Type-specific resolution data ──────────────────────────────────────

  /** Present when type === 'game' */
  match?: Match;

  /** Present when type === 'live_slate' */
  sport?: Sport;
  date?: Date;

  /** Present when type === 'team' or 'league' */
  slug?: string;

  /** Present when type === 'live_slate' — which tab/view is active */
  activeView?: ViewType;
}

// ═══════════════════════════════════════════════════════════════════════════
// §  Hook
// ═══════════════════════════════════════════════════════════════════════════
type LiveSlateSport = Sport | 'all';
const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;
const parseDateParam = (raw: string | null): Date => {
  if (!raw || !DATE_PARAM_RE.test(raw)) return new Date();
  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};
const formatDateValue = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const normalizeGameId = (value: string): string => String(value || '').trim();
const toGameBaseId = (value: string): string => normalizeGameId(value).split('_')[0];
const gameIdsMatch = (a: string, b: string): boolean => {
  const left = normalizeGameId(a);
  const right = normalizeGameId(b);
  if (!left || !right) return false;
  return left === right || toGameBaseId(left) === toGameBaseId(right);
};

export function useActiveObject(): ActiveObject {
  const location = useLocation();
  const selectedMatch = useAppStore((s) => s.selectedMatch);
  const activeView = useAppStore((s) => s.activeView);

  return useMemo((): ActiveObject => {
    const pathname = location.pathname;
    const sourceUrl = `${location.pathname}${location.search}`;
    const query = new URLSearchParams(location.search);
    const urlDate = parseDateParam(query.get('date'));
    const urlDateKey = formatDateValue(urlDate);
    const urlView: ViewType = (() => {
      const raw = (query.get('view') || '').toLowerCase();
      if (raw === 'live') return 'LIVE';
      if (raw === 'feed') return 'FEED';
      if (pathname === '/live') return 'LIVE';
      return activeView === 'LIVE' ? 'LIVE' : 'FEED';
    })();
    const urlSport: LiveSlateSport = (() => {
      const fromPath = resolveSportFromPath(pathname);
      if (fromPath) return fromPath;
      // Legacy fallback for older shared links (e.g. "/?sport=soccer").
      const raw = (query.get('sport') || '').toLowerCase().trim();
      if (!raw || raw === 'all') return 'all';
      return SLUG_TO_SPORT[raw] ?? 'all';
    })();

    // ── Priority 1: URL-resolved routes ────────────────────────────────

    // /game/:gameId — the first public object surface
    const gameRoute = pathname.match(/^\/game\/([^/]+)/);
    if (gameRoute) {
      const gameId = normalizeGameId(gameRoute[1]);
      // Attach selectedMatch when it is the same canonical game object,
      // including legacy unsuffixed IDs (e.g. 4016... vs 4016..._mlb).
      const resolvedMatch = selectedMatch && gameIdsMatch(String(selectedMatch.id || ''), gameId)
        ? selectedMatch
        : undefined;
      const canonicalGameId = resolvedMatch?.id ? String(resolvedMatch.id) : gameId;
      const inferredSport = resolvedMatch?.sport || (urlSport === 'all' ? undefined : (urlSport as Sport));
      return {
        type: 'game',
        id: canonicalGameId,
        source_url: sourceUrl,
        match: resolvedMatch,
        sport: inferredSport as Sport | undefined,
      };
    }

    // /team/:slug
    const teamMatch = pathname.match(/^\/team\/([^/]+)/);
    if (teamMatch) {
      return {
        type: 'team',
        id: `team:${teamMatch[1]}`,
        source_url: sourceUrl,
        slug: teamMatch[1],
      };
    }

    // /match/:slug (postgame)
    const matchSlug = pathname.match(/^\/match\/([^/]+)/);
    if (matchSlug) {
      return {
        type: 'postgame',
        id: `postgame:${matchSlug[1]}`,
        source_url: sourceUrl,
        slug: matchSlug[1],
      };
    }

    // /league/:slug
    const leagueMatch = pathname.match(/^\/league\/([^/]+)/);
    if (leagueMatch) {
      return {
        type: 'league',
        id: `league:${leagueMatch[1]}`,
        source_url: sourceUrl,
        slug: leagueMatch[1],
      };
    }

    // /soccer/hub or /soccer/postgame (legacy alias)
    if (pathname === '/soccer/hub' || pathname === '/soccer/postgame') {
      return {
        type: 'postgame',
        id: 'postgame:hub',
        source_url: sourceUrl,
        slug: 'soccer-hub',
      };
    }

    // /trends
    if (pathname === '/trends') {
      return {
        type: 'trend',
        id: `trends:${urlDateKey}`,
        source_url: sourceUrl,
        sport: urlSport === 'all' ? undefined : (urlSport as Sport),
        date: urlDate,
      };
    }

    // /edge or /reports
    if (pathname === '/edge' || pathname === '/reports') {
      return {
        type: 'report',
        id: `reports:${urlDateKey}`,
        source_url: sourceUrl,
        sport: urlSport === 'all' ? undefined : (urlSport as Sport),
        date: urlDate,
      };
    }

    // ── Priority 2: Legacy in-memory selected match (fallback only) ─────
    if (selectedMatch) {
      return {
        type: 'game',
        id: selectedMatch.id,
        source_url: sourceUrl,
        match: selectedMatch,
        sport: selectedMatch.sport as Sport | undefined,
      };
    }

    // ── Priority 3: Default — URL-bound live slate ──────────────────────
    const sportKey = urlSport === 'all' ? 'all' : String(urlSport);
    const viewKey = urlView.toLowerCase();
    return {
      type: 'live_slate',
      id: `slate:${sportKey}:${urlDateKey}:${viewKey}`,
      source_url: sourceUrl,
      sport: urlSport === 'all' ? undefined : (urlSport as Sport),
      date: urlDate,
      activeView: urlView,
    };
  }, [
    location.pathname,
    location.search,
    selectedMatch,
    activeView,
  ]);
}

export default useActiveObject;
