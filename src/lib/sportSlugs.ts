/**
 * sportSlugs — Canonical mapping between URL slugs and Sport enum values.
 *
 * SSOT for sport ↔ URL resolution.
 * Used by: App.tsx routes, AppShell URL sync, useActiveObject, header nav.
 */

import { Sport } from '@/types';

/** URL slug → Sport enum */
export const SLUG_TO_SPORT: Record<string, Sport> = {
  nba: Sport.NBA,
  nfl: Sport.NFL,
  mlb: Sport.BASEBALL,
  nhl: Sport.HOCKEY,
  soccer: Sport.SOCCER,
  ncaaf: Sport.COLLEGE_FOOTBALL,
  ncaab: Sport.COLLEGE_BASKETBALL,
  wnba: Sport.WNBA,
  ufc: Sport.MMA,
  tennis: Sport.TENNIS,
  golf: Sport.GOLF,
};

/** Sport enum → URL slug */
export const SPORT_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_TO_SPORT).map(([slug, sport]) => [sport, slug])
);

/** All valid sport slugs (for route matching) */
export const SPORT_SLUGS = Object.keys(SLUG_TO_SPORT);

/** Resolve a pathname to a sport, or null if not a sport route */
export function resolveSportFromPath(pathname: string): Sport | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const slug = segments[0].toLowerCase();
  return SLUG_TO_SPORT[slug] ?? null;
}
