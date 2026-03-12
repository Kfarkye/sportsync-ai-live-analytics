import React, { memo, type ReactNode } from 'react';
import { cn } from '@/lib/essence';

export interface SummaryStripItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}

interface SummaryStripProps {
  items: SummaryStripItem[];
  className?: string;
}

export const SummaryStrip = memo(({ items, className }: SummaryStripProps) => {
  if (!items.length) return null;

  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {items.map((item) => (
        <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{item.label}</div>
          <div className="mt-1 text-[15px] font-semibold tracking-[-0.02em] text-slate-950">{item.value}</div>
          {item.hint ? <div className="mt-1 text-[12px] leading-5 text-slate-500">{item.hint}</div> : null}
        </div>
      ))}
    </div>
  );
});

SummaryStrip.displayName = 'SummaryStrip';

export default SummaryStrip;
