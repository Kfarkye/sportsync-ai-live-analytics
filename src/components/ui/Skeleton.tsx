import React, { memo } from 'react';
import { cn } from '@/lib/essence';

// ============================================================================
// SKELETON SYSTEM — Obsidian Weissach
// ============================================================================
// Synchronized shimmer via background-attachment: fixed.
// Every skeleton element shares the same sweep — no jitter between shapes.
//
// Research: Users perceive skeleton-loaded UIs as 20% faster than spinner UIs.
//           (Viget, 2024; NNGroup perceived performance studies)
// ============================================================================

// --- Keyframes injected once via <style> in head ---
const SHIMMER_STYLE_ID = 'obsidian-shimmer';
if (typeof document !== 'undefined' && !document.getElementById(SHIMMER_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = SHIMMER_STYLE_ID;
  style.textContent = `
    @keyframes obsidian-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `;
  document.head.appendChild(style);
}

// --- Primitive ---
interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const radiusMap = {
  sm: 'rounded',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  full: 'rounded-full',
} as const;

export const Skeleton = memo(({ className, width, height, rounded = 'md' }: SkeletonProps) => (
  <div
    className={cn(
      'bg-white/[0.04]',
      radiusMap[rounded],
      className,
    )}
    style={{
      width: typeof width === 'number' ? `${width}px` : width,
      height: typeof height === 'number' ? `${height}px` : height,
      backgroundImage: 'linear-gradient(90deg, transparent 25%, rgba(255,255,255,0.04) 50%, transparent 75%)',
      backgroundSize: '200% 100%',
      backgroundAttachment: 'fixed',
      animation: 'obsidian-shimmer 2s ease-in-out infinite',
    }}
    aria-hidden="true"
  />
));
Skeleton.displayName = 'Skeleton';

// --- MatchRow Skeleton (mimics real MatchRow layout) ---
export const MatchRowSkeleton = memo(({ index = 0 }: { index?: number }) => (
  <div
    className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.04]"
    style={{ animationDelay: `${index * 80}ms` }}
  >
    {/* Status chip */}
    <Skeleton width={42} height={18} rounded="full" />

    {/* Teams column */}
    <div className="flex-1 flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <Skeleton width={20} height={20} rounded="full" />
        <Skeleton width={100 + (index % 3) * 20} height={13} rounded="sm" />
        <div className="ml-auto">
          <Skeleton width={24} height={16} rounded="sm" />
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <Skeleton width={20} height={20} rounded="full" />
        <Skeleton width={80 + (index % 2) * 30} height={13} rounded="sm" />
        <div className="ml-auto">
          <Skeleton width={24} height={16} rounded="sm" />
        </div>
      </div>
    </div>

    {/* Odds column */}
    <div className="hidden sm:flex gap-2">
      <Skeleton width={52} height={28} rounded="lg" />
      <Skeleton width={52} height={28} rounded="lg" />
      <Skeleton width={52} height={28} rounded="lg" />
    </div>
  </div>
));
MatchRowSkeleton.displayName = 'MatchRowSkeleton';

// --- League Header Skeleton ---
export const LeagueHeaderSkeleton = memo(() => (
  <div className="flex items-center gap-3 px-4 pt-6 pb-2">
    <Skeleton width={20} height={20} rounded="full" />
    <Skeleton width={140} height={11} rounded="sm" />
    <div className="ml-auto">
      <Skeleton width={48} height={16} rounded="full" />
    </div>
  </div>
));
LeagueHeaderSkeleton.displayName = 'LeagueHeaderSkeleton';

// --- Full Feed Skeleton (2 league groups × 3 rows each) ---
export const FeedSkeleton = memo(() => (
  <div className="animate-in fade-in duration-300">
    {[0, 1].map(group => (
      <div key={group}>
        <LeagueHeaderSkeleton />
        {[0, 1, 2].map(i => (
          <MatchRowSkeleton key={`${group}-${i}`} index={group * 3 + i} />
        ))}
      </div>
    ))}
  </div>
));
FeedSkeleton.displayName = 'FeedSkeleton';

// --- Detail Page Skeleton ---
export const DetailSkeleton = memo(() => (
  <div className="p-4 space-y-6">
    {/* Header */}
    <div className="flex items-center justify-between">
      <Skeleton width={32} height={32} rounded="lg" />
      <Skeleton width={160} height={20} rounded="md" />
      <Skeleton width={32} height={32} rounded="lg" />
    </div>

    {/* Scoreboard */}
    <div className="flex items-center justify-center gap-8 py-8">
      <div className="flex flex-col items-center gap-3">
        <Skeleton width={56} height={56} rounded="full" />
        <Skeleton width={48} height={12} rounded="sm" />
      </div>
      <Skeleton width={80} height={40} rounded="lg" />
      <div className="flex flex-col items-center gap-3">
        <Skeleton width={56} height={56} rounded="full" />
        <Skeleton width={48} height={12} rounded="sm" />
      </div>
    </div>

    {/* Tabs */}
    <div className="flex gap-2">
      {[80, 60, 72, 56].map((w, i) => (
        <Skeleton key={i} width={w} height={32} rounded="lg" />
      ))}
    </div>

    {/* Content rows */}
    <div className="space-y-3">
      {[0, 1, 2, 3, 4].map(i => (
        <Skeleton key={i} width="100%" height={52} rounded="xl" />
      ))}
    </div>
  </div>
));
DetailSkeleton.displayName = 'DetailSkeleton';

export default Skeleton;
