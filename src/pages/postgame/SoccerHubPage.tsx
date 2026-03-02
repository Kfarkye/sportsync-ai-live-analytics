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
                    className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 transition-colors hover:border-slate-300 hover:bg-white"
                  >
                    <div className="text-sm font-semibold text-slate-900">{league.leagueName}</div>
                    <div className="mt-1 text-xs text-slate-500">
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
                <div className="px-4 py-6 text-sm text-slate-500">No completed matches found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="border-b border-slate-200">
                      <tr className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        <th className="px-4 py-3 font-medium">League</th>
                        <th className="px-4 py-3 font-medium">Match</th>
                        <th className="px-4 py-3 font-medium">Score</th>
                        <th className="px-4 py-3 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentMatches.map((match) => (
                        <tr key={match.id} className="border-b border-slate-200 text-slate-800">
                          <td className="px-4 py-3 text-xs text-slate-500">{match.leagueName}</td>
                          <td className="px-4 py-3">
                            <a
                              href={POSTGAME_SSG_ROUTES.match(match.slug)}
                              className="font-medium text-slate-900 hover:text-slate-800"
                            >
                              {match.homeTeam} vs {match.awayTeam}
                            </a>
                          </td>
                          <td className="px-4 py-3">
                            <ValueText>
                              {match.homeScore ?? '—'}-{match.awayScore ?? '—'}
                            </ValueText>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">{formatMatchDateLabel(match.startTime)}</td>
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
