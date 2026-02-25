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
                sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
                mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
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
                    slate: '#0F172A',
                },
                surface: {
                    pure:     '#FFFFFF',
                    base:     '#F8FAFC',   /* slate-50 */
                    card:     '#FFFFFF',
                    elevated: '#FFFFFF',
                    subtle:   '#F1F5F9',   /* slate-100 */
                    accent:   '#E2E8F0',   /* slate-200 */
                },
                edge: {
                    ghost:   'rgba(15,23,42,0.03)',
                    subtle:  'rgba(15,23,42,0.06)',
                    DEFAULT: '#E2E8F0',
                    strong:  '#CBD5E1',
                },
                overlay: {
                    ghost:    'rgba(15,23,42,0.02)',
                    subtle:   'rgba(15,23,42,0.04)',
                    muted:    'rgba(15,23,42,0.06)',
                    emphasis: 'rgba(15,23,42,0.08)',
                },
            },

            /* ── Shadows — Editorial Light (microscopic only) ──────── */
            boxShadow: {
                'editorial-sm': '0 1px 2px rgba(0, 0, 0, 0.04)',
                'editorial-md': '0 2px 4px rgba(0, 0, 0, 0.04)',
            },
        },
    },
    plugins: [],
}
