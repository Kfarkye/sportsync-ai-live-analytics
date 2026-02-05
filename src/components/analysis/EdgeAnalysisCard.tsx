import React, { useState } from 'react';
import { cn } from '@/lib/essence';
import { Activity, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Bot } from 'lucide-react';
import { Sport } from '@/types';

/**
 * THE EDGE SCRIPT CONTRACT
 * 1. Edge: Numeric Delta + Shift + Probability (Big Math)
 * 2. Implications: Deterministic observations (Mechanical)
 * 3. Injuries: Relevant names only (Priced In)
 * 4. Trace: The silent math path
 */

export type EdgeDirection = 'OVER' | 'UNDER' | 'HOME' | 'AWAY';

export type EdgeResult = {
    type: 'TOTAL' | 'SPREAD';
    impliedLine: number;
    modelLine: number;
    edgePoints: number;     // Absolute Magnitude
    edgeDirection: EdgeDirection;
    confidence: number;     // 0.0 - 1.0

    // The Script Elements
    implications: string[]; // Max 4 bullet points
    sources?: Array<{ title: string; url: string }>;
    keyInjuries: Array<{ name: string; status: 'OUT' | 'GTD' | 'PROBABLE' }>;
    trace: {
        pace: number;
        efficiency: number;
        possessions: number;
    };

    // Internal Gates
    edgePercent: number;
};

interface EdgeAnalysisCardProps {
    data?: EdgeResult;
    isLoading?: boolean;
    sport?: Sport;
}

export const EdgeAnalysisCard: React.FC<EdgeAnalysisCardProps> = ({ data, isLoading, sport }) => {
    const [traceExpanded, setTraceExpanded] = useState(false);

    // Sport-aware unit label
    const getUnitLabel = (): string => {
        if (data?.type === 'SPREAD') return 'Points';
        // For TOTAL, use sport-specific terminology
        switch (sport) {
            case Sport.HOCKEY:
            case Sport.SOCCER:
                return 'Goals';
            case Sport.NFL:
            case Sport.COLLEGE_FOOTBALL:
            case Sport.NBA:
            case Sport.WNBA:
            case Sport.COLLEGE_BASKETBALL:
            case Sport.BASKETBALL:
            default:
                return 'Points';
        }
    };

    // 1. LOADING GATE
    if (isLoading || !data) {
        return (
            <div className="w-full bg-[#0A0A0B] border border-white/[0.04] rounded-2xl p-20 flex flex-col items-center justify-center gap-6">
                <div className="relative">
                    <div className="absolute -inset-4 bg-white/[0.03] blur-xl rounded-full animate-pulse" />
                    <Bot size={40} className="text-zinc-700 animate-spin relative z-10" />
                </div>
                <div className="flex flex-col items-center gap-2">
                    <span className="text-[11px] font-black uppercase tracking-[0.5em] text-zinc-500 ml-[0.5em]">
                        Analysis
                    </span>
                    <div className="h-[1px] w-12 bg-white/[0.05]" />
                </div>
            </div>
        );
    }

    const isWeakSignal = data.edgePoints < 3.0 && data.edgePercent < 2.0;
    const isLowConfidence = data.confidence < 0.60;
    const isEfficient = data.edgePoints < 1.0;

    // Visual Semiotics
    const isPositive = data.edgeDirection === 'OVER' || data.edgeDirection === 'HOME';
    const accentColor = isEfficient ? "text-zinc-500" : (isPositive ? "text-emerald-400" : "text-rose-400");

    // Determine Trace Labels based on metric keys
    const isSpread = data.type === 'SPREAD';
    const rateKey = Object.keys(data.trace).find(k => ['efficiency', 'net_rating'].includes(k)) || 'efficiency';
    const traceVolumeLabel = isSpread ? 'POSS' : (rateKey === 'efficiency' ? (data.trace.possessions < 80 ? 'SOG' : 'POSS') : 'POSS');
    const traceEffLabel = rateKey === 'efficiency' ? (isSpread ? 'NET' : 'EFF') : 'NET';

    return (
        <div className="w-full bg-gradient-to-b from-[#0c0c0e] to-[#050506] border border-white/10 rounded-2xl overflow-hidden shadow-2xl font-sans animate-in fade-in zoom-in-95 duration-500">

            {/* SECTION 1: THE EDGE NUMBERS */}
            <div className="p-8 pb-6 relative overflow-hidden">
                {/* Ambient Multi-Stop Gradient Glow */}
                <div className={cn(
                    "absolute inset-0 opacity-30",
                    isPositive
                        ? "bg-[radial-gradient(ellipse_at_top_right,_rgba(16,185,129,0.15)_0%,_transparent_50%)]"
                        : "bg-[radial-gradient(ellipse_at_top_right,_rgba(244,63,94,0.15)_0%,_transparent_50%)]"
                )} />

                <div className="relative z-10 flex flex-col items-center text-center space-y-4">

                    {/* The Signal Meter (Hero) */}
                    {isEfficient ? (
                        <div className="flex flex-col items-center py-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600 mb-2">Audit Status</div>
                            <div className="text-2xl font-mono font-bold tracking-tighter text-zinc-400 uppercase">
                                Market Efficient
                            </div>
                            <div className="text-[9px] font-medium text-zinc-600 mt-2 uppercase tracking-widest">
                                No High-Conviction Alpha Detected
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center">
                            <div className="text-[9px] font-black uppercase tracking-[0.4em] text-zinc-500 mb-3">Signal Meter</div>

                            {/* Hero Number - 72px for Sofascore-Level Dominance */}
                            <div className="flex items-center gap-3">
                                <span className={cn(
                                    "text-[72px] font-mono font-black tracking-tighter tabular-nums leading-none",
                                    isPositive ? "text-emerald-400" : "text-rose-400"
                                )} style={{ textShadow: isPositive ? '0 0 40px rgba(16,185,129,0.3)' : '0 0 40px rgba(244,63,94,0.3)' }}>
                                    {isPositive ? '+' : '-'}{data.edgePoints.toFixed(1)}
                                </span>
                                <div className={cn(
                                    "w-3 h-3 rounded-full animate-pulse",
                                    isPositive ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]" : "bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.8)]"
                                )} />
                            </div>
                            <div className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.1em] mt-1">
                                {getUnitLabel()} vs Market
                            </div>
                            {/* Market vs Model Row - Enhanced */}
                            <div className="flex items-center gap-4 mt-5 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                                <div className="flex flex-col items-center">
                                    <span className="text-[8px] text-zinc-600 uppercase tracking-widest font-bold">Market</span>
                                    <span className="text-lg font-mono text-zinc-500 line-through decoration-zinc-600">{data.impliedLine.toFixed(1)}</span>
                                </div>
                                <ArrowRight size={16} className="text-zinc-600" />
                                <div className="flex flex-col items-center">
                                    <span className="text-[8px] text-zinc-600 uppercase tracking-widest font-bold">Model</span>
                                    <span className="text-lg font-mono text-white font-bold">{data.modelLine.toFixed(1)}</span>
                                </div>
                                <span className={cn(
                                    "text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border ml-2",
                                    isPositive ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                                )}>
                                    {data.edgeDirection}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* The Probability */}
                    {!isEfficient && (
                        <div className="flex items-center gap-2.5 px-4 py-2 rounded-full border border-white/[0.08] bg-gradient-to-r from-white/[0.03] to-transparent">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                            <span className="text-sm font-bold text-zinc-300 tracking-wide">
                                {Math.round(data.confidence * 100)}% Relative Confidence
                            </span>
                        </div>
                    )}
                </div>
            </div>

            <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

            {/* SECTION 3.5: GROUNDING SOURCES */}
            {data.sources && data.sources.length > 0 && (
                <div className="px-6 py-4 bg-white/[0.01] border-t border-white/[0.04]">
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-3 pl-1">
                        Grounded Sources
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {data.sources.slice(0, 3).map((source, i) => (
                            <a
                                key={i}
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-medium text-blue-400/70 hover:text-blue-300 transition-colors bg-blue-500/5 px-2 py-1 rounded border border-blue-500/10"
                            >
                                {source.title.length > 25 ? source.title.substring(0, 25) + '...' : source.title}
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* SECTION 4: INJURIES (PRICED IN) */}
            {data.keyInjuries.length > 0 && (
                <>
                    <div className="h-px w-full bg-white/[0.04]" />
                    <div className="px-6 py-4 bg-white/[0.02]">
                        <div className="flex flex-col gap-2">
                            {data.keyInjuries.slice(0, 3).map((inj, i) => (
                                <div key={i} className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-zinc-400 font-mono">{inj.name}</span>
                                    <span className={cn(
                                        "text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider",
                                        inj.status === 'OUT' ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                                            inj.status === 'GTD' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                                "bg-zinc-800 text-zinc-400 border-zinc-700"
                                    )}>
                                        {inj.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {/* The Non-Negotiable Accounting Line */}
                        <div className="mt-4 pt-3 border-t border-dashed border-white/10 flex items-center gap-2 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                            <CheckCircle2 size={10} className="text-zinc-600" />
                            <span>Availability: Priced In</span>
                        </div>
                    </div>
                </>
            )}

            {/* SECTION 5: WHY THIS BET (EXPANDABLE TRACE) */}
            <div className="border-t border-white/[0.04]">
                <button
                    onClick={() => setTraceExpanded(!traceExpanded)}
                    className="w-full px-6 py-3 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors"
                >
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Why this bet?</span>
                    {traceExpanded ? (
                        <ChevronUp size={14} className="text-zinc-500" />
                    ) : (
                        <ChevronDown size={14} className="text-zinc-500" />
                    )}
                </button>
                {traceExpanded && (
                    <div className="px-6 pb-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 text-center">
                                <div className="text-[8px] font-bold text-zinc-600 uppercase tracking-wider mb-1">Pace</div>
                                <div className="text-sm font-mono font-bold text-zinc-300">{data.trace.pace.toFixed(1)}</div>
                            </div>
                            <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 text-center">
                                <div className="text-[8px] font-bold text-zinc-600 uppercase tracking-wider mb-1">Efficiency</div>
                                <div className="text-sm font-mono font-bold text-zinc-300">{data.trace.efficiency.toFixed(3)}</div>
                            </div>
                            <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 text-center">
                                <div className="text-[8px] font-bold text-zinc-600 uppercase tracking-wider mb-1">{traceVolumeLabel}</div>
                                <div className="text-sm font-mono font-bold text-zinc-300">{Math.round(data.trace.possessions)}</div>
                            </div>
                        </div>
                        <div className="text-[10px] text-zinc-500 text-center font-mono">
                            Fair Line = Pace × Efficiency → {data.modelLine.toFixed(1)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
