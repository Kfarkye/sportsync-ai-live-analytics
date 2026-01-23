/**
 * Design Tokens - Jony Ive x Stripe x Google Internal
 * 
 * "Every pixel must earn its place"
 * 
 * This file establishes the mathematical foundation for all UI decisions.
 * Reference these constants; never use arbitrary values.
 */

// ============================================================================
// SPACING SYSTEM (4px base grid)
// ============================================================================
export const SPACING = {
    0: '0px',
    1: '4px',    // Micro
    2: '8px',    // Compact
    3: '12px',   // Tight
    4: '16px',   // Default
    5: '20px',   // Comfortable
    6: '24px',   // Spacious
    8: '32px',   // Section
    10: '40px',  // Large section
    12: '48px',  // Page section
    16: '64px',  // Major break
} as const;

// ============================================================================
// TYPOGRAPHY SCALE (Modular Scale 1.125 - Major Second)
// ============================================================================
export const TYPE = {
    // Micro text (labels, captions)
    micro: {
        size: '9px',
        weight: 700,
        tracking: '0.15em',
        lineHeight: 1,
    },
    // Caption (sub-labels, hints)
    caption: {
        size: '10px',
        weight: 600,
        tracking: '0.12em',
        lineHeight: 1.2,
    },
    // Label (form labels, section headers)
    label: {
        size: '11px',
        weight: 700,
        tracking: '0.2em',
        lineHeight: 1,
    },
    // Body small
    bodyS: {
        size: '12px',
        weight: 500,
        tracking: '0.01em',
        lineHeight: 1.5,
    },
    // Body default
    body: {
        size: '14px',
        weight: 400,
        tracking: '0',
        lineHeight: 1.6,
    },
    // Title small (card titles)
    titleS: {
        size: '15px',
        weight: 600,
        tracking: '-0.01em',
        lineHeight: 1.3,
    },
    // Title (section titles)
    title: {
        size: '17px',
        weight: 600,
        tracking: '-0.02em',
        lineHeight: 1.2,
    },
    // Headline
    headline: {
        size: '24px',
        weight: 700,
        tracking: '-0.03em',
        lineHeight: 1.1,
    },
    // Display (scores, hero numbers)
    display: {
        size: '32px',
        weight: 800,
        tracking: '-0.04em',
        lineHeight: 1,
    },
} as const;

// ============================================================================
// COLOR SYSTEM (Zinc-first, intentional accents)
// ============================================================================
export const COLOR = {
    // Backgrounds (dark to light)
    bg: {
        base: '#09090b',      // Page background
        elevated: '#0a0a0b',  // Cards, panels
        subtle: 'rgba(255,255,255,0.02)', // Hover states
        muted: 'rgba(255,255,255,0.04)',  // Active states
    },

    // Text (light to dark)
    text: {
        primary: '#fafafa',           // White text
        secondary: '#a1a1aa',         // zinc-400
        tertiary: '#71717a',          // zinc-500
        muted: '#52525b',             // zinc-600
        disabled: '#3f3f46',          // zinc-700
    },

    // Borders (opacity-based for layering)
    border: {
        subtle: 'rgba(255,255,255,0.03)',   // Row dividers
        default: 'rgba(255,255,255,0.05)',  // Component borders
        emphasis: 'rgba(255,255,255,0.08)', // Interactive borders
        focus: 'rgba(255,255,255,0.12)',    // Focus states
    },

    // Semantic accents
    accent: {
        live: '#10b981',      // emerald-500
        liveMuted: 'rgba(16,185,129,0.12)',
        warning: '#f59e0b',   // amber-500
        warningMuted: 'rgba(245,158,11,0.12)',
        danger: '#f43f5e',    // rose-500
        dangerMuted: 'rgba(244,63,94,0.12)',
        info: '#3b82f6',      // blue-500
        infoMuted: 'rgba(59,130,246,0.12)',
    },
} as const;

// ============================================================================
// BORDER RADIUS (Consistent rounding)
// ============================================================================
export const RADIUS = {
    none: '0px',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    full: '9999px',
} as const;

// ============================================================================
// SHADOWS (Subtle, purposeful)
// ============================================================================
export const SHADOW = {
    none: 'none',
    sm: '0 1px 2px rgba(0,0,0,0.25)',
    md: '0 2px 8px rgba(0,0,0,0.3)',
    lg: '0 4px 16px rgba(0,0,0,0.35)',
    logo: '0 2px 8px rgba(0,0,0,0.5)', // Team logos
} as const;

// ============================================================================
// TRANSITIONS (Smooth, intentional)
// ============================================================================
export const TRANSITION = {
    fast: '150ms ease-out',
    default: '200ms ease-out',
    slow: '300ms ease-out',
    spring: '400ms cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

// ============================================================================
// TAILWIND CLASS UTILITIES (Pre-built combinations)
// ============================================================================
export const TW = {
    // Section header label
    sectionLabel: 'text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em]',

    // Column header in tables
    columnHeader: 'text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.15em]',

    // Row divider
    rowDivider: 'border-b border-white/[0.04]',

    // Subtle row divider
    rowDividerSubtle: 'border-b border-white/[0.03]',

    // Interactive row
    interactiveRow: 'py-4 hover:bg-white/[0.015] transition-colors duration-200',

    // Tabular numbers
    tabular: 'tabular-nums font-mono',

    // Primary data value
    dataValue: 'text-[15px] font-semibold text-white tabular-nums',

    // Secondary data value  
    dataValueSecondary: 'text-[11px] font-medium text-zinc-500 tabular-nums',

    // Team abbreviation
    teamAbbr: 'text-[12px] font-semibold text-zinc-300 uppercase tracking-[0.08em]',

    // Icon container (small)
    iconContainerSm: 'w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center',

    // Icon container (medium)
    iconContainerMd: 'w-10 h-10 rounded-lg bg-white/[0.03] flex items-center justify-center',
} as const;
