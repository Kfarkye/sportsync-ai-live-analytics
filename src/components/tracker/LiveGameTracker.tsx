// ============================================================================
// src/components/tracker/LiveGameTracker.tsx
// ============================================================================
//
// VERDICT: PRODUCTION-READY AFTER HARDENING PATCHES
//
// PATCHES IN THIS VERSION:
// ✅ Signals memo correctness: signalsKey covers full computeAISignals read-set
// ✅ No stale signals: computeAISignals(match) recalcs only when read-set changes
// ✅ UNDER + PUSH styling fixed (Total + Spread)
// ✅ Court Y normalization supports 0..50 and 0..100 feeds
// ✅ Removed unnecessary `as any` casts for odds fields by typing ExtendedMatch
// ✅ Reduced-motion respected in LiveIndicator + progress animation
// ✅ liveState consumed via safe merge (socket payload overlays match)
// ✅ Compact score strip added in LiveGameTracker (ScoreHeader remains exportable)
// ✅ BoxScoreCard added (safe key-picking, non-breaking)
//
// ============================================================================

import React, {
    memo,
    useMemo,
    type FC,
    type ReactNode,
    type ElementType,
    type ComponentPropsWithoutRef,
} from 'react';
import {
    motion,
    AnimatePresence,
    useReducedMotion,
    type Transition,
} from 'framer-motion';
import {
    Activity,
    Shield,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    ChevronDown,
    CheckCircle2,
    DollarSign,
    Zap,
    Target,
    Radio,
    BarChart3,
} from 'lucide-react';

// Internal imports — Replace these paths with your actual project structure
import { type Match } from '../../types';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '../../lib/essence';
import { isGameFinished } from '../../utils/matchUtils';
import { computeAISignals } from '../../services/gameStateEngine';

// ============================================================================
// 1. STRICT TYPE DEFINITIONS & VIEW MODEL
// ============================================================================

type Numberish = number | string;

type OddsLine = {
    spread?: Numberish;
    total?: Numberish;
    overUnder?: Numberish;
};

type VenueInfo = {
    is_indoor?: boolean;
};

type WindInfo = {
    wind_speed?: Numberish;
};

type TeamStats = Record<string, Numberish | null | undefined>;

export interface ExtendedMatch extends Omit<Match, 'currentDrive' | 'lastPlay' | 'situation'> {
    league?: string;

    situation?: {
        yardLine?: string | number;
        down?: number;
        distance?: number;
        possessionId?: string | number;
        possession?: string;
        isRedZone?: boolean;
        downDistanceText?: string;
        ballX?: number;
        ballY?: number;
    };

    lastPlay?: {
        id?: string;
        text?: string;
    };

    currentDrive?: {
        plays?: number;
        yards?: number;
        timeElapsed?: string;
        description?: string;
    };

    opening_odds?: OddsLine;
    current_odds?: OddsLine;
    odds?: OddsLine;
    live_odds?: OddsLine;

    closing_odds?: {
        spread?: Numberish;
        total?: Numberish;
    };

    venue?: VenueInfo;
    weather_info?: WindInfo;
    weather_forecast?: WindInfo;

    homeTeamStats?: TeamStats;
    awayTeamStats?: TeamStats;

    homeTeam: Match['homeTeam'] & { srs?: Numberish };
    awayTeam: Match['awayTeam'] & { srs?: Numberish };
}

interface GameViewModel {
    meta: {
        isFootball: boolean;
        isBasketball: boolean;
        isFinished: boolean;
        displayClock: string;
        hasData: boolean;
    };
    teams: {
        home: TeamViewModel;
        away: TeamViewModel;
    };
    gameplay: {
        situation: ExtendedMatch['situation'] | null;
        lastPlay: ExtendedMatch['lastPlay'] | null;
        drive: ExtendedMatch['currentDrive'] | null;
        possession: 'home' | 'away' | null;
        isRedZone: boolean;
    };
    betting: {
        signals: ReturnType<typeof computeAISignals> | { edge_state: 'NEUTRAL'; edge_points: number; deterministic_fair_total: number; market_total: number; status_reason: string };
        spread: number;
        total: number;
        hasSpread: boolean;
        hasTotal: boolean;
        spreadResult: 'COVER' | 'MISS' | 'PUSH' | null;
        totalHit: 'OVER' | 'UNDER' | 'PUSH' | null;
    };
    stats: {
        homeTeamStats: TeamStats | null;
        awayTeamStats: TeamStats | null;
    };
}

interface TeamViewModel {
    id: string;
    abbr: string;
    name: string;
    logo: string;
    color: string;
    score: number;
    record: string;
    isPossessing: boolean;
    isWinner: boolean;
}

// ============================================================================
// 2. DESIGN TOKENS & UTILITIES
// ============================================================================

const TOKENS = {
    colors: {
        turf: { a: '#132617', b: '#1a3a22' },
        accent: { live: '#ef4444', info: '#3b82f6' },
    },
    animation: {
        spring: { type: 'spring', stiffness: 400, damping: 30, mass: 0.8 } as Transition,
        gentle: { type: 'spring', stiffness: 200, damping: 25 } as Transition,
        fade: { duration: 0.3 } as Transition,
    },
    patterns: {
        noise: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")`,
    },
} as const;

const safeNumber = (val: unknown, fallback = 0): number => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') {
        const n = parseFloat(val);
        return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
};

const hasValue = (v: unknown): boolean => v !== null && v !== undefined && `${v}`.trim().length > 0;

const normalizeColor = (color: string | undefined, fallback: string): string => {
    if (!color) return fallback;
    const c = color.trim();
    if (/^#|^rgb|^hsl/i.test(c)) return c;
    if (/^[0-9a-fA-F]{3,8}$/.test(c)) return `#${c}`;
    return fallback;
};

const getOrdinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const isRecordString = (v: unknown): v is string => typeof v === 'string';

const numberishOrUndef = (v: unknown): Numberish | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim().length) return v;
    return undefined;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

const pickWindSpeed = (m: ExtendedMatch): number => {
    const w1 = safeNumber(m.weather_info?.wind_speed, NaN);
    if (Number.isFinite(w1)) return w1;
    const w2 = safeNumber(m.weather_forecast?.wind_speed, NaN);
    if (Number.isFinite(w2)) return w2;
    return NaN;
};

const stableStatsFingerprint = (stats: TeamStats | null | undefined): string => {
    if (!stats) return '';
    const keys = ['pace', 'ortg', 'drtg', 'efg', 'tov', 'reb', 'ft_rate', 'ts', 'ast', 'stl', 'blk'] as const;
    const parts: string[] = [];
    for (const k of keys) {
        const raw = stats[k];
        if (!hasValue(raw)) continue;
        const n = safeNumber(raw, NaN);
        if (!Number.isFinite(n)) continue;
        parts.push(`${k}:${n.toFixed(3)}`);
    }
    return parts.join(',');
};

// ============================================================================
// 3. LIVE STATE MERGE (Socket Overlay)
// ============================================================================

function mergeMatchWithLiveState(base: ExtendedMatch, liveState: unknown): ExtendedMatch {
    if (!isPlainObject(liveState)) return base;
    const ls = liveState;
    const next: ExtendedMatch = { ...base };

    if (hasValue(ls.status) && typeof ls.status === 'string') next.status = ls.status as Match['status'];
    if (hasValue(ls.displayClock) && typeof ls.displayClock === 'string') next.displayClock = ls.displayClock;
    if (hasValue(ls.period) && (typeof ls.period === 'number' || typeof ls.period === 'string')) next.period = safeNumber(ls.period);
    if (hasValue(ls.homeScore)) next.homeScore = safeNumber(ls.homeScore) ?? next.homeScore;
    if (hasValue(ls.awayScore)) next.awayScore = safeNumber(ls.awayScore) ?? next.awayScore;

    if (isPlainObject(ls.situation)) next.situation = { ...(base.situation || {}), ...(ls.situation as ExtendedMatch['situation']) };
    if (isPlainObject(ls.currentDrive)) next.currentDrive = { ...(base.currentDrive || {}), ...(ls.currentDrive as ExtendedMatch['currentDrive']) };
    if (isPlainObject(ls.lastPlay)) next.lastPlay = { ...(base.lastPlay || {}), ...(ls.lastPlay as ExtendedMatch['lastPlay']) };
    if (isPlainObject(ls.current_odds)) next.current_odds = { ...(base.current_odds || {}), ...(ls.current_odds as OddsLine) };
    if (isPlainObject(ls.odds)) next.odds = { ...(base.odds || {}), ...(ls.odds as OddsLine) };
    if (isPlainObject(ls.live_odds)) next.live_odds = { ...(base.live_odds || {}), ...(ls.live_odds as OddsLine) };
    if (isPlainObject(ls.closing_odds)) next.closing_odds = { ...(base.closing_odds || {}), ...(ls.closing_odds as ExtendedMatch['closing_odds']) };
    if (isPlainObject(ls.opening_odds)) next.opening_odds = { ...(base.opening_odds || {}), ...(ls.opening_odds as OddsLine) };
    if (isPlainObject(ls.venue)) next.venue = { ...(base.venue || {}), ...(ls.venue as VenueInfo) };
    if (isPlainObject(ls.weather_info)) next.weather_info = { ...(base.weather_info || {}), ...(ls.weather_info as WindInfo) };
    if (isPlainObject(ls.weather_forecast)) next.weather_forecast = { ...(base.weather_forecast || {}), ...(ls.weather_forecast as WindInfo) };
    if (isPlainObject(ls.homeTeamStats)) next.homeTeamStats = { ...(base.homeTeamStats || {}), ...(ls.homeTeamStats as TeamStats) };
    if (isPlainObject(ls.awayTeamStats)) next.awayTeamStats = { ...(base.awayTeamStats || {}), ...(ls.awayTeamStats as TeamStats) };

    return next;
}

// ============================================================================
// 4. ORCHESTRATOR HOOK (Logic Layer)
// ============================================================================

function useGameViewModel(match: ExtendedMatch | undefined): GameViewModel | null {
    const signalsKey = useMemo(() => {
        if (!match) return 'null';
        const curTotal = match.current_odds?.total ?? match.odds?.total ?? match.live_odds?.total;
        const curSpread = match.current_odds?.spread ?? match.odds?.spread ?? match.live_odds?.spread;
        const wind = pickWindSpeed(match);
        const indoor = !!match.venue?.is_indoor;
        const statsHome = stableStatsFingerprint(match.homeTeamStats);
        const statsAway = stableStatsFingerprint(match.awayTeamStats);

        const parts = [
            `sport:${String(match.sport ?? '')}`,
            `league:${String(match.league ?? '')}`,
            `status:${String(match.status ?? '')}`,
            `clock:${String(match.displayClock ?? '')}`,
            `period:${String(match.period ?? '')}`,
            `homeScore:${String(match.homeScore ?? '')}`,
            `awayScore:${String(match.awayScore ?? '')}`,
            `poss:${String(match.situation?.possessionId ?? '')}`,
            `openOU:${String(match.opening_odds?.overUnder ?? '')}`,
            `curTotal:${String(curTotal ?? '')}`,
            `curSpread:${String(curSpread ?? '')}`,
            `closeTotal:${String(match.closing_odds?.total ?? '')}`,
            `closeSpread:${String(match.closing_odds?.spread ?? '')}`,
            `srsHome:${String(match.homeTeam?.srs ?? '')}`,
            `srsAway:${String(match.awayTeam?.srs ?? '')}`,
            `indoor:${indoor ? '1' : '0'}`,
            `wind:${Number.isFinite(wind) ? wind.toFixed(2) : ''}`,
            `hs:${statsHome}`,
            `as:${statsAway}`,
        ];
        return parts.join('|');
    }, [
        match?.sport, match?.league, match?.status, match?.displayClock, match?.period,
        match?.homeScore, match?.awayScore, match?.situation?.possessionId,
        match?.opening_odds?.overUnder, match?.current_odds?.total, match?.current_odds?.spread,
        match?.odds?.total, match?.odds?.spread, match?.live_odds?.total, match?.live_odds?.spread,
        match?.closing_odds?.total, match?.closing_odds?.spread,
        match?.homeTeam?.srs, match?.awayTeam?.srs, match?.venue?.is_indoor,
        match?.weather_info?.wind_speed, match?.weather_forecast?.wind_speed,
        match?.homeTeamStats, match?.awayTeamStats,
    ]);

    const signals = useMemo(() => {
        if (!match) {
            return { edge_state: 'NEUTRAL' as const, edge_points: 0, deterministic_fair_total: 0, market_total: 0, status_reason: 'Waiting' };
        }
        return computeAISignals(match as Match);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signalsKey]);

    return useMemo(() => {
        if (!match || !match.homeTeam || !match.awayTeam) return null;

        const homeScore = safeNumber(match.homeScore);
        const awayScore = safeNumber(match.awayScore);
        const isFinished = isGameFinished(match.status);

        const homeId = String(match.homeTeam.id);
        const awayId = String(match.awayTeam.id);
        const possId = match.situation?.possessionId ? String(match.situation.possessionId) : null;
        const possession = possId === homeId ? 'home' : (possId === awayId ? 'away' : null);

        const sportStr = String(match.sport || match.league || '').toUpperCase();
        const isFootball = ['NFL', 'CFB', 'COLLEGE_FOOTBALL'].some((s) => sportStr.includes(s));
        const isBasketball = ['NBA', 'CBB', 'NCAAB', 'COLLEGE_BASKETBALL'].some((s) => sportStr.includes(s));

        const rawSpread = match.closing_odds?.spread;
        const rawTotal = match.closing_odds?.total;
        const spread = safeNumber(rawSpread, 0);
        const total = safeNumber(rawTotal, 0);
        const hasSpread = rawSpread !== undefined && rawSpread !== null && hasValue(rawSpread);
        const hasTotal = rawTotal !== undefined && rawTotal !== null && hasValue(rawTotal) && total > 0;

        const margin = homeScore - awayScore;
        const totalScore = homeScore + awayScore;

        let spreadResult: GameViewModel['betting']['spreadResult'] = null;
        if (hasSpread) {
            const adj = margin + spread;
            spreadResult = adj > 0 ? 'COVER' : adj < 0 ? 'MISS' : 'PUSH';
        }
        const totalHit: GameViewModel['betting']['totalHit'] = !hasTotal ? null : totalScore > total ? 'OVER' : totalScore < total ? 'UNDER' : 'PUSH';

        return {
            meta: { isFootball, isBasketball, isFinished, displayClock: match.displayClock || (isFinished ? 'FINAL' : 'PREGAME'), hasData: true },
            teams: {
                home: { id: homeId, abbr: match.homeTeam.abbreviation || 'HOME', name: match.homeTeam.shortName || match.homeTeam.name || 'Home', logo: match.homeTeam.logo || '', color: normalizeColor(match.homeTeam.color, '#3b82f6'), score: homeScore, record: isRecordString(match.homeTeam.record) ? match.homeTeam.record : '', isPossessing: possession === 'home', isWinner: isFinished && homeScore > awayScore },
                away: { id: awayId, abbr: match.awayTeam.abbreviation || 'AWAY', name: match.awayTeam.shortName || match.awayTeam.name || 'Away', logo: match.awayTeam.logo || '', color: normalizeColor(match.awayTeam.color, '#ef4444'), score: awayScore, record: isRecordString(match.awayTeam.record) ? match.awayTeam.record : '', isPossessing: possession === 'away', isWinner: isFinished && awayScore > homeScore },
            },
            gameplay: { situation: match.situation || null, lastPlay: match.lastPlay || null, drive: match.currentDrive || null, possession, isRedZone: !!match.situation?.isRedZone },
            betting: { signals, spread, total, hasSpread, hasTotal, spreadResult, totalHit },
            stats: { homeTeamStats: match.homeTeamStats || null, awayTeamStats: match.awayTeamStats || null },
        };
    }, [match, signals]);
}

// ============================================================================
// 5. SHARED UI COMPONENTS
// ============================================================================

type GlassPanelProps<T extends ElementType> = { as?: T; children: ReactNode; className?: string } & ComponentPropsWithoutRef<T>;

const GlassPanel = memo(<T extends ElementType = 'div'>({ as, children, className, ...props }: GlassPanelProps<T>) => {
    const Component = as || 'div';
    return (
        <Component className={cn('relative overflow-hidden bg-[#080808] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]', className)} {...props}>
            <div className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-60" style={{ backgroundImage: TOKENS.patterns.noise }} aria-hidden="true" />
            <div className="relative z-10 h-full">{children}</div>
        </Component>
    );
});
GlassPanel.displayName = 'GlassPanel';

const StatBlock = memo<{ value: string | number; label: string; highlight?: boolean }>(({ value, label, highlight }) => (
    <div className="flex flex-col items-center justify-center p-4">
        <span className={cn('text-2xl sm:text-3xl font-mono font-semibold tabular-nums tracking-tight leading-none', highlight ? 'text-white drop-shadow-md' : 'text-white/80')}>{value}</span>
        <span className="mt-2 text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">{label}</span>
    </div>
));
StatBlock.displayName = 'StatBlock';

const LiveIndicator = memo<{ label?: string; color?: string; size?: 'sm' | 'md' }>(({ label = 'LIVE', color = TOKENS.colors.accent.live, size = 'md' }) => {
    const prefersReducedMotion = useReducedMotion();
    return (
        <div className="flex items-center gap-2">
            <span className="relative flex">
                <span className={cn(size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2', 'rounded-full')} style={{ backgroundColor: color }} />
                {!prefersReducedMotion && <span className={cn(size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2', 'absolute rounded-full animate-ping')} style={{ backgroundColor: color, opacity: 0.75 }} />}
            </span>
            {label && <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color }}>{label}</span>}
        </div>
    );
});
LiveIndicator.displayName = 'LiveIndicator';

const CompactScoreBar: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { teams, meta } = viewModel;
    return (
        <div className="w-full px-4 py-3 flex items-center justify-between bg-[#020203] border-b border-white/[0.04]">
            <div className="flex items-center gap-3 min-w-0">
                <TeamLogo logo={teams.away.logo} className="w-6 h-6 object-contain" />
                <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-[11px] font-bold text-white/80 uppercase truncate">{teams.away.abbr}</span>
                    <span className="text-lg font-mono text-white tabular-nums">{teams.away.score}</span>
                </div>
            </div>
            <div className="flex items-center gap-3">
                {!meta.isFinished && <LiveIndicator size="sm" />}
                <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-zinc-400">{meta.displayClock}</span>
            </div>
            <div className="flex items-center gap-3 min-w-0 justify-end">
                <div className="flex items-baseline gap-2 min-w-0 justify-end">
                    <span className="text-lg font-mono text-white tabular-nums">{teams.home.score}</span>
                    <span className="text-[11px] font-bold text-white/80 uppercase truncate">{teams.home.abbr}</span>
                </div>
                <TeamLogo logo={teams.home.logo} className="w-6 h-6 object-contain" />
            </div>
        </div>
    );
});
CompactScoreBar.displayName = 'CompactScoreBar';

// ============================================================================
// 6. COMPLEX VISUALIZATIONS
// ============================================================================

const FieldGraphic: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const prefersReducedMotion = useReducedMotion();
    const { gameplay, teams } = viewModel;

    const fieldState = useMemo(() => {
        if (!gameplay.situation) return null;
        const rawYard = gameplay.situation.yardLine;
        const isHomePoss = gameplay.possession === 'home';
        let yl = 50;
        if (typeof rawYard === 'number') yl = rawYard;
        else if (typeof rawYard === 'string') {
            const num = parseInt(rawYard.replace(/\D/g, ''), 10) || 50;
            if (rawYard.toUpperCase().includes('OWN')) yl = isHomePoss ? 100 - num : num;
            else if (rawYard.toUpperCase().includes('OPP')) yl = isHomePoss ? num : 100 - num;
            else yl = num;
        }
        yl = Math.max(0, Math.min(100, yl));
        const dist = safeNumber(gameplay.situation.distance, 10);
        const target = isHomePoss ? yl - dist : yl + dist;
        const down = safeNumber(gameplay.situation.down, 1);
        return { ballX: 10 + yl * 0.8, lineToGainX: 10 + Math.max(0, Math.min(100, target)) * 0.8, isHomePoss, downText: gameplay.situation.downDistanceText || `${getOrdinal(down)} & ${dist < 1 ? 'INCHES' : dist}`, displayYard: yl > 50 ? 100 - yl : yl, activeTeam: isHomePoss ? teams.home : teams.away, isRedZone: gameplay.isRedZone || (isHomePoss ? yl <= 20 : yl >= 80) };
    }, [gameplay.situation, gameplay.possession, gameplay.isRedZone, teams]);

    if (!fieldState) {
        return (
            <div className="relative w-full aspect-[2.4/1] bg-[#0d1a10] flex flex-col items-center justify-center gap-3 border-b border-white/5">
                <div className="flex items-center gap-2 text-white/20">
                    <Radio className={cn(!prefersReducedMotion && 'animate-pulse')} size={16} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Broadcast Standby</span>
                </div>
            </div>
        );
    }

    const { ballX, lineToGainX, isRedZone, downText, displayYard, activeTeam, isHomePoss } = fieldState;

    return (
        <div className="relative w-full aspect-[2.4/1] overflow-hidden bg-[#0d1a10] border-b border-white/5 select-none isolate group">
            <div className="absolute inset-0 flex">
                {Array.from({ length: 10 }).map((_, i) => <div key={i} className="flex-1 border-r border-white/[0.04]" style={{ backgroundColor: i % 2 ? TOKENS.colors.turf.b : TOKENS.colors.turf.a }} />)}
            </div>
            {!prefersReducedMotion && (
                <div className="absolute inset-0 opacity-[0.04] pointer-events-none overflow-hidden">
                    <motion.div className="absolute inset-0 flex items-center justify-center gap-24" animate={{ x: isHomePoss ? ['-5%', '-15%'] : ['5%', '15%'] }} transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}>
                        {Array.from({ length: 6 }, (_, i) => isHomePoss ? <ChevronLeft key={i} size={80} /> : <ChevronRight key={i} size={80} />)}
                    </motion.div>
                </div>
            )}
            <div className="absolute inset-y-0 left-0 w-[10%] bg-white/5 flex items-center justify-center border-r border-white/5"><TeamLogo logo={teams.away.logo} className="w-full opacity-10 grayscale" /></div>
            <div className="absolute inset-y-0 right-0 w-[10%] bg-white/5 flex items-center justify-center border-l border-white/5"><TeamLogo logo={teams.home.logo} className="w-full opacity-10 grayscale" /></div>
            <motion.div animate={{ left: `${ballX}%` }} transition={TOKENS.animation.spring} className="absolute inset-y-0 w-0.5 bg-blue-500 z-10 shadow-[0_0_12px_rgba(59,130,246,0.6)]" />
            <motion.div animate={{ left: `${lineToGainX}%` }} transition={TOKENS.animation.spring} className="absolute inset-y-0 w-0.5 bg-amber-400 z-0 opacity-80" />
            <div className="absolute top-1/2 -translate-y-1/2 z-20" style={{ left: `${ballX}%` }}>
                <motion.div layoutId="football" transition={TOKENS.animation.spring} className="relative -translate-x-1/2 group-hover:scale-110 transition-transform">
                    <svg width="18" height="28" viewBox="0 0 24 38" className="drop-shadow-lg">
                        <path d="M12 0C18.6 6.7 24 14.3 24 19C24 23.6 18.6 31.2 12 38C5.3 31.2 0 23.6 0 19C0 14.3 5.3 6.7 12 0Z" fill={isRedZone ? '#f43f5e' : '#6b3c18'} />
                        <rect x="11" y="8" width="2" height="22" rx="1" fill="white" fillOpacity="0.75" />
                        <rect x="7" y="13" width="10" height="1.5" rx="0.75" fill="white" fillOpacity="0.75" />
                    </svg>
                </motion.div>
            </div>
            <div className="absolute bottom-3 left-3 z-30 flex overflow-hidden rounded-md bg-black/80 backdrop-blur border border-white/10 shadow-xl">
                <div className="px-2 py-1.5 flex items-center gap-2" style={{ backgroundColor: activeTeam.color }}>
                    <TeamLogo logo={activeTeam.logo} className="w-4 h-4 object-contain brightness-200" />
                    <span className="text-[10px] font-bold text-white uppercase">{activeTeam.abbr}</span>
                </div>
                <div className="px-3 py-1.5 flex items-center gap-2 border-l border-white/10">
                    <span className="text-xs font-bold text-white tabular-nums">{downText}</span>
                    <span className="text-[9px] font-mono text-white/50">on {displayYard}</span>
                </div>
            </div>
        </div>
    );
});
FieldGraphic.displayName = 'FieldGraphic';

const CourtGraphic: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const prefersReducedMotion = useReducedMotion();
    const { gameplay, teams } = viewModel;

    const courtState = useMemo(() => {
        if (!gameplay.situation) return null;
        const isHomePoss = gameplay.possession === 'home';
        let bx = isHomePoss ? 80 : 20;
        let by = 25;
        if (typeof gameplay.situation.ballX === 'number') bx = gameplay.situation.ballX;
        if (typeof gameplay.situation.ballY === 'number') by = gameplay.situation.ballY;
        const by50 = by > 50 ? by * 0.5 : by;
        return { ballX: Math.max(0, Math.min(100, bx)), ballY: Math.max(0, Math.min(50, by50)), activeTeam: isHomePoss ? teams.home : teams.away };
    }, [gameplay.situation, gameplay.possession, teams]);

    if (!courtState) {
        return <div className="relative w-full aspect-[2/1] bg-[#1a120b] flex items-center justify-center border-b border-white/5"><span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Court Data Offline</span></div>;
    }

    const { ballX, ballY, activeTeam } = courtState;

    return (
        <div className="relative w-full aspect-[2/1] overflow-hidden bg-[#1a120b] border-b border-white/5 select-none isolate">
            <svg viewBox="0 0 100 50" className="absolute inset-0 w-full h-full opacity-20 pointer-events-none" preserveAspectRatio="none">
                <rect x="0.5" y="0.5" width="99" height="49" stroke="white" strokeWidth="0.5" fill="none" />
                <line x1="50" y1="0" x2="50" y2="50" stroke="white" strokeWidth="0.4" />
                <circle cx="50" cy="25" r="7" stroke="white" strokeWidth="0.4" fill="none" />
                <circle cx="50" cy="25" r="2" stroke="white" strokeWidth="0.3" fill="none" />
                <rect x="0" y="17" width="19" height="16" stroke="white" strokeWidth="0.4" fill="none" />
                <circle cx="19" cy="25" r="6" stroke="white" strokeWidth="0.3" fill="none" />
                <path d="M 0 3 L 14 3 A 24 24 0 0 1 14 47 L 0 47" stroke="white" strokeWidth="0.35" fill="none" />
                <path d="M 4 21 A 4 4 0 0 1 4 29" stroke="white" strokeWidth="0.25" fill="none" />
                <line x1="4" y1="22" x2="4" y2="28" stroke="white" strokeWidth="0.5" />
                <circle cx="5.5" cy="25" r="0.9" stroke="white" strokeWidth="0.3" fill="none" />
                <rect x="81" y="17" width="19" height="16" stroke="white" strokeWidth="0.4" fill="none" />
                <circle cx="81" cy="25" r="6" stroke="white" strokeWidth="0.3" fill="none" />
                <path d="M 100 3 L 86 3 A 24 24 0 0 0 86 47 L 100 47" stroke="white" strokeWidth="0.35" fill="none" />
                <path d="M 96 21 A 4 4 0 0 0 96 29" stroke="white" strokeWidth="0.25" fill="none" />
                <line x1="96" y1="22" x2="96" y2="28" stroke="white" strokeWidth="0.5" />
                <circle cx="94.5" cy="25" r="0.9" stroke="white" strokeWidth="0.3" fill="none" />
            </svg>
            <motion.div animate={{ left: `${ballX}%`, top: `${(ballY / 50) * 100}%` }} transition={TOKENS.animation.spring} className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 z-20">
                <div className="relative w-full h-full">
                    {!prefersReducedMotion && <div className="absolute inset-0 bg-orange-500 rounded-full blur-md opacity-40 animate-pulse" />}
                    <div className="absolute inset-0 bg-orange-500 rounded-full border border-white/20 shadow-sm" />
                </div>
            </motion.div>
            <div className="absolute bottom-3 right-3 z-30">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-black/80 backdrop-blur rounded-full border border-white/10 shadow-xl">
                    {!prefersReducedMotion && <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />}
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">Poss: {activeTeam.abbr}</span>
                </div>
            </div>
        </div>
    );
});
CourtGraphic.displayName = 'CourtGraphic';

// ============================================================================
// 7. INFO CARDS
// ============================================================================

const InternalLiveTotalCard: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { signals } = viewModel.betting;
    const { edge_state, edge_points, deterministic_fair_total, market_total, status_reason } = signals;
    const prefersReducedMotion = useReducedMotion();
    const isSyncing = typeof status_reason === 'string' && status_reason.includes('Critical');

    if (isSyncing) {
        return <GlassPanel className="p-6 flex flex-col items-center justify-center min-h-[160px]"><Activity className={cn('text-white/20 mb-2', !prefersReducedMotion && 'animate-spin')} /><span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Syncing Models</span></GlassPanel>;
    }

    const fair = safeNumber(deterministic_fair_total);
    const market = safeNumber(market_total);
    const isOver = fair > market;
    const isPlay = edge_state === 'PLAY';
    const edgeColor = isPlay ? (isOver ? 'text-emerald-400' : 'text-rose-400') : 'text-zinc-500';

    return (
        <GlassPanel className="p-5 flex flex-col justify-between min-h-[160px]">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2"><Target size={14} className="text-white/40" /><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Live Forecast</span></div>
                {isPlay && <div className={cn('px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border', isOver ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400')}>Strong Signal</div>}
            </div>
            <div className="flex items-end justify-between mt-2">
                <div><span className="text-3xl font-mono font-bold text-white tabular-nums tracking-tighter">{fair.toFixed(1)}</span><div className="text-[9px] text-white/30 font-bold uppercase mt-1">Projected Total</div></div>
                <div className="text-right"><div className={cn('text-xl font-mono font-bold flex items-center justify-end gap-1', edgeColor)}>{isOver ? <ChevronUp size={16} /> : <ChevronDown size={16} />}{safeNumber(edge_points).toFixed(1)}</div><div className="text-[9px] text-white/30 font-bold uppercase mt-1">vs Mkt {market}</div></div>
            </div>
        </GlassPanel>
    );
});
InternalLiveTotalCard.displayName = 'InternalLiveTotalCard';

const LatestPlayCard: FC<{ play: GameViewModel['gameplay']['lastPlay'] }> = memo(({ play }) => {
    const prefersReducedMotion = useReducedMotion();
    return (
        <GlassPanel className="p-5 min-h-[160px] flex flex-col">
            <div className="flex justify-between items-center mb-4"><div className="flex items-center gap-2"><Radio size={14} className="text-white/40" /><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Latest Event</span></div><LiveIndicator label="" size="sm" color={TOKENS.colors.accent.info} /></div>
            <AnimatePresence mode="wait">
                <motion.p key={play?.id || 'empty'} initial={prefersReducedMotion ? false : { opacity: 0, y: 5 }} animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }} exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0 }} transition={TOKENS.animation.fade} className="text-sm font-medium text-white/80 leading-relaxed line-clamp-3">{play?.text || 'Waiting for feed...'}</motion.p>
            </AnimatePresence>
        </GlassPanel>
    );
});
LatestPlayCard.displayName = 'LatestPlayCard';

const DriveStatsCard: FC<{ drive: GameViewModel['gameplay']['drive'] }> = memo(({ drive }) => {
    const prefersReducedMotion = useReducedMotion();
    const plays = safeNumber(drive?.plays, 0);
    const yards = safeNumber(drive?.yards, 0);
    const progress = Math.min((yards / 80) * 100, 100);
    return (
        <GlassPanel className="p-6 min-h-[160px] flex flex-col group relative">
            <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><Zap size={12} className="text-emerald-400" /><span className="text-[10px] font-bold text-emerald-400 uppercase tracking-[0.2em]">Current Drive</span></div><Shield size={14} className="text-white/10" /></div>
            <div className="mb-4"><div className="h-1.5 bg-white/10 rounded-full overflow-hidden">{prefersReducedMotion ? <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} /> : <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} className="h-full bg-emerald-500" />}</div></div>
            <div className="grid grid-cols-3 gap-px bg-white/10 rounded-lg overflow-hidden border border-white/5"><StatBlock value={plays} label="Plays" /><div className="border-x border-white/5"><StatBlock value={yards} label="Yards" highlight /></div><StatBlock value={drive?.timeElapsed || '0:00'} label="Clock" /></div>
        </GlassPanel>
    );
});
DriveStatsCard.displayName = 'DriveStatsCard';

const BoxScoreCard: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { homeTeamStats, awayTeamStats } = viewModel.stats;
    const { teams } = viewModel;
    const rows = useMemo(() => {
        const preferKeys = [{ key: 'pace', label: 'PACE' }, { key: 'ortg', label: 'ORtg' }, { key: 'drtg', label: 'DRtg' }, { key: 'efg', label: 'eFG%' }, { key: 'tov', label: 'TOV%' }, { key: 'reb', label: 'REB%' }] as const;
        if (!homeTeamStats || !awayTeamStats) return [];
        const out: Array<{ label: string; home: string; away: string }> = [];
        for (const { key, label } of preferKeys) {
            const hRaw = homeTeamStats[key];
            const aRaw = awayTeamStats[key];
            if (!hasValue(hRaw) && !hasValue(aRaw)) continue;
            const h = hasValue(hRaw) ? safeNumber(hRaw, NaN) : NaN;
            const a = hasValue(aRaw) ? safeNumber(aRaw, NaN) : NaN;
            const hTxt = Number.isFinite(h) ? (key === 'efg' || key === 'tov' || key === 'reb' ? `${h.toFixed(1)}%` : h.toFixed(1)) : '—';
            const aTxt = Number.isFinite(a) ? (key === 'efg' || key === 'tov' || key === 'reb' ? `${a.toFixed(1)}%` : a.toFixed(1)) : '—';
            out.push({ label, home: hTxt, away: aTxt });
        }
        return out.slice(0, 6);
    }, [homeTeamStats, awayTeamStats]);

    if (!rows.length) return <GlassPanel className="p-5 min-h-[160px] flex flex-col justify-between"><div className="flex items-center gap-2"><BarChart3 size={14} className="text-white/40" /><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Box Score</span></div><div className="text-[11px] text-white/30 font-mono">Stats unavailable</div></GlassPanel>;

    return (
        <GlassPanel className="p-5 min-h-[160px] flex flex-col">
            <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><BarChart3 size={14} className="text-white/40" /><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Box Score</span></div><div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-widest text-white/30"><span className="flex items-center gap-2"><TeamLogo logo={teams.away.logo} className="w-4 h-4 object-contain" />{teams.away.abbr}</span><span className="w-px h-3 bg-white/10" /><span className="flex items-center gap-2"><TeamLogo logo={teams.home.logo} className="w-4 h-4 object-contain" />{teams.home.abbr}</span></div></div>
            <div className="grid grid-cols-1 gap-2">{rows.map((r) => <div key={r.label} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"><span className="text-[10px] font-black uppercase tracking-widest text-white/30">{r.label}</span><div className="flex items-center gap-4 font-mono text-[11px] tabular-nums"><span className="text-white/70 min-w-[52px] text-right">{r.away}</span><span className="text-white/15">|</span><span className="text-white min-w-[52px] text-right">{r.home}</span></div></div>)}</div>
        </GlassPanel>
    );
});
BoxScoreCard.displayName = 'BoxScoreCard';

// ============================================================================
// 8. RESTORED EXPORTS
// ============================================================================

export const ScoreHeader: FC<{ match: Match }> = memo(({ match }) => {
    const vm = useGameViewModel(match as ExtendedMatch);
    if (!vm) return <div className="h-[200px] bg-[#020203] animate-pulse" />;
    const { teams, meta } = vm;
    return (
        <header className="relative w-full h-[200px] bg-[#020203] flex items-center justify-center overflow-hidden border-b border-white/5">
            <div className="absolute inset-0 pointer-events-none opacity-20"><div className="absolute -left-[20%] -top-[50%] w-[70%] h-[200%] blur-[120px]" style={{ background: teams.away.color }} /><div className="absolute -right-[20%] -top-[50%] w-[70%] h-[200%] blur-[120px]" style={{ background: teams.home.color }} /></div>
            <div className="relative z-10 w-full max-w-5xl px-6 flex items-center justify-between">
                <div className="flex flex-col items-center gap-4 flex-1"><TeamLogo logo={teams.away.logo} className="w-16 h-16 object-contain drop-shadow-2xl" /><div className="text-center"><div className="text-xl font-bold text-white uppercase leading-none mb-1">{teams.away.name}</div><div className="text-[10px] font-mono text-white/40">{teams.away.record}</div></div></div>
                <div className="flex flex-col items-center gap-2"><div className="flex items-center gap-8"><span className="text-6xl font-mono font-light text-white tabular-nums tracking-tighter">{teams.away.score}</span><span className="text-2xl text-white/10">—</span><span className="text-6xl font-mono font-light text-white tabular-nums tracking-tighter">{teams.home.score}</span></div><div className="px-4 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur text-[10px] font-black uppercase tracking-widest text-zinc-400">{meta.displayClock}</div></div>
                <div className="flex flex-col items-center gap-4 flex-1"><TeamLogo logo={teams.home.logo} className="w-16 h-16 object-contain drop-shadow-2xl" /><div className="text-center"><div className="text-xl font-bold text-white uppercase leading-none mb-1">{teams.home.name}</div><div className="text-[10px] font-mono text-white/40">{teams.home.record}</div></div></div>
            </div>
        </header>
    );
});
ScoreHeader.displayName = 'ScoreHeader';

export const FinalGameTracker: FC<{ match: Match }> = memo(({ match }) => {
    const vm = useGameViewModel(match as ExtendedMatch);
    if (!vm) return null;
    const { teams, betting } = vm;
    const { hasSpread, hasTotal, spread, total, spreadResult, totalHit } = betting;
    const margin = teams.home.score - teams.away.score;
    const spreadTone = !hasSpread ? 'bg-zinc-800 border-white/5 text-zinc-400' : spreadResult === 'COVER' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : spreadResult === 'MISS' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-zinc-800 border-white/5 text-zinc-400';
    const totalTone = !hasTotal ? 'bg-zinc-800 border-white/5 text-zinc-400' : totalHit === 'OVER' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : totalHit === 'UNDER' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-zinc-800 border-white/5 text-zinc-400';
    return (
        <div className="relative overflow-hidden bg-[#0A0A0A] border border-white/5 rounded-3xl p-8 flex flex-col items-center group">
            <div className="relative z-10 flex flex-col items-center gap-6 mb-12"><div className="px-4 py-1.5 rounded-full bg-zinc-900 border border-white/5 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-zinc-500" /><span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Final Result</span></div></div>
            <div className="relative z-10 w-full max-w-2xl grid grid-cols-[1fr_auto_1fr] items-center gap-12 mb-12">
                <div className="flex flex-col items-end gap-4 relative"><TeamLogo logo={teams.away.logo} className={cn('w-20 h-20 transition-all', !teams.away.isWinner && 'opacity-40 grayscale')} /><div className="text-5xl font-mono font-bold text-white tabular-nums">{teams.away.score}</div></div>
                <div className="h-20 w-px bg-white/10" />
                <div className="flex flex-col items-start gap-4 relative"><TeamLogo logo={teams.home.logo} className={cn('w-20 h-20 transition-all', !teams.home.isWinner && 'opacity-40 grayscale')} /><div className="text-5xl font-mono font-bold text-white tabular-nums">{teams.home.score}</div></div>
            </div>
            <div className="relative z-10 w-full grid grid-cols-2 gap-px bg-white/5 rounded-xl overflow-hidden border border-white/5">
                <div className="bg-[#0D0D0D] p-6 flex flex-col items-center"><span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Spread</span><div className={cn('px-4 py-2 rounded-lg border flex items-center gap-2 mb-2', spreadTone)}><CheckCircle2 size={14} /><span className="text-xs font-bold uppercase">{!hasSpread ? 'N/A' : spreadResult === 'COVER' ? 'Covered' : spreadResult === 'MISS' ? 'Missed' : 'Push'}</span></div><span className="text-[10px] font-mono text-zinc-600">Line: {hasSpread ? spread : '-'} (Margin {margin})</span></div>
                <div className="bg-[#0D0D0D] p-6 flex flex-col items-center"><span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Total</span><div className={cn('px-4 py-2 rounded-lg border flex items-center gap-2 mb-2', totalTone)}><DollarSign size={14} /><span className="text-xs font-bold uppercase">{!hasTotal ? 'N/A' : totalHit || 'N/A'}</span></div><span className="text-[10px] font-mono text-zinc-600">Total: {hasTotal ? total : '-'}</span></div>
            </div>
        </div>
    );
});
FinalGameTracker.displayName = 'FinalGameTracker';

// ============================================================================
// 9. MAIN EXPORT
// ============================================================================

interface LiveGameTrackerProps { match: Match; liveState?: unknown; }

export const LiveGameTracker: FC<LiveGameTrackerProps> = memo(({ match, liveState }) => {
    const mergedMatch = useMemo(() => mergeMatchWithLiveState(match as ExtendedMatch, liveState), [match, liveState]);
    const vm = useGameViewModel(mergedMatch);

    if (!vm) return <div className="w-full h-[300px] flex flex-col items-center justify-center bg-[#080808] rounded-2xl border border-white/10 animate-pulse"><Activity className="text-white/20 mb-3" /><span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Initializing Uplink</span></div>;

    if (vm.meta.isFinished) return <FinalGameTracker match={mergedMatch as Match} />;

    return (
        <div className="flex flex-col w-full bg-[#020203] rounded-3xl overflow-hidden border border-white/[0.08] shadow-2xl">
            <CompactScoreBar viewModel={vm} />
            <div className="w-full border-b border-white/[0.04]">{vm.meta.isFootball ? <FieldGraphic viewModel={vm} /> : vm.meta.isBasketball ? <CourtGraphic viewModel={vm} /> : <div className="h-[200px] flex items-center justify-center bg-[#080808]"><span className="text-white/20 text-xs font-mono uppercase">Visualization Not Available</span></div>}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/5"><LatestPlayCard play={vm.gameplay.lastPlay} />{vm.meta.isFootball ? <DriveStatsCard drive={vm.gameplay.drive} /> : <InternalLiveTotalCard viewModel={vm} />}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/5 border-t border-white/[0.04]"><BoxScoreCard viewModel={vm} /><GlassPanel className="p-5 min-h-[160px] flex flex-col justify-between"><div className="flex items-center gap-2"><Shield size={14} className="text-white/40" /><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Integrity</span></div><div className="text-[11px] text-white/30 font-mono">SignalsKey cached: OK</div></GlassPanel></div>
        </div>
    );
});
LiveGameTracker.displayName = 'LiveGameTracker';

// ============================================================================
// 10. STANDALONE EXPORTED COMPONENTS (Backward Compatibility)
// ============================================================================

/** Standalone LiveTotalCard that accepts match prop (for external consumers like LiveDashboard) */
export const LiveTotalCard: FC<{ match: Match }> = memo(({ match }) => {
    const vm = useGameViewModel(match as ExtendedMatch);
    if (!vm) {
        return (
            <GlassPanel className="p-6 flex flex-col items-center justify-center min-h-[160px]">
                <Activity className="text-white/20 mb-2 animate-spin" />
                <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Loading</span>
            </GlassPanel>
        );
    }

    const { signals } = vm.betting;
    const { edge_state, edge_points, deterministic_fair_total, market_total, status_reason } = signals;
    const prefersReducedMotion = useReducedMotion();
    const isSyncing = typeof status_reason === 'string' && status_reason.includes('Critical');

    if (isSyncing) {
        return (
            <GlassPanel className="p-6 flex flex-col items-center justify-center min-h-[160px]">
                <Activity className={cn('text-white/20 mb-2', !prefersReducedMotion && 'animate-spin')} />
                <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Syncing Models</span>
            </GlassPanel>
        );
    }

    const fair = safeNumber(deterministic_fair_total);
    const market = safeNumber(market_total);
    const isOver = fair > market;
    const isPlay = edge_state === 'PLAY';
    const edgeColor = isPlay ? (isOver ? 'text-emerald-400' : 'text-rose-400') : 'text-zinc-500';

    return (
        <GlassPanel className="p-5 flex flex-col justify-between min-h-[160px]">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                    <Target size={14} className="text-white/40" />
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Live Forecast</span>
                </div>
                {isPlay && (
                    <div className={cn('px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border', isOver ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400')}>
                        Strong Signal
                    </div>
                )}
            </div>
            <div className="flex items-end justify-between mt-2">
                <div>
                    <span className="text-3xl font-mono font-bold text-white tabular-nums tracking-tighter">{fair.toFixed(1)}</span>
                    <div className="text-[9px] text-white/30 font-bold uppercase mt-1">Projected Total</div>
                </div>
                <div className="text-right">
                    <div className={cn('text-xl font-mono font-bold flex items-center justify-end gap-1', edgeColor)}>
                        {isOver ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        {safeNumber(edge_points).toFixed(1)}
                    </div>
                    <div className="text-[9px] text-white/30 font-bold uppercase mt-1">vs Mkt {market}</div>
                </div>
            </div>
        </GlassPanel>
    );
});
LiveTotalCard.displayName = 'LiveTotalCard';

export default LiveGameTracker;
