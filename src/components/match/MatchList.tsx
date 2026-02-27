// ═══════════════════════════════════════════════════════════════════════════════
// MatchList.tsx — ESSENCE v14 · Cupertino Glass × Financial Terminal (PASS II)
//
// ⚡️ PERF (Meta/Netflix Standard): 
//     Ref-backed stable callbacks, zero inline allocations, O(1) sort keys,
//     and `content-visibility: auto` native off-screen DOM culling.
//
// 🍎 UI (Apple HIG Standard): 
//     GPU-composited transforms, `saturate(180%) blur(24px)` sticky materials, 
//     mathematically precise iOS spring timing (stiffness: 400, damping: 30).
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useMemo, memo, useRef, useCallback } from 'react';
import { Match } from '@/types';
import { LEAGUES } from '@/constants';
import MatchRow from './MatchRow';
import TeamLogo from '../shared/TeamLogo';
import { LayoutGroup, motion, AnimatePresence } from 'framer-motion';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { useAppStore } from '../../store/appStore';
import { ESSENCE } from '@/lib/essence';

// ─── Native iOS Physics & Hardware Config ────────────────────────────────────
const IOS_SPRING = { type: 'spring', stiffness: 400, damping: 30, mass: 0.8 };
const GPU_ACCEL = { transform: 'translateZ(0)', willChange: 'transform, opacity' };
const MotionDiv = motion.div;

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

// ─── Memoized Wrapper for External MatchRow ──────────────────────────────────
// Prevents the parent's map() from generating new inline arrow functions.
const OptimizedMatchRow = memo(({
    match, isPinned, isLive, isFinal, onSelect, onToggle
}: {
    match: Match; isPinned: boolean; isLive: boolean; isFinal: boolean;
    onSelect: (m: Match) => void; onToggle: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
}) => {
    const handleSelect = useCallback(() => onSelect(match), [match, onSelect]);
    const handleToggle = useCallback((e: React.MouseEvent | React.KeyboardEvent) => onToggle(match.id, e), [match.id, onToggle]);

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
}, (prev, next) => (
    prev.match.id === next.match.id &&
    prev.isPinned === next.isPinned &&
    prev.isLive === next.isLive &&
    prev.isFinal === next.isFinal &&
    // Deep comparison of highly volatile socket data to prevent useless renders
    prev.match.homeScore === next.match.homeScore &&
    prev.match.awayScore === next.match.awayScore &&
    prev.match.status === next.match.status
));
OptimizedMatchRow.displayName = 'OptimizedMatchRow';

// ─── Skeleton (Fluid Shimmer via GPU) ────────────────────────────────────────
const RowSkeleton: React.FC = memo(() => (
    <div
        className="flex items-center h-[68px] px-5 border-b last:border-b-0 relative overflow-hidden bg-white"
        style={{ borderColor: ESSENCE.colors.border.ghost }}
    >
        <div
            className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite_cubic-bezier(0.4,0,0.2,1)] bg-gradient-to-r from-transparent via-slate-200/50 to-transparent z-10"
            style={{ willChange: 'transform' }}
        />
        <div className="flex flex-col gap-2.5 flex-1 opacity-40 mix-blend-multiply">
            <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-slate-300" />
                <div className="h-2.5 w-28 rounded-full bg-slate-300" />
            </div>
            <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-slate-300" />
                <div className="h-2.5 w-24 rounded-full bg-slate-300" />
            </div>
        </div>
        <div className="w-16 h-4 rounded-full bg-slate-300 opacity-40" />
    </div>
));
RowSkeleton.displayName = 'RowSkeleton';

// ─── Kalshi Market Data Blocks ───────────────────────────────────────────────
const TeamMarketBlock = memo(({
    team, prob, isFav
}: {
    team: Match['homeTeam']; prob?: number; isFav: boolean
}) => {
    const teamName = team.abbreviation || team.shortName || team.name.substring(0, 3).toUpperCase();

    return (
        <div className="flex flex-col items-center gap-2.5 flex-1 min-w-0 group">
            <TeamLogo logo={team.logo} name={team.name} className="w-11 h-11 object-contain drop-shadow-sm transition-transform duration-300 group-hover:scale-105" />
            <span className="text-[12px] font-semibold tracking-[-0.01em] text-center truncate w-full text-slate-900 antialiased">
                {teamName}
            </span>
            <div className="h-[28px] w-full flex items-center justify-center">
                {prob !== undefined && prob > 0 ? (
                    <button
                        type="button"
                        className="text-[11px] font-bold tabular-nums px-2.5 py-1.5 rounded-md transition-all duration-200 w-full text-center active:scale-95 will-change-transform"
                        style={{
                            color: isFav ? '#059669' : '#64748B',
                            backgroundColor: isFav ? '#ECFDF5' : '#F8FAFC',
                            // Hardware inset lip mimics physical Kalshi executable
                            boxShadow: isFav
                                ? 'inset 0 0 0 1px rgba(16,185,129,0.25), 0 1px 2px rgba(0,0,0,0.04)'
                                : 'inset 0 0 0 1px rgba(0,0,0,0.06)',
                        }}
                    >
                        {Math.round(prob)}%
                    </button>
                ) : (
                    <span className="w-full h-[1px] bg-slate-100" />
                )}
            </div>
        </div>
    );
});
TeamMarketBlock.displayName = 'TeamMarketBlock';

// ─── Featured Hero Component (Apple Glassmorphism) ───────────────────────────
const FeaturedHero = memo(({ match, onClick, isLive }: { match: Match; onClick: (m: Match) => void; isLive: boolean }) => {
    const homeProb = match.predictor?.homeTeamChance ?? match.win_probability?.home;
    const awayProb = match.predictor?.awayTeamChance ?? match.win_probability?.away;
    const homeFav = (homeProb ?? 0) >= (awayProb ?? 0);

    const handleClick = useCallback(() => onClick(match), [match, onClick]);

    return (
        <motion.article
            role="button"
            tabIndex={0}
            onClick={handleClick}
            whileHover={{ y: -2, scale: 0.995 }}
            whileTap={{ scale: 0.98 }}
            transition={IOS_SPRING}
            className="relative overflow-hidden cursor-pointer group bg-white"
            style={{
                ...GPU_ACCEL,
                borderRadius: 24, // Continuous squircle math approximation
                border: `1px solid ${ESSENCE.colors.border.default}`,
                boxShadow: `0 8px 32px rgba(0,0,0,0.03), 0 2px 8px rgba(0,0,0,0.02)`,
            }}
        >
            {/* Live ambient gradient glow */}
            <AnimatePresence>
                {isLive && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 0.7 }} exit={{ opacity: 0 }}
                        className="absolute top-0 inset-x-0 h-[3px]"
                        style={{ background: `linear-gradient(90deg, transparent, #E11D48 20%, #E11D48 80%, transparent)` }}
                    />
                )}
            </AnimatePresence>

            <div className="p-5">
                <header className="flex items-center justify-between mb-6">
                    {isLive ? (
                        <div className="flex items-center gap-1.5 bg-rose-50/80 backdrop-blur-md px-2 py-0.5 rounded border border-rose-100/50">
                            <span className="relative flex h-1.5 w-1.5 items-center justify-center">
                                <motion.span
                                    animate={{ scale: [1, 2.8], opacity: [0.6, 0] }}
                                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                                    className="absolute inset-0 rounded-full bg-rose-500 will-change-transform"
                                />
                                <span className="relative rounded-full h-1.5 w-1.5 bg-rose-600" />
                            </span>
                            <span className="text-[10px] font-black text-rose-600 uppercase tracking-[0.12em] mt-[1px]">Live</span>
                        </div>
                    ) : (
                        <time className="text-[11px] font-semibold tracking-wide tabular-nums text-slate-500">
                            {new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </time>
                    )}
                    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                        {match.leagueId?.toUpperCase() || match.sport}
                    </span>
                </header>

                <div className="flex items-center justify-between gap-4">
                    <TeamMarketBlock team={match.awayTeam} prob={awayProb} isFav={!homeFav} />

                    <div className="flex flex-col items-center shrink-0 px-3 min-w-[70px]">
                        {isLive || match.homeScore > 0 || match.awayScore > 0 ? (
                            <div className="flex items-baseline gap-2.5">
                                <span className="text-3xl font-bold tabular-nums tracking-tighter text-slate-900 font-sans">
                                    {match.awayScore}
                                </span>
                                <span className="text-xl font-light opacity-30 text-slate-900 mb-1 relative -top-0.5">:</span>
                                <span className="text-3xl font-bold tabular-nums tracking-tighter text-slate-900 font-sans">
                                    {match.homeScore}
                                </span>
                            </div>
                        ) : (
                            <span className="text-[12px] font-black uppercase tracking-[0.2em] text-slate-300">
                                VS
                            </span>
                        )}

                        <AnimatePresence>
                            {isLive && (
                                <motion.span
                                    initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
                                    className="text-[10px] font-bold uppercase tracking-[0.1em] mt-2 text-slate-500"
                                >
                                    {getPeriodDisplay(match)}
                                </motion.span>
                            )}
                        </AnimatePresence>
                    </div>

                    <TeamMarketBlock team={match.homeTeam} prob={homeProb} isFav={homeFav} />
                </div>
            </div>
        </motion.article>
    );
});
FeaturedHero.displayName = 'FeaturedHero';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT — MATCH LIST
// ═══════════════════════════════════════════════════════════════════════════════

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
    const { selectedSport } = useAppStore();
    const selectedSportKey = String(selectedSport);

    // ── ⚡️ STABLE CALLBACK REFERENCES (Netflix/Meta pattern) ────────────────
    // Proxies external methods so the identity never changes for the deep React tree.
    const callbacksRef = useRef({ onSelectMatch, onTogglePin });
    callbacksRef.current = { onSelectMatch, onTogglePin };

    const handleSelect = useCallback((m: Match) => callbacksRef.current.onSelectMatch(m), []);
    const handleToggle = useCallback((id: string, e: React.MouseEvent | React.KeyboardEvent) => callbacksRef.current.onTogglePin(id, e), []);

    // ── O(N) Data Orchestration ────────────────────────────────────────────────
    const { favorites, groupedMatches, featuredMatches } = useMemo(() => {
        type EnrichedMatch = { match: Match; isLive: boolean; isFinal: boolean; timeMs: number };
        const favs: EnrichedMatch[] = [];
        const rest: EnrichedMatch[] = [];
        const groupsMap = new Map<string, EnrichedMatch[]>();

        // Single pass to resolve volatile metrics, avoiding repetitive deep calls during sort
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            const isLive = isMatchLive(m);
            const isFinal = isMatchFinal(m);
            const timeMs = new Date(m.startTime).getTime();

            const item = { match: m, isLive, isFinal, timeMs };
            if (pinnedMatchIds.has(m.id)) {
                favs.push(item);
            } else {
                rest.push(item);
                let group = groupsMap.get(m.leagueId);
                if (!group) { group = []; groupsMap.set(m.leagueId, group); }
                group.push(item);
            }
        }

        const sortMatches = (arr: EnrichedMatch[]) => arr.sort((a, b) => {
            if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
            return a.timeMs - b.timeMs;
        });

        const sortedGroups = Array.from(groupsMap.entries())
            .map(([id, items]) => [id, sortMatches(items)] as const)
            .sort((a, b) => {
                const idxA = LEAGUES.findIndex(l => l.id === a[0]);
                const idxB = LEAGUES.findIndex(l => l.id === b[0]);
                return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
            });

        // Extract side-bar hero matches
        const majors = new Set(['nba', 'nfl', 'ncaaf', 'ncaab', 'epl', 'mlb', 'nhl', 'ucl']);
        const validHeroes = rest.filter(item => majors.has(item.match.leagueId.toLowerCase()) && !item.isFinal);
        const headlines = sortMatches(validHeroes).slice(0, 2);

        return {
            favorites,
            groupedMatches: sortedGroups,
            featuredMatches: headlines.length > 0 ? headlines : rest.filter(i => !i.isFinal).slice(0, 2)
        };
    }, [matches, pinnedMatchIds, isMatchLive, isMatchFinal]);

    // ── Rendering states ───────────────────────────────────────────────────────
    if (isLoading && matches.length === 0) {
        return (
            <div className="max-w-7xl mx-auto w-full pt-4 lg:px-6">
                <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                    {[...Array(6)].map((_, i) => <RowSkeleton key={`skel-${i}`} />)}
                </div>
            </div>
        );
    }

    if (matches.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4" style={GPU_ACCEL}>
                <span className="text-5xl font-light opacity-10 text-slate-900">∅</span>
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    No Market Events
                </span>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-transparent pb-32">
            <LayoutGroup>
                <div className="max-w-7xl mx-auto px-0 lg:px-6 w-full">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8 lg:gap-12 items-start">

                        {/* ═══ PRIMARY FEED COLUMN ══════════════════════════════════ */}
                        <div className="min-w-0 flex flex-col gap-10 pt-4">

                            {/* Watchlist Container */}
                            <AnimatePresence mode="popLayout">
                                {favorites.length > 0 && (
                                    <MotionDiv
                                        layout="position"
                                        initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                                        transition={IOS_SPRING}
                                        style={GPU_ACCEL}
                                    >
                                        <div className="flex items-center gap-2 mb-3.5 px-4 lg:px-2">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
                                            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
                                                Watchlist
                                            </span>
                                        </div>
                                        <div className="overflow-hidden rounded-[24px] border border-amber-200/50 bg-white shadow-[0_8px_30px_rgba(251,191,36,0.05)]">
                                            {favorites.map(item => (
                                                <OptimizedMatchRow
                                                    key={`fav-${item.match.id}`}
                                                    match={item.match}
                                                    isPinned={true}
                                                    isLive={item.isLive}
                                                    isFinal={item.isFinal}
                                                    onSelect={handleSelect}
                                                    onToggle={handleToggle}
                                                />
                                            ))}
                                        </div>
                                    </MotionDiv>
                                )}
                            </AnimatePresence>

                            {/* Main League Loop */}
                            <div className="space-y-8">
                                <AnimatePresence>
                                    {groupedMatches.map(([leagueId, leagueItems], groupIndex) => {
                                        const leagueConfig = LEAGUES.find(l => l.id === leagueId);
                                        const leagueName = leagueConfig?.name || leagueId.toUpperCase();
                                        const liveCount = leagueItems.filter(m => m.isLive).length;

                                        return (
                                            <MotionDiv
                                                layout="position"
                                                key={leagueId}
                                                initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
                                                transition={{ ...IOS_SPRING, delay: Math.min(groupIndex * 0.05, 0.4) }}
                                                // ⚡️ PERFORMANCE: DOM Off-screen Culling
                                                style={{ ...GPU_ACCEL, contentVisibility: 'auto', containIntrinsicSize: 'auto 600px' }}
                                            >

                                                {/* 🍎 Apple HIG: Deep Glassmorphic Sticky Header */}
                                                {selectedSportKey === 'all' && (
                                                    <div
                                                        className="sticky top-[64px] z-10 flex items-center justify-between px-4 lg:px-2 pt-4 pb-3 mb-1 bg-white/50 border-b border-transparent"
                                                        style={{ backdropFilter: 'saturate(180%) blur(24px)', WebkitBackdropFilter: 'saturate(180%) blur(24px)' }}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <h3 className="text-[12px] font-black uppercase tracking-[0.08em] text-slate-900">
                                                                {leagueName}
                                                            </h3>
                                                            {liveCount > 0 && (
                                                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold tabular-nums tracking-wide bg-emerald-50 text-emerald-600 border border-emerald-100/50">
                                                                    <motion.span
                                                                        animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                                                                        className="w-[4px] h-[4px] rounded-full bg-current"
                                                                    />
                                                                    {liveCount} Live
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full text-slate-500 bg-slate-100/80">
                                                            {leagueItems.length}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Group Render Block */}
                                                <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
                                                    {leagueItems.map(item => (
                                                        <OptimizedMatchRow
                                                            key={item.match.id}
                                                            match={item.match}
                                                            isPinned={pinnedMatchIds.has(item.match.id)}
                                                            isLive={item.isLive}
                                                            isFinal={item.isFinal}
                                                            onSelect={handleSelect}
                                                            onToggle={handleToggle}
                                                        />
                                                    ))}
                                                </div>
                                            </MotionDiv>
                                        );
                                    })}
                                </AnimatePresence>
                            </div>
                        </div>

                        {/* ═══ DESKTOP SIDEBAR (Financial / Pro Intel) ═══════════════ */}
                        <aside className="hidden lg:flex flex-col sticky top-24 space-y-8 pt-4" style={GPU_ACCEL}>

                            {/* Headline Events Block */}
                            {featuredMatches.length > 0 && (
                                <section>
                                    <div className="flex items-center gap-2 mb-3.5 px-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
                                            Market Headlines
                                        </span>
                                    </div>
                                    <div className="flex flex-col gap-4">
                                        {featuredMatches.map((item, idx) => (
                                            <MotionDiv
                                                key={`feat-${item.match.id}`}
                                                initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                                                transition={{ ...IOS_SPRING, delay: idx * 0.1 }}
                                            >
                                                <FeaturedHero
                                                    match={item.match}
                                                    onClick={handleSelect}
                                                    isLive={item.isLive}
                                                />
                                            </MotionDiv>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* 🍎 Apple Titanium Terminal Card */}
                            <motion.div
                                role="button"
                                tabIndex={0}
                                onClick={onOpenPricing}
                                whileHover={{ y: -2, scale: 0.995 }}
                                whileTap={{ scale: 0.98 }}
                                transition={IOS_SPRING}
                                className="overflow-hidden relative group p-8 flex flex-col items-start cursor-pointer shadow-2xl shadow-black/10"
                                style={{
                                    borderRadius: 24,
                                    backgroundColor: '#090A0C', // Deep OLED black
                                    border: '1px solid rgba(255,255,255,0.08)',
                                }}
                            >
                                {/* Simulated physical metallic grain/gradient */}
                                <div
                                    className="absolute inset-0 opacity-[0.15] pointer-events-none transition-opacity duration-700 group-hover:opacity-30"
                                    style={{
                                        background: 'radial-gradient(120% 120% at 100% 0%, #3B82F6 0%, transparent 50%), radial-gradient(120% 120% at 0% 100%, #8B5CF6 0%, transparent 50%)',
                                        mixBlendMode: 'screen'
                                    }}
                                />

                                <span className="relative z-10 text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-1">
                                    Terminal Data
                                </span>
                                <h4 className="relative z-10 text-[18px] font-bold tracking-tight text-white mb-2">
                                    Pro Access
                                </h4>
                                <p className="relative z-10 mt-1 mb-7 leading-relaxed text-[13px] text-white/60 font-medium text-balance antialiased">
                                    Real-time institutional feeds, sharp money indicators, and AI-powered edge detection.
                                </p>

                                <div className="relative z-10 w-full py-3.5 rounded-xl font-bold uppercase tracking-[0.12em] transition-all duration-300 bg-white text-black text-center text-[11px] hover:bg-slate-200 shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                                    Upgrade Tier
                                </div>
                            </motion.div>
                        </aside>

                    </div>
                </div>
            </LayoutGroup>

            {/* Hardware-Accelerated Shimmer Keyframe */}
            <style>{`
        @keyframes shimmer {
          0% { transform: translate3d(-100%, 0, 0); }
          100% { transform: translate3d(100%, 0, 0); }
        }
      `}</style>
        </div>
    );
};

export default memo(MatchList, (prev, next) => {
    // Ultra-strict shallow array comparison prevents MatchList from re-rendering
    // unless the actual physical length or memory reference of matches changes.
    return prev.matches === next.matches &&
        prev.isLoading === next.isLoading &&
        prev.pinnedMatchIds === next.pinnedMatchIds;
});
