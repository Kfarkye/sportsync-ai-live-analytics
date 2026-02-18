
import React, { FC, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { Trophy, ChevronDown, Calendar, ChevronLeft, ChevronRight, Search, Grid3X3, List, X, Wifi, WifiOff } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAuth } from '../../contexts/AuthContext';
import { useWeekNavigation } from '../../hooks/useWeekNavigation';
import { SPORT_CONFIG, LEAGUES } from '@/constants';
import { Sport } from '@/types';
import { cn, ESSENCE } from '@/lib/essence';

const MotionSpan = motion.span;
const MotionDiv = motion.div;

const parseWeekValue = (value: string): Date => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map(Number);
        return new Date(y, m - 1, d, 12, 0, 0, 0);
    }
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && value.trim() !== '') {
        return new Date(numeric);
    }
    return new Date(value);
};

interface UnifiedHeaderProps {
    reconnecting?: boolean;
}

export const UnifiedHeader: FC<UnifiedHeaderProps> = ({ reconnecting = false }) => {
    const {
        selectedSport,
        selectedDate,
        activeView,
        liveTab,
        liveFilter,
        liveLayout,
        setSelectedDate,
        setLiveTab,
        setLiveFilter,
        setLiveLayout,
        toggleSportDrawer,
        toggleCmdk,
        toggleAuthModal,
        toggleRankingsDrawer
    } = useAppStore();

    const { user, signOut } = useAuth();

    const weekScrollRef = useRef<HTMLDivElement>(null);
    const weekOptions = useWeekNavigation(selectedDate, selectedSport);
    const isCollege = selectedSport === Sport.COLLEGE_FOOTBALL || selectedSport === Sport.COLLEGE_BASKETBALL;
    const navStep = (selectedSport === Sport.NFL || selectedSport === Sport.COLLEGE_FOOTBALL) ? 7 : 1;

    useEffect(() => {
        const container = weekScrollRef.current;
        const activeElement = document.getElementById('week-tab-active');
        if (!container || !activeElement) return;

        const containerWidth = container.offsetWidth;
        const elementOffset = activeElement.offsetLeft;
        const elementWidth = activeElement.offsetWidth;

        const centeredScroll = elementOffset - containerWidth / 2 + elementWidth / 2;
        container.scrollTo({ left: centeredScroll, behavior: 'smooth' });
    }, [weekOptions, activeView]);

    const handleWeekSelect = useCallback((isoValue: string) => {
        const date = parseWeekValue(isoValue);
        if (!isNaN(date.getTime())) setSelectedDate(date);
    }, [setSelectedDate]);

    const sportLabel = activeView === 'LIVE' ? 'Live' : SPORT_CONFIG[selectedSport]?.label || 'Sports';
    const sportIcon = SPORT_CONFIG[selectedSport]?.icon;
    const leagueId = LEAGUES.find(l => l.sport === selectedSport)?.id.toUpperCase() || 'GLOBAL';

    return (
        <header className="sticky top-0 z-40 w-full bg-black/95 backdrop-blur-2xl border-b border-white/10 print:hidden pt-safe">
            {/* Network reconnecting indicator — subtle header pulse */}
            {reconnecting && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-amber-500/60 to-transparent animate-reconnect" />
            )}

            <div className="max-w-7xl mx-auto w-full flex flex-col">
                {/* PRIMARY ROW: Context & Identity — 56px, 44px touch targets */}
                <div className="h-14 px-4 md:px-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {/* Sport Selector — 44px touch target */}
                        <button
                            onClick={() => toggleSportDrawer(true)}
                            className="group flex items-center gap-3 min-h-[44px] min-w-[44px] active:scale-[0.97] transition-all duration-200"
                            aria-label={`Select sport: ${sportLabel}`}
                        >
                            <div className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 shadow-[inner_0_1px_0_rgba(255,255,255,0.05)] group-hover:bg-white/10 transition-colors text-base relative overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent opacity-50" />
                                <span className="relative z-10">{sportIcon}</span>
                            </div>
                            <div className="flex flex-col items-start leading-none gap-0.5">
                                <div className="flex items-center gap-1">
                                    <h1 className="text-[16px] font-semibold tracking-tight text-white/90 group-hover:text-white transition-colors">
                                        {sportLabel}
                                    </h1>
                                    <ChevronDown size={12} className="text-zinc-500 mt-0.5 group-hover:text-zinc-300 transition-colors" />
                                </div>
                                {activeView !== 'LIVE' && leagueId.toLowerCase() !== sportLabel.toLowerCase() && (
                                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none">
                                        {leagueId}
                                    </span>
                                )}
                            </div>
                        </button>

                        {isCollege && (
                            <button
                                onClick={() => toggleRankingsDrawer(true)}
                                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-amber-500/80 hover:text-amber-400 hover:bg-amber-500/10 transition-all active:scale-90"
                                aria-label="Rankings"
                            >
                                <Trophy size={16} />
                            </button>
                        )}
                    </div>

                    {/* Global Actions — 44px touch targets */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => toggleCmdk()}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all active:scale-95"
                            aria-label="Search"
                        >
                            <Search size={18} strokeWidth={2.5} />
                        </button>

                        {user ? (
                            <button
                                onClick={() => toggleAuthModal(true)}
                                className="relative min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-95 transition-transform"
                                aria-label="Account"
                            >
                                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-zinc-700 to-zinc-900 border border-white/10 flex items-center justify-center text-[11px] font-bold text-zinc-100 uppercase tracking-tighter shadow-lg">
                                    {user.email?.[0]}
                                </div>
                            </button>
                        ) : (
                            <button
                                onClick={() => toggleAuthModal(true)}
                                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-white/5 border border-white/5 text-zinc-500 hover:text-zinc-300 active:scale-95 transition-all"
                                aria-label="Sign in"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                    <circle cx="12" cy="7" r="4" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>

                {/* SECONDARY ROW: Timeline / Live Controls — touch-optimized */}
                <div className="h-11 px-4 md:px-6 flex items-center border-t border-white/5">
                    <AnimatePresence mode="wait">
                        {activeView === 'FEED' ? (
                            <MotionDiv
                                key="feed-nav"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="flex-1 flex items-center gap-1"
                            >
                                <button
                                    onClick={() => setSelectedDate(-navStep)}
                                    className="min-w-[44px] min-h-[40px] flex items-center justify-center text-zinc-500 hover:text-white bg-white/5 rounded-lg border border-white/5 transition-all active:scale-90"
                                    aria-label="Previous date"
                                >
                                    <ChevronLeft size={16} />
                                </button>

                                <div
                                    ref={weekScrollRef}
                                    className="flex-1 overflow-x-auto no-scrollbar flex items-center gap-1 px-1"
                                >
                                    <LayoutGroup id="week-tabs">
                                        {weekOptions.map((option) => (
                                            <button
                                                key={option.value}
                                                id={option.isCurrent ? 'week-tab-active' : undefined}
                                                onClick={() => handleWeekSelect(option.value)}
                                                className={cn(
                                                    "relative flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-semibold tracking-tight transition-all duration-200 select-none min-h-[36px]",
                                                    option.isCurrent ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                                                )}
                                            >
                                                {option.isCurrent && (
                                                    <MotionSpan
                                                        layoutId="week-active-pill"
                                                        className="absolute inset-0 rounded-lg bg-white/10 border border-white/10 shadow-sm"
                                                        transition={ESSENCE.transition.spring}
                                                    />
                                                )}
                                                <span className="relative z-10">{option.label}</span>
                                            </button>
                                        ))}
                                    </LayoutGroup>
                                </div>

                                <button
                                    onClick={() => setSelectedDate(navStep)}
                                    className="min-w-[44px] min-h-[40px] flex items-center justify-center text-zinc-500 hover:text-white bg-white/5 rounded-lg border border-white/5 transition-all active:scale-90"
                                    aria-label="Next date"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </MotionDiv>
                        ) : activeView === 'LIVE' ? (
                            <MotionDiv
                                key="live-nav"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="flex-1 flex items-center justify-between gap-2"
                            >
                                {/* Segmented Control — 44px touch targets */}
                                <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/5">
                                    {(['LIVE', 'NEXT', 'ENDED'] as const).map((tab) => {
                                        const labels = { LIVE: 'Live', NEXT: 'Next', ENDED: 'Done' };
                                        const isActive = liveTab === tab;
                                        return (
                                            <button
                                                key={tab}
                                                onClick={() => setLiveTab(tab)}
                                                className={cn(
                                                    "relative px-3 py-2 min-h-[36px] rounded-md text-[11px] font-semibold tracking-tight transition-colors",
                                                    isActive ? "text-white bg-white/10" : "text-zinc-500"
                                                )}
                                            >
                                                {labels[tab]}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Controls — compressed for mobile */}
                                <div className="flex items-center gap-1.5">
                                    <div className="relative hidden md:block">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={12} />
                                        <input
                                            type="text"
                                            placeholder="Search..."
                                            value={liveFilter}
                                            onChange={(e) => setLiveFilter(e.target.value)}
                                            className="w-28 bg-white/5 border border-white/5 rounded-lg py-2 pl-7 pr-2 text-[12px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:bg-white/10 focus:border-white/10 transition-all"
                                        />
                                    </div>

                                    {/* Layout Toggle */}
                                    <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/5">
                                        <button
                                            onClick={() => setLiveLayout('LIST')}
                                            className={cn(
                                                "p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-md transition-colors",
                                                liveLayout === 'LIST' ? "text-white bg-white/10" : "text-zinc-500"
                                            )}
                                            aria-label="List view"
                                        >
                                            <List size={14} />
                                        </button>
                                        <button
                                            onClick={() => setLiveLayout('GRID')}
                                            className={cn(
                                                "p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-md transition-colors",
                                                liveLayout === 'GRID' ? "text-white bg-white/10" : "text-zinc-500"
                                            )}
                                            aria-label="Grid view"
                                        >
                                            <Grid3X3 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </MotionDiv>
                        ) : (
                            <div className="flex-1" />
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </header>
    );
};
