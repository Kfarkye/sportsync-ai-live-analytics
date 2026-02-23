// ============================================================================
// SHARED DESIGN TOKENS (SSOT)
// Edit in packages/shared/src/lib/essence.ts and run `npm run sync:shared`.
// ============================================================================

// ============================================================================
// ESSENCE DESIGN SYSTEM v10.0 — Unified Visual Grammar
// "One language. Every detail. Aligned."
// ============================================================================

export const ESSENCE = {
  // --- PALETTE: Cinematic Depth (NOT pure black) ---
  colors: {
    surface: {
      base: '#09090b',         // Deep background (Zinc 950+)
      card: '#0A0A0B',         // Surface Cards (unified)
      elevated: '#0C0C0D',     // Elevated elements
      subtle: '#1A1A1C',       // Hover states (lighter)
      pure: '#000000',         // True Black (sparingly)
    },
    text: {
      primary: '#FAFAFA',      // Zinc 50
      secondary: '#A1A1AA',    // Zinc 400
      tertiary: '#71717A',     // Zinc 500
      muted: '#52525B',        // Zinc 600
      ghost: '#3F3F46',        // Zinc 700
    },
    accent: {
      emerald: '#34D399',      // Success / Live
      amber: '#FBBF24',        // Warning / Halftime
      rose: '#FB7185',         // Error
      violet: '#A78BFA',       // Premium / Processing
    },
    border: {
      subtle: 'rgba(255,255,255,0.04)',
      default: 'rgba(255,255,255,0.06)',
      strong: 'rgba(255,255,255,0.12)',
      innerGlow: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.02) 100%)',
    }
  },

  // --- SHADOWS: Cinematic depth ---
  shadows: {
    sm: '0 1px 2px rgba(0,0,0,0.4)',
    md: '0 4px 12px -2px rgba(0,0,0,0.5)',
    lg: '0 24px 48px -12px rgba(0,0,0,0.6)',
    glow: (color: string) => `0 0 60px ${color}20, 0 0 100px ${color}10`,
  },

  // --- RADIUS: Unified scale (4px base) ---
  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '20px',
    full: '9999px',
    // Apple Squircle Approximation (requires clip-path or heavy radius)
    squircle: '44% / 44%',
  },

  // --- CARD GEOMETRY: Normalized container rules ---
  card: {
    padding: 'p-5',           // 20px - consistent padding
    radius: 'rounded-3xl',    // 24px - unified Apple baseline
    gap: 'gap-4',             // 16px - internal spacing
    border: 'border border-white/[0.06]',
    bg: 'bg-[#0A0A0B]',
    headerHeight: 'h-[44px]', // Consistent header baseline
    innerGlow: 'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]',
    // Full card class shorthand
    base: 'bg-[#0A0A0B] border border-white/[0.06] rounded-3xl p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]',
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

  // --- MATERIALS: Cinematic Glass & Cards ---
  glass: {
    panel: 'bg-[#0A0A0B] border border-white/[0.06] backdrop-blur-xl',
    header: 'bg-black/95 backdrop-blur-2xl border-b border-white/[0.04]',
    card: 'bg-[#0A0A0B] border border-white/[0.06] rounded-2xl',
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
