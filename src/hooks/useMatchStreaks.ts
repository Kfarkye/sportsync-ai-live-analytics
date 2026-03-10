import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Match } from '@/types';

type TrendRow = {
  layer?: string;
  league?: string;
  entity?: string;
  trend?: string;
  hit_rate?: string | number;
  sample?: number | string;
};

type LeagueBaselineRow = {
  league_id: string;
  matches_played?: string | number;
  avg_total_goals?: string | number;
  over_25_pct?: string | number;
  btts_pct?: string | number;
  clean_sheet_pct?: string | number;
};

export type StreakDotState = 'hot-up' | 'hot-down' | 'neutral';

export interface StreakDot {
  state: StreakDotState;
  label: string;
  rate: number;
}

export interface TeamStreakRow {
  id: string;
  metric: string;
  rate: number;
  sample: number;
  leagueAvg: number;
  delta: number;
  hot: boolean;
  direction: 'up' | 'down';
  sourceLeague: string;
}

export interface LeagueBaselineSummary {
  leagueId: string;
  leagueLabel: string;
  matches: number;
  avgTotal: number;
  over25: number;
  btts: number;
  cleanSheet: number;
}

export interface MatchStreakSummary {
  matchId: string;
  sport: string;
  hotCount: number;
  totalCount: number;
  ratioLabel: string;
  topLabel: string;
  topRate: number;
  dots: StreakDot[];
  home: TeamStreakRow[];
  away: TeamStreakRow[];
  crossLeagueHome: TeamStreakRow[];
  crossLeagueAway: TeamStreakRow[];
  baseline?: LeagueBaselineSummary;
  densityScore: number;
}

const LEAGUE_ALIASES: Record<string, string> = {
  epl: 'eng.1',
  laliga: 'esp.1',
  seriea: 'ita.1',
  bundesliga: 'ger.1',
  ligue1: 'fra.1',
  mls: 'usa.1',
  ncaab: 'mens-college-basketball',
};

const LEAGUE_LABELS: Record<string, string> = {
  'eng.1': 'Premier League',
  'esp.1': 'La Liga',
  'ita.1': 'Serie A',
  'ger.1': 'Bundesliga',
  'fra.1': 'Ligue 1',
  'usa.1': 'MLS',
  'uefa.champions': 'Champions League',
  'uefa.europa': 'Europa League',
  nba: 'NBA',
  nhl: 'NHL',
  nfl: 'NFL',
  mlb: 'MLB',
  'mens-college-basketball': 'NCAAB',
};

const normalizeLeagueId = (raw?: string | null): string => {
  const key = String(raw || '').trim().toLowerCase();
  return LEAGUE_ALIASES[key] || key;
};

const leagueLabel = (leagueId: string): string => LEAGUE_LABELS[leagueId] || leagueId.toUpperCase();

const normalizeName = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const nameMatches = (left: string, right: string): boolean => {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
};

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const parseRate = (value: string | number | undefined): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
};

const inferLeagueAverage = (trendText: string, baseline?: LeagueBaselineSummary): number => {
  const t = trendText.toLowerCase();
  if (!baseline) return 50;
  if (t.includes('over 2.5')) return baseline.over25;
  if (t.includes('under 2.5')) return 100 - baseline.over25;
  if (t.includes('btts') || t.includes('both teams score')) return baseline.btts;
  if (t.includes('clean sheet') || t.includes('cs ')) return baseline.cleanSheet;
  return 50;
};

const toMetricLabel = (trendText: string): string => {
  const compact = trendText.replace(/\s+/g, ' ').trim();
  const key = compact.toUpperCase();

  if (key.includes('OVER VS LINE')) return 'Games over total line';
  if (key.includes('UNDER VS LINE')) return 'Games under total line';
  if (key.includes('DOG COVER')) return 'Underdog covers';
  if (key.includes('FAV COVER')) return 'Favorite covers';
  if (key.includes('ML FORM') || key.includes('ML STREAK')) return 'Win form';
  if (key.includes('BOTH TEAMS SCORE')) return 'Both teams score';
  if (key.includes('CLEAN SHEET')) return 'Clean sheets';
  if (key.includes('OVER 2.5')) return 'Over 2.5 goals';
  if (key.includes('UNDER 2.5')) return 'Under 2.5 goals';
  if (key.includes('1H BTTS')) return 'First-half both teams score';
  if (key.includes('1H GOALS')) return 'First-half goals';
  if (key.includes('2H GOALS')) return 'Second-half goals';
  if (key.includes('LATE GOAL')) return 'Late goals';

  return compact
    .replace(/\bYES\b/gi, 'Yes')
    .replace(/\bNO\b/gi, 'No')
    .replace(/\bVS LINE\b/gi, 'vs posted line')
    .trim();
};

const isHotRun = (rate: number, sample: number, delta: number): boolean => {
  if (sample < 5) return false;
  return Math.abs(delta) >= 12 || rate >= 70 || rate <= 30;
};

const dedupeAndSort = (rows: TeamStreakRow[]): TeamStreakRow[] => {
  const byMetric = new Map<string, TeamStreakRow>();
  for (const row of rows) {
    const key = row.metric.toLowerCase();
    const current = byMetric.get(key);
    if (!current) {
      byMetric.set(key, row);
      continue;
    }
    const candidateScore = (row.hot ? 1000 : 0) + Math.abs(row.delta) * 10 + row.sample;
    const currentScore = (current.hot ? 1000 : 0) + Math.abs(current.delta) * 10 + current.sample;
    if (candidateScore > currentScore) byMetric.set(key, row);
  }

  return Array.from(byMetric.values()).sort((a, b) => {
    if (a.hot !== b.hot) return a.hot ? -1 : 1;
    if (Math.abs(a.delta) !== Math.abs(b.delta)) return Math.abs(b.delta) - Math.abs(a.delta);
    if (a.sample !== b.sample) return b.sample - a.sample;
    return a.metric.localeCompare(b.metric);
  });
};

const buildTeamRows = (
  trends: TrendRow[],
  teamNames: string[],
  leagueId: string,
  baseline?: LeagueBaselineSummary,
): TeamStreakRow[] => {
  const leagueKey = normalizeLeagueId(leagueId);
  const filtered = trends.filter((row) => {
    const rowLeague = normalizeLeagueId(row.league);
    if (rowLeague !== leagueKey) return false;
    const entity = String(row.entity || '');
    return teamNames.some((candidate) => candidate && nameMatches(candidate, entity));
  });

  const normalized = filtered
    .map((row) => {
      const trendText = String(row.trend || '').trim();
      if (!trendText) return null;
      const rate = parseRate(row.hit_rate);
      const sample = Math.max(0, Math.trunc(toNumber(row.sample)));
      const avg = inferLeagueAverage(trendText, baseline);
      const delta = rate - avg;
      const hot = isHotRun(rate, sample, delta);
      const sourceLeague = normalizeLeagueId(row.league);

      return {
        id: `${sourceLeague}:${String(row.entity || '')}:${trendText}`,
        metric: toMetricLabel(trendText),
        rate,
        sample,
        leagueAvg: avg,
        delta,
        hot,
        direction: delta >= 0 ? 'up' : 'down',
        sourceLeague,
      } as TeamStreakRow;
    })
    .filter((row): row is TeamStreakRow => Boolean(row));

  return dedupeAndSort(normalized);
};

const buildCrossLeagueRows = (
  trends: TrendRow[],
  teamNames: string[],
  currentLeagueId: string,
): TeamStreakRow[] => {
  const currentLeague = normalizeLeagueId(currentLeagueId);
  const rows = trends
    .filter((row) => {
      const rowLeague = normalizeLeagueId(row.league);
      if (!rowLeague || rowLeague === currentLeague) return false;
      const entity = String(row.entity || '');
      return teamNames.some((candidate) => candidate && nameMatches(candidate, entity));
    })
    .map((row) => {
      const trendText = String(row.trend || '').trim();
      if (!trendText) return null;
      const rate = parseRate(row.hit_rate);
      const sample = Math.max(0, Math.trunc(toNumber(row.sample)));
      const delta = rate - 50;
      const hot = isHotRun(rate, sample, delta);
      if (!hot) return null;
      const sourceLeague = normalizeLeagueId(row.league);
      return {
        id: `${sourceLeague}:${String(row.entity || '')}:${trendText}`,
        metric: `${toMetricLabel(trendText)} (${leagueLabel(sourceLeague)})`,
        rate,
        sample,
        leagueAvg: 50,
        delta,
        hot,
        direction: delta >= 0 ? 'up' : 'down',
        sourceLeague,
      } as TeamStreakRow;
    })
    .filter((row): row is TeamStreakRow => Boolean(row));

  return dedupeAndSort(rows).slice(0, 4);
};

const getTopRun = (rows: TeamStreakRow[]): TeamStreakRow | null => {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => {
    if (a.hot !== b.hot) return a.hot ? -1 : 1;
    return Math.abs(b.delta) - Math.abs(a.delta);
  })[0] || null;
};

const fetchAllTrends = async (): Promise<TrendRow[]> => {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase.rpc('get_all_trends');
  if (error) throw new Error(`get_all_trends failed: ${error.message}`);
  if (!Array.isArray(data)) return [];
  return data as TrendRow[];
};

const fetchLeagueBaselines = async (): Promise<LeagueBaselineRow[]> => {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('mv_league_structural_profiles')
    .select('league_id,matches_played,avg_total_goals,over_25_pct,btts_pct,clean_sheet_pct');
  if (error) throw new Error(`mv_league_structural_profiles failed: ${error.message}`);
  return (data || []) as LeagueBaselineRow[];
};

export function useMatchStreaks(matches: Match[]) {
  const trendsQuery = useQuery({
    queryKey: ['all-trends-global'],
    queryFn: fetchAllTrends,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
  });

  const baselineQuery = useQuery({
    queryKey: ['league-baselines'],
    queryFn: fetchLeagueBaselines,
    staleTime: 10 * 60_000,
    gcTime: 20 * 60_000,
    retry: 1,
  });

  const baselinesByLeague = useMemo(() => {
    const map = new Map<string, LeagueBaselineSummary>();
    (baselineQuery.data || []).forEach((row) => {
      const leagueId = normalizeLeagueId(row.league_id);
      map.set(leagueId, {
        leagueId,
        leagueLabel: leagueLabel(leagueId),
        matches: Math.trunc(toNumber(row.matches_played)),
        avgTotal: toNumber(row.avg_total_goals),
        over25: toNumber(row.over_25_pct),
        btts: toNumber(row.btts_pct),
        cleanSheet: toNumber(row.clean_sheet_pct),
      });
    });
    return map;
  }, [baselineQuery.data]);

  const streaksByMatch = useMemo(() => {
    const map = new Map<string, MatchStreakSummary>();
    const trends = trendsQuery.data || [];

    matches.forEach((match) => {
      const leagueId = normalizeLeagueId(match.leagueId || '');
      const baseline = baselinesByLeague.get(leagueId);
      const homeNames = [match.homeTeam?.name, match.homeTeam?.shortName]
        .map((s) => String(s || ''))
        .filter((value) => value.length >= 4);
      const awayNames = [match.awayTeam?.name, match.awayTeam?.shortName]
        .map((s) => String(s || ''))
        .filter((value) => value.length >= 4);
      const isSoccer = String(match.sport || '').toLowerCase().includes('soccer');

      const homeRows = buildTeamRows(trends, homeNames, leagueId, baseline);
      const awayRows = buildTeamRows(trends, awayNames, leagueId, baseline);
      const crossLeagueHome = isSoccer ? buildCrossLeagueRows(trends, homeNames, leagueId) : [];
      const crossLeagueAway = isSoccer ? buildCrossLeagueRows(trends, awayNames, leagueId) : [];
      const combined = [...homeRows, ...awayRows];
      const hotCount = combined.filter((row) => row.hot).length;
      const totalCount = combined.length;
      const top = getTopRun(combined);
      const avgDelta = combined.length
        ? combined.reduce((sum, row) => sum + Math.abs(row.delta), 0) / combined.length
        : 0;
      const densityScore = hotCount * 100 + avgDelta;
      const dots: StreakDot[] = combined.slice(0, 14).map((row) => ({
        state: row.hot ? (row.direction === 'up' ? 'hot-up' : 'hot-down') : 'neutral',
        label: row.metric,
        rate: row.rate,
      }));

      const summary: MatchStreakSummary = {
        matchId: match.id,
        sport: String(match.sport || ''),
        hotCount,
        totalCount,
        ratioLabel: `${hotCount}/${totalCount || 0}`,
        topLabel: top?.metric || 'No clear run yet',
        topRate: top?.rate || 0,
        dots,
        home: homeRows,
        away: awayRows,
        crossLeagueHome,
        crossLeagueAway,
        baseline,
        densityScore,
      };

      map.set(match.id, summary);
      map.set(match.id.split('_')[0] || match.id, summary);
    });

    return map;
  }, [matches, trendsQuery.data, baselinesByLeague]);

  return {
    streaksByMatch,
    isLoading: trendsQuery.isLoading || baselineQuery.isLoading,
    error: trendsQuery.error || baselineQuery.error,
  };
}
