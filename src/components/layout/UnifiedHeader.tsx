
import React, { FC, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { ChevronLeft, ChevronRight, Grid3X3, List } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { useAuth } from '../../contexts/AuthContext';
import { useWeekNavigation } from '../../hooks/useWeekNavigation';
import { useMatches } from '../../hooks/useMatches';
import { OddsLensToggle } from '../shared/OddsLens';
import { Sport } from '@/types';
import { isGameInProgress } from '../../utils/matchUtils';
import { cn } from '@/lib/essence';

const MotionDiv = motion.div;

// ─── Header Sport Tabs ───────────────────────────────────────────
const HEADER_SPORTS: { label: string; sport: Sport | 'all' }[] = [
    { label: 'All Sports', sport: 'all' as any },
    { label: 'NBA', sport: Sport.NBA },
    { label: 'MLB', sport: Sport.BASEBALL },
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

const formatDateValue = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4D3CD] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAFAF8]';

export const UnifiedHeader: FC = () => {
    const navigate = useNavigate();
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
        window.location.pathname.includes('/edge') || window.location.pathname.includes('/reports') || window.location.pathname.includes('/trends')
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
        if (activeView === 'LIVE') {
            setActiveView('FEED');
            navigate('/');
            return;
        }
        setActiveView('LIVE');
        navigate('/live');
    }, [setActiveView, activeView, navigate]);

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

    const selectedDateValue = useMemo(() => formatDateValue(new Date(selectedDate)), [selectedDate]);

    return (
        <header className="sticky top-0 z-40 w-full bg-[#FAFAF8]/95 supports-backdrop-filter:bg-[#FAFAF8]/90 backdrop-blur-md print:hidden pt-safe border-b border-[#E8E7E3]">
            {/* ─── PRIMARY ROW: Brand + Sport Tabs + Actions ──── */}
            <div className="max-w-7xl mx-auto w-full">
                <div className="h-16 max-[390px]:h-14 px-4 max-[390px]:px-3 md:px-7 flex items-center justify-between border-b border-[#E8E7E3]">
                    <div className="flex items-center gap-5 max-[390px]:gap-3">
                        {/* Wordmark */}
                        <button
                            aria-label="Open sport menu"
                            onClick={() => toggleSportDrawer(true)}
                            className={`h-11 min-w-11 px-1 flex items-center select-none active:scale-[0.97] transition-transform md:cursor-default ${focusRing}`}
                        >
                            <span
                                className="text-[15px] max-[390px]:text-[14px] tracking-[-0.02em] text-[#1A1A18] leading-none font-medium"
                                style={{ fontFamily: "JetBrains Mono, SFMono-Regular, monospace" }}
                            >
                                The Drip
                            </span>
                        </button>

                        {/* Divider */}
                        <div className="hidden md:block w-px h-[18px] bg-[#E8E7E3]" />

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
                                                type="button"
                                                aria-label={`Select ${label} matches`}
                                                key={label}
                                                onClick={() => handleSportTab(sport)}
                                                className={cn(
                                                    "relative px-2.5 py-[6px] rounded-none text-[12.5px] tracking-tight transition-colors select-none",
                                                    isActive ? "font-semibold text-[#1A1A18] underline underline-offset-4 decoration-[#1A1A18]" : "font-medium text-[#9B9B91] hover:text-[#1A1A18]",
                                                    focusRing
                                                )}
                                            >
                                            <span className="relative z-10">{label}</span>
                                        </button>
                                    );
                                })}
                            </LayoutGroup>
                        </nav>
                    </div>

                        {/* Right: Trends + LIVE + Lens + Account */}
                    <div className="flex items-center gap-2 max-[390px]:gap-1.5 shrink-0">
                        <a
                            href="/trends"
                            className={cn(
                                "h-11 min-w-11 flex items-center justify-center gap-1.5 px-3 rounded-lg text-[11px] font-medium tracking-[0.06em] transition-all active:scale-95 select-none",
                                isTrendsPage
                                    ? "text-[#1A1A18] underline underline-offset-4 decoration-[#1A1A18]"
                                    : "text-[#6B6B63] hover:text-[#1A1A18]",
                                focusRing
                            )}
                            aria-label="Open trends"
                            style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                        >
                            TRENDS
                        </a>
                        <button
                            type="button"
                            aria-label={activeView === 'LIVE' ? 'Switch to feed view' : 'Switch to live view'}
                            onClick={handleLiveClick}
                            className={cn(
                                "h-11 min-w-11 flex items-center gap-1.5 px-4 rounded-lg text-[11px] font-semibold tracking-[0.08em] transition-all active:scale-95 select-none border",
                                activeView === 'LIVE'
                                    ? "border-[#E8E7E3] bg-transparent text-[#1A1A18]"
                                    : "border-[#E8E7E3] bg-transparent text-[#6B6B63] hover:text-[#1A1A18]",
                                focusRing
                            )}
                            style={{ fontFamily: "JetBrains Mono, SFMono-Regular, monospace" }}
                        >
                            LIVE
                            {hasActiveLiveGames ? (
                                <span className="relative inline-flex h-2 w-2 items-center justify-center" aria-label={`${liveGamesCount} live games`}>
                                    <span className="absolute inline-flex h-2 w-2 rounded-full bg-[#2D8F5C]/35 animate-ping [animation-duration:2s]" />
                                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#2D8F5C]" />
                                </span>
                            ) : null}
                        </button>

                        <div className="hidden md:block w-px h-[18px] bg-[#E8E7E3] mx-0.5" />

                        <div className="hidden md:flex">
                            <div className={focusRing}><OddsLensToggle /></div>
                        </div>

                        <button
                            type="button"
                            onClick={() => toggleAuthModal(true)}
                            aria-label={user ? 'Open account menu' : 'Open login modal'}
                            className={`h-11 min-w-11 px-3 rounded-lg text-[11px] font-medium tracking-[0.06em] transition-all active:scale-95 select-none border bg-white border-[#E8E7E3] text-[#6B6B63] hover:text-[#1A1A18] hover:border-[#D4D3CD] ${focusRing}`}
                            style={{ fontFamily: "JetBrains Mono, SFMono-Regular, monospace" }}
                        >
                            Log in
                        </button>
                    </div>
                </div>
            </div>

            {/* ─── SECONDARY ROW: Date Strip ──────────────────── */}
            <div className="max-w-7xl mx-auto w-full">
                <div className="h-14 max-[390px]:h-[52px] px-4 max-[390px]:px-3 md:px-7 flex items-center justify-between border-b border-[#E8E7E3]">
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
                                        aria-label={dateDisplay.isToday ? 'Previous day' : 'Go to previous date step'}
                                        onClick={() => setSelectedDate(-navStep)}
                                        className={`w-11 h-11 flex items-center justify-center text-[#6B6B63] hover:text-[#1A1A18] border border-[#E8E7E3] rounded-lg bg-white transition-all active:scale-90 ${focusRing}`}
                                    >
                                        <ChevronLeft size={16} />
                                    </button>

                                    <button
                                        type="button"
                                        aria-label={`Current date: ${dateDisplay.label}`}
                                        className={`h-11 flex items-center gap-2 max-[390px]:gap-1.5 px-3.5 max-[390px]:px-2.5 rounded-lg border border-[#E8E7E3] bg-white hover:bg-[#FDFCFA] transition-colors select-none ${focusRing}`}
                                    >
                                        <span className="text-[13px] max-[390px]:text-[12px] font-semibold text-[#1A1A18]">{dateDisplay.label}</span>
                                        {dateDisplay.isToday && (
                                            <span
                                                className="text-[9.5px] font-bold tracking-[0.06em] text-[#FAFAF8] px-1.5 py-px rounded-[6px] bg-[#1A1A18]"
                                                style={{
                                                    fontFamily: "JetBrains Mono, SFMono-Regular, monospace",
                                                }}
                                            >
                                                TODAY
                                            </span>
                                        )}
                                        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="#9B9B91" strokeWidth="1.5"><path d="M2 4L5 7L8 4" /></svg>
                                    </button>

                                    <button
                                        type="button"
                                        aria-label="Next day"
                                        onClick={() => setSelectedDate(navStep)}
                                        className={`w-11 h-11 flex items-center justify-center text-[#6B6B63] hover:text-[#1A1A18] border border-[#E8E7E3] rounded-lg bg-white transition-all active:scale-90 ${focusRing}`}
                                    >
                                        <ChevronRight size={16} />
                                    </button>
                                </div>

                                {/* Right: Quick date links */}
                                <div className="hidden md:flex items-center gap-0.5">
                                    {quickDates.map((qd) => {
                                        const isSelected = qd.value === selectedDateValue;
                                        return (
                                            <button
                                                key={qd.value}
                                                onClick={() => handleWeekSelect(qd.value)}
                                                aria-label={`Jump to ${qd.label}`}
                                                className={cn(
                                                    "h-11 px-3 rounded-[8px] text-[11px] transition-all select-none",
                                                    isSelected
                                                        ? "text-[#1A1A18] font-semibold"
                                                        : "text-[#9B9B91] hover:text-[#1A1A18]",
                                                    focusRing
                                                )}
                                                aria-current={isSelected ? 'date' : undefined}
                                            >
                                                {qd.label}
                                            </button>
                                        );
                                    })}
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
                                <div className="flex items-center bg-white rounded-lg p-0.5 border border-[#E8E7E3]">
                                    {(['LIVE', 'NEXT', 'ENDED'] as const).map((tab) => {
                                        const labels = { LIVE: 'Live', NEXT: 'Upcoming', ENDED: 'Completed' };
                                        const isActive = liveTab === tab;
                                        return (
                                            <button
                                                key={tab}
                                                type="button"
                                                onClick={() => setLiveTab(tab)}
                                                aria-label={`${labels[tab]} games`}
                                                className={cn(
                                                    "relative h-11 min-w-[72px] px-3 max-[390px]:px-2.5 rounded-md text-[11px] max-[390px]:text-[10px] font-semibold tracking-[0.02em] transition-colors",
                                                    isActive ? "text-[#1A1A18] font-semibold" : "text-[#9B9B91] hover:text-[#1A1A18]",
                                                    focusRing
                                                )}
                                                style={{ fontFamily: "JetBrains Mono, SFMono-Regular, monospace" }}
                                            >
                                                {labels[tab]}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="flex items-center gap-2 max-[390px]:gap-1.5">
                                    <div className="relative">
                                        <input
                                            type="text"
                                            aria-label="Filter live matches"
                                            placeholder="Filter..."
                                            value={liveFilter}
                                            onChange={(e) => setLiveFilter(e.target.value)}
                                            className="w-32 max-[390px]:w-28 h-11 bg-white border border-[#E8E7E3] rounded-lg py-1.5 pl-2 pr-2 text-[11px] max-[390px]:text-[10px] text-[#1A1A18] placeholder:text-[#9B9B91] focus:outline-none focus:bg-white focus:border-[#D4D3CD] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4D3CD] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAFAF8]"
                                        />
                                    </div>
                                    <div className="flex bg-white rounded-lg p-0.5 border border-[#E8E7E3]">
                                        <button
                                            type="button"
                                            aria-label="List view"
                                            onClick={() => setLiveLayout('LIST')}
                                            className={cn(
                                                "w-11 h-11 flex items-center justify-center rounded-md transition-colors",
                                                liveLayout === 'LIST' ? "text-[#1A1A18]" : "text-[#9B9B91] hover:text-[#1A1A18]",
                                                focusRing
                                            )}
                                        >
                                            <List size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label="Grid view"
                                            onClick={() => setLiveLayout('GRID')}
                                            className={cn(
                                                "w-11 h-11 flex items-center justify-center rounded-md transition-colors",
                                                liveLayout === 'GRID' ? "text-[#1A1A18]" : "text-[#9B9B91] hover:text-[#1A1A18]",
                                                focusRing
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
