import React from "react";
import { cn, ESSENCE } from "@/lib/essence";
import { motion } from "framer-motion";

const MotionDiv = motion.div;

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    children?: React.ReactNode;
    variant?: "default" | "glass" | "solid";
    hover?: boolean;
    edgeLight?: boolean;
    livePulse?: boolean;
    className?: string;
}

/**
 * Card — Obsidian Weissach Surface
 * All styling flows from ESSENCE tokens. No local color knowledge.
 */
export const Card = ({ children, className, variant = "default", hover = false, edgeLight = true, livePulse = false, ...rest }: CardProps) => {
    const baseStyles = cn("relative overflow-hidden transition-all duration-300", ESSENCE.card.radius);

    const variants = {
        default: ESSENCE.card.base,
        glass: cn(ESSENCE.card.bg, "backdrop-blur-xl saturate-150", ESSENCE.card.border),
        solid: cn("bg-[" + ESSENCE.colors.surface.elevated + "]", ESSENCE.card.border),
    };

    const hoverStyles = hover ? "hover:border-white/[0.08] hover:-translate-y-0.5" : "";

    return (
        <MotionDiv
            className={cn(baseStyles, variants[variant], hoverStyles, className)}
            {...rest}
        >
            {/* Obsidian Specular Edge Light */}
            {edgeLight && (
                <div
                    className={cn(
                        "absolute top-0 left-0 right-0 h-px z-20",
                        livePulse && "animate-[breathe_3.5s_ease-in-out_infinite]"
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
            <div className="relative z-10 h-full">
                {children}
            </div>
        </MotionDiv>
    );
};

export default Card;
