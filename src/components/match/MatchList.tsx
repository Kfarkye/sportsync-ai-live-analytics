// ===================================================================
// MatchList.tsx — Production Editorial Feed
// ===================================================================
// Architecture: League-grouped accordion feed with sidebar hero widgets.
// Accordion: useMeasure + motion spring (precise height measurement).
// Ref: https://motion.dev/docs/react-layout-animations
// Ref: https://www.danbillson.com/blog/animating-height-in-react
// ===================================================================

import React, { useMemo, useState, useCallback, memo, useRef } from 'react';
import useMeasure from 'react-use-measure';
import { Match } from '@/types';
import { LEAGUES } from '@/constants';
import MatchRow from './MatchRow';
import TeamLogo from '../shared/TeamLogo';
import { LayoutGroup, motion } from 'framer-motion';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { cn } from '@/lib/essence';

// ============================================================================
// TYPES
// ============================================================================

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

// ============================================================================
// ANIMATION CONSTANTS
// Ref: Apple HIG recommends 200-350ms for expand/collapse transitions.
// Spring with bounce: 0 matches iOS native accordion feel.
// ============================================================================

const ACCORDION_SPRING = { type: 'spring' as const, duration: 0.35, bounce: 0 };
const STAGGER_DELAY = 0.04;

// ============================================================================
// OPTIMIZED MATCH ROW WRAPPER — Stable callbacks (Netflix/Meta pattern)
// Prevents map() from generating new inline arrow closures per MatchRow.
// Without this, every parent render creates fresh onSelect/onToggle identities,
// which defeats React.memo() on MatchRow (the most-rendered component).
// Ref: https://react.dev/reference/react/useCallback
// ============================================================================

const OptimizedMatchRow = memo(({
    match, isPinned, isLive, isFinal, onSelect, onToggle,
}: {
    match: Match; isPinned: boolean; isLive: boolean; isFinal: boolean;
    onSelect: (m: Match) => void; onToggle: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
}) => {
    const handleSelect = useCallback(() => onSelect(match), [match, onSelect]);
    const handleToggle = useCallback(
        (e: React.MouseEvent | React.KeyboardEvent) => onToggle(match.id, e),
        [match.id, onToggle]
    );

    return (
        <MatchRow
            match={match}
            isPinned={isPinned}
            isLive={isLive}
            isFinal={isFinal}
            onSelect={handleSelect}
            onTogglePin={handleToggle}
        />
    );
});
OptimizedMatchRow.displayName = 'OptimizedMatchRow';

// ============================================================================
// FEATURED HERO WIDGET — Sidebar headline card
// ============================================================================

const FeaturedHero = memo(({
    match,
    onClick,
    isLive,
}: {
    match: Match;
    onClick: () => void;
    isLive: boolean;
}) => {
    const homeColor = match.homeTeam.color || '#1c1c1e';
    const awayColor = match.awayTeam.color || '#1c1c1e';

    return (
        <div
            onClick={onClick}
            className="relative h-[160px] rounded-2xl border border-white/10 overflow-hidden cursor-pointer group transition-all duration-500 hover:border-white/20 hover:shadow-sm"
            style={{ background: '#09090b' }}
            role="button"
            tabIndex={0}
            aria-label={`${match.awayTeam.name} vs ${match.homeTeam.name}`}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            }}
        >
            {/* Dynamic gradient — team colors at 15% opacity for subtlety */}
            <div
                className="absolute inset-0 opacity-60 transition-opacity duration-500 group-hover:opacity-80"
                style={{
                    background: `linear-gradient(135deg, ${awayColor}15 0%, #09090b 50%, ${homeColor}15 100%)`,
                }}
            />
            <div className="absolute inset-0 bg-black/20" />

            <div className="relative z-10 h-full flex flex-col justify-between p-5">
                {/* Status Row */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {isLive ? (
                            <div className="px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 flex items-center gap-1.5" aria-live="polite">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                <span className="text-[9px] font-bold text-red-500 uppercase tracking-widest">
                                    Live
                                </span>
                            </div>
                        ) : (
                            <div className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest" suppressHydrationWarning>
                                    {new Date(match.startTime).toLocaleTimeString([], {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                    })}
                                </span>
                            </div>
                        )}
                    </div>
                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">
                        {match.leagueId}
                    </span>
                </div>

                {/* Matchup — centered logos + score */}
                <div className="flex items-center justify-between px-2">
                    <div className="flex flex-col items-center gap-2">
                        <TeamLogo
                            logo={match.awayTeam.logo}
                            name={match.awayTeam.name}
                            className="w-12 h-12 object-contain drop-shadow-sm"
                        />
                        <span className="text-sm font-bold text-white tracking-tight">
                            {match.awayTeam.abbreviation ||
                                match.awayTeam.name.substring(0, 3).toUpperCase()}
                        </span>
                    </div>

                    <div className="flex flex-col items-center">
                        {isLive ? (
                            <div className="text-3xl font-mono font-bold text-white tracking-tighter tabular-nums flex items-center gap-3">
                                <span>{match.awayScore}</span>
                                <span className="text-white/20">-</span>
                                <span>{match.homeScore}</span>
                            </div>
                        ) : (
                            <span className="text-2xl font-black text-white/20 italic">
                                VS
                            </span>
                        )}
                    </div>

                    <div className="flex flex-col items-center gap-2">
                        <TeamLogo
                            logo={match.homeTeam.logo}
                            name={match.homeTeam.name}
                            className="w-12 h-12 object-contain drop-shadow-sm"
                        />
                        <span className="text-sm font-bold text-white tracking-tight">
                            {match.homeTeam.abbreviation ||
                                match.homeTeam.name.substring(0, 3).toUpperCase()}
                        </span>
                    </div>
                </div>

                {/* Footer caption */}
                <div className="flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] truncate max-w-[200px]">
                        {isLive ? getPeriodDisplay(match) : 'Headline Event'}
                    </span>
                </div>
            </div>
        </div>
    );
});

FeaturedHero.displayName = 'FeaturedHero';

// ============================================================================
// SKELETON — Shimmer placeholder matching MatchRow geometry
// ============================================================================

const MatchRowSkeleton = () => (
    <div className="w-full h-[72px] border-b border-slate-200 flex items-center animate-pulse">
        <div className="w-[80px] h-full border-r border-slate-200 bg-white/[0.01]" />
        <div className="flex-1 px-6 flex flex-col gap-2">
            <div className="h-3 w-32 bg-white/5 rounded" />
            <div className="h-3 w-24 bg-white/5 rounded" />
        </div>
    </div>
);

// ============================================================================
// LEAGUE GROUP — Accordion with useMeasure for precise height animation
// ============================================================================
// Pattern: motion.div wrapper animates to measured height via spring.
// Inner div holds the ref so ResizeObserver tracks actual content bounds.
// Ref: react-use-measure (3.4M weekly downloads, pmndrs ecosystem)
// ============================================================================

const LeagueGroup = memo(({
    leagueId,
    leagueName,
    leagueMatches,
    pinnedMatchIds,
    isMatchLive,
    isMatchFinal,
    onSelectMatch,
    onTogglePin,
    groupIndex,
}: {
    leagueId: string;
    leagueName: string;
    leagueMatches: Match[];
    pinnedMatchIds: ReadonlySet<string>;
    isMatchLive: (match: Match) => boolean;
    isMatchFinal: (match: Match) => boolean;
    onSelectMatch: (match: Match) => void;
    onTogglePin: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
    groupIndex: number;
}) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [measureRef, bounds] = useMeasure();

    // Safe time parsing — filters NaN from malformed API responses
    const upcomingMatches = leagueMatches.filter((m) => !isMatchFinal(m));
    const validTimes = upcomingMatches
        .map((m) => new Date(m.startTime).getTime())
        .filter((t) => !isNaN(t));

    const earliestTime =
        validTimes.length > 0
            ? new Date(Math.min(...validTimes)).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
            })
            : '';

    const toggle = useCallback(() => setIsExpanded((prev) => !prev), []);

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIndex * STAGGER_DELAY }}
            className="flex flex-col relative"
        >
            {/* League Header — flush, sticky, 44px min touch target (Apple HIG) */}
            <button
                type="button"
                onClick={toggle}
                className={cn(
                    'flex items-center justify-between w-full min-h-[44px] px-4 py-3',
                    'bg-white/95 backdrop-blur-md',
                    'sticky top-[56px] lg:top-[64px] z-20',
                    'transition-colors hover:bg-slate-50',
                    'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-300',
                    isExpanded
                        ? 'border border-slate-200 border-b-0 rounded-t-xl'
                        : 'border border-slate-200 rounded-xl shadow-sm'
                )}
                aria-expanded={isExpanded}
                aria-controls={`league-content-${leagueId}`}
            >
                <div className="flex items-center gap-2">
                    <h3 className="text-[11px] font-bold text-slate-900 tracking-wide uppercase">
                        {leagueName}
                    </h3>
                    <span className="text-[14px] text-slate-300 leading-none" aria-hidden="true">
                        ·
                    </span>
                    <span className="text-[11px] font-medium text-slate-500">
                        {leagueMatches.length} {leagueMatches.length === 1 ? 'game' : 'games'}
                    </span>
                    {earliestTime && (
                        <>
                            <span className="text-[14px] text-slate-300 leading-none" aria-hidden="true">
                                ·
                            </span>
                            <span className="text-[11px] font-medium text-slate-500">
                                {earliestTime}
                            </span>
                        </>
                    )}
                </div>
                <motion.svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-slate-400"
                    animate={{ rotate: isExpanded ? 0 : -90 }}
                    transition={{ duration: 0.2 }}
                >
                    <path d="m6 9 6 6 6-6" />
                </motion.svg>
            </button>

            {/* Accordion Body — useMeasure drives precise spring animation */}
            <motion.div
                id={`league-content-${leagueId}`}
                animate={{
                    height: isExpanded ? bounds.height || 'auto' : 0,
                    opacity: isExpanded ? 1 : 0,
                }}
                transition={ACCORDION_SPRING}
                className={cn(
                    'overflow-hidden relative z-10 -mt-[1px]',
                    isExpanded &&
                    'bg-white border border-slate-200 border-t-0 rounded-b-xl shadow-sm'
                )}
                style={{ contentVisibility: isExpanded ? 'visible' : 'auto' }}
                aria-hidden={!isExpanded}
            >
                <div ref={measureRef} className="flex flex-col">
                    {leagueMatches.map((match) => (
                        <OptimizedMatchRow
                            key={match.id}
                            match={match}
                            isPinned={pinnedMatchIds.has(match.id)}
                            isLive={isMatchLive(match)}
                            isFinal={isMatchFinal(match)}
                            onSelect={onSelectMatch}
                            onToggle={onTogglePin}
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
    matches,
    onSelectMatch,
    isLoading,
    pinnedMatchIds,
    onTogglePin,
    isMatchLive,
    isMatchFinal,
    onOpenPricing,
}) => {
    // ── Stable callback proxies (Netflix/Meta pattern) ──────────────────
    // useRef stores the latest closure so the function identity never changes.
    // This prevents the entire LeagueGroup → OptimizedMatchRow tree from
    // re-rendering when the parent's onSelectMatch/onTogglePin changes identity.
    const callbacksRef = useRef({ onSelectMatch, onTogglePin });
    callbacksRef.current = { onSelectMatch, onTogglePin };

    const handleSelect = useCallback((m: Match) => callbacksRef.current.onSelectMatch(m), []);
    const handleToggle = useCallback(
        (id: string, e: React.MouseEvent | React.KeyboardEvent) => callbacksRef.current.onTogglePin(id, e),
        []
    );
    const { groupedMatches, featuredMatches } = useMemo(() => {
        const groups: Map<string, Match[]> = new Map();

        // Group ALL matches by league
        matches.forEach((m) => {
            if (!groups.has(m.leagueId)) groups.set(m.leagueId, []);
            groups.get(m.leagueId)?.push(m);
        });

        // Sort within groups: Pinned -> Live -> Soonest
        groups.forEach((groupMatches) => {
            groupMatches.sort((a, b) => {
                const aPinned = pinnedMatchIds.has(a.id);
                const bPinned = pinnedMatchIds.has(b.id);
                if (aPinned !== bPinned) return aPinned ? -1 : 1;

                const aLive = isMatchLive(a);
                const bLive = isMatchLive(b);
                if (aLive !== bLive) return aLive ? -1 : 1;

                return (
                    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
                );
            });
        });

        // Sort league groups by LEAGUES constant order
        const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
            const idxA = LEAGUES.findIndex((l) => l.id === a[0]);
            const idxB = LEAGUES.findIndex((l) => l.id === b[0]);
            return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });

        // Headline selection: major league live/upcoming, fallback to any
        const majors = new Set(['nba', 'nfl', 'ncaaf', 'ncaab']);
        const possibleHeadlines = matches
            .filter((m) => majors.has(m.leagueId.toLowerCase()) && !isMatchFinal(m))
            .sort((a, b) => {
                const aLive = isMatchLive(a);
                const bLive = isMatchLive(b);
                if (aLive !== bLive) return aLive ? -1 : 1;
                return (
                    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
                );
            });

        const headlines =
            possibleHeadlines.length > 0
                ? possibleHeadlines.slice(0, 2)
                : matches.filter((m) => !isMatchFinal(m)).slice(0, 2);

        return { groupedMatches: sortedGroups, featuredMatches: headlines };
    }, [matches, pinnedMatchIds, isMatchLive, isMatchFinal]);

    // -- Loading State ---------------------------------------------------------

    if (isLoading && matches.length === 0) {
        return (
            <div className="max-w-7xl mx-auto w-full pt-4">
                <div className="border-t border-slate-200">
                    {Array.from({ length: 6 }, (_, i) => (
                        <MatchRowSkeleton key={i} />
                    ))}
                </div>
            </div>
        );
    }

    // -- Empty State -----------------------------------------------------------

    if (matches.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500">
                <span className="text-xl mb-4 opacity-50">∅</span>
                <span className="text-sm font-medium uppercase tracking-widest opacity-70">
                    No Action
                </span>
            </div>
        );
    }

    // -- Feed ------------------------------------------------------------------

    return (
        <div className="min-h-screen bg-transparent pb-32">
            <LayoutGroup>
                <div className="max-w-7xl mx-auto px-0 lg:px-6 w-full">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-12 items-start">
                        {/* FEED COLUMN */}
                        <div className="min-w-0 flex flex-col gap-10">
                            <div className="space-y-8 pt-6">
                                {groupedMatches.map(
                                    ([leagueId, leagueMatches], groupIndex) => {
                                        const leagueConfig = LEAGUES.find(
                                            (l) => l.id === leagueId
                                        );
                                        return (
                                            <LeagueGroup
                                                key={leagueId}
                                                leagueId={leagueId}
                                                leagueName={leagueConfig?.name || leagueId.toUpperCase()}
                                                leagueMatches={leagueMatches}
                                                pinnedMatchIds={pinnedMatchIds}
                                                isMatchLive={isMatchLive}
                                                isMatchFinal={isMatchFinal}
                                                onSelectMatch={handleSelect}
                                                onTogglePin={handleToggle}
                                                groupIndex={groupIndex}
                                            />
                                        );
                                    }
                                )}
                            </div>
                        </div>

                        {/* SIDEBAR — Desktop only, sticky below header */}
                        <div className="hidden lg:flex flex-col sticky top-[128px] space-y-6 pt-6">
                            {featuredMatches.length > 0 && (
                                <section className="mb-2">
                                    <div className="flex items-center gap-2 mb-3 px-1">
                                        <span className="w-1.5 h-1.5 bg-brand-cyan rounded-full shadow-glow-cyan-sm animate-pulse" />
                                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                                            Headline Events
                                        </span>
                                    </div>
                                    <div className="flex flex-col gap-4">
                                        {featuredMatches.map((match) => (
                                            <FeaturedHero
                                                key={`feat-${match.id}`}
                                                match={match}
                                                onClick={() => onSelectMatch(match)}
                                                isLive={isMatchLive(match)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* Pro Upsell */}
                            <div className="p-8 rounded-2xl bg-zinc-900/30 border border-slate-200 relative overflow-hidden group">
                                <h3 className="text-[11px] font-bold text-[#2997FF] uppercase tracking-widest mb-3">
                                    Pro Access
                                </h3>
                                <p className="text-[13px] text-slate-400 mb-6 leading-relaxed font-medium tracking-tight">
                                    Real-time institutional feeds and sharp money indicators.
                                </p>
                                <button
                                    onClick={onOpenPricing}
                                    className="w-full py-3 bg-white hover:bg-zinc-200 text-black text-[11px] font-bold uppercase tracking-widest rounded-full transition-colors flex items-center justify-center"
                                >
                                    Upgrade
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </LayoutGroup>
        </div>
    );
};

export default MatchList;
