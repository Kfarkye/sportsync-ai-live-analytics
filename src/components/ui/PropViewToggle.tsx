
import React from 'react';
import { cn, ESSENCE } from '../../lib/essence';
import { motion } from 'framer-motion';

interface PropViewToggleProps {
    view: 'classic' | 'cinematic';
    onChange: (view: 'classic' | 'cinematic') => void;
    className?: string;
}

const MotionDiv = motion.div;

export const PropViewToggle: React.FC<PropViewToggleProps> = ({ view, onChange, className }) => {
    return (
        <div className={cn(
            "inline-flex p-1 bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/[0.05] relative overflow-hidden ring-1 ring-white/[0.05]",
            className
        )}>
            {/* Sliding Background */}
            <MotionDiv
                layout
                initial={false}
                animate={{
                    x: view === 'cinematic' ? 0 : '100%'
                }}
                transition={ESSENCE.transition.spring}
                className="absolute inset-y-1 left-1 w-[calc(50%-4px)] bg-white shadow-[0_2px_10px_rgba(0,0,0,0.3)] rounded-[10px] z-0"
            />

            <button
                onClick={() => onChange('cinematic')}
                className={cn(
                    "relative z-10 px-5 py-2 rounded-[10px] text-[10px] font-black uppercase tracking-[0.15em] transition-colors duration-300 active:scale-95 tap-feedback",
                    view === 'cinematic' ? "text-zinc-950" : "text-zinc-500 hover:text-zinc-300"
                )}
            >
                Cards
            </button>
            <button
                onClick={() => onChange('classic')}
                className={cn(
                    "relative z-10 px-5 py-2 rounded-[10px] text-[10px] font-black uppercase tracking-[0.15em] transition-colors duration-300 active:scale-95 tap-feedback",
                    view === 'classic' ? "text-zinc-950" : "text-zinc-500 hover:text-zinc-300"
                )}
            >
                List
            </button>
        </div>
    );
};
