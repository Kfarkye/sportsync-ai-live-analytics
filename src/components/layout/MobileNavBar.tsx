
import React from 'react';
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

// Inline pulse indicator (replaces NeuralPulse)
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

export const MobileNavBar = () => {
    const { activeView, setActiveView, toggleGlobalChat, isGlobalChatOpen } = useAppStore();

    const TABS = [
        { id: 'FEED', label: 'Feed', icon: Home },
        { id: 'LIVE', label: 'Live', icon: Zap },
        { id: 'TITAN', label: 'Search', icon: BarChart3 },
    ];

    const handleTabPress = (tabId: string) => {
        if ('vibrate' in navigator) navigator.vibrate(10);
        setActiveView(tabId as ViewType);
    };

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-[45] flex items-center justify-center pb-safe mb-4 md:mb-6 print:hidden pointer-events-none px-4"
            role="navigation"
            aria-label="Main navigation"
        >
            <div className="flex items-center gap-1 p-1.5 bg-black/90 backdrop-blur-2xl border border-white/10 rounded-full shadow-lg pointer-events-auto">
                {/* View Tabs — 44px minimum touch targets */}
                <div className="flex items-center gap-0.5">
                    {TABS.map((tab) => {
                        const isActive = activeView === tab.id;
                        const Icon = tab.icon;

                        return (
                            <button
                                key={tab.id}
                                onClick={() => handleTabPress(tab.id)}
                                aria-label={tab.label}
                                aria-current={isActive ? 'page' : undefined}
                                className={cn(
                                    "relative flex flex-col items-center justify-center min-w-[52px] h-[44px] rounded-full transition-all duration-300 active:scale-90",
                                    isActive ? 'text-white' : 'text-zinc-500'
                                )}
                            >
                                {isActive && (
                                    <MotionDiv
                                        layoutId="activeTabMobile"
                                        className="absolute inset-0 bg-white/10 rounded-full shadow-lg border border-white/10"
                                        transition={ESSENCE.transition.spring}
                                    />
                                )}
                                <Icon size={20} strokeWidth={isActive ? 2.5 : 2} className="relative z-10" />
                                <span className={cn(
                                    "relative z-10 text-[9px] font-semibold mt-0.5 tracking-wide",
                                    isActive ? 'text-white' : 'text-zinc-600'
                                )}>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Subtle Divider */}
                <div className="w-px h-5 bg-white/10 mx-0.5" />

                {/* Edge Button — 44px touch target */}
                <button
                    onClick={() => {
                        if ('vibrate' in navigator) navigator.vibrate(10);
                        toggleGlobalChat();
                    }}
                    aria-label="AI Edge Assistant"
                    className={cn(
                        "relative flex flex-col items-center justify-center min-w-[52px] h-[44px] rounded-full transition-all duration-300 active:scale-95",
                        isGlobalChatOpen ? "text-emerald-400" : "text-zinc-500"
                    )}
                >
                    {isGlobalChatOpen ? (
                        <EdgePulse />
                    ) : (
                        <Bot size={20} strokeWidth={2} className="relative z-10" />
                    )}
                    <span className={cn(
                        "relative z-10 text-[9px] font-semibold mt-0.5 tracking-wide",
                        isGlobalChatOpen ? 'text-emerald-400' : 'text-zinc-600'
                    )}>Edge</span>

                    {isGlobalChatOpen && (
                        <MotionDiv
                            layoutId="activeTabMobileChat"
                            className="absolute inset-0 bg-[#34D399]/10 rounded-full border border-[#34D399]/20"
                            transition={ESSENCE.transition.spring}
                        />
                    )}
                </button>
            </div>
        </nav>
    );
};
