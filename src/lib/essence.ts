// ============================================================================
// ESSENCE DESIGN SYSTEM v12.0 — Editorial Light
// ============================================================================
//
// This file is the ONLY design token authority for SportsSync AI.
// Every color, size, radius, shadow, and motion value lives here.
//
// v12 CHANGES — "Editorial Light" Overhaul:
//   - All surfaces → white / slate-50 (light backgrounds)
//   - All text → slate-900 primary / slate-500 secondary
//   - All borders → slate-200 crisp outlines (no blurry shadows)
//   - All glows/neon removed
//
// RULES:
//   1. No hex color in any .tsx file. Use ESSENCE.colors.* or ESSENCE.tw.*
//   2. No arbitrary text-[Npx]. Use ESSENCE.scale.* or ESSENCE.tier.*
//   3. No arbitrary border-white/[N]. Use ESSENCE.tw.border.*
//   4. No arbitrary bg-white/[N]. Use ESSENCE.tw.surface.*
//   5. If a value doesn't exist here, ADD it here first, then use it.
// ============================================================================

// ============================================================================
// §1  PALETTE — Editorial Light
// ============================================================================

export const ESSENCE = {
  colors: {
    // Surfaces: Light hierarchy (Canvas → Container)
    surface: {
      pure:     '#FFFFFF',   // Pure white — cards, containers
      base:     '#F8FAFC',   // slate-50 — page background (the "canvas")
      card:     '#FFFFFF',   // Card / panel fill
      elevated: '#FFFFFF',   // Modals, popovers, raised panels
      subtle:   '#F1F5F9',   // slate-100 — hover states, interactive surfaces
      accent:   '#E2E8F0',   // slate-200 — active states, selected rows
    },

    // Text: Dark → Light (5 stops)
    text: {
      primary:   '#0F172A',  // slate-900 — headlines, scores, team names
      secondary: '#64748B',  // slate-500 — body, descriptions, secondary data
      tertiary:  '#94A3B8',  // slate-400 — captions, timestamps
      muted:     '#CBD5E1',  // slate-300 — disabled, placeholders
      ghost:     '#E2E8F0',  // slate-200 — structural hints
    },

    // Semantic Accents (muted for editorial feel)
    accent: {
      emerald:      '#10B981',
      emeraldMuted: 'rgba(16, 185, 129, 0.08)',
      mintEdge:     'transparent',  // No more specular edge light
      amber:        '#F59E0B',
      amberMuted:   'rgba(245, 158, 11, 0.08)',
      rose:         '#F43F5E',
      roseMuted:    'rgba(244, 63, 94, 0.08)',
      violet:       '#8B5CF6',
      violetMuted:  'rgba(139, 92, 246, 0.08)',
      cyan:         '#0F172A',     // Brand anchor = slate-900
      cyanMuted:    'rgba(15, 23, 42, 0.06)',
      // Alias accents
      mint:         '#10B981',
      mintDim:      'rgba(16, 185, 129, 0.08)',
      gold:         '#F59E0B',
      goldDim:      'rgba(245, 158, 11, 0.08)',
    },

    // Borders: Crisp slate-200 outlines (the "Outline Rule")
    border: {
      ghost:    'rgba(15,23,42,0.04)',
      subtle:   'rgba(15,23,42,0.06)',
      default:  '#E2E8F0',   // slate-200 — primary border
      strong:   '#CBD5E1',   // slate-300
      innerGlow: 'none',     // Killed — no inner glow
    },

    // Background overlays: Subtle tints on white
    overlay: {
      ghost:    'rgba(15,23,42,0.02)',
      subtle:   'rgba(15,23,42,0.03)',
      muted:    'rgba(15,23,42,0.05)',
      emphasis: 'rgba(15,23,42,0.08)',
    },
  },

  // ==========================================================================
  // §2  TYPE SCALE — Named sizes (unchanged)
  // ==========================================================================
  scale: {
    nano:     'text-[8px]',
    label:    'text-[9px]',
    caption:  'text-[10px]',
    footnote: 'text-[11px]',
    small:    'text-[12px]',
    bodySm:   'text-[13px]',
    body:     'text-[14px]',
    bodyLg:   'text-[15px]',
    title:    'text-[17px]',
    titleLg:  'text-[20px]',
    headline: 'text-[24px]',
    display:  'text-[32px]',
  },

  // ==========================================================================
  // §3  TRACKING — Named letter-spacing (unchanged)
  // ==========================================================================
  tracking: {
    tight:   'tracking-[-0.03em]',
    snug:    'tracking-[-0.01em]',
    normal:  'tracking-normal',
    wide:    'tracking-[0.1em]',
    wider:   'tracking-[0.15em]',
    widest:  'tracking-[0.2em]',
    ultra:   'tracking-[0.3em]',
  },

  // ==========================================================================
  // §4  SHADOWS — Microscopic only (the "Outline Rule")
  // ==========================================================================
  shadows: {
    sm:   '0 1px 2px rgba(0,0,0,0.04)',
    md:   '0 2px 4px rgba(0,0,0,0.04)',
    lg:   '0 4px 8px rgba(0,0,0,0.04)',
    logo:    'none',                // No logo shadows
    obsidian: 'none',               // Killed — use border instead
    glow: (_color: string) => 'none',  // Killed — no glows
  },

  // ==========================================================================
  // §5  RADIUS — 4px base grid (unchanged)
  // ==========================================================================
  radius: {
    sm:    '4px',
    md:    '8px',
    lg:    '12px',
    xl:    '16px',
    '2xl': '20px',
    '3xl': '24px',
    full:  '9999px',
    squircle: '44% / 44%',
  },

  // ==========================================================================
  // §6  SPACING — 4px base grid (unchanged)
  // ==========================================================================
  spacing: {
    0:  '0px',
    1:  '4px',
    2:  '8px',
    3:  '12px',
    4:  '16px',
    5:  '20px',
    6:  '24px',
    8:  '32px',
    10: '40px',
    12: '48px',
    16: '64px',
  },

  // ==========================================================================
  // §7  CARD GEOMETRY — Editorial Light
  // ==========================================================================
  card: {
    padding:      'p-5',
    radius:       'rounded-2xl',
    gap:          'gap-4',
    border:       'border border-slate-200',
    bg:           'bg-white',
    headerHeight: 'h-[44px]',
    innerGlow:    '',  // Killed
    base: 'bg-white border border-slate-200 rounded-2xl p-5',
  },

  // ==========================================================================
  // §8  TYPOGRAPHY TIERS — Editorial Light
  // ==========================================================================
  tier: {
    // Tier 1: Primary Values — Bold, slate-900
    t1Score:   'font-mono text-[32px] font-bold tabular-nums text-slate-900 tracking-tight',
    t1Value:   'font-mono text-[16px] font-bold tabular-nums text-slate-900 tracking-tight',
    t1Project: 'font-mono text-[24px] font-black tabular-nums text-slate-900 tracking-tight',

    // Tier 2: Labels & Names — Sans, semibold, slate-700
    t2Label:  'text-[9px] font-bold text-slate-400 uppercase tracking-[0.15em]',
    t2Team:   'text-sm font-semibold text-slate-900 tracking-tight',
    t2Header: 'text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]',

    // Tier 3: Metadata — Sans, medium, slate-500
    t3Meta:   'text-[9px] font-medium text-slate-500 uppercase tracking-wider',
    t3Record: 'text-[10px] font-medium text-slate-500 tabular-nums',
    t3Delta:  'font-mono text-[11px] font-bold tabular-nums text-slate-500',
  },

  // Legacy typography — Editorial Light
  type: {
    hero:    'font-sans text-[32px] font-semibold tracking-[-0.02em] text-slate-900',
    title:   'font-sans text-[20px] font-semibold tracking-[-0.01em] text-slate-900',
    body:    'font-sans text-[15px] font-normal text-slate-600',
    caption: 'font-sans text-[13px] font-medium text-slate-500',
    label:   'text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em]',
    data:    'font-mono text-[16px] font-bold tabular-nums text-slate-900',
    dataSm:  'font-mono text-[13px] font-semibold tabular-nums text-slate-700',
    dataLg:  'font-mono text-[24px] font-black tabular-nums text-slate-900',
  },

  // ==========================================================================
  // §9  MOTION — Apple-style spring physics (unchanged)
  // ==========================================================================
  transition: {
    spring:  { type: "spring" as const, stiffness: 400, damping: 30, mass: 1 },
    soft:    { type: "spring" as const, stiffness: 200, damping: 25 },
    instant: { duration: 0.15, ease: [0.25, 0.1, 0.25, 1.0] },
    shared:  { layoutId: "shared-element", transition: { type: "spring" as const, stiffness: 400, damping: 30 } },
  },

  durations: {
    fast:      'duration-150',
    base:      'duration-300',
    slow:      'duration-500',
    ultraSlow: 'duration-1000',
  },

  // ==========================================================================
  // §10  MATERIALS — Editorial Light
  // ==========================================================================
  glass: {
    panel:  'bg-white border border-slate-200',
    header: 'bg-white/95 backdrop-blur-xl border-b border-slate-200',
    card:   'bg-white border border-slate-200 rounded-2xl',
  },

  // ==========================================================================
  // §11  Z-INDEX (unchanged)
  // ==========================================================================
  zIndex: {
    base:    0,
    card:    10,
    header:  40,
    drawer:  50,
    modal:   60,
    tooltip: 70,
  },

  // ==========================================================================
  // §12  MICRO-INTERACTIONS — Editorial Light
  // ==========================================================================
  interactions: {
    hoverScale:  { scale: 1.01, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" },
    activePress: { scale: 0.98 },
    fadeIn:       { opacity: 0, y: 8 },
    fadeInActive: { opacity: 1, y: 0 },
    glowPulse:   { boxShadow: "none" },
    haptic: {
      whileHover: { scale: 1.01 },
      whileTap:   { scale: 0.98 },
      transition: { type: "spring" as const, stiffness: 600, damping: 30 },
    },
    vibrancy: '',  // Killed — no vibrancy effects
  },

  // ==========================================================================
  // §13  NAVIGATION & HEADER — Editorial Light
  // ==========================================================================
  nav: {
    h1:          'h-14',
    h2:          'h-10',
    pill:        'rounded-full bg-slate-50 border border-slate-200 shadow-sm transition-all duration-200',
    chip:        'w-11 h-11 flex items-center justify-center rounded-full bg-slate-50 border border-slate-200 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all duration-200',
    initialPill: 'w-7 h-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-900 tracking-tighter',
    divider:     'border-slate-200',
  },

  // ==========================================================================
  // §14  FLOATING ACTION ICON — Editorial Light
  // ==========================================================================
  floatingIcon: {
    position:  'absolute bottom-4 right-4',
    size:      'w-8 h-8',
    style:     'rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center',
    iconSize:  14,
    iconColor: 'text-slate-400',
  },

  // ==========================================================================
  // §15  TAILWIND UTILITY PRESETS — Editorial Light
  // ==========================================================================
  tw: {
    // --- Section & Card Headers ---
    sectionLabel:     'text-[12px] font-medium text-slate-500 uppercase tracking-[0.12em]',
    cardHeaderLabel:  'text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]',
    columnHeader:     'text-[10px] font-semibold text-slate-400 uppercase tracking-[0.15em]',

    // --- Data Display ---
    dataValue:          'text-[15px] font-semibold text-slate-900 tabular-nums',
    dataValueSecondary: 'text-[11px] font-medium text-slate-500 tabular-nums',
    teamAbbr:           'text-[12px] font-semibold text-slate-700 uppercase tracking-[0.08em]',
    tabular:            'tabular-nums font-mono',

    // --- Border shorthands ---
    border: {
      ghost:   'border border-slate-100',
      subtle:  'border border-slate-200/60',
      default: 'border border-slate-200',
      strong:  'border border-slate-300',
    },

    // --- Surface shorthands ---
    surface: {
      ghost:    'bg-slate-50/50',
      subtle:   'bg-slate-50',
      muted:    'bg-slate-100',
      emphasis: 'bg-slate-200/50',
    },

    // --- Row Patterns ---
    rowDivider:      'border-b border-slate-200/60',
    rowDividerGhost: 'border-b border-slate-100',
    interactiveRow:  'py-4 hover:bg-slate-50 transition-colors duration-200',

    // --- Icon Containers ---
    iconSm: 'w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center',
    iconMd: 'w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center',

    // --- Cards (density-aware) ---
    card:         'rounded-xl border border-slate-200 bg-white p-3',
    cardFeatured: 'rounded-2xl border border-slate-200 bg-white p-4',
    cardCompact:  'rounded-lg border border-slate-200 bg-white p-2',

    // --- Tabs ---
    tabsWrap:    'h-10 rounded-xl border border-slate-200 bg-slate-50 p-1',
    tab:         'h-8 rounded-lg px-3 text-sm font-medium',
    tabActive:   'bg-white text-slate-900 shadow-sm',
    tabInactive: 'text-slate-400 hover:text-slate-600',

    // --- Badges ---
    badge:        'rounded-md px-2 py-1 text-[10px] font-semibold uppercase',
    badgeLive:    'bg-emerald-50 text-emerald-600 border border-emerald-200',
    badgeNeutral: 'bg-slate-50 text-slate-500 border border-slate-200',

    // --- Buttons ---
    buttonSm: 'h-8 rounded-lg px-3 text-sm font-medium',
    buttonMd: 'h-10 rounded-lg px-4 text-sm font-medium',

    // --- Page Layout ---
    page:       'px-4 space-y-3',
    pageGutter: 'px-4',
    sectionGap: 'space-y-3',

    // --- Dividers ---
    divider:       'border-t border-slate-200',
    dividerStrong: 'border-t border-slate-300',
    hairline:      'h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent',

    // --- Hero / Header ---
    heroHeader: 'space-y-2 py-3',
    heroScore:  'text-2xl font-bold tabular-nums text-slate-900',
    heroClock:  'text-sm font-medium text-slate-500',

    // --- Status ---
    statusText: 'text-[8px] font-black uppercase tracking-[0.15em]',
  },
} as const;

// ============================================================================
// §16  UTILITY: Class Name Joiner
// ============================================================================
export const cn = (...classes: (string | undefined | null | false)[]) =>
  classes.filter(Boolean).join(' ');

// ============================================================================
// §17  TYPE EXPORTS
// ============================================================================
export type EssenceColors  = typeof ESSENCE.colors;
export type EssenceSurface = keyof typeof ESSENCE.colors.surface;
export type EssenceText    = keyof typeof ESSENCE.colors.text;
export type EssenceAccent  = keyof typeof ESSENCE.colors.accent;
export type EssenceScale   = keyof typeof ESSENCE.scale;
export type EssenceTracking = keyof typeof ESSENCE.tracking;

export default ESSENCE;
