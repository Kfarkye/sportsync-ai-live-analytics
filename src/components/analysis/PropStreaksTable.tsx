
import React, { useEffect, useState } from 'react';
import { dbService } from '../../services/dbService';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, Flame, ChevronRight, Target } from 'lucide-react';
import { cn } from '../../lib/essence';

interface PropStreak {
    id: string;
    player_name: string;
    team: string;
    prop_type: string;
    streak_type: 'OVER' | 'UNDER';
    streak_count: number;
    threshold: number;
    avg_value: number;
    last_game_date: string;
}

export const PropStreaksTable = ({ teamName }: { teamName?: string }) => {
    const [streaks, setStreaks] = useState<PropStreak[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadStreaks = async () => {
            setIsLoading(true);
            try {
                const data = await dbService.getPlayerPropStreaks(teamName);
                setStreaks(data);
            } catch (e) {
                console.error("Failed to load streaks", e);
            } finally {
                setIsLoading(false);
            }
        };
        loadStreaks();
    }, [teamName]);

    if (isLoading) return (
        <div className="py-12 flex justify-center">
            <div className="w-5 h-5 border-2 border-white/10 border-t-white/60 rounded-full animate-spin" />
        </div>
    );

    if (streaks.length === 0) return null;

    return (
        <div>
            {/* Section Header */}
            <div className="flex items-center justify-between py-3 border-b border-white/[0.04]">
                <div className="flex items-center gap-2">
                    <Flame className="w-3.5 h-3.5 text-orange-500 fill-orange-500" />
                    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-[0.1em]">Hot Streaks</span>
                </div>
                <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wide">
                    Last 10 Games
                </span>
            </div>

            {/* Streak Rows */}
            <div>
                <AnimatePresence>
                    {streaks.map((streak, idx) => (
                        <motion.div
                            key={streak.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.03 }}
                            className="flex items-center justify-between py-3 border-b border-white/[0.04] hover:bg-white/[0.01] transition-colors duration-150"
                        >
                            {/* Left: Player Info */}
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-white/[0.025] flex items-center justify-center">
                                    <TrendingUp className="w-3.5 h-3.5 text-orange-500/70" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[13px] font-semibold text-white tracking-tight">
                                            {streak.player_name}
                                        </span>
                                        <span className="px-1.5 py-0.5 rounded-md bg-orange-500/10 border border-orange-500/20 text-[9px] font-semibold text-orange-400 uppercase">
                                            {streak.streak_count}G
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-medium mt-0.5">
                                        <span>{streak.team}</span>
                                        <span className="text-zinc-700">·</span>
                                        <span className="uppercase">{streak.prop_type.replace('_', ' ')}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Right: Values */}
                            <div className="text-right">
                                <div className="text-[14px] font-semibold text-white tabular-nums tracking-tight">
                                    {streak.streak_type} {streak.threshold}
                                </div>
                                <div className="text-[10px] font-medium text-zinc-600 mt-0.5">
                                    Avg: {streak.avg_value.toFixed(1)}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
};
