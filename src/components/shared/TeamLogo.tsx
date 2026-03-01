
import React, { useState, useEffect, useRef, memo } from 'react';
import { cn } from '@/lib/essence';

interface TeamLogoProps {
  logo?: string;
  name?: string;
  className?: string;
  abbreviation?: string;
  variant?: 'default' | 'card';
  isLive?: boolean;
}

// ---------------------------------------------------------------------------
// Optimization Utility — CDN proxy for caching, WebP, and resizing
// ---------------------------------------------------------------------------
const getOptimizedLogoUrl = (url: string | undefined): string | null => {
  if (!url || url === '-' || url === 'undefined' || url.includes('placeholder')) {
    return null;
  }

  if (url.includes('espncdn.com')) {
    if (url.includes('?')) return url;
    return `${url}?w=128&h=128&scale=crop`;
  }

  try {
    const encoded = encodeURIComponent(url);
    return `https://wsrv.nl/?url=${encoded}&w=128&h=128&fit=contain&output=webp&q=80`;
  } catch (e) {
    return url;
  }
};

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1500, 4000]; // ms — backoff schedule

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
  const [retryCount, setRetryCount] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const optimizedSrc = React.useMemo(() => getOptimizedLogoUrl(logo), [logo]);

  // Reset state only when the actual URL changes
  useEffect(() => {
    setError(false);
    setLoaded(false);
    setRetryCount(0);
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [optimizedSrc]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const handleError = () => {
    if (retryCount < MAX_RETRIES) {
      // Schedule a retry with backoff
      const delay = RETRY_DELAYS[retryCount] || 4000;
      retryTimerRef.current = setTimeout(() => {
        setRetryCount(prev => prev + 1);
        setError(false); // Reset error to trigger re-render → img re-mount
      }, delay);
    }
    setError(true);
  };

  const fallback = abbreviation
    ? (abbreviation || '').slice(0, 3).toUpperCase()
    : (name || '').slice(0, 2).toUpperCase();

  // Append retry count as cache-buster so the browser doesn't serve a cached error
  const srcWithRetry = optimizedSrc && retryCount > 0
    ? `${optimizedSrc}${optimizedSrc.includes('?') ? '&' : '?'}_r=${retryCount}`
    : optimizedSrc;

  const hasValidSource = !!srcWithRetry && !error;

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
          <img
            src={srcWithRetry || undefined}
            alt={name}
            className={cn(
              "w-[70%] h-[70%] object-contain transition-all duration-300 will-change-transform",
              loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
            )}
            onError={handleError}
            onLoad={() => setLoaded(true)}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="text-slate-400 font-black text-[0.4em] tracking-tighter">
            {fallback}
          </span>
        )}
      </div>
    );
  }

  // --- Variant: Default (Icon/List Style) — Clean PNG, no drop-shadows ---
  if (!hasValidSource) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-slate-100 rounded-full text-slate-500 font-black tracking-tighter border border-slate-200 overflow-hidden select-none",
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
        <div className="absolute inset-0 bg-slate-100 animate-pulse rounded-full" />
      )}
      <img
        src={srcWithRetry || undefined}
        alt={name}
        className={cn(
          "w-full h-full object-contain transition-all duration-300",
          loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
        )}
        onError={handleError}
        onLoad={() => setLoaded(true)}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
};

export default memo(TeamLogo);
