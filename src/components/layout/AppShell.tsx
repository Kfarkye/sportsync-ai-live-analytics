import React, { FC, lazy, Suspense, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore, usePinStore } from '../../store/appStore';
import { useMatches } from '../../hooks/useMatches';
import { UnifiedHeader } from './UnifiedHeader';
import MatchList from '../match/MatchList';
import MatchDetails from '../match/MatchDetails';
import LandingPage from './LandingPage';
import LiveDashboard from '../analysis/LiveDashboard';
import ChatWidget from '../ChatWidget';
import { hasPersistedSportContext, isGameInProgress, isGameFinished } from '../../utils/matchUtils';
import { cn, ESSENCE } from '@/lib/essence';
import { ORDERED_SPORTS, SPORT_CONFIG, LEAGUES } from '@/constants';
import { Sport } from '@/types';

const CommandPalette = lazy(() => import('../modals/CommandPalette'));
const AuthModal = lazy(() => import('../modals/AuthModal'));
const PricingModal = lazy(() => import('../modals/PricingModal'));
const MobileSportDrawer = lazy(() => import('./MobileSportDrawer'));
const RankingsDrawer = lazy(() => import('../modals/RankingsDrawer'));
const TitanAnalytics = lazy(() => import('../../pages/TitanAnalytics'));

const MotionMain = motion.main;
const MotionDiv = motion.div;

const AppShell: FC = () => {
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
    isPricingModalOpen,
    isRankingsDrawerOpen,
    isGlobalChatOpen,
    toggleCmdk,
    toggleAuthModal,
    togglePricingModal,
    toggleSportDrawer,
    toggleRankingsDrawer,
    toggleGlobalChat,
    setShowLanding,
    setSelectedDate,
    closeAllOverlays,
  } = useAppStore();

  const { pinnedMatchIds, togglePin } = usePinStore();
  const [defaultSportResolved, setDefaultSportResolved] = React.useState(false);
  const persistedSportExists = React.useMemo(() => hasPersistedSportContext(), []);

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
    if (defaultSportResolved || persistedSportExists || isLoading) return;
    if (!matches.length) {
      setDefaultSportResolved(true);
      return;
    }

    const hasSoccerGames = matches.some((m) => String(m.sport).toUpperCase() === Sport.SOCCER);
    if (!hasSoccerGames && selectedSport === Sport.SOCCER) {
      setSelectedSport(Sport.NBA);
    }
    setDefaultSportResolved(true);
  }, [
    defaultSportResolved,
    persistedSportExists,
    isLoading,
    matches,
    selectedSport,
    setSelectedSport,
  ]);

  if (showLanding) return <LandingPage onEnter={() => setShowLanding(false)} />;

  return (
    <div
      className={cn(
        // Layout
        'min-h-screen h-(--vvh,100vh) relative flex flex-col antialiased',
        // Yahoo-inspired shell surface
        'bg-[#F4F6FF] text-slate-900 font-sans kalshi-shell',
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
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                {/* LOADING STATE */}
                {isLoading && filteredMatches.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-24 opacity-80">
                    <div className="w-6 h-6 border-2 border-blue-200 border-t-[#0B63F6] rounded-full animate-spin mb-4" />
                    <p className={cn(ESSENCE.tier.t2Header, 'text-slate-500')}>Syncing Sports Data</p>
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
                      {new Date(selectedDate).toDateString() === new Date().toDateString() ? 'No Games Today' : 'No Games Scheduled'}
                    </h3>

                    <p className="text-slate-600 text-[13px] mt-2 max-w-[220px] leading-relaxed">
                      Check back later or navigate to another date in the timeline.
                    </p>

                    <button
                      type="button"
                      onClick={() => setSelectedDate(new Date())}
                      className={cn(
                        ESSENCE.nav.pill,
                        'mt-5 px-4 py-2',
                        'text-[10px] font-bold uppercase tracking-widest text-slate-600',
                        'hover:text-slate-900 hover:border-slate-300',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50',
                        'transition-all'
                      )}
                    >
                      Back to Today
                    </button>
                  </div>
                )}

                {/* MATCH LIST */}
                {filteredMatches.length > 0 && (
                  <MatchList
                    matches={filteredMatches}
                    onSelectMatch={setSelectedMatch}
                    isLoading={isLoading}
                    pinnedMatchIds={pinnedSet}
                    onTogglePin={(id) => togglePin(id)}
                    isMatchLive={(m) => isGameInProgress(m.status)}
                    isMatchFinal={(m) => isGameFinished(m.status)}
                    onOpenPricing={() => togglePricingModal(true)}
                  />
                )}
              </MotionDiv>
            )}

            {activeView === 'LIVE' && (
              <MotionDiv
                key="live"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <LiveDashboard
                  matches={matches}
                  onSelectMatch={setSelectedMatch}
                  isMatchLive={(m) => isGameInProgress(m.status)}
                  pinnedMatchIds={pinnedSet}
                  onTogglePin={togglePin}
                />
              </MotionDiv>
            )}

            {activeView === 'TITAN' && (
              <MotionDiv
                key="titan"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
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

      <AnimatePresence>
        {selectedMatch && (
          <MotionDiv
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 350, mass: 1 }}
            className={cn(
              'fixed inset-0 z-[60] overflow-hidden flex flex-col',
              ESSENCE.tw.surface.subtle, // bg-slate-50
              'kalshi-shell'
            )}
          >
            {/* Sheet Handle for Mobile */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-slate-300 rounded-full z-[70] md:hidden" />
            <MatchDetails match={selectedMatch} matches={filteredMatches} onSelectMatch={setSelectedMatch} onBack={() => setSelectedMatch(null)} />
          </MotionDiv>
        )}
      </AnimatePresence>

      <ChatWidget currentMatch={selectedMatch ?? undefined} matches={filteredMatches} />
      {!isGlobalChatOpen && (
        <button
          type="button"
          onClick={() => toggleGlobalChat(true)}
          aria-label="Open AI chat"
          className="fixed right-3 md:right-8 bottom-[calc(env(safe-area-inset-bottom,0px)+10px)] md:bottom-8 z-[65] md:z-[9999] inline-flex items-center justify-center gap-2 h-10 md:h-auto w-10 md:w-auto md:px-4 md:py-2.5 rounded-full kalshi-fab text-slate-800 opacity-90 hover:opacity-100 transition-opacity"
        >
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="hidden md:inline text-[11px] font-semibold tracking-[0.05em] uppercase" style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
            AI Chat
          </span>
        </button>
      )}

      <Suspense fallback={null}>
        <CommandPalette isOpen={isCmdkOpen} onClose={() => toggleCmdk(false)} matches={matches} onSelect={setSelectedMatch} />
        <MobileSportDrawer
          isOpen={isSportDrawerOpen}
          onClose={() => toggleSportDrawer(false)}
          onSelect={setSelectedSport}
          selectedSport={selectedSport}
          liveCounts={liveCountsBySport}
          orderedSports={ORDERED_SPORTS}
          sportConfig={SPORT_CONFIG}
        />
        <RankingsDrawer isOpen={isRankingsDrawerOpen} onClose={() => toggleRankingsDrawer(false)} sport={selectedSport} leagueId={currentLeagueId} />
        <AuthModal isOpen={isAuthModalOpen} onClose={() => toggleAuthModal(false)} />
        <PricingModal isOpen={isPricingModalOpen} onClose={() => togglePricingModal(false)} />
      </Suspense>
    </div>
  );
};

export default AppShell;
