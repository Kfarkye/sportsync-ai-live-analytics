import React, { type FC, type PropsWithChildren } from 'react';
import { cn } from '@/lib/essence';

export const PageShell: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <div className={cn('min-h-screen h-(--vvh,100vh) overflow-y-auto overscroll-y-contain bg-slate-50 text-slate-900', className)}>
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</div>
  </div>
);

export const TopNav: FC = () => (
  <nav className="mb-6 flex items-center justify-between border-b border-slate-200 pb-3 sm:mb-8">
    <a href="/" className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500 hover:text-slate-900">
      Live Feed
    </a>
    <a href="/soccer" className="text-xs font-medium uppercase tracking-[0.12em] text-slate-700 hover:text-slate-900">
      Soccer Hub
    </a>
  </nav>
);

export const Card: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <section className={cn('rounded-xl border border-slate-200 bg-white', className)}>{children}</section>
);

export const CardHeader: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <header className={cn('border-b border-slate-200 px-4 py-3 sm:px-5', className)}>{children}</header>
);

export const CardBody: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <div className={cn('px-4 py-4 sm:px-5 sm:py-5', className)}>{children}</div>
);

export const SectionLabel: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <h2 className={cn('text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500', className)}>{children}</h2>
);

export const ValueText: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <span className={cn('font-mono tabular-nums text-slate-900', className)}>{children}</span>
);

export const DataPill: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <span className={cn('inline-flex items-center rounded-md border border-slate-200 px-2 py-1 font-mono text-xs tabular-nums text-slate-800', className)}>{children}</span>
);

export const EmptyBlock: FC<{ message: string; className?: string }> = ({ message, className }) => (
  <div className={cn('rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500', className)}>{message}</div>
);

export const LoadingBlock: FC<{ label?: string }> = ({ label = 'Loading data…' }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">{label}</div>
);

export const MetricCell: FC<{ label: string; value: React.ReactNode; className?: string }> = ({ label, value, className }) => (
  <div className={cn('rounded-lg border border-slate-200 bg-slate-50 px-3 py-3', className)}>
    <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</div>
    <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
  </div>
);
