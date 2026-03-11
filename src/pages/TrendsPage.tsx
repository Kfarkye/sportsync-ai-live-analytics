import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchRecentMatches, getSpreadResult, getTotalResult, type SoccerPostgame } from '../lib/postgame';
import { formatMatchDate, LEAGUE_LABELS, LEAGUE_SHORT, matchUrl } from '../lib/slugs';

// ============================================================================
// Types
// ============================================================================

type DateWindow = 'all' | '30d' | '14d' | '7d';

type LeagueTrend = {
  leagueId: string;
  label: string;
  games: number;
  homeCoverPct: number;
  overPct: number;
  bttsPct: number;
  avgGoals: number;
  avgCorners: number;
  avgCards: number;
};

// ============================================================================
// SSOT: Colors & Theme
// ============================================================================

const THEME = {
  profit: (val: number) => (val >= 0 ? 'text-emerald-600' : 'text-rose-600'),
  layout: {
    page: 'h-(--vvh,100vh) overflow-y-auto overscroll-y-contain bg-[#F4F6FF] text-slate-900',
    header: 'sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur shadow-[0_1px_0_rgba(17,24,39,0.06)]',
    section: 'rounded-2xl border border-slate-200 bg-white shadow-[0_18px_36px_-28px_rgba(30,64,175,0.24)]',
  },
  components: {
    navLink: 'rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors',
    statCard: 'rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-[0_10px_24px_-22px_rgba(30,64,175,0.22)]',
    input: 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 transition-colors',
    tableHeaderRow: 'border-b border-slate-200 bg-[#F8FAFC]',
    tableHeaderCell: 'sticky top-[53px] z-20 bg-[#F8FAFC]/95 backdrop-blur px-3 py-2.5 text-[11px] uppercase tracking-[0.12em] text-slate-500',
  },
} as const;

// ============================================================================
// Clean Info: Filter Configurations
// ============================================================================

const FILTER_OPTIONS = {
  dateWindow: [
    { value: 'all', label: 'All' },
    { value: '30d', label: 'Last 30 days' },
    { value: '14d', label: 'Last 14 days' },
    { value: '7d', label: 'Last 7 days' },
  ] as { value: DateWindow; label: string }[],
};

// ============================================================================
// Pure Helpers
// ============================================================================

const safeN = (n: number | null | undefined): number => (Number.isFinite(n as number) ? Number(n) : 0);
const pct = (num: number, den: number): number => (den > 0 ? (num / den) * 100 : 0);
const avg = (num: number, den: number): number => (den > 0 ? num / den : 0);

function dateInWindow(value: string, window: DateWindow): boolean {
  if (window === 'all') return true;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const now = Date.now();
  const days = window === '30d' ? 30 : window === '14d' ? 14 : 7;
  return parsed >= now - days * 24 * 60 * 60 * 1000;
}

function isUpset(match: SoccerPostgame): boolean {
  if (match.dk_home_ml == null || match.dk_away_ml == null) return false;
  if (match.home_score === match.away_score) return false;
  const homeFav = match.dk_home_ml < match.dk_away_ml;
  const awayWon = match.away_score > match.home_score;
  const homeWon = match.home_score > match.away_score;
  return (homeFav && awayWon) || (!homeFav && homeWon);
}

function upsetLine(match: SoccerPostgame): number {
  if (match.dk_home_ml == null || match.dk_away_ml == null) return 0;
  const homeFav = match.dk_home_ml < match.dk_away_ml;
  return homeFav ? safeN(match.dk_away_ml) : safeN(match.dk_home_ml);
}

function americanProfit(odds: number | null | undefined): number {
  if (odds == null || !Number.isFinite(odds)) return 0;
  if (odds > 0) return odds / 100;
  if (odds < 0) return 100 / Math.abs(odds);
  return 0;
}

function settleUnits(odds: number | null | undefined, outcome: 'win' | 'loss' | 'push'): number {
  if (outcome === 'push') return 0;
  if (!Number.isFinite(odds as number)) return 0;
  return outcome === 'win' ? americanProfit(odds) : -1;
}

// ============================================================================
// UI Sub-Components
// ============================================================================

function StatCard({ label, value, valueClass = 'text-slate-900' }: { label: string; value: string | React.ReactNode; valueClass?: string }) {
  return (
    <article className={THEME.components.statCard}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className={`mt-1 text-[1.55rem] leading-none font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </article>
  );
}

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (val: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={THEME.components.input}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  min,
  max,
}: {
  label: string;
  value: string | number;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</label>
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={THEME.components.input}
      />
    </div>
  );
}

function LeagueTable({ data }: { data: LeagueTrend[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[900px] w-full text-[13px]">
        <thead>
          <tr className={THEME.components.tableHeaderRow}>
            <th className={`${THEME.components.tableHeaderCell} px-4 text-left`}>League</th>
            <th className={`${THEME.components.tableHeaderCell} text-right`}>Games</th>
            <th className={`${THEME.components.tableHeaderCell} text-right`}>Home ATS</th>
            <th className={`${THEME.components.tableHeaderCell} text-right`}>Over %</th>
            <th className={`${THEME.components.tableHeaderCell} text-right`}>BTTS %</th>
            <th className={`${THEME.components.tableHeaderCell} text-right`}>Avg Goals</th>
            <th className={`${THEME.components.tableHeaderCell} text-right`}>Avg Corners</th>
            <th className={`${THEME.components.tableHeaderCell} text-right`}>Avg Cards</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.leagueId} className="border-t border-slate-100 hover:bg-blue-50/45 transition-colors">
              <td className="px-4 py-2.5 font-semibold text-slate-900">{row.label}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{row.games}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.homeCoverPct.toFixed(1)}%</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.overPct.toFixed(1)}%</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.bttsPct.toFixed(1)}%</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.avgGoals.toFixed(2)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.avgCorners.toFixed(1)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.avgCards.toFixed(1)}</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">No data available for current filters.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function MatchList({
  title,
  matches,
  getValueLabel,
  getValueColor
}: {
  title: string;
  matches: SoccerPostgame[];
  getValueLabel: (m: SoccerPostgame) => string;
  getValueColor: (m: SoccerPostgame) => string;
}) {
  return (
    <article className={`${THEME.layout.section} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-800 bg-[#F8FAFC]">
        {title}
      </div>
      <div className="p-4 space-y-2">
        {matches.map((match) => (
          <Link
            key={match.id}
            to={matchUrl(match.home_team, match.away_team, match.start_time)}
            className="grid grid-cols-[1fr_auto_auto] gap-3 items-center rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 hover:border-blue-200 transition-colors"
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">
                {match.home_team} vs {match.away_team}
              </div>
              <div className="text-[11px] text-slate-500">
                {LEAGUE_SHORT[match.league_id] || match.league_id.toUpperCase()} · {formatMatchDate(match.start_time)}
              </div>
            </div>
            <div className="text-sm tabular-nums text-slate-600">
              {match.home_score}-{match.away_score}
            </div>
            <div className={`text-sm font-semibold tabular-nums ${getValueColor(match)}`}>
              {getValueLabel(match)}
            </div>
          </Link>
        ))}
        {matches.length === 0 && <div className="text-sm text-slate-500 py-4 text-center">No matches met criteria.</div>}
      </div>
    </article>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function TrendsPage() {
  const [matches, setMatches] = useState<SoccerPostgame[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [dateWindow, setDateWindow] = useState<DateWindow>('all');
  const [search, setSearch] = useState<string>('');
  const [upsetThreshold, setUpsetThreshold] = useState<number>(150);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchRecentMatches(600);
        if (active) setMatches(data);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    document.title = 'Betting Trends | The Drip';
    return () => { active = false; };
  }, []);

  const dynamicLeagueOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const match of matches) ids.add(match.league_id);
    const sorted = [...ids].sort();
    return [
      { value: 'all', label: 'All leagues' },
      ...sorted.map(id => ({ value: id, label: LEAGUE_LABELS[id] || id.toUpperCase() }))
    ];
  }, [matches]);

  const filteredMatches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return matches.filter((match) => {
      if (leagueFilter !== 'all' && match.league_id !== leagueFilter) return false;
      if (!dateInWindow(match.start_time, dateWindow)) return false;
      if (needle) {
        const combined = `${match.home_team} ${match.away_team}`.toLowerCase();
        if (!combined.includes(needle)) return false;
      }
      return true;
    });
  }, [matches, leagueFilter, dateWindow, search]);

  const summary = useMemo(() => {
    if (filteredMatches.length === 0) return null;

    let goals = 0, homeCovered = 0, atsBets = 0, homeSpreadUnits = 0;
    let overs = 0, totalBets = 0, overUnits = 0;
    let favoriteWins = 0, dogWins = 0, moneylineDecisions = 0;
    let btts = 0, corners = 0, cards = 0, passPct = 0, shotAcc = 0;

    for (const match of filteredMatches) {
      goals += match.home_score + match.away_score;

      const spread = getSpreadResult(match);
      if (spread) {
        if (spread.result === 'covered') homeCovered += 1;
        if (spread.result !== 'push') atsBets += 1;
        const outcome: 'win' | 'loss' | 'push' = spread.result === 'covered' ? 'win' : spread.result === 'failed' ? 'loss' : 'push';
        // FIX: Guard spread price null — exclude from ROI denominator if missing
        if (Number.isFinite(match.dk_home_spread_price as number)) {
          homeSpreadUnits += settleUnits(match.dk_home_spread_price, outcome);
        } else if (outcome !== 'push') {
          atsBets -= 1; // No price → exclude from ROI denominator
        }
      }

      const total = getTotalResult(match);
      if (total) {
        if (total.result === 'over') overs += 1;
        if (total.result !== 'push') totalBets += 1;
        const overOutcome: 'win' | 'loss' | 'push' = total.result === 'over' ? 'win' : total.result === 'under' ? 'loss' : 'push';
        // FIX: Guard over price null — exclude from ROI denominator if missing
        if (Number.isFinite(match.dk_over_price as number)) {
          overUnits += settleUnits(match.dk_over_price, overOutcome);
        } else if (overOutcome !== 'push') {
          totalBets -= 1;
        }
      }

      if (match.dk_home_ml != null && match.dk_away_ml != null && match.home_score !== match.away_score) {
        moneylineDecisions += 1;
        const homeFav = match.dk_home_ml < match.dk_away_ml;
        const homeWon = match.home_score > match.away_score;
        if ((homeFav && homeWon) || (!homeFav && !homeWon)) favoriteWins += 1;
        else dogWins += 1;
      }

      if (match.home_score > 0 && match.away_score > 0) btts += 1;

      corners += safeN(match.home_corners) + safeN(match.away_corners);
      cards += safeN(match.home_yellow_cards) + safeN(match.away_yellow_cards) + safeN(match.home_red_cards) + safeN(match.away_red_cards);
      // ⚠️ DATA TEAM: Verify pass_pct/shot_accuracy scale — if already 0-100, remove * 100
      passPct += avg(safeN(match.home_pass_pct) + safeN(match.away_pass_pct), 2) * 100;
      shotAcc += avg(safeN(match.home_shot_accuracy) + safeN(match.away_shot_accuracy), 2) * 100;
    }

    return {
      sample: filteredMatches.length,
      homeCoverPct: pct(homeCovered, atsBets),
      overPct: pct(overs, totalBets),
      favoriteWinPct: pct(favoriteWins, moneylineDecisions),
      dogWinPct: pct(dogWins, moneylineDecisions),
      bttsPct: pct(btts, filteredMatches.length),
      avgGoals: avg(goals, filteredMatches.length),
      avgCorners: avg(corners, filteredMatches.length),
      avgCards: avg(cards, filteredMatches.length),
      avgPassPct: avg(passPct, filteredMatches.length),
      avgShotAcc: avg(shotAcc, filteredMatches.length),
      homeSpreadRoiPct: pct(homeSpreadUnits, atsBets),
      overRoiPct: pct(overUnits, totalBets),
    };
  }, [filteredMatches]);

  const byLeague = useMemo<LeagueTrend[]>(() => {
    const bucket = new Map<string, {
      games: number; homeCovered: number; atsBets: number; overs: number;
      totalBets: number; btts: number; goals: number; corners: number; cards: number;
    }>();

    for (const match of filteredMatches) {
      if (!bucket.has(match.league_id)) {
        bucket.set(match.league_id, { games: 0, homeCovered: 0, atsBets: 0, overs: 0, totalBets: 0, btts: 0, goals: 0, corners: 0, cards: 0 });
      }

      const agg = bucket.get(match.league_id)!;
      agg.games += 1;
      agg.goals += match.home_score + match.away_score;
      agg.corners += safeN(match.home_corners) + safeN(match.away_corners);
      agg.cards += safeN(match.home_yellow_cards) + safeN(match.away_yellow_cards) + safeN(match.home_red_cards) + safeN(match.away_red_cards);
      if (match.home_score > 0 && match.away_score > 0) agg.btts += 1;

      const spread = getSpreadResult(match);
      if (spread) {
        if (spread.result === 'covered') agg.homeCovered += 1;
        if (spread.result !== 'push') agg.atsBets += 1;
      }

      const total = getTotalResult(match);
      if (total) {
        if (total.result === 'over') agg.overs += 1;
        if (total.result !== 'push') agg.totalBets += 1;
      }
    }

    return [...bucket.entries()]
      .map(([leagueId, agg]) => ({
        leagueId,
        label: LEAGUE_LABELS[leagueId] || leagueId.toUpperCase(),
        games: agg.games,
        homeCoverPct: pct(agg.homeCovered, agg.atsBets),
        overPct: pct(agg.overs, agg.totalBets),
        bttsPct: pct(agg.btts, agg.games),
        avgGoals: avg(agg.goals, agg.games),
        avgCorners: avg(agg.corners, agg.games),
        avgCards: avg(agg.cards, agg.games),
      }))
      .sort((a, b) => b.games - a.games);
  }, [filteredMatches]);

  const upsets = useMemo(() => {
    return filteredMatches
      .filter((match) => isUpset(match) && upsetLine(match) >= upsetThreshold)
      .sort((a, b) => upsetLine(b) - upsetLine(a))
      .slice(0, 8);
  }, [filteredMatches, upsetThreshold]);

  const highScoring = useMemo(() => {
    return filteredMatches
      .slice()
      .sort((a, b) => (b.home_score + b.away_score) - (a.home_score + a.away_score))
      .slice(0, 8);
  }, [filteredMatches]);

  // Derived display config for summary cards
  const summaryMetrics = summary ? [
    { label: 'Sample Size', value: `n = ${summary.sample}` },
    { label: 'Home Cover %', value: `${summary.homeCoverPct.toFixed(1)}%` },
    { label: 'Over %', value: `${summary.overPct.toFixed(1)}%` },
    { label: 'Favorite Win %', value: `${summary.favoriteWinPct.toFixed(1)}%` },
    { label: 'Underdog Win %', value: `${summary.dogWinPct.toFixed(1)}%` },
    { label: 'BTTS %', value: `${summary.bttsPct.toFixed(1)}%` },
    { label: 'Avg Goals', value: summary.avgGoals.toFixed(2) },
    { label: 'Avg Corners', value: summary.avgCorners.toFixed(1) },
    { label: 'Avg Cards', value: summary.avgCards.toFixed(1) },
    { label: 'Avg Pass %', value: `${summary.avgPassPct.toFixed(1)}%` },
    { label: 'Avg Shot Accuracy', value: `${summary.avgShotAcc.toFixed(1)}%` },
    { label: 'Home ATS ROI', value: `${summary.homeSpreadRoiPct.toFixed(1)}%`, valueClass: THEME.profit(summary.homeSpreadRoiPct) },
    { label: 'Over ROI', value: `${summary.overRoiPct.toFixed(1)}%`, valueClass: THEME.profit(summary.overRoiPct) },
  ] : [];

  return (
    <div className={THEME.layout.page}>

      {/* Navigation Header */}
      <header className={THEME.layout.header}>
        <div className="mx-auto w-full max-w-7xl px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Link to="/" className={THEME.components.navLink}>Home</Link>
            <Link to="/edge" className={THEME.components.navLink}>Edge</Link>
          </div>
          <span className="text-[11px] font-medium text-slate-500">{filteredMatches.length} matches in view</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 md:px-6 py-8 space-y-6">

        {/* Title */}
        <section className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Betting Trends</h1>
          <p className="text-sm text-slate-600">Advanced market outcomes from DB-backed closing lines and in-match stat profiles.</p>
        </section>

        {/* Filters Panel */}
        <section className={`${THEME.layout.section} p-4 md:p-5`}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <FilterSelect label="League" value={leagueFilter} options={dynamicLeagueOptions} onChange={setLeagueFilter} />
            <FilterSelect label="Date Window" value={dateWindow} options={FILTER_OPTIONS.dateWindow} onChange={setDateWindow} />

            <FilterInput label="Team Filter" value={search} onChange={setSearch} placeholder="Search team" />
            <FilterInput
              label="Upset Threshold"
              type="number"
              min={100}
              max={600}
              value={upsetThreshold}
              onChange={(val) => setUpsetThreshold(Math.max(100, Math.min(600, Number(val) || 100)))}
            />

            <div className="self-end text-[11px] font-semibold tracking-[0.12em] uppercase text-slate-400 pb-2">
              Data source: soccer_postgame
            </div>
          </div>
        </section>

        {loading ? (
          <section className={`${THEME.layout.section} p-8 text-center text-sm font-semibold tracking-wide text-slate-500`}>
            Loading trends...
          </section>
        ) : (
          <>
            {/* Top Level Metric KPIs */}
            {summary && (
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                {summaryMetrics.map((metric) => (
                  <StatCard key={metric.label} label={metric.label} value={metric.value} valueClass={metric.valueClass} />
                ))}
              </section>
            )}

            {/* League Breakdown */}
            <section className={`${THEME.layout.section} overflow-hidden`}>
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-800 bg-[#F8FAFC]">
                League Breakdown
              </div>
              <LeagueTable data={byLeague} />
            </section>

            {/* Highlights Sections (Side-by-side on large screens) */}
            <section className="grid gap-5 xl:grid-cols-2">
              <MatchList
                title="Biggest Upsets"
                matches={upsets}
                getValueLabel={(m) => `+${upsetLine(m)}`}
                getValueColor={() => 'text-rose-600'}
              />
              <MatchList
                title="Highest Scoring"
                matches={highScoring}
                getValueLabel={(m) => `${m.home_score + m.away_score} goals`}
                getValueColor={() => 'text-slate-700'}
              />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
