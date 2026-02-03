import type { Match, StatItem } from '../types';

const normalizeLabel = (value?: string): string =>
  (value || '').toLowerCase().replace(/[^a-z0-9%]/g, ' ').replace(/\s+/g, ' ').trim();

const statMatches = (label: string, patterns: string[]): boolean => {
  const needle = normalizeLabel(label);
  return patterns.some((p) => needle.includes(normalizeLabel(p)));
};

const STAT_PRIORITY: Record<string, string[][]> = {
  BASKETBALL: [
    ['fg%', 'field goal %', 'field goal pct'],
    ['3p%', '3-pt', 'three point', '3pt%'],
    ['ft%', 'free throw %'],
    ['reb', 'rebound'],
    ['ast', 'assist'],
    ['stl', 'steal'],
    ['blk', 'block'],
    ['turnover', 'tov'],
  ],
  FOOTBALL: [
    ['total yards', 'tot yds'],
    ['passing yards', 'pass yds'],
    ['rushing yards', 'rush yds'],
    ['yards per play', 'yds/play'],
    ['third down', '3rd down'],
    ['turnover'],
    ['sacks'],
    ['penalt', 'penalties'],
  ],
  HOCKEY: [
    ['shots'],
    ['faceoff', 'fo%'],
    ['hits'],
    ['blocked', 'blocks'],
    ['pim', 'penalty'],
    ['power play', 'pp'],
    ['giveaways'],
    ['takeaways'],
  ],
  SOCCER: [
    ['shots on target', 'shots on goal', 'sot'],
    ['shots'],
    ['possession'],
    ['pass', 'pass accuracy'],
    ['corners', 'corner kicks'],
    ['fouls'],
    ['yellow'],
    ['red'],
    ['offside'],
  ],
  BASEBALL: [
    ['runs'],
    ['hits'],
    ['errors'],
    ['home runs', 'hr'],
    ['rbi'],
    ['walks', 'bb'],
    ['strikeouts', 'so'],
  ],
  TENNIS: [
    ['aces'],
    ['double fault'],
    ['1st serve', 'first serve'],
    ['break point'],
    ['winners'],
    ['unforced'],
  ],
};

const detectSportKey = (match: Match): string => {
  const sportKey = String(match.sport || '').toUpperCase();
  const leagueKey = match.leagueId?.toLowerCase() || '';
  if (sportKey.includes('BASKETBALL') || leagueKey.includes('nba') || leagueKey.includes('wnba')) return 'BASKETBALL';
  if (sportKey.includes('FOOTBALL') || leagueKey.includes('nfl') || leagueKey.includes('cfb')) return 'FOOTBALL';
  if (sportKey.includes('HOCKEY') || leagueKey.includes('nhl')) return 'HOCKEY';
  if (sportKey.includes('SOCCER') || leagueKey.includes('mls')) return 'SOCCER';
  if (sportKey.includes('BASEBALL') || leagueKey.includes('mlb')) return 'BASEBALL';
  if (sportKey.includes('TENNIS') || ['atp', 'wta'].includes(leagueKey)) return 'TENNIS';
  return 'BASKETBALL';
};

export const hasLineScoreData = (match: Match): boolean => {
  const home = match.homeTeam?.linescores || [];
  const away = match.awayTeam?.linescores || [];
  const hasValue = (ls: any) => ls && ls.value !== undefined && ls.value !== null;
  return home.some(hasValue) || away.some(hasValue);
};

export const buildStatsFromTeamStats = (homeStats: any, awayStats: any): StatItem[] => {
  const homeArr = homeStats?.statistics || homeStats?.stats || [];
  const awayArr = awayStats?.statistics || awayStats?.stats || [];
  if (!Array.isArray(homeArr) || !Array.isArray(awayArr) || homeArr.length === 0) return [];

  const normalizeKey = (value?: string) =>
    (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  return homeArr
    .map((h: any) => {
      const key = normalizeKey(h.name || h.label);
      const a = awayArr.find((s: any) => normalizeKey(s.name || s.label) === key);
      if (!a) return null;
      return {
        label: String(h.label || h.name || '').toUpperCase(),
        homeValue: String(h.displayValue ?? h.value ?? ''),
        awayValue: String(a.displayValue ?? a.value ?? ''),
      };
    })
    .filter(Boolean) as StatItem[];
};

export const orderStatsBySport = (stats: StatItem[], match: Match, max = 8): StatItem[] => {
  if (!stats || stats.length === 0) return [];
  const key = detectSportKey(match);
  const patterns = STAT_PRIORITY[key] || [];
  const used = new Set<number>();
  const ordered: StatItem[] = [];

  patterns.forEach((group) => {
    const idx = stats.findIndex((s, i) => !used.has(i) && statMatches(s.label, group));
    if (idx >= 0) {
      used.add(idx);
      ordered.push(stats[idx]);
    }
  });

  const remainder = stats.filter((_, i) => !used.has(i));
  return [...ordered, ...remainder].slice(0, max);
};

export const getMatchDisplayStats = (match: Match, max = 8): StatItem[] => {
  const raw = match.stats || [];
  const fallback = buildStatsFromTeamStats(match.homeTeamStats, match.awayTeamStats);
  const base = raw.length ? raw : fallback;
  return orderStatsBySport(base, match, max);
};
