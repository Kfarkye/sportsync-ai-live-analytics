/**
 * Obsidian Weissach Design System — Canonical Tokens
 * Three-font hierarchy. Ultra-low opacity borders. Four-layer shadow stack.
 */

export const fonts = {
  serif: "'Newsreader', Georgia, serif",
  mono: "'JetBrains Mono', monospace",
  sans: "'DM Sans', system-ui, sans-serif",
} as const;

export const colors = {
  bg: '#080808',
  card: '#0e0e0e',
  cardHover: '#111111',
  border: 'rgba(255,255,255,0.04)',
  borderSubtle: 'rgba(255,255,255,0.02)',
  borderActive: 'rgba(255,255,255,0.07)',
  text: {
    primary: 'rgba(255,255,255,1.0)',
    secondary: 'rgba(255,255,255,0.4)',
    tertiary: 'rgba(255,255,255,0.2)',
    disabled: 'rgba(255,255,255,0.1)',
  },
  accent: {
    green: '#16a34a',
    greenBg: 'rgba(34,197,94,0.04)',
    greenBorder: 'rgba(34,197,94,0.12)',
    red: '#dc2626',
    redBg: 'rgba(220,38,38,0.04)',
    redBorder: 'rgba(220,38,38,0.12)',
    gray: '#737373',
    grayBg: 'rgba(115,115,115,0.08)',
  },
  insight: {
    bg: 'rgba(255,255,255,0.015)',
    border: 'rgba(255,255,255,0.04)',
  },
} as const;

export const shadows = {
  card: '0 0 0 1px rgba(255,255,255,.02), 0 2px 4px rgba(0,0,0,.3), 0 12px 40px rgba(0,0,0,.5), 0 40px 80px rgba(0,0,0,.25)',
  cardHover: '0 0 0 1px rgba(255,255,255,.04), 0 4px 8px rgba(0,0,0,.4), 0 16px 48px rgba(0,0,0,.6), 0 48px 96px rgba(0,0,0,.3)',
} as const;

export const animation = {
  fadeUp: { duration: 0.3, ease: [0.4, 0, 0.2, 1] as number[] },
  revealScore: { duration: 0.7, ease: [0.34, 1.56, 0.64, 1] as number[] },
  expandLine: { duration: 0.6, ease: [0.4, 0, 0.2, 1] as number[] },
  stagger: 0.04,
} as const;

export const fontImport =
  'https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;1,400;1,500&family=JetBrains+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap';
