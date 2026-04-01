import React, { memo } from 'react';
import { cn, ESSENCE } from '@/lib/essence';

type PillTone = 'neutral' | 'accent' | 'success' | 'danger';

interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
}

const toneStyles: Record<PillTone, { bg: string; border: string; color: string }> = {
  neutral: {
    bg: ESSENCE.colors.surface.subtle,
    border: ESSENCE.colors.border.default,
    color: ESSENCE.colors.text.secondary,
  },
  accent: {
    bg: ESSENCE.colors.accent.primaryMuted,
    border: ESSENCE.colors.border.default,
    color: ESSENCE.colors.accent.primary,
  },
  success: {
    bg: ESSENCE.colors.accent.successMuted,
    border: ESSENCE.colors.accent.success,
    color: ESSENCE.colors.accent.success,
  },
  danger: {
    bg: ESSENCE.colors.accent.dangerMuted,
    border: ESSENCE.colors.accent.danger,
    color: ESSENCE.colors.accent.danger,
  },
};

export const Pill = memo(({ className, tone = 'neutral', children, ...rest }: PillProps) => {
  const toneStyle = toneStyles[tone];
  return (
    <span
      className={cn('inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]', className)}
      style={{
        background: toneStyle.bg,
        borderColor: toneStyle.border,
        color: toneStyle.color,
      }}
      {...rest}
    >
      {children}
    </span>
  );
});

Pill.displayName = 'Pill';

export default Pill;
