// ============================================================================
// SHARED CONSTANTS (SSOT)
// Edit in packages/shared/src/constants.ts and run `npm run sync:shared`.
// ============================================================================

import { League, Sport } from './types.ts';

// ============================================================================
// LEAGUES CONFIGURATION
// ============================================================================

export const LEAGUES: League[] = [
  // American Football
  {
    id: 'nfl',
    name: 'NFL',
    sport: Sport.NFL,
    apiEndpoint: 'football/nfl',
    oddsKey: 'americanfootball_nfl'
  },
  {
    id: 'college-football',
    name: 'College Football',
    sport: Sport.COLLEGE_FOOTBALL,
    apiEndpoint: 'football/college-football',
    oddsKey: 'americanfootball_ncaaf'
  },

  // Basketball
  {
    id: 'nba',
    name: 'NBA',
    sport: Sport.NBA,
    apiEndpoint: 'basketball/nba',
    oddsKey: 'basketball_nba'
  },
  {
    id: 'wnba',
    name: 'WNBA',
    sport: Sport.WNBA,
    apiEndpoint: 'basketball/wnba',
    oddsKey: 'basketball_wnba'
  },
  {
    id: 'mens-college-basketball',
    name: 'NCAAB',
    sport: Sport.COLLEGE_BASKETBALL,
    apiEndpoint: 'basketball/mens-college-basketball',
    oddsKey: 'basketball_ncaab'
  },

  // Baseball
  {
    id: 'mlb',
    name: 'MLB',
    sport: Sport.BASEBALL,
    apiEndpoint: 'baseball/mlb',
    oddsKey: 'baseball_mlb'
  },

  // Hockey
  {
    id: 'nhl',
    name: 'NHL',
    sport: Sport.HOCKEY,
    apiEndpoint: 'hockey/nhl',
    oddsKey: 'icehockey_nhl'
  },

  // Soccer - Major Leagues
  {
    id: 'eng.1',
    name: 'English Premier League',
    sport: Sport.SOCCER,
    apiEndpoint: 'soccer/eng.1',
    oddsKey: 'soccer_epl'
  },
  {
    id: 'usa.1',
    name: 'MLS',
    sport: Sport.SOCCER,
    apiEndpoint: 'soccer/usa.1',
    oddsKey: 'soccer_usa_mls'
  },
  {
    id: 'esp.1',
    name: 'La Liga',
    sport: Sport.SOCCER,
    apiEndpoint: 'soccer/esp.1',
    oddsKey: 'soccer_spain_la_liga'
  },
  {
    id: 'ger.1',
    name: 'Bundesliga',
    sport: Sport.SOCCER,
    apiEndpoint: 'soccer/ger.1',
    oddsKey: 'soccer_germany_bundesliga'
  },
  {
    id: 'ita.1',
    name: 'Serie A',
    sport: Sport.SOCCER,
    apiEndpoint: 'soccer/ita.1',
    oddsKey: 'soccer_italy_serie_a'
  },
  {
    id: 'fra.1',
    name: 'Ligue 1',
    sport: Sport.SOCCER,
    apiEndpoint: 'soccer/fra.1',
    oddsKey: 'soccer_france_ligue_one'
  },
  {
    id: 'uefa.champions',
    name: 'Champions League',
    sport: Sport.SOCCER,
    apiEndpoint: 'soccer/uefa.champions',
    oddsKey: 'soccer_uefa_champs_league'
  },
  {
    id: 'uefa.europa',
    name: 'Europa League',
    sport: Sport.SOCCER,
    apiEndpoint: 'soccer/uefa.europa',
    oddsKey: 'soccer_uefa_europa_league'
  },
  {
    id: 'caf.nations',
    name: 'Africa Cup',
    sport: Sport.SOCCER,
    apiEndpoint: 'soccer/caf.nations',
    oddsKey: 'soccer_africa_cup_of_nations'
  },
  {
    id: 'mex.1',
    name: 'Liga MX',
    sport: Sport.SOCCER,
    apiEndpoint: 'soccer/mex.1',
    oddsKey: 'soccer_mexico_ligamx'
  },

  // Tennis
  {
    id: 'atp',
    name: 'ATP Tour',
    sport: Sport.TENNIS,
    apiEndpoint: 'tennis/atp',
    oddsKey: 'tennis_atp_aus_open_singles'
  },
  {
    id: 'wta',
    name: 'WTA Tour',
    sport: Sport.TENNIS,
    apiEndpoint: 'tennis/wta',
    oddsKey: 'tennis_wta_aus_open_singles'
  },

  // MMA
  {
    id: 'ufc',
    name: 'UFC',
    sport: Sport.MMA,
    apiEndpoint: 'mma/ufc',
    oddsKey: 'mma_mixed_martial_arts'
  },

  // Golf
  {
    id: 'pga',
    name: 'PGA Tour',
    sport: Sport.GOLF,
    apiEndpoint: 'golf/pga',
    oddsKey: 'golf_pga_championship_winner'
  }
];

export const getLeagueById = (id: string): League | undefined =>
  LEAGUES.find(l => l.id === id);

export const getLeaguesBySport = (sport: Sport): League[] =>
  LEAGUES.filter(l => l.sport === sport);

export const getOddsKeyForLeague = (leagueId: string): string | undefined =>
  LEAGUES.find(l => l.id === leagueId)?.oddsKey;

/**
 * Returns a clean display name for a league ID
 * "ita.1" → "Serie A", "nfl" → "NFL", etc.
 */
export const getLeagueDisplayName = (leagueId: string): string => {
  const league = LEAGUES.find(l => l.id.toLowerCase() === leagueId.toLowerCase());
  if (league) return league.name;

  // Fallback: Clean up the raw ID
  // "ita.1" → "ITA", "mens-college-basketball" → "NCAAB"
  const cleanId = leagueId.toUpperCase().replace(/\.\d+$/, '').replace(/-/g, ' ');
  return cleanId;
};

// ============================================================================
// UI LAYOUT & CONFIGURATION
// ============================================================================

export const LAYOUT = {
  HEADER_HEIGHT: 56,      // h-14
  WEEK_BAR_HEIGHT: 40,    // h-10
  TOTAL_HEADER_HEIGHT: 96,
} as const;

export const SPORT_CONFIG: Record<Sport, { label: string; icon: string }> = {
  [Sport.NFL]: { label: 'NFL', icon: '🏈' },
  [Sport.NBA]: { label: 'NBA', icon: '🏀' },
  [Sport.COLLEGE_FOOTBALL]: { label: 'NCAAF', icon: '🏈' },
  [Sport.COLLEGE_BASKETBALL]: { label: 'NCAAB', icon: '🏀' },
  [Sport.BASEBALL]: { label: 'MLB', icon: '⚾️' },
  [Sport.HOCKEY]: { label: 'NHL', icon: '🏒' },
  [Sport.SOCCER]: { label: 'Soccer', icon: '⚽️' },
  [Sport.WNBA]: { label: 'WNBA', icon: '🏀' },
  [Sport.MMA]: { label: 'UFC', icon: '🥊' },
  [Sport.GOLF]: { label: 'PGA', icon: '⛳️' },
  [Sport.TENNIS]: { label: 'Tennis', icon: '🎾' },
  [Sport.BASKETBALL]: { label: 'Basketball', icon: '🏀' },
  ['all' as any]: { label: 'All Sports', icon: '🌎' },
};

export const ORDERED_SPORTS: Sport[] = [
  Sport.NFL,
  Sport.NBA,
  Sport.SOCCER,
  Sport.COLLEGE_FOOTBALL,
  Sport.COLLEGE_BASKETBALL,
  Sport.WNBA,
  Sport.BASEBALL,
  Sport.HOCKEY,
  Sport.MMA,
  Sport.TENNIS,
  Sport.GOLF,
];
