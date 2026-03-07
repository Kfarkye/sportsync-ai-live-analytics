import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Home, Zap, Bot, BarChart3 } from 'lucide-react';
import { useAppStore, ViewType } from '../../store/appStore';
import { ESSENCE } from '@/lib/essence';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

const MotionDiv = motion.div;

// ─────────────────────────────────────────────────────────────
// § SCROLL DIRECTION — rAF-throttled, passive listener
// ─────────────────────────────────────────────────────────────

type ScrollDir = 'up' | 'down' | 'idle';

const useScrollDirection = (scrollTargetId: string, threshold = 12): { direction: ScrollDir; isCompact: boolean } => {
    const [direction, setDirection] = useState<ScrollDir>('idle');
    const [isCompact, setIsCompact] = useState(false);
    const lastY = useRef(0);
    const ticking = useRef(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const scrollRoot = document.getElementById(scrollTargetId);
        const getY = () => (scrollRoot ? scrollRoot.scrollTop : window.scrollY);

        const onScroll = () => {
            if (ticking.current) return;
            ticking.current = true;

            requestAnimationFrame(() => {
                const y = getY();
                const delta = y - lastY.current;

                if (Math.abs(delta) > threshold) {
                    const dir: ScrollDir = delta > 0 ? 'down' : 'up';
                    setDirection(dir);
                    setIsCompact(dir === 'down' && y > 80);
                    lastY.current = y;
                }

                if (y < 40) {
                    setIsCompact(false);
                    setDirection('idle');
                }

                ticking.current = false;
            });
        };

        const target: Window | HTMLElement = scrollRoot ?? window;
        onScroll();
        target.addEventListener('scroll', onScroll, { passive: true });
        return () => target.removeEventListener('scroll', onScroll);
    }, [scrollTargetId, threshold]);

    return { direction, isCompact };
};

// ─────────────────────────────────────────────────────────────
// § EDGE PULSE INDICATOR
// ─────────────────────────────────────────────────────────────

const EdgePulse = () => (
    <div className="relative w-5 h-5 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        <motion.div
            className="absolute inset-0 rounded-full bg-emerald-400/40"
            animate={{ scale: [1, 2], opacity: [0.5, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
        />
    </div>
);

// ─────────────────────────────────────────────────────────────
// § TABS — icon + label, because labels are function, not decoration
// ─────────────────────────────────────────────────────────────

const TABS = [
    { id: 'FEED',  label: 'Home', icon: Home },
    { id: 'LIVE',  label: 'Live', icon: Zap },
    { id: 'TITAN', label: 'Titan', icon: BarChart3 },
] as const;

// ─────────────────────────────────────────────────────────────
// § MOBILE NAV BAR
//
// Design:  Glass material + collapse-on-scroll + text labels
// Pattern: iOS tab bar (icon above label, always labeled)
//          Compact state: icon-only (user has mental model)
// ─────────────────────────────────────────────────────────────

interface MobileNavBarProps {
    scrollTargetId?: string;
}

export const MobileNavBar = ({ scrollTargetId = 'main-content' }: MobileNavBarProps) => {
    const { activeView, setActiveView, toggleGlobalChat, isGlobalChatOpen } = useAppStore();
    const { isCompact } = useScrollDirection(scrollTargetId, 12);

    const handleTabPress = useCallback((id: string) => {
        setActiveView(id as ViewType);
    }, [setActiveView]);

    return (
        <div className="fixed bottom-0 left-0 right-0 z-[45] flex items-center justify-center pb-safe print:hidden pointer-events-none px-4">
            <MotionDiv
                layout
                animate={{
                    y: isCompact ? 4 : 0,
                    opacity: isCompact ? 0.85 : 1,
                    scale: isCompact ? 0.88 : 1,
                }}
                transition={{
                    type: 'spring',
                    stiffness: 500,
                    damping: 35,
                    mass: 0.8,
                }}
                className="mb-4 md:mb-6 pointer-events-auto"
            >
                {/* ── Glass Shell ── */}
                <div
                    className={cn(
                        "relative flex items-center rounded-full overflow-hidden transition-all duration-300",
                        "bg-surface-card backdrop-blur-3xl backdrop-saturate-150",
                        "border border-edge",
                        "shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)]",
                        isCompact ? "px-1 py-1 gap-0" : "px-2 py-1.5 gap-0.5",
                    )}
                >
                    {/* ── View Tabs ── */}
                    <div className={cn(
                        "flex items-center transition-all duration-300",
                        isCompact ? "gap-0" : "gap-0.5",
                    )}>
                        {TABS.map((tab) => {
                            const isActive = activeView === tab.id;
                            const Icon = tab.icon;

                            return (
                                <MotionDiv
                                    key={tab.id}
                                    layout
                                    animate={{
                                        width: isCompact
                                            ? 42
                                            : isActive ? 72 : 52,
                                        opacity: 1,
                                    }}
                                    transition={{
                                        type: 'spring',
                                        stiffness: 500,
                                        damping: 32,
                                        mass: 0.6,
                                        opacity: { duration: 0.15 },
                                    }}
                                    className="overflow-hidden"
                                    style={{ minWidth: 0 }}
                                >
                                    <button
                                        type="button"
                                        aria-label={tab.label}
                                        aria-pressed={isActive}
                                        onClick={() => handleTabPress(tab.id)}
                                        className={cn(
                                            "relative flex flex-col items-center justify-center rounded-full transition-colors duration-200 active:scale-90",
                                            isCompact ? "w-11 h-10" : "w-full h-12",
                                            isActive ? 'text-ink-primary' : 'text-ink-tertiary hover:text-ink-secondary',
                                        )}
                                    >
                                        {isActive && (
                                            <MotionDiv
                                                layoutId="activeTabMobile"
                                                className="absolute inset-0 rounded-full bg-overlay-emphasis border border-edge-subtle"
                                                transition={ESSENCE.transition.spring}
                                            />
                                        )}
                                        <Icon
                                            size={isCompact ? 18 : 17}
                                            strokeWidth={isActive ? 2.5 : 1.8}
                                            className="relative z-10 transition-all duration-200"
                                        />
                                        {/* Label — visible expanded, hidden compact */}
                                        {!isCompact && (
                                            <span className={cn(
                                                "relative z-10 text-[9px] font-semibold tracking-wide leading-none mt-0.5",
                                                isActive ? "text-ink-primary" : "text-ink-tertiary",
                                            )}>
                                                {tab.label}
                                            </span>
                                        )}
                                    </button>
                                </MotionDiv>
                            );
                        })}
                    </div>

                    {/* ── Divider ── */}
                    <MotionDiv
                        layout
                        animate={{
                            opacity: isCompact ? 0.25 : 1,
                            width: 1,
                            marginLeft: 4,
                            marginRight: 4,
                        }}
                        transition={{ duration: 0.2 }}
                        className="h-5 bg-overlay-emphasis overflow-hidden flex-shrink-0"
                    />

                    {/* ── Edge / Chat ── */}
                    <MotionDiv
                        layout
                        animate={{
                            width: isCompact ? 42 : isGlobalChatOpen ? 72 : 52,
                            opacity: 1,
                        }}
                        transition={{
                            type: 'spring',
                            stiffness: 500,
                            damping: 32,
                            mass: 0.6,
                            opacity: { duration: 0.15 },
                        }}
                        className="overflow-hidden"
                        style={{ minWidth: 0 }}
                    >
                        <button
                            type="button"
                            aria-label="Toggle edge chat"
                            aria-pressed={isGlobalChatOpen}
                            onClick={() => toggleGlobalChat()}
                            className={cn(
                                "relative flex flex-col items-center justify-center w-full h-12 rounded-full transition-all duration-200 active:scale-95",
                                isGlobalChatOpen ? "text-emerald-400" : "text-ink-tertiary hover:text-ink-secondary",
                            )}
                        >
                            {isGlobalChatOpen ? (
                                <EdgePulse />
                            ) : (
                                <Bot size={17} strokeWidth={1.8} className="relative z-10" />
                            )}

                            {/* Label */}
                            <span className={cn(
                                "relative z-10 text-[9px] font-semibold tracking-wide leading-none mt-0.5",
                                isGlobalChatOpen ? "text-emerald-400/80" : "text-ink-tertiary",
                            )}>
                                Edge
                            </span>

                            {isGlobalChatOpen && (
                                <MotionDiv
                                    layoutId="activeTabMobileChat"
                                    className="absolute inset-0 bg-emerald-400/[0.06] rounded-full border border-emerald-400/[0.1]"
                                    transition={ESSENCE.transition.spring}
                                />
                            )}
                        </button>
                    </MotionDiv>
                </div>
            </MotionDiv>
        </div>
    );
};
