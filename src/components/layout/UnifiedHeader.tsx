import React, { FC, useMemo, useRef, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Search, Grid3X3, List } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAuth } from '../../contexts/AuthContext';
import { useMatches } from '../../hooks/useMatches';
import { OddsLensToggle } from '../shared/OddsLens';
import { Sport } from '@/types';
import { isGameInProgress } from '../../utils/matchUtils';
import { cn } from '@/lib/essence';

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
  if (!Number.isNaN(numeric) && value.trim() !== '') return new Date(numeric);
  return new Date(value);
};

const navButtonClass =
  'inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50';

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
  const { data: liveStatusMatches = [] } = useMatches(selectedDate);
  const navStep = selectedSport === Sport.NFL || selectedSport === Sport.COLLEGE_FOOTBALL ? 7 : 1;
  const liveGamesCount = useMemo(
    () => liveStatusMatches.filter((m) => isGameInProgress(m.status)).length,
    [liveStatusMatches],
  );
  const hasActiveLiveGames = liveGamesCount > 0;
  const isEdgePage =
    typeof window !== 'undefined' &&
    (window.location.pathname.includes('/edge') || window.location.pathname.includes('/reports'));

  const handleWeekSelect = useCallback(
    (isoValue: string) => {
      const date = parseWeekValue(isoValue);
      if (!Number.isNaN(date.getTime())) setSelectedDate(date);
    },
    [setSelectedDate],
  );

  const handleSportTab = useCallback(
    (sport: Sport | 'all') => {
      if (activeView === 'LIVE') setActiveView('FEED');
      setSelectedSport(sport as Sport);
    },
    [activeView, setActiveView, setSelectedSport],
  );

  const handleLiveClick = useCallback(() => {
    setActiveView(activeView === 'LIVE' ? 'FEED' : 'LIVE');
  }, [activeView, setActiveView]);

  const dateDisplay = useMemo(() => {
    const d = new Date(selectedDate);
    const today = new Date();
    return {
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      full: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      isToday: d.toDateString() === today.toDateString(),
    };
  }, [selectedDate]);

  const quickDates = useMemo(() => {
    const d = new Date(selectedDate);
    const items: { label: string; value: string }[] = [];
    const yesterday = new Date(d);
    yesterday.setDate(yesterday.getDate() - 1);
    items.push({ label: 'Yesterday', value: yesterday.toISOString().split('T')[0] });

    const tomorrow = new Date(d);
    tomorrow.setDate(tomorrow.getDate() + 1);
    items.push({ label: 'Tomorrow', value: tomorrow.toISOString().split('T')[0] });

    for (let i = 2; i <= 3; i++) {
      const future = new Date(d);
      future.setDate(future.getDate() + i);
      items.push({
        label: future.toLocaleDateString('en-US', { weekday: 'short' }),
        value: future.toISOString().split('T')[0],
      });
    }

    return items;
  }, [selectedDate]);

  useEffect(() => {
    const container = weekScrollRef.current;
    if (!container) return;
    container.scrollLeft = 0;
  }, [activeView, selectedDate]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur supports-backdrop-filter:bg-white/88 print:hidden">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="flex h-14 items-center justify-between gap-4 border-b border-slate-200/80">
          <div className="flex min-w-0 items-center gap-4">
            <button
              onClick={() => toggleSportDrawer(true)}
              className="md:pointer-events-none md:cursor-default"
              aria-label="Open sports navigation"
            >
              <span className="text-[22px] font-extrabold tracking-[-0.04em] text-slate-950">The Drip</span>
            </button>

            <nav className="hidden items-center gap-1 md:flex" aria-label="Sports">
              {HEADER_SPORTS.map(({ label, sport }) => {
                const isActive =
                  activeView !== 'LIVE' &&
                  ((sport === 'all' && (selectedSport as string) === 'all') || selectedSport === sport);

                return (
                  <button
                    key={label}
                    onClick={() => handleSportTab(sport)}
                    className={cn(
                      'rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/edge"
              className={cn(
                'hidden h-9 items-center rounded-md border px-3 text-[11px] font-semibold tracking-[0.08em] md:inline-flex',
                isEdgePage
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              EDGE
            </a>

            <button
              type="button"
              onClick={handleLiveClick}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-[11px] font-semibold tracking-[0.08em] transition-colors',
                activeView === 'LIVE'
                  ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              LIVE
              {hasActiveLiveGames ? <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" /> : null}
            </button>

            <div className="hidden md:block">
              <OddsLensToggle />
            </div>

            <button
              type="button"
              onClick={() => toggleCmdk()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Open search"
            >
              <Search size={16} />
            </button>

            <button
              type="button"
              onClick={() => toggleAuthModal(true)}
              className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
              aria-label={user ? 'Open account' : 'Open login'}
            >
              {user?.email?.[0]?.toUpperCase() ?? 'LOG IN'}
            </button>
          </div>
        </div>

        <div className="flex min-h-11 items-center justify-between gap-4 py-2">
          {activeView === 'FEED' ? (
            <>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setSelectedDate(-navStep)} className={navButtonClass} aria-label="Previous date">
                  <ChevronLeft size={16} />
                </button>

                <button type="button" className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-left hover:border-slate-300 hover:bg-slate-50">
                  <span className="text-[12px] font-semibold text-slate-900">{dateDisplay.label}</span>
                  {dateDisplay.isToday ? (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-600">
                      Today
                    </span>
                  ) : null}
                </button>

                <button type="button" onClick={() => setSelectedDate(navStep)} className={navButtonClass} aria-label="Next date">
                  <ChevronRight size={16} />
                </button>
              </div>

              <div ref={weekScrollRef} className="hidden items-center gap-1 md:flex">
                <span className="mr-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                  {dateDisplay.full}
                </span>
                {quickDates.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => handleWeekSelect(item.value)}
                    className="rounded px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          ) : activeView === 'LIVE' ? (
            <>
              <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">
                {(['LIVE', 'NEXT', 'ENDED'] as const).map((tab) => {
                  const isActive = liveTab === tab;
                  const label = tab === 'LIVE' ? 'Live' : tab === 'NEXT' ? 'Upcoming' : 'Completed';
                  return (
                    <button
                      key={tab}
                      onClick={() => setLiveTab(tab)}
                      className={cn(
                        'rounded px-3 py-1.5 text-[11px] font-medium transition-colors',
                        isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <label className="relative hidden md:block">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                  <input
                    type="text"
                    placeholder="Search live games"
                    value={liveFilter}
                    onChange={(e) => setLiveFilter(e.target.value)}
                    className="h-9 w-44 rounded-md border border-slate-200 bg-white pl-8 pr-3 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-slate-300 focus:outline-none"
                  />
                </label>

                <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">
                  <button
                    onClick={() => setLiveLayout('LIST')}
                    className={cn(
                      'inline-flex h-7 w-7 items-center justify-center rounded transition-colors',
                      liveLayout === 'LIST' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
                    )}
                    aria-label="List view"
                  >
                    <List size={14} />
                  </button>
                  <button
                    onClick={() => setLiveLayout('GRID')}
                    className={cn(
                      'inline-flex h-7 w-7 items-center justify-center rounded transition-colors',
                      liveLayout === 'GRID' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
                    )}
                    aria-label="Grid view"
                  >
                    <Grid3X3 size={14} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="h-7" />
          )}
        </div>
      </div>
    </header>
  );
};
