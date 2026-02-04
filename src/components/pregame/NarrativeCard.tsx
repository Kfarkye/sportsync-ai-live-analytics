
import React from 'react';
import { geminiService } from '../../services/geminiService';
import { dbService, CacheResult } from '../../services/dbService';
import { useDbFirst } from '../../hooks/useDbFirst';
import { Match, NarrativeIntel } from '../../types';
import { Loader2, AlertTriangle, Flame, Quote, Zap, RefreshCw, Mic2, ExternalLink, FileText } from 'lucide-react';
import { motion } from 'framer-motion';

const MotionDiv = motion.div;

export const NarrativeCard = ({ match }: { match: Match }) => {

    const { data, isLoading, error, retry } = useDbFirst<NarrativeIntel>(
        () => dbService.getNarrativeIntel(match.id) as Promise<CacheResult<NarrativeIntel> | null>,
        () => geminiService.fetchNarrativeAnalysis(match),
        async (narrative) => {
            if (narrative && narrative.headline && !narrative.headline.includes("Signal")) {
                await dbService.cacheNarrativeIntel(match.id, narrative);
            }
        },
        [match.id]
    );

    if (isLoading) {
        return (
            <div className="bg-[#09090B] border border-white/[0.08] rounded-2xl p-12 flex flex-col items-center justify-center min-h-[300px]">
                <div className="relative mb-4">
                    <div className="absolute inset-0 bg-amber-500/20 blur-xl rounded-full" />
                    <Loader2 className="w-8 h-8 text-amber-500 animate-spin relative z-10" />
                </div>
                <span className="text-sm font-medium text-zinc-400">Reading the Public...</span>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="bg-[#09090B] border border-white/[0.08] rounded-2xl p-8 flex flex-col items-center justify-center min-h-[250px]">
                <div className="p-3 bg-red-500/10 rounded-xl mb-4">
                    <AlertTriangle className="w-6 h-6 text-red-500" />
                </div>
                <p className="text-sm text-zinc-400 mb-6 font-medium">{error || "Narrative unavailable."}</p>
                <button
                    onClick={() => retry(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-white text-black hover:bg-zinc-200 rounded-xl text-xs font-bold transition-all active:scale-95"
                >
                    <RefreshCw size={14} /> Retry
                </button>
            </div>
        );
    }

    // Unified Confidence Logic
    const conf = data.blazingPick.confidence;
    const isBlazing = conf.tier === 'ELITE' || conf.tier === 'STRONG';

    return (
        <MotionDiv
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#09090B] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl relative group"
        >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-rose-500" />

            <div className="p-6 md:p-8 pb-6 border-b border-white/5 relative">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-amber-500">
                        <Flame size={18} fill="currentColor" className="opacity-90" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">The Narrative</span>
                    </div>

                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/5 rounded-md border border-white/5">
                        <Mic2 size={10} className="text-zinc-400" />
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">The Herd Model</span>
                    </div>
                </div>

                <h3 className="text-2xl md:text-3xl font-black text-white leading-tight italic tracking-tight mb-6 max-w-2xl">
                    "{data.headline}"
                </h3>

                <div className="relative pl-6 border-l-2 border-amber-500/40">
                    <Quote size={20} className="absolute -left-[11px] -top-1 text-amber-500 bg-[#09090B]" />
                    <p className="text-sm md:text-[15px] text-zinc-200 leading-relaxed font-medium">
                        {data.mainRant}
                    </p>
                </div>
            </div>

            <div className="grid md:grid-cols-12 gap-px bg-white/5 border-b border-white/5">

                <div className="md:col-span-7 bg-[#0D0D0E] p-6 md:p-8">
                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-5 flex items-center gap-2">
                        <div className="w-1 h-1 bg-zinc-500 rounded-full" />
                        Psychological Factors
                    </h4>

                    <div className="space-y-4">
                        {data.psychologyFactors?.map((factor, i) => (
                            <div key={i} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0 group/item">
                                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide group-hover/item:text-white transition-colors">{factor.title}</span>
                                <span className="text-sm font-bold text-white">{factor.value}</span>
                            </div>
                        ))}
                    </div>

                    <div className="mt-6 pt-4 border-t border-white/5">
                        <div className="text-[9px] font-bold text-zinc-600 uppercase mb-2">Key Analogies</div>
                        <div className="flex flex-wrap gap-2">
                            {data.analogies?.map((analogy, i) => (
                                <span key={i} className="px-2.5 py-1 bg-white/[0.03] rounded-md text-[10px] text-zinc-400 border border-white/5 font-medium">
                                    {analogy}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="md:col-span-5 bg-[#0D0D0E] p-6 md:p-8 relative overflow-hidden flex flex-col">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 blur-3xl rounded-full pointer-events-none" />

                    <div className="flex-1 relative z-10">
                        <div className="flex items-center gap-2 mb-3">
                            <Zap size={14} className={isBlazing ? "text-amber-500 fill-amber-500" : "text-zinc-500"} />
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                                {isBlazing ? "Blazing 5 Selection" : "Lean"}
                            </span>
                        </div>

                        <div className="text-2xl font-black text-white tracking-tight mb-2 leading-none">
                            {data.blazingPick.selection}
                        </div>

                        <div className="w-full bg-white/10 h-1.5 rounded-full mb-4 overflow-hidden">
                            <MotionDiv
                                initial={{ width: 0 }}
                                animate={{ width: isBlazing ? '90%' : '60%' }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                className={`h-full rounded-full ${isBlazing ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'bg-zinc-500'}`}
                            />
                        </div>

                        <div className="p-3 bg-white/[0.03] rounded-xl border border-white/5">
                            <p className="text-[11px] text-zinc-300 leading-snug font-medium">
                                <span className="text-amber-500 font-bold mr-1">Why:</span>
                                {data.blazingPick.reason}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => retry(true)}
                        className="mt-6 w-full py-2 flex items-center justify-center gap-2 text-[10px] font-bold text-zinc-600 hover:text-white transition-colors uppercase tracking-widest border border-dashed border-white/10 rounded-lg hover:bg-white/5 hover:border-white/20"
                    >
                        <RefreshCw size={10} /> Refresh Take
                    </button>
                </div>

            </div>

            {/* Sources Footer */}
            {data.sources && data.sources.length > 0 && (
                <div className="px-6 py-4 bg-[#080808] border-t border-white/5">
                    <div className="flex items-center gap-2 mb-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                        <FileText size={10} /> Verified Sources
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {(data.sources || []).slice(0, 5).map((source, i) => (
                            <a
                                key={i}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.03] hover:bg-white/[0.08] rounded-full border border-white/5 hover:border-white/10 text-[10px] text-zinc-400 hover:text-white transition-all group"
                            >
                                <span className="truncate max-w-[150px]">{source.title}</span>
                                <ExternalLink size={10} className="opacity-50 group-hover:opacity-100" />
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </MotionDiv>
    );
};
