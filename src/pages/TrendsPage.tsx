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

type TrendSignal = 'TREND' | 'FADE';
type TrendVisibility = 'PUBLIC' | 'PROPRIETARY';
type TrendMode = 'Trend' | 'Fade' | 'Both';
type TrendSortMode = 'edge' | 'rate';
type TrendDirection = 'TREND' | 'FADE' | 'NEUTRAL';

type DripTrend = {
  layer: string;
  league: string;
  entity: string;
  trend: string;
  hit_rate: number;
  sample: number;
  visibility: TrendVisibility;
  signal_type: TrendSignal;
};

type LayerSummary = {
  layer: string;
  total: number;
  avg: number;
  perfect: number;
};

// ============================================================================
// Page Constants
// ============================================================================

const THEME = {
  profit: (val: number) => (val >= 0 ? 'text-emerald-600' : 'text-rose-600'),
  layout: {
    page: 'min-h-[var(--vvh,100vh)] overflow-y-auto overscroll-y-contain bg-[#f4f6ff] text-slate-900',
    header: 'sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur shadow-[0_1px_0_rgba(17,24,39,0.06)]',
    section: 'rounded-2xl border border-slate-200 bg-white shadow-[0_18px_36px_-28px_rgba(30,64,175,0.24)]',
  },
  components: {
    navLink: 'rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors',
    statCard: 'rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-[0_10px_24px_-22px_rgba(30,64,175,0.22)]',
    input: 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 transition-colors',
    tableHeaderRow: 'border-b border-slate-200 bg-[#F8FAFC]',
    tableHeaderCell: 'sticky top-[53px] z-20 bg-[#F8FAFC]/95 backdrop-blur px-3 py-2.5 text-[11px] uppercase tracking-[0.12em] text-slate-500',
    heroPill: 'inline-flex items-center rounded-full border border-white/35 bg-white/55 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-700',
    chip: 'px-2.5 py-1 rounded-full border border-slate-300 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600 hover:border-slate-500 hover:text-slate-900 transition-colors',
    chipActive: 'px-2.5 py-1 rounded-full border border-slate-900 bg-slate-900 text-white',
  },
} as const;

const FILTER_OPTIONS = {
  dateWindow: [
    { value: 'all', label: 'All' },
    { value: '30d', label: 'Last 30 days' },
    { value: '14d', label: 'Last 14 days' },
    { value: '7d', label: 'Last 7 days' },
  ] as { value: DateWindow; label: string }[],
} as const;

const DRIP_SPORT_FILTERS = ['ALL', 'Soccer', 'NBA', 'NHL', 'MLS', 'MLB', 'NCAAB', 'Other'] as const;

const DRIP_LAYER_CARDS: LayerSummary[] = [
  { layer: 'SOCCER_1H_BTTS', total: 31, avg: 88.6, perfect: 12 },
  { layer: 'SOCCER_LATE_GOALS', total: 14, avg: 76.7, perfect: 5 },
  { layer: 'TEAM_ATS_LINE', total: 13, avg: 69.2, perfect: 6 },
  { layer: 'SOCCER_CORNERS', total: 7, avg: 68.3, perfect: 3 },
  { layer: 'TEAM_OU_LINE', total: 7, avg: 67.3, perfect: 4 },
  { layer: 'SOCCER_CARDS', total: 6, avg: 67.9, perfect: 3 },
] as const;

const DRIP_TRENDS: DripTrend[] = [
  { layer: 'SOCCER_1H_BTTS', league: 'eng.1', entity: 'Wolverhampton Wanderers', trend: '1H BTTS NO', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'usa.1', entity: 'LAFC', trend: '1H BTTS NO', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'usa.1', entity: 'FC Cincinnati', trend: '1H BTTS NO', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'fra.1', entity: 'Angers', trend: '1H BTTS NO', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'eng.1', entity: 'Fulham', trend: '1H BTTS NO', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'ger.1', entity: 'FC Augsburg', trend: '1H BTTS NO', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'uefa.champions', entity: 'Bayer Leverkusen', trend: '1H BTTS NO', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'esp.1', entity: 'Getafe', trend: '1H BTTS NO', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'esp.1', entity: 'Levante', trend: '1H BTTS NO', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'fra.1', entity: 'Lille', trend: '1H BTTS NO', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'ger.1', entity: 'St. Pauli', trend: '1H BTTS NO', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_CORNERS', league: 'usa.1', entity: 'Inter Miami CF', trend: 'CORNERS UNDER 10.2', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_CARDS', league: 'fra.1', entity: 'Paris Saint-Germain', trend: 'CARDS UNDER 4', hit_rate: 100, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'TEAM', league: 'uefa.champions', entity: 'Club Brugge', trend: 'OVER 2.5', hit_rate: 100, sample: 10, visibility: 'PROPRIETARY', signal_type: 'TREND' },
  { layer: 'TEAM', league: 'ger.1', entity: 'Bayern Munich', trend: 'OVER 2.5', hit_rate: 100, sample: 10, visibility: 'PROPRIETARY', signal_type: 'TREND' },
  { layer: 'TEAM_OU_LINE', league: 'nhl', entity: 'Edmonton Oilers', trend: 'OVER VS LINE', hit_rate: 90, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'TEAM', league: 'uefa.champions', entity: 'PSV Eindhoven', trend: 'BTTS YES', hit_rate: 90, sample: 10, visibility: 'PROPRIETARY', signal_type: 'TREND' },
  { layer: 'TEAM', league: 'uefa.champions', entity: 'Atlético Madrid', trend: 'BTTS YES', hit_rate: 90, sample: 10, visibility: 'PROPRIETARY', signal_type: 'TREND' },
  { layer: 'TEAM', league: 'eng.1', entity: 'Chelsea', trend: 'BTTS YES', hit_rate: 90, sample: 10, visibility: 'PROPRIETARY', signal_type: 'TREND' },
  { layer: 'TEAM', league: 'esp.1', entity: 'Athletic Club', trend: 'BTTS YES', hit_rate: 90, sample: 10, visibility: 'PROPRIETARY', signal_type: 'TREND' },
  { layer: 'TEAM', league: 'esp.1', entity: 'Real Sociedad', trend: 'BTTS YES', hit_rate: 90, sample: 10, visibility: 'PROPRIETARY', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'esp.1', entity: 'Barcelona', trend: '1H BTTS NO', hit_rate: 90, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_1H_BTTS', league: 'esp.1', entity: 'Real Madrid', trend: '1H BTTS NO', hit_rate: 90, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_LATE_GOALS', league: 'eng.1', entity: 'Manchester City', trend: 'LATE GOAL RESISTANT', hit_rate: 90, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_LATE_GOALS', league: 'fra.1', entity: 'Paris Saint-Germain', trend: 'LATE GOAL RESISTANT', hit_rate: 90, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_HALF_GOALS', league: 'ger.1', entity: 'Bayern Munich', trend: '2H GOALS > 0', hit_rate: 90, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_HALF_GOALS', league: 'fra.1', entity: 'Paris Saint-Germain', trend: '2H GOALS > 0', hit_rate: 90, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_HALF_GOALS', league: 'uefa.champions', entity: 'Newcastle United', trend: '2H GOALS > 0', hit_rate: 90, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_HALF_GOALS', league: 'usa.1', entity: 'LAFC', trend: '2H GOALS > 0', hit_rate: 90, sample: 10, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_LATE_GOALS', league: 'eng.1', entity: 'Manchester City', trend: 'LATE GOAL RESISTANT', hit_rate: 100, sample: 8, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_CARDS', league: 'uefa.champions', entity: 'Eintracht Frankfurt', trend: 'CARDS UNDER 3.6', hit_rate: 100, sample: 8, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_CORNERS', league: 'uefa.europa', entity: 'Feyenoord Rotterdam', trend: 'CORNERS UNDER 9.3', hit_rate: 100, sample: 8, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'TEAM_ATS_LINE', league: 'nba', entity: 'Atlanta Hawks', trend: 'FAV COVER', hit_rate: 100, sample: 6, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'TEAM_ATS_LINE', league: 'nhl', entity: 'Montreal Canadiens', trend: 'DOG COVER', hit_rate: 100, sample: 5, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'TEAM_OU_LINE', league: 'mens-college-basketball', entity: 'Alcorn State Braves', trend: 'UNDER VS LINE', hit_rate: 100, sample: 5, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'TEAM_OU_LINE', league: 'mens-college-basketball', entity: 'Kent State Golden Flashes', trend: 'OVER VS LINE', hit_rate: 100, sample: 5, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_LATE_GOALS', league: 'uefa.europa', entity: 'Rangers', trend: 'LATE GOAL RESISTANT', hit_rate: 100, sample: 8, visibility: 'PUBLIC', signal_type: 'TREND' },
  { layer: 'SOCCER_HT_FT', league: 'eng.1', entity: 'West Ham', trend: 'HT/FT W/W', hit_rate: 78, sample: 9, visibility: 'PUBLIC', signal_type: 'FADE' },
  { layer: 'TEAM', league: 'mlb', entity: 'Dodgers', trend: 'OVER 2.5', hit_rate: 77, sample: 14, visibility: 'PUBLIC', signal_type: 'FADE' },
];

const DRIP_DIRECTION_FILTERS = ['ALL', 'TREND', 'FADE', 'NEUTRAL'] as const;

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

function normalizePct(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value <= 1.5 ? value * 100 : value;
}

function edgeScore(rate: number, sample: number): number {
  const normalized = normalizePct(rate);
  return Math.min(99, Math.max(1, Math.round((normalized * Math.sqrt(sample)) / 6.5)));
}

function signalModeAllowed(mode: TrendMode, signalType: TrendSignal): boolean {
  if (mode === 'Both') return true;
  if (mode === 'Trend') return signalType === 'TREND';
  return signalType === 'FADE';
}

function isSoccerLeague(leagueId: string): boolean {
  const id = leagueId.toLowerCase();
  return id.includes('.') || id.startsWith('uefa') || id === 'mls' || id === 'usa.1';
}

function layerLabel(layer: string): string {
  const map: Record<string, string> = {
    TEAM: 'Team',
    TEAM_OU_LINE: 'O/U Line',
    TEAM_ATS_LINE: 'ATS Line',
    TEAM_BTTS: 'BTTS',
    TEAM_OVER25: 'Over 2.5',
    REFEREE: 'Referee',
    LEAGUE: 'League',
    SOCCER_1H_BTTS: '1H BTTS',
    SOCCER_HALF_GOALS: '2H Goals',
    SOCCER_CORNERS: 'Corners',
    SOCCER_CARDS: 'Cards',
    SOCCER_LATE_GOALS: 'Late Goals',
    SOCCER_HT_FT: 'HT/FT',
    SOCCER_1H_BTTS: '1H BTTS',
  };
  return map[layer] ?? layer.replace(/_/g, ' ');
}

function formatLeague(leagueId: string): string {
  return LEAGUE_LABELS[leagueId] ?? leagueId;
}

function sportFromLeague(leagueId: string): string {
  if (isSoccerLeague(leagueId)) return 'Soccer';
  if (leagueId === 'nba' || leagueId === 'NBA') return 'NBA';
  if (leagueId === 'nhl') return 'NHL';
  if (leagueId === 'mlb') return 'MLB';
  if (leagueId.includes('college-basketball') || leagueId === 'ncaab' || leagueId === 'mens-college-basketball') return 'NCAAB';
  return 'Other';
}

function hitBarSignal(rate: number): 'good' | 'warn' | 'danger' {
  const normalized = normalizePct(rate);
  if (normalized >= 88) return 'good';
  if (normalized >= 74) return 'warn';
  return 'danger';
}

function hitBarClass(rate: number, signal: TrendSignal): string {
  if (signal === 'FADE') return 'bg-rose-400';
  const tone = hitBarSignal(rate);
  if (tone === 'good') return 'bg-emerald-500';
  if (tone === 'warn') return 'bg-amber-400';
  return 'bg-slate-400';
}

function formatRecord(sample: number, hitRate: number): string {
  const normalized = normalizePct(hitRate);
  const wins = Math.round((normalized / 100) * sample);
  const losses = Math.max(0, sample - wins);
  return `${wins}-${losses}`;
}

function formatPercent(value: number, digits = 1): string {
  return `${normalizePct(value).toFixed(digits)}%`;
}

function inferDirectionFromSignal(signal: TrendSignal, trendText: string): TrendDirection {
  if (signal === 'FADE') return 'FADE';

  const text = trendText.toUpperCase();
  if (/(UNDER|LOW|DOWN|DOG|FADE|SELL|HIT|NO|AGAINST|AVOID|SLA)/.test(text)) {
    return 'FADE';
  }
  if (/(OVER|UP|FAV|HOME|BUY|YES|POSITIVE|BET|GOOD|TREND)/.test(text)) {
    return 'TREND';
  }

  return 'NEUTRAL';
}

function directionLabel(direction: TrendDirection): string {
  if (direction === 'FADE') return 'FADE';
  if (direction === 'TREND') return 'TREND';
  return 'NEUTRAL';
}

function directionClass(direction: TrendDirection): string {
  if (direction === 'FADE') return 'text-rose-600 bg-rose-50 border-rose-200';
  if (direction === 'TREND') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  return 'text-slate-600 bg-slate-100 border-slate-200';
}

function signalStrengthFromRow(rate: number, sample: number): number {
  const normalizedRate = normalizePct(rate);
  const sampleBoost = Math.sqrt(sample) * 2.6;
  return Math.max(0, Math.round(normalizedRate * 0.68 + sampleBoost));
}

// ============================================================================
// UI Components
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
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
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

function TrendBoardHitBar({ rate, sample, signalType }: { rate: number; sample: number; signalType: TrendSignal }) {
  const score = edgeScore(rate, sample);
  const pctVal = normalizePct(rate);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] tabular-nums text-slate-500 w-11 text-right">{Math.max(1, score)}%</span>
      <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden flex-shrink-0">
        <div
          className={`h-full rounded-full ${hitBarClass(rate, signalType)}`}
          style={{ width: `${Math.min(pctVal, 100)}%` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums text-slate-700">n={sample}</span>
    </div>
  );
}

function strengthLabel(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B+';
  if (score >= 45) return 'B';
  return 'C';
}

function strengthClass(score: number): string {
  if (score >= 90) return 'border-emerald-500/25 bg-emerald-100 text-emerald-700';
  if (score >= 75) return 'border-sky-500/25 bg-sky-100 text-sky-700';
  if (score >= 60) return 'border-amber-500/25 bg-amber-100 text-amber-700';
  return 'border-slate-200 bg-slate-100 text-slate-500';
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function TrendsPage() {
  const [matches, setMatches] = useState<SoccerPostgame[]>([]);
  const [loading, setLoading] = useState(true);

  // Existing match filters
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [dateWindow, setDateWindow] = useState<DateWindow>('all');
  const [search, setSearch] = useState<string>('');
  const [upsetThreshold, setUpsetThreshold] = useState<number>(150);
  const [boardSearch, setBoardSearch] = useState<string>('');

  // Drip board filters
  const [boardLayerFilter, setBoardLayerFilter] = useState<string>('ALL');
  const [boardSportFilter, setBoardSportFilter] = useState<typeof DRIP_SPORT_FILTERS[number]>('ALL');
  const [boardSignalMode, setBoardSignalMode] = useState<TrendMode>('Trend');
  const [boardVisibility, setBoardVisibility] = useState<'ALL' | TrendVisibility>('ALL');
  const [boardMinHit, setBoardMinHit] = useState(80);
  const [boardMinSample, setBoardMinSample] = useState(10);
  const [boardSortBy, setBoardSortBy] = useState<TrendSortMode>('edge');
  const [boardDirectionFilter, setBoardDirectionFilter] = useState<typeof DRIP_DIRECTION_FILTERS[number]>('ALL');

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
    return () => {
      active = false;
    };
  }, []);

  const dynamicLeagueOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const match of matches) ids.add(match.league_id);
    const sorted = [...ids].sort();
    return [
      { value: 'all', label: 'All leagues' },
      ...sorted.map((id) => ({ value: id, label: LEAGUE_LABELS[id] || id.toUpperCase() })),
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
        if (Number.isFinite(match.dk_home_spread_price as number)) {
          homeSpreadUnits += settleUnits(match.dk_home_spread_price, outcome);
        } else if (outcome !== 'push') {
          atsBets -= 1;
        }
      }

      const total = getTotalResult(match);
      if (total) {
        if (total.result === 'over') overs += 1;
        if (total.result !== 'push') totalBets += 1;
        const overOutcome: 'win' | 'loss' | 'push' = total.result === 'over' ? 'win' : total.result === 'under' ? 'loss' : 'push';
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
    const bucket = new Map<
      string,
      { games: number; homeCovered: number; atsBets: number; overs: number; totalBets: number; btts: number; goals: number; corners: number; cards: number }
    >();

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

  const boardSportOptions = useMemo(() => DRIP_SPORT_FILTERS.map((value) => ({ value, label: value })), []);

  const boardLayerOptions = useMemo(() => {
    const seen = new Set<string>(['ALL']);
    const rows: { value: string; label: string }[] = [{ value: 'ALL', label: 'All' }];

    for (const row of DRIP_LAYER_CARDS) {
      if (!seen.has(row.layer)) {
        seen.add(row.layer);
        rows.push({ value: row.layer, label: layerLabel(row.layer) });
      }
    }
    for (const row of DRIP_TRENDS) {
      if (!seen.has(row.layer)) {
        seen.add(row.layer);
        rows.push({ value: row.layer, label: layerLabel(row.layer) });
      }
    }

    return rows;
  }, []);

  const boardMaxSample = useMemo(() => {
    const filtered = DRIP_TRENDS.filter((row) => signalModeAllowed(boardSignalMode, row.signal_type));
    if (filtered.length === 0) return 10;
    return Math.max(10, Math.max(...filtered.map((row) => row.sample)));
  }, [boardSignalMode]);

  const boardSample = useMemo(() => Math.min(Math.max(5, boardMinSample), boardMaxSample), [boardMinSample, boardMaxSample]);

  const boardLayerSummary = useMemo(() => {
    return DRIP_LAYER_CARDS.map((summary) => {
      const rows = DRIP_TRENDS.filter((row) => row.layer === summary.layer && signalModeAllowed(boardSignalMode, row.signal_type));
      const above = rows.filter((row) => row.hit_rate >= boardMinHit && row.sample >= boardSample);
      const total = rows.filter((row) => row.sample >= boardSample).length;
      const perfect = rows.filter((row) => row.hit_rate >= 100 && row.sample >= boardSample).length;
      return {
        ...summary,
        avg: rows.length === 0 ? 0 : rows.reduce((acc, row) => acc + normalizePct(row.hit_rate), 0) / rows.length,
        perfect,
        total,
        above,
      };
    });
  }, [boardMinHit, boardSample, boardSignalMode]);

  const boardMeta = useMemo(() => {
    const directionCounts = DRIP_TRENDS.reduce(
      (acc, row) => {
        const direction = inferDirectionFromSignal(row.signal_type, row.trend);
        if (direction === 'TREND') acc.trend += 1;
        if (direction === 'FADE') acc.fade += 1;
        if (direction === 'NEUTRAL') acc.neutral += 1;
        return acc;
      },
      { trend: 0, fade: 0, neutral: 0 }
    );
    const activeRows = DRIP_TRENDS.filter((row) => row.sample >= boardSample && row.hit_rate >= boardMinHit);
    const meanHitRate = DRIP_TRENDS.length
      ? Math.round(DRIP_TRENDS.reduce((sum, row) => sum + normalizePct(row.hit_rate), 0) / DRIP_TRENDS.length)
      : 0;
    return {
      total: DRIP_TRENDS.length,
      visible: filteredBoardRows.length,
      active: activeRows.length,
      trendCount: directionCounts.trend,
      fadeCount: directionCounts.fade,
      neutralCount: directionCounts.neutral,
      meanHitRate,
      source: 'Internal trend snapshot',
      updatedAt: new Date().toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    };
  }, [boardSample, boardMinHit, filteredBoardRows.length]);

  const filteredBoardRows = useMemo(() => {
    const needle = boardSearch.trim().toLowerCase();
    const next = DRIP_TRENDS.filter((row) => {
      if (!signalModeAllowed(boardSignalMode, row.signal_type)) return false;
      if (boardLayerFilter !== 'ALL' && row.layer !== boardLayerFilter) return false;
      if (boardSportFilter !== 'ALL' && sportFromLeague(row.league) !== boardSportFilter) return false;
      if (boardVisibility !== 'ALL' && row.visibility !== boardVisibility) return false;
      if (row.hit_rate < boardMinHit) return false;
      if (row.sample < boardSample) return false;
      if (boardDirectionFilter !== 'ALL' && inferDirectionFromSignal(row.signal_type, row.trend) !== boardDirectionFilter) return false;
      if (needle && `${row.entity} ${row.trend} ${row.league}`.toLowerCase().indexOf(needle) === -1) return false;
      return true;
    });

    return boardSortBy === 'edge'
      ? [...next].sort(
          (a, b) =>
            signalStrengthFromRow(b.hit_rate, b.sample) - signalStrengthFromRow(a.hit_rate, a.sample) ||
            (normalizePct(b.hit_rate) - normalizePct(a.hit_rate))
        )
      : [...next].sort((a, b) => normalizePct(b.hit_rate) - normalizePct(a.hit_rate) || b.sample - a.sample);
  }, [
    boardDirectionFilter,
    boardLayerFilter,
    boardMinHit,
    boardMinSample,
    boardSearch,
    boardSignalMode,
    boardSportFilter,
    boardVisibility,
    boardSortBy,
    boardSample,
  ]);

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
      <header className={THEME.layout.header}>
        <div className="mx-auto w-full max-w-7xl px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Link to="/" className={THEME.components.navLink}>Home</Link>
            <Link to="/trends" className={THEME.components.navLink}>Trends</Link>
          </div>
          <span className="text-[11px] font-medium text-slate-500">
            {filteredMatches.length} matches in view
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 md:px-6 py-8 space-y-6">
        <section className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Betting Trends</h1>
          <p className="text-sm text-slate-600">Advanced market outcomes from live match data and internal trend intelligence.</p>
        </section>

        <section className={`${THEME.layout.section} p-4 md:p-5`}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <FilterSelect label="League" value={leagueFilter} options={dynamicLeagueOptions} onChange={setLeagueFilter} />
            <FilterSelect label="Date Window" value={dateWindow} options={FILTER_OPTIONS.dateWindow} onChange={(val) => setDateWindow(val as DateWindow)} />
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
              Data source: soccer_postgame + internal trend snapshot
            </div>
          </div>
        </section>

        {loading ? (
          <section className={`${THEME.layout.section} p-8 text-center text-sm font-semibold tracking-wide text-slate-500`}>
            Loading trends...
          </section>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              {summaryMetrics.map((metric) => (
                <StatCard key={metric.label} label={metric.label} value={metric.value} valueClass={metric.valueClass} />
              ))}
            </section>

            <section className={`${THEME.layout.section} overflow-hidden`}>
              <header className="relative overflow-hidden rounded-t-2xl border-b border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 px-4 py-5 md:px-6 text-white">
                <div className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.3),_transparent_40%),_radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.2),_transparent_35%)]" />
                <div className="relative">
                  <div className="inline-flex items-center gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/90">Trend Board</p>
                    <span className={THEME.components.heroPill}>The Drip Snapshot</span>
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold mt-2">Internal Signal Ledger</h2>
                  <p className="text-sm text-white/75 mt-1">
                    Layered market signals with directional bias and conviction weighted by sample quality.
                  </p>
                  <dl className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 text-xs uppercase tracking-[0.08em] text-white/85">
                    <div><dt className="font-semibold text-white/65">Source</dt><dd>{boardMeta.source}</dd></div>
                    <div><dt className="font-semibold text-white/65">Signals</dt><dd>{boardMeta.total} total</dd></div>
                    <div><dt className="font-semibold text-white/65">Visible</dt><dd>{boardMeta.visible} active</dd></div>
                    <div><dt className="font-semibold text-white/65">Direction</dt><dd>{boardMeta.trendCount}/{boardMeta.fadeCount}/{boardMeta.neutralCount}</dd></div>
                    <div><dt className="font-semibold text-white/65">Avg Hit</dt><dd>{boardMeta.meanHitRate}%</dd></div>
                    <div><dt className="font-semibold text-white/65">Updated</dt><dd>{boardMeta.updatedAt}</dd></div>
                  </dl>
                </div>
              </header>

              <div className="p-4 md:p-5 space-y-5">
                <div className="grid gap-2 sm:gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {boardLayerSummary.map((summaryRow) => {
                    const sampleText = summaryRow.total > 0 ? `${summaryRow.above.length}/${summaryRow.total}` : '0';
                    return (
                      <button
                        key={summaryRow.layer}
                        onClick={() => setBoardLayerFilter((prev) => (prev === summaryRow.layer ? 'ALL' : summaryRow.layer))}
                        className={`text-left rounded-lg border px-3 py-2.5 transition-all ${
                          boardLayerFilter === summaryRow.layer
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className={`text-[10px] uppercase tracking-[0.14em] ${boardLayerFilter === summaryRow.layer ? 'text-white/70' : 'text-slate-500'}`}>
                          {summaryRow.layer}
                        </div>
                        <div className={`text-lg font-semibold ${boardLayerFilter === summaryRow.layer ? 'text-white' : 'text-slate-900'}`}>
                          {summaryRow.avg.toFixed(1)}%
                        </div>
                        <div className={`text-xs mt-1 ${boardLayerFilter === summaryRow.layer ? 'text-white/70' : 'text-slate-500'}`}>
                          {sampleText} above {boardMinHit}% · n≥{boardSample}
                        </div>
                        <div className={`text-[10px] ${boardLayerFilter === summaryRow.layer ? 'text-white/50' : 'text-slate-400'}`}>
                          Perfect: {summaryRow.perfect}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="grid gap-2 xl:grid-cols-[1fr_1fr_auto] 2xl:grid-cols-[1.1fr_1fr_1fr_1fr_auto]">
                  <FilterSelect label="Layer" value={boardLayerFilter} options={boardLayerOptions} onChange={setBoardLayerFilter} />
                  <FilterSelect
                    label="Sport"
                    value={boardSportFilter}
                    options={boardSportOptions}
                    onChange={(val) => setBoardSportFilter(val as typeof DRIP_SPORT_FILTERS[number])}
                  />
                  <FilterSelect
                    label="Signal"
                    value={boardSignalMode}
                    options={[
                      { value: 'Trend', label: 'Trend' },
                      { value: 'Fade', label: 'Fade' },
                      { value: 'Both', label: 'Both' },
                    ]}
                    onChange={(val) => setBoardSignalMode(val as TrendMode)}
                  />
                  <FilterSelect
                    label="Visibility"
                    value={boardVisibility}
                    options={[
                      { value: 'ALL', label: 'All' },
                      { value: 'PUBLIC', label: 'Public' },
                      { value: 'PROPRIETARY', label: 'Pro' },
                    ]}
                    onChange={(val) => setBoardVisibility(val as 'ALL' | TrendVisibility)}
                  />
                  <FilterSelect
                    label="Sort"
                    value={boardSortBy}
                    options={[
                      { value: 'edge', label: 'Strength' },
                      { value: 'rate', label: 'Hit Rate' },
                    ]}
                    onChange={(val) => setBoardSortBy(val as TrendSortMode)}
                  />
                  <FilterInput
                    label="Signal Search"
                    value={boardSearch}
                    onChange={setBoardSearch}
                    placeholder="Search entity or trend"
                  />
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap gap-2.5 items-center">
                    <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Direction</div>
                    {DRIP_DIRECTION_FILTERS.map((item) => (
                      <button
                        key={item}
                        onClick={() => setBoardDirectionFilter(item)}
                        className={boardDirectionFilter === item ? THEME.components.chipActive : THEME.components.chip}
                        type="button"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm">
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      Min Hit {boardMinHit}%
                    </label>
                    <input
                      type="range"
                      min={55}
                      max={100}
                      value={boardMinHit}
                      onChange={(e) => setBoardMinHit(Number(e.target.value))}
                      className="w-full accent-slate-900"
                    />
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      Min Games {boardSample}
                    </label>
                    <input
                      type="range"
                      min={5}
                      max={boardMaxSample}
                      value={boardSample}
                      onChange={(e) => setBoardMinSample(Number(e.target.value))}
                      className="w-full accent-slate-900"
                    />
                    <div className="ml-auto text-sm text-slate-500">Showing {filteredBoardRows.length} signals</div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-[13px]">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <th className="text-left px-3 py-2.5 font-semibold text-slate-500 text-sm">#</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-slate-500 text-sm">Team / Entity</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-slate-500 text-sm">League</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-slate-500 text-sm">Signal</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-slate-500 text-sm">Layer</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-slate-500 text-sm w-48">Signal Quality</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-slate-500 text-sm">Hit %</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-slate-500 text-sm w-20">Sample</th>
                        <th className="text-center px-3 py-2.5 font-semibold text-slate-500 text-sm">Direction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBoardRows.map((row, index) => {
                        const strength = signalStrengthFromRow(row.hit_rate, row.sample);
                        const direction = inferDirectionFromSignal(row.signal_type, row.trend);
                        return (
                          <tr
                            key={`${row.league}-${row.entity}-${row.trend}-${index}`}
                            className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                          >
                            <td className="px-3 py-2.5 text-slate-400">{index + 1}</td>
                            <td className="px-3 py-2.5">
                              <div className="text-sm font-semibold text-slate-900">{row.entity}</div>
                              {row.visibility === 'PROPRIETARY' && (
                                <div className="text-[9px] inline-block mt-1 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-500">PRO</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-left font-mono text-slate-500">{formatLeague(row.league)}</td>
                            <td className="px-3 py-2.5 text-left text-slate-700">
                              <div className="flex items-center gap-1.5">
                                <span>{row.trend}</span>
                              </div>
                              <div className="text-[10px] text-slate-500">{formatRecord(row.sample, row.hit_rate)} · signal {row.signal_type}</div>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-500">
                                {layerLabel(row.layer)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <TrendBoardHitBar rate={row.hit_rate} sample={row.sample} signalType={row.signal_type} />
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                              {formatPercent(row.hit_rate)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{row.sample}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border ${directionClass(direction)}`}>
                                {directionLabel(direction)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredBoardRows.length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-3 py-12 text-center text-sm text-slate-500">
                            No trend signals match the board filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className={`${THEME.layout.section} overflow-hidden`}>
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-800 bg-[#F8FAFC]">
                League Breakdown
              </div>
              <LeagueTable data={byLeague} />
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <MatchList title="Biggest Upsets" matches={upsets} getValueLabel={(m) => `+${upsetLine(m)}`} getValueColor={() => 'text-rose-600'} />
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
