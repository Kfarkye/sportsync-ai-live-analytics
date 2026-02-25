import React, { FC } from 'react';

interface LandingPageProps {
  onEnter: () => void;
}

const LandingPage: FC<LandingPageProps> = ({ onEnter }) => {
  return (
    <div className="min-h-screen w-full bg-surface-base text-ink-primary flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl text-center">
        <div className="flex items-center justify-center gap-2 text-caption font-semibold uppercase tracking-[0.2em] text-ink-tertiary mb-6">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
          Live Edge Intelligence
        </div>

        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-ink-primary">
          The Drip
        </h1>

        <p className="mt-6 text-body-lg text-ink-secondary leading-relaxed">
          Editorial-grade analysis for live sports. Clean signal, minimal noise — built for
          people who want to see the market, the story, and the edge at a glance.
        </p>

        <div className="mt-10 flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={onEnter}
            className="w-full max-w-[220px] py-3 rounded-full bg-brand-primary text-white text-footnote font-bold uppercase tracking-widest transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
          >
            Enter
          </button>
          <span className="text-caption text-ink-tertiary">
            See what the books see, live.
          </span>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
