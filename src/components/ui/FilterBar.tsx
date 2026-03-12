import React, { memo, type ReactNode } from 'react';
import { cn } from '@/lib/essence';

interface FilterBarProps {
  children?: ReactNode;
  rightAccessory?: ReactNode;
  className?: string;
}

export const FilterBar = memo(({ children, rightAccessory, className }: FilterBarProps) => {
  return (
    <div
      className={cn(
        'mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {rightAccessory ? <div className="shrink-0">{rightAccessory}</div> : null}
    </div>
  );
});

FilterBar.displayName = 'FilterBar';

export default FilterBar;
