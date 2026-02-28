import React, { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Link as LinkIcon, Timer, ArrowUp, AlertCircle } from 'lucide-react';
import { Match, LiveAIAnalysis, SharpData } from '@/types';
import { isGameInProgress, isGameFinished, getDbMatchId } from '../../utils/matchUtils';
import { cn, ESSENCE } from '@/lib/essence';
import { useLiveGameState } from '../../hooks/useLiveGameState';
import { supabase } from '../../lib/supabase';

// ============================================================================
// TYPES
// ============================================================================

interface LiveAIInsightProps {
    match: Match;
}

interface AnalysisSource {
    title?: string;
    uri?: string;
    url?: string;
}

interface OnDemandAnalysis {
    match_id: string; // Tracks strict ownership of data to prevent cross-game bleed
    success?: boolean;
    sharp_data?: SharpData;
    thought_trace?: string;
    sources?: AnalysisSource[];
    _fetchedAt: string;
}

type FetchStatus = 'idle' | 'fetching' | 'success' | 'error';

// ============================================================================
// UTILITIES
// ============================================================================

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
const BEAT_BARS = [1, 2, 3];
const LOADER_BARS = [1, 2, 3];

/** Safely stabilizes the latest object without triggering effect re-renders */
function useLatestRef<T>(value: T) {
    const ref = useRef<T>(value);
    useIsomorphicLayoutEffect(() => { ref.current = value; }, [value]);
    return ref;
}

/** Safely coerces unpredictable LLM outputs into React-safe strings to prevent WSOD crashes */
const safeString = (val: unknown, fallback = ''): string => {
    if (val === undefined || val === null) return fallback;
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    try { return JSON.stringify(val); } catch { return fallback; }
};

/** Prevents XSS attacks and JS TypeErrors from hallucinated LLM URIs */
const sanitizeUrl = (url?: unknown): string | null => {
    if (!url || typeof url !== 'string') return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
        return null;
    } catch {
        if (url.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) return `https://${url}`;
        return null;
    }
};

/** Normalizes LLM unit sizes. Handles raw numbers (1.5), strings ("1.5U"), and valid 0s. */
const formatUnitSize = (unit?: unknown): string => {
    if (unit === 0 || unit === '0') return '0.00U';
    if (!unit) return '0.00U';
    const str = String(unit).toUpperCase();
    return str.endsWith('U') ? str : `${str}U`;
};

// ============================================================================
// COMPONENT
// ============================================================================

export const LiveAIInsight: React.FC<LiveAIInsightProps> = ({ match }) => {
    const safeMatchId = match?.id ? String(match.id) : '';

    // 1. Hooks & State
    const { state: liveState, loading: liveLoading } = useLiveGameState(safeMatchId, match?.leagueId || '');

    const [fetchStatus, setFetchStatus] = useState<FetchStatus>('idle');
    const [onDemandAnalysis, setOnDemandAnalysis] = useState<OnDemandAnalysis | null>(null);
    const [showTrace, setShowTrace] = useState(false);
    const [showFullRead, setShowFullRead] = useState(false);

    // Prevents SSR Hydration errors for local Date formatting
    const [isClient, setIsClient] = useState(false);
    useEffect(() => { setIsClient(true); }, []);

    // Refs for network locking and stale-closure prevention
    const activeFetchRef = useRef<string | null>(null);
    const matchRef = useLatestRef(match);
    const liveStateRef = useLatestRef(liveState);

    // 2. Derived Statuses
    const isLive = isGameInProgress(match?.status);
    const isFinal = isGameFinished(match?.status);

    // 3. ID Collision Reset (Protects against DOM reuse when navigating between games)
    useEffect(() => {
        if (!safeMatchId) return;
        setFetchStatus('idle');
        setOnDemandAnalysis(null);
        setShowTrace(false);
        setShowFullRead(false);
        activeFetchRef.current = null;
    }, [safeMatchId]);

    // 4. AI Analysis Resolution
    const resolvedAnalysis = useMemo<LiveAIAnalysis | null>(() => {
        if (liveState?.ai_analysis) return liveState.ai_analysis;
        if (onDemandAnalysis?.sharp_data && onDemandAnalysis.match_id === safeMatchId) {
            return {
                sharp_data: onDemandAnalysis.sharp_data,
                generated_at: onDemandAnalysis._fetchedAt,
                thought_trace: onDemandAnalysis.thought_trace,
                sources: onDemandAnalysis.sources
            };
        }
        return null;
    }, [liveState?.ai_analysis, onDemandAnalysis, safeMatchId]);

    const sharp_data = resolvedAnalysis?.sharp_data;

    // ============================================================================
    // EFFECTS (The Network Pipeline)
    // ============================================================================

    useEffect(() => {
        if (!isLive || !safeMatchId) return;
        if (resolvedAnalysis) return;
        if (activeFetchRef.current === safeMatchId) return; // FSM Lock

        let isMounted = true;
        activeFetchRef.current = safeMatchId;
        setFetchStatus('fetching');

        const currentMatch = matchRef.current;
        const currentLiveState = liveStateRef.current;

        const safeEvents = Array.isArray(currentMatch.events) ? currentMatch.events.slice(-15) : undefined;
        const safeLeaders = Array.isArray(currentMatch.leaders) ? currentMatch.leaders.slice(0, 6) : undefined;

        const aScore = currentLiveState?.away_score ?? currentMatch.awayScore ?? 0;
        const hScore = currentLiveState?.home_score ?? currentMatch.homeScore ?? 0;

        const snapshot = {
            score: `${aScore}-${hScore}`,
            away_team: currentMatch.awayTeam?.name || 'Away',
            home_team: currentMatch.homeTeam?.name || 'Home',
            away_score: aScore,
            home_score: hScore,
            clock: currentLiveState?.clock || currentMatch.displayClock || '00:00',
            period: currentLiveState?.period ?? currentMatch.period ?? 1,
            market_total: currentLiveState?.deterministic_signals?.market_total ?? currentMatch.current_odds?.total ?? currentMatch.odds?.total ?? null,
            fair_total: currentLiveState?.deterministic_signals?.deterministic_fair_total ?? null,
            deterministic_signals: currentLiveState?.deterministic_signals ?? null,
            last_play: currentLiveState?.last_play || currentMatch.lastPlay || null,
            sport: currentMatch.sport || 'unknown',
            league_id: currentMatch.leagueId || 'unknown',
            stats: currentMatch.stats,
            leaders: safeLeaders,
            events: safeEvents,
        };

        const dbId = getDbMatchId(safeMatchId, currentMatch.leagueId || '');

        supabase.functions.invoke('analyze-match', {
            body: { match_id: dbId, snapshot }
        })
            .then(({ data, error }) => {
                if (!isMounted) {
                    activeFetchRef.current = null;
                    return;
                }

                if (error || !data?.success || !data?.sharp_data) {
                    console.warn('[LiveAIInsight] Analysis invocation failed:', error);
                    setFetchStatus('error');
                    activeFetchRef.current = null;
                    return;
                }

                setOnDemandAnalysis({
                    ...data,
                    match_id: safeMatchId,
                    _fetchedAt: new Date().toISOString()
                });
                setFetchStatus('success');
            })
            .catch((err) => {
                if (!isMounted) {
                    activeFetchRef.current = null;
                    return;
                }
                console.error('[LiveAIInsight] Network/Edge failure:', err);
                setFetchStatus('error');
                activeFetchRef.current = null;
            });

        return () => {
            isMounted = false;
            if (activeFetchRef.current === safeMatchId) {
                activeFetchRef.current = null;
            }
        };

    }, [isLive, safeMatchId, resolvedAnalysis, matchRef, liveStateRef]);

    // ============================================================================
    // RENDER GUARDS
    // ============================================================================

    if (!match?.homeTeam || !match?.awayTeam) return null;
    if (!isLive && !isFinal) return null;

    const showError = fetchStatus === 'error' && !resolvedAnalysis;
    const showLiveLoading = liveLoading && !liveState;
    const showComputing = isLive && fetchStatus === 'fetching' && !sharp_data;

    if (showError) {
        return (
            <div className="my-8 p-6 flex items-center justify-center gap-3 bg-zinc-900/30 rounded-2xl border border-white/5" role="alert">
                <AlertCircle size={14} className="text-slate-500" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                    Live Analysis Temporarily Unavailable
                </span>
            </div>
        );
    }

    if (showLiveLoading) {
        return (
            <div className="my-8 p-16 flex flex-col items-center justify-center bg-[#080808]/60 backdrop-blur-xl rounded-3xl border border-white/5 shadow-sm" aria-busy="true" aria-live="polite">
                <motion.div
                    animate={{ rotate: 360, scale: [1, 1.1, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    className="w-12 h-12 border-2 border-zinc-800 border-t-emerald-500 rounded-full mb-6"
                />
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 animate-pulse">
                    Synchronizing Intelligence
                </span>
            </div>
        );
    }

    if (showComputing) {
        return (
            <div className="my-8" aria-busy="true" aria-label="Computing live advantages" aria-live="polite">
                <div className={cn("backdrop-blur-2xl p-8 space-y-8 overflow-hidden relative group", ESSENCE.card.base)}>
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent opacity-50 pointer-events-none" />

                    <div className="flex items-center justify-between relative z-10" aria-hidden="true">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <div className="h-2 w-32 bg-zinc-800 rounded-full overflow-hidden relative">
                                <motion.div
                                    animate={{ x: ['-100%', '200%'] }}
                                    transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                    className="absolute inset-y-0 left-0 w-1/2 bg-emerald-500/50 rounded-full"
                                />
                            </div>
                        </div>
                        <div className="w-20 h-8 bg-zinc-800/50 rounded-xl animate-pulse" />
                    </div>

                    <div className="space-y-4 relative z-10" aria-hidden="true">
                        <div className="w-full h-4 bg-zinc-800/30 rounded-lg animate-pulse" />
                        <div className="w-4/5 h-4 bg-zinc-800/20 rounded-lg animate-pulse" />
                    </div>

                    <div className="pt-8 border-t border-white/[0.03] flex items-center justify-between relative z-10">
                        <div className="flex items-center gap-2">
                            <div className="flex gap-0.5" aria-hidden="true">
                                {LOADER_BARS.map(i => (
                                    <motion.div
                                        key={`loader-${i}`}
                                        animate={{ height: [4, 12, 4], opacity: [0.3, 1, 0.3] }}
                                        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                                        className="w-[2px] bg-emerald-500/60 rounded-full"
                                    />
                                ))}
                            </div>
                            <span className="text-[10px] font-black text-emerald-500/60 uppercase tracking-[0.2em] ml-1">
                                Computing Alpha
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!sharp_data) return null;

    // ============================================================================
    // DATA MAPPING & THEME ARCHITECTURE
    // ============================================================================

    const ui = useMemo(() => {
        const rawSide = String(sharp_data.recommendation?.side || 'PASS').toUpperCase();
        const isEdge = rawSide !== 'PASS' && rawSide !== 'AVOID';
        const marketType = sharp_data.recommendation?.market_type ?? 'TOTAL';

        const displaySide = rawSide === 'HOME'
            ? (match.homeTeam?.shortName || (match.homeTeam?.name || 'TBA').substring(0, 3).toUpperCase())
            : rawSide === 'AWAY'
                ? (match.awayTeam?.shortName || (match.awayTeam?.name || 'TBA').substring(0, 3).toUpperCase())
                : rawSide;

        const confVal = sharp_data.confidence_level ?? sharp_data.confidence_rating ?? "—";
        const rawConf = String(confVal).replace(/%/g, '');
        const confNum = Number(rawConf);
        const displayConf = Number.isFinite(confNum) ? `${confNum}%` : "—";

        const score = liveState?.away_score !== undefined
            ? `${liveState.away_score}-${liveState.home_score}`
            : `${match.awayScore ?? 0}-${match.homeScore ?? 0}`;

        const clock = liveState?.clock || match.displayClock || '—';

        const parsedDateMs = resolvedAnalysis?.generated_at ? Date.parse(resolvedAnalysis.generated_at) : NaN;
        const formattedTime = (isClient && !Number.isNaN(parsedDateMs))
            ? new Date(parsedDateMs).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
            : null;

        const formattedUnitSize = formatUnitSize(sharp_data.recommendation?.unit_size);
        const accentColor = isEdge ? "text-emerald-400" : "text-slate-500";

        return {
            rawSide,
            isEdge,
            marketType,
            displaySide,
            displayConf,
            score,
            clock,
            formattedTime,
            formattedUnitSize,
            accentColor,
            digestId: `digest-${safeMatchId}`,
            traceId: `trace-${safeMatchId}`,
        };
    }, [sharp_data, liveState, match, resolvedAnalysis?.generated_at, isClient, safeMatchId]);

    const executivePillars = useMemo(() => {
        const bullets = sharp_data?.executive_bullets;
        if (!bullets) return [];
        return [
            { label: 'Situational', val: bullets.spot },
            { label: 'Tactical', val: bullets.driver },
            { label: 'Verdict', val: bullets.verdict }
        ].filter(p => p.val);
    }, [sharp_data?.executive_bullets]);

    const sourceLinks = useMemo(() => {
        const sources = resolvedAnalysis?.sources ?? [];
        return sources
            .slice(0, 3)
            .map((s) => {
                const rawLink = s.uri || s.url;
                const safeLink = sanitizeUrl(rawLink);
                if (!safeLink) return null;
                return {
                    href: safeLink,
                    title: safeString(s.title || 'Source').substring(0, 25),
                };
            })
            .filter(Boolean) as { href: string; title: string }[];
    }, [resolvedAnalysis?.sources]);

    // ============================================================================
    // RENDER PIPELINE
    // ============================================================================

    return (
        <motion.div
            layout="position"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="my-8"
        >
            <div className={cn("backdrop-blur-3xl p-8 space-y-7 relative overflow-hidden group border border-white/5", ESSENCE.card.base)}>

                <div
                    className={cn(
                        "absolute -top-24 -right-24 w-64 h-64 blur-[100px] opacity-[0.15] transition-colors duration-1000 pointer-events-none rounded-full transform-gpu",
                        ui.isEdge ? "bg-emerald-500" : "bg-blue-500"
                    )}
                    aria-hidden="true"
                />

                <header className="flex items-center justify-between relative z-10">
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                            <div className="flex gap-0.5" aria-hidden="true">
                                {BEAT_BARS.map(i => (
                                    <motion.div
                                        key={`beat-${i}`}
                                        animate={{ height: [4, 10, 4], opacity: [0.4, 1, 0.4] }}
                                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                                        className={cn("w-[2px] rounded-full", ui.isEdge ? "bg-emerald-500" : "bg-zinc-500")}
                                    />
                                ))}
                            </div>
                            <span className={cn("text-[10px] font-black tracking-[0.2em] uppercase", ui.accentColor)}>
                                {ui.isEdge ? "Tactical Alpha Detected" : "Market Efficiency Confirmed"}
                            </span>
                        </div>
                        {ui.formattedTime && (
                            <span className="text-[9px] font-mono text-slate-500 tracking-tighter uppercase opacity-60" suppressHydrationWarning>
                                Audit Hash: {ui.formattedTime} • v4.2 ARCHITECT
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="px-2.5 py-1 bg-white/5 border border-white/5 rounded-lg hidden sm:flex items-center gap-1.5 shadow-inner">
                            <span className="text-[10px] font-black text-slate-400 tracking-widest uppercase">{ui.marketType}</span>
                        </div>
                        <div className={cn(
                            "px-4 py-2 rounded-2xl flex items-center gap-3 border shadow-sm transition-all duration-700",
                            ui.isEdge ? "bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.05)] ring-1 ring-emerald-500/10" : "bg-zinc-900/60 border-white/10"
                        )}>
                            <span className={cn("text-xs font-black tracking-tight uppercase", ui.accentColor)}>
                                {ui.rawSide === 'PASS' ? 'Efficiency Clear' : ui.displaySide}
                            </span>
                            {ui.isEdge && (
                                <>
                                    <div className="w-[1px] h-4 bg-white/10" aria-hidden="true" />
                                    <span className="text-[11px] font-mono font-bold text-slate-300 tabular-nums">
                                        {ui.formattedUnitSize}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </header>

                <h2 className="text-[22px] font-bold text-slate-200 tracking-tight leading-[1.15] relative z-10 lg:pr-12">
                    {safeString(sharp_data?.headline, "System processing insights...")}
                </h2>

                <section className="grid grid-cols-3 gap-8 py-5 border-y border-white/10 relative z-10" aria-label="Forensic Snapshot">
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black text-slate-500 tracking-widest uppercase">Scoreboard</span>
                        <span className="font-mono text-[16px] font-bold text-slate-200 tabular-nums tracking-tight">
                            {ui.score}
                        </span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black text-slate-500 tracking-widest uppercase">Game Clock</span>
                        <div className="flex items-center gap-1.5">
                            <Timer size={12} className="text-slate-400" aria-hidden="true" />
                            <span className="font-mono text-[16px] font-bold text-slate-200 tabular-nums tracking-tight">
                                {ui.clock}
                            </span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black text-slate-500 tracking-widest uppercase">Confidence</span>
                        <div className="flex items-center gap-1.5">
                            <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }} className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                            <span className="font-mono text-[16px] font-bold text-slate-200 tabular-nums tracking-tight">
                                {ui.displayConf}
                            </span>
                        </div>
                    </div>
                </section>

                {executivePillars.length > 0 && (
                    <section className="space-y-4 relative z-10 py-1" aria-label="Strategic Analysis">
                        {executivePillars.map((pillar, i) => (
                            <motion.div
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.1 * i }}
                                key={`pillar-${i}`}
                                className="flex items-start gap-4 group"
                            >
                                <div className={cn(
                                    "mt-2 w-1.5 h-1.5 shrink-0 rounded-full transition-all duration-500",
                                    ui.isEdge ? "bg-slate-400 group-hover:bg-emerald-500/70 shadow-[0_0_8px_transparent] group-hover:shadow-emerald-500/30" : "bg-slate-600"
                                )} aria-hidden="true" />
                                <div className="flex-1 flex flex-col gap-0.5">
                                    <span className={cn(
                                        "text-[9px] font-black uppercase tracking-[0.15em] transition-colors",
                                        ui.isEdge ? "text-slate-500 group-hover:text-emerald-500/80" : "text-slate-500"
                                    )}>
                                        {pillar.label}
                                    </span>
                                    <span className="text-[14px] text-slate-300 font-medium leading-[1.4] tracking-tight">
                                        {safeString(pillar.val)}
                                    </span>
                                </div>
                            </motion.div>
                        ))}
                    </section>
                )}

                <div className="pt-2 relative z-10">
                    <AnimatePresence mode="wait">
                        {showFullRead && sharp_data?.the_read && (
                            <motion.div
                                key="digest-content"
                                id={ui.digestId}
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.3, ease: 'easeInOut' }}
                                className="overflow-hidden"
                            >
                                <p className="text-[13.5px] text-slate-400 leading-[1.6] tracking-tight pb-5 border-l border-white/[0.05] pl-4 italic bg-white/[0.01] pt-3 pr-3 rounded-r-lg shadow-inner">
                                    {safeString(sharp_data.the_read)}
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <nav className="flex items-center gap-6">
                        {sharp_data?.the_read && (
                            <button
                                type="button"
                                onClick={() => setShowFullRead(!showFullRead)}
                                aria-expanded={showFullRead}
                                aria-controls={ui.digestId}
                                className="text-[10px] font-black text-emerald-500 hover:text-emerald-400 transition-all flex items-center gap-2 uppercase tracking-widest group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
                            >
                                <span className="bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 group-hover:bg-emerald-500/20 transition-all shadow-sm">
                                    {showFullRead ? 'Collapse Digest' : 'Read Deep Dive'}
                                </span>
                                <motion.div animate={{ rotate: showFullRead ? 0 : 180 }} transition={{ duration: 0.3 }}>
                                    <ArrowUp size={12} className="transition-colors duration-500" aria-hidden="true" />
                                </motion.div>
                            </button>
                        )}

                        {resolvedAnalysis?.thought_trace && typeof resolvedAnalysis.thought_trace === 'string' && (
                            <button
                                type="button"
                                onClick={() => setShowTrace(!showTrace)}
                                aria-expanded={showTrace}
                                aria-controls={ui.traceId}
                                className="text-[10px] font-black text-slate-500 hover:text-slate-300 transition-colors uppercase tracking-[0.2em] flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 rounded px-1"
                            >
                                <Terminal size={12} className="opacity-40" aria-hidden="true" />
                                <span>{showTrace ? 'Seal Trace' : 'Audit Pipeline'}</span>
                            </button>
                        )}
                    </nav>

                    <AnimatePresence mode="wait">
                        {showTrace && resolvedAnalysis?.thought_trace && (
                            <motion.div
                                key="trace-content"
                                id={ui.traceId}
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.3, ease: 'easeInOut' }}
                                className="overflow-hidden mt-6"
                            >
                                <div className="p-6 rounded-2xl bg-zinc-900/80 border border-white/5 shadow-inner font-mono text-[11px] text-slate-400 leading-relaxed max-h-72 overflow-y-auto custom-scrollbar selection:bg-emerald-500/30">
                                    <div className="flex items-center gap-2 mb-4 opacity-70">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" aria-hidden="true" />
                                        <span className="uppercase tracking-widest text-[9px] font-black">Secure Reasoning Kernel</span>
                                    </div>
                                    <div className="whitespace-pre-wrap">
                                        {safeString(resolvedAnalysis.thought_trace)}
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {sourceLinks.length > 0 && (
                    <footer className="flex flex-wrap gap-3 pt-6 relative z-10 border-t border-white/5 mt-2" aria-label="Reference Sources">
                        {sourceLinks.map((s, i) => (
                            <a
                                key={`source-${i}`}
                                href={s.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[9px] font-bold text-slate-400 hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-emerald-500/10 transition-all duration-300 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                            >
                                <LinkIcon size={10} className="opacity-50" aria-hidden="true" />
                                <span className="uppercase tracking-wider">{s.title}</span>
                            </a>
                        ))}
                    </footer>
                )}
            </div>
        </motion.div>
    );
};

export default LiveAIInsight;
