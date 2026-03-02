import React, { type FC, useMemo } from 'react';
import { formatMatchDateLabel, POSTGAME_SSG_ROUTES } from '@/lib/postgamePages';
import { useSoccerHub } from '@/hooks/usePostgame';
import {
  Card,
  CardBody,
  CardHeader,
  EmptyBlock,
  LoadingBlock,
  PageShell,
  SectionLabel,
  TopNav,
  ValueText,
} from './PostgamePrimitives';

type LeagueRow = { leagueId: string; leagueName: string; matchCount: number };

type RecentMatchRow = {
  id: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  slug: string;
  startTime: string;
};

const densityFillClass = (ratio: number): string => {
  if (ratio >= 0.75) return 'bg-slate-900';
  if (ratio >= 0.45) return 'bg-slate-700';
  return 'bg-slate-500';
};

const scoreToneClass = (home: number | null, away: number | null): string => {
  if (home === null || away === null) return 'border-slate-200 bg-slate-50 text-slate-400';
  const total = home + away;
  if (total === 0) return 'border-slate-200 bg-slate-100 text-slate-500';
  if (total >= 4) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (home === away) return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
};

const rowHeatClass = (home: number | null, away: number | null): string => {
  if (home === null || away === null) return '';
  const total = home + away;
  if (total >= 5) return 'bg-rose-50/40';
  if (total >= 4) return 'bg-amber-50/30';
  if (total === 0) return 'bg-sky-50/40';
  return '';
};

const MatchCountBar: FC<{ count: number; max: number }> = ({ count, max }) => {
  const ratio = max > 0 ? Math.min(count / max, 1) : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full transition-all duration-300 ${densityFillClass(ratio)}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-500">{count}</span>
    </div>
  );
};

const ScorePill: FC<{ home: number | null; away: number | null }> = ({ home, away }) => (
  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums ${scoreToneClass(home, away)}`}>
    {home ?? '—'}
    <span className="mx-1 text-slate-300">-</span>
    {away ?? '—'}
  </span>
);

const ResultDot: FC<{ home: number | null; away: number | null }> = ({ home, away }) => {
  if (home === null || away === null) {
    return <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />;
  }

  const dotClass = home > away ? 'bg-emerald-500' : home < away ? 'bg-rose-500' : 'bg-amber-500';
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} />;
};

const StatsStrip: FC<{ totalMatches: number; leagueCount: number; recentCount: number }> = ({
  totalMatches,
  leagueCount,
  recentCount,
}) => {
  const stats = [
    { label: 'Matches', value: totalMatches },
    { label: 'Leagues', value: leagueCount },
    { label: 'Recent', value: recentCount },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{stat.label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{stat.value}</div>
        </div>
      ))}
    </div>
  );
};

const LeagueCard: FC<{ league: LeagueRow; maxCount: number }> = ({ league, maxCount }) => {
  const ratio = maxCount > 0 ? Math.min(league.matchCount / maxCount, 1) : 0;

  return (
    <a
      key={league.leagueId}
      href={POSTGAME_SSG_ROUTES.league(league.leagueId)}
      className="group relative rounded-xl border border-slate-200 bg-white px-4 py-4 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{league.leagueName}</div>
          <div className="mt-2 flex items-center gap-2">
            <MatchCountBar count={league.matchCount} max={maxCount} />
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">matches</span>
          </div>
        </div>

        <span
          className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-semibold tabular-nums text-white ${densityFillClass(
            ratio,
          )}`}
        >
          {league.matchCount}
        </span>
      </div>
    </a>
  );
};

const MatchTable: FC<{ matches: RecentMatchRow[] }> = ({ matches }) => {
  if (matches.length === 0) {
    return <div className="px-5 py-8 text-sm text-slate-500">No completed matches found.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="border-b border-slate-200">
          <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <th className="w-8 px-4 py-3" />
            <th className="px-4 py-3">League</th>
            <th className="px-4 py-3">Match</th>
            <th className="px-4 py-3 text-center">Score</th>
            <th className="px-4 py-3 text-center">Goals</th>
            <th className="px-4 py-3 text-right">Date</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => {
            const total =
              match.homeScore === null || match.awayScore === null
                ? null
                : match.homeScore + match.awayScore;

            return (
              <tr
                key={match.id}
                className={`group border-b border-slate-100 transition-colors hover:bg-slate-50 ${rowHeatClass(
                  match.homeScore,
                  match.awayScore,
                )}`}
              >
                <td className="px-4 py-3.5">
                  <ResultDot home={match.homeScore} away={match.awayScore} />
                </td>
                <td className="px-4 py-3.5 text-xs font-medium text-slate-500">{match.leagueName}</td>
                <td className="px-4 py-3.5">
                  <a
                    href={POSTGAME_SSG_ROUTES.match(match.slug)}
                    className="font-medium tracking-tight text-slate-900 transition-colors group-hover:text-slate-700"
                  >
                    {match.homeTeam}
                    <span className="mx-1.5 text-slate-300">vs</span>
                    {match.awayTeam}
                  </a>
                </td>
                <td className="px-4 py-3.5 text-center">
                  <ScorePill home={match.homeScore} away={match.awayScore} />
                </td>
                <td className="px-4 py-3.5 text-center">
                  <span className="text-xs font-semibold tabular-nums text-slate-700">{total ?? '—'}</span>
                </td>
                <td className="px-4 py-3.5 text-right text-xs tabular-nums text-slate-500">
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

export const SoccerHubPage: FC = () => {
  const { data, isLoading, error } = useSoccerHub();

  const leagues: LeagueRow[] = data?.leagues ?? [];
  const recentMatches: RecentMatchRow[] = data?.recentMatches ?? [];

  const maxMatchCount = useMemo(() => {
    if (leagues.length === 0) return 1;
    return Math.max(...leagues.map((league) => league.matchCount), 1);
  }, [leagues]);

  const totalMatches = useMemo(() => {
    return leagues.reduce((sum, league) => sum + league.matchCount, 0);
  }, [leagues]);

  const latestLabel = useMemo(() => {
    if (recentMatches.length === 0) return 'No recent matches';
    return formatMatchDateLabel(recentMatches[0].startTime);
  }, [recentMatches]);

  return (
    <PageShell>
      <TopNav />

      <header className="mb-6 sm:mb-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Postgame Data Hub</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Soccer</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          Indexed pages for completed matches and team-level archives. All data is sourced directly from
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">soccer_postgame</code>
          with DraftKings close lines and v5 game flow fields.
        </p>
      </header>

      {isLoading ? <LoadingBlock label="Loading soccer pages…" /> : null}
      {error ? <EmptyBlock message={`Failed to load soccer hub: ${error.message}`} /> : null}

      {data ? (
        <div className="space-y-5 sm:space-y-6">
          <StatsStrip
            totalMatches={totalMatches}
            leagueCount={leagues.length}
            recentCount={recentMatches.length}
          />

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <SectionLabel>Leagues</SectionLabel>
                <span className="text-[11px] font-medium tabular-nums text-slate-500">{leagues.length} indexed</span>
              </div>
            </CardHeader>
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {leagues.map((league) => (
                  <LeagueCard key={league.leagueId} league={league} maxCount={maxMatchCount} />
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <SectionLabel>Recent Matches</SectionLabel>
                <span className="text-[11px] font-medium tabular-nums text-slate-500">{recentMatches.length} matches</span>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <MatchTable matches={recentMatches} />
            </CardBody>
          </Card>

          <div className="flex items-center justify-between border-t border-slate-200 pt-3 pb-4">
            <span className="text-xs text-slate-500">thedrip.to</span>
            <span className="text-xs tabular-nums text-slate-500">
              <ValueText className="text-xs text-slate-700">soccer_postgame</ValueText> · {totalMatches} matches · {latestLabel}
            </span>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
};

export default SoccerHubPage;
