/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
                mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
            },
            colors: {
                brand: {
                    cyan: '#00F0FF',
                    'cyan-dim': 'rgba(0, 240, 255, 0.15)',
                },
                surface: {
                    dark: '#09090B',
                    darker: '#030303',
                    card: 'rgba(9, 9, 11, 0.8)',
                },
            },
            boxShadow: {
                'deep': '0 24px 80px -12px rgba(0, 0, 0, 0.8)',
                'glow-cyan': '0 0 20px rgba(0, 240, 255, 0.35)',
                'glow-cyan-sm': '0 0 10px rgba(0, 240, 255, 0.25)',
            },
            backdropBlur: {
                '2xl': '40px',
                '3xl': '64px',
            },
            animation: {
                'typing-dot': 'typing-dot 1.4s infinite ease-in-out',
                'pulse-subtle': 'pulse-subtle 2s infinite',
                'float': 'float 3s ease-in-out infinite',
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
            },
            borderRadius: {
                '2xl': '1rem',
                '3xl': '1.5rem',
            },
        },
    },
    plugins: [],
}
