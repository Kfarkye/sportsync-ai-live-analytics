
import React, { FC, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { ChevronLeft, ChevronRight, Search, Grid3X3, List } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAuth } from '../../contexts/AuthContext';
import { useWeekNavigation } from '../../hooks/useWeekNavigation';
import { OddsLensToggle } from '../shared/OddsLens';
import { SPORT_CONFIG } from '@/constants';
import { Sport } from '@/types';
import { cn, ESSENCE } from '@/lib/essence';

const MotionSpan = motion.span;
const MotionDiv = motion.div;

// ─── Header Sport Tabs ───────────────────────────────────────────
const HEADER_SPORTS: { label: string; sport: Sport | 'all' }[] = [
    { label: 'All Sports', sport: 'all' as any },
    { label: 'NBA', sport: Sport.NBA },
    { label: 'NHL', sport: Sport.HOCKEY },
    { label: 'NFL', sport: Sport.NFL },
    { label: 'NCAAB', sport: Sport.COLLEGE_BASKETBALL },
    { label: 'Soccer', sport: Sport.SOCCER },
];

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
        setSelectedSport,
        setActiveView,
        setLiveTab,
        setLiveFilter,
        setLiveLayout,
        toggleSportDrawer,
        toggleCmdk,
        toggleAuthModal,
    } = useAppStore();

    const { user } = useAuth();

    const weekScrollRef = useRef<HTMLDivElement>(null);
    const weekOptions = useWeekNavigation(selectedDate, selectedSport);
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

    const handleSportTab = useCallback((sport: Sport | 'all') => {
        if (activeView === 'LIVE') setActiveView('FEED');
        setSelectedSport(sport as Sport);
    }, [setSelectedSport, setActiveView, activeView]);

    const handleLiveClick = useCallback(() => {
        setActiveView(activeView === 'LIVE' ? 'FEED' : 'LIVE');
    }, [setActiveView, activeView]);

    // Date display
    const dateDisplay = useMemo(() => {
        const d = new Date(selectedDate);
        const today = new Date();
        return {
            label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            isToday: d.toDateString() === today.toDateString(),
        };
    }, [selectedDate]);

    // Quick nav dates
    const quickDates = useMemo(() => {
        const d = new Date(selectedDate);
        const results: { label: string; value: string }[] = [];
        const yest = new Date(d); yest.setDate(yest.getDate() - 1);
        results.push({ label: 'Yesterday', value: yest.toISOString().split('T')[0] });
        const tom = new Date(d); tom.setDate(tom.getDate() + 1);
        results.push({ label: 'Tomorrow', value: tom.toISOString().split('T')[0] });
        for (let i = 2; i <= 3; i++) {
            const nd = new Date(d); nd.setDate(nd.getDate() + i);
            results.push({
                label: nd.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + (nd.getMonth() + 1) + '/' + nd.getDate(),
                value: nd.toISOString().split('T')[0],
            });
        }
        return results;
    }, [selectedDate]);

    return (
        <header className="sticky top-0 z-40 w-full bg-white print:hidden pt-safe">
            {/* ─── PRIMARY ROW: Brand + Sport Tabs + Actions ──── */}
            <div className="max-w-7xl mx-auto w-full">
                <div className="h-[52px] px-4 md:px-7 flex items-center justify-between border-b border-zinc-200">
                    <div className="flex items-center gap-5">
                        {/* Serif wordmark */}
                        <button
                            onClick={() => toggleSportDrawer(true)}
                            className="flex items-center select-none active:scale-[0.97] transition-transform md:cursor-default"
                        >
                            <span
                                className="text-[20px] tracking-[-0.02em] text-zinc-900 italic leading-none"
                                style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
                            >
                                The Drip
                            </span>
                        </button>

                        {/* Divider */}
                        <div className="hidden md:block w-px h-[18px] bg-zinc-200" />

                        {/* Inline Sport Tabs */}
                        <nav className="hidden md:flex items-center gap-0.5">
                            <LayoutGroup id="sport-tabs">
                                {HEADER_SPORTS.map(({ label, sport }) => {
                                    const isActive = activeView !== 'LIVE' && (
                                        (sport === 'all' && (selectedSport as string) === 'all') ||
                                        selectedSport === sport
                                    );
                                    return (
                                        <button
                                            key={label}
                                            onClick={() => handleSportTab(sport)}
                                            className={cn(
                                                "relative px-2.5 py-[5px] rounded-md text-[12.5px] tracking-tight transition-colors select-none",
                                                isActive ? "font-semibold text-zinc-900" : "font-normal text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50"
                                            )}
                                        >
                                            {isActive && (
                                                <MotionSpan
                                                    layoutId="sport-active-pill"
                                                    className="absolute inset-0 rounded-md bg-zinc-100"
                                                    transition={ESSENCE.transition.spring}
                                                />
                                            )}
                                            <span className="relative z-10">{label}</span>
                                        </button>
                                    );
                                })}
                            </LayoutGroup>
                        </nav>
                    </div>

                    {/* Right: LIVE + Lens + Search + User */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleLiveClick}
                            className={cn(
                                "flex items-center gap-1.5 px-2.5 py-[5px] rounded-md text-[11px] font-semibold tracking-[0.04em] transition-all active:scale-95 select-none border",
                                activeView === 'LIVE'
                                    ? "bg-red-50 border-red-200 text-red-600"
                                    : "bg-red-50/50 border-red-100/80 text-red-500 hover:bg-red-50"
                            )}
                            style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                        >
                            <svg width="6" height="6" viewBox="0 0 6 6"><circle cx="3" cy="3" r="3" fill="currentColor"/></svg>
                            LIVE
                        </button>

                        <div className="hidden md:block w-px h-[18px] bg-zinc-200 mx-0.5" />

                        <div className="hidden md:flex"><OddsLensToggle /></div>

                        <button
                            onClick={() => toggleCmdk()}
                            className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 transition-all active:scale-95"
                        >
                            <Search size={15} strokeWidth={1.8} />
                        </button>

                        {user ? (
                            <button
                                onClick={() => toggleAuthModal(true)}
                                className="relative w-7 h-7 rounded-full bg-zinc-100 border border-zinc-200 p-0.5 active:scale-95 transition-transform"
                            >
                                <div className="w-full h-full rounded-full bg-zinc-200 flex items-center justify-center text-[10px] font-bold text-zinc-700 uppercase tracking-tighter">
                                    {user.email?.[0]}
                                </div>
                            </button>
                        ) : (
                            <button
                                onClick={() => toggleAuthModal(true)}
                                className="w-[30px] h-[30px] rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 active:scale-95 transition-all"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                                    <circle cx="8" cy="5.5" r="3"/><path d="M2 14.5c0-3 2.7-5 6-5s6 2 6 5"/>
                                </svg>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ─── SECONDARY ROW: Date Strip ──────────────────── */}
            <div className="max-w-7xl mx-auto w-full">
                <div className="h-10 px-4 md:px-7 flex items-center justify-between border-b border-zinc-100">
                    <AnimatePresence mode="wait">
                        {activeView === 'FEED' ? (
                            <MotionDiv
                                key="feed-date"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="flex-1 flex items-center justify-between"
                            >
                                {/* Left: < Date TODAY > */}
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => setSelectedDate(-navStep)}
                                        className="w-[26px] h-[26px] flex items-center justify-center text-zinc-400 hover:text-zinc-900 border border-zinc-200 rounded-md transition-all active:scale-90"
                                    >
                                        <ChevronLeft size={14} />
                                    </button>

                                    <button className="flex items-center gap-2 px-3.5 py-1 rounded-md border border-zinc-200 bg-zinc-50/50 hover:bg-zinc-100 transition-colors select-none">
                                        <span className="text-[13px] font-medium text-zinc-900">{dateDisplay.label}</span>
                                        {dateDisplay.isToday && (
                                            <span
                                                className="text-[9.5px] font-semibold tracking-[0.03em] px-1.5 py-px rounded-[3px]"
                                                style={{
                                                    color: '#22c55e',
                                                    backgroundColor: 'rgba(34,197,94,0.06)',
                                                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                                                }}
                                            >
                                                TODAY
                                            </span>
                                        )}
                                        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="#a1a1aa" strokeWidth="1.5"><path d="M2 4L5 7L8 4"/></svg>
                                    </button>

                                    <button
                                        onClick={() => setSelectedDate(navStep)}
                                        className="w-[26px] h-[26px] flex items-center justify-center text-zinc-400 hover:text-zinc-900 border border-zinc-200 rounded-md transition-all active:scale-90"
                                    >
                                        <ChevronRight size={14} />
                                    </button>
                                </div>

                                {/* Right: Quick date links */}
                                <div className="hidden md:flex items-center gap-0.5">
                                    {quickDates.map((qd) => (
                                        <button
                                            key={qd.value}
                                            onClick={() => handleWeekSelect(qd.value)}
                                            className="px-2.5 py-1 rounded-[5px] text-[11px] text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 transition-all select-none"
                                        >
                                            {qd.label}
                                        </button>
                                    ))}
                                </div>
                            </MotionDiv>
                        ) : activeView === 'LIVE' ? (
                            <MotionDiv
                                key="live-nav"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="flex-1 flex items-center justify-between gap-4"
                            >
                                <div className="flex items-center bg-zinc-50 rounded-lg p-0.5 border border-zinc-200">
                                    {(['LIVE', 'NEXT', 'ENDED'] as const).map((tab) => {
                                        const labels = { LIVE: 'Live', NEXT: 'Upcoming', ENDED: 'Completed' };
                                        const isActive = liveTab === tab;
                                        return (
                                            <button
                                                key={tab}
                                                onClick={() => setLiveTab(tab)}
                                                className={cn(
                                                    "relative px-3 py-1.5 rounded-md text-[11px] font-semibold tracking-tight transition-colors",
                                                    isActive ? "text-zinc-900 bg-white shadow-sm" : "text-zinc-400 hover:text-zinc-600"
                                                )}
                                            >
                                                {labels[tab]}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" size={12} />
                                        <input
                                            type="text"
                                            placeholder="Search..."
                                            value={liveFilter}
                                            onChange={(e) => setLiveFilter(e.target.value)}
                                            className="w-28 bg-zinc-50 border border-zinc-200 rounded-lg py-1.5 pl-7 pr-2 text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-300 transition-all"
                                        />
                                    </div>
                                    <div className="flex bg-zinc-50 rounded-lg p-0.5 border border-zinc-200">
                                        <button
                                            onClick={() => setLiveLayout('LIST')}
                                            className={cn("p-1.5 rounded-md transition-colors", liveLayout === 'LIST' ? "text-zinc-900 bg-white shadow-sm" : "text-zinc-400 hover:text-zinc-600")}
                                        >
                                            <List size={14} />
                                        </button>
                                        <button
                                            onClick={() => setLiveLayout('GRID')}
                                            className={cn("p-1.5 rounded-md transition-colors", liveLayout === 'GRID' ? "text-zinc-900 bg-white shadow-sm" : "text-zinc-400 hover:text-zinc-600")}
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
