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
 * Card — Editorial Light Surface
 * Clean white card with crisp slate-200 border. No shadows, no glows.
 */
export const Card = memo(({
    children,
    className,
    variant = "default",
    hover = false,
    edgeLight = false,
    livePulse = false,
    isLoading = false,
    noPadding = false,
    ...rest
}: CardProps) => {
    const baseStyles = cn("relative overflow-hidden transition-all duration-300", ESSENCE.card.radius);

    const variants = {
        default: ESSENCE.card.base,
        glass: cn("bg-white/90 backdrop-blur-xl", "border border-slate-200"),
        solid: cn("bg-white", "border border-slate-200"),
        elevated: cn("bg-white", "border border-slate-200", ESSENCE.card.radius, "shadow-sm"),
        flush: "bg-transparent border-0 rounded-none",
    };

    const hoverStyles = hover ? "hover:border-slate-300 hover:-translate-y-0.5" : "";

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
            {/* Live pulse indicator — subtle top border color */}
            {livePulse && (
                <div className="absolute top-0 left-0 right-0 h-px z-20 bg-emerald-400 motion-safe:animate-pulse" />
            )}

            {/* Shimmer skeleton */}
            {isLoading && (
                <div className="absolute inset-0 z-20 overflow-hidden">
                    <div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-slate-100 to-transparent"
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
