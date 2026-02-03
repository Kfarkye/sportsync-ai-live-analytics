// ============================================================================
// src/components/match/MatchDetails.tsx
// ============================================================================
//
//  THE DRIP — MATCH INTELLIGENCE HUB (BROADCAST MASTER)
//  State-of-the-Art Game Detail View
//
//  Version: 3.5.0 (Clean Aesthetic)
//  - UPDATE: Removed all icons for a strictly typographic interface.
//  - UPDATE: Removed "LIVE" terminology, replaced with "CONNECTED" / "Active".
//  - FIX: "Zombie Socket" freezing UI when realtime hangs (Freshness Gate).
//  - FIX: "Time Travel" jitter caused by mixing local/server timestamps (Strict Ordering).
//
// ============================================================================

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  memo,
  type FC,
  type ReactNode,
} from 'react';
import { motion, AnimatePresence, useMotionValue } from 'framer-motion';

// ============================================================================
// SECTION 1: IMPORTS
// ============================================================================

import type { Match } from '../../types';
import { cn } from '../../lib/essence';
import { getMatchDisplayStats } from '../../utils/statDisplay';

// Services
import { fetchMatchDetailsExtended, fetchTeamLastFive } from '../../services/espnService';
import { fetchNhlGameDetails } from '../../services/nhlService';
import { supabase } from '../../lib/supabase';
import {
  isGameInProgress,
  isGameFinished as isGameFinal,
  isGameScheduled,
  getDbMatchId,
} from '../../utils/matchUtils';

// Components
import { ScoreHeader, LiveGameTracker, FinalGameTracker } from '../analysis/Gamecast';
import { LiveAIInsight } from '../analysis/LiveAIInsight';
import { ForecastHistoryTable } from '../analysis/ForecastHistoryTable';
import BoxScore, {
  ClassicPlayerProps,
  TeamStatsGrid,
  LineScoreGrid,
} from '../analysis/BoxScore';
import { CinematicPlayerProps } from '../analysis/PlayerStatComponents';
import MatchupHeader from '../pregame/MatchupHeader';
import RecentForm from '../pregame/RecentForm';
import SafePregameIntelCards from '../pregame/PregameIntelCards';
import OddsCard from '../betting/OddsCard';
import { GoalieMatchup } from '../GoalieMatchup';
import { SectionHeader, MatchupLoader, MatchupContextPills } from '../ui';
import ChatWidget from '../ChatWidget';
import { TechnicalDebugView } from '../TechnicalDebugView';

// ============================================================================
// SECTION 2: TYPES & CONFIG
// ============================================================================

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

const CONFIG = {
  polling: {
    LIVE_MS: 3000,
    PREGAME_MS: 60000,
    SOCKET_FRESH_MS: 8000, // Time before fallback polling kicks in if socket silent
  },
  nhlShots: {
    MIN_MS: 15000,
  },
  coordinates: {
    BASKETBALL: { x: 50, y: 28.125 },
    FOOTBALL: { x: 60, y: 26.65 },
    SOCCER: { x: 50, y: 50 },
  },
  forecast: {
    SPARKLINE_POINTS: 12,
    MAX_HISTORY: 20,
  },
};

const ANIMATION = {
  camera: { type: 'spring' as const, stiffness: 60, damping: 20, mass: 1.2 },
  slideUp: {
    initial: { opacity: 0, y: 15 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0 },
  },
};

const BROADCAST = {
  court: {
    lines: 'rgba(255, 255, 255, 0.5)',
    paint: '#18181b',
  },
  glass: 'bg-white/5 backdrop-blur-md border border-white/10 shadow-xl',
};

// ============================================================================
// SECTION 3: INTELLIGENT COORDINATE ENGINE
// ============================================================================

interface PlayCoordinate { x: number; y: number; }
type SportDims = { maxX: number; maxY: number };

function getSportDims(sportKey: string): SportDims {
  if (sportKey.includes('BASKETBALL') || sportKey.includes('NBA') || sportKey.includes('NCAAM')) {
    return { maxX: 100, maxY: 56.25 };
  }
  if (sportKey.includes('FOOTBALL') || sportKey.includes('NFL') || sportKey.includes('CFB') || sportKey.includes('NCAAF')) {
    return { maxX: 120, maxY: 53.3 };
  }
  return { maxX: 100, maxY: 100 };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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

function normalizeRawToDims(rawX: number, rawY: number, dims: SportDims): PlayCoordinate {
  if (rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1) {
    return { x: rawX * dims.maxX, y: rawY * dims.maxY };
  }
  if (rawX >= 0 && rawX <= 100 && rawY >= 0 && rawY <= 100) {
    return { x: rawX * (dims.maxX / 100), y: rawY * (dims.maxY / 100) };
  }
  return { x: rawX, y: rawY };
}

function parseCoordinate(raw: unknown, playText: string, sport: string): PlayCoordinate {
  const sportKey = (sport || '').toUpperCase();
  const dims = getSportDims(sportKey);

  if (raw && typeof raw === 'object') {
    const c = raw as any;
    const rx = typeof c.x === 'number' ? c.x : (typeof c.x === 'string' ? Number(c.x) : NaN);
    const ry = typeof c.y === 'number' ? c.y : (typeof c.y === 'string' ? Number(c.y) : NaN);

    if (Number.isFinite(rx) && Number.isFinite(ry)) {
      if (!(Math.abs(rx) < 0.1 && Math.abs(ry) < 0.1)) {
        const n = normalizeRawToDims(rx, ry, dims);
        return { x: clamp(n.x, 0, dims.maxX), y: clamp(n.y, 0, dims.maxY) };
      }
    }
  }

  const text = (playText || '').toLowerCase().trim();
  const rng = mulberry32(fnv1a32(`${sportKey}|${text}`));
  const jitter = (amp: number) => (rng() - 0.5) * amp;

  if (sportKey.includes('BASKETBALL') || sportKey.includes('NBA') || sportKey.includes('NCAAM')) {
    if (text.includes('free throw')) return { x: 75, y: 28 };
    if (text.includes('3-pointer') || text.includes('three')) return { x: 72 + jitter(4), y: 12 + rng() * 30 };
    if (text.includes('dunk') || text.includes('layup')) return { x: 92, y: 28 };
    if (text.includes('jump shot')) return { x: 65 + jitter(4), y: 28 + jitter(4) };
    if (text.includes('rebound')) return { x: 88 + jitter(4), y: 28 + jitter(4) };
    return CONFIG.coordinates.BASKETBALL;
  }

  if (sportKey.includes('FOOTBALL') || sportKey.includes('NFL') || sportKey.includes('CFB') || sportKey.includes('NCAAF')) {
    if (text.includes('touchdown')) return { x: 115, y: 26.65 };
    if (text.includes('field goal')) return { x: 100, y: 26.65 };
    if (text.includes('punt') || text.includes('kickoff')) return { x: 20, y: 26.65 };
    if (text.includes('safety')) return { x: 5, y: 26.65 };
    return CONFIG.coordinates.FOOTBALL;
  }

  return CONFIG.coordinates.SOCCER;
}

function normalizeColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  return color.startsWith('#') ? color : `#${color}`;
}

// ============================================================================
// SECTION 4: VISUALIZATION COMPONENTS
// ============================================================================

const BroadcastOverlay = memo(() => (
  <div className="absolute inset-0 z-[5] pointer-events-none select-none mix-blend-overlay opacity-30">
    <div
      className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))]"
      style={{ backgroundSize: "100% 2px, 3px 100%" }}
    />
  </div>
));

const BasketballCourt = memo(({ children }: { children?: ReactNode }) => (
  <svg viewBox="0 0 100 56.25" className="w-full h-full drop-shadow-2xl select-none">
    <defs>
      <radialGradient id="courtGlow" cx="0.5" cy="0.5" r="0.8">
        <stop offset="0%" stopColor="#2a2a2a" stopOpacity="1" />
        <stop offset="100%" stopColor="#111111" stopOpacity="1" />
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
    <g fill="none" stroke={BROADCAST.court.lines} strokeWidth="0.6">
      <rect x="2" y="2" width="96" height="52.25" />
      <line x1="50" y1="2" x2="50" y2="54.25" />
      <circle cx="50" cy="28.125" r="6" />
      <g>
        <path d="M2,18.125 h14 v20 h-14" fill={BROADCAST.court.paint} fillOpacity="0.4" />
        <circle cx="16" cy="28.125" r="6" strokeDasharray="3 3" />
        <path d="M2,5.125 a23,23 0 0 1 0,46" />
        <circle cx="5.25" cy="28.125" r="0.75" fill="#ec4899" stroke="none" />
        <line x1="4" y1="25.125" x2="4" y2="31.125" strokeWidth="0.8" />
      </g>
      <g transform="scale(-1, 1) translate(-100, 0)">
        <path d="M2,18.125 h14 v20 h-14" fill={BROADCAST.court.paint} fillOpacity="0.4" />
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

const Gridiron = memo(({ children }: { children?: ReactNode }) => (
  <svg viewBox="0 0 120 53.3" className="w-full h-full drop-shadow-2xl select-none bg-emerald-950">
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

const CinematicGameTracker = memo(({ match, liveState }: { match: Match; liveState: any }) => {
  const sport = match.sport?.toUpperCase() || 'UNKNOWN';
  const ballPos = useMemo(() =>
    parseCoordinate(liveState?.lastPlay?.coordinate, liveState?.lastPlay?.text || '', sport),
    [liveState?.lastPlay, sport]);

  const primaryColor = useMemo(() => normalizeColor(match.homeTeam.color, '#3b82f6'), [match.homeTeam.color]);

  const renderCourt = () => {
    if (sport.includes('BASKETBALL') || sport.includes('NBA') || sport.includes('NCAAM')) {
      return (
        <BasketballCourt>
          <motion.g initial={{ x: 50, y: 28 }} animate={{ x: ballPos.x, y: ballPos.y }} transition={ANIMATION.camera}>
            <motion.circle r="4" fill={primaryColor} opacity="0.3" animate={{ scale: [1, 2.5, 1], opacity: [0.4, 0, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }} />
            <circle r="1.5" fill="#fff" className="drop-shadow-[0_0_8px_rgba(255,255,255,1)]" />
          </motion.g>
        </BasketballCourt>
      );
    }
    if (sport.includes('FOOTBALL') || sport.includes('NFL') || sport.includes('CFB') || sport.includes('NCAAF')) {
      return (
        <Gridiron>
          <motion.circle cx="0" cy="0" r="1.5" fill="#fff" initial={{ x: 60, y: 26 }} animate={{ x: ballPos.x, y: ballPos.y }} transition={ANIMATION.camera} />
        </Gridiron>
      );
    }
    return <LiveGameTracker match={match} liveState={liveState} showHeader={false} headerVariant="embedded" />;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black ring-1 ring-white/10 group shadow-2xl z-0">
        <div className="absolute inset-0 z-0">{renderCourt()}</div>
        <BroadcastOverlay />

        {/* Removed 'LIVE' badge and icons */}
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
          {(match as any).possession && (
            <div className="px-2 py-1 rounded bg-black/60 backdrop-blur text-zinc-300 text-[10px] font-mono border border-white/10">
              POSS: <span className="text-white font-bold">{(match as any).possession}</span>
            </div>
          )}
        </div>

        <div className="absolute top-0 left-0 w-24 h-24 bg-gradient-to-br from-white/10 to-transparent pointer-events-none mix-blend-overlay" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(BROADCAST.glass, "p-3 rounded-xl flex items-center gap-4 shadow-lg border border-white/5 bg-white/5")}
      >
        <div className="h-10 w-1 rounded-full bg-blue-500/50 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider bg-white/10 px-1.5 py-0.5 rounded flex items-center gap-1">
              {/* Icons Removed */}
              {liveState?.lastPlay?.type?.text || "FEED"}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono flex items-center gap-1">
              {match.displayClock} • P{match.period}
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.p
              key={liveState?.lastPlay?.text || "waiting"}
              initial={{ opacity: 0, x: 5 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -5 }}
              className="text-sm font-medium text-white leading-snug truncate"
            >
              {liveState?.lastPlay?.text || "Waiting for next play..."}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
});

// ============================================================================
// SECTION 6: UI COMPONENTS (Edge, Sparkline, Skeletons)
// ============================================================================

const EdgeStateBadge = memo(({ edgeState }: { edgeState: any }) => {
  if (!edgeState || edgeState.state === 'NEUTRAL') return null;
  const isPlay = edgeState.state === 'PLAY';
  const bgClass = isPlay ? 'bg-emerald-500/15 border-emerald-500/30' : 'bg-amber-500/15 border-amber-500/30';
  const textClass = isPlay ? 'text-emerald-400' : 'text-amber-400';

  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className={cn('flex items-center gap-2 px-2.5 py-1 rounded-lg border', bgClass)}>
      <div className="flex gap-0.5">
        {[1, 2, 3].map(i => (
          <motion.div key={i} animate={{ height: [3, 8, 3], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1 }} className={cn('w-[2px] rounded-full', isPlay ? 'bg-emerald-500' : 'bg-amber-500')} />
        ))}
      </div>
      <span className={cn('text-[10px] font-bold uppercase tracking-wider', textClass)}>{edgeState.state}</span>
      {edgeState.edgePoints !== undefined && (
        <>
          <div className={cn('w-px h-3', isPlay ? 'bg-emerald-500/30' : 'bg-amber-500/30')} />
          <div className="flex items-center gap-0.5">
            {/* Icons Removed */}
            <span className={cn('text-[10px] font-mono font-bold', textClass)}>{edgeState.edgePoints > 0 ? '+' : ''}{edgeState.edgePoints.toFixed(1)}</span>
          </div>
        </>
      )}
    </motion.div>
  );
});

const ForecastSparkline = memo(({ points }: { points: any[] }) => {
  if (points.length < 2) return null;
  const values = points.map(p => p.fairTotal);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // Prevent divide by zero
  const width = 80;
  const height = 24;
  const padding = 2;

  const pathData = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((p.fairTotal - min) / range) * (height - padding * 2);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  const latestEdge = points[points.length - 1]?.edgeState;
  const strokeColor = latestEdge === 'PLAY' ? '#10b981' : latestEdge === 'LEAN' ? '#f59e0b' : '#71717a';

  return (
    <div className="flex items-center gap-2">
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <linearGradient id="sparkGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={pathData} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" vectorEffect="non-scaling-stroke" />
        <path d={`${pathData} L ${width - padding} ${height} L ${padding} ${height} Z`} fill="url(#sparkGradient)" stroke="none" />
        <circle cx={padding + ((points.length - 1) / (points.length - 1)) * (width - padding * 2)} cy={height - padding - ((values[values.length - 1] - min) / range) * (height - padding * 2)} r="2.5" fill={strokeColor} />
      </svg>
      <div className="flex flex-col">
        <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Fair</span>
        <span className="text-xs font-mono font-bold text-white">{values[values.length - 1]?.toFixed(1)}</span>
      </div>
    </div>
  );
});

const SkeletonPulse = memo(({ className }: { className?: string }) => <div className={cn('bg-white/5 rounded animate-pulse', className)} />);
const OddsCardSkeleton = memo(() => (
  <div className="p-4 rounded-2xl border border-white/5 bg-white/[0.02] space-y-4">
    <div className="flex items-center justify-between"><SkeletonPulse className="h-4 w-20" /><SkeletonPulse className="h-4 w-12" /></div>
    <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="flex justify-between items-center"><SkeletonPulse className="h-5 w-24" /><SkeletonPulse className="h-5 w-16" /></div>)}</div>
  </div>
));
const StatsGridSkeleton = memo(() => (
  <div className="p-4 rounded-2xl border border-white/5 bg-white/[0.02] space-y-3">
    <SkeletonPulse className="h-4 w-24 mb-4" />
    {[1, 2, 3, 4].map(i => <div key={i} className="flex justify-between items-center"><SkeletonPulse className="h-3 w-20" /><SkeletonPulse className="h-3 w-32" /><SkeletonPulse className="h-3 w-20" /></div>)}
  </div>
));

// ============================================================================
// SECTION 7: DATA LOGIC (FAULT TOLERANT)
// ============================================================================

function stableSerialize(value: any, seen = new WeakSet<object>()): string {
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
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableSerialize((value as any)[k], seen)}`).join(',')}}`;
  }
  return '"__unsupported__"';
}
function hashStable(value: any): string { return fnv1a32(stableSerialize(value)).toString(16); }

function computeMatchSignature(m: Match): string {
  return [
    m.id, m.status ?? '', String(m.period ?? ''), String((m as any)?.displayClock ?? ''),
    String((m as any)?.homeScore ?? ''), String((m as any)?.awayScore ?? ''),
    (m as any)?.lastPlay?.text || '', hashStable((m as any)?.current_odds ?? null), hashStable((m as any)?.stats ?? null)
  ].join('|');
}

// FAIL-SAFE FETCHER: Swallows errors for non-critical data.
async function failSafe<T>(p: PromiseLike<{ data: T; error: any }> | any): Promise<T | null> {
  try {
    const { data, error } = await p;
    if (error) {
      if (process.env.NODE_ENV === 'development') console.warn('Non-critical fetch failed:', error);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

// CRITICAL FETCHER: Strict, throws on error.
async function sbData<T>(p: PromiseLike<{ data: T; error: any }> | any): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

// HELPER: Strict Timestamp Parsing
function parseTsMs(v: any, fallbackMs: number): number {
  if (!v) return fallbackMs;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : fallbackMs;
}

function useMatchPolling(initialMatch: Match) {
  const [match, setMatch] = useState<Match>(initialMatch);
  const [liveState, setLiveState] = useState<any>(null);
  const [nhlShots, setNhlShots] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'error' | 'connecting'>('connecting');
  const [error, setError] = useState<Error | null>(null);
  const [forecastHistory, setForecastHistory] = useState<ForecastPoint[]>([]);
  const [edgeState, setEdgeState] = useState<EdgeState | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const matchRef = useRef<Match>(initialMatch);
  const matchSigRef = useRef<string>(computeMatchSignature(initialMatch));
  const liveSigRef = useRef<string>('');

  // REVISED REFS: Separate DB timestamp from Local Staleness
  const lastLiveCreatedAtRef = useRef<number>(0);   // Order by DB write time
  const lastLiveReceivedAtRef = useRef<number>(0);  // Gate for "Zombie Socket" detection

  const isFetchingRef = useRef(false);
  const fetchSeqRef = useRef(0);
  const nhlLastFetchAtRef = useRef<number>(0);
  const nhlLastKeyRef = useRef<string>('');
  const isSocketActiveRef = useRef(false);

  const processLiveState = useCallback((live: any) => {
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
        const newPoint: ForecastPoint = {
          clock: live.clock || '',
          fairTotal,
          marketTotal,
          edgeState: newEdge.state,
          timestamp: Date.now(),
        };
        const last = prev[prev.length - 1];
        if (last && last.clock === newPoint.clock && last.fairTotal === newPoint.fairTotal) return prev;
        return [...prev.slice(-CONFIG.forecast.SPARKLINE_POINTS + 1), newPoint];
      });
    }

    if (live.home_score !== undefined && live.away_score !== undefined) {
      setMatch(prev => {
        if (live.home_score > (prev.homeScore || 0) || live.away_score > (prev.awayScore || 0)) {
          return { ...prev, homeScore: Math.max(live.home_score, prev.homeScore || 0), awayScore: Math.max(live.away_score, prev.awayScore || 0) };
        }
        return prev;
      });
    }
  }, []);

  // Reset
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

  // REAL-TIME SUBSCRIPTION
  useEffect(() => {
    if (!isGameInProgress(initialMatch.status)) return;
    const dbId = getDbMatchId(initialMatch.id, initialMatch.leagueId?.toLowerCase() || '');
    const channel = supabase.channel(`live_state:${dbId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_match_states', filter: `match_id=eq.${dbId}` }, (payload) => {
        if (payload.new) {
          isSocketActiveRef.current = true;
          const receivedAt = Date.now();
          const createdAt = parseTsMs((payload.new as any).created_at, receivedAt);

          // Gate: Only process if newer than what we have (DB Time)
          if (createdAt <= lastLiveCreatedAtRef.current) return;

          lastLiveCreatedAtRef.current = createdAt;
          lastLiveReceivedAtRef.current = receivedAt;

          const nextLiveSig = hashStable(payload.new);
          if (nextLiveSig !== liveSigRef.current) {
            liveSigRef.current = nextLiveSig;
            processLiveState(payload.new);
          }
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          isSocketActiveRef.current = true;
          lastLiveReceivedAtRef.current = Date.now();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          isSocketActiveRef.current = false;
        }
      });
    return () => { supabase.removeChannel(channel); isSocketActiveRef.current = false; };
  }, [initialMatch.id, initialMatch.leagueId, initialMatch.status, processLiveState]);

  const maybeFetchNhlShots = useCallback(async (m: Match) => {
    if (m.sport !== 'HOCKEY') return;
    const now = Date.now();
    if (now - nhlLastFetchAtRef.current < CONFIG.nhlShots.MIN_MS) return;
    const key = `${m.id}|${m.homeTeam?.name ?? ''}|${m.awayTeam?.name ?? ''}|${m.startTime ?? ''}`;
    if (key === nhlLastKeyRef.current && now - nhlLastFetchAtRef.current < CONFIG.nhlShots.MIN_MS) return;
    nhlLastFetchAtRef.current = now;
    nhlLastKeyRef.current = key;
    try {
      const d = await fetchNhlGameDetails(m.homeTeam.name, m.awayTeam.name, new Date(m.startTime));
      if (d?.shots) setNhlShots(d.shots.map((s: any) => ({ ...s, team: s.teamId, time: s.timeInPeriod })));
    } catch { }
  }, []);

  const fetchData = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    const seq = ++fetchSeqRef.current;

    try {
      const cur = matchRef.current;
      const leagueKey = cur.leagueId?.toLowerCase() || '';
      const dbId = getDbMatchId(cur.id, leagueKey);
      const shouldFetchLive = isGameInProgress(cur.status);

      // Freshness Gate: Only skip polling if socket provided data recently (<8s)
      const socketFresh = isSocketActiveRef.current && shouldFetchLive && (Date.now() - lastLiveReceivedAtRef.current) < CONFIG.polling.SOCKET_FRESH_MS;

      setConnectionStatus(prev => (prev === 'connected' ? 'connected' : 'connecting'));

      const espnPromise = fetchMatchDetailsExtended(cur.id, cur.sport, cur.leagueId).catch(e => { console.warn('ESPN Fail:', e); return null; });
      const dbPromise = sbData<any>(supabase.from('matches').select('*').eq('id', dbId).maybeSingle()).catch(e => { console.warn('DB Fail:', e); return null; });
      const propsPromise = failSafe<any[]>(supabase.from('player_prop_bets').select('*').ilike('match_id', `%${cur.id}%`).order('player_name'));

      // Polling fallback if socket is stale
      const livePromise = (shouldFetchLive && !socketFresh)
        ? failSafe<any>(supabase.from('live_match_states').select('*').eq('match_id', dbId).maybeSingle())
        : Promise.resolve(null);

      const [espn, db, props, live] = await Promise.all([espnPromise, dbPromise, propsPromise, livePromise]);

      if (seq !== fetchSeqRef.current) return;

      // Hard Failure: If ESPN + DB are both dead, show error.
      if (!espn && !db) {
        if (matchRef.current.homeTeam) setConnectionStatus('connecting');
        else throw new Error('Unable to connect to game feed.');
        setIsInitialLoad(false);
        return;
      }

      let nextMatch: Match = { ...matchRef.current };

      if (espn) {
        nextMatch = {
          ...nextMatch, ...espn,
          stats: (espn as any).stats || (espn as any).statistics || nextMatch.stats || [],
          homeScore: Math.max(espn.homeScore || 0, nextMatch.homeScore || 0),
          awayScore: Math.max(espn.awayScore || 0, nextMatch.awayScore || 0)
        } as Match;
      }

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

      if (props?.length) {
        nextMatch.dbProps = props.map((p: any) => ({
          playerName: p.player_name, betType: p.bet_type, lineValue: Number(p.line_value),
          oddsAmerican: Number(p.odds_american), marketLabel: p.market_label, headshotUrl: p.headshot_url
        })) as any;
      } else if (props !== null) {
        // Only clear props if fetch succeeded but returned empty. If null (failed), keep old.
        nextMatch.dbProps = [];
      }

      const nextSig = computeMatchSignature(nextMatch);
      if (nextSig !== matchSigRef.current) {
        matchRef.current = nextMatch;
        matchSigRef.current = nextSig;
        setMatch(nextMatch);
      }

      if (live) {
        const receivedAt = Date.now();
        const createdAt = parseTsMs((live as any).created_at, receivedAt);

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

      // Fetch Recent Form for Scheduled Games (Once)
      if (isGameScheduled(cur.status) && !(nextMatch.homeTeam as any).last5) {
        try {
          const [hForm, aForm] = await Promise.all([
            fetchTeamLastFive(cur.homeTeam.id, cur.sport, cur.leagueId),
            fetchTeamLastFive(cur.awayTeam.id, cur.sport, cur.leagueId)
          ]);
          (nextMatch.homeTeam as any).last5 = hForm;
          (nextMatch.awayTeam as any).last5 = aForm;
          // Trigger update
          setMatch({ ...nextMatch });
          matchRef.current = nextMatch;
        } catch (e) {
          console.warn('Form Fetch Error', e);
        }
      }

      void maybeFetchNhlShots(nextMatch);

      setConnectionStatus('connected');
      setError(null);
      setIsInitialLoad(false);

    } catch (e) {
      console.error("Polling Error", e);
      setConnectionStatus('error');
      setError(e instanceof Error ? e : new Error('Sync failed'));
      setIsInitialLoad(false);
    } finally {
      isFetchingRef.current = false;
    }
  }, [maybeFetchNhlShots, processLiveState]);

  useEffect(() => {
    fetchData();
    const tickMs = isGameInProgress(match.status) ? CONFIG.polling.LIVE_MS : CONFIG.polling.PREGAME_MS;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, tickMs);
    return () => window.clearInterval(interval);
  }, [fetchData, match.status]);

  return { match, liveState, nhlShots, connectionStatus, error, forecastHistory, edgeState, isInitialLoad };
}

function useKeyboardNavigation(matches: Match[], currentMatchId: string, onSelectMatch?: (match: Match) => void) {
  useEffect(() => {
    if (!onSelectMatch || matches.length <= 1) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = matches.findIndex((m) => m.id === currentMatchId);
      if (idx === -1) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onSelectMatch(matches[(idx - 1 + matches.length) % matches.length]); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onSelectMatch(matches[(idx + 1) % matches.length]); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [matches, currentMatchId, onSelectMatch]);
}

// ============================================================================
// SECTION 8: UI COMPONENTS
// ============================================================================

const ConnectionBadge = memo(({ status }: { status: 'connected' | 'error' | 'connecting' }) => {
  const base = "flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium transition-colors";
  if (status === 'connected') return (<div className={cn(base, "bg-emerald-500/10 text-emerald-400")}> <span className="relative flex h-1.5 w-1.5"> <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span> <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span> </span> </div>);
  if (status === 'connecting') return (<div className={cn(base, "bg-amber-500/10 text-amber-300")}> <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: "linear", duration: 1 }}>{/* Icon Removed */}</motion.span> <span>SYNC</span> </div>);
  return (<div className={cn(base, "bg-red-500/10 text-red-400")}> <span>OFFLINE</span> </div>);
});

const SwipeableHeader = memo(({ match, isScheduled, onSwipe }: any) => {
  const x = useMotionValue(0);
  return (
    <motion.div style={{ x }} drag="x" dragConstraints={{ left: 0, right: 0 }} onDragEnd={(_, i) => { if (i.offset.x > 100) onSwipe(-1); else if (i.offset.x < -100) onSwipe(1); }} className="pb-2 px-2 cursor-grab active:cursor-grabbing">
      <AnimatePresence mode="wait">
        <motion.div key={match.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {isScheduled ? (
            <MatchupHeader
              matchId={match.id}
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
              startTime={match.startTime}
              sport={match.sport}
              currentOdds={match.current_odds}
            />
          ) : (
            <ScoreHeader match={match} variant="embedded" />
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
});

// ============================================================================
// SECTION 9: MAIN COMPONENT
// ============================================================================

export interface MatchDetailsProps {
  match: Match;
  onBack: () => void;
  matches?: Match[];
  onSelectMatch?: (match: Match) => void;
}

const MatchDetails: FC<MatchDetailsProps> = ({ match: initialMatch, onBack, matches = [], onSelectMatch }) => {
  const { match, liveState, nhlShots, connectionStatus, error, forecastHistory, edgeState, isInitialLoad } = useMatchPolling(initialMatch);
  useKeyboardNavigation(matches, match.id, onSelectMatch);

  const isSched = useMemo(() => isGameScheduled(match?.status), [match?.status]);
  const isLive = isGameInProgress(match.status);
  const homeColor = useMemo(() => normalizeColor(match?.homeTeam?.color, '#3B82F6'), [match.homeTeam]);
  const awayColor = useMemo(() => normalizeColor(match?.awayTeam?.color, '#EF4444'), [match.awayTeam]);
  const displayStats = useMemo(() => getMatchDisplayStats(match, 8), [match]);

  const [activeTab, setActiveTab] = useState(isSched ? 'DETAILS' : 'OVERVIEW');
  const [propView, setPropView] = useState<'classic' | 'cinematic'>('cinematic');

  useEffect(() => {
    if (isSched && activeTab === 'OVERVIEW') setActiveTab('DETAILS');
    if (!isSched && activeTab === 'DETAILS') setActiveTab('OVERVIEW');
  }, [isSched, activeTab]);

  const handleSwipe = useCallback((dir: number) => {
    if (!matches.length) return;
    const idx = matches.findIndex(m => m.id === match.id);
    if (idx === -1) return;
    onSelectMatch?.(matches[(idx + dir + matches.length) % matches.length]);
  }, [matches, match.id, onSelectMatch]);

  if (!match?.homeTeam) return <MatchupLoader className="h-screen" label="Synchronizing Game Hub" />;

  const TABS = isSched
    ? [{ id: 'DETAILS', label: 'Matchup' }, { id: 'PROPS', label: 'Props' }, { id: 'DATA', label: 'Edge' }, { id: 'CHAT', label: 'AI' }]
    : [{ id: 'OVERVIEW', label: 'Game' }, { id: 'PROPS', label: 'Props' }, { id: 'DATA', label: 'Edge' }, { id: 'CHAT', label: 'AI' }];

  return (
    <div className="min-h-screen bg-[#050505] text-white relative overflow-y-auto">
      <div className="fixed inset-0 pointer-events-none z-0">
        <motion.div animate={{ opacity: [0.05, 0.08, 0.05] }} transition={{ duration: 5, repeat: Infinity }} className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full blur-[140px]" style={{ background: awayColor }} />
        <motion.div animate={{ opacity: [0.05, 0.08, 0.05] }} transition={{ duration: 5, repeat: Infinity, delay: 2.5 }} className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full blur-[140px]" style={{ background: homeColor }} />
      </div>

      <header className="sticky top-0 z-50 bg-[#050505]/95 backdrop-blur-xl border-b border-white/[0.06] pt-safe shadow-2xl">
        <div className="flex items-center justify-between px-6 py-3">
          {/* Replaced ArrowLeft icon with text "Back" to satisfy "remove all icons" */}
          <button onClick={onBack} className="p-2 -ml-2 rounded-full text-zinc-400 hover:text-white transition-colors text-[10px] uppercase font-bold tracking-widest">BACK</button>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase">{match.leagueId?.toUpperCase() || 'GAME'}</span>
            {isLive && edgeState && <EdgeStateBadge edgeState={edgeState} />}
            {isLive && forecastHistory.length >= 2 && <div className="hidden md:block"><ForecastSparkline points={forecastHistory} /></div>}
          </div>
          <ConnectionBadge status={connectionStatus} />
        </div>

        {error && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="px-6 pb-2 text-xs text-red-400 bg-red-900/20 mx-6 rounded mb-2 border border-red-900/50 p-2 flex items-center gap-2"> Connection Unstable: Showing cached data...</motion.div>}

        <SwipeableHeader match={match} isScheduled={isSched} onSwipe={handleSwipe} />

        <nav className="flex justify-center gap-8 px-6 pb-0 mt-1">
          {TABS.map(tab => {
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className="relative flex flex-col items-center py-3 group outline-none">
                <div className={cn("flex items-center gap-1.5 transition-colors", activeTab === tab.id ? "text-white" : "text-zinc-500 group-hover:text-zinc-300")}>
                  <span className="text-[10px] font-bold tracking-widest uppercase">{tab.label}</span>
                </div>
                {activeTab === tab.id && <motion.div layoutId="tabLine" className="absolute bottom-0 w-full h-0.5 bg-white rounded-full" />}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="relative z-10 pb-safe-offset-24 min-h-screen px-6 py-6 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} {...ANIMATION.slideUp}>
            {activeTab === 'OVERVIEW' && (
              <div className="grid lg:grid-cols-12 gap-8">
                <div className="lg:col-span-8 space-y-6">
                  <div className="lg:hidden">{isInitialLoad ? <OddsCardSkeleton /> : <OddsCard match={match} />}</div>
                  <section>
                    <SectionHeader accent={isGameFinal(match.status) ? 'final' : 'live'}>{isGameFinal(match.status) ? "Final Analysis" : "Gamecast"}</SectionHeader>
                    <CinematicGameTracker match={match} liveState={liveState || { lastPlay: match.lastPlay as any }} />
                    <div className="mt-6"><LineScoreGrid match={match} isLive={!isGameFinal(match.status)} /></div>
                  </section>
                  {!isGameFinal(match.status) && (
                    <div className="lg:hidden">
                      <SectionHeader compact>Team Stats</SectionHeader>
                      {isInitialLoad ? (
                        <StatsGridSkeleton />
                      ) : (
                        <TeamStatsGrid stats={displayStats} match={match} colors={{ home: homeColor, away: awayColor }} />
                      )}
                    </div>
                  )}
                  {liveState?.ai_analysis && <LiveAIInsight match={match} />}
                </div>
                <aside className="lg:col-span-4 space-y-6 hidden lg:block">
                  {isInitialLoad ? <OddsCardSkeleton /> : <OddsCard match={match} />}
                  {match.sport === 'HOCKEY' && <GoalieMatchup matchId={match.id} homeTeam={match.homeTeam} awayTeam={match.awayTeam} />}
                  {match.context && <MatchupContextPills {...match.context} sport={match.sport} />}
                  {isInitialLoad ? <StatsGridSkeleton /> : <TeamStatsGrid stats={displayStats} match={match} colors={{ home: homeColor, away: awayColor }} />}
                </aside>
              </div>
            )}

            {activeTab === 'DETAILS' && (
              <div className="space-y-6">
                <div className="grid lg:grid-cols-12 gap-8">
                  <div className="lg:col-span-8 space-y-8">
                    {/* 1. The Pick & Thesis (Hero) */}
                    <SafePregameIntelCards match={match} />

                    {/* 2. Market Context */}
                    {isInitialLoad ? <OddsCardSkeleton /> : <OddsCard match={match} />}

                    {/* 3. Team Stats Comparison */}
                    <div>
                      <SectionHeader compact>Head to Head</SectionHeader>
                      {isInitialLoad ? <StatsGridSkeleton /> : <TeamStatsGrid stats={displayStats} match={match} colors={{ home: homeColor, away: awayColor }} />}
                    </div>

                    {/* 4. Recent Form */}
                    <div>
                      <SectionHeader compact>Recent Form</SectionHeader>
                      <RecentForm
                        homeTeam={match.homeTeam as any}
                        awayTeam={match.awayTeam as any}
                        homeName={match.homeTeam.name}
                        awayName={match.awayTeam.name}
                        homeColor={homeColor}
                        awayColor={awayColor}
                      />
                    </div>
                  </div>

                  <aside className="lg:col-span-4 space-y-6">
                    {/* Sidebar Context */}
                    {(match as any).context && <MatchupContextPills {...(match as any).context} sport={match.sport} />}
                    {match.sport === 'HOCKEY' && <GoalieMatchup matchId={match.id} homeTeam={match.homeTeam} awayTeam={match.awayTeam} />}
                  </aside>
                </div>
              </div>
            )}

            {activeTab === 'PROPS' && (
              <div className="space-y-4">
                <div className="flex justify-end"><button onClick={() => setPropView(v => v === 'classic' ? 'cinematic' : 'classic')} className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-white flex items-center gap-1"> View Mode</button></div>
                {propView === 'classic' ? <ClassicPlayerProps match={match} /> : <CinematicPlayerProps match={match} />}
              </div>
            )}

            {activeTab === 'DATA' && (
              <div className="space-y-6">
                <SafePregameIntelCards match={match} />
                <ForecastHistoryTable matchId={match.id} />
                <BoxScore match={match} />
                {isInitialLoad ? <StatsGridSkeleton /> : <TeamStatsGrid stats={displayStats} match={match} colors={{ home: homeColor, away: awayColor }} />}
              </div>
            )}

            {activeTab === 'CHAT' && <div className="max-w-3xl mx-auto h-[700px]"><ChatWidget currentMatch={match} inline /></div>}
          </motion.div>
        </AnimatePresence>
      </main>
      <TechnicalDebugView match={match} />
    </div>
  );
};

export default memo(MatchDetails);
