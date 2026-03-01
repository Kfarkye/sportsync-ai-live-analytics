import React from 'react';
import { cn } from '@/lib/essence';

interface EmptyStateProps {
    icon?: React.ReactNode;
    message: string;
    description?: string;
    action?: React.ReactNode;
    className?: string;
}

/**
 * ELITE EMPTY STATE COMPONENT
 * Consistent, visually refined placeholder for empty data sections.
 * Uses subtle fading and centered layout for premium feel.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
    icon,
    message,
    description,
    action,
    className
}) => {
    return (
        <div className={cn(
            "flex flex-col items-center justify-center px-8 py-16 text-center",
            "rounded-2xl border border-zinc-200 bg-zinc-50/70",
            className
        )}>
            {icon && (
                <div className="mb-6 text-zinc-500">
                    {icon}
                </div>
            )}
            <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-zinc-700">
                {message}
            </p>
            {description && (
                <p className="mt-2 max-w-[280px] text-[12px] font-medium text-zinc-600">
                    {description}
                </p>
            )}
            {action && (
                <div className="mt-6">
                    {action}
                </div>
            )}
        </div>
    );
};

export default EmptyState;
