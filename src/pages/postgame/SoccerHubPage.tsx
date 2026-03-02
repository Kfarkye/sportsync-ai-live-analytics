import React, { type FC } from 'react';
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

export const SoccerHubPage: FC = () => {
  const { data, isLoading, error } = useSoccerHub();

  return (
    <PageShell>
      <TopNav />

      <header className="mb-6 sm:mb-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">Postgame Data Hub</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">Soccer</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Indexed pages for completed matches and team-level archives. All data is sourced directly from
          <code className="mx-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">soccer_postgame</code>
          with DraftKings close lines and v5 game flow fields.
        </p>
      </header>

      {isLoading ? <LoadingBlock label="Loading soccer pages…" /> : null}
      {error ? <EmptyBlock message={`Failed to load soccer hub: ${error.message}`} /> : null}

      {data ? (
        <div className="space-y-6 sm:space-y-8">
          <Card>
            <CardHeader>
              <SectionLabel>Leagues</SectionLabel>
            </CardHeader>
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.leagues.map((league) => (
                  <a
                    key={league.leagueId}
                    href={POSTGAME_SSG_ROUTES.league(league.leagueId)}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 transition-colors hover:border-zinc-700"
                  >
                    <div className="text-sm font-semibold text-zinc-100">{league.leagueName}</div>
                    <div className="mt-1 text-xs text-zinc-400">
                      <ValueText>{league.matchCount}</ValueText> matches
                    </div>
                  </a>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <SectionLabel>Recent Matches</SectionLabel>
            </CardHeader>
            <CardBody className="p-0">
              {data.recentMatches.length === 0 ? (
                <div className="px-4 py-6 text-sm text-zinc-400">No completed matches found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="border-b border-zinc-800">
                      <tr className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                        <th className="px-4 py-3 font-medium">League</th>
                        <th className="px-4 py-3 font-medium">Match</th>
                        <th className="px-4 py-3 font-medium">Score</th>
                        <th className="px-4 py-3 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentMatches.map((match) => (
                        <tr key={match.id} className="border-b border-zinc-800/80 text-zinc-200">
                          <td className="px-4 py-3 text-xs text-zinc-400">{match.leagueName}</td>
                          <td className="px-4 py-3">
                            <a
                              href={POSTGAME_SSG_ROUTES.match(match.slug)}
                              className="font-medium text-zinc-100 hover:text-zinc-200"
                            >
                              {match.homeTeam} vs {match.awayTeam}
                            </a>
                          </td>
                          <td className="px-4 py-3">
                            <ValueText>
                              {match.homeScore ?? '—'}-{match.awayScore ?? '—'}
                            </ValueText>
                          </td>
                          <td className="px-4 py-3 text-xs text-zinc-400">{formatMatchDateLabel(match.startTime)}</td>
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

export default SoccerHubPage;
