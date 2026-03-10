import React, { useMemo, useState, type CSSProperties, type FC } from 'react';
import { leagueLabel } from '@/lib/postgamePages';
import { useTeamOutlook, type TeamOutlookFixtureRow, type TeamOutlookProfileRow } from '@/hooks/useTeamOutlook';
import { EmptyBlock, LoadingBlock, PageShell, TopNav } from './PostgamePrimitives';

interface TeamOutlookPageProps {
  teamSlug: string;
  query: URLSearchParams;
}

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', -apple-system, system-ui, sans-serif";

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const LEAGUE_ABBR: Record<string, string> = {
  'eng.1': 'EPL',
  'esp.1': 'LaLiga',
  'ita.1': 'Serie A',
  'ger.1': 'Bundesliga',
  'fra.1': 'Ligue 1',
  'usa.1': 'MLS',
  'uefa.champions': 'UCL',
  'uefa.europa': 'UEL',
};

const normalizeLeague = (value: string): string => value.trim().toLowerCase();

const competitionAbbr = (leagueId: string): string => LEAGUE_ABBR[normalizeLeague(leagueId)] ?? leagueId.toUpperCase();

const competitionName = (leagueId: string): string => leagueLabel(leagueId);

const formatPct = (value: number | null): string => (value === null || Number.isNaN(value) ? '0.0' : value.toFixed(1));

const formatDecimal = (value: number | null, digits = 1): string =>
  value === null || Number.isNaN(value) ? '-' : value.toFixed(digits);

const titleFromSlug = (slug: string): string =>
  slug
    .split('-')
    .filter(Boolean)
    .map((token) => {
      const upper = new Set(['fc', 'cf', 'ac', 'afc']);
      if (upper.has(token)) return token.toUpperCase();
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(' ');

const getDateParts = (iso: string): { iso: string; dateLabel: string; timeLabel: string } => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return {
      iso: '',
      dateLabel: 'TBD',
      timeLabel: 'TBD',
    };
  }

  const dateLabel = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });

  const timeLabel = `${date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  })} ET`;

  return {
    iso: date.toISOString(),
    dateLabel,
    timeLabel,
  };
};

const teamLogoUrl = (espnTeamId: string): string =>
  `https://a.espncdn.com/i/teamlogos/soccer/500/${encodeURIComponent(espnTeamId)}.png`;

const teamInitials = (teamName: string): string => {
  const parts = teamName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return '?';
  return parts.map((token) => token.charAt(0).toUpperCase()).join('');
};

const TeamBadge: FC<{ teamName: string; espnTeamId: string | null; size?: number }> = ({ teamName, espnTeamId, size = 24 }) => {
  const [failed, setFailed] = useState(false);

  if (espnTeamId && !failed) {
    return (
      <img
        src={teamLogoUrl(espnTeamId)}
        alt={`${teamName} logo`}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '1px solid #e5e5e5',
          background: '#fff',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#e5e5e5',
        color: '#525252',
        fontFamily: mono,
        fontWeight: 700,
        fontSize: size < 30 ? 10 : 14,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {teamInitials(teamName)}
    </div>
  );
};

const Chevron: FC<{ open: boolean }> = ({ open }) => (
  <svg
    aria-hidden="true"
    width="14"
    height="14"
    viewBox="0 0 14 14"
    style={{
      transition: 'transform 0.2s',
      transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
      color: '#a3a3a3',
      flexShrink: 0,
    }}
  >
    <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface FixtureRowProps {
  fixture: TeamOutlookFixtureRow;
  teamName: string;
  teamProfile: TeamOutlookProfileRow | null;
  last: boolean;
}

const fixtureCompetitionLink = (leagueId: string): string | null => {
  if (normalizeLeague(leagueId) === 'uefa.champions') return '/research/ucl-r16';
  return null;
};

const FixtureRow: FC<FixtureRowProps> = ({ fixture, teamName, teamProfile, last }) => {
  const [open, setOpen] = useState(false);
  const matchDomId = `fixture-${fixture.id || `${fixture.opponent}-${fixture.startTime}`}`
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .toLowerCase();

  const dateParts = getDateParts(fixture.startTime);
  const compAbbr = competitionAbbr(fixture.leagueId);
  const compName = competitionName(fixture.leagueId);
  const compLink = fixtureCompetitionLink(fixture.leagueId);

  const opponentHeadline = fixture.oppOuSample > 0
    ? `${fixture.opponent} ${compAbbr}: ${formatPct(fixture.oppUnderRate)}% under and ${formatPct(fixture.oppOverRate)}% over on ${fixture.oppOuSample} lined games. Avg actual total ${formatDecimal(fixture.oppAvgActual)}.`
    : `${fixture.opponent} ${compAbbr}: no verified closing-line sample yet.`;

  const teamUnder = teamProfile?.underRate;
  const oppUnder = fixture.oppUnderRate;
  const read = teamUnder !== null && teamUnder !== undefined && oppUnder !== null
    ? `${teamName} has finished under the posted total in ${formatPct(teamUnder)}% of recent lined matches. ${fixture.opponent} is at ${formatPct(oppUnder)}% in this competition. Use the posted total as the reference number.`
    : `${teamName} and ${fixture.opponent} are available on the schedule board. Check closer to kickoff for line-based reads once closing samples are populated.`;

  const formNote = fixture.oppWins !== null && fixture.oppDraws !== null && fixture.oppLosses !== null
    ? `${fixture.opponent} recent form: ${fixture.oppWins}-${fixture.oppDraws}-${fixture.oppLosses}${fixture.oppForm ? ` (${fixture.oppForm})` : ''}.`
    : fixture.oppForm
      ? `${fixture.opponent} recent form: ${fixture.oppForm}.`
      : null;

  return (
    <tbody style={{ borderBottom: last ? 'none' : '1px solid #e5e5e5' }}>
      <tr
        onClick={() => setOpen((prev) => !prev)}
        style={{
          cursor: 'pointer',
          background: open ? '#f9f9f9' : 'transparent',
          transition: 'background 0.12s',
        }}
        onMouseEnter={(event) => {
          if (!open) event.currentTarget.style.background = '#fafafa';
        }}
        onMouseLeave={(event) => {
          if (!open) event.currentTarget.style.background = 'transparent';
        }}
      >
        <td style={{ padding: '18px 24px', width: 152 }}>
          <time dateTime={dateParts.iso} style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#171717', fontFamily: mono }}>
            {dateParts.dateLabel}
          </time>
          <time dateTime={dateParts.iso} style={{ display: 'block', fontSize: 11, color: '#737373', fontFamily: mono, marginTop: 1 }}>
            {dateParts.timeLabel}
          </time>
        </td>

        <td
          style={{
            padding: '18px 24px',
            width: 64,
            fontSize: 11,
            fontWeight: 600,
            color: fixture.venue === 'Home' ? '#171717' : '#737373',
            fontFamily: mono,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {fixture.venue}
        </td>

        <th scope="row" style={{ padding: '18px 24px', background: 'transparent', textAlign: 'left', fontWeight: 'normal' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TeamBadge teamName={fixture.opponent} espnTeamId={fixture.opponentEspnId} size={24} />
            <div>
              <span id={`title-${matchDomId}`} style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#171717' }}>
                {fixture.opponent}
              </span>
              {compLink ? (
                <a
                  href={compLink}
                  style={{
                    display: 'block',
                    fontSize: 11,
                    color: '#737373',
                    marginTop: 1,
                    textDecoration: 'none',
                    borderBottom: '1px solid #d4d4d4',
                    width: 'fit-content',
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  {compName}
                </a>
              ) : (
                <span style={{ display: 'block', fontSize: 11, color: '#737373', marginTop: 1 }}>{compName}</span>
              )}
            </div>
          </div>
        </th>

        <td style={{ padding: '18px 24px', width: 80, textAlign: 'center' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#525252',
              background: '#f5f5f5',
              padding: '3px 8px',
              borderRadius: 3,
              fontFamily: mono,
            }}
          >
            <abbr title={compName} style={{ textDecoration: 'none' }}>
              {compAbbr}
            </abbr>
          </span>
        </td>

        <td style={{ padding: '18px 24px', width: 24, textAlign: 'right' }}>
          <button
            aria-expanded={open}
            aria-controls={`content-${matchDomId}`}
            aria-label={`View betting read for ${fixture.opponent}`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <Chevron open={open} />
          </button>
        </td>
      </tr>

      <tr id={`content-${matchDomId}`} hidden={!open}>
        <td colSpan={5} style={{ padding: open ? '0 24px 24px' : 0, background: '#f9f9f9', border: 'none' }}>
          <div style={{ display: open ? 'block' : 'none' }}>
            <div style={{ padding: '14px 16px', background: '#fff', borderRadius: 6, border: '1px solid #e5e5e5', marginBottom: 12 }}>
              <h4
                style={{
                  margin: 0,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#737373',
                  fontFamily: mono,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                {fixture.opponent}
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: '#404040', lineHeight: 1.6 }}>{opponentHeadline}</p>
              {formNote ? (
                <p style={{ margin: '10px 0 0', fontSize: 11, color: '#737373', lineHeight: 1.5, fontStyle: 'italic' }}>{formNote}</p>
              ) : null}
            </div>

            <div style={{ padding: '14px 16px', background: '#fff', borderRadius: 6, border: '1px solid #e5e5e5' }}>
              <h4
                style={{
                  margin: 0,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#737373',
                  fontFamily: mono,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                Read
              </h4>
              <p style={{ margin: 0, fontSize: 14, color: '#171717', lineHeight: 1.65 }}>{read}</p>
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

  const profileRows = data?.profile ?? [];
  const fixtures = data?.fixtures ?? [];
  const goalDist = data?.goalDist ?? [];

  const teamName = data?.team || titleFromSlug(teamSlug);
  const headerTeamEspnId = data?.teamEspnId ?? fixtures[0]?.teamEspnId ?? null;

  const profileByLeague = useMemo(() => {
    const lookup = new Map<string, TeamOutlookProfileRow>();
    for (const row of profileRows) {
      lookup.set(normalizeLeague(row.leagueId), row);
    }
    return lookup;
  }, [profileRows]);

  const totalLinedGames = useMemo(
    () => profileRows.reduce((sum, row) => sum + row.gamesWithLine, 0),
    [profileRows],
  );

  const monthLabel = useMemo(
    () =>
      new Date().toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'America/New_York',
      }),
    [],
  );

  const primaryGoalLeague = data?.goalDistLeagueId || leagueId || profileRows[0]?.leagueId || 'soccer';
  const goalDistMax = Math.max(...goalDist.map((row) => row.pct), 1);

  return (
    <PageShell className="bg-white">
      <TopNav />

      {isLoading ? <LoadingBlock label="Loading team outlook..." /> : null}
      {error ? <EmptyBlock message={`Failed to load team outlook: ${error.message}`} /> : null}

      {data ? (
        <main style={{ minHeight: '100vh', background: '#fff', fontFamily: sans, color: '#171717' }}>
          <link
            href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
            rel="stylesheet"
          />

          <header style={{ borderBottom: '1px solid #e5e5e5' }}>
            <div
              style={{
                maxWidth: 840,
                margin: '0 auto',
                padding: '28px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                flexWrap: 'wrap',
              }}
            >
              <TeamBadge teamName={teamName} espnTeamId={headerTeamEspnId} size={48} />
              <div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#737373',
                    fontFamily: mono,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginBottom: 3,
                  }}
                >
                  Team Schedule
                </div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{teamName}</h1>
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 11, color: '#737373', fontFamily: mono }}>{monthLabel}</div>
            </div>
          </header>

          <div style={{ maxWidth: 840, margin: '0 auto', padding: '28px 24px 72px' }}>
            <section aria-labelledby="ou-profile-heading" style={{ marginBottom: 32 }}>
              <h2
                id="ou-profile-heading"
                style={{
                  margin: 0,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#737373',
                  fontFamily: mono,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 12,
                }}
              >
                <abbr title="Over / Under" style={{ textDecoration: 'none' }}>
                  O/U
                </abbr>{' '}
                Profile - 2025-26
              </h2>

              <div style={{ borderRadius: 8, border: '1px solid #e5e5e5', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 650 }}>
                  <caption style={srOnly}>
                    {teamName} historical Over/Under betting records and 2-3 goal band hit rates.
                  </caption>
                  <thead>
                    <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
                      {[
                        { id: 'col-comp', vis: 'Competition', full: 'Tournament Competition', align: 'left' as const },
                        { id: 'col-games', vis: 'Games', full: 'Total Matches Played', align: 'right' as const },
                        { id: 'col-line', vis: 'w/ Line', full: 'Matches with a Sportsbook Closing Line', align: 'right' as const },
                        { id: 'col-under', vis: 'Under', full: 'Under Betting Record', align: 'right' as const },
                        { id: 'col-rate', vis: 'Rate', full: 'Under Betting Win Percentage', align: 'right' as const },
                        { id: 'col-avgline', vis: 'Avg Line', full: 'Average Over/Under Closing Line', align: 'right' as const },
                        { id: 'col-avgact', vis: 'Avg Actual', full: 'Average Actual Goals Scored', align: 'right' as const },
                        { id: 'col-band', vis: '2-3 Band', full: 'Matches Landing in the 2-3 Total Goals Band', align: 'right' as const },
                      ].map((header) => (
                        <th
                          key={header.id}
                          id={header.id}
                          scope="col"
                          style={{
                            padding: '10px 14px',
                            textAlign: header.align,
                            fontSize: 10,
                            fontWeight: 600,
                            color: '#737373',
                            fontFamily: mono,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span aria-hidden="true">{header.vis}</span>
                          <span style={srOnly}>{header.full}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {profileRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '14px', fontSize: 13, color: '#737373' }}>
                          No line profile available for this team yet.
                        </td>
                      </tr>
                    ) : (
                      profileRows.map((row, index) => {
                        const rowId = `row-${index}`;
                        const bandDenominator = row.games > 0 ? row.games : data.band.totalGames;
                        const bandPct = row.band23Pct ?? (bandDenominator > 0 ? (row.band23 / bandDenominator) * 100 : null);
                        const underRecord = row.pushCount > 0
                          ? `${row.underCount}-${row.overCount}-${row.pushCount}`
                          : `${row.underCount}-${row.overCount}`;

                        return (
                          <tr key={`${row.leagueId}-${index}`} style={{ borderBottom: index < profileRows.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                            <th
                              id={rowId}
                              headers="col-comp"
                              scope="row"
                              style={{
                                padding: '13px 14px',
                                fontSize: 13,
                                fontWeight: 600,
                                textAlign: 'left',
                                background: 'transparent',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <abbr title={competitionName(row.leagueId)} style={{ textDecoration: 'none' }}>
                                {competitionAbbr(row.leagueId)}
                              </abbr>
                            </th>
                            <td headers={`${rowId} col-games`} style={{ padding: '13px 14px', fontSize: 13, color: '#737373', textAlign: 'right', fontFamily: mono }}>
                              <data value={row.games}>{row.games}</data>
                            </td>
                            <td headers={`${rowId} col-line`} style={{ padding: '13px 14px', fontSize: 13, color: '#737373', textAlign: 'right', fontFamily: mono }}>
                              <data value={row.gamesWithLine}>{row.gamesWithLine}</data>
                            </td>
                            <td headers={`${rowId} col-under`} style={{ padding: '13px 14px', fontSize: 13, fontWeight: 600, textAlign: 'right', fontFamily: mono }}>
                              {underRecord}
                            </td>
                            <td headers={`${rowId} col-rate`} style={{ padding: '13px 14px', fontSize: 14, fontWeight: 700, textAlign: 'right', fontFamily: mono }}>
                              <data value={formatPct(row.underRate)}>{formatPct(row.underRate)}%</data>
                            </td>
                            <td headers={`${rowId} col-avgline`} style={{ padding: '13px 14px', fontSize: 13, color: '#737373', textAlign: 'right', fontFamily: mono }}>
                              <data value={formatDecimal(row.avgLine)}>{formatDecimal(row.avgLine)}</data>
                            </td>
                            <td headers={`${rowId} col-avgact`} style={{ padding: '13px 14px', fontSize: 13, color: '#737373', textAlign: 'right', fontFamily: mono }}>
                              <data value={formatDecimal(row.avgActual)}>{formatDecimal(row.avgActual)}</data>
                            </td>
                            <td
                              headers={`${rowId} col-band`}
                              style={{
                                padding: '13px 14px',
                                fontSize: 13,
                                fontWeight: 600,
                                textAlign: 'right',
                                fontFamily: mono,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <data value={row.band23}>{`${row.band23}/${bandDenominator}`}</data>{' '}
                              <span style={{ color: '#737373', fontWeight: 400 }}>
                                (<data value={formatPct(bandPct)}>{formatPct(bandPct)}%</data>)
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="goal-dist-heading" style={{ marginBottom: 32 }}>
              <h2
                id="goal-dist-heading"
                style={{
                  margin: 0,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#737373',
                  fontFamily: mono,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 12,
                }}
              >
                <abbr title={competitionName(primaryGoalLeague)} style={{ textDecoration: 'none' }}>
                  {competitionAbbr(primaryGoalLeague)}
                </abbr>{' '}
                Goal Distribution - {data.band.totalGames} games
              </h2>

              {goalDist.length > 0 ? (
                <>
                  <div aria-hidden="true" style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 120, padding: '0 0 20px' }}>
                    {goalDist.map((row, index) => {
                      const height = Math.max((row.pct / goalDistMax) * 100, 4);
                      const isHot = String(row.total) === '2' || String(row.total) === '3';
                      return (
                        <div key={`${row.total}-${index}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, fontFamily: mono, color: isHot ? '#171717' : '#737373' }}>{formatPct(row.pct)}%</div>
                          <div
                            style={{
                              width: '100%',
                              height: `${height}%`,
                              minHeight: 4,
                              background: isHot ? '#171717' : '#e5e5e5',
                              borderRadius: '3px 3px 0 0',
                              transition: 'height 0.3s',
                            }}
                          />
                          <div style={{ fontSize: 11, fontWeight: isHot ? 700 : 500, fontFamily: mono, color: isHot ? '#171717' : '#737373' }}>
                            {row.total}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <table style={srOnly}>
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
                            <data value={formatPct(row.pct)}>{formatPct(row.pct)}%</data>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p style={{ margin: 0, fontSize: 12, color: '#737373' }}>
                    {data.band.band23} of {data.band.totalGames} games land on 2 or 3 goals.
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: '#737373' }}>No completed-match goal distribution available.</p>
              )}
            </section>

            <section aria-labelledby="fixtures-heading">
              <h2
                id="fixtures-heading"
                style={{
                  margin: 0,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#737373',
                  fontFamily: mono,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 12,
                }}
              >
                Upcoming - {fixtures.length} matches
              </h2>
              <div style={{ borderRadius: 8, border: '1px solid #e5e5e5', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <caption style={srOnly}>
                    {teamName} upcoming fixture list with opponent analysis and betting context.
                  </caption>
                  <thead>
                    <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
                      <th
                        scope="col"
                        style={{
                          padding: '10px 24px',
                          textAlign: 'left',
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#737373',
                          fontFamily: mono,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          width: 152,
                        }}
                      >
                        Date
                      </th>
                      <th
                        scope="col"
                        style={{
                          padding: '10px 24px',
                          textAlign: 'left',
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#737373',
                          fontFamily: mono,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          width: 64,
                        }}
                      >
                        Venue
                      </th>
                      <th
                        scope="col"
                        style={{
                          padding: '10px 24px',
                          textAlign: 'left',
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#737373',
                          fontFamily: mono,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                        }}
                      >
                        Opponent
                      </th>
                      <th
                        scope="col"
                        style={{
                          padding: '10px 24px',
                          textAlign: 'center',
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#737373',
                          fontFamily: mono,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          width: 80,
                        }}
                      >
                        Comp
                      </th>
                      <th scope="col" style={{ width: 24 }}>
                        <span style={srOnly}>Expand Details</span>
                      </th>
                    </tr>
                  </thead>
                  {fixtures.length === 0 ? (
                    <tbody>
                      <tr>
                        <td colSpan={5} style={{ padding: '16px 24px', color: '#737373', fontSize: 13 }}>
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
            </section>

            <footer
              style={{
                marginTop: 36,
                paddingTop: 20,
                borderTop: '1px solid #e5e5e5',
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <span style={{ fontSize: 10, color: '#a3a3a3', fontFamily: mono }}>thedrip.to</span>
              <span style={{ fontSize: 10, color: '#a3a3a3', fontFamily: mono }}>
                Closing lines via PickCenter - {totalLinedGames} lined games verified
              </span>
            </footer>
          </div>
        </main>
      ) : null}
    </PageShell>
  );
};

export default TeamOutlookPage;
