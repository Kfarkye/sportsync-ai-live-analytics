
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Sport, Match } from '../types';
import { getInitialSportContext, getInitialDateContext } from '../utils/matchUtils';

export type ViewType = 'FEED' | 'LIVE' | 'NBA' | 'TITAN';
export type LiveTabType = 'LIVE' | 'NEXT' | 'ENDED';
export type LiveLayoutType = 'LIST' | 'GRID';

interface AppState {
  // --- Selection State ---
  selectedSport: Sport;
  selectedDate: Date;
  selectedMatch: Match | null;
  activeView: ViewType;
  liveTab: LiveTabType;
  liveFilter: string;
  liveLayout: LiveLayoutType;

  // --- UI State (Modals) ---
  isCmdkOpen: boolean;
  isAuthModalOpen: boolean;
  isSportDrawerOpen: boolean;
  isPricingModalOpen: boolean;
  isRankingsDrawerOpen: boolean;
  isGlobalChatOpen: boolean;
  showLanding: boolean;

  // --- Actions ---
  setSelectedSport: (sport: Sport) => void;
  setSelectedDate: (date: Date | number) => void;
  setSelectedMatch: (match: Match | null) => void;
  setActiveView: (view: ViewType) => void;
  setLiveTab: (tab: LiveTabType) => void;
  setLiveFilter: (filter: string) => void;
  setLiveLayout: (layout: LiveLayoutType) => void;

  toggleCmdk: (open?: boolean) => void;
  toggleAuthModal: (open?: boolean) => void;
  toggleSportDrawer: (open?: boolean) => void;
  togglePricingModal: (open?: boolean) => void;
  toggleRankingsDrawer: (open?: boolean) => void;
  toggleGlobalChat: (open?: boolean) => void;
  setShowLanding: (show: boolean) => void;
  closeAllOverlays: () => void;
}

interface PinState {
  pinnedMatchIds: string[];
  togglePin: (id: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedSport: getInitialSportContext(),
      selectedDate: getInitialDateContext(),
      selectedMatch: null,
      activeView: 'FEED',
      liveTab: 'LIVE',
      liveFilter: '',
      liveLayout: 'LIST',

      isCmdkOpen: false,
      isAuthModalOpen: false,
      isSportDrawerOpen: false,
      isPricingModalOpen: false,
      isRankingsDrawerOpen: false,
      isGlobalChatOpen: false,
      showLanding: true,

      setSelectedSport: (sport) => set({ selectedSport: sport }),

      setSelectedDate: (payload) => set((state) => {
        if (typeof payload === 'number') {
          const next = new Date(state.selectedDate);
          next.setDate(next.getDate() + payload);
          return { selectedDate: next };
        }
        return { selectedDate: payload };
      }),

      setSelectedMatch: (match) => set({ selectedMatch: match }),
      setActiveView: (view) => set({ activeView: view }),
      setLiveTab: (tab) => set({ liveTab: tab }),
      setLiveFilter: (filter) => set({ liveFilter: filter }),
      setLiveLayout: (layout) => set({ liveLayout: layout }),

      toggleCmdk: (open) => set((s) => ({ isCmdkOpen: open ?? !s.isCmdkOpen })),
      toggleAuthModal: (open) => set((s) => ({ isAuthModalOpen: open ?? !s.isAuthModalOpen })),
      toggleSportDrawer: (open) => set((s) => ({ isSportDrawerOpen: open ?? !s.isSportDrawerOpen })),
      togglePricingModal: (open) => set((s) => ({ isPricingModalOpen: open ?? !s.isPricingModalOpen })),
      toggleRankingsDrawer: (open) => set((s) => ({ isRankingsDrawerOpen: open ?? !s.isRankingsDrawerOpen })),
      toggleGlobalChat: (open) => set((s) => ({ isGlobalChatOpen: open ?? !s.isGlobalChatOpen })),
      setShowLanding: (show) => set({ showLanding: show }),

      closeAllOverlays: () => set({
        isCmdkOpen: false,
        isAuthModalOpen: false,
        isSportDrawerOpen: false,
        isPricingModalOpen: false,
        isRankingsDrawerOpen: false,
        isGlobalChatOpen: false
      })
    }),
    {
      name: 'sharpedge_app_state_v1',
      partialize: (state) => ({
        selectedSport: state.selectedSport,
        // We don't persist selectedDate if it's "Today" by default, or maybe we do
        activeView: state.activeView,
        showLanding: state.showLanding
      })
    }
  )
);

export const usePinStore = create<PinState>()(
  persist(
    (set) => ({
      pinnedMatchIds: [],
      togglePin: (id) => set((state) => ({
        pinnedMatchIds: state.pinnedMatchIds.includes(id)
          ? state.pinnedMatchIds.filter(p => p !== id)
          : [...state.pinnedMatchIds, id]
      })),
    }),
    {
      name: 'drip_pins_v1',
    }
  )
);
