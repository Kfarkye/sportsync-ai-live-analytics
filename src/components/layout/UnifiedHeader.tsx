
import React, { FC, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { ChevronLeft, ChevronRight, Grid3X3, List } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAuth } from '../../contexts/AuthContext';
import { useWeekNavigation } from '../../hooks/useWeekNavigation';
import { useMatches } from '../../hooks/useMatches';
import { OddsLensToggle } from '../shared/OddsLens';
import { Sport } from '@/types';
import { isGameInProgress } from '../../utils/matchUtils';
import { cn, ESSENCE } from '@/lib/essence';

const MotionSpan = motion.span;
const MotionDiv = motion.div;

// ─── Header Sport Tabs ───────────────────────────────────────────
const HEADER_SPORTS: { label: string; sport: Sport | 'all' }[] = [
    { label: 'All Sports', sport: 'all' as any },
    { label: 'MLB', sport: Sport.BASEBALL },
    { label: 'NBA', sport: Sport.NBA },
    { label: 'NHL', sport: Sport.HOCKEY },
    { label: 'NFL', sport: Sport.NFL },
    { label: 'NCAAB', sport: Sport.COLLEGE_BASKETBALL },
    { label: 'Soccer', sport: Sport.SOCCER },
];

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const parseWeekValue = (value: string): Date => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const parts = value.split('-');
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        const d = Number(parts[2]);
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
        liveLayout,
        setSelectedDate,
        setSelectedSport,
        setActiveView,
        setLiveTab,
        setLiveLayout,
        toggleSportDrawer,
        toggleAuthModal,
    } = useAppStore();

    const { user } = useAuth();

    const weekScrollRef = useRef<HTMLDivElement>(null);
    const weekOptions = useWeekNavigation(selectedDate, selectedSport);
    const { data: liveStatusMatches = [] } = useMatches(selectedDate);
    const navStep = (selectedSport === Sport.NFL || selectedSport === Sport.COLLEGE_FOOTBALL) ? 7 : 1;
    const liveGamesCount = useMemo(
        () => liveStatusMatches.filter((m) => isGameInProgress(m.status)).length,
        [liveStatusMatches]
    );
    const hasActiveLiveGames = liveGamesCount > 0;
    const isTrendsPage = typeof window !== 'undefined' && (
        window.location.pathname.includes('/trends') ||
        window.location.pathname.includes('/edge') ||
        window.location.pathname.includes('/reports')
    );

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
        results.push({ label: 'Yesterday', value: toIsoDate(yest) });
        const tom = new Date(d); tom.setDate(tom.getDate() + 1);
        results.push({ label: 'Tomorrow', value: toIsoDate(tom) });
        for (let i = 2; i <= 3; i++) {
            const nd = new Date(d); nd.setDate(nd.getDate() + i);
            results.push({
                label: nd.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + (nd.getMonth() + 1) + '/' + nd.getDate(),
                value: toIsoDate(nd),
            });
        }
        return results;
    }, [selectedDate]);

    return (
        <header className="sticky top-0 z-40 w-full bg-white/95 supports-backdrop-filter:bg-white/88 backdrop-blur-md print:hidden pt-safe shadow-[0_1px_0_rgba(17,24,39,0.07)]">
            {/* ─── PRIMARY ROW: Brand + Sport Tabs + Actions ──── */}
            <div className="max-w-7xl mx-auto w-full">
                <div className="h-[54px] max-[390px]:h-[50px] px-4 max-[390px]:px-3 md:px-7 flex items-center justify-between border-b border-slate-200/90">
                    <div className="flex items-center gap-5 max-[390px]:gap-3">
                        {/* Wordmark */}
                        <button
                            onClick={() => toggleSportDrawer(true)}
                            className="flex items-center gap-3 select-none active:scale-[0.97] transition-transform md:cursor-default"
                        >
                            <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-600">
                                MLB
                            </span>
                            <span
                                className="text-[24px] max-[390px]:text-[21px] tracking-[-0.04em] text-slate-900 leading-none font-semibold"
                                style={{ fontFamily: 'Iowan Old Style, Georgia, Times New Roman, serif' }}
                            >
                                The Drip
                            </span>
                        </button>

                        {/* Divider */}
                        <div className="hidden md:block w-px h-[18px] bg-slate-200" />

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
                                            "relative px-2.5 py-[6px] rounded-md text-[12.5px] tracking-tight transition-colors select-none",
                                            isActive ? "font-semibold text-[#312E81]" : "font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                                        )}
                                        >
                                            {isActive && (
                                                <MotionSpan
                                                    layoutId="sport-active-pill"
                                                    className="absolute inset-0 rounded-md bg-[#EFF6FF] ring-1 ring-[#BFDBFE]"
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
                    <div className="flex items-center gap-2 max-[390px]:gap-1">
                        <a
                            href="/trends"
                            className={cn(
                                "h-[34px] max-[390px]:h-[32px] flex items-center gap-1.5 px-3 max-[390px]:px-2.5 rounded-lg text-[11px] max-[390px]:text-[10px] font-semibold tracking-[0.05em] transition-all active:scale-95 select-none border",
                                isTrendsPage
                                    ? "bg-[#0A0A0A] border-[#0A0A0A] text-white"
                                    : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400"
                            )}
                            style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                        >
                            TRENDS
                        </a>
                        <button
                            type="button"
                            onClick={handleLiveClick}
                            className={cn(
                                "h-[34px] max-[390px]:h-[32px] flex items-center gap-1.5 px-3 max-[390px]:px-2.5 rounded-lg text-[11px] max-[390px]:text-[10px] font-semibold tracking-[0.05em] transition-all active:scale-95 select-none border",
                                activeView === 'LIVE'
                                    ? "bg-[#0B63F6] border-[#0B63F6] text-white shadow-[0_8px_20px_-10px_rgba(11,99,246,0.5)]"
                                    : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400"
                            )}
                            style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                        >
                            LIVE
                            {hasActiveLiveGames ? (
                                <span className="relative inline-flex h-2 w-2 items-center justify-center" aria-label={`${liveGamesCount} live games`}>
                                    <span className="absolute inline-flex h-2 w-2 rounded-full bg-emerald-400/40 animate-ping [animation-duration:2s]" />
                                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
                                </span>
                            ) : null}
                        </button>

                        <div className="hidden md:block w-px h-[18px] bg-slate-200 mx-0.5" />

                        <div className="hidden md:flex"><OddsLensToggle /></div>

                        {user ? (
                            <button
                                type="button"
                                onClick={() => toggleAuthModal(true)}
                                className="h-[34px] max-[390px]:h-[32px] flex items-center rounded-lg border border-slate-300 bg-white px-3 max-[390px]:px-2.5 text-[11px] max-[390px]:text-[10px] font-semibold tracking-[0.08em] text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-400 active:scale-95"
                                style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                            >
                                ACCOUNT
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => toggleAuthModal(true)}
                                className="h-[34px] max-[390px]:h-[32px] flex items-center rounded-lg border border-slate-300 bg-white px-3 max-[390px]:px-2.5 text-[11px] max-[390px]:text-[10px] font-semibold tracking-[0.08em] text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-400 active:scale-95"
                                style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                            >
                                LOG IN
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ─── SECONDARY ROW: Date Strip ──────────────────── */}
            <div className="max-w-7xl mx-auto w-full">
                <div className="h-[48px] max-[390px]:h-[44px] px-4 max-[390px]:px-3 md:px-7 flex items-center justify-between border-b border-slate-200/80">
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
                                <div className="flex items-center gap-1 max-[390px]:gap-0.5">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedDate(-navStep)}
                                        className="w-[34px] h-[34px] max-[390px]:w-[30px] max-[390px]:h-[30px] flex items-center justify-center text-slate-500 hover:text-slate-900 border border-slate-300 rounded-lg bg-white transition-all active:scale-90"
                                    >
                                        <ChevronLeft size={16} />
                                    </button>

                                    <button type="button" className="h-[34px] max-[390px]:h-[30px] flex items-center gap-2 max-[390px]:gap-1.5 px-3.5 max-[390px]:px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 transition-colors select-none">
                                        <span className="text-[13px] max-[390px]:text-[12px] font-semibold text-slate-900">{dateDisplay.label}</span>
                                        {dateDisplay.isToday && (
                                            <span
                                                className="text-[9.5px] font-bold tracking-[0.06em] text-[#1E40AF] px-1.5 py-px rounded bg-[#EFF6FF]"
                                                style={{
                                                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                                                }}
                                            >
                                                TODAY
                                            </span>
                                        )}
                                        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="#64748B" strokeWidth="1.5"><path d="M2 4L5 7L8 4" /></svg>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setSelectedDate(navStep)}
                                        className="w-[34px] h-[34px] max-[390px]:w-[30px] max-[390px]:h-[30px] flex items-center justify-center text-slate-500 hover:text-slate-900 border border-slate-300 rounded-lg bg-white transition-all active:scale-90"
                                    >
                                        <ChevronRight size={16} />
                                    </button>
                                </div>

                                {/* Right: Quick date links */}
                                <div className="hidden md:flex items-center gap-0.5">
                                    {quickDates.map((qd) => (
                                        <button
                                            key={qd.value}
                                            onClick={() => handleWeekSelect(qd.value)}
                                            className="px-2.5 py-1 rounded-[5px] text-[11px] text-slate-500 hover:text-[#1D4ED8] hover:bg-[#EFF6FF] transition-all select-none"
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
                                className="flex-1 flex items-center justify-between gap-4 max-[390px]:gap-2"
                            >
                                <div className="flex items-center bg-slate-50 rounded-lg p-0.5 border border-slate-300">
                                    {(['LIVE', 'NEXT', 'ENDED'] as const).map((tab) => {
                                        const labels = { LIVE: 'Live', NEXT: 'Upcoming', ENDED: 'Completed' };
                                        const isActive = liveTab === tab;
                                        return (
                                            <button
                                                key={tab}
                                                onClick={() => setLiveTab(tab)}
                                                className={cn(
                                                    "relative px-3 max-[390px]:px-2.5 py-1.5 max-[390px]:py-1 rounded-md text-[11px] max-[390px]:text-[10px] font-semibold tracking-[0.02em] transition-colors",
                                                    isActive ? "text-[#1D4ED8] bg-[#EFF6FF] shadow-sm" : "text-slate-500 hover:text-slate-700"
                                                )}
                                            >
                                                {labels[tab]}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="flex items-center gap-2 max-[390px]:gap-1.5">
                                    <div className="flex bg-slate-50 rounded-lg p-0.5 border border-slate-300">
                                        <button
                                            onClick={() => setLiveLayout('LIST')}
                                            className={cn("p-1.5 rounded-md transition-colors", liveLayout === 'LIST' ? "text-[#1D4ED8] bg-[#EFF6FF] shadow-sm" : "text-slate-500 hover:text-slate-700")}
                                        >
                                            <List size={14} />
                                        </button>
                                        <button
                                            onClick={() => setLiveLayout('GRID')}
                                            className={cn("p-1.5 rounded-md transition-colors", liveLayout === 'GRID' ? "text-[#1D4ED8] bg-[#EFF6FF] shadow-sm" : "text-slate-500 hover:text-slate-700")}
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
