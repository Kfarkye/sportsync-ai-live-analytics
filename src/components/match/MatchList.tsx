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
import { cn } from '@/lib/essence';
import { getTeamColor } from '@/lib/teamColors';
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

        const homeML = parseAmericanOdds(match.odds?.moneylineHome ?? match.odds?.home_ml);
        const awayML = parseAmericanOdds(match.odds?.moneylineAway ?? match.odds?.away_ml);

        if (poly) {
            polyH = polyProbToPercent(poly.homeProb);
            polyA = polyProbToPercent(poly.awayProb);
            source = 'poly';

            if (homeML !== 0) edgeH = calcEdge(poly.homeProb, americanToImpliedProb(homeML));
            if (awayML !== 0) edgeA = calcEdge(poly.awayProb, americanToImpliedProb(awayML));
        } else if (homeML !== 0 && awayML !== 0) {
            // Fallback: derive client-side probability from sportsbook moneyline
            polyH = americanToImpliedProb(homeML) * 100;
            polyA = americanToImpliedProb(awayML) * 100;
            source = 'espn';
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
// MARKET PULSE ROW — Polymarket sidebar widget row
// ============================================================================

function formatVolume(vol: number): string {
    if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
    return `$${vol}`;
}

const MarketPulseRow = memo(({ poly, matchMap, onSelect, isLast }: {
    poly: PolyOdds;
    matchMap: Map<string, Match>;
    onSelect: (m: Match) => void;
    isLast: boolean;
}) => {
    const homeProb = Math.round(poly.home_prob * 100);
    const awayProb = Math.round(poly.away_prob * 100);
    const favIsAway = awayProb > homeProb;

    // Resolve match: try game_id first, then fuzzy team-name match
    const match = useMemo(() => {
        if (poly.game_id) {
            const direct = matchMap.get(poly.game_id) || matchMap.get(poly.game_id.split('_')[0]);
            if (direct) return direct;
        }
        // Fuzzy: find any match where team names overlap
        const normPoly = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
        const polyHome = normPoly(poly.home_team_name);
        const polyAway = normPoly(poly.away_team_name);
        for (const m of matchMap.values()) {
            const mHome = normPoly(m.homeTeam?.name || '');
            const mAway = normPoly(m.awayTeam?.name || '');
            if ((mHome.includes(polyHome) || polyHome.includes(mHome)) &&
                (mAway.includes(polyAway) || polyAway.includes(mAway))) return m;
            // Check flipped orientation
            if ((mHome.includes(polyAway) || polyAway.includes(mHome)) &&
                (mAway.includes(polyHome) || polyHome.includes(mAway))) return m;
        }
        return undefined;
    }, [poly, matchMap]);

    const awayColor = getTeamColor(poly.away_team_name) || match?.awayTeam?.color || '#a1a1aa';
    const homeColor = getTeamColor(poly.home_team_name) || match?.homeTeam?.color || '#a1a1aa';

    const handleClick = useCallback(() => {
        if (match) onSelect(match);
    }, [match, onSelect]);

    return (
        <button
            type="button"
            onClick={handleClick}
            className={cn(
                "w-full text-left px-3.5 py-2.5 transition-colors hover:bg-zinc-50 cursor-pointer",
                !isLast && "border-b border-zinc-100"
            )}
        >
            {/* Away row */}
            <div className="flex justify-between items-center mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                    {match?.awayTeam?.logo ? (
                        <TeamLogo logo={match.awayTeam.logo} name={poly.away_team_name} className="w-4 h-4 object-contain shrink-0" />
                    ) : (
                        <span className="w-4 h-4 shrink-0" />
                    )}
                    <span className={cn(
                        "text-[12px] truncate",
                        favIsAway ? "font-semibold text-zinc-900" : "font-normal text-zinc-400"
                    )}>{poly.away_team_name}</span>
                </div>
                <span className={cn(
                    "font-mono text-[11px] font-semibold tabular-nums shrink-0",
                    favIsAway ? "text-zinc-900" : "text-zinc-400"
                )}>{awayProb}%</span>
            </div>
            {/* Home row */}
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2 min-w-0">
                    {match?.homeTeam?.logo ? (
                        <TeamLogo logo={match.homeTeam.logo} name={poly.home_team_name} className="w-4 h-4 object-contain shrink-0" />
                    ) : (
                        <span className="w-4 h-4 shrink-0" />
                    )}
                    <span className={cn(
                        "text-[12px] truncate",
                        !favIsAway ? "font-semibold text-zinc-900" : "font-normal text-zinc-400"
                    )}>{poly.home_team_name}</span>
                </div>
                <span className={cn(
                    "font-mono text-[11px] font-semibold tabular-nums shrink-0",
                    !favIsAway ? "text-zinc-900" : "text-zinc-400"
                )}>{homeProb}%</span>
            </div>
            {/* Dual prob bar — team brand colors */}
            <div className="flex h-1 rounded-full overflow-hidden gap-px">
                <div
                    className="rounded-l-full transition-all duration-500"
                    style={{
                        width: `${awayProb}%`,
                        backgroundColor: awayColor,
                        opacity: favIsAway ? 0.85 : 0.2,
                    }}
                />
                <div
                    className="rounded-r-full transition-all duration-500"
                    style={{
                        width: `${homeProb}%`,
                        backgroundColor: homeColor,
                        opacity: !favIsAway ? 0.85 : 0.2,
                    }}
                />
            </div>
            {/* Meta row */}
            <div className="flex justify-between items-center mt-1.5">
                <span className="font-mono text-[9px] text-zinc-400 tracking-[0.04em] uppercase">{poly.local_league_id}</span>
                <span className="font-mono text-[9px] text-zinc-400">{formatVolume(poly.volume)} vol</span>
            </div>
        </button>
    );
});
MarketPulseRow.displayName = 'MarketPulseRow';

// ============================================================================
// FEATURED PROP ROW — Player headshot prop widget
// ============================================================================

const PropRow = memo(({ prop, isLast }: { prop: FeaturedProp; isLast: boolean }) => {
    const isPlus = prop.odds_american > 0;
    const statLabel = STAT_LABELS[prop.bet_type] || prop.bet_type.toUpperCase();

    return (
        <div
            className={cn(
                "flex items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-zinc-50 cursor-pointer",
                !isLast && "border-b border-zinc-100"
            )}
        >
            {/* Headshot */}
            <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-100 border border-zinc-200 shrink-0">
                <img
                    src={prop.headshot_url}
                    alt=""
                    className="w-full h-full object-cover object-top"
                    loading="lazy"
                />
            </div>
            {/* Name + Team */}
            <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium text-zinc-900 truncate">{prop.player_name}</div>
                <div className="font-mono text-[9.5px] text-zinc-400 tracking-[0.04em] mt-px">
                    {prop.team.split(' ').pop()} · {statLabel}
                </div>
            </div>
            {/* Line + Odds */}
            <div className="text-right shrink-0">
                <div className="font-mono text-[12px] font-semibold text-zinc-900 tracking-[-0.01em]">
                    O {Number(prop.line_value)}
                </div>
                <div className="font-mono text-[10px] text-zinc-500 mt-px">
                    {isPlus ? '+' : ''}{prop.odds_american}
                </div>
            </div>
        </div>
    );
});
PropRow.displayName = 'PropRow';

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
                    'bg-zinc-50/80 backdrop-blur-sm sticky top-[92px] z-10 border-b border-zinc-200/60',
                    'transition-colors hover:bg-zinc-100',
                    'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-400',
                    isExpanded ? 'border border-zinc-200 border-b-zinc-200/60 rounded-t-xl shadow-sm' : 'border border-zinc-200 border-b-transparent rounded-xl shadow-sm'
                )}
                aria-expanded={isExpanded}
                aria-controls={`league-content-${leagueId}`}
            >
                <div className="flex items-center gap-2">
                    <h3 className="text-[11px] font-bold text-zinc-900 tracking-wide uppercase" style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", letterSpacing: "0.08em" }}>{leagueName}</h3>
                    <span className="text-[14px] text-zinc-300 leading-none" aria-hidden="true">·</span>
                    <span className="text-[11px] font-medium text-zinc-500">
                        {enrichedMatches.length} {enrichedMatches.length === 1 ? 'game' : 'games'}
                    </span>
                    {earliestTime && (
                        <>
                            <span className="text-[14px] text-zinc-300 leading-none" aria-hidden="true">·</span>
                            <span className="text-[11px] font-medium text-zinc-500" suppressHydrationWarning>
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
    const { data: featuredProps = [] } = useFeaturedProps(4);

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
        <div className="min-h-screen bg-zinc-100 pb-32">
            <LayoutGroup id="editorial-feed">
                <div className="max-w-7xl mx-auto px-0 lg:px-6 w-full">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_290px] gap-8 items-start">

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
                        <aside className="hidden lg:flex flex-col sticky top-[104px] gap-3.5 pt-6">
                            {/* Market Pulse — Polymarket */}
                            {polyResult && polyResult.rows.length > 0 && (
                                <section
                                    className="rounded-xl bg-white border border-zinc-200 overflow-hidden"
                                    aria-label="Market Pulse"
                                >
                                    <div className="px-3.5 py-2.5 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                                        <div className="flex items-center gap-1.5">
                                            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                                                <path d="M7 1L12.5 4.25V10.75L7 14L1.5 10.75V4.25L7 1Z" stroke="#3b82f6" strokeWidth="1.3" fill="rgba(59,130,246,0.06)"/>
                                            </svg>
                                            <span className="font-mono text-[10px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">Market Pulse</span>
                                        </div>
                                        <span className="font-mono text-[8.5px] text-zinc-300 tracking-[0.03em] uppercase">Via Polymarket</span>
                                    </div>
                                    {(() => {
                                        const matchMap = new Map<string, Match>();
                                        matches.forEach((m) => {
                                            matchMap.set(m.id, m);
                                            const stripped = m.id.split('_')[0];
                                            if (stripped) matchMap.set(stripped, m);
                                        });
                                        // Filter: exclude resolved markets (>95% or <5%), dedupe by team pair
                                        const seen = new Set<string>();
                                        const topMarkets = polyResult.rows
                                            .filter((r) => {
                                                if (r.home_prob < 0.05 || r.home_prob > 0.95) return false;
                                                if (r.away_prob < 0.05 || r.away_prob > 0.95) return false;
                                                const key = [r.home_team_name, r.away_team_name].sort().join('|');
                                                if (seen.has(key)) return false;
                                                seen.add(key);
                                                return true;
                                            })
                                            .sort((a, b) => new Date(b.game_start_time).getTime() - new Date(a.game_start_time).getTime())
                                            .slice(0, 5);
                                        if (topMarkets.length === 0) return (
                                            <div className="px-3.5 py-4 text-center text-[11px] text-zinc-400">No active markets</div>
                                        );
                                        return topMarkets.map((poly, i) => (
                                            <MarketPulseRow
                                                key={poly.poly_event_slug || i}
                                                poly={poly}
                                                matchMap={matchMap}
                                                onSelect={handleSelect}
                                                isLast={i === topMarkets.length - 1}
                                            />
                                        ));
                                    })()}
                                </section>
                            )}

                            {/* Featured Props */}
                            {featuredProps.length > 0 && (
                                <section
                                    className="rounded-xl bg-white border border-zinc-200 overflow-hidden"
                                    aria-label="Featured Props"
                                >
                                    <div className="px-3.5 py-2.5 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                                        <div className="flex items-center gap-1.5">
                                            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M1 10L5 6L8 9L13 4"/><path d="M9 4H13V8"/>
                                            </svg>
                                            <span className="font-mono text-[10px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">Featured Props</span>
                                        </div>
                                        <span className="font-mono text-[8.5px] text-zinc-300 tracking-[0.03em] uppercase">
                                            {featuredProps[0]?.event_date === new Date().toISOString().split('T')[0] ? 'Today' : 'Tomorrow'}
                                        </span>
                                    </div>
                                    {featuredProps.map((prop, i) => (
                                        <PropRow key={prop.player_name + prop.bet_type} prop={prop} isLast={i === featuredProps.length - 1} />
                                    ))}
                                </section>
                            )}

                            {/* Pro CTA */}
                            <section className="rounded-xl bg-white border border-zinc-200 p-[18px]">
                                <h3
                                    className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-zinc-500 uppercase mb-2"
                                >
                                    Pro Access
                                </h3>
                                <p className="text-[13px] text-zinc-500 leading-relaxed mb-3.5">
                                    Full prop analysis, L5 hit rates, AI rationale, and real-time line movement alerts.
                                </p>
                                <button
                                    type="button"
                                    onClick={handlePricing}
                                    className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-[12px] font-semibold rounded-lg transition-colors tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900"
                                >
                                    Upgrade
                                </button>
                            </section>
                        </aside>

                    </div>
                </div>
            </LayoutGroup>
        </div>
    );
};

export default MatchList;
