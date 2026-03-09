// ===================================================================
// MatchList.tsx — Production Editorial Feed
// ===================================================================
// Architecture: League-grouped accordion feed with sidebar hero widgets.
// Animations: Hardware-accelerated height springs via Framer Motion.
// Performance: Strict primitive memoization, Schwartzian transform sorting.
// Safety: React 18 Concurrent Mode compliant, SSR Hydration-safe dates.
// ===================================================================

import React, { useMemo, useState, useCallback, memo, useRef, useLayoutEffect, useEffect } from 'react';
import useMeasure from 'react-use-measure';
import { Match } from '@/types';
import { LEAGUES } from '@/constants';
import MatchRow from './MatchRow';
import TeamLogo from '../shared/TeamLogo';
import { LayoutGroup, motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/essence';
import { getTeamColor, getTeamLogo } from '@/lib/teamColors';
import { useAppStore } from '@/store/appStore';
import { formatOddsByMode } from '@/lib/oddsDisplay';
import {
    usePolyOdds,
    findPolyForMatch,
    calcEdge,
    americanToImpliedProb,
    polyProbToPercent,
    type PolyOddsResult,
    type PolyOdds
} from '@/hooks/usePolyOdds';
import { useFeaturedProps, STAT_LABELS, type FeaturedProp } from '@/hooks/useFeaturedProps';
import type { MatchPickSummary } from '@/types/dailyPicks';

// ============================================================================
// TYPES & PIPELINES
// ============================================================================

export interface EnrichedMatch {
    match: Match;
    timeMs: number;
    isLive: boolean;
    isFinal: boolean;
    isPinned: boolean;
}

interface MatchListProps {
    matches: Match[];
    onSelectMatch: (match: Match) => void;
    isLoading: boolean;
    pinnedMatchIds: ReadonlySet<string>;
    onTogglePin: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
    isMatchLive: (match: Match) => boolean;
    isMatchFinal: (match: Match) => boolean;
    onOpenPricing: () => void;
    picksByMatch: ReadonlyMap<string, MatchPickSummary>;
    isPicksMode: boolean;
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Safely stabilizes callbacks for DOM user interactions (e.g., onClick).
 * DO NOT use this for functions evaluated during the render phase (e.g. useMemo).
 */
function useEventCallback<T extends (...args: any[]) => any>(fn: T): T {
    const ref = useRef<T>(fn);
    useIsomorphicLayoutEffect(() => { ref.current = fn; });
    return useCallback((...args: Parameters<T>) => ref.current(...args), []) as T;
}

// ============================================================================
// CONSTANTS & UTILS
// ============================================================================

const ACCORDION_SPRING = { type: 'spring' as const, duration: 0.35, bounce: 0 };
const STAGGER_DELAY = 0.04;
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

const LEAGUE_WEIGHTS = new Map(LEAGUES.map((l, i) => [l.id.toLowerCase(), i]));

/** Fixes Safari's native NaN failure by ensuring Date strings contain the ISO 'T' */
const parseSafeDateMs = (dateString?: string | Date): number => {
    if (!dateString) return Number.MAX_SAFE_INTEGER;
    const normalizedInput = dateString instanceof Date ? dateString.toISOString() : dateString;
    const normalized = normalizedInput.includes('T') ? normalizedInput : normalizedInput.replace(' ', 'T');
    const ms = Date.parse(normalized);
    return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
};

const parseUpdatedAtMs = (match: Match): number => {
    const lastUpdatedMs = match.last_updated ? Date.parse(match.last_updated) : Number.NaN;
    if (!Number.isNaN(lastUpdatedMs) && Number.isFinite(lastUpdatedMs)) return lastUpdatedMs;

    const fetchedAt = typeof match.fetched_at === 'number' ? match.fetched_at : Number.NaN;
    if (!Number.isNaN(fetchedAt) && Number.isFinite(fetchedAt)) return fetchedAt;

    return 0;
};

const formatAgeLabel = (ageMs: number): string => {
    if (ageMs < 60_000) return 'just now';
    const mins = Math.floor(ageMs / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem === 0 ? `${hours}h ago` : `${hours}h ${rem}m ago`;
};

/** Normalize team name for fuzzy matching: lowercase, alphanumeric only */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Safely parse American odds, preventing TypeErrors on malformed API objects */
const parseAmericanOdds = (odds?: unknown): number => {
    if (odds === undefined || odds === null) return 0;
    if (typeof odds === 'number') return odds;

    // String coercion protects against the API unexpectedly returning arrays or booleans
    const str = String(odds).toUpperCase().trim();
    if (str === 'EVEN' || str === 'PK' || str === 'PICK') return 100;

    const parsed = Number(str.replace(/[^0-9\-+.]/g, ''));
    return Number.isNaN(parsed) ? 0 : parsed;
};

// ============================================================================
// OPTIMIZED MATCH ROW WRAPPER
// ============================================================================

interface OptimizedMatchRowProps {
    match: Match;
    isPinned: boolean;
    isLive: boolean;
    isFinal: boolean;
    onSelect: (m: Match) => void;
    onToggle: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
    polyResult?: PolyOddsResult;
    pickSummary?: MatchPickSummary;
    isPicksMode: boolean;
}

/**
 * Flat Primitive Memoization.
 * By computing polyResult internally, row rendering PERFECTLY BAILS OUT
 * when the parent re-renders for a pin toggle elsewhere in the list.
 */
const OptimizedMatchRow = memo(({
    match, isPinned, isLive, isFinal, onSelect, onToggle, polyResult, pickSummary, isPicksMode
}: OptimizedMatchRowProps) => {

    const handleSelect = useCallback(() => onSelect(match), [match, onSelect]);
    const handleToggle = useCallback((e: React.MouseEvent | React.KeyboardEvent) => onToggle(match.id, e), [match.id, onToggle]);

    const { polyHomeProb, polyAwayProb, homeEdge, awayEdge } = useMemo(() => {
        const poly = findPolyForMatch(
            polyResult,
            match.id,
            match.homeTeam?.name || match.homeTeam?.shortName,
            match.awayTeam?.name || match.awayTeam?.shortName
        );

        let polyH: number | undefined;
        let polyA: number | undefined;
        let edgeH: number | undefined;
        let edgeA: number | undefined;

        const homeML = parseAmericanOdds(match.odds?.moneylineHome ?? match.odds?.home_ml);
        const awayML = parseAmericanOdds(match.odds?.moneylineAway ?? match.odds?.away_ml);

        if (poly) {
            polyH = polyProbToPercent(poly.homeProb);
            polyA = polyProbToPercent(poly.awayProb);

            if (homeML !== 0) edgeH = calcEdge(poly.homeProb, americanToImpliedProb(homeML));
            if (awayML !== 0) edgeA = calcEdge(poly.awayProb, americanToImpliedProb(awayML));
        } else if (homeML !== 0 && awayML !== 0) {
            // Fallback: derive client-side probability from sportsbook moneyline
            polyH = americanToImpliedProb(homeML) * 100;
            polyA = americanToImpliedProb(awayML) * 100;
        }

        return { polyHomeProb: polyH, polyAwayProb: polyA, homeEdge: edgeH, awayEdge: edgeA };
    }, [polyResult, match]);

    return (
        <motion.div layout="position" layoutId={`match-row-${match.id}`} initial={false} className="transform-gpu">
            <MatchRow
                match={match}
                isPinned={isPinned}
                isLive={isLive}
                isFinal={isFinal}
                onSelect={handleSelect}
                onTogglePin={handleToggle}
                pickSummary={pickSummary}
                isPicksMode={isPicksMode}
                {...(polyHomeProb !== undefined ? { polyHomeProb } : {})}
                {...(polyAwayProb !== undefined ? { polyAwayProb } : {})}
                {...(homeEdge !== undefined ? { homeEdge } : {})}
                {...(awayEdge !== undefined ? { awayEdge } : {})}
            />
        </motion.div>
    );
});
OptimizedMatchRow.displayName = 'OptimizedMatchRow';

// ============================================================================
// MARKET PULSE ROW — Polymarket sidebar widget row
// ============================================================================

function formatVolume(vol: number): string {
    if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
    return `$${vol}`;
}

const MarketPulseRow = memo(({ poly, match, onSelect }: {
    poly: PolyOdds;
    match?: Match;
    onSelect: (m: Match) => void;
}) => {
    const homeProb = Math.round(poly.home_prob * 100);
    const awayProb = Math.round(poly.away_prob * 100);
    const favIsAway = awayProb > homeProb;

    // Static color map → match color → fallback
    const awayColor = getTeamColor(poly.away_team_name) || match?.awayTeam?.color || '#a1a1aa';
    const homeColor = getTeamColor(poly.home_team_name) || match?.homeTeam?.color || '#a1a1aa';

    // Match logo → static ESPN CDN map → empty
    const awayLogo = match?.awayTeam?.logo || getTeamLogo(poly.away_team_name);
    const homeLogo = match?.homeTeam?.logo || getTeamLogo(poly.home_team_name);
    const hasVolume = typeof poly.volume === 'number' && poly.volume > 0;

    const handleClick = useCallback(() => {
        if (match) onSelect(match);
    }, [match, onSelect]);

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={!match}
            className={cn(
                "group w-full text-left px-3.5 py-3 max-[390px]:px-3 max-[390px]:py-2.5 transition-colors duration-150 outline-none [-webkit-tap-highlight-color:transparent]",
                match ? "hover:bg-zinc-50 cursor-pointer focus-visible:bg-zinc-50" : "opacity-80 cursor-not-allowed"
            )}
        >
            {/* Away row */}
            <div className="flex justify-between items-center mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-[18px] h-[18px] rounded-full bg-zinc-100 flex items-center justify-center shrink-0 border border-black/5 overflow-hidden">
                        <TeamLogo logo={awayLogo} name={poly.away_team_name} teamColor={awayColor} className="w-3.5 h-3.5 object-contain" />
                    </div>
                    <span className={cn(
                        "text-[12.5px] max-[390px]:text-[12px] truncate tracking-tight transition-colors duration-150",
                        favIsAway ? "font-semibold text-zinc-900" : "font-medium text-zinc-500"
                    )}>{poly.away_team_name}</span>
                </div>
                <span className={cn(
                    "font-mono text-[11.5px] max-[390px]:text-[11px] tabular-nums shrink-0 tracking-tight",
                    favIsAway ? "font-bold text-zinc-900" : "font-medium text-zinc-400"
                )}>{awayProb}%</span>
            </div>
            {/* Home row */}
            <div className="flex justify-between items-center mb-2.5">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-[18px] h-[18px] rounded-full bg-zinc-100 flex items-center justify-center shrink-0 border border-black/5 overflow-hidden">
                        <TeamLogo logo={homeLogo} name={poly.home_team_name} teamColor={homeColor} className="w-3.5 h-3.5 object-contain" />
                    </div>
                    <span className={cn(
                        "text-[12.5px] max-[390px]:text-[12px] truncate tracking-tight transition-colors duration-150",
                        !favIsAway ? "font-semibold text-zinc-900" : "font-medium text-zinc-500"
                    )}>{poly.home_team_name}</span>
                </div>
                <span className={cn(
                    "font-mono text-[11.5px] max-[390px]:text-[11px] tabular-nums shrink-0 tracking-tight",
                    !favIsAway ? "font-bold text-zinc-900" : "font-medium text-zinc-400"
                )}>{homeProb}%</span>
            </div>
            {/* Dual prob bar — team brand colors with inset ring */}
            <div className="flex h-[4px] rounded-full overflow-hidden gap-[1.5px] bg-zinc-100 ring-1 ring-inset ring-black/[0.04] p-[0.5px]">
                <div className="h-full rounded-l-full transition-all duration-700 ease-out" style={{ width: `${awayProb}%`, backgroundColor: awayColor, opacity: favIsAway ? 1 : 0.25 }} />
                <div className="h-full rounded-r-full transition-all duration-700 ease-out" style={{ width: `${homeProb}%`, backgroundColor: homeColor, opacity: !favIsAway ? 1 : 0.25 }} />
            </div>
            {/* Meta row */}
            <div className="flex justify-between items-center mt-2 opacity-60 group-hover:opacity-100 transition-opacity duration-300">
                <span className="font-mono text-[9px] max-[390px]:text-[8.5px] text-zinc-500 tracking-[0.06em] uppercase font-semibold">{poly.local_league_id}</span>
                <div className="flex items-center gap-1.5">
                    {hasVolume ? (
                        <span className="font-mono text-[9.5px] max-[390px]:text-[9px] text-zinc-500 tracking-[0.02em] font-medium">{formatVolume(poly.volume)} vol</span>
                    ) : null}
                    <ChevronRight size={12} className="text-zinc-400 group-hover:text-zinc-600 transition-colors" />
                </div>
            </div>
        </button>
    );
});
MarketPulseRow.displayName = 'MarketPulseRow';

// ============================================================================
// PREMIUM PRO CTA (Extracted for reuse)
// ============================================================================

const PremiumProCTA = memo(({ onPricing, className }: { onPricing: () => void; className?: string }) => (
    <section className={cn(
        "relative rounded-2xl bg-[linear-gradient(145deg,#ffffff,#f4f8ff)] p-4 max-[390px]:p-3.5 overflow-hidden shadow-[0_10px_24px_-12px_rgba(30,64,175,0.22)] ring-1 ring-blue-200/80",
        className
    )}>
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#0B63F6] to-transparent opacity-70" />
        <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2.5">
                <div className="flex items-center justify-center w-[20px] h-[20px] rounded bg-[#0B63F6] text-white shadow-[0_8px_14px_-8px_rgba(11,99,246,0.45)]">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                    </svg>
                </div>
                <h3 className="font-mono text-[10px] font-bold tracking-[0.14em] text-blue-700 uppercase">
                    Pro Access
                </h3>
            </div>
            <p className="text-[12px] max-[390px]:text-[11.5px] text-slate-600 leading-relaxed mb-3.5 max-[390px]:mb-3 font-medium">
                Unlock deep AI prop analysis, L5 hit rates, and real-time line movement alerts.
            </p>
            <button
                type="button"
                onClick={onPricing}
                className="group/btn w-full h-[38px] max-[390px]:h-[36px] bg-[#0B63F6] text-white text-[12px] max-[390px]:text-[11px] font-bold rounded-lg transition-all outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:ring-blue-300 flex items-center justify-center gap-2 shadow-sm hover:bg-[#0954d1]"
            >
                Upgrade
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover/btn:translate-x-0.5 text-blue-100 group-hover/btn:text-white">
                    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
            </button>
        </div>
    </section>
));
PremiumProCTA.displayName = 'PremiumProCTA';

// ============================================================================
// SKELETON
// ============================================================================

const MatchRowSkeleton = () => (
    <div className="w-full h-[74px] border-b border-zinc-100 flex items-center bg-white" aria-hidden="true">
        <div className="w-[64px] sm:w-[80px] h-full border-r border-zinc-100 bg-zinc-50/50 flex flex-col justify-center items-center gap-2 shrink-0">
            <div className="w-6 sm:w-8 h-1.5 bg-zinc-200 rounded-full animate-pulse" />
            <div className="w-8 sm:w-10 h-1.5 bg-zinc-100 rounded-full animate-pulse" style={{ animationDelay: '100ms' }} />
        </div>
        <div className="flex-1 px-4 sm:px-5 flex flex-col justify-center gap-3.5 min-w-0">
            <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full bg-zinc-100 animate-pulse shrink-0" style={{ animationDelay: '50ms' }} />
                <div className="h-2 w-24 sm:w-32 bg-zinc-200 rounded-full animate-pulse" style={{ animationDelay: '100ms' }} />
            </div>
            <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full bg-zinc-100 animate-pulse shrink-0" style={{ animationDelay: '150ms' }} />
                <div className="h-2 w-16 sm:w-24 bg-zinc-100 rounded-full animate-pulse" style={{ animationDelay: '200ms' }} />
            </div>
        </div>
    </div>
);

// ============================================================================
// LEAGUE GROUP
// ============================================================================

const LeagueGroup = memo(({
    leagueId, leagueName, enrichedMatches, onSelectMatch, onTogglePin, groupIndex, polyResult, isMounted, picksByMatch, isPicksMode,
}: {
    leagueId: string; leagueName: string; enrichedMatches: EnrichedMatch[];
    onSelectMatch: (match: Match) => void; onTogglePin: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
    groupIndex: number; polyResult?: PolyOddsResult; isMounted?: boolean;
    picksByMatch: ReadonlyMap<string, MatchPickSummary>;
    isPicksMode: boolean;
}) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [measureRef, bounds] = useMeasure();
    const toggle = useCallback(() => setIsExpanded((prev) => !prev), []);

    // O(1) mathematical extraction, impervious to sorting index changes
    const earliestTime = useMemo(() => {
        if (!isMounted) return '';
        const earliestMs = enrichedMatches.reduce((min, em) => {
            if (em.isFinal) return min;
            return em.timeMs < min ? em.timeMs : min;
        }, Number.MAX_SAFE_INTEGER);

        return earliestMs === Number.MAX_SAFE_INTEGER
            ? ''
            : new Date(earliestMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }, [enrichedMatches, isMounted]);

    return (
        <motion.div
            layout="position"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIndex * STAGGER_DELAY }}
            className="flex flex-col relative transform-gpu"
        >
                <button
                    type="button"
                    onClick={toggle}
                    className={cn(
                    'flex items-center justify-between w-full h-11 px-3 sm:px-4 max-[390px]:px-2.5 [-webkit-tap-highlight-color:transparent]',
                    // Keep group headers static so ordering never shifts behind match rows.
                    'bg-[#F8FAFC] border-b border-blue-200/70',
                    'transition-colors hover:bg-blue-50/80',
                    'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300',
                    isExpanded ? 'border border-blue-200 border-b-blue-200/70 rounded-t-xl shadow-[0_12px_24px_-20px_rgba(30,64,175,0.36)]' : 'border border-blue-200 border-b-transparent rounded-xl shadow-[0_12px_24px_-20px_rgba(30,64,175,0.36)]'
                )}
                aria-expanded={isExpanded}
                aria-controls={`league-content-${leagueId}`}
            >
                <div className="flex items-center gap-2 max-[390px]:gap-1.5 min-w-0">
                    <h3 className="text-[12px] max-[390px]:text-[11px] font-semibold text-[#0A0A0A] tracking-tight truncate">{leagueName}</h3>
                    <span className="text-[14px] text-blue-200 leading-none" aria-hidden="true">·</span>
                    <span className="text-[11px] max-[390px]:text-[10px] font-mono tabular-nums font-normal text-[#555555] whitespace-nowrap">
                        {enrichedMatches.length} {enrichedMatches.length === 1 ? 'game' : 'games'}
                    </span>
                    {earliestTime && (
                        <>
                            <span className="text-[14px] text-blue-200 leading-none" aria-hidden="true">·</span>
                            <span className="text-[11px] max-[390px]:text-[10px] font-mono tabular-nums font-normal text-[#555555] whitespace-nowrap" suppressHydrationWarning>
                                {earliestTime}
                            </span>
                        </>
                    )}
                </div>
                    <motion.svg
                    xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className="text-blue-400" animate={{ rotate: isExpanded ? 0 : -90 }} transition={{ duration: 0.2 }}
                    >
                    <path d="m6 9 6 6 6-6" />
                </motion.svg>
            </button>

            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        key="content"
                        id={`league-content-${leagueId}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: bounds.height || 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={ACCORDION_SPRING}
                        className={cn(
                            'overflow-hidden relative -mt-[1px]',
                            'bg-white ring-1 ring-blue-200/80 rounded-b-xl shadow-[0_14px_28px_-20px_rgba(30,64,175,0.28)]'
                        )}
                    >
                        <div ref={measureRef} className="flex flex-col divide-y divide-zinc-100/80">
                            {enrichedMatches.map(({ match, isPinned, isLive, isFinal }) => (
                                <OptimizedMatchRow
                                    key={match.id}
                                    match={match}
                                    isPinned={isPinned}
                                    isLive={isLive}
                                    isFinal={isFinal}
                                    onSelect={onSelectMatch}
                                    onToggle={onTogglePin}
                                    polyResult={polyResult}
                                    pickSummary={picksByMatch.get(match.id) || picksByMatch.get(match.id.split('_')[0] || match.id)}
                                    isPicksMode={isPicksMode}
                                />
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
});
LeagueGroup.displayName = 'LeagueGroup';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const MatchList: React.FC<MatchListProps> = ({
    matches, onSelectMatch, isLoading, pinnedMatchIds, onTogglePin, isMatchLive, isMatchFinal, onOpenPricing, picksByMatch, isPicksMode,
}) => {
    const oddsLens = useAppStore((state) => state.oddsLens);

    // ONLY UI user-interactions use event callbacks. State/Data derivatives MUST stay as standard dependencies.
    const handleSelect = useEventCallback(onSelectMatch);
    const handleToggle = useEventCallback(onTogglePin);
    const handlePricing = useEventCallback(onOpenPricing);

    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => setIsMounted(true), []);
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, []);

    const { data: polyResult } = usePolyOdds();
    const { data: featuredProps = [] } = useFeaturedProps(4);
    const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);
    const latestDataUpdatedMs = useMemo(() => {
        return matches.reduce((latest, match) => {
            const updatedMs = parseUpdatedAtMs(match);
            return updatedMs > latest ? updatedMs : latest;
        }, 0);
    }, [matches]);
    const dataAgeMs = latestDataUpdatedMs > 0 ? Math.max(0, nowMs - latestDataUpdatedMs) : null;
    const isDataStale = dataAgeMs !== null && dataAgeMs > STALE_THRESHOLD_MS;
    const freshnessLabel = dataAgeMs === null ? '~ syncing' : formatAgeLabel(dataAgeMs);
    const updatedClockLabel = latestDataUpdatedMs > 0
        ? new Date(latestDataUpdatedMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '~ syncing';

    const resolveFeaturedPropMatch = useCallback((prop: FeaturedProp): Match | undefined => {
        const propMatchId = prop.match_id?.split('_')[0];
        if (propMatchId) {
            const direct = matches.find((m) => m.id === prop.match_id || m.id.split('_')[0] === propMatchId);
            if (direct) return direct;
        }

        const teamNeedle = norm(prop.team || '');
        const oppNeedle = norm(prop.opponent || '');
        const eventDate = prop.event_date;
        return matches.find((m) => {
            const matchDate = m.startTime ? new Date(m.startTime).toISOString().split('T')[0] : '';
            if (eventDate && matchDate && eventDate !== matchDate) return false;
            const home = norm(m.homeTeam?.name || '');
            const away = norm(m.awayTeam?.name || '');
            if (oppNeedle) {
                const pairedHomeAway = home.includes(teamNeedle) && away.includes(oppNeedle);
                const pairedAwayHome = away.includes(teamNeedle) && home.includes(oppNeedle);
                return pairedHomeAway || pairedAwayHome;
            }
            return home.includes(teamNeedle) || away.includes(teamNeedle);
        });
    }, [matches]);

    const openFeaturedProp = useCallback((prop: FeaturedProp, match?: Match) => {
        if (prop.detail_url) {
            window.location.assign(prop.detail_url);
            return;
        }
        if (match) {
            handleSelect(match);
        }
    }, [handleSelect]);

    const featuredPropRows = useMemo(
        () => featuredProps.map((prop) => ({ prop, match: resolveFeaturedPropMatch(prop) })),
        [featuredProps, resolveFeaturedPropMatch]
    );

    // Steal #1: Pre-resolve Market Pulse pipeline outside render loop
    const pulseMarkets = useMemo(() => {
        if (!polyResult || polyResult.rows.length === 0) return [];

        const matchMap = new Map<string, Match>();
        for (const m of matches) {
            matchMap.set(m.id, m);
            const stripped = m.id.split('_')[0];
            if (stripped && !matchMap.has(stripped)) matchMap.set(stripped, m);
        }

        const resolveMatch = (poly: PolyOdds) => {
            if (poly.game_id) {
                const direct = matchMap.get(poly.game_id) || matchMap.get(poly.game_id.split('_')[0]);
                if (direct) return direct;
            }
            const pHome = norm(poly.home_team_name), pAway = norm(poly.away_team_name);
            for (const m of matchMap.values()) {
                const mH = norm(m.homeTeam?.name || ''), mA = norm(m.awayTeam?.name || '');
                if ((mH.includes(pHome) || pHome.includes(mH)) && (mA.includes(pAway) || pAway.includes(mA))) return m;
                if ((mH.includes(pAway) || pAway.includes(mH)) && (mA.includes(pHome) || pHome.includes(mA))) return m;
            }
            return undefined;
        };

        const seen = new Set<string>();
        const resolved = polyResult.rows
            .filter((r) => {
                if (r.home_prob < 0.05 || r.home_prob > 0.95 || r.away_prob < 0.05 || r.away_prob > 0.95) return false;
                const key = [r.home_team_name, r.away_team_name].sort().join('|');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .map(poly => ({ poly, match: resolveMatch(poly) }))
            .filter((entry): entry is { poly: PolyOdds; match: Match } => Boolean(entry.match));

        const hasAnyVolume = resolved.some(({ poly }) => typeof poly.volume === 'number' && poly.volume > 0);
        const sorted = resolved.slice().sort((a, b) => {
            if (hasAnyVolume) {
                return (b.poly.volume ?? 0) - (a.poly.volume ?? 0);
            }
            const leagueCmp = String(a.match.leagueId || a.poly.local_league_id || '')
                .localeCompare(String(b.match.leagueId || b.poly.local_league_id || ''));
            if (leagueCmp !== 0) return leagueCmp;
            return String(a.match.id).localeCompare(String(b.match.id));
        });

        return sorted.slice(0, 5);
    }, [polyResult, matches]);

    // Steal #7: Removed dead featuredMatches pipeline
    const { groupedMatches } = useMemo(() => {
        // 1. SCHWARTZIAN TRANSFORM: Pre-parse times & booleans in O(N) to prevent O(N log N) bottlenecks
        const enriched: EnrichedMatch[] = matches.map((m) => {
            return {
                match: m,
                timeMs: parseSafeDateMs(m.startTime),
                isLive: isMatchLive(m),
                isFinal: isMatchFinal(m),
                isPinned: pinnedMatchIds.has(m.id),
            };
        });

        const groups = new Map<string, EnrichedMatch[]>();
        for (const item of enriched) {
            const lId = (item.match.leagueId || 'other').toLowerCase();
            if (!groups.has(lId)) groups.set(lId, []);
            groups.get(lId)!.push(item);
        }

        // Fast Integer-based Sort
        groups.forEach((groupMatches) => {
            groupMatches.sort((a, b) => {
                if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
                if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;

                // Deterministic string tie-breaker prevents non-deterministic V8 array jumping
                if (a.timeMs === b.timeMs) return String(a.match.id).localeCompare(String(b.match.id));
                return a.timeMs - b.timeMs;
            });
        });

        // O(1) Precomputed Weights replaces O(N*M) nested array search loops
        const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
            const wA = LEAGUE_WEIGHTS.get(a[0]) ?? 99;
            const wB = LEAGUE_WEIGHTS.get(b[0]) ?? 99;
            return wA - wB;
        });

        return { groupedMatches: sortedGroups };

        // isMatchLive and isMatchFinal must remain in dependencies to ensure concurrent safety
    }, [matches, pinnedMatchIds, isMatchLive, isMatchFinal]);

    // Steal #5: Upgraded loading skeleton
    if (isLoading && matches.length === 0) {
        return (
            <div className="min-h-screen bg-[#F4F6FF] pt-2 sm:pt-6 lg:pt-6" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))' }}>
                <div className="max-w-7xl mx-auto w-full px-0 lg:px-6" aria-busy="true" aria-label="Loading matches">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_290px] gap-6 items-start">
                        <div className="flex flex-col w-full rounded-2xl overflow-hidden bg-white ring-1 ring-slate-200 shadow-[0_14px_28px_-20px_rgba(30,64,175,0.22)]">
                            {Array.from({ length: 8 }, (_, i) => <MatchRowSkeleton key={`skel-${i}`} />)}
                        </div>
                        <aside className="hidden lg:flex flex-col gap-4">
                            <div className="h-[280px] bg-white ring-1 ring-slate-200 rounded-2xl shadow-sm animate-pulse" />
                            <div className="h-[240px] bg-white ring-1 ring-slate-200 rounded-2xl shadow-sm animate-pulse" style={{ animationDelay: '100ms' }} />
                        </aside>
                    </div>
                </div>
            </div>
        );
    }

    // Steal #6: Upgraded empty state
    if (matches.length === 0) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex flex-col items-center justify-center min-h-[50vh] text-zinc-400 select-none bg-[#F4F6FF] px-6 text-center"
                style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))' }}
            >
                <div className="w-14 h-14 rounded-[14px] bg-white ring-1 ring-zinc-900/5 flex items-center justify-center mb-4 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)]">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                </div>
                <span className="text-[13px] font-semibold text-zinc-900 mb-1 tracking-tight">No Action Found</span>
                <span className="text-[12px] font-medium text-zinc-500 max-w-[260px] leading-relaxed">There are currently no matches matching your selected criteria.</span>
            </motion.div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F4F6FF]" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))' }}>
            <LayoutGroup id="editorial-feed">
                <div className="max-w-7xl mx-auto px-0 lg:px-6 w-full">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_290px] gap-6 sm:gap-8 items-start">

                        {/* MAIN COLUMN */}
                        <div className="min-w-0 flex flex-col">
                            <div className="space-y-3.5 sm:space-y-6 pt-0 sm:pt-4">
                                <div className="px-2.5 sm:px-0">
                                    <div className="inline-flex items-center gap-2.5 text-[11px] text-[#888888] font-normal">
                                        <span className="font-mono tabular-nums tracking-[0.01em]">Updated {updatedClockLabel}</span>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-mono tabular-nums">{freshnessLabel}</span>
                                        {isLoading ? <span className="text-[#555555]">Refreshing…</span> : null}
                                        {isDataStale ? <span className="text-amber-700 font-medium">Data may be stale</span> : null}
                                    </div>
                                </div>
                                {groupedMatches.map(([leagueId, enrichedMatchArray], groupIndex) => {
                                    const leagueConfig = LEAGUES.find((l) => l.id.toLowerCase() === leagueId);
                                    return (
                                        <LeagueGroup
                                            key={leagueId}
                                            leagueId={leagueId}
                                            leagueName={leagueConfig?.name || 'Other'}
                                            enrichedMatches={enrichedMatchArray}
                                            onSelectMatch={handleSelect}
                                            onTogglePin={handleToggle}
                                            groupIndex={groupIndex}
                                            polyResult={polyResult}
                                            isMounted={isMounted}
                                            picksByMatch={picksByMatch}
                                            isPicksMode={isPicksMode}
                                        />
                                    );
                                })}

                                {isPicksMode && featuredPropRows.length > 0 && (
                                    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_14px_28px_-20px_rgba(30,64,175,0.2)]" aria-label="Featured Props">
                                        <div className="mb-3 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-blue-200 bg-blue-100 text-blue-700">
                                                    <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M1 10L5 6L8 9L13 4" />
                                                        <path d="M9 4H13V8" />
                                                    </svg>
                                                </div>
                                                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-blue-800">Featured Props</span>
                                            </div>
                                            <span className="font-mono text-[8.5px] uppercase tracking-[0.03em] text-blue-300">
                                                {featuredPropRows[0]?.prop.event_date === todayIso ? 'Today' : 'Tomorrow'}
                                            </span>
                                        </div>
                                        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                                            {featuredPropRows.map(({ prop, match }) => (
                                                <button
                                                    key={`strip-${prop.player_name}-${prop.bet_type}`}
                                                    type="button"
                                                    onClick={() => openFeaturedProp(prop, match)}
                                                    className="min-w-[220px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100"
                                                >
                                                    <p className="truncate text-[12px] font-semibold text-slate-900">{prop.player_name}</p>
                                                    <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-slate-500">{STAT_LABELS[prop.bet_type] || prop.bet_type}</p>
                                                    <div className="mt-2 flex items-center justify-between">
                                                        <span className="font-mono text-[12px] font-bold tabular-nums text-slate-900">O {Number(prop.line_value)}</span>
                                                        <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-slate-700">
                                                            {formatOddsByMode(prop.odds_american, oddsLens, 'moneyline') ?? String(prop.odds_american)}
                                                        </span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </section>
                                )}

                                {isPicksMode && (
                                    <PremiumProCTA onPricing={handlePricing} />
                                )}
                            </div>

                            {/* Mobile widgets parity for sidebar content */}
                            <div className="lg:hidden px-2.5 sm:px-0 pt-2.5 space-y-2.5">
                                {pulseMarkets.length > 0 && (
                                    <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-[0_14px_28px_-20px_rgba(30,64,175,0.2)]" aria-label="Market Pulse">
                                        <div className="px-3.5 max-[390px]:px-3 py-2.5 max-[390px]:py-2 border-b border-slate-100 bg-[#F8FAFC] flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-blue-100 border border-blue-200 text-blue-700">
                                                    <svg width="9" height="9" viewBox="0 0 14 14" fill="none"><path d="M7 1L12.5 4.25V10.75L7 14L1.5 10.75V4.25L7 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
                                                </div>
                                                <span className="font-mono text-[10px] max-[390px]:text-[9px] font-bold tracking-[0.1em] text-blue-800 uppercase">Market Pulse</span>
                                            </div>
                                            <span className="font-mono text-[8.5px] max-[390px]:text-[8px] text-blue-300 tracking-[0.03em] uppercase">Via Polymarket</span>
                                        </div>
                                        <div className="divide-y divide-slate-100/80">
                                        {pulseMarkets.slice(0, 3).map(({ poly, match }, i) => (
                                            <MarketPulseRow
                                                key={`mobile-${poly.poly_event_slug || i}`}
                                                poly={poly}
                                                match={match}
                                                onSelect={handleSelect}
                                            />
                                        ))}
                                        </div>
                                    </section>
                                )}

                            </div>
                        </div>

                        {/* SIDEBAR WIDGETS */}
                        <aside className="hidden lg:flex flex-col sticky top-[104px] gap-3 pt-4">
                            {/* Market Pulse — Polymarket (now memoized) */}
                            {pulseMarkets.length > 0 && (
                                <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-[0_14px_28px_-20px_rgba(30,64,175,0.2)]" aria-label="Market Pulse">
                                    <div className="px-3.5 py-2.5 border-b border-slate-100 bg-[#F8FAFC] flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-blue-100 border border-blue-200 text-blue-700">
                                                <svg width="9" height="9" viewBox="0 0 14 14" fill="none"><path d="M7 1L12.5 4.25V10.75L7 14L1.5 10.75V4.25L7 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                                            </div>
                                            <span className="font-mono text-[10px] font-bold tracking-[0.1em] text-blue-800 uppercase">Market Pulse</span>
                                        </div>
                                        <span className="font-mono text-[8.5px] text-blue-300 tracking-[0.03em] uppercase">Via Polymarket</span>
                                    </div>
                                    <div className="divide-y divide-slate-100/80">
                                    {pulseMarkets.map(({ poly, match }, i) => (
                                        <MarketPulseRow
                                            key={poly.poly_event_slug || i}
                                            poly={poly}
                                            match={match}
                                            onSelect={handleSelect}
                                        />
                                    ))}
                                    </div>
                                </section>
                            )}

                        </aside>

                    </div>
                </div>
            </LayoutGroup>
        </div>
    );
};

export default MatchList;
