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
 *   1. Explicit game selection (detail overlay is open)
 *   2. URL-resolved routes (/team/:slug, /match/:slug, /trends, /edge)
 *   3. Default: live slate (sport + date from store)
 */

import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppStore, type ViewType } from '@/store/appStore';
import type { Sport, Match } from '@/types';

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

export function useActiveObject(): ActiveObject {
  const location = useLocation();
  const selectedMatch = useAppStore((s) => s.selectedMatch);
  const selectedSport = useAppStore((s) => s.selectedSport);
  const selectedDate = useAppStore((s) => s.selectedDate);
  const activeView = useAppStore((s) => s.activeView);

  return useMemo((): ActiveObject => {
    const pathname = location.pathname;

    // ── Priority 1: Game detail overlay is active ──────────────────────
    // When a user taps a game card, the detail sheet opens over the feed.
    // The game object is THE active object, regardless of the underlying URL.
    if (selectedMatch) {
      return {
        type: 'game',
        id: selectedMatch.id,
        source_url: pathname,
        match: selectedMatch,
        sport: selectedMatch.sport as Sport | undefined,
      };
    }

    // ── Priority 2: URL-resolved routes ────────────────────────────────

    // /game/:gameId — the first public object surface
    const gameRoute = pathname.match(/^\/game\/([^/]+)/);
    if (gameRoute) {
      const gameId = gameRoute[1];
      // If selectedMatch is loaded and matches this gameId, attach it.
      // Otherwise resolve with just the ID (GamePage will hydrate it).
      const resolvedMatch = selectedMatch?.id === gameId ? selectedMatch : undefined;
      return {
        type: 'game',
        id: gameId,
        source_url: pathname,
        match: resolvedMatch,
        sport: resolvedMatch?.sport as Sport | undefined,
      };
    }

    // /team/:slug
    const teamMatch = pathname.match(/^\/team\/([^/]+)/);
    if (teamMatch) {
      return {
        type: 'team',
        id: `team:${teamMatch[1]}`,
        source_url: pathname,
        slug: teamMatch[1],
      };
    }

    // /match/:slug (postgame)
    const matchSlug = pathname.match(/^\/match\/([^/]+)/);
    if (matchSlug) {
      return {
        type: 'postgame',
        id: `postgame:${matchSlug[1]}`,
        source_url: pathname,
        slug: matchSlug[1],
      };
    }

    // /league/:slug
    const leagueMatch = pathname.match(/^\/league\/([^/]+)/);
    if (leagueMatch) {
      return {
        type: 'league',
        id: `league:${leagueMatch[1]}`,
        source_url: pathname,
        slug: leagueMatch[1],
      };
    }

    // /trends
    if (pathname === '/trends') {
      const dateKey = selectedDate instanceof Date
        ? selectedDate.toISOString().slice(0, 10)
        : String(selectedDate);
      return {
        type: 'trend',
        id: `trends:${dateKey}`,
        source_url: pathname,
        sport: selectedSport,
        date: selectedDate instanceof Date ? selectedDate : new Date(selectedDate),
      };
    }

    // /edge or /reports
    if (pathname === '/edge' || pathname === '/reports') {
      const dateKey = selectedDate instanceof Date
        ? selectedDate.toISOString().slice(0, 10)
        : String(selectedDate);
      return {
        type: 'report',
        id: `reports:${dateKey}`,
        source_url: pathname,
        sport: selectedSport,
        date: selectedDate instanceof Date ? selectedDate : new Date(selectedDate),
      };
    }

    // ── Priority 3: Default — live slate ───────────────────────────────
    // The user is on the main feed (/, /nba, /mlb, etc.)
    // The object is the day's slate for the selected sport.
    const dateKey = selectedDate instanceof Date
      ? selectedDate.toISOString().slice(0, 10)
      : String(selectedDate);
    return {
      type: 'live_slate',
      id: `slate:${selectedSport}:${dateKey}`,
      source_url: pathname,
      sport: selectedSport,
      date: selectedDate instanceof Date ? selectedDate : new Date(selectedDate),
      activeView,
    };
  }, [
    location.pathname,
    selectedMatch,
    selectedSport,
    selectedDate,
    activeView,
  ]);
}

export default useActiveObject;
