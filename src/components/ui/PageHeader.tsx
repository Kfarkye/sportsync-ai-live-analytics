import React, { memo, type ReactNode } from 'react';
import { cn } from '@/lib/essence';

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}

export const PageHeader = memo(
  ({ eyebrow, title, description, actions, className, compact = false }: PageHeaderProps) => {
    return (
      <div
        className={cn(
          'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
          compact ? 'mb-4' : 'mb-6',
          className,
        )}
      >
        <div className="min-w-0 space-y-2">
          {eyebrow ? (
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">{eyebrow}</div>
          ) : null}
          <div className="text-[22px] font-semibold tracking-[-0.03em] text-slate-950 sm:text-[26px]">{title}</div>
          {description ? (
            <div className="max-w-3xl text-[13px] leading-6 text-slate-600 sm:text-[14px]">{description}</div>
          ) : null}
        </div>

        {actions ? <div className="shrink-0 self-start">{actions}</div> : null}
      </div>
    );
  },
);

PageHeader.displayName = 'PageHeader';

export default PageHeader;
