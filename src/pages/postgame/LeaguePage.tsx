import React, { type FC, useMemo } from 'react';
import { POSTGAME_SSG_ROUTES, formatMatchDateLabel, formatPct, formatSignedNumber, leagueLabel } from '@/lib/postgamePages';
import { useLeagueMatches, useTeamsInLeague } from '@/hooks/usePostgame';
import {
  Card,
  CardBody,
  CardHeader,
  DataPill,
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

const sum = (values: Array<number | null>): number => values.reduce((total, value) => total + (value ?? 0), 0);

const avg = (values: Array<number | null>): number | null => {
  const filtered = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((total, value) => total + value, 0) / filtered.length;
};

const formatSpread = (value: number | null): string => (value === null ? '—' : formatSignedNumber(value, 1));

const resultLabel = (home: number | null, away: number | null): string => {
  if (home === null || away === null) return '—';
  if (home > away) return 'Home Win';
  if (home < away) return 'Away Win';
  return 'Draw';
};

const firstGoalBucket = (interval: string | null): string => {
  if (!interval) return 'Unknown';
  const normalized = interval.toUpperCase();
  if (normalized.includes('0-15')) return '0-15';
  if (normalized.includes('16-30')) return '16-30';
  if (normalized.includes('31-45')) return '31-45';
  if (normalized.includes('46-60')) return '46-60';
  if (normalized.includes('61-75')) return '61-75';
  if (normalized.includes('76-90')) return '76-90';
  return normalized;
};

export const LeaguePage: FC<LeaguePageProps> = ({ leagueId, query }) => {
  const selectedMatchday = query.get('matchday');
  const { data: matches, isLoading, error } = useLeagueMatches(leagueId);
  const { data: teams } = useTeamsInLeague(leagueId);

  const matchdays = useMemo(() => {
    if (!matches) return [];
    return Array.from(new Set(matches.map((match) => match.matchday).filter(Boolean)))
      .map((value) => value ?? '')
      .filter((value) => value.length > 0)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [matches]);

  const filteredMatches = useMemo(() => {
    if (!matches) return [];
    if (!selectedMatchday) return matches;
    return matches.filter((match) => match.matchday === selectedMatchday);
  }, [matches, selectedMatchday]);

  const aggregate = useMemo(() => {
    const totalMatches = filteredMatches.length;
    const homeGoals = sum(filteredMatches.map((match) => match.homeScore));
    const awayGoals = sum(filteredMatches.map((match) => match.awayScore));

    const btts = filteredMatches.filter((match) => match.gameFlow.btts === true).length;
    const scoreless = filteredMatches.filter((match) => match.gameFlow.scoreless === true).length;
    const penalties = sum(filteredMatches.map((match) => match.gameFlow.totalPenalties));
    const goals1hPct = avg(filteredMatches.map((match) => match.gameFlow.goals1HPct));

    const firstGoalMap = new Map<string, number>();
    for (const match of filteredMatches) {
      const bucket = firstGoalBucket(match.gameFlow.firstGoalInterval);
      firstGoalMap.set(bucket, (firstGoalMap.get(bucket) ?? 0) + 1);
    }

    const topFirstGoal = Array.from(firstGoalMap.entries())
      .sort((a, b) => b[1] - a[1])[0];

    return {
      totalMatches,
      totalGoals: homeGoals + awayGoals,
      avgGoals: totalMatches > 0 ? (homeGoals + awayGoals) / totalMatches : null,
      bttsRate: totalMatches > 0 ? (btts / totalMatches) * 100 : null,
      scorelessRate: totalMatches > 0 ? (scoreless / totalMatches) * 100 : null,
      totalPenalties: penalties,
      goals1hPct,
      topFirstGoalBucket: topFirstGoal?.[0] ?? '—',
      topFirstGoalCount: topFirstGoal?.[1] ?? 0,
    };
  }, [filteredMatches]);

  return (
    <PageShell>
      <TopNav />

      <header className="mb-6 space-y-2 sm:mb-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">League</p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">{leagueLabel(leagueId)}</h1>
        <p className="max-w-3xl text-sm text-zinc-400">
          Completed matches, closing DraftKings references, and v5 game-flow patterns. Source table:
          <code className="mx-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">soccer_postgame</code>
        </p>
      </header>

      {isLoading ? <LoadingBlock label="Loading league matches…" /> : null}
      {error ? <EmptyBlock message={`Failed to load ${leagueLabel(leagueId)}: ${error.message}`} /> : null}

      {matches ? (
        <div className="space-y-6 sm:space-y-8">
          <Card>
            <CardHeader className="flex flex-wrap items-center gap-3">
              <SectionLabel>Matchday Navigation</SectionLabel>
              {matchdays.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={POSTGAME_SSG_ROUTES.league(leagueId)}
                    className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-600"
                  >
                    All
                  </a>
                  {matchdays.map((matchday) => (
                    <a
                      key={matchday}
                      href={`${POSTGAME_SSG_ROUTES.league(leagueId)}?matchday=${encodeURIComponent(matchday)}`}
                      className={
                        selectedMatchday === matchday
                          ? 'rounded-md border border-zinc-500 bg-zinc-800 px-2 py-1 text-xs text-zinc-100'
                          : 'rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-600'
                      }
                    >
                      {matchday}
                    </a>
                  ))}
                </div>
              ) : null}
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <SectionLabel>League Aggregate</SectionLabel>
            </CardHeader>
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCell label="Matches" value={<ValueText>{aggregate.totalMatches}</ValueText>} />
                <MetricCell label="Total Goals" value={<ValueText>{aggregate.totalGoals}</ValueText>} />
                <MetricCell label="Avg Goals / Match" value={<ValueText>{aggregate.avgGoals?.toFixed(2) ?? '—'}</ValueText>} />
                <MetricCell label="BTTS Rate" value={<ValueText>{formatPct(aggregate.bttsRate)}</ValueText>} />
                <MetricCell label="Scoreless" value={<ValueText>{formatPct(aggregate.scorelessRate)}</ValueText>} />
                <MetricCell label="Penalties" value={<ValueText>{aggregate.totalPenalties}</ValueText>} />
                <MetricCell label="Goals In 1H" value={<ValueText>{formatPct(aggregate.goals1hPct)}</ValueText>} />
                <MetricCell
                  label="Top First Goal Window"
                  value={
                    <span className="text-sm text-zinc-200">
                      {aggregate.topFirstGoalBucket} <span className="text-zinc-500">({aggregate.topFirstGoalCount})</span>
                    </span>
                  }
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <SectionLabel>Matches</SectionLabel>
            </CardHeader>
            <CardBody className="p-0">
              {filteredMatches.length === 0 ? (
                <div className="px-4 py-6 text-sm text-zinc-400">No matches for this filter.</div>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {filteredMatches.map((match) => (
                    <a
                      key={match.id}
                      href={POSTGAME_SSG_ROUTES.match(match.slug)}
                      className="block px-4 py-4 transition-colors hover:bg-zinc-900/80 sm:px-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-zinc-100">
                            {match.homeTeam} vs {match.awayTeam}
                          </div>
                          <div className="mt-1 text-xs text-zinc-400">{formatMatchDateLabel(match.startTime)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <DataPill>
                            <ValueText>
                              {match.homeScore ?? '—'}-{match.awayScore ?? '—'}
                            </ValueText>
                          </DataPill>
                          <DataPill className="text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                            {resultLabel(match.homeScore, match.awayScore)}
                          </DataPill>
                          <DataPill>SPR {formatSpread(match.odds.spread)}</DataPill>
                          <DataPill>O/U {match.odds.total ?? '—'}</DataPill>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {teams && teams.length > 0 ? (
            <Card>
              <CardHeader>
                <SectionLabel>Teams</SectionLabel>
              </CardHeader>
              <CardBody>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {teams.map((team) => (
                    <a
                      key={team.slug}
                      href={POSTGAME_SSG_ROUTES.team(team.slug, leagueId)}
                      className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-700"
                    >
                      <span>{team.teamName}</span>
                      <span className="font-mono text-xs text-zinc-500">{team.matchCount}</span>
                    </a>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}
    </PageShell>
  );
};

export default LeaguePage;
