
import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/essence';

interface MatchupLoaderProps {
    className?: string;
    label?: string;
}

export const MatchupLoader: React.FC<MatchupLoaderProps> = ({
    className,
    label = 'Loading Intelligence...'
}) => {
    return (
        <div className={cn(
            "flex flex-col items-center justify-center py-24 animate-in fade-in duration-700",
            className
        )}>
            <div className="relative mb-6">
                <div className="absolute -inset-4 border border-white/5 rounded-full animate-[spin_8s_linear_infinite]" />
                <div className="w-12 h-12 rounded-full bg-zinc-950 border border-white/[0.04] flex items-center justify-center backdrop-blur-xl">
                    <Loader2 className="w-5 h-5 text-zinc-600 animate-spin" />
                </div>
            </div>
            <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.3em] animate-pulse">
                {label}
            </div>
        </div>
    );
};
