
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/essence';

interface MatchupErrorProps {
    className?: string;
    title?: string;
    message?: string;
    error?: any;
}

export const MatchupError: React.FC<MatchupErrorProps> = ({
    className,
    title = 'Data Discovery Failed',
    message = 'A rendering exception occurred in this data layer. This is usually caused by missing or malformed statistical aggregates.',
    error
}) => {
    return (
        <div className={cn(
            "p-12 text-center bg-rose-500/5 border border-rose-500/10 rounded-3xl mx-4 mt-8 backdrop-blur-sm animate-in zoom-in-95 duration-500",
            className
        )}>
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto mb-6">
                <AlertTriangle className="text-rose-500" strokeWidth={1.5} size={24} />
            </div>
            <h3 className="text-rose-500 font-bold mb-2 text-lg tracking-tight">{title}</h3>
            <p className="text-zinc-500 text-sm max-w-md mx-auto mb-6 leading-relaxed">
                {message}
            </p>
            {error && (
                <div className="bg-black/40 p-3 rounded-xl border border-white/[0.04] text-[10px] font-mono text-rose-400 overflow-auto max-h-32 text-left">
                    {error.toString()}
                </div>
            )}
        </div>
    );
};
