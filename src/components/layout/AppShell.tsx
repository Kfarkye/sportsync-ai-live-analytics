import React, { FC, lazy, Suspense, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore, usePinStore } from '../../store/appStore';
import { useMatches } from '../../hooks/useMatches';
import { UnifiedHeader } from './UnifiedHeader';
import { MobileNavBar } from './MobileNavBar';
import MatchList from '../match/MatchList';
import MatchDetails from '../match/MatchDetails';
import ChatWidget from '../ChatWidget';
import LandingPage from './LandingPage';
import LiveDashboard from '../analysis/LiveDashboard';
import { isGameInProgress, isGameFinished } from '../../utils/matchUtils';
import { LAYOUT, ORDERED_SPORTS, SPORT_CONFIG, LEAGUES } from '@/constants';
import { useOfflineCache } from '../../hooks/useOfflineCache';
import { useNetworkResilience } from '../../hooks/useNetworkResilience';
import { usePullToRefresh } from '../../hooks/useMobileGestures';
import { useAddToHomescreen } from '../../hooks/useAddToHomescreen';

const CommandPalette = lazy(() => import('../modals/CommandPalette'));
const AuthModal = lazy(() => import('../modals/AuthModal'));
const PricingModal = lazy(() => import('../modals/PricingModal'));
const MobileSportDrawer = lazy(() => import('./MobileSportDrawer'));
const RankingsDrawer = lazy(() => import('../modals/RankingsDrawer'));
const TitanAnalytics = lazy(() => import('../../pages/TitanAnalytics'));

const MotionMain = motion.main;
const MotionDiv = motion.div;

// Skeleton card for loading state
const MatchRowSkeleton = () => (
  <div className="w-full h-[72px] border-b border-white/[0.06] flex items-center animate-pulse">
    <div className="flex-1 px-5 flex flex-col gap-3 py-4">
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 bg-white/5 rounded-full" />
        <div className="h-3 w-28 bg-white/5 rounded" />
      </div>
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 bg-white/5 rounded-full" />
        <div className="h-3 w-24 bg-white/5 rounded" />
      </div>
    </div>
    <div className="w-[80px] h-full flex items-center justify-center">
      <div className="h-3 w-12 bg-white/5 rounded" />
    </div>
  </div>
);

const AppShell: FC = () => {
  const {
    activeView, selectedDate, selectedSport, selectedMatch,
    setSelectedMatch, setSelectedSport, showLanding, isCmdkOpen,
    isAuthModalOpen, isSportDrawerOpen,
    isPricingModalOpen, isRankingsDrawerOpen, toggleCmdk,
    toggleAuthModal, togglePricingModal,
    toggleSportDrawer, toggleRankingsDrawer, setShowLanding,
    closeAllOverlays
  } = useAppStore();

  const { pinnedMatchIds, togglePin } = usePinStore();

  // 1. Fetch Data
  const { data: matches = [], isLoading, refetch } = useMatches(selectedDate);

  // 2. Offline cache
  const { updateCache, cachedMatches, cacheAge, hasCachedData } = useOfflineCache();
  const { online, quality, reconnecting } = useNetworkResilience();

  // Update cache when fresh data arrives
  useEffect(() => {
    if (matches.length > 0 && online) {
      updateCache(matches);
    }
  }, [matches, online, updateCache]);

  // Use cached data when offline
  const effectiveMatches = online && matches.length > 0 ? matches : (hasCachedData ? cachedMatches : matches);

  // 3. Pull-to-refresh
  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const { pulling, refreshing, pullDistance, scrollRef, handlers: ptrHandlers } = usePullToRefresh({
    onRefresh: handleRefresh,
  });

  // 4. Add-to-homescreen
  const { canPrompt, promptInstall, dismiss: dismissA2HS } = useAddToHomescreen();

  // 5. Client-Side Filter by sport
  const filteredMatches = useMemo(() => {
    if (!effectiveMatches.length) return [];
    const targetSport = (selectedSport || '').toLowerCase();
    return effectiveMatches.filter((m) => {
      const matchSport = (m.sport || '').toLowerCase();
      return targetSport === 'all' || matchSport === targetSport || matchSport.includes(targetSport);
    });
  }, [effectiveMatches, selectedSport]);

  const liveCountsBySport = useMemo(() => {
    const counts: Record<string, number> = {};
    effectiveMatches.forEach((m) => {
      if (isGameInProgress(m.status)) counts[m.sport] = (counts[m.sport] || 0) + 1;
    });
    return counts;
  }, [effectiveMatches]);

  const pinnedSet = useMemo(() => new Set<string>(pinnedMatchIds), [pinnedMatchIds]);
  const currentLeagueId = useMemo(() => LEAGUES.find(l => l.sport === selectedSport)?.id || 'unknown', [selectedSport]);

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
    <div className="min-h-screen h-screen bg-[#09090B] text-[#FAFAFA] font-sans selection:bg-[#0A84FF]/30 relative flex flex-col antialiased">
      <UnifiedHeader reconnecting={reconnecting || !online} />

      {/* Offline Banner */}
      {!online && (
        <div className="sticky top-[100px] z-30 mx-4 mb-2">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-[11px] font-semibold text-amber-400">
              Offline — showing cached data{cacheAge > 0 ? ` (${cacheAge}m ago)` : ''}
            </span>
          </div>
        </div>
      )}

      {/* Pull-to-refresh indicator */}
      {(pulling || refreshing) && (
        <div
          className="flex items-center justify-center transition-all duration-200"
          style={{ height: pullDistance, minHeight: pulling ? 20 : 0 }}
        >
          <div className={`w-5 h-5 border-2 border-white/20 border-t-white/80 rounded-full ${refreshing ? 'animate-spin' : ''}`}
            style={{ transform: !refreshing ? `rotate(${pullDistance * 3}deg)` : undefined }}
          />
        </div>
      )}

      <MotionMain
        className="flex-1 w-full overflow-y-auto"
        ref={scrollRef as React.RefObject<HTMLElement>}
        {...ptrHandlers}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-6 pb-32">
          <AnimatePresence mode="wait">
            {activeView === 'FEED' && (
              <MotionDiv
                key={viewKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                {/* LOADING STATE — Skeleton cards, no layout shift */}
                {isLoading && filteredMatches.length === 0 && (
                  <div className="pt-4">
                    {[1, 2, 3, 4, 5, 6].map(i => <MatchRowSkeleton key={i} />)}
                  </div>
                )}

                {/* EMPTY STATE */}
                {!isLoading && filteredMatches.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <div className="text-4xl mb-6 grayscale filter contrast-50 opacity-20">📅</div>
                    <h3 className="text-xl font-bold text-white tracking-tight">
                      {new Date(selectedDate).toDateString() === new Date().toDateString() ? 'No Games Today' : 'No Games Scheduled'}
                    </h3>
                    <p className="text-zinc-500 text-[13px] mt-2 max-w-[200px] leading-relaxed">
                      Check back later or navigate to another date in the timeline.
                    </p>
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
                <LiveDashboard matches={effectiveMatches} onSelectMatch={setSelectedMatch} isMatchLive={(m) => isGameInProgress(m.status)} pinnedMatchIds={pinnedSet} onTogglePin={togglePin} />
              </MotionDiv>
            )}

            {activeView === 'TITAN' && (
              <MotionDiv key="titan" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="w-6 h-6 border-2 border-white/20 border-t-emerald-500 rounded-full animate-spin" /></div>}>
                  <TitanAnalytics />
                </Suspense>
              </MotionDiv>
            )}
          </AnimatePresence>
        </div>
      </MotionMain>

      <MobileNavBar />

      {/* Add-to-Homescreen Prompt (shows after 3rd visit) */}
      {canPrompt && (
        <div className="fixed bottom-24 left-4 right-4 z-[50] animate-in slide-in-from-bottom">
          <div className="bg-[#111113] border border-white/10 rounded-2xl p-4 shadow-deep flex items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">Add The Drip to Home Screen</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">Instant access, offline support</p>
            </div>
            <button onClick={promptInstall} className="px-4 py-2 bg-white text-black text-[11px] font-bold uppercase tracking-wider rounded-full active:scale-95 transition-transform">
              Add
            </button>
            <button onClick={dismissA2HS} className="text-zinc-600 text-xs font-medium">
              Later
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {selectedMatch && (
          <MotionDiv
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 350, mass: 1 }}
            className="fixed inset-0 z-[60] bg-[#09090B] overflow-hidden flex flex-col"
          >
            {/* Sheet Handle for Mobile */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-white/10 rounded-full z-[70] md:hidden" />
            <MatchDetails
              match={selectedMatch}
              matches={filteredMatches}
              onSelectMatch={setSelectedMatch}
              onBack={() => setSelectedMatch(null)}
            />
          </MotionDiv>
        )}
      </AnimatePresence>

      <ChatWidget currentMatch={selectedMatch} matches={effectiveMatches} />

      {/* Legal Footer */}
      <footer className="w-full max-w-7xl mx-auto px-6 py-12 border-t border-white/5 opacity-40">
        <div className="flex flex-col items-center text-center space-y-4">
          <p className="text-[10px] font-medium leading-relaxed max-w-2xl text-zinc-400">
            SportSync AI provides a quantitative decision-support environment for entertainment purposes only.
            We are not a sportsbook and do not provide financial advice or guarantee outcome success.
            Analytical confidence levels represent model weights, not mathematical probability of real-world results.
          </p>
          <div className="flex items-center gap-6 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
            <span>Must be 21+</span>
            <span className="w-1 h-1 rounded-full bg-zinc-800" />
            <span>Problem? 1-800-GAMBLER</span>
          </div>
        </div>
      </footer>

      <Suspense fallback={null}>
        <CommandPalette isOpen={isCmdkOpen} onClose={() => toggleCmdk(false)} matches={effectiveMatches} onSelect={setSelectedMatch} />
        <MobileSportDrawer isOpen={isSportDrawerOpen} onClose={() => toggleSportDrawer(false)} onSelect={setSelectedSport} selectedSport={selectedSport} liveCounts={liveCountsBySport} orderedSports={ORDERED_SPORTS} sportConfig={SPORT_CONFIG} />
        <RankingsDrawer isOpen={isRankingsDrawerOpen} onClose={() => toggleRankingsDrawer(false)} sport={selectedSport} leagueId={currentLeagueId} />
        <AuthModal isOpen={isAuthModalOpen} onClose={() => toggleAuthModal(false)} />
        <PricingModal isOpen={isPricingModalOpen} onClose={() => togglePricingModal(false)} />
      </Suspense>
    </div>
  );
};

export default AppShell;
