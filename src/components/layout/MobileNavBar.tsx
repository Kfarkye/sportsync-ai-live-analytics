
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

// Inline pulse indicator for active chat
const EdgePulse = () => (
    <div className="relative w-5 h-5 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-zinc-900" />
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
        <div className="fixed left-1/2 -translate-x-1/2 w-[90%] max-w-[400px] z-[45] font-sans print:hidden md:hidden bottom-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {/* iOS Frosted Glass Container */}
            <div className="bg-white/85 backdrop-blur-xl border border-slate-200/80 rounded-full px-4 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.08)] flex items-center justify-between">
                {/* View Tabs */}
                {TABS.map((tab) => {
                    const isActive = activeView === tab.id;
                    const Icon = tab.icon;

                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveView(tab.id as ViewType)}
                            className={cn(
                                "flex flex-col items-center gap-1.5 transition-colors duration-200 active:scale-90",
                                isActive ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                            )}
                        >
                            <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                            <span className={cn(
                                "text-[10px] tracking-wide",
                                isActive ? "font-bold" : "font-medium"
                            )}>
                                {tab.label}
                            </span>
                        </button>
                    );
                })}

                {/* Subtle Divider */}
                <div className="w-px h-6 bg-slate-200 mx-1" />

                {/* Edge/Chat Button */}
                <button
                    onClick={() => toggleGlobalChat()}
                    className={cn(
                        "flex flex-col items-center gap-1.5 transition-colors duration-200 active:scale-95",
                        isGlobalChatOpen ? "text-zinc-900" : "text-slate-400 hover:text-slate-600"
                    )}
                    title="Edge AI"
                >
                    {isGlobalChatOpen ? (
                        <EdgePulse />
                    ) : (
                        <Bot size={20} strokeWidth={2} />
                    )}
                    <span className={cn(
                        "text-[10px] tracking-wide",
                        isGlobalChatOpen ? "font-bold" : "font-medium"
                    )}>
                        Edge
                    </span>
                </button>
            </div>
        </div>
    );
};
