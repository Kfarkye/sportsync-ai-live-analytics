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
import TeamLogo from '../components/shared/TeamLogo';
import SEOHead from '@/components/seo/SEOHead';

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
// SSOT: Modernized Theme & Styling
// ============================================================================

const THEME = {
  result: {
    win: 'bg-emerald-50/80 text-emerald-700 border-emerald-200/80',
    loss: 'bg-rose-50/80 text-rose-700 border-rose-200/80',
    draw: 'bg-slate-100/80 text-slate-700 border-slate-200/80',
  },
  spread: {
    covered: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    failed: 'bg-rose-50 text-rose-700 border-rose-200/80',
    push: 'bg-slate-100 text-slate-500 border-slate-200/80',
    off: 'bg-slate-100/70 text-slate-400 border-slate-200/70',
  },
  total: {
    over: 'bg-rose-50 text-rose-700 border-rose-200/80',
    under: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
    push: 'bg-slate-100 text-slate-500 border-slate-200/80',
    off: 'bg-slate-100/70 text-slate-400 border-slate-200/70',
  },
  layout: {
    page: 'h-(--vvh,100vh) overflow-y-auto overscroll-y-contain bg-slate-50/50 text-slate-900 font-sans pb-12 sm:pb-20 selection:bg-blue-100',
    header: 'sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md shadow-sm',
    section: 'rounded-2xl border border-slate-200/75 bg-white shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] overflow-hidden transition-all',
  },
  row: {
    shell: 'relative overflow-hidden rounded-2xl border border-slate-200/75 bg-white/95 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.45)]',
    shellInner: 'px-4 sm:px-5 py-3.5 sm:py-4',
    accent: {
      win: 'from-emerald-500/10 via-transparent to-emerald-500/5',
      loss: 'from-rose-500/12 via-transparent to-rose-500/4',
      draw: 'from-slate-400/12 via-transparent to-slate-400/4',
    },
  },
  components: {
    navLink: 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 transition-all active:scale-95',
    chipActive: 'bg-slate-900 text-white border-slate-900 shadow-md shadow-slate-900/10 ring-1 ring-slate-900',
    chipInactive: 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900 hover:bg-slate-50 shadow-sm',
  },
} as const;

// ============================================================================
// Clean Info: Filter Configurations
// ============================================================================

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
// Pure Helpers
// ============================================================================

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

function buildLedgerRow(match: SoccerPostgame, keyNames: string[]): LedgerRow {
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
        spreadResult.result === 'covered' ? 'failed'
          : spreadResult.result === 'failed' ? 'covered'
            : 'push';
    }
  }

  const teamSpread = match.dk_spread != null ? (venue === 'home' ? match.dk_spread : -match.dk_spread) : null;
  const spreadPrefix = teamSpread != null ? `${fmt.spread(teamSpread)} · ` : '';
  const spreadLabel =
    spreadOutcome === 'covered' ? `${spreadPrefix}Covered`
      : spreadOutcome === 'failed' ? `${spreadPrefix}Failed`
        : spreadOutcome === 'push' ? `${spreadPrefix}Push`
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
}

// ============================================================================
// UI Sub-Components
// ============================================================================

function StatCard({ label, value, subtext }: { label: string; value: React.ReactNode; subtext: React.ReactNode }) {
  return (
    <article className="relative flex flex-col justify-center overflow-hidden rounded-2xl border border-slate-200/75 bg-white p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
      <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 opacity-80">{label}</div>
      <div className="mt-1.5 text-2xl sm:text-[1.7rem] font-bold tracking-tight tabular-nums leading-none text-slate-900">{value}</div>
      <div className="mt-2 text-[10px] sm:text-[11px] font-medium text-slate-500 opacity-90">{subtext}</div>
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
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 min-w-[50px] ml-1 sm:ml-0">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = currentValue === option.value;
          const stateClass = isActive ? THEME.components.chipActive : THEME.components.chipInactive;

          return (
            <button
              key={option.value}
              type="button"
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
  const isHome = row.venue === 'home';

  return (
    <Link
      to={row.href}
      className={`${THEME.row.shell} block transition-all duration-300 hover:-translate-y-[1px] hover:shadow-[0_16px_34px_-24px_rgba(15,23,42,0.35)]`}
    >
      <span className={`pointer-events-none absolute inset-0 bg-gradient-to-r ${THEME.row.accent[row.result]} opacity-65`} />
      <span className="pointer-events-none absolute left-0 top-0 bottom-0 w-[3px] bg-slate-900/15" />
      <div className={THEME.row.shellInner}>
        {/* Desktop Layout */}
        <div className="hidden md:grid md:grid-cols-[118px_1fr_120px_155px_122px] gap-4 items-center">
          <div className="text-[12px] text-slate-500 tabular-nums leading-tight">
            <div className="font-semibold">{row.dateLabel}</div>
            <div className="mt-1 uppercase tracking-[0.14em] text-[8.5px] font-bold text-slate-400">{isHome ? 'Home' : 'Away'}</div>
          </div>

          <div className="min-w-0 pr-1">
            <div className="text-[16px] sm:text-[17px] font-semibold text-slate-900 truncate group-hover:text-slate-950 transition-colors tracking-tight">
              <span className="text-slate-400 font-medium mr-1.5">{isHome ? 'vs' : '@'}</span>
              {row.opponent}
            </div>
            <div className="mt-1 text-[10px] sm:text-[11px] text-slate-500">Closing lines context</div>
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${resultTone}`}>
              {row.result}
            </span>
            <span className="text-[18px] sm:text-xl font-bold tabular-nums text-slate-900">{row.score}</span>
          </div>

          <span className={`justify-self-start rounded-full border px-2.5 py-1 text-[11px] font-bold ${spreadTone}`}>
            {row.spreadLabel}
          </span>
          <span className={`justify-self-start rounded-full border px-2.5 py-1 text-[11px] font-bold ${totalTone}`}>
            {row.totalLabel}
          </span>
        </div>

        {/* Mobile Layout */}
        <div className="md:hidden flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-500">
              {row.dateLabel} <span className="mx-1.5 text-slate-300">•</span> {row.venue}
            </div>
            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${resultTone}`}>
              {row.result}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-[16px] font-bold text-slate-900 truncate group-hover:text-slate-950 transition-colors">
              <span className="text-slate-400 font-medium mr-1.5">{isHome ? 'vs' : '@'}</span>
              {row.opponent}
            </div>
            <div className="text-xl font-bold tabular-nums text-slate-900">{row.score}</div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className={`rounded-xl border px-2.5 py-2 flex flex-col items-center justify-center text-center ${spreadTone}`}>
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">ATS</span>
              <span className="text-[11px] font-semibold">{row.spreadLabel}</span>
            </div>
            <div className={`rounded-xl border px-2.5 py-2 flex flex-col items-center justify-center text-center ${totalTone}`}>
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">Total</span>
              <span className="text-[11px] font-semibold">{row.totalLabel}</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function TeamPage() {
  const { slug } = useParams<{ slug: string }>();

  // Global State
  const [matches, setMatches] = useState<SoccerPostgame[]>([]);
  const [meta, setMeta] = useState<TeamMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<TeamRecord | null>(null);
  const [ready, setReady] = useState(false);

  // Filter State
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
      }

      setLoading(false);
    }

    void init();
    return () => { alive = false; };
  }, [slug]);

  const teamName = meta?.name || meta?.short_name || (slug || '').replace(/-/g, ' ');
  const teamColor = meta?.color || C.accent;
  const canonicalPath = slug ? `/team/${encodeURIComponent(slug)}` : '/team';
  const loadingSeoTitle = `${teamName || 'Team'} ATS Record & Results | The Drip`;
  const loadingSeoDescription = `${teamName || 'Team'} team results, ATS record, and closing line context.`;

  // 1. Process all matches into strictly typed rows
  const ledgerRows = useMemo<LedgerRow[]>(() => {
    const keyNames = [teamName, (slug || '').replace(/-/g, ' ')].filter(Boolean);
    return matches
      .map((match) => buildLedgerRow(match, keyNames))
      // FIX: NaN-safe date sort — prevents non-deterministic ordering on malformed start_time
      .sort((a, b) => (Date.parse(b.startTime) || 0) - (Date.parse(a.startTime) || 0));
  }, [matches, slug, teamName]);

  // 2. Filter the rows based on current state
  const filteredRows = useMemo(() => {
    let rows = ledgerRows;
    if (venueFilter !== 'all') rows = rows.filter((r) => r.venue === venueFilter);
    if (resultFilter !== 'all') rows = rows.filter((r) => r.result === resultFilter);
    if (spreadFilter !== 'all') rows = rows.filter((r) => r.spreadOutcome === spreadFilter);
    if (windowFilter !== 'all') rows = rows.slice(0, Number(windowFilter));
    return rows;
  }, [ledgerRows, venueFilter, resultFilter, spreadFilter, windowFilter]);

  // 3. Group rows by month
  const groupedRows = useMemo(() => {
    const groups = new Map<string, LedgerRow[]>();
    for (const row of filteredRows) {
      if (!groups.has(row.monthLabel)) groups.set(row.monthLabel, []);
      groups.get(row.monthLabel)?.push(row);
    }
    return Array.from(groups.entries()).map(([month, items]) => ({ month, items }));
  }, [filteredRows]);

  // 4. Summarize recent form based strictly on raw items
  const recentForm = useMemo(() => {
    const recent = ledgerRows.slice(0, Math.min(5, ledgerRows.length));
    const wins = recent.filter((r) => r.result === 'win').length;
    const draws = recent.filter((r) => r.result === 'draw').length;
    const losses = recent.filter((r) => r.result === 'loss').length;
    return { sample: recent.length, wins, draws, losses };
  }, [ledgerRows]);

  // --- Views ---

  if (loading) {
    return (
      <>
        <SEOHead
          title={loadingSeoTitle}
          description={loadingSeoDescription}
          canonicalPath={canonicalPath}
        />
        <div className={`${THEME.layout.page} flex items-center justify-center min-h-screen`}>
          <div className="flex flex-col items-center gap-3">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Loading Team Ledger...</div>
          </div>
        </div>
      </>
    );
  }

  if (!record || matches.length === 0) {
    return (
      <>
        <SEOHead
          title={loadingSeoTitle}
          description={loadingSeoDescription}
          canonicalPath={canonicalPath}
        />
        <div className={`${THEME.layout.page} flex flex-col items-center justify-center min-h-screen gap-5`}>
          <div className="h-16 w-16 rounded-full bg-slate-100 border border-slate-200/60 flex items-center justify-center text-2xl">🔍</div>
          <p className="text-base font-bold text-slate-700">Team record not found.</p>
          <Link to="/edge" className={THEME.components.navLink}>
            Back to Edge
          </Link>
        </div>
      </>
    );
  }

  const atsTotal = record.ats.covered + record.ats.failed;
  const coverPct = atsTotal > 0 ? (record.ats.covered / atsTotal) * 100 : 0;
  const totalGames = Math.max(1, record.wins + record.draws + record.losses);
  const cleanSheetPct = ((record.cleanSheets / totalGames) * 100).toFixed(1);
  const atsDenForSeo = record.ats.covered + record.ats.failed;
  const coverPctForSeo =
    atsDenForSeo > 0 ? ((record.ats.covered / atsDenForSeo) * 100).toFixed(1) : '0.0';
  const seoTitle = `${teamName} ATS Record & Results | The Drip`;
  const seoDescription = `${teamName} ATS record: ${record.ats.covered}-${record.ats.failed}. Cover rate: ${coverPctForSeo}%. Full season results with closing lines.`;

  return (
    <>
      <SEOHead
        title={seoTitle}
        description={seoDescription}
        canonicalPath={canonicalPath}
      />
      <div className={THEME.layout.page} style={{ opacity: ready ? 1 : 0, transition: 'opacity 0.4s ease-out' }}>

      {/* Top Header Navigation */}
      <header className={THEME.layout.header}>
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 py-3">
          <div className="flex items-center gap-2">
            <Link to="/edge" className={THEME.components.navLink}>Edge</Link>
            <Link to="/trends" className={THEME.components.navLink}>Trends</Link>
          </div>
          <span className="text-[10px] sm:text-xs font-bold text-slate-500 tracking-wider bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200/60">
            {filteredRows.length} MATCHES
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-8 md:py-10 space-y-6 md:space-y-8">

        {/* Profile Header & Stats */}
        <section className={`${THEME.layout.section} p-5 md:p-6 bg-white/50 backdrop-blur-sm`}>
          <div className="flex flex-col xl:flex-row gap-6 xl:items-center xl:justify-between">
            <div className="flex items-center gap-4 sm:gap-6 min-w-0">
              <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl border border-slate-200/80 bg-white shadow-sm flex items-center justify-center p-3 shrink-0">
                {meta?.logo_url ? (
                  <TeamLogo
                    logo={meta.logo_url}
                    name={teamName}
                    className="h-full w-full"
                    teamColor={teamColor}
                  />
                ) : (
                  <span className="text-3xl sm:text-4xl font-extrabold" style={{ color: teamColor }}>{teamName[0]}</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600 mb-1">Team Ledger</p>
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight truncate text-slate-900 pr-4">{teamName}</h1>
                <p className="mt-1.5 sm:mt-2 text-sm text-slate-500 font-medium">
                  {meta?.league_id || 'League'} season matchbook with ATS & Totals closing line context.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 xl:shrink-0 xl:w-[650px]">
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

        {/* Filters Panel */}
        <section className={`${THEME.layout.section} p-5 sm:p-6 bg-white/50 backdrop-blur-sm space-y-5`}>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 ml-1">Match Filters</div>
          <div className="flex flex-col gap-4">
            <FilterGroup label="Venue" options={FILTER_OPTIONS.venue} currentValue={venueFilter} onChange={setVenueFilter} />
            <FilterGroup label="Result" options={FILTER_OPTIONS.result} currentValue={resultFilter} onChange={setResultFilter} />
            <FilterGroup label="Spread" options={FILTER_OPTIONS.spread} currentValue={spreadFilter} onChange={setSpreadFilter} />
            <FilterGroup label="Window" options={FILTER_OPTIONS.window} currentValue={windowFilter} onChange={setWindowFilter} />
          </div>
        </section>

        {/* Match Ledger Table */}
        <section className={`${THEME.layout.section} overflow-visible`}>
          <div className="px-5 py-4 border-b border-slate-200/80 bg-white flex items-center justify-between rounded-t-2xl">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">Match Ledger</h2>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 font-medium">Chronological record with verdicts.</p>
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm font-medium text-slate-500 bg-white rounded-b-2xl">
              No matches match the current filters.
            </div>
          ) : (
            <div className="bg-white rounded-b-2xl">
              {/* Desktop Sticky Column Headers */}
              <div className="hidden md:grid md:grid-cols-[118px_1fr_120px_155px_122px] gap-4 px-5 py-3.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 bg-slate-50/95 border-b border-slate-200/80 sticky top-[57px] md:top-[65px] z-30 backdrop-blur-md shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <span>Date</span>
                <span>Opponent</span>
                <span>Result</span>
                <span>Closing Spread</span>
                <span>O/U Total</span>
              </div>

              {groupedRows.map((group) => (
                <div key={group.month}>
                  {/* Month Divider Header */}
                  <div className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 bg-slate-100/90 border-y border-slate-200/60 flex justify-between items-center sticky top-[95px] md:top-[109px] z-20 backdrop-blur-md shadow-[0_1px_0_rgba(255,255,255,0.5)]">
                    <span className="text-slate-700">{group.month}</span>
                    <span className="text-slate-400 bg-white px-2 py-0.5 rounded-full border border-slate-200">{group.items.length} Matches</span>
                  </div>
                  <div className="space-y-2 px-4 pt-3 pb-4 md:px-5">
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
    </>
  );
}
