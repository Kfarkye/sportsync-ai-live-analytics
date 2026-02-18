
import React, { useMemo } from 'react';
import { Match, MatchStatus } from '@/types';
import { Radio } from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { ESSENCE, cn } from '@/lib/essence';
import MatchCard from '../match/MatchCard';
import { useAppStore } from '../../store/appStore';
import { LiveTotalCard } from './Gamecast';

const MotionDiv = motion.div;

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface LiveDashboardProps {
    matches: Match[];
    onSelectMatch: (match: Match) => void;
    isMatchLive: (match: Match) => boolean;
    pinnedMatchIds: ReadonlySet<string>;
    onTogglePin: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
}

type LayoutType = 'GRID' | 'LIST';

const LiveDashboard: React.FC<LiveDashboardProps> = ({ matches, onSelectMatch, isMatchLive, pinnedMatchIds, onTogglePin }) => {
    const { liveTab: activeTab, liveFilter: searchTerm, liveLayout: layout } = useAppStore();

    // --- FILTERING ---
    const { live, nextUp, justEnded } = useMemo(() => {
        const now = Date.now();
        const lookahead = 24 * 3600000;

        const acc = { live: [] as Match[], nextUp: [] as Match[], justEnded: [] as Match[] };

        matches.forEach(m => {
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                if (!m.homeTeam.name.toLowerCase().includes(term) &&
                    !m.awayTeam.name.toLowerCase().includes(term) &&
                    !m.leagueId.toLowerCase().includes(term)) return;
            }

            const isL = isMatchLive(m);
            const isF = m.status === MatchStatus.FINISHED || (m.status as string).includes('FINAL');
            const start = new Date(m.startTime).getTime();

            if (isL) {
                acc.live.push(m);
            } else if (start > now && !isF) {
                if (start - now < lookahead) acc.nextUp.push(m);
            } else if (isF) {
                acc.justEnded.push(m);
            }
        });

        // Sort live by favorites first
        acc.live.sort((a, b) => {
            if (pinnedMatchIds.has(a.id) && !pinnedMatchIds.has(b.id)) return -1;
            if (!pinnedMatchIds.has(a.id) && pinnedMatchIds.has(b.id)) return 1;
            return 0;
        });

        return acc;
    }, [matches, isMatchLive, pinnedMatchIds, searchTerm]);

    const getActiveList = () => {
        switch (activeTab) {
            case 'LIVE': return live;
            case 'NEXT': return nextUp;
            case 'ENDED': return justEnded;
            default: return live;
        }
    };

    const displayMatches = getActiveList();

    return (
        <div className="w-full max-w-7xl mx-auto pb-32 relative">

            {/* Content Area with Sidebar — mobile-first single column */}
            <div className="mt-3 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 lg:gap-8 items-start">

                {/* Main Feed */}
                <div className="min-w-0">
                    <LayoutGroup>
                        <MotionDiv
                            layout
                            className={cn(
                                "grid gap-3 md:gap-4",
                                layout === 'GRID' ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
                            )}
                        >
                            <AnimatePresence mode='popLayout'>
                                {displayMatches.length > 0 ? (
                                    displayMatches.map((match, i) => {
                                        const isFinal = match.status === MatchStatus.FINISHED || String(match.status).includes('FINAL');

                                        return (
                                            <MotionDiv
                                                layout
                                                key={match.id}
                                                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.95 }}
                                                transition={{
                                                    ...ESSENCE.transition.spring,
                                                    delay: Math.min(i * 0.05, 0.3) // Stagger cap
                                                }}
                                            >
                                                <MatchCard
                                                    match={match}
                                                    viewMode={layout}
                                                    isPinned={pinnedMatchIds.has(match.id)}
                                                    isLive={isMatchLive(match)}
                                                    isFinal={isFinal}
                                                    hasAction={false}
                                                    onSelect={() => onSelectMatch(match)}
                                                    onTogglePin={onTogglePin}
                                                />
                                            </MotionDiv>
                                        );
                                    })
                                ) : (
                                    <MotionDiv
                                        initial={{ opacity: 0, y: 12, scale: 0.98 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        transition={{ ...ESSENCE.transition.soft, delay: 0.1 }}
                                        className="col-span-full py-20 flex flex-col items-center justify-center relative"
                                    >
                                        {/* Ambient Glass Glow */}
                                        <div className={cn(
                                            "absolute w-[400px] h-[400px] rounded-full blur-[120px] opacity-[0.06] pointer-events-none",
                                            activeTab === 'LIVE' ? "bg-emerald-500" : activeTab === 'NEXT' ? "bg-violet-500" : "bg-zinc-500"
                                        )} />

                                        {/* Icon Container — Precision Material */}
                                        <motion.div
                                            animate={activeTab === 'LIVE' ? { scale: [1, 1.02, 1] } : {}}
                                            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                                            className={cn(
                                                "relative w-24 h-24 rounded-[28px] flex items-center justify-center mb-8",
                                                "bg-[#111113]/80 backdrop-blur-xl border border-white/10 shadow-[inner_0_1px_0_rgba(255,255,255,0.05),_0_20px_40px_rgba(0,0,0,0.4)]",
                                            )}
                                        >
                                            <Radio
                                                size={36}
                                                strokeWidth={1.2}
                                                className={cn(
                                                    "transition-colors duration-500",
                                                    activeTab === 'LIVE' ? "text-emerald-500/80" : activeTab === 'NEXT' ? "text-violet-500/80" : "text-zinc-600"
                                                )}
                                            />
                                            {activeTab === 'LIVE' && (
                                                <motion.div
                                                    animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.1, 1] }}
                                                    transition={{ duration: 2, repeat: Infinity }}
                                                    className="absolute inset-0 rounded-[28px] border border-emerald-500/30"
                                                />
                                            )}
                                        </motion.div>

                                        {/* Content Hierarchy */}
                                        <h3 className={cn(
                                            "text-[13px] font-black uppercase tracking-[0.3em] mb-3 transition-colors duration-500",
                                            activeTab === 'LIVE' ? "text-emerald-500/80" : activeTab === 'NEXT' ? "text-violet-400/80" : "text-zinc-500"
                                        )}>
                                            {activeTab === 'LIVE' ? 'No Live Games' : activeTab === 'NEXT' ? 'No Upcoming Games' : 'No Completed Games'}
                                        </h3>

                                        <p className="text-[12px] text-zinc-500 font-medium tracking-tight max-w-[240px] text-center leading-relaxed">
                                            {activeTab === 'LIVE'
                                                ? "Check back shortly for active match sessions or view upcoming games."
                                                : activeTab === 'NEXT'
                                                    ? "Games will appear here as they are scheduled for the current session."
                                                    : "Recently completed games will populate here after final grading."}
                                        </p>

                                        {/* Subtle CTA — iOS Style Pill */}
                                        {activeTab !== 'NEXT' && (
                                            <button
                                                onClick={() => useAppStore.getState().setLiveTab('NEXT')}
                                                className="mt-10 px-6 py-2.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all duration-300 shadow-lg"
                                            >
                                                View Schedule
                                            </button>
                                        )}
                                    </MotionDiv>

                                )}
                            </AnimatePresence>
                        </MotionDiv>
                    </LayoutGroup>
                </div>

                {/* Sidebar Feed (Desktop) */}
                <div className="hidden lg:block sticky top-[120px] space-y-4">

                    {/* Live Forecast Panel - Shows first live match's forecast */}
                    {live.length > 0 && (
                        <div className="rounded-[20px] overflow-hidden">
                            <LiveTotalCard match={live[0]} />
                        </div>
                    )}

                    {/* Pro Terminal: State of the Art Upsell */}
                    <div className="p-6 rounded-[20px] bg-[#0C0C0E] border border-white/[0.06] relative overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                        {/* Subtle gradient accent */}
                        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />

                        <h3 className="text-[10px] font-black text-violet-400 uppercase tracking-[0.2em] mb-3">
                            Pro Terminal
                        </h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed mb-5 font-medium">
                            Access real-time order flow, sharp money splits, and institutional line movement data.
                        </p>
                        <button className="w-full py-2.5 bg-white/[0.03] text-zinc-300 text-[10px] font-bold uppercase tracking-[0.15em] rounded-xl border border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.12] hover:text-white transition-all duration-200">
                            Unlock Data
                        </button>
                    </div>
                </div>

            </div>
        </div >
    );
};

export default LiveDashboard;
