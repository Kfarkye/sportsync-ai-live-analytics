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
import { LayoutGroup, motion } from 'framer-motion';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { cn } from '@/lib/essence';
import {
    usePolyOdds,
    findPolyForMatch,
    calcEdge,
    americanToImpliedProb,
    polyProbToPercent,
    type PolyOddsResult
} from '@/hooks/usePolyOdds';

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

// Precompute lowercase keys to prevent dictionary misses on malformed API payloads
const LEAGUE_WEIGHTS = new Map(LEAGUES.map((l, i) => [l.id.toLowerCase(), i]));
const MAJOR_LEAGUES = new Set(['nba', 'nfl', 'ncaaf', 'ncaab', 'nhl', 'mlb', 'epl', 'champions']);

/** Fixes Safari's native NaN failure by ensuring Date strings contain the ISO 'T' */
const parseSafeDateMs = (dateString?: string): number => {
    if (!dateString) return Number.MAX_SAFE_INTEGER;
    const normalized = dateString.includes('T') ? dateString : dateString.replace(' ', 'T');
    const ms = Date.parse(normalized);
    return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
};

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
}

/**
 * Flat Primitive Memoization.
 * By computing polyResult internally, row rendering PERFECTLY BAILS OUT
 * when the parent re-renders for a pin toggle elsewhere in the list.
 */
const OptimizedMatchRow = memo(({
    match, isPinned, isLive, isFinal, onSelect, onToggle, polyResult
}: OptimizedMatchRowProps) => {

    const handleSelect = useCallback(() => onSelect(match), [match, onSelect]);
    const handleToggle = useCallback((e: React.MouseEvent | React.KeyboardEvent) => onToggle(match.id, e), [match.id, onToggle]);

    const { polyHomeProb, polyAwayProb, homeEdge, awayEdge, probSource } = useMemo(() => {
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
        let source: 'poly' | 'espn' | undefined;

        if (poly) {
            polyH = polyProbToPercent(poly.homeProb);
            polyA = polyProbToPercent(poly.awayProb);
            source = 'poly';

            const homeML = parseAmericanOdds(match.odds?.moneylineHome ?? match.odds?.home_ml);
            const awayML = parseAmericanOdds(match.odds?.moneylineAway ?? match.odds?.away_ml);

            if (homeML !== 0) edgeH = calcEdge(poly.homeProb, americanToImpliedProb(homeML));
            if (awayML !== 0) edgeA = calcEdge(poly.awayProb, americanToImpliedProb(awayML));
        }

        return { polyHomeProb: polyH, polyAwayProb: polyA, homeEdge: edgeH, awayEdge: edgeA, probSource: source };
    }, [polyResult, match]);

    return (
        <motion.div layout="position" layoutId={`match-row-${match.id}`} initial={false}>
            <MatchRow
                match={match}
                isPinned={isPinned}
                isLive={isLive}
                isFinal={isFinal}
                onSelect={handleSelect}
                onTogglePin={handleToggle}
                {...(polyHomeProb !== undefined ? { polyHomeProb } : {})}
                {...(polyAwayProb !== undefined ? { polyAwayProb } : {})}
                {...(homeEdge !== undefined ? { homeEdge } : {})}
                {...(awayEdge !== undefined ? { awayEdge } : {})}
                {...(probSource ? { probSource } : {})}
            />
        </motion.div>
    );
});
OptimizedMatchRow.displayName = 'OptimizedMatchRow';

// ============================================================================
// FEATURED HERO WIDGET
// ============================================================================

const FeaturedHero = memo(({ match, onSelect, isLive }: { match: Match; onSelect: (m: Match) => void; isLive: boolean }) => {
    const handleClick = useCallback(() => onSelect(match), [match, onSelect]);

    const homeColor = match.homeTeam?.color || '#1c1c1e';
    const awayColor = match.awayTeam?.color || '#1c1c1e';

    const safeHomeName = match.homeTeam?.name ?? 'TBA';
    const safeAwayName = match.awayTeam?.name ?? 'TBA';

    // Interpolate critical info into the root ARIA label so assistive tech doesn't miss it
    const ariaAnnouncement = `Featured Match: ${safeAwayName} ${isLive && match.awayScore != null ? match.awayScore : ''} versus ${safeHomeName} ${isLive && match.homeScore != null ? match.homeScore : ''}. ${isLive ? 'Live right now.' : 'Upcoming event.'}`;

    const timeMs = parseSafeDateMs(match.startTime);

    return (
        <button
            type="button"
            onClick={handleClick}
            className={cn(
                "relative h-[160px] w-full text-left rounded-2xl border border-slate-200 overflow-hidden cursor-pointer group",
                "transition-all duration-300 hover:border-slate-300 hover:shadow-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50"
            )}
            style={{ background: '#ffffff' }}
            aria-label={ariaAnnouncement}
        >
            <div
                className="absolute inset-0 opacity-70 transition-opacity duration-300 group-hover:opacity-90 pointer-events-none"
                style={{
                    // CSS color-mix handles malformed 3-char hex strings flawlessly
                    background: `linear-gradient(135deg, color-mix(in srgb, ${awayColor} 8%, transparent) 0%, #ffffff 50%, color-mix(in srgb, ${homeColor} 8%, transparent) 100%)`,
                }}
            />
            <div className="absolute inset-0 bg-white/70 pointer-events-none" />

            {/* aria-hidden restricts the screen reader to ONLY read the button's aria-label */}
            <div className="relative z-10 h-full flex flex-col justify-between p-5 pointer-events-none" aria-hidden="true">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {isLive ? (
                            <div className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                                <span className="text-[9px] font-bold text-rose-600 uppercase tracking-widest">Live</span>
                            </div>
                        ) : (
                            <div className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                                <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest" suppressHydrationWarning>
                                    {timeMs === Number.MAX_SAFE_INTEGER ? 'TBA' : new Date(timeMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                </span>
                            </div>
                        )}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                        {match.leagueId}
                    </span>
                </div>

                <div className="flex items-center justify-between px-2">
                    <div className="flex flex-col items-center gap-2">
                        <TeamLogo logo={match.awayTeam?.logo} name={safeAwayName} className="w-12 h-12 object-contain drop-shadow-sm" />
                        <span className="text-sm font-bold text-slate-900 tracking-tight">
                            {match.awayTeam?.abbreviation || safeAwayName.substring(0, 3).toUpperCase()}
                        </span>
                    </div>

                    <div className="flex flex-col items-center">
                        {isLive ? (
                            <div className="text-3xl font-mono font-bold text-slate-900 tracking-tighter tabular-nums flex items-center gap-3">
                                <span>{match.awayScore ?? 0}</span>
                                <span className="text-slate-300">-</span>
                                <span>{match.homeScore ?? 0}</span>
                            </div>
                        ) : (
                            <span className="text-2xl font-black text-slate-300 italic">VS</span>
                        )}
                    </div>

                    <div className="flex flex-col items-center gap-2">
                        <TeamLogo logo={match.homeTeam?.logo} name={safeHomeName} className="w-12 h-12 object-contain drop-shadow-sm" />
                        <span className="text-sm font-bold text-slate-900 tracking-tight">
                            {match.homeTeam?.abbreviation || safeHomeName.substring(0, 3).toUpperCase()}
                        </span>
                    </div>
                </div>

                <div className="flex items-center justify-center">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] truncate max-w-[200px]">
                        {isLive ? getPeriodDisplay(match) : 'Headline Event'}
                    </span>
                </div>
            </div>
        </button>
    );
});
FeaturedHero.displayName = 'FeaturedHero';

// ============================================================================
// SKELETON
// ============================================================================

const MatchRowSkeleton = () => (
    <div className="w-full h-[72px] border-b border-slate-200 flex items-center animate-pulse" aria-hidden="true">
        <div className="w-[80px] h-full border-r border-slate-200 bg-slate-50" />
        <div className="flex-1 px-6 flex flex-col gap-2">
            <div className="h-3 w-32 bg-slate-200 rounded" />
            <div className="h-3 w-24 bg-slate-100 rounded" />
        </div>
    </div>
);

// ============================================================================
// LEAGUE GROUP
// ============================================================================

const LeagueGroup = memo(({
    leagueId, leagueName, enrichedMatches, onSelectMatch, onTogglePin, groupIndex, polyResult,
}: {
    leagueId: string; leagueName: string; enrichedMatches: EnrichedMatch[];
    onSelectMatch: (match: Match) => void; onTogglePin: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
    groupIndex: number; polyResult?: PolyOddsResult;
}) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [measureRef, bounds] = useMeasure();
    const toggle = useCallback(() => setIsExpanded((prev) => !prev), []);

    // O(1) mathematical extraction, impervious to sorting index changes
    const earliestTime = useMemo(() => {
        const earliestMs = enrichedMatches.reduce((min, em) => {
            if (em.isFinal) return min;
            return em.timeMs < min ? em.timeMs : min;
        }, Number.MAX_SAFE_INTEGER);

        return earliestMs === Number.MAX_SAFE_INTEGER
            ? ''
            : new Date(earliestMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }, [enrichedMatches]);

    return (
        <motion.div
            layout="position"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIndex * STAGGER_DELAY }}
            className="flex flex-col relative"
        >
            <button
                type="button"
                onClick={toggle}
                className={cn(
                    'flex items-center justify-between w-full min-h-[44px] px-4 py-3',
                    'bg-white sticky top-[56px] lg:top-[64px] z-20',
                    'transition-colors hover:bg-slate-50',
                    'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500',
                    isExpanded ? 'border border-slate-200 border-b-0 rounded-t-xl shadow-sm' : 'border border-slate-200 rounded-xl shadow-sm'
                )}
                aria-expanded={isExpanded}
                aria-controls={`league-content-${leagueId}`}
            >
                <div className="flex items-center gap-2">
                    <h3 className="text-[11px] font-bold text-slate-900 tracking-wide uppercase">{leagueName}</h3>
                    <span className="text-[14px] text-slate-300 leading-none" aria-hidden="true">·</span>
                    <span className="text-[11px] font-medium text-slate-500">
                        {enrichedMatches.length} {enrichedMatches.length === 1 ? 'game' : 'games'}
                    </span>
                    {earliestTime && (
                        <>
                            <span className="text-[14px] text-slate-300 leading-none" aria-hidden="true">·</span>
                            <span className="text-[11px] font-medium text-slate-500" suppressHydrationWarning>
                                {earliestTime}
                            </span>
                        </>
                    )}
                </div>
                <motion.svg
                    xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className="text-slate-400" animate={{ rotate: isExpanded ? 0 : -90 }} transition={{ duration: 0.2 }}
                >
                    <path d="m6 9 6 6 6-6" />
                </motion.svg>
            </button>

            <motion.div
                id={`league-content-${leagueId}`}
                initial={false}
                animate={{
                    height: isExpanded ? bounds.height || 'auto' : 0,
                    opacity: isExpanded ? 1 : 0,
                }}
                transition={ACCORDION_SPRING}
                className={cn(
                    'overflow-hidden relative z-10 -mt-[1px]',
                    isExpanded && 'bg-white border border-slate-200 border-t-0 rounded-b-xl shadow-sm'
                )}
                aria-hidden={!isExpanded}
            >
                <div ref={measureRef} className="flex flex-col">
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
                        />
                    ))}
                </div>
            </motion.div>
        </motion.div>
    );
});
LeagueGroup.displayName = 'LeagueGroup';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const MatchList: React.FC<MatchListProps> = ({
    matches, onSelectMatch, isLoading, pinnedMatchIds, onTogglePin, isMatchLive, isMatchFinal, onOpenPricing,
}) => {
    // ONLY UI user-interactions use event callbacks. State/Data derivatives MUST stay as standard dependencies.
    const handleSelect = useEventCallback(onSelectMatch);
    const handleToggle = useEventCallback(onTogglePin);
    const handlePricing = useEventCallback(onOpenPricing);

    const { data: polyResult } = usePolyOdds();

    const { groupedMatches, featuredMatches } = useMemo(() => {
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
            const lId = (item.match.leagueId || 'unknown').toLowerCase();
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

        const activeFilterSort = (arr: EnrichedMatch[]) => arr
            .filter((e) => !e.isFinal)
            .sort((a, b) => {
                if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
                if (a.timeMs === b.timeMs) return String(a.match.id).localeCompare(String(b.match.id));
                return a.timeMs - b.timeMs;
            });

        const possibleHeadlines = activeFilterSort(
            enriched.filter((e) => MAJOR_LEAGUES.has(e.match.leagueId?.toLowerCase() ?? ''))
        );

        const headlines = possibleHeadlines.length > 0
            ? possibleHeadlines.slice(0, 2)
            : activeFilterSort(enriched).slice(0, 2);

        return { groupedMatches: sortedGroups, featuredMatches: headlines };

        // isMatchLive and isMatchFinal must remain in dependencies to ensure concurrent safety
    }, [matches, pinnedMatchIds, isMatchLive, isMatchFinal]);

    if (isLoading && matches.length === 0) {
        return (
            <div className="max-w-7xl mx-auto w-full pt-4" aria-busy="true" aria-label="Loading matches">
                <div className="border-t border-slate-200">
                    {Array.from({ length: 6 }, (_, i) => <MatchRowSkeleton key={`skel-${i}`} />)}
                </div>
            </div>
        );
    }

    if (matches.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500">
                <span className="text-xl mb-4 opacity-50" aria-hidden="true">∅</span>
                <span className="text-sm font-medium uppercase tracking-widest opacity-70">No Action</span>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 pb-32">
            <LayoutGroup id="editorial-feed">
                <div className="max-w-7xl mx-auto px-0 lg:px-6 w-full">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-12 items-start">

                        {/* MAIN COLUMN */}
                        <div className="min-w-0 flex flex-col gap-10">
                            <div className="space-y-8 pt-6">
                                {groupedMatches.map(([leagueId, enrichedMatchArray], groupIndex) => {
                                    const leagueConfig = LEAGUES.find((l) => l.id.toLowerCase() === leagueId);
                                    return (
                                        <LeagueGroup
                                            key={leagueId}
                                            leagueId={leagueId}
                                            leagueName={leagueConfig?.name || leagueId.toUpperCase()}
                                            enrichedMatches={enrichedMatchArray}
                                            onSelectMatch={handleSelect}
                                            onTogglePin={handleToggle}
                                            groupIndex={groupIndex}
                                            polyResult={polyResult}
                                        />
                                    );
                                })}
                            </div>
                        </div>

                        {/* SIDEBAR WIDGETS */}
                        <aside className="hidden lg:flex flex-col sticky top-[128px] space-y-6 pt-6">
                            {featuredMatches.length > 0 && (
                                <section className="mb-2" aria-label="Headline Events">
                                    <div className="flex items-center gap-2 mb-3 px-1">
                                        <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full shadow-[0_0_8px_rgba(6,182,212,0.35)] animate-pulse" />
                                        <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest m-0">
                                            Headline Events
                                        </h2>
                                    </div>
                                    <div className="flex flex-col gap-4">
                                        {featuredMatches.map((data) => (
                                            <FeaturedHero
                                                key={`feat-${data.match.id}`}
                                                match={data.match}
                                                onSelect={handleSelect}
                                                isLive={data.isLive}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* Pro Upsell Widget */}
                            <section className="p-7 rounded-2xl bg-white border border-slate-200 relative overflow-hidden shadow-sm">
                                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-60 pointer-events-none" />
                                <div className="relative z-10">
                                    <h3 className="text-[11px] font-bold text-[#2997FF] uppercase tracking-widest mb-3">
                                        Pro Access
                                    </h3>
                                    <p className="text-[13px] text-slate-600 mb-6 leading-relaxed font-medium tracking-tight">
                                        Unlock real-time institutional feeds and sharp money indicators.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handlePricing}
                                        className={cn(
                                            "w-full py-3 bg-slate-900 hover:bg-slate-800 text-white",
                                            "text-[11px] font-bold uppercase tracking-widest rounded-full",
                                            "transition-colors flex items-center justify-center outline-none",
                                            "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-900 focus-visible:ring-offset-white"
                                        )}
                                    >
                                        Upgrade
                                    </button>
                                </div>
                            </section>
                        </aside>

                    </div>
                </div>
            </LayoutGroup>
        </div>
    );
};

export default MatchList;
