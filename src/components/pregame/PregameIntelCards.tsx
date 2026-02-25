// ===================================================================
// PregameIntelCards.tsx
// ARCHITECTURE: "Obsidian Weissach" • Production Release (v29.1)
// STATUS: ✅ Regressions Fixed • ✅ Layout Restored • ✅ Design Unified
// ===================================================================

import React, { useState, useEffect, useMemo, memo, Component } from 'react';
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence, LayoutGroup, MotionConfig, type Transition } from 'framer-motion';
import { cn, ESSENCE } from '@/lib/essence';
import { Match } from '@/types';
import { pregameIntelService, PregameIntelResponse, IntelCard } from '../../services/pregameIntelService';
import { cleanHeadline, cleanCardThesis } from '../../lib/intel-guards';
import { Activity, Zap, TrendingUp, AlertTriangle, Crosshair } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────
// §0  WEISSACH SYSTEM TOKENS & PHYSICS
// ─────────────────────────────────────────────────────────────────

const SYSTEM = {
    anim: {
        fluid: { type: "spring", damping: 32, stiffness: 380, mass: 0.9 } as Transition,
        snap: { type: "spring", damping: 22, stiffness: 450 } as Transition,
    },
    surface: {
        void: "bg-slate-50",
        glass: "bg-white border border-slate-200",
        panel: ESSENCE.card.base,
    },
    type: {
        mono: "font-mono text-[10px] tracking-[0.12em] uppercase text-slate-500 tabular-nums font-medium",
        label: "text-[9px] font-bold tracking-[0.08em] uppercase text-slate-400",
    },
} as const;

const NOISE_TEXTURE = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.04'/%3E%3C/svg%3E")`;

const SORT_ORDER = ["The Spot", "The Trend", "The Engine", "The Trap", "X-Factor"];

const SECTION_CONFIG: Record<string, { color: string; label: string; icon: React.ElementType }> = {
    "The Spot": { color: "text-slate-900", label: "01 // THE SPOT", icon: Crosshair },
    "The Trend": { color: "text-blue-700", label: "02 // THE TREND", icon: TrendingUp },
    "The Engine": { color: "text-emerald-700", label: "03 // THE ENGINE", icon: Activity },
    "The Trap": { color: "text-amber-700", label: "04 // THE TRAP", icon: AlertTriangle },
    "X-Factor": { color: "text-violet-700", label: "05 // X-FACTOR", icon: Zap },
};

// ─────────────────────────────────────────────────────────────────
// §0.1  CITATION REGEX (Hoisted — Zero Allocation at Runtime)
// ─────────────────────────────────────────────────────────────────

/**
 * Matches bracket citation tokens: [1], [1, 2], [1.1]
 * Negative lookahead (?!\() prevents matching markdown links [text](url).
 */
const REGEX_CITATION_PLACEHOLDER =
    /\[(\d+(?:\.\d+)?(?:[\s,]+\d+(?:\.\d+)?)*)\](?!\()/g;
const REGEX_SPLIT_COMMA = /[,\s]+/;
const REGEX_MULTI_SPACE = /\s{2,}/g;

// ─────────────────────────────────────────────────────────────────
// §1  STRICT TYPES
// ─────────────────────────────────────────────────────────────────

interface ExtendedMatch extends Match {
    current_odds?: { homeSpread?: number; total?: number };
    leagueId?: string;
    sport?: string;
    startTime?: string | Date;
}

interface IntelSource {
    url?: string;
    uri?: string;
    title?: string;
}

interface ExtendedIntelCard extends IntelCard {
    market_implication?: string;
    details?: string[];
    thesis?: string;
    category?: string;
}

interface ProcessedIntelData extends Omit<PregameIntelResponse, 'cards'> {
    recommended_pick?: string;
    headline?: string;
    cards: ExtendedIntelCard[];
    confidence_tier?: string;
    grading_metadata?: { price?: string };
    spread_juice?: string;
    sources?: IntelSource[];
}

// ─────────────────────────────────────────────────────────────────
// §2  UTILITIES
// ─────────────────────────────────────────────────────────────────

function triggerHaptic(): void { try { if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(4); } catch { /* */ } }

function flattenText(children: React.ReactNode): string {
    return React.Children.toArray(children).reduce<string>((acc, child) => {
        if (typeof child === "string") return acc + child;
        if (typeof child === "number") return acc + String(child);
        if (React.isValidElement<{ children?: React.ReactNode }>(child)) return acc + flattenText(child.props.children);
        return acc;
    }, "");
}

function getHostname(href?: string): string {
    if (!href) return "Source";
    try { return new URL(href).hostname.replace(/^www\./, ""); } catch { return "Source"; }
}

const BRAND_MAP_PREGAME: Record<string, string> = {
    "espn.com": "ESPN", "covers.com": "Covers", "actionnetwork.com": "Action",
    "draftkings.com": "DK", "fanduel.com": "FanDuel", "rotowire.com": "RotoWire",
    "basketball-reference.com": "BBRef", "sports-reference.com": "SportsRef",
    "pro-football-reference.com": "PFRef", "x.com": "X", "twitter.com": "X",
    "google.com": "Google", "ai.google.dev": "Google AI",
    "vertexaisearch.cloud.google.com": "Google", "discoveryengine.googleapis.com": "Google",
    "nba.com": "NBA", "nfl.com": "NFL", "mlb.com": "MLB", "nhl.com": "NHL",
    "cbssports.com": "CBS", "yahoo.com": "Yahoo", "bleacherreport.com": "BR",
    "theathletic.com": "Athletic",
};

function hostnameToBrand(hostname: string): string {
    const h = hostname.replace(/^www\./, "").toLowerCase();
    if (BRAND_MAP_PREGAME[h]) return BRAND_MAP_PREGAME[h];
    // Walk up subdomains: "vertexaisearch.cloud.google.com" → "cloud.google.com" → "google.com"
    const parts = h.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
        const parent = parts.slice(i).join(".");
        if (BRAND_MAP_PREGAME[parent]) return BRAND_MAP_PREGAME[parent];
    }
    const base = parts[0] || "Source";
    return base.charAt(0).toUpperCase() + base.slice(1);
}


/**
 * Inline Citation Hydration (Pregame).
 * Replaces bracket tokens in-place with brand-name hyperlinks.
 * Adjacent tokens merge into a single parenthetical.
 */
function hydrateCitations(text: string, sources?: IntelSource[]): string {
    if (!text || !sources?.length) return text;
    const uris = sources.map((s) => s.url || s.uri || "");
    const maxIndex = uris.length;
    const CODE_FENCE = /(```[\s\S]*?```)/g;
    const segments = text.split(CODE_FENCE);

    const REGEX_ADJACENT_CITATIONS = /(?:\[(\d+(?:\.\d+)?(?:[\s,]+\d+(?:\.\d+)?)*)\](?!\()[\s]*)+/g;

    const hydrated = segments.map((segment) => {
        if (segment.startsWith("```")) return segment;

        return segment.replace(REGEX_ADJACENT_CITATIONS, (fullMatch) => {
            const links: Array<{ brand: string; uri: string }> = [];
            const seenUri = new Set<string>();

            let m: RegExpExecArray | null;
            const tokenRe = /\[(\d+(?:\.\d+)?(?:[\s,]+\d+(?:\.\d+)?)*)\](?!\()/g;
            while ((m = tokenRe.exec(fullMatch)) !== null) {
                const parts = m[1].split(REGEX_SPLIT_COMMA).filter((p: string) => p.trim());
                for (const part of parts) {
                    const trimmed = part.trim();
                    const num = parseFloat(trimmed);
                    if (Number.isNaN(num)) continue;
                    const index = Math.floor(num) - 1;
                    if (index < 0 || index >= maxIndex) continue;
                    const uri = uris[index];
                    if (uri && !seenUri.has(uri)) {
                        seenUri.add(uri);
                        const hostname = getHostname(uri);
                        const brand = hostnameToBrand(hostname);
                        links.push({ brand, uri });
                    }
                }
            }

            if (links.length === 0) return fullMatch;

            const inner = links.map((l) => `[${l.brand}](${l.uri})`).join(", ");
            return ` (${inner})`;
        });
    }).join("");

    return hydrated
        .replace(/\s+\)/g, ")")
        .replace(/\(\s+/g, "(")
        .replace(/\.\s*\(/g, " (")
        .replace(/\)([a-zA-Z])/g, ") $1")
        .replace(REGEX_MULTI_SPACE, " ");
}

function toISOOrNull(v: string | number | Date | null | undefined): string | null {
    if (!v) return null;
    if (typeof v === 'string') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
    return null;
}

function extractTeamFromPick(pick?: string | null): string {
    if (!pick) return "Team";
    const s = pick.trim();
    if (!s) return "Team";
    if (/^(over|under)\b/i.test(s)) return "TOTAL_PICK";
    const mlIdx = s.toLowerCase().lastIndexOf(' ml');
    const core = mlIdx > 0 ? s.slice(0, mlIdx).trim() : s;
    const tokens = core.split(/\s+/);
    const out: string[] = [];
    for (const t of tokens) {
        if (/^[+\-]?\d+(\.\d+)?$/.test(t)) break;
        if (/^\(?[+\-]?\d{3,5}\)?$/.test(t)) break;
        out.push(t);
    }
    return out.length ? out.join(' ') : tokens[0];
}

// ─────────────────────────────────────────────────────────────────
// §3  VISUAL PRIMITIVES
// ─────────────────────────────────────────────────────────────────

const FilmGrain = memo(() => (
    <div className="absolute inset-0 pointer-events-none z-0 opacity-[0.03] mix-blend-overlay" style={{ backgroundImage: NOISE_TEXTURE }} />
));
FilmGrain.displayName = "FilmGrain";


const RenderRichText = React.memo(({ text, sources, className }: { text: string; sources?: IntelSource[]; className?: string }) => {
    if (!text) return null;
    const hydrated = useMemo(() => hydrateCitations(text, sources), [text, sources]);
    const components: Components = useMemo(() => ({
        p: ({ children }) => <span>{children}</span>,
        strong: ({ children }) => <strong className="font-semibold text-slate-900 tracking-tight">{children}</strong>,
        a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-slate-500 no-underline hover:text-slate-900 hover:underline decoration-slate-300 underline-offset-4 transition-colors duration-200">
                {children}
            </a>
        ),
    }), []);

    return (
        <span className={className}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {hydrated}
            </ReactMarkdown>
        </span>
    );
});


// RESTORED TOGGLE SWITCH (Animated +/-)
const ToggleSwitch = ({ expanded }: { expanded: boolean }) => (
    <div className="relative w-3 h-3 flex items-center justify-center opacity-50 group-hover:opacity-100 transition-opacity duration-300">
        <span className={cn(
            "absolute w-full h-[1.5px] bg-slate-900 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]",
            expanded ? "rotate-180" : "rotate-0"
        )} />
        <span className={cn(
            "absolute w-full h-[1.5px] bg-slate-900 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]",
            expanded ? "rotate-180 opacity-0" : "rotate-90 opacity-100"
        )} />
    </div>
);

// WEISSACH CONFIDENCE BAR (Gradient)
const ConfidenceBar = ({ tier }: { tier: string }) => {
    const level = tier === "HIGH" ? "high" : tier === "MEDIUM" ? "medium" : "low";
    const percent = level === "high" ? 88 : level === "medium" ? 58 : 30;
    const gradient = level === "high" ? "from-emerald-500 to-emerald-400" : level === "medium" ? "from-amber-500 to-amber-400" : "from-slate-400 to-slate-300";

    return (
        <div className="flex items-center gap-2 h-4 w-full max-w-[120px]" title={`Confidence: ${tier}`}>
            <div className="flex-1 h-[5px] rounded-full bg-slate-200 overflow-hidden">
                <motion.div
                    className={cn("h-full rounded-full bg-gradient-to-r", gradient)}
                    initial={{ width: 0 }}
                    animate={{ width: `${percent}%` }}
                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                />
            </div>
            <span className={cn("text-[9px] font-mono uppercase tabular-nums", level === "high" ? "text-emerald-600" : level === "medium" ? "text-amber-600" : "text-slate-500")}>
                {percent}%
            </span>
        </div>
    );
};

// EDGE LABEL (Status Badge)
const EdgeLabel = ({ startTimeISO }: { startTimeISO: string | null }) => {
    const [label, setLabel] = useState<string>("");

    useEffect(() => {
        if (!startTimeISO) { setLabel("PENDING"); return; }
        const start = new Date(startTimeISO);
        if (Number.isNaN(start.getTime())) { setLabel("PENDING"); return; }
        const now = new Date();
        const startDate = new Date(start); startDate.setHours(0, 0, 0, 0);
        const nowDate = new Date(now); nowDate.setHours(0, 0, 0, 0);
        const diffDays = Math.round((startDate.getTime() - nowDate.getTime()) / 86400000);

        if (diffDays === 0) setLabel("TODAY'S EDGE");
        else if (diffDays === 1) setLabel("TOMORROW");
        else setLabel("UPCOMING");
    }, [startTimeISO]);

    if (!label) return null;
    const isLive = label === "TODAY'S EDGE";

    return (
        <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-sm", isLive ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200")}>
            {isLive && <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" /></span>}
            <span className={cn(SYSTEM.type.label, isLive ? "text-emerald-700" : "text-slate-400")}>{label}</span>
        </div>
    );
};


// ─────────────────────────────────────────────────────────────────
// §4  INSIGHT ROWS (Restored Logic)
// ─────────────────────────────────────────────────────────────────

const InsightRow = ({ card, confidenceTier, isLast, sources }: { card: ExtendedIntelCard; confidenceTier?: string; isLast: boolean; sources?: IntelSource[] }) => {
    const category = String(card.category);
    const details = card.details || [];
    const hasDetails = details.length > 0;
    const isEngine = category === "The Engine";

    // Logic Restoration: Only auto-expand "The Spot" if it has details.
    const [expanded, setExpanded] = useState<boolean>(hasDetails && category === "The Spot");

    useEffect(() => { if (!hasDetails) setExpanded(false); else if (category === "The Spot") setExpanded(true); }, [hasDetails, category]);

    const config = SECTION_CONFIG[category] || SECTION_CONFIG["The Spot"];
    const displayThesis = cleanCardThesis(category, String(card.thesis || ""));

    return (
        <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn("group relative w-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]", hasDetails ? "cursor-pointer" : "cursor-default")} onClick={() => hasDetails && setExpanded(v => !v)}>
            {/* Hairline Separator */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

            <div className="relative max-w-[1200px] mx-auto">
                {/* Active Indicator Rail */}
                <div className={cn("absolute left-[2px] md:left-[-12px] top-8 bottom-8 w-[2px] bg-slate-900 rounded-full transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]", expanded ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0")} />

                <div className="py-8 md:py-10 px-6 md:px-0 flex flex-col md:flex-row md:items-baseline gap-6 md:gap-0 z-10">

                    {/* Left Rail (Label) */}
                    <div className="hidden md:flex w-[160px] shrink-0 flex-col gap-3 select-none pt-1">
                        <span className={cn("text-[10px] font-bold tracking-[0.2em] uppercase transition-colors duration-300 font-mono", expanded ? config.color : "text-slate-400 group-hover:text-slate-500")}>
                            {config.label.split(' // ')[1]}
                        </span>
                        {isEngine && confidenceTier && <ConfidenceBar tier={confidenceTier} />}
                    </div>

                    {/* Content Stream */}
                    <div className="flex-1 min-w-0">
                        {/* Mobile Header */}
                        <div className="md:hidden flex items-center justify-between mb-4">
                            <span className={cn("text-[9px] font-bold tracking-[0.2em] uppercase font-mono", expanded ? config.color : "text-slate-400")}>{config.label.split(' // ')[1]}</span>
                            {isEngine && confidenceTier && <ConfidenceBar tier={confidenceTier} />}
                        </div>

                        <div className="flex items-start justify-between gap-8">
                            <div className={cn("text-[16px] md:text-[18px] leading-[1.6] font-light tracking-wide transition-colors duration-500 text-pretty max-w-[80ch]", isEngine ? "font-mono text-[13px] text-slate-600 tracking-normal leading-[1.8]" : (expanded ? "text-slate-900" : "text-slate-500 group-hover:text-slate-700"))}>
                                <RenderRichText text={displayThesis} sources={sources} />
                            </div>

                            {hasDetails && (
                                <div className="shrink-0 mt-2">
                                    <ToggleSwitch expanded={expanded} />
                                </div>
                            )}
                        </div>

                        <AnimatePresence>
                            {expanded && hasDetails && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SYSTEM.anim.fluid} className="overflow-hidden">
                                    <div className="pt-8 space-y-6">
                                        {card.market_implication && (
                                            <div className="pl-0 md:pl-6 md:border-l border-slate-200">
                                                <div className="flex items-center gap-2 mb-2 text-emerald-600 md:hidden"><Activity size={10} /><span className={SYSTEM.type.label}>Market Implication</span></div>
                                                <p className="text-[14px] text-slate-500 italic leading-relaxed font-light"><RenderRichText text={String(card.market_implication)} sources={sources} /></p>
                                            </div>
                                        )}
                                        <div className="space-y-4">
                                            {details.map((detail, i) => (
                                                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + (i * 0.04) }} className="flex gap-4 group/item items-baseline">
                                                    <span className="block w-1 h-1 bg-slate-300 rounded-full mt-2 shrink-0 group-hover/item:bg-slate-900 transition-colors duration-500" />
                                                    <p className="text-[14px] text-slate-500 font-light leading-relaxed group-hover/item:text-slate-700 transition-colors duration-500"><RenderRichText text={detail} sources={sources} /></p>
                                                </motion.div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="h-6" />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Bottom Hairline for Last Item */}
            {isLast && <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />}
        </motion.div>
    );
};

// ─────────────────────────────────────────────────────────────────
// §5  MAIN COMPONENT (Logic + Safety)
// ─────────────────────────────────────────────────────────────────

const useIntelQuery = (match: ExtendedMatch, externalIntel?: PregameIntelResponse | null) => {
    const [data, setData] = useState<PregameIntelResponse | null>(externalIntel || null);
    const [status, setStatus] = useState<'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'>(externalIntel ? 'SUCCESS' : 'LOADING');
    const [retryCount, setRetryCount] = useState(0);

    const matchId = match.id; const home = match.homeTeam?.name; const away = match.awayTeam?.name;
    const sport = match.sport; const league = match.leagueId; const start = toISOOrNull(match.startTime);
    const oddsHome = match.current_odds?.homeSpread; const oddsTotal = match.current_odds?.total;

    useEffect(() => {
        if (externalIntel) { setData(externalIntel); setStatus('SUCCESS'); return; }
        const controller = new AbortController();
        const fetchData = async () => {
            setStatus('LOADING');
            try {
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                const result = await pregameIntelService.fetchIntel(matchId, home, away, sport, league, start || undefined, oddsHome, oddsTotal);
                clearTimeout(timeoutId); if (!controller.signal.aborted && result) { setData(result); setStatus('SUCCESS'); }
            } catch { if (!controller.signal.aborted) setStatus('ERROR'); }
        };
        fetchData(); return () => controller.abort();
    }, [externalIntel, retryCount, matchId, home, away, sport, league, start, oddsHome, oddsTotal]);
    return { data, status, retry: () => setRetryCount(c => c + 1) };
};

export const PregameIntelCards = ({ match, hideFooter = false, intel: externalIntel }: { match: Match; hideFooter?: boolean; intel?: PregameIntelResponse | null }) => {
    const safeMatch = match as ExtendedMatch;
    const { data: rawIntel, status, retry } = useIntelQuery(safeMatch, externalIntel);
    const startTimeISO = useMemo(() => toISOOrNull(safeMatch.startTime), [safeMatch.startTime]);

    const processedData = useMemo<ProcessedIntelData | null>(() => {
        if (!rawIntel) return null;
        const teamNameRaw = extractTeamFromPick(rawIntel.recommended_pick);
        const teamName = teamNameRaw === "TOTAL_PICK" ? (safeMatch.homeTeam?.name || "Match") : teamNameRaw;
        const headline = cleanHeadline(String(rawIntel.headline || ""), teamName);
        const sortedCards = [...(rawIntel.cards || [])].sort((a, b) => {
            const idxA = SORT_ORDER.indexOf(String(a.category));
            const idxB = SORT_ORDER.indexOf(String(b.category));
            return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
        });
        return { ...rawIntel, headline, cards: sortedCards };
    }, [rawIntel, safeMatch.homeTeam?.name]);

    if (status === 'LOADING') {
        return (
            <div className="w-full min-h-[500px] flex flex-col items-center justify-center space-y-8 opacity-60">
                <div className="relative w-24 h-[1px] bg-slate-200 overflow-hidden"><div className="absolute inset-0 bg-slate-400/50 w-1/2 animate-[shimmer_2s_infinite]" /></div>
                <div className={SYSTEM.type.mono}>Initializing Analysis</div>
            </div>
        );
    }

    if (status === 'ERROR' || !processedData || !processedData.cards?.length) {
        return (
            <div className="py-40 text-center w-full">
                <div className="inline-flex flex-col items-center gap-6">
                    <span className={SYSTEM.type.mono}>Unable to load analysis</span>
                    <button onClick={retry} className="px-8 py-2.5 rounded-full border border-slate-200 text-[10px] font-bold text-slate-500 hover:text-slate-900 hover:border-slate-300 transition-all uppercase tracking-widest">Retry</button>
                </div>
            </div>
        );
    }

    const confidenceTier = String(processedData.confidence_tier || "");
    const rawPick = String(processedData.recommended_pick || "");
    const displayJuice = processedData.grading_metadata?.price || processedData.spread_juice;

    // Phase 4: Humanize raw database text
    const isNoMarket = rawPick === 'NO_MARKET' || rawPick === 'NO MARKET' || rawPick.includes('NO_MARKET');
    const recommendedPick = isNoMarket ? '' : rawPick;

    // If NO_MARKET, show the humanized empty state instead
    if (isNoMarket) {
        return (
            <div className="flex-1 w-full bg-slate-50 min-h-[55vh] relative pt-16 px-6 flex flex-col items-center font-sans pb-40">
                <div className="text-center max-w-sm mb-12">
                    <div className="w-14 h-14 bg-white border border-slate-200 rounded-full flex items-center justify-center mx-auto mb-5 shadow-sm">
                        <span className="text-2xl text-slate-400">&#128274;</span>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 tracking-tight mb-2">
                        Lines Not Yet Posted
                    </h3>
                    <p className="text-[15px] text-slate-500 leading-relaxed">
                        Sportsbooks have not released the market for this game. AI analysis will begin automatically once odds are available.
                    </p>
                </div>
                <div className="flex justify-center">
                    <div className="bg-white/90 backdrop-blur-sm border border-slate-200 px-4 py-1.5 rounded-full flex items-center gap-2 shadow-sm">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                            Monitoring Market
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <MotionConfig reducedMotion="user">
            <LayoutGroup>
                <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.06 } } }} className="w-full py-16 font-sans antialiased relative">
                    <div className="mb-32 relative w-full max-w-[1200px] mx-auto px-6 md:px-12">
                        <div className="relative z-10 flex flex-col items-center text-center md:items-start md:text-left md:pl-[160px]">
                            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }} className="mb-10">
                                <EdgeLabel startTimeISO={startTimeISO} />
                            </motion.div>
                            <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}>
                                <div className="flex flex-col md:flex-row md:items-baseline md:gap-8 mb-8">
                                    <h1 className="text-[56px] md:text-[100px] font-semibold text-slate-900 tracking-tighter leading-[0.85] break-words max-w-5xl">{recommendedPick}</h1>
                                    {displayJuice && <span className="text-[16px] md:text-[20px] font-mono text-slate-500 font-medium tracking-[0.15em] mt-4 md:mt-0">{displayJuice}</span>}
                                </div>
                                <div className="max-w-3xl border-l-2 border-slate-200 pl-8 py-2 mx-auto md:mx-0">
                                    <p className="text-[20px] md:text-[24px] text-slate-600 font-light leading-[1.5] tracking-tight text-pretty"><RenderRichText text={String(processedData.headline || "")} sources={processedData.sources} /></p>
                                </div>
                            </motion.div>
                        </div>
                    </div>

                    <div className="relative w-full">
                        <div className="max-w-[1200px] mx-auto px-6 md:px-12 mb-8 select-none">
                            <div className="flex items-center gap-6 md:pl-[160px]">
                                <div className="h-px w-12 bg-slate-300" />
                                <span className={SYSTEM.type.label}>Vector Analysis</span>
                            </div>
                        </div>

                        {processedData.cards.map((card, idx) => (
                            <InsightRow key={`${idx}-${String(card.category)}`} card={card} confidenceTier={confidenceTier} isLast={idx === processedData.cards.length - 1} sources={processedData.sources} />
                        ))}

                        {/* Closing Fade */}
                        <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
                    </div>

                </motion.div>
            </LayoutGroup>
        </MotionConfig>
    );
};

class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
    state = { hasError: false };
    static getDerivedStateFromError() { return { hasError: true }; }
    render() { if (this.state.hasError) return null; return this.props.children; }
}

export default function SafePregameIntelCards(props: React.ComponentProps<typeof PregameIntelCards>) {
    return <ErrorBoundary><PregameIntelCards {...props} /></ErrorBoundary>;
}
