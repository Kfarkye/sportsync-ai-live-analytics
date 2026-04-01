/**
 * Slug Utilities — URL generation and parsing for match/team pages
 * 
 * Match slug: "arsenal-vs-chelsea-2026-03-01"
 * Team slug:  "arsenal"
 */

export function teamSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function matchSlug(homeTeam: string, awayTeam: string, startTime: string): string {
  const date = new Date(startTime).toISOString().split('T')[0];
  return `${teamSlug(homeTeam)}-vs-${teamSlug(awayTeam)}-${date}`;
}

export function parseMatchSlug(slug: string): { home: string; away: string; date: string } | null {
  const vsIndex = slug.indexOf('-vs-');
  if (vsIndex === -1) return null;
  const home = slug.substring(0, vsIndex);
  const rest = slug.substring(vsIndex + 4);
  const dateMatch = rest.match(/(\d{4}-\d{2}-\d{2})$/);
  if (!dateMatch) return null;
  const date = dateMatch[1];
  const away = rest.substring(0, rest.length - date.length - 1);
  return { home, away, date };
}

export function matchUrl(homeTeam: string, awayTeam: string, startTime: string): string {
  return `/match/${matchSlug(homeTeam, awayTeam, startTime)}`;
}

export function teamUrl(teamName: string): string {
  return `/team/${teamSlug(teamName)}`;
}

export function formatMatchDate(startTime: string): string {
  return new Date(startTime).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

export const LEAGUE_LABELS: Record<string, string> = {
  epl: 'Premier League', laliga: 'La Liga', seriea: 'Serie A',
  bundesliga: 'Bundesliga', ligue1: 'Ligue 1', mls: 'MLS',
};

export const LEAGUE_SHORT: Record<string, string> = {
  epl: 'EPL', laliga: 'LIGA', seriea: 'SA',
  bundesliga: 'BUN', ligue1: 'L1', mls: 'MLS',
};
