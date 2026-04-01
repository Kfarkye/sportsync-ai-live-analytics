
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
    colorClass,
    fillColor,
    icon: Icon
}: {
    label: string,
    pct: number,
    colorClass: string,
    fillColor: string,
    icon: ComponentType<{ size?: number; className?: string }>
}) => {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-end">
                <div className="flex items-center gap-1.5 text-zinc-600">
                    <Icon size={12} />
                    <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
                </div>
                <span className={cn("text-xs font-mono font-bold tabular-nums", colorClass)}>
                    {pct}%
                </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
                <MotionDiv
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: fillColor }}
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
        <div className="flex h-[180px] flex-col items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 animate-pulse">
            <Target size={20} className="text-zinc-500" />
            <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-500">Analysing Order Flow...</span>
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
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
        >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-900 px-4 py-3">
                <div className="flex items-center gap-2">
                    <Zap size={14} className={isSharp ? "text-cyan-300" : "text-zinc-400"} />
                    <h3 className="text-[10px] font-bold text-zinc-200 uppercase tracking-[0.2em]">Sharp Report</h3>
                </div>

                {isSharp && (
                    <div className="rounded border border-cyan-300/40 bg-cyan-300/10 px-2 py-0.5">
                        <span className="text-[8px] font-black uppercase tracking-widest text-cyan-200">High Conviction</span>
                    </div>
                )}
            </div>

            <div className="p-5 space-y-5">
                {/* Gauges */}
                <div className="space-y-4">
                    <GaugeBar
                        label="Ticket Count (Public)"
                        pct={signal.public_pct}
                        colorClass="text-zinc-700"
                        fillColor="#71717a"
                        icon={Users}
                    />
                    <GaugeBar
                        label="Money Handle (Sharp)"
                        pct={signal.money_pct}
                        colorClass="text-cyan-700"
                        fillColor="#0891b2"
                        icon={DollarSign}
                    />
                </div>

                {/* Signals */}
                {(signal.rlm_detected || signal.pvj_detected) && (
                    <div className="border-t border-zinc-200 pt-4">
                        <div className="flex gap-2">
                            {signal.rlm_detected && (
                                <div className="flex flex-1 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2">
                                    <TrendingUp size={14} className="text-rose-500" />
                                    <div className="flex flex-col">
                                        <span className="text-[8px] font-bold uppercase text-rose-700">RLM Detected</span>
                                        <span className="text-[8px] text-rose-600">Line moved vs Public</span>
                                    </div>
                                </div>
                            )}
                            {signal.pvj_detected && (
                                <div className="flex flex-1 items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 p-2">
                                    <AlertTriangle size={14} className="text-cyan-700" />
                                    <div className="flex flex-col">
                                        <span className="text-[8px] font-bold uppercase text-cyan-700">Sharp Divergence</span>
                                        <span className="text-[8px] text-cyan-600">Money &gt; Tickets</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Summary */}
                {signal.inferred_sharp_side !== 'neutral' && (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-[10px] leading-relaxed text-zinc-700">
                        <span className="font-bold text-cyan-700">INSIGHT:</span> Smart money is heavily favoring <span className="font-bold text-zinc-900">{signal.inferred_sharp_side === 'home' ? match.homeTeam.shortName : match.awayTeam.shortName}</span> despite {signal.public_pct > 50 ? 'public consensus' : 'ticket volume'}.
                    </div>
                )}
            </div>
        </MotionDiv>
    );
};
