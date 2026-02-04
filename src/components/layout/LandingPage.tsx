import React, { memo } from 'react';
import { motion, type Variants } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import TypeWriter from '../shared/TypeWriter';

const MotionMain = motion.main;
const MotionDiv = motion.div;
const MotionH1 = motion.h1;
const MotionButton = motion.button;
const MotionFooter = motion.footer;

interface LandingPageProps {
  onEnter: () => void;
}

// ========================================================================
// Configuration
// ========================================================================

const EASING_APPLE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const TRANSITION_DURATION = 1.6;
const EASING_SPRING_CTA = { type: 'spring', stiffness: 400, damping: 17 } as const;

const entranceVariants: Variants = {
  hidden: { opacity: 0, y: 25 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: TRANSITION_DURATION,
      ease: EASING_APPLE,
    },
  },
};

// ========================================================================
// Components
// ========================================================================

const DripHeroLogo = memo(() => (
  <svg
    width="80"
    height="80"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="drop-shadow-[0_10px_60px_rgba(139,92,246,0.6)]"
    role="img"
    aria-label="The Drip Logo"
  >
    <path
      d="M12 21C15.5346 21 18.4346 18.1 18.4346 14.5654C18.4346 11.0308 15.5346 3 12 3C8.46538 3 5.56538 11.0308 5.56538 14.5654C5.56538 18.1 8.46538 21 12 21Z"
      fill="url(#paint0_linear_clean)"
    />
    <defs>
      <linearGradient id="paint0_linear_clean" x1="12" y1="3" x2="12" y2="21" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFFFFF" />
        <stop offset="0.4" stopColor="#C4B5FD" />
        <stop offset="1" stopColor="#7C3AED" />
      </linearGradient>
    </defs>
  </svg>
));
DripHeroLogo.displayName = 'DripHeroLogo';

// ========================================================================
// Main Component
// ========================================================================

const LandingPage: React.FC<LandingPageProps> = ({ onEnter }) => {
  return (
    <div className="relative min-h-screen bg-[#030303] text-white overflow-hidden flex flex-col items-center justify-center font-sans selection:bg-violet-500/40 antialiased">

      {/* Background spotlight */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-[800px] opacity-30"
          style={{
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.3) 0%, rgba(3, 3, 3, 0) 50%)',
            filter: 'blur(100px)'
          }}
        />
      </div>

      {/* Main Content */}
      <MotionMain
        initial="hidden"
        animate="visible"
        transition={{ staggerChildren: 0.15, delayChildren: 0.1 }}
        className="relative z-10 flex flex-col items-center text-center px-6 max-w-4xl w-full"
      >

        {/* Logo */}
        <MotionDiv
          variants={entranceVariants}
          className="mb-14 relative group"
        >
          <div className="absolute -inset-12 bg-violet-600/20 blur-[50px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

          <div className="relative w-32 h-32 bg-white/[0.02] backdrop-blur-2xl border border-white/[0.06] rounded-[28px] flex items-center justify-center shadow-[0_20px_50px_-15px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-tr from-white/[0.04] to-transparent pointer-events-none" />
            <DripHeroLogo />
          </div>
        </MotionDiv>

        {/* Headline */}
        <MotionH1
          variants={entranceVariants}
          className="text-7xl md:text-[7.5rem] font-semibold tracking-[-0.04em] mb-10 bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-400"
        >
          The Drip
        </MotionH1>

        {/* TypeWriter - Bettor focused, no code aesthetic */}
        <MotionDiv
          variants={entranceVariants}
          className="h-14 mb-20 flex items-center justify-center"
        >
          <div className="text-xl md:text-2xl text-zinc-400 font-medium tracking-tight">
            <TypeWriter
              lines={[
                'Player props on deck.',
                'Akron vs. Kent State? We know the edge.',
                'Vegas feared.',
                '2AM locks loaded.'
              ]}
              colors={[
                'text-zinc-400',
                'text-violet-400',
                'text-zinc-400',
                'text-white'
              ]}
              typingSpeed={45}
              deleteSpeed={25}
              pauseBeforeType={1000}
              pauseBeforeDelete={2200}
              showCursor={true}
              cursorChar="pipe"
              loop={true}
            />
          </div>
        </MotionDiv>

        {/* CTA Button */}
        <MotionDiv variants={entranceVariants}>
          <MotionButton
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            transition={EASING_SPRING_CTA}
            onClick={onEnter}
            className="group relative px-12 py-4 bg-white text-black rounded-full overflow-hidden shadow-[0_8px_40px_rgba(255,255,255,0.25)] z-50 transition-shadow duration-500 hover:shadow-[0_8px_50px_rgba(255,255,255,0.4)]"
            aria-label="Enter the Edge"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-white to-zinc-200 opacity-100 group-hover:opacity-95 transition-opacity" />

            <div className="absolute top-0 -left-full w-full h-full bg-gradient-to-r from-transparent via-white/50 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[200%]" />

            <div className="relative flex items-center gap-3 font-semibold text-lg tracking-tight">
              <span>Enter the Edge</span>
              <ChevronRight size={18} className="text-black/50 group-hover:translate-x-0.5 transition-transform duration-300" />
            </div>
          </MotionButton>
        </MotionDiv>

      </MotionMain>

      {/* Minimal Footer - Just the live indicator */}
      <MotionFooter
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.2, duration: 1 }}
        className="absolute bottom-8 z-10"
      >
        <div className="flex items-center gap-2 opacity-50">
          <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
          <span className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">Live</span>
        </div>
      </MotionFooter>
    </div>
  );
};

export default LandingPage;
