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
// SSOT: Colors & Theme
// ============================================================================

const THEME = {
  result: {
    win: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    loss: 'bg-rose-50 text-rose-700 border-rose-200',
    draw: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  spread: {
    covered: 'text-emerald-700',
    failed: 'text-rose-700',
    push: 'text-slate-600',
    off: 'text-slate-500',
  },
  total: {
    over: 'text-slate-900',
    under: 'text-slate-700',
    push: 'text-slate-500',
    off: 'text-slate-500',
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
    { value: 'all', label: 'All' },
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
    if (!target || target.length < 2) return false;
    if (clean === target) return true;
    // Word-boundary match to prevent "LA" matching "Atlanta"
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(clean);
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
            : spreadResult.result === 'push' ? 'push'
              : 'off';
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
// Sub-Components
// ============================================================================

function StatCard({ label, value, subtext }: { label: string; value: React.ReactNode; subtext: React.ReactNode }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{subtext}</div>
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
    <div className="flex flex-wrap gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 self-center min-w-[50px] mr-1">
        {label}
      </span>
      {options.map((option) => {
        const isActive = currentValue === option.value;
        const stateClass = isActive
          ? 'bg-slate-900 text-white border-slate-900'
          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900 hover:bg-slate-50';

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest transition ${stateClass}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MatchRow({ row }: { row: LedgerRow }) {
  const resultTone = THEME.result[row.result];
  const spreadTone = THEME.spread[row.spreadOutcome];
  const totalTone = THEME.total[row.totalOutcome];

  return (
    <Link to={row.href} className="block px-4 py-3 hover:bg-slate-50 transition group">
      {/* Desktop Layout */}
      <div className="hidden md:grid md:grid-cols-[130px_1fr_130px_220px_180px] gap-3 items-center">
        <div className="text-xs text-slate-500 tabular-nums">
          <div>{row.dateLabel}</div>
          <div className="mt-1 uppercase tracking-widest text-[10px]">{row.venue === 'home' ? 'Home' : 'Away'}</div>
        </div>

        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate group-hover:text-slate-600 transition-colors">
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

      {/* Mobile Layout */}
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

      const typedMeta: TeamMeta | null = (teamMeta as TeamMeta | null) ?? null;
      setMeta(typedMeta);
      setMatches(teamMatches);

      if (teamMatches.length > 0) {
        const canonicalTeamName = typedMeta?.name || typedMeta?.short_name || teamNameFromSlug;

        const nextRecord = computeTeamRecord(teamMatches, canonicalTeamName);
        setRecord(nextRecord);

        // Document Meta Tags
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
    return () => { alive = false; };
  }, [slug]);

  const teamName = meta?.name || meta?.short_name || (slug || '').replace(/-/g, ' ');
  const teamColor = meta?.color || C.accent;

  // 1. Process all matches into strictly typed rows
  const ledgerRows = useMemo<LedgerRow[]>(() => {
    const keyNames = [teamName, (slug || '').replace(/-/g, ' ')].filter(Boolean);
    return matches
      .map((match) => buildLedgerRow(match, keyNames))
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
      <div className="min-h-screen bg-slate-50 text-slate-500 flex items-center justify-center text-xs font-semibold uppercase tracking-[0.16em]">
        Loading Team Ledger
      </div>
    );
  }

  if (!record || matches.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center gap-4">
        <p className="text-base font-semibold">Record not found.</p>
        <Link to="/edge" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50">
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
    <div className="h-(--vvh,100vh) overflow-y-auto bg-slate-50 text-slate-900" style={{ opacity: ready ? 1 : 0, transition: 'opacity 0.5s ease-out' }}>

      {/* Top Header Navigation */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-2">
            <Link to="/edge" className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors">
              Edge
            </Link>
            <Link to="/trends" className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors">
              Trends
            </Link>
          </div>
          <span className="text-[11px] font-medium text-slate-500">{filteredRows.length} matches in view</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 md:px-6 py-8 space-y-6">

        {/* Profile Header & Stats */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
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

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 shrink-0">
              <StatCard
                label="ATS"
                value={`${record.ats.covered}-${record.ats.failed}-${record.ats.push}`}
                subtext={`${coverPct.toFixed(1)}% cover (n=${atsTotal})`}
              />
              <StatCard
                label="W-D-L"
                value={`${record.wins}-${record.draws}-${record.losses}`}
                subtext={`Recent ${recentForm.wins}-${recentForm.draws}-${recentForm.losses} (last ${recentForm.sample})`}
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
        <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Match Filters</div>
          <FilterGroup label="Venue" options={FILTER_OPTIONS.venue} currentValue={venueFilter} onChange={setVenueFilter} />
          <FilterGroup label="Result" options={FILTER_OPTIONS.result} currentValue={resultFilter} onChange={setResultFilter} />
          <FilterGroup label="ATS" options={FILTER_OPTIONS.spread} currentValue={spreadFilter} onChange={setSpreadFilter} />
          <FilterGroup label="Window" options={FILTER_OPTIONS.window} currentValue={windowFilter} onChange={setWindowFilter} />
        </section>

        {/* Match Ledger Table */}
        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
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
                  <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 bg-slate-50 border-y border-slate-100 flex justify-between items-center">
                    <span>{group.month}</span>
                    <span className="text-slate-400">{group.items.length} matches</span>
                  </div>
                  <div className="divide-y divide-slate-100">
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
