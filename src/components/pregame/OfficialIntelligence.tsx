// ===================================================================
// OfficialIntelligence.tsx
// ARCHITECTURE: "SOTA Production" • Apple/Google Quality Standards
// AESTHETIC: Porsche Luxury • Jony Ive Minimalism • Jobs Narrative
// ===================================================================

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/essence';
import type { RefIntelContent } from '@/types';

interface Official {
    name: string;
    position: string;
}

interface OfficialIntelligenceProps {
    officials: Official[];
    intel?: RefIntelContent | null;
}

// ─────────────────────────────────────────────────────────────────
// 🎨 DESIGN TOKENS & PHYSICS
// ─────────────────────────────────────────────────────────────────

const PHYSICS_SWITCH = { type: "spring", stiffness: 380, damping: 35, mass: 0.8 };

// ─────────────────────────────────────────────────────────────────
// 💎 MICRO-COMPONENTS
// ─────────────────────────────────────────────────────────────────

const SpecRow = ({
    label,
    children,
    isLast = false
}: {
    label: string;
    children: React.ReactNode;
    isLast?: boolean;
}) => (
    <div className={cn(
        "group relative flex flex-col md:flex-row md:items-baseline gap-2 md:gap-0 py-5 transition-colors duration-500 hover:bg-overlay-subtle",
        !isLast && "border-b border-white/[0.08]"
    )}>
        {/* Active Laser Line (Left Edge - Hover State) */}
        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-white scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-center opacity-0 group-hover:opacity-100 shadow-[0_0_10px_rgba(255,255,255,0.5)]" />

        {/* 1. Technical Label */}
        <div className="w-full md:w-[140px] shrink-0 select-none pl-3 md:pl-0">
            <span className="text-label font-bold tracking-[0.25em] uppercase text-zinc-600 group-hover:text-zinc-400 transition-colors duration-300 font-mono">
                {label}
            </span>
        </div>

        {/* 2. Content */}
        <div className="flex-1 pl-3 md:pl-0">
            {children}
        </div>
    </div>
);

// ─────────────────────────────────────────────────────────────────
// 🏛️ MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

const OfficialIntelligence: React.FC<OfficialIntelligenceProps> = ({ officials, intel }) => {
    // 1. Data Guard
    if ((!officials || officials.length === 0) && !intel) return null;

    // 2. Data Resolution Strategy 
    // (Priority: Intel Override > Officials Array > Intel String)
    const chief = intel?.crewChief || ((officials && officials.length > 0) ? officials[0].name : intel?.crewName?.split(',')[0]?.trim());

    const rawCrew = (officials && officials.length > 0)
        ? officials.map(o => o.name)
        : (intel?.crewName ? intel.crewName.split(',').map(n => n.trim()) : []);

    // Filter chief out of crew list to avoid duplication
    const crewMembers = rawCrew.filter(c => c !== chief);

    return (
        <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={PHYSICS_SWITCH}
            className="w-full"
        >
            {/* 01 // HEAD OFFICIAL */}
            {chief && (
                <SpecRow label="01 // CREW CHIEF" isLast={crewMembers.length === 0}>
                    <div className="flex items-center gap-3">
                        <h4 className="text-body-lg md:text-[16px] font-medium text-white tracking-tight">
                            {chief}
                        </h4>
                        {/* Status Dot (Pure CSS) */}
                        <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-20"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500/80"></span>
                        </span>
                    </div>
                </SpecRow>
            )}

            {/* 02 // CREW ROSTER */}
            {crewMembers.length > 0 && (
                <SpecRow label="02 // ROSTER" isLast={true}>
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                        {crewMembers.map((name, idx) => (
                            <div key={idx} className="flex items-center gap-2 group/item select-none">
                                {/* Decorator Dot */}
                                <span className="w-1 h-1 rounded-full bg-zinc-700 group-hover/item:bg-zinc-500 transition-colors duration-300" />
                                <span className="text-body-sm font-light text-zinc-400 group-hover/item:text-zinc-200 transition-colors duration-300 tracking-wide">
                                    {name}
                                </span>
                            </div>
                        ))}
                    </div>
                </SpecRow>
            )}
        </motion.div>
    );
};

export default OfficialIntelligence;
