import React, { FC, lazy, Suspense, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore, usePinStore } from '../../store/appStore';
import { useMatches } from '../../hooks/useMatches';
import { UnifiedHeader } from './UnifiedHeader';
import MatchList from '../match/MatchList';

import LandingPage from './LandingPage';
import LiveDashboard from '../analysis/LiveDashboard';
import ChatWidget from '../ChatWidget';

import { isGameInProgress, isGameFinished } from '../../utils/matchUtils';
import { cn, ESSENCE } from '@/lib/essence';
import { ORDERED_SPORTS, SPORT_CONFIG, LEAGUES } from '@/constants';
import { Sport } from '@/types';
import { formatLocalDate } from '@/utils/dateUtils';
import { SLUG_TO_SPORT, SPORT_TO_SLUG, resolveSportFromPath } from '@/lib/sportSlugs';

const CommandPalette = lazy(() => import('../modals/CommandPalette'));
const AuthModal = lazy(() => import('../modals/AuthModal'));

const MobileSportDrawer = lazy(() => import('./MobileSportDrawer'));
const RankingsDrawer = lazy(() => import('../modals/RankingsDrawer'));
const TitanAnalytics = lazy(() => import('../../pages/TitanAnalytics'));

const MotionMain = motion.main;
const MotionDiv = motion.div;
type LiveSlateSport = Sport | 'all';
const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseDateParam = (raw: string | null): Date => {
  if (!raw || !DATE_PARAM_RE.test(raw)) return new Date();
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const AppShell: FC = () => {
  const navigate = useNavigate();
  const {
    activeView,
    selectedDate,
    selectedSport,
    selectedMatch,
    setSelectedMatch,
    setSelectedSport,
    showLanding,
    isCmdkOpen,
    isAuthModalOpen,
    isSportDrawerOpen,
    isRankingsDrawerOpen,
    isGlobalChatOpen,
    toggleCmdk,
    toggleAuthModal,
    toggleSportDrawer,
    toggleRankingsDrawer,
    toggleGlobalChat,
    setShowLanding,
    setSelectedDate,
    setActiveView,
    closeAllOverlays,
  } = useAppStore();

  const { pinnedMatchIds, togglePin } = usePinStore();
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const hasSlateQuery = useMemo(
    () => query.has('date') || query.has('view') || query.has('sport'),
    [query]
  );
  const urlDate = useMemo(() => parseDateParam(query.get('date')), [query]);
  const urlView = useMemo<'FEED' | 'LIVE'>(() => {
    const raw = (query.get('view') || '').toLowerCase();
    if (raw === 'live') return 'LIVE';
    if (location.pathname === '/live') return 'LIVE';
    return 'FEED';
  }, [query, location.pathname]);
  const urlSport = useMemo<LiveSlateSport>(() => {
    const fromPath = resolveSportFromPath(location.pathname);
    if (fromPath) return fromPath;
    const raw = (query.get('sport') || '').toLowerCase().trim();
    if (!raw || raw === 'all') return 'all';
    return SLUG_TO_SPORT[raw] ?? 'all';
  }, [location.pathname, query]);

  const buildLiveSlateHref = useCallback((overrides: Partial<{
    sport: LiveSlateSport;
    date: Date;
    view: 'FEED' | 'LIVE';
  }> = {}) => {
    const sport = overrides.sport ?? urlSport;
    const date = overrides.date ?? urlDate;
    const view = overrides.view ?? urlView;
    const params = new URLSearchParams();
    params.set('date', formatLocalDate(date));
    params.set('view', view === 'LIVE' ? 'live' : 'feed');

    let pathname = '/';
    if (sport !== 'all') {
      const slug = (SPORT_TO_SLUG[String(sport)] || '').toLowerCase();
      if (slug) pathname = `/${slug}`;
    }

    return `${pathname}?${params.toString()}`;
  }, [urlSport, urlDate, urlView]);

  // 1) Fetch data (date-filtered in hook)
  const { data: matches = [], isLoading } = useMatches(selectedDate);

  // 2) Client filter: sport only
  const filteredMatches = useMemo(() => {
    if (!matches.length) return [];
    const targetSport = (selectedSport || '').toLowerCase();

    return matches.filter((m) => {
      const matchSport = (m.sport || '').toLowerCase();
      return targetSport === 'all' || matchSport === targetSport || matchSport.includes(targetSport);
    });
  }, [matches, selectedSport]);

  const liveCountsBySport = useMemo(() => {
    const counts: Record<string, number> = {};
    matches.forEach((m) => {
      if (isGameInProgress(m.status)) counts[m.sport] = (counts[m.sport] || 0) + 1;
    });
    return counts;
  }, [matches]);

  const pinnedSet = useMemo(() => new Set<string>(pinnedMatchIds), [pinnedMatchIds]);
  const currentLeagueId = useMemo(() => LEAGUES.find((l) => l.sport === selectedSport)?.id || 'unknown', [selectedSport]);

  // Navigate to /game/:id instead of setting Zustand state directly.
  // This creates a real URL-based object surface.
  const handleSelectMatch = useCallback((match: import('@/types').Match | null) => {
    if (match) {
      navigate(`/game/${match.id}`);
    } else {
      setSelectedMatch(null);
    }
  }, [navigate, setSelectedMatch]);

  // Unique key to force animation when Date/Sport changes
  const viewKey = `feed-${new Date(selectedDate).toISOString().split('T')[0]}-${selectedSport}`;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCmdk();
      }
      if (e.key === 'Escape') {
        selectedMatch ? setSelectedMatch(null) : closeAllOverlays();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleCmdk, selectedMatch, setSelectedMatch, closeAllOverlays]);

  useEffect(() => {
    if (selectedSport !== urlSport) {
      setSelectedSport(urlSport as Sport);
    }

    const currentDateKey = formatLocalDate(selectedDate);
    const nextDateKey = formatLocalDate(urlDate);
    if (currentDateKey !== nextDateKey) {
      setSelectedDate(urlDate);
    }

    if (activeView !== urlView) {
      setActiveView(urlView);
    }
  }, [
    selectedSport,
    urlSport,
    selectedDate,
    urlDate,
    activeView,
    urlView,
    setSelectedSport,
    setSelectedDate,
    setActiveView,
  ]);

  useEffect(() => {
    if (location.pathname === '/live') {
      navigate(buildLiveSlateHref({ view: 'LIVE' }), { replace: true });
    }
  }, [location.pathname, navigate, buildLiveSlateHref]);

  useEffect(() => {
    const querySport = (query.get('sport') || '').toLowerCase().trim();
    if (!querySport) return;

    const mappedSport = querySport === 'all' ? 'all' : (SLUG_TO_SPORT[querySport] ?? null);
    if (!mappedSport) return;

    const canonicalHref = buildLiveSlateHref({ sport: mappedSport });
    const currentHref = `${location.pathname}${location.search}`;
    if (currentHref !== canonicalHref) {
      navigate(canonicalHref, { replace: true });
    }
  }, [query, location.pathname, location.search, navigate, buildLiveSlateHref]);

  useEffect(() => {
    if (showLanding && (location.pathname !== '/' || hasSlateQuery)) {
      setShowLanding(false);
    }
  }, [showLanding, location.pathname, hasSlateQuery, setShowLanding]);

  const shiftSlateDate = useCallback((days: number) => {
    const next = new Date(urlDate);
    next.setDate(next.getDate() + days);
    navigate(buildLiveSlateHref({ date: next }));
  }, [urlDate, navigate, buildLiveSlateHref]);

  const goToToday = useCallback(() => {
    navigate(buildLiveSlateHref({ date: new Date() }));
  }, [navigate, buildLiveSlateHref]);

  const handleSelectSportFromDrawer = useCallback((sport: LiveSlateSport) => {
    navigate(buildLiveSlateHref({ sport, view: 'FEED' }));
  }, [navigate, buildLiveSlateHref]);

  const shouldShowLanding = showLanding && location.pathname === '/' && !hasSlateQuery;

  if (shouldShowLanding) return <LandingPage onEnter={() => setShowLanding(false)} />;

  return (
    <div
      className={cn(
        // Layout
        'min-h-screen h-(--vvh,100vh) relative flex flex-col antialiased',
        // Yahoo-inspired shell surface
        'bg-[#FAFAF8] text-[#1A1A18] font-sans kalshi-shell',
        // selection rule
        'selection:bg-blue-300/30'
      )}
    >
      <UnifiedHeader />

      <MotionMain id="main-content" className="flex-1 w-full overflow-y-auto overscroll-contain">
        <div className="max-w-7xl mx-auto px-4 md:px-6 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3">
          <AnimatePresence mode="wait">
            {activeView === 'FEED' && (
              <MotionDiv
                key={viewKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                {/* LOADING STATE */}
                {isLoading && filteredMatches.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-24 opacity-80">
                    <div className="w-6 h-6 border-2 border-blue-200 border-t-[#0B63F6] rounded-full animate-spin mb-4" />
                    <p className={cn(ESSENCE.tier.t2Header, 'text-slate-500')}>Refreshing board</p>
                    <button
                      onClick={() => window.location.reload()}
                      className={cn('mt-6 px-4 py-1.5 rounded-full border border-blue-200 bg-white text-[10px] font-medium text-blue-700 hover:bg-blue-50 active:scale-95')}
                    >
                      Force Refresh
                    </button>
                  </div>
                )}

                {/* EMPTY STATE */}
                {!isLoading && filteredMatches.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <div className={cn('w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5', ESSENCE.tw.surface.subtle, ESSENCE.tw.border.default, 'shadow-sm')}>
                      <span className="text-2xl text-slate-400">📅</span>
                    </div>

                    <h3 className="text-xl font-bold text-slate-900 tracking-tight">
                      {new Date(selectedDate).toDateString() === new Date().toDateString() ? 'No live board right now' : 'No games on this date'}
                    </h3>

                    <p className="text-slate-600 text-[13px] mt-2 max-w-[280px] leading-relaxed">
                      Switch the date, then check Trends for pregame setups while you wait for tip-off.
                    </p>

                    <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                      <button
                        type="button"
                        onClick={goToToday}
                        className={cn(
                          ESSENCE.nav.pill,
                          'h-11 px-4',
                          'text-[10px] font-bold uppercase tracking-widest text-slate-600',
                          'hover:text-slate-900 hover:border-slate-300',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50',
                          'transition-all'
                        )}
                      >
                        Back to Today
                      </button>
                      <a
                        href="/trends"
                        className={cn(
                          ESSENCE.nav.pill,
                          'h-11 px-4 inline-flex items-center',
                          'text-[10px] font-bold uppercase tracking-widest text-slate-600',
                          'hover:text-slate-900 hover:border-slate-300'
                        )}
                      >
                        Open Trends
                      </a>
                    </div>
                  </div>
                )}

                {/* MATCH LIST */}
                {filteredMatches.length > 0 && (
                  <MatchList
                    matches={filteredMatches}
                    onSelectMatch={handleSelectMatch}
                    isLoading={isLoading}
                    pinnedMatchIds={pinnedSet}
                    onTogglePin={(id) => togglePin(id)}
                    isMatchLive={(m) => isGameInProgress(m.status)}
                    isMatchFinal={(m) => isGameFinished(m.status)}
                    onAdvanceDate={shiftSlateDate}
                  />
                )}
              </MotionDiv>
            )}

            {activeView === 'LIVE' && (
              <MotionDiv
                key="live"
                initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <LiveDashboard
                  matches={matches}
                  onSelectMatch={handleSelectMatch}
                  isMatchLive={(m) => isGameInProgress(m.status)}
                  pinnedMatchIds={pinnedSet}
                  onTogglePin={togglePin}
                />
              </MotionDiv>
            )}

            {activeView === 'TITAN' && (
              <MotionDiv
                key="titan"
                initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center py-24">
                      <div className="w-6 h-6 border-2 border-blue-200 border-t-[#0B63F6] rounded-full animate-spin" />
                    </div>
                  }
                >
                  <TitanAnalytics />
                </Suspense>
              </MotionDiv>
            )}
          </AnimatePresence>
        </div>

        {/* Global Legal & Responsibility Footer (inside scroll context) */}
        <footer className={cn('w-full border-t border-slate-200/80 bg-linear-to-b from-transparent to-[#EFF6FF]/80')}>
          <div className="max-w-7xl mx-auto px-7 py-9 md:py-10">
            <div className="flex flex-col items-center text-center gap-3 opacity-80">
              <span className="text-[11px] text-slate-600 max-w-2xl">
                Quantitative decision-support for entertainment only. Not financial advice.
              </span>
              <div className="flex items-center gap-3.5">
                <span className="font-mono text-[9.5px] text-slate-600 tracking-[0.04em]">21+</span>
                <span className="text-slate-300">·</span>
                <span className="font-mono text-[9.5px] text-slate-600 tracking-[0.04em]">1-800-GAMBLER</span>
              </div>
            </div>
          </div>
        </footer>
      </MotionMain>



      <ChatWidget currentMatch={selectedMatch ?? undefined} matches={filteredMatches} />
      {!isGlobalChatOpen && (
        <button
          type="button"
          onClick={() => toggleGlobalChat(true)}
          aria-label="Open chat"
          className="fixed right-3 md:right-8 bottom-[calc(env(safe-area-inset-bottom,0px)+10px)] md:bottom-8 z-[65] md:z-[9999] inline-flex items-center justify-center gap-2 h-10 md:h-auto w-10 md:w-auto md:px-4 md:py-2.5 rounded-full kalshi-fab text-slate-800 opacity-90 hover:opacity-100 transition-opacity"
        >
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="hidden md:inline text-[11px] font-semibold tracking-[0.05em] uppercase" style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
            Chat
          </span>
        </button>
      )}

      <Suspense fallback={null}>
        <CommandPalette isOpen={isCmdkOpen} onClose={() => toggleCmdk(false)} matches={matches} onSelect={handleSelectMatch} />
        <MobileSportDrawer
          isOpen={isSportDrawerOpen}
          onClose={() => toggleSportDrawer(false)}
          onSelect={handleSelectSportFromDrawer}
          selectedSport={selectedSport}
          liveCounts={liveCountsBySport}
          orderedSports={ORDERED_SPORTS}
          sportConfig={SPORT_CONFIG}
        />
        <RankingsDrawer isOpen={isRankingsDrawerOpen} onClose={() => toggleRankingsDrawer(false)} sport={selectedSport} leagueId={currentLeagueId} />
        <AuthModal isOpen={isAuthModalOpen} onClose={() => toggleAuthModal(false)} />

      </Suspense>
    </div>
  );
};

export default AppShell;
