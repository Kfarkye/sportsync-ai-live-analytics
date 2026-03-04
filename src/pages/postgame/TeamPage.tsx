import React, { type FC } from 'react';
import { formatMatchDateLabel, formatPct, formatSignedNumber, leagueLabel } from '@/lib/postgamePages';
import { useTeamPage } from '@/hooks/usePostgame';
import { useTeamHistory } from '@/hooks/useTeamHistory';
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

interface TeamPageProps {
  teamSlug: string;
  query: URLSearchParams;
}

const rangeText = (range: { min: number | null; max: number | null; avg: number | null }, decimals = 1): string => {
  if (range.min === null || range.max === null || range.avg === null) return '—';
  return `${formatSignedNumber(range.min, decimals)} to ${formatSignedNumber(range.max, decimals)} (avg ${formatSignedNumber(range.avg, decimals)})`;
};

const resultTone = (value: 'W' | 'D' | 'L' | '—' | 'P' | 'O' | 'U') => {
  if (value === 'W' || value === 'O') return 'text-emerald-700';
  if (value === 'L' || value === 'U') return 'text-rose-700';
  return 'text-slate-700';
};

export const TeamPage: FC<TeamPageProps> = ({ teamSlug, query }) => {
  const leagueParam = query.get('league');
  const { data, isLoading, error } = useTeamPage(teamSlug, leagueParam);
  const {
    data: historyRows = [],
    isLoading: isHistoryLoading,
    error: historyError,
  } = useTeamHistory(teamSlug, leagueParam);

  const seasonRows = historyRows.length > 0 ? historyRows : (data?.rows ?? []);
  const seasonRecord = seasonRows.reduce(
    (acc, row) => {
      if (row.result === 'W') acc.wins += 1;
      if (row.result === 'D') acc.draws += 1;
      if (row.result === 'L') acc.losses += 1;
      acc.goalsFor += row.teamScore ?? 0;
      acc.goalsAgainst += row.oppScore ?? 0;
      return acc;
    },
    { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
  );

  return (
    <PageShell>
      <TopNav />

      {isLoading ? <LoadingBlock label="Loading team archive…" /> : null}
      {error ? <EmptyBlock message={`Failed to load team page: ${error.message}`} /> : null}

      {data ? (
        <div className="space-y-6 sm:space-y-8">
          <header className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Team</p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{data.teamName}</h1>
            <p className="text-sm text-slate-500">
              {data.leagueId ? leagueLabel(data.leagueId) : 'All Leagues'} · <ValueText>{seasonRows.length}</ValueText> matches
            </p>
          </header>

          {historyError ? (
            <EmptyBlock message={`Team history fallback active (using postgame rows): ${historyError.message}`} />
          ) : null}

          <Card>
            <CardHeader>
              <SectionLabel>Aggregate Stats</SectionLabel>
            </CardHeader>
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCell
                  label="Record"
                  value={
                    <ValueText>
                      {seasonRecord.wins}-{seasonRecord.draws}-{seasonRecord.losses}
                    </ValueText>
                  }
                />
                <MetricCell
                  label="Goals"
                  value={
                    <ValueText>
                      {seasonRecord.goalsFor}:{seasonRecord.goalsAgainst}
                    </ValueText>
                  }
                />
                <MetricCell
                  label="Avg Possession"
                  value={<ValueText>{data.aggregate.avgPossession === null ? '—' : `${data.aggregate.avgPossession.toFixed(1)}%`}</ValueText>}
                />
                <MetricCell
                  label="Avg xG"
                  value={
                    <ValueText>
                      {data.aggregate.avgXgFor === null ? '—' : data.aggregate.avgXgFor.toFixed(2)} /{' '}
                      {data.aggregate.avgXgAgainst === null ? '—' : data.aggregate.avgXgAgainst.toFixed(2)}
                    </ValueText>
                  }
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <SectionLabel>v5 Trends</SectionLabel>
            </CardHeader>
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCell label="BTTS" value={<ValueText>{formatPct(data.trends.bttsRate)}</ValueText>} />
                <MetricCell label="First Goal" value={<ValueText>{formatPct(data.trends.firstGoalRate)}</ValueText>} />
                <MetricCell label="Scored Both Halves" value={<ValueText>{formatPct(data.trends.scoredBothHalvesRate)}</ValueText>} />
                <MetricCell label="Late Goal Frequency" value={<ValueText>{formatPct(data.trends.lateGoalRate)}</ValueText>} />
                <MetricCell label="ML Trend" value={<span className="text-xs text-slate-700">{rangeText(data.trends.mlRange, 0)}</span>} />
                <MetricCell label="Spread Trend" value={<span className="text-xs text-slate-700">{rangeText(data.trends.spreadRange, 1)}</span>} />
                <MetricCell label="Total Trend" value={<span className="text-xs text-slate-700">{rangeText(data.trends.totalRange, 1)}</span>} className="sm:col-span-2 lg:col-span-1" />
              </div>

              {data.trends.htFtDistribution.length > 0 ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {data.trends.htFtDistribution.slice(0, 8).map((item) => (
                    <div key={item.key} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <div className="text-slate-500">HT/FT</div>
                      <div className="mt-1 font-mono text-slate-800">
                        {item.key} <span className="text-slate-500">({item.count})</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <SectionLabel>Season Results</SectionLabel>
            </CardHeader>
            <CardBody className="p-0">
              {isHistoryLoading && (data?.rows?.length ?? 0) === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">Loading team history…</div>
              ) : seasonRows.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">No team matches found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="border-b border-slate-200">
                      <tr className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Opponent</th>
                        <th className="px-4 py-3 font-medium">Score</th>
                        <th className="px-4 py-3 font-medium">Result</th>
                        <th className="px-4 py-3 font-medium">ATS</th>
                        <th className="px-4 py-3 font-medium">O/U</th>
                        <th className="px-4 py-3 font-medium">Lines</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seasonRows.map((row) => (
                        <tr key={row.matchId} className="border-b border-slate-200 text-slate-800">
                          <td className="px-4 py-3 text-xs text-slate-500">{formatMatchDateLabel(row.startTime)}</td>
                          <td className="px-4 py-3">
                            <a href={`/match/${row.matchSlug}`} className="font-medium text-slate-900 hover:text-slate-800">
                              {row.isHome ? 'vs' : '@'} {row.opponent}
                            </a>
                          </td>
                          <td className="px-4 py-3">
                            <ValueText>
                              {row.teamScore ?? '—'}-{row.oppScore ?? '—'}
                            </ValueText>
                          </td>
                          <td className={`px-4 py-3 font-mono ${resultTone(row.result)}`}>{row.result}</td>
                          <td className={`px-4 py-3 font-mono ${resultTone(row.atsResult)}`}>{row.atsResult}</td>
                          <td className={`px-4 py-3 font-mono ${resultTone(row.ouResult)}`}>{row.ouResult}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <DataPill>SPR {row.spread === null ? '—' : formatSignedNumber(row.spread, 1)}</DataPill>
                              <DataPill>O/U {row.total ?? '—'}</DataPill>
                              <DataPill>ML {row.moneyline === null ? '—' : formatSignedNumber(row.moneyline, 0)}</DataPill>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </PageShell>
  );
};

export default TeamPage;
