/**
 * UI Density System - Mobile-First Information Density
 * 
 * Target: ESPN/Yahoo-like density on mobile
 * Goal: Reduce "padding tax" and maximize content per viewport
 */

export const DENSE = {
    // Page Layout
    page: "px-4 space-y-3",
    pageGutter: "px-4",
    sectionGap: "space-y-3",

    // Cards
    card: "rounded-xl border border-white/10 bg-white/5 p-3",
    cardFeatured: "rounded-2xl border border-white/10 bg-white/5 p-4",
    cardCompact: "rounded-lg border border-white/10 bg-white/5 p-2",

    // Tabs
    tabsWrap: "h-10 rounded-xl border border-white/10 bg-white/5 p-1",
    tab: "h-8 rounded-lg px-3 text-sm font-medium",
    tabActive: "bg-white/10 text-white",
    tabInactive: "text-white/70 hover:text-white/90",

    // Typography
    sectionTitle: "text-[11px] tracking-widest text-white/60 uppercase",
    label: "text-[11px] leading-none text-white/50",
    value: "text-sm font-semibold text-white",
    valueLarge: "text-lg font-bold text-white",

    // Table/Grid
    row: "h-11",
    cell: "rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm",
    cellCompact: "rounded-md px-2 py-1.5 text-sm",
    tableHeader: "text-[11px] leading-none text-white/50 uppercase tracking-wide",

    // Hero/Header (compact)
    heroHeader: "space-y-2 py-3",
    heroRow: "flex items-center justify-between gap-2",
    heroScore: "text-2xl font-bold tabular-nums",
    heroClock: "text-sm font-medium text-white/80",
    heroStatus: "text-xs text-white/60",

    // Badges/Pills
    badge: "rounded-md px-2 py-1 text-[10px] font-semibold uppercase",
    badgePrimary: "bg-emerald-500/20 text-emerald-400",
    badgeSecondary: "bg-white/10 text-white/70",

    // Buttons
    buttonSm: "h-8 rounded-lg px-3 text-sm font-medium",
    buttonMd: "h-10 rounded-lg px-4 text-sm font-medium",

    // Spacing utilities
    gap1: "gap-1",
    gap2: "gap-2",
    gap3: "gap-3",

    // Dividers
    divider: "border-t border-white/5",
    dividerStrong: "border-t border-white/10",
} as const;

// Shorthand for common combinations
export const DENSITY = {
    // Score header pattern
    scoreHeader: `${DENSE.heroHeader} ${DENSE.pageGutter}`,

    // Standard card pattern
    standardCard: DENSE.card,

    // Compact table cell
    tableCell: DENSE.cellCompact,

    // Section with title
    section: `${DENSE.sectionGap}`,
    sectionWithTitle: "space-y-2",
};

// Height constraints
export const HEIGHTS = {
    heroMax: "max-h-[200px]",
    tabBar: "h-10",
    row: "h-11",
    cell: "h-10",
    buttonSm: "h-8",
    buttonMd: "h-10",
};

// Export as default for convenience
export default DENSE;
