import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, Terminal, Link as LinkIcon, Timer, ArrowUp } from 'lucide-react';
import { Match, AISignals, LiveAIAnalysis, SharpData } from '@/types';
import { isGameInProgress, isGameFinished, getPeriodDisplay, getDbMatchId } from '../../utils/matchUtils';
import { cn, ESSENCE } from '@/lib/essence';
import { useLiveGameState } from '../../hooks/useLiveGameState';
import { supabase } from '../../lib/supabase';

interface LiveAIInsightProps {
    match: Match;
}

interface AnalysisSource {
    title?: string;
    uri?: string;
    url?: string;
}

interface OnDemandAnalysis {
    success?: boolean;
    sharp_data?: SharpData;
    thought_trace?: string;
    sources?: AnalysisSource[];
}



export const LiveAIInsight: React.FC<LiveAIInsightProps> = ({ match }) => {
    const { state: liveState, loading: liveLoading } = useLiveGameState(match?.id || '', match?.leagueId || '');
    const [onDemandAnalysis, setOnDemandAnalysis] = useState<OnDemandAnalysis | null>(null);
    const [showTrace, setShowTrace] = useState(false);
    const [showFullRead, setShowFullRead] = useState(false);
    const attemptRef = useRef<string | null>(null);

    const isLive = isGameInProgress(match?.status);
    const isFinal = isGameFinished(match?.status);

    const ai_analysis: LiveAIAnalysis | null = liveState?.ai_analysis || (onDemandAnalysis?.sharp_data ? {
        sharp_data: onDemandAnalysis.sharp_data,
        generated_at: new Date().toISOString(),
        thought_trace: onDemandAnalysis.thought_trace,
        sources: onDemandAnalysis.sources
    } : null);
    const sharp_data = ai_analysis?.sharp_data;

    useEffect(() => {
        if (!isLive || !match?.id) return;
        if (!ai_analysis && attemptRef.current !== match.id) {
            attemptRef.current = match.id;
            const snapshot = {
                score: `${match.awayScore}-${match.homeScore}`,
                away_team: match.awayTeam?.name,
                home_team: match.homeTeam?.name,
                away_score: match.awayScore,
                home_score: match.homeScore,
                clock: match.displayClock,
                period: match.period,
                market_total: match.current_odds?.total || match.odds?.total,
                fair_total: liveState?.deterministic_signals?.deterministic_fair_total,
                deterministic_signals: liveState?.deterministic_signals,
                last_play: liveState?.last_play || match.lastPlay,
                sport: match.sport,
                league_id: match.leagueId
            };

            const dbId = getDbMatchId(match.id, match.leagueId || '');
            supabase.functions.invoke('analyze-match', {
                body: { match_id: dbId, snapshot }
            }).then(({ data }) => {
                if (data?.success && data?.sharp_data) {
                    setOnDemandAnalysis(data);
                }
            }).catch(() => {
                attemptRef.current = null;
            });
        }
    }, [match?.id, match?.leagueId, liveState, isLive, ai_analysis]);

    if (!match || !match.homeTeam || !match.awayTeam) return null;
    if (!isLive && !isFinal) return null;

    if (liveLoading && !liveState) {
        return (
            <div className="p-16 flex flex-col items-center justify-center bg-[#080808]/60 backdrop-blur-xl rounded-3xl border border-slate-200 shadow-sm">
                <motion.div
                    animate={{ rotate: 360, scale: [1, 1.1, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="w-12 h-12 border-2 border-zinc-800 border-t-emerald-500 rounded-full mb-6"
                />
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 animate-pulse">Synchronizing Intelligence</span>
            </div>
        );
    }

    if (isLive && !sharp_data) {
        return (
            <div className="my-8">
                <div className={cn("backdrop-blur-2xl p-8 space-y-8 overflow-hidden relative group", ESSENCE.card.base)}>
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent opacity-50" />
                    <div className="flex items-center justify-between relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <div className="h-2 w-32 bg-zinc-800 rounded-full overflow-hidden">
                                <motion.div
                                    animate={{ x: [-128, 128] }}
                                    transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                    className="w-full h-full bg-emerald-500/50"
                                />
                            </div>
                        </div>
                        <div className="w-20 h-8 bg-zinc-800/50 rounded-xl" />
                    </div>
                    <div className="space-y-4 relative z-10">
                        <div className="w-full h-4 bg-zinc-800/30 rounded-lg animate-pulse" />
                        <div className="w-4/5 h-4 bg-zinc-800/20 rounded-lg animate-pulse" />
                    </div>
                    <div className="pt-8 border-t border-white/[0.03] flex items-center justify-between relative z-10">
                        <div className="flex items-center gap-2">
                            <div className="flex gap-0.5">
                                {[1, 2, 3].map(i => (
                                    <motion.div
                                        key={i}
                                        animate={{ height: [4, 12, 4], opacity: [0.3, 1, 0.3] }}
                                        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                                        className="w-[2px] bg-emerald-500/60 rounded-full"
                                    />
                                ))}
                            </div>
                            <span className="text-[10px] font-black text-emerald-500/60 uppercase tracking-[0.2em] ml-1">Computing Alpha</span>
                        </div>
                        <div className="flex gap-4">
                            <div className="w-8 h-2 bg-zinc-800/50 rounded-full" />
                            <div className="w-8 h-2 bg-zinc-800/50 rounded-full" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!sharp_data) return null;

    const side = sharp_data?.recommendation?.side || 'PASS';
    const isEdge = side !== 'PASS' && side !== 'AVOID';
    const marketType = sharp_data?.recommendation?.market_type || 'TOTAL';
    const displaySide = side === 'HOME' ? match.homeTeam.shortName : side === 'AWAY' ? match.awayTeam.shortName : side;

    const forensicSnapshot = {
        score: liveState?.away_score !== undefined ? `${liveState.away_score}-${liveState.home_score}` : `${match.awayScore}-${match.homeScore}`,
        clock: liveState?.clock || match.displayClock || '—',
        period: liveState?.period || match.period,
        market_total: liveState?.deterministic_signals?.market_total || match.current_odds?.total || match.odds?.total || 0,
        fair_total: liveState?.deterministic_signals?.deterministic_fair_total || 0
    };

    const formattedTime = ai_analysis?.generated_at ? new Date(ai_analysis.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    const accentColor = isEdge ? "text-emerald-400" : "text-slate-500";

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="my-8"
        >
            <div className={cn("backdrop-blur-3xl p-8 space-y-7 relative overflow-hidden group", ESSENCE.card.base)}>
                {/* Visual Accent */}
                <div className={cn(
                    "absolute -top-24 -right-24 w-64 h-64 blur-[100px] opacity-10 transition-colors duration-1000",
                    isEdge ? "bg-emerald-500" : "bg-blue-500"
                )} />

                {/* Tier 1: System Heartbeat & Meta */}
                <div className="flex items-center justify-between relative z-10">
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                            <div className="flex gap-0.5">
                                {[1, 2, 3].map(i => (
                                    <motion.div
                                        key={i}
                                        animate={{ height: [4, 10, 4], opacity: [0.4, 1, 0.4] }}
                                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                                        className={cn("w-[2px] rounded-full", isEdge ? "bg-emerald-500" : "bg-zinc-500")}
                                    />
                                ))}
                            </div>
                            <span className={cn("text-[10px] font-black tracking-[0.2em] uppercase", accentColor)}>
                                {isEdge ? "Tactical Alpha Detected" : "Market Efficiency Confirmed"}
                            </span>
                        </div>
                        {formattedTime && <span className="text-[9px] font-mono text-slate-500 tracking-tighter uppercase opacity-60">Audit Hash: {formattedTime} • v4.2 ARCHITECT</span>}
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="px-2.5 py-1 bg-slate-50 border border-white/[0.02] rounded-lg hidden sm:flex items-center gap-1.5">
                            <Target size={10} className="text-slate-500" />
                            <span className="text-[10px] font-black text-slate-500 tracking-widest uppercase">{marketType}</span>
                        </div>
                        <div className={cn(
                            "px-4 py-2 rounded-2xl flex items-center gap-3 border shadow-sm transition-all duration-700",
                            isEdge ? "bg-emerald-500/10 border-emerald-500/20 shadow-emerald-500/5 ring-1 ring-emerald-500/10" : "bg-zinc-900/60 border-slate-200"
                        )}>
                            <span className={cn("text-xs font-black tracking-tight uppercase", accentColor)}>
                                {side === 'PASS' ? 'Efficiency Clear' : displaySide}
                            </span>
                            <div className="w-[1px] h-4 bg-slate-100" />
                            <span className="text-[11px] font-mono font-bold text-slate-400 tabular-nums">
                                {sharp_data?.recommendation?.unit_size || '0.00U'}
                            </span>
                        </div>
                    </div>
                </div>

                <h2 className="text-[22px] font-bold text-slate-900 tracking-tight leading-[1.15] relative z-10 lg:pr-12">
                    {sharp_data.headline}
                </h2>

                {/* Tier 2: Real-time Snapshot Grid */}
                <div className="grid grid-cols-3 gap-8 py-5 border-y border-slate-200 relative z-10">
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black text-slate-500 tracking-widest uppercase">Scoreboard</span>
                        <span className="font-mono text-[16px] font-bold text-slate-900 tabular-nums tracking-tight">{forensicSnapshot.score}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black text-slate-500 tracking-widest uppercase">Game Clock</span>
                        <div className="flex items-center gap-1.5">
                            <Timer size={12} className="text-slate-400" />
                            <span className="font-mono text-[16px] font-bold text-slate-900 tabular-nums tracking-tight">{forensicSnapshot.clock}</span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black text-slate-500 tracking-widest uppercase">Confidence</span>
                        <div className="flex items-center gap-1.5">
                            <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }} className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span className="font-mono text-[16px] font-bold text-slate-900 tabular-nums tracking-tight">{sharp_data.confidence_level || sharp_data.confidence_rating || "—"}%</span>
                        </div>
                    </div>
                </div>

                {/* Tier 3: Strategic Pillars */}
                {sharp_data.executive_bullets && (
                    <div className="space-y-4 relative z-10 py-1">
                        {[
                            { label: 'Situational', val: sharp_data.executive_bullets.spot },
                            { label: 'Tactical', val: sharp_data.executive_bullets.driver },
                            { label: 'Verdict', val: sharp_data.executive_bullets.verdict }
                        ].map((pillar, i) => (
                            <motion.div
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.1 * i }}
                                key={i}
                                className="flex items-start gap-4 group"
                            >
                                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-100 group-hover:bg-emerald-500/50 transition-all duration-500 shadow-[0_0_8px_transparent] group-hover:shadow-emerald-500/20" />
                                <div className="flex-1 flex flex-col gap-0.5">
                                    <span className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500 group-hover:text-emerald-500/60 transition-colors">{pillar.label}</span>
                                    <span className="text-[14px] text-slate-600 font-medium leading-[1.4] tracking-tight">{pillar.val}</span>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}

                {/* Tier 4: The Narrative (Collapsible) */}
                <div className="pt-2 relative z-10">
                    <AnimatePresence>
                        {showFullRead && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <p className="text-[13.5px] text-slate-400 leading-[1.6] tracking-tight mb-5 border-l border-white/[0.05] pl-4 italic bg-white/[0.01] py-2 rounded-r-lg">
                                    {sharp_data.the_read}
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="flex items-center gap-6">
                        <button
                            onClick={() => setShowFullRead(!showFullRead)}
                            className="text-[10px] font-black text-emerald-500/70 hover:text-emerald-400 transition-all flex items-center gap-2 uppercase tracking-widest group"
                        >
                            <span className="bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 group-hover:bg-emerald-500/20 transition-all">
                                {showFullRead ? 'Collapse Digest' : 'Read Deep Dive'}
                            </span>
                            <motion.div animate={{ y: showFullRead ? -2 : 2 }}>
                                <ArrowUp size={12} className={cn("transition-transform duration-500", showFullRead ? "rotate-0" : "rotate-180")} />
                            </motion.div>
                        </button>

                        {ai_analysis?.thought_trace && (
                            <button
                                onClick={() => setShowTrace(!showTrace)}
                                className="text-[10px] font-black text-slate-500 hover:text-slate-900 transition-colors uppercase tracking-[0.2em] flex items-center gap-2"
                            >
                                <Terminal size={12} className="opacity-40" />
                                <span>{showTrace ? 'Seal Trace' : 'Audit Pipeline'}</span>
                            </button>
                        )}
                    </div>

                    <AnimatePresence>
                        {showTrace && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden mt-6"
                            >
                                <div className="p-6 rounded-2xl bg-black/40 border border-white/[0.03] backdrop-blur-md font-mono text-[11px] text-slate-500 leading-relaxed max-h-72 overflow-y-auto custom-scrollbar selection:bg-emerald-500/20">
                                    <div className="flex items-center gap-2 mb-4 opacity-50">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                        <span className="uppercase tracking-widest text-[9px] font-black">Secure Reasoning Kernel</span>
                                    </div>
                                    {ai_analysis.thought_trace}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer Component: Grounded Sources */}
                {ai_analysis?.sources && ai_analysis.sources.length > 0 && (
                    <div className="flex flex-wrap gap-3 pt-6 relative z-10">
                        {ai_analysis.sources.slice(0, 3).map((s: AnalysisSource, i: number) => (
                            <a
                                key={i}
                                href={s.uri || s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-[9px] font-bold text-slate-500 hover:text-emerald-400/80 hover:border-emerald-500/20 hover:bg-emerald-500/5 transition-all duration-500"
                            >
                                <LinkIcon size={10} className="opacity-40" />
                                <span className="uppercase tracking-wider">{(s.title || 'Source').substring(0, 20)}</span>
                            </a>
                        ))}
                    </div>
                )}
            </div>
        </motion.div>
    );
};
