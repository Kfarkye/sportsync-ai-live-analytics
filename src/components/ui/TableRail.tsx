import React, { memo, type ReactNode } from 'react';
import { cn, ESSENCE } from '@/lib/essence';

interface TableRailProps {
  header: ReactNode;
  children: ReactNode;
  className?: string;
}

export const TableRail = memo(({ header, children, className }: TableRailProps) => {
  return (
    <section className={cn(ESSENCE.card.base, 'overflow-hidden', className)}>
      <div className={cn('pb-3', ESSENCE.tw.divider)}>{header}</div>
      <div>{children}</div>
    </section>
  );
});

TableRail.displayName = 'TableRail';

export default TableRail;
