// ============================================================================
// src/components/tracker/LiveGameTracker.tsx
// ============================================================================
//
// Live Game Tracker — Broadcast-Grade Sports Visualization
// A real-time game state engine for NFL, CFB, NBA, and CBB with ESPN-tier
// visual fidelity and Vegas-grade betting intelligence integration.
//
// Design Language: "Stadium After Dark"
// - Deep blacks with luminous accents
// - Broadcast typography (condensed, high-contrast)
// - Subtle environmental lighting per team color
// - Micro-animations that convey momentum without distraction
//
// Performance: Memoized components, spring physics, CSS-accelerated transforms
// Accessibility: Reduced motion support, semantic markup, ARIA live regions
//
// ============================================================================

import React, {
    memo,
    useMemo,
    type FC,
    type ReactNode,
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

// Internal imports (adjust paths as needed)
import { Sport, type Match, type ExtendedMatch } from '../../types';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '../../lib/essence';
import { isGameInProgress, isGameFinished } from '../../utils/matchUtils';
import { computeAISignals } from '../../services/gameStateEngine';

// ============================================================================
// DESIGN SYSTEM
// ============================================================================

/**
 * Centralized design tokens following a "Stadium After Dark" aesthetic.
 * Deep blacks, luminous team colors, broadcast typography.
 */
const TOKENS = {
    // ———————————————————————––
    // Color Palette
    // ———————————————————————––
    colors: {
        // Core surfaces
        void: '#000000',
        abyss: '#030303',
        carbon: '#080808',
        graphite: '#0d0d0d',
        slate: '#141414',
        ash: '#1a1a1a',

        // Text hierarchy
        ink: {
            primary: '#ffffff',
            secondary: 'rgba(255, 255, 255, 0.75)',
            tertiary: 'rgba(255, 255, 255, 0.50)',
            muted: 'rgba(255, 255, 255, 0.25)',
            ghost: 'rgba(255, 255, 255, 0.10)',
        },

        // Sport-specific surfaces
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

        // Semantic accents
        accent: {
            live: '#ef4444',
            positive: '#10b981',
            negative: '#f43f5e',
            warning: '#f59e0b',
            info: '#3b82f6',
            gold: '#fbbf24',
        },

        // Betting signal states
        signal: {
            play: '#10b981',
            lean: '#f59e0b',
            neutral: '#6b7280',
        },
    },

    // ———————————————————————––
    // Typography
    // ———————————————————————––
    typography: {
        families: {
            // Condensed display for scores and stats
            display: "'Oswald', 'Bebas Neue', sans-serif",
            // Monospace for numbers and data
            mono: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace",
            // Body text
            body: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        },
        sizes: {
            '2xs': '0.625rem', // 10px
            xs: '0.6875rem', // 11px
            sm: '0.75rem', // 12px
            base: '0.875rem', // 14px
            lg: '1rem', // 16px
            xl: '1.125rem', // 18px
            '2xl': '1.5rem', // 24px
            '3xl': '1.875rem', // 30px
            '4xl': '2.25rem', // 36px
            '5xl': '3rem', // 48px
            '6xl': '3.75rem', // 60px
        },
        tracking: {
            tighter: '-0.05em',
            tight: '-0.025em',
            normal: '0',
            wide: '0.025em',
            wider: '0.05em',
            widest: '0.1em',
            ultra: '0.2em',
        },
    },

    // ———————————————————————––
    // Animation
    // ———————————————————————––
    animation: {
        spring: {
            type: 'spring',
            stiffness: 400,
            damping: 30,
            mass: 0.8,
        } as Transition,
        springGentle: {
            type: 'spring',
            stiffness: 200,
            damping: 25,
            mass: 1,
        } as Transition,
        fade: {
            duration: 0.3,
            ease: [0.4, 0, 0.2, 1],
        } as Transition,
        stagger: {
            staggerChildren: 0.05,
            delayChildren: 0.1,
        },
    },

    // ———————————————————————––
    // Shadows & Effects
    // ———————————————————————––
    effects: {
        glow: {
            subtle: '0 0 20px rgba(255, 255, 255, 0.05)',
            medium: '0 0 40px rgba(255, 255, 255, 0.1)',
            strong: '0 0 60px rgba(255, 255, 255, 0.15)',
        },
        noise: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")`,
    },

    // ———————————————————————––
    // Spacing & Layout
    // ———————————————————————––
    spacing: {
        px: '1px',
        0.5: '0.125rem',
        1: '0.25rem',
        1.5: '0.375rem',
        2: '0.5rem',
        2.5: '0.625rem',
        3: '0.75rem',
        4: '1rem',
        5: '1.25rem',
        6: '1.5rem',
        8: '2rem',
        10: '2.5rem',
        12: '3rem',
        16: '4rem',
    },

    // ———————————————————————––
    // Borders & Radii
    // ———————————————————————––
    radii: {
        none: '0',
        sm: '0.25rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.5rem',
        full: '9999px',
    },
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Safely normalizes a hex color string.
 */
function normalizeColor(color: string | undefined, fallback: string): string {
    if (!color) return fallback;
    const cleaned = color.replace(/^#?/, '');
    return `#${cleaned}`;
}

/**
 * Creates a radial gradient for team atmosphere lighting.
 */
function teamGlow(color: string, position: 'left' | 'right', opacity = 0.08): string {
    const x = position === 'left' ? '20%' : '80%';
    return `radial-gradient(ellipse at ${x} 50%, ${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')} 0%, transparent 70%)`;
}

/**
 * Parses a yard line string (e.g., "OWN 35", "OPP 20") into a numeric 0-100 value.
 * 0 = Away endzone, 100 = Home endzone.
 */
function parseSafeYardLine(raw: any, possessionId: string | number, homeId: string | number): number {
    const s = String(raw || '').toUpperCase();
    const num = parseInt(s.replace(/[^0-9]/g, ''));
    if (isNaN(num)) return 50;

    if (s.includes('OWN')) {
        return String(possessionId) === String(homeId) ? 100 - num : num;
    }
    if (s.includes('OPP')) {
        return String(possessionId) === String(homeId) ? num : 100 - num;
    }
    if (s.includes('MID')) return 50;

    return num;
}

/**
 * Determines ordinal suffix for down number.
 */
function getOrdinal(n: number): string {
    const v = n % 100;
    if (v >= 11 && v <= 13) return 'th';
    const suffixes = ['th', 'st', 'nd', 'rd'];
    return suffixes[n % 10] || suffixes[0];
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

/**
 * GlassPanel — Elevated container with noise texture and subtle border.
 */
interface GlassPanelProps {
    children: ReactNode;
    className?: string;
    as?: keyof React.JSX.IntrinsicElements;
}

const GlassPanel: FC<GlassPanelProps> = memo(({
    children,
    className,
    as: Component = 'div',
}) => (
    // @ts-ignore
    <Component
        className={cn(
            'relative overflow-hidden',
            'bg-[#080808]',
            'border border-white/[0.06]',
            'shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]',
            className
        )}
    >
        {/* Noise texture overlay */}
        <div
            className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-60"
            style={{ backgroundImage: TOKENS.effects.noise }}
            aria-hidden="true"
        />
        {/* Content */}
        <div className="relative z-10 h-full">{children}</div>
    </Component>
));
GlassPanel.displayName = 'GlassPanel';

/**
 * LiveIndicator — Pulsing dot with optional label.
 */
interface LiveIndicatorProps {
    label?: string;
    color?: string;
    size?: 'sm' | 'md' | 'lg';
}

const LiveIndicator: FC<LiveIndicatorProps> = memo(({
    label = 'LIVE',
    color = TOKENS.colors.accent.live,
    size = 'md',
}) => {
    const prefersReducedMotion = useReducedMotion();
    const dotSize = { sm: 'w-1.5 h-1.5', md: 'w-2 h-2', lg: 'w-2.5 h-2.5' }[size];

    return (
        <div className="flex items-center gap-2">
            <span className="relative flex">
                <span
                    className={cn(dotSize, 'rounded-full')}
                    style={{ backgroundColor: color }}
                />
                {!prefersReducedMotion && (
                    <span
                        className={cn(dotSize, 'absolute rounded-full animate-ping')}
                        style={{ backgroundColor: color, opacity: 0.75 }}
                    />
                )}
            </span>
            {label && (
                <span
                    className="text-[10px] font-bold uppercase tracking-[0.2em]"
                    style={{ color }}
                >
                    {label}
                </span>
            )}
        </div>
    );
});
LiveIndicator.displayName = 'LiveIndicator';

/**
 * StatBlock — Compact stat display with label.
 */
interface StatBlockProps {
    value: string | number;
    label: string;
    highlight?: boolean;
}

const StatBlock: FC<StatBlockProps> = memo(({ value, label, highlight }) => (
    <div className="flex flex-col items-center justify-center p-4">
        <span
            className={cn(
                'text-2xl sm:text-3xl font-mono font-semibold tabular-nums tracking-tight leading-none',
                highlight ? 'text-white' : 'text-white/90'
            )}
        >
            {value}
        </span>
        <span className="mt-2 text-[9px] font-bold uppercase tracking-[0.15em] text-white/40">
            {label}
        </span>
    </div>
));
StatBlock.displayName = 'StatBlock';

// ============================================================================
// FIELD VISUALIZATION (NFL / CFB)
// ============================================================================

interface FieldSituation {
    yardLine?: number;
    down?: number;
    distance?: number;
    possessionId?: string | number;
    possession?: string;
    isRedZone?: boolean;
    downDistanceText?: string;
}

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

const FieldGraphic: FC<FieldGraphicProps> = memo(({
    situation,
    homeId,
    homeAbbr,
    awayAbbr,
    homeLogo,
    awayLogo,
    homeColor,
    awayColor,
}) => {
    const prefersReducedMotion = useReducedMotion();

    // Fallback for missing situation (commercials, breaks)
    if (!situation) {
        return (
            <div className="relative w-full aspect-[2.4/1] bg-gradient-to-b from-[#152818] to-[#0d1a10] flex items-center justify-center">
                <div className="flex items-center gap-3 text-white/20">
                    <Radio size={16} className="animate-pulse" />
                    <span className="text-[11px] font-bold uppercase tracking-[0.3em]">
                        Awaiting Field Data
                    </span>
                </div>
            </div>
        );
    }

    // Parse situation data
    const possessionId = situation.possessionId;
    const yardLine = parseSafeYardLine(situation.yardLine, possessionId, homeId);
    const down = Number(situation.down) || 1;
    const distance = situation.distance ?? 10;
    const possessionText = String(situation.possession || '').toUpperCase();
    const homeAbbrSafe = String(homeAbbr || '').toUpperCase();

    // Determine possession
    const isHomePossession =
        String(possessionId) === String(homeId) ||
        (possessionText && possessionText === homeAbbrSafe);

    // Calculate field positions (10%-90% viewport maps to 0-100 yards)
    // 0 = Away side (Left), 100 = Home side (Right)
    const rawBallX = 10 + (yardLine * 0.8);
    const ballX = isNaN(rawBallX) ? 50 : rawBallX;

    const targetYard = isHomePossession
        ? Math.max(yardLine - distance, 0)
        : Math.min(yardLine + distance, 100);
    const rawLineToGainX = 10 + (targetYard * 0.8);
    const lineToGainX = isNaN(rawLineToGainX) ? 50 : rawLineToGainX;

    // Red zone detection
    const isRedZone =
        situation.isRedZone ||
        (isHomePossession ? yardLine <= 20 : yardLine >= 80);

    // Display yard line (convert to standard notation)
    const displayYard = yardLine > 50 ? 100 - yardLine : yardLine;

    // Down and distance text
    const downText = useMemo(() => {
        if (situation.downDistanceText) return situation.downDistanceText;
        const ordinal = `${down}${getOrdinal(down)}`;
        const isGoal = targetYard <= 0 || targetYard >= 100;
        const distText = isGoal ? 'GOAL' : distance < 1 ? 'INCHES' : distance;
        return `${ordinal} & ${distText}`;
    }, [situation.downDistanceText, down, distance, targetYard]);

    // Possession team data
    const possTeam = isHomePossession
        ? { abbr: homeAbbr, logo: homeLogo, color: homeColor }
        : { abbr: awayAbbr, logo: awayLogo, color: awayColor };

    return (
        <div
            className="relative w-full aspect-[2.4/1] overflow-hidden select-none isolate"
            role="img"
            aria-label={`Football field: ${possTeam.abbr} ball on the ${displayYard} yard line, ${downText}`}
        >
            {/* Layer 1: Turf Base */}
            <div className="absolute inset-0 bg-gradient-to-b from-[#1a3a22] via-[#152818] to-[#0d1a10]">
                {/* Yard stripes */}
                <div className="absolute inset-x-[10%] inset-y-0 flex">
                    {Array.from({ length: 10 }, (_, i) => (
                        <div
                            key={i}
                            className="h-full flex-1 border-r border-white/[0.03]"
                            style={{
                                backgroundColor:
                                    i % 2 === 0
                                        ? TOKENS.colors.turf.stripe.a
                                        : TOKENS.colors.turf.stripe.b,
                            }}
                        />
                    ))}
                </div>

                {/* Noise overlay */}
                <div
                    className="absolute inset-0 mix-blend-overlay opacity-30"
                    style={{ backgroundImage: TOKENS.effects.noise }}
                />

                {/* Momentum flow (directional chevrons) */}
                {!prefersReducedMotion && (
                    <div className="absolute inset-0 opacity-[0.06] pointer-events-none overflow-hidden">
                        <motion.div
                            className="absolute inset-0 flex items-center justify-center gap-24"
                            animate={{
                                x: isHomePossession ? ['-5%', '-15%'] : ['5%', '15%'],
                            }}
                            transition={{
                                duration: 3,
                                repeat: Infinity,
                                ease: 'linear',
                            }}
                        >
                            {Array.from({ length: 6 }, (_, i) =>
                                isHomePossession ? (
                                    <ChevronLeft
                                        key={i}
                                        size={100}
                                        className="text-white scale-y-150"
                                    />
                                ) : (
                                    <ChevronRight
                                        key={i}
                                        size={100}
                                        className="text-white scale-y-150"
                                    />
                                )
                            )}
                        </motion.div>
                    </div>
                )}

                {/* Red zone pulse */}
                <AnimatePresence>
                    {isRedZone && !prefersReducedMotion && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0, 0.15, 0] }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="absolute inset-0 bg-rose-500/20"
                        />
                    )}
                </AnimatePresence>
            </div>

            {/* Layer 2: Endzones */}
            <div
                className="absolute inset-y-0 left-0 w-[10%] border-r border-white/[0.05] flex items-center justify-center overflow-hidden"
                style={{ backgroundColor: `${awayColor}10` }}
            >
                <TeamLogo
                    logo={awayLogo}
                    className="absolute w-28 h-28 opacity-[0.08] grayscale blur-[2px]"
                />
                <span className="-rotate-90 text-[9px] font-bold text-white/15 tracking-[0.4em] uppercase">
                    {awayAbbr}
                </span>
            </div>
            <div
                className="absolute inset-y-0 right-0 w-[10%] border-l border-white/[0.05] flex items-center justify-center overflow-hidden"
                style={{ backgroundColor: `${homeColor}10` }}
            >
                <TeamLogo
                    logo={homeLogo}
                    className="absolute w-28 h-28 opacity-[0.08] grayscale blur-[2px]"
                />
                <span className="rotate-90 text-[9px] font-bold text-white/15 tracking-[0.4em] uppercase">
                    {homeAbbr}
                </span>
            </div>

            {/* Layer 3: Yard markers */}
            <div className="absolute inset-y-0 left-[10%] right-[10%] pointer-events-none">
                {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((n) => (
                    <div
                        key={n}
                        className="absolute inset-y-0 w-px bg-white/[0.04]"
                        style={{ left: `${n}%` }}
                    >
                        <span className="absolute top-2 -translate-x-1/2 text-[9px] font-bold text-white/[0.08] tabular-nums">
                            {n > 50 ? 100 - n : n}
                        </span>
                    </div>
                ))}
            </div>

            {/* Layer 4: Virtual lines */}
            <div className="absolute inset-y-0 left-0 right-0 z-10 pointer-events-none">
                {/* Line of scrimmage */}
                <motion.div
                    animate={{ left: `${ballX}%` }}
                    transition={TOKENS.animation.spring}
                    className="absolute inset-y-0 w-[3px] bg-blue-500"
                    style={{
                        boxShadow: '0 0 12px rgba(59, 130, 246, 0.6)',
                    }}
                />

                {/* First down line */}
                {distance > 0 && distance < 99 && (
                    <motion.div
                        animate={{ left: `${lineToGainX}%` }}
                        transition={TOKENS.animation.spring}
                        className="absolute inset-y-0 w-[3px] bg-amber-400"
                        style={{
                            boxShadow: '0 0 12px rgba(251, 191, 36, 0.6)',
                        }}
                    />
                )}
            </div>

            {/* Layer 5: Ball marker */}
            <div
                className="absolute top-1/2 -translate-y-1/2 z-20"
                style={{ left: `${ballX}%` }}
            >
                <motion.div
                    layoutId="football"
                    transition={TOKENS.animation.spring}
                    className="relative -translate-x-1/2 group"
                >
                    {/* Football SVG */}
                    <svg
                        width="18"
                        height="28"
                        viewBox="0 0 24 38"
                        fill="none"
                        className="drop-shadow-[0_6px_12px_rgba(0,0,0,0.7)] transition-transform duration-200 group-hover:scale-110"
                    >
                        <path
                            d="M12 0C18.6 6.7 24 14.3 24 19C24 23.6 18.6 31.2 12 38C5.3 31.2 0 23.6 0 19C0 14.3 5.3 6.7 12 0Z"
                            fill={isRedZone ? '#f43f5e' : '#5c3317'}
                        />
                        <rect x="11" y="8" width="2" height="22" rx="1" fill="white" fillOpacity="0.75" />
                        <rect x="7" y="13" width="10" height="1.5" rx="0.75" fill="white" fillOpacity="0.75" />
                        <rect x="7" y="18" width="10" height="1.5" rx="0.75" fill="white" fillOpacity="0.75" />
                        <rect x="7" y="23" width="10" height="1.5" rx="0.75" fill="white" fillOpacity="0.75" />
                    </svg>

                    {/* Yard marker tooltip */}
                    <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute left-1/2 -translate-x-1/2 -top-10"
                    >
                        <div className="px-2.5 py-1 bg-black/90 backdrop-blur-xl rounded-lg border border-white/10 shadow-lg flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-[9px] font-bold text-white uppercase tracking-[0.15em] whitespace-nowrap tabular-nums">
                                BALL ON {displayYard}
                            </span>
                        </div>
                    </motion.div>
                </motion.div>
            </div>

            {/* Layer 6: HUD - Scorebug */}
            <div className="absolute bottom-3 left-3 z-30">
                <div
                    className="flex items-stretch overflow-hidden rounded-lg bg-black/90 backdrop-blur-xl border border-white/10"
                    style={{
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                    }}
                >
                    {/* Team badge */}
                    <div
                        className="flex items-center gap-2 px-3 py-2"
                        style={{ borderLeft: `3px solid ${possTeam.color}` }}
                    >
                        <TeamLogo logo={possTeam.logo} className="w-4 h-4 object-contain" />
                        <span className="text-xs font-bold text-white tracking-tight">
                            {possTeam.abbr}
                        </span>
                    </div>

                    {/* Down & distance */}
                    <div className="flex items-center gap-3 px-3 border-l border-white/10 bg-white/[0.03]">
                        <motion.span
                            key={downText}
                            initial={{ opacity: 0, y: 3 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-sm font-bold text-white uppercase tabular-nums"
                        >
                            {downText}
                        </motion.span>

                        {/* Down pips */}
                        <div className="flex gap-0.5">
                            {[1, 2, 3, 4].map((d) => (
                                <div
                                    key={d}
                                    className={cn(
                                        'w-1 h-2.5 rounded-full transition-all duration-300',
                                        down >= d
                                            ? 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.6)]'
                                            : 'bg-white/10'
                                    )}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Direction indicator */}
                    <div className="flex items-center justify-center w-9 border-l border-white/[0.05] bg-white/[0.05]">
                        <motion.div
                            animate={{ x: isHomePossession ? [0, 2, 0] : [0, -2, 0] }}
                            transition={{
                                repeat: Infinity,
                                duration: 1.2,
                                ease: 'easeInOut',
                            }}
                        >
                            {isHomePossession ? (
                                <ChevronLeft size={16} className="text-white/70" />
                            ) : (
                                <ChevronRight size={16} className="text-white/70" />
                            )}
                        </motion.div>
                    </div>
                </div>
            </div>
        </div>
    );
});
FieldGraphic.displayName = 'FieldGraphic';

// ============================================================================
// COURT VISUALIZATION (NBA / CBB)
// ============================================================================

interface CourtSituation {
    possessionId?: string | number;
    possession?: string;
    ballX?: number; // 0-100 (left to right)
    ballY?: number; // 0-50 (top to bottom)
}

interface CourtGraphicProps {
    situation: CourtSituation | null;
    homeId: string | number;
    homeAbbr: string;
    awayAbbr: string;
    homeLogo: string;
    awayLogo: string;
    homeColor: string;
    awayColor: string;
}

const CourtGraphic: FC<CourtGraphicProps & { lastPlay?: PlayData | null }> = memo(({
    situation,
    homeId,
    homeAbbr,
    awayAbbr,
    homeLogo,
    awayLogo,
    homeColor,
    awayColor,
    lastPlay,
}) => {
    const prefersReducedMotion = useReducedMotion();

    // 1. Determine possession side
    const possessionId = situation?.possessionId;
    const possessionText = String(situation?.possession || '').toUpperCase();
    const homeAbbrSafe = String(homeAbbr || '').toUpperCase();

    const isHomePossession =
        String(possessionId) === String(homeId) ||
        (possessionText && possessionText === homeAbbrSafe);

    // 2. Calculate ball position (Surgical spatial mapping)
    // Home is usually on the right (75%), Away on the left (25%)
    const defaultX = isHomePossession ? 80 : 20;
    const defaultY = 25;

    let ballX = situation?.ballX ?? defaultX;
    let ballY = situation?.ballY ?? defaultY;

    // Last Play context: If it's a shot or foul, move ball towards the hoop
    const playText = (lastPlay?.text || '').toLowerCase();
    const isActiveShot = playText.includes('shot') || playText.includes('jumper') || playText.includes('layup') || playText.includes('dunk');

    if (isActiveShot && !situation?.ballX) {
        // Move towards the hoop on the active possession side
        ballX = isHomePossession ? 92 : 8;
    }

    // 3. Extract active player for on-court label
    const activePlayerMatch = lastPlay?.text?.match(/([A-Z][a-z]+ [A-Z][a-z]+)/);
    const activePlayer = activePlayerMatch ? activePlayerMatch[1] : null;

    const activeTeam = isHomePossession
        ? { abbr: homeAbbr, color: homeColor }
        : { abbr: awayAbbr, color: awayColor };

    return (
        <div
            className="relative w-full aspect-[2/1] overflow-hidden select-none isolate bg-[#1a120b]"
            role="img"
            aria-label={`Basketball court: ${activeTeam.abbr} has possession`}
        >
            {/* Layer 1: Hardwood base */}
            <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f14] via-[#1a120b] to-[#0f0a06]">
                {/* Wood grain pattern */}
                <div
                    className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage:
                            'repeating-linear-gradient(90deg, transparent, transparent 38px, rgba(0,0,0,0.3) 39px, rgba(0,0,0,0.3) 40px)',
                    }}
                />

                {/* Noise overlay */}
                <div
                    className="absolute inset-0 mix-blend-overlay opacity-30"
                    style={{ backgroundImage: TOKENS.effects.noise }}
                />

                {/* Active side spotlight */}
                {!prefersReducedMotion && (
                    <motion.div
                        animate={{ opacity: [0.1, 0.2, 0.1] }}
                        transition={{ duration: 4, repeat: Infinity }}
                        className="absolute inset-0"
                        style={{
                            background: isHomePossession
                                ? `radial-gradient(ellipse at 75% 50%, ${homeColor}18 0%, transparent 55%)`
                                : `radial-gradient(ellipse at 25% 50%, ${awayColor}18 0%, transparent 55%)`,
                        }}
                    />
                )}
            </div>

            {/* Layer 2: Court lines */}
            <svg
                viewBox="0 0 100 50"
                className="absolute inset-0 w-full h-full pointer-events-none opacity-15"
                preserveAspectRatio="none"
            >
                {/* Half court line */}
                <line x1="50" y1="0" x2="50" y2="50" stroke="white" strokeWidth="0.4" />
                {/* Center circle */}
                <circle cx="50" cy="25" r="7" stroke="white" strokeWidth="0.4" fill="none" />
                {/* Left paint */}
                <rect x="0" y="17" width="19" height="16" stroke="white" strokeWidth="0.4" fill="none" />
                <path d="M 19 17 A 5.5 5.5 0 0 1 19 33" stroke="white" strokeWidth="0.4" fill="none" />
                <path d="M 0 6 Q 26 25 0 44" stroke="white" strokeWidth="0.25" fill="none" />
                {/* Right paint */}
                <rect x="81" y="17" width="19" height="16" stroke="white" strokeWidth="0.4" fill="none" />
                <path d="M 81 17 A 5.5 5.5 0 0 0 81 33" stroke="white" strokeWidth="0.4" fill="none" />
                <path d="M 100 6 Q 74 25 100 44" stroke="white" strokeWidth="0.25" fill="none" />
            </svg>

            {/* Layer 3: Team branding (subtle) */}
            <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none opacity-[0.06]">
                <TeamLogo logo={awayLogo} className="w-20 h-20 grayscale blur-[1px]" />
            </div>
            <div className="absolute inset-y-0 right-6 flex items-center pointer-events-none opacity-[0.06]">
                <TeamLogo logo={homeLogo} className="w-20 h-20 grayscale blur-[1px]" />
            </div>

            {/* Layer 5: Ball marker & Player focus */}
            <motion.div
                initial={false}
                animate={{
                    x: `${ballX}%`,
                    y: `${ballY}%`,
                    opacity: 1
                }}
                transition={TOKENS.animation.spring}
                className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 z-30"
            >
                {/* Luminous Core */}
                <div className="relative">
                    <motion.div
                        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="absolute inset-0 bg-amber-500/40 blur-md rounded-full"
                    />
                    <div className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 border border-amber-200/50 shadow-lg flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-white/40" />
                    </div>

                    {/* Active Player Label */}
                    <AnimatePresence mode="wait">
                        {activePlayer && (
                            <motion.div
                                key={activePlayer}
                                initial={{ opacity: 0, y: 10, scale: 0.8 }}
                                animate={{ opacity: 1, y: -24, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded bg-black/80 backdrop-blur-md border border-white/10"
                            >
                                <span className="text-[9px] font-black uppercase tracking-widest text-white">
                                    {activePlayer}
                                </span>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>

            {/* Layer 6: Possession indicator */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
                <motion.div
                    layoutId="possession-pill"
                    className="flex items-center gap-2.5 px-4 py-2 bg-black/85 backdrop-blur-xl border border-white/10 rounded-full shadow-xl"
                >
                    {/* Away indicator */}
                    <div
                        className={cn(
                            'w-2 h-2 rounded-full transition-all duration-300',
                            !isHomePossession
                                ? 'bg-amber-400 scale-125 shadow-[0_0_8px_rgba(251,191,36,0.7)]'
                                : 'bg-white/10'
                        )}
                    />

                    {/* Label */}
                    <div className="flex items-center gap-2 px-2 border-x border-white/10">
                        <span className="text-[9px] font-bold text-white/40 uppercase tracking-[0.15em]">
                            Poss
                        </span>
                        <span
                            className="text-[11px] font-bold text-white tracking-wider"
                            style={{ textShadow: `0 0 8px ${activeTeam.color}60` }}
                        >
                            {activeTeam.abbr}
                        </span>
                    </div>

                    {/* Home indicator */}
                    <div
                        className={cn(
                            'w-2 h-2 rounded-full transition-all duration-300',
                            isHomePossession
                                ? 'bg-amber-400 scale-125 shadow-[0_0_8px_rgba(251,191,36,0.7)]'
                                : 'bg-white/10'
                        )}
                    />
                </motion.div>
            </div>
        </div>
    );
});
CourtGraphic.displayName = 'CourtGraphic';

// ============================================================================
// LIVE BETTING INTELLIGENCE CARDS
// ============================================================================

interface LiveTotalCardProps {
    match: ExtendedMatch;
}

export const LiveTotalCard: FC<LiveTotalCardProps> = memo(({ match }) => {
    const signals = useMemo(() => computeAISignals(match), [match]);

    const {
        edge_state,
        edge_points,
        deterministic_fair_total,
        market_total,
        status_reason,
    } = signals;

    // Syncing state
    if (status_reason?.includes('Critical')) {
        return (
            <GlassPanel className="p-8 min-h-[180px] flex flex-col items-center justify-center">
                <Activity size={20} className="text-white/20 mb-3 animate-pulse" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">
                    Model Syncing
                </span>
            </GlassPanel>
        );
    }

    const fairTotal = deterministic_fair_total ?? 0;
    const mktTotal = market_total ?? 0;
    const isOver = fairTotal > mktTotal;
    const edgeDisplay = `${edge_points && edge_points > 0 ? '+' : ''}${(edge_points ?? 0).toFixed(1)}`;

    // State-based styling
    const stateConfig = {
        PLAY: {
            border: isOver ? 'border-emerald-500/20' : 'border-rose-500/20',
            bg: isOver ? 'bg-emerald-500/[0.02]' : 'bg-rose-500/[0.02]',
            badge: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
        },
        LEAN: {
            border: 'border-amber-500/20',
            bg: 'bg-amber-500/[0.02]',
            badge: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
        },
        NEUTRAL: {
            border: 'border-white/[0.06]',
            bg: '',
            badge: '',
        },
    }[edge_state ?? 'NEUTRAL'];

    return (
        <GlassPanel
            className={cn(
                'p-6 min-h-[180px] flex flex-col transition-all duration-500',
                stateConfig.border,
                stateConfig.bg
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <Target size={12} className="text-white/40" />
                    <span className="text-[10px] font-bold text-white/50 uppercase tracking-[0.2em]">
                        Live Forecast
                    </span>
                </div>

                {edge_state === 'PLAY' && (
                    <div
                        className={cn(
                            'flex items-center gap-1.5 px-2 py-0.5 rounded-full border',
                            stateConfig.badge
                        )}
                    >
                        <TrendingUp size={10} />
                        <span className="text-[9px] font-bold uppercase tracking-wider">
                            High Confidence
                        </span>
                    </div>
                )}
            </div>

            {/* Data display */}
            <div className="flex-1 flex items-end justify-between">
                {/* Projection */}
                <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/30 mb-1 pl-0.5">
                        Projection
                    </div>
                    <span className="text-4xl font-mono font-semibold text-white tracking-tighter tabular-nums">
                        {fairTotal.toFixed(1)}
                    </span>
                </div>

                {/* Edge */}
                <div className="text-right pb-0.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/30 mb-1">
                        Edge
                    </div>
                    <div className="flex items-center justify-end gap-1">
                        {edge_state !== 'NEUTRAL' &&
                            (isOver ? (
                                <ChevronUp size={14} className="text-emerald-400" />
                            ) : (
                                <ChevronDown size={14} className="text-rose-400" />
                            ))}
                        <span
                            className={cn(
                                'text-2xl font-mono font-medium tabular-nums tracking-tight',
                                edge_state === 'NEUTRAL'
                                    ? 'text-white/40'
                                    : isOver
                                        ? 'text-emerald-400'
                                        : 'text-rose-400'
                            )}
                        >
                            {edgeDisplay}
                        </span>
                    </div>
                    <span className="text-[10px] font-mono text-white/30 tabular-nums">
                        vs {mktTotal}
                    </span>
                </div>
            </div>
        </GlassPanel>
    );
});
LiveTotalCard.displayName = 'LiveTotalCard';

// ============================================================================
// DRIVE STATS CARD (Football)
// ============================================================================

interface DriveData {
    plays?: number;
    yards?: number;
    timeElapsed?: string;
}

interface DriveStatsCardProps {
    drive: DriveData | null;
}

const DriveStatsCard: FC<DriveStatsCardProps> = memo(({ drive }) => {
    const plays = drive?.plays ?? 0;
    const yards = drive?.yards ?? 0;
    const time = drive?.timeElapsed ?? '0:00';
    const progress = Math.min((yards / 80) * 100, 100);

    return (
        <GlassPanel className="p-6 min-h-[180px] flex flex-col relative overflow-hidden group">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Zap size={12} className="text-emerald-400" />
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-[0.2em]">
                        Momentum
                    </span>
                </div>
                <Shield size={14} className="text-white/10" />
            </div>

            {/* Drive status */}
            <div className="mb-5">
                <div className="text-xl font-bold text-white uppercase tracking-tight">
                    Drive Active
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-1.5 bg-white/[0.06] rounded-full overflow-hidden border border-white/[0.04]">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={TOKENS.animation.springGentle}
                        className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full"
                    />
                </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-px bg-white/[0.04] rounded-xl overflow-hidden border border-white/[0.04]">
                <StatBlock value={plays} label="Plays" />
                <div className="border-x border-white/[0.04]">
                    <StatBlock value={yards} label="Yards" highlight />
                </div>
                <StatBlock value={time} label="Clock" />
            </div>

            {/* Background decoration */}
            <div className="absolute -bottom-4 -right-4 opacity-[0.03] pointer-events-none rotate-12 group-hover:rotate-0 transition-transform duration-700">
                <Trophy size={72} className="text-white" />
            </div>
        </GlassPanel>
    );
});
DriveStatsCard.displayName = 'DriveStatsCard';

// ============================================================================
// LATEST PLAY CARD
// ============================================================================

interface PlayData {
    id?: string;
    text?: string;
}

interface LatestPlayCardProps {
    play: PlayData | null;
}

const LatestPlayCard: FC<LatestPlayCardProps> = memo(({ play }) => (
    <GlassPanel className="p-6 min-h-[180px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
                <Radio size={12} className="text-white/40" />
                <span className="text-[10px] font-bold text-white/50 uppercase tracking-[0.2em]">
                    Latest Play
                </span>
            </div>
            <LiveIndicator label="" size="sm" color={TOKENS.colors.accent.info} />
        </div>

        {/* Play text */}
        <div className="flex-1 flex items-center">
            <AnimatePresence mode="wait">
                <motion.p
                    key={play?.id ?? 'empty'}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={TOKENS.animation.fade}
                    className="text-[15px] font-medium text-white/80 leading-relaxed"
                >
                    {play?.text ?? 'Awaiting play data...'}
                </motion.p>
            </AnimatePresence>
        </div>
    </GlassPanel>
));
LatestPlayCard.displayName = 'LatestPlayCard';

// ============================================================================
// FINAL GAME SUMMARY
// ============================================================================

interface FinalGameTrackerProps {
    match: Match;
}

export const FinalGameTracker: FC<FinalGameTrackerProps> = memo(({ match }) => {
    const homeScore = match.homeScore ?? 0;
    const awayScore = match.awayScore ?? 0;
    const isHomeWinner = homeScore > awayScore;

    // Betting resolution (Surgical Recovery)
    const closingSpread = (match as any).closing_odds?.spread ?? 0;
    const closingTotal = (match as any).closing_odds?.total ?? 0;

    const margin = homeScore - awayScore;
    const covered = margin + closingSpread > 0;
    const totalScore = homeScore + awayScore;
    const isOver = totalScore > closingTotal;

    const WinningBadge = ({ team }: { team: any }) => (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <Trophy size={10} className="text-emerald-400" />
            <span className="text-[9px] font-black uppercase tracking-[0.1em] text-emerald-400">WINNER</span>
        </div>
    );

    return (
        <div className="relative group overflow-hidden bg-[#0A0A0A] border border-white/[0.06] rounded-[2rem] p-10 flex flex-col items-center">
            {/* Ambient Background Pulse */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />

            {/* Header: Status Pill */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative z-10 flex flex-col items-center gap-4 mb-12"
            >
                <div className="px-5 py-2 rounded-full bg-zinc-900/50 border border-white/[0.03] backdrop-blur-md flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                    <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400">Match Finalized</span>
                </div>
                <h2 className="text-[13px] font-medium text-zinc-500 uppercase tracking-[0.15em]">Official Result</h2>
            </motion.div>

            {/* Main Scoreboard Layout */}
            <div className="relative z-10 w-full max-w-2xl grid grid-cols-[1fr_auto_1fr] items-center gap-8 mb-16">
                {/* Away Team */}
                <div className="flex flex-col items-end gap-6">
                    <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.06] p-4 flex items-center justify-center relative">
                        <TeamLogo logo={match.awayTeam.logo} className={cn("w-12 h-12 transition-all duration-700", !isHomeWinner ? "opacity-100 scale-110 drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]" : "opacity-30 grayscale")} />
                        {!isHomeWinner && <div className="absolute -top-3 -right-3"><WinningBadge team={match.awayTeam} /></div>}
                    </div>
                    <div className="text-right">
                        <div className={cn("text-5xl font-mono font-bold tracking-tighter tabular-nums mb-1", !isHomeWinner ? "text-white" : "text-zinc-600")}>
                            {match.awayScore}
                        </div>
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">
                            {match.awayTeam.abbreviation || match.awayTeam.shortName}
                        </div>
                    </div>
                </div>

                {/* Vertical Divider */}
                <div className="h-24 w-[1px] bg-gradient-to-b from-transparent via-white/10 to-transparent" />

                {/* Home Team */}
                <div className="flex flex-col items-start gap-6">
                    <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.06] p-4 flex items-center justify-center relative">
                        <TeamLogo logo={match.homeTeam.logo} className={cn("w-12 h-12 transition-all duration-700", isHomeWinner ? "opacity-100 scale-110 drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]" : "opacity-30 grayscale")} />
                        {isHomeWinner && <div className="absolute -top-3 -left-3"><WinningBadge team={match.homeTeam} /></div>}
                    </div>
                    <div className="text-left">
                        <div className={cn("text-5xl font-mono font-bold tracking-tighter tabular-nums mb-1", isHomeWinner ? "text-white" : "text-zinc-600")}>
                            {match.homeScore}
                        </div>
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">
                            {match.homeTeam.abbreviation || match.homeTeam.shortName}
                        </div>
                    </div>
                </div>
            </div>

            {/* Betting Resolution Grid: Stripe x Vercel Aesthetic */}
            <div className="relative z-10 w-full grid grid-cols-2 gap-px bg-white/[0.06] rounded-2xl overflow-hidden border border-white/[0.06]">
                {/* Spread Card */}
                <div className="bg-[#0D0D0D] p-6 flex flex-col items-center justify-center group/card hover:bg-white/[0.02] transition-colors">
                    <span className="text-[10px] font-black uppercase text-zinc-600 tracking-[0.2em] mb-4">Spread Analysis</span>
                    <div className="flex flex-col items-center gap-2">
                        <div className={cn(
                            "px-4 py-2 rounded-xl flex items-center gap-3 border transition-all duration-500",
                            covered ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400" : "bg-rose-500/5 border-rose-500/20 text-rose-400"
                        )}>
                            <CheckCircle2 size={12} />
                            <span className="text-xs font-bold tracking-tight uppercase">
                                {covered ? 'Covers' : 'Fails to Cover'}
                            </span>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mt-1">
                            Line: {closingSpread > 0 ? `+${closingSpread}` : closingSpread}
                        </span>
                    </div>
                </div>

                {/* Total Card */}
                <div className="bg-[#0D0D0D] p-6 flex flex-col items-center justify-center group/card hover:bg-white/[0.02] transition-colors">
                    <span className="text-[10px] font-black uppercase text-zinc-600 tracking-[0.2em] mb-4">Total Analysis</span>
                    <div className="flex flex-col items-center gap-2">
                        <div className={cn(
                            "px-4 py-2 rounded-xl flex items-center gap-3 border transition-all duration-500",
                            isOver ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400" : "bg-zinc-800 border-white/[0.04] text-zinc-400"
                        )}>
                            <DollarSign size={12} />
                            <span className="text-xs font-bold tracking-tight uppercase">
                                {isOver ? 'OVER HIT' : 'UNDER HIT'}
                            </span>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mt-1">
                            Market: {closingTotal}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
});
FinalGameTracker.displayName = 'FinalGameTracker';

// ============================================================================
// MAIN TRACKER COMPONENT
// ============================================================================

interface LiveGameTrackerProps {
    match: Match;
    liveState?: {
        lastPlay?: PlayData;
        situation?: FieldSituation | CourtSituation;
        currentDrive?: DriveData;
    };
}

export const LiveGameTracker: FC<LiveGameTrackerProps> = memo(({
    match,
    liveState,
}) => {
    // Master Guard: Prevent crash if match data is missing
    if (!match || !match.homeTeam || !match.awayTeam) {
        return (
            <div className="p-8 flex flex-col items-center justify-center bg-[#080808] border border-white/10 rounded-2xl min-h-[200px]">
                <Activity size={24} className="text-white/20 mb-4 animate-pulse" />
                <span className="text-[11px] font-bold text-white/30 uppercase tracking-[0.2em]">
                    Initializing Tracker...
                </span>
            </div>
        );
    }

    // Check for final status
    const status = (match.status ?? '').toUpperCase();
    if (status.includes('FINAL') || status.includes('FINISHED')) {
        return <FinalGameTracker match={match} />;
    }

    // Extract live state
    const play = liveState?.lastPlay ?? (match as any).lastPlay;
    const situation = liveState?.situation ?? (match as any).situation;
    const drive = liveState?.currentDrive ?? (match as any).currentDrive;

    // Sport detection
    const sport = match.sport;
    const league = (match as any).league;
    const isFootball =
        sport === Sport.NFL || sport === Sport.COLLEGE_FOOTBALL || (sport as any) === 'CFB';
    const isBasketball =
        sport === Sport.NBA || sport === Sport.COLLEGE_BASKETBALL || (sport as any) === 'CBB' || league === 'NBA';

    // Team colors (Defensive)
    const homeColor = normalizeColor(match.homeTeam?.color, '#3B82F6');
    const awayColor = normalizeColor(match.awayTeam?.color, '#EF4444');

    return (
        <div className="flex flex-col w-full">
            {/* Visualization layer */}
            <div className="w-full border-b border-white/[0.04]">
                {isFootball ? (
                    <FieldGraphic
                        situation={situation as FieldSituation}
                        homeId={match.homeTeam?.id}
                        homeAbbr={match.homeTeam?.abbreviation || match.homeTeam?.shortName || 'HOME'}
                        awayAbbr={match.awayTeam?.abbreviation || match.awayTeam?.shortName || 'AWAY'}
                        homeLogo={match.homeTeam?.logo}
                        awayLogo={match.awayTeam?.logo}
                        homeColor={homeColor}
                        awayColor={awayColor}
                    />
                ) : isBasketball ? (
                    <CourtGraphic
                        situation={situation as CourtSituation}
                        homeId={match.homeTeam?.id}
                        homeAbbr={match.homeTeam?.abbreviation || match.homeTeam?.shortName || 'HOME'}
                        awayAbbr={match.awayTeam?.abbreviation || match.awayTeam?.shortName || 'AWAY'}
                        homeLogo={match.homeTeam?.logo}
                        awayLogo={match.awayTeam?.logo}
                        homeColor={homeColor}
                        awayColor={awayColor}
                        lastPlay={play}
                    />
                ) : null}
            </div>

            {/* Data cards grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/[0.04]">
                <LatestPlayCard play={play} />
                {isFootball ? (
                    <DriveStatsCard drive={drive} />
                ) : (
                    <LiveTotalCard match={match as ExtendedMatch} />
                )}
            </div>
        </div>
    );
});
LiveGameTracker.displayName = 'LiveGameTracker';

// ============================================================================
// SCORE HEADER
// ============================================================================

interface ScoreHeaderProps {
    match: Match;
}

// Sub-component for Team Display
interface TeamDisplayProps {
    team: Match['homeTeam'] | Match['awayTeam'];
    hasPossession: boolean;
}

const TeamDisplay: FC<TeamDisplayProps> = memo(({ team, hasPossession }) => (
    <div className="flex flex-col items-center gap-4 flex-1 min-w-0">
        <motion.div
            whileHover={{ scale: 1.03 }}
            className="relative p-0.5 rounded-2xl bg-white/[0.02] border border-white/[0.04] shadow-lg"
        >
            <TeamLogo
                logo={team.logo}
                className="w-12 h-12 sm:w-14 sm:h-14 object-contain brightness-110"
            />
            {hasPossession && (
                <motion.div
                    layoutId="possession-indicator"
                    className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full border-2 border-black"
                    style={{
                        boxShadow: '0 0 10px rgba(251, 191, 36, 0.6)',
                    }}
                />
            )}
        </motion.div>
        <div className="text-center">
            <h2 className="text-sm font-bold text-white tracking-tight uppercase leading-none mb-1">
                {team?.shortName ?? team?.name ?? 'TEAM'}
            </h2>
            <span className="text-[10px] font-mono text-white/40 tracking-wider">
                {team?.record ?? '0-0'}
            </span>
        </div>
    </div>
));
TeamDisplay.displayName = 'TeamDisplay';


export const ScoreHeader: FC<ScoreHeaderProps> = memo(({ match }) => {
    // Master Guard
    if (!match || !match.homeTeam || !match.awayTeam) {
        return <div className="w-full h-[180px] bg-[#020203] border-b border-white/5" />;
    }

    const homeColor = normalizeColor(match.homeTeam?.color, '#3B82F6');
    const awayColor = normalizeColor(match.awayTeam?.color, '#EF4444');

    // Possession detection
    const possessionId = (match as any).situation?.possessionId;
    const isHomePossession =
        possessionId && String(possessionId) === String(match.homeTeam?.id);
    const isAwayPossession =
        possessionId && String(possessionId) === String(match.awayTeam?.id);

    return (
        <header
            className="relative w-full h-[180px] sm:h-[200px] overflow-hidden bg-[#020203] flex items-center justify-center"
            role="banner"
            aria-label={`${match.awayTeam.shortName || 'Away'} ${match.awayScore} at ${match.homeTeam.shortName || 'Home'} ${match.homeScore}`}
        >
            {/* Atmospheric team glows */}
            <div className="absolute inset-0 pointer-events-none">
                <div
                    className="absolute top-[-60%] left-[-25%] w-[80%] h-[220%] blur-[120px] opacity-[0.08] transition-colors duration-1000"
                    style={{ background: teamGlow(awayColor, 'left', 1) }}
                />
                <div
                    className="absolute top-[-60%] right-[-25%] w-[80%] h-[220%] blur-[120px] opacity-[0.08] transition-colors duration-1000"
                    style={{ background: teamGlow(homeColor, 'right', 1) }}
                />
            </div>

            {/* Content */}
            <div className="relative z-10 w-full px-6 max-w-5xl">
                <div className="flex items-center justify-between gap-4 sm:gap-12">
                    {/* Away team */}
                    <TeamDisplay
                        team={match.awayTeam}
                        hasPossession={isAwayPossession}
                    />

                    {/* Score center */}
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex items-center gap-6 sm:gap-10">
                            <motion.span
                                key={`away-${match.awayScore}`}
                                initial={{ opacity: 0.5, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="text-4xl sm:text-6xl font-mono font-light text-white tracking-tighter tabular-nums"
                            >
                                {match.awayScore}
                            </motion.span>
                            <span className="text-2xl font-light text-white/10 select-none">
                                —
                            </span>
                            <motion.span
                                key={`home-${match.homeScore}`}
                                initial={{ opacity: 0.5, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="text-4xl sm:text-6xl font-mono font-light text-white tracking-tighter tabular-nums"
                            >
                                {match.homeScore}
                            </motion.span>
                        </div>

                        <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.06] backdrop-blur-xl"
                        >
                            <span className={cn(
                                "text-[11px] font-black uppercase tracking-[0.3em] tabular-nums transition-colors duration-500",
                                isGameFinished(match.status) ? "text-amber-500" : "text-rose-500"
                            )}>
                                {isGameFinished(match.status) ? 'FINAL' : ((match as any).displayClock ?? 'PREGAME')}
                            </span>
                        </motion.div>
                    </div>

                    {/* Home team */}
                    <TeamDisplay
                        team={match.homeTeam}
                        hasPossession={isHomePossession}
                    />
                </div>
            </div>
        </header>
    );
});
ScoreHeader.displayName = 'ScoreHeader';

// ============================================================================
// EXPORTS
// ============================================================================

export default LiveGameTracker;
