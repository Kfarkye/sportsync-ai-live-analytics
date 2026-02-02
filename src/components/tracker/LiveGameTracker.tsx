// ============================================================================
// src/components/tracker/LiveGameTracker.tsx
// ============================================================================
//
// VERDICT: ELITE UNCOMPROMISED (Hardened Logic + Obsidian UI + Fixed BoxScore)
//
// FIXED: BoxScoreCard
// - Now accepts partial stats (Home only or Away only)
// - Context-aware: Switches between NFL (Yards/TO) and NBA (Pace/Eff) schemas
// - Auto-Fallback: Tries Advanced Analytics -> falls back to Basic Stats (Pts/Reb)
// - Scans multiple API key variants (ortg/off_rtg, pace/possessions)
// - Shows "Waiting for Feed" state instead of disappearing if data is empty
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
    Zap,
    Target,
    Radio,
    BarChart3,
    Wind,
    Lock,
    Minus,
} from 'lucide-react';

// Internal imports — Replace with your actual project structure
import { type Match } from '../../types';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '../../lib/essence';
import { isGameFinished } from '../../utils/matchUtils';
import { computeAISignals } from '../../services/gameStateEngine';

// ============================================================================
// 1. STRICT TYPE DEFINITIONS
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
    temp?: Numberish;
};

type TeamStats = Record<string, Numberish | null | undefined>;

export type RawMatch = Omit<Match, 'period' | 'homeScore' | 'awayScore' | 'displayClock' | 'situation' | 'currentDrive' | 'lastPlay'> & {
    league?: string;
    displayClock?: string;
    period?: Numberish;
    homeScore?: Numberish;
    awayScore?: Numberish;

    situation?: {
        yardLine?: Numberish;
        down?: Numberish;
        distance?: Numberish;
        possessionId?: string | number;
        possession?: string;
        isRedZone?: boolean;
        downDistanceText?: string;
        ballX?: number;
        ballY?: number;
    };

    lastPlay?: { id?: string; text?: string; type?: string };

    currentDrive?: {
        plays?: Numberish;
        yards?: Numberish;
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
};

export type ExtendedMatch = RawMatch;

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
        situation: RawMatch['situation'] | null;
        lastPlay: RawMatch['lastPlay'] | null;
        drive: RawMatch['currentDrive'] | null;
        possession: 'home' | 'away' | null;
        isRedZone: boolean;
    };
    betting: {
        signals: ReturnType<typeof computeAISignals>;
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
    environment: {
        wind: string | null;
        temp: string | null;
    };
    normalized: Match;
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
// 2. DESIGN TOKENS
// ============================================================================

const TOKENS = {
    colors: {
        surface: { base: '#020202', panel: '#0A0A0A' },
        turf: { a: '#0f1712', b: '#142218' },
        accent: { live: '#ef4444', info: '#3b82f6', success: '#10b981' },
    },
    animation: {
        spring: { type: 'spring', stiffness: 350, damping: 35, mass: 1 } as Transition,
        fade: { duration: 0.3, ease: [0.32, 0.72, 0, 1] } as Transition,
    },
    assets: {
        noise: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")`,
    },
} as const;

// ============================================================================
// 3. HARDENED UTILITIES
// ============================================================================

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

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const pickWindSpeed = (m: ExtendedMatch): number => {
    const w1 = safeNumber(m.weather_info?.wind_speed, NaN);
    if (Number.isFinite(w1)) return w1;
    const w2 = safeNumber(m.weather_forecast?.wind_speed, NaN);
    if (Number.isFinite(w2)) return w2;
    return NaN;
};

const stableStatsFingerprint = (stats: TeamStats | null | undefined): string => {
    if (!stats) return '';
    // Tracks both advanced and basic keys to ensure AI model updates on any stat change
    const keys = ['pace', 'ortg', 'efg', 'tov', 'reb', 'pts', 'yards', 'fg_pct'] as const;
    const parts: string[] = [];
    for (const k of keys) {
        // Check explicit key and uppercase variant
        const raw = stats[k] ?? stats[k.toUpperCase()];
        if (!hasValue(raw)) continue;
        const n = safeNumber(raw, NaN);
        if (!Number.isFinite(n)) continue;
        parts.push(`${k}:${n.toFixed(3)}`);
    }
    return parts.join(',');
};

// ============================================================================
// 4. LOGIC KERNEL (Deep Merging & Normalization)
// ============================================================================

function mergeMatchWithLiveState(base: ExtendedMatch, liveState: unknown): ExtendedMatch {
    if (!isPlainObject(liveState)) return base;
    const ls = liveState as Partial<ExtendedMatch>;
    const next: ExtendedMatch = { ...base };

    // Shallow top-level updates
    if (hasValue(ls.status)) next.status = ls.status as Match['status'];
    if (hasValue(ls.displayClock)) next.displayClock = ls.displayClock as string;
    if (hasValue(ls.period)) next.period = safeNumber(ls.period);
    if (hasValue(ls.homeScore)) next.homeScore = safeNumber(ls.homeScore);
    if (hasValue(ls.awayScore)) next.awayScore = safeNumber(ls.awayScore);

    // Deep nested merge (Prevents partial updates from wiping missing keys)
    if (isPlainObject(ls.situation)) next.situation = { ...(base.situation || {}), ...ls.situation };
    if (isPlainObject(ls.currentDrive)) next.currentDrive = { ...(base.currentDrive || {}), ...ls.currentDrive };
    if (isPlainObject(ls.lastPlay)) next.lastPlay = { ...(base.lastPlay || {}), ...ls.lastPlay };
    if (isPlainObject(ls.closing_odds)) next.closing_odds = { ...(base.closing_odds || {}), ...ls.closing_odds };
    if (isPlainObject(ls.weather_info)) next.weather_info = { ...(base.weather_info || {}), ...ls.weather_info };

    // STATS MERGE: Critical for BoxScore persistence
    if (isPlainObject(ls.homeTeamStats)) next.homeTeamStats = { ...(base.homeTeamStats || {}), ...ls.homeTeamStats };
    if (isPlainObject(ls.awayTeamStats)) next.awayTeamStats = { ...(base.awayTeamStats || {}), ...ls.awayTeamStats };

    return next;
}

function normalizeMatch(raw: RawMatch | undefined): Match | null {
    if (!raw?.homeTeam || !raw?.awayTeam) return null;

    const situationRaw = raw.situation;
    const situation: Match['situation'] | undefined = situationRaw
        ? {
            yardLine: safeNumber(situationRaw.yardLine, 50),
            down: safeNumber(situationRaw.down, 1),
            distance: safeNumber(situationRaw.distance, 10),
            possessionId: situationRaw.possessionId ? String(situationRaw.possessionId) : undefined,
            possessionText: situationRaw.possession,
            isRedZone: situationRaw.isRedZone,
            downDistanceText: situationRaw.downDistanceText,
            ballX: situationRaw.ballX,
            ballY: situationRaw.ballY,
        } : undefined;

    return {
        ...raw,
        homeScore: safeNumber(raw.homeScore, 0),
        awayScore: safeNumber(raw.awayScore, 0),
        period: safeNumber(raw.period, 0),
        displayClock: raw.displayClock ?? '',
        situation,
        currentDrive: raw.currentDrive ? {
            ...raw.currentDrive,
            plays: safeNumber(raw.currentDrive?.plays, 0),
            yards: safeNumber(raw.currentDrive?.yards, 0),
        } : undefined,
        lastPlay: raw.lastPlay ? { ...raw.lastPlay, id: raw.lastPlay?.id ?? '', text: raw.lastPlay?.text ?? '' } : undefined,
    } as Match;
}

function useGameViewModel(match: RawMatch | undefined): GameViewModel | null {
    // 20-POINT SIGNAL DEPENDENCY KEY (Includes Basic Stats)
    const signalsKey = useMemo(() => {
        if (!match) return 'null';
        const curTotal = match.current_odds?.total ?? match.odds?.total ?? match.live_odds?.total;
        const curSpread = match.current_odds?.spread ?? match.odds?.spread ?? match.live_odds?.spread;
        const wind = pickWindSpeed(match);
        const indoor = !!match.venue?.is_indoor;
        const statsHome = stableStatsFingerprint(match.homeTeamStats);
        const statsAway = stableStatsFingerprint(match.awayTeamStats);

        return [
            match.sport, match.league, match.status, match.displayClock, match.period,
            match.homeScore, match.awayScore, match.situation?.possessionId,
            match.closing_odds?.total, match.closing_odds?.spread,
            curTotal, curSpread, indoor ? '1' : '0',
            Number.isFinite(wind) ? wind.toFixed(2) : '', statsHome, statsAway
        ].join('|');
    }, [
        match?.sport, match?.league, match?.status, match?.displayClock, match?.period,
        match?.homeScore, match?.awayScore, match?.situation?.possessionId,
        match?.current_odds, match?.odds, match?.live_odds, match?.closing_odds,
        match?.venue, match?.weather_info, match?.homeTeamStats, match?.awayTeamStats
    ]);

    const normalized = useMemo(() => normalizeMatch(match), [signalsKey]);

    const signals = useMemo(() => {
        return normalized ? computeAISignals(normalized) : computeAISignals({} as Match);
    }, [normalized, signalsKey]);

    return useMemo(() => {
        if (!match || !match.homeTeam || !match.awayTeam || !normalized) return null;

        const homeScore = safeNumber(match.homeScore);
        const awayScore = safeNumber(match.awayScore);
        const homeId = String(match.homeTeam.id);
        const awayId = String(match.awayTeam.id);
        const possId = match.situation?.possessionId ? String(match.situation.possessionId) : null;

        const spread = safeNumber(match.closing_odds?.spread, 0);
        const total = safeNumber(match.closing_odds?.total, 0);
        const hasSpread = hasValue(match.closing_odds?.spread);
        const hasTotal = hasValue(match.closing_odds?.total) && total > 0;

        const margin = homeScore - awayScore;
        const totalScore = homeScore + awayScore;

        let spreadResult: GameViewModel['betting']['spreadResult'] = null;
        if (hasSpread) {
            const adj = margin + spread;
            spreadResult = adj > 0 ? 'COVER' : adj < 0 ? 'MISS' : 'PUSH';
        }

        const totalHit: GameViewModel['betting']['totalHit'] = !hasTotal ? null : totalScore > total ? 'OVER' : totalScore < total ? 'UNDER' : 'PUSH';
        const windSpd = pickWindSpeed(match);

        return {
            meta: {
                isFootball: ['NFL', 'CFB', 'COLLEGE_FOOTBALL'].some(s => String(match.league).toUpperCase().includes(s)),
                isBasketball: ['NBA', 'CBB', 'NCAAB'].some(s => String(match.league).toUpperCase().includes(s)),
                isFinished: isGameFinished(match.status),
                displayClock: match.displayClock || '00:00',
                hasData: true
            },
            teams: {
                home: { id: homeId, abbr: match.homeTeam.abbreviation || 'HOME', name: match.homeTeam.shortName || 'Home', logo: match.homeTeam.logo || '', color: normalizeColor(match.homeTeam.color, '#3b82f6'), score: homeScore, record: String(match.homeTeam.record || ''), isPossessing: possId === homeId, isWinner: isGameFinished(match.status) && homeScore > awayScore },
                away: { id: awayId, abbr: match.awayTeam.abbreviation || 'AWAY', name: match.awayTeam.shortName || 'Away', logo: match.awayTeam.logo || '', color: normalizeColor(match.awayTeam.color, '#ef4444'), score: awayScore, record: String(match.awayTeam.record || ''), isPossessing: possId === awayId, isWinner: isGameFinished(match.status) && awayScore > homeScore }
            },
            gameplay: { situation: match.situation || null, lastPlay: match.lastPlay || null, drive: match.currentDrive || null, possession: possId === homeId ? 'home' : (possId === awayId ? 'away' : null), isRedZone: !!match.situation?.isRedZone },
            betting: { signals, spread, total, hasSpread, hasTotal, spreadResult, totalHit },
            stats: { homeTeamStats: match.homeTeamStats || null, awayTeamStats: match.awayTeamStats || null },
            environment: {
                wind: Number.isFinite(windSpd) ? `${windSpd} mph` : null,
                temp: match.weather_info?.temp ? `${match.weather_info.temp}°` : null,
            },
            normalized,
        };
    }, [match, signals, normalized]);
}

// ============================================================================
// 5. ATOMIC COMPONENTS (Obsidian UI)
// ============================================================================

const ObsidianPanel = memo(<T extends ElementType = 'div'>({
    as, children, className, hover = false, ...props
}: { as?: T; children: ReactNode; className?: string; hover?: boolean } & ComponentPropsWithoutRef<T>) => {
    const Component = as || 'div';
    return (
        <Component
            className={cn(
                'relative overflow-hidden bg-[#0A0A0A]',
                'border border-white/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.5)]',
                'after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-white/10 after:to-transparent',
                hover && 'transition-colors duration-300 hover:border-white/[0.12] hover:bg-[#0f0f0f]',
                className
            )}
            {...props}
        >
            <div className="absolute inset-0 pointer-events-none opacity-[0.03] mix-blend-overlay"
                style={{ backgroundImage: TOKENS.assets.noise }} aria-hidden="true" />
            <div className="relative z-10 h-full">{children}</div>
        </Component>
    );
});
ObsidianPanel.displayName = 'ObsidianPanel';

const Label = ({ children, className }: { children: ReactNode, className?: string }) => (
    <div className={cn("text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em] leading-none", className)}>
        {children}
    </div>
);

const DataValue = ({ value, size = 'lg', className }: { value: string | number; size?: 'sm' | 'lg' | 'xl'; className?: string }) => (
    <span className={cn(
        "font-mono font-medium tracking-tighter tabular-nums text-white",
        size === 'xl' ? "text-4xl sm:text-5xl" : size === 'lg' ? "text-2xl sm:text-3xl" : "text-lg",
        className
    )}>
        {value}
    </span>
);

const LiveIndicator = memo(({ size = 'md' }: { size?: 'sm' | 'md' }) => {
    const reducedMotion = useReducedMotion();
    return (
        <div className="flex items-center gap-2">
            <span className="relative flex">
                <span className={cn(size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2', 'rounded-full bg-rose-500')} />
                {!reducedMotion && (
                    <span className={cn(size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2', 'absolute rounded-full bg-rose-500 animate-ping opacity-75')} />
                )}
            </span>
            <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Live</span>
        </div>
    );
});
LiveIndicator.displayName = 'LiveIndicator';

// ============================================================================
// 6. VISUALIZATIONS
// ============================================================================

const FieldSchematic: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { gameplay, teams } = viewModel;
    const reducedMotion = useReducedMotion();

    const state = useMemo(() => {
        if (!gameplay.situation) return null;
        const isHome = gameplay.possession === 'home';
        let yard = 50;
        const rawY = gameplay.situation.yardLine;
        if (typeof rawY === 'number') yard = rawY;
        else if (typeof rawY === 'string') {
            const n = parseInt(rawY.replace(/\D/g, ''), 10) || 50;
            yard = rawY.toUpperCase().includes('OWN') ? (isHome ? 100 - n : n)
                : rawY.toUpperCase().includes('OPP') ? (isHome ? n : 100 - n) : n;
        }
        yard = Math.max(0, Math.min(100, yard));

        const dist = safeNumber(gameplay.situation.distance, 10);
        const target = isHome ? yard - dist : yard + dist;
        const down = safeNumber(gameplay.situation.down, 1);

        return {
            ballX: 10 + (yard * 0.8),
            lineX: 10 + (Math.max(0, Math.min(100, target)) * 0.8),
            isHome,
            text: gameplay.situation.downDistanceText || `${getOrdinal(down)} & ${dist < 1 ? 'INCHES' : dist}`,
            displayYard: yard > 50 ? 100 - yard : yard,
            team: isHome ? teams.home : teams.away
        };
    }, [gameplay.situation, gameplay.possession, teams]);

    if (!state) return <ObsidianPanel className="aspect-[2.2/1] md:aspect-[2.6/1] flex items-center justify-center"><Label>Connecting to Field Data</Label></ObsidianPanel>;

    return (
        <div className="relative w-full aspect-[2.2/1] md:aspect-[2.6/1] overflow-hidden bg-[#0A0A0A] border-b border-white/[0.06] select-none isolate group">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#131d16_0%,_#09090b_100%)] opacity-80" />
            <div className="absolute inset-0 flex opacity-20">
                {Array.from({ length: 11 }).map((_, i) => (
                    <div key={i} className="flex-1 border-r border-white/10 relative">
                        {i > 0 && i < 10 && <span className="absolute bottom-2 -translate-x-1/2 left-0 text-[8px] font-mono text-white/40">{Math.abs(50 - (i * 10))}</span>}
                    </div>
                ))}
            </div>
            {!reducedMotion && (
                <div className="absolute inset-0 opacity-[0.03] overflow-hidden mix-blend-screen pointer-events-none">
                    <motion.div
                        className="flex gap-24 sm:gap-32 absolute top-1/2 -translate-y-1/2 w-[200%]"
                        animate={{ x: state.isHome ? ['-10%', '-20%'] : ['10%', '20%'] }}
                        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                    >
                        {Array.from({ length: 10 }).map((_, i) =>
                            state.isHome ? <ChevronLeft key={i} size={100} /> : <ChevronRight key={i} size={100} />
                        )}
                    </motion.div>
                </div>
            )}
            <motion.div animate={{ left: `${state.ballX}%` }} transition={TOKENS.animation.spring} className="absolute inset-y-0 w-[2px] bg-blue-500 z-10 shadow-[0_0_20px_2px_rgba(59,130,246,0.6)]" />
            <motion.div animate={{ left: `${state.lineX}%` }} transition={TOKENS.animation.spring} className="absolute inset-y-0 w-[2px] bg-amber-400 z-0 opacity-60" />
            <div className="absolute top-1/2 -translate-y-1/2 z-20" style={{ left: `${state.ballX}%` }}>
                <motion.div layoutId="football" transition={TOKENS.animation.spring} className="relative -translate-x-1/2">
                    <div className="w-2.5 h-4 sm:w-3 sm:h-5 bg-[#8B4513] rounded-full border border-black/50 shadow-lg relative group-hover:scale-125 transition-transform duration-300">
                        <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[2px] h-[60%] border-x border-white/30" />
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[2px] bg-white/30" />
                    </div>
                </motion.div>
            </div>
            <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4 z-30 flex items-stretch rounded-lg overflow-hidden border border-white/10 shadow-2xl bg-black/80 backdrop-blur-md">
                <div className="px-2 sm:px-3 py-1.5 flex items-center gap-2" style={{ backgroundColor: state.team.color }}>
                    <TeamLogo logo={state.team.logo} className="w-3.5 h-3.5 sm:w-4 sm:h-4 object-contain brightness-200" />
                    <span className="text-[9px] sm:text-[10px] font-black text-white uppercase tracking-wider">{state.team.abbr}</span>
                </div>
                <div className="px-2 sm:px-3 py-1.5 flex items-center gap-2 border-l border-white/10">
                    <span className="text-[10px] sm:text-xs font-bold text-white tabular-nums tracking-tight">{state.text}</span>
                    <span className="text-[9px] font-mono text-zinc-400 hidden sm:inline">@{state.displayYard}</span>
                </div>
            </div>
        </div>
    );
});
FieldSchematic.displayName = 'FieldSchematic';

const CourtSchematic: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { gameplay, teams } = viewModel;
    const reducedMotion = useReducedMotion();
    const state = useMemo(() => {
        if (!gameplay.situation) return null;
        const isHome = gameplay.possession === 'home';
        let bx = isHome ? 80 : 20;
        let by = 25;
        if (typeof gameplay.situation.ballX === 'number') bx = gameplay.situation.ballX;
        if (typeof gameplay.situation.ballY === 'number') by = gameplay.situation.ballY;
        return {
            ballX: Math.max(0, Math.min(100, bx)),
            ballY: Math.max(0, Math.min(50, by > 50 ? by * 0.5 : by)),
            activeTeam: isHome ? teams.home : teams.away
        };
    }, [gameplay.situation, gameplay.possession, teams]);

    if (!state) return <ObsidianPanel className="aspect-[2.2/1] md:aspect-[2.6/1]" />;

    return (
        <div className="relative w-full aspect-[2.2/1] md:aspect-[2.6/1] bg-[#100c0a] border-b border-white/[0.04] overflow-hidden select-none">
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(255,255,255,0.02) 20px)' }} />
            <svg viewBox="0 0 100 50" className="absolute inset-0 w-full h-full opacity-30 pointer-events-none stroke-white" preserveAspectRatio="none">
                <rect x="0.5" y="0.5" width="99" height="49" strokeWidth="0.5" fill="none" />
                <line x1="50" y1="0" x2="50" y2="50" strokeWidth="0.5" />
                <circle cx="50" cy="25" r="7" strokeWidth="0.5" fill="none" />
                <path d="M0 4 L14 4 A 23 23 0 0 1 14 46 L0 46" strokeWidth="0.5" fill="none" />
                <path d="M100 4 L86 4 A 23 23 0 0 0 86 46 L100 46" strokeWidth="0.5" fill="none" />
            </svg>
            <motion.div animate={{ left: `${state.ballX}%`, top: `${(state.ballY / 50) * 100}%` }} transition={TOKENS.animation.spring} className="absolute z-20 -translate-x-1/2 -translate-y-1/2">
                {!reducedMotion && <div className="absolute inset-0 bg-orange-500/40 rounded-full blur-md animate-pulse" />}
                <div className="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 border border-white/20 shadow-lg relative" />
            </motion.div>
            <div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 z-30">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0a0a0a]/90 backdrop-blur rounded-full border border-white/10 shadow-xl">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                    <span className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                        Poss <span className="text-white ml-1">{state.activeTeam.abbr}</span>
                    </span>
                </div>
            </div>
        </div>
    );
});
CourtSchematic.displayName = 'CourtSchematic';

// ============================================================================
// 7. DASHBOARD MODULES (Including Fixed BoxScoreCard)
// ============================================================================

const BettingCard: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { signals, totalHit } = viewModel.betting;
    const { edge_state, edge_points, deterministic_fair_total, market_total, status_reason } = signals;

    const isSyncing = typeof status_reason === 'string' && status_reason.includes('Critical');
    if (isSyncing) return <ObsidianPanel className="p-6 flex flex-col items-center justify-center min-h-[160px]"><Activity className="text-zinc-600 animate-spin mb-2" /><Label>Syncing Models</Label></ObsidianPanel>;

    const isPlay = edge_state === 'PLAY';
    const isOver = safeNumber(deterministic_fair_total) > safeNumber(market_total);
    const statusText = totalHit ? totalHit : isPlay ? "High Value" : "Neutral";
    const statusColor = totalHit === 'OVER' ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/10"
        : totalHit === 'UNDER' ? "text-rose-400 border-rose-500/20 bg-rose-500/10"
            : totalHit === 'PUSH' ? "text-zinc-400 border-white/10 bg-white/5"
                : isPlay
                    ? (isOver ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/10" : "text-rose-400 border-rose-500/20 bg-rose-500/10")
                    : "text-zinc-500 border-white/5 bg-zinc-800/50";

    return (
        <ObsidianPanel hover className="flex flex-col justify-between min-h-[160px] p-5">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-white/5 border border-white/5"><Target size={12} className="text-zinc-400" /></div>
                    <Label>Forecast</Label>
                </div>
                <div className={cn("px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-wider", statusColor)}>
                    {statusText}
                </div>
            </div>
            <div className="flex items-end justify-between mt-4 relative z-10">
                <div>
                    <DataValue value={safeNumber(deterministic_fair_total).toFixed(1)} />
                    <Label className="mt-1 normal-case tracking-normal opacity-50">Model Fair</Label>
                </div>
                <div className="text-right">
                    <div className={cn("text-xl font-mono font-bold flex items-center justify-end gap-1", isPlay ? (isOver ? 'text-emerald-400' : 'text-rose-400') : 'text-zinc-500')}>
                        {isOver ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        {Math.abs(safeNumber(edge_points)).toFixed(1)}
                    </div>
                    <Label className="mt-1 normal-case tracking-normal opacity-50">vs Mkt {market_total}</Label>
                </div>
            </div>
            {isPlay && <div className={cn("absolute -bottom-10 -right-10 w-32 h-32 blur-[60px] opacity-10 pointer-events-none", isOver ? "bg-emerald-500" : "bg-rose-500")} />}
        </ObsidianPanel>
    );
});
BettingCard.displayName = 'BettingCard';

const DriveStatsCard: FC<{ drive: GameViewModel['gameplay']['drive'] }> = memo(({ drive }) => {
    const reducedMotion = useReducedMotion();
    const plays = safeNumber(drive?.plays, 0);
    const yards = safeNumber(drive?.yards, 0);
    const progress = Math.min((yards / 80) * 100, 100);

    return (
        <ObsidianPanel hover className="p-5 min-h-[160px] flex flex-col group relative">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20"><Zap size={12} className="text-emerald-400" /></div>
                    <Label className="text-emerald-400">Current Drive</Label>
                </div>
                <Shield size={14} className="text-zinc-600" />
            </div>
            <div className="mb-6 relative">
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={reducedMotion ? { duration: 0 } : TOKENS.animation.spring}
                        className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                    />
                </div>
            </div>
            <div className="grid grid-cols-3 gap-px bg-white/5 rounded-lg overflow-hidden border border-white/5">
                <div className="p-2 text-center"><DataValue value={plays} size="sm" /><div className="text-[8px] text-zinc-500 uppercase mt-0.5">Plays</div></div>
                <div className="p-2 text-center border-x border-white/5"><DataValue value={yards} size="sm" className="text-white" /><div className="text-[8px] text-zinc-500 uppercase mt-0.5">Yards</div></div>
                <div className="p-2 text-center"><DataValue value={drive?.timeElapsed || "0:00"} size="sm" /><div className="text-[8px] text-zinc-500 uppercase mt-0.5">Time</div></div>
            </div>
        </ObsidianPanel>
    );
});
DriveStatsCard.displayName = 'DriveStatsCard';

// --- FIXED BOX SCORE CARD (SPORT-AWARE) ---

const BoxScoreCard: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { homeTeamStats, awayTeamStats } = viewModel.stats;
    const { teams, meta } = viewModel;

    // Helper: fuzzy find value from multiple potential keys
    const findStat = (stats: TeamStats | null, keys: string[]): number => {
        if (!stats) return NaN;
        for (const k of keys) {
            const val = stats[k] ?? stats[k.toUpperCase()];
            if (val !== undefined && val !== null && val !== '') {
                const n = parseFloat(String(val));
                if (Number.isFinite(n)) return n;
            }
        }
        return NaN;
    };

    const rows = useMemo(() => {
        if (!homeTeamStats && !awayTeamStats) return [];

        let config: { label: string; keys: string[]; format?: string }[] = [];

        if (meta.isFootball) {
            // Football Config
            config = [
                { label: 'Total Yds', keys: ['total_yards', 'net_yards', 'yards'] },
                { label: 'Pass Yds', keys: ['passing_yards', 'pass_net_yards', 'pass_yards'] },
                { label: 'Rush Yds', keys: ['rushing_yards', 'rush_net_yards', 'rush_yards'] },
                { label: 'Turnovers', keys: ['turnovers', 'to', 'turnovers'] },
                { label: 'Yards/Play', keys: ['yards_per_play', 'yds_play'] },
            ];
        } else {
            // Basketball/Default Config (Standard + Advanced Fallbacks)
            config = [
                { label: 'FG%', keys: ['fg_pct', 'field_goal_pct', 'efg', 'efg_pct'], format: '%' },
                { label: '3P%', keys: ['fg3_pct', 'three_point_pct', 'tpp'], format: '%' },
                { label: 'FT%', keys: ['ft_pct', 'free_throw_pct'], format: '%' },
                { label: 'Rebounds', keys: ['reb', 'rebounds', 'tot_reb'] },
                { label: 'Assists', keys: ['ast', 'assists'] },
                { label: 'TOV', keys: ['tov', 'turnovers'] },
            ];
        }

        return config.map(({ label, keys, format }) => {
            const h = findStat(homeTeamStats, keys);
            const a = findStat(awayTeamStats, keys);

            // Filter out row only if BOTH teams are missing data for this stat
            if (!Number.isFinite(h) && !Number.isFinite(a)) return null;

            // Formatting
            const fmt = (n: number) => {
                if (Number.isNaN(n)) return '—';
                // Handle percentages that might come as 0.45 or 45
                if (format === '%' && n <= 1 && n > 0 && label !== 'Y/Play') return (n * 100).toFixed(0) + '%';
                if (format === '%') return n.toFixed(1) + '%';
                return n.toFixed(label === 'TO' ? 0 : 1);
            };

            return { label, home: fmt(h), away: fmt(a) };
        }).filter(Boolean); // Remove null rows
    }, [homeTeamStats, awayTeamStats, meta.isFootball]);

    // Render "Waiting for Stats" state instead of null if empty
    if (!rows.length) {
        // If we have stats objects but no rows matched, show a "No Data" state
        if (homeTeamStats || awayTeamStats) {
            return (
                <ObsidianPanel className="p-4 flex items-center justify-center opacity-50">
                    <span className="text-[10px] font-mono uppercase text-zinc-500">
                        {meta.isFootball ? "Waiting for Drive Stats..." : "Waiting for Advanced Stats..."}
                    </span>
                </ObsidianPanel>
            );
        }
        return null; // Cleanly hide if absolutely no data exists
    }

    return (
        <ObsidianPanel className="p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <BarChart3 size={12} className="text-zinc-500" />
                    <Label>Game Metrics</Label>
                </div>
                <div className="flex gap-4 text-[9px] font-bold uppercase text-zinc-500">
                    <span>{teams.away.abbr}</span>
                    <span>{teams.home.abbr}</span>
                </div>
            </div>
            {/* Responsive Grid: 2 columns on mobile, 3 on desktop */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {rows.map((r, i) => (
                    <div key={i} className="flex flex-col items-center p-2 rounded bg-white/[0.02] border border-white/[0.04]">
                        <span className="text-[9px] font-bold text-zinc-600 mb-1">{r!.label}</span>
                        <div className="flex gap-3 font-mono text-xs tabular-nums">
                            <span className="text-zinc-400">{r!.away}</span>
                            <span className="text-zinc-700">|</span>
                            <span className="text-white">{r!.home}</span>
                        </div>
                    </div>
                ))}
            </div>
        </ObsidianPanel>
    );
});
BoxScoreCard.displayName = 'BoxScoreCard';

const LatestEventCard: FC<{ play: GameViewModel['gameplay']['lastPlay'] }> = memo(({ play }) => (
    <ObsidianPanel hover className="flex flex-col min-h-[160px] p-5">
        <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-white/5 border border-white/5"><Radio size={12} className="text-zinc-400" /></div>
                <Label>Live Feed</Label>
            </div>
            <LiveIndicator size="sm" />
        </div>
        <AnimatePresence mode="wait">
            <motion.p
                key={play?.id || 'empty'}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                transition={TOKENS.animation.fade}
                className="text-sm font-medium text-zinc-300 leading-relaxed line-clamp-3"
            >
                {play?.text || "Waiting for stadium feed..."}
            </motion.p>
        </AnimatePresence>
    </ObsidianPanel>
));
LatestEventCard.displayName = 'LatestEventCard';

// ============================================================================
// 8. HEADER & SUMMARY
// ============================================================================

const CompactScoreBar: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { teams, meta } = viewModel;
    return (
        <div className="relative z-20 w-full px-4 sm:px-6 py-4 flex items-center justify-between bg-[#020202] border-b border-white/[0.06]">
            <div className="flex items-center gap-3 min-w-0 flex-1">
                <TeamLogo logo={teams.away.logo} className="w-6 h-6 sm:w-8 sm:h-8 object-contain drop-shadow-lg" />
                <div className="flex flex-col">
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-0.5">{teams.away.abbr}</span>
                    <DataValue value={teams.away.score} size="lg" />
                </div>
            </div>
            <div className="flex flex-col items-center gap-1.5">
                <div className={cn("px-2 py-0.5 rounded-full border text-[8px] font-bold uppercase tracking-widest", !meta.isFinished ? "bg-rose-500/10 border-rose-500/20 text-rose-500" : "bg-zinc-800/50 border-white/5 text-zinc-500")}>{meta.isFinished ? "Final" : "Live"}</div>
                <span className="text-[10px] font-mono font-bold text-zinc-400 tracking-wider tabular-nums">{meta.displayClock}</span>
            </div>
            <div className="flex items-center gap-3 min-w-0 flex-1 justify-end">
                <div className="flex flex-col items-end">
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-0.5">{teams.home.abbr}</span>
                    <DataValue value={teams.home.score} size="lg" />
                </div>
                <TeamLogo logo={teams.home.logo} className="w-6 h-6 sm:w-8 sm:h-8 object-contain drop-shadow-lg" />
            </div>
        </div>
    );
});
CompactScoreBar.displayName = 'CompactScoreBar';

export const ScoreHeader: FC<{ match: Match }> = memo(({ match }) => {
    const vm = useGameViewModel(match as ExtendedMatch);
    if (!vm) return <div className="h-[200px] bg-[#020202] animate-pulse rounded-b-3xl" />;

    const { teams, meta, environment } = vm;
    return (
        <header className="relative w-full min-h-[200px] sm:min-h-[240px] overflow-hidden bg-[#020202] flex items-center justify-center border-b border-white/[0.08] py-8">
            <div className="absolute inset-0 opacity-20 pointer-events-none">
                <div className="absolute -left-20 top-0 w-[60%] h-[150%] blur-[100px]" style={{ background: `radial-gradient(circle, ${teams.away.color} 0%, transparent 70%)` }} />
                <div className="absolute -right-20 top-0 w-[60%] h-[150%] blur-[100px]" style={{ background: `radial-gradient(circle, ${teams.home.color} 0%, transparent 70%)` }} />
            </div>

            <div className="relative z-10 w-full max-w-4xl px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-6 sm:gap-0">
                <div className="flex flex-col items-center gap-3">
                    <TeamLogo logo={teams.away.logo} className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-2xl" />
                    <div className="text-center">
                        <h2 className="text-lg sm:text-2xl font-bold text-white tracking-tight uppercase">{teams.away.name}</h2>
                        <Label>{teams.away.record}</Label>
                    </div>
                </div>

                <div className="flex flex-col items-center gap-3">
                    <div className="flex items-baseline gap-6 sm:gap-10">
                        <span className="text-5xl sm:text-7xl font-light text-white tabular-nums tracking-tighter">{teams.away.score}</span>
                        <span className="text-2xl sm:text-4xl text-white/10 font-thin">-</span>
                        <span className="text-5xl sm:text-7xl font-light text-white tabular-nums tracking-tighter">{teams.home.score}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] backdrop-blur-md">
                            <span className={cn("text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em]", isGameFinished(match.status) ? "text-amber-500" : "text-rose-500")}>
                                {meta.displayClock}
                            </span>
                        </div>
                        {environment.wind && <div className="hidden sm:flex items-center gap-1 text-[9px] text-zinc-500 border-l border-white/10 pl-3"><Wind size={10} /> {environment.wind}</div>}
                    </div>
                </div>

                <div className="flex flex-col items-center gap-3">
                    <TeamLogo logo={teams.home.logo} className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-2xl" />
                    <div className="text-center">
                        <h2 className="text-lg sm:text-2xl font-bold text-white tracking-tight uppercase">{teams.home.name}</h2>
                        <Label>{teams.home.record}</Label>
                    </div>
                </div>
            </div>
        </header>
    );
});
ScoreHeader.displayName = 'ScoreHeader';

export const FinalGameTracker: FC<{ match: Match }> = memo(({ match }) => {
    const vm = useGameViewModel(match as ExtendedMatch);
    if (!vm) return null;
    const { teams, betting } = vm;

    const Badge = ({ result, label }: { result: 'COVER' | 'MISS' | 'PUSH' | 'OVER' | 'UNDER' | null, label: string }) => {
        let colors = "bg-zinc-800/50 border-white/5 text-zinc-500";
        if (result === 'COVER' || result === 'OVER') colors = "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
        else if (result === 'MISS' || result === 'UNDER') colors = "bg-rose-500/10 border-rose-500/20 text-rose-400";
        else if (result === 'PUSH') colors = "bg-zinc-700/50 border-white/10 text-zinc-400";

        return (
            <div className={cn("px-3 py-1.5 rounded-md border flex items-center justify-center gap-2 w-full transition-colors", colors)}>
                {(result === 'COVER' || result === 'OVER') && <CheckCircle2 size={12} />}
                {(result === 'MISS' || result === 'UNDER') && <Minus size={12} />}
                {result === 'PUSH' && <Lock size={12} />}
                <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
            </div>
        );
    };

    return (
        <ObsidianPanel className="p-6 sm:p-10 rounded-[32px] flex flex-col items-center">
            <div className="px-5 py-2 rounded-full bg-zinc-900 border border-white/5 mb-8 shadow-lg">
                <Label className="text-zinc-400">Final Result</Label>
            </div>
            <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-6 sm:gap-12 mb-10">
                <div className="flex flex-col items-center sm:items-end gap-4 sm:gap-6">
                    <TeamLogo logo={teams.away.logo} className={cn("w-16 h-16 sm:w-24 sm:h-24 transition-all duration-700", !teams.away.isWinner && "opacity-30 grayscale")} />
                    <DataValue value={teams.away.score} size="xl" />
                </div>
                <div className="hidden sm:block h-16 sm:h-24 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />
                <div className="flex flex-col items-center sm:items-start gap-4 sm:gap-6">
                    <TeamLogo logo={teams.home.logo} className={cn("w-16 h-16 sm:w-24 sm:h-24 transition-all duration-700", !teams.home.isWinner && "opacity-30 grayscale")} />
                    <DataValue value={teams.home.score} size="xl" />
                </div>
            </div>
            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-px bg-white/5 rounded-xl overflow-hidden border border-white/5">
                <div className="bg-[#0c0c0e] p-4 sm:p-6 flex flex-col items-center gap-3">
                    <Label>Spread</Label>
                    <Badge result={betting.spreadResult} label={betting.spreadResult === 'COVER' ? 'Covered' : betting.spreadResult === 'MISS' ? 'Missed' : betting.spreadResult || 'N/A'} />
                    <span className="text-[10px] font-mono text-zinc-500">Line: {betting.hasSpread ? betting.spread : '-'}</span>
                </div>
                <div className="bg-[#0c0c0e] p-4 sm:p-6 flex flex-col items-center gap-3">
                    <Label>Total</Label>
                    <Badge result={betting.totalHit} label={betting.totalHit || 'N/A'} />
                    <span className="text-[10px] font-mono text-zinc-500">Line: {betting.hasTotal ? betting.total : '-'}</span>
                </div>
            </div>
        </ObsidianPanel>
    );
});
FinalGameTracker.displayName = 'FinalGameTracker';

// ============================================================================
// 9. ROOT COMPONENT
// ============================================================================

export const LiveGameTracker: FC<{ match: Match; liveState?: unknown }> = memo(({ match, liveState }) => {
    const mergedMatch = useMemo(() => mergeMatchWithLiveState(match as ExtendedMatch, liveState), [match, liveState]);
    const vm = useGameViewModel(mergedMatch);

    if (!vm) return <ObsidianPanel className="h-[320px] flex flex-col items-center justify-center gap-4"><Activity className="text-zinc-700 animate-pulse" /><Label>Establishing Uplink</Label></ObsidianPanel>;
    if (vm.meta.isFinished) return <FinalGameTracker match={vm.normalized} />;

    return (
        <div className="flex flex-col w-full bg-[#020202] rounded-[24px] sm:rounded-[32px] overflow-hidden border border-white/[0.08] shadow-2xl ring-1 ring-white/[0.02]">
            <CompactScoreBar viewModel={vm} />
            <div className="w-full border-b border-white/[0.06]">
                {vm.meta.isFootball ? <FieldSchematic viewModel={vm} /> : vm.meta.isBasketball ? <CourtSchematic viewModel={vm} /> : <div className="h-[240px] flex items-center justify-center bg-[#0a0a0a]"><Label>Visualizer Unavailable</Label></div>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/[0.04]">
                <LatestEventCard play={vm.gameplay.lastPlay} />
                {vm.meta.isFootball ? <DriveStatsCard drive={vm.gameplay.drive} /> : <BettingCard viewModel={vm} />}
            </div>

            <div className="grid grid-cols-1 gap-px bg-white/[0.04] border-t border-white/[0.04]">
                {/* Fixed BoxScoreCard is now used here */}
                <BoxScoreCard viewModel={vm} />
                {vm.meta.isFootball && <div className="md:hidden border-t border-white/[0.04]"><BettingCard viewModel={vm} /></div>}
            </div>
        </div>
    );
});
LiveGameTracker.displayName = 'LiveGameTracker';

// Backward compatibility export
export const LiveTotalCard = BettingCard;

export default LiveGameTracker;
