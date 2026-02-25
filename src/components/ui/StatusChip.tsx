
import React, { memo } from 'react';
import { cn } from '@/lib/essence';

/**
 * StatusChip - Unified Status Indicator System
 * 
 * ONE chip grammar across the entire application.
 * Variants: live | final | halftime | stale | processing
 * 
 * Design Principle: Status is metadata, not noise.
 * - Small, precise, consistent
 * - Left-aligned dot for visual rhythm
 * - Uppercase tracking for scanability
 */

type StatusVariant = 'live' | 'final' | 'halftime' | 'stale' | 'processing';

interface StatusChipProps {
    variant: StatusVariant;
    className?: string;
    pulse?: boolean;
    label?: string;
}

const VARIANT_CONFIG: Record<StatusVariant, { dot: string; text: string; label: string }> = {
    live: {
        dot: 'bg-emerald-500',
        text: 'text-emerald-500',
        label: 'Live'
    },
    final: {
        dot: 'bg-zinc-500',
        text: 'text-zinc-500',
        label: 'Final'
    },
    halftime: {
        dot: 'bg-amber-500',
        text: 'text-amber-500',
        label: 'Halftime'
    },
    stale: {
        dot: 'bg-amber-500/60',
        text: 'text-amber-500/80',
        label: 'Stale'
    },
    processing: {
        dot: 'bg-violet-500',
        text: 'text-violet-500',
        label: 'Processing'
    }
};

export const StatusChip = memo(({ variant, className, pulse = false, label }: StatusChipProps) => {
    const config = VARIANT_CONFIG[variant];
    const displayLabel = label || config.label;
    const shouldPulse = pulse || variant === 'live' || variant === 'processing';

    return (
        <div className={cn("flex items-center gap-1.5", className)}>
            <div className="relative flex h-1.5 w-1.5">
                {shouldPulse && (
                    <span className={cn(
                        "motion-reduce:hidden animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                        config.dot
                    )} />
                )}
                <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", config.dot)} />
            </div>
            <span className={cn("text-[8px] font-black uppercase tracking-[0.15em]", config.text)}>
                {displayLabel}
            </span>
        </div>
    );
});

StatusChip.displayName = 'StatusChip';

export default StatusChip;
