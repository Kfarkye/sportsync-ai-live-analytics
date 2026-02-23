// ============================================================================
// ESSENCE DESIGN SYSTEM v11.0 — Consolidated Single Source of Truth
// ============================================================================
//
// This file is the ONLY design token authority for SportsSync AI.
// Every color, size, radius, shadow, and motion value lives here.
//
// KILLED in v11:
//   - src/styles/design-tokens.ts  (0 imports — dead code)
//   - src/ui/density.ts            (1 import — absorbed into §15)
//
// RULES:
//   1. No hex color in any .tsx file. Use ESSENCE.colors.* or ESSENCE.tw.*
//   2. No arbitrary text-[Npx]. Use ESSENCE.scale.* or ESSENCE.tier.*
//   3. No arbitrary border-white/[N]. Use ESSENCE.tw.border.*
//   4. No arbitrary bg-white/[N]. Use ESSENCE.tw.surface.*
//   5. If a value doesn't exist here, ADD it here first, then use it.
//
// SYNC: Edit here, then run `npm run sync:shared` to propagate to
//       packages/shared/src/lib/essence.ts and supabase functions.
// ============================================================================

// ============================================================================
// §1  PALETTE — Cinematic Depth
// ============================================================================
// Rationalized from 27 unique surface hexes found across 88 component files.
// Every bg-[#XXXXXX] must map to one of these 6 surface values.

export const ESSENCE = {
  colors: {
    // Surfaces: Dark → Light (6 stops — no more)
    surface: {
      pure:     '#000000',   // True black — overlays, voids only
      base:     '#09090b',   // Page background (Zinc 950+)
      card:     '#0A0A0B',   // Card / panel fill (unified)
      elevated: '#111113',   // Modals, popovers, raised panels
      subtle:   '#1A1A1C',   // Hover states, interactive surfaces
      accent:   '#222224',   // Active states, selected rows
    },

    // Text: Light → Dark (5 stops)
    text: {
      primary:   '#FAFAFA',  // Zinc 50  — headlines, scores, values
      secondary: '#A1A1AA',  // Zinc 400 — body, descriptions
      tertiary:  '#71717A',  // Zinc 500 — captions, timestamps
      muted:     '#52525B',  // Zinc 600 — disabled, placeholders
      ghost:     '#3F3F46',  // Zinc 700 — structural hints
    },

    // Semantic Accents (5 hues + muted variants)
    accent: {
      emerald:      '#34D399',
      emeraldMuted: 'rgba(52, 211, 153, 0.12)',
      mintEdge:     'rgba(54, 232, 150, 0.08)',  // Card specular edge light
      amber:        '#FBBF24',
      amberMuted:   'rgba(251, 191, 36, 0.12)',
      rose:         '#FB7185',
      roseMuted:    'rgba(251, 113, 133, 0.12)',
      violet:       '#A78BFA',
      violetMuted:  'rgba(167, 139, 250, 0.12)',
      cyan:         '#00F0FF',
      cyanMuted:    'rgba(0, 240, 255, 0.12)',
      // Alias accents (used by ChatWidget, match cards)
      mint:         '#34D399',                       // = emerald
      mintDim:      'rgba(52, 211, 153, 0.12)',      // = emeraldMuted
      gold:         '#FBBF24',                       // = amber
      goldDim:      'rgba(251, 191, 36, 0.12)',      // = amberMuted
    },

    // Borders: 4 opacity tiers (rationalized from 9)
    border: {
      ghost:    'rgba(255,255,255,0.03)',
      subtle:   'rgba(255,255,255,0.04)',
      default:  'rgba(255,255,255,0.06)',
      strong:   'rgba(255,255,255,0.12)',
      innerGlow: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.02) 100%)',
    },

    // Background overlays: 4 opacity tiers (rationalized from 10)
    overlay: {
      ghost:    'rgba(255,255,255,0.01)',
      subtle:   'rgba(255,255,255,0.02)',
      muted:    'rgba(255,255,255,0.04)',
      emphasis: 'rgba(255,255,255,0.06)',
    },
  },

  // ==========================================================================
  // §2  TYPE SCALE — Named sizes (rationalized from 25 arbitrary values)
  // ==========================================================================
  scale: {
    nano:     'text-[8px]',    // 59 usages  — micro labels, status chips
    label:    'text-[9px]',    // 144 usages — section labels, tier headers
    caption:  'text-[10px]',   // 235 usages — metadata, timestamps, badges
    footnote: 'text-[11px]',   // 83 usages  — secondary data, records
    small:    'text-[12px]',   // 33 usages  — compact body, abbreviations
    bodySm:   'text-[13px]',   // 32 usages  — body small
    body:     'text-[14px]',   // 20 usages  — default body
    bodyLg:   'text-[15px]',   // 23 usages  — card titles, emphasized body
    title:    'text-[17px]',   // section titles
    titleLg:  'text-[20px]',   // page titles, modal headers
    headline: 'text-[24px]',   // display headline
    display:  'text-[32px]',   // scores, hero numbers
  },

  // ==========================================================================
  // §3  TRACKING — Named letter-spacing (rationalized from 18 values)
  // ==========================================================================
  tracking: {
    tight:   'tracking-[-0.03em]',
    snug:    'tracking-[-0.01em]',
    normal:  'tracking-normal',
    wide:    'tracking-[0.1em]',
    wider:   'tracking-[0.15em]',
    widest:  'tracking-[0.2em]',     // 72 usages — primary section labels
    ultra:   'tracking-[0.3em]',
  },

  // ==========================================================================
  // §4  SHADOWS
  // ==========================================================================
  shadows: {
    sm:   '0 1px 2px rgba(0,0,0,0.4)',
    md:   '0 4px 12px -2px rgba(0,0,0,0.5)',
    lg:   '0 24px 48px -12px rgba(0,0,0,0.6)',
    logo:    '0 2px 8px rgba(0,0,0,0.5)',
    obsidian: '0 8px 32px -4px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.4)',  // Deep card shadow
    glow: (color: string) => `0 0 60px ${color}20, 0 0 100px ${color}10`,
  },

  // ==========================================================================
  // §5  RADIUS — 4px base grid
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
  // §6  SPACING — 4px base grid (absorbed from dead design-tokens.ts)
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
  // §7  CARD GEOMETRY
  // ==========================================================================
  card: {
    padding:      'p-5',
    radius:       'rounded-3xl',
    gap:          'gap-4',
    border:       'border border-white/[0.06]',
    bg:           'bg-[#0A0A0B]',
    headerHeight: 'h-[44px]',
    innerGlow:    'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]',
    base: 'bg-[#0A0A0B] border border-white/[0.06] rounded-3xl p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]',
  },

  // ==========================================================================
  // §8  TYPOGRAPHY TIERS — Institutional Hierarchy
  // ==========================================================================
  tier: {
    // Tier 1: Primary Values — Monospace, bold, white
    t1Score:   'font-mono text-[32px] font-bold tabular-nums text-white tracking-tight',
    t1Value:   'font-mono text-[16px] font-bold tabular-nums text-white tracking-tight',
    t1Project: 'font-mono text-[24px] font-black tabular-nums text-white tracking-tight',

    // Tier 2: Labels & Names — Sans, semibold
    t2Label:  'text-[9px] font-bold text-zinc-600 uppercase tracking-[0.15em]',
    t2Team:   'text-sm font-semibold text-zinc-200 tracking-tight',
    t2Header: 'text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]',

    // Tier 3: Metadata — Sans, medium, muted
    t3Meta:   'text-[9px] font-medium text-zinc-500 uppercase tracking-wider',
    t3Record: 'text-[10px] font-medium text-zinc-600 tabular-nums',
    t3Delta:  'font-mono text-[11px] font-bold tabular-nums text-zinc-400',
  },

  // Legacy typography (backwards compat — migrate to tier.* or scale.*)
  type: {
    hero:    'font-sans text-[32px] font-semibold tracking-[-0.02em] text-white',
    title:   'font-sans text-[20px] font-semibold tracking-[-0.01em] text-white',
    body:    'font-sans text-[15px] font-normal text-zinc-300',
    caption: 'font-sans text-[13px] font-medium text-zinc-500',
    label:   'text-[9px] font-bold text-zinc-600 uppercase tracking-[0.1em]',
    data:    'font-mono text-[16px] font-bold tabular-nums text-white',
    dataSm:  'font-mono text-[13px] font-semibold tabular-nums text-zinc-200',
    dataLg:  'font-mono text-[24px] font-black tabular-nums text-white',
  },

  // ==========================================================================
  // §9  MOTION — Apple-style spring physics
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
  // §10  MATERIALS — Glass & Vibrancy
  // ==========================================================================
  glass: {
    panel:  'bg-[#0A0A0B] border border-white/[0.06] backdrop-blur-xl',
    header: 'bg-black/95 backdrop-blur-2xl border-b border-white/[0.04]',
    card:   'bg-[#0A0A0B] border border-white/[0.06] rounded-2xl',
  },

  // ==========================================================================
  // §11  Z-INDEX
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
  // §12  MICRO-INTERACTIONS
  // ==========================================================================
  interactions: {
    hoverScale:  { scale: 1.01, boxShadow: "0 20px 40px -12px rgba(0,0,0,0.5)" },
    activePress: { scale: 0.98 },
    fadeIn:       { opacity: 0, y: 8 },
    fadeInActive: { opacity: 1, y: 0 },
    glowPulse:   { boxShadow: "0 0 20px rgba(52, 211, 153, 0.3)" },
    haptic: {
      whileHover: { scale: 1.01 },
      whileTap:   { scale: 0.98 },
      transition: { type: "spring" as const, stiffness: 600, damping: 30 },
    },
    vibrancy: 'mix-blend-overlay opacity-80 contrast-125 brightness-150',
  },

  // ==========================================================================
  // §13  NAVIGATION & HEADER
  // ==========================================================================
  nav: {
    h1:          'h-14',
    h2:          'h-10',
    pill:        'rounded-full bg-white/[0.04] border border-white/[0.04] shadow-sm transition-all duration-200',
    chip:        'w-11 h-11 flex items-center justify-center rounded-full bg-white/[0.02] border border-white/[0.04] text-zinc-500 hover:text-white hover:bg-white/[0.06] transition-all duration-200',
    initialPill: 'w-7 h-7 rounded-full bg-zinc-900 border border-white/[0.1] shadow-inner flex items-center justify-center text-[10px] font-bold text-zinc-100 tracking-tighter',
    divider:     'border-white/[0.08]',
  },

  // ==========================================================================
  // §14  FLOATING ACTION ICON
  // ==========================================================================
  floatingIcon: {
    position:  'absolute bottom-4 right-4',
    size:      'w-8 h-8',
    style:     'rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center',
    iconSize:  14,
    iconColor: 'text-zinc-600',
  },

  // ==========================================================================
  // §15  TAILWIND UTILITY PRESETS
  // ==========================================================================
  // Pre-composed class strings for the most common UI patterns.
  // Absorbed from dead design-tokens.ts (TW.*) and density.ts (DENSE.*).
  tw: {
    // --- Section & Card Headers ---
    sectionLabel:     'text-[12px] font-medium text-zinc-500 uppercase tracking-[0.12em]',
    cardHeaderLabel:  'text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]',
    columnHeader:     'text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.15em]',

    // --- Data Display ---
    dataValue:          'text-[15px] font-semibold text-white tabular-nums',
    dataValueSecondary: 'text-[11px] font-medium text-zinc-500 tabular-nums',
    teamAbbr:           'text-[12px] font-semibold text-zinc-300 uppercase tracking-[0.08em]',
    tabular:            'tabular-nums font-mono',

    // --- Border shorthands ---
    border: {
      ghost:   'border border-white/[0.03]',
      subtle:  'border border-white/[0.04]',
      default: 'border border-white/[0.06]',
      strong:  'border border-white/[0.12]',
    },

    // --- Surface shorthands ---
    surface: {
      ghost:    'bg-white/[0.01]',
      subtle:   'bg-white/[0.02]',
      muted:    'bg-white/[0.04]',
      emphasis: 'bg-white/[0.06]',
    },

    // --- Row Patterns ---
    rowDivider:      'border-b border-white/[0.04]',
    rowDividerGhost: 'border-b border-white/[0.03]',
    interactiveRow:  'py-4 hover:bg-white/[0.02] transition-colors duration-200',

    // --- Icon Containers ---
    iconSm: 'w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center',
    iconMd: 'w-10 h-10 rounded-lg bg-white/[0.03] flex items-center justify-center',

    // --- Cards (density-aware) ---
    card:         'rounded-xl border border-white/[0.06] bg-[#0A0A0B] p-3',
    cardFeatured: 'rounded-2xl border border-white/[0.06] bg-[#0A0A0B] p-4',
    cardCompact:  'rounded-lg border border-white/[0.06] bg-[#0A0A0B] p-2',

    // --- Tabs ---
    tabsWrap:    'h-10 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1',
    tab:         'h-8 rounded-lg px-3 text-sm font-medium',
    tabActive:   'bg-white/[0.06] text-white',
    tabInactive: 'text-white/70 hover:text-white/90',

    // --- Badges ---
    badge:        'rounded-md px-2 py-1 text-[10px] font-semibold uppercase',
    badgeLive:    'bg-emerald-500/20 text-emerald-400',
    badgeNeutral: 'bg-white/[0.04] text-zinc-400',

    // --- Buttons ---
    buttonSm: 'h-8 rounded-lg px-3 text-sm font-medium',
    buttonMd: 'h-10 rounded-lg px-4 text-sm font-medium',

    // --- Page Layout ---
    page:       'px-4 space-y-3',
    pageGutter: 'px-4',
    sectionGap: 'space-y-3',

    // --- Dividers ---
    divider:       'border-t border-white/[0.04]',
    dividerStrong: 'border-t border-white/[0.06]',
    hairline:      'h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent',

    // --- Hero / Header ---
    heroHeader: 'space-y-2 py-3',
    heroScore:  'text-2xl font-bold tabular-nums',
    heroClock:  'text-sm font-medium text-white/80',

    // --- Status ---
    statusText: 'text-[8px] font-black uppercase tracking-[0.15em]',
  },
} as const;

// =====================================================================export type EssenceColors  = typeof ESSENCE.colors;
export type EssenceSurface = keyof typeof ESSENCE.colors.surface;
export type EssenceText    = keyof typeof ESSENCE.colors.text;
export type EssenceAccent  = keyof typeof ESSENCE.colors.accent;
export type EssenceScale   = keyof typeof ESSENCE.scale;
export type EssenceTracking = keyof typeof ESSENCE.tracking;

export default ESSENCE;
