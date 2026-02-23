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
                    cyan: '#00F0FF',
                },
                surface: {
                    pure:     '#000000',
                    base:     '#09090b',
                    card:     '#0A0A0B',
                    elevated: '#111113',
                    subtle:   '#1A1A1C',
                    accent:   '#222224',
                },
                edge: {
                    ghost:   'rgba(255,255,255,0.03)',
                    subtle:  'rgba(255,255,255,0.04)',
                    DEFAULT: 'rgba(255,255,255,0.06)',
                    strong:  'rgba(255,255,255,0.12)',
                },
                overlay: {
                    ghost:    'rgba(255,255,255,0.01)',
                    subtle:   'rgba(255,255,255,0.02)',
                    muted:    'rgba(255,255,255,0.04)',
                    emphasis: 'rgba(255,255,255,0.06)',
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
