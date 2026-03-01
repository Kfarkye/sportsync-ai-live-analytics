import React, { FC } from 'react';

interface LandingPageProps {
  onEnter: () => void;
}

const LandingPage: FC<LandingPageProps> = ({ onEnter }) => {
  return (
    <div className="relative min-h-screen w-full bg-surface-base text-ink-primary flex items-center justify-center px-6 py-12 overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[38rem] h-[38rem] rounded-full bg-brand-primary/[0.10] blur-3xl" />
        <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.08), transparent 35%), radial-gradient(circle at 80% 75%, rgba(255,255,255,0.06), transparent 30%)' }} />
      </div>

      <div className="relative w-full max-w-2xl text-center">
        <div className="inline-flex items-center justify-center gap-2 text-caption font-semibold uppercase tracking-[0.2em] text-ink-tertiary mb-6 px-3 py-1.5 rounded-full border border-edge-subtle bg-overlay-subtle">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
          Live Edge Intelligence
        </div>

        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight text-ink-primary text-balance">
          Sportsync AI
        </h1>

        <p className="mt-5 text-body-lg text-ink-secondary leading-relaxed max-w-xl mx-auto">
          Editorial-grade analysis for live sports. Clean signal, minimal noise — built for
          people who want to see the market, the story, and the edge at a glance.
        </p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <div className="rounded-xl border border-edge-subtle bg-overlay-subtle px-4 py-3">
            <p className="text-label uppercase tracking-widest text-ink-muted mb-1">Signal</p>
            <p className="text-footnote font-semibold text-ink-secondary">Live line movement and context in one view.</p>
          </div>
          <div className="rounded-xl border border-edge-subtle bg-overlay-subtle px-4 py-3">
            <p className="text-label uppercase tracking-widest text-ink-muted mb-1">Speed</p>
            <p className="text-footnote font-semibold text-ink-secondary">Actionable snapshots with no dashboard clutter.</p>
          </div>
          <div className="rounded-xl border border-edge-subtle bg-overlay-subtle px-4 py-3">
            <p className="text-label uppercase tracking-widest text-ink-muted mb-1">Coverage</p>
            <p className="text-footnote font-semibold text-ink-secondary">Cross-league feed with deep game-level context.</p>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={onEnter}
            className="w-full max-w-[220px] py-3 rounded-full bg-brand-primary text-white text-footnote font-bold uppercase tracking-widest transition-all hover:opacity-90 hover:shadow-[0_10px_30px_rgba(79,70,229,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
          >
            Open Live Feed
          </button>
          <span className="text-caption text-ink-tertiary">
            Updated continuously across live and pregame windows.
          </span>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
