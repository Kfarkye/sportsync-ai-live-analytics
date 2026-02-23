/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            /* ──────────────────────────────────────────────────────
               §1  TYPOGRAPHY — aligned with ESSENCE.scale
               Enables migration: text-[10px] → text-caption
               ────────────────────────────────────────────────────── */
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
                mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
            },
            fontSize: {
                // ESSENCE named scale (value + line-height)
                'nano':     ['8px',  { lineHeight: '10px' }],
                'label':    ['9px',  { lineHeight: '12px' }],
                'caption':  ['10px', { lineHeight: '14px' }],
                'footnote': ['11px', { lineHeight: '14px' }],
                'small':    ['12px', { lineHeight: '16px' }],
                'body-sm':  ['13px', { lineHeight: '18px' }],
                'body':     ['14px', { lineHeight: '20px' }],
                'body-lg':  ['15px', { lineHeight: '22px' }],
                'title':    ['17px', { lineHeight: '24px' }],
                'title-lg': ['20px', { lineHeight: '28px' }],
                'headline': ['24px', { lineHeight: '32px' }],
                'display':  ['32px', { lineHeight: '40px' }],
            },

            /* ──────────────────────────────────────────────────────
               §2  COLORS — aligned with ESSENCE.colors
               Enables migration: bg-[#09090b] → bg-surface-base
               ────────────────────────────────────────────────────── */
            colors: {
                brand: {
                    cyan: '#00F0FF',                      // 3 usages
                    'cyan-dim': 'rgba(0, 240, 255, 0.15)',
                },
                surface: {
                    pure:     '#000000',
                    base:     '#09090B',
                    card:     '#0A0A0B',
                    elevated: '#111113',
                    subtle:   '#1A1A1C',
                    accent:   '#222224',
                },
                // Border opacity tiers (use as border-edge-ghost, etc.)
                edge: {
                    ghost:   'rgba(255,255,255,0.03)',
                    subtle:  'rgba(255,255,255,0.04)',
                    DEFAULT: 'rgba(255,255,255,0.06)',
                    strong:  'rgba(255,255,255,0.12)',
                },
                // Background overlay tiers
                overlay: {
                    ghost:    'rgba(255,255,255,0.01)',
                    subtle:   'rgba(255,255,255,0.02)',
                    muted:    'rgba(255,255,255,0.04)',
                    emphasis: 'rgba(255,255,255,0.06)',
                },
            },

            /* ──────────────────────────────────────────────────────
               §3  LETTER SPACING — aligned with ESSENCE.tracking
               Enables migration: tracking-[0.2em] → tracking-widest
               ────────────────────────────────────────────────────── */
            letterSpacing: {
                tight:   '-0.02em',
                snug:    '-0.01em',
                normal:  '0em',
                wide:    '0.04em',
                wider:   '0.08em',
                widest:  '0.2em',
                ultra:   '0.3em',
            },

            /* ──────────────────────────────────────────────────────
               §4  EFFECTS
               ────────────────────────────────────────────────────── */
            boxShadow: {
                'glow-cyan':    '0 0 20px rgba(0, 240, 255, 0.35)',
                'glow-cyan-sm': '0 0 10px rgba(0, 240, 255, 0.25)', // 1 usage
                'obsidian':     '0 8px 32px -4px rgba(0,0,0,0.7)',  // ESSENCE.shadows.obsidian
            },
            backdropBlur: {
                '2xl': '40px',
                '3xl': '64px',  // 2 usages
            },

            /* ──────────────────────────────────────────────────────
               §5  BORDER RADIUS
               ────────────────────────────────────────────────────── */
            borderRadius: {
                '2xl': '1rem',
                '3xl': '1.5rem',
            },
        },
    },
    plugins: [],
}
