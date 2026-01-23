
import React, { memo, ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { cn, ESSENCE } from '../../lib/essence';

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

const ACCENT_COLORS: Record<AccentVariant, string> = {
    default: 'bg-zinc-700',
    live: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]',
    final: 'bg-zinc-600'
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
            compact ? (centered ? "mb-6" : "mb-4") : "mb-6 mt-10 first:mt-0",
            className
        )}>
            {/* Left: Bullet + Title */}
            <div className="flex items-center gap-2.5">
                <div className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all duration-300",
                    ACCENT_COLORS[accent]
                )} />
                {Icon && <Icon size={11} strokeWidth={2.5} className="text-zinc-500" />}
                <span className={cn(
                    "text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.2em] leading-none",
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
                <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">
                    {title}
                </h4>
                {rightAccessory && (
                    <div className="flex-shrink-0">
                        {rightAccessory}
                    </div>
                )}
            </div>
            {showDivider && <div className="h-[1px] bg-white/[0.04] mt-3" />}
        </div>
    );
});

CardHeader.displayName = 'CardHeader';

export default SectionHeader;
