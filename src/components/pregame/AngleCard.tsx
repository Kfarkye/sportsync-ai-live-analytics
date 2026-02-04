
import React from 'react';
import { geminiService } from '../../services/geminiService';
import { dbService, CacheResult } from '../../services/dbService';
import { useDbFirst } from '../../hooks/useDbFirst';
import { Match, MatchAngle } from '../../types';
import { Loader2, AlertTriangle, Target, RefreshCw, Layers, ExternalLink, FileText } from 'lucide-react';
import { motion } from 'framer-motion';

const MotionDiv = motion.div;

export const AngleCard = ({ match }: { match: Match }) => {

    const { data, isLoading, error, retry } = useDbFirst<MatchAngle>(
        () => dbService.getMatchAngle(match.id) as Promise<CacheResult<MatchAngle> | null>,
        () => geminiService.fetchMatchAngle(match),
        async (angle) => {
            if (angle && angle.summary && !angle.summary.includes("AI Configuration Missing")) {
                await dbService.cacheMatchAngle(match.id, angle);
            }
        },
        [match.id]
    );

    if (isLoading) {
        return (
            <div className="bg-[#09090B] border border-white/[0.08] rounded-2xl p-12 flex flex-col items-center justify-center min-h-[300px]">
                <div className="relative mb-4">
                    <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full" />
                    <Loader2 className="w-8 h-8 text-emerald-500 animate-spin relative z-10" />
                </div>
                <span className="text-sm font-medium text-zinc-400">Synthesizing Data Model...</span>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="bg-[#09090B] border border-white/[0.08] rounded-2xl p-8 flex flex-col items-center justify-center min-h-[250px]">
                <div className="p-3 bg-red-500/10 rounded-xl mb-4">
                    <AlertTriangle className="w-6 h-6 text-red-500" />
                </div>
                <p className="text-sm text-zinc-400 mb-6 font-medium">{error || "Analysis unavailable."}</p>
                <button
                    onClick={() => retry(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-white text-black hover:bg-zinc-200 rounded-xl text-xs font-bold transition-all active:scale-95"
                >
                    <RefreshCw size={14} /> Retry Analysis
                </button>
            </div>
        );
    }

    return (
        <MotionDiv
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#09090B] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl relative group"
        >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />

            <div className="p-6 md:p-8 border-b border-white/5 bg-[#09090B]">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                            <Target size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white tracking-tight">Data Model</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/5 rounded-md border border-white/5">
                                    <Layers size={10} className="text-emerald-500" />
                                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Syndicate Action</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => retry(true)}
                        className="p-2 text-zinc-600 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                        title="Regenerate Angle"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
                <p className="text-sm md:text-[15px] text-zinc-300 leading-relaxed font-medium border-l-2 border-white/10 pl-4 py-1">
                    {data.summary}
                </p>
            </div>

            <div className="grid md:grid-cols-2 gap-px bg-white/5 border-b border-white/5">
                <div className="p-6 md:p-8 bg-[#0D0D0E]">
                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-5 flex items-center gap-2">
                        <div className="w-1 h-1 bg-zinc-500 rounded-full" />
                        Power Ratings
                    </h4>
                    <div className="space-y-5">
                        {data.keyFactors?.map((factor, i) => (
                            <div key={i} className="flex gap-4 group/item">
                                <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ring-4 ring-[#0D0D0E] ${factor.impact === 'high' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : factor.impact === 'medium' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
                                <div>
                                    <div className="text-sm font-bold text-white mb-1 group-hover/item:text-emerald-400 transition-colors">{factor.title}</div>
                                    <div className="text-xs text-zinc-400 leading-relaxed">{factor.description}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-6 md:p-8 bg-[#0D0D0E]">
                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-5 flex items-center gap-2">
                        <div className="w-1 h-1 bg-zinc-500 rounded-full" />
                        Value Positions
                    </h4>
                    <div className="space-y-3">
                        {data.recommendedPlays?.map((play, i) => {
                            const conf = play.confidence;
                            const isElite = conf.tier === 'ELITE' || conf.tier === 'STRONG';
                            return (
                                <div key={i} className="bg-white/[0.03] border border-white/5 rounded-xl p-4 flex items-center justify-between group hover:bg-white/[0.05] hover:border-emerald-500/30 transition-all duration-300 relative overflow-hidden">
                                    {isElite && <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/0 to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />}

                                    <div className="relative z-10">
                                        <div className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">{play.label}</div>
                                        <div className="text-[10px] font-mono text-zinc-500 mt-0.5 bg-black/30 inline-block px-1.5 py-0.5 rounded">{play.odds}</div>
                                    </div>
                                    <div className="text-right relative z-10">
                                        <div className="text-[9px] text-zinc-500 uppercase font-bold mb-0.5">{conf.label}</div>
                                        <div className={`text-sm font-mono font-bold ${isElite ? 'text-emerald-400' : 'text-zinc-400'}`}>{conf.score}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
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
