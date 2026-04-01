const LEAGUE_ALIASES: Record<string, string> = {
  'eng.1': 'epl',
  'esp.1': 'laliga',
  'ger.1': 'bundesliga',
  'ita.1': 'seriea',
  'fra.1': 'ligue1',
  'usa.1': 'mls',
  'ned.1': 'eredivisie',
  'por.1': 'primeira',
  'bel.1': 'belgian',
  'tur.1': 'superlig',
  'bra.1': 'brasileirao',
  'arg.1': 'argentina',
  'sco.1': 'scottish',
  ucl: 'uefa.champions',
  uel: 'uefa.europa',
  ncaab: 'mens-college-basketball',
  ncaawb: 'womens-college-basketball',
  ncaaf: 'college-football',
};

const LEAGUE_DISPLAY_NAMES: Record<string, string> = {
  nba: 'NBA',
  wnba: 'WNBA',
  nfl: 'NFL',
  mlb: 'MLB',
  nhl: 'NHL',
  'mens-college-basketball': 'NCAAB',
  'womens-college-basketball': 'NCAAW',
  'college-football': 'NCAAF',
  epl: 'Premier League',
  laliga: 'La Liga',
  bundesliga: 'Bundesliga',
  seriea: 'Serie A',
  ligue1: 'Ligue 1',
  mls: 'MLS',
  eredivisie: 'Eredivisie',
  primeira: 'Primeira Liga',
  belgian: 'Belgian Pro League',
  superlig: 'Super Lig',
  brasileirao: 'Brasileirao',
  argentina: 'Argentina Primera',
  scottish: 'Scottish Premiership',
  'ned.1': 'Eredivisie',
  'por.1': 'Primeira Liga',
  'bel.1': 'Belgian Pro League',
  'tur.1': 'Super Lig',
  'bra.1': 'Brasileirao',
  'arg.1': 'Argentina Primera',
  'sco.1': 'Scottish Premiership',
  'mex.1': 'Liga MX',
  'uefa.champions': 'UEFA Champions League',
  'uefa.europa': 'UEFA Europa League',
  atp: 'ATP',
  wta: 'WTA',
  tennis: 'Tennis',
  soccer: 'Soccer',
  basketball: 'Basketball',
  football: 'Football',
  baseball: 'Baseball',
  hockey: 'Hockey',
};

const toTitleCase = (value: string): string =>
  value
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 3) return word.toUpperCase();
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(' ');

const normalizeLeagueId = (leagueId?: string | null): string => {
  if (!leagueId) return '';
  const key = String(leagueId).trim().toLowerCase();
  return LEAGUE_ALIASES[key] ?? key;
};

export const getLeagueDisplayName = (leagueId?: string | null, sport?: string | null): string => {
  const normalizedLeague = normalizeLeagueId(leagueId);
  if (normalizedLeague && LEAGUE_DISPLAY_NAMES[normalizedLeague]) {
    return LEAGUE_DISPLAY_NAMES[normalizedLeague];
  }

  if (normalizedLeague) {
    return toTitleCase(normalizedLeague.replace(/[._-]+/g, ' '));
  }

  const fallbackSport = String(sport || '').trim().toLowerCase();
  if (fallbackSport && LEAGUE_DISPLAY_NAMES[fallbackSport]) {
    return LEAGUE_DISPLAY_NAMES[fallbackSport];
  }

  return fallbackSport ? toTitleCase(fallbackSport.replace(/[._-]+/g, ' ')) : 'League';
};
