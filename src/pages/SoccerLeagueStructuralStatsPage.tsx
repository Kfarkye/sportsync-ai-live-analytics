import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

type UnknownRow = Record<string, unknown>;

interface LeagueMetricSnapshot {
  bttsRate: number | null;
  over25Rate: number | null;
  drawRate: number | null;
  avgGoals: number | null;
  matches: number | null;
}

interface GoalBucket {
  label: string;
  value: number;
}

interface HtFtPattern {
  pattern: string;
  rate: number;
  matches: number;
}

interface LeadCollapseSnapshot {
  collapseRate: number | null;
  twoGoalLeads: number | null;
  collapses: number | null;
}

interface LeagueStatsSnapshot {
  metrics: LeagueMetricSnapshot;
  firstGoalBuckets: GoalBucket[];
  htftTopFive: HtFtPattern[];
  leadCollapse: LeadCollapseSnapshot;
}

export interface SoccerLeaguePageConfig {
  slug: string;
  path: string;
  leagueId: string;
  aliases: string[];
  name: string;
  shortName: string;
  region: string;
  synonyms?: string[];
}

const SOCCER_LEAGUE_PAGES: SoccerLeaguePageConfig[] = [
  {
    slug: 'epl-structural-stats',
    path: '/soccer/epl-structural-stats',
    leagueId: 'eng.1',
    aliases: ['eng.1', 'epl', 'premier-league', 'english-premier-league'],
    name: 'English Premier League',
    shortName: 'EPL',
    region: 'England',
    synonyms: ['premier league', 'english premier league'],
  },
  {
    slug: 'la-liga-structural-stats',
    path: '/soccer/la-liga-structural-stats',
    leagueId: 'esp.1',
    aliases: ['esp.1', 'la-liga', 'laliga', 'spanish-la-liga'],
    name: 'La Liga',
    shortName: 'La Liga',
    region: 'Spain',
    synonyms: ['la liga', 'spanish la liga'],
  },
  {
    slug: 'serie-a-structural-stats',
    path: '/soccer/serie-a-structural-stats',
    leagueId: 'ita.1',
    aliases: ['ita.1', 'serie-a', 'seriea', 'italian-serie-a'],
    name: 'Serie A',
    shortName: 'Serie A',
    region: 'Italy',
    synonyms: ['serie a', 'italian serie a'],
  },
  {
    slug: 'bundesliga-structural-stats',
    path: '/soccer/bundesliga-structural-stats',
    leagueId: 'ger.1',
    aliases: ['ger.1', 'bundesliga', 'german-bundesliga'],
    name: 'Bundesliga',
    shortName: 'Bundesliga',
    region: 'Germany',
    synonyms: ['bundesliga', 'german bundesliga'],
  },
  {
    slug: 'ligue-1-structural-stats',
    path: '/soccer/ligue-1-structural-stats',
    leagueId: 'fra.1',
    aliases: ['fra.1', 'ligue-1', 'ligue1', 'french-ligue-1'],
    name: 'Ligue 1',
    shortName: 'Ligue 1',
    region: 'France',
    synonyms: ['ligue 1', 'french ligue 1'],
  },
  {
    slug: 'mls-structural-stats',
    path: '/soccer/mls-structural-stats',
    leagueId: 'usa.1',
    aliases: ['usa.1', 'mls', 'major-league-soccer'],
    name: 'Major League Soccer',
    shortName: 'MLS',
    region: 'United States',
    synonyms: ['major league soccer', 'mls'],
  },
  {
    slug: 'ucl-structural-stats',
    path: '/soccer/ucl-structural-stats',
    leagueId: 'uefa.champions',
    aliases: ['uefa.champions', 'ucl', 'champions-league', 'uefa-champions-league'],
    name: 'UEFA Champions League',
    shortName: 'UCL',
    region: 'Europe',
    synonyms: ['champions league', 'uefa champions league', 'ucl'],
  },
];

const LEAGUE_PATH_ALIASES: Record<string, string> = {
  '/soccer/premier-league-structural-stats': '/soccer/epl-structural-stats',
  '/soccer/champions-league-structural-stats': '/soccer/ucl-structural-stats',
  '/soccer/uefa-champions-league-structural-stats': '/soccer/ucl-structural-stats',
};

const FIRST_GOAL_BUCKET_LABELS = ['0-15', '16-30', '31-45', '46-60', '61-75', '76-90+'];

const INITIAL_SNAPSHOT: LeagueStatsSnapshot = {
  metrics: {
    bttsRate: null,
    over25Rate: null,
    drawRate: null,
    avgGoals: null,
    matches: null,
  },
  firstGoalBuckets: FIRST_GOAL_BUCKET_LABELS.map((label) => ({ label, value: 0 })),
  htftTopFive: [],
  leadCollapse: {
    collapseRate: null,
    twoGoalLeads: null,
    collapses: null,
  },
};

const canonicalPathname = (pathname: string): string => {
  const trimmed = pathname.trim().toLowerCase().replace(/\/+$/, '');
  return trimmed || '/';
};

const normalizeToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizePercent = (value: number): number => {
  if (value <= 1 && value >= 0) return value * 100;
  return value;
};

const clampPercent = (value: number): number => Math.max(0, Math.min(value, 100));

const sum = (values: number[]): number => values.reduce((acc, value) => acc + value, 0);

const pickNumberFromRow = (row: UnknownRow, exactKeys: string[], fuzzyKeys: string[] = []): number | null => {
  const entries = Object.entries(row);

  for (const key of exactKeys) {
    const found = entries.find(([rowKey]) => rowKey.toLowerCase() === key.toLowerCase());
    if (!found) continue;
    const value = toNumber(found[1]);
    if (value !== null) return value;
  }

  if (!fuzzyKeys.length) return null;

  for (const [rowKey, rawValue] of entries) {
    const lower = rowKey.toLowerCase();
    if (!fuzzyKeys.some((fuzzy) => lower.includes(fuzzy.toLowerCase()))) continue;
    const value = toNumber(rawValue);
    if (value !== null) return value;
  }

  return null;
};

const pickStringFromRow = (row: UnknownRow, exactKeys: string[], fuzzyKeys: string[] = []): string | null => {
  const entries = Object.entries(row);

  for (const key of exactKeys) {
    const found = entries.find(([rowKey]) => rowKey.toLowerCase() === key.toLowerCase());
    if (!found) continue;
    if (typeof found[1] === 'string' && found[1].trim()) return found[1].trim();
  }

  if (!fuzzyKeys.length) return null;

  for (const [rowKey, rawValue] of entries) {
    const lower = rowKey.toLowerCase();
    if (!fuzzyKeys.some((fuzzy) => lower.includes(fuzzy.toLowerCase()))) continue;
    if (typeof rawValue === 'string' && rawValue.trim()) return rawValue.trim();
  }

  return null;
};

const rowMatchesLeague = (row: UnknownRow, league: SoccerLeaguePageConfig): boolean => {
  const normalizedAliases = new Set(
    [league.leagueId, ...league.aliases, league.name, league.shortName, ...(league.synonyms || [])].map(normalizeToken),
  );

  for (const value of Object.values(row)) {
    if (typeof value !== 'string') continue;
    const normalized = normalizeToken(value);
    if (!normalized) continue;

    for (const alias of normalizedAliases) {
      if (normalized === alias || normalized.includes(alias) || alias.includes(normalized)) return true;
    }
  }

  return false;
};

const formatPercent = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) return '--';
  return `${value.toFixed(1)}%`;
};

const formatAverage = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) return '--';
  return value.toFixed(2);
};

const chooseLeagueRows = (rows: UnknownRow[] | null | undefined, league: SoccerLeaguePageConfig): UnknownRow[] =>
  (rows || []).filter((row) => rowMatchesLeague(row, league));

const weightedRate = (
  rows: UnknownRow[],
  directRateKeys: string[],
  numeratorKeys: string[],
  denominatorKeys: string[],
): number | null => {
  let numeratorTotal = 0;
  let denominatorTotal = 0;
  let weightedDirectTotal = 0;
  let weightedDirectWeight = 0;

  for (const row of rows) {
    const denominator = pickNumberFromRow(row, denominatorKeys, ['match', 'game', 'sample']);
    const numerator = pickNumberFromRow(row, numeratorKeys, ['count', 'yes', 'draw']);
    const directRate = pickNumberFromRow(row, directRateKeys, ['rate', 'pct', 'percentage']);

    if (denominator !== null && denominator > 0 && numerator !== null && numerator >= 0) {
      numeratorTotal += numerator;
      denominatorTotal += denominator;
    }

    if (directRate !== null) {
      const normalizedRate = clampPercent(normalizePercent(directRate));
      const weight = denominator !== null && denominator > 0 ? denominator : 1;
      weightedDirectTotal += normalizedRate * weight;
      weightedDirectWeight += weight;
    }
  }

  if (denominatorTotal > 0) {
    return clampPercent((numeratorTotal / denominatorTotal) * 100);
  }

  if (weightedDirectWeight > 0) {
    return clampPercent(weightedDirectTotal / weightedDirectWeight);
  }

  return null;
};

const weightedAverage = (rows: UnknownRow[], valueKeys: string[], weightKeys: string[]): number | null => {
  let weightedTotal = 0;
  let weightTotal = 0;
  let fallbackTotal = 0;
  let fallbackCount = 0;

  for (const row of rows) {
    const value = pickNumberFromRow(row, valueKeys, ['avg', 'average', 'goals']);
    if (value === null) continue;

    const weight = pickNumberFromRow(row, weightKeys, ['match', 'game', 'sample']);
    if (weight !== null && weight > 0) {
      weightedTotal += value * weight;
      weightTotal += weight;
    } else {
      fallbackTotal += value;
      fallbackCount += 1;
    }
  }

  if (weightTotal > 0) return weightedTotal / weightTotal;
  if (fallbackCount > 0) return fallbackTotal / fallbackCount;
  return null;
};

const extractPrimaryMetrics = (rows: UnknownRow[]): LeagueMetricSnapshot => {
  const matches = weightedAverage(
    rows,
    ['matches', 'match_count', 'total_matches', 'games', 'sample_size'],
    ['matches', 'match_count', 'total_matches', 'games', 'sample_size'],
  );

  const bttsRate = weightedRate(
    rows,
    ['btts_rate', 'btts_pct', 'btts_percentage', 'both_teams_to_score_rate', 'both_teams_to_score_pct'],
    ['btts_yes', 'btts_count', 'both_teams_scored', 'both_teams_to_score_count'],
    ['matches', 'match_count', 'total_matches', 'games', 'sample_size'],
  );

  const over25Rate = weightedRate(
    rows,
    ['over_2_5_rate', 'over25_rate', 'over_2_5_pct', 'over25_pct', 'over_2_5_percentage'],
    ['over_2_5_count', 'over25_count', 'over_25_count', 'matches_over_2_5'],
    ['matches', 'match_count', 'total_matches', 'games', 'sample_size'],
  );

  const drawRate = weightedRate(
    rows,
    ['draw_rate', 'draw_pct', 'draw_percentage'],
    ['draw_count', 'draws'],
    ['matches', 'match_count', 'total_matches', 'games', 'sample_size'],
  );

  const avgGoals = weightedAverage(
    rows,
    ['avg_goals', 'average_goals', 'avg_total_goals', 'goals_per_match', 'avg_match_goals'],
    ['matches', 'match_count', 'total_matches', 'games', 'sample_size'],
  );

  return {
    bttsRate,
    over25Rate,
    drawRate,
    avgGoals,
    matches: matches ? Math.round(matches) : null,
  };
};

const parseBucketIndexFromLabel = (label: string): number | null => {
  const normalized = label.toLowerCase().replace(/\s+/g, '');

  if (normalized.includes('0-15') || normalized.includes('00-15')) return 0;
  if (normalized.includes('16-30') || normalized.includes('15-30')) return 1;
  if (normalized.includes('31-45') || normalized.includes('30-45')) return 2;
  if (normalized.includes('46-60') || normalized.includes('45-60')) return 3;
  if (normalized.includes('61-75') || normalized.includes('60-75')) return 4;
  if (normalized.includes('76-90') || normalized.includes('75-90') || normalized.includes('90+')) return 5;

  const match = normalized.match(/(\d{1,2})/);
  if (!match) return null;
  const minute = Number(match[1]);
  if (!Number.isFinite(minute)) return null;
  if (minute <= 15) return 0;
  if (minute <= 30) return 1;
  if (minute <= 45) return 2;
  if (minute <= 60) return 3;
  if (minute <= 75) return 4;
  return 5;
};

const parseBucketIndexFromMinute = (minute: number | null): number | null => {
  if (minute === null || !Number.isFinite(minute)) return null;
  if (minute <= 15) return 0;
  if (minute <= 30) return 1;
  if (minute <= 45) return 2;
  if (minute <= 60) return 3;
  if (minute <= 75) return 4;
  return 5;
};

const extractFirstGoalDistribution = (rows: UnknownRow[]): GoalBucket[] => {
  const bucketCounts = FIRST_GOAL_BUCKET_LABELS.map(() => 0);
  const bucketPercents = FIRST_GOAL_BUCKET_LABELS.map(() => 0);
  const bucketPercentPresent = FIRST_GOAL_BUCKET_LABELS.map(() => false);

  for (const row of rows) {
    const bucketLabel = pickStringFromRow(
      row,
      ['interval_15', 'minute_bucket', 'time_bucket', 'bucket', 'bucket_label', 'goal_bucket'],
      ['bucket', 'interval', 'minute'],
    );
    const minuteStart = pickNumberFromRow(
      row,
      ['minute', 'minute_start', 'bucket_start', 'interval_start', 'from_minute'],
      ['minute', 'start'],
    );

    const bucketIndex = bucketLabel
      ? parseBucketIndexFromLabel(bucketLabel)
      : parseBucketIndexFromMinute(minuteStart);
    if (bucketIndex === null || bucketIndex < 0 || bucketIndex >= FIRST_GOAL_BUCKET_LABELS.length) continue;

    const count = pickNumberFromRow(
      row,
      ['first_goal_count', 'bucket_count', 'count', 'matches', 'match_count'],
      ['count', 'match'],
    );
    const percent = pickNumberFromRow(
      row,
      ['first_goal_pct', 'first_goal_percentage', 'bucket_pct', 'bucket_percentage', 'pct', 'percentage', 'rate'],
      ['pct', 'percentage', 'rate', 'share'],
    );

    if (count !== null && count > 0) {
      bucketCounts[bucketIndex] += count;
    }

    if (percent !== null) {
      bucketPercents[bucketIndex] += normalizePercent(percent);
      bucketPercentPresent[bucketIndex] = true;
    }
  }

  const hasDirectPercents = bucketPercentPresent.some(Boolean);
  if (hasDirectPercents) {
    const totalPercent = sum(bucketPercents);
    if (totalPercent > 0) {
      return FIRST_GOAL_BUCKET_LABELS.map((label, index) => ({
        label,
        value: clampPercent((bucketPercents[index] / totalPercent) * 100),
      }));
    }
  }

  const totalCounts = sum(bucketCounts);
  if (totalCounts > 0) {
    return FIRST_GOAL_BUCKET_LABELS.map((label, index) => ({
      label,
      value: clampPercent((bucketCounts[index] / totalCounts) * 100),
    }));
  }

  return FIRST_GOAL_BUCKET_LABELS.map((label) => ({ label, value: 0 }));
};

const normalizePattern = (pattern: string): string =>
  pattern
    .replace(/[-|>]/g, '/')
    .replace(/\s+/g, '')
    .toUpperCase();

const extractHtFtPatterns = (rows: UnknownRow[]): HtFtPattern[] => {
  const map = new Map<string, { matches: number; weightedRate: number; weightedRateWeight: number }>();

  for (const row of rows) {
    const rawPattern =
      pickStringFromRow(row, ['htft_pattern', 'ht_ft_pattern', 'pattern', 'combo', 'ht_ft', 'htft']) ||
      (() => {
        const ht = pickStringFromRow(row, ['ht_result', 'half_time_result'], ['ht']);
        const ft = pickStringFromRow(row, ['ft_result', 'full_time_result'], ['ft']);
        if (ht && ft) return `${ht}/${ft}`;
        return null;
      })();

    if (!rawPattern) continue;

    const pattern = normalizePattern(rawPattern);
    if (!pattern) continue;

    const matches = pickNumberFromRow(
      row,
      ['matches', 'match_count', 'pattern_count', 'count', 'games'],
      ['count', 'match'],
    ) || 0;
    const rateRaw = pickNumberFromRow(
      row,
      ['pattern_rate', 'pattern_pct', 'pattern_percentage', 'rate', 'pct', 'percentage'],
      ['rate', 'pct', 'percentage'],
    );
    const rate = rateRaw === null ? null : clampPercent(normalizePercent(rateRaw));

    const current = map.get(pattern) || { matches: 0, weightedRate: 0, weightedRateWeight: 0 };
    current.matches += matches;

    if (rate !== null) {
      const weight = matches > 0 ? matches : 1;
      current.weightedRate += rate * weight;
      current.weightedRateWeight += weight;
    }

    map.set(pattern, current);
  }

  const totalMatches = sum(Array.from(map.values()).map((item) => item.matches));

  const normalized = Array.from(map.entries()).map(([pattern, value]) => {
    const derivedRate =
      value.weightedRateWeight > 0
        ? value.weightedRate / value.weightedRateWeight
        : totalMatches > 0
          ? (value.matches / totalMatches) * 100
          : 0;

    return {
      pattern,
      matches: Math.round(value.matches),
      rate: clampPercent(derivedRate),
    };
  });

  normalized.sort((a, b) => {
    if (b.matches !== a.matches) return b.matches - a.matches;
    return b.rate - a.rate;
  });

  return normalized.slice(0, 5);
};

const extractLeadCollapse = (rows: UnknownRow[]): LeadCollapseSnapshot => {
  let twoGoalLeads = 0;
  let collapses = 0;
  let weightedRateTotal = 0;
  let weightedRateWeight = 0;

  for (const row of rows) {
    const leads = pickNumberFromRow(
      row,
      ['two_goal_leads', 'total_two_goal_leads', 'lead_instances', 'lead_count'],
      ['lead'],
    );
    const collapseCount = pickNumberFromRow(
      row,
      ['collapses', 'collapse_count', 'two_goal_collapses', 'lead_collapses'],
      ['collapse'],
    );
    const collapseRate = pickNumberFromRow(
      row,
      ['collapse_rate', 'two_goal_lead_collapse_rate', 'collapse_pct', 'collapse_percentage'],
      ['collapse_rate', 'collapse_pct', 'collapse_percentage'],
    );

    if (leads !== null && leads > 0) twoGoalLeads += leads;
    if (collapseCount !== null && collapseCount > 0) collapses += collapseCount;

    if (collapseRate !== null) {
      const normalizedRate = clampPercent(normalizePercent(collapseRate));
      const weight = leads !== null && leads > 0 ? leads : 1;
      weightedRateTotal += normalizedRate * weight;
      weightedRateWeight += weight;
    }
  }

  let resolvedRate: number | null = null;
  if (twoGoalLeads > 0 && collapses >= 0) {
    resolvedRate = clampPercent((collapses / twoGoalLeads) * 100);
  } else if (weightedRateWeight > 0) {
    resolvedRate = clampPercent(weightedRateTotal / weightedRateWeight);
  }

  return {
    collapseRate: resolvedRate,
    twoGoalLeads: twoGoalLeads > 0 ? Math.round(twoGoalLeads) : null,
    collapses: collapses > 0 ? Math.round(collapses) : null,
  };
};

const withDefault = <T,>(value: T | null | undefined, fallback: T): T =>
  value === null || value === undefined ? fallback : value;

const ensureMetaTag = (selector: string, attrs: Record<string, string>, content: string): void => {
  if (typeof document === 'undefined') return;
  let tag = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement('meta');
    Object.entries(attrs).forEach(([key, value]) => tag!.setAttribute(key, value));
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
};

const ensureCanonicalTag = (href: string): void => {
  if (typeof document === 'undefined') return;
  let tag = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', 'canonical');
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', href);
};

const ensureJsonLd = (payload: Record<string, unknown>): void => {
  if (typeof document === 'undefined') return;
  let script = document.head.querySelector('#soccer-league-structural-jsonld') as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = 'soccer-league-structural-jsonld';
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(payload);
};

const readUrlOrigin = (): string => {
  if (typeof window === 'undefined') return 'https://sportsync.ai';
  return window.location.origin;
};

export const getSoccerLeagueByPathname = (pathname: string): SoccerLeaguePageConfig | null => {
  const normalized = canonicalPathname(pathname);
  const aliasResolved = LEAGUE_PATH_ALIASES[normalized] || normalized;

  return SOCCER_LEAGUE_PAGES.find((league) => league.path === aliasResolved) || null;
};

const MetricCard: React.FC<{ label: string; value: string; accent: string; helper?: string }> = ({
  label,
  value,
  accent,
  helper,
}) => {
  return (
    <article className="rounded-2xl border border-zinc-800 bg-zinc-950/70 shadow-[0_12px_40px_rgba(0,0,0,0.35)] overflow-hidden">
      <div className={`h-1 w-full ${accent}`} />
      <div className="p-5">
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">{label}</p>
        <p className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">{value}</p>
        {helper ? <p className="mt-2 text-sm text-zinc-400">{helper}</p> : null}
      </div>
    </article>
  );
};

const FIRST_GOAL_ACCENT_CLASSES = [
  'bg-gradient-to-r from-violet-500 to-fuchsia-500',
  'bg-gradient-to-r from-blue-500 to-cyan-500',
  'bg-gradient-to-r from-sky-500 to-indigo-500',
  'bg-gradient-to-r from-emerald-500 to-teal-500',
  'bg-gradient-to-r from-amber-500 to-orange-500',
  'bg-gradient-to-r from-rose-500 to-red-500',
];

const SoccerLeagueStructuralStatsPage: React.FC<{ league: SoccerLeaguePageConfig }> = ({ league }) => {
  const [snapshot, setSnapshot] = useState<LeagueStatsSnapshot>(INITIAL_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    const load = async () => {
      try {
        const [bttsRes, timingRes, htftRes, collapseRes] = await Promise.all([
          supabase.from('mv_btts_scoring_profiles').select('*'),
          supabase.from('mv_first_goal_timing').select('*'),
          supabase.from('mv_htft_patterns').select('*'),
          supabase.from('mv_two_goal_lead_analysis').select('*'),
        ]);

        const fetchErrors = [bttsRes.error, timingRes.error, htftRes.error, collapseRes.error]
          .filter(Boolean)
          .map((value) => value!.message);

        const bttsRows = chooseLeagueRows(bttsRes.data as UnknownRow[] | null | undefined, league);
        const timingRows = chooseLeagueRows(timingRes.data as UnknownRow[] | null | undefined, league);
        const htftRows = chooseLeagueRows(htftRes.data as UnknownRow[] | null | undefined, league);
        const collapseRows = chooseLeagueRows(collapseRes.data as UnknownRow[] | null | undefined, league);

        const nextSnapshot: LeagueStatsSnapshot = {
          metrics: extractPrimaryMetrics(bttsRows),
          firstGoalBuckets: extractFirstGoalDistribution(timingRows),
          htftTopFive: extractHtFtPatterns(htftRows),
          leadCollapse: extractLeadCollapse(collapseRows),
        };

        if (!live) return;

        setSnapshot(nextSnapshot);
        setError(fetchErrors.length ? fetchErrors.join(' | ') : null);
        setLastUpdated(new Date().toISOString());
      } catch (fetchError) {
        if (!live) return;
        const message = fetchError instanceof Error ? fetchError.message : 'Failed to fetch league structural stats.';
        setError(message);
      } finally {
        if (!live) return;
        setLoading(false);
      }
    };

    void load();
    const refresh = window.setInterval(() => void load(), 5 * 60 * 1000);

    return () => {
      live = false;
      window.clearInterval(refresh);
    };
  }, [league]);

  useEffect(() => {
    const origin = readUrlOrigin();
    const canonicalUrl = `${origin}${league.path}`;

    if (typeof window !== 'undefined' && canonicalPathname(window.location.pathname) !== league.path) {
      window.history.replaceState({}, '', `${league.path}${window.location.search}${window.location.hash}`);
    }

    const bttsText = formatPercent(snapshot.metrics.bttsRate);
    const overText = formatPercent(snapshot.metrics.over25Rate);
    const collapseText = formatPercent(snapshot.leadCollapse.collapseRate);
    const title = `${league.name} Structural Stats: BTTS, O2.5, HT/FT Patterns | SportSync AI`;
    const description = `${league.shortName} live structural stats from SportSync AI: BTTS ${bttsText}, Over 2.5 ${overText}, two-goal lead collapse ${collapseText}, plus first-goal timing and HT/FT pattern breakdowns.`;

    document.title = title;
    ensureCanonicalTag(canonicalUrl);
    ensureMetaTag('meta[name="description"]', { name: 'description' }, description);
    ensureMetaTag('meta[name="robots"]', { name: 'robots' }, 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1');
    ensureMetaTag('meta[property="og:type"]', { property: 'og:type' }, 'website');
    ensureMetaTag('meta[property="og:title"]', { property: 'og:title' }, title);
    ensureMetaTag('meta[property="og:description"]', { property: 'og:description' }, description);
    ensureMetaTag('meta[property="og:url"]', { property: 'og:url' }, canonicalUrl);
    ensureMetaTag('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary_large_image');
    ensureMetaTag('meta[name="twitter:title"]', { name: 'twitter:title' }, title);
    ensureMetaTag('meta[name="twitter:description"]', { name: 'twitter:description' }, description);

    ensureJsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: `${league.name} Structural Stats`,
      url: canonicalUrl,
      description,
      isPartOf: {
        '@type': 'WebSite',
        name: 'SportSync AI',
        url: origin,
      },
      mainEntity: {
        '@type': 'Dataset',
        name: `${league.name} Structural Metrics`,
        description: `Materialized-view derived structural soccer metrics for ${league.name}.`,
        creator: {
          '@type': 'Organization',
          name: 'SportSync AI',
        },
        keywords: [
          `${league.shortName} BTTS rate`,
          `${league.shortName} over 2.5 goals`,
          `${league.shortName} draw rate`,
          `${league.shortName} first goal timing`,
          `${league.shortName} HT FT patterns`,
        ],
        variableMeasured: [
          'Both teams to score rate',
          'Over 2.5 goals rate',
          'Draw rate',
          'Average goals per match',
          'First goal timing distribution',
          'HT/FT top pattern breakdown',
          'Two-goal lead collapse rate',
        ],
      },
      dateModified: withDefault(lastUpdated, new Date().toISOString()),
    });
  }, [league, snapshot, lastUpdated]);

  const pageDescription = useMemo(() => {
    if (!loading && !error) {
      return `Live structural profile for ${league.name}. BTTS rate, over 2.5 frequency, draw rate, average goals, first-goal timing distribution, top HT/FT outcomes, and two-goal lead collapse data.`;
    }
    return `Loading structural stats for ${league.name} from SportSync AI materialized views.`;
  }, [loading, error, league.name]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 right-[-10rem] h-[36rem] w-[36rem] rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute top-24 -left-24 h-[24rem] w-[24rem] rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(56,189,248,0.12),transparent_30%)]" />
      </div>

      <main className="relative mx-auto w-full max-w-6xl px-4 py-10 md:px-8 md:py-14">
        <header className="mb-8 md:mb-10">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            Live Feed
          </a>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-[0.18em] text-cyan-300/90">Obsidian Weissach v7 • League Structural Stats</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 md:text-5xl">{league.name} Structural Stats</h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-300 md:text-base">{pageDescription}</p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-zinc-400">
              <span className="rounded-full border border-zinc-700/80 bg-zinc-900/70 px-3 py-1">Region: {league.region}</span>
              <span className="rounded-full border border-zinc-700/80 bg-zinc-900/70 px-3 py-1">
                Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleString() : 'Syncing'}
              </span>
            </div>
          </div>
        </header>

        {error ? (
          <section className="mb-8 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            Some views returned partial data: {error}
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="BTTS Rate"
            value={formatPercent(snapshot.metrics.bttsRate)}
            accent="bg-gradient-to-r from-emerald-500 to-cyan-400"
            helper={snapshot.metrics.matches ? `${snapshot.metrics.matches} tracked matches` : undefined}
          />
          <MetricCard
            label="Over 2.5 Rate"
            value={formatPercent(snapshot.metrics.over25Rate)}
            accent="bg-gradient-to-r from-sky-500 to-blue-400"
          />
          <MetricCard
            label="Draw Rate"
            value={formatPercent(snapshot.metrics.drawRate)}
            accent="bg-gradient-to-r from-violet-500 to-indigo-500"
          />
          <MetricCard
            label="Avg Goals"
            value={formatAverage(snapshot.metrics.avgGoals)}
            accent="bg-gradient-to-r from-amber-500 to-orange-500"
          />
        </section>

        <section className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
          <article className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
            <h2 className="text-lg font-semibold tracking-tight text-zinc-50">First Goal Timing (15-Min Buckets)</h2>
            <p className="mt-2 text-sm text-zinc-400">Share of first goals by match clock segment.</p>
            <div className="mt-5 space-y-3">
              {snapshot.firstGoalBuckets.map((bucket, index) => (
                <div key={bucket.label}>
                  <div className="mb-1 flex items-center justify-between text-xs text-zinc-300">
                    <span className="font-semibold tracking-[0.12em]">{bucket.label}</span>
                    <span>{bucket.value.toFixed(1)}%</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${FIRST_GOAL_ACCENT_CLASSES[index]}`}
                      style={{ width: `${Math.max(0, Math.min(bucket.value, 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
            <h2 className="text-lg font-semibold tracking-tight text-zinc-50">Two-Goal Lead Collapse</h2>
            <p className="mt-2 text-sm text-zinc-400">How often a two-goal advantage fails to hold.</p>
            <p className="mt-5 text-4xl font-semibold tracking-tight text-rose-300">
              {formatPercent(snapshot.leadCollapse.collapseRate)}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">2-Goal Leads</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">
                  {snapshot.leadCollapse.twoGoalLeads ?? '--'}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">Collapses</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">
                  {snapshot.leadCollapse.collapses ?? '--'}
                </p>
              </div>
            </div>
          </article>
        </section>

        <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-50">HT/FT Pattern Breakdown (Top 5)</h2>
          <p className="mt-2 text-sm text-zinc-400">Most frequent halftime/fulltime state transitions.</p>
          <div className="mt-5 overflow-hidden rounded-xl border border-zinc-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-900/80 text-xs uppercase tracking-[0.12em] text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Pattern</th>
                  <th className="px-4 py-3">Rate</th>
                  <th className="px-4 py-3">Matches</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.htftTopFive.length ? (
                  snapshot.htftTopFive.map((row) => (
                    <tr key={row.pattern} className="border-t border-zinc-800/80">
                      <td className="px-4 py-3 font-semibold text-zinc-200">{row.pattern}</td>
                      <td className="px-4 py-3 text-zinc-300">{row.rate.toFixed(1)}%</td>
                      <td className="px-4 py-3 text-zinc-300">{row.matches || '--'}</td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-t border-zinc-800/80">
                    <td colSpan={3} className="px-4 py-6 text-center text-zinc-400">
                      {loading ? 'Loading HT/FT patterns...' : 'No HT/FT rows available for this league.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-10 text-xs text-zinc-500">
          Source views: <code>mv_btts_scoring_profiles</code>, <code>mv_first_goal_timing</code>, <code>mv_htft_patterns</code>,{' '}
          <code>mv_two_goal_lead_analysis</code>
        </footer>
      </main>
    </div>
  );
};

export default SoccerLeagueStructuralStatsPage;
