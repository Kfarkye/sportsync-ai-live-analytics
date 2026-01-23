
import React from "react";
import { cn } from "../../lib/essence";
import { motion } from "framer-motion";

const MotionDiv = motion.div as any;

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  variant?: "default" | "glass" | "solid";
  hover?: boolean;
}

export const Card = ({ children, className, variant = "default", hover = false, ...rest }: CardProps) => {
  const baseStyles = "relative overflow-hidden rounded-2xl transition-all duration-300";
  
  const variants = {
    default: "bg-[#09090B] border border-white/[0.08] shadow-2xl",
    glass: "bg-[#09090B]/60 backdrop-blur-xl saturate-150 border border-white/[0.06]",
    solid: "bg-[#121212] border border-white/5",
  };

  const hoverStyles = hover ? "hover:border-white/[0.12] hover:shadow-[0_0_50px_rgba(0,0,0,0.5)] hover:-translate-y-0.5" : "";

  return (
    <MotionDiv
      className={cn(baseStyles, variants[variant], hoverStyles, className)}
      {...rest}
    >
      {/* Noise Texture for Depth */}
      <div 
        className="absolute inset-0 opacity-[0.02] pointer-events-none mix-blend-overlay select-none" 
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} 
      />
      <div className="relative z-10 h-full">
        {children}
      </div>
    </MotionDiv>
  );
};
