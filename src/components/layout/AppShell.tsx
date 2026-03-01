import React, { FC, lazy, Suspense, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore, usePinStore } from '../../store/appStore';
import { useMatches } from '../../hooks/useMatches';
import { UnifiedHeader } from './UnifiedHeader';
import MatchList from '../match/MatchList';
import MatchDetails from '../match/MatchDetails';
import ChatWidget from '../ChatWidget';
import LandingPage from './LandingPage';
import LiveDashboard from '../analysis/LiveDashboard';
import { isGameInProgress, isGameFinished } from '../../utils/matchUtils';
import { cn } from '@/lib/essence';
import { ORDERED_SPORTS, SPORT_CONFIG, LEAGUES } from '@/constants';

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
    activeView, selectedDate, selectedSport, selectedMatch,
    setSelectedMatch, setSelectedSport, showLanding, isCmdkOpen,
    isAuthModalOpen, isSportDrawerOpen,
    isPricingModalOpen, isRankingsDrawerOpen, isGlobalChatOpen, toggleCmdk,
    toggleAuthModal, togglePricingModal,
    toggleSportDrawer, toggleRankingsDrawer, setShowLanding,
    setSelectedDate,
    closeAllOverlays
  } = useAppStore();

  const { pinnedMatchIds, togglePin } = usePinStore();

  // 1. Fetch Data (Filtered strictly by the Hook now)
  const { data: matches = [], isLoading } = useMatches(selectedDate);

  // 2. Client-Side Filter: Only filter by SPORT
  // We REMOVED the strict Date check to prevent the "Double Filtering" bug.
  const filteredMatches = useMemo(() => {
    if (!matches.length) return [];

    const targetSport = (selectedSport || '').toLowerCase();

    return matches.filter((m) => {
      const matchSport = (m.sport || '').toLowerCase();
      // Simple Sport Check
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
  const currentLeagueId = useMemo(() => LEAGUES.find(l => l.sport === selectedSport)?.id || 'unknown', [selectedSport]);

  // Unique key to force animation when Date/Sport changes
  // We use the raw ISO string slice to be consistent
  const viewKey = `feed-${new Date(selectedDate).toISOString().split('T')[0]}-${selectedSport}`;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); toggleCmdk(); }
      if (e.key === 'Escape') { selectedMatch ? setSelectedMatch(null) : closeAllOverlays(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleCmdk, selectedMatch, setSelectedMatch, closeAllOverlays]);

  if (showLanding) return <LandingPage onEnter={() => setShowLanding(false)} />;

  return (
    <div className="min-h-screen h-[var(--vvh,100vh)] bg-zinc-100 text-zinc-900 font-sans selection:bg-zinc-900/10 relative flex flex-col antialiased">
      <UnifiedHeader />

      <MotionMain
        id="main-content"
        className="flex-1 w-full overflow-y-auto overscroll-contain"
      >
        <div className="max-w-7xl mx-auto px-4 md:px-6 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
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
                  <div className="flex flex-col items-center justify-center py-24 opacity-70">
                    <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin mb-4" />
                    <p className="text-[11px] font-bold tracking-[0.2em] text-slate-500 uppercase">Syncing Sports Data</p>
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-6 px-4 py-1.5 rounded-full border border-slate-200 text-[10px] font-medium text-slate-500 hover:bg-slate-100 active:scale-95 transition-all"
                    >
                      Force Refresh
                    </button>
                  </div>
                )}

                {/* EMPTY STATE */}
                {!isLoading && filteredMatches.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <div className="w-14 h-14 bg-white border border-slate-200 rounded-full flex items-center justify-center mx-auto mb-5 shadow-sm">
                      <span className="text-2xl text-slate-400">📅</span>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 tracking-tight">
                      {new Date(selectedDate).toDateString() === new Date().toDateString() ? 'No Games Today' : 'No Games Scheduled'}
                    </h3>
                    <p className="text-slate-500 text-[13px] mt-2 max-w-[200px] leading-relaxed">
                      Check back later or navigate to another date in the timeline.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedDate(new Date())}
                      className="mt-5 px-4 py-2 rounded-full border border-zinc-200 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-900 hover:border-zinc-300 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-100"
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
                    onTogglePin={(id, e) => togglePin(id)}
                    isMatchLive={(m) => isGameInProgress(m.status)}
                    isMatchFinal={(m) => isGameFinished(m.status)}
                    onOpenPricing={() => togglePricingModal(true)}
                  />
                )}
              </MotionDiv>
            )}


            {activeView === 'LIVE' && (
              <MotionDiv key="live" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                <LiveDashboard matches={matches} onSelectMatch={setSelectedMatch} isMatchLive={(m) => isGameInProgress(m.status)} pinnedMatchIds={pinnedSet} onTogglePin={togglePin} />
              </MotionDiv>
            )}

            {activeView === 'TITAN' && (
              <MotionDiv key="titan" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="w-6 h-6 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin" /></div>}>
                  <TitanAnalytics />
                </Suspense>
              </MotionDiv>
            )}


          </AnimatePresence>
        </div>

        {/* Global Legal & Responsibility Footer (inside scroll context) */}
        <footer className="w-full border-t border-zinc-200 bg-gradient-to-b from-transparent to-zinc-50/80">
          <div className="max-w-7xl mx-auto px-7 py-9 md:py-10">
            <div className="flex flex-col items-center text-center gap-3 opacity-70">
              <span className="text-[11px] text-zinc-500 max-w-2xl">
                Quantitative decision-support for entertainment only. Not financial advice.
              </span>
              <div className="flex items-center gap-3.5">
                <span className="font-mono text-[9.5px] text-zinc-500 tracking-[0.04em]">21+</span>
                <span className="text-zinc-300">·</span>
                <span className="font-mono text-[9.5px] text-zinc-500 tracking-[0.04em]">1-800-GAMBLER</span>
              </div>
            </div>
          </div>
        </footer>
      </MotionMain>

      <AnimatePresence>
        {selectedMatch && (
          <MotionDiv
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 350, mass: 1 }}
            className="fixed inset-0 z-[60] bg-slate-50 overflow-hidden flex flex-col"
          >
            {/* Sheet Handle for Mobile */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-slate-300 rounded-full z-[70] md:hidden" />
            <MatchDetails
              match={selectedMatch}
              matches={filteredMatches}
              onSelectMatch={setSelectedMatch}
              onBack={() => setSelectedMatch(null)}
            />
          </MotionDiv>
        )}
      </AnimatePresence>

      {/* Desktop AI FAB — only visible on md+ when chat is closed */}
      {!selectedMatch && (
        <button
          onClick={() => useAppStore.getState().toggleGlobalChat()}
          className={cn(
            "fixed bottom-5 right-5 z-50 hidden md:flex items-center justify-center",
            "w-11 h-11 rounded-xl transition-all active:scale-90",
            "bg-zinc-900 text-white shadow-lg shadow-zinc-900/20 hover:bg-zinc-800",
            isGlobalChatOpen && "rotate-45"
          )}
          aria-label={isGlobalChatOpen ? 'Close AI' : 'Open AI Analysis'}
        >
          {isGlobalChatOpen ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4L12 12M12 4L4 12"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <path d="M9 1L11.5 6.5L17 9L11.5 11.5L9 17L6.5 11.5L1 9L6.5 6.5L9 1Z" fill="currentColor" opacity="0.85"/>
            </svg>
          )}
        </button>
      )}

      <ChatWidget currentMatch={selectedMatch} matches={matches} />

      <Suspense fallback={null}>
        <CommandPalette isOpen={isCmdkOpen} onClose={() => toggleCmdk(false)} matches={matches} onSelect={setSelectedMatch} />
        <MobileSportDrawer isOpen={isSportDrawerOpen} onClose={() => toggleSportDrawer(false)} onSelect={setSelectedSport} selectedSport={selectedSport} liveCounts={liveCountsBySport} orderedSports={ORDERED_SPORTS} sportConfig={SPORT_CONFIG} />
        <RankingsDrawer isOpen={isRankingsDrawerOpen} onClose={() => toggleRankingsDrawer(false)} sport={selectedSport} leagueId={currentLeagueId} />
        <AuthModal isOpen={isAuthModalOpen} onClose={() => toggleAuthModal(false)} />
        <PricingModal isOpen={isPricingModalOpen} onClose={() => togglePricingModal(false)} />
      </Suspense>
    </div >
  );
};

export default AppShell;
