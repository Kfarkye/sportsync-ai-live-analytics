// ===================================================================
// PregameIntelCards.tsx
// ARCHITECTURE: "SOTA Production" • Apple/Google Quality Standards
// ===================================================================

import React, { useState, useEffect, Component } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ExternalLink, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '../../lib/essence';
import { Match } from '../../types';
import { pregameIntelService, PregameIntelResponse, IntelCard } from '../../services/pregameIntelService';

// ─────────────────────────────────────────────────────────────────
// 🎨 DESIGN TOKENS (Apple HIG + Google Material 3)
// ─────────────────────────────────────────────────────────────────

const SPRING = { type: "spring" as const, stiffness: 400, damping: 30 };
const STAGGER_CHILDREN = { staggerChildren: 0.08, delayChildren: 0.1 };

// Strip markdown for pristine display
const stripMarkdown = (text: string): string => {
    if (!text) return '';
    return text
        .replace(/#{1,6}\s*/g, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .trim();
};

// ─────────────────────────────────────────────────────────────────
// 🪝 DATA LAYER
// ─────────────────────────────────────────────────────────────────

const useIntelQuery = (match: Match, externalIntel?: PregameIntelResponse | null) => {
    const [data, setData] = useState<PregameIntelResponse | null>(externalIntel || null);
    const [status, setStatus] = useState<'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'>(externalIntel ? 'SUCCESS' : 'LOADING');
    const [retryCount, setRetryCount] = useState(0);

    useEffect(() => {
        if (externalIntel) { setData(externalIntel); setStatus('SUCCESS'); return; }

        const controller = new AbortController();
        const fetchData = async () => {
            setStatus('LOADING');
            try {
                const timeoutId = setTimeout(() => controller.abort(), 12000);
                const result = await pregameIntelService.fetchIntel(
                    match.id, match.homeTeam.name, match.awayTeam.name, match.sport, match.leagueId,
                    typeof match.startTime === 'string' ? match.startTime : match.startTime?.toISOString(),
                    match.current_odds?.homeSpread, match.current_odds?.total
                );
                clearTimeout(timeoutId);
                if (!controller.signal.aborted && result) { setData(result); setStatus('SUCCESS'); }
            } catch { if (!controller.signal.aborted) setStatus('ERROR'); }
        };
        fetchData();
        return () => controller.abort();
    }, [match.id, externalIntel, retryCount]);

    return { data, status, retry: () => setRetryCount(c => c + 1) };
};

// ─────────────────────────────────────────────────────────────────
// 🎭 MOTION VARIANTS (Staggered Orchestration)
// ─────────────────────────────────────────────────────────────────

const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: STAGGER_CHILDREN }
};

const pickVariants = {
    hidden: { opacity: 0, y: -20, scale: 0.95 },
    visible: { opacity: 1, y: 0, scale: 1, transition: { ...SPRING, delay: 0 } }
};

const headlineVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { ...SPRING, delay: 0.15 } }
};

const cardVariants = {
    hidden: { opacity: 0, x: -10 },
    visible: { opacity: 1, x: 0, transition: SPRING }
};

// ─────────────────────────────────────────────────────────────────
// 📊 CONFIDENCE GLOW (Semantic Color Theory)
// ─────────────────────────────────────────────────────────────────

const getConfidenceGlow = (score?: number): string => {
    if (!score || score < 60) return '';
    if (score >= 80) return 'before:absolute before:inset-0 before:bg-gradient-to-br before:from-emerald-500/[0.03] before:to-transparent before:rounded-3xl before:pointer-events-none';
    if (score >= 70) return 'before:absolute before:inset-0 before:bg-gradient-to-br before:from-blue-500/[0.02] before:to-transparent before:rounded-3xl before:pointer-events-none';
    return '';
};

// ─────────────────────────────────────────────────────────────────
// 🏗️ COMPONENTS
// ─────────────────────────────────────────────────────────────────

const LoadingState = () => (
    <div className="py-32 flex flex-col items-center justify-center gap-8">
        <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
        >
            <Loader2 size={18} className="text-zinc-700" />
        </motion.div>
        <span className="text-[10px] font-medium text-zinc-700 uppercase tracking-[0.25em]">
            Analyzing
        </span>
    </div>
);

// --- HELPER: Date Awareness ---
const getEdgeLabel = (startTime: string | Date): string => {
    const start = new Date(startTime);
    const now = new Date();

    // Reset times to compare dates specifically
    const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const diffDays = Math.round((startDate.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today's Edge";
    if (diffDays === 1) return "Tomorrow's Edge";

    return start.toLocaleDateString('en-US', { weekday: 'long' }) + "'s Edge";
};

// THE PICK - 1-Second Read (Magazine Cover Style)
const PickDisplay = ({ pick, juice, startTime }: { pick: string; juice?: string; startTime: string | Date }) => (
    <motion.div variants={pickVariants} className="mb-12">
        <div className="flex items-center gap-2 mb-3">
            <motion.div
                className="w-2 h-2 rounded-full bg-emerald-500"
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
            />
            <span className="text-[9px] font-semibold uppercase tracking-[0.3em] text-emerald-500/60">
                {getEdgeLabel(startTime)}
            </span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight leading-none">
            {pick}
            <span className="text-zinc-600 text-xl font-medium ml-3">{juice || '−110'}</span>
        </h1>
    </motion.div>
);

// THE THESIS - Headline Only (Cards provide detail)
const ThesisDisplay = ({ headline }: { headline: string }) => (
    <motion.div variants={headlineVariants} className="mb-12">
        <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight leading-snug">
            {stripMarkdown(headline)}
        </h2>
    </motion.div>
);

// INSIGHT CARD - 30-Second Read (Progressive Disclosure)
const InsightCard = ({ card, index, isEdge }: { card: IntelCard; index: number; isEdge: boolean }) => {
    const [expanded, setExpanded] = useState(false);

    return (
        <motion.div
            variants={cardVariants}
            className={cn(
                "relative py-8 group cursor-pointer",
                index > 0 && "border-t border-white/[0.03]"
            )}
            onClick={() => setExpanded(!expanded)}
        >
            {/* Ambient glow for edge cards */}
            {isEdge && (
                <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-1 h-12 bg-gradient-to-b from-transparent via-emerald-500/20 to-transparent rounded-full" />
            )}

            <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                    {/* Category Label */}
                    <span className={cn(
                        "text-[9px] font-bold uppercase tracking-[0.25em] mb-3 block",
                        isEdge ? "text-emerald-500/70" : "text-amber-500/50"
                    )}>
                        {card.category}
                    </span>

                    {/* Thesis - Primary Content */}
                    <h4 className="text-[16px] font-semibold text-white leading-snug mb-2 group-hover:text-zinc-300 transition-colors">
                        {stripMarkdown(card.thesis)}
                    </h4>

                    {/* Market Implication - Secondary */}
                    <p className="text-[13px] text-zinc-600 leading-relaxed">
                        {stripMarkdown(card.market_implication)}
                    </p>
                </div>

                {/* Expand Indicator */}
                {card.details && card.details.length > 0 && (
                    <motion.div
                        animate={{ rotate: expanded ? 180 : 0 }}
                        className="text-zinc-700 mt-1"
                    >
                        <ChevronDown size={16} />
                    </motion.div>
                )}
            </div>

            {/* Expanded Details - Deep Intel */}
            <AnimatePresence>
                {expanded && card.details && card.details.length > 0 && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="pt-6 space-y-3">
                            {card.details.map((detail: string, dIdx: number) => (
                                <div
                                    key={dIdx}
                                    className="flex items-start gap-3 text-[12px] text-zinc-500"
                                >
                                    <div className="w-1 h-1 rounded-full bg-zinc-700 mt-2 shrink-0" />
                                    <span>{stripMarkdown(detail)}</span>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

// SOURCES FOOTER - Attribution (Gemini Style)
const SourcesFooter = ({ sources }: { sources: any[] }) => (
    <motion.div
        variants={cardVariants}
        className="pt-8 mt-8 border-t border-white/[0.02]"
    >
        <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-zinc-700 block mb-4">
            Sources
        </span>
        <div className="flex flex-wrap gap-2">
            {sources.slice(0, 3).map((source: any, i: number) => (
                <a
                    key={i}
                    href={source.uri || source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                    <ExternalLink size={10} />
                    {source.title ? (source.title.length > 30 ? source.title.substring(0, 30) + '…' : source.title) : 'Source'}
                </a>
            ))}
        </div>
    </motion.div>
);

// ─────────────────────────────────────────────────────────────────
// 🏛️ MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

export const PregameIntelCards = ({
    match,
    hideFooter = false,
    intel: externalIntel
}: {
    match: Match;
    hideFooter?: boolean;
    intel?: PregameIntelResponse | null
}) => {
    const { data: intel, status, retry } = useIntelQuery(match, externalIntel);

    if (status === 'LOADING') return <LoadingState />;

    if (status === 'ERROR' || !intel || !intel.cards?.length) {
        return (
            <div className="py-24 flex flex-col items-center justify-center gap-6">
                <ShieldCheck size={20} className="text-zinc-800" />
                <span className="text-[11px] text-zinc-700">Intel Unavailable</span>
                <button
                    onClick={retry}
                    className="text-[10px] font-semibold text-zinc-600 hover:text-white transition-colors uppercase tracking-widest"
                >
                    Retry
                </button>
            </div>
        );
    }

    const confidenceScore = (intel as any).confidence_score;

    return (
        <motion.div
            className={cn(
                "relative px-1",
                getConfidenceGlow(confidenceScore)
            )}
            variants={containerVariants}
            initial="hidden"
            animate="visible"
        >
            {/* THE PICK - Immediate Visual Impact */}
            {intel.recommended_pick && (
                <PickDisplay
                    pick={intel.recommended_pick}
                    juice={(intel as any).spread_juice}
                    startTime={typeof match.startTime === 'string' ? match.startTime : match.startTime?.toISOString()}
                />
            )}

            {/* THE THESIS - Quick Context */}
            <ThesisDisplay headline={intel.headline} />

            {/* INSIGHT CARDS - Deep Analysis */}
            <div className="mb-8">
                {intel.cards.map((card: IntelCard, idx: number) => (
                    <InsightCard
                        key={idx}
                        card={card}
                        index={idx}
                        isEdge={card.category?.toLowerCase().includes('edge') || idx === 0}
                    />
                ))}
            </div>

            {/* SOURCES - Trust Layer */}
            {!hideFooter && intel.sources && intel.sources.length > 0 && (
                <SourcesFooter sources={intel.sources} />
            )}
        </motion.div>
    );
};

// ─────────────────────────────────────────────────────────────────
// 🛡️ ERROR BOUNDARY
// ─────────────────────────────────────────────────────────────────

class IntelErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
    state = { hasError: false };
    static getDerivedStateFromError() { return { hasError: true }; }
    render() {
        if (this.state.hasError) return null;
        return this.props.children;
    }
}

export default function SafePregameIntelCards(props: any) {
    return (
        <IntelErrorBoundary>
            <PregameIntelCards {...props} />
        </IntelErrorBoundary>
    );
}
