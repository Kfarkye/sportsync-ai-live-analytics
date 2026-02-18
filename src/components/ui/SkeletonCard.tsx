/**
 * Skeleton Loading States — Edge Cards
 * Zero layout shift: matches exact dimensions of real cards
 */

import React from 'react';

export const SkeletonMatchRow: React.FC = () => (
  <div className="w-full min-h-[72px] flex items-center px-4 md:px-5 py-4 border-b border-white/[0.04]">
    <div className="flex flex-col gap-2.5 flex-1 pr-4">
      {[0, 1].map(i => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full skeleton" />
          <div className="h-3.5 w-24 rounded skeleton" />
        </div>
      ))}
    </div>
    <div className="min-w-[70px] flex flex-col items-end gap-1 pl-3 border-l border-white/[0.04]">
      <div className="h-3 w-12 rounded skeleton" />
      <div className="h-2.5 w-8 rounded skeleton" />
    </div>
  </div>
);

export const SkeletonMatchCard: React.FC = () => (
  <div className="w-full rounded-2xl border border-white/[0.06] bg-[#0A0A0B] p-4 md:p-5">
    <div className="flex items-center justify-between mb-4">
      <div className="h-3 w-14 rounded skeleton" />
      <div className="h-3 w-10 rounded skeleton" />
    </div>
    <div className="space-y-3">
      {[0, 1].map(i => (
        <div key={i} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full skeleton" />
            <div className="space-y-1.5">
              <div className="h-3.5 w-28 rounded skeleton" />
              <div className="h-2.5 w-16 rounded skeleton" />
            </div>
          </div>
          <div className="h-6 w-10 rounded skeleton" />
        </div>
      ))}
    </div>
  </div>
);

export const SkeletonEdgeCard: React.FC = () => (
  <div className="w-full rounded-2xl border border-white/[0.06] bg-[#0A0A0B] overflow-hidden">
    {/* Matchup header skeleton */}
    <div className="p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full skeleton" />
          <div className="h-3.5 w-20 rounded skeleton" />
          <span className="text-zinc-700 text-xs">vs</span>
          <div className="h-3.5 w-20 rounded skeleton" />
          <div className="w-6 h-6 rounded-full skeleton" />
        </div>
      </div>

      {/* Edge badge skeleton */}
      <div className="h-8 w-24 rounded-lg skeleton mb-4" />

      {/* Odds comparison grid skeleton */}
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-10 rounded-lg skeleton" />
        ))}
      </div>
    </div>

    {/* AI analysis skeleton (collapsed) */}
    <div className="border-t border-white/[0.04] px-4 py-3">
      <div className="h-3 w-20 rounded skeleton" />
    </div>
  </div>
);

export default { SkeletonMatchRow, SkeletonMatchCard, SkeletonEdgeCard };
