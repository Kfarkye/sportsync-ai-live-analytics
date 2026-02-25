/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            /* ── Fonts (kept — 19 + 227 usages) ─────────────────────── */
            fontFamily: {
                sans: ['Geist', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
                mono: ['Geist Mono', 'JetBrains Mono', 'SF Mono', 'monospace'],
            },

            /* ── ESSENCE Type Scale (12 stops) ──────────────────────── *
             * Replaces 684 raw text-[Npx] values across 58 components.
             * Usage: text-caption, text-body, text-headline, etc.       */
            fontSize: {
                'nano':     '8px',
                'label':    '9px',
                'caption':  '10px',
                'footnote': '11px',
                'small':    '12px',
                'body-sm':  '13px',
                'body':     '14px',
                'body-lg':  '15px',
                'title':    '17px',
                'title-lg': '20px',
                'headline': '24px',
                'display':  '32px',
            },

            /* ── ESSENCE Colors ─────────────────────────────────────── *
             * Surfaces:  bg-surface-base, bg-surface-card, etc.
             * Edges:     border-edge, border-edge-subtle, etc.
             * Overlays:  bg-overlay-subtle, bg-overlay-muted, etc.
             * Brand:     text-brand-cyan, bg-brand-cyan (3 usages)     */
            colors: {
                brand: {
                    primary: 'rgb(var(--brand-primary-rgb) / <alpha-value>)',
                    muted: 'var(--brand-muted)',
                    cyan: 'rgb(var(--brand-cyan-rgb) / <alpha-value>)',
                },
                surface: {
                    pure:     'rgb(var(--surface-pure-rgb) / <alpha-value>)',
                    base:     'rgb(var(--surface-base-rgb) / <alpha-value>)',
                    card:     'rgb(var(--surface-card-rgb) / <alpha-value>)',
                    elevated: 'rgb(var(--surface-elevated-rgb) / <alpha-value>)',
                    subtle:   'rgb(var(--surface-subtle-rgb) / <alpha-value>)',
                    accent:   'rgb(var(--surface-accent-rgb) / <alpha-value>)',
                },
                edge: {
                    ghost:   'var(--edge-ghost)',
                    subtle:  'var(--edge-subtle)',
                    DEFAULT: 'var(--edge-default)',
                    strong:  'var(--edge-strong)',
                },
                overlay: {
                    ghost:    'var(--overlay-ghost)',
                    subtle:   'var(--overlay-subtle)',
                    muted:    'var(--overlay-muted)',
                    emphasis: 'var(--overlay-emphasis)',
                },
                ink: {
                    primary: 'var(--ink-primary)',
                    secondary: 'var(--ink-secondary)',
                    tertiary: 'var(--ink-tertiary)',
                    muted: 'var(--ink-muted)',
                    ghost: 'var(--ink-ghost)',
                },
            },

            /* ── Shadows (kept — 1 usage each) ─────────────────────── */
            boxShadow: {
                'glow-cyan':    '0 0 20px rgba(0, 240, 255, 0.35)',
                'glow-cyan-sm': '0 0 10px rgba(0, 240, 255, 0.25)',
            },
        },
    },
    plugins: [],
}
