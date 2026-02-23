import React, { FC } from 'react';

interface LandingPageProps {
  onEnter: () => void;
}

const LandingPage: FC<LandingPageProps> = ({ onEnter }) => {
  return (
    <div className="drip-landing-body">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');

        /* ═══════════════════════════════════════════════════════════════════════
           OBSIDIAN WEISSACH v7 — THE DRIP LANDING PAGE
           ═══════════════════════════════════════════════════════════════════════
           
           Design Principles:
           ├─ Jony Ive: Every element earned. Nothing decorative.
           ├─ Steve Jobs: Precision creates adoption. First glance = understood.
           ├─ Linear/Vercel: Crisp. Correct. Mathematically consistent.
           ├─ Porsche: Luxury is engineered, not announced.
           └─ Emerald: Single accent, earned by interaction.
           
           Typography: Geist (Vercel's Swiss-inspired sans, precision-engineered for UI)
           Palette: Obsidian blacks with emerald accent
           
        ═══════════════════════════════════════════════════════════════════════ */

        .drip-landing-body, .drip-landing-body *, .drip-landing-body *::before, .drip-landing-body *::after {
            box-sizing: border-box;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        .drip-landing-body {
            /* ─── OBSIDIAN PALETTE ─── */
            --void: #000000;
            --obsidian: #060606;
            --graphite: #0e0e0e;
            --carbon: #161616;
            --ash: #1e1e1e;
            --smoke: #2a2a2a;
            --slate: #3a3a3a;
            --silver: #666666;
            --mist: #888888;
            --cloud: #aaaaaa;
            --bone: #c8c8c8;
            --ivory: #e0e0e0;
            --white: #f0f0f0;

            /* ─── EMERALD ACCENT (earned, not given) ─── */
            --emerald: #00c978;
            --emerald-soft: #00b86e;
            --emerald-dim: rgba(0, 201, 120, 0.12);
            --emerald-glow: rgba(0, 201, 120, 0.06);
            --emerald-pulse: rgba(0, 201, 120, 0.35);

            /* ─── MOTION ─── */
            --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
            --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);

            /* ─── TYPOGRAPHY ─── */
            --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
            
            font-family: var(--font-sans);
            background: var(--void);
            color: var(--white);
            min-height: 100vh;
            min-height: 100dvh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 24px;
            position: fixed;
            inset: 0;
            z-index: 9999;
            overflow-x: hidden;
            overflow-y: auto;
        }

        /* ─── FILM GRAIN (subtle analog texture) ─── */
        .drip-landing-body::before {
            content: '';
            position: fixed;
            inset: 0;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
            opacity: 0.025;
            pointer-events: none;
            z-index: 9999;
        }

        /* ─── AMBIENT GLOW (subtle, not decorative) ─── */
        .drip-landing-body::after {
            content: '';
            position: fixed;
            top: -40%;
            left: 50%;
            transform: translateX(-50%);
            width: 140%;
            height: 80%;
            background: radial-gradient(
                ellipse 60% 40% at 50% 0%,
                var(--emerald-glow) 0%,
                transparent 70%
            );
            pointer-events: none;
            z-index: -1;
        }

        /* ═══════════════════════════════════════════════════════════════════════
           CONTAINER
        ═══════════════════════════════════════════════════════════════════════ */

        .drip-landing-container {
            width: 100%;
            max-width: 520px;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            position: relative;
            z-index: 1;
        }

        /* ═══════════════════════════════════════════════════════════════════════
           LIVE INDICATOR (earned emerald moment)
        ═══════════════════════════════════════════════════════════════════════ */

        .drip-landing-indicator {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 48px;
            opacity: 0;
            animation: fadeIn 0.8s var(--ease-out-expo) 0.3s forwards;
        }

        .drip-pulse {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--emerald);
            position: relative;
            box-shadow: 0 0 12px var(--emerald-pulse);
        }

        .drip-pulse::before {
            content: '';
            position: absolute;
            inset: -3px;
            border-radius: 50%;
            background: var(--emerald);
            opacity: 0.4;
            animation: pulse 2.5s ease-in-out infinite;
        }

        .drip-live-text {
            font-size: 0.6875rem;
            font-weight: 500;
            letter-spacing: 0.15em;
            text-transform: uppercase;
            color: var(--emerald);
        }

        /* ═══════════════════════════════════════════════════════════════════════
           TYPOGRAPHY
        ═══════════════════════════════════════════════════════════════════════ */

        .drip-title {
            font-size: clamp(3rem, 12vw, 4.5rem);
            font-weight: 600;
            letter-spacing: -0.04em;
            line-height: 0.95;
            margin-bottom: 32px;
            opacity: 0;
            animation: fadeInUp 0.9s var(--ease-out-expo) 0.4s forwards;
        }

        .drip-headline {
            font-size: clamp(1.25rem, 4vw, 1.625rem);
            font-weight: 400;
            color: var(--bone);
            line-height: 1.35;
            letter-spacing: -0.01em;
            margin-bottom: 48px;
            opacity: 0;
            animation: fadeInUp 0.9s var(--ease-out-expo) 0.55s forwards;
        }

        .drip-headline-primary {
            display: block;
            margin-bottom: 8px;
        }

        .drip-headline-secondary {
            display: block;
            color: var(--mist);
            font-size: 0.9em;
        }

        /* ═══════════════════════════════════════════════════════════════════════
           CTA
        ═══════════════════════════════════════════════════════════════════════ */

        .drip-cta-wrapper {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
            opacity: 0;
            animation: fadeInUp 0.9s var(--ease-out-expo) 0.7s forwards;
        }

        .drip-cta {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 180px;
            padding: 18px 56px;
            font-family: var(--font-sans);
            font-size: 1rem;
            font-weight: 600;
            letter-spacing: -0.01em;
            color: var(--void);
            background: var(--white);
            border: none;
            border-radius: 14px;
            cursor: pointer;
            transition: all 0.25s var(--ease-out-quart);
            position: relative;
            overflow: hidden;
        }

        .drip-cta::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(135deg, transparent 0%, rgba(0,0,0,0.04) 100%);
            opacity: 0;
            transition: opacity 0.25s ease;
        }

        .drip-cta:hover {
            transform: translateY(-2px);
            box-shadow: 
                0 4px 20px rgba(240, 240, 240, 0.12),
                0 12px 40px rgba(240, 240, 240, 0.08);
        }

        .drip-cta:hover::before {
            opacity: 1;
        }

        .drip-cta:active {
            transform: translateY(0);
            transition-duration: 0.1s;
        }

        .drip-trial-note {
            font-size: 0.875rem;
            font-weight: 400;
            color: var(--silver);
            letter-spacing: 0.01em;
        }

        /* ═══════════════════════════════════════════════════════════════════════
           EDGE TAGLINE
        ═══════════════════════════════════════════════════════════════════════ */

        .drip-edge-tagline {
            margin-top: 80px;
            padding-top: 40px;
            border-top: 1px solid var(--ash);
            opacity: 0;
            animation: fadeIn 0.9s var(--ease-out-expo) 0.9s forwards;
        }

        .drip-edge-title {
            font-size: 0.6875rem;
            font-weight: 500;
            letter-spacing: 0.2em;
            text-transform: uppercase;
            color: var(--slate);
            margin-bottom: 12px;
        }

        .drip-edge-description {
            font-size: 0.9375rem;
            font-weight: 400;
            color: var(--mist);
            line-height: 1.5;
        }

        /* ═══════════════════════════════════════════════════════════════════════
           FOOTER
        ═══════════════════════════════════════════════════════════════════════ */

        .drip-footer {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 20px 24px;
            padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
            display: flex;
            justify-content: center;
            gap: 32px;
            opacity: 0;
            animation: fadeIn 0.8s var(--ease-out-expo) 1.1s forwards;
            z-index: 2;
        }

        .drip-footer-link {
            font-size: 0.75rem;
            font-weight: 400;
            color: var(--slate);
            text-decoration: none;
            letter-spacing: 0.02em;
            transition: color 0.2s ease;
        }

        .drip-footer-link:hover {
            color: var(--mist);
        }

        /* ═══════════════════════════════════════════════════════════════════════
           ANIMATIONS
        ═══════════════════════════════════════════════════════════════════════ */

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @keyframes pulse {
            0%, 100% {
                transform: scale(1);
                opacity: 0.4;
            }
            50% {
                transform: scale(2);
                opacity: 0;
            }
        }

        /* ═══════════════════════════════════════════════════════════════════════
           REDUCED MOTION
        ═══════════════════════════════════════════════════════════════════════ */

        @media (prefers-reduced-motion: reduce) {
            .drip-landing-body *, .drip-landing-body *::before, .drip-landing-body *::after {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }

        /* ═══════════════════════════════════════════════════════════════════════
           MOBILE
        ═══════════════════════════════════════════════════════════════════════ */

        @media (max-width: 480px) {
            .drip-landing-body {
                padding: 20px;
                padding-bottom: 100px;
            }

            .drip-landing-indicator {
                margin-bottom: 40px;
            }

            .drip-title {
                margin-bottom: 24px;
            }

            .drip-headline {
                margin-bottom: 40px;
            }

            .drip-cta {
                width: 100%;
                padding: 20px 48px;
            }

            .drip-edge-tagline {
                margin-top: 60px;
                padding-top: 32px;
            }
        }
      `}</style>

      <div className="drip-landing-container">
        {/* Live Indicator */}
        <div className="drip-landing-indicator">
          <div className="drip-pulse" />
          <span className="drip-live-text">Live</span>
        </div>

        {/* Title */}
        <h1 className="drip-title">The Drip</h1>

        {/* Headline */}
        <p className="drip-headline">
          <span className="drip-headline-primary">See what the books see. Live.</span>
          <span className="drip-headline-secondary">Odds. Edge. Context. One conversation.</span>
        </p>

        {/* CTA */}
        <div className="drip-cta-wrapper">
          <button className="drip-cta" onClick={onEnter}>Start</button>
          <span className="drip-trial-note">Free for 3 days</span>
        </div>

        {/* Edge Tagline */}
        <div className="drip-edge-tagline">
          <p className="drip-edge-title">Edge</p>
          <p className="drip-edge-description">Public tax stripped. Value revealed.</p>
        </div>
      </div>

      {/* Footer */}
      <footer className="drip-footer">
        <a href="/terms" className="drip-footer-link">Terms</a>
        <a href="/privacy" className="drip-footer-link">Privacy</a>
      </footer>
    </div>
  );
};

export default LandingPage;
