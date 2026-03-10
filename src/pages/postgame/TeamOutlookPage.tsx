import React, { useMemo, useState, type FC } from 'react';
import { cn } from '@/lib/essence';
import { leagueLabel } from '@/lib/postgamePages';
import { useTeamOutlook, type TeamOutlookFixtureRow, type TeamOutlookProfileRow } from '@/hooks/useTeamOutlook';
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

interface TeamOutlookPageProps {
  teamSlug: string;
  query: URLSearchParams;
}

const LEAGUE_ABBR: Record<string, string> = {
  'eng.1': 'EPL',
  epl: 'EPL',
  'esp.1': 'LaLiga',
  laliga: 'LaLiga',
  'ita.1': 'Serie A',
  seriea: 'Serie A',
  'ger.1': 'Bundesliga',
  bundesliga: 'Bundesliga',
  'fra.1': 'Ligue 1',
  ligue1: 'Ligue 1',
  'usa.1': 'MLS',
  mls: 'MLS',
  'uefa.champions': 'UCL',
  ucl: 'UCL',
  'uefa.europa': 'UEL',
  uel: 'UEL',
};

const CUP_LEAGUES = new Set(['uefa.champions', 'uefa.europa', 'ucl', 'uel']);

const normalizeLeague = (value: string): string => value.trim().toLowerCase();

const competitionAbbr = (leagueId: string): string => LEAGUE_ABBR[normalizeLeague(leagueId)] ?? leagueId.toUpperCase();

const competitionName = (leagueId: string): string => leagueLabel(leagueId);

const fmtPct = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) return '0.0';
  return value.toFixed(1);
};

const fmtNumber = (value: number | null, digits = 1): string => {
  if (value === null || Number.isNaN(value)) return '-';
  return value.toFixed(digits);
};

const titleFromSlug = (slug: string): string =>
  slug
    .split('-')
    .filter(Boolean)
    .map((token) => {
      const upperTokens = new Set(['fc', 'cf', 'ac', 'afc']);
      if (upperTokens.has(token)) return token.toUpperCase();
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(' ');

const teamLogoUrl = (espnTeamId: string): string =>
  `https://a.espncdn.com/i/teamlogos/soccer/500/${encodeURIComponent(espnTeamId)}.png`;

const teamInitials = (teamName: string): string => {
  const tokens = teamName.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '?';
  return tokens.slice(0, 2).map((token) => token[0]?.toUpperCase() ?? '').join('');
};

const fixtureCompetitionLink = (leagueId: string): string | null => {
  const normalized = normalizeLeague(leagueId);
  if (normalized === 'uefa.champions' || normalized === 'ucl') return '/research/ucl-r16';
  return null;
};

const dateParts = (iso: string): { iso: string; dateLabel: string; timeLabel: string } => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return {
      iso: '',
      dateLabel: 'TBD',
      timeLabel: 'TBD',
    };
  }

  return {
    iso: parsed.toISOString(),
    dateLabel: parsed.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York',
    }),
    timeLabel: `${parsed.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    })} ET`,
  };
};

const monthLabel = (iso?: string): string => {
  if (iso) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/New_York' });
    }
  }

  return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/New_York' });
};

const chevronClass = (open: boolean): string =>
  open ? 'rotate-180 text-slate-700' : 'rotate-0 text-slate-400';

const TeamBadge: FC<{ teamName: string; espnTeamId: string | null; size?: 'sm' | 'lg' }> = ({
  teamName,
  espnTeamId,
  size = 'sm',
}) => {
  const [failed, setFailed] = useState(false);
  const dimension = size === 'lg' ? 46 : 26;
  const textSize = size === 'lg' ? 'text-sm' : 'text-[10px]';

  if (espnTeamId && !failed) {
    return (
      <img
        src={teamLogoUrl(espnTeamId)}
        alt={`${teamName} logo`}
        width={dimension}
        height={dimension}
        loading="lazy"
        onError={() => setFailed(true)}
        className="rounded-full border border-slate-200 bg-white object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-100 font-mono font-semibold text-slate-600',
        textSize,
      )}
      style={{ width: dimension, height: dimension }}
    >
      {teamInitials(teamName)}
    </span>
  );
};

interface FixtureRowProps {
  fixture: TeamOutlookFixtureRow;
  teamName: string;
  teamProfile: TeamOutlookProfileRow | null;
  last: boolean;
}

const FixtureRow: FC<FixtureRowProps> = ({ fixture, teamName, teamProfile, last }) => {
  const [open, setOpen] = useState(false);
  const domId = `fixture-${fixture.id || `${fixture.opponent}-${fixture.startTime}`}`.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const date = dateParts(fixture.startTime);
  const compAbbr = competitionAbbr(fixture.leagueId);
  const compName = competitionName(fixture.leagueId);
  const compLink = fixtureCompetitionLink(fixture.leagueId);

  const opponentHeadline =
    fixture.oppOuSample > 0
      ? `${fixture.opponent} ${compAbbr}: ${fmtPct(fixture.oppUnderRate)}% under and ${fmtPct(fixture.oppOverRate)}% over across ${fixture.oppOuSample} lined matches.`
      : `${fixture.opponent} ${compAbbr}: no verified closing-line sample yet.`;

  const teamUnder = teamProfile?.underRate;
  const oppUnder = fixture.oppUnderRate;
  const readText =
    teamUnder !== null && teamUnder !== undefined && oppUnder !== null
      ? `${teamName} is ${fmtPct(teamUnder)}% under vs posted totals recently. ${fixture.opponent} is ${fmtPct(oppUnder)}% under in this competition.`
      : `${teamName} and ${fixture.opponent} are on the schedule board. Check again closer to kickoff for stronger line-based reads.`;

  const formNote =
    fixture.oppWins !== null && fixture.oppDraws !== null && fixture.oppLosses !== null
      ? `${fixture.opponent} recent form: ${fixture.oppWins}-${fixture.oppDraws}-${fixture.oppLosses}${fixture.oppForm ? ` (${fixture.oppForm})` : ''}.`
      : fixture.oppForm
        ? `${fixture.opponent} recent form: ${fixture.oppForm}.`
        : null;

  return (
    <tbody className={cn('border-slate-200', last ? 'border-b-0' : 'border-b')}>
      <tr
        className={cn(
          'cursor-pointer transition-colors hover:bg-slate-50',
          open ? 'bg-slate-50' : 'bg-white',
        )}
        onClick={() => setOpen((prev) => !prev)}
      >
        <td className="w-[148px] px-4 py-4 align-top sm:px-5">
          <time dateTime={date.iso} className="block font-mono text-xs font-semibold tabular-nums text-slate-900">
            {date.dateLabel}
          </time>
          <time dateTime={date.iso} className="mt-0.5 block font-mono text-[11px] tabular-nums text-slate-500">
            {date.timeLabel}
          </time>
        </td>
        <td className="w-[68px] px-3 py-4 align-top">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">{fixture.venue}</span>
        </td>
        <th scope="row" className="bg-transparent px-3 py-4 text-left font-normal align-top">
          <div className="flex items-start gap-2.5">
            <TeamBadge teamName={fixture.opponent} espnTeamId={fixture.opponentEspnId} />
            <div className="min-w-0">
              <span id={`title-${domId}`} className="block truncate text-sm font-semibold text-slate-900">
                {fixture.opponent}
              </span>
              {compLink ? (
                <a
                  href={compLink}
                  className="mt-0.5 inline-flex border-b border-slate-300 text-[11px] text-slate-600 hover:text-slate-900"
                  onClick={(event) => event.stopPropagation()}
                >
                  {compName}
                </a>
              ) : (
                <span className="mt-0.5 block text-[11px] text-slate-500">{compName}</span>
              )}
            </div>
          </div>
        </th>
        <td className="w-[88px] px-3 py-4 align-top text-center">
          <span className="inline-flex rounded-md border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600">
            <abbr title={compName} className="no-underline">
              {compAbbr}
            </abbr>
          </span>
        </td>
        <td className="w-10 px-3 py-4 align-top text-right">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`content-${domId}`}
            aria-label={`View breakdown for ${fixture.opponent}`}
            className="rounded-md border border-transparent p-1.5 transition-colors hover:border-slate-200 hover:bg-white"
          >
            <svg className={cn('h-3.5 w-3.5 transition-transform', chevronClass(open))} viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </td>
      </tr>

      <tr id={`content-${domId}`} hidden={!open} className="bg-slate-50">
        <td colSpan={5} className="px-4 pb-4 sm:px-5">
          <div className="grid gap-3">
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{fixture.opponent}</h4>
              <p className="text-sm leading-6 text-slate-700">{opponentHeadline}</p>
              {fixture.oppAvgActual !== null ? (
                <p className="mt-1.5 text-xs text-slate-500">
                  Avg actual total: <ValueText className="text-xs">{fmtNumber(fixture.oppAvgActual)}</ValueText>
                </p>
              ) : null}
              {formNote ? <p className="mt-2 text-xs italic text-slate-500">{formNote}</p> : null}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Read</h4>
              <p className="text-sm leading-6 text-slate-800">{readText}</p>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  );
};

export const TeamOutlookPage: FC<TeamOutlookPageProps> = ({ teamSlug, query }) => {
  const leagueId = query.get('league');
  const { data, isLoading, error } = useTeamOutlook(teamSlug, leagueId);

  const teamName = data?.team || titleFromSlug(teamSlug);
  const profileRows = data?.profile ?? [];
  const goalDist = data?.goalDist ?? [];
  const fixtures = data?.fixtures ?? [];

  const profileByLeague = useMemo(() => {
    const map = new Map<string, TeamOutlookProfileRow>();
    for (const row of profileRows) {
      map.set(normalizeLeague(row.leagueId), row);
    }
    return map;
  }, [profileRows]);

  const totalLinedGames = useMemo(() => profileRows.reduce((sum, row) => sum + row.gamesWithLine, 0), [profileRows]);

  const primaryGoalLeague = data?.goalDistLeagueId || leagueId || profileRows[0]?.leagueId || 'soccer';
  const goalDistMax = useMemo(() => Math.max(...goalDist.map((row) => row.pct), 1), [goalDist]);

  const headerTeamEspnId = data?.teamEspnId ?? fixtures[0]?.teamEspnId ?? null;
  const snapshotMonth = monthLabel(fixtures[0]?.startTime);

  if (isLoading) {
    return (
      <PageShell>
        <TopNav />
        <LoadingBlock label="Loading team outlook…" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <TopNav />
        <EmptyBlock message={`Failed to load team outlook: ${error.message}`} />
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell>
        <TopNav />
        <EmptyBlock message="No team outlook data available yet." />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <TopNav />

      <div className="mx-auto max-w-5xl space-y-5">
        <Card>
          <CardBody className="px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-4">
              <TeamBadge teamName={teamName} espnTeamId={headerTeamEspnId} size="lg" />
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Team Outlook</div>
                <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">{teamName}</h1>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] text-slate-600">
                  {snapshotMonth}
                </span>
                <a
                  href="/soccer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700 hover:bg-slate-50"
                >
                  <span aria-hidden="true">←</span>
                  Soccer Hub
                </a>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>
              <abbr title="Over / Under" className="no-underline">
                O/U
              </abbr>{' '}
              Profile
            </SectionLabel>
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-slate-500">
              {profileRows.length} competitions
            </span>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <caption className="sr-only">{teamName} historical over/under profile by competition.</caption>
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {[
                      { id: 'col-comp', vis: 'Comp', full: 'Tournament Competition', align: 'left' as const },
                      { id: 'col-games', vis: 'Games', full: 'Total Matches Played', align: 'right' as const },
                      { id: 'col-line', vis: 'w/ Line', full: 'Matches with Closing Line', align: 'right' as const },
                      { id: 'col-under', vis: 'Under', full: 'Under Record', align: 'right' as const },
                      { id: 'col-rate', vis: 'Rate', full: 'Under Rate', align: 'right' as const },
                      { id: 'col-avgline', vis: 'Avg Line', full: 'Average Posted Total', align: 'right' as const },
                      { id: 'col-avgact', vis: 'Avg Actual', full: 'Average Actual Total', align: 'right' as const },
                      { id: 'col-band', vis: '2-3 Band', full: 'Matches Landing in 2-3 Total Goals', align: 'right' as const },
                    ].map((header) => (
                      <th key={header.id} id={header.id} scope="col" className={cn('px-4 py-3', header.align === 'right' ? 'text-right' : 'text-left')}>
                        <span aria-hidden="true">{header.vis}</span>
                        <span className="sr-only">{header.full}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profileRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-4 text-sm text-slate-500">
                        No line profile available for this team yet.
                      </td>
                    </tr>
                  ) : (
                    profileRows.map((row, index) => {
                      const rowId = `profile-row-${index}`;
                      const bandDenominator = row.games > 0 ? row.games : data.band.totalGames;
                      const bandPct = row.band23Pct ?? (bandDenominator > 0 ? (row.band23 / bandDenominator) * 100 : null);
                      const underRecord = row.pushCount > 0 ? `${row.underCount}-${row.overCount}-${row.pushCount}` : `${row.underCount}-${row.overCount}`;

                      return (
                        <tr key={`${row.leagueId}-${index}`} className={cn('border-slate-100', index < profileRows.length - 1 ? 'border-b' : '')}>
                          <th
                            id={rowId}
                            headers="col-comp"
                            scope="row"
                            className="bg-transparent px-4 py-3.5 text-left text-sm font-semibold text-slate-900"
                          >
                            <abbr title={competitionName(row.leagueId)} className="no-underline">
                              {competitionAbbr(row.leagueId)}
                            </abbr>
                          </th>
                          <td headers={`${rowId} col-games`} className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-600">
                            <data value={row.games}>{row.games}</data>
                          </td>
                          <td headers={`${rowId} col-line`} className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-600">
                            <data value={row.gamesWithLine}>{row.gamesWithLine}</data>
                          </td>
                          <td headers={`${rowId} col-under`} className="px-4 py-3.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-800">
                            {underRecord}
                          </td>
                          <td headers={`${rowId} col-rate`} className="px-4 py-3.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-900">
                            <data value={fmtPct(row.underRate)}>{fmtPct(row.underRate)}%</data>
                          </td>
                          <td headers={`${rowId} col-avgline`} className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-600">
                            <data value={fmtNumber(row.avgLine)}>{fmtNumber(row.avgLine)}</data>
                          </td>
                          <td headers={`${rowId} col-avgact`} className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-600">
                            <data value={fmtNumber(row.avgActual)}>{fmtNumber(row.avgActual)}</data>
                          </td>
                          <td headers={`${rowId} col-band`} className="whitespace-nowrap px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-700">
                            <data value={row.band23}>{`${row.band23}/${bandDenominator}`}</data>{' '}
                            <span className="text-slate-500">
                              (<data value={fmtPct(bandPct)}>{fmtPct(bandPct)}%</data>)
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <SectionLabel>
              <abbr title={competitionName(primaryGoalLeague)} className="no-underline">
                {competitionAbbr(primaryGoalLeague)}
              </abbr>{' '}
              Goal Distribution
            </SectionLabel>
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-slate-500">{data.band.totalGames} games</span>
          </CardHeader>
          <CardBody>
            {goalDist.length === 0 ? (
              <p className="text-sm text-slate-500">No completed-match goal distribution available.</p>
            ) : (
              <>
                <div aria-hidden="true" className="mb-3 flex h-[130px] items-end gap-1.5">
                  {goalDist.map((row, index) => {
                    const barHeight = Math.max((row.pct / goalDistMax) * 100, 6);
                    const rowLabel = String(row.total);
                    const hotBand = rowLabel === '2' || rowLabel === '3';
                    return (
                      <div key={`${row.total}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                        <span className={cn('font-mono text-[10px] tabular-nums', hotBand ? 'text-slate-900' : 'text-slate-500')}>
                          {fmtPct(row.pct)}%
                        </span>
                        <div
                          className={cn(
                            'w-full rounded-t-sm transition-all duration-200',
                            hotBand ? 'bg-slate-900' : 'bg-slate-300',
                          )}
                          style={{ height: `${barHeight}%` }}
                        />
                        <span className={cn('font-mono text-[11px] tabular-nums', hotBand ? 'font-semibold text-slate-900' : 'text-slate-500')}>
                          {row.total}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <table className="sr-only">
                  <caption>Exact match goal distribution for {teamName}</caption>
                  <thead>
                    <tr>
                      <th id="h-exact-goals" scope="col">
                        Exact Total Goals
                      </th>
                      <th id="h-games-played" scope="col">
                        Number of Games
                      </th>
                      <th id="h-frequency" scope="col">
                        Frequency Percentage
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {goalDist.map((row, index) => (
                      <tr key={`${row.total}-${index}`}>
                        <th id={`r-goal-${index}`} scope="row" headers="h-exact-goals">
                          {row.total} Goals
                        </th>
                        <td headers={`h-games-played r-goal-${index}`}>
                          <data value={row.games}>{row.games}</data>
                        </td>
                        <td headers={`h-frequency r-goal-${index}`}>
                          <data value={fmtPct(row.pct)}>{fmtPct(row.pct)}%</data>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p className="text-sm text-slate-600">
                  <ValueText className="text-sm">{data.band.band23}</ValueText> of{' '}
                  <ValueText className="text-sm">{data.band.totalGames}</ValueText> games land on 2 or 3 goals.
                </p>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <SectionLabel>Upcoming Fixtures</SectionLabel>
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-slate-500">{fixtures.length} matches</span>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <caption className="sr-only">{teamName} upcoming fixture list with opponent context.</caption>
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    <th scope="col" className="w-[148px] px-4 py-3 text-left">
                      Date
                    </th>
                    <th scope="col" className="w-[68px] px-3 py-3 text-left">
                      Venue
                    </th>
                    <th scope="col" className="px-3 py-3 text-left">
                      Opponent
                    </th>
                    <th scope="col" className="w-[88px] px-3 py-3 text-center">
                      Comp
                    </th>
                    <th scope="col" className="w-10 px-3 py-3 text-right">
                      <span className="sr-only">Expand Details</span>
                    </th>
                  </tr>
                </thead>

                {fixtures.length === 0 ? (
                  <tbody>
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-sm text-slate-500">
                        No upcoming fixtures found.
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  fixtures.map((fixture, index) => (
                    <FixtureRow
                      key={`${fixture.id}-${index}`}
                      fixture={fixture}
                      teamName={teamName}
                      teamProfile={profileByLeague.get(normalizeLeague(fixture.leagueId)) ?? null}
                      last={index === fixtures.length - 1}
                    />
                  ))
                )}
              </table>
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400">thedrip.to</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400">
            closing-line sample: {totalLinedGames}
          </span>
          {profileRows.some((row) => CUP_LEAGUES.has(normalizeLeague(row.leagueId))) ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400">ucl-aware profile enabled</span>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
};

export default TeamOutlookPage;
