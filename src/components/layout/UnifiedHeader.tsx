
import React, { FC, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { Trophy, ChevronDown, Calendar, ChevronLeft, ChevronRight, Search, Grid3X3, List, X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAuth } from '../../contexts/AuthContext';
import { useWeekNavigation } from '../../hooks/useWeekNavigation';
import { OddsLensToggle } from '../shared/OddsLens';
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

export const UnifiedHeader: FC = () => {
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
        <header className="sticky top-0 z-40 w-full bg-white border-b border-slate-200 print:hidden pt-safe">
            <div className="max-w-7xl mx-auto w-full flex flex-col">
                {/* PRIMARY ROW: Context & Identity */}
                <div className="h-14 px-4 md:px-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        {/* Unified Context Trigger */}
                        <button
                            onClick={() => toggleSportDrawer(true)}
                            className="group flex items-center gap-3 active:scale-[0.97] transition-all duration-200"
                        >
                            <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-200 group-hover:bg-slate-100 transition-colors text-base">
                                <span>{sportIcon}</span>
                            </div>
                            <div className="flex flex-col items-start leading-none gap-0.5">
                                <div className="flex items-center gap-1">
                                    <h1 className="text-[16px] font-semibold tracking-tight text-slate-900 group-hover:text-slate-700 transition-colors">
                                        {sportLabel}
                                    </h1>
                                    <ChevronDown size={12} className="text-slate-400 mt-0.5 group-hover:text-slate-500 transition-colors" />
                                </div>
                                {activeView !== 'LIVE' && leagueId.toLowerCase() !== sportLabel.toLowerCase() && (
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">
                                        {leagueId}
                                    </span>
                                )}
                            </div>
                        </button>

                        {isCollege && (
                            <button
                                onClick={() => toggleRankingsDrawer(true)}
                                className="w-7 h-7 flex items-center justify-center rounded-full text-amber-500 hover:text-amber-600 hover:bg-amber-50 transition-all active:scale-90"
                            >
                                <Trophy size={14} />
                            </button>
                        )}
                    </div>

                    {/* Global Actions */}
                    <div className="flex items-center gap-2">
                        <OddsLensToggle />
                        <button
                            onClick={() => toggleCmdk()}
                            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all active:scale-95"
                        >
                            <Search size={16} strokeWidth={2.5} />
                        </button>

                        {user ? (
                            <button
                                onClick={() => toggleAuthModal(true)}
                                className="relative w-7 h-7 rounded-full bg-slate-100 border border-slate-200 p-0.5 active:scale-95 transition-transform"
                            >
                                <div className="w-full h-full rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-700 uppercase tracking-tighter">
                                    {user.email?.[0]}
                                </div>
                            </button>
                        ) : (
                            <button
                                onClick={() => toggleAuthModal(true)}
                                className="w-7 h-7 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 active:scale-95 transition-all"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                    <circle cx="12" cy="7" r="4" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>

                {/* SECONDARY ROW: Timeline or View Navigation */}
                <div className="h-11 px-4 md:px-6 flex items-center border-t border-slate-100">
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
                                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-900 bg-slate-50 rounded-lg border border-slate-200 transition-all active:scale-90"
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
                                                    "relative flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold tracking-tight transition-all duration-200 select-none",
                                                    option.isCurrent ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                                                )}
                                            >
                                                {option.isCurrent && (
                                                    <MotionSpan
                                                        layoutId="week-active-pill"
                                                        className="absolute inset-0 rounded-lg bg-slate-100 border border-slate-200 shadow-sm"
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
                                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-900 bg-slate-50 rounded-lg border border-slate-200 transition-all active:scale-90"
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
                                className="flex-1 flex items-center justify-between gap-4"
                            >
                                {/* Segmented Control */}
                                <div className="flex items-center bg-slate-50 rounded-lg p-0.5 border border-slate-200">
                                    {(['LIVE', 'NEXT', 'ENDED'] as const).map((tab) => {
                                        const labels = { LIVE: 'Live', NEXT: 'Upcoming', ENDED: 'Completed' };
                                        const isActive = liveTab === tab;
                                        return (
                                            <button
                                                key={tab}
                                                onClick={() => setLiveTab(tab)}
                                                className={cn(
                                                    "relative px-3 py-1.5 rounded-md text-[11px] font-semibold tracking-tight transition-colors",
                                                    isActive ? "text-slate-900 bg-white shadow-sm" : "text-slate-400 hover:text-slate-600"
                                                )}
                                            >
                                                {labels[tab]}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Controls */}
                                <div className="flex items-center gap-2">
                                    {/* Search Input */}
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
                                        <input
                                            type="text"
                                            placeholder="Search..."
                                            value={liveFilter}
                                            onChange={(e) => setLiveFilter(e.target.value)}
                                            className="w-28 bg-slate-50 border border-slate-200 rounded-lg py-1.5 pl-7 pr-2 text-[11px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-300 transition-all"
                                        />
                                    </div>

                                    {/* Layout Toggle */}
                                    <div className="flex bg-slate-50 rounded-lg p-0.5 border border-slate-200">
                                        <button
                                            onClick={() => setLiveLayout('LIST')}
                                            className={cn(
                                                "p-1.5 rounded-md transition-colors",
                                                liveLayout === 'LIST' ? "text-slate-900 bg-white shadow-sm" : "text-slate-400 hover:text-slate-600"
                                            )}
                                        >
                                            <List size={14} />
                                        </button>
                                        <button
                                            onClick={() => setLiveLayout('GRID')}
                                            className={cn(
                                                "p-1.5 rounded-md transition-colors",
                                                liveLayout === 'GRID' ? "text-slate-900 bg-white shadow-sm" : "text-slate-400 hover:text-slate-600"
                                            )}
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
