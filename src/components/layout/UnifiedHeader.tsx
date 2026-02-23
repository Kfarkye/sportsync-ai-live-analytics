import React, { FC, useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { Trophy, ChevronDown, Search, Grid3X3, List, Calendar } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAuth } from '../../contexts/AuthContext';
import { useWeekNavigation } from '../../hooks/useWeekNavigation';
import { SPORT_CONFIG, LEAGUES } from '@/constants';
import { Sport } from '@/types';
import { cn, ESSENCE } from '@/lib/essence';
import { formatLocalDate } from '@/utils/dateUtils';

const MotionSpan = motion.span;
const MotionDiv = motion.div;

// ─────────────────────────────────────────────────────────────
// § DATE HELPERS
// ─────────────────────────────────────────────────────────────

/** Noon local — avoids timezone drift on day boundaries */
const noonLocal = (d: Date): Date => {
    const c = new Date(d);
    c.setHours(12, 0, 0, 0);
    return c;
};

const offsetDays = (d: Date, n: number): Date => {
    const c = noonLocal(d);
    c.setDate(c.getDate() + n);
    return c;
};

const isSameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

const formatShort = (d: Date): { day: string; num: string } => ({
    day: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
    num: String(d.getDate()),
});

const parseWeekValue = (value: string): Date => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map(Number);
        return new Date(y, m - 1, d, 12, 0, 0, 0);
    }
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && value.trim() !== '') return new Date(numeric);
    return new Date(value);
};

// ─────────────────────────────────────────────────────────────
// § TEMPORAL ANCHORS — Yesterday · Today · Tomorrow
// ─────────────────────────────────────────────────────────────

interface AnchorOption {
    label: string;
    date: Date;
    value: string;
    isActive: boolean;
}

const useTemporalAnchors = (selectedDate: Date): { anchors: AnchorOption[]; isOnAnchor: boolean } => {
    return useMemo(() => {
        const today = noonLocal(new Date());
        const selected = selectedDate instanceof Date ? noonLocal(selectedDate) : noonLocal(new Date(selectedDate));

        const anchors: AnchorOption[] = [
            { label: 'Yesterday', date: offsetDays(today, -1), value: formatLocalDate(offsetDays(today, -1)), isActive: false },
            { label: 'Today',     date: today,                 value: formatLocalDate(today),                 isActive: false },
            { label: 'Tomorrow',  date: offsetDays(today, +1), value: formatLocalDate(offsetDays(today, +1)), isActive: false },
        ];

        let isOnAnchor = false;
        for (const a of anchors) {
            if (isSameDay(a.date, selected)) {
                a.isActive = true;
                isOnAnchor = true;
            }
        }

        return { anchors, isOnAnchor };
    }, [selectedDate]);
};

// ─────────────────────────────────────────────────────────────
// § EXTENDED DATE GRID (±7 days from today)
// ─────────────────────────────────────────────────────────────

const ExtendedDateGrid: FC<{
    selectedDate: Date;
    onSelect: (date: Date) => void;
    onClose: () => void;
}> = ({ selectedDate, onSelect, onClose }) => {
    const today = noonLocal(new Date());
    const selected = noonLocal(selectedDate);

    const days = useMemo(() => {
        const result: Date[] = [];
        for (let i = -7; i <= 7; i++) {
            result.push(offsetDays(today, i));
        }
        return result;
    }, [today]);

    return (
        <MotionDiv
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden border-t border-white/[0.04]"
        >
            <div className="px-4 md:px-6 py-3">
                <div className="grid grid-cols-7 gap-1">
                    {days.map((d) => {
                        const { day, num } = formatShort(d);
                        const isToday = isSameDay(d, today);
                        const isSelected = isSameDay(d, selected);

                        return (
                            <button
                                key={d.toISOString()}
                                onClick={() => {
                                    onSelect(d);
                                    onClose();
                                }}
                                className={cn(
                                    "flex flex-col items-center py-2 rounded-lg transition-all duration-200",
                                    "active:scale-[0.92]",
                                    isSelected
                                        ? "bg-white/[0.08] ring-1 ring-white/[0.08]"
                                        : "hover:bg-white/[0.04]",
                                )}
                            >
                                <span className={cn(
                                    "text-[9px] font-semibold tracking-[0.1em] leading-none mb-1.5",
                                    isSelected ? "text-white/70" : "text-zinc-600",
                                )}>
                                    {day}
                                </span>
                                <span className={cn(
                                    "text-[13px] font-semibold leading-none tabular-nums",
                                    isSelected ? "text-white" : isToday ? "text-zinc-300" : "text-zinc-500",
                                )}>
                                    {num}
                                </span>
                                {isToday && (
                                    <div className="w-1 h-1 rounded-full bg-white/40 mt-1.5" />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </MotionDiv>
    );
};

// ─────────────────────────────────────────────────────────────
// § UNIFIED HEADER
// ─────────────────────────────────────────────────────────────

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

    const { user } = useAuth();
    const [calendarOpen, setCalendarOpen] = useState(false);

    const isFootball = selectedSport === Sport.NFL || selectedSport === Sport.COLLEGE_FOOTBALL;
    const isCollege = selectedSport === Sport.COLLEGE_FOOTBALL || selectedSport === Sport.COLLEGE_BASKETBALL;

    const weekOptions = useWeekNavigation(selectedDate, selectedSport);
    const weekScrollRef = useRef<HTMLDivElement>(null);
    const safeDate = selectedDate instanceof Date ? selectedDate : new Date(selectedDate);
    const { anchors, isOnAnchor } = useTemporalAnchors(safeDate);

    // Auto-center active week tab (football only)
    useEffect(() => {
        if (!isFootball) return;
        const container = weekScrollRef.current;
        const el = document.getElementById('week-tab-active');
        if (!container || !el) return;
        container.scrollTo({
            left: el.offsetLeft - container.offsetWidth / 2 + el.offsetWidth / 2,
            behavior: 'smooth',
        });
    }, [weekOptions, isFootball]);

    const handleWeekSelect = useCallback((isoValue: string) => {
        const date = parseWeekValue(isoValue);
        if (!isNaN(date.getTime())) setSelectedDate(date);
    }, [setSelectedDate]);

    const handleDateSelect = useCallback((date: Date) => {
        setSelectedDate(noonLocal(date));
        setCalendarOpen(false);
    }, [setSelectedDate]);

    const sportLabel = activeView === 'LIVE' ? 'Live' : SPORT_CONFIG[selectedSport]?.label || 'Sports';
    const sportIcon = SPORT_CONFIG[selectedSport]?.icon;
    const leagueId = LEAGUES.find(l => l.sport === selectedSport)?.id.toUpperCase() || 'GLOBAL';

    // Display label for dates outside Yesterday/Today/Tomorrow
    const offAnchorLabel = useMemo(() => {
        if (isOnAnchor) return '';
        return safeDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }, [isOnAnchor, safeDate]);

    return (
        <header className="sticky top-0 z-40 w-full bg-black/95 backdrop-blur-2xl border-b border-white/[0.06] print:hidden pt-safe">
            <div className="max-w-7xl mx-auto w-full flex flex-col">

                {/* ── PRIMARY ROW ─────────────────────────────────── */}
                <div className="h-14 px-4 md:px-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => toggleSportDrawer(true)}
                            className="group flex items-center gap-3 active:scale-[0.97] transition-all duration-200"
                        >
                            <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/5 border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] group-hover:bg-white/10 transition-colors text-base relative overflow-hidden">
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
                                    <span className="text-label font-black text-zinc-500 uppercase tracking-widest leading-none">
                                        {leagueId}
                                    </span>
                                )}
                            </div>
                        </button>

                        {isCollege && (
                            <button
                                onClick={() => toggleRankingsDrawer(true)}
                                className="w-7 h-7 flex items-center justify-center rounded-full text-amber-500/80 hover:text-amber-400 hover:bg-amber-500/10 transition-all active:scale-90"
                            >
                                <Trophy size={14} />
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => toggleCmdk()}
                            className="w-8 h-8 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all active:scale-95"
                        >
                            <Search size={16} strokeWidth={2.5} />
                        </button>

                        {user ? (
                            <button
                                onClick={() => toggleAuthModal(true)}
                                className="relative w-7 h-7 rounded-full bg-zinc-800 border border-white/10 p-0.5 shadow-lg active:scale-95 transition-transform"
                            >
                                <div className="w-full h-full rounded-full bg-gradient-to-tr from-zinc-700 to-zinc-900 flex items-center justify-center text-caption font-bold text-zinc-100 uppercase tracking-tighter">
                                    {user.email?.[0]}
                                </div>
                            </button>
                        ) : (
                            <button
                                onClick={() => toggleAuthModal(true)}
                                className="w-7 h-7 rounded-full bg-white/5 border border-white/5 flex items-center justify-center text-zinc-500 hover:text-zinc-300 active:scale-95 transition-all"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                    <circle cx="12" cy="7" r="4" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>

                {/* ── SECONDARY ROW ───────────────────────────────── */}
                <div className="border-t border-white/[0.04]">
                    <AnimatePresence mode="wait">
                        {activeView === 'FEED' ? (
                            <MotionDiv
                                key="feed-nav"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                            >
                                {isFootball ? (
                                    /* ── FOOTBALL: Week pills ── */
                                    <div className="h-11 px-4 md:px-6 flex items-center">
                                        <div
                                            ref={weekScrollRef}
                                            className="flex-1 overflow-x-auto no-scrollbar flex items-center gap-1"
                                        >
                                            <LayoutGroup id="week-tabs">
                                                {weekOptions.map((option) => (
                                                    <button
                                                        key={option.value}
                                                        id={option.isCurrent ? 'week-tab-active' : undefined}
                                                        onClick={() => handleWeekSelect(option.value)}
                                                        className={cn(
                                                            "relative flex-shrink-0 px-3 py-1.5 rounded-lg text-footnote font-semibold tracking-tight transition-colors duration-200 select-none",
                                                            option.isCurrent ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                                                        )}
                                                    >
                                                        {option.isCurrent && (
                                                            <MotionSpan
                                                                layoutId="week-active-pill"
                                                                className="absolute inset-0 rounded-lg bg-white/[0.08] border border-white/[0.06]"
                                                                transition={ESSENCE.transition.spring}
                                                            />
                                                        )}
                                                        <span className="relative z-10">{option.label}</span>
                                                    </button>
                                                ))}
                                            </LayoutGroup>
                                        </div>
                                    </div>
                                ) : (
                                    /* ── ALL SPORTS: Yesterday · Today · Tomorrow ── */
                                    <div className="h-11 px-4 md:px-6 flex items-center justify-between">
                                        <LayoutGroup id="date-anchors">
                                            <div className="flex items-center gap-0.5">
                                                {anchors.map((anchor) => (
                                                    <button
                                                        key={anchor.label}
                                                        onClick={() => handleDateSelect(anchor.date)}
                                                        className={cn(
                                                            "relative px-3.5 py-1.5 rounded-lg text-[13px] font-semibold tracking-[-0.01em] transition-colors duration-200 select-none",
                                                            anchor.isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-300',
                                                        )}
                                                    >
                                                        {anchor.isActive && (
                                                            <MotionSpan
                                                                layoutId="date-active-pill"
                                                                className="absolute inset-0 rounded-lg bg-white/[0.08] border border-white/[0.06]"
                                                                transition={ESSENCE.transition.spring}
                                                            />
                                                        )}
                                                        <span className="relative z-10">{anchor.label}</span>
                                                    </button>
                                                ))}

                                                {/* Off-anchor date pill */}
                                                {!isOnAnchor && (
                                                    <MotionDiv
                                                        initial={{ opacity: 0, scale: 0.95 }}
                                                        animate={{ opacity: 1, scale: 1 }}
                                                        className="relative px-3.5 py-1.5 rounded-lg"
                                                    >
                                                        <MotionSpan
                                                            layoutId="date-active-pill"
                                                            className="absolute inset-0 rounded-lg bg-white/[0.08] border border-white/[0.06]"
                                                            transition={ESSENCE.transition.spring}
                                                        />
                                                        <span className="relative z-10 text-[13px] font-semibold text-white">
                                                            {offAnchorLabel}
                                                        </span>
                                                    </MotionDiv>
                                                )}
                                            </div>
                                        </LayoutGroup>

                                        {/* Calendar toggle */}
                                        <button
                                            onClick={() => setCalendarOpen(prev => !prev)}
                                            className={cn(
                                                "w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 active:scale-90",
                                                calendarOpen
                                                    ? "bg-white/[0.08] text-white"
                                                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]",
                                            )}
                                        >
                                            <Calendar size={15} strokeWidth={2} />
                                        </button>
                                    </div>
                                )}

                                {/* ── EXTENDED CALENDAR GRID ── */}
                                <AnimatePresence>
                                    {calendarOpen && !isFootball && (
                                        <ExtendedDateGrid
                                            selectedDate={safeDate}
                                            onSelect={handleDateSelect}
                                            onClose={() => setCalendarOpen(false)}
                                        />
                                    )}
                                </AnimatePresence>
                            </MotionDiv>
                        ) : activeView === 'LIVE' ? (
                            <MotionDiv
                                key="live-nav"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="h-11 px-4 md:px-6 flex items-center justify-between gap-4"
                            >
                                <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/5">
                                    {(['LIVE', 'NEXT', 'ENDED'] as const).map((tab) => {
                                        const labels = { LIVE: 'Live', NEXT: 'Upcoming', ENDED: 'Completed' };
                                        const isActive = liveTab === tab;
                                        return (
                                            <button
                                                key={tab}
                                                onClick={() => setLiveTab(tab)}
                                                className={cn(
                                                    "relative px-3 py-1.5 rounded-md text-footnote font-semibold tracking-tight transition-colors",
                                                    isActive ? "text-white bg-white/10" : "text-zinc-500 hover:text-zinc-300"
                                                )}
                                            >
                                                {labels[tab]}
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="flex items-center gap-2">
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={12} />
                                        <input
                                            type="text"
                                            placeholder="Search..."
                                            value={liveFilter}
                                            onChange={(e) => setLiveFilter(e.target.value)}
                                            className="w-28 bg-white/5 border border-white/5 rounded-lg py-1.5 pl-7 pr-2 text-footnote text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:bg-white/10 focus:border-white/10 transition-all"
                                        />
                                    </div>

                                    <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/5">
                                        <button
                                            onClick={() => setLiveLayout('LIST')}
                                            className={cn(
                                                "p-1.5 rounded-md transition-colors",
                                                liveLayout === 'LIST' ? "text-white bg-white/10" : "text-zinc-500 hover:text-zinc-300"
                                            )}
                                        >
                                            <List size={14} />
                                        </button>
                                        <button
                                            onClick={() => setLiveLayout('GRID')}
                                            className={cn(
                                                "p-1.5 rounded-md transition-colors",
                                                liveLayout === 'GRID' ? "text-white bg-white/10" : "text-zinc-500 hover:text-zinc-300"
                                            )}
                                        >
                                            <Grid3X3 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </MotionDiv>
                        ) : (
                            <div className="h-0" />
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </header>
    );
};
