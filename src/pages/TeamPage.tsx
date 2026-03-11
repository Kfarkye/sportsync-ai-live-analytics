import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  type SoccerPostgame,
  fetchTeamMatches,
  computeTeamRecord,
  fetchTeamMeta,
  type TeamRecord,
  getSpreadResult,
  getTotalResult,
} from '../lib/postgame';
import { formatMatchDate, matchUrl } from '../lib/slugs';
import { color as C, fmt } from '../lib/tokens';

type TeamMeta = {
  name?: string;
  short_name?: string;
  abbreviation?: string;
  logo_url?: string;
  color?: string;
  league_id?: string;
};

type VenueFilter = 'all' | 'home' | 'away';
type ResultFilter = 'all' | 'win' | 'draw' | 'loss';
type SpreadFilter = 'all' | 'covered' | 'failed' | 'push' | 'off';
type WindowFilter = 'all' | '10' | '20' | '40';

type LedgerRow = {
  id: string;
  startTime: string;
  monthLabel: string;
  dateLabel: string;
  venue: 'home' | 'away';
  opponent: string;
  score: string;
  result: 'win' | 'draw' | 'loss';
  spreadOutcome: 'covered' | 'failed' | 'push' | 'off';
  spreadLabel: string;
  totalLabel: string;
  totalOutcome: 'over' | 'under' | 'push' | 'off';
  href: string;
};

const filterChipBase = 'rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest transition';

function matchesTeamName(candidate: string, teamNames: string[]): boolean {
  const clean = candidate.trim().toLowerCase();
  return teamNames.some((name) => {
    const target = name.trim().toLowerCase();
    if (!target) return false;
    return clean === target || clean.includes(target) || target.includes(clean);
  });
}

function monthLabelFromDate(startTime: string): string {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return 'Unknown Month';
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function TeamPage() {
  const { slug } = useParams<{ slug: string }>();

  const [matches, setMatches] = useState<SoccerPostgame[]>([]);
  const [meta, setMeta] = useState<TeamMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<TeamRecord | null>(null);
  const [ready, setReady] = useState(false);

  const [venueFilter, setVenueFilter] = useState<VenueFilter>('all');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [spreadFilter, setSpreadFilter] = useState<SpreadFilter>('all');
  const [windowFilter, setWindowFilter] = useState<WindowFilter>('all');

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let alive = true;

    async function init() {
      if (!slug) return;

      const teamNameFromSlug = slug.replace(/-/g, ' ');

      const [teamMeta, teamMatches] = await Promise.all([
        fetchTeamMeta(teamNameFromSlug),
        fetchTeamMatches(slug),
      ]);

      if (!alive) return;

      setMeta((teamMeta as TeamMeta | null) ?? null);
      setMatches(teamMatches);

      if (teamMatches.length > 0) {
        const canonicalTeamName =
          (teamMeta as TeamMeta | null)?.name ||
          (teamMeta as TeamMeta | null)?.short_name ||
          teamNameFromSlug;

        const nextRecord = computeTeamRecord(teamMatches, canonicalTeamName);
        setRecord(nextRecord);

        const pageTitle = `${canonicalTeamName} ATS Record & Results | The Drip`;
        document.title = pageTitle;

        const atsDen = nextRecord.ats.covered + nextRecord.ats.failed;
        const coverPct = atsDen > 0 ? ((nextRecord.ats.covered / atsDen) * 100).toFixed(1) : '0.0';
        const desc = `${canonicalTeamName} ATS record: ${nextRecord.ats.covered}-${nextRecord.ats.failed}. Cover rate: ${coverPct}%. Full season results with closing lines.`;

        document.querySelector('meta[property="og:title"]')?.setAttribute('content', pageTitle);
        document.querySelector('meta[property="og:description"]')?.setAttribute('content', desc);
      }

      setLoading(false);
    }

    void init();

    return () => {
      alive = false;
    };
  }, [slug]);

  const teamName = meta?.name || meta?.short_name || (slug || '').replace(/-/g, ' ');
  const teamColor = meta?.color || C.accent;

  const ledgerRows = useMemo<LedgerRow[]>(() => {
    const keyNames = [teamName, (slug || '').replace(/-/g, ' ')].filter(Boolean);

    return matches
      .map((match) => {
        const isHome = matchesTeamName(match.home_team, keyNames);
        const isAway = matchesTeamName(match.away_team, keyNames);
        const venue: 'home' | 'away' = isHome || !isAway ? 'home' : 'away';

        const opponent = venue === 'home' ? match.away_team : match.home_team;
        const teamScore = venue === 'home' ? match.home_score : match.away_score;
        const oppScore = venue === 'home' ? match.away_score : match.home_score;

        const result: 'win' | 'draw' | 'loss' =
          teamScore > oppScore ? 'win' : teamScore < oppScore ? 'loss' : 'draw';

        const spreadResult = getSpreadResult(match);
        let spreadOutcome: 'covered' | 'failed' | 'push' | 'off' = 'off';

        if (spreadResult) {
          if (venue === 'home') {
            spreadOutcome = spreadResult.result;
          } else {
            spreadOutcome =
              spreadResult.result === 'covered'
                ? 'failed'
                : spreadResult.result === 'failed'
                  ? 'covered'
                  : 'push';
          }
        }

        const teamSpread = match.dk_spread != null ? (venue === 'home' ? match.dk_spread : -match.dk_spread) : null;
        const spreadPrefix = teamSpread != null ? `${fmt.spread(teamSpread)} · ` : '';
        const spreadLabel =
          spreadOutcome === 'covered'
            ? `${spreadPrefix}Covered`
            : spreadOutcome === 'failed'
              ? `${spreadPrefix}Failed`
              : spreadOutcome === 'push'
                ? `${spreadPrefix}Push`
                : 'Off board';

        const totalResult = getTotalResult(match);
        const totalOutcome: 'over' | 'under' | 'push' | 'off' = totalResult ? totalResult.result : 'off';
        const totalLabel = totalResult
          ? `${match.dk_total != null ? `O/U ${match.dk_total} · ` : ''}${String(totalResult.result).toUpperCase()}`
          : 'Off board';

        return {
          id: match.id,
          startTime: match.start_time,
          monthLabel: monthLabelFromDate(match.start_time),
          dateLabel: formatMatchDate(match.start_time),
          venue,
          opponent,
          score: `${teamScore}-${oppScore}`,
          result,
          spreadOutcome,
          spreadLabel,
          totalLabel,
          totalOutcome,
          href: matchUrl(match.home_team, match.away_team, match.start_time),
        };
      })
      .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
  }, [matches, slug, teamName]);

  const filteredRows = useMemo(() => {
    let rows = ledgerRows;

    if (venueFilter !== 'all') {
      rows = rows.filter((row) => row.venue === venueFilter);
    }

    if (resultFilter !== 'all') {
      rows = rows.filter((row) => row.result === resultFilter);
    }

    if (spreadFilter !== 'all') {
      rows = rows.filter((row) => row.spreadOutcome === spreadFilter);
    }

    if (windowFilter !== 'all') {
      rows = rows.slice(0, Number(windowFilter));
    }

    return rows;
  }, [ledgerRows, venueFilter, resultFilter, spreadFilter, windowFilter]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, LedgerRow[]>();

    for (const row of filteredRows) {
      if (!groups.has(row.monthLabel)) groups.set(row.monthLabel, []);
      groups.get(row.monthLabel)?.push(row);
    }

    return [...groups.entries()].map(([month, items]) => ({ month, items }));
  }, [filteredRows]);

  const recentForm = useMemo(() => {
    const recent = ledgerRows.slice(0, Math.min(5, ledgerRows.length));
    const wins = recent.filter((row) => row.result === 'win').length;
    const draws = recent.filter((row) => row.result === 'draw').length;
    const losses = recent.filter((row) => row.result === 'loss').length;
    return { sample: recent.length, wins, draws, losses };
  }, [ledgerRows]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-500 flex items-center justify-center text-xs font-semibold uppercase tracking-[0.16em]">
        Loading Team Ledger
      </div>
    );
  }

  if (!record || matches.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center gap-4">
        <p className="text-base font-semibold">Record not found.</p>
        <Link
          to="/edge"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50"
        >
          Back to Edge
        </Link>
      </div>
    );
  }

  const atsTotal = record.ats.covered + record.ats.failed;
  const coverPct = atsTotal > 0 ? (record.ats.covered / atsTotal) * 100 : 0;
  const totalGames = Math.max(1, record.wins + record.draws + record.losses);

  return (
    <div className="h-(--vvh,100vh) overflow-y-auto bg-slate-50 text-slate-900" style={{ opacity: ready ? 1 : 0, transition: 'opacity 0.5s ease-out' }}>
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Link
              to="/edge"
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900 hover:bg-slate-50"
            >
              Edge
            </Link>
            <Link
              to="/trends"
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900 hover:bg-slate-50"
            >
              Trends
            </Link>
          </div>
          <span className="text-[11px] font-medium text-slate-500">{filteredRows.length} matches in view</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 md:px-6 py-8 space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4 md:gap-5 min-w-0">
              <div className="h-20 w-20 md:h-24 md:w-24 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                {meta?.logo_url ? (
                  <img src={meta.logo_url} alt={teamName} className="h-14 w-14 md:h-16 md:w-16 object-contain" />
                ) : (
                  <span className="text-3xl font-semibold" style={{ color: teamColor }}>{teamName[0]}</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Editorial Team Ledger</p>
                <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight truncate">{teamName}</h1>
                <p className="mt-2 text-sm text-slate-600">
                  {meta?.league_id || 'League'} season matchbook with ATS and totals context on every result.
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">ATS</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{record.ats.covered}-{record.ats.failed}-{record.ats.push}</div>
                <div className="mt-1 text-[11px] text-slate-500">{coverPct.toFixed(1)}% cover (n={atsTotal})</div>
              </article>
              <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">W-D-L</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{record.wins}-{record.draws}-{record.losses}</div>
                <div className="mt-1 text-[11px] text-slate-500">Recent {recentForm.wins}-{recentForm.draws}-{recentForm.losses} (last {recentForm.sample})</div>
              </article>
              <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Over / Under</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{record.ou.over}-{record.ou.under}-{record.ou.push}</div>
                <div className="mt-1 text-[11px] text-slate-500">Totals decisions n={record.ou.over + record.ou.under}</div>
              </article>
              <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Goal Profile</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{record.goalsFor}-{record.goalsAgainst}</div>
                <div className="mt-1 text-[11px] text-slate-500">{(record.cleanSheets / totalGames * 100).toFixed(1)}% clean sheet rate</div>
              </article>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Match Filters</div>

          <div className="flex flex-wrap gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 self-center">Venue</span>
            {(['all', 'home', 'away'] as VenueFilter[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setVenueFilter(option)}
                className={`${filterChipBase} ${venueFilter === option ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'}`}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 self-center">Result</span>
            {([
              ['all', 'all'],
              ['win', 'wins'],
              ['draw', 'draws'],
              ['loss', 'losses'],
            ] as Array<[ResultFilter, string]>).map(([option, label]) => (
              <button
                key={option}
                type="button"
                onClick={() => setResultFilter(option)}
                className={`${filterChipBase} ${resultFilter === option ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 self-center">ATS</span>
            {([
              ['all', 'all'],
              ['covered', 'covered'],
              ['failed', 'failed'],
              ['push', 'push'],
              ['off', 'off board'],
            ] as Array<[SpreadFilter, string]>).map(([option, label]) => (
              <button
                key={option}
                type="button"
                onClick={() => setSpreadFilter(option)}
                className={`${filterChipBase} ${spreadFilter === option ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 self-center">Window</span>
            {([
              ['all', 'all'],
              ['10', 'last 10'],
              ['20', 'last 20'],
              ['40', 'last 40'],
            ] as Array<[WindowFilter, string]>).map(([option, label]) => (
              <button
                key={option}
                type="button"
                onClick={() => setWindowFilter(option)}
                className={`${filterChipBase} ${windowFilter === option ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">Match Ledger</h2>
            <p className="mt-1 text-xs text-slate-500">Structured by month with score, ATS verdict, and totals result for fast scan.</p>
          </div>

          {filteredRows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-slate-500">No matches match the current filters.</div>
          ) : (
            <div>
              <div className="hidden md:grid md:grid-cols-[130px_1fr_130px_220px_180px] gap-3 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 bg-slate-50/95 border-b border-slate-200 sticky top-[53px] z-30 backdrop-blur">
                <span>Date</span>
                <span>Opponent</span>
                <span>Result</span>
                <span>Closing Spread</span>
                <span>Total</span>
              </div>

              {groupedRows.map((group) => (
                <div key={group.month}>
                  <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 bg-slate-50 border-y border-slate-100">
                    {group.month} · {group.items.length} matches
                  </div>

                  <div className="divide-y divide-slate-100">
                    {group.items.map((row) => {
                      const resultTone =
                        row.result === 'win'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : row.result === 'loss'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200';

                      const spreadTone =
                        row.spreadOutcome === 'covered'
                          ? 'text-emerald-700'
                          : row.spreadOutcome === 'failed'
                            ? 'text-rose-700'
                            : 'text-slate-600';

                      const totalTone =
                        row.totalOutcome === 'over'
                          ? 'text-slate-900'
                          : row.totalOutcome === 'under'
                            ? 'text-slate-700'
                            : 'text-slate-500';

                      return (
                        <Link
                          to={row.href}
                          key={row.id}
                          className="block px-4 py-3 hover:bg-slate-50 transition"
                        >
                          <div className="hidden md:grid md:grid-cols-[130px_1fr_130px_220px_180px] gap-3 items-center">
                            <div className="text-xs text-slate-500 tabular-nums">
                              <div>{row.dateLabel}</div>
                              <div className="mt-1 uppercase tracking-widest text-[10px]">{row.venue === 'home' ? 'Home' : 'Away'}</div>
                            </div>

                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 truncate">
                                <span className="text-slate-400 mr-1.5">{row.venue === 'home' ? 'vs' : '@'}</span>
                                {row.opponent}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${resultTone}`}>
                                {row.result}
                              </span>
                              <span className="text-lg font-semibold tabular-nums text-slate-900">{row.score}</span>
                            </div>

                            <div className={`text-sm font-semibold tabular-nums ${spreadTone}`}>{row.spreadLabel}</div>
                            <div className={`text-sm font-semibold tabular-nums ${totalTone}`}>{row.totalLabel}</div>
                          </div>

                          <div className="md:hidden">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs text-slate-500 tabular-nums">{row.dateLabel}</div>
                              <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${resultTone}`}>
                                {row.result}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3">
                              <div className="font-semibold text-slate-900 truncate">
                                <span className="text-slate-400 mr-1.5">{row.venue === 'home' ? 'vs' : '@'}</span>
                                {row.opponent}
                              </div>
                              <div className="text-lg font-semibold tabular-nums text-slate-900">{row.score}</div>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                              <div className={`rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-semibold ${spreadTone}`}>{row.spreadLabel}</div>
                              <div className={`rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-semibold ${totalTone}`}>{row.totalLabel}</div>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
