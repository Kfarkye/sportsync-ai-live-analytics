
import React, { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Match } from '@/types';
import { computeSharpSignal, SharpSignal } from '../../services/sharpSignalService';
import { TrendingUp, DollarSign, Users, Target, Zap, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/essence';

const MotionDiv = motion.div;

const GaugeBar = ({
    label,
    pct,
    color,
    icon: Icon
}: {
    label: string,
    pct: number,
    color: string,
    icon: ComponentType<{ size?: number; className?: string }>
}) => {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-end">
                <div className="flex items-center gap-1.5 text-zinc-400">
                    <Icon size={12} />
                    <span className="text-label font-bold uppercase tracking-wider">{label}</span>
                </div>
                <span className={cn("text-xs font-mono font-bold tabular-nums", color)}>
                    {pct}%
                </span>
            </div>
            <div className="h-1.5 w-full bg-surface-subtle rounded-full overflow-hidden border border-edge-subtle">
                <MotionDiv
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className={cn("h-full rounded-full", color.replace('text-', 'bg-'))}
                />
            </div>
        </div>
    );
};

export const SharpSignalWidget = ({ match }: { match: Match }) => {
    const [signal, setSignal] = useState<SharpSignal | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            await new Promise(r => setTimeout(r, 600));
            const res = await computeSharpSignal(match.id, match.sport);
            setSignal(res);
            setLoading(false);
        };
        load();
    }, [match.id, match.sport]);

    if (loading) return (
        <div className="h-[180px] bg-surface-base border border-edge-strong rounded-xl flex flex-col items-center justify-center gap-3 animate-pulse">
            <Target size={20} className="text-zinc-700" />
            <span className="text-label font-mono text-zinc-600 uppercase tracking-widest">Analysing Order Flow...</span>
        </div>
    );

    if (!signal) return null;

    // Determine Status
    const isSharp = signal.sharp_confidence > 0.6;
    const isFade = signal.rlm_detected;

    return (
        <MotionDiv
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-surface-base border border-edge-strong rounded-xl overflow-hidden shadow-lg"
        >
            {/* Header */}
            <div className="bg-surface-base px-4 py-3 border-b border-edge flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Zap size={14} className={isSharp ? "text-[#00F0FF] fill-[#00F0FF]/20" : "text-zinc-500"} />
                    <h3 className="text-caption font-bold text-zinc-200 uppercase tracking-widest">Sharp Report</h3>
                </div>

                {isSharp && (
                    <div className="px-2 py-0.5 rounded bg-[#00F0FF]/10 border border-[#00F0FF]/20">
                        <span className="text-nano font-black text-[#00F0FF] uppercase tracking-widest">High Conviction</span>
                    </div>
                )}
            </div>

            <div className="p-5 space-y-5">
                {/* Gauges */}
                <div className="space-y-4">
                    <GaugeBar
                        label="Ticket Count (Public)"
                        pct={signal.public_pct}
                        color="text-zinc-400"
                        icon={Users}
                    />
                    <GaugeBar
                        label="Money Handle (Sharp)"
                        pct={signal.money_pct}
                        color="text-[#00F0FF]"
                        icon={DollarSign}
                    />
                </div>

                {/* Signals */}
                {(signal.rlm_detected || signal.pvj_detected) && (
                    <div className="pt-4 border-t border-edge">
                        <div className="flex gap-2">
                            {signal.rlm_detected && (
                                <div className="flex-1 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2 flex items-center gap-2">
                                    <TrendingUp size={14} className="text-rose-500" />
                                    <div className="flex flex-col">
                                        <span className="text-nano font-bold text-rose-400 uppercase">RLM Detected</span>
                                        <span className="text-nano text-rose-300/70">Line moved vs Public</span>
                                    </div>
                                </div>
                            )}
                            {signal.pvj_detected && (
                                <div className="flex-1 bg-[#00F0FF]/10 border border-[#00F0FF]/20 rounded-lg p-2 flex items-center gap-2">
                                    <AlertTriangle size={14} className="text-[#00F0FF]" />
                                    <div className="flex flex-col">
                                        <span className="text-nano font-bold text-[#00F0FF] uppercase">Sharp Divergence</span>
                                        <span className="text-nano text-[#00F0FF]/70">Money &gt; Tickets</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Summary */}
                {signal.inferred_sharp_side !== 'neutral' && (
                    <div className="text-caption text-zinc-400 font-mono leading-relaxed bg-surface-elevated p-3 rounded-lg border border-white/5">
                        <span className="text-[#00F0FF] font-bold">INSIGHT:</span> Smart money is heavily favoring <span className="text-white font-bold">{signal.inferred_sharp_side === 'home' ? match.homeTeam.shortName : match.awayTeam.shortName}</span> despite {signal.public_pct > 50 ? 'public consensus' : 'ticket volume'}.
                    </div>
                )}
            </div>
        </MotionDiv>
    );
};
