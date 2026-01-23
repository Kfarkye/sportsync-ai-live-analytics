
import React, { memo } from "react";
import { cn, ESSENCE } from "../../lib/essence";

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
  isLoading?: boolean;
  variant?: 'default' | 'elevated' | 'flush';
  /** Override padding. Default: p-5 */
  noPadding?: boolean;
}

/**
 * CardShell - Premium Glassmorphic Container
 * 
 * STATE OF THE ART (Linear/Cron Tier):
 * - Translucent backgrounds with backdrop blur
 * - Gradient light borders (white fade to transparent)
 * - Subtle inner glow for depth
 * - Noise texture overlay for tactile feel
 */
export const CardShell = memo(({
  children,
  className,
  isLoading,
  variant = 'default',
  noPadding = false,
  ...rest
}: Props) => {
  const variants = {
    default: cn("bg-[rgba(14,14,16,0.75)] backdrop-blur-xl border border-white/[0.06] rounded-3xl", ESSENCE.card.innerGlow),
    elevated: cn("bg-[rgba(18,18,22,0.85)] backdrop-blur-2xl border border-white/[0.08] rounded-3xl shadow-2xl", ESSENCE.card.innerGlow),
    flush: "bg-transparent border-0 rounded-none"
  };

  return (
    <div
      {...rest}
      className={cn(
        "relative overflow-hidden",
        variants[variant],
        !noPadding && variant !== 'flush' && ESSENCE.card.padding,
        "transition-all duration-300",
        className
      )}
    >
      {/* GLASSMORPHISM overlay (Noise texture) */}
      <div className="absolute inset-0 rounded-3xl pointer-events-none overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.015] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`
          }}
        />
      </div>

      {/* SHIMMER SKELETON (When Loading) */}
      {isLoading && (
        <div className="absolute inset-0 z-20 overflow-hidden">
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent animate-shimmer"
            style={{ backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }}
          />
        </div>
      )}

      <div className={cn("relative z-10 h-full", isLoading && "opacity-0")}>
        {children}
      </div>
    </div>
  );
});

CardShell.displayName = 'CardShell';

export default CardShell;
