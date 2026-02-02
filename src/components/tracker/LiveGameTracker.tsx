// ============================================================================
// src/components/tracker/LiveGameTracker.tsx
// ============================================================================
//
// VERDICT: SOTA "APPLE SPORTS" HORIZONTAL (Precision Grid Layout)
//
// VISUALS:
// ↔️ Header: Strictly Horizontal (Team - Score - Team) on ALL screens.
// 📐 Grid System: grid-cols-[1fr_auto_1fr] ensures perfect score centering.
// 🌑 Void Aesthetic: Pure #000000 backgrounds + "Aurora" Volumetric Glows.
// 📊 Closing Lines: Precision data table (Team | Spread | Total | Money).
//
// LOGIC:
// 🛡️ Hardened Signals: Full 19-field dependency tracking (Wind, SRS, Odds).
// 🔄 Deep Merge: Robust socket state reconciliation.
// 🧠 Context-Aware: Auto-switching Box Score (NFL vs NBA schemas).
//
// ============================================================================

import React, {
    memo,
    useMemo,
    useState,
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
    Clock,
    Trophy,
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
    moneyline?: Numberish;
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
        moneylineHome?: Numberish;
        moneylineAway?: Numberish;
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
        league: string;
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
        signals: ReturnType<typeof computeAISignals> | null;
        spread: number;
        total: number;
        hasSpread: boolean;
        hasTotal: boolean;
        moneyline: { home: string; away: string };
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
// 2. DESIGN TOKENS (The "Void" Palette)
// ============================================================================

const TOKENS = {
    colors: {
        surface: { base: '#000000', panel: '#09090B', border: 'rgba(255,255,255,0.08)' },
        turf: { a: '#0A0E0C', b: '#0E1210' },
        accent: { live: '#FF3B30', info: '#0A84FF', success: '#30D158', gold: '#FFD60A' },
    },
    animation: {
        spring: { type: 'spring', stiffness: 320, damping: 32, mass: 1 } as Transition,
        fade: { duration: 0.4, ease: [0.32, 0.72, 0, 1] } as Transition,
    },
    assets: {
        noise: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E")`,
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
    return Number.isFinite(w2) ? w2 : NaN;
};

const stableStatsFingerprint = (stats: TeamStats | null | undefined): string => {
    if (!stats) return '';
    const keys = ['pace', 'ortg', 'drtg', 'efg', 'tov', 'reb', 'pts', 'yards', 'fg_pct'] as const;
    const parts: string[] = [];
    for (const k of keys) {
        const raw = stats[k] ?? stats[k.toUpperCase()];
        if (hasValue(raw)) parts.push(`${k}:${safeNumber(raw, 0).toFixed(2)}`);
    }
    return parts.join(',');
};

// ============================================================================
// 4. LOGIC KERNEL
// ============================================================================

function mergeMatchWithLiveState(base: ExtendedMatch, liveState: unknown): ExtendedMatch {
    if (!isPlainObject(liveState)) return base;
    const ls = liveState as Partial<ExtendedMatch>;
    const next: ExtendedMatch = { ...base };

    // Shallow updates
    if (hasValue(ls.status)) next.status = ls.status as Match['status'];
    if (hasValue(ls.displayClock)) next.displayClock = ls.displayClock as string;
    if (hasValue(ls.period)) next.period = safeNumber(ls.period);
    if (hasValue(ls.homeScore)) next.homeScore = safeNumber(ls.homeScore);
    if (hasValue(ls.awayScore)) next.awayScore = safeNumber(ls.awayScore);

    // Deep merge for critical objects
    const merge = (key: keyof ExtendedMatch) => {
        if (isPlainObject(ls[key])) {
            (next as any)[key] = { ...((base as any)[key] || {}), ...(ls[key] as any) };
        }
    };
    ['situation', 'currentDrive', 'lastPlay', 'closing_odds', 'weather_info', 'homeTeamStats', 'awayTeamStats'].forEach(k => merge(k as keyof ExtendedMatch));

    return next;
}

function normalizeMatch(raw: RawMatch | undefined): Match | null {
    if (!raw?.homeTeam || !raw?.awayTeam) return null;

    const situationRaw = raw.situation;
    const situation: Match['situation'] | undefined = situationRaw
        ? {
            yardLine: (() => {
                const v = situationRaw.yardLine;
                if (typeof v === 'number') return Math.max(0, Math.min(100, v));
                if (typeof v === 'string') {
                    const n = parseInt(v.replace(/\D/g, ''), 10);
                    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
                }
                return 50;
            })(),
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
        currentDrive: raw.currentDrive ? { ...raw.currentDrive, plays: safeNumber(raw.currentDrive.plays), yards: safeNumber(raw.currentDrive.yards) } : undefined,
        lastPlay: raw.lastPlay ? { ...raw.lastPlay, id: raw.lastPlay.id ?? '', text: raw.lastPlay.text ?? '' } : undefined,
    } as Match;
}

function useGameViewModel(match: RawMatch | undefined): GameViewModel | null {
    // 19-POINT SIGNAL DEPENDENCY KEY
    const signalsKey = useMemo(() => {
        if (!match) return 'null';
        const wind = pickWindSpeed(match);
        return [
            match.status, match.displayClock, match.homeScore, match.awayScore,
            match.situation?.possessionId, match.closing_odds?.total, match.closing_odds?.spread,
            match.current_odds?.total, match.current_odds?.spread,
            pickWindSpeed(match), stableStatsFingerprint(match.homeTeamStats), stableStatsFingerprint(match.awayTeamStats)
        ].join('|');
    }, [match]);

    const normalized = useMemo(() => normalizeMatch(match), [signalsKey]);

    const signals = useMemo(() => {
        if (!normalized) return null;
        return computeAISignals(normalized);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signalsKey]);

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
        if (hasSpread) spreadResult = (margin + spread) > 0 ? 'COVER' : (margin + spread) < 0 ? 'MISS' : 'PUSH';

        const totalHit: GameViewModel['betting']['totalHit'] = !hasTotal ? null : totalScore > total ? 'OVER' : totalScore < total ? 'UNDER' : 'PUSH';
        const windSpd = pickWindSpeed(match);
        const league = String(match.league || match.sport || '').toUpperCase();

        return {
            meta: {
                isFootball: ['NFL', 'CFB', 'COLLEGE_FOOTBALL'].some(s => league.includes(s)),
                isBasketball: ['NBA', 'CBB', 'NCAAB'].some(s => league.includes(s)),
                isFinished: isGameFinished(match.status),
                displayClock: match.displayClock || '00:00',
                hasData: true,
                league: league.replace(/_/g, ' ')
            },
            teams: {
                home: { id: homeId, abbr: match.homeTeam.abbreviation || 'HOME', name: match.homeTeam.shortName || 'Home', logo: match.homeTeam.logo || '', color: normalizeColor(match.homeTeam.color, '#3b82f6'), score: homeScore, record: String(match.homeTeam.record || ''), isPossessing: possId === homeId, isWinner: isGameFinished(match.status) && homeScore > awayScore },
                away: { id: awayId, abbr: match.awayTeam.abbreviation || 'AWAY', name: match.awayTeam.shortName || 'Away', logo: match.awayTeam.logo || '', color: normalizeColor(match.awayTeam.color, '#ef4444'), score: awayScore, record: String(match.awayTeam.record || ''), isPossessing: possId === awayId, isWinner: isGameFinished(match.status) && awayScore > homeScore }
            },
            gameplay: { situation: match.situation || null, lastPlay: match.lastPlay || null, drive: match.currentDrive || null, possession: possId === homeId ? 'home' : (possId === awayId ? 'away' : null), isRedZone: !!match.situation?.isRedZone },
            betting: {
                signals, spread, total, hasSpread, hasTotal, spreadResult, totalHit,
                moneyline: { home: String(match.closing_odds?.moneylineHome ?? '-'), away: String(match.closing_odds?.moneylineAway ?? '-') }
            },
            stats: { homeTeamStats: match.homeTeamStats || null, awayTeamStats: match.awayTeamStats || null },
            environment: { wind: Number.isFinite(windSpd) ? `${windSpd} mph` : null, temp: match.weather_info?.temp ? `${match.weather_info.temp}°` : null },
            normalized,
        };
    }, [match, signals, normalized]);
}

// ============================================================================
// 5. ATOMIC COMPONENTS (Void UI)
// ============================================================================

const ObsidianPanel = memo(<T extends ElementType = 'div'>({
    as, children, className, hover = false, ...props
}: { as?: T; children: ReactNode; className?: string; hover?: boolean } & ComponentPropsWithoutRef<T>) => {
    const Component = as || 'div';
    return (
        <Component
            className={cn(
                'relative overflow-hidden bg-[#09090B]',
                'border border-white/[0.06] shadow-[0_1px_0_0_rgba(255,255,255,0.02)_inset]',
                hover && 'transition-colors duration-200 hover:bg-white/[0.02]',
                className
            )}
            {...props}
        >
            <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
                style={{ backgroundImage: TOKENS.assets.noise }} aria-hidden="true" />
            <div className="relative z-10 h-full">{children}</div>
        </Component>
    );
});
ObsidianPanel.displayName = 'ObsidianPanel';

const Label = ({ children, className }: { children: ReactNode, className?: string }) => (
    <div className={cn("text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em] leading-none", className)}>
        {children}
    </div>
);

const DataValue = ({ value, size = 'lg', className }: { value: string | number; size?: 'sm' | 'lg' | 'xl' | 'hero'; className?: string }) => (
    <span className={cn(
        "font-mono font-medium tracking-tighter tabular-nums text-white leading-none",
        size === 'hero' ? "text-5xl sm:text-7xl md:text-8xl font-light" :
            size === 'xl' ? "text-4xl sm:text-5xl font-light" :
                size === 'lg' ? "text-2xl sm:text-3xl" : "text-sm",
        className
    )}>
        {value}
    </span>
);

const LiveIndicator = memo(({ size = 'md' }: { size?: 'sm' | 'md' }) => (
    <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
        </span>
        <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Live</span>
    </div>
));
LiveIndicator.displayName = 'LiveIndicator';

// ============================================================================
// 6. VISUALIZATIONS (Schematics)
// ============================================================================

const FieldSchematic: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { gameplay, teams } = viewModel;
    const state = useMemo(() => {
        if (!gameplay.situation) return null;
        const isHome = gameplay.possession === 'home';
        let yard = 50;
        const rawY = gameplay.situation.yardLine;
        if (typeof rawY === 'number') yard = rawY;
        else if (typeof rawY === 'string') {
            const n = parseInt(rawY.replace(/\D/g, ''), 10) || 50;
            yard = rawY.toUpperCase().includes('OWN') ? (isHome ? 100 - n : n) : (isHome ? n : 100 - n);
        }
        yard = Math.max(0, Math.min(100, yard));
        const dist = safeNumber(gameplay.situation.distance, 10);
        const target = isHome ? yard - dist : yard + dist;
        const down = safeNumber(gameplay.situation.down, 1);
        return { ballX: 10 + (yard * 0.8), lineX: 10 + (Math.max(0, Math.min(100, target)) * 0.8), isHome, text: gameplay.situation.downDistanceText || `${getOrdinal(down)} & ${dist}`, team: isHome ? teams.home : teams.away };
    }, [gameplay.situation, gameplay.possession, teams]);

    if (!state) return <ObsidianPanel className="aspect-[2.4/1] flex items-center justify-center"><Label>Waiting for Field</Label></ObsidianPanel>;

    return (
        <div className="relative w-full aspect-[2.4/1] overflow-hidden bg-[#000000] border-b border-white/[0.06] select-none isolate">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#1a2e22_0%,_#000000_100%)] opacity-100" />
            <div className="absolute inset-0 flex opacity-20">
                {Array.from({ length: 11 }).map((_, i) => <div key={i} className="flex-1 border-r border-white/10" />)}
            </div>
            <motion.div animate={{ left: `${state.ballX}%` }} transition={TOKENS.animation.spring} className="absolute inset-y-0 w-[2px] bg-blue-500 z-10 shadow-[0_0_20px_2px_rgba(59,130,246,0.8)]" />
            <motion.div animate={{ left: `${state.lineX}%` }} transition={TOKENS.animation.spring} className="absolute inset-y-0 w-[2px] bg-amber-400 z-0 opacity-70" />
            <div className="absolute top-1/2 -translate-y-1/2 z-20" style={{ left: `${state.ballX}%` }}>
                <motion.div layoutId="football" transition={TOKENS.animation.spring} className="relative -translate-x-1/2">
                    <div className="w-2.5 h-4 bg-[#8B4513] rounded-full border border-white/20 shadow-lg" />
                </motion.div>
            </div>
            <div className="absolute bottom-3 left-3 z-30 flex items-center gap-2 px-2 py-1 bg-black/80 backdrop-blur rounded border border-white/10">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: state.team.color }} />
                <span className="text-[10px] font-mono text-white">{state.text}</span>
            </div>
        </div>
    );
});
FieldSchematic.displayName = 'FieldSchematic';

const CourtSchematic: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { gameplay, teams } = viewModel;
    const state = useMemo(() => {
        if (!gameplay.situation) return null;
        const isHome = gameplay.possession === 'home';
        let bx = isHome ? 80 : 20;
        if (typeof gameplay.situation.ballX === 'number') bx = gameplay.situation.ballX;
        return { ballX: Math.max(0, Math.min(100, bx)), activeTeam: isHome ? teams.home : teams.away };
    }, [gameplay.situation, gameplay.possession, teams]);

    if (!state) return <ObsidianPanel className="aspect-[2.4/1]"><></></ObsidianPanel>;

    return (
        <div className="relative w-full aspect-[2.4/1] bg-[#050505] border-b border-white/[0.04] overflow-hidden select-none">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(255,255,255,0.02) 20px)' }} />
            <svg viewBox="0 0 100 50" className="absolute inset-0 w-full h-full opacity-20 stroke-white pointer-events-none" preserveAspectRatio="none">
                <line x1="50" y1="0" x2="50" y2="50" strokeWidth="0.5" />
                <circle cx="50" cy="25" r="8" strokeWidth="0.5" fill="none" />
                <path d="M0 4 L14 4 A 23 23 0 0 1 14 46 L0 46" strokeWidth="0.5" fill="none" />
                <path d="M100 4 L86 4 A 23 23 0 0 0 86 46 L100 46" strokeWidth="0.5" fill="none" />
            </svg>
            <motion.div animate={{ left: `${state.ballX}%`, top: '50%' }} transition={TOKENS.animation.spring} className="absolute z-20 -translate-x-1/2 -translate-y-1/2">
                <div className="w-3 h-3 rounded-full bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.6)]" />
            </motion.div>
            <div className="absolute bottom-3 right-3 z-30 flex items-center gap-2 px-3 py-1 bg-black/80 backdrop-blur rounded-full border border-white/10">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                <span className="text-[10px] font-bold text-white uppercase tracking-wider">Poss {state.activeTeam.abbr}</span>
            </div>
        </div>
    );
});
CourtSchematic.displayName = 'CourtSchematic';

// ============================================================================
// 7. DASHBOARD MODULES (Tables & Cards)
// ============================================================================

const ClosingLinesTable: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { teams, betting } = viewModel;

    return (
        <div className="bg-[#000000] px-6 py-6 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 mb-5">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Closing Lines</span>
            </div>

            <div className="w-full">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr] mb-3 px-2">
                    <span className="text-[9px] font-bold text-zinc-600 tracking-widest uppercase">Team</span>
                    <span className="text-[9px] font-bold text-zinc-600 tracking-widest uppercase text-right">Spread</span>
                    <span className="text-[9px] font-bold text-zinc-600 tracking-widest uppercase text-right">Total</span>
                    <span className="text-[9px] font-bold text-zinc-600 tracking-widest uppercase text-right">Money</span>
                </div>

                {[
                    { team: teams.away, spread: betting.spread, ml: betting.moneyline.away },
                    { team: teams.home, spread: -betting.spread, ml: betting.moneyline.home }
                ].map((row, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr] py-4 border-t border-white/[0.06] items-center px-2">
                        <div className="flex items-center gap-3">
                            <TeamLogo logo={row.team.logo} className="w-5 h-5 object-contain" />
                            <span className="text-[11px] font-bold text-white tracking-wider">{row.team.abbr}</span>
                        </div>
                        <span className="text-xs font-mono text-white text-right">{betting.hasSpread ? (row.spread > 0 ? `+${row.spread}` : row.spread) : '-'}</span>
                        <span className="text-xs font-mono text-white text-right">{betting.hasTotal ? (i === 0 ? `o${betting.total}` : `u${betting.total}`) : '-'}</span>
                        <span className="text-xs font-mono text-zinc-500 text-right">{row.ml}</span>
                    </div>
                ))}
            </div>
        </div>
    );
});
ClosingLinesTable.displayName = 'ClosingLinesTable';

const BoxScoreCard: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { homeTeamStats, awayTeamStats } = viewModel.stats;
    const { teams, meta } = viewModel;

    const findStat = (stats: any, keys: string[]) => {
        if (!stats) return 0;
        for (const k of keys) if (stats[k] !== undefined) return parseFloat(stats[k]);
        return 0;
    };

    const rows = useMemo(() => {
        if (!homeTeamStats && !awayTeamStats) return [];
        const config = meta.isFootball
            ? [{ l: 'Tot Yds', k: ['yards', 'total_yards'] }, { l: 'Pass Yds', k: ['passing_yards'] }, { l: 'Rush Yds', k: ['rushing_yards'] }, { l: 'TO', k: ['turnovers', 'to'] }]
            : [{ l: 'FG%', k: ['fg_pct'], f: '%' }, { l: '3P%', k: ['fg3_pct'], f: '%' }, { l: 'FT%', k: ['ft_pct'], f: '%' }, { l: 'REB', k: ['reb', 'rebounds'] }, { l: 'AST', k: ['ast', 'assists'] }, { l: 'TO', k: ['tov', 'turnovers'] }];

        return config.map(({ l, k, f }) => {
            const h = findStat(homeTeamStats, k), a = findStat(awayTeamStats, k);
            const fmt = (n: number) => f === '%' ? (n <= 1 ? (n * 100).toFixed(0) + '%' : n.toFixed(1) + '%') : n.toFixed(0);
            return { label: l, home: fmt(h), away: fmt(a) };
        });
    }, [homeTeamStats, awayTeamStats, meta.isFootball]);

    if (!rows.length) return null;

    return (
        <div className="bg-[#000000] border-t border-white/[0.04] pb-20">
            <div className="flex items-center gap-2 mb-4 px-8 pt-8">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Match Stats</span>
            </div>
            {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_1fr] py-4 px-8 border-b border-white/[0.04] items-center">
                    <span className="text-sm font-mono text-white text-left">{row.away}</span>
                    <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase">{row.label}</span>
                    <span className="text-sm font-mono text-white text-right">{row.home}</span>
                </div>
            ))}
        </div>
    );
});
BoxScoreCard.displayName = 'BoxScoreCard';

const PredictionCard: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { signals } = viewModel.betting;
    if (!signals) return null;
    const { edge_state, edge_points, deterministic_fair_total, market_total } = signals;
    const isPlay = edge_state === 'PLAY';
    const isOver = safeNumber(deterministic_fair_total) > safeNumber(market_total);

    return (
        <ObsidianPanel hover className="p-5 flex flex-col justify-between min-h-[130px]">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2"><Target size={14} className="text-zinc-500" /><Label>Model</Label></div>
                <div className={cn("px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border", isPlay ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/10" : "text-zinc-500 border-white/5 bg-white/5")}>
                    {isPlay ? "Strong Value" : "Neutral"}
                </div>
            </div>
            <div>
                <div className="flex items-baseline justify-between">
                    <DataValue value={safeNumber(deterministic_fair_total).toFixed(1)} size="lg" />
                    <div className={cn("flex items-center gap-0.5 text-lg font-mono font-bold", isPlay ? (isOver ? 'text-emerald-400' : 'text-rose-400') : 'text-zinc-500')}>
                        {isOver ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        {Math.abs(safeNumber(edge_points)).toFixed(1)}
                    </div>
                </div>
                <Label className="mt-1 opacity-50 normal-case tracking-normal">vs Mkt {market_total}</Label>
            </div>
        </ObsidianPanel>
    );
});
PredictionCard.displayName = 'PredictionCard';

// ============================================================================
// 8. HEADER (Symmetrical Horizontal Layout)
// ============================================================================

export const ScoreHeader: FC<{ match: Match }> = memo(({ match }) => {
    const vm = useGameViewModel(match as ExtendedMatch);
    const [activeTab, setActiveTab] = useState('GAME');
    if (!vm) return <div className="h-[360px] bg-black animate-pulse" />;

    const { teams, meta } = vm;

    return (
        <header className="relative w-full bg-[#000000] flex flex-col items-center pt-6 overflow-hidden select-none">
            {/* League Pill */}
            <div className="absolute top-4 flex items-center justify-between w-full px-6 z-20">
                <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase cursor-pointer hover:text-white transition-colors">Back</span>
                <div className="px-3 py-1 rounded-full border border-white/[0.08] bg-white/[0.02]">
                    <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase">{meta.league || 'LIVE'}</span>
                </div>
                <div className={cn("w-2 h-2 rounded-full", meta.isFinished ? "bg-zinc-800" : "bg-emerald-500 shadow-[0_0_8px_#10b981]")} />
            </div>

            {/* Cinematic Atmosphere */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-[10%] left-1/2 -translate-x-1/2 w-[120%] h-[60%] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03)_0%,transparent_70%)] blur-[60px]" />
                <div className="absolute top-[30%] -left-[20%] w-[80%] h-[80%] blur-[120px] opacity-20" style={{ background: teams.away.color }} />
                <div className="absolute top-[30%] -right-[20%] w-[80%] h-[80%] blur-[120px] opacity-20" style={{ background: teams.home.color }} />
            </div>

            {/* Horizontal Face-Off (Grid for Precision Center) */}
            <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-8 w-full max-w-5xl px-4 sm:px-8 mt-16 mb-10">

                {/* Away Team */}
                <div className="flex flex-col items-center gap-3">
                    <TeamLogo logo={teams.away.logo} className="w-14 h-14 sm:w-24 sm:h-24 object-contain drop-shadow-2xl opacity-90" />
                    <div className="text-center">
                        {/* Desktop Name */}
                        <h2 className="hidden sm:block text-2xl font-black text-white tracking-widest uppercase leading-none">{teams.away.name}</h2>
                        {/* Mobile Abbr */}
                        <h2 className="sm:hidden text-xs font-black text-zinc-400 tracking-widest uppercase">{teams.away.abbr}</h2>
                        <span className="text-[9px] sm:text-[10px] font-mono text-zinc-500 tracking-wider mt-1 hidden sm:block">{teams.away.record}</span>
                    </div>
                </div>

                {/* Score Core */}
                <div className="flex flex-col items-center gap-4 px-2">
                    <div className="flex items-center gap-6 sm:gap-12">
                        <span className="text-5xl sm:text-8xl font-light text-white tabular-nums tracking-tighter drop-shadow-lg">{teams.away.score}</span>
                        <span className="text-5xl sm:text-8xl font-light text-white tabular-nums tracking-tighter drop-shadow-lg">{teams.home.score}</span>
                    </div>
                    <div className="px-3 py-1 sm:px-4 sm:py-1.5 rounded-full border border-white/[0.08] bg-black/40 backdrop-blur-md">
                        <span className="text-[10px] sm:text-[11px] font-medium text-amber-500 tracking-widest tabular-nums">{meta.displayClock}</span>
                    </div>
                </div>

                {/* Home Team */}
                <div className="flex flex-col items-center gap-3">
                    <TeamLogo logo={teams.home.logo} className="w-14 h-14 sm:w-24 sm:h-24 object-contain drop-shadow-2xl opacity-90" />
                    <div className="text-center">
                        <h2 className="hidden sm:block text-2xl font-black text-white tracking-widest uppercase leading-none">{teams.home.name}</h2>
                        <h2 className="sm:hidden text-xs font-black text-zinc-400 tracking-widest uppercase">{teams.home.abbr}</h2>
                        <span className="text-[9px] sm:text-[10px] font-mono text-zinc-500 tracking-wider mt-1 hidden sm:block">{teams.home.record}</span>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="w-full flex items-center justify-center gap-8 border-b border-white/[0.08] pb-4 overflow-x-auto no-scrollbar px-4">
                {['GAME', 'PROPS', 'EDGE', 'AI'].map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                            "text-[10px] sm:text-[11px] font-bold tracking-[0.15em] transition-colors pb-2 relative shrink-0",
                            activeTab === tab ? "text-white" : "text-zinc-600 hover:text-zinc-400"
                        )}
                    >
                        {tab}
                        {activeTab === tab && <motion.div layoutId="tab" className="absolute bottom-[-17px] left-0 right-0 h-[2px] bg-white" />}
                    </button>
                ))}
            </div>
        </header>
    );
});
ScoreHeader.displayName = 'ScoreHeader';

// ============================================================================
// 9. ROOT COMPONENT
// ============================================================================

export const LiveGameTracker: FC<{ match: Match; liveState?: unknown }> = memo(({ match, liveState }) => {
    const mergedMatch = useMemo(() => mergeMatchWithLiveState(match as ExtendedMatch, liveState), [match, liveState]);
    const vm = useGameViewModel(mergedMatch);

    if (!vm) return <div className="h-[300px] flex items-center justify-center bg-black"><Activity className="text-zinc-700 animate-pulse" /></div>;

    return (
        <div className="flex flex-col w-full bg-[#000000] min-h-screen overflow-x-hidden">
            <ScoreHeader match={vm.normalized} />

            {/* Main Content */}
            <div className="w-full animate-in fade-in duration-700">
                {/* Visualization Layer */}
                <div className="w-full border-b border-white/[0.06]">
                    {vm.meta.isFootball ? <FieldSchematic viewModel={vm} /> : vm.meta.isBasketball ? <CourtSchematic viewModel={vm} /> : null}
                </div>

                {/* Live Ticker */}
                <div className="px-6 py-4 border-b border-white/[0.04] flex gap-3 items-start bg-[#050505]">
                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    <p className="text-xs font-medium text-zinc-300 leading-relaxed">{vm.gameplay.lastPlay?.text || "Game in progress..."}</p>
                </div>

                {/* Data Modules */}
                <ClosingLinesTable viewModel={vm} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/[0.06] border-b border-white/[0.06]">
                    <PredictionCard viewModel={vm} />
                    <ObsidianPanel hover className="p-5 flex flex-col justify-between min-h-[130px]">
                        <div className="flex items-center gap-2"><Radio size={14} className="text-zinc-500" /><Label>Feed Status</Label></div>
                        <div className="flex items-center gap-2 text-zinc-400 text-xs"><div className="w-1 h-1 bg-emerald-500 rounded-full" /> Live Data Stream Active</div>
                    </ObsidianPanel>
                </div>

                <BoxScoreCard viewModel={vm} />
            </div>
        </div>
    );
});
LiveGameTracker.displayName = 'LiveGameTracker';

// Backward compatibility export - accepts match prop, creates viewModel internally
export const LiveTotalCard: FC<{ match: Match }> = memo(({ match }) => {
    const vm = useGameViewModel(match as ExtendedMatch);
    if (!vm) return <ObsidianPanel className="p-6 flex flex-col items-center justify-center min-h-[160px]"><Activity className="text-zinc-600 animate-spin mb-2" /><Label>Loading...</Label></ObsidianPanel>;
    return <ClosingLinesTable viewModel={vm} />;
});
LiveTotalCard.displayName = 'LiveTotalCard';

export default LiveGameTracker;
