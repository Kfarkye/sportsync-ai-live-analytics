import React, { memo } from "react";
import { cn, ESSENCE } from "@/lib/essence";
import { motion } from "framer-motion";

const MotionDiv = motion.div;

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    children?: React.ReactNode;
    variant?: "default" | "glass" | "solid" | "elevated" | "flush";
    hover?: boolean;
    edgeLight?: boolean;
    livePulse?: boolean;
    isLoading?: boolean;
    noPadding?: boolean;
    className?: string;
}

/**
 * Card — Obsidian Weissach Surface (Unified)
 * Consolidated from Card + CardShell. All styling flows from ESSENCE tokens.
 */
export const Card = memo(({
    children,
    className,
    variant = "default",
    hover = false,
    edgeLight = true,
    livePulse = false,
    isLoading = false,
    noPadding = false,
    ...rest
}: CardProps) => {
    const baseStyles = cn("relative overflow-hidden transition-all duration-300", ESSENCE.card.radius);

    const variants = {
        default: ESSENCE.card.base,
        glass: cn(ESSENCE.card.bg, "backdrop-blur-xl saturate-150", ESSENCE.card.border),
        solid: cn("bg-[" + ESSENCE.colors.surface.elevated + "]", ESSENCE.card.border),
        elevated: cn(ESSENCE.card.bg, ESSENCE.card.border, ESSENCE.card.radius, "backdrop-blur-2xl shadow-2xl", ESSENCE.card.innerGlow),
        flush: "bg-transparent border-0 rounded-none",
    };

    const hoverStyles = hover ? "hover:border-white/[0.08] hover:-translate-y-0.5" : "";
    const showEdge = edgeLight && variant !== 'flush';

    return (
        <MotionDiv
            className={cn(
                baseStyles,
                variants[variant],
                hoverStyles,
                !noPadding && variant !== 'flush' && ESSENCE.card.padding,
                className
            )}
            {...rest}
        >
            {/* Obsidian Specular Edge Light */}
            {showEdge && (
                <div
                    className={cn(
                        "absolute top-0 left-0 right-0 h-px z-20",
                        livePulse && "motion-safe:animate-[breathe_3.5s_ease-in-out_infinite]"
                    )}
                    style={{
                        background: `linear-gradient(90deg, transparent, ${ESSENCE.colors.accent.mintEdge} 30%, ${ESSENCE.colors.accent.mintEdge} 70%, transparent)`,
                        opacity: livePulse ? undefined : 0.65,
                    }}
                />
            )}

            {/* Noise Texture */}
            <div
                className={cn("absolute inset-0 opacity-[0.02] pointer-events-none mix-blend-overlay select-none", ESSENCE.card.radius)}
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
            />

            {/* Shimmer skeleton */}
            {isLoading && (
                <div className="absolute inset-0 z-20 overflow-hidden">
                    <div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
                        style={{ backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }}
                    />
                </div>
            )}

            <div className={cn("relative z-10 h-full", isLoading && "opacity-0")}>
                {children}
            </div>
        </MotionDiv>
    );
});

Card.displayName = 'Card';

export default Card;
