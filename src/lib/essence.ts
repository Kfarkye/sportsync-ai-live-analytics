// ============================================================================
// SHARED DESIGN TOKENS (SSOT)
// Edit in packages/shared/src/lib/essence.ts and run `npm run sync:shared`.
// ============================================================================

// ============================================================================
// ESSENCE DESIGN SYSTEM v10.0 — Unified Visual Grammar
// "One language. Every detail. Aligned."
// ============================================================================

export const ESSENCE = {
  // --- PALETTE: Obsidian Weissach (void → card → elevated) ---
  colors: {
    surface: {
      base: '#09090B',         // Void — page background
      card: '#111113',         // Card — lifted from void
      elevated: '#1A1A1C',     // M-24: Elevated — inner panels, synopsis blocks (distinct from card)
      subtle: '#1A1A1C',       // Hover states
      pure: '#000000',         // True Black (sparingly)
    },
    text: {
      primary: '#EDEDEF',      // t1 — headlines, scores
      secondary: '#A1A1AA',    // t2 — body, secondary data
      tertiary: '#63636E',     // t3 — captions, hover states
      muted: '#3E3E47',        // t4 — labels, metadata
      ghost: '#52525C',        // tSys — system lines
    },
    accent: {
      mint: '#36E896',         // Primary — confidence, positive
      mintDim: 'rgba(54,232,150,0.06)',
      mintEdge: 'rgba(54,232,150,0.08)',
      gold: '#CDA04E',         // Secondary — caution, movement
      goldDim: 'rgba(205,160,78,0.08)',
      emerald: '#36E896',      // Alias for backwards compat
      amber: '#CDA04E',        // Alias for backwards compat
      rose: '#EF4444',         // Error / negative
      violet: '#A78BFA',       // Premium / Processing
    },
    border: {
      subtle: 'rgba(255,255,255,0.04)',
      default: 'rgba(255,255,255,0.04)',
      strong: 'rgba(255,255,255,0.08)',
      innerGlow: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.02) 100%)',
    }
  },

  // --- SHADOWS: Obsidian Layered Depth ---
  shadows: {
    sm: '0 1px 2px rgba(0,0,0,0.5)',
    md: '0 4px 12px rgba(0,0,0,0.25)',
    lg: '0 16px 40px rgba(0,0,0,0.3)',
    // Obsidian 4-layer shadow (the Weissach spec)
    obsidian: '0 0 0 1px rgba(255,255,255,0.03), 0 1px 2px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.25), 0 16px 40px rgba(0,0,0,0.3)',
    glow: (color: string) => `0 0 60px ${color}20, 0 0 100px ${color}10`,
  },

  // --- RADIUS: Obsidian scale (M-23 hierarchy) ---
  radius: {
    sm: '4px',
    md: '10px',     // ri — buttons inside cards (M-23)
    lg: '12px',     // Inner cards (WATCH, CASH OUT) (M-23)
    xl: '16px',     // r  — outer card radius (M-23: 16px)
    '2xl': '20px',
    full: '9999px',
    squircle: '44% / 44%',
    pill: '6px',    // Badges/pills — smallest (M-23)
  },

  // --- CARD GEOMETRY: Obsidian Weissach container ---
  card: {
    padding: 'p-7',           // 28px — Obsidian spec (32px top via pt-8)
    radius: 'rounded-[16px]', // M-23: 16px — outer card
    gap: 'gap-4',             // 16px - internal spacing
    border: 'border border-white/[0.04]',
    bg: 'bg-[#111113]',
    headerHeight: 'h-[44px]',
    innerGlow: 'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]',
    // Full Obsidian card class shorthand
    base: 'bg-[#111113] border border-white/[0.04] rounded-[16px] shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_1px_2px_rgba(0,0,0,0.5),0_4px_12px_rgba(0,0,0,0.25),0_16px_40px_rgba(0,0,0,0.3)]', // M-23
  },

  // --- TYPOGRAPHY: 3-Tier Unified System ---
  // 
  // TIER 1: Primary Numbers & Values (Highest visual weight)
  //   - Score, Win %, Main odds numbers
  //   - Monospace, bold, white
  //
  // TIER 2: Primary Labels (Team names, column headers)
  //   - Team names, Spread/Total/Moneyline labels
  //   - Sans-serif, semibold, zinc-200
  //
  // TIER 3: Metadata & Descriptors (Lowest visual weight)
  //   - Records, deltas, timestamps, props
  //   - Sans-serif, medium, zinc-500
  //
  tier: {
    // TIER 1: Primary Values (Institutional Authority)
    // Enforced Monospace for all numeric values to prevent "jumping"
    t1Score: 'font-mono text-[32px] font-bold tabular-nums text-white tracking-tight',
    t1Value: 'font-mono text-[16px] font-bold tabular-nums text-white tracking-tight',
    t1Project: 'font-mono text-[24px] font-black tabular-nums text-white tracking-tight',

    // TIER 2: Secondary Metadata (The "Knowledge" Layer)
    t2Label: 'text-[9px] font-bold text-zinc-600 uppercase tracking-[0.15em]',
    t2Team: 'text-sm font-semibold text-zinc-200 tracking-tight',
    t2Header: 'text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]',

    // TIER 3: Deep Context (The "Forensic" Layer)
    t3Meta: 'text-[9px] font-medium text-zinc-500 uppercase tracking-wider',
    t3Record: 'text-[10px] font-medium text-zinc-600 tabular-nums',
    t3Delta: 'font-mono text-[11px] font-bold tabular-nums text-zinc-400',
  },

  // Legacy typography (for backwards compatibility)
  type: {
    hero: 'font-sans text-[32px] font-semibold tracking-[-0.02em] text-white',
    title: 'font-sans text-[20px] font-semibold tracking-[-0.01em] text-white',
    body: 'font-sans text-[15px] font-normal text-zinc-300',
    caption: 'font-sans text-[13px] font-medium text-zinc-500',
    label: 'text-[9px] font-bold text-zinc-600 uppercase tracking-[0.1em]',
    data: 'font-mono text-[16px] font-bold tabular-nums text-white',
    dataSm: 'font-mono text-[13px] font-semibold tabular-nums text-zinc-200',
    dataLg: 'font-mono text-[24px] font-black tabular-nums text-white',
  },

  // --- MOTION: Apple-style spring physics ---
  transition: {
    spring: { type: "spring", stiffness: 400, damping: 30, mass: 1 },
    soft: { type: "spring", stiffness: 200, damping: 25 },
    instant: { duration: 0.15, ease: [0.25, 0.1, 0.25, 1.0] },
    shared: { layoutId: "shared-element", transition: { type: "spring", stiffness: 400, damping: 30 } }
  },

  // --- MATERIALS: Obsidian Glass & Cards ---
  glass: {
    panel: 'bg-[#111113] border border-white/[0.04] backdrop-blur-xl',
    header: 'bg-[#09090B]/95 backdrop-blur-2xl border-b border-white/[0.04]',
    card: 'bg-[#111113] border border-white/[0.04] rounded-[16px]', // M-23
  },

  zIndex: {
    base: 0,
    card: 10,
    header: 40,
    drawer: 50,
    modal: 60,
    tooltip: 70,
  },

  // --- MICRO-INTERACTIONS: Elite UI/UX ---
  interactions: {
    hoverScale: { scale: 1.01, boxShadow: "0 20px 40px -12px rgba(0,0,0,0.5)" },
    activePress: { scale: 0.98 },
    fadeIn: { opacity: 0, y: 8 },
    fadeInActive: { opacity: 1, y: 0 },
    glowPulse: { boxShadow: "0 0 20px rgba(52, 211, 153, 0.3)" },
    // Haptic response
    haptic: {
      whileHover: { scale: 1.01 },
      whileTap: { scale: 0.98 },
      transition: { type: "spring", stiffness: 600, damping: 30 }
    },
    // Apple-tier glass vibrancy
    vibrancy: 'mix-blend-overlay opacity-80 contrast-125 brightness-150',
  },

  // --- TRANSITION DURATIONS (Tailwind utility targets) ---
  durations: {
    fast: 'duration-150',
    base: 'duration-300',
    slow: 'duration-500',
    ultraSlow: 'duration-1000',
  },

  // --- FLOATING ACTION ICON: Unified placement ---
  floatingIcon: {
    position: 'absolute bottom-4 right-4',
    size: 'w-8 h-8',
    style: 'rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center',
    iconSize: 14,
    iconColor: 'text-zinc-600',
  },

  // --- HEADER & NAVIGATION: Apple-grade structural hierarchy ---
  nav: {
    h1: 'h-14',               // 56px - Row 1
    h2: 'h-10',               // 40px - Row 2
    pill: 'rounded-full bg-white/[0.04] border border-white/[0.04] shadow-sm transition-all duration-200',
    chip: 'w-11 h-11 flex items-center justify-center rounded-full bg-white/[0.02] border border-white/[0.04] text-zinc-500 hover:text-white hover:bg-white/[0.06] transition-all duration-200',
    initialPill: 'w-7 h-7 rounded-full bg-zinc-900 border border-white/[0.1] shadow-inner flex items-center justify-center text-[10px] font-bold text-zinc-100 tracking-tighter',
    divider: 'border-white/[0.08]', // Increased contrast for separation
  }
} as const;

export const cn = (...classes: (string | undefined | null | false)[]) =>
  classes.filter(Boolean).join(' ');

export default ESSENCE;
