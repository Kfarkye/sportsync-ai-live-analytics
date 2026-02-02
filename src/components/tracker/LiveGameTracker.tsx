// ============================================================================
// src/components/tracker/LiveGameTracker.tsx
// ============================================================================
//
// Live Game Tracker — Broadcast-Grade Sports Visualization
// Design Language: "Stadium After Dark"
//
// ============================================================================

import React, {
    memo,
    useMemo,
    type FC,
    type ReactNode,
    type ElementType,
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
    Trophy,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    ChevronDown,
    TrendingUp,
    CheckCircle2,
    DollarSign,
    Zap,
    Target,
    Radio,
} from 'lucide-react';

import { Sport, type Match, type ExtendedMatch } from '../../types';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '../../lib/essence';
import { isGameFinished } from '../../utils/matchUtils';
import { computeAISignals } from '../../services/gameStateEngine';

// ============================================================================
// DESIGN SYSTEM
// ============================================================================

const TOKENS = {
    colors: {
        void: '#000000',
        abyss: '#030303',
        carbon: '#080808',
        graphite: '#0d0d0d',
        slate: '#141414',
        ash: '#1a1a1a',
        ink: {
            primary: '#ffffff',
            secondary: 'rgba(255, 255, 255, 0.75)',
            tertiary: 'rgba(255, 255, 255, 0.50)',
            muted: 'rgba(255, 255, 255, 0.25)',
            ghost: 'rgba(255, 255, 255, 0.10)',
        },
        turf: {
            base: '#0d1a10',
            dark: '#091208',
            light: '#132617',
            stripe: { a: '#132617', b: '#1a3a22' },
        },
        hardwood: {
            base: '#1a120b',
            dark: '#0f0a06',
            light: '#2a1f14',
        },
        accent: {
            live: '#ef4444',
            positive: '#10b981',
            negative: '#f43f5e',
            warning: '#f59e0b',
            info: '#3b82f6',
            gold: '#fbbf24',
        },
        signal: {
            play: '#10b981',
            lean: '#f59e0b',
            neutral: '#6b7280',
        },
    },
    typography: {
        families: {
            display: "'Oswald', 'Bebas Neue', sans-serif",
            mono: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace",
            body: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        },
    },
    animation: {
        spring: { type: 'spring', stiffness: 400, damping: 30, mass: 0.8 } as Transition,
        springGentle: { type: 'spring', stiffness: 200, damping: 25, mass: 1 } as Transition,
        fade: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } as Transition,
    },
    effects: {
        noise: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")`,
    },
    radii: {
        none: '0', sm: '0.25rem', md: '0.5rem', lg: '0.75rem',
        xl: '1rem', '2xl': '1.5rem', full: '9999px',
    },
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function safeNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const n = Number(value.trim());
        if (Number.isFinite(n)) return n;
    }
    return fallback;
}

function normalizeColor(color: string | undefined, fallback: string): string {
    if (!color) return fallback;
    const c = color.trim();
    if (/^(rgb|rgba|hsl|hsla)\(/i.test(c)) return c;
    const hex = c.replace(/^#/, '');
    if (!/^[0-9a-fA-F]{3,8}$/.test(hex)) return fallback;
    const expanded = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
    if (expanded.length !== 6 && expanded.length !== 8) return fallback;
    return `#${expanded.toLowerCase()}`;
}

function toRgba(color: string, alpha: number): string {
    const a = Math.max(0, Math.min(1, alpha));
    const c = (color || '').trim();
    if (c.startsWith('#')) {
        const hex = c.slice(1);
        if (hex.length === 6 || hex.length === 8) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${a})`;
        }
    }
    return `rgba(255, 255, 255, ${a})`;
}

function teamGlow(color: string, position: 'left' | 'right', opacity = 0.08): string {
    const x = position === 'left' ? '20%' : '80%';
    return `radial-gradient(ellipse at ${x} 50%, ${toRgba(color, opacity)} 0%, transparent 70%)`;
}

function parseSafeYardLine(raw: unknown, possessionId: string | number | undefined, homeId: string | number): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.max(0, Math.min(100, raw));
    }
    const s = String(raw || '').toUpperCase();
    const num = parseInt(s.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(num)) return 50;
    const possIsHome = possessionId != null && String(possessionId) === String(homeId);
    if (s.includes('OWN')) return possIsHome ? 100 - num : num;
    if (s.includes('OPP')) return possIsHome ? num : 100 - num;
    if (s.includes('MID')) return 50;
    return Math.max(0, Math.min(100, num));
}

function getOrdinal(n: number): string {
    const v = n % 100;
    if (v >= 11 && v <= 13) return 'th';
    const suffixes = ['th', 'st', 'nd', 'rd'];
    return suffixes[n % 10] || suffixes[0];
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

interface GlassPanelBaseProps {
    children: ReactNode;
    className?: string;
    as?: ElementType;
}

const GlassPanel: FC<GlassPanelBaseProps> = memo(({ children, className, as: Component = 'div' }) => (
    <Component className={cn('relative overflow-hidden bg-[#080808] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]', className)}>
        <div className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-60" style={{ backgroundImage: TOKENS.effects.noise }} aria-hidden="true" />
        <div className="relative z-10 h-full">{children}</div>
    </Component>
));
GlassPanel.displayName = 'GlassPanel';

interface LiveIndicatorProps { label?: string; color?: string; size?: 'sm' | 'md' | 'lg'; }

const LiveIndicator: FC<LiveIndicatorProps> = memo(({ label = 'LIVE', color = TOKENS.colors.accent.live, size = 'md' }) => {
    const prefersReducedMotion = useReducedMotion();
    const dotSize = { sm: 'w-1.5 h-1.5', md: 'w-2 h-2', lg: 'w-2.5 h-2.5' }[size];
    return (
        <div className="flex items-center gap-2">
            <span className="relative flex" aria-hidden="true">
                <span className={cn(dotSize, 'rounded-full')} style={{ backgroundColor: color }} />
                {!prefersReducedMotion && <span className={cn(dotSize, 'absolute rounded-full animate-ping')} style={{ backgroundColor: color, opacity: 0.75 }} />}
            </span>
            {label ? <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color }}>{label}</span> : <span className="sr-only">Live</span>}
        </div>
    );
});
LiveIndicator.displayName = 'LiveIndicator';

interface StatBlockProps { value: string | number; label: string; highlight?: boolean; }

const StatBlock: FC<StatBlockProps> = memo(({ value, label, highlight }) => (
    <div className="flex flex-col items-center justify-center p-4">
        <span className={cn('text-2xl sm:text-3xl font-mono font-semibold tabular-nums tracking-tight leading-none', highlight ? 'text-white' : 'text-white/90')}>{value}</span>
        <span className="mt-2 text-[9px] font-bold uppercase tracking-[0.15em] text-white/40">{label}</span>
    </div>
));
StatBlock.displayName = 'StatBlock';

// ============================================================================
// TYPES
// ============================================================================

interface PlayData { id?: string; text?: string; }
interface FieldSituation { yardLine?: string | number; down?: number | string; distance?: number; possessionId?: string | number; possession?: string; isRedZone?: boolean; downDistanceText?: string; }
interface CourtSituation { possessionId?: string | number; possession?: string; ballX?: number; ballY?: number; }
interface DriveData { plays?: number; yards?: number; timeElapsed?: string; }

// ============================================================================
// FIELD GRAPHIC (NFL/CFB) - Hooks always called, early return AFTER hooks
// ============================================================================

interface FieldGraphicProps {
    situation: FieldSituation | null;
    homeId: string | number;
    homeAbbr: string;
    awayAbbr: string;
    homeLogo: string;
    awayLogo: string;
    homeColor: string;
    awayColor: string;
}

const FieldGraphic: FC<FieldGraphicProps> = memo(({ situation, homeId, homeAbbr, awayAbbr, homeLogo, awayLogo, homeColor, awayColor }) => {
    const prefersReducedMotion = useReducedMotion();

    // All calculations done unconditionally to avoid hook order issues
    const possessionId = situation?.possessionId;
    const yardLine = parseSafeYardLine(situation?.yardLine, possessionId, homeId);
    const down = Math.max(1, safeNumber(situation?.down, 1));
    const distance = Math.max(0, safeNumber(situation?.distance, 10));
    const possessionText = String(situation?.possession || '').toUpperCase();
    const homeAbbrSafe = String(homeAbbr || '').toUpperCase();

    const isHomePossession = (possessionId != null && String(possessionId) === String(homeId)) || (possessionText && possessionText === homeAbbrSafe);
    const rawBallX = 10 + (yardLine * 0.8);
    const ballX = Number.isFinite(rawBallX) ? rawBallX : 50;
    const targetYard = isHomePossession ? Math.max(yardLine - distance, 0) : Math.min(yardLine + distance, 100);
    const rawLineToGainX = 10 + (targetYard * 0.8);
    const lineToGainX = Number.isFinite(rawLineToGainX) ? rawLineToGainX : 50;
    const isRedZone = Boolean(situation?.isRedZone) || (isHomePossession ? yardLine <= 20 : yardLine >= 80);
    const displayYard = yardLine > 50 ? 100 - yardLine : yardLine;
    const downText = situation?.downDistanceText || (() => {
        const ordinal = `${down}${getOrdinal(down)}`;
        const isGoal = targetYard <= 0 || targetYard >= 100;
        const distText = isGoal ? 'GOAL' : distance < 1 ? 'INCHES' : distance;
        return `${ordinal} & ${distText}`;
    })();
    const possTeam = isHomePossession ? { abbr: homeAbbr, logo: homeLogo, color: homeColor } : { abbr: awayAbbr, logo: awayLogo, color: awayColor };

    // Early return AFTER all hooks
    if (!situation) {
        return (
            <div className="relative w-full aspect-[2.4/1] bg-gradient-to-b from-[#152818] to-[#0d1a10] flex items-center justify-center">
                <div className="flex items-center gap-3 text-white/20">
                    <Radio size={16} className={cn(!prefersReducedMotion && 'animate-pulse')} />
                    <span className="text-[11px] font-bold uppercase tracking-[0.3em]">Awaiting Field Data</span>
                </div>
            </div>
        );
    }

    return (
        <div className="relative w-full aspect-[2.4/1] overflow-hidden select-none isolate" role="img" aria-label={`Football field: ${possTeam.abbr} ball on the ${displayYard} yard line, ${downText}`}>
            <div className="absolute inset-0 bg-gradient-to-b from-[#1a3a22] via-[#152818] to-[#0d1a10]">
                <div className="absolute inset-x-[10%] inset-y-0 flex">
                    {Array.from({ length: 10 }, (_, i) => (
                        <div key={i} className="h-full flex-1 border-r border-white/[0.03]" style={{ backgroundColor: i % 2 === 0 ? TOKENS.colors.turf.stripe.a : TOKENS.colors.turf.stripe.b }} />
                    ))}
                </div>
                <div className="absolute inset-0 mix-blend-overlay opacity-30" style={{ backgroundImage: TOKENS.effects.noise }} aria-hidden="true" />
                <AnimatePresence>
                    {isRedZone && !prefersReducedMotion && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: [0, 0.15, 0] }} exit={{ opacity: 0 }} transition={{ duration: 2, repeat: Infinity }} className="absolute inset-0 bg-rose-500/20" />
                    )}
                </AnimatePresence>
            </div>
            <div className="absolute inset-y-0 left-0 w-[10%] border-r border-white/[0.05] flex items-center justify-center overflow-hidden" style={{ backgroundColor: toRgba(awayColor, 0.06) }}>
                <TeamLogo logo={awayLogo} className="absolute w-28 h-28 opacity-[0.08] grayscale blur-[2px]" />
                <span className="-rotate-90 text-[9px] font-bold text-white/15 tracking-[0.4em] uppercase">{awayAbbr}</span>
            </div>
            <div className="absolute inset-y-0 right-0 w-[10%] border-l border-white/[0.05] flex items-center justify-center overflow-hidden" style={{ backgroundColor: toRgba(homeColor, 0.06) }}>
                <TeamLogo logo={homeLogo} className="absolute w-28 h-28 opacity-[0.08] grayscale blur-[2px]" />
                <span className="rotate-90 text-[9px] font-bold text-white/15 tracking-[0.4em] uppercase">{homeAbbr}</span>
            </div>
            <div className="absolute inset-y-0 left-0 right-0 z-10 pointer-events-none">
                <motion.div animate={{ left: `${ballX}%` }} transition={TOKENS.animation.spring} className="absolute inset-y-0 w-[3px] bg-blue-500" style={{ boxShadow: '0 0 12px rgba(59, 130, 246, 0.6)' }} />
                {distance > 0 && distance < 99 && (
                    <motion.div animate={{ left: `${lineToGainX}%` }} transition={TOKENS.animation.spring} className="absolute inset-y-0 w-[3px] bg-amber-400" style={{ boxShadow: '0 0 12px rgba(251, 191, 36, 0.6)' }} />
                )}
            </div>
            <div className="absolute top-1/2 -translate-y-1/2 z-20" style={{ left: `${ballX}%` }}>
                <motion.div layoutId="football" transition={TOKENS.animation.spring} className="relative -translate-x-1/2 group">
                    <svg width="18" height="28" viewBox="0 0 24 38" fill="none" className="drop-shadow-[0_6px_12px_rgba(0,0,0,0.7)]" aria-hidden="true">
                        <path d="M12 0C18.6 6.7 24 14.3 24 19C24 23.6 18.6 31.2 12 38C5.3 31.2 0 23.6 0 19C0 14.3 5.3 6.7 12 0Z" fill={isRedZone ? '#f43f5e' : '#5c3317'} />
                        <rect x="11" y="8" width="2" height="22" rx="1" fill="white" fillOpacity="0.75" />
                    </svg>
                </motion.div>
            </div>
            <div className="absolute bottom-3 left-3 z-30">
                <div className="flex items-stretch overflow-hidden rounded-lg bg-black/90 backdrop-blur-xl border border-white/10" style={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)' }}>
                    <div className="flex items-center gap-2 px-3 py-2" style={{ borderLeft: `3px solid ${possTeam.color}` }}>
                        <TeamLogo logo={possTeam.logo} className="w-4 h-4 object-contain" />
                        <span className="text-xs font-bold text-white tracking-tight">{possTeam.abbr}</span>
                    </div>
                    <div className="flex items-center gap-3 px-3 border-l border-white/10 bg-white/[0.03]">
                        <span className="text-sm font-bold text-white uppercase tabular-nums">{downText}</span>
                    </div>
                </div>
            </div>
        </div>
    );
});
FieldGraphic.displayName = 'FieldGraphic';

// ============================================================================
// COURT GRAPHIC (NBA/CBB)
// ============================================================================

interface CourtGraphicProps { situation: CourtSituation | null; homeId: string | number; homeAbbr: string; awayAbbr: string; homeLogo: string; awayLogo: string; homeColor: string; awayColor: string; lastPlay?: PlayData | null; }

const CourtGraphic: FC<CourtGraphicProps> = memo(({ situation, homeId, homeAbbr, awayAbbr, homeLogo, awayLogo, homeColor, awayColor, lastPlay }) => {
    const prefersReducedMotion = useReducedMotion();
    const possessionId = situation?.possessionId;
    const possessionText = String(situation?.possession || '').toUpperCase();
    const homeAbbrSafe = String(homeAbbr || '').toUpperCase();
    const isHomePossession = String(possessionId) === String(homeId) || (possessionText && possessionText === homeAbbrSafe);
    const defaultX = isHomePossession ? 80 : 20;
    let ballX = Math.max(0, Math.min(100, safeNumber(situation?.ballX, defaultX)));
    const ballY = Math.max(0, Math.min(50, safeNumber(situation?.ballY, 25)));
    const playText = (lastPlay?.text || '').toLowerCase();
    const isActiveShot = playText.includes('shot') || playText.includes('jumper') || playText.includes('layup') || playText.includes('dunk');
    if (isActiveShot && situation?.ballX == null) ballX = isHomePossession ? 92 : 8;
    const activeTeam = isHomePossession ? { abbr: homeAbbr, color: homeColor } : { abbr: awayAbbr, color: awayColor };

    return (
        <div className="relative w-full aspect-[2/1] overflow-hidden select-none isolate bg-[#1a120b]" role="img" aria-label={`Basketball court: ${activeTeam.abbr} has possession`}>
            <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f14] via-[#1a120b] to-[#0f0a06]">
                <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 38px, rgba(0,0,0,0.3) 39px, rgba(0,0,0,0.3) 40px)' }} aria-hidden="true" />
                <div className="absolute inset-0 mix-blend-overlay opacity-30" style={{ backgroundImage: TOKENS.effects.noise }} aria-hidden="true" />
            </div>
            <svg viewBox="0 0 100 50" className="absolute inset-0 w-full h-full pointer-events-none opacity-20" preserveAspectRatio="none" aria-hidden="true">
                <rect x="0.5" y="0.5" width="99" height="49" stroke="white" strokeWidth="0.5" fill="none" />
                <line x1="50" y1="0" x2="50" y2="50" stroke="white" strokeWidth="0.4" />
                <circle cx="50" cy="25" r="7" stroke="white" strokeWidth="0.4" fill="none" />
                <circle cx="50" cy="25" r="2" stroke="white" strokeWidth="0.3" fill="none" />
                <rect x="0" y="17" width="19" height="16" stroke="white" strokeWidth="0.4" fill="none" />
                <circle cx="19" cy="25" r="6" stroke="white" strokeWidth="0.3" fill="none" />
                <path d="M 0 3 L 14 3 A 24 24 0 0 1 14 47 L 0 47" stroke="white" strokeWidth="0.35" fill="none" />
                <line x1="4" y1="22" x2="4" y2="28" stroke="white" strokeWidth="0.5" />
                <circle cx="5.5" cy="25" r="0.9" stroke="white" strokeWidth="0.3" fill="none" />
                <rect x="81" y="17" width="19" height="16" stroke="white" strokeWidth="0.4" fill="none" />
                <circle cx="81" cy="25" r="6" stroke="white" strokeWidth="0.3" fill="none" />
                <path d="M 100 3 L 86 3 A 24 24 0 0 0 86 47 L 100 47" stroke="white" strokeWidth="0.35" fill="none" />
                <line x1="96" y1="22" x2="96" y2="28" stroke="white" strokeWidth="0.5" />
                <circle cx="94.5" cy="25" r="0.9" stroke="white" strokeWidth="0.3" fill="none" />
            </svg>
            <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none opacity-[0.06]"><TeamLogo logo={awayLogo} className="w-20 h-20 grayscale blur-[1px]" /></div>
            <div className="absolute inset-y-0 right-6 flex items-center pointer-events-none opacity-[0.06]"><TeamLogo logo={homeLogo} className="w-20 h-20 grayscale blur-[1px]" /></div>
            <motion.div initial={false} animate={{ x: `${ballX}%`, y: `${(ballY / 50) * 100}%`, opacity: 1 }} transition={TOKENS.animation.spring} className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 z-30" aria-hidden="true">
                <div className="relative">
                    {!prefersReducedMotion && <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }} transition={{ duration: 2, repeat: Infinity }} className="absolute inset-0 bg-amber-500/40 blur-md rounded-full" />}
                    <div className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 border border-amber-200/50 shadow-lg flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-white/40" /></div>
                </div>
            </motion.div>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
                <motion.div layoutId="possession-pill" className="flex items-center gap-2.5 px-4 py-2 bg-black/85 backdrop-blur-xl border border-white/10 rounded-full shadow-xl">
                    <div className={cn('w-2 h-2 rounded-full transition-all duration-300', !isHomePossession ? 'bg-amber-400 scale-125 shadow-[0_0_8px_rgba(251,191,36,0.7)]' : 'bg-white/10')} />
                    <div className="flex items-center gap-2 px-2 border-x border-white/10">
                        <span className="text-[9px] font-bold text-white/40 uppercase tracking-[0.15em]">Poss</span>
                        <span className="text-[11px] font-bold text-white tracking-wider" style={{ textShadow: `0 0 8px ${toRgba(activeTeam.color, 0.4)}` }}>{activeTeam.abbr}</span>
                    </div>
                    <div className={cn('w-2 h-2 rounded-full transition-all duration-300', isHomePossession ? 'bg-amber-400 scale-125 shadow-[0_0_8px_rgba(251,191,36,0.7)]' : 'bg-white/10')} />
                </motion.div>
            </div>
        </div>
    );
});
CourtGraphic.displayName = 'CourtGraphic';

// ============================================================================
// LIVE BETTING INTELLIGENCE CARDS
// ============================================================================

interface LiveTotalCardProps { match: ExtendedMatch; }

export const LiveTotalCard: FC<LiveTotalCardProps> = memo(({ match }) => {
    const signals = useMemo(() => computeAISignals(match), [match]);
    const { edge_state, edge_points, deterministic_fair_total, market_total, status_reason } = signals;
    if (status_reason?.includes('Critical')) {
        return <GlassPanel className="p-8 min-h-[180px] flex flex-col items-center justify-center"><Activity size={20} className="text-white/20 mb-3 animate-pulse" /><span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">Model Syncing</span></GlassPanel>;
    }
    const fairTotal = safeNumber(deterministic_fair_total, 0);
    const mktTotal = safeNumber(market_total, 0);
    const isOver = fairTotal > mktTotal;
    const ep = safeNumber(edge_points, 0);
    const edgeDisplay = `${ep > 0 ? '+' : ''}${ep.toFixed(1)}`;
    const stateConfig = { PLAY: { border: isOver ? 'border-emerald-500/20' : 'border-rose-500/20', bg: isOver ? 'bg-emerald-500/[0.02]' : 'bg-rose-500/[0.02]', badge: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' }, LEAN: { border: 'border-amber-500/20', bg: 'bg-amber-500/[0.02]', badge: 'bg-amber-500/10 border-amber-500/20 text-amber-400' }, NEUTRAL: { border: 'border-white/[0.06]', bg: '', badge: '' } }[edge_state ?? 'NEUTRAL'];
    return (
        <GlassPanel className={cn('p-6 min-h-[180px] flex flex-col transition-all duration-500', stateConfig.border, stateConfig.bg)}>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2"><Target size={12} className="text-white/40" /><span className="text-[10px] font-bold text-white/50 uppercase tracking-[0.2em]">Live Forecast</span></div>
                {edge_state === 'PLAY' && <div className={cn('flex items-center gap-1.5 px-2 py-0.5 rounded-full border', stateConfig.badge)}><TrendingUp size={10} /><span className="text-[9px] font-bold uppercase tracking-wider">High Confidence</span></div>}
            </div>
            <div className="flex-1 flex items-end justify-between">
                <div><div className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/30 mb-1 pl-0.5">Projection</div><span className="text-4xl font-mono font-semibold text-white tracking-tighter tabular-nums">{fairTotal.toFixed(1)}</span></div>
                <div className="text-right pb-0.5"><div className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/30 mb-1">Edge</div><div className="flex items-center justify-end gap-1">{edge_state !== 'NEUTRAL' && (isOver ? <ChevronUp size={14} className="text-emerald-400" /> : <ChevronDown size={14} className="text-rose-400" />)}<span className={cn('text-2xl font-mono font-medium tabular-nums tracking-tight', edge_state === 'NEUTRAL' ? 'text-white/40' : isOver ? 'text-emerald-400' : 'text-rose-400')}>{edgeDisplay}</span></div><span className="text-[10px] font-mono text-white/30 tabular-nums">vs {mktTotal}</span></div>
            </div>
        </GlassPanel>
    );
});
LiveTotalCard.displayName = 'LiveTotalCard';

// ============================================================================
// ADDITIONAL CARDS
// ============================================================================

const DriveStatsCard: FC<{ drive: DriveData | null }> = memo(({ drive }) => {
    const plays = safeNumber(drive?.plays, 0);
    const yards = safeNumber(drive?.yards, 0);
    const time = String(drive?.timeElapsed ?? '0:00');
    const progress = Math.min((yards / 80) * 100, 100);
    return (
        <GlassPanel className="p-6 min-h-[180px] flex flex-col relative overflow-hidden group">
            <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><Zap size={12} className="text-emerald-400" /><span className="text-[10px] font-bold text-emerald-400 uppercase tracking-[0.2em]">Drive</span></div><Shield size={14} className="text-white/10" /></div>
            <div className="mb-5"><div className="text-xl font-bold text-white uppercase tracking-tight">Drive Active</div><div className="mt-2 h-1.5 bg-white/[0.06] rounded-full overflow-hidden border border-white/[0.04]"><motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={TOKENS.animation.springGentle} className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full" /></div></div>
            <div className="grid grid-cols-3 gap-px bg-white/[0.04] rounded-xl overflow-hidden border border-white/[0.04]"><StatBlock value={plays} label="Plays" /><div className="border-x border-white/[0.04]"><StatBlock value={yards} label="Yards" highlight /></div><StatBlock value={time} label="Clock" /></div>
            <div className="absolute -bottom-4 -right-4 opacity-[0.03] pointer-events-none rotate-12"><Trophy size={72} className="text-white" /></div>
        </GlassPanel>
    );
});
DriveStatsCard.displayName = 'DriveStatsCard';

const LatestPlayCard: FC<{ play: PlayData | null }> = memo(({ play }) => (
    <GlassPanel className="p-6 min-h-[180px] flex flex-col">
        <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><Radio size={12} className="text-white/40" /><span className="text-[10px] font-bold text-white/50 uppercase tracking-[0.2em]">Latest Play</span></div><LiveIndicator label="" size="sm" color={TOKENS.colors.accent.info} /></div>
        <div className="flex-1 flex items-center"><AnimatePresence mode="wait"><motion.p key={play?.id ?? 'empty'} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={TOKENS.animation.fade} className="text-[15px] font-medium text-white/80 leading-relaxed" aria-live="polite" aria-atomic="true">{play?.text ?? 'Awaiting play data...'}</motion.p></AnimatePresence></div>
    </GlassPanel>
));
LatestPlayCard.displayName = 'LatestPlayCard';

// ============================================================================
// FINAL GAME TRACKER
// ============================================================================

export const FinalGameTracker: FC<{ match: Match }> = memo(({ match }) => {
    const homeScore = safeNumber(match.homeScore, 0);
    const awayScore = safeNumber(match.awayScore, 0);
    const isHomeWinner = homeScore > awayScore;
    const closingSpread = safeNumber((match as any).closing_odds?.spread, 0);
    const closingTotal = safeNumber((match as any).closing_odds?.total, 0);
    const margin = homeScore - awayScore;
    const hasSpread = Number.isFinite(closingSpread) && closingSpread !== 0;
    const covered = hasSpread ? (margin + closingSpread > 0) : false;
    const totalScore = homeScore + awayScore;
    const hasTotal = Number.isFinite(closingTotal) && closingTotal > 0;
    const isOver = hasTotal ? totalScore > closingTotal : false;
    const WinningBadge: FC = () => <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20"><Trophy size={10} className="text-emerald-400" /><span className="text-[9px] font-black uppercase tracking-[0.1em] text-emerald-400">WINNER</span></div>;
    return (
        <div className="relative group overflow-hidden bg-[#0A0A0A] border border-white/[0.06] rounded-[2rem] p-10 flex flex-col items-center">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 flex flex-col items-center gap-4 mb-12"><div className="px-5 py-2 rounded-full bg-zinc-900/50 border border-white/[0.03] backdrop-blur-md flex items-center gap-3"><div className="w-1.5 h-1.5 rounded-full bg-zinc-500" /><span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400">Match Finalized</span></div></motion.div>
            <div className="relative z-10 w-full max-w-2xl grid grid-cols-[1fr_auto_1fr] items-center gap-8 mb-16">
                <div className="flex flex-col items-end gap-6"><div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.06] p-4 flex items-center justify-center relative"><TeamLogo logo={match.awayTeam.logo} className={cn("w-12 h-12 transition-all duration-700", !isHomeWinner ? "opacity-100 scale-110" : "opacity-30 grayscale")} />{!isHomeWinner && <div className="absolute -top-3 -right-3"><WinningBadge /></div>}</div><div className="text-right"><div className={cn("text-5xl font-mono font-bold tracking-tighter tabular-nums mb-1", !isHomeWinner ? "text-white" : "text-zinc-600")}>{awayScore}</div><div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">{match.awayTeam.abbreviation || match.awayTeam.shortName}</div></div></div>
                <div className="h-24 w-[1px] bg-gradient-to-b from-transparent via-white/10 to-transparent" />
                <div className="flex flex-col items-start gap-6"><div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.06] p-4 flex items-center justify-center relative"><TeamLogo logo={match.homeTeam.logo} className={cn("w-12 h-12 transition-all duration-700", isHomeWinner ? "opacity-100 scale-110" : "opacity-30 grayscale")} />{isHomeWinner && <div className="absolute -top-3 -left-3"><WinningBadge /></div>}</div><div className="text-left"><div className={cn("text-5xl font-mono font-bold tracking-tighter tabular-nums mb-1", isHomeWinner ? "text-white" : "text-zinc-600")}>{homeScore}</div><div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">{match.homeTeam.abbreviation || match.homeTeam.shortName}</div></div></div>
            </div>
            <div className="relative z-10 w-full grid grid-cols-2 gap-px bg-white/[0.06] rounded-2xl overflow-hidden border border-white/[0.06]">
                <div className="bg-[#0D0D0D] p-6 flex flex-col items-center justify-center"><span className="text-[10px] font-black uppercase text-zinc-600 tracking-[0.2em] mb-4">Spread Analysis</span><div className={cn("px-4 py-2 rounded-xl flex items-center gap-3 border", hasSpread ? (covered ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400" : "bg-rose-500/5 border-rose-500/20 text-rose-400") : "bg-zinc-800 border-white/[0.04] text-zinc-400")}><CheckCircle2 size={12} /><span className="text-xs font-bold tracking-tight uppercase">{hasSpread ? (covered ? 'Covers' : 'Fails to Cover') : 'Spread N/A'}</span></div></div>
                <div className="bg-[#0D0D0D] p-6 flex flex-col items-center justify-center"><span className="text-[10px] font-black uppercase text-zinc-600 tracking-[0.2em] mb-4">Total Analysis</span><div className={cn("px-4 py-2 rounded-xl flex items-center gap-3 border", hasTotal ? (isOver ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400" : "bg-zinc-800 border-white/[0.04] text-zinc-400") : "bg-zinc-800 border-white/[0.04] text-zinc-400")}><DollarSign size={12} /><span className="text-xs font-bold tracking-tight uppercase">{hasTotal ? (isOver ? 'OVER HIT' : 'UNDER HIT') : 'TOTAL N/A'}</span></div></div>
            </div>
        </div>
    );
});
FinalGameTracker.displayName = 'FinalGameTracker';

// ============================================================================
// MAIN TRACKER + SCORE HEADER
// ============================================================================

interface LiveGameTrackerProps { match: Match; liveState?: { lastPlay?: PlayData | null; situation?: FieldSituation | CourtSituation | null; currentDrive?: DriveData | null }; }

export const LiveGameTracker: FC<LiveGameTrackerProps> = memo(({ match, liveState }) => {
    if (!match || !match.homeTeam || !match.awayTeam) {
        return <div className="p-8 flex flex-col items-center justify-center bg-[#080808] border border-white/10 rounded-2xl min-h-[200px]"><Activity size={24} className="text-white/20 mb-4 animate-pulse" /><span className="text-[11px] font-bold text-white/30 uppercase tracking-[0.2em]">Initializing Tracker...</span></div>;
    }
    if (isGameFinished(match.status)) return <FinalGameTracker match={match} />;
    const play = (liveState?.lastPlay ?? (match as any).lastPlay) as PlayData | null;
    const situation = (liveState?.situation ?? (match as any).situation) as FieldSituation | CourtSituation | null;
    const drive = (liveState?.currentDrive ?? (match as any).currentDrive) as DriveData | null;
    const sport = match.sport;
    const league = String((match as any).league || '').toUpperCase();
    const isFootball = sport === Sport.NFL || sport === Sport.COLLEGE_FOOTBALL || (sport as any) === 'CFB' || league === 'NFL' || league === 'CFB';
    const isBasketball = sport === Sport.NBA || sport === Sport.COLLEGE_BASKETBALL || (sport as any) === 'CBB' || league === 'NBA' || league === 'CBB' || league === 'NCAAB';
    const homeColor = normalizeColor(match.homeTeam?.color, '#3b82f6');
    const awayColor = normalizeColor(match.awayTeam?.color, '#ef4444');
    return (
        <div className="flex flex-col w-full">
            <div className="w-full border-b border-white/[0.04]">
                {isFootball ? <FieldGraphic situation={situation as FieldSituation} homeId={match.homeTeam?.id} homeAbbr={match.homeTeam?.abbreviation || match.homeTeam?.shortName || 'HOME'} awayAbbr={match.awayTeam?.abbreviation || match.awayTeam?.shortName || 'AWAY'} homeLogo={match.homeTeam?.logo} awayLogo={match.awayTeam?.logo} homeColor={homeColor} awayColor={awayColor} /> : isBasketball ? <CourtGraphic situation={situation as CourtSituation} homeId={match.homeTeam?.id} homeAbbr={match.homeTeam?.abbreviation || match.homeTeam?.shortName || 'HOME'} awayAbbr={match.awayTeam?.abbreviation || match.awayTeam?.shortName || 'AWAY'} homeLogo={match.homeTeam?.logo} awayLogo={match.awayTeam?.logo} homeColor={homeColor} awayColor={awayColor} lastPlay={play} /> : null}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/[0.04]">{isFootball ? <><LatestPlayCard play={play} /><DriveStatsCard drive={drive} /></> : <><LatestPlayCard play={play} /><LiveTotalCard match={match as ExtendedMatch} /></>}</div>
        </div>
    );
});
LiveGameTracker.displayName = 'LiveGameTracker';

const TeamDisplay: FC<{ team: Match['homeTeam'] | Match['awayTeam']; hasPossession: boolean }> = memo(({ team, hasPossession }) => (
    <div className="flex flex-col items-center gap-4 flex-1 min-w-0">
        <motion.div whileHover={{ scale: 1.03 }} className="relative p-0.5 rounded-2xl bg-white/[0.02] border border-white/[0.04] shadow-lg">
            <TeamLogo logo={team.logo} className="w-12 h-12 sm:w-14 sm:h-14 object-contain brightness-110" />
            {hasPossession && <motion.div layoutId="possession-indicator" className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full border-2 border-black" style={{ boxShadow: '0 0 10px rgba(251, 191, 36, 0.6)' }} />}
        </motion.div>
        <div className="text-center"><h2 className="text-sm font-bold text-white tracking-tight uppercase leading-none mb-1 truncate max-w-[160px]">{team?.shortName ?? team?.name ?? 'TEAM'}</h2><span className="text-[10px] font-mono text-white/40 tracking-wider">{team?.record ?? '0-0'}</span></div>
    </div>
));
TeamDisplay.displayName = 'TeamDisplay';

export const ScoreHeader: FC<{ match: Match }> = memo(({ match }) => {
    if (!match || !match.homeTeam || !match.awayTeam) return <div className="w-full h-[180px] bg-[#020203] border-b border-white/5" />;
    const homeColor = normalizeColor(match.homeTeam?.color, '#3b82f6');
    const awayColor = normalizeColor(match.awayTeam?.color, '#ef4444');
    const possessionId = (match as any).situation?.possessionId;
    const isHomePossession = possessionId != null && String(possessionId) === String(match.homeTeam?.id);
    const isAwayPossession = possessionId != null && String(possessionId) === String(match.awayTeam?.id);
    return (
        <header className="relative w-full h-[180px] sm:h-[200px] overflow-hidden bg-[#020203] flex items-center justify-center" role="banner">
            <div className="absolute inset-0 pointer-events-none" aria-hidden="true"><div className="absolute top-[-60%] left-[-25%] w-[80%] h-[220%] blur-[120px] opacity-[0.08]" style={{ background: teamGlow(awayColor, 'left', 0.10) }} /><div className="absolute top-[-60%] right-[-25%] w-[80%] h-[220%] blur-[120px] opacity-[0.08]" style={{ background: teamGlow(homeColor, 'right', 0.10) }} /></div>
            <div className="relative z-10 w-full px-6 max-w-5xl">
                <div className="flex items-center justify-between gap-4 sm:gap-12">
                    <TeamDisplay team={match.awayTeam} hasPossession={isAwayPossession} />
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex items-center gap-6 sm:gap-10"><motion.span key={`away-${match.awayScore}`} initial={{ opacity: 0.5, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-4xl sm:text-6xl font-mono font-light text-white tracking-tighter tabular-nums">{safeNumber(match.awayScore, 0)}</motion.span><span className="text-2xl font-light text-white/10 select-none">—</span><motion.span key={`home-${match.homeScore}`} initial={{ opacity: 0.5, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-4xl sm:text-6xl font-mono font-light text-white tracking-tighter tabular-nums">{safeNumber(match.homeScore, 0)}</motion.span></div>
                        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.06] backdrop-blur-xl"><span className={cn("text-[11px] font-black uppercase tracking-[0.3em] tabular-nums", isGameFinished(match.status) ? "text-amber-500" : "text-rose-500")}>{isGameFinished(match.status) ? 'FINAL' : String((match as any).displayClock ?? 'PREGAME')}</span></motion.div>
                    </div>
                    <TeamDisplay team={match.homeTeam} hasPossession={isHomePossession} />
                </div>
            </div>
        </header>
    );
});
ScoreHeader.displayName = 'ScoreHeader';

export default LiveGameTracker;
