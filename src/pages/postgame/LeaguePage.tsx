import React, { type FC, useMemo } from 'react';
import {
  POSTGAME_SSG_ROUTES,
  formatMatchDateLabel,
  formatPct,
  formatSignedNumber,
  leagueLabel,
} from '@/lib/postgamePages';
import { useLeagueMatches, useTeamsInLeague } from '@/hooks/usePostgame';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyBlock,
  LoadingBlock,
  MetricCell,
  PageShell,
  SectionLabel,
  TopNav,
  ValueText,
} from './PostgamePrimitives';

interface LeaguePageProps {
  leagueId: string;
  query: URLSearchParams;
}

type LeagueMatch = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  slug: string;
  startTime: string;
  matchday: string | null;
  odds: { spread: number | null; total: number | null };
  gameFlow: {
    btts: boolean | null;
    scoreless: boolean | null;
    totalPenalties: number | null;
    goals1HPct: number | null;
    firstGoalInterval: string | null;
    htFtResult: string | null;
  };
};

type TeamRow = { slug: string; teamName: string; matchCount: number };

const FIRST_GOAL_BUCKETS = ['1-15', '16-30', '31-45', '46-60', '61-75', '76-90'] as const;
const GOAL_BUCKETS = [0, 1, 2, 3, 4, 5] as const; // 5 => 5+
const HTFT_STATES = ['H', 'D', 'A'] as const;

const sum = (values: Array<number | null>): number =>
  values.reduce((total, value) => total + (value ?? 0), 0);

const avg = (values: Array<number | null>): number | null => {
  const clean = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (clean.length === 0) return null;
  return clean.reduce((total, value) => total + value, 0) / clean.length;
};

const formatSpread = (value: number | null): string =>
  value === null ? '—' : formatSignedNumber(value, 1);

const matchTotal = (home: number | null, away: number | null): number | null => {
  if (home === null || away === null) return null;
  return home + away;
};

const resultCode = (home: number | null, away: number | null): 'H' | 'A' | 'D' | '—' => {
  if (home === null || away === null) return '—';
  if (home > away) return 'H';
  if (home < away) return 'A';
  return 'D';
};

const resultTone = (result: 'H' | 'A' | 'D' | '—'): string => {
  if (result === 'H') return 'bg-emerald-100 text-emerald-700';
  if (result === 'A') return 'bg-rose-100 text-rose-700';
  if (result === 'D') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-500';
};

const resultDotTone = (result: 'H' | 'A' | 'D' | '—'): string => {
  if (result === 'H') return 'bg-emerald-500';
  if (result === 'A') return 'bg-rose-500';
  if (result === 'D') return 'bg-amber-500';
  return 'bg-slate-300';
};

const normalizeFirstGoalBucket = (value: string | null): (typeof FIRST_GOAL_BUCKETS)[number] | null => {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/\s+/g, '');
  if (normalized.includes('0-15') || normalized.includes('1-15')) return '1-15';
  if (normalized.includes('16-30')) return '16-30';
  if (normalized.includes('31-45')) return '31-45';
  if (normalized.includes('46-60')) return '46-60';
  if (normalized.includes('61-75')) return '61-75';
  if (normalized.includes('76-90')) return '76-90';
  return null;
};

const heatTone = (ratio: number): string => {
  if (ratio >= 0.7) return 'border-rose-300 bg-rose-100 text-rose-700';
  if (ratio >= 0.4) return 'border-amber-300 bg-amber-100 text-amber-700';
  if (ratio > 0) return 'border-slate-200 bg-slate-100 text-slate-700';
  return 'border-slate-100 bg-slate-50 text-slate-300';
};

const MiniBar: FC<{ value: number; max: number; tone?: 'neutral' | 'warm' | 'cool' }> = ({
  value,
  max,
  tone = 'neutral',
}) => {
  const pct = Math.min((value / Math.max(max, 1)) * 100, 100);
  const fill = tone === 'warm' ? 'bg-amber-500' : tone === 'cool' ? 'bg-sky-500' : 'bg-slate-700';

  return (
    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
};

const SubsectionLabel: FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
  <div className="mb-2 mt-5 flex items-center justify-between first:mt-0">
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{children}</h3>
    {right ? <span className="text-xs tabular-nums text-slate-400">{right}</span> : null}
  </div>
);

const ScorePill: FC<{ home: number | null; away: number | null }> = ({ home, away }) => {
  const total = matchTotal(home, away);

  if (total === null) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  const tone = total === 0
    ? 'border-slate-200 bg-slate-100 text-slate-600'
    : total >= 4
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : home === away
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>
      {home}
      <span className="mx-1 text-slate-300">-</span>
      {away}
    </span>
  );
};

const GoalPips: FC<{ total: number | null }> = ({ total }) => {
  if (total === null) return <span className="text-xs text-slate-400">—</span>;

  return (
    <div className="flex items-center justify-center gap-1.5">
      <div className="flex gap-px">
        {Array.from({ length: Math.min(total, 7) }).map((_, index) => {
          const tone = index < 2 ? 'bg-slate-500' : index < 4 ? 'bg-amber-500' : 'bg-rose-500';
          return <span key={index} className={`h-2.5 w-1.5 rounded-sm ${tone}`} />;
        })}
      </div>
      <span className="text-[10px] font-semibold tabular-nums text-slate-600">{total}</span>
    </div>
  );
};

const TimingHeatstrip: FC<{ bucketMap: Map<string, number>; total: number }> = ({ bucketMap, total }) => {
  const maxCount = Math.max(...Array.from(bucketMap.values()), 1);

  return (
    <div className="grid grid-cols-6 gap-1">
      {FIRST_GOAL_BUCKETS.map((bucket) => {
        const count = bucketMap.get(bucket) ?? 0;
        const pct = total > 0 ? (count / total) * 100 : 0;
        const cellClass = heatTone(count / maxCount);

        return (
          <div key={bucket} className={`rounded border px-2 py-2 text-center ${cellClass}`}>
            <div className="text-xs font-semibold tabular-nums">{count > 0 ? `${pct.toFixed(0)}%` : '—'}</div>
            <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em]">{bucket}</div>
          </div>
        );
      })}
    </div>
  );
};

const GoalDistStrip: FC<{ dist: Map<number, number>; total: number }> = ({ dist, total }) => {
  const maxCount = Math.max(...GOAL_BUCKETS.map((bucket) => dist.get(bucket) ?? 0), 1);

  return (
    <div className="grid grid-cols-6 gap-1">
      {GOAL_BUCKETS.map((bucket) => {
        const count = dist.get(bucket) ?? 0;
        const pct = total > 0 ? (count / total) * 100 : 0;
        const cellClass = heatTone(count / maxCount);

        return (
          <div key={bucket} className={`rounded border px-2 py-2 text-center ${cellClass}`}>
            <div className="text-xs font-semibold tabular-nums">{count > 0 ? `${pct.toFixed(0)}%` : '—'}</div>
            <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em]">{bucket === 5 ? '5+' : bucket}</div>
            <div className="text-[9px] tabular-nums opacity-70">{count > 0 ? count : ''}</div>
          </div>
        );
      })}
    </div>
  );
};

const ScorelineGrid: FC<{ grid: Map<string, number>; total: number }> = ({ grid, total }) => {
  const axis = [0, 1, 2, 3, 4] as const;
  const maxCount = Math.max(...Array.from(grid.values()), 1);

  return (
    <div className="space-y-1">
      <div className="ml-10 grid grid-cols-5 gap-1">
        {axis.map((away) => (
          <div key={away} className="text-center text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            A {away === 4 ? '4+' : away}
          </div>
        ))}
      </div>
      {axis.map((home) => (
        <div key={home} className="grid grid-cols-[2.5rem_repeat(5,minmax(0,1fr))] gap-1">
          <div className="flex items-center justify-end pr-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            H {home === 4 ? '4+' : home}
          </div>
          {axis.map((away) => {
            const key = `${Math.min(home, 4)}-${Math.min(away, 4)}`;
            const count = grid.get(key) ?? 0;
            const pct = total > 0 ? (count / total) * 100 : 0;
            const cellClass = heatTone(count / maxCount);

            return (
              <div key={`${home}-${away}`} className={`rounded border py-2 text-center ${cellClass}`}>
                <div className="text-xs font-semibold tabular-nums">{count > 0 ? `${pct.toFixed(0)}%` : '·'}</div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const HtftGrid: FC<{ htftMap: Map<string, number>; total: number }> = ({ htftMap, total }) => {
  const maxCount = Math.max(...Array.from(htftMap.values()), 1);

  return (
    <div className="space-y-1">
      <div className="ml-10 grid grid-cols-3 gap-1">
        {HTFT_STATES.map((ft) => (
          <div key={ft} className="text-center text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            FT {ft}
          </div>
        ))}
      </div>
      {HTFT_STATES.map((ht) => (
        <div key={ht} className="grid grid-cols-[2.5rem_repeat(3,minmax(0,1fr))] gap-1">
          <div className="flex items-center justify-end pr-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            HT {ht}
          </div>
          {HTFT_STATES.map((ft) => {
            const key = `${ht}/${ft}`;
            const count = htftMap.get(key) ?? 0;
            const pct = total > 0 ? (count / total) * 100 : 0;
            const cellClass = heatTone(count / maxCount);

            return (
              <div key={key} className={`rounded border py-2 text-center ${cellClass}`}>
                <div className="text-xs font-semibold tabular-nums">{count > 0 ? `${pct.toFixed(0)}%` : '—'}</div>
                <div className="text-[9px] tabular-nums opacity-70">{key}</div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

type SetRow = {
  label: string;
  value: string;
  barValue?: number;
  barMax?: number;
  tone?: 'neutral' | 'warm' | 'cool';
};

const SetTable: FC<{ rows: SetRow[] }> = ({ rows }) => (
  <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/70">
    {rows.map((row) => (
      <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
        <span className="text-sm text-slate-600">{row.label}</span>
        <div className="flex items-center gap-2">
          {typeof row.barValue === 'number' && typeof row.barMax === 'number' ? (
            <MiniBar value={row.barValue} max={row.barMax} tone={row.tone} />
          ) : null}
          <span className="w-16 text-right text-sm font-semibold tabular-nums text-slate-800">{row.value}</span>
        </div>
      </div>
    ))}
  </div>
);

const MatchdayNav: FC<{ matchdays: string[]; selected: string | null; leagueId: string }> = ({
  matchdays,
  selected,
  leagueId,
}) => {
  if (matchdays.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <SectionLabel>Matchday</SectionLabel>
          <span className="text-[11px] tabular-nums text-slate-500">{matchdays.length} rounds</span>
        </div>
      </CardHeader>
      <CardBody>
        <div className="flex flex-wrap gap-1.5">
          <a
            href={POSTGAME_SSG_ROUTES.league(leagueId)}
            className={
              selected === null
                ? 'rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white'
                : 'rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300'
            }
          >
            All
          </a>
          {matchdays.map((matchday) => {
            const active = selected === matchday;
            return (
              <a
                key={matchday}
                href={`${POSTGAME_SSG_ROUTES.league(leagueId)}?matchday=${encodeURIComponent(matchday)}`}
                className={
                  active
                    ? 'rounded-md border border-slate-900 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-white'
                    : 'rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-slate-600 hover:border-slate-300'
                }
              >
                {matchday}
              </a>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
};

const MatchTable: FC<{ matches: LeagueMatch[] }> = ({ matches }) => {
  if (matches.length === 0) {
    return <div className="px-5 py-8 text-center text-sm text-slate-500">No matches for this filter.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="border-b-2 border-slate-200">
          <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <th className="w-6 px-3 py-3" />
            <th className="px-3 py-3">Match</th>
            <th className="px-3 py-3 text-center">Score</th>
            <th className="px-3 py-3 text-center">Goals</th>
            <th className="px-3 py-3 text-center">Spread</th>
            <th className="px-3 py-3 text-center">O/U</th>
            <th className="px-3 py-3 text-center">Result</th>
            <th className="px-3 py-3 text-right">Date</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => {
            const total = matchTotal(match.homeScore, match.awayScore);
            const result = resultCode(match.homeScore, match.awayScore);
            const overHit = match.odds.total !== null && total !== null && total > match.odds.total;
            const underHit = match.odds.total !== null && total !== null && total < match.odds.total;

            return (
              <tr key={match.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                <td className="px-3 py-3.5">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${resultDotTone(result)}`} />
                </td>
                <td className="px-3 py-3.5">
                  <a
                    href={POSTGAME_SSG_ROUTES.match(match.slug)}
                    className="font-medium tracking-tight text-slate-900 transition-colors hover:text-slate-700"
                  >
                    {match.homeTeam}
                    <span className="mx-1.5 text-slate-300">vs</span>
                    {match.awayTeam}
                  </a>
                </td>
                <td className="px-3 py-3.5 text-center">
                  <ScorePill home={match.homeScore} away={match.awayScore} />
                </td>
                <td className="px-3 py-3.5 text-center">
                  <GoalPips total={total} />
                </td>
                <td className="px-3 py-3.5 text-center">
                  <span className="text-xs tabular-nums text-slate-600">{formatSpread(match.odds.spread)}</span>
                </td>
                <td className="px-3 py-3.5 text-center">
                  <span
                    className={`text-xs tabular-nums ${overHit ? 'font-semibold text-rose-700' : underHit ? 'font-semibold text-sky-700' : 'text-slate-600'}`}
                  >
                    {match.odds.total ?? '—'}
                  </span>
                </td>
                <td className="px-3 py-3.5 text-center">
                  <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${resultTone(result)}`}>
                    {result}
                  </span>
                </td>
                <td className="px-3 py-3.5 text-right text-xs tabular-nums text-slate-500">
                  {formatMatchDateLabel(match.startTime)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const TeamCard: FC<{ team: TeamRow; leagueId: string; maxCount: number }> = ({
  team,
  leagueId,
  maxCount,
}) => {
  const ratio = Math.min(team.matchCount / Math.max(maxCount, 1), 1);

  return (
    <a
      href={POSTGAME_SSG_ROUTES.team(team.slug, leagueId)}
      className="group rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-slate-800">{team.teamName}</span>
        <span className="text-xs font-semibold tabular-nums text-slate-600">{team.matchCount}</span>
      </div>
      <div className="mt-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-slate-700" style={{ width: `${ratio * 100}%` }} />
        </div>
      </div>
    </a>
  );
};

export const LeaguePage: FC<LeaguePageProps> = ({ leagueId, query }) => {
  const selectedMatchday = query.get('matchday');
  const { data: rawMatches, isLoading, error } = useLeagueMatches(leagueId);
  const { data: rawTeams } = useTeamsInLeague(leagueId);

  const matches: LeagueMatch[] = rawMatches ?? [];
  const teams: TeamRow[] = rawTeams ?? [];

  const matchdays = useMemo(() => {
    return Array.from(new Set(matches.map((match) => match.matchday).filter(Boolean)))
      .map((value) => value ?? '')
      .filter((value) => value.length > 0)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [matches]);

  const filteredMatches = useMemo(() => {
    if (!selectedMatchday) return matches;
    return matches.filter((match) => match.matchday === selectedMatchday);
  }, [matches, selectedMatchday]);

  const aggregate = useMemo(() => {
    const n = filteredMatches.length;
    const validScoreRows = filteredMatches.filter(
      (match) => match.homeScore !== null && match.awayScore !== null,
    );

    const homeGoals = sum(filteredMatches.map((match) => match.homeScore));
    const awayGoals = sum(filteredMatches.map((match) => match.awayScore));
    const totalGoals = homeGoals + awayGoals;

    const bttsCount = filteredMatches.filter((match) => match.gameFlow.btts === true).length;
    const scorelessCount = filteredMatches.filter((match) => match.gameFlow.scoreless === true).length;
    const totalPenalties = sum(filteredMatches.map((match) => match.gameFlow.totalPenalties));
    const goals1hPct = avg(filteredMatches.map((match) => match.gameFlow.goals1HPct));

    const homeWins = validScoreRows.filter((match) => (match.homeScore ?? 0) > (match.awayScore ?? 0)).length;
    const draws = validScoreRows.filter((match) => match.homeScore === match.awayScore).length;
    const awayWins = validScoreRows.filter((match) => (match.homeScore ?? 0) < (match.awayScore ?? 0)).length;

    const firstGoalMap = new Map<string, number>();
    for (const match of filteredMatches) {
      const bucket = normalizeFirstGoalBucket(match.gameFlow.firstGoalInterval);
      if (!bucket) continue;
      firstGoalMap.set(bucket, (firstGoalMap.get(bucket) ?? 0) + 1);
    }

    const topFirstGoal = Array.from(firstGoalMap.entries()).sort((a, b) => b[1] - a[1])[0];

    const goalDist = new Map<number, number>();
    for (const match of validScoreRows) {
      const total = (match.homeScore ?? 0) + (match.awayScore ?? 0);
      const bucket = Math.min(total, 5);
      goalDist.set(bucket, (goalDist.get(bucket) ?? 0) + 1);
    }

    const scorelineGrid = new Map<string, number>();
    for (const match of validScoreRows) {
      const key = `${Math.min(match.homeScore ?? 0, 4)}-${Math.min(match.awayScore ?? 0, 4)}`;
      scorelineGrid.set(key, (scorelineGrid.get(key) ?? 0) + 1);
    }

    const htftMap = new Map<string, number>();
    for (const match of filteredMatches) {
      const htft = match.gameFlow.htFtResult;
      if (!htft || !htft.includes('/')) continue;
      htftMap.set(htft, (htftMap.get(htft) ?? 0) + 1);
    }

    let overHits = 0;
    let underHits = 0;
    let pushes = 0;
    let ouMatches = 0;

    for (const match of validScoreRows) {
      if (match.odds.total === null) continue;
      ouMatches += 1;
      const total = (match.homeScore ?? 0) + (match.awayScore ?? 0);
      if (total > match.odds.total) overHits += 1;
      else if (total < match.odds.total) underHits += 1;
      else pushes += 1;
    }

    const over15 = validScoreRows.filter((match) => (match.homeScore ?? 0) + (match.awayScore ?? 0) > 1.5).length;
    const over25 = validScoreRows.filter((match) => (match.homeScore ?? 0) + (match.awayScore ?? 0) > 2.5).length;
    const over35 = validScoreRows.filter((match) => (match.homeScore ?? 0) + (match.awayScore ?? 0) > 3.5).length;

    return {
      n,
      totalGoals,
      homeGoals,
      awayGoals,
      avgGoals: n > 0 ? totalGoals / n : null,
      bttsRate: n > 0 ? (bttsCount / n) * 100 : null,
      scorelessRate: n > 0 ? (scorelessCount / n) * 100 : null,
      totalPenalties,
      goals1hPct,
      homeWins,
      draws,
      awayWins,
      homeWinPct: n > 0 ? (homeWins / n) * 100 : 0,
      drawPct: n > 0 ? (draws / n) * 100 : 0,
      awayWinPct: n > 0 ? (awayWins / n) * 100 : 0,
      topFirstGoalBucket: topFirstGoal?.[0] ?? '—',
      topFirstGoalCount: topFirstGoal?.[1] ?? 0,
      firstGoalMap,
      goalDist,
      scorelineGrid,
      htftMap,
      overHits,
      underHits,
      pushes,
      ouMatches,
      over15Rate: validScoreRows.length > 0 ? (over15 / validScoreRows.length) * 100 : 0,
      over25Rate: validScoreRows.length > 0 ? (over25 / validScoreRows.length) * 100 : 0,
      over35Rate: validScoreRows.length > 0 ? (over35 / validScoreRows.length) * 100 : 0,
      bttsCount,
      scorelessCount,
      penaltyRate: validScoreRows.length > 0 ? (totalPenalties / validScoreRows.length) * 100 : 0,
      validScoreCount: validScoreRows.length,
    };
  }, [filteredMatches]);

  const maxTeamCount = useMemo(() => {
    if (teams.length === 0) return 1;
    return Math.max(...teams.map((team) => team.matchCount), 1);
  }, [teams]);

  const latestLabel = useMemo(() => {
    if (filteredMatches.length === 0) return 'No recent matches';
    return formatMatchDateLabel(filteredMatches[0].startTime);
  }, [filteredMatches]);

  return (
    <PageShell>
      <TopNav />

      <header className="mb-6 sm:mb-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">League</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {leagueLabel(leagueId)}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          Completed matches, closing DraftKings references, and v5 game-flow patterns. Source table:
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">soccer_postgame</code>
        </p>
      </header>

      {isLoading ? <LoadingBlock label="Loading league matches…" /> : null}
      {error ? <EmptyBlock message={`Failed to load ${leagueLabel(leagueId)}: ${error.message}`} /> : null}

      {rawMatches ? (
        <div className="space-y-5 sm:space-y-6">
          <MatchdayNav matchdays={matchdays} selected={selectedMatchday} leagueId={leagueId} />

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <SectionLabel>League Aggregate</SectionLabel>
                <span className="text-xs tabular-nums text-slate-500">n = {aggregate.n}</span>
              </div>
            </CardHeader>
            <CardBody>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCell
                  label="Avg Goals"
                  value={<ValueText>{aggregate.avgGoals?.toFixed(2) ?? '—'}</ValueText>}
                  className="bg-white"
                />
                <MetricCell
                  label="BTTS Rate"
                  value={<ValueText>{formatPct(aggregate.bttsRate)}</ValueText>}
                  className="bg-white"
                />
                <MetricCell
                  label="Scoreless"
                  value={<ValueText>{formatPct(aggregate.scorelessRate)}</ValueText>}
                  className="bg-white"
                />
                <MetricCell
                  label="Goals In 1H"
                  value={<ValueText>{formatPct(aggregate.goals1hPct)}</ValueText>}
                  className="bg-white"
                />
              </div>

              <SubsectionLabel>Match Outcomes</SubsectionLabel>
              <div className="grid grid-cols-3 gap-1">
                {[
                  {
                    label: 'Home',
                    pct: aggregate.homeWinPct,
                    count: aggregate.homeWins,
                    tone: 'bg-emerald-100 text-emerald-700',
                  },
                  {
                    label: 'Draw',
                    pct: aggregate.drawPct,
                    count: aggregate.draws,
                    tone: 'bg-amber-100 text-amber-700',
                  },
                  {
                    label: 'Away',
                    pct: aggregate.awayWinPct,
                    count: aggregate.awayWins,
                    tone: 'bg-sky-100 text-sky-700',
                  },
                ].map((segment) => (
                  <div key={segment.label} className={`rounded-md px-2 py-2 text-center ${segment.tone}`}>
                    <div className="text-sm font-semibold tabular-nums">{segment.pct.toFixed(1)}%</div>
                    <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]">
                      {segment.label} ({segment.count})
                    </div>
                  </div>
                ))}
              </div>

              <SubsectionLabel right={`${aggregate.validScoreCount} with scores`}>
                Market Rates
              </SubsectionLabel>
              <SetTable
                rows={[
                  {
                    label: 'Over 1.5 Goals',
                    value: `${aggregate.over15Rate.toFixed(1)}%`,
                    barValue: aggregate.over15Rate,
                    barMax: 100,
                    tone: 'neutral',
                  },
                  {
                    label: 'Over 2.5 Goals',
                    value: `${aggregate.over25Rate.toFixed(1)}%`,
                    barValue: aggregate.over25Rate,
                    barMax: 100,
                    tone: 'warm',
                  },
                  {
                    label: 'Over 3.5 Goals',
                    value: `${aggregate.over35Rate.toFixed(1)}%`,
                    barValue: aggregate.over35Rate,
                    barMax: 100,
                    tone: 'warm',
                  },
                  {
                    label: 'BTTS',
                    value: formatPct(aggregate.bttsRate),
                    barValue: aggregate.bttsRate ?? 0,
                    barMax: 100,
                    tone: 'neutral',
                  },
                  {
                    label: 'Scoreless',
                    value: formatPct(aggregate.scorelessRate),
                    barValue: aggregate.scorelessRate ?? 0,
                    barMax: 20,
                    tone: 'cool',
                  },
                  {
                    label: 'Penalty Rate',
                    value: `${aggregate.penaltyRate.toFixed(1)}%`,
                    barValue: aggregate.penaltyRate,
                    barMax: 50,
                    tone: 'neutral',
                  },
                ]}
              />

              {aggregate.ouMatches > 0 ? (
                <>
                  <SubsectionLabel right={`${aggregate.ouMatches} with lines`}>
                    Closing O/U Coverage
                  </SubsectionLabel>
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      {
                        label: 'Over',
                        pct: (aggregate.overHits / aggregate.ouMatches) * 100,
                        count: aggregate.overHits,
                        tone: 'bg-rose-100 text-rose-700',
                      },
                      {
                        label: 'Push',
                        pct: (aggregate.pushes / aggregate.ouMatches) * 100,
                        count: aggregate.pushes,
                        tone: 'bg-amber-100 text-amber-700',
                      },
                      {
                        label: 'Under',
                        pct: (aggregate.underHits / aggregate.ouMatches) * 100,
                        count: aggregate.underHits,
                        tone: 'bg-sky-100 text-sky-700',
                      },
                    ].map((segment) => (
                      <div key={segment.label} className={`rounded-md px-2 py-2 text-center ${segment.tone}`}>
                        <div className="text-sm font-semibold tabular-nums">{segment.pct.toFixed(1)}%</div>
                        <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]">
                          {segment.label} ({segment.count})
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {aggregate.firstGoalMap.size > 0 ? (
                <>
                  <SubsectionLabel>First Goal Distribution</SubsectionLabel>
                  <TimingHeatstrip bucketMap={aggregate.firstGoalMap} total={aggregate.n} />
                </>
              ) : null}

              {aggregate.goalDist.size > 0 ? (
                <>
                  <SubsectionLabel right="total goals per match">Goal Distribution</SubsectionLabel>
                  <GoalDistStrip dist={aggregate.goalDist} total={aggregate.n} />
                </>
              ) : null}
            </CardBody>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            {aggregate.scorelineGrid.size > 0 ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <SectionLabel>Scoreline Frequency</SectionLabel>
                    <span className="text-xs tabular-nums text-slate-500">heatmap</span>
                  </div>
                </CardHeader>
                <CardBody>
                  <ScorelineGrid grid={aggregate.scorelineGrid} total={aggregate.n} />
                </CardBody>
              </Card>
            ) : null}

            {aggregate.htftMap.size > 0 ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <SectionLabel>HT / FT Flow</SectionLabel>
                    <span className="text-xs tabular-nums text-slate-500">heatmap</span>
                  </div>
                </CardHeader>
                <CardBody>
                  <HtftGrid htftMap={aggregate.htftMap} total={aggregate.n} />
                </CardBody>
              </Card>
            ) : null}
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <SectionLabel>Matches</SectionLabel>
                <span className="text-xs tabular-nums text-slate-500">{filteredMatches.length} results</span>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <MatchTable matches={filteredMatches} />
            </CardBody>
          </Card>

          {teams.length > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <SectionLabel>Teams</SectionLabel>
                  <span className="text-xs tabular-nums text-slate-500">{teams.length} indexed</span>
                </div>
              </CardHeader>
              <CardBody>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {teams.map((team) => (
                    <TeamCard key={team.slug} team={team} leagueId={leagueId} maxCount={maxTeamCount} />
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          <div className="flex items-center justify-between border-t border-slate-200 pb-4 pt-3">
            <span className="text-xs text-slate-500">thedrip.to</span>
            <span className="text-xs tabular-nums text-slate-500">
              soccer_postgame · {aggregate.n} matches · {latestLabel}
            </span>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
};

export default LeaguePage;
