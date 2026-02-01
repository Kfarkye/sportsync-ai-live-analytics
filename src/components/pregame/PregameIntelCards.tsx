// ===================================================================
// PregameIntelCards.tsx
// ARCHITECTURE: "SOTA Production" • Apple/Google Quality Standards
// ===================================================================

import React, { useState, useEffect, useMemo, Component } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import {
    ShieldCheck, ExternalLink, ChevronDown,
    Target, TrendingUp, Cpu, AlertOctagon, Zap
} from 'lucide-react';
import { cn } from '../../lib/essence';
import { Match } from '../../types';
import { pregameIntelService, PregameIntelResponse, IntelCard } from '../../services/pregameIntelService';
import { cleanHeadline, cleanCardThesis } from '../../lib/intel-guards';

// ─────────────────────────────────────────────────────────────────
// 🎨 DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────

const SPRING = { type: "spring", stiffness: 450, damping: 35 };
const STAGGER = { staggerChildren: 0.08, delayChildren: 0.05 };

const SORT_ORDER = ["The Spot", "The Trend", "The Engine", "The Trap", "X-Factor"];

const SECTION_CONFIG: Record<string, {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    color: string;
    border: string;
    bg: string;
}> = {
    "The Spot": { icon: Target, color: "text-zinc-100", border: "border-l-zinc-500", bg: "bg-zinc-500/10" },
    "The Trend": { icon: TrendingUp, color: "text-blue-400", border: "border-l-blue-500", bg: "bg-blue-500/10" },
    "The Engine": { icon: Cpu, color: "text-emerald-400", border: "border-l-emerald-500", bg: "bg-emerald-500/10" },
    "The Trap": { icon: AlertOctagon, color: "text-amber-500", border: "border-l-amber-500", bg: "bg-amber-500/10" },
    "X-Factor": { icon: Zap, color: "text-purple-400", border: "border-l-purple-500", bg: "bg-purple-500/10" },
};

const RenderRichText = React.memo(({ text, className }: { text: string; className?: string }) => {
    if (!text) return null;
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return (
        <span className={className}>
            {parts.map((part, i) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={i} className="font-bold text-white">{part.slice(2, -2)}</strong>;
                }
                return <React.Fragment key={i}>{part}</React.Fragment>;
            })}
        </span>
    );
});

// ─────────────────────────────────────────────────────────────────
// 🧠 HELPERS
// ─────────────────────────────────────────────────────────────────

function toISOOrNull(v: any): string | null {
    if (!v) return null;
    if (typeof v === 'string') {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
    return null;
}

// Extract team name from pick string without breaking multi-word teams.
// Examples:
// "Indiana Pacers +1.5" -> "Indiana Pacers"
// "Los Angeles Lakers ML" -> "Los Angeles Lakers"
// "OVER 219.5" -> "OVER"
function extractTeamFromPick(pick?: string | null): string {
    if (!pick) return "Team";
    const s = pick.trim();
    if (!s) return "Team";

    // totals
    if (/^(over|under)\b/i.test(s)) return s.split(/\s+/).slice(0, 1).join(' ').toUpperCase();

    // moneyline marker
    const mlIdx = s.toLowerCase().lastIndexOf(' ml');
    const core = mlIdx > 0 ? s.slice(0, mlIdx).trim() : s;

    // stop before first token that looks like a number/spread (e.g., +2.5, -110, 219.5)
    const tokens = core.split(/\s+/);
    const out: string[] = [];
    for (const t of tokens) {
        if (/^[+\-]?\d+(\.\d+)?$/.test(t)) break;
        if (/^\(?[+\-]?\d{3,5}\)?$/.test(t)) break; // odds-like
        out.push(t);
    }
    return out.length ? out.join(' ') : tokens[0];
}

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
                const timeoutId = setTimeout(() => controller.abort(), 10000);

                const startTimeISO = toISOOrNull((match as any).startTime);

                const result = await pregameIntelService.fetchIntel(
                    (match as any).id,
                    (match as any).homeTeam?.name,
                    (match as any).awayTeam?.name,
                    (match as any).sport,
                    (match as any).leagueId,
                    startTimeISO || undefined,
                    (match as any).current_odds?.homeSpread,
                    (match as any).current_odds?.total
                );

                clearTimeout(timeoutId);
                if (!controller.signal.aborted && result) { setData(result); setStatus('SUCCESS'); }
            } catch {
                if (!controller.signal.aborted) setStatus('ERROR');
            }
        };

        fetchData();
        return () => controller.abort();
    }, [externalIntel, retryCount, (match as any).id]);

    return { data, status, retry: () => setRetryCount(c => c + 1) };
};

// ─────────────────────────────────────────────────────────────────
// 🏗️ SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────

const SignalMeter = ({ tier }: { tier: string }) => {
    const level = tier === "HIGH" ? 3 : tier === "MEDIUM" ? 2 : 1;
    const color = tier === "HIGH" ? "bg-emerald-500" : tier === "MEDIUM" ? "bg-amber-500" : "bg-zinc-600";

    return (
        <div className="flex items-center gap-1.5" title={`Signal Strength: ${tier}`}>
            {[1, 2, 3].map(i => (
                <div
                    key={i}
                    className={cn(
                        "h-1.5 w-3 rounded-[1px] transition-all duration-500",
                        i <= level ? color : "bg-zinc-800"
                    )}
                />
            ))}
        </div>
    );
};

const EdgeLabel = ({ startTimeISO }: { startTimeISO: string | null }) => {
    const [label, setLabel] = useState<string>("");

    useEffect(() => {
        if (!startTimeISO) { setLabel("Upcoming Intel"); return; }

        const start = new Date(startTimeISO);
        if (Number.isNaN(start.getTime())) { setLabel("Upcoming Intel"); return; }

        const now = new Date();
        const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diffDays = Math.round((startDate.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) setLabel("Today's Edge");
        else if (diffDays === 1) setLabel("Tomorrow's Edge");
        else setLabel("Upcoming Intel");
    }, [startTimeISO]);

    if (!label) return null;

    return (
        <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-3 backdrop-blur-sm">
            <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="text-[9px] font-bold tracking-widest text-emerald-500 uppercase">
                {label}
            </span>
        </div>
    );
};

const InsightCard = ({ card, index, confidenceTier }: { card: IntelCard; index: number; confidenceTier?: string }) => {
    const category = String((card as any).category);

    const hasDetails = Array.isArray((card as any).details) && (card as any).details.length > 0;
    const isEngine = category === "The Engine";

    // Expand state must react if details appear after refresh
    const [expanded, setExpanded] = useState<boolean>(hasDetails && category === "The Spot");
    useEffect(() => {
        if (!hasDetails) setExpanded(false);
        else if (category === "The Spot") setExpanded(true);
    }, [hasDetails, category]);

    const config = SECTION_CONFIG[category] || SECTION_CONFIG["The Spot"];
    const Icon = config.icon;

    const displayThesis = cleanCardThesis(category, String((card as any).thesis || ""));

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "group relative border-l-[3px] py-5 transition-colors duration-300",
                config.border,
                index !== 0 && "border-t border-white/[0.04]",
                hasDetails && expanded ? "bg-white/[0.02]" : "hover:bg-white/[0.01]",
                hasDetails ? "cursor-pointer" : "cursor-default"
            )}
            onClick={() => hasDetails && setExpanded(v => !v)}
        >
            <div className="flex items-start justify-between gap-4 px-4">
                <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                        <div className={cn("p-1 rounded-md", config.bg)}>
                            <Icon size={12} className={config.color} />
                        </div>
                        <span className={cn("text-[9px] font-bold uppercase tracking-[0.2em]", config.color)}>
                            {category}
                        </span>

                        {isEngine && confidenceTier && (
                            <div className="ml-auto mr-2"><SignalMeter tier={confidenceTier} /></div>
                        )}
                    </div>

                    <div className={cn(
                        "text-[15px] leading-snug transition-colors duration-300 font-medium pr-6",
                        isEngine ? "font-mono text-[13px] text-zinc-300" : "text-zinc-200 group-hover:text-white"
                    )}>
                        {isEngine && <span className="text-emerald-500 mr-2">{'>'}</span>}
                        <RenderRichText text={displayThesis} />
                        {isEngine && <span className="inline-block w-1.5 h-3 ml-1 bg-emerald-500/50 animate-pulse align-middle" />}
                    </div>
                </div>

                {hasDetails && (
                    <motion.div
                        animate={{ rotate: expanded ? 180 : 0 }}
                        className="text-zinc-600 mt-1"
                    >
                        <ChevronDown size={14} />
                    </motion.div>
                )}
            </div>

            <AnimatePresence>
                {expanded && hasDetails && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={SPRING}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-2 pt-3 ml-1">
                            {(card as any).market_implication && (
                                <div className="mb-3 pl-3 border-l-2 border-zinc-800">
                                    <p className="text-xs text-zinc-500 italic">
                                        <RenderRichText text={String((card as any).market_implication)} />
                                    </p>
                                </div>
                            )}

                            <div className="space-y-2">
                                {(card as any).details?.map((detail: any, i: number) => (
                                    <div key={i} className="flex gap-3 text-xs text-zinc-400 font-light leading-relaxed">
                                        <span className="w-1 h-1 rounded-full bg-zinc-700 mt-1.5 shrink-0" />
                                        <RenderRichText text={String(detail)} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const IntelSkeleton = () => (
    <div className="space-y-8 animate-pulse px-1 opacity-60">
        <div className="space-y-3">
            <div className="h-2 w-16 bg-zinc-800 rounded-full" />
            <div className="h-8 w-3/4 bg-zinc-800 rounded-lg" />
        </div>
        <div className="space-y-px rounded-xl overflow-hidden border border-zinc-800/50">
            {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 w-full bg-zinc-900/30 border-b border-white/5" />
            ))}
        </div>
    </div>
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
    intel?: PregameIntelResponse | null;
}) => {
    const { data: rawIntel, status, retry } = useIntelQuery(match, externalIntel);

    const startTimeISO = useMemo(() => toISOOrNull((match as any).startTime), [(match as any).startTime]);

    const processedData = useMemo(() => {
        if (!rawIntel) return null;

        // If backend already scrubbed, this is a safe second-pass polish only.
        const teamName = extractTeamFromPick((rawIntel as any).recommended_pick);
        const headline = cleanHeadline(String((rawIntel as any).headline || ""), teamName);

        const sortedCards = [...(((rawIntel as any).cards) || [])].sort((a: any, b: any) =>
            SORT_ORDER.indexOf(String(a.category)) - SORT_ORDER.indexOf(String(b.category))
        );

        return { ...(rawIntel as any), headline, cards: sortedCards };
    }, [rawIntel]);

    if (status === 'LOADING') return <IntelSkeleton />;

    if (status === 'ERROR' || !processedData || !processedData.cards?.length) {
        return (
            <div className="py-16 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/20">
                <ShieldCheck size={20} className="mx-auto text-zinc-700 mb-2" />
                <p className="text-xs text-zinc-600 mb-4">Analysis Unavailable</p>
                <button
                    onClick={retry}
                    className="text-[10px] font-bold text-zinc-500 hover:text-white uppercase tracking-widest px-4 py-2 bg-zinc-800 rounded hover:bg-zinc-700 transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    const confidenceTier = String((processedData as any).confidence_tier || "");
    const recommendedPick = String((processedData as any).recommended_pick || "");

    // FIX: Use grading_metadata.price as source of truth for juice display
    // Falls back to spread_juice only if grading_metadata is missing
    const displayJuice = (processedData as any).grading_metadata?.price
        || (processedData as any).spread_juice;

    return (
        <LayoutGroup>
            <motion.div
                initial="hidden"
                animate="visible"
                variants={{ visible: { transition: STAGGER } }}
                className="w-full max-w-md mx-auto px-1"
            >
                {/* HERO */}
                <div className="mb-8">
                    <EdgeLabel startTimeISO={startTimeISO} />

                    <motion.div variants={{ hidden: { opacity: 0, y: 5 }, visible: { opacity: 1, y: 0 } }}>
                        <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tighter leading-none mb-1">
                            {recommendedPick}
                        </h1>

                        {displayJuice && (
                            <div className="text-lg font-mono text-zinc-500 font-medium">
                                {displayJuice}
                            </div>
                        )}

                        {/* HARD RULE: no Confidence in hero */}
                    </motion.div>
                </div>

                {/* HEADLINE */}
                <motion.div
                    variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
                    className="mb-10 pl-4 border-l-2 border-white/10"
                >
                    <p className="text-lg text-zinc-300 font-light leading-snug text-pretty">
                        <RenderRichText text={String((processedData as any).headline || "")} />
                    </p>
                </motion.div>

                {/* CARDS LIST */}
                <div className="space-y-1">
                    {(processedData as any).cards.map((card: any, idx: number) => (
                        <InsightCard
                            key={`${idx}-${String(card.category)}`}
                            card={card}
                            index={idx}
                            confidenceTier={confidenceTier}
                        />
                    ))}
                </div>

                {/* FOOTER */}
                {!hideFooter && Array.isArray((processedData as any).sources) && (processedData as any).sources.length > 0 && (
                    <motion.div variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }} className="mt-12 pt-6 border-t border-white/5">
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {(processedData as any).sources.slice(0, 3).map((s: any, i: number) => (
                                <a
                                    key={i}
                                    href={s.url || s.uri}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors uppercase tracking-wider"
                                >
                                    <ExternalLink size={9} />
                                    {s.title ? (String(s.title).length > 20 ? String(s.title).slice(0, 20) + '…' : String(s.title)) : 'Source'}
                                </a>
                            ))}
                        </div>
                    </motion.div>
                )}
            </motion.div>
        </LayoutGroup>
    );
};

// 🛡️ Error Boundary for production safety
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
    state = { hasError: false };
    static getDerivedStateFromError() { return { hasError: true }; }
    render() {
        if (this.state.hasError) return null;
        return this.props.children;
    }
}

export default function SafePregameIntelCards(props: any) {
    return (
        <ErrorBoundary>
            <PregameIntelCards {...props} />
        </ErrorBoundary>
    );
}
