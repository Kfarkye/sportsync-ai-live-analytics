
import React, { memo, ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/essence';

/**
 * SectionHeader - Unified Section Header System
 * 
 * ONE header grammar across the entire application.
 * - Consistent left bullet (accent color)
 * - Same tracking, same typography
 * - Right accessory slot for chips/actions
 * 
 * Replaces:
 * - Old SectionTitle
 * - Card internal headers ("GAME LINES", "TOP PERFORMERS", etc.)
 * - All custom header treatments
 */

type AccentVariant = 'default' | 'live' | 'final';

interface SectionHeaderProps {
    children?: ReactNode;
    title?: string;
    icon?: LucideIcon;
    accent?: AccentVariant;
    rightAccessory?: ReactNode;
    className?: string;
    compact?: boolean;
    centered?: boolean;
}

// M-04: All section headers get identical neutral treatment — no semantic color
const ACCENT_COLORS: Record<AccentVariant, string> = {
    default: 'bg-zinc-500',
    live: 'bg-zinc-500',     // M-04: No emerald on section headers
    final: 'bg-zinc-500'
};

export const SectionHeader = memo(({
    children,
    title,
    icon: Icon,
    accent = 'default',
    rightAccessory,
    className,
    compact = false,
    centered = false
}: SectionHeaderProps) => {
    const displayTitle = children || title;

    return (
        <div className={cn(
            "flex items-center",
            centered ? "flex-col justify-center text-center space-y-4" : "justify-between",
            compact ? (centered ? "mb-6" : "mb-3") : "mb-3 mt-8 first:mt-0", // M-17: 32px top, 12px bottom
            className
        )}>
            {/* Left: Bullet + Title */}
            <div className="flex items-center gap-2.5">
                <div className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all duration-300",
                    ACCENT_COLORS[accent]
                )} />
                {Icon && <Icon size={11} strokeWidth={2.5} className="text-zinc-600" />}
                {/* M-04: All section headers neutral, 12px, 500 weight, 0.12em tracking */}
                <span className={cn(
                    "text-[12px] font-medium text-zinc-700 uppercase tracking-[0.12em] leading-none",
                    centered && "pl-0" // Remove relative offset if centered
                )}>
                    {displayTitle}
                </span>
            </div>

            {/* Right: Accessory Slot */}
            {rightAccessory && (
                <div className="flex-shrink-0">
                    {rightAccessory}
                </div>
            )}
        </div>
    );
});

SectionHeader.displayName = 'SectionHeader';

/**
 * CardHeader - Used INSIDE cards for internal section titles
 * 
 * Same visual grammar as SectionHeader, but:
 * - No top margin (already inside a card)
 * - Slightly smaller bottom margin
 * - Optional divider below
 */
interface CardHeaderProps {
    title: string;
    rightAccessory?: ReactNode;
    showDivider?: boolean;
    className?: string;
}

export const CardHeader = memo(({ title, rightAccessory, showDivider = false, className }: CardHeaderProps) => {
    return (
        <div className={cn("mb-4", className)}>
            <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em]">
                    {title}
                </h4>
                {rightAccessory && (
                    <div className="flex-shrink-0">
                        {rightAccessory}
                    </div>
                )}
            </div>
            {showDivider && <div className="mt-3 h-[1px] bg-zinc-200" />}
        </div>
    );
});

CardHeader.displayName = 'CardHeader';

export default SectionHeader;
