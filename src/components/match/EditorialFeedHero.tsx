import React, { memo } from 'react';
import { cn } from '@/lib/essence';

const STADIUM_IMAGE = '/editorial/baseball-live-stadium.jpg';
const GEAR_IMAGE = '/editorial/baseball-gear-closeup.jpg';

interface EditorialFeedHeroProps {
  baseballGamesCount: number;
  liveGamesCount: number;
  updatedClockLabel: string;
  firstPitchLabel: string;
  dateLabel: string;
  emptyState?: boolean;
  className?: string;
}

const StatPill = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-white/20 bg-white/10 px-3.5 py-2 backdrop-blur-md">
    <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/62">{label}</div>
    <div className="mt-1 text-[15px] font-semibold tracking-[-0.03em] text-white">{value}</div>
  </div>
);

const EditorialFeedHero = memo(({
  baseballGamesCount,
  liveGamesCount,
  updatedClockLabel,
  firstPitchLabel,
  dateLabel,
  emptyState = false,
  className,
}: EditorialFeedHeroProps) => {
  const title = emptyState ? 'MLB board resets soon.' : 'Baseball, under lights.';
  const subtitle = emptyState
    ? 'No baseball games are on this slate yet, but the live board is staged and ready for the next run of first pitches.'
    : 'A premium MLB-first feed with live pace, sharper match rows, and a cleaner editorial read on the board.';

  return (
    <section className={cn('grid gap-4 lg:grid-cols-[1.35fr_0.88fr]', className)} aria-label="Baseball hero">
      <article
        className="relative min-h-[320px] overflow-hidden rounded-[28px] border border-slate-200/80 shadow-[0_26px_70px_-36px_rgba(15,23,42,0.55)]"
        style={{
          backgroundImage: `linear-gradient(135deg, rgba(7,13,28,0.24) 0%, rgba(7,13,28,0.76) 58%, rgba(6,10,18,0.92) 100%), url(${STADIUM_IMAGE})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.24),transparent_26%),linear-gradient(180deg,transparent_0%,rgba(7,13,28,0.2)_52%,rgba(7,13,28,0.72)_100%)]" />
        <div className="relative flex h-full flex-col justify-between p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/18 bg-white/10 px-3 py-1.5 backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-[#ff5c35]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.26em] text-white/88">MLB Live Board</span>
            </div>
            <span className="rounded-full border border-white/18 bg-black/18 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/76 backdrop-blur-md">
              {dateLabel}
            </span>
          </div>

          <div className="max-w-[34rem]">
            <h2
              className="max-w-[12ch] text-[2.35rem] font-semibold leading-[0.94] tracking-[-0.06em] text-white sm:text-[3.65rem]"
              style={{ fontFamily: 'Iowan Old Style, Georgia, Times New Roman, serif' }}
            >
              {title}
            </h2>
            <p className="mt-4 max-w-[34rem] text-sm leading-6 text-white/78 sm:text-[15px]">
              {subtitle}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatPill label="Slate" value={`${baseballGamesCount} ${baseballGamesCount === 1 ? 'game' : 'games'}`} />
            <StatPill label="Live Now" value={liveGamesCount > 0 ? `${liveGamesCount} active` : 'Awaiting first pitch'} />
            <StatPill label="First Pitch" value={firstPitchLabel} />
          </div>
        </div>
      </article>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <article
          className="relative min-h-[152px] overflow-hidden rounded-[26px] border border-slate-200/80 shadow-[0_22px_60px_-34px_rgba(15,23,42,0.45)]"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(9,13,24,0.08) 0%, rgba(9,13,24,0.78) 100%), url(${GEAR_IMAGE})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="relative flex h-full flex-col justify-end p-5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/68">Diamond Detail</div>
            <div
              className="mt-2 text-[1.45rem] font-semibold leading-none tracking-[-0.05em] text-white"
              style={{ fontFamily: 'Iowan Old Style, Georgia, Times New Roman, serif' }}
            >
              Every live angle starts at field level.
            </div>
          </div>
        </article>

        <article
          className="relative min-h-[152px] overflow-hidden rounded-[26px] border border-slate-200/80 shadow-[0_22px_60px_-34px_rgba(15,23,42,0.45)]"
          style={{
            backgroundImage: `linear-gradient(135deg, rgba(4,10,24,0.82) 0%, rgba(12,33,86,0.68) 52%, rgba(176,33,37,0.5) 100%), url(${STADIUM_IMAGE})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="relative flex h-full flex-col justify-between p-5">
            <div className="inline-flex w-fit items-center rounded-full border border-white/16 bg-white/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-white/70 backdrop-blur-md">
              Live Play
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/60">Updated</div>
              <div className="mt-2 text-[1.75rem] font-semibold leading-none tracking-[-0.05em] text-white">
                {updatedClockLabel || 'Syncing'}
              </div>
              <p className="mt-2 max-w-[20rem] text-[13px] leading-5 text-white/74">
                Lights up, count sharp, and the live board staying ready for inning-state swings.
              </p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
});

EditorialFeedHero.displayName = 'EditorialFeedHero';

export default EditorialFeedHero;
