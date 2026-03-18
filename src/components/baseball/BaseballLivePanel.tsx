// ============================================================================
// src/components/baseball/BaseballLivePanel.tsx
//
// THE DRIP — BASEBALL LIVE INTELLIGENCE PANEL
// Embeds inside MatchDetails' existing tab/SpecSheetRow layout.
// Consumes shared Match + baseball-specific BaseballLiveData.
//
// EXPORTS:
//   BaseballGamePanel  — At-bat view for OVERVIEW tab
//   BaseballEdgePanel  — Edge convergence for DATA tab
//   BaseballLineScore  — Inning-by-inning for OVERVIEW tab
//   BaseballScoringSummary — Scoring plays for PLAYS/OVERVIEW
//
// DESIGN: ESSENCE v10.0 tokens, Tailwind, Framer Motion, lucide-react
// ============================================================================

import React, { useState, useMemo, memo, type FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Thermometer,
  CircleDot,
  Flame,
  Clock,
  Tv,
  MapPin,
  BarChart3,
  Sun,
  AlertTriangle,
} from 'lucide-react';

import type { Match, MatchStatus, Team } from '@/types';
import { cn, ESSENCE } from '@/lib/essence';
import { Card } from '@/components/ui/Card';
import { StatusChip } from '@/components/ui/StatusChip';
import { EmptyState } from '@/components/ui/EmptyState';

import type {
  BaseballLiveData,
  BaseballPitcher,
  BaseballBatter,
  BaseballEdgeData,
  BaseballEdgeSignal,
  BaseballScoringPlay,
  PitchEvent,
  PitchResult,
  DueUpPlayer,
  InningHalf,
  ConvergenceTier,
} from './types';

import {
  computeConvergence,
  ordinalSuffix,
  formatInning,
  isStaleTs,
  relativeTime,
  ODDS_STALE_MS,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const PITCH_COUNT_THRESHOLD = 90;
const STANDARD_INNINGS = 9;

/** Pitch result → Tailwind color class mapping */
const PITCH_COLORS: Record<PitchResult, string> = {
  swinging_strike: 'bg-orange-500',
  called_strike: 'bg-orange-500',
  foul: 'bg-violet-500',
  ball: 'bg-blue-500',
  hit: 'bg-emerald-500',
  hit_by_pitch: 'bg-amber-500',
  in_play_out: 'bg-red-500',
};

/** Pitch result → SVG hex color for strike zone */
const PITCH_HEX: Record<PitchResult, string> = {
  swinging_strike: '#F97316',
  called_strike: '#F97316',
  foul: '#A855F7',
  ball: '#3B82F6',
  hit: ESSENCE.colors.accent.emerald,
  hit_by_pitch: ESSENCE.colors.accent.amber,
  in_play_out: '#EF4444',
};

/** Pitch result → human label */
const PITCH_LABELS: Record<PitchResult, string> = {
  swinging_strike: 'Swinging Strike',
  called_strike: 'Called Strike',
  foul: 'Foul',
  ball: 'Ball',
  hit: 'In Play',
  hit_by_pitch: 'Hit By Pitch',
  in_play_out: 'In Play (Out)',
};

/** Edge signal → color tokens */
const EDGE_COLORS: Record<'high' | 'med' | 'low', { text: string; bg: string; dot: string }> = {
  high: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', dot: 'bg-emerald-500' },
  med: { text: 'text-amber-400', bg: 'bg-amber-500/10', dot: 'bg-amber-500' },
  low: { text: 'text-red-400', bg: 'bg-red-500/10', dot: 'bg-red-500' },
};

const CONVERGENCE_COLORS: Record<ConvergenceTier, { text: string; bg: string; border: string }> = {
  STRONG: { text: 'text-emerald-400', bg: 'bg-emerald-500/5', border: 'border-emerald-500/15' },
  MODERATE: { text: 'text-amber-400', bg: 'bg-amber-500/5', border: 'border-amber-500/15' },
  WEAK: { text: 'text-slate-400', bg: 'bg-zinc-500/5', border: 'border-zinc-500/15' },
};

const CONVERGENCE_COPY: Record<ConvergenceTier, string> = {
  STRONG: 'Three edge signals align. Live Over or opposing ML has elevated expected value.',
  MODERATE: 'Partial convergence detected. Monitor pitch count threshold for live entry.',
  WEAK: 'Signals inconclusive. Standard risk framework applies.',
};

const HITS_MATCHERS = [/^h$/, /hit/];
const ERRORS_MATCHERS = [/^e$/, /error/];

function toStatCell(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const numeric = trimmed.match(/-?\d+(\.\d+)?/);
    return numeric ? String(Number(numeric[0])) : trimmed;
  }
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const parsed = toStatCell(entry);
      if (parsed !== null) return parsed;
    }
    return null;
  }
  if (typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    return toStatCell(rec.value ?? rec.displayValue ?? rec.stat ?? rec.total ?? null);
  }
  return null;
}

function statKeyMatches(key: string, patterns: RegExp[]): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return patterns.some((pattern) => pattern.test(normalized));
}

function readFromTeamStats(stats: unknown, patterns: RegExp[]): string | null {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null;
  const rec = stats as Record<string, unknown>;

  for (const [key, value] of Object.entries(rec)) {
    if (statKeyMatches(key, patterns)) {
      const direct = toStatCell(value);
      if (direct !== null) return direct;
    }

    if (Array.isArray(value)) {
      for (const line of value) {
        if (!line || typeof line !== 'object') continue;
        const lineRec = line as Record<string, unknown>;
        const label = String(lineRec.label ?? lineRec.name ?? '').toLowerCase();
        if (!statKeyMatches(label, patterns)) continue;
        const parsed = toStatCell(lineRec.value ?? lineRec.displayValue ?? null);
        if (parsed !== null) return parsed;
      }
    }
  }

  return null;
}

function readFromMatchStats(stats: Match['stats'] | undefined, isAway: boolean, patterns: RegExp[]): string | null {
  if (!Array.isArray(stats)) return null;
  for (const item of stats) {
    const label = String(item.label ?? '').toLowerCase();
    if (!statKeyMatches(label, patterns)) continue;
    const parsed = toStatCell(isAway ? item.awayValue : item.homeValue);
    if (parsed !== null) return parsed;
  }
  return null;
}

function getTeamHitsErrors(match: Match, isAway: boolean): { hits: string; errors: string } {
  const sideStats = isAway ? match.awayTeamStats : match.homeTeamStats;
  const hits =
    readFromTeamStats(sideStats, HITS_MATCHERS) ??
    readFromMatchStats(match.stats, isAway, HITS_MATCHERS) ??
    '—';
  const errors =
    readFromTeamStats(sideStats, ERRORS_MATCHERS) ??
    readFromMatchStats(match.stats, isAway, ERRORS_MATCHERS) ??
    '—';

  return { hits, errors };
}

// ============================================================================
// MOTION (respect prefers-reduced-motion via Framer's built-in support)
// ============================================================================

const FADE_IN = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: ESSENCE.transition.instant,
};

// ============================================================================
// § DIAMOND SVG
// ============================================================================

interface DiamondProps {
  onFirst?: boolean;
  onSecond?: boolean;
  onThird?: boolean;
  size?: number;
  className?: string;
}

const Diamond: FC<DiamondProps> = memo(({ onFirst, onSecond, onThird, size = 56, className }) => {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const bs = Math.max(4, size * 0.1);

  const pts = {
    home: { x: cx, y: cy + r },
    first: { x: cx + r, y: cy },
    second: { x: cx, y: cy - r },
    third: { x: cx - r, y: cy },
  };

  const bases: Array<{ key: string; label: string; x: number; y: number; on: boolean }> = [
    { key: 'first', label: '1B', x: pts.first.x, y: pts.first.y, on: !!onFirst },
    { key: 'second', label: '2B', x: pts.second.x, y: pts.second.y, on: !!onSecond },
    { key: 'third', label: '3B', x: pts.third.x, y: pts.third.y, on: !!onThird },
  ];

  const label = [
    onFirst && 'runner on first',
    onSecond && 'runner on second',
    onThird && 'runner on third',
  ].filter(Boolean).join(', ') || 'bases empty';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Diamond: ${label}`}
      className={className}
    >
      {/* Diamond outline */}
      <path
        d={`M${pts.home.x} ${pts.home.y}L${pts.first.x} ${pts.first.y}L${pts.second.x} ${pts.second.y}L${pts.third.x} ${pts.third.y}Z`}
        fill="rgba(248,250,252,0.86)"
        stroke={ESSENCE.colors.border.default}
        strokeWidth="0.8"
      />
      <circle
        cx={cx}
        cy={cy}
        r={Math.max(3, size * 0.065)}
        fill="rgba(148,163,184,0.18)"
        stroke={ESSENCE.colors.border.subtle}
        strokeWidth="0.5"
      />
      {/* Home plate */}
      <rect
        x={pts.home.x - 3}
        y={pts.home.y - 3}
        width={6}
        height={6}
        rx={0.8}
        fill={ESSENCE.colors.border.strong}
        transform={`rotate(45 ${pts.home.x} ${pts.home.y})`}
      />
      {/* Bases */}
      {bases.map((b) => (
        <g key={b.key}>
          {b.on && (
            <circle cx={b.x} cy={b.y} r={Math.max(6, size * 0.11)} fill={`${ESSENCE.colors.accent.emerald}33`}>
              <animate attributeName="opacity" values="0.5;0.18;0.5" dur="1.8s" repeatCount="indefinite" />
            </circle>
          )}
          <rect
            x={b.x - bs / 2}
            y={b.y - bs / 2}
            width={bs}
            height={bs}
            rx={0.8}
            fill={b.on ? ESSENCE.colors.accent.emerald : 'rgba(255,255,255,0.06)'}
            stroke={b.on ? 'none' : ESSENCE.colors.border.default}
            strokeWidth={0.5}
            transform={`rotate(45 ${b.x} ${b.y})`}
            style={{
              filter: b.on ? `drop-shadow(0 0 6px ${ESSENCE.colors.accent.emerald}55)` : 'none',
              transition: 'all 0.3s ease',
            }}
          />
          <text
            x={b.x}
            y={b.y + Math.max(12, size * 0.24)}
            textAnchor="middle"
            className="font-mono text-[6px] tracking-wide"
            fill="rgba(15,23,42,0.65)"
          >
            {b.label}
          </text>
        </g>
      ))}
    </svg>
  );
});
Diamond.displayName = 'Diamond';

// ============================================================================
// § BSO COUNT
// ============================================================================

interface BSOProps {
  balls: number;
  strikes: number;
  outs: number;
  className?: string;
}

const BSORow: FC<{ label: string; count: number; max: number; colorClass: string; aria: string }> = memo(
  ({ label, count, max, colorClass, aria }) => (
    <div className="flex items-center gap-1.5" role="group" aria-label={aria}>
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <div className="flex gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'w-2 h-2 rounded-full transition-all duration-200',
              i < count ? colorClass : 'bg-slate-200 border border-slate-300',
            )}
            style={i < count ? { boxShadow: `0 0 4px currentColor` } : undefined}
          />
        ))}
      </div>
    </div>
  ),
);
BSORow.displayName = 'BSORow';

const BSO: FC<BSOProps> = memo(({ balls, strikes, outs, className }) => (
  <div
    className={cn('flex gap-4 rounded-xl border border-slate-300 bg-slate-50/70 px-3 py-2.5', className)}
    aria-label={`Count: ${balls} balls, ${strikes} strikes, ${outs} outs`}
  >
    <BSORow label="B" count={balls} max={4} colorClass="bg-blue-500" aria={`${balls} balls`} />
    <BSORow label="S" count={strikes} max={3} colorClass="bg-orange-500" aria={`${strikes} strikes`} />
    <BSORow label="O" count={outs} max={3} colorClass="bg-red-500" aria={`${outs} outs`} />
  </div>
));
BSO.displayName = 'BSO';

// ============================================================================
// § STRIKE ZONE
// ============================================================================

interface StrikeZoneProps {
  pitches: PitchEvent[];
  className?: string;
}

const StrikeZone: FC<StrikeZoneProps> = memo(({ pitches, className }) => {
  const zoneSize = 110;
  const pad = 28;
  const total = zoneSize + pad * 2;

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg
        width={total}
        height={total + 10}
        viewBox={`0 0 ${total} ${total + 10}`}
        role="img"
        aria-label="Strike zone with pitch locations"
      >
        {/* Zone box */}
        <rect x={pad} y={pad} width={zoneSize} height={zoneSize} fill="none" stroke={ESSENCE.colors.border.default} strokeWidth="0.8" />
        {/* 3×3 grid */}
        {[1, 2].map((n) => (
          <g key={n}>
            <line x1={pad + (zoneSize / 3) * n} y1={pad} x2={pad + (zoneSize / 3) * n} y2={pad + zoneSize} stroke={ESSENCE.colors.border.subtle} strokeWidth="0.5" />
            <line x1={pad} y1={pad + (zoneSize / 3) * n} x2={pad + zoneSize} y2={pad + (zoneSize / 3) * n} stroke={ESSENCE.colors.border.subtle} strokeWidth="0.5" />
          </g>
        ))}
        {/* Pitch markers */}
        {pitches.map((p, i) => {
          const px = pad + (p.x / 100) * zoneSize;
          const py = pad + (p.y / 100) * zoneSize;
          const col = PITCH_HEX[p.result] || ESSENCE.colors.text.tertiary;
          const isLast = i === 0;

          return (
            <g key={`pitch-${p.seq}-${i}`}>
              {/* Last pitch animated ring */}
              {isLast && (
                <circle cx={px} cy={py} r={13} fill="none" stroke={col} strokeWidth="1" opacity={0.4} strokeDasharray="2 2">
                  <animate attributeName="r" values="12;15;12" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0.15;0.4" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={px} cy={py} r={10} fill={col} opacity={0.18} />
              <circle cx={px} cy={py} r={7} fill={col} opacity={0.85} style={{ filter: `drop-shadow(0 0 3px ${col}40)` }} />
              {/* Sequence number */}
              <text
                x={px}
                y={py + 3.5}
                textAnchor="middle"
                fill="#fff"
                className="font-mono text-[8px] font-bold"
              >
                {pitches.length - i}
              </text>
              {/* LAST label */}
              {isLast && (
                <text
                  x={px}
                  y={py - 12}
                  textAnchor="middle"
                  fill={col}
                  className="font-mono text-[6px] font-bold tracking-widest"
                >
                  LAST
                </text>
              )}
            </g>
          );
        })}
        {/* Home plate */}
        <path
          d={`M${total / 2 - 12} ${pad + zoneSize + 6} L${total / 2} ${pad + zoneSize + 14} L${total / 2 + 12} ${pad + zoneSize + 6}`}
          fill="none"
          stroke={ESSENCE.colors.border.strong}
          strokeWidth="1"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
});
StrikeZone.displayName = 'StrikeZone';

// ============================================================================
// § PITCH LOG
// ============================================================================

interface PitchLogProps {
  pitches: PitchEvent[];
}

const PitchLog: FC<PitchLogProps> = memo(({ pitches }) => {
  if (pitches.length === 0) {
    return <EmptyState message="No pitch tracking available" />;
  }

  return (
    <div className="flex flex-col">
      {pitches.map((p, i) => (
        <div
          key={`log-${p.seq}-${i}`}
          className={cn(
            'grid grid-cols-[24px_1fr_1fr_50px] items-center py-2',
            i < pitches.length - 1 && 'border-b border-slate-200',
          )}
        >
          <div
            className={cn(
              'w-[18px] h-[18px] rounded-full flex items-center justify-center',
              'font-mono text-[8px] font-extrabold text-slate-900',
              PITCH_COLORS[p.result],
            )}
          >
            {pitches.length - i}
          </div>
          <span className="text-xs font-medium text-slate-900">
            {PITCH_LABELS[p.result] || p.result}
          </span>
          <span className="text-xs text-slate-400">{p.type}</span>
          <span className={cn(ESSENCE.type.dataSm, 'text-right')}>
            {p.mph}mph
          </span>
        </div>
      ))}
    </div>
  );
});
PitchLog.displayName = 'PitchLog';

// ============================================================================
// § PITCHER / BATTER MATCHUP
// ============================================================================

interface MatchupProps {
  pitcher: BaseballPitcher;
  batter: BaseballBatter;
  awayColor: string;
  homeColor: string;
  status: MatchStatus | string;
}

const PlayerAvatar: FC<{ initials: string; color: string }> = memo(({ initials, color }) => (
  <div
    className="w-[46px] h-[46px] rounded-xl flex items-center justify-center font-mono text-[13px] font-black"
    style={{
      background: `linear-gradient(135deg, ${color}2E, ${color}12)`,
      border: `1px solid ${color}38`,
      color,
    }}
  >
    {initials}
  </div>
));
PlayerAvatar.displayName = 'PlayerAvatar';

const Matchup: FC<MatchupProps> = memo(({ pitcher, batter, awayColor, homeColor, status }) => {
  if (status === 'FINISHED' || status === 'SCHEDULED') return null;

  const pcHot = pitcher.pitchCount > PITCH_COUNT_THRESHOLD;

  return (
    <Card className="flex items-center justify-between p-3! bg-[linear-gradient(180deg,#FFFFFF_0%,#F7FAFF_100%)] border border-[#D8E2F1] shadow-[0_12px_24px_-22px_rgba(16,34,58,0.52)]">
      {/* Pitcher */}
      <div className="flex items-center gap-2.5">
        <PlayerAvatar initials={pitcher.initials} color={awayColor} />
        <div>
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">PITCHING</span>
          <div className="mt-0.5 text-[13px] font-semibold text-slate-900">{pitcher.name}</div>
          <div className="mt-0.5 font-mono text-[10px] font-semibold text-slate-700">
            {pitcher.ip} IP, {pitcher.pitchCount}PC
          </div>
          <div className="font-mono text-[10px] text-slate-500">
            {pitcher.er}ER, {pitcher.k}K
          </div>
        </div>
      </div>

      {/* Pitch Count Badge */}
      <div
        className={cn(
          'flex flex-col items-center px-3 py-1.5 rounded-lg border',
          pcHot
            ? 'bg-orange-500/10 border-orange-500/20'
            : 'bg-slate-50 border-slate-200',
        )}
        aria-label={`Pitch count: ${pitcher.pitchCount}`}
      >
        <span className="font-mono text-[7px] font-semibold tracking-[0.12em] text-slate-500">P-CT</span>
        <span
          className={cn(
            'font-mono text-xl font-extrabold leading-none',
            pcHot ? 'text-orange-500' : 'text-slate-900',
          )}
        >
          {pitcher.pitchCount}
        </span>
      </div>

      {/* Batter */}
      <div className="flex items-center gap-2.5">
        <div className="text-right">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">AT BAT</span>
          <div className="mt-0.5 text-[13px] font-semibold text-slate-900">{batter.name}</div>
          <div className="mt-0.5 font-mono text-[10px] font-semibold text-slate-700">{batter.todayLine}</div>
        </div>
        <PlayerAvatar initials={batter.initials} color={homeColor} />
      </div>
    </Card>
  );
});
Matchup.displayName = 'Matchup';

// ============================================================================
// § DUE UP
// ============================================================================

interface DueUpProps {
  teamName: string;
  teamColor: string;
  players: DueUpPlayer[];
}

const DueUp: FC<DueUpProps> = memo(({ teamName, teamColor, players }) => {
  if (!players.length) return null;

  return (
    <Card className="p-3! bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFF_100%)] border border-[#D8E2F1] shadow-[0_10px_22px_-20px_rgba(16,34,58,0.45)]">
      <div className="flex items-center gap-1.5 mb-2.5">
        <div className="w-[3px] h-2.5 rounded-sm" style={{ background: teamColor }} />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{teamName} Due Up</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {players.slice(0, 2).map((p, i) => (
          <div
            key={`due-${i}`}
            className="p-2.5 rounded-lg bg-slate-50 border border-slate-200"
          >
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600">{i === 0 ? 'ON DECK' : 'IN THE HOLE'}</span>
            <div className="mt-1 text-[13px] font-semibold text-slate-900">{p.name}</div>
            <div className="mt-0.5 font-mono text-[10px] text-slate-600">
              {p.position} ({p.bats})
            </div>
            <div className="flex justify-between mt-1">
              <span className="font-mono text-[9px] text-slate-600 uppercase tracking-[0.12em]">Today</span>
              <span className="font-mono text-[10px] font-bold text-slate-900 tabular-nums">{p.todayLine}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
});
DueUp.displayName = 'DueUp';

// ============================================================================
// § LINE SCORE
// ============================================================================

export interface BaseballLineScoreProps {
  match: Match;
  currentInning?: number;
  inningHalf?: InningHalf;
}

export const BaseballLineScore: FC<BaseballLineScoreProps> = memo(({ match, currentInning, inningHalf }) => {
  const isFinal = match.status === 'FINISHED';
  const inning = currentInning ?? match.period ?? 1;
  const half = inningHalf ?? 'top';

  const away = match.awayTeam;
  const home = match.homeTeam;
  const awayScores = away.linescores ?? [];
  const homeScores = home.linescores ?? [];
  const awayBox = getTeamHitsErrors(match, true);
  const homeBox = getTeamHitsErrors(match, false);

  const innings = Math.max(STANDARD_INNINGS, awayScores.length, homeScores.length);

  // Grid: team-abbr | inn1..innN | spacer | R H E
  const cols = `38px repeat(${innings}, minmax(18px, 1fr)) 4px repeat(3, minmax(18px, 1fr))`;

  const HeaderCell: FC<{ label: string }> = ({ label }) => (
    <div className="text-center py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</div>
  );

  const ScoreCell: FC<{ val: string; active: boolean }> = ({ val, active }) => (
    <div
      className={cn(
        'font-mono text-[11px] tabular-nums text-center py-1.5 transition-all duration-300',
        active ? 'font-bold text-slate-900 border-b-2 border-orange-500' : val ? 'text-slate-600' : 'text-slate-400',
      )}
    >
      {val}
    </div>
  );

  const TeamRow: FC<{ team: Team; scores: Array<{ value?: number | string }>; isAway: boolean; hits: string; errors: string }> = ({
    team,
    scores,
    isAway,
    hits,
    errors,
  }) => (
    <div style={{ display: 'grid', gridTemplateColumns: cols }}>
      <div className="font-mono text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-900 py-1.5">
        {team.abbreviation || team.shortName}
      </div>
      {Array.from({ length: innings }).map((_, i) => {
        const active =
          !isFinal &&
          i + 1 === inning &&
          ((isAway && half === 'top') || (!isAway && half === 'bottom'));
        const val = i < scores.length ? String(scores[i]?.value ?? 0) : i + 1 < inning ? '0' : '';
        return <ScoreCell key={i} val={val} active={active} />;
      })}
      <div />
      <div className="font-mono text-[11px] tabular-nums font-extrabold text-slate-900 text-center py-1.5">
        {team.score}
      </div>
      <div className="font-mono text-[11px] tabular-nums font-extrabold text-slate-900 text-center py-1.5">{hits}</div>
      <div className="font-mono text-[11px] tabular-nums font-extrabold text-slate-900 text-center py-1.5">{errors}</div>
    </div>
  );

  return (
    <Card className="p-2! overflow-x-auto bg-[linear-gradient(180deg,#FFFFFF_0%,#FAFCFF_100%)] border border-[#D8E2F1] shadow-[0_10px_22px_-20px_rgba(16,34,58,0.44)]">
      {/* Header row */}
      <div style={{ display: 'grid', gridTemplateColumns: cols }}>
        <HeaderCell label="" />
        {Array.from({ length: innings }).map((_, i) => (
          <HeaderCell key={i} label={String(i + 1)} />
        ))}
        <div />
        <HeaderCell label="R" />
        <HeaderCell label="H" />
        <HeaderCell label="E" />
      </div>
      <TeamRow team={away} scores={awayScores} isAway hits={awayBox.hits} errors={awayBox.errors} />
      <div className="h-px bg-slate-200" />
      <TeamRow team={home} scores={homeScores} isAway={false} hits={homeBox.hits} errors={homeBox.errors} />
    </Card>
  );
});
BaseballLineScore.displayName = 'BaseballLineScore';

// ============================================================================
// § SCORING SUMMARY
// ============================================================================

export interface BaseballScoringSummaryProps {
  plays: BaseballScoringPlay[];
  awayColor: string;
  homeColor: string;
  awayAbbr: string;
  homeAbbr: string;
}

export const BaseballScoringSummary: FC<BaseballScoringSummaryProps> = memo(({
  plays,
  awayColor,
  homeColor,
  awayAbbr,
  homeAbbr,
}) => {
  if (!plays.length) {
    return <EmptyState message="No scoring plays yet" />;
  }

  return (
    <Card className="p-3.5! bg-[linear-gradient(180deg,#FFFFFF_0%,#FAFCFF_100%)] border border-[#D8E2F1] shadow-[0_10px_22px_-20px_rgba(16,34,58,0.44)]">
      <span className={cn(ESSENCE.tier.t2Header, 'block mb-3')}>SCORING SUMMARY</span>
      {plays.map((play, i) => {
        const isAway = play.teamAbbr === awayAbbr;
        const teamColor = isAway ? awayColor : homeColor;
        const teamLabel = isAway ? awayAbbr.slice(0, 2) : homeAbbr.slice(0, 2);

        return (
          <div key={`score-${i}`}>
            {play.inningLabel && (
              <div
                className={cn(
                  'text-[11px] font-bold text-slate-400 py-2',
                  i > 0 && 'border-t border-slate-200',
                )}
              >
                {play.inningLabel}
              </div>
            )}
            <div className="flex items-start gap-2.5 py-1.5">
              <div
                className="w-5 h-5 rounded-[5px] shrink-0 mt-0.5 flex items-center justify-center font-mono text-[7px] font-extrabold"
                style={{
                  background: `${teamColor}18`,
                  border: `1px solid ${teamColor}22`,
                  color: teamColor,
                }}
              >
                {teamLabel}
              </div>
              <span className="flex-1 text-xs text-slate-900 leading-relaxed">
                {play.description}
              </span>
              <div className="flex gap-2.5 shrink-0">
                <span className="font-mono text-[11px] font-bold text-slate-900">{play.awayScore}</span>
                <span className="font-mono text-[11px] font-bold text-slate-900">{play.homeScore}</span>
              </div>
            </div>
          </div>
        );
      })}
    </Card>
  );
});
BaseballScoringSummary.displayName = 'BaseballScoringSummary';

// ============================================================================
// § EDGE SIGNAL CARD (single signal with cited inputs)
// ============================================================================

interface EdgeSignalCardProps {
  label: string;
  icon: React.ReactNode;
  data: BaseballEdgeSignal;
}

const EdgeSignalCard: FC<EdgeSignalCardProps> = memo(({ label, icon, data }) => {
  const colors = EDGE_COLORS[data.signal];

  return (
    <Card className="p-3.5!">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">{icon}</span>
          <span className={ESSENCE.tier.t2Label}>{label}</span>
        </div>
        <div className={cn('flex items-center gap-1.5 px-2 py-1 rounded-full', colors.bg)}>
          <div className={cn('w-[5px] h-[5px] rounded-full', colors.dot)} style={{ boxShadow: `0 0 4px currentColor` }} />
          <span className={cn('font-mono text-[9px] font-bold tracking-wider', colors.text)}>
            {data.value}
          </span>
        </div>
      </div>

      {/* Detail */}
      <p className="text-xs text-slate-400 leading-relaxed mb-2.5">{data.detail}</p>

      {/* Cited Inputs */}
      {data.inputs.length > 0 && (
        <div className="border-t border-slate-200 pt-2">
          <span className={cn(ESSENCE.tier.t3Meta, 'block mb-1.5')}>INPUTS</span>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {data.inputs.map((inp, j) => (
              <div key={j} className="flex justify-between py-0.5">
                <span className="font-mono text-[9px] text-slate-500">{inp.field}</span>
                <span className="font-mono text-[9px] font-semibold text-slate-900">{inp.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
});
EdgeSignalCard.displayName = 'EdgeSignalCard';

// ============================================================================
// § EDGE CONVERGENCE PANEL (Weather × Pitch Count × Bullpen)
// ============================================================================

export interface BaseballEdgePanelProps {
  edge: BaseballEdgeData;
}

export const BaseballEdgePanel: FC<BaseballEdgePanelProps> = memo(({ edge }) => {
  const { score, tier } = computeConvergence(edge.weather, edge.pitchCount, edge.bullpen);
  const colors = CONVERGENCE_COLORS[tier];

  const bars: Array<{ label: string; signal: BaseballEdgeSignal }> = [
    { label: 'WX', signal: edge.weather },
    { label: 'PC', signal: edge.pitchCount },
    { label: 'BP', signal: edge.bullpen },
  ];

  return (
    <motion.div {...FADE_IN} className="flex flex-col gap-2.5">
      {/* Convergence Header */}
      <div className={cn('p-4 rounded-xl border', colors.bg, colors.border)}>
        <div className="flex items-center justify-between mb-2.5">
          <span className={cn(ESSENCE.tier.t2Header)}>EDGE CONVERGENCE</span>
          <div className={cn('flex items-center gap-1.5 px-2 py-1 rounded-full', colors.bg)}>
            <div
              className={cn('w-[5px] h-[5px] rounded-full', EDGE_COLORS[tier === 'STRONG' ? 'high' : tier === 'MODERATE' ? 'med' : 'low'].dot)}
              style={{ boxShadow: `0 0 6px currentColor` }}
            />
            <span className={cn('font-mono text-[9px] font-bold tracking-wider', colors.text)}>
              {tier}
            </span>
          </div>
        </div>

        {/* Signal Bars */}
        <div className="flex gap-1.5 mb-3">
          {bars.map((item) => {
            const c = EDGE_COLORS[item.signal.signal];
            const pct = item.signal.signal === 'high' ? 90 : item.signal.signal === 'med' ? 55 : 25;

            return (
              <div key={item.label} className="flex-1">
                <div className="flex justify-between mb-1">
                  <span className="font-mono text-[8px] font-semibold text-slate-500">{item.label}</span>
                  <span className={cn('font-mono text-[8px] font-semibold', c.text)}>
                    {item.signal.signal.toUpperCase()}
                  </span>
                </div>
                <div className="h-1 rounded-sm bg-slate-50 overflow-hidden">
                  <motion.div
                    className={cn('h-full rounded-sm', c.dot)}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    style={{ boxShadow: `0 0 6px currentColor` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Thesis */}
        <p className="text-xs font-semibold text-slate-900 leading-relaxed">
          {CONVERGENCE_COPY[tier]}
        </p>
      </div>

      {/* Individual Signal Cards */}
      <EdgeSignalCard
        label="WEATHER IMPACT"
        icon={<Thermometer size={15} />}
        data={edge.weather}
      />
      <EdgeSignalCard
        label="PITCH COUNT"
        icon={<CircleDot size={15} />}
        data={edge.pitchCount}
      />
      <EdgeSignalCard
        label="BULLPEN STATUS"
        icon={<Flame size={15} />}
        data={edge.bullpen}
      />
    </motion.div>
  );
});
BaseballEdgePanel.displayName = 'BaseballEdgePanel';

// ============================================================================
// § FRESHNESS BADGE (Updated X ago)
// ============================================================================

const FreshnessBadge: FC<{ ts: number | undefined; className?: string }> = memo(({ ts, className }) => (
  <span className={cn('font-mono text-[8px] text-slate-500', className)}>
    Updated {relativeTime(ts)}
  </span>
));
FreshnessBadge.displayName = 'FreshnessBadge';

// ============================================================================
// § STALE ODDS WARNING
// ============================================================================

const StaleWarning: FC<{ ts: number | undefined }> = memo(({ ts }) => {
  if (!isStaleTs(ts)) return null;

  return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10">
      <AlertTriangle size={9} className="text-red-400" />
      <span className="font-mono text-[8px] font-bold tracking-wider text-red-400">STALE</span>
    </div>
  );
});
StaleWarning.displayName = 'StaleWarning';

// ============================================================================
// § MAIN EXPORT: BaseballGamePanel
//
// Renders inside MatchDetails' OVERVIEW tab SpecSheetRow.
// Receives the shared Match + optional BaseballLiveData.
// ============================================================================

export interface BaseballGamePanelProps {
  match: Match;
  baseballData: BaseballLiveData | null | undefined;
}

export const BaseballGamePanel: FC<BaseballGamePanelProps> = memo(({ match, baseballData }) => {
  const [view, setView] = useState<'atbat' | 'runners'>('atbat');

  const normalizedStatus = String(match.status || '').toUpperCase();
  const isLive =
    normalizedStatus === 'LIVE' ||
    normalizedStatus === 'HALFTIME' ||
    normalizedStatus.includes('IN_PROGRESS');
  const isFinal =
    normalizedStatus === 'FINISHED' ||
    normalizedStatus === 'FINAL' ||
    normalizedStatus.includes('STATUS_FINAL') ||
    normalizedStatus.includes('FULL_TIME');

  const situation = match.situation;
  const runners = {
    first: situation?.onFirst ?? false,
    second: situation?.onSecond ?? false,
    third: situation?.onThird ?? false,
  };
  const balls = situation?.balls ?? 0;
  const strikes = situation?.strikes ?? 0;
  const outs = situation?.outs ?? 0;

  const inning = match.period ?? 1;
  const inningHalf: InningHalf = baseballData?.inningHalf ?? 'top';

  const awayColor = useMemo(() => {
    const c = match.awayTeam.color;
    return c ? (c.startsWith('#') ? c : `#${c}`) : '#3B82F6';
  }, [match.awayTeam.color]);

  const homeColor = useMemo(() => {
    const c = match.homeTeam.color;
    return c ? (c.startsWith('#') ? c : `#${c}`) : '#EF4444';
  }, [match.homeTeam.color]);

  const battingTeam = inningHalf === 'top' ? match.awayTeam : match.homeTeam;
  const battingColor = inningHalf === 'top' ? awayColor : homeColor;

  // If no baseball-specific data, show what we can from Match alone
  const hasPitchData = !!baseballData?.pitches?.length;

  return (
    <motion.div {...FADE_IN} className="flex flex-col gap-2.5">
      <Card className="p-3.5! bg-[linear-gradient(180deg,#FFFFFF_0%,#F7FAFF_100%)] border border-[#D8E2F1] shadow-[0_10px_22px_-20px_rgba(16,34,58,0.45)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-[#1D9E75]" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#10223A]">
              Baseball Live Hub
            </span>
          </div>
          <span className="font-mono text-[10px] text-slate-600 uppercase tracking-[0.12em]">
            {formatInning(inning, inningHalf)}
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">Count</div>
            <div className="font-mono text-[11px] font-bold text-slate-900 tabular-nums">
              {balls}-{strikes}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">Outs</div>
            <div className="font-mono text-[11px] font-bold text-slate-900 tabular-nums">{outs}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">Runners</div>
            <div className="font-mono text-[11px] font-bold text-slate-900 uppercase tracking-[0.1em]">
              {runners.first || runners.second || runners.third ? 'On' : 'Empty'}
            </div>
          </div>
        </div>
      </Card>

      {/* View Toggle (live only) */}
      {isLive && (
        <div
          className="flex rounded-xl overflow-hidden border border-[#D8E2F1] bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFF_100%)] p-1 shadow-[0_8px_18px_-16px_rgba(16,34,58,0.55)]"
          role="group"
          aria-label="View toggle"
        >
          {(['atbat', 'runners'] as const).map((opt) => (
            <button
              key={opt}
              aria-pressed={view === opt}
              onClick={() => setView(opt)}
              className={cn(
                'flex-1 min-h-[40px] rounded-lg flex items-center justify-center',
                'text-[11px] font-mono font-bold tracking-[0.14em] uppercase transition-all duration-200',
                view === opt
                  ? 'text-white bg-[linear-gradient(180deg,#1D9E75_0%,#177F60_100%)] shadow-[0_10px_20px_-16px_rgba(29,158,117,0.78)]'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {opt === 'atbat' ? 'At-Bat' : 'Runners'}
            </button>
          ))}
        </div>
      )}

      {/* AT-BAT VIEW */}
      {isLive && view === 'atbat' && (
        <AnimatePresence mode="wait">
          <motion.div key="atbat" {...FADE_IN} className="flex flex-col gap-2.5">
            {/* Matchup */}
            {baseballData?.pitcher && baseballData?.batter && (
              <Matchup
                pitcher={baseballData.pitcher}
                batter={baseballData.batter}
                awayColor={awayColor}
                homeColor={homeColor}
                status={match.status}
              />
            )}

            {/* Strike Zone + BSO + Pitch Log */}
            <Card className="p-3.5! bg-[linear-gradient(180deg,#FFFFFF_0%,#FAFCFF_100%)] border border-[#D8E2F1] shadow-[0_12px_24px_-22px_rgba(16,34,58,0.52)]">
              {hasPitchData ? (
                <>
                  <StrikeZone pitches={baseballData!.pitches} />
                  <div className="flex justify-center py-2.5">
                    <BSO balls={balls} strikes={strikes} outs={outs} />
                  </div>
                  <PitchLog pitches={baseballData!.pitches} />
                </>
              ) : (
                <>
                  <div className="flex justify-center py-4.5">
                    <Diamond
                      onFirst={runners.first}
                      onSecond={runners.second}
                      onThird={runners.third}
                      size={80}
                    />
                  </div>
                  <div className="flex justify-center py-2.5">
                    <BSO balls={balls} strikes={strikes} outs={outs} />
                  </div>
                  <EmptyState message="Awaiting pitch tracking data" />
                </>
              )}
            </Card>
          </motion.div>
        </AnimatePresence>
      )}

      {/* RUNNERS VIEW */}
      {isLive && view === 'runners' && (
        <AnimatePresence mode="wait">
          <motion.div key="runners" {...FADE_IN}>
            <Card className="p-5! flex flex-col items-center gap-4 bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFF_100%)] border border-[#D8E2F1] shadow-[0_12px_24px_-22px_rgba(16,34,58,0.52)]">
              <Diamond
                onFirst={runners.first}
                onSecond={runners.second}
                onThird={runners.third}
                size={120}
              />
              <BSO balls={balls} strikes={strikes} outs={outs} />
              <span className="font-mono text-[10px] text-slate-500 tracking-wider">
                {runners.first || runners.second || runners.third ? 'Runners on base' : 'Bases empty'}
              </span>
            </Card>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Due Up */}
      {isLive && baseballData?.dueUp && baseballData.dueUp.length > 0 && (
        <DueUp
          teamName={battingTeam.shortName || battingTeam.name}
          teamColor={battingColor}
          players={baseballData.dueUp}
        />
      )}

      {/* Inning Context (live only) */}
      {isLive && (
        <div className="flex items-center gap-2 px-1 py-2">
          <div
            className="w-[22px] h-[22px] rounded-md flex items-center justify-center font-mono text-[7px] font-extrabold"
            style={{
              background: `${battingColor}15`,
              border: `1px solid ${battingColor}20`,
              color: battingColor,
            }}
          >
            {(battingTeam.abbreviation || battingTeam.shortName || '').slice(0, 2)}
          </div>
          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-slate-900">
            {formatInning(inning, inningHalf)}
          </span>
        </div>
      )}

      {/* Line Score (always) */}
      <BaseballLineScore
        match={match}
        currentInning={inning}
        inningHalf={inningHalf}
      />

      {/* FINAL: promote scoring summary */}
      {isFinal && baseballData?.scoringPlays && (
        <BaseballScoringSummary
          plays={baseballData.scoringPlays}
          awayColor={awayColor}
          homeColor={homeColor}
          awayAbbr={match.awayTeam.abbreviation || match.awayTeam.shortName}
          homeAbbr={match.homeTeam.abbreviation || match.homeTeam.shortName}
        />
      )}

      {/* Freshness */}
      {baseballData?.asOfTs && (
        <div className="flex items-center justify-center gap-2 py-1">
          <FreshnessBadge ts={baseballData.asOfTs} />
          <StaleWarning ts={baseballData.oddsTs} />
        </div>
      )}
    </motion.div>
  );
});
BaseballGamePanel.displayName = 'BaseballGamePanel';

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default BaseballGamePanel;
