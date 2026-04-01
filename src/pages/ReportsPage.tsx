import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchLeagueIds, fetchLeagueMatches, fetchTeamsInLeague, getSpreadResult, getTotalResult, type SoccerPostgame } from '../lib/postgame';
import { LEAGUE_LABELS, formatMatchDate, matchUrl, teamUrl } from '../lib/slugs';
import SEOHead from '@/components/seo/SEOHead';

// ============================================================================
// Types
// ============================================================================

type LeagueOption = { id: string; label: string };
type ViewMode = 'results' | 'standings';
type ResultFilter = 'all' | 'home' | 'away' | 'draw' | 'over' | 'under' | 'upset';
type DateWindow = 'all' | '30d' | '14d' | '7d';
type ResultsSort = 'latest' | 'goals' | 'upset';
type StandingsSort = 'cover' | 'atsRoi' | 'points' | 'goalDiff';

type TeamStanding = {
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  atsCovered: number;
  atsFailed: number;
  atsPush: number;
  atsBets: number;
  atsUnits: number;
  atsRoiPct: number;
  coverPct: number;
  over: number;
  under: number;
  ouPush: number;
  bttsHits: number;
  bttsPct: number;
  avgGoals: number;
};

// ============================================================================
// SSOT: Modernized Theme & Styling
// ============================================================================

const THEME = {
  profitColor: (val: number) => (val >= 0 ? 'text-emerald-600' : 'text-rose-600'),
  profitBg: (val: number) => (val >= 0 ? 'bg-emerald-50/50 border-emerald-100/50' : 'bg-rose-50/50 border-rose-100/50'),
  gdColor: (val: number) => (val > 0 ? 'text-emerald-600' : val < 0 ? 'text-rose-600' : 'text-slate-700'),
  teamText: (isWinner: boolean) => (isWinner ? 'text-slate-900 font-bold' : 'text-slate-500 font-medium'),
  scoreText: (isWinner: boolean) => (isWinner ? 'text-slate-900 font-bold' : 'text-slate-400 font-semibold'),
  spreadText: {
    covered: 'font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100',
    failed: 'font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-100',
    push: 'font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200',
  },
  layout: {
    page: 'h-(--vvh,100vh) overflow-y-auto overscroll-y-contain bg-slate-50/50 text-slate-900 font-sans pb-12 sm:pb-20 selection:bg-blue-100',
    header: 'sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md shadow-sm',
    section: 'rounded-2xl border border-slate-200/75 bg-white shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] overflow-hidden transition-all',
  },
  components: {
    navLink: 'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 transition-all active:scale-95',
    input: 'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all',
    tableHeaderRow: 'bg-slate-50/95 backdrop-blur-sm',
    tableHeaderCell: 'whitespace-nowrap px-4 py-3.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500',
    tableDataCell: 'whitespace-nowrap px-4 py-3.5 text-[13px] sm:text-[14px] tabular-nums transition-colors',
    leagueBtnActive: 'bg-blue-600 text-white shadow-[0_4px_10px_-2px_rgba(37,99,235,0.4)] ring-1 ring-blue-700',
    leagueBtnInactive: 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300',
    tabActive: 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200/60 font-bold',
    tabInactive: 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50 font-semibold',
  },
} as const;

// ============================================================================
// Clean Info: Filter Configurations
// ============================================================================

const FILTER_OPTIONS = {
  dateWindow: [
    { value: 'all', label: 'All Time' },
    { value: '30d', label: 'Last 30 days' },
    { value: '14d', label: 'Last 14 days' },
    { value: '7d', label: 'Last 7 days' },
  ] as { value: DateWindow; label: string }[],
  resultType: [
    { value: 'all', label: 'All Results' },
    { value: 'home', label: 'Home Wins' },
    { value: 'away', label: 'Away Wins' },
    { value: 'draw', label: 'Draws' },
    { value: 'over', label: 'Overs' },
    { value: 'under', label: 'Unders' },
    { value: 'upset', label: 'Upsets' },
  ] as { value: ResultFilter; label: string }[],
  resultsSort: [
    { value: 'latest', label: 'Latest First' },
    { value: 'goals', label: 'Highest Scoring' },
    { value: 'upset', label: 'Biggest Upsets' },
  ] as { value: ResultsSort; label: string }[],
  standingsSort: [
    { value: 'cover', label: 'Cover %' },
    { value: 'atsRoi', label: 'ATS ROI %' },
    { value: 'points', label: 'League Points' },
    { value: 'goalDiff', label: 'Goal Difference' },
  ] as { value: StandingsSort; label: string }[],
};

// ============================================================================
// Pure Helpers
// ============================================================================

const pct = (num: number, den: number): number => (den > 0 ? (num / den) * 100 : 0);
const avg = (num: number, den: number): number => (den > 0 ? num / den : 0);
const safeN = (n: number | null | undefined): number => (Number.isFinite(n as number) ? Number(n) : 0);

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

function computeStandings(matches: SoccerPostgame[], teamNames: string[]): TeamStanding[] {
  const map = new Map<string, TeamStanding>();

  const ensureTeam = (name: string): TeamStanding => {
    const existing = map.get(name);
    if (existing) return existing;
    const next: TeamStanding = {
      name, played: 0, wins: 0, draws: 0, losses: 0, points: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0,
      atsCovered: 0, atsFailed: 0, atsPush: 0, atsBets: 0, atsUnits: 0, atsRoiPct: 0, coverPct: 0,
      over: 0, under: 0, ouPush: 0, bttsHits: 0, bttsPct: 0, avgGoals: 0,
    };
    map.set(name, next);
    return next;
  };

  for (const name of teamNames) ensureTeam(name);

  for (const match of matches) {
    const home = ensureTeam(match.home_team);
    const away = ensureTeam(match.away_team);

    home.played += 1;
    away.played += 1;
    home.goalsFor += match.home_score;
    home.goalsAgainst += match.away_score;
    away.goalsFor += match.away_score;
    away.goalsAgainst += match.home_score;

    if (match.home_score > match.away_score) {
      home.wins += 1; home.points += 3; away.losses += 1;
    } else if (match.away_score > match.home_score) {
      away.wins += 1; away.points += 3; home.losses += 1;
    } else {
      home.draws += 1; away.draws += 1; home.points += 1; away.points += 1;
    }

    if (match.home_score > 0 && match.away_score > 0) {
      home.bttsHits += 1; away.bttsHits += 1;
    }

    const spread = getSpreadResult(match);
    if (spread) {
      const homeOutcome: 'win' | 'loss' | 'push' = spread.result === 'covered' ? 'win' : spread.result === 'failed' ? 'loss' : 'push';
      const awayOutcome: 'win' | 'loss' | 'push' = spread.result === 'covered' ? 'loss' : spread.result === 'failed' ? 'win' : 'push';

      if (homeOutcome === 'win') home.atsCovered += 1; else if (homeOutcome === 'loss') home.atsFailed += 1; else home.atsPush += 1;
      if (awayOutcome === 'win') away.atsCovered += 1; else if (awayOutcome === 'loss') away.atsFailed += 1; else away.atsPush += 1;

      if (homeOutcome !== 'push') home.atsBets += 1;
      if (awayOutcome !== 'push') away.atsBets += 1;

      // FIX: Guard spread price null — exclude from ROI numerator+denominator if missing
      if (Number.isFinite(match.dk_home_spread_price as number)) {
        home.atsUnits += settleUnits(match.dk_home_spread_price, homeOutcome);
      } else if (homeOutcome !== 'push') {
        home.atsBets -= 1;
      }
      if (Number.isFinite(match.dk_away_spread_price as number)) {
        away.atsUnits += settleUnits(match.dk_away_spread_price, awayOutcome);
      } else if (awayOutcome !== 'push') {
        away.atsBets -= 1;
      }
    }

    const total = getTotalResult(match);
    if (total) {
      if (total.result === 'over') { home.over += 1; away.over += 1; }
      else if (total.result === 'under') { home.under += 1; away.under += 1; }
      else { home.ouPush += 1; away.ouPush += 1; }
    }
  }

  return [...map.values()].map((team) => ({
    ...team,
    goalDiff: team.goalsFor - team.goalsAgainst,
    coverPct: pct(team.atsCovered, team.atsCovered + team.atsFailed),
    atsRoiPct: pct(team.atsUnits, team.atsBets),
    bttsPct: pct(team.bttsHits, team.played),
    avgGoals: avg(team.goalsFor + team.goalsAgainst, team.played),
  }));
}

// ============================================================================
// UI Sub-Components
// ============================================================================

function StatCard({
  label,
  value,
  context,
  valueClass = 'text-slate-900',
  bgClass = 'bg-white border-slate-200/75'
}: {
  label: string;
  value: React.ReactNode;
  context?: React.ReactNode;
  valueClass?: string;
  bgClass?: string;
}) {
  return (
    <article className={`relative flex flex-col justify-center overflow-hidden rounded-2xl border p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all duration-300 hover:-translate-y-1 hover:shadow-md ${bgClass}`}>
      <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 opacity-80">{label}</div>
      <div className={`mt-1.5 text-2xl sm:text-[1.7rem] font-bold tracking-tight tabular-nums leading-none ${valueClass}`}>{value}</div>
      {context && <div className="mt-2 text-[10px] sm:text-[11px] font-medium text-slate-500 opacity-90">{context}</div>}
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
    <div className="flex flex-col gap-1.5 w-full">
      <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 ml-1">{label}</label>
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
    <div className="flex flex-col gap-1.5 w-full">
      <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 ml-1">{label}</label>
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

function MatchCard({ match }: { match: SoccerPostgame }) {
  const spread = getSpreadResult(match);
  const total = getTotalResult(match);
  const homeWinner = match.home_score > match.away_score;
  const awayWinner = match.away_score > match.home_score;
  const upsetVal = upsetLine(match);

  return (
    <Link
      to={matchUrl(match.home_team, match.away_team, match.start_time)}
      className="group relative flex flex-col h-full rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <span>{formatMatchDate(match.start_time)}</span>
        <span>{LEAGUE_LABELS[match.league_id] || match.league_id}</span>
      </div>

      <div className="mt-3 space-y-2 flex-grow">
        <div className="flex items-center justify-between">
          <span className={`text-[15px] sm:text-base transition-colors group-hover:text-blue-900 ${THEME.teamText(homeWinner)}`}>{match.home_team}</span>
          <span className={`text-[1.5rem] tabular-nums leading-none ${THEME.scoreText(homeWinner)}`}>{match.home_score}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className={`text-[15px] sm:text-base transition-colors group-hover:text-blue-900 ${THEME.teamText(awayWinner)}`}>{match.away_team}</span>
          <span className={`text-[1.5rem] tabular-nums leading-none ${THEME.scoreText(awayWinner)}`}>{match.away_score}</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 text-[11px] font-medium text-slate-500 bg-slate-50/50 p-2.5 rounded-xl border border-slate-100">
        <div>SPR <span className="text-slate-700 ml-1 font-semibold">{match.dk_spread != null ? (match.dk_spread > 0 ? `+${match.dk_spread}` : `${match.dk_spread}`) : '—'}</span></div>
        <div className="text-right">O/U <span className="text-slate-700 ml-1 font-semibold">{match.dk_total ?? '—'}</span></div>
        <div>Corners <span className="text-slate-700 ml-1 font-semibold">{safeN(match.home_corners) + safeN(match.away_corners)}</span></div>
        <div className="text-right">Cards <span className="text-slate-700 ml-1 font-semibold">{safeN(match.home_yellow_cards) + safeN(match.away_yellow_cards) + safeN(match.home_red_cards) + safeN(match.away_red_cards)}</span></div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 text-[10px] font-bold uppercase tracking-widest">
        {spread && (
          <span className={`px-2 py-1 rounded border ${THEME.spreadText[spread.result]}`}>
            ATS: {spread.result === 'covered' ? 'Home' : spread.result === 'failed' ? 'Away' : 'Push'}
          </span>
        )}
        {total && (
          <span className="px-2 py-1 rounded border border-slate-200 bg-slate-50 text-slate-600">
            TOT: {total.result}
          </span>
        )}
        {isUpset(match) && (
          <span className="px-2 py-1 rounded border border-rose-200 bg-rose-50 text-rose-700">
            UPSET {upsetVal > 0 ? `(+${upsetVal})` : upsetVal}
          </span>
        )}
      </div>
    </Link>
  );
}

function StandingRow({ row, idx }: { row: TeamStanding; idx: number }) {
  return (
    <tr className="group hover:bg-slate-50 transition-colors border-t border-slate-100/80">
      <td className={`${THEME.components.tableDataCell} sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[1px_0_0_0_rgba(241,245,249,1)] transition-colors`}>
        <Link to={teamUrl(row.name)} className="font-bold text-slate-900 hover:text-blue-600 transition-colors flex items-center">
          <span className="text-slate-400 font-medium text-xs w-5">{idx + 1}.</span> {row.name}
        </Link>
      </td>
      <td className={`${THEME.components.tableDataCell} text-right text-slate-500`}>{row.wins}-{row.draws}-{row.losses}</td>
      <td className={`${THEME.components.tableDataCell} text-right font-extrabold text-slate-900`}>{row.points}</td>
      <td className={`${THEME.components.tableDataCell} text-right font-bold ${THEME.gdColor(row.goalDiff)}`}>
        {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
      </td>
      <td className={`${THEME.components.tableDataCell} text-right text-slate-500`}>{row.atsCovered}-{row.atsFailed}-{row.atsPush}</td>
      <td className={`${THEME.components.tableDataCell} text-right`} title={`ATS sample (n = ${row.atsBets})`}>
        <div className="inline-flex flex-col items-end leading-tight">
          <span className="font-bold text-slate-700">{row.coverPct.toFixed(1)}%</span>
          <span className="mt-0.5 text-[10px] text-slate-400 font-medium tracking-wide">n={row.atsBets}</span>
        </div>
      </td>
      <td className={`${THEME.components.tableDataCell} text-right`} title={`ATS sample (n = ${row.atsBets})`}>
        <div className="inline-flex flex-col items-end leading-tight">
          <span className={`font-extrabold ${THEME.profitColor(row.atsRoiPct)}`}>{row.atsRoiPct.toFixed(1)}%</span>
          <span className="mt-0.5 text-[10px] text-slate-400 font-medium tracking-wide">n={row.atsBets}</span>
        </div>
      </td>
      <td className={`${THEME.components.tableDataCell} text-right text-slate-500`}>{row.over}-{row.under}-{row.ouPush}</td>
      <td className={`${THEME.components.tableDataCell} text-right`} title={`Games sample (n = ${row.played})`}>
        <div className="inline-flex flex-col items-end leading-tight">
          <span className="font-bold text-slate-700">{row.bttsPct.toFixed(1)}%</span>
          <span className="mt-0.5 text-[10px] text-slate-400 font-medium tracking-wide">n={row.played}</span>
        </div>
      </td>
      <td className={`${THEME.components.tableDataCell} text-right font-medium text-slate-600`}>{row.avgGoals.toFixed(2)}</td>
    </tr>
  );
}

function StandingsTable({ data }: { data: TeamStanding[] }) {
  if (data.length === 0) {
    return <div className="px-4 py-12 text-center text-sm font-medium text-slate-500">No teams match current standings filters.</div>;
  }

  return (
    <div className="w-full overflow-x-auto rounded-b-2xl overscroll-x-contain pb-2">
      <table className="w-full min-w-[1000px] text-left border-separate border-spacing-0">
        <thead>
          <tr className={THEME.components.tableHeaderRow}>
            <th className={`${THEME.components.tableHeaderCell} sticky top-[57px] md:top-[65px] left-0 z-30 bg-slate-50/95 backdrop-blur shadow-[inset_0_-1px_0_0_rgba(226,232,240,0.8),_1px_0_0_0_rgba(226,232,240,1)] text-left`}>Team</th>
            <th className={`${THEME.components.tableHeaderCell} sticky top-[57px] md:top-[65px] z-20 bg-slate-50/95 backdrop-blur shadow-[inset_0_-1px_0_0_rgba(226,232,240,0.8)] text-right`}>W-D-L</th>
            <th className={`${THEME.components.tableHeaderCell} sticky top-[57px] md:top-[65px] z-20 bg-slate-50/95 backdrop-blur shadow-[inset_0_-1px_0_0_rgba(226,232,240,0.8)] text-right`}>Pts</th>
            <th className={`${THEME.components.tableHeaderCell} sticky top-[57px] md:top-[65px] z-20 bg-slate-50/95 backdrop-blur shadow-[inset_0_-1px_0_0_rgba(226,232,240,0.8)] text-right`}>GD</th>
            <th className={`${THEME.components.tableHeaderCell} sticky top-[57px] md:top-[65px] z-20 bg-slate-50/95 backdrop-blur shadow-[inset_0_-1px_0_0_rgba(226,232,240,0.8)] text-right`}>ATS</th>
            <th className={`${THEME.components.tableHeaderCell} sticky top-[57px] md:top-[65px] z-20 bg-slate-50/95 backdrop-blur shadow-[inset_0_-1px_0_0_rgba(226,232,240,0.8)] text-right`}>
              <span>Cover %</span>
              <span className="block mt-0.5 text-[9px] normal-case tracking-normal opacity-70">Sample n</span>
            </th>
            <th className={`${THEME.components.tableHeaderCell} sticky top-[57px] md:top-[65px] z-20 bg-slate-50/95 backdrop-blur shadow-[inset_0_-1px_0_0_rgba(226,232,240,0.8)] text-right`}>
              <span>ATS ROI %</span>
              <span className="block mt-0.5 text-[9px] normal-case tracking-normal opacity-70">Sample n</span>
            </th>
            <th className={`${THEME.components.tableHeaderCell} sticky top-[57px] md:top-[65px] z-20 bg-slate-50/95 backdrop-blur shadow-[inset_0_-1px_0_0_rgba(226,232,240,0.8)] text-right`}>O/U</th>
            <th className={`${THEME.components.tableHeaderCell} sticky top-[57px] md:top-[65px] z-20 bg-slate-50/95 backdrop-blur shadow-[inset_0_-1px_0_0_rgba(226,232,240,0.8)] text-right`}>
              <span>BTTS %</span>
              <span className="block mt-0.5 text-[9px] normal-case tracking-normal opacity-70">Sample n</span>
            </th>
            <th className={`${THEME.components.tableHeaderCell} sticky top-[57px] md:top-[65px] z-20 bg-slate-50/95 backdrop-blur shadow-[inset_0_-1px_0_0_rgba(226,232,240,0.8)] text-right`}>Avg Goals</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100/80 bg-white">
          {data.map((row, idx) => (
            <StandingRow key={row.name} row={row} idx={idx} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function ReportsPage() {
  const [leagueOptions, setLeagueOptions] = useState<LeagueOption[]>([]);
  const [leagueId, setLeagueId] = useState<string>('');
  const [view, setView] = useState<ViewMode>('results');
  const [matches, setMatches] = useState<SoccerPostgame[]>([]);
  const [teamRows, setTeamRows] = useState<TeamStanding[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const [search, setSearch] = useState<string>('');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [dateWindow, setDateWindow] = useState<DateWindow>('all');
  const [onlyWithLines, setOnlyWithLines] = useState<boolean>(false);
  const [resultsSort, setResultsSort] = useState<ResultsSort>('latest');
  const [standingsSort, setStandingsSort] = useState<StandingsSort>('cover');
  const [minGames, setMinGames] = useState<number>(5);

  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    const loadLeagues = async () => {
      const ids = await fetchLeagueIds();
      if (!active) return;
      const options = ids.map((id) => ({ id, label: LEAGUE_LABELS[id] || id.toUpperCase() }));
      setLeagueOptions(options);
      if (!leagueId && options.length > 0) setLeagueId(options[0].id);
    };
    void loadLeagues();
    return () => { active = false; };
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const [leagueMatches, teams] = await Promise.all([
          fetchLeagueMatches(leagueId),
          fetchTeamsInLeague(leagueId),
        ]);
        if (!active) return;
        setMatches(leagueMatches);
        setTeamRows(computeStandings(leagueMatches, teams));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [leagueId]);

  const filteredMatches = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const base = matches.filter((match) => {
      if (!dateInWindow(match.start_time, dateWindow)) return false;
      if (onlyWithLines && (match.dk_home_ml == null || match.dk_total == null || match.dk_spread == null)) return false;

      if (needle) {
        const combined = `${match.home_team} ${match.away_team}`.toLowerCase();
        if (!combined.includes(needle)) return false;
      }

      if (resultFilter === 'home') return match.home_score > match.away_score;
      if (resultFilter === 'away') return match.away_score > match.home_score;
      if (resultFilter === 'draw') return match.home_score === match.away_score;
      if (resultFilter === 'upset') return isUpset(match);
      if (resultFilter === 'over' || resultFilter === 'under') {
        const total = getTotalResult(match);
        return total ? total.result === resultFilter : false;
      }

      return true;
    });

    if (resultsSort === 'goals') return base.slice().sort((a, b) => (b.home_score + b.away_score) - (a.home_score + a.away_score));
    if (resultsSort === 'upset') return base.slice().sort((a, b) => upsetLine(b) - upsetLine(a));
    return base.slice().sort((a, b) => (Date.parse(b.start_time) || 0) - (Date.parse(a.start_time) || 0));
  }, [matches, search, dateWindow, onlyWithLines, resultFilter, resultsSort]);

  const summary = useMemo(() => {
    if (filteredMatches.length === 0) return null;

    let totalGoals = 0, homeWins = 0, awayWins = 0, draws = 0;
    let homeCovered = 0, atsBets = 0, homeSpreadUnits = 0;
    let overs = 0, unders = 0, totalBets = 0, overUnits = 0;
    let favoriteWins = 0, dogWins = 0, moneylineDecisions = 0;
    let bttsHits = 0, closeGames = 0;
    let cornersTotal = 0, cardsTotal = 0, passPctTotal = 0, shotAccTotal = 0, qualityRows = 0;

    for (const match of filteredMatches) {
      const goals = match.home_score + match.away_score;
      totalGoals += goals;

      if (match.home_score > match.away_score) homeWins += 1;
      else if (match.away_score > match.home_score) awayWins += 1;
      else draws += 1;

      if (Math.abs(match.home_score - match.away_score) <= 1) closeGames += 1;
      if (match.home_score > 0 && match.away_score > 0) bttsHits += 1;

      const spread = getSpreadResult(match);
      if (spread) {
        if (spread.result === 'covered') homeCovered += 1;
        if (spread.result !== 'push') atsBets += 1;
        const homeOutcome: 'win' | 'loss' | 'push' = spread.result === 'covered' ? 'win' : spread.result === 'failed' ? 'loss' : 'push';
        // FIX: Guard spread price null — exclude from ROI denominator if missing
        if (Number.isFinite(match.dk_home_spread_price as number)) {
          homeSpreadUnits += settleUnits(match.dk_home_spread_price, homeOutcome);
        } else if (homeOutcome !== 'push') {
          atsBets -= 1;
        }
      }

      const total = getTotalResult(match);
      if (total) {
        if (total.result === 'over') overs += 1;
        if (total.result === 'under') unders += 1;
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

      const corners = safeN(match.home_corners) + safeN(match.away_corners);
      const cards = safeN(match.home_yellow_cards) + safeN(match.away_yellow_cards) + safeN(match.home_red_cards) + safeN(match.away_red_cards);
      // ⚠️ DATA TEAM: Verify pass_pct/shot_accuracy scale — if already 0-100, remove * 100
      const passPct = avg(safeN(match.home_pass_pct) + safeN(match.away_pass_pct), 2) * 100;
      const shotAcc = avg(safeN(match.home_shot_accuracy) + safeN(match.away_shot_accuracy), 2) * 100;

      cornersTotal += corners; cardsTotal += cards; passPctTotal += passPct; shotAccTotal += shotAcc; qualityRows += 1;
    }

    return {
      sample: filteredMatches.length,
      atsBets, totalBets, moneylineDecisions,
      avgGoals: avg(totalGoals, filteredMatches.length),
      homeWinPct: pct(homeWins, filteredMatches.length),
      drawPct: pct(draws, filteredMatches.length),
      awayWinPct: pct(awayWins, filteredMatches.length),
      homeCoverPct: pct(homeCovered, atsBets),
      overPct: pct(overs, totalBets),
      favoriteWinPct: pct(favoriteWins, moneylineDecisions),
      dogWinPct: pct(dogWins, moneylineDecisions),
      bttsPct: pct(bttsHits, filteredMatches.length),
      closeGamePct: pct(closeGames, filteredMatches.length),
      homeSpreadRoiPct: pct(homeSpreadUnits, atsBets),
      overRoiPct: pct(overUnits, totalBets),
      avgCorners: avg(cornersTotal, qualityRows),
      avgCards: avg(cardsTotal, qualityRows),
      avgPassPct: avg(passPctTotal, qualityRows),
      avgShotAcc: avg(shotAccTotal, qualityRows),
    };
  }, [filteredMatches]);

  const filteredStandings = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const cutoffMatches = dateWindow === 'all' ? 0 : dateWindow === '30d' ? 30 : dateWindow === '14d' ? 14 : 7;

    let rows = teamRows.filter((team) => {
      if (team.played < minGames) return false;
      if (needle && !team.name.toLowerCase().includes(needle)) return false;
      if (cutoffMatches > 0 && team.played < Math.max(2, Math.floor(cutoffMatches / 2))) return false;
      return true;
    });

    if (standingsSort === 'points') rows = rows.sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff);
    else if (standingsSort === 'goalDiff') rows = rows.sort((a, b) => b.goalDiff - a.goalDiff || b.points - a.points);
    else if (standingsSort === 'atsRoi') rows = rows.sort((a, b) => b.atsRoiPct - a.atsRoiPct || b.coverPct - a.coverPct);
    else rows = rows.sort((a, b) => b.coverPct - a.coverPct || b.atsRoiPct - a.atsRoiPct);

    return rows;
  }, [teamRows, search, minGames, standingsSort, dateWindow]);

  const selectedLeague = leagueOptions.find((league) => league.id === leagueId);
  const leagueLabel = selectedLeague?.label || LEAGUE_LABELS[leagueId] || leagueId.toUpperCase();
  const seoTitle = `${leagueLabel || 'League'} Edge Report | The Drip`;
  const seoDescription = `${leagueLabel || 'League'} results, standings, ATS coverage, and totals performance from closing-line records.`;

  const handleReset = () => {
    setSearch('');
    setDateWindow('all');
    setResultFilter('all');
    setOnlyWithLines(false);
    setResultsSort('latest');
    setStandingsSort('cover');
    setMinGames(5);
  };

  return (
    <>
      <SEOHead title={seoTitle} description={seoDescription} canonicalPath="/edge" />
      <div className={THEME.layout.page}>

      {/* Navigation Header */}
      <header className={THEME.layout.header}>
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Link to="/" className={THEME.components.navLink}>Home</Link>
            <Link to="/trends" className={THEME.components.navLink}>Trends</Link>
          </div>
          <span className="text-[10px] sm:text-xs font-bold text-slate-500 tracking-wider bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200/60">
            {filteredMatches.length} MATCHES
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-8 md:py-10 space-y-8 md:space-y-12">

        {/* Title Area */}
        <section className="space-y-3">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900">
            {leagueLabel || 'League Edge'}
          </h1>
          <p className="text-sm sm:text-base font-medium text-slate-500 max-w-3xl leading-relaxed">
            Season results, dynamic standings, and advanced betting performance derived directly from closing line databases.
          </p>
        </section>

        {/* Filter Panel */}
        <section className={`${THEME.layout.section} p-5 sm:p-6 bg-white/50 backdrop-blur-sm space-y-6`}>

          {/* Top Row: League Selector & View Toggles */}
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="space-y-2.5">
              <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 ml-1">Select League</label>
              <div className="flex flex-wrap gap-2">
                {leagueOptions.map((league) => {
                  const isActive = leagueId === league.id;
                  return (
                    <button
                      key={league.id}
                      type="button"
                      onClick={() => setLeagueId(league.id)}
                      className={`rounded-xl px-4 py-2.5 text-xs font-bold tracking-wide transition-all active:scale-95 ${isActive ? THEME.components.leagueBtnActive : THEME.components.leagueBtnInactive
                        }`}
                    >
                      {league.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Segmented View Toggle */}
            <div className="inline-flex rounded-xl bg-slate-100/80 p-1.5 border border-slate-200/60 shadow-inner w-full lg:w-auto">
              <button
                type="button"
                onClick={() => setView('results')}
                className={`${THEME.components.tabActive} flex-1 lg:flex-none rounded-lg px-6 py-2.5 text-xs transition-all ${view === 'results' ? THEME.components.tabActive : THEME.components.tabInactive}`}
              >
                Match Results
              </button>
              <button
                type="button"
                onClick={() => setView('standings')}
                className={`${THEME.components.tabActive} flex-1 lg:flex-none rounded-lg px-6 py-2.5 text-xs transition-all ${view === 'standings' ? THEME.components.tabActive : THEME.components.tabInactive}`}
              >
                Standings + ATS
              </button>
            </div>
          </div>

          <div className="h-px bg-slate-200/60 w-full"></div>

          {/* Bottom Row: General Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 items-end">
            <FilterInput label="Search Team" value={search} onChange={setSearch} placeholder="e.g. Arsenal" />
            <FilterSelect label="Date Window" value={dateWindow} options={FILTER_OPTIONS.dateWindow} onChange={(val) => setDateWindow(val as DateWindow)} />

            <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-2">
              <button
                type="button"
                onClick={handleReset}
                className="h-[42px] px-5 rounded-xl border border-slate-200 bg-white text-xs font-bold tracking-wide text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors active:scale-95 shadow-sm"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setShowAdvancedFilters((prev) => !prev)}
                className={`h-[42px] flex-1 px-5 rounded-xl border text-xs font-bold tracking-wide transition-colors active:scale-95 shadow-sm ${showAdvancedFilters
                    ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                    : 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50'
                  }`}
              >
                {showAdvancedFilters ? 'Hide Advanced' : 'Advanced Filters'}
              </button>
            </div>
          </div>

          {/* Expandable Advanced Filters */}
          <div className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${showAdvancedFilters ? 'max-h-96 opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 sm:p-5 shadow-inner">
              <h3 className="mb-4 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 ml-1">Advanced Options</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                {view === 'results' ? (
                  <>
                    <FilterSelect label="Result Type" value={resultFilter} options={FILTER_OPTIONS.resultType} onChange={(val) => setResultFilter(val as ResultFilter)} />
                    <FilterSelect label="Sort Order" value={resultsSort} options={FILTER_OPTIONS.resultsSort} onChange={(val) => setResultsSort(val as ResultsSort)} />

                    <label className="flex h-[42px] w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors shadow-sm active:scale-[0.98]">
                      <input type="checkbox" checked={onlyWithLines} onChange={(e) => setOnlyWithLines(e.target.checked)} className="h-4 w-4 accent-blue-600 rounded border-slate-300" />
                      Must Have Betting Lines
                    </label>

                    <div className="text-[11px] font-bold text-slate-400 pb-3 text-center sm:text-right lg:text-left">
                      Filtered matches: <span className="bg-slate-200/50 px-2 py-1 rounded-md text-slate-600 ml-1">{filteredMatches.length}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <FilterSelect label="Standings Sort" value={standingsSort} options={FILTER_OPTIONS.standingsSort} onChange={(val) => setStandingsSort(val as StandingsSort)} />

                    <FilterInput type="number" label="Minimum Games Played" min={1} max={40} value={minGames} onChange={(v) => setMinGames(Math.max(1, Math.min(40, Number(v) || 1)))} />

                    <div className="text-[11px] font-bold text-slate-400 pb-3 text-center sm:text-right lg:col-span-2">
                      Filtered rows: <span className="bg-slate-200/50 px-2 py-1 rounded-md text-slate-600 ml-1">{filteredStandings.length}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Dashboard Metrics */}
        {summary && (
          <div className="space-y-8">
            <section className="space-y-3">
              <h2 className="text-sm font-bold tracking-widest text-slate-400 uppercase ml-1">Market Performance</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4">
                <StatCard label="Home ATS ROI" value={`${summary.homeSpreadRoiPct.toFixed(1)}%`} valueClass={THEME.profitColor(summary.homeSpreadRoiPct)} bgClass={THEME.profitBg(summary.homeSpreadRoiPct)} />
                <StatCard label="Over ROI" value={`${summary.overRoiPct.toFixed(1)}%`} valueClass={THEME.profitColor(summary.overRoiPct)} bgClass={THEME.profitBg(summary.overRoiPct)} />
                <StatCard label="Home Cover %" value={`${summary.homeCoverPct.toFixed(1)}%`} />
                <StatCard label="Total Over Rate" value={`${summary.overPct.toFixed(1)}%`} />
                <StatCard label="Favorite Win %" value={`${summary.favoriteWinPct.toFixed(1)}%`} />
                <StatCard label="Underdog Win %" value={`${summary.dogWinPct.toFixed(1)}%`} />
                <StatCard label="BTTS Hits" value={`${summary.bttsPct.toFixed(1)}%`} />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-bold tracking-widest text-slate-400 uppercase ml-1">Match Profile Averages</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4">
                <StatCard label="Avg Goals" value={summary.avgGoals.toFixed(2)} />
                <StatCard label="Avg Corners" value={summary.avgCorners.toFixed(1)} />
                <StatCard label="Avg Cards" value={summary.avgCards.toFixed(1)} />
                <StatCard label="Close Games" value={`${summary.closeGamePct.toFixed(1)}%`} context="1 goal margin" />
                <StatCard label="Pass Accuracy" value={`${summary.avgPassPct.toFixed(1)}%`} />
                <StatCard label="Shot Accuracy" value={`${summary.avgShotAcc.toFixed(1)}%`} />
              </div>
            </section>
          </div>
        )}

        {/* Dynamic Data Views */}
        {loading ? (
          <section className={`${THEME.layout.section} p-12 text-center`}>
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600 mb-3" />
            <p className="text-sm font-bold tracking-widest text-slate-400 uppercase">Loading League Data...</p>
          </section>
        ) : view === 'results' ? (
          <section className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filteredMatches.length === 0 ? (
              <div className={`${THEME.layout.section} p-12 text-sm font-medium text-slate-500 col-span-full text-center`}>
                No matches found for current filters.
              </div>
            ) : (
              filteredMatches.map((match) => <MatchCard key={match.id} match={match} />)
            )}
          </section>
        ) : (
          <section className={`${THEME.layout.section} overflow-visible`}>
            <div className="px-5 py-4 border-b border-slate-200/80 bg-white flex items-center justify-between rounded-t-2xl">
              <h2 className="text-base font-bold text-slate-900 tracking-tight">League Standings</h2>
            </div>
            <StandingsTable data={filteredStandings} />
          </section>
        )}
      </main>
      </div>
    </>
  );
}
