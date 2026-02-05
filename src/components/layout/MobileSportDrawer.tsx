
import React, { useMemo } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { Sport } from '@/types';

const MotionDiv = motion.div;

type SportFilter = Sport | 'all';

interface MobileSportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (sport: SportFilter) => void;
  selectedSport: SportFilter;
  liveCounts: Record<string, number>;
  orderedSports: Sport[];
  sportConfig: Record<string, { label: string; icon: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DESIGN SYSTEM - Pure Typography, Black Glassmorphism
// ═══════════════════════════════════════════════════════════════════════════════

const SPORT_CATEGORIES: Record<string, string[]> = {
  'Pro Leagues': ['NFL', 'NBA', 'BASEBALL', 'HOCKEY', 'WNBA'],
  'College': ['COLLEGE_FOOTBALL', 'COLLEGE_BASKETBALL'],
  'Global': ['SOCCER', 'MMA', 'TENNIS', 'GOLF']
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

const SportCard: React.FC<{
  sport: SportFilter;
  config: { label: string; icon: string };
  isSelected: boolean;
  liveCount: number;
  onSelect: () => void;
}> = ({ config, isSelected, liveCount, onSelect }) => {

  return (
    <motion.button
      onClick={onSelect}
      whileTap={{ scale: 0.98 }}
      className="relative w-full text-left group"
    >
      {/* Black Glass Card */}
      <div className={`
                relative overflow-hidden rounded-2xl transition-all duration-300
                ${isSelected
          ? 'bg-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]'
          : 'bg-white/[0.02] hover:bg-white/[0.04] shadow-[0_2px_8px_rgba(0,0,0,0.2)]'
        }
                border border-white/[0.04]
                backdrop-blur-xl
            `}>
        {/* Content */}
        <div className="relative flex items-center justify-between px-5 py-4">
          <div className="flex flex-col">
            {/* League Name - Primary Typography */}
            <span className={`
                            text-[17px] font-semibold tracking-[-0.02em] transition-all duration-200
                            ${isSelected
                ? 'text-white'
                : 'text-zinc-300 group-hover:text-white'
              }
                        `}>
              {config.label}
            </span>

            {/* Live Count - Secondary */}
            {liveCount > 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`
                                    w-1.5 h-1.5 rounded-full animate-pulse
                                    ${isSelected ? 'bg-white' : 'bg-rose-500'}
                                `} />
                <span className={`
                                    text-[11px] font-medium tracking-wide
                                    ${isSelected ? 'text-white/70' : 'text-zinc-500'}
                                `}>
                  {liveCount} live
                </span>
              </div>
            )}
          </div>

          {/* Selection Indicator */}
          <AnimatePresence mode="wait">
            {isSelected && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", bounce: 0.4, duration: 0.4 }}
                className="w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-[0_4px_12px_rgba(255,255,255,0.2)]"
              >
                <Check size={12} strokeWidth={3} className="text-black" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Subtle bottom highlight for selected */}
        {isSelected && (
          <div className="absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        )}
      </div>
    </motion.button>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const MobileSportDrawer: React.FC<MobileSportDrawerProps> = ({
  isOpen,
  onClose,
  onSelect,
  selectedSport,
  liveCounts,
  orderedSports,
  sportConfig
}) => {
  // Group sports by category
  const groupedSports = useMemo(() => {
    const groups: { category: string; sports: Sport[] }[] = [];

    Object.entries(SPORT_CATEGORIES).forEach(([category, sportKeys]) => {
      const sportsInCategory = orderedSports.filter(s => sportKeys.includes(s));
      if (sportsInCategory.length > 0) {
        groups.push({ category, sports: sportsInCategory });
      }
    });

    // Add any remaining sports
    const categorizedSports = Object.values(SPORT_CATEGORIES).flat();
    const uncategorized = orderedSports.filter(s => !categorizedSports.includes(s));
    if (uncategorized.length > 0) {
      groups.push({ category: 'Other', sports: uncategorized });
    }

    return groups;
  }, [orderedSports]);

  // Calculate total live
  const totalLive = useMemo(() =>
    Object.values(liveCounts).reduce((a, b) => a + b, 0),
    [liveCounts]);

  const onDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop - Deep Black */}
          <MotionDiv
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[100]"
            aria-hidden="true"
          />

          {/* Drawer - Black Glassmorphism */}
          <MotionDiv
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{
              type: "spring",
              damping: 34,
              stiffness: 400,
              mass: 0.8
            }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.05}
            onDragEnd={onDragEnd}
            className="fixed bottom-0 left-0 right-0 z-[101] flex flex-col max-h-[88vh] rounded-t-[24px] overflow-hidden"
            style={{
              background: 'linear-gradient(180deg, rgba(12,12,12,0.98) 0%, rgba(0,0,0,0.99) 100%)',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              boxShadow: '0 -24px 80px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.04)'
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Select League"
          >
            {/* Handle */}
            <div className="w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
              <div className="w-8 h-1 bg-white/10 rounded-full" />
            </div>

            {/* Header - Pure Typography */}
            <div className="px-6 pt-2 pb-5">
              <h2 className="text-[28px] font-bold text-white tracking-[-0.03em] leading-none">
                Leagues
              </h2>
              {totalLive > 0 && (
                <p className="text-[13px] text-zinc-500 font-medium mt-2 tracking-[-0.01em]">
                  {totalLive} games in progress
                </p>
              )}
            </div>

            {/* Close Button - Minimal */}
            <button
              onClick={onClose}
              className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center bg-white/[0.04] hover:bg-white/[0.08] rounded-full text-zinc-500 hover:text-white transition-all duration-200 border border-white/[0.04]"
            >
              <X size={16} strokeWidth={2} />
            </button>

            {/* Scrollable Content */}
            <div className="overflow-y-auto px-4 pb-12 flex-1 custom-scrollbar">
              <div className="space-y-8">
                {/* GLOBAL ALL SPORTS OPTION */}
                <div>
                  <div className="flex items-center gap-3 px-1 mb-3">
                    <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-[0.12em]">
                      Universe
                    </span>
                    <div className="flex-1 h-px bg-white/[0.03]" />
                  </div>
                  <SportCard
                    sport={'all'}
                    config={{ label: 'All Sports', icon: '🌎' }}
                    isSelected={selectedSport === 'all'}
                    liveCount={totalLive}
                    onSelect={() => {
                      onSelect('all');
                      onClose();
                    }}
                  />
                </div>

                {groupedSports.map(({ category, sports }) => (
                  <div key={category}>
                    {/* Category Label - Subtle Typography */}
                    <div className="flex items-center gap-3 px-1 mb-3">
                      <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-[0.12em]">
                        {category}
                      </span>
                      <div className="flex-1 h-px bg-white/[0.03]" />
                    </div>

                    {/* Sport Cards */}
                    <div className="space-y-2">
                      {sports.map((sport) => {
                        const config = sportConfig[sport];
                        if (!config) return null;

                        return (
                          <SportCard
                            key={sport}
                            sport={sport}
                            config={config}
                            isSelected={selectedSport === sport}
                            liveCount={liveCounts[sport] || 0}
                            onSelect={() => {
                              onSelect(sport);
                              onClose();
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Safe Area */}
              <div className="h-safe-bottom" />
            </div>
          </MotionDiv>
        </>
      )}
    </AnimatePresence>
  );
};

export default MobileSportDrawer;
