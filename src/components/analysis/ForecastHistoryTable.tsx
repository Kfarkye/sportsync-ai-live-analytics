import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { cn } from '@/lib/essence';
import { TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

interface ForecastSnapshot {
    id: string;
    period: number;
    clock: string;
    home_score: number;
    away_score: number;
    market_total: number;
    fair_total: number;
    edge_points: number;
    edge_state: 'PLAY' | 'LEAN' | 'NEUTRAL';
    regime: string;
    created_at: string;
}

interface ForecastHistoryTableProps {
    matchId: string;
}

export const ForecastHistoryTable: React.FC<ForecastHistoryTableProps> = ({ matchId }) => {
    const [snapshots, setSnapshots] = useState<ForecastSnapshot[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSnapshots = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('live_forecast_snapshots')
                .select('*')
                .eq('match_id', matchId)
                .order('created_at', { ascending: false })
                .limit(20);

            if (!error && data) {
                setSnapshots(data);
            }
            setLoading(false);
        };

        fetchSnapshots();

        // Real-time updates
        const channel = supabase
            .channel(`forecast_snapshots:${matchId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'live_forecast_snapshots',
                    filter: `match_id=eq.${matchId}`
                },
                (payload) => {
                    setSnapshots(prev => [payload.new as ForecastSnapshot, ...prev].slice(0, 20));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [matchId]);

    if (loading && snapshots.length === 0) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="w-6 h-6 border-2 border-zinc-800 border-t-zinc-500 rounded-full motion-safe:animate-spin" />
            </div>
        );
    }

    if (snapshots.length === 0) return (
        <EmptyState
            icon={<BarChart3 size={24} />}
            message="No forecast snapshots yet"
            description="Forecast data appears once the game goes live"
        />
    );

    return (
        <div className="w-full">
            <div className="flex items-center gap-2 mb-4">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Forecast History</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-slate-200">
                            <th className="py-3 px-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Time</th>
                            <th className="py-3 px-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Score</th>
                            <th className="py-3 px-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Fair</th>
                            <th className="py-3 px-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Market</th>
                            <th className="py-3 px-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Edge</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.02]">
                        <AnimatePresence mode="popLayout">
                            {snapshots.map((s) => (
                                <motion.tr
                                    key={s.id}
                                    initial={{ opacity: 0, x: -4 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className="group hover:bg-white/[0.015] transition-colors"
                                >
                                    <td className="py-3 px-2">
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-mono font-bold text-slate-600">{s.clock}</span>
                                            <span className="text-[9px] font-bold text-slate-500 uppercase">P{s.period}</span>
                                        </div>
                                    </td>
                                    <td className="py-3 px-2 text-center">
                                        <span className="text-[11px] font-mono font-bold text-slate-400">
                                            {s.away_score}-{s.home_score}
                                        </span>
                                    </td>
                                    <td className="py-3 px-2 text-center">
                                        <span className="text-[11px] font-mono font-bold text-slate-900 drop-shadow-sm">
                                            {s.fair_total.toFixed(1)}
                                        </span>
                                    </td>
                                    <td className="py-3 px-2 text-center">
                                        <span className="text-[11px] font-mono font-bold text-slate-500">
                                            {s.market_total.toFixed(1)}
                                        </span>
                                    </td>
                                    <td className="py-3 px-2">
                                        <div className="flex items-center justify-center gap-1.5">
                                            <div className={cn(
                                                "px-2 py-0.5 rounded flex items-center gap-1",
                                                s.edge_state === 'PLAY' ? "bg-emerald-500/10" :
                                                    s.edge_state === 'LEAN' ? "bg-amber-500/10" : "bg-zinc-800/40"
                                            )}>
                                                {s.edge_points > 0 ? (
                                                    <TrendingUp size={10} className={cn(
                                                        s.edge_state === 'PLAY' ? "text-emerald-400" :
                                                            s.edge_state === 'LEAN' ? "text-amber-400" : "text-slate-500"
                                                    )} />
                                                ) : s.edge_points < 0 ? (
                                                    <TrendingDown size={10} className="text-rose-400" />
                                                ) : (
                                                    <Minus size={10} className="text-slate-500" />
                                                )}
                                                <span className={cn(
                                                    "text-[10px] font-mono font-bold",
                                                    s.edge_state === 'PLAY' ? "text-emerald-400" :
                                                        s.edge_state === 'LEAN' ? "text-amber-400" : "text-slate-500"
                                                )}>
                                                    {s.edge_points.toFixed(1)}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                </motion.tr>
                            ))}
                        </AnimatePresence>
                    </tbody>
                </table>
            </div>
        </div>
    );
};
