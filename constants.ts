import { League, Sport } from './types';

// ============================================================================
// LEAGUES CONFIGURATION
// ============================================================================
// Each league maps to ESPN's API endpoint and the-odds-api sport key

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

  // Tennis
  {
    id: 'atp',
    name: 'ATP Tour',
    sport: Sport.TENNIS,
    apiEndpoint: 'tennis/atp',
    oddsKey: 'tennis_atp_french_open' // Updates based on current tournament
  },
  {
    id: 'wta',
    name: 'WTA Tour',
    sport: Sport.TENNIS,
    apiEndpoint: 'tennis/wta',
    oddsKey: 'tennis_wta_french_open'
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

// Helper to get league by ID
export const getLeagueById = (id: string): League | undefined =>
  LEAGUES.find(l => l.id === id);

// Helper to get leagues by sport
export const getLeaguesBySport = (sport: Sport): League[] =>
  LEAGUES.filter(l => l.sport === sport);

// Helper to get odds key for a league
export const getOddsKeyForLeague = (leagueId: string): string | undefined =>
  LEAGUES.find(l => l.id === leagueId)?.oddsKey;
