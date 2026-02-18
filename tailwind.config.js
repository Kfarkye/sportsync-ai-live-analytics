/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        // Mobile-first breakpoints (min-width scaling up)
        screens: {
            'sm': '375px',
            'md': '768px',
            'lg': '1024px',
            'xl': '1280px',
        },
        extend: {
            fontFamily: {
                sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
            },
            fontSize: {
                'odds': ['max(18px, 1.125rem)', { lineHeight: '1.2', fontWeight: '700' }],
                'edge-badge': ['max(14px, 0.875rem)', { lineHeight: '1.2', fontWeight: '700' }],
            },
            colors: {
                brand: {
                    cyan: '#00F0FF',
                    'cyan-dim': 'rgba(0, 240, 255, 0.15)',
                },
                surface: {
                    base: '#09090B',
                    card: '#0A0A0B',
                    elevated: '#0C0C0D',
                    subtle: '#111111',
                    dark: '#09090B',
                    darker: '#030303',
                },
            },
            spacing: {
                'safe-top': 'env(safe-area-inset-top)',
                'safe-bottom': 'env(safe-area-inset-bottom)',
                'safe-left': 'env(safe-area-inset-left)',
                'safe-right': 'env(safe-area-inset-right)',
                'nav': '72px',
            },
            boxShadow: {
                'deep': '0 24px 80px -12px rgba(0, 0, 0, 0.8)',
                'glow-cyan': '0 0 20px rgba(0, 240, 255, 0.35)',
                'glow-cyan-sm': '0 0 10px rgba(0, 240, 255, 0.25)',
                'obsidian': 'inset 0 1px 0 0 rgba(255,255,255,0.08), 0 4px 12px -2px rgba(0,0,0,0.5)',
            },
            backdropBlur: {
                '2xl': '40px',
                '3xl': '64px',
            },
            animation: {
                'typing-dot': 'typing-dot 1.4s infinite ease-in-out',
                'pulse-subtle': 'pulse-subtle 2s infinite',
                'float': 'float 3s ease-in-out infinite',
                'skeleton': 'skeleton-shimmer 1.5s ease-in-out infinite',
                'reconnect': 'reconnect-pulse 2s ease-in-out infinite',
            },
            keyframes: {
                'typing-dot': {
                    '0%, 80%, 100%': { opacity: '0.3', transform: 'scale(0.8)' },
                    '40%': { opacity: '1', transform: 'scale(1)' },
                },
                'pulse-subtle': {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0.7' },
                },
                'float': {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-4px)' },
                },
                'skeleton-shimmer': {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
                'reconnect-pulse': {
                    '0%, 100%': { opacity: '0.3' },
                    '50%': { opacity: '1' },
                },
            },
            borderRadius: {
                '2xl': '1rem',
                '3xl': '1.5rem',
            },
            minWidth: {
                'touch': '44px',
            },
            minHeight: {
                'touch': '44px',
            },
        },
    },
    plugins: [],
}
