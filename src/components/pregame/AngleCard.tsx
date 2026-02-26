
import React from 'react';
import { geminiService } from '../../services/geminiService';
import { dbService, CacheResult } from '../../services/dbService';
import { useDbFirst } from '../../hooks/useDbFirst';
import { Match, MatchAngle } from '@/types';
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
            <div className="bg-white border border-slate-200 rounded-2xl p-12 flex flex-col items-center justify-center min-h-[300px]">
                <div className="relative mb-4">
                    <div className="absolute inset-0 bg-emerald-500/10 blur-xl rounded-full" />
                    <Loader2 className="w-8 h-8 text-emerald-500 animate-spin relative z-10" />
                </div>
                <span className="text-sm font-medium text-slate-400">Synthesizing Data Model...</span>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center min-h-[250px]">
                <div className="p-3 bg-red-50 rounded-xl mb-4">
                    <AlertTriangle className="w-6 h-6 text-red-500" />
                </div>
                <p className="text-sm text-slate-400 mb-6 font-medium">{error || "Analysis unavailable."}</p>
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
            className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm relative group"
        >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />

            <div className="p-6 md:p-8 border-b border-slate-100 bg-white">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600 border border-emerald-200">
                            <Target size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 tracking-tight">Data Model</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-50 rounded-md border border-slate-200">
                                    <Layers size={10} className="text-emerald-500" />
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Syndicate Action</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => retry(true)}
                        className="p-2 text-slate-400 hover:text-slate-900 transition-colors rounded-lg hover:bg-slate-50"
                        title="Regenerate Angle"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
                <p className="text-sm md:text-[15px] text-slate-600 leading-relaxed font-medium border-l-2 border-slate-200 pl-4 py-1">
                    {data.summary}
                </p>
            </div>

            <div className="grid md:grid-cols-2 gap-px bg-slate-100 border-b border-slate-100">
                <div className="p-6 md:p-8 bg-white">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                        <div className="w-1 h-1 bg-slate-400 rounded-full" />
                        Power Ratings
                    </h4>
                    <div className="space-y-5">
                        {data.keyFactors?.map((factor, i) => (
                            <div key={i} className="flex gap-4 group/item">
                                <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ring-4 ring-white ${factor.impact === 'high' ? 'bg-emerald-500' : factor.impact === 'medium' ? 'bg-amber-400' : 'bg-slate-300'}`} />
                                <div>
                                    <div className="text-sm font-bold text-slate-900 mb-1 group-hover/item:text-emerald-600 transition-colors">{factor.title}</div>
                                    <div className="text-xs text-slate-500 leading-relaxed">{factor.description}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-6 md:p-8 bg-white">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                        <div className="w-1 h-1 bg-slate-400 rounded-full" />
                        Value Positions
                    </h4>
                    <div className="space-y-3">
                        {data.recommendedPlays?.map((play, i) => {
                            const conf = play.confidence;
                            const isElite = conf.tier === 'ELITE' || conf.tier === 'STRONG';
                            return (
                                <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between group hover:bg-slate-100 hover:border-emerald-300 transition-all duration-300 relative overflow-hidden">
                                    {isElite && <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/0 to-emerald-50 opacity-0 group-hover:opacity-100 transition-opacity" />}

                                    <div className="relative z-10">
                                        <div className="text-sm font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">{play.label}</div>
                                        <div className="text-[10px] font-mono text-slate-400 mt-0.5 bg-slate-100 inline-block px-1.5 py-0.5 rounded">{play.odds}</div>
                                    </div>
                                    <div className="text-right relative z-10">
                                        <div className="text-[9px] text-slate-400 uppercase font-bold mb-0.5">{conf.label}</div>
                                        <div className={`text-sm font-mono font-bold ${isElite ? 'text-emerald-600' : 'text-slate-400'}`}>{conf.score}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Sources Footer */}
            {data.sources && data.sources.length > 0 && (
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100">
                    <div className="flex items-center gap-2 mb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        <FileText size={10} /> Verified Sources
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {(data.sources || []).slice(0, 5).map((source, i) => (
                            <a
                                key={i}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 rounded-full border border-slate-200 hover:border-slate-300 text-[10px] text-slate-500 hover:text-slate-900 transition-all group"
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
