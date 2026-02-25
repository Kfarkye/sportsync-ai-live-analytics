
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/essence';

interface StatItem {
    label: string;
    value: string;
}

interface TeamData {
    id: string;
    name: string;
    shortName: string;
    logo: string;
    color: string;
    stats: StatItem[];
}

interface SofaStatsProps {
    homeTeam: TeamData;
    awayTeam: TeamData;
}

const getStatGroup = (label: string): string => {
    const l = label.toLowerCase();
    if (l.includes('goal') || l.includes('shot') || l.includes('pass') || l.includes('assist') || l.includes('points') || l.includes('yard') || l.includes('completion')) return 'Offensive Detail';
    if (l.includes('tackle') || l.includes('interception') || l.includes('foul') || l.includes('save') || l.includes('rebound') || l.includes('block') || l.includes('steal')) return 'Defensive Detail';
    if (l.includes('kick') || l.includes('punt') || l.includes('return')) return 'Specialist Output';
    return 'Core Performance';
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

const isLowerBetter = (label: string): boolean => {
    const l = label.toLowerCase();
    return l.includes('turnover') || l.includes('foul') || l.includes('penalty') || l.includes('error') || l.includes('giveaway') || l.includes('lost');
};

const parseStatValue = (val: string): number => {
    if (!val || val === '-') return 0;
    const clean = val.replace(/[^0-9.-]/g, '');
    const num = parseFloat(clean);

    // Handle Streak (W4 -> 4)
    if (val.toUpperCase().startsWith('W') || val.toUpperCase().startsWith('L')) {
        return Math.abs(parseFloat(val.substring(1))) || 0;
    }
    // Handle Records (8-2 -> 8)
    if (val.includes('-')) {
        return parseFloat(val.split('-')[0]) || 0;
    }
    return isNaN(num) ? 0 : num;
};

const SofaStats: React.FC<SofaStatsProps> = ({ homeTeam, awayTeam }) => {
    const statsList = useMemo(() => {
        const statsMap = new Map<string, { home: string, away: string }>();
        const hStats = homeTeam.stats || [];
        const aStats = awayTeam.stats || [];

        hStats.forEach(s => {
            if (!s || !s.label) return;
            statsMap.set(s.label, { home: String(s.value || '0'), away: '' });
        });

        aStats.forEach(s => {
            if (!s || !s.label) return;
            const existing = statsMap.get(s.label);
            const val = String(s.value || '0');
            if (existing) {
                statsMap.set(s.label, { ...existing, away: val });
            } else {
                statsMap.set(s.label, { home: '', away: val });
            }
        });

        return Array.from(statsMap.entries())
            .filter(([_, values]) => values.home !== '' && values.away !== '')
            .map(([label, values]) => ({ label, ...values }));
    }, [homeTeam.stats, awayTeam.stats]);

    // Normalize colors
    const homeColor = homeTeam.color?.startsWith('#') ? homeTeam.color : `#${homeTeam.color || '6366f1'}`;
    const awayColor = awayTeam.color?.startsWith('#') ? awayTeam.color : `#${awayTeam.color || '6366f1'}`;

    return (
        <div className="w-full">
            <div className="space-y-1">
                {statsList.map((stat, idx) => {
                    const hStr = stat.home;
                    const aStr = stat.away;
                    const label = stat.label;

                    const homeVal = parseStatValue(hStr);
                    const awayVal = parseStatValue(aStr);
                    const lowerBetter = isLowerBetter(label);

                    // Winner Logic
                    const homeIsAlpha = lowerBetter ? (homeVal < awayVal) : (homeVal > awayVal);
                    const awayIsAlpha = lowerBetter ? (awayVal < homeVal) : (awayVal > homeVal);
                    const isEqual = homeVal === awayVal;

                    // Bar Scaling (Relative to each other to fill space)
                    // Use a minimum floor for values to prevent 0% bars
                    const sum = (homeVal || 0.1) + (awayVal || 0.1);

                    // NEW: Invert scaling for lower-is-better stats so the "better" side is always visually dominant
                    let homePct = ((homeVal || 0.1) / sum) * 100;
                    let awayPct = ((awayVal || 0.1) / sum) * 100;

                    if (lowerBetter) {
                        // Swap percentages so the lower value gets the longer bar
                        const temp = homePct;
                        homePct = awayPct;
                        awayPct = temp;
                    }

                    return (
                        <div key={idx} className="group relative py-3 sm:py-4 flex flex-col gap-2.5 px-1 hover:bg-slate-50 transition-colors rounded-xl">
                            {/* Stat Info */}
                            <div className="flex justify-between items-center relative z-10 h-5">
                                {/* Away Value */}
                                <div className="flex items-center gap-2 min-w-[60px]">
                                    {awayIsAlpha && (
                                        <div className="relative flex items-center justify-center">
                                            <div className="absolute w-3 h-3 rounded-full animate-ping opacity-20" style={{ backgroundColor: awayColor }} />
                                            <div className="w-1.5 h-1.5 rounded-full relative z-10" style={{ backgroundColor: awayColor }} />
                                        </div>
                                    )}
                                    <span
                                        className={cn(
                                            "text-[14px] sm:text-[15px] font-bold tabular-nums transition-colors duration-300",
                                            awayIsAlpha ? "text-slate-900" : "text-slate-500"
                                        )}
                                    >
                                        {stat.away}
                                    </span>
                                </div>

                                {/* Label */}
                                <div className="flex-1 flex justify-center px-4">
                                    <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 group-hover:text-slate-600 transition-colors text-center truncate">
                                        {stat.label}
                                    </span>
                                </div>

                                {/* Home Value */}
                                <div className="flex items-center justify-end gap-2 min-w-[60px]">
                                    <span
                                        className={cn(
                                            "text-[14px] sm:text-[15px] font-bold tabular-nums transition-colors duration-300 text-right",
                                            homeIsAlpha ? "text-slate-900" : "text-slate-500"
                                        )}
                                    >
                                        {stat.home}
                                    </span>
                                    {homeIsAlpha && (
                                        <div className="relative flex items-center justify-center">
                                            <div className="absolute w-3 h-3 rounded-full animate-ping opacity-20" style={{ backgroundColor: homeColor }} />
                                            <div className="w-1.5 h-1.5 rounded-full relative z-10" style={{ backgroundColor: homeColor }} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Advanced Comparison Bar */}
                            <div className="relative h-[4px] w-full bg-slate-50 rounded-full overflow-hidden">
                                <div className="absolute inset-0 flex">
                                    {/* Away Side (Left) */}
                                    <div className="relative flex-1 h-full flex justify-end">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            whileInView={{ width: `${awayPct}%` }}
                                            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                                            className="h-full rounded-l-full relative"
                                            style={{
                                                backgroundColor: awayIsAlpha ? awayColor : (isEqual ? '#4b5563' : 'rgba(255,255,255,0.06)'),
                                            }}
                                        >
                                            {awayIsAlpha && <div className="absolute inset-0 bg-white/10 mix-blend-overlay" />}
                                        </motion.div>
                                    </div>

                                    {/* Midpoint Notch */}
                                    <div className="w-0.5 bg-black/20 shrink-0 z-10" />

                                    {/* Home Side (Right) */}
                                    <div className="relative flex-1 h-full flex justify-start">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            whileInView={{ width: `${homePct}%` }}
                                            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                                            className="h-full rounded-r-full relative"
                                            style={{
                                                backgroundColor: homeIsAlpha ? homeColor : (isEqual ? '#4b5563' : 'rgba(255,255,255,0.06)'),
                                            }}
                                        >
                                            {homeIsAlpha && <div className="absolute inset-0 bg-white/10 mix-blend-overlay" />}
                                        </motion.div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SofaStats;
