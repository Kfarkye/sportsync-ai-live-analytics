import React, { useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import { Sport } from '@/types';
import { ESSENCE } from '@/lib/essence';

const MotionDiv = motion.div;

type SportFilter = Sport | 'all';

interface MobileSportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (sport: SportFilter) => void;
  selectedSport: SportFilter;
  liveCounts: Record<string, number>;
  orderedSports: Sport[];
  sportConfig: Record<string, { label: string; icon?: string }>; // Icon structurally ignored
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORIES: { label: string; keys: string[] }[] = [
  { label: 'Pro', keys: ['NFL', 'NBA', 'BASEBALL', 'HOCKEY', 'WNBA'] },
  { label: 'College', keys: ['COLLEGE_FOOTBALL', 'COLLEGE_BASKETBALL'] },
  { label: 'Global', keys: ['SOCCER', 'MMA', 'TENNIS', 'GOLF'] },
];

// Heavier, luxurious spring physics (feels like sliding a physical pane of glass)
const SHEET_SPRING = { type: 'spring' as const, damping: 36, stiffness: 380, mass: 1.1 };
const TAP_SPRING = { duration: 0.1, ease: 'easeOut' };
const CHECK_SPRING = { type: 'spring' as const, stiffness: 500, damping: 32, mass: 0.4 };

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE INDICATOR
// A static, piercing emerald diode paired with rigid tabular numbers. 
// ═══════════════════════════════════════════════════════════════════════════════

const LivePulse: React.FC<{ count: number; isSelected: boolean }> = ({ count, isSelected }) => (
  <span className="inline-flex items-center gap-2" aria-label={`${count} active events`}>
    <span
      className="rounded-full flex-shrink-0"
      style={{
        width: 6,
        height: 6,
        backgroundColor: isSelected ? '#34D399' : '#00D395', // Kalshi Signature Green
        boxShadow: isSelected ? '0 0 8px rgba(52, 211, 153, 0.4)' : 'none',
      }}
    />
    <span
      className="font-medium"
      style={{
        fontSize: 13,
        color: isSelected ? 'rgba(255,255,255,0.7)' : '#8E8E93',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.01em',
      }}
    >
      {count}
    </span>
  </span>
);

// ═══════════════════════════════════════════════════════════════════════════════
// SPORT ROW
// 56px height. Absolute edge-to-edge flush. Pure typography.
// ═══════════════════════════════════════════════════════════════════════════════

const SportRow: React.FC<{
  label: string;
  isSelected: boolean;
  liveCount: number;
  onSelect: () => void;
}> = ({ label, isSelected, liveCount, onSelect }) => {
  return (
    <motion.button
      onClick={onSelect}
      whileTap={{ backgroundColor: isSelected ? '#000000' : '#F2F2F7' }}
      transition={TAP_SPRING}
      className="relative w-full flex items-center justify-between text-left outline-none"
      style={{
        padding: '0 20px',
        height: 56, // Upgraded to 56px for ultimate touch luxury
        backgroundColor: isSelected ? '#000000' : '#FFFFFF',
        transition: 'background-color 0.15s ease-out',
        zIndex: isSelected ? 10 : 1, // Elevate selected item over the group canvas
      }}
      role="option"
      aria-selected={isSelected}
    >
      <span
        className="font-medium truncate transition-colors duration-200"
        style={{
          fontSize: 17, // Classic iOS body size
          fontWeight: isSelected ? 600 : 500, // Typographic hierarchy shift
          letterSpacing: '-0.02em',
          color: isSelected ? '#FFFFFF' : '#111111',
        }}
      >
        {label}
      </span>

      <span className="flex items-center gap-4 flex-shrink-0">
        {liveCount > 0 && <LivePulse count={liveCount} isSelected={isSelected} />}

        {/* Brutalist 2.5px checkmark stroke. Geometric and confident. */}
        <div style={{ width: 14, display: 'flex', justifyContent: 'center' }}>
          <AnimatePresence mode="wait">
            {isSelected && (
              <motion.svg
                key="check"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={CHECK_SPRING}
                width="14" height="14" viewBox="0 0 16 16" fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2.5 8.5L6 12L13.5 3.5"
                  stroke="#FFFFFF"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </motion.svg>
            )}
          </AnimatePresence>
        </div>
      </span>
    </motion.button>
  );
};

// True Retina 0.5px hairline separator. 
// Uses a scale transform because standard '0.5px' height doesn't render consistently across devices.
const Separator: React.FC<{ hidden?: boolean }> = ({ hidden }) => (
  <div
    style={{
      marginLeft: 20,
      height: 1,
      backgroundColor: hidden ? 'transparent' : 'rgba(0,0,0,0.08)',
      transform: 'scaleY(0.5)',
      transformOrigin: 'bottom',
      transition: 'background-color 0.15s ease-out'
    }}
  />
);

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
  sportConfig,
}) => {
  // ── Handlers ────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const groups = useMemo(() =>
    CATEGORIES
      .map(({ label, keys }) => ({
        label,
        sports: orderedSports.filter(s => keys.includes(s)),
      }))
      .filter(g => g.sports.length > 0),
    [orderedSports],
  );

  const totalLive = useMemo(
    () => Object.values(liveCounts).reduce((a, b) => a + b, 0),
    [liveCounts],
  );

  const pick = useCallback(
    (sport: SportFilter) => { onSelect(sport); onClose(); },
    [onSelect, onClose],
  );

  const onDragEnd = useCallback(
    (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.y > 100 || info.velocity.y > 500) onClose();
    },
    [onClose],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ── Scrim ────────────────────────────────────────── */}
          <MotionDiv
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
            onClick={onClose}
            className="fixed inset-0 z-[100]"
            style={{
              backgroundColor: 'rgba(0,0,0,0.3)',
              backdropFilter: 'blur(16px)',       // Deep cinematic glass blur
              WebkitBackdropFilter: 'blur(16px)',
            }}
            aria-hidden="true"
          />

          {/* ── Sheet ────────────────────────────────────────── */}
          <MotionDiv
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={SHEET_SPRING}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.04}
            onDragEnd={onDragEnd}
            className="fixed bottom-0 inset-x-0 z-[101] flex flex-col max-h-[92vh] overflow-hidden"
            style={{
              backgroundColor: '#F2F2F7', // Exact iOS Grouped Background color
              borderRadius: '32px 32px 0 0', // Massive, hardware-like corner radii
              boxShadow: '0 -10px 40px rgba(0,0,0,0.15)',
              willChange: 'transform',
            }}
            role="listbox"
            aria-modal="true"
            aria-label="Select Market"
          >
            {/* ── Drag Handle ─────────────────────────────────── */}
            <div className="flex justify-center pt-3 pb-4 cursor-grab active:cursor-grabbing">
              <div
                className="rounded-full"
                style={{
                  width: 36,
                  height: 5,
                  backgroundColor: '#3C3C43',
                  opacity: 0.25,
                }}
              />
            </div>

            {/* ── Header ───────────────────────────────────────── */}
            <div className="flex items-end justify-between px-6 pb-6">
              <div>
                <h2
                  className="font-semibold"
                  style={{
                    fontSize: 28, // Pushed to iOS Large Title proportions
                    color: '#000000',
                    letterSpacing: '-0.04em',
                    lineHeight: '1.1',
                  }}
                >
                  Markets
                </h2>
                {totalLive > 0 && (
                  <p
                    className="font-medium mt-1"
                    style={{
                      fontSize: 14,
                      color: '#8E8E93',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {totalLive} active events
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="flex items-center justify-center rounded-full transition-colors active:scale-95 hover:bg-black/10"
                style={{
                  width: 32,
                  height: 32,
                  backgroundColor: 'rgba(0,0,0,0.06)',
                  color: '#000000',
                  marginBottom: 4, // Optical alignment with the massive header text
                }}
                aria-label="Close"
              >
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>

            {/* ── Scrollable ───────────────────────────────────── */}
            <div
              className="flex-1 overflow-y-auto overscroll-contain"
              style={{ padding: '0 20px 48px' }}
            >
              {/* All Sports — Solo Row */}
              <div style={{ marginBottom: 32 }}>
                <div style={{ borderRadius: 16, overflow: 'hidden' }}>
                  <SportRow
                    label="All Markets"
                    isSelected={selectedSport === 'all'}
                    liveCount={totalLive}
                    onSelect={() => pick('all')}
                  />
                </div>
              </div>

              {/* Category Groups */}
              {groups.map(({ label, sports }) => (
                <div key={label} style={{ marginBottom: 32 }}>
                  {/* Micro-typographic Header */}
                  <p
                    className="font-bold uppercase"
                    style={{
                      fontSize: 11,
                      color: '#8E8E93',
                      letterSpacing: '0.12em', // Extreme tracking for authority
                      paddingLeft: 20,
                      marginBottom: 8,
                    }}
                  >
                    {label}
                  </p>

                  <div style={{ borderRadius: 16, overflow: 'hidden' }}>
                    {sports.map((sport, i) => {
                      const config = sportConfig[sport];
                      if (!config) return null;

                      const len = sports.length;

                      // Intelligence: Hide hairlines that neighbor a black selected row 
                      // to prevent an awkward gray line bleeding against the pure matte black.
                      const isNextSelected = i < len - 1 && selectedSport === sports[i + 1];
                      const isCurrentlySelected = selectedSport === sport;
                      const hideSeparator = isCurrentlySelected || isNextSelected;

                      return (
                        <React.Fragment key={sport}>
                          {i > 0 && <Separator hidden={hideSeparator} />}
                          <SportRow
                            label={config.label}
                            isSelected={isCurrentlySelected}
                            liveCount={liveCounts[sport] || 0}
                            onSelect={() => pick(sport)}
                          />
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="h-safe-bottom" />
            </div>
          </MotionDiv>
        </>
      )}
    </AnimatePresence>
  );
};

export default MobileSportDrawer;
