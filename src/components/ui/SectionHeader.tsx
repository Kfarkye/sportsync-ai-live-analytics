import React, { memo, ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { cn, ESSENCE } from '@/lib/essence';

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

const accentStyle: Record<AccentVariant, { dot: string; text: string }> = {
  default: {
    dot: ESSENCE.colors.accent.primary,
    text: ESSENCE.colors.text.secondary,
  },
  live: {
    dot: ESSENCE.colors.accent.success,
    text: ESSENCE.colors.text.secondary,
  },
  final: {
    dot: ESSENCE.colors.text.tertiary,
    text: ESSENCE.colors.text.secondary,
  },
};

export const SectionHeader = memo(({
  children,
  title,
  icon: Icon,
  accent = 'default',
  rightAccessory,
  className,
  compact = false,
  centered = false,
}: SectionHeaderProps) => {
  const displayTitle = children || title;

  return (
    <div
      className={cn(
        'flex items-center',
        centered ? 'flex-col justify-center text-center space-y-4' : 'justify-between',
        compact ? (centered ? 'mb-6' : 'mb-3') : 'mb-3 mt-8 first:mt-0',
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-300"
          style={{ background: accentStyle[accent].dot }}
        />
        {Icon && <Icon size={11} strokeWidth={2.5} style={{ color: accentStyle[accent].text }} />}
        <span
          className={cn('text-[12px] font-medium uppercase tracking-[0.12em] leading-none', centered && 'pl-0')}
          style={{ color: accentStyle[accent].text }}
        >
          {displayTitle}
        </span>
      </div>

      {rightAccessory && <div className="shrink-0">{rightAccessory}</div>}
    </div>
  );
});

SectionHeader.displayName = 'SectionHeader';

interface CardHeaderProps {
  title: string;
  rightAccessory?: ReactNode;
  showDivider?: boolean;
  className?: string;
}

export const CardHeader = memo(({ title, rightAccessory, showDivider = false, className }: CardHeaderProps) => {
  return (
    <div className={cn('mb-4', className)}>
      <div className="flex items-center justify-between">
        <h4 className={ESSENCE.tw.cardHeaderLabel} style={{ color: ESSENCE.colors.text.secondary }}>
          {title}
        </h4>
        {rightAccessory && <div className="shrink-0">{rightAccessory}</div>}
      </div>
      {showDivider && <div className={cn('mt-3', ESSENCE.tw.divider)} />}
    </div>
  );
});

CardHeader.displayName = 'CardHeader';

export default SectionHeader;
