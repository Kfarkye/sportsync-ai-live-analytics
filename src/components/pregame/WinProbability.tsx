import React from 'react';
import { motion } from 'framer-motion';
import { Trophy, Zap } from 'lucide-react';
import { cn, ESSENCE } from '@/lib/essence';
import { CardHeader } from '../ui/SectionHeader';
import { StatusChip } from '../ui/StatusChip';

const MotionDiv = motion.div;

interface WinProbabilityProps {
    homeWinPct: number;
    awayWinPct: number;
    homeColor?: string;
    awayColor?: string;
}

/**
 * WinProbability - Pre-game Win Projection Widget
 * 
 * UNIFIED with ESSENCE v10 design tokens
 */
const WinProbability: React.FC<WinProbabilityProps> = ({
    homeWinPct,
    awayWinPct,
    homeColor = '#3B82F6',
    awayColor = '#EF4444'
}) => {
    const total = homeWinPct + awayWinPct;
    const normHome = (homeWinPct / total) * 100;
    const normAway = (awayWinPct / total) * 100;

    const isHomeFav = normHome > 50;
    const spread = Math.abs(normHome - normAway);
    const confidence = spread > 20 ? 'High' : spread > 10 ? 'Medium' : 'Low';

    return (
        <div className="relative group">
            {/* Subtle Ambient Glow */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-transparent via-white/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition duration-700 blur-sm" />

            <div className={cn(ESSENCE.card.base, "relative overflow-hidden shadow-2xl")}>
                {/* Background Tint based on winner */}
                <div
                    className="absolute inset-0 opacity-[0.03] transition-colors duration-1000 pointer-events-none"
                    style={{ background: `linear-gradient(90deg, ${awayColor} 0%, ${homeColor} 100%)` }}
                />

                {/* Header - Using unified CardHeader */}
                <div className="flex items-center justify-between mb-5 relative z-10">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-white/5 rounded-md border border-white/5">
                            <Zap size={14} className="text-zinc-400 fill-zinc-400/20" />
                        </div>
                        <div>
                            <span className={ESSENCE.tier.t2Label + " block"}>Win Projection</span>
                            <span className={ESSENCE.tier.t3Meta}>Model Confidence: <span className="text-zinc-400">{confidence}</span></span>
                        </div>
                    </div>

                    {spread > 5 && (
                        <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-elevated rounded-full border border-white/10 shadow-inner">
                            <span className={`w-1.5 h-1.5 rounded-full ${isHomeFav ? 'bg-emerald-500' : 'bg-rose-500'} animate-pulse`} />
                            <span className={ESSENCE.tier.t2Header}>
                                {isHomeFav ? 'Home' : 'Away'} Advantage
                            </span>
                        </div>
                    )}
                </div>

                {/* Comparison Bar */}
                <div className="relative h-16 w-full flex rounded-xl overflow-hidden ring-1 ring-white/10 bg-surface-elevated shadow-inner">

                    {/* Away Segment */}
                    <MotionDiv
                        initial={{ width: "50%" }}
                        animate={{ width: `${normAway}%` }}
                        transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
                        className="relative h-full flex flex-col justify-center pl-5"
                        style={{ backgroundColor: awayColor }}
                    >
                        <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />
                        <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-black/30 to-transparent" />

                        <div className="relative z-10 flex flex-col items-start">
                            <span className={ESSENCE.tier.t2Header + " text-white/70 mb-0.5 mix-blend-overlay"}>Away</span>
                            <span className={ESSENCE.tier.t1Score + " text-3xl drop-shadow-md"}>
                                {awayWinPct.toFixed(0)}<span className="text-sm align-top opacity-80 font-bold">%</span>
                            </span>
                        </div>
                    </MotionDiv>

                    {/* The "Sharp Edge" Splitter */}
                    <div
                        className="absolute top-[-10%] bottom-[-10%] w-3 bg-surface-base z-20 skew-x-[-18deg] border-x-2 border-[#09090B] shadow-[0_0_20px_rgba(0,0,0,0.5)] scale-y-110 origin-center"
                        style={{
                            left: `calc(${normAway}% - 6px)`,
                            transition: 'left 1.4s cubic-bezier(0.22, 1, 0.36, 1)'
                        }}
                    >
                        <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-white/10" />
                    </div>

                    {/* Home Segment */}
                    <div className="flex-1 relative h-full flex flex-col justify-center items-end pr-5"
                        style={{ backgroundColor: homeColor }}
                    >
                        <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />
                        <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-black/30 to-transparent" />

                        <div className="relative z-10 flex flex-col items-end">
                            <span className={ESSENCE.tier.t2Header + " text-white/70 mb-0.5 mix-blend-overlay"}>Home</span>
                            <span className={ESSENCE.tier.t1Score + " text-3xl drop-shadow-md"}>
                                {homeWinPct.toFixed(0)}<span className="text-sm align-top opacity-80 font-bold">%</span>
                            </span>
                        </div>
                    </div>
                </div>

                {/* Footer / Context */}
                <div className="mt-4 flex justify-between items-center px-1">
                    <div className={`flex items-center gap-1.5 transition-opacity duration-500 ${!isHomeFav ? 'opacity-100' : 'opacity-30'}`}>
                        <Trophy size={12} className={!isHomeFav ? "text-amber-400 fill-amber-400/20" : "text-zinc-600"} />
                        <span className={ESSENCE.tier.t3Meta + (!isHomeFav ? " text-zinc-300" : "")}>Projected Winner</span>
                    </div>

                    <div className={`flex items-center gap-1.5 transition-opacity duration-500 ${isHomeFav ? 'opacity-100' : 'opacity-30'}`}>
                        <span className={ESSENCE.tier.t3Meta + (isHomeFav ? " text-zinc-300" : "")}>Projected Winner</span>
                        <Trophy size={12} className={isHomeFav ? "text-amber-400 fill-amber-400/20" : "text-zinc-600"} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WinProbability;