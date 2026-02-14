
import React, { memo } from "react";
import { cn, ESSENCE } from "@/lib/essence";

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
  isLoading?: boolean;
  variant?: 'default' | 'elevated' | 'flush';
  noPadding?: boolean;
}

/**
 * CardShell — Obsidian Weissach Container
 * Pulls entirely from ESSENCE tokens. No local color knowledge.
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
    default: cn(ESSENCE.card.base),
    elevated: cn(ESSENCE.card.bg, ESSENCE.card.border, ESSENCE.card.radius, "backdrop-blur-2xl shadow-2xl", ESSENCE.card.innerGlow),
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
      {/* Obsidian Specular Edge Light */}
      {variant !== 'flush' && (
        <div
          className="absolute top-0 left-0 right-0 h-px z-20"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(54,232,150,0.08) 30%, rgba(54,232,150,0.08) 70%, transparent)',
            opacity: 0.65,
          }}
        />
      )}

      {/* Noise texture */}
      <div className={cn("absolute inset-0 pointer-events-none overflow-hidden", ESSENCE.card.radius)}>
        <div
          className="absolute inset-0 opacity-[0.015] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`
          }}
        />
      </div>

      {/* Shimmer skeleton */}
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
