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

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Theme
// ============================================================================

const THEME = {
  result: {
    win: 'bg-emerald-50/80 text-emerald-700 border-emerald-200/80',
    loss: 'bg-rose-50/80 text-rose-700 border-rose-200/80',
    draw: 'bg-slate-100/80 text-slate-700 border-slate-200/80',
  },
  spread: {
    covered: 'text-emerald-600 font-bold',
    failed: 'text-rose-600 font-bold',
    push: 'text-slate-500 font-bold',
    off: 'text-slate-400 font-medium',
  },
  total: {
    over: 'text-slate-800 font-bold',
    under: 'text-slate-600 font-bold',
    push: 'text-slate-500 font-bold',
    off: 'text-slate-400 font-medium',
  },
  layout: {
    page:
      'min-h-[100svh] overflow-y-auto overscroll-y-contain bg-slate-50/50 pb-12 font-sans text-slate-900 selection:bg-blue-100 sm:pb-20',
    header:
      'sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 shadow-sm backdrop-blur-md',
    section:
      'overflow-hidden rounded-2xl border border-slate-200/75 bg-white shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] transition-all',
  },
  components: {
    navLink:
      'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-95',
    chipActive:
      'border-slate-900 bg-slate-900 text-white shadow-md shadow-slate-900/10 ring-1 ring-slate-900',
    chipInactive:
      'border-slate-200 bg-white text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900',
  },
} as const;

const FILTER_OPTIONS = {
  venue: [
    { value: 'all', label: 'All' },
    { value: 'home', label: 'Home' },
    { value: 'away', label: 'Away' },
  ] as { value: VenueFilter; label: string }[],
  result: [
    { value: 'all', label: 'All' },
    { value: 'win', label: 'Wins' },
    { value: 'draw', label: 'Draws' },
    { value: 'loss', label: 'Losses' },
  ] as { value: ResultFilter; label: string }[],
  spread: [
    { value: 'all', label: 'All' },
    { value: 'covered', label: 'Covered' },
    { value: 'failed', label: 'Failed' },
    { value: 'push', label: 'Push' },
    { value: 'off', label: 'Off Board' },
  ] as { value: SpreadFilter; label: string }[],
  window: [
    { value: 'all', label: 'All Time' },
    { value: '10', label: 'Last 10' },
    { value: '20', label: 'Last 20' },
    { value: '40', label: 'Last 40' },
  ] as { value: WindowFilter; label: string }[],
};

// ============================================================================
// Helpers
// ============================================================================

function normalizeTeamName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function matchesTeamName(candidate: string, teamNames: string[]): boolean {
  const cleanCandidate = normalizeTeamName(candidate);

  return teamNames.some((name) => {
    const cleanTarget = normalizeTeamName(name);
    if (!cleanTarget) return false;
    return (
      cleanCandidate === cleanTarget ||
      cleanCandidate.includes(cleanTarget) ||
      cleanTarget.includes(cleanCandidate)
    );
  });
}

function monthLabelFromDate(startTime: string): string {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return 'Unknown Month';
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function resolveVenue(match: SoccerPostgame, aliases: string[]): 'home' | 'away' {
  const homeMatch = matchesTeamName(match.home_team, aliases);
  const awayMatch = matchesTeamName(match.away_team, aliases);

  if (homeMatch && !awayMatch) return 'home';
  if (awayMatch && !homeMatch) return 'away';

  const primary = aliases.find(Boolean);
  if (primary) {
    const cleanPrimary = normalizeTeamName(primary);
    const cleanHome = normalizeTeamName(match.home_team);
    const cleanAway = normalizeTeamName(match.away_team);

    if (cleanHome === cleanPrimary) return 'home';
    if (cleanAway === cleanPrimary) return 'away';
  }

  return 'home';
}

function buildLedgerRow(match: SoccerPostgame, aliases: string[]): LedgerRow {
  const venue = resolveVenue(match, aliases);

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

  const teamSpread =
    match.dk_spread != null
      ? venue === 'home'
        ? match.dk_spread
        : -match.dk_spread
      : null;

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
  const totalOutcome: 'over' | 'under' | 'push' | 'off' = totalResult
    ? totalResult.result
    : 'off';

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
}

function upsertMetaTag(selector: string, attribute: 'content', value: string): void {
  const existing = document.querySelector(selector) as HTMLMetaElement | null;
  if (existing) {
    existing.setAttribute(attribute, value);
    return;
  }

  if (!selector.startsWith('meta[')) return;

  const propertyMatch = selector.match(/property="([^"]+)"/);
  const nameMatch = selector.match(/name="([^"]+)"/);

  const meta = document.createElement('meta');
  if (propertyMatch?.[1]) meta.setAttribute('property', propertyMatch[1]);
  if (nameMatch?.[1]) meta.setAttribute('name', nameMatch[1]);
  meta.setAttribute(attribute, value);
  document.head.appendChild(meta);
}

// ============================================================================
// UI
// ============================================================================

function StatCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: React.ReactNode;
  subtext: React.ReactNode;
}) {
  return (
    <article className="relative flex flex-col justify-center overflow-hidden rounded-2xl border border-slate-200/75 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all duration-300 hover:-translate-y-1 hover:shadow-md sm:p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 opacity-80 sm:text-[11px]">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold leading-none tracking-tight tabular-nums text-slate-900 sm:text-[1.7rem]">
        {value}
      </div>
      <div className="mt-2 text-[10px] font-medium text-slate-500 opacity-90 sm:text-[11px]">
        {subtext}
      </div>
    </article>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  currentValue,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  currentValue: T;
  onChange: (val: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <span className="ml-1 min-w-[50px] text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:ml-0">
        {label}
      </span>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = currentValue === option.value;
          const stateClass = isActive
            ? THEME.components.chipActive
            : THEME.components.chipInactive;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(option.value)}
              className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-all active:scale-95 ${stateClass}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MatchRow({ row }: { row: LedgerRow }) {
  const resultTone = THEME.result[row.result];
  const spreadTone = THEME.spread[row.spreadOutcome];
  const totalTone = THEME.total[row.totalOutcome];

  return (
    <Link
      to={row.href}
      className="group block border-b border-slate-100/80 transition-colors hover:bg-blue-50/40 last:border-0"
    >
      <div className="md:grid hidden md:grid-cols-[130px_1fr_100px_180px_140px] items-center gap-4 px-5 py-3.5">
        <div className="text-[13px] leading-tight tabular-nums text-slate-500">
          <div className="font-medium">{row.dateLabel}</div>
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
            {row.venue === 'home' ? 'Home' : 'Away'}
          </div>
        </div>

        <div className="min-w-0 pr-4">
          <div className="truncate text-[15px] font-bold text-slate-900 transition-colors group-hover:text-blue-700">
            <span className="mr-1.5 font-medium text-slate-400">
              {row.venue === 'home' ? 'vs' : '@'}
            </span>
            {row.opponent}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span
            className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${resultTone}`}
          >
            {row.result}
          </span>
          <span className="text-lg font-extrabold tabular-nums text-slate-900">
            {row.score}
          </span>
        </div>

        <div className={`text-[14px] tabular-nums ${spreadTone}`}>{row.spreadLabel}</div>
        <div className={`text-[14px] tabular-nums ${totalTone}`}>{row.totalLabel}</div>
      </div>

      <div className="flex flex-col gap-3 p-4 md:hidden">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
            {row.dateLabel} <span className="mx-1.5 text-slate-300">•</span> {row.venue}
          </div>

          <span
            className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${resultTone}`}
          >
            {row.result}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-[15px] font-bold text-slate-900 transition-colors group-hover:text-blue-600">
            <span className="mr-1.5 font-medium text-slate-400">
              {row.venue === 'home' ? 'vs' : '@'}
            </span>
            {row.opponent}
          </div>
          <div className="text-lg font-extrabold tabular-nums text-slate-900">{row.score}</div>
        </div>

        <div className="mt-1 grid grid-cols-2 gap-2">
          <div
            className={`flex flex-col items-center justify-center rounded-lg border border-slate-200/60 bg-slate-50/50 px-2.5 py-1.5 text-center ${spreadTone}`}
          >
            <span className="mb-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
              ATS
            </span>
            <span className="text-xs">{row.spreadLabel}</span>
          </div>

          <div
            className={`flex flex-col items-center justify-center rounded-lg border border-slate-200/60 bg-slate-50/50 px-2.5 py-1.5 text-center ${totalTone}`}
          >
            <span className="mb-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
              Total
            </span>
            <span className="text-xs">{row.totalLabel}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ============================================================================
// Main
// ============================================================================

export default function TeamPage() {
  const { slug } = useParams<{ slug: string }>();

  const [matches, setMatches] = useState<SoccerPostgame[]>([]);
  const [meta, setMeta] = useState<TeamMeta | null>(null);
  const [record, setRecord] = useState<TeamRecord | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [venueFilter, setVenueFilter] = useState<VenueFilter>('all');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [spreadFilter, setSpreadFilter] = useState<SpreadFilter>('all');
  const [windowFilter, setWindowFilter] = useState<WindowFilter>('all');

  useEffect(() => {
    let cancelled = false;

    async function init(): Promise<void> {
      setLoading(true);
      setError(null);
      setMatches([]);
      setMeta(null);
      setRecord(null);

      if (!slug) {
        setError('Missing team slug.');
        setLoading(false);
        return;
      }

      try {
        const teamNameFromSlug = slug.replace(/-/g, ' ');

        const [teamMeta, teamMatches] = await Promise.all([
          fetchTeamMeta(teamNameFromSlug),
          fetchTeamMatches(slug),
        ]);

        if (cancelled) return;

        const safeMeta = (teamMeta as TeamMeta | null) ?? null;
        const safeMatches = Array.isArray(teamMatches) ? teamMatches : [];

        setMeta(safeMeta);
        setMatches(safeMatches);

        if (safeMatches.length > 0) {
          const canonicalTeamName =
            safeMeta?.name || safeMeta?.short_name || safeMeta?.abbreviation || teamNameFromSlug;

          const nextRecord = computeTeamRecord(safeMatches, canonicalTeamName);
          setRecord(nextRecord);

          const pageTitle = `${canonicalTeamName} ATS Record & Results | The Drip`;
          document.title = pageTitle;

          const atsDen = nextRecord.ats.covered + nextRecord.ats.failed;
          const coverPct =
            atsDen > 0 ? ((nextRecord.ats.covered / atsDen) * 100).toFixed(1) : '0.0';
          const desc = `${canonicalTeamName} ATS record: ${nextRecord.ats.covered}-${nextRecord.ats.failed}. Cover rate: ${coverPct}%. Full season results with closing lines.`;

          upsertMetaTag('meta[property="og:title"]', 'content', pageTitle);
          upsertMetaTag('meta[property="og:description"]', 'content', desc);
          upsertMetaTag('meta[name="description"]', 'content', desc);
        } else {
          setError('No team matches found.');
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load team ledger.';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const fallbackSlugName = (slug || '').replace(/-/g, ' ');
  const teamName = meta?.name || meta?.short_name || meta?.abbreviation || fallbackSlugName;
  const teamColor = meta?.color || C.accent;

  const teamAliases = useMemo<string[]>(() => {
    return [
      meta?.name,
      meta?.short_name,
      meta?.abbreviation,
      fallbackSlugName,
      teamName,
    ].filter((value): value is string => Boolean(value && value.trim()));
  }, [meta?.abbreviation, meta?.name, meta?.short_name, fallbackSlugName, teamName]);

  const ledgerRows = useMemo<LedgerRow[]>(() => {
    return matches
      .map((match) => buildLedgerRow(match, teamAliases))
      .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
  }, [matches, teamAliases]);

  const filteredRows = useMemo<LedgerRow[]>(() => {
    let rows = ledgerRows;

    if (venueFilter !== 'all') rows = rows.filter((r) => r.venue === venueFilter);
    if (resultFilter !== 'all') rows = rows.filter((r) => r.result === resultFilter);
    if (spreadFilter !== 'all') rows = rows.filter((r) => r.spreadOutcome === spreadFilter);
    if (windowFilter !== 'all') rows = rows.slice(0, Number(windowFilter));

    return rows;
  }, [ledgerRows, venueFilter, resultFilter, spreadFilter, windowFilter]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, LedgerRow[]>();

    for (const row of filteredRows) {
      if (!groups.has(row.monthLabel)) groups.set(row.monthLabel, []);
      groups.get(row.monthLabel)?.push(row);
    }

    return Array.from(groups.entries()).map(([month, items]) => ({
      month,
      items,
    }));
  }, [filteredRows]);

  const recentForm = useMemo(() => {
    const recent = ledgerRows.slice(0, Math.min(5, ledgerRows.length));
    const wins = recent.filter((r) => r.result === 'win').length;
    const draws = recent.filter((r) => r.result === 'draw').length;
    const losses = recent.filter((r) => r.result === 'loss').length;
    return { sample: recent.length, wins, draws, losses };
  }, [ledgerRows]);

  if (loading) {
    return (
      <div className={`${THEME.layout.page} flex min-h-[100svh] items-center justify-center`}>
        <div className="flex flex-col items-center gap-3">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Loading Team Ledger...
          </div>
        </div>
      </div>
    );
  }

  if (error || !record || matches.length === 0) {
    return (
      <div className={`${THEME.layout.page} flex min-h-[100svh] flex-col items-center justify-center gap-5`}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-slate-200/60 bg-slate-100 text-2xl">
          🔍
        </div>
        <p className="text-base font-bold text-slate-700">{error || 'Team record not found.'}</p>
        <Link to="/edge" className={THEME.components.navLink}>
          Back to Edge
        </Link>
      </div>
    );
  }

  const atsTotal = record.ats.covered + record.ats.failed;
  const coverPct = atsTotal > 0 ? (record.ats.covered / atsTotal) * 100 : 0;
  const totalGames = Math.max(1, record.wins + record.draws + record.losses);
  const cleanSheetPct = ((record.cleanSheets / totalGames) * 100).toFixed(1);

  return (
    <div className={THEME.layout.page}>
      <header className={THEME.layout.header}>
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Link to="/edge" className={THEME.components.navLink}>
              Edge
            </Link>
            <Link to="/trends" className={THEME.components.navLink}>
              Trends
            </Link>
          </div>

          <span className="rounded-full border border-slate-200/60 bg-slate-100 px-2.5 py-1 text-[10px] font-bold tracking-wider text-slate-500 sm:text-xs">
            {filteredRows.length} MATCHES
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 md:space-y-8 md:py-10">
        <section className={`${THEME.layout.section} bg-white/50 p-5 backdrop-blur-sm md:p-6`}>
          <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-4 sm:gap-6">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm sm:h-24 sm:w-24">
                {meta?.logo_url ? (
                  <img
                    src={meta.logo_url}
                    alt={teamName}
                    className="h-full w-full object-contain drop-shadow-sm"
                  />
                ) : (
                  <span
                    className="text-3xl font-extrabold sm:text-4xl"
                    style={{ color: teamColor }}
                  >
                    {teamName?.[0] || '?'}
                  </span>
                )}
              </div>

              <div className="min-w-0">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600 sm:text-[11px]">
                  Team Ledger
                </p>
                <h1 className="truncate pr-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl md:text-5xl">
                  {teamName}
                </h1>
                <p className="mt-1.5 text-sm font-medium text-slate-500 sm:mt-2">
                  {meta?.league_id || 'League'} season matchbook with ATS and totals closing-line context.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:w-[650px] xl:shrink-0">
              <StatCard
                label="ATS Form"
                value={`${record.ats.covered}-${record.ats.failed}-${record.ats.push}`}
                subtext={`${coverPct.toFixed(1)}% cover (n=${atsTotal})`}
              />
              <StatCard
                label="Match W-D-L"
                value={`${record.wins}-${record.draws}-${record.losses}`}
                subtext={`Recent ${recentForm.wins}-${recentForm.draws}-${recentForm.losses}`}
              />
              <StatCard
                label="Over / Under"
                value={`${record.ou.over}-${record.ou.under}-${record.ou.push}`}
                subtext={`Totals decisions n=${record.ou.over + record.ou.under}`}
              />
              <StatCard
                label="Goal Profile"
                value={`${record.goalsFor}-${record.goalsAgainst}`}
                subtext={`${cleanSheetPct}% clean sheet rate`}
              />
            </div>
          </div>
        </section>

        <section className={`${THEME.layout.section} space-y-5 bg-white/50 p-5 backdrop-blur-sm sm:p-6`}>
          <div className="ml-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Match Filters
          </div>

          <div className="flex flex-col gap-4">
            <FilterGroup
              label="Venue"
              options={FILTER_OPTIONS.venue}
              currentValue={venueFilter}
              onChange={setVenueFilter}
            />
            <FilterGroup
              label="Result"
              options={FILTER_OPTIONS.result}
              currentValue={resultFilter}
              onChange={setResultFilter}
            />
            <FilterGroup
              label="Spread"
              options={FILTER_OPTIONS.spread}
              currentValue={spreadFilter}
              onChange={setSpreadFilter}
            />
            <FilterGroup
              label="Window"
              options={FILTER_OPTIONS.window}
              currentValue={windowFilter}
              onChange={setWindowFilter}
            />
          </div>
        </section>

        <section className={`${THEME.layout.section} overflow-visible`}>
          <div className="flex items-center justify-between rounded-t-2xl border-b border-slate-200/80 bg-white px-5 py-4">
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                Match Ledger
              </h2>
              <p className="mt-0.5 text-[11px] font-medium text-slate-500 sm:text-xs">
                Chronological record with verdicts.
              </p>
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <div className="rounded-b-2xl bg-white px-4 py-16 text-center text-sm font-medium text-slate-500">
              No matches match the current filters.
            </div>
          ) : (
            <div className="rounded-b-2xl bg-white">
              <div className="sticky top-[61px] z-20 hidden gap-4 border-b border-slate-200/80 bg-slate-50/95 px-5 py-3.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 shadow-[0_1px_2px_rgba(0,0,0,0.02)] backdrop-blur-md md:grid md:grid-cols-[130px_1fr_100px_180px_140px]">
                <span>Date</span>
                <span>Opponent</span>
                <span>Result</span>
                <span>Closing Spread</span>
                <span>O/U Total</span>
              </div>

              {groupedRows.map((group) => (
                <div key={group.month}>
                  <div className="flex items-center justify-between border-y border-slate-200/60 bg-slate-100/90 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                    <span className="text-slate-700">{group.month}</span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-400">
                      {group.items.length} Matches
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100/80">
                    {group.items.map((row) => (
                      <MatchRow key={row.id} row={row} />
                    ))}
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
