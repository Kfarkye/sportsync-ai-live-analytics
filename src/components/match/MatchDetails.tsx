// ============================================================================
// src/components/match/MatchDetails.tsx
// ============================================================================
//
//  THE DRIP — MATCH INTELLIGENCE HUB
//
//  Design Language:
//    Porsche Weissach precision · Apple HIG spatial hierarchy
//    Linear information density · Vercel typographic clarity
//
//  Token Architecture:
//    Four-layer system: Primitive → Semantic → Component → Composite
//    Modeled after Material Design 3, Linear's internal system,
//    and Apple's HIG elevation model.
//
//    Primitive:   Raw values — hex codes, pixel values, milliseconds
//    Semantic:    Purpose-bound aliases — surface, textPrimary, borderSubtle
//    Component:   Scoped dimensional tokens — scoreHeader.height, tab.indicator
//    Composite:   Pre-composed class strings — TYPE.label, TYPE.mono
//
//  Motion Philosophy:
//    Spring-physics with critically damped defaults (~200ms settle).
//    Orchestrated stagger on tab transitions for perceived speed.
//    Reduced-motion fallback: instant transitions, no spring oscillation.
//    GPU-only properties (transform, opacity) — never animate layout.
//
//  Data Pipeline:
//    ESPN (primary) → Supabase DB (odds, props) → WebSocket (live state)
//    Signature-based diffing via FNV-1a hash prevents unnecessary re-renders.
//    WebSocket freshness gating avoids duplicate HTTP fetches.
//
//  Performance:
//    Signature-based diffing, RAF-throttled scroll, memo barriers
//    useCallback/useMemo at every derived-state boundary
//    Lazy tab content via hidden attribute (preserves DOM, avoids remount)
//
//  Type Safety:   Strict — zero `any` casts
//  Accessibility: WCAG 2.1 AA — keyboard nav, ARIA roles, focus management,
//                 prefers-reduced-motion, semantic landmarks
//
// ============================================================================

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useId,
  memo,
  type FC,
  type ReactNode,
} from 'react';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'framer-motion';

// ─── Domain ─────────────────────────────────────────────────────────────────
import { MatchStatus, Sport } from '@/types';
import type {
  Match,
  RecentFormGame,
  ShotEvent,
  PlayerPropBet,
  PropBetType,
} from '@/types';
import { cn } from '@/lib/essence';
import { getMatchDisplayStats } from '../../utils/statDisplay';
import { calculateBettingOutcome } from '../../utils/bettingCalculations';

// ─── Services ───────────────────────────────────────────────────────────────
import {
  fetchMatchDetailsExtended,
  fetchTeamLastFive,
} from '../../services/espnService';
import { fetchNhlGameDetails } from '../../services/nhlService';
import { supabase } from '../../lib/supabase';
import {
  pregameIntelService,
  type PregameIntelResponse,
} from '../../services/pregameIntelService';
import {
  isGameInProgress,
  isGameFinished as isGameFinal,
  isGameScheduled,
  getDbMatchId,
} from '../../utils/matchUtils';

// ─── Components ─────────────────────────────────────────────────────────────
import { LiveGameTracker } from '../analysis/Gamecast';
import { LiveAIInsight } from '../analysis/LiveAIInsight';
import { ForecastHistoryTable } from '../analysis/ForecastHistoryTable';
import { EdgeAnalysisCard } from '../analysis/EdgeAnalysisCard';
import BoxScore, {
  ClassicPlayerProps,
  TeamStatsGrid,
  LineScoreGrid,
} from '../analysis/BoxScore';
import { CinematicPlayerProps } from '../analysis/PlayerStatComponents';
import InsightCard, { toInsightCard } from '../analysis/InsightCard';
import RecentForm from '../pregame/RecentForm';
import SafePregameIntelCards from '../pregame/PregameIntelCards';
import OddsCard from '../betting/OddsCard';
import { GoalieMatchup } from '../GoalieMatchup';
import { MatchupLoader, MatchupContextPills } from '../ui';
import ChatWidget from '../ChatWidget';
import { TechnicalDebugView } from '../TechnicalDebugView';
import TeamLogo from '../shared/TeamLogo';
import {
  BaseballGamePanel,
  BaseballEdgePanel,
  useBaseballLive,
} from '@/components/baseball';


// ============================================================================
// §1  DESIGN TOKEN SYSTEM
// ============================================================================
//
//  Four-layer token architecture:
//
//    PALETTE   →  Raw hex values. Never referenced in JSX.
//    TOKEN     →  Semantic aliases. The primary API for components.
//    DIMENSION →  Component-scoped layout constants.
//    TYPE      →  Pre-composed typographic class strings.
//
//  Design references:
//    Linear:    ~200ms ease-out, 4px unit, monochrome + single accent
//    Apple HIG: 8pt grid, SF Pro scale, spring-damped motion
//    Porsche:   Restrained palette, engineered whitespace, no decoration
//    Vercel:    High-contrast text, minimal borders, precise alignment
//
// ============================================================================

/**
 * Primitive color palette.
 * Raw hex values — never referenced directly in component JSX.
 * Named by visual identity, not by semantic purpose.
 */
const PALETTE = {
  white:    '#FFFFFF',
  black:    '#0A0A0A',
  gray50:   '#FAFAFA',
  gray100:  '#F5F5F5',
  gray200:  '#E5E5E5',
  gray300:  '#D4D4D4',
  gray400:  '#A3A3A3',
  gray500:  '#737373',
  gray600:  '#525252',
  green:    '#00C896',
  red:      '#E54D4D',
  emerald:  '#10B981',
  amber:    '#F59E0B',
} as const;

/**
 * Semantic tokens — the canonical API for component styling.
 *
 * Every color decision in JSX routes through TOKEN.
 * When theming, only this layer changes; components remain untouched.
 */
const TOKEN = {
  // ── Surface hierarchy (3 levels + overlay) ──
  bg:              PALETTE.white,
  surface:         PALETTE.gray50,
  surfaceElevated: PALETTE.gray100,
  surfaceOverlay:  `${PALETTE.white}F2`,       // 95% opacity — frosted glass

  // ── Border hierarchy (subtle → active) ──
  borderSubtle:    PALETTE.gray200,
  borderDefault:   PALETTE.gray300,
  borderActive:    PALETTE.gray400,

  // ── Text hierarchy (4 levels) ──
  textPrimary:     PALETTE.black,
  textSecondary:   PALETTE.gray600,
  textTertiary:    PALETTE.gray500,
  textMuted:       PALETTE.gray400,

  // ── Signal colors — used exclusively for status/accent ──
  live:            PALETTE.green,
  error:           PALETTE.red,
  edgePlay:        PALETTE.emerald,
  edgeLean:        PALETTE.amber,
} as const;

/**
 * Elevation system — layered shadows for spatial depth.
 *
 * Modeled after Apple's HIG elevation model:
 *   Level 0: Flush (no shadow)
 *   Level 1: Subtle lift (cards, sections)
 *   Level 2: Floating (modals, popovers)
 *   Level 3: Prominent (sticky headers, toasts)
 */
const ELEVATION = {
  0: 'shadow-none',
  1: 'shadow-[0_1px_3px_rgba(10,10,10,0.04),0_1px_2px_rgba(10,10,10,0.03)]',
  2: 'shadow-[0_4px_12px_rgba(10,10,10,0.05),0_1px_3px_rgba(10,10,10,0.03)]',
  3: 'shadow-[0_8px_24px_rgba(10,10,10,0.06),0_2px_6px_rgba(10,10,10,0.03)]',
} as const;

/** Component-scoped dimensional tokens — spatial constants */
const DIMENSION = {
  navHeight:       64,
  scoreExpanded:   182,
  scoreCompact:    52,
  maxWidth:        960,
  tabIndicator:    2,
  radius: {
    sm:   8,
    md:  12,
    lg:  16,
    xl:  20,
    pill: 9999,
  },
  /** 4px spatial unit — all spacing derives from this base */
  unit: 4,
} as const;

/**
 * Typographic presets — pre-composed Tailwind class strings.
 *
 * Naming convention: TYPE.{role}
 * Every text element in the component maps to exactly one preset.
 * This eliminates ad-hoc font-size decisions and ensures
 * the type hierarchy is auditable at a glance.
 *
 * Numeric preset uses monospace + tabular-nums for data alignment.
 */
const TYPE = {
  /** Section labels: compact metadata style */
  label:     'text-[10px] font-semibold tracking-[0.08em] uppercase font-mono',
  /** Inline metadata: 11px, medium, 0.05em tracking */
  meta:      'text-[11px] font-medium tracking-[0.05em]',
  /** Body copy: 12px, normal weight, relaxed leading */
  body:      'text-[12px] leading-relaxed',
  /** Card headings: 13px, medium weight */
  heading:   'text-[13px] font-medium',
  /** Primary score display: 38px, mono, tabular figures */
  score:     'text-[38px] leading-none font-mono [font-variant-numeric:tabular-nums] [font-feature-settings:"tnum"]',
  /** Secondary numeric: 14px, mono, tabular figures */
  numeric:   'text-[14px] font-mono [font-variant-numeric:tabular-nums] [font-feature-settings:"tnum"] tracking-[0.02em]',
  /** Small numeric: 12px, mono, tabular figures */
  numericSm: 'text-[12px] font-mono [font-variant-numeric:tabular-nums] [font-feature-settings:"tnum"] tracking-[0.02em]',
  /** Tiny numeric: 11px, mono, tabular figures */
  numericXs: 'text-[11px] font-mono [font-variant-numeric:tabular-nums] [font-feature-settings:"tnum"]',
} as const;

/** Backward-compatible NUMERIC alias for inline tabular figures */
const NUMERIC = `font-mono [font-variant-numeric:tabular-nums] [font-feature-settings:"tnum"] tracking-[0.02em]`;

/**
 * Motion tokens — spring physics tuned for perceived responsiveness.
 *
 * Primary spring: critically damped, ~200ms settle time.
 * Matches Linear's animation target of sub-200ms interactions.
 *
 * When prefers-reduced-motion is active, components should use
 * SPRING.reduced which provides instant transitions (duration: 0).
 */
const SPRING = {
  /** Standard UI transitions — tabs, accordions, toggles */
  default:  { type: 'spring' as const, stiffness: 380, damping: 35, mass: 0.8 },
  /** Score updates, ball position — cinematic weight */
  camera:   { type: 'spring' as const, stiffness: 60, damping: 20, mass: 1.2 },
  /** Tab indicator — snappy, critically damped, no overshoot */
  tab:      { type: 'spring' as const, stiffness: 350, damping: 30 },
  /** Stat bars — eased reveal with natural deceleration */
  bar:      { duration: 0.45, ease: 'easeOut' as const },
  /** Reduced-motion fallback — instant, no oscillation */
  reduced:  { duration: 0 },
} as const;

/** Polling & data pipeline configuration */
const PIPELINE = {
  polling: {
    LIVE_MS:          3_000,
    PREGAME_MS:      60_000,
    SOCKET_FRESH_MS:  8_000,
  },
  nhlShots: {
    MIN_MS: 15_000,
  },
  forecast: {
    SPARKLINE_POINTS: 12,
    MAX_HISTORY:      20,
  },
} as const;

/** Sport-specific field coordinate defaults */
const FIELD_DEFAULTS = {
  BASKETBALL: { x: 50,  y: 28.125 },
  FOOTBALL:   { x: 60,  y: 26.65 },
  SOCCER:     { x: 50,  y: 50 },
} as const;


// ============================================================================
// §2  TYPE DEFINITIONS
// ============================================================================

interface DbPlayerPropRow {
  player_name?: string | null;
  bet_type?: string | null;
  line_value?: number | string | null;
  odds_american?: number | string | null;
  market_label?: string | null;
  headshot_url?: string | null;
  team?: string | null;
  opponent?: string | null;
  sportsbook?: string | null;
  provider?: string | null;
  side?: string | null;
  player_id?: string | null;
  espn_player_id?: string | null;
  fantasy_dvp_rank?: number | null;
  l5_hit_rate?: number | null;
  l5_values?: number[] | null;
  avg_l5?: number | null;
  ai_rationale?: string | null;
  analysis_status?: string | null;
  analysis_ts?: string | null;
  implied_prob_pct?: number | null;
  confidence_score?: number | null;
}

interface DbMatchRow {
  current_odds?: Match['current_odds'];
  closing_odds?: Match['closing_odds'];
  opening_odds?: Match['opening_odds'];
  odds?: Match['odds'];
  home_score?: number;
  away_score?: number;
}

interface TeamGameContextRow {
  team?: string | null;
  game_date?: string | null;
  situation?: string | null;
  rest_days?: number | null;
  fatigue_score?: number | null;
  injury_notes?: string | null;
  injury_impact?: number | null;
  ats_last_10?: number | null;
  is_b2b?: boolean | null;
  is_second_of_b2b?: boolean | null;
  is_3in4?: boolean | null;
  is_4in5?: boolean | null;
  updated_at?: string | null;
}

interface TeamContextSnapshot {
  home?: TeamGameContextRow;
  away?: TeamGameContextRow;
  updatedAt?: string;
}

type EspnExtendedMatch = Partial<ExtendedMatch> & {
  statistics?: Match['stats'];
};

interface LiveState extends Partial<ExtendedMatch> {
  lastPlay?: {
    text?: string;
    coordinate?: { x: number; y: number } | string;
    type?: { text: string };
  };
  ai_analysis?: {
    sharp_data?: {
      recommendation?: { side: string; market_type?: string };
      confidence_level?: number;
    };
  };
  deterministic_signals?: {
    deterministic_fair_total?: number;
    market_total?: number;
  };
  home_score?: number;
  away_score?: number;
  clock?: string;
  created_at?: string;
}

type ContextValue =
  | string
  | number
  | boolean
  | null
  | ContextValue[]
  | { [key: string]: ContextValue };

/** Extended Match with strict sub-object typing to eliminate casting */
interface ExtendedMatch extends Match {
  possession?: string;
  displayClock?: string;
  context?: Record<string, ContextValue>;
  closing_odds?: Match['closing_odds'];
  opening_odds?: Match['opening_odds'];
  dbProps?: Match['dbProps'];
  stats?: Match['stats'];
  homeTeam: Match['homeTeam'] & { last5?: RecentFormGame[] };
  awayTeam: Match['awayTeam'] & { last5?: RecentFormGame[] };
}

interface ForecastPoint {
  clock: string;
  fairTotal: number;
  marketTotal: number;
  edgeState: 'PLAY' | 'LEAN' | 'NEUTRAL';
  timestamp: number;
}

interface EdgeState {
  side: 'OVER' | 'UNDER' | null;
  state: 'PLAY' | 'LEAN' | 'NEUTRAL';
  edgePoints: number;
  confidence?: number;
}

type CoreSport = 'SOCCER' | 'BASKETBALL' | 'FOOTBALL' | 'HOCKEY' | 'BASEBALL' | 'OTHER';
type MatchTabId = 'SUMMARY' | 'STATS' | 'LINEUPS' | 'BOX_SCORE' | 'AI' | 'ODDS';
type StatSection = 'Attack' | 'Defense' | 'Discipline';

interface ClockDisplayModel {
  primary: string;
  secondary?: string;
  isLive: boolean;
  isFinal: boolean;
  finalLabel?: string;
}

interface ComparisonStat {
  label: string;
  awayDisplay: string;
  homeDisplay: string;
  awayValue: number;
  homeValue: number;
  section: StatSection;
}

interface BettingOutcomeRow {
  market: 'SPREAD' | 'TOTAL' | 'ML';
  selection: string;
  result: string;
  verdict: string;
  won: boolean | null;
}


// ============================================================================
// §3  PURE UTILITY FUNCTIONS
// ============================================================================

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

const toTeamAbbreviation = (team?: Match['homeTeam']): string =>
  team?.abbreviation || team?.shortName || team?.name?.slice(0, 3).toUpperCase() || 'TEAM';

const formatSigned = (value: number, precision = 1): string => {
  const fixed = Number(value.toFixed(precision));
  return fixed > 0 ? `+${fixed}` : `${fixed}`;
};

const formatAmericanOdds = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return '';
  return value > 0 ? `+${Math.trunc(value)}` : `${Math.trunc(value)}`;
};

const normalizeColor = (color: string | undefined, fallback: string): string => {
  if (!color) return fallback;
  return color.startsWith('#') ? color : `#${color}`;
};

const normalizeKey = (value: string | undefined): string =>
  (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const uniqueStrings = (values: Array<string | undefined>): string[] => {
  const set = new Set<string>();
  values
    .map((value) => (value || '').trim())
    .filter(Boolean)
    .forEach((value) => set.add(value));
  return Array.from(set);
};

const getTeamAliases = (team: Match['homeTeam'] | Match['awayTeam']): string[] =>
  uniqueStrings([team.name, team.shortName, team.abbreviation]);

const pickTeamContextRow = (
  rows: TeamGameContextRow[],
  aliases: string[]
): TeamGameContextRow | undefined => {
  if (!rows.length || !aliases.length) return undefined;
  const aliasKeys = aliases.map(normalizeKey).filter(Boolean);

  let best: TeamGameContextRow | undefined;
  let bestScore = 0;

  for (const row of rows) {
    const rowTeam = (row.team || '').trim();
    const rowKey = normalizeKey(rowTeam);
    if (!rowKey) continue;

    for (const alias of aliasKeys) {
      if (rowKey === alias) {
        if (4 > bestScore) {
          best = row;
          bestScore = 4;
        }
      } else if (rowKey.includes(alias) || alias.includes(rowKey)) {
        if (2 > bestScore) {
          best = row;
          bestScore = 2;
        }
      }
    }
  }

  return best;
};

const formatTeamContextLine = (abbr: string, row?: TeamGameContextRow): string | null => {
  if (!row) return null;
  const bits: string[] = [];
  if (typeof row.rest_days === 'number') bits.push(`${row.rest_days}d rest`);
  if (typeof row.fatigue_score === 'number') bits.push(`fatigue ${Math.round(row.fatigue_score)}`);
  if (row.is_second_of_b2b || row.is_b2b) bits.push('B2B');
  else if (row.is_3in4) bits.push('3 in 4');
  else if (row.is_4in5) bits.push('4 in 5');
  if (row.situation && row.situation !== 'Normal') bits.push(row.situation);
  return bits.length ? `${abbr}: ${bits.join(' · ')}` : null;
};

const asContextRecord = (value: ContextValue | undefined): { [key: string]: ContextValue } | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as { [key: string]: ContextValue };
};

const asContextString = (value: ContextValue | undefined): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const asContextText = (value: ContextValue | undefined): string | undefined => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

/** FNV-1a 32-bit hash — deterministic, fast, zero-dependency */
function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — deterministic sequence from seed */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


// ─── Odds Parsing ───────────────────────────────────────────────────────────

function readOddsField(
  odds: Match['current_odds'] | Match['opening_odds'] | Match['closing_odds'] | undefined,
  keys: readonly string[]
): unknown {
  if (!odds) return undefined;
  const record = odds as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && `${value}`.trim() !== '') return value;
  }
  return undefined;
}

function parseOddsNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const raw = value.trim().toUpperCase();
  if (!raw) return undefined;
  if (raw === 'PK' || raw === 'PICK' || raw === 'EV' || raw === 'EVEN') return 0;
  const num = Number(raw.replace(/[^\d.\-]/g, ''));
  return Number.isFinite(num) ? num : undefined;
}

function getOddsSpreadValue(
  odds: Match['current_odds'] | Match['opening_odds'] | Match['closing_odds'] | undefined
): number | undefined {
  const home = parseOddsNumber(
    readOddsField(odds, ['homeSpread', 'home_spread', 'spread_home', 'spread_home_value', 'spread'])
  );
  if (home !== undefined) return home;
  const away = parseOddsNumber(
    readOddsField(odds, ['awaySpread', 'away_spread', 'spread_away', 'spread_away_value'])
  );
  return away !== undefined ? away * -1 : undefined;
}

function getOddsTotalValue(
  odds: Match['current_odds'] | Match['opening_odds'] | Match['closing_odds'] | undefined
): number | undefined {
  return parseOddsNumber(
    readOddsField(odds, ['total', 'overUnder', 'over_under', 'total_line', 'total_value', 'over'])
  );
}

function getOddsDisplayValue(
  odds: Match['current_odds'] | Match['opening_odds'] | Match['closing_odds'] | undefined,
  keys: readonly string[]
): string | number | undefined {
  const value = readOddsField(odds, keys);
  return (typeof value === 'string' || typeof value === 'number') ? value : undefined;
}

const getOddsFieldNumber = (
  odds: Match['current_odds'] | Match['opening_odds'] | Match['closing_odds'] | Match['odds'] | undefined,
  keys: string[]
): number | undefined => parseOddsNumber(readOddsField(odds as Match['current_odds'], keys));


// ─── Sport Classification ───────────────────────────────────────────────────

const getCoreSport = (match: Match): CoreSport => {
  const sport = String(match.sport || '').toUpperCase();
  const league = String(match.leagueId || '').toUpperCase();
  if (sport.includes('SOCCER') || league.includes('MLS') || league.includes('EPL')) return 'SOCCER';
  if (sport.includes('BASEBALL') || league.includes('MLB')) return 'BASEBALL';
  if (sport.includes('HOCKEY') || league.includes('NHL')) return 'HOCKEY';
  if (sport.includes('FOOTBALL') || league.includes('NFL') || league.includes('NCAAF')) return 'FOOTBALL';
  if (sport.includes('BASKETBALL') || league.includes('NBA') || league.includes('WNBA') || league.includes('NCAAB')) return 'BASKETBALL';
  return 'OTHER';
};

const toOrdinalPeriod = (period: number): string => {
  const suffixes: Record<number, string> = { 1: '1ST', 2: '2ND', 3: '3RD', 4: '4TH' };
  return suffixes[period] || `${period}TH`;
};

const getStatSection = (label: string): StatSection => {
  const value = label.toLowerCase();
  if (/foul|card|penalt|offside|turnover|ejection|pim/.test(value)) return 'Discipline';
  if (/tackle|save|block|interception|clearance|steal|rebound|hit|takeaway|giveaway/.test(value)) return 'Defense';
  return 'Attack';
};

const parseComparableValue = (raw: string): number => {
  const value = String(raw || '').trim();
  if (!value) return 0;
  if (value.includes('/')) {
    const [head] = value.split('/');
    const n = Number(head.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};


// ─── Serialization (signature diffing) ──────────────────────────────────────

type Serializable =
  | string
  | number
  | boolean
  | null
  | Serializable[]
  | { [key: string]: Serializable };

function stableSerialize(value: Serializable | Date | undefined, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number') return Number.isFinite(value) ? String(value) : '"NaN"';
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'undefined') return '"__undefined__"';
  if (t === 'bigint') return `"${value.toString()}n"`;
  if (value instanceof Date) return `"${value.toISOString()}"`;
  if (Array.isArray(value)) return `[${value.map(v => stableSerialize(v, seen)).join(',')}]`;
  if (t === 'object') {
    if (seen.has(value as object)) return '"__circular__"';
    seen.add(value as object);
    const record = value as Record<string, Serializable>;
    const keys = Object.keys(record).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableSerialize(record[k], seen)}`).join(',')}}`;
  }
  return '"__unsupported__"';
}

function hashStable(value: Serializable | Date | undefined): string {
  return fnv1a32(stableSerialize(value)).toString(16);
}

function computeMatchSignature(m: ExtendedMatch): string {
  return [
    m.id,
    m.status ?? '',
    String(m.period ?? ''),
    String(m.displayClock ?? ''),
    String(m.homeScore ?? ''),
    String(m.awayScore ?? ''),
    m.lastPlay?.text || '',
    hashStable(m.current_odds ?? null),
    hashStable(m.stats ?? null),
    hashStable(m.playerStats ?? null),
  ].join('|');
}

function parseTsMs(v: string | number | Date | null | undefined, fallbackMs: number): number {
  if (!v) return fallbackMs;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : fallbackMs; }
  if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : fallbackMs; }
  return fallbackMs;
}

function normalizePregameIntelFallback(
  row: Partial<PregameIntelResponse> & { match_id?: string | null; freshness?: string | null },
  matchId: string
): PregameIntelResponse {
  return {
    ...row,
    match_id: row.match_id || matchId,
    generated_at: row.generated_at || new Date().toISOString(),
    headline: row.headline || 'Intel pending.',
    cards: Array.isArray(row.cards) ? row.cards : [],
    sources: Array.isArray(row.sources) ? row.sources : [],
    freshness: row.freshness === 'LIVE' || row.freshness === 'RECENT' || row.freshness === 'STALE'
      ? row.freshness
      : 'RECENT',
  };
}


// ─── Supabase Helpers ───────────────────────────────────────────────────────

type SupabaseResponse<T> = { data: T; error: Error | null };

async function failSafe<T>(p: PromiseLike<SupabaseResponse<T>>): Promise<T | null> {
  try {
    const { data, error } = await p;
    if (error) {
      if (process.env.NODE_ENV === 'development') console.warn('[Drip] Non-critical fetch failed:', error.message);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

async function sbData<T>(p: PromiseLike<SupabaseResponse<T>>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}


// ============================================================================
// §4  COORDINATE ENGINE
// ============================================================================
//
//  Deterministic play-to-coordinate mapping with sport-aware normalization.
//  Falls back to seeded PRNG when ESPN provides no coordinate data,
//  ensuring identical renders for identical play descriptions (referential
//  transparency for UI snapshots and testing).
//
// ============================================================================

interface PlayCoordinate { x: number; y: number }
type SportDims = { maxX: number; maxY: number };

function getSportDims(sportKey: string): SportDims {
  if (sportKey.includes('BASKETBALL') || sportKey.includes('NBA') || sportKey.includes('NCAAM'))
    return { maxX: 100, maxY: 56.25 };
  if (sportKey.includes('FOOTBALL') || sportKey.includes('NFL') || sportKey.includes('CFB') || sportKey.includes('NCAAF'))
    return { maxX: 120, maxY: 53.3 };
  return { maxX: 100, maxY: 100 };
}

function normalizeRawToDims(rawX: number, rawY: number, dims: SportDims): PlayCoordinate {
  if (rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1)
    return { x: rawX * dims.maxX, y: rawY * dims.maxY };
  if (rawX >= 0 && rawX <= 100 && rawY >= 0 && rawY <= 100)
    return { x: rawX * (dims.maxX / 100), y: rawY * (dims.maxY / 100) };
  return { x: rawX, y: rawY };
}

type CoordinateInput = { x?: number | string; y?: number | string } | string | null | undefined;

function parseCoordinate(raw: CoordinateInput, playText: string, sport: string): PlayCoordinate {
  const sportKey = (sport || '').toUpperCase();
  const dims = getSportDims(sportKey);

  // Attempt structured coordinate parse
  if (raw && typeof raw === 'object') {
    const c = raw as { x?: number | string; y?: number | string };
    const rx = typeof c.x === 'number' ? c.x : (typeof c.x === 'string' ? Number(c.x) : NaN);
    const ry = typeof c.y === 'number' ? c.y : (typeof c.y === 'string' ? Number(c.y) : NaN);

    if (Number.isFinite(rx) && Number.isFinite(ry)) {
      if (!(Math.abs(rx) < 0.1 && Math.abs(ry) < 0.1)) {
        const n = normalizeRawToDims(rx, ry, dims);
        return { x: clamp(n.x, 0, dims.maxX), y: clamp(n.y, 0, dims.maxY) };
      }
    }
  }

  // Deterministic fallback: seeded PRNG from play text
  const text = (playText || '').toLowerCase().trim();
  const rng = mulberry32(fnv1a32(`${sportKey}|${text}`));
  const jitter = (amp: number) => (rng() - 0.5) * amp;

  if (sportKey.includes('BASKETBALL') || sportKey.includes('NBA') || sportKey.includes('NCAAM')) {
    if (text.includes('free throw')) return { x: 75, y: 28 };
    if (text.includes('3-pointer') || text.includes('three')) return { x: 72 + jitter(4), y: 12 + rng() * 30 };
    if (text.includes('dunk') || text.includes('layup')) return { x: 92, y: 28 };
    if (text.includes('jump shot')) return { x: 65 + jitter(4), y: 28 + jitter(4) };
    if (text.includes('rebound')) return { x: 88 + jitter(4), y: 28 + jitter(4) };
    return FIELD_DEFAULTS.BASKETBALL;
  }

  if (sportKey.includes('FOOTBALL') || sportKey.includes('NFL') || sportKey.includes('CFB') || sportKey.includes('NCAAF')) {
    if (text.includes('touchdown')) return { x: 115, y: 26.65 };
    if (text.includes('field goal')) return { x: 100, y: 26.65 };
    if (text.includes('punt') || text.includes('kickoff')) return { x: 20, y: 26.65 };
    if (text.includes('safety')) return { x: 5, y: 26.65 };
    return FIELD_DEFAULTS.FOOTBALL;
  }

  return FIELD_DEFAULTS.SOCCER;
}


// ============================================================================
// §5  MICRO-COMPONENTS — PURE GEOMETRY
// ============================================================================
//
//  Zero-dependency UI primitives. No icon libraries.
//  Every element is pure CSS geometry — "remove until it breaks."
//
//  Reduced-motion: all animation durations collapse to 0 when
//  prefers-reduced-motion is active. Components read this via
//  the `prefersReduced` prop or the useReducedMotion hook.
//
// ============================================================================

/**
 * Animated plus/minus toggle — pure CSS rotation.
 * Transitions from '+' (collapsed) to '−' (expanded) via orthogonal rotation.
 */
const ToggleSwitch = ({ expanded }: { expanded: boolean }) => (
  <div
    className="relative w-2.5 h-2.5 flex items-center justify-center opacity-40 group-hover:opacity-100 transition-opacity duration-300"
    aria-hidden="true"
  >
    <span className={cn(
      'absolute w-full h-[1px] bg-current transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]',
      expanded ? 'rotate-180' : 'rotate-0',
    )} />
    <span className={cn(
      'absolute w-full h-[1px] bg-current transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]',
      expanded ? 'rotate-180 opacity-0' : 'rotate-90 opacity-100',
    )} />
  </div>
);

/**
 * Chevron-left navigation arrow — pure CSS geometry.
 * Three spans compose a left-pointing arrow with shaft.
 */
const BackArrow = () => (
  <div className="relative w-3 h-3 flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity" aria-hidden="true">
    <span className="absolute w-2.5 h-[1.5px] bg-current origin-left rotate-45 -translate-y-[0px] -translate-x-[1px]" />
    <span className="absolute w-2.5 h-[1.5px] bg-current origin-left -rotate-45 translate-y-[0px] -translate-x-[1px]" />
    <span className="absolute w-3 h-[1.5px] bg-current translate-x-1" />
  </div>
);

const SwipeableHeader = memo(({
  children,
  enabled,
  onSwipe,
  matchId,
}: {
  children: ReactNode;
  enabled: boolean;
  onSwipe: (dir: number) => void;
  matchId: string;
}) => (
  <motion.div
    drag={enabled ? 'x' : false}
    dragDirectionLock
    dragMomentum={false}
    dragElastic={0.08}
    dragConstraints={{ left: 0, right: 0 }}
    onDragEnd={(_, info) => {
      if (info.offset.x > 110) onSwipe(-1);
      if (info.offset.x < -110) onSwipe(1);
    }}
    className={cn(
      'mx-auto w-full max-w-[960px] px-4 pb-3 pt-1 touch-pan-y',
      enabled && 'cursor-grab active:cursor-grabbing',
    )}
  >
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={matchId}
        initial={{ opacity: 0, scale: 0.99, filter: 'blur(2px)' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, scale: 1.01, filter: 'blur(2px)' }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  </motion.div>
));
SwipeableHeader.displayName = 'SwipeableHeader';

/**
 * Edge state signal badge with optional pulse animation.
 * Three visual states: PLAY (emerald pulse), LEAN (amber static), NEUTRAL (zinc).
 */
const EdgeStateBadge = memo(({ edgeState }: { edgeState: EdgeState }) => {
  const isPlay = edgeState.state === 'PLAY';
  const isLean = edgeState.state === 'LEAN';

  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold tracking-[0.08em] uppercase',
      'transition-colors duration-200 border',
      isPlay  && 'bg-emerald-50 text-emerald-700 border-emerald-200',
      isLean  && 'bg-amber-50 text-amber-700 border-amber-200',
      !isPlay && !isLean && 'bg-zinc-50 text-zinc-600 border-zinc-200',
    )}>
      <span className="relative flex h-1.5 w-1.5 mr-1">
        <span className={cn(
          'relative inline-flex rounded-full h-1.5 w-1.5',
          isPlay ? 'bg-emerald-500' : isLean ? 'bg-amber-500' : 'bg-zinc-500',
        )} />
      </span>
      <span>{edgeState.side || 'NEUTRAL'}</span>
      <div className="w-px h-2 bg-current opacity-20 mx-1" aria-hidden="true" />
      <span className="font-mono">{edgeState.edgePoints > 0 ? '+' : ''}{edgeState.edgePoints.toFixed(1)}</span>
    </div>
  );
});
EdgeStateBadge.displayName = 'EdgeStateBadge';

/** Miniature bar chart showing model trend direction */
const ForecastSparkline = memo(({ points }: { points: ForecastPoint[] }) => {
  if (points.length < 2) return null;
  const values = points.map(p => p.fairTotal);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  return (
    <div className="flex items-end gap-[2px] h-4 w-16 opacity-80" title="Live Model Trend" role="img" aria-label="Model trend sparkline">
      {points.slice(-10).map((p, i) => (
        <div
          key={i}
          className={cn(
            'w-1 rounded-[1px] transition-all duration-300',
            p.edgeState === 'PLAY' ? 'bg-emerald-500' :
            p.edgeState === 'LEAN' ? 'bg-amber-500' : 'bg-zinc-700',
          )}
          style={{ height: `${Math.max(20, ((p.fairTotal - min) / range) * 100)}%` }}
        />
      ))}
    </div>
  );
});
ForecastSparkline.displayName = 'ForecastSparkline';

/** Skeleton loading state — odds card placeholder */
const OddsCardSkeleton = memo(() => (
  <div className="animate-pulse space-y-4 p-4 border border-[#E5E5E5] rounded-xl bg-white" aria-label="Loading odds data">
    <div className="flex justify-between items-center">
      <div className="h-2 w-20 bg-zinc-100 rounded-full" />
      <div className="h-2 w-8 bg-zinc-100 rounded-full" />
    </div>
    <div className="space-y-2">
      <div className="h-8 w-full bg-zinc-50 rounded-lg" />
      <div className="h-8 w-full bg-zinc-50 rounded-lg" />
    </div>
  </div>
));
OddsCardSkeleton.displayName = 'OddsCardSkeleton';

/** Skeleton loading state — stats grid placeholder */
const StatsGridSkeleton = memo(() => (
  <div className="animate-pulse grid grid-cols-2 gap-4 mt-4" aria-label="Loading statistics">
    {Array.from({ length: 6 }, (_, i) => (
      <div key={i} className={`h-10 bg-[#FAFAFA] rounded-lg border border-[#E5E5E5]`} />
    ))}
  </div>
));
StatsGridSkeleton.displayName = 'StatsGridSkeleton';

/**
 * Real-time connection status indicator.
 * Three states: connected (green), connecting (pulsing green), error (red).
 */
const ConnectionBadge = memo(({ status }: { status: 'connected' | 'error' | 'connecting' }) => {
  const dotColor = status === 'error' ? TOKEN.error : TOKEN.live;
  const isPulsing = status === 'connecting';

  return (
    <div
      className={`flex items-center justify-center w-7 h-7 rounded-full border border-[#E5E5E5] bg-[#FFFFFF]`}
      role="status"
      aria-label={`Connection ${status}`}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn('absolute inline-flex h-full w-full rounded-full blur-[4px]', isPulsing && 'animate-pulse')}
          style={{ backgroundColor: `${dotColor}70` }}
        />
        <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: dotColor }} />
      </span>
    </div>
  );
});
ConnectionBadge.displayName = 'ConnectionBadge';


// ============================================================================
// §6  VISUALIZATION COMPONENTS — FIELD RENDERERS
// ============================================================================

/** CRT scanline overlay — broadcast authenticity layer */
const BroadcastOverlay = memo(() => (
  <div className="hidden" aria-hidden="true" />
));
BroadcastOverlay.displayName = 'BroadcastOverlay';

/**
 * NBA/NCAAM hardwood court — SVG with gradient lighting and wood grain texture.
 * Court dimensions: 100 × 56.25 (16:9 aspect ratio normalized).
 */
const BasketballCourt = memo(({ children }: { children?: ReactNode }) => (
  <svg viewBox="0 0 100 56.25" className="w-full h-full drop-shadow-2xl select-none" role="img" aria-label="Basketball court visualization">
    <defs>
      <radialGradient id="courtGlow" cx="0.5" cy="0.5" r="0.8">
        <stop offset="0%" stopColor="#2a2a2a" />
        <stop offset="100%" stopColor="#111" />
      </radialGradient>
      <pattern id="woodGrain" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 8L8 0M-2 2L2 -2M6 10L10 6" stroke="currentColor" strokeWidth="0.03" className="text-white/5" />
      </pattern>
      <linearGradient id="floorShine" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="white" stopOpacity="0" />
        <stop offset="45%" stopColor="white" stopOpacity="0" />
        <stop offset="50%" stopColor="white" stopOpacity="0.03" />
        <stop offset="55%" stopColor="white" stopOpacity="0" />
        <stop offset="100%" stopColor="white" stopOpacity="0" />
      </linearGradient>
    </defs>
    <rect width="100" height="56.25" fill="url(#courtGlow)" />
    <rect width="100" height="56.25" fill="url(#woodGrain)" />
    <g fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.6">
      <rect x="2" y="2" width="96" height="52.25" />
      <line x1="50" y1="2" x2="50" y2="54.25" />
      <circle cx="50" cy="28.125" r="6" />
      <g>
        <path d="M2,18.125 h14 v20 h-14" fill="#18181b" fillOpacity="0.4" />
        <circle cx="16" cy="28.125" r="6" strokeDasharray="3 3" />
        <path d="M2,5.125 a23,23 0 0 1 0,46" />
        <circle cx="5.25" cy="28.125" r="0.75" fill="#ec4899" stroke="none" />
        <line x1="4" y1="25.125" x2="4" y2="31.125" strokeWidth="0.8" />
      </g>
      <g transform="scale(-1, 1) translate(-100, 0)">
        <path d="M2,18.125 h14 v20 h-14" fill="#18181b" fillOpacity="0.4" />
        <circle cx="16" cy="28.125" r="6" strokeDasharray="3 3" />
        <path d="M2,5.125 a23,23 0 0 1 0,46" />
        <circle cx="5.25" cy="28.125" r="0.75" fill="#3b82f6" stroke="none" />
        <line x1="4" y1="25.125" x2="4" y2="31.125" strokeWidth="0.8" />
      </g>
    </g>
    <rect width="100" height="56.25" fill="url(#floorShine)" pointerEvents="none" />
    {children}
  </svg>
));
BasketballCourt.displayName = 'BasketballCourt';

/**
 * NFL/CFB gridiron — SVG with grass gradient and yard markers.
 * Field dimensions: 120 × 53.3 (including end zones).
 */
const Gridiron = memo(({ children }: { children?: ReactNode }) => (
  <svg viewBox="0 0 120 53.3" className="w-full h-full drop-shadow-2xl select-none bg-emerald-950" role="img" aria-label="Football field visualization">
    <defs>
      <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#064e3b" />
        <stop offset="100%" stopColor="#022c22" />
      </linearGradient>
      <filter id="grassNoise">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
      </filter>
    </defs>
    <rect width="120" height="53.3" fill="url(#grass)" />
    <rect width="120" height="53.3" filter="url(#grassNoise)" opacity="0.1" />
    <g stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" fill="none">
      <rect x="0" y="0" width="10" height="53.3" fill="rgba(0,0,0,0.2)" />
      <rect x="110" y="0" width="10" height="53.3" fill="rgba(0,0,0,0.2)" />
      {Array.from({ length: 9 }).map((_, i) => (
        <line key={i} x1={(i + 2) * 10} y1="0" x2={(i + 2) * 10} y2="53.3" />
      ))}
      <g fill="rgba(255,255,255,0.4)" stroke="none" fontSize="4" fontWeight="bold" textAnchor="middle">
        <text x="30" y="10" transform="rotate(180 30 10)">20</text><text x="30" y="47">20</text>
        <text x="60" y="10" transform="rotate(180 60 10)">50</text><text x="60" y="47">50</text>
        <text x="90" y="10" transform="rotate(180 90 10)">20</text><text x="90" y="47">20</text>
      </g>
    </g>
    {children}
  </svg>
));
Gridiron.displayName = 'Gridiron';

/** Sport-aware game tracker with ball position animation */
const CinematicGameTracker = memo(({ match, liveState }: { match: ExtendedMatch; liveState?: LiveState }) => {
  const sport = match.sport?.toUpperCase() || 'UNKNOWN';
  const lastPlay = liveState?.lastPlay;
  const prefersReduced = useReducedMotion();
  const isLiveGame = isGameInProgress(match.status);

  const ballPos = useMemo(() =>
    parseCoordinate(lastPlay?.coordinate, lastPlay?.text || '', sport),
    [lastPlay, sport],
  );

  const primaryColor = useMemo(
    () => normalizeColor(match.homeTeam.color, '#3b82f6'),
    [match.homeTeam.color],
  );

  const cameraSpring = prefersReduced ? SPRING.reduced : SPRING.camera;
  const scheduledOdds = match.current_odds || match.opening_odds || match.odds;
  const scheduledSpread = getOddsSpreadValue(scheduledOdds);
  const scheduledTotal = getOddsTotalValue(scheduledOdds);
  const kickoffLabel = useMemo(() => {
    if (!match.startTime) return 'Start time TBD';
    const dt = new Date(match.startTime);
    if (Number.isNaN(dt.getTime())) return 'Start time TBD';
    return dt.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }, [match.startTime]);

  if (!isLiveGame) {
    const statusLabel = isGameFinal(match.status)
      ? 'FINAL'
      : isGameScheduled(match.status)
        ? 'PREGAME'
        : 'STATUS';

    return (
      <div className="rounded-2xl border border-[#E5E5E5] bg-[#FAFAFA] p-4 sm:p-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <TeamLogo
              logo={match.awayTeam.logo}
              name={match.awayTeam.name}
              abbreviation={toTeamAbbreviation(match.awayTeam)}
              sport={String(match.sport)}
              color={normalizeColor(match.awayTeam.color, '#EF4444')}
              className="h-10 w-10"
            />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-[#0A0A0A]">{match.awayTeam.shortName || match.awayTeam.name}</p>
              <p className={cn(TYPE.numericXs, 'text-[#A3A3A3]')}>{match.awayTeam.record || '—'}</p>
            </div>
          </div>

          <div className="text-center">
            <p className={cn(TYPE.label, 'text-[#737373]')}>{statusLabel}</p>
            <p className={cn(TYPE.numericSm, 'mt-1 text-[#0A0A0A]')}>
              {isGameFinal(match.status) ? `${match.awayScore} - ${match.homeScore}` : kickoffLabel}
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 min-w-0">
            <div className="min-w-0 text-right">
              <p className="truncate text-[13px] font-medium text-[#0A0A0A]">{match.homeTeam.shortName || match.homeTeam.name}</p>
              <p className={cn(TYPE.numericXs, 'text-[#A3A3A3]')}>{match.homeTeam.record || '—'}</p>
            </div>
            <TeamLogo
              logo={match.homeTeam.logo}
              name={match.homeTeam.name}
              abbreviation={toTeamAbbreviation(match.homeTeam)}
              sport={String(match.sport)}
              color={normalizeColor(match.homeTeam.color, '#3B82F6')}
              className="h-10 w-10"
            />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-[#E5E5E5] bg-white px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn(TYPE.meta, 'text-[#737373]')}>
              {isGameFinal(match.status) ? 'Game complete' : 'Awaiting live feed'}
            </span>
            <span className={cn(NUMERIC, 'text-[12px] text-[#0A0A0A]')}>
              {[
                scheduledSpread !== undefined ? `${toTeamAbbreviation(match.homeTeam)} ${formatSigned(scheduledSpread)}` : null,
                scheduledTotal !== undefined ? `O/U ${scheduledTotal}` : null,
              ].filter(Boolean).join(' · ') || 'Lines pending'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const renderCourt = () => {
    if (sport.includes('BASKETBALL') || sport.includes('NBA') || sport.includes('NCAAM')) {
      return (
        <BasketballCourt>
          <motion.g initial={{ x: 50, y: 28 }} animate={{ x: ballPos.x, y: ballPos.y }} transition={cameraSpring}>
            {!prefersReduced && (
              <motion.circle
                r="4" fill={primaryColor} opacity="0.3"
                animate={{ scale: [1, 2.5, 1], opacity: [0.4, 0, 0.4] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              />
            )}
            <circle r="1.5" fill="#fff" className="drop-shadow-[0_0_8px_rgba(255,255,255,1)]" />
          </motion.g>
        </BasketballCourt>
      );
    }
    if (sport.includes('FOOTBALL') || sport.includes('NFL') || sport.includes('CFB') || sport.includes('NCAAF')) {
      return (
        <Gridiron>
          <motion.circle cx="0" cy="0" r="1.5" fill="#fff" initial={{ x: 60, y: 26 }} animate={{ x: ballPos.x, y: ballPos.y }} transition={cameraSpring} />
        </Gridiron>
      );
    }
    return <LiveGameTracker match={match} liveState={liveState} showHeader={false} headerVariant="embedded" />;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full aspect-video overflow-hidden rounded-xl bg-[#0F172A] border border-[#1F2937] z-0 shadow-sm">
        <div className="absolute inset-0 z-0">{renderCourt()}</div>
        <BroadcastOverlay />
        {match.possession && (
          <div className="absolute top-4 left-4 z-[1]">
            <div className="px-2 py-px bg-black/80 backdrop-blur text-zinc-300 text-[9px] tracking-widest font-mono border border-white/10 uppercase">
              Possession: <span className="text-white font-bold">{match.possession}</span>
            </div>
          </div>
        )}
      </div>

      {/* Play-by-play ticker */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-4 px-1">
        <div className="w-1 h-8 bg-blue-500 shrink-0 opacity-80 rounded-full" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn(TYPE.label, 'text-zinc-400')}>
              {(lastPlay?.type?.text || 'LAST PLAY').toUpperCase()}
            </span>
            <span className="text-[9px] text-zinc-600 font-mono tracking-widest">
              {match.displayClock || '00:00'} // P{match.period}
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.p
              key={lastPlay?.text || 'waiting'}
              initial={prefersReduced ? false : { opacity: 0, x: 5 }}
              animate={{ opacity: 1, x: 0 }}
              exit={prefersReduced ? undefined : { opacity: 0, x: -5 }}
              className={cn(TYPE.heading, 'text-white truncate')}
            >
              {lastPlay?.text || 'Awaiting live event...'}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
});
CinematicGameTracker.displayName = 'CinematicGameTracker';


// ============================================================================
// §7  SPEC SHEET LAYOUT ENGINE
// ============================================================================
//
//  Porsche-inspired specification row — label | content, collapsible.
//  Each row is a self-contained section with ARIA accordion semantics.
//  Spring-physics height animation with active-state border treatment.
//
//  Keyboard: Enter/Space toggles, Tab navigates between rows.
//  Screen readers: aria-expanded, aria-controls, role="region".
//
// ============================================================================

interface SpecSheetRowProps {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
}

const SpecSheetRow = ({ label, children, defaultOpen = false, collapsible = true }: SpecSheetRowProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const effectiveOpen = collapsible ? isOpen : true;
  const contentId = useId();
  const prefersReduced = useReducedMotion();
  const safeLabel = label.replace(/\s*\/\/\s*/g, ' ').trim();

  const toggleOpen = useCallback(() => {
    if (collapsible) setIsOpen(prev => !prev);
  }, [collapsible]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!collapsible) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleOpen();
    }
  }, [collapsible, toggleOpen]);

  const springTransition = prefersReduced ? SPRING.reduced : SPRING.default;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        'group relative border-t transition-all duration-500',
        `border-[#E5E5E5]`,
        collapsible
          ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0'
          : 'cursor-default',
        collapsible && `focus-visible:ring-[#D4D4D4]`,
      )}
      onClick={toggleOpen}
      onKeyDown={handleKeyDown}
      role={collapsible ? 'button' : undefined}
      tabIndex={collapsible ? 0 : undefined}
      aria-expanded={collapsible ? effectiveOpen : undefined}
      aria-controls={collapsible ? contentId : undefined}
      aria-label={collapsible ? `${safeLabel} section` : undefined}
    >
      {/* Active-state border highlight — animates width from 0 to full */}
      <div className={cn(
        'absolute -top-[1px] left-0 h-[1px] transition-all duration-500 ease-out z-[1]',
        `bg-[#D4D4D4] shadow-[0_0_8px_rgba(212,212,212,0.4)]`,
        effectiveOpen ? 'w-full opacity-100' : 'w-0 opacity-0',
      )} />

      <div className="py-6 flex flex-col md:flex-row md:items-start gap-5 md:gap-0">
        {/* Section label column */}
        <div className="w-full md:w-[140px] shrink-0 flex items-center justify-between md:block select-none">
          <span className={cn(
            TYPE.label,
            'transition-colors duration-300 block',
            effectiveOpen
              ? `text-[#0A0A0A]`
              : `text-[#A3A3A3] group-hover:text-[#737373]`,
          )}>
            {label}
          </span>
          {collapsible && <div className="md:hidden block"><ToggleSwitch expanded={effectiveOpen} /></div>}
        </div>

        {/* Content region */}
        <div className="flex-1 min-w-0 relative">
          {collapsible && (
            <div className="hidden md:block absolute right-0 top-1">
              <ToggleSwitch expanded={effectiveOpen} />
            </div>
          )}
          <AnimatePresence initial={false}>
            {effectiveOpen && (
              <motion.div
                id={contentId}
                role="region"
                aria-label={safeLabel}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={springTransition}
                className="overflow-hidden"
              >
                <div className="animate-in fade-in duration-700 fill-mode-forwards">
                  {children}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};


// ============================================================================
// §8  DATA-DISPLAY COMPONENTS
// ============================================================================

/**
 * Horizontal comparison bar for team stats.
 * Bar widths are proportional to max(away, home) — the leader fills 100%.
 * Winner side gets full opacity; trailing side is de-emphasized.
 */
const ComparisonStatRow: FC<{
  label: string;
  awayDisplay: string;
  homeDisplay: string;
  awayValue: number;
  homeValue: number;
  awayColor: string;
  homeColor: string;
}> = memo(({ label, awayDisplay, homeDisplay, awayValue, homeValue, awayColor, homeColor }) => {
  const max = Math.max(awayValue, homeValue, 1);
  const awayPct = (awayValue / max) * 100;
  const homePct = (homeValue / max) * 100;
  const awayLeading = awayValue > homeValue;
  const homeLeading = homeValue > awayValue;

  return (
    <div className="grid grid-cols-[72px_1fr_72px] items-center gap-3 py-2">
      <span className={cn(NUMERIC, `text-right text-[13px] text-[#0A0A0A]`)}>{awayDisplay}</span>
      <div className={cn(
        'relative h-9 rounded-full overflow-hidden',
        `bg-[#F5F5F5] border border-[#E5E5E5]`,
      )}>
        <div className={`absolute inset-y-0 left-1/2 w-px bg-[#D4D4D4]`} />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${awayPct / 2}%` }}
          transition={SPRING.bar}
          className="absolute right-1/2 inset-y-[9px] rounded-l-full"
          style={{ backgroundColor: awayColor, opacity: awayLeading ? 0.8 : 0.55 }}
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${homePct / 2}%` }}
          transition={SPRING.bar}
          className="absolute left-1/2 inset-y-[9px] rounded-r-full"
          style={{ backgroundColor: homeColor, opacity: homeLeading ? 0.8 : 0.55 }}
        />
        <div className="absolute inset-0 flex items-center justify-center px-2">
          <span className={cn(TYPE.body, `text-[#737373] text-center truncate`)}>{label}</span>
        </div>
      </div>
      <span className={cn(NUMERIC, `text-[13px] text-[#0A0A0A]`)}>{homeDisplay}</span>
    </div>
  );
});
ComparisonStatRow.displayName = 'ComparisonStatRow';

/** Post-game betting outcomes table */
const BettingRowsTable: FC<{ rows: BettingOutcomeRow[]; compact?: boolean }> = memo(({ rows, compact = false }) => {
  if (!rows.length) return null;
  const renderRows = compact ? rows.slice(0, 2) : rows;

  return (
    <div className={cn(
      'divide-y rounded-2xl border bg-white',
      `divide-[#E5E5E5] border-[#E5E5E5]`,
    )}>
      {renderRows.map((row) => (
        <div key={row.market} className="grid grid-cols-[64px_1fr_1fr_auto] gap-3 p-3 items-center">
          <span className={cn(TYPE.meta, `font-semibold uppercase text-[#737373]`)}>{row.market}</span>
          <span className={cn(TYPE.numericSm, `text-[#0A0A0A]`)}>{row.selection}</span>
          <span className={cn(TYPE.numericSm, `text-[#737373]`)}>{row.result}</span>
          <span className={cn(
            'text-[12px] font-semibold',
            row.won === null ? `text-[#737373]` : row.won ? `text-[#00C896]` : `text-[#E54D4D]`,
          )}>
            {row.verdict}
          </span>
        </div>
      ))}
    </div>
  );
});
BettingRowsTable.displayName = 'BettingRowsTable';

/** Database-backed intelligence snapshot for pregame and low-data states */
const IntelligenceSnapshotCard: FC<{
  intel: PregameIntelResponse | null;
  teamContext: TeamContextSnapshot | null;
  homeAbbr: string;
  awayAbbr: string;
}> = memo(({ intel, teamContext, homeAbbr, awayAbbr }) => {
  const homeLine = formatTeamContextLine(homeAbbr, teamContext?.home);
  const awayLine = formatTeamContextLine(awayAbbr, teamContext?.away);
  const updatedLabel = teamContext?.updatedAt
    ? new Date(teamContext.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : undefined;
  const confidence = typeof intel?.confidence_score === 'number'
    ? `${Math.round(intel.confidence_score <= 1 ? intel.confidence_score * 100 : intel.confidence_score)}%`
    : undefined;

  return (
    <div className="space-y-3">
      {intel && (
        <div className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(TYPE.label, 'text-[#737373]')}>INTEL</span>
            {intel.freshness && (
              <span className={cn(TYPE.numericXs, 'rounded-full border border-[#D4D4D4] bg-white px-2 py-0.5 text-[#737373]')}>
                {intel.freshness}
              </span>
            )}
            {confidence && (
              <span className={cn(TYPE.numericXs, 'rounded-full border border-[#D4D4D4] bg-white px-2 py-0.5 text-[#737373]')}>
                {confidence} confidence
              </span>
            )}
          </div>
          <p className={cn(TYPE.heading, 'mt-2 text-[#0A0A0A]')}>{intel.headline}</p>
          {intel.briefing && (
            <p className={cn(TYPE.body, 'mt-1 line-clamp-3 text-[#525252]')}>{intel.briefing}</p>
          )}
          {intel.recommended_pick && (
            <p className={cn(TYPE.numericSm, 'mt-2 text-[#0A0A0A]')}>
              Pick: <span className="font-semibold">{intel.recommended_pick}</span>
            </p>
          )}
        </div>
      )}

      {(homeLine || awayLine) && (
        <div className="rounded-xl border border-[#E5E5E5] bg-white p-3">
          <p className={cn(TYPE.label, 'text-[#737373]')}>TEAM LOAD</p>
          <div className="mt-2 space-y-1.5">
            {awayLine && <p className={cn(TYPE.body, 'text-[#525252]')}>{awayLine}</p>}
            {homeLine && <p className={cn(TYPE.body, 'text-[#525252]')}>{homeLine}</p>}
          </div>
          {updatedLabel && (
            <p className={cn(TYPE.numericXs, 'mt-2 text-[#A3A3A3]')}>
              Updated {updatedLabel}
            </p>
          )}
        </div>
      )}

      {!intel && !homeLine && !awayLine && (
        <div className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-3">
          <p className={cn(TYPE.body, 'text-[#737373]')}>
            Syncing database context for this match.
          </p>
        </div>
      )}
    </div>
  );
});
IntelligenceSnapshotCard.displayName = 'IntelligenceSnapshotCard';


// ============================================================================
// §9  CLOCK & SCORING ENGINE
// ============================================================================

const getBreakClockLabel = (status: string, sport: CoreSport): string | null => {
  const s = status.toUpperCase();
  if (s.includes('HALF')) return sport === 'SOCCER' ? 'HT' : 'HALF';
  if (s.includes('INTERMISSION')) return 'INT';
  if (s.includes('END_PERIOD')) return sport === 'HOCKEY' ? 'INT' : 'END OF PERIOD';
  if (s.includes('RAIN_DELAY')) return 'RAIN DELAY';
  return null;
};

const getScoreClockModel = (
  match: Match,
  currentOdds: Match['current_odds'] | Match['closing_odds'] | Match['opening_odds'] | Match['odds'] | undefined
): ClockDisplayModel => {
  const sport = getCoreSport(match);
  const status = String(match.status || '').toUpperCase();
  const displayClock = String(match.displayClock || '').trim();
  const period = Math.max(1, match.period || 1);
  const spread = getOddsSpreadValue(currentOdds);
  const total = getOddsTotalValue(currentOdds);

  if (isGameFinal(match.status)) {
    const hasOvertime = status.includes('OT') || status.includes('AET') || status.includes('SO');
    return { primary: hasOvertime ? 'FINAL/OT' : 'FINAL', isLive: false, isFinal: true, finalLabel: hasOvertime ? 'FINAL/OT' : 'FINAL' };
  }

  const breakLabel = getBreakClockLabel(status, sport);
  if (breakLabel) return { primary: breakLabel, isLive: false, isFinal: false };

  if (isGameScheduled(match.status)) {
    const date = new Date(match.startTime);
    const primary = Number.isNaN(date.getTime())
      ? 'TBD'
      : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const details: string[] = [];
    if (spread !== undefined) details.push(`SPREAD ${formatSigned(spread)}`);
    if (total !== undefined) details.push(`TOTAL ${total}`);
    return { primary, secondary: details.join(' · '), isLive: false, isFinal: false };
  }

  if (sport === 'SOCCER') {
    const rawMinute = String(match.minute || displayClock).replace(/\s/g, '');
    const minute = rawMinute.endsWith("'") ? rawMinute : `${rawMinute || '0'}'`;
    return { primary: minute, isLive: true, isFinal: false };
  }

  if (sport === 'BASEBALL') {
    const normalizedClock = displayClock.toUpperCase().replace('BOTTOM', 'BOT').replace('MIDDLE', 'MID').trim();
    const inning = Math.max(1, period);
    const primary = normalizedClock || `TOP ${inning}`;
    const outs = typeof match.situation?.outs === 'number'
      ? `${match.situation.outs} OUT${match.situation.outs === 1 ? '' : 'S'}`
      : undefined;
    return { primary, secondary: outs && !primary.startsWith('MID') ? outs : undefined, isLive: true, isFinal: false };
  }

  if (sport === 'HOCKEY') {
    return { primary: `${toOrdinalPeriod(period)} · ${displayClock || '00:00'}`, isLive: true, isFinal: false };
  }

  if (sport === 'FOOTBALL') {
    const downDistance = match.situation?.downDistanceText?.toUpperCase();
    return {
      primary: `${period > 4 ? 'OT' : `Q${period}`} · ${displayClock || '00:00'}`,
      secondary: downDistance || undefined,
      isLive: true,
      isFinal: false,
    };
  }

  return { primary: `${period > 4 ? 'OT' : `Q${period}`} · ${displayClock || '00:00'}`, isLive: true, isFinal: false };
};


// ============================================================================
// §10  BETTING OUTCOME ENGINE
// ============================================================================

const buildFinalBettingRows = (
  match: Match,
  closingOdds: Match['current_odds'] | Match['opening_odds'] | Match['closing_odds'] | Match['odds'] | undefined
): BettingOutcomeRow[] => {
  if (!isGameFinal(match.status) || !closingOdds) return [];

  const rows: BettingOutcomeRow[] = [];
  const homeAbbr = toTeamAbbreviation(match.homeTeam);
  const awayAbbr = toTeamAbbreviation(match.awayTeam);
  const sport = getCoreSport(match);
  const totalLabel = sport === 'SOCCER' || sport === 'HOCKEY' ? 'goals' : sport === 'BASEBALL' ? 'runs' : 'points';

  const bettingOutcome = calculateBettingOutcome({
    ...match,
    status: MatchStatus.FINISHED,
    odds: closingOdds as Match['odds'],
  });

  // ─── Spread ───
  const homeSpread = getOddsFieldNumber(closingOdds, ['dk_spread', 'homeSpread', 'home_spread', 'spread_home', 'spread']);
  const spreadPriceHome = getOddsFieldNumber(closingOdds, ['dk_home_spread_price', 'homeSpreadOdds', 'home_spread_odds']);
  const spreadPriceAway = getOddsFieldNumber(closingOdds, ['dk_away_spread_price', 'awaySpreadOdds', 'away_spread_odds']);

  if (homeSpread !== undefined) {
    const pickHome = homeSpread <= 0;
    const selectedTeam = pickHome ? homeAbbr : awayAbbr;
    const selectedLine = pickHome ? homeSpread : homeSpread * -1;
    const selectedPrice = pickHome ? spreadPriceHome : spreadPriceAway;

    let won: boolean | null = null;
    if (bettingOutcome?.spread) {
      if (bettingOutcome.spread.isPush) won = null;
      else won = bettingOutcome.spread.teamId === (pickHome ? match.homeTeam.id : match.awayTeam.id);
    } else {
      const margin = (match.homeScore || 0) + homeSpread - (match.awayScore || 0);
      won = margin === 0 ? null : pickHome ? margin > 0 : margin < 0;
    }

    rows.push({
      market: 'SPREAD',
      selection: `${selectedTeam} ${formatSigned(selectedLine)}${selectedPrice !== undefined ? ` (${formatAmericanOdds(selectedPrice)})` : ''}`,
      result: `${match.homeTeam.name} ${match.homeScore}-${match.awayScore} ${match.awayTeam.name}`,
      verdict: won === null ? 'PUSH' : won ? 'COVERED ✓' : 'MISSED ✗',
      won,
    });
  }

  // ─── Total ───
  const totalLine = getOddsFieldNumber(closingOdds, ['dk_total', 'total', 'overUnder', 'over_under', 'total_line', 'over']);
  const overPrice = getOddsFieldNumber(closingOdds, ['dk_over_price', 'overOdds', 'over_odds', 'totalOver']);
  if (totalLine !== undefined) {
    const actual = (match.homeScore || 0) + (match.awayScore || 0);
    const won = actual === totalLine ? null : actual > totalLine;
    rows.push({
      market: 'TOTAL',
      selection: `Over ${totalLine}${overPrice !== undefined ? ` (${formatAmericanOdds(overPrice)})` : ''}`,
      result: `${actual} ${totalLabel}`,
      verdict: won === null ? 'PUSH' : won ? 'HIT ✓' : 'MISSED ✗',
      won,
    });
  }

  // ─── Moneyline ───
  const homeMl = getOddsFieldNumber(closingOdds, ['dk_home_ml', 'home_ml', 'moneylineHome', 'homeWin']);
  const awayMl = getOddsFieldNumber(closingOdds, ['dk_away_ml', 'away_ml', 'moneylineAway', 'awayWin']);
  const drawMl = getOddsFieldNumber(closingOdds, ['dk_draw_ml', 'draw_ml', 'draw']);
  if (homeMl !== undefined || awayMl !== undefined || drawMl !== undefined) {
    const options = [
      homeMl !== undefined ? { team: homeAbbr, side: 'HOME' as const, price: homeMl } : null,
      awayMl !== undefined ? { team: awayAbbr, side: 'AWAY' as const, price: awayMl } : null,
      drawMl !== undefined ? { team: 'DRAW', side: 'DRAW' as const, price: drawMl } : null,
    ].filter(Boolean) as Array<{ team: string; side: 'HOME' | 'AWAY' | 'DRAW'; price: number }>;

    options.sort((a, b) => {
      if (a.price < 0 && b.price >= 0) return -1;
      if (a.price >= 0 && b.price < 0) return 1;
      return a.price - b.price;
    });

    const pick = options[0];
    const winnerSide: 'HOME' | 'AWAY' | 'DRAW' =
      match.homeScore === match.awayScore ? 'DRAW' : match.homeScore > match.awayScore ? 'HOME' : 'AWAY';
    const won = pick ? pick.side === winnerSide : null;

    rows.push({
      market: 'ML',
      selection: pick ? `${pick.team} ML (${formatAmericanOdds(pick.price)})` : 'ML',
      result: winnerSide === 'DRAW' ? 'Draw' : winnerSide === 'HOME' ? `${homeAbbr} won` : `${awayAbbr} won`,
      verdict: won === null ? 'PUSH' : won ? 'WON ✓' : 'LOST ✗',
      won,
    });
  }

  return rows;
};


// ============================================================================
// §11  HOOKS
// ============================================================================

/**
 * RAF-throttled scroll collapse with hysteresis to prevent flicker.
 *
 * Hysteresis: the collapsed state only toggles when scroll position
 * exceeds (threshold ± hysteresis), preventing rapid state oscillation
 * at the boundary. This is the same technique Apple uses for sticky
 * headers in UIKit's UIScrollView.
 */
const useScrollCollapse = (threshold = 40, hysteresis = 12): boolean => {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let rafId: number | null = null;
    let lastCollapsed = collapsed;

    const evaluate = () => {
      const y = window.scrollY;
      const next =
        y > threshold + hysteresis ? true :
        y < threshold - hysteresis ? false :
        lastCollapsed;

      if (next !== lastCollapsed) {
        lastCollapsed = next;
        setCollapsed(next);
      }
      rafId = null;
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(evaluate);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
    };
  }, [threshold, hysteresis, collapsed]);

  return collapsed;
};

/** Arrow key navigation between matches in the carousel */
function useKeyboardNavigation(matches: Match[], currentMatchId: string, onSelectMatch?: (match: Match) => void) {
  useEffect(() => {
    if (!onSelectMatch || matches.length <= 1) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = matches.findIndex(m => m.id === currentMatchId);
      if (idx === -1) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onSelectMatch(matches[(idx - 1 + matches.length) % matches.length]); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onSelectMatch(matches[(idx + 1) % matches.length]); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [matches, currentMatchId, onSelectMatch]);
}


// ============================================================================
// §12  REAL-TIME DATA FUSION HOOK
// ============================================================================
//
//  Multi-source data pipeline:
//    ESPN (primary) → Supabase DB (odds, props) → WebSocket (live state)
//
//  Signature-based diffing prevents unnecessary re-renders.
//  WebSocket freshness gating avoids duplicate HTTP fetches.
//  Sequential fetch guard (isFetchingRef) prevents request pileup.
//
// ============================================================================

function useMatchPolling(initialMatch: ExtendedMatch) {
  const [match, setMatch] = useState<ExtendedMatch>(initialMatch);
  const [liveState, setLiveState] = useState<LiveState | null>(null);
  const [nhlShots, setNhlShots] = useState<ShotEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'error' | 'connecting'>('connecting');
  const [error, setError] = useState<Error | null>(null);
  const [forecastHistory, setForecastHistory] = useState<ForecastPoint[]>([]);
  const [edgeState, setEdgeState] = useState<EdgeState | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const matchRef = useRef<ExtendedMatch>(initialMatch);
  const matchSigRef = useRef<string>(computeMatchSignature(initialMatch));
  const liveSigRef = useRef<string>('');
  const lastLiveCreatedAtRef = useRef<number>(0);
  const lastLiveReceivedAtRef = useRef<number>(0);
  const isFetchingRef = useRef(false);
  const fetchSeqRef = useRef(0);
  const nhlLastFetchAtRef = useRef<number>(0);
  const nhlLastKeyRef = useRef<string>('');
  const isSocketActiveRef = useRef(false);

  const processLiveState = useCallback((live: LiveState) => {
    if (!live) { setEdgeState(null); return; }
    setLiveState(live);

    const aiAnalysis = live.ai_analysis;
    const signals = live.deterministic_signals;

    if (aiAnalysis?.sharp_data?.recommendation && signals) {
      const rec = aiAnalysis.sharp_data.recommendation;
      const fairTotal = signals.deterministic_fair_total || 0;
      const marketTotal = signals.market_total || 0;
      const diff = fairTotal - marketTotal;

      const newEdge: EdgeState = {
        side: diff > 0 ? 'OVER' : diff < 0 ? 'UNDER' : null,
        state: rec.side !== 'PASS' && rec.side !== 'AVOID' ? 'PLAY' : Math.abs(diff) > 1.5 ? 'LEAN' : 'NEUTRAL',
        edgePoints: diff,
        confidence: aiAnalysis.sharp_data.confidence_level,
      };

      setEdgeState(newEdge);
      setForecastHistory(prev => {
        const newPoint: ForecastPoint = { clock: live.clock || '', fairTotal, marketTotal, edgeState: newEdge.state, timestamp: Date.now() };
        const last = prev[prev.length - 1];
        if (last && last.clock === newPoint.clock && last.fairTotal === newPoint.fairTotal) return prev;
        return [...prev.slice(-PIPELINE.forecast.SPARKLINE_POINTS + 1), newPoint];
      });
    }

    if (live.home_score !== undefined && live.away_score !== undefined) {
      setMatch(prev => {
        if ((live.home_score! > (prev.homeScore || 0)) || (live.away_score! > (prev.awayScore || 0))) {
          return { ...prev, homeScore: Math.max(live.home_score!, prev.homeScore || 0), awayScore: Math.max(live.away_score!, prev.awayScore || 0) };
        }
        return prev;
      });
    }
  }, []);

  // Reset on match change
  useEffect(() => {
    matchRef.current = initialMatch;
    matchSigRef.current = computeMatchSignature(initialMatch);
    liveSigRef.current = '';
    lastLiveCreatedAtRef.current = 0;
    lastLiveReceivedAtRef.current = 0;
    setMatch(initialMatch);
    setLiveState(null);
    setNhlShots([]);
    setForecastHistory([]);
    setEdgeState(null);
    setConnectionStatus('connecting');
    setError(null);
    setIsInitialLoad(true);
    nhlLastFetchAtRef.current = 0;
    nhlLastKeyRef.current = '';
    isSocketActiveRef.current = false;
  }, [initialMatch.id]);

  // WebSocket subscription for live game state
  useEffect(() => {
    if (!isGameInProgress(initialMatch.status)) return;

    const dbId = getDbMatchId(initialMatch.id, initialMatch.leagueId?.toLowerCase() || '');
    const channel = supabase
      .channel(`live_state:${dbId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'live_match_states',
        filter: `match_id=eq.${dbId}`,
      }, (payload) => {
        if (payload.new) {
          isSocketActiveRef.current = true;
          const receivedAt = Date.now();
          const newLive = payload.new as LiveState;
          const createdAt = parseTsMs(newLive.created_at, receivedAt);
          if (createdAt <= lastLiveCreatedAtRef.current) return;
          lastLiveCreatedAtRef.current = createdAt;
          lastLiveReceivedAtRef.current = receivedAt;
          const nextLiveSig = hashStable(newLive);
          if (nextLiveSig !== liveSigRef.current) {
            liveSigRef.current = nextLiveSig;
            processLiveState(newLive);
          }
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { isSocketActiveRef.current = true; lastLiveReceivedAtRef.current = Date.now(); }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { isSocketActiveRef.current = false; }
      });

    return () => { supabase.removeChannel(channel); isSocketActiveRef.current = false; };
  }, [initialMatch.id, initialMatch.leagueId, initialMatch.status, processLiveState]);

  const maybeFetchNhlShots = useCallback(async (m: Match) => {
    if (m.sport !== 'HOCKEY') return;
    const now = Date.now();
    if (now - nhlLastFetchAtRef.current < PIPELINE.nhlShots.MIN_MS) return;
    const key = `${m.id}|${m.homeTeam?.name ?? ''}|${m.awayTeam?.name ?? ''}|${m.startTime ?? ''}`;
    if (key === nhlLastKeyRef.current && now - nhlLastFetchAtRef.current < PIPELINE.nhlShots.MIN_MS) return;
    nhlLastFetchAtRef.current = now;
    nhlLastKeyRef.current = key;
    try {
      const d = await fetchNhlGameDetails(m.homeTeam.name, m.awayTeam.name, new Date(m.startTime));
      if (d?.shots) setNhlShots(d.shots);
    } catch { /* non-critical */ }
  }, []);

  // ─── Primary Fetch Loop ───────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    const seq = ++fetchSeqRef.current;

    try {
      const cur = matchRef.current;
      const leagueKey = cur.leagueId?.toLowerCase() || '';
      const dbId = getDbMatchId(cur.id, leagueKey);
      const shouldFetchLive = isGameInProgress(cur.status);
      const socketFresh = isSocketActiveRef.current && shouldFetchLive &&
        (Date.now() - lastLiveReceivedAtRef.current) < PIPELINE.polling.SOCKET_FRESH_MS;

      setConnectionStatus(prev => (prev === 'connected' ? 'connected' : 'connecting'));

      const espnPromise: Promise<EspnExtendedMatch | null> =
        fetchMatchDetailsExtended(cur.id, cur.sport, cur.leagueId).catch(e => { console.warn('[Drip] ESPN:', e.message); return null; });
      const dbPromise =
        sbData<DbMatchRow>(supabase.from('matches').select('*').eq('id', dbId).maybeSingle()).catch(e => { console.warn('[Drip] DB:', e.message); return null; });
      const propsPromise =
        failSafe<DbPlayerPropRow[]>(supabase.from('player_prop_bets').select('*').ilike('match_id', `%${cur.id}%`).order('player_name'));
      const livePromise = (shouldFetchLive && !socketFresh)
        ? failSafe<LiveState>(supabase.from('live_match_states').select('*').eq('match_id', dbId).maybeSingle())
        : Promise.resolve(null);

      const [espn, db, props, live] = await Promise.all([espnPromise, dbPromise, propsPromise, livePromise]);
      if (seq !== fetchSeqRef.current) return;

      if (!espn && !db) {
        if (matchRef.current.homeTeam) setConnectionStatus('connecting');
        else throw new Error('Unable to connect to game feed.');
        setIsInitialLoad(false);
        return;
      }

      let nextMatch: ExtendedMatch = { ...matchRef.current };

      // ESPN data merge
      if (espn) {
        const stats = espn.stats || espn.statistics || nextMatch.stats || [];
        nextMatch = {
          ...nextMatch,
          ...espn,
          stats,
          homeScore: Math.max(espn.homeScore ?? 0, nextMatch.homeScore ?? 0),
          awayScore: Math.max(espn.awayScore ?? 0, nextMatch.awayScore ?? 0),
        };
      }

      // DB odds & score merge
      if (db && !isGameFinal(nextMatch.status)) {
        nextMatch.current_odds = db.current_odds;
        if ((db.home_score || 0) > (nextMatch.homeScore || 0)) nextMatch.homeScore = db.home_score;
        if ((db.away_score || 0) > (nextMatch.awayScore || 0)) nextMatch.awayScore = db.away_score;
      }
      if (db) {
        if (db.closing_odds) nextMatch.closing_odds = db.closing_odds;
        if (db.opening_odds) nextMatch.opening_odds = db.opening_odds;
        if (db.odds) nextMatch.odds = db.odds;
      }

      // Player props normalization
      if (props?.length) {
        const normalizePropType = (value?: string | null): PropBetType => {
          const raw = (value || '').toLowerCase();
          const v = raw.replace(/\s+/g, '_').replace(/3pt|3p|3pm|threes/g, 'threes_made');
          const allowed: PropBetType[] = [
            'points', 'rebounds', 'assists', 'threes_made', 'blocks', 'steals',
            'pra', 'pr', 'pa', 'ra', 'points_rebounds', 'points_assists', 'rebounds_assists',
            'passing_yards', 'rushing_yards', 'receiving_yards', 'touchdowns', 'receptions', 'tackles', 'sacks', 'hits',
            'shots_on_goal', 'goals', 'saves', 'custom',
          ];
          return allowed.includes(v as PropBetType) ? (v as PropBetType) : 'custom';
        };

        const inferSide = (label?: string | null, betType?: string | null): PlayerPropBet['side'] => {
          const raw = `${label || ''} ${betType || ''}`.toLowerCase();
          if (/\bover\b/.test(raw)) return 'over';
          if (/\bunder\b/.test(raw)) return 'under';
          if (/\byes\b/.test(raw)) return 'yes';
          if (/\bno\b/.test(raw)) return 'no';
          return 'line';
        };

        const toPropBet = (p: DbPlayerPropRow): PlayerPropBet => ({
          id: `${cur.id}:${p.player_name || 'player'}:${p.bet_type || 'prop'}:${p.line_value ?? ''}`,
          userId: 'system',
          matchId: cur.id,
          eventDate: new Date(cur.startTime).toISOString(),
          league: cur.leagueId,
          team: p.team || undefined,
          opponent: p.opponent || undefined,
          playerName: p.player_name || '',
          playerId: p.player_id || undefined,
          espnPlayerId: p.espn_player_id || undefined,
          headshotUrl: p.headshot_url || undefined,
          betType: normalizePropType(p.bet_type),
          marketLabel: p.market_label || undefined,
          side: (p.side || inferSide(p.market_label, p.bet_type)) as PlayerPropBet['side'],
          lineValue: Number(p.line_value ?? 0),
          sportsbook: p.sportsbook || p.provider || 'market',
          oddsAmerican: Number(p.odds_american ?? 0),
          stakeAmount: 0,
          result: 'pending',
          impliedProbPct: p.implied_prob_pct ? Number(p.implied_prob_pct) : undefined,
          confidenceScore: p.confidence_score ? Number(p.confidence_score) : undefined,
          fantasyDvpRank: p.fantasy_dvp_rank ? Number(p.fantasy_dvp_rank) : undefined,
          l5HitRate: p.l5_hit_rate ? Number(p.l5_hit_rate) : undefined,
          l5Values: Array.isArray(p.l5_values) ? p.l5_values.map(v => Number(v)) : undefined,
          avgL5: p.avg_l5 ? Number(p.avg_l5) : undefined,
          aiRationale: p.ai_rationale || undefined,
          analysisStatus: p.analysis_status || undefined,
          analysisTs: p.analysis_ts || undefined,
        });

        nextMatch.dbProps = props.map(toPropBet);
      } else if (props !== null) {
        nextMatch.dbProps = [];
      }

      // Signature-gated state update
      const nextSig = computeMatchSignature(nextMatch);
      if (nextSig !== matchSigRef.current) {
        matchRef.current = nextMatch;
        matchSigRef.current = nextSig;
        setMatch(nextMatch);
      }

      // Live state from HTTP fallback
      if (live) {
        const receivedAt = Date.now();
        const createdAt = parseTsMs(live.created_at, receivedAt);
        if (createdAt > lastLiveCreatedAtRef.current) {
          lastLiveCreatedAtRef.current = createdAt;
          lastLiveReceivedAtRef.current = receivedAt;
          const nextLiveSig = hashStable(live);
          if (nextLiveSig !== liveSigRef.current) {
            liveSigRef.current = nextLiveSig;
            processLiveState(live);
          }
        }
      }

      // Pregame form fetch (once)
      if (isGameScheduled(cur.status) && !nextMatch.homeTeam.last5) {
        try {
          const [hForm, aForm] = await Promise.all([
            fetchTeamLastFive(cur.homeTeam.id, cur.sport, cur.leagueId),
            fetchTeamLastFive(cur.awayTeam.id, cur.sport, cur.leagueId),
          ]);
          nextMatch.homeTeam.last5 = hForm;
          nextMatch.awayTeam.last5 = aForm;
          setMatch({ ...nextMatch });
          matchRef.current = nextMatch;
        } catch (e) { console.warn('[Drip] Form Fetch:', e); }
      }

      void maybeFetchNhlShots(nextMatch);
      setConnectionStatus('connected');
      setError(null);
      setIsInitialLoad(false);
    } catch (e) {
      console.error('[Drip] Polling Error:', e);
      setConnectionStatus('error');
      setError(e instanceof Error ? e : new Error('Sync failed'));
      setIsInitialLoad(false);
    } finally {
      isFetchingRef.current = false;
    }
  }, [maybeFetchNhlShots, processLiveState]);

  // Polling interval — visibility-gated to avoid background battery drain
  useEffect(() => {
    fetchData();
    const tickMs = isGameInProgress(match.status) ? PIPELINE.polling.LIVE_MS : PIPELINE.polling.PREGAME_MS;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, tickMs);
    return () => window.clearInterval(interval);
  }, [fetchData, match.status]);

  return { match, liveState, nhlShots, connectionStatus, error, forecastHistory, edgeState, isInitialLoad };
}


// ============================================================================
// §13  EXTRACTED LAYOUT COMPONENTS
// ============================================================================
//
//  Score header and tab navigation are extracted as named components
//  to improve readability of the main render tree and establish
//  clear memo boundaries for performance.
//
// ============================================================================

/** Surface card wrapper — consistent border/radius/bg treatment */
const Surface: FC<{ children: ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn(
    'rounded-2xl border bg-white',
    `border-[#E5E5E5]`,
    className,
  )}>
    {children}
  </div>
);

/** Labeled metric card — used in Market Watch and Odds grids */
const MetricCard: FC<{ label: string; value: string; className?: string }> = ({ label, value, className }) => (
  <div className={cn(
    'rounded-xl border p-3',
    `border-[#E5E5E5] bg-[#FAFAFA]`,
    className,
  )}>
    <p className={cn(TYPE.label, `mb-1 text-[#737373]`)}>{label}</p>
    <p className={cn(TYPE.numeric, `text-[#0A0A0A]`)}>{value}</p>
  </div>
);

/** Section header label — used in AI sidebar panels */
const SectionLabel: FC<{ children: string }> = ({ children }) => (
  <p className={cn(TYPE.label, `mb-3 text-[#737373]`)}>{children}</p>
);


// ============================================================================
// §14  MAIN COMPONENT
// ============================================================================

export interface MatchDetailsProps {
  match: Match;
  onBack: () => void;
  matches?: Match[];
  onSelectMatch?: (match: Match) => void;
}

const MatchDetails: FC<MatchDetailsProps> = ({
  match: initialMatch,
  onBack,
  matches = [],
  onSelectMatch,
}) => {
  const prefersReduced = useReducedMotion();

  // ─── Data Layer ─────────────────────────────────────────────────────────
  const {
    match, liveState, nhlShots, connectionStatus, error,
    forecastHistory, edgeState, isInitialLoad,
  } = useMatchPolling(initialMatch as ExtendedMatch);

  const isBaseball = match.sport === Sport.BASEBALL;
  const { data: baseballData } = useBaseballLive(match.id, match.status, isBaseball);

  const [pregameIntel, setPregameIntel] = useState<PregameIntelResponse | null>(null);
  const [teamContextSnapshot, setTeamContextSnapshot] = useState<TeamContextSnapshot | null>(null);
  useKeyboardNavigation(matches, match.id, onSelectMatch);

  // ─── Derived State ──────────────────────────────────────────────────────
  const isSched = useMemo(() => isGameScheduled(match?.status), [match?.status]);
  const isLive = isGameInProgress(match.status);
  const coreSport = useMemo(() => getCoreSport(match), [match]);
  const isSoccer = coreSport === 'SOCCER';

  const homeColor = useMemo(() => normalizeColor(match?.homeTeam?.color, '#3B82F6'), [match.homeTeam]);
  const awayColor = useMemo(() => normalizeColor(match?.awayTeam?.color, '#EF4444'), [match.awayTeam]);
  const displayStats = useMemo(() => getMatchDisplayStats(match, 8), [match]);

  const awayAbbr = toTeamAbbreviation(match.awayTeam);
  const homeAbbr = toTeamAbbreviation(match.homeTeam);
  const awayWinner = match.awayScore > match.homeScore;
  const homeWinner = match.homeScore > match.awayScore;

  const awayRecord = match.awayTeam?.record || '—';
  const homeRecord = match.homeTeam?.record || '—';

  // ─── UI State ───────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<MatchTabId>('SUMMARY');
  const [propView, setPropView] = useState<'classic' | 'cinematic'>('cinematic');
  const nextPropView = propView === 'classic' ? 'cinematic' : 'classic';
  const nextPropLabel = nextPropView === 'classic' ? 'Classic View' : 'Cinematic View';
  const swipeEnabled = matches.length > 1 && Boolean(onSelectMatch);
  // ─── Odds Resolution ───────────────────────────────────────────────────
  const currentOddsSource = match.current_odds || match.closing_odds || match.odds || match.opening_odds;
  const closingOddsSource = match.closing_odds || match.current_odds || match.odds || match.opening_odds;

  const currentSpread = getOddsSpreadValue(currentOddsSource as Match['current_odds']);
  const currentTotal = getOddsTotalValue(currentOddsSource as Match['current_odds']);
  const currentHomeMl = getOddsFieldNumber(currentOddsSource, ['dk_home_ml', 'home_ml', 'moneylineHome', 'homeWin']);
  const currentAwayMl = getOddsFieldNumber(currentOddsSource, ['dk_away_ml', 'away_ml', 'moneylineAway', 'awayWin']);
  const currentDrawMl = getOddsFieldNumber(currentOddsSource, ['dk_draw_ml', 'draw_ml', 'draw']);
  const hasMarketLines = currentSpread !== undefined || currentTotal !== undefined || currentHomeMl !== undefined || currentAwayMl !== undefined || currentDrawMl !== undefined;

  const currentMlDisplay = [
    currentAwayMl !== undefined ? `${awayAbbr} ${formatAmericanOdds(currentAwayMl)}` : null,
    currentHomeMl !== undefined ? `${homeAbbr} ${formatAmericanOdds(currentHomeMl)}` : null,
    currentDrawMl !== undefined ? `DRAW ${formatAmericanOdds(currentDrawMl)}` : null,
  ].filter(Boolean).join(' · ') || 'N/A';

  const spreadTotalLine = [
    currentSpread !== undefined ? `${homeAbbr} ${formatSigned(currentSpread)}` : null,
    currentTotal !== undefined ? `O/U ${currentTotal}` : null,
  ].filter(Boolean).join(' · ');

  // ─── Database Context Snapshot ──────────────────────────────────────────
  useEffect(() => {
    let active = true;

    const fetchTeamContextSnapshot = async () => {
      const start = new Date(match.startTime);
      if (Number.isNaN(start.getTime())) {
        if (active) setTeamContextSnapshot(null);
        return;
      }

      const gameDate = start.toISOString().slice(0, 10);

      try {
        const { data } = await supabase
          .from('team_game_context')
          .select('team, game_date, situation, rest_days, fatigue_score, injury_notes, injury_impact, ats_last_10, is_b2b, is_second_of_b2b, is_3in4, is_4in5, updated_at')
          .eq('game_date', gameDate)
          .limit(64);

        if (!active) return;

        const rows = Array.isArray(data) ? (data as TeamGameContextRow[]) : [];
        if (!rows.length) {
          setTeamContextSnapshot(null);
          return;
        }

        const homeRow = pickTeamContextRow(rows, getTeamAliases(match.homeTeam));
        const awayRow = pickTeamContextRow(rows, getTeamAliases(match.awayTeam));

        const updatedAt = [homeRow?.updated_at, awayRow?.updated_at]
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .sort()
          .at(-1);

        if (!homeRow && !awayRow) {
          setTeamContextSnapshot(null);
          return;
        }

        setTeamContextSnapshot({
          home: homeRow,
          away: awayRow,
          updatedAt,
        });
      } catch {
        if (active) setTeamContextSnapshot(null);
      }
    };

    fetchTeamContextSnapshot();
    return () => { active = false; };
  }, [
    match.id,
    match.startTime,
    match.homeTeam.name,
    match.homeTeam.shortName,
    match.homeTeam.abbreviation,
    match.awayTeam.name,
    match.awayTeam.shortName,
    match.awayTeam.abbreviation,
  ]);

  // ─── Clock Model ────────────────────────────────────────────────────────
  const scoreClock = useMemo(
    () => getScoreClockModel(match, currentOddsSource),
    [match, currentOddsSource],
  );

  // ─── Win Probability ──────────────────────────────────────────────────
  const winProbability = useMemo(() => {
    const clampPct = (value: number) => Math.max(0, Math.min(100, value));
    const mlToProb = (line: number) => line > 0 ? 100 / (line + 100) : Math.abs(line) / (Math.abs(line) + 100);

    let home: number | undefined;
    let away: number | undefined;

    if (typeof match.win_probability?.home === 'number') home = match.win_probability.home;
    if (typeof match.win_probability?.away === 'number') away = match.win_probability.away;

    if ((home === undefined || away === undefined) && match.predictor) {
      if (typeof match.predictor.homeTeamChance === 'number') home = match.predictor.homeTeamChance;
      if (typeof match.predictor.awayTeamChance === 'number') away = match.predictor.awayTeamChance;
    }

    if (home === undefined && away === undefined) {
      const liveHome = (match.lastPlay as (Match['lastPlay'] & { probability?: { homeWinPercentage?: number } }) | undefined)?.probability?.homeWinPercentage;
      if (typeof liveHome === 'number') { home = liveHome; away = 100 - liveHome; }
    }

    if (home === undefined && away === undefined && typeof currentOddsSource?.winProbability === 'number') {
      home = currentOddsSource.winProbability;
      away = 100 - currentOddsSource.winProbability;
    }

    if ((home === undefined || away === undefined) && currentHomeMl !== undefined && currentAwayMl !== undefined) {
      const homeRaw = mlToProb(currentHomeMl);
      const awayRaw = mlToProb(currentAwayMl);
      const total = homeRaw + awayRaw;
      if (total > 0) { home = (homeRaw / total) * 100; away = (awayRaw / total) * 100; }
    }

    if (home === undefined && away === undefined) { home = 50; away = 50; }
    else if (home === undefined) { home = 100 - away!; }
    else if (away === undefined) { away = 100 - home; }

    home = clampPct(home);
    away = clampPct(away);
    const total = home + away;
    if (total > 0 && Math.abs(total - 100) > 0.5) { home = (home / total) * 100; away = 100 - home; }

    return { home: Math.round(home), away: Math.round(away) };
  }, [match.win_probability, match.predictor, match.lastPlay, currentOddsSource?.winProbability, currentHomeMl, currentAwayMl]);

  // ─── Tab Configuration ────────────────────────────────────────────────
  const TABS = useMemo<{ id: MatchTabId; label: string }[]>(
    () => isSoccer
      ? [
          { id: 'SUMMARY', label: 'SUMMARY' },
          { id: 'STATS', label: 'STATS' },
          { id: 'LINEUPS', label: 'LINEUPS' },
          { id: 'AI', label: 'AI' },
          { id: 'ODDS', label: 'ODDS' },
        ]
      : [
          { id: 'SUMMARY', label: 'SUMMARY' },
          { id: 'STATS', label: 'STATS' },
          { id: 'BOX_SCORE', label: 'BOX SCORE' },
          { id: 'AI', label: 'AI' },
          { id: 'ODDS', label: 'ODDS' },
        ],
    [isSoccer],
  );

  useEffect(() => {
    if (!TABS.some(tab => tab.id === activeTab)) setActiveTab('SUMMARY');
  }, [TABS, activeTab]);

  const tabButtonId = (id: string) => `match-tab-${id.toLowerCase()}`;
  const tabPanelId = (id: string) => `match-panel-${id.toLowerCase()}`;

  // ─── Event Handlers ───────────────────────────────────────────────────
  const handleSwipe = useCallback((dir: number) => {
    if (!matches.length) return;
    const idx = matches.findIndex(m => m.id === match.id);
    if (idx === -1) return;
    onSelectMatch?.(matches[(idx + dir + matches.length) % matches.length]);
  }, [matches, match.id, onSelectMatch]);

  const handleTabSelect = useCallback((tabId: MatchTabId) => {
    setActiveTab(tabId);
  }, []);

  // ─── Stats Computation ────────────────────────────────────────────────
  const comparisonStats = useMemo<ComparisonStat[]>(() => {
    const rows = getMatchDisplayStats(match, 24).map(stat => {
      const awayDisplay = String(stat.awayValue ?? '0');
      const homeDisplay = String(stat.homeValue ?? '0');
      return {
        label: stat.label,
        awayDisplay,
        homeDisplay,
        awayValue: parseComparableValue(awayDisplay),
        homeValue: parseComparableValue(homeDisplay),
        section: getStatSection(stat.label),
      };
    });

    if (isSoccer && !rows.some(row => row.label.toLowerCase().includes('xg'))) {
      const xg = (match.stats || []).find(stat => String(stat.label || '').toLowerCase().includes('xg'));
      if (xg) {
        const awayDisplay = String(xg.awayValue ?? '0');
        const homeDisplay = String(xg.homeValue ?? '0');
        rows.unshift({
          label: 'xG',
          awayDisplay,
          homeDisplay,
          awayValue: parseComparableValue(awayDisplay),
          homeValue: parseComparableValue(homeDisplay),
          section: 'Attack',
        });
      }
    }
    return rows;
  }, [isSoccer, match]);

  const groupedStats = useMemo(() => ({
    Attack: comparisonStats.filter(row => row.section === 'Attack'),
    Defense: comparisonStats.filter(row => row.section === 'Defense'),
    Discipline: comparisonStats.filter(row => row.section === 'Discipline'),
  }), [comparisonStats]);

  const finalBettingRows = useMemo(
    () => buildFinalBettingRows(match, closingOddsSource),
    [match, closingOddsSource],
  );

  // ─── Pregame Intel ────────────────────────────────────────────────────
  const isAiTab = activeTab === 'AI';
  const startTimeISO = useMemo(() => {
    if (!match.startTime) return undefined;
    const date = new Date(match.startTime);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }, [match.startTime]);

  const currentSpreadForIntel = useMemo(() => getOddsSpreadValue(match.current_odds), [match.current_odds]);
  const currentTotalForIntel = useMemo(() => getOddsTotalValue(match.current_odds), [match.current_odds]);

  useEffect(() => {
    if (!isSched) return;
    const controller = new AbortController();
    let active = true;

    const fetchIntel = async () => {
      try {
        if (isAiTab) {
          const intel = await pregameIntelService.fetchIntel(
            match.id, match.homeTeam?.name || '', match.awayTeam?.name || '',
            match.sport || '', match.leagueId || '',
            startTimeISO, currentSpreadForIntel, currentTotalForIntel,
            controller.signal,
          );
          if (intel) { if (active) setPregameIntel(intel); return; }
        }

        const leagueKey = match.leagueId?.toLowerCase() || '';
        const canonicalId = getDbMatchId(match.id, leagueKey);
        const orFilter = canonicalId && canonicalId !== match.id
          ? `match_id.ilike.%${match.id}%,match_id.ilike.%${canonicalId}%`
          : `match_id.ilike.%${match.id}%`;

        const { data: fallback } = await supabase
          .from('pregame_intel')
          .select('*')
          .or(orFilter)
          .order('generated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (active) {
          setPregameIntel(fallback
            ? normalizePregameIntelFallback(
                fallback as Partial<PregameIntelResponse> & { match_id?: string | null; freshness?: string | null },
                match.id
              )
            : null);
        }
      } catch { if (active) setPregameIntel(null); }
    };

    fetchIntel();
    return () => { active = false; controller.abort(); };
  }, [isSched, isAiTab, match.id, match.homeTeam?.name, match.awayTeam?.name, match.sport, match.leagueId, startTimeISO, currentSpreadForIntel, currentTotalForIntel]);

  // ─── AI Insight Cards ─────────────────────────────────────────────────
  const insightCardData = useMemo(() => {
    if (!isAiTab) return null;
    const prop = match.dbProps?.[0];
    if (!prop || typeof prop !== 'object') return null;
    const propRow = prop as Partial<PlayerPropBet> & Record<string, unknown>;

    const norm = (s?: string) => (s || '').toLowerCase();
    const homeKeys = [match.homeTeam.abbreviation, match.homeTeam.shortName, match.homeTeam.name].map(norm);
    const awayKeys = [match.awayTeam.abbreviation, match.awayTeam.shortName, match.awayTeam.name].map(norm);
    const propTeam = norm(propRow.team as string | undefined);

    const isHome = propTeam && homeKeys.some(k => k && propTeam.includes(k));
    const isAway = propTeam && awayKeys.some(k => k && propTeam.includes(k));

    const teamLabel = (propRow.team as string | undefined) || match.homeTeam.abbreviation || match.homeTeam.shortName || match.homeTeam.name;
    const opponentLabel = isHome
      ? (match.awayTeam.abbreviation || match.awayTeam.shortName || match.awayTeam.name)
      : isAway
        ? (match.homeTeam.abbreviation || match.homeTeam.shortName || match.homeTeam.name)
        : (match.awayTeam.abbreviation || match.awayTeam.shortName || match.awayTeam.name);

    const statType = ((propRow.marketLabel as string | undefined) || (propRow.betType as string | undefined) || 'Stat')
      .toString().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    const lineValue = Number(propRow.lineValue ?? 0);
    const side = ((propRow.side as string) || 'OVER').toString().toLowerCase();
    const l5Values = Array.isArray(propRow.l5Values) ? propRow.l5Values.map(v => Number(v)) : [];
    const l5Results = l5Values.map(value => {
      if (!Number.isFinite(value)) return 'MISS';
      if (side === 'under') return value < lineValue ? 'HIT' : value > lineValue ? 'MISS' : 'PUSH';
      if (side === 'over') return value > lineValue ? 'HIT' : value < lineValue ? 'MISS' : 'PUSH';
      return 'MISS';
    }).slice(0, 5);

    const impliedProb = typeof propRow.impliedProbPct === 'number'
      ? propRow.impliedProbPct
      : (typeof propRow.confidenceScore === 'number' ? propRow.confidenceScore * 100 : 50);
    const hitRate = typeof propRow.l5HitRate === 'number'
      ? propRow.l5HitRate
      : (l5Results.length ? Math.round((l5Results.filter(r => r === 'HIT').length / l5Results.length) * 100) : 0);

    return toInsightCard({
      id: (propRow.id as string) || match.id,
      playerName: propRow.playerName as string,
      team: teamLabel,
      opponent: opponentLabel,
      matchup: `${awayAbbr} @ ${homeAbbr}`,
      headshotUrl: propRow.headshotUrl as string,
      side: side.toUpperCase(),
      line: lineValue,
      statType,
      bestOdds: propRow.oddsAmerican as number,
      bestBook: (propRow.sportsbook as string) || (propRow.provider as string) || 'market',
      affiliateLink: undefined,
      dvpRank: typeof propRow.fantasyDvpRank === 'number' ? propRow.fantasyDvpRank : 0,
      edge: 0,
      probability: impliedProb,
      aiAnalysis: (propRow.aiRationale as string) || 'Intelligence pending.',
      l5Results,
      l5HitRate: hitRate,
    });
  }, [isAiTab, match, awayAbbr, homeAbbr]);

  const gameEdgeCardData = useMemo(() => {
    if (!isAiTab || !pregameIntel || !match.homeTeam || !match.awayTeam) return null;

    const pick = pregameIntel.recommended_pick || pregameIntel.grading_metadata?.selection || '';
    const pickText = (pick || '').trim();
    const norm = (s?: string) => (s || '').toLowerCase();
    const homeLabel = match.homeTeam.abbreviation || match.homeTeam.shortName || match.homeTeam.name;
    const awayLabel = match.awayTeam.abbreviation || match.awayTeam.shortName || match.awayTeam.name;
    const matchup = `${awayLabel} @ ${homeLabel}`;

    const homeKeys = [match.homeTeam.abbreviation, match.homeTeam.shortName, match.homeTeam.name].map(norm);
    const awayKeys = [match.awayTeam.abbreviation, match.awayTeam.shortName, match.awayTeam.name].map(norm);

    const extractTeamFromPick = (value?: string | null) => {
      if (!value) return '';
      const s = value.trim();
      if (!s) return '';
      if (/^(over|under)\b/i.test(s)) return s.split(/\s+/).slice(0, 1).join(' ').toUpperCase();
      const mlIdx = s.toLowerCase().lastIndexOf(' ml');
      const core = mlIdx > 0 ? s.slice(0, mlIdx).trim() : s;
      const tokens = core.split(/\s+/);
      const out: string[] = [];
      for (const t of tokens) {
        if (/^[+\-]?\d+(\.\d+)?$/.test(t)) break;
        if (/^\(?[+\-]?\d{3,5}\)?$/.test(t)) break;
        out.push(t);
      }
      return out.length ? out.join(' ') : tokens[0];
    };

    const pickTeam = extractTeamFromPick(pickText);
    const pickNorm = norm(pickTeam);

    let teamName = match.homeTeam.name || homeLabel;
    let opponentName = match.awayTeam.name || awayLabel;
    let teamAbbr = match.homeTeam.abbreviation || homeLabel;
    let teamLogoUrl = match.homeTeam.logo;

    if (pickNorm && homeKeys.some(k => k && pickNorm.includes(k))) {
      teamName = match.homeTeam.name || homeLabel;
      opponentName = match.awayTeam.name || awayLabel;
      teamAbbr = match.homeTeam.abbreviation || homeLabel;
      teamLogoUrl = match.homeTeam.logo;
    } else if (pickNorm && awayKeys.some(k => k && pickNorm.includes(k))) {
      teamName = match.awayTeam.name || awayLabel;
      opponentName = match.homeTeam.name || homeLabel;
      teamAbbr = match.awayTeam.abbreviation || awayLabel;
      teamLogoUrl = match.awayTeam.logo;
    } else if (/^(over|under)\b/i.test(pickText)) {
      teamName = `${homeLabel} vs ${awayLabel}`;
      opponentName = '';
      teamAbbr = 'TOTAL';
      teamLogoUrl = undefined;
    }

    const meta = pregameIntel.grading_metadata;
    const oddsMarket = match.current_odds;
    let bestOdds: string | number | undefined;

    if (meta?.type === 'TOTAL') {
      bestOdds = meta.side === 'OVER'
        ? getOddsDisplayValue(oddsMarket, ['overOdds', 'over_odds', 'totalOver', 'total_over_odds', 'over'])
        : getOddsDisplayValue(oddsMarket, ['underOdds', 'under_odds', 'total_under_odds', 'under']);
    } else if (meta?.type === 'SPREAD') {
      bestOdds = meta.side === 'HOME'
        ? getOddsDisplayValue(oddsMarket, ['homeSpreadOdds', 'home_spread_odds', 'spread_home_odds', 'homeSpread', 'home_spread', 'spread_home', 'spread_home_value'])
        : getOddsDisplayValue(oddsMarket, ['awaySpreadOdds', 'away_spread_odds', 'spread_away_odds', 'awaySpread', 'away_spread', 'spread_away', 'spread_away_value']);
    } else if (meta?.type === 'MONEYLINE') {
      bestOdds = meta.side === 'HOME'
        ? getOddsDisplayValue(oddsMarket, ['moneylineHome', 'homeWin', 'homeML', 'home_ml', 'home_moneyline'])
        : getOddsDisplayValue(oddsMarket, ['moneylineAway', 'awayWin', 'awayML', 'away_ml', 'away_moneyline']);
    }

    const confidence = pregameIntel.confidence_score;
    const probability = typeof confidence === 'number' ? (confidence <= 1 ? confidence * 100 : confidence) : 50;

    return toInsightCard({
      id: `${match.id}-game-edge`,
      headerMode: 'team',
      teamName, teamAbbr, opponentName, teamLogoUrl, matchup,
      customSegment: pickText || 'Game Edge',
      side: pickText.toUpperCase().startsWith('UNDER') ? 'UNDER' : 'OVER',
      line: 0,
      statType: 'Edge',
      bestOdds,
      bestBook: oddsMarket?.provider || 'Market',
      affiliateLink: undefined,
      dvpRank: 0,
      edge: 0,
      probability,
      aiAnalysis: pregameIntel.briefing || pregameIntel.headline || 'Intelligence pending.',
      l5Results: [],
      l5HitRate: 0,
    });
  }, [isAiTab, match, pregameIntel]);

  // ─── AI Context Badges ────────────────────────────────────────────────
  const aiContextBadges = useMemo(() => {
    const statusBadge = isLive ? 'LIVE' : isGameFinal(match.status) ? (scoreClock.finalLabel || 'FINAL') : 'SCHEDULED';
    const scoreBadge = isGameScheduled(match.status)
      ? `${awayAbbr} VS ${homeAbbr}`
      : `${awayAbbr} ${match.awayScore}-${match.homeScore} ${homeAbbr}`;
    const clockBadge = [scoreClock.primary, scoreClock.secondary].filter(Boolean).join(' · ');
    return [statusBadge, scoreBadge, clockBadge].filter(Boolean);
  }, [isLive, match.status, match.awayScore, match.homeScore, awayAbbr, homeAbbr, scoreClock]);

  const aiDrivers = useMemo(() => {
    const items: string[] = [];
    const recommendation = liveState?.ai_analysis?.sharp_data?.recommendation;
    const confidence = liveState?.ai_analysis?.sharp_data?.confidence_level;
    if (recommendation?.side) {
      const marketType = recommendation.market_type ? ` ${String(recommendation.market_type).toUpperCase()}` : '';
      const confidenceText = typeof confidence === 'number' ? ` · ${Math.round(confidence)}% confidence` : '';
      items.push(`${String(recommendation.side).toUpperCase()}${marketType}${confidenceText}`);
    }
    if (edgeState && edgeState.state !== 'NEUTRAL') {
      items.push(`Deterministic edge ${edgeState.side || 'NEUTRAL'} ${edgeState.edgePoints > 0 ? '+' : ''}${edgeState.edgePoints.toFixed(1)} (${edgeState.state})`);
    }
    if (pregameIntel?.headline) items.push(pregameIntel.headline);
    if (!items.length) items.push('Awaiting the next ai-chat stream update.');
    return items.slice(0, 3);
  }, [liveState?.ai_analysis, edgeState, pregameIntel?.headline]);

  const aiWatchouts = useMemo(() => {
    const items: string[] = [];
    if (scoreClock.secondary) items.push(scoreClock.secondary);
    if (isSched) items.push('Pregame numbers can move quickly before kickoff.');
    if (!hasMarketLines) items.push('Lines Not Yet Posted — MONITORING MARKET');
    const confidence = liveState?.ai_analysis?.sharp_data?.confidence_level;
    if (typeof confidence === 'number' && confidence < 60) items.push('Confidence is below 60%; keep stake sizing disciplined.');
    if (!items.length) items.push('No structural watchouts flagged by the live model.');
    return items.slice(0, 3);
  }, [scoreClock.secondary, isSched, hasMarketLines, liveState?.ai_analysis]);

  const edgeAnalysisData = useMemo(() => {
    const fairTotal = liveState?.deterministic_signals?.deterministic_fair_total;
    const marketTotal = liveState?.deterministic_signals?.market_total;
    if (!Number.isFinite(fairTotal) || !Number.isFinite(marketTotal)) return undefined;
    const diff = Number(fairTotal) - Number(marketTotal);
    return {
      type: 'TOTAL' as const,
      impliedLine: Number(marketTotal),
      modelLine: Number(fairTotal),
      edgePoints: Math.abs(diff),
      edgeDirection: diff >= 0 ? 'OVER' as const : 'UNDER' as const,
      confidence: Math.max(0.5, Math.min(0.95, edgeState?.confidence || 0.62)),
      implications: [
        `Model fair total ${Number(fairTotal).toFixed(1)} vs market ${Number(marketTotal).toFixed(1)}`,
        `Directional edge: ${diff >= 0 ? 'OVER' : 'UNDER'} ${Math.abs(diff).toFixed(1)} points`,
      ],
      keyInjuries: [],
      trace: {
        pace: 100,
        efficiency: Number(marketTotal) === 0 ? 0 : Number(fairTotal) / Number(marketTotal),
        possessions: 98,
      },
      edgePercent: Number(marketTotal) === 0 ? 0 : Math.abs((diff / Number(marketTotal)) * 100),
    };
  }, [liveState, edgeState]);

  const dbGameContext = useMemo(() => {
    const lines = [
      formatTeamContextLine(awayAbbr, teamContextSnapshot?.away),
      formatTeamContextLine(homeAbbr, teamContextSnapshot?.home),
    ].filter((line): line is string => Boolean(line));
    return lines.length ? lines.join(' | ') : undefined;
  }, [awayAbbr, homeAbbr, teamContextSnapshot]);

  const contextPillsData = useMemo(() => {
    const contextRecord = match.context || {};

    const venueRecord = asContextRecord(contextRecord.venue);
    const venueName = asContextString(venueRecord?.name);
    const venue = venueName
      ? {
          name: venueName,
          city: asContextString(venueRecord?.city) || '',
          state: asContextString(venueRecord?.state) || '',
        }
      : undefined;

    const weatherRecord = asContextRecord(contextRecord.weather);
    const weatherTemp = asContextText(weatherRecord?.temp) || asContextText(match.weather_info?.temp as ContextValue | undefined) || asContextText(match.weather_forecast?.temp as ContextValue | undefined);
    const weatherCondition = asContextString(weatherRecord?.condition)
      || (typeof match.weather_info?.condition === 'string' ? match.weather_info.condition : undefined)
      || (typeof match.weather_forecast?.condition === 'string' ? match.weather_forecast.condition : undefined);
    const weather = weatherTemp
      ? { temp: weatherTemp, condition: weatherCondition || '' }
      : undefined;

    const directBroadcast = asContextString(contextRecord.broadcast);
    const broadcasts = contextRecord.broadcasts;
    let broadcast = directBroadcast;
    if (!broadcast && Array.isArray(broadcasts)) {
      for (const item of broadcasts) {
        if (broadcast) break;
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const itemRecord = item as { [key: string]: ContextValue };
        if (Array.isArray(itemRecord.names)) {
          const names = (itemRecord.names as ContextValue[])
            .map((name) => asContextString(name))
            .filter((name): name is string => Boolean(name));
          if (names.length) broadcast = names[0];
        }
        if (!broadcast) broadcast = asContextString(itemRecord.market) || undefined;
      }
    }

    const gameContext = asContextString(contextRecord.gameContext) || dbGameContext;
    return { venue, weather, broadcast, gameContext };
  }, [dbGameContext, match.context, match.weather_info, match.weather_forecast]);

  const hasContextPills = Boolean(
    contextPillsData.venue
    || contextPillsData.weather
    || contextPillsData.broadcast
    || contextPillsData.gameContext
  );

  const hasIntelSnapshot = Boolean(pregameIntel || teamContextSnapshot);
  const marketResultSectionLabel = hasIntelSnapshot ? '04 // MARKET RESULT' : '03 // MARKET RESULT';
  const goalieSectionLabel = hasIntelSnapshot ? '05 // GOALIES' : '04 // GOALIES';

  // ─── Fallback & Guards ────────────────────────────────────────────────
  const fallbackLiveState: LiveState | undefined = match.lastPlay
    ? { lastPlay: { text: match.lastPlay.text, type: { text: match.lastPlay.type } } }
    : undefined;

  const hasRosters = Boolean(match.rosters?.home?.length || match.rosters?.away?.length);

  if (!match?.homeTeam) return <MatchupLoader className="h-screen" label="Synchronizing Hub" />;


  // ════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div className="relative min-h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#F7F8FA] pb-[calc(env(safe-area-inset-bottom)+6rem)] font-sans text-[#0A0A0A] selection:bg-black selection:text-white">
      <div className="relative isolate">

        <header className="sticky top-0 z-50 border-b border-black/[0.05] bg-[#F7F8FA] pt-safe transition-colors duration-500">
          <div className="mx-auto flex max-w-[960px] items-center justify-between px-4 py-4">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to matches"
              className="group flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 hover:bg-black/5"
            >
              <BackArrow />
            </button>
            <div className="flex items-center gap-4">
              <span className="mt-[1px] hidden text-[10px] font-bold uppercase tracking-[0.25em] text-black/40 md:block">
                {String(match.leagueId || '').replaceAll('.', ' ').toUpperCase()}
              </span>
              <ConnectionBadge status={connectionStatus} />
            </div>
          </div>

          {error && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} className="overflow-hidden px-4 pb-2">
              <div className="rounded-[6px] border border-red-200 bg-red-50 px-3 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-red-600 shadow-[0_0_10px_rgba(239,68,68,0.1)]">
                Telemetry Link Offline
              </div>
            </motion.div>
          )}

          <SwipeableHeader enabled={swipeEnabled} onSwipe={handleSwipe} matchId={match.id}>
            <div className="relative">
              {isLive && (
                <span className={cn(
                  'absolute right-0 top-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
                  TYPE.label,
                  `border border-[#00C896]/30 bg-[#00C896]/10 text-[#00C896]`,
                )}>
                  <span className="h-1.5 w-1.5 rounded-full bg-[#00C896] animate-[pulse_2s_infinite]" />
                  LIVE
                </span>
              )}

              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="flex items-center gap-3">
                  <TeamLogo logo={match.awayTeam.logo} name={match.awayTeam.name} abbreviation={awayAbbr} sport={String(match.sport)} color={awayColor} className="h-12 w-12" />
                  <div className="min-w-0">
                    <p className={cn('truncate text-[14px] font-medium', `text-[#0A0A0A]`)}>{match.awayTeam.shortName || match.awayTeam.name}</p>
                    <p className={cn(TYPE.numericSm, `text-[#A3A3A3]`)}>{awayRecord}</p>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center">
                  {!isGameScheduled(match.status) && (
                    <div className="flex items-end gap-3">
                      <span className={cn(TYPE.score, awayWinner || !scoreClock.isFinal ? `font-bold text-[#0A0A0A]` : `font-semibold text-[#A3A3A3]`)}>{match.awayScore}</span>
                      <span className={cn(NUMERIC, `pb-1 text-[26px] text-[#A3A3A3]`)}>—</span>
                      <span className={cn(TYPE.score, homeWinner || !scoreClock.isFinal ? `font-bold text-[#0A0A0A]` : `font-semibold text-[#A3A3A3]`)}>{match.homeScore}</span>
                    </div>
                  )}
                  <div className={cn(
                    'mt-1 rounded-full border px-3 py-0.5',
                    `border-[#D4D4D4] bg-white`,
                  )}>
                    <span className={cn(TYPE.numericSm, `inline-flex items-center gap-1 text-[#737373]`)}>
                      {scoreClock.isLive && <span className="h-1.5 w-1.5 rounded-full bg-[#00C896] animate-[pulse_2s_infinite]" />}
                      {scoreClock.isFinal ? scoreClock.finalLabel : scoreClock.primary}
                    </span>
                  </div>
                  {scoreClock.secondary && <p className={cn(TYPE.numericXs, `mt-1 text-[#A3A3A3]`)}>{scoreClock.secondary}</p>}
                  {spreadTotalLine && <p className={cn(TYPE.numericXs, `mt-1 text-[#737373]`)}>{spreadTotalLine}</p>}
                </div>

                <div className="flex items-center justify-end gap-3">
                  <div className="min-w-0 text-right">
                    <p className={cn('truncate text-[14px] font-medium', `text-[#0A0A0A]`)}>{match.homeTeam.shortName || match.homeTeam.name}</p>
                    <p className={cn(TYPE.numericSm, `text-[#A3A3A3]`)}>{homeRecord}</p>
                  </div>
                  <TeamLogo logo={match.homeTeam.logo} name={match.homeTeam.name} abbreviation={homeAbbr} sport={String(match.sport)} color={homeColor} className="h-12 w-12" />
                </div>
              </div>

              <div className="pt-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className={cn(TYPE.numericXs, `font-medium text-[#737373]`)}>{awayAbbr} {winProbability.away}%</span>
                  <span className={cn(TYPE.numericXs, `font-medium text-[#737373]`)}>{winProbability.home}% {homeAbbr}</span>
                </div>
                <div className={cn(
                  'h-2 w-full overflow-hidden rounded-full',
                  `border border-[#D4D4D4] bg-[#F5F5F5]`,
                )}>
                  <div className="flex h-full w-full">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${winProbability.away}%` }} transition={SPRING.bar} style={{ background: `linear-gradient(90deg, ${awayColor}, ${awayColor}CC)` }} />
                    <motion.div initial={{ width: 0 }} animate={{ width: `${winProbability.home}%` }} transition={SPRING.bar} style={{ background: `linear-gradient(90deg, ${homeColor}CC, ${homeColor})` }} />
                  </div>
                </div>
              </div>
            </div>
          </SwipeableHeader>

          <div className="relative mt-0.5 w-full shrink-0 overflow-hidden" role="tablist" aria-label="Match detail tabs">
            <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-6 bg-gradient-to-r from-[#F7F8FA] to-transparent" />
            <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-6 bg-gradient-to-l from-[#F7F8FA] to-transparent" />
            <LayoutGroup>
              <nav className="relative flex h-[40px] max-w-full items-center gap-6 overflow-x-auto px-6 no-scrollbar">
                {TABS.map((tab, i) => (
                  <button
                    key={tab.id}
                    type="button"
                    id={tabButtonId(tab.id)}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    aria-controls={tabPanelId(tab.id)}
                    onClick={() => handleTabSelect(tab.id)}
                    className={cn(
                      'relative flex h-full shrink-0 items-center whitespace-nowrap text-[11.5px] font-semibold uppercase tracking-[0.2em] transition-all duration-300 outline-none',
                      `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4D4D4]`,
                      activeTab === tab.id ? 'text-black' : 'text-black/40 hover:text-black/60',
                      i === TABS.length - 1 && 'pr-6',
                    )}
                  >
                    {tab.label}
                    {activeTab === tab.id && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-[2px] bg-black"
                        transition={prefersReduced ? SPRING.reduced : SPRING.tab}
                      />
                    )}
                  </button>
                ))}
              </nav>
            </LayoutGroup>
            <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-black/[0.04]" />
          </div>
        </header>

        {/* ── Main Content ───────────────────────────────────────────── */}
        <main className="relative z-[1] mx-auto min-h-screen max-w-[960px] px-4 pb-safe-offset-24 pt-3">
          {/* ────────────────── SUMMARY TAB ────────────────── */}
          <section id={tabPanelId('SUMMARY')} role="tabpanel" aria-labelledby={tabButtonId('SUMMARY')} hidden={activeTab !== 'SUMMARY'} className="space-y-5">
            <SpecSheetRow label="01 // SUMMARY" defaultOpen collapsible={false}>
              {isBaseball
                ? <BaseballGamePanel match={match} baseballData={baseballData} />
                : <CinematicGameTracker match={match} liveState={liveState || fallbackLiveState} />
              }
            </SpecSheetRow>

            <SpecSheetRow label="02 // SNAPSHOT" defaultOpen>
              <div className="space-y-6">
                <LineScoreGrid match={match} isLive={!isGameFinal(match.status)} />
                <div className={`h-px w-full bg-[#E5E5E5]`} />
                {isInitialLoad ? <StatsGridSkeleton /> : <TeamStatsGrid stats={displayStats} match={match} colors={{ home: homeColor, away: awayColor }} />}
              </div>
            </SpecSheetRow>

            {hasIntelSnapshot && (
              <SpecSheetRow label="03 // INTELLIGENCE" defaultOpen={isSched}>
                <IntelligenceSnapshotCard
                  intel={pregameIntel}
                  teamContext={teamContextSnapshot}
                  homeAbbr={homeAbbr}
                  awayAbbr={awayAbbr}
                />
              </SpecSheetRow>
            )}

            {isGameFinal(match.status) && finalBettingRows.length > 0 && (
              <SpecSheetRow label={marketResultSectionLabel} defaultOpen collapsible={false}>
                <BettingRowsTable rows={finalBettingRows} compact />
              </SpecSheetRow>
            )}

            {coreSport === 'HOCKEY' && (
              <SpecSheetRow label={goalieSectionLabel} defaultOpen>
                <GoalieMatchup matchId={match.id} homeTeam={match.homeTeam} awayTeam={match.awayTeam} />
              </SpecSheetRow>
            )}
          </section>

          {/* ────────────────── STATS TAB ────────────────── */}
          <section id={tabPanelId('STATS')} role="tabpanel" aria-labelledby={tabButtonId('STATS')} hidden={activeTab !== 'STATS'} className="space-y-4">
            <Surface className="p-4">
              {(['Attack', 'Defense', 'Discipline'] as StatSection[]).map((section, idx) => (
                <div key={section} className={cn(idx !== 0 && `pt-4 border-t border-[#E5E5E5]`)}>
                  <p className={cn(TYPE.meta, `mb-2 uppercase text-[#737373]`)}>{section}</p>
                  {(groupedStats[section] || []).length === 0 ? (
                    <p className={cn(TYPE.body, `py-2 text-[#A3A3A3]`)}>No {section.toLowerCase()} stats available.</p>
                  ) : (
                    (groupedStats[section] || []).map(row => (
                      <ComparisonStatRow key={`${section}-${row.label}`} label={row.label} awayDisplay={row.awayDisplay} homeDisplay={row.homeDisplay} awayValue={row.awayValue} homeValue={row.homeValue} awayColor={awayColor} homeColor={homeColor} />
                    ))
                  )}
                </div>
              ))}
            </Surface>
          </section>

          {/* ────────────────── LINEUPS / BOX SCORE TAB ────────────────── */}
          <section
            id={tabPanelId(isSoccer ? 'LINEUPS' : 'BOX_SCORE')}
            role="tabpanel"
            aria-labelledby={tabButtonId(isSoccer ? 'LINEUPS' : 'BOX_SCORE')}
            hidden={activeTab !== (isSoccer ? 'LINEUPS' : 'BOX_SCORE')}
            className="space-y-5"
          >
            {isSoccer && (
              <Surface className="p-4">
                <p className={cn(TYPE.meta, `mb-3 font-semibold uppercase text-[#737373]`)}>Lineups</p>
                {!hasRosters ? (
                  <p className={cn(TYPE.body, `text-[#A3A3A3]`)}>Lineups are not published yet.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    {[{ team: match.awayTeam, roster: match.rosters?.away }, { team: match.homeTeam, roster: match.rosters?.home }].map(({ team, roster }) => (
                      <div key={team.id || team.name}>
                        <p className={cn(TYPE.body, `mb-2 font-medium text-[#0A0A0A]`)}>{team.name}</p>
                        <div className="space-y-1">
                          {(roster || []).slice(0, 22).map((player, idx) => (
                            <div key={`${player.id || player.name}-${idx}`} className={cn(
                              'flex items-center justify-between rounded-lg border px-2 py-1.5',
                              `border-[#E5E5E5]`,
                            )}>
                              <span className={cn(TYPE.body, `text-[#0A0A0A]`)}>{player.displayName || player.name || `Player ${idx + 1}`}</span>
                              <span className={cn(TYPE.numericXs, `text-[#A3A3A3]`)}>{typeof player.position === 'string' ? player.position : player.position?.abbreviation || '-'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Surface>
            )}

            <SpecSheetRow label="01 // BOX SCORE" defaultOpen>
              <BoxScore match={match} />
            </SpecSheetRow>

            <div className="flex justify-end pr-1">
              <button
                type="button"
                onClick={() => setPropView(v => v === 'classic' ? 'cinematic' : 'classic')}
                aria-label={`Switch to ${nextPropLabel}`}
                className={cn(
                  'rounded-full border px-3 py-1.5 transition-colors',
                  TYPE.label,
                  `border-[#E5E5E5] text-[#737373]`,
                  `hover:bg-[#F5F5F5]`,
                  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4D4D4]`,
                )}
              >
                Switch to {nextPropLabel}
              </button>
            </div>
            <Surface className="p-2">
              {propView === 'classic' ? <ClassicPlayerProps match={match} /> : <CinematicPlayerProps match={match} />}
            </Surface>
          </section>

          {/* ────────────────── AI TAB ────────────────── */}
          <section id={tabPanelId('AI')} role="tabpanel" aria-labelledby={tabButtonId('AI')} hidden={activeTab !== 'AI'} className="space-y-5">
            <Surface className="p-2">
              <SafePregameIntelCards match={match} />
            </Surface>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
              <Surface className="min-h-[680px] p-2">
                <ChatWidget currentMatch={match} inline />
              </Surface>

              <aside className="space-y-4">
                {/* AI Context */}
                <Surface className="p-4">
                  <SectionLabel>AI CONTEXT</SectionLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    {aiContextBadges.map((badge, idx) => {
                      const isLiveBadge = idx === 0 && badge === 'LIVE';
                      const isFinalBadge = idx === 0 && badge.startsWith('FINAL');
                      return (
                        <span key={`${badge}-${idx}`} className={cn(
                          NUMERIC, 'rounded-full border px-2.5 py-1 text-[11px]',
                          isLiveBadge   && `border-[#00C896]/40 bg-[#00C896]/10 text-[#00C896]`,
                          isFinalBadge  && `border-[#D4D4D4] bg-[#F5F5F5] text-[#737373]`,
                          !isLiveBadge && !isFinalBadge && `border-[#E5E5E5] bg-[#FAFAFA] text-[#737373]`,
                        )}>
                          {isLiveBadge && <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#00C896] align-middle animate-[pulse_2s_infinite]`} />}
                          {badge}
                        </span>
                      );
                    })}
                  </div>
                </Surface>

                {/* Live Intelligence */}
                <Surface className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionLabel>LIVE INTELLIGENCE</SectionLabel>
                    {edgeState && <EdgeStateBadge edgeState={edgeState} />}
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <div className={cn('rounded-xl border p-3', `border-[#E5E5E5] bg-[#FAFAFA]`)}>
                      <p className={cn(TYPE.label, `mb-2 text-[#737373]`)}>Drivers</p>
                      <div className="space-y-1.5">
                        {aiDrivers.map((item, idx) => (
                          <p key={`driver-${idx}`} className={cn(TYPE.body, `text-[#0A0A0A]`)}>{item}</p>
                        ))}
                      </div>
                    </div>
                    <div className={cn('rounded-xl border p-3', `border-[#E5E5E5] bg-[#FAFAFA]`)}>
                      <p className={cn(TYPE.label, `mb-2 text-[#737373]`)}>Watchouts</p>
                      <div className="space-y-1.5">
                        {aiWatchouts.map((item, idx) => (
                          <p key={`watch-${idx}`} className={cn(TYPE.body, `text-[#737373]`)}>{item}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                  {forecastHistory.length > 1 && (
                    <div className="mt-3 flex items-center justify-end">
                      <ForecastSparkline points={forecastHistory} />
                    </div>
                  )}
                </Surface>

                {(gameEdgeCardData || insightCardData) && (
                  <div className="space-y-4">
                    {gameEdgeCardData && <InsightCard data={gameEdgeCardData} />}
                    {insightCardData && <InsightCard data={insightCardData} />}
                  </div>
                )}

                {edgeAnalysisData && (
                  <Surface>
                    <EdgeAnalysisCard data={edgeAnalysisData} sport={match.sport} />
                  </Surface>
                )}

                {liveState?.ai_analysis && (
                  <Surface className="p-2">
                    <LiveAIInsight match={match} />
                  </Surface>
                )}

                {isBaseball && baseballData?.edge && (
                  <Surface className="p-4">
                    <BaseballEdgePanel edge={baseballData.edge} />
                  </Surface>
                )}

                {/* Forecast */}
                <Surface className="p-4">
                  <SectionLabel>Forecast</SectionLabel>
                  <ForecastHistoryTable matchId={match.id} />
                </Surface>

                {/* Market Watch */}
                <Surface className="p-4">
                  <SectionLabel>Market Watch</SectionLabel>
                  {hasMarketLines ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <MetricCard label="Spread" value={currentSpread !== undefined ? `${homeAbbr} ${formatSigned(currentSpread)}` : 'N/A'} />
                      <MetricCard label="Total" value={currentTotal !== undefined ? `O/U ${currentTotal}` : 'N/A'} />
                      <MetricCard label="Moneyline" value={currentMlDisplay} />
                    </div>
                  ) : (
                    <div className={cn(
                      'rounded-xl border p-5 text-center',
                      `border-[#E5E5E5] bg-[#FAFAFA]`,
                    )}>
                      <p className={cn(TYPE.heading, `text-[#0A0A0A]`)}>Lines Not Yet Posted</p>
                      <p className={cn(TYPE.label, `mt-1 text-[#A3A3A3]`)}>MONITORING MARKET</p>
                    </div>
                  )}
                </Surface>
              </aside>
            </div>
          </section>

          {/* ────────────────── ODDS TAB ────────────────── */}
          <section id={tabPanelId('ODDS')} role="tabpanel" aria-labelledby={tabButtonId('ODDS')} hidden={activeTab !== 'ODDS'} className="space-y-5">
            {isGameFinal(match.status) && finalBettingRows.length > 0 ? (
              <BettingRowsTable rows={finalBettingRows} />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <MetricCard label="Spread" value={currentSpread !== undefined ? `${homeAbbr} ${formatSigned(currentSpread)}` : 'N/A'} className="bg-white" />
                <MetricCard label="Total" value={currentTotal !== undefined ? `O/U ${currentTotal}` : 'N/A'} className="bg-white" />
                <MetricCard label="Moneyline" value={currentMlDisplay} className="bg-white" />
              </div>
            )}

            <SpecSheetRow label="01 // MARKETS" defaultOpen>
              {isInitialLoad ? <OddsCardSkeleton /> : <OddsCard match={match} />}
            </SpecSheetRow>

            {isSched && (
              <SpecSheetRow label="02 // TRAJECTORY" defaultOpen={false}>
                <RecentForm homeTeam={match.homeTeam} awayTeam={match.awayTeam} homeName={match.homeTeam.name} awayName={match.awayTeam.name} homeColor={homeColor} awayColor={awayColor} />
              </SpecSheetRow>
            )}

            <SpecSheetRow label="03 // CONTEXT" defaultOpen>
              {hasContextPills ? (
                <MatchupContextPills
                  venue={contextPillsData.venue}
                  weather={contextPillsData.weather || null}
                  broadcast={contextPillsData.broadcast}
                  gameContext={contextPillsData.gameContext}
                  sport={match.sport}
                />
              ) : (
                <div className={cn(TYPE.body, `text-[#A3A3A3] italic`)}>
                  {pregameIntel?.headline || 'No context available.'}
                </div>
              )}
            </SpecSheetRow>
          </section>
        </main>

        <TechnicalDebugView match={match} />
      </div>
    </div>
  );
};

export default memo(MatchDetails);
