
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
        { id: 'FEED', label: 'Home', icon: Home },
        { id: 'LIVE', label: 'Live', icon: Zap },
        { id: 'TITAN', label: 'Titan', icon: BarChart3 },
    ];

    return (
        <div className="fixed bottom-0 left-0 right-0 z-[45] flex items-center justify-center pb-safe mb-6 print:hidden pointer-events-none px-4">
            <div className="flex items-center gap-1.5 p-1.5 bg-black/90 backdrop-blur-2xl border border-white/10 rounded-full shadow-lg pointer-events-auto">
                {/* View Tabs */}
                <div className="flex items-center gap-1">
                    {TABS.map((tab) => {
                        const isActive = activeView === tab.id;
                        const Icon = tab.icon;

                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveView(tab.id as ViewType)}
                                className={cn(
                                    "relative flex items-center justify-center w-14 h-11 rounded-full transition-all duration-300 active:scale-90",
                                    isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
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
                            </button>
                        );
                    })}
                </div>

                {/* Subtle Divider */}
                <div className="w-px h-5 bg-white/10 mx-1" />

                {/* Edge Button */}
                <button
                    onClick={() => toggleGlobalChat()}
                    className={cn(
                        "relative flex items-center justify-center w-14 h-11 rounded-full transition-all duration-300 active:scale-95",
                        isGlobalChatOpen ? "text-emerald-400" : "text-zinc-500 hover:text-zinc-300"
                    )}
                    title="Edge"
                >
                    {isGlobalChatOpen ? (
                        <EdgePulse />
                    ) : (
                        <Bot size={20} strokeWidth={2} className="relative z-10" />
                    )}

                    {isGlobalChatOpen && (
                        <MotionDiv
                            layoutId="activeTabMobileChat"
                            className="absolute inset-0 bg-[#34D399]/10 rounded-full border border-[#34D399]/20"
                            transition={ESSENCE.transition.spring}
                        />
                    )}
                </button>
            </div>
        </div>
    );
};
