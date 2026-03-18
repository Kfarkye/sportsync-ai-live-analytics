import React, { useState, useEffect, memo } from 'react';
import { cn } from '@/lib/essence';
import { getTeamColor } from '@/lib/teamColors';

interface TeamLogoProps {
  logo?: string;
  name?: string;
  className?: string;
  abbreviation?: string;
  variant?: 'default' | 'card';
  isLive?: boolean;
  teamColor?: string;
}

// ---------------------------------------------------------------------------
// Optimization Utility — keep team logos on primary CDN path for stable fetches.
// ---------------------------------------------------------------------------
const getOptimizedLogoUrl = (url: string | undefined): string | null => {
  if (!url || url === '-' || url === 'undefined' || url.includes('placeholder')) {
    return null;
  }

  if (url.includes('espncdn.com')) {
    if (url.includes('?')) return url;
    return `${url}?w=128&h=128&scale=crop`;
  }

  return url;
};

const colorFromName = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 65% 40%)`;
};

const hexToRgb = (hex: string): [number, number, number] | null => {
  const cleaned = hex.trim().replace('#', '');
  if (!/^[\da-fA-F]{3}$|^[\da-fA-F]{6}$/.test(cleaned)) return null;
  const full = cleaned.length === 3 ? cleaned.split('').map((c) => c + c).join('') : cleaned;
  const int = Number.parseInt(full, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};

const textColorForBackground = (color: string): string => {
  const rgb = color.startsWith('#') ? hexToRgb(color) : null;
  if (!rgb) return '#FFFFFF';
  const [r, g, b] = rgb.map((v) => v / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.62 ? '#0A0A0A' : '#FFFFFF';
};

const TeamLogo: React.FC<TeamLogoProps> = ({
  logo,
  name = 'Team',
  className = "w-8 h-8",
  abbreviation,
  variant = 'default',
  isLive = false,
  teamColor,
}) => {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const optimizedSrc = React.useMemo(() => getOptimizedLogoUrl(logo), [logo]);
  const fallbackColor = React.useMemo(
    () => teamColor || getTeamColor(name) || colorFromName(name),
    [name, teamColor]
  );
  const fallbackTextColor = React.useMemo(
    () => textColorForBackground(fallbackColor),
    [fallbackColor]
  );

  // Reset state only when the actual URL changes.
  useEffect(() => {
    setError(false);
    setLoaded(false);
  }, [optimizedSrc]);

  const handleError = () => {
    setError(true);
    setLoaded(false);
  };

  const fallback = abbreviation
    ? (abbreviation || '').slice(0, 3).toUpperCase()
    : (name || '').slice(0, 2).toUpperCase();

  const hasValidSource = !!optimizedSrc && !error;

  // --- Variant: Card (Match Header Style) — Clean on white, NO GLOWS ---
  if (variant === 'card') {
    return (
      <div
        className={cn(
          "relative flex items-center justify-center shrink-0 select-none overflow-hidden",
          "bg-slate-50 rounded-2xl border border-slate-200",
          isLive && "ring-1 ring-rose-300",
          className
        )}
        aria-label={name}
        title={name}
      >
        {hasValidSource ? (
          <>
            {!loaded ? (
              <div
                className="absolute h-[70%] w-[70%] rounded-full animate-pulse"
                style={{ backgroundColor: fallbackColor, opacity: 0.22 }}
              />
            ) : null}
            <img
              src={optimizedSrc || undefined}
              alt={name}
              className={cn(
                "w-[70%] h-[70%] object-contain transition-all duration-300 will-change-transform",
                loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
              )}
              onError={handleError}
              onLoad={() => setLoaded(true)}
              loading="eager"
              decoding="sync"
            />
          </>
        ) : (
          <div
            className="h-[70%] w-[70%] rounded-full flex items-center justify-center font-black text-[0.38em] tracking-tighter"
            style={{ backgroundColor: fallbackColor, color: fallbackTextColor }}
          >
            {fallback}
          </div>
        )}
      </div>
    );
  }

  // --- Variant: Default (Icon/List Style) — Clean PNG, no drop-shadows ---
  if (!hasValidSource) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full font-black tracking-tighter border border-black/10 overflow-hidden select-none",
          className
        )}
        style={{ fontSize: '0.4em', backgroundColor: fallbackColor, color: fallbackTextColor }}
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
        <div className="absolute inset-0 animate-pulse rounded-full" style={{ backgroundColor: fallbackColor, opacity: 0.22 }} />
      )}
      <img
        src={optimizedSrc || undefined}
        alt={name}
        className={cn(
          "w-full h-full object-contain transition-all duration-300",
          loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
        )}
        onError={handleError}
        onLoad={() => setLoaded(true)}
        loading="eager"
        decoding="sync"
      />
    </div>
  );
};

export default memo(TeamLogo);
