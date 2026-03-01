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
import { cn } from '@/lib/essence';
import { getTeamColor, getTeamLogo } from '@/lib/teamColors';
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

const LEAGUE_WEIGHTS = new Map(LEAGUES.map((l, i) => [l.id.toLowerCase(), i]));

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

const MarketPulseRow = memo(({ poly, match, onSelect, isLast }: {
    poly: PolyOdds;
    match?: Match;
    onSelect: (m: Match) => void;
    isLast: boolean;
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

    const handleClick = useCallback(() => {
        if (match) onSelect(match);
    }, [match, onSelect]);

    return (
        <button
            type="button"
            onClick={handleClick}
            className={cn(
                "group w-full text-left px-3.5 py-3 transition-colors duration-150 outline-none",
                match ? "hover:bg-zinc-50 cursor-pointer focus-visible:bg-zinc-50" : "opacity-80 cursor-default",
                !isLast && "border-b border-zinc-100"
            )}
        >
            {/* Away row */}
            <div className="flex justify-between items-center mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-[18px] h-[18px] rounded-full bg-zinc-100 flex items-center justify-center shrink-0 border border-black/5 overflow-hidden">
                        {awayLogo ? (
                            <TeamLogo logo={awayLogo} name={poly.away_team_name} className="w-3.5 h-3.5 object-contain" />
                        ) : <span className="w-3 h-3 block" />}
                    </div>
                    <span className={cn(
                        "text-[12.5px] truncate tracking-tight transition-colors duration-150",
                        favIsAway ? "font-semibold text-zinc-900" : "font-medium text-zinc-500"
                    )}>{poly.away_team_name}</span>
                </div>
                <span className={cn(
                    "font-mono text-[11.5px] tabular-nums shrink-0 tracking-tight",
                    favIsAway ? "font-bold text-zinc-900" : "font-medium text-zinc-400"
                )}>{awayProb}%</span>
            </div>
            {/* Home row */}
            <div className="flex justify-between items-center mb-2.5">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-[18px] h-[18px] rounded-full bg-zinc-100 flex items-center justify-center shrink-0 border border-black/5 overflow-hidden">
                        {homeLogo ? (
                            <TeamLogo logo={homeLogo} name={poly.home_team_name} className="w-3.5 h-3.5 object-contain" />
                        ) : <span className="w-3 h-3 block" />}
                    </div>
                    <span className={cn(
                        "text-[12.5px] truncate tracking-tight transition-colors duration-150",
                        !favIsAway ? "font-semibold text-zinc-900" : "font-medium text-zinc-500"
                    )}>{poly.home_team_name}</span>
                </div>
                <span className={cn(
                    "font-mono text-[11.5px] tabular-nums shrink-0 tracking-tight",
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
                <span className="font-mono text-[9px] text-zinc-500 tracking-[0.06em] uppercase font-semibold">{poly.local_league_id}</span>
                <span className="font-mono text-[9.5px] text-zinc-500 tracking-[0.02em] font-medium">{formatVolume(poly.volume)} vol</span>
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
    const statLabel = STAT_LABELS[prop.bet_type] || prop.bet_type.replace(/_/g, ' ').toUpperCase();

    return (
        <div className={cn(
            "group flex items-center gap-3 px-3.5 py-3 transition-colors duration-150 hover:bg-zinc-50 cursor-pointer",
            !isLast && "border-b border-zinc-100"
        )}>
            {/* Headshot */}
            <div className="relative w-10 h-10 shrink-0">
                <div className="w-full h-full rounded-full overflow-hidden bg-zinc-100 border border-black/5 shadow-sm">
                    <img src={prop.headshot_url} alt="" className="w-full h-full object-cover object-top" loading="lazy" />
                </div>
            </div>
            {/* Name + Team */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="text-[13px] font-semibold text-zinc-900 truncate tracking-tight leading-tight">{prop.player_name}</div>
                <div className="font-mono text-[9.5px] text-zinc-500 tracking-[0.03em] mt-[3px] font-medium flex items-center">
                    <span className="text-zinc-400 uppercase">{prop.team.split(' ').pop()}</span>
                    <span className="mx-1.5 opacity-40">·</span>
                    <span className="text-zinc-700 font-semibold uppercase">{statLabel}</span>
                </div>
            </div>
            {/* Line + Odds */}
            <div className="text-right shrink-0 flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                    <span className="text-[9.5px] text-zinc-400 font-semibold uppercase">O</span>
                    <span className="font-mono text-[12.5px] font-bold text-zinc-900 tabular-nums tracking-tight">
                        {Number(prop.line_value)}
                    </span>
                </div>
                <div className={cn(
                    "font-mono text-[10px] font-semibold tabular-nums tracking-tight px-1.5 py-[2px] rounded min-w-[36px] flex items-center justify-center leading-none",
                    isPlus ? "text-zinc-700 bg-zinc-100 ring-1 ring-zinc-900/5" : "text-zinc-500 bg-transparent ring-1 ring-zinc-200/80"
                )}>
                    {isPlus ? '+' : ''}{prop.odds_american}
                </div>
            </div>
        </div>
    );
});
PropRow.displayName = 'PropRow';

// ============================================================================
// PREMIUM PRO CTA (Extracted for reuse)
// ============================================================================

const PremiumProCTA = memo(({ onPricing, className }: { onPricing: () => void; className?: string }) => (
    <section className={cn(
        "relative rounded-xl bg-[linear-gradient(145deg,#18181b,#09090b)] p-5 overflow-hidden shadow-[0_8px_24px_-8px_rgba(0,0,0,0.2)] ring-1 ring-white/10",
        className
    )}>
        <div className="relative z-10">
            <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center justify-center w-[20px] h-[20px] rounded bg-white text-black shadow-[0_0_12px_rgba(255,255,255,0.15)]">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                    </svg>
                </div>
                <h3 className="font-mono text-[10px] font-bold tracking-[0.14em] text-white uppercase">
                    Pro Access
                </h3>
            </div>
            <p className="text-[12.5px] text-zinc-400 leading-relaxed mb-4 font-medium">
                Unlock deep AI prop analysis, L5 hit rates, and real-time line movement alerts.
            </p>
            <button
                type="button"
                onClick={onPricing}
                className="group/btn w-full h-[40px] bg-white text-zinc-950 text-[12.5px] font-bold rounded-lg transition-all outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 focus-visible:ring-white flex items-center justify-center gap-2 shadow-sm"
            >
                Upgrade
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover/btn:translate-x-0.5 text-zinc-400 group-hover/btn:text-zinc-950">
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
            className="flex flex-col relative transform-gpu"
        >
            <button
                type="button"
                onClick={toggle}
                className={cn(
                    'flex items-center justify-between w-full min-h-[40px] sm:min-h-[44px] px-3 sm:px-4 py-2.5 sm:py-3',
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
                            'overflow-hidden relative z-10 -mt-[1px]',
                            'bg-white border border-slate-200 border-t-0 rounded-b-xl shadow-sm'
                        )}
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
    matches, onSelectMatch, isLoading, pinnedMatchIds, onTogglePin, isMatchLive, isMatchFinal, onOpenPricing,
}) => {
    // ONLY UI user-interactions use event callbacks. State/Data derivatives MUST stay as standard dependencies.
    const handleSelect = useEventCallback(onSelectMatch);
    const handleToggle = useEventCallback(onTogglePin);
    const handlePricing = useEventCallback(onOpenPricing);

    const { data: polyResult } = usePolyOdds();
    const { data: featuredProps = [] } = useFeaturedProps(4);

    // Steal #1: Pre-resolve Market Pulse pipeline outside render loop
    const pulseMarkets = useMemo(() => {
        if (!polyResult || polyResult.rows.length === 0) return [];

        const matchMap = new Map<string, Match>();
        for (const m of matches) {
            matchMap.set(m.id, m);
            const stripped = m.id.split('_')[0];
            if (stripped && !matchMap.has(stripped)) matchMap.set(stripped, m);
        }

        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
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
        return polyResult.rows
            .filter((r) => {
                if (r.home_prob < 0.05 || r.home_prob > 0.95 || r.away_prob < 0.05 || r.away_prob > 0.95) return false;
                const key = [r.home_team_name, r.away_team_name].sort().join('|');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => new Date(b.game_start_time).getTime() - new Date(a.game_start_time).getTime())
            .slice(0, 5)
            .map(poly => ({ poly, match: resolveMatch(poly) }));
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

        return { groupedMatches: sortedGroups };

        // isMatchLive and isMatchFinal must remain in dependencies to ensure concurrent safety
    }, [matches, pinnedMatchIds, isMatchLive, isMatchFinal]);

    // Steal #5: Upgraded loading skeleton
    if (isLoading && matches.length === 0) {
        return (
            <div className="min-h-screen bg-[#F9F9FA] pb-8 pt-2 sm:pt-6 lg:pt-6">
                <div className="max-w-7xl mx-auto w-full px-0 lg:px-6" aria-busy="true" aria-label="Loading matches">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_290px] gap-8 items-start">
                        <div className="flex flex-col w-full rounded-xl overflow-hidden bg-white ring-1 ring-zinc-950/5 shadow-sm">
                            {Array.from({ length: 8 }, (_, i) => <MatchRowSkeleton key={`skel-${i}`} />)}
                        </div>
                        <aside className="hidden lg:flex flex-col gap-4">
                            <div className="h-[280px] bg-white ring-1 ring-black/5 rounded-xl shadow-sm animate-pulse" />
                            <div className="h-[240px] bg-white ring-1 ring-black/5 rounded-xl shadow-sm animate-pulse" style={{ animationDelay: '100ms' }} />
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
                className="flex flex-col items-center justify-center min-h-[50vh] text-zinc-400 select-none bg-[#F9F9FA] px-6 text-center"
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
        <div className="min-h-screen bg-[#F9F9FA] pb-8">
            <LayoutGroup id="editorial-feed">
                <div className="max-w-7xl mx-auto px-0 lg:px-6 w-full">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_290px] gap-8 items-start">

                        {/* MAIN COLUMN */}
                        <div className="min-w-0 flex flex-col">
                            <div className="space-y-3 sm:space-y-6 pt-2 sm:pt-6">
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
                        <aside className="hidden lg:flex flex-col sticky top-[104px] gap-4 pt-6">
                            {/* Market Pulse — Polymarket (now memoized) */}
                            {pulseMarkets.length > 0 && (
                                <section className="rounded-xl bg-white border border-zinc-200 overflow-hidden" aria-label="Market Pulse">
                                    <div className="px-3.5 py-2.5 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-zinc-100 border border-zinc-200/80 text-zinc-500">
                                                <svg width="9" height="9" viewBox="0 0 14 14" fill="none"><path d="M7 1L12.5 4.25V10.75L7 14L1.5 10.75V4.25L7 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                                            </div>
                                            <span className="font-mono text-[10px] font-bold tracking-[0.1em] text-zinc-700 uppercase">Market Pulse</span>
                                        </div>
                                        <span className="font-mono text-[8.5px] text-zinc-300 tracking-[0.03em] uppercase">Via Polymarket</span>
                                    </div>
                                    {pulseMarkets.map(({ poly, match }, i) => (
                                        <MarketPulseRow
                                            key={poly.poly_event_slug || i}
                                            poly={poly}
                                            match={match}
                                            onSelect={handleSelect}
                                            isLast={i === pulseMarkets.length - 1}
                                        />
                                    ))}
                                </section>
                            )}

                            {/* Featured Props */}
                            {featuredProps.length > 0 && (
                                <section className="rounded-xl bg-white border border-zinc-200 overflow-hidden" aria-label="Featured Props">
                                    <div className="px-3.5 py-2.5 border-b border-zinc-100 bg-zinc-50/50 flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-zinc-100 border border-zinc-200/80 text-zinc-500">
                                                <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M1 10L5 6L8 9L13 4"/><path d="M9 4H13V8"/>
                                                </svg>
                                            </div>
                                            <span className="font-mono text-[10px] font-bold tracking-[0.1em] text-zinc-700 uppercase">Featured Props</span>
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

                            {/* Pro CTA — Obsidian gradient */}
                            <PremiumProCTA onPricing={handlePricing} />
                        </aside>

                    </div>
                </div>
            </LayoutGroup>
        </div>
    );
};

export default MatchList;
