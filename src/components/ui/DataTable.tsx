import React, { memo, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/essence';
import { EmptyState } from './EmptyState';

export type DataTableDensity = 'compact' | 'comfortable';
export type DataTableRowTone = 'default' | 'muted' | 'strong';

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  width?: string;
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: keyof T | ((row: T, index: number) => React.Key);
  density?: DataTableDensity;
  loading?: boolean;
  loadingRows?: number;
  emptyState?: ReactNode;
  stickyHeader?: boolean;
  rowTone?: (row: T, index: number) => DataTableRowTone;
  className?: string;
}

const densityStyles: Record<DataTableDensity, string> = {
  compact: 'px-4 py-3',
  comfortable: 'px-4 py-4',
};

const rowToneStyles: Record<DataTableRowTone, string> = {
  default: 'bg-white',
  muted: 'bg-slate-50/55',
  strong: 'bg-slate-50/85',
};

const resolveRowKey = <T,>(row: T, index: number, rowKey: keyof T | ((row: T, index: number) => React.Key)) => {
  if (typeof rowKey === 'function') return rowKey(row, index);
  return String(row[rowKey] ?? index);
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  density = 'compact',
  loading = false,
  loadingRows = 6,
  emptyState,
  stickyHeader = true,
  rowTone,
  className,
}: DataTableProps<T>) {
  const templateColumns = columns.map((column) => column.width ?? 'minmax(120px,1fr)').join(' ');
  const gridStyle = { gridTemplateColumns: templateColumns } satisfies CSSProperties;

  const renderSkeletonRows = () =>
    Array.from({ length: loadingRows }).map((_, rowIndex) => (
      <div
        key={`skeleton-${rowIndex}`}
        className={cn(
          'grid gap-3 border-t border-slate-200 bg-white',
          densityStyles[density],
        )}
        style={gridStyle}
      >
        {columns.map((column, columnIndex) => (
          <div key={`${column.id}-${columnIndex}`} className="flex items-center">
            <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
          </div>
        ))}
      </div>
    ));

  return (
    <div className={cn('overflow-x-auto rounded-2xl border border-slate-200 bg-white', className)}>
      <div className="min-w-max">
        <div
          className={cn(
            'grid gap-3 border-b border-slate-200 px-4 py-3',
            stickyHeader && 'sticky top-0 z-10 bg-white/95 backdrop-blur supports-backdrop-filter:bg-white/90',
          )}
          style={gridStyle}
        >
          {columns.map((column) => (
            <div
              key={column.id}
              className={cn(
                'text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500',
                column.headerClassName,
              )}
            >
              {column.header}
            </div>
          ))}
        </div>

        {loading ? (
          renderSkeletonRows()
        ) : rows.length === 0 ? (
          <div className="px-4 py-4">
            {emptyState ?? (
              <EmptyState
                message="NO DATA"
                description="There is nothing to show in this table yet."
              />
            )}
          </div>
        ) : (
          rows.map((row, index) => {
            const tone = rowTone ? rowTone(row, index) : 'default';

            return (
              <div
                key={resolveRowKey(row, index, rowKey)}
                className={cn(
                  'grid gap-3 border-t border-slate-200 transition-colors',
                  densityStyles[density],
                  rowToneStyles[tone],
                )}
                style={gridStyle}
              >
                {columns.map((column) => (
                  <div key={column.id} className={cn('min-w-0', column.className)}>
                    {column.cell(row, index)}
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default memo(DataTable) as typeof DataTable;
