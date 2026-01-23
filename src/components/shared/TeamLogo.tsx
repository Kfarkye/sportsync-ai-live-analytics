
import React, { useState, useEffect, memo } from 'react';
import { cn } from '../../lib/essence';

interface TeamLogoProps {
  logo?: string;
  name?: string;
  className?: string;
  abbreviation?: string;
  variant?: 'default' | 'card'; // 'card' implements the SofaScore-style header container
  isLive?: boolean;
}

// ---------------------------------------------------------------------------
// Optimization Utility
// ---------------------------------------------------------------------------
// Proxies images through a high-performance CDN to ensure:
// 1. Caching (Fixes slow loading from raw sources)
// 2. Formatting (Converts to WebP)
// 3. Resizing (Prevents downloading massive assets for small icons)
const getOptimizedLogoUrl = (url: string | undefined): string | null => {
  if (!url || url === '-' || url === 'undefined' || url.includes('placeholder')) {
    return null;
  }

  // Handle ESPN URLs specifically as they support native resizing
  if (url.includes('espncdn.com')) {
    // If it already has query params, just return it (assuming source knows best), 
    // otherwise append standard optimization params
    if (url.includes('?')) return url;
    return `${url}?w=128&h=128&scale=crop`;
  }

  // For other sources (TheSportsDB, etc), use a caching proxy
  // wsrv.nl is a robust, privacy-friendly image proxy
  try {
    const encoded = encodeURIComponent(url);
    return `https://wsrv.nl/?url=${encoded}&w=128&h=128&fit=contain&output=webp&q=80`;
  } catch (e) {
    return url;
  }
};

const TeamLogo: React.FC<TeamLogoProps> = ({
  logo,
  name = 'Team',
  className = "w-8 h-8",
  abbreviation,
  variant = 'default',
  isLive = false
}) => {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Compute optimized URL once
  const optimizedSrc = React.useMemo(() => getOptimizedLogoUrl(logo), [logo]);

  // Reset states if the source changes
  useEffect(() => {
    setError(false);
    setLoaded(false);
  }, [optimizedSrc]);

  // Create fallback text: Abbreviation (first 3 chars) or Name initials
  const fallback = abbreviation
    ? (abbreviation || '').slice(0, 3).toUpperCase()
    : (name || '').slice(0, 2).toUpperCase();

  const hasValidSource = !!optimizedSrc && !error;

  // --- Variant: Card (Match Header Style) ---
  if (variant === 'card') {
    return (
      <div
        className={cn(
          // Container Geometry
          "relative flex items-center justify-center shrink-0 select-none overflow-hidden",
          "bg-[#1A1A1A] rounded-2xl",
          // Depth & Polish
          "shadow-[0_4px_12px_rgba(0,0,0,0.3)]",
          "border-t border-white/[0.05]",
          // Optional Live State
          isLive && "animate-[pulse_3s_ease-in-out_infinite] ring-1 ring-rose-500/20",
          className
        )}
        aria-label={name}
        title={name}
      >
        {/* Subtle Gradient Overlay for Materiality */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />

        {hasValidSource ? (
          <img
            src={optimizedSrc || undefined}
            alt={name}
            className={cn(
              "w-[70%] h-[70%] object-contain transition-all duration-300 will-change-transform",
              "brightness-110 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] filter contrast-110",
              loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
            )}
            style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3)) drop-shadow(0 4px 12px rgba(0,0,0,0.2))' }}
            onError={() => setError(true)}
            onLoad={() => setLoaded(true)}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="text-white/30 font-black text-[0.4em] tracking-tighter">
            {fallback}
          </span>
        )}
      </div>
    );
  }

  // --- Variant: Default (Icon/List Style) ---
  if (!hasValidSource) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-white/10 rounded-full text-white/70 font-black tracking-tighter ring-1 ring-white/20 overflow-hidden select-none",
          className
        )}
        style={{ fontSize: '0.4em' }}
        aria-label={name}
        title={name}
      >
        {fallback}
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden shrink-0", className)}>
      {!loaded && (
        <div className="absolute inset-0 bg-white/5 animate-pulse rounded-full" />
      )}
      <img
        src={optimizedSrc || undefined}
        alt={name}
        className={cn(
          "w-full h-full object-contain transition-all duration-300",
          loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
        )}
        style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.2)) drop-shadow(0 4px 8px rgba(0,0,0,0.15))' }}
        onError={() => setError(true)}
        onLoad={() => setLoaded(true)}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
};

export default memo(TeamLogo);
