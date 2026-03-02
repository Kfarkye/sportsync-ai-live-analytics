import React, { type FC, type PropsWithChildren } from 'react';
import { cn } from '@/lib/essence';

export const PageShell: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <div className={cn('min-h-screen bg-zinc-950 text-zinc-100', className)}>
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</div>
  </div>
);

export const TopNav: FC = () => (
  <nav className="mb-6 flex items-center justify-between border-b border-zinc-800 pb-3 sm:mb-8">
    <a href="/" className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-400 hover:text-zinc-100">
      Live Feed
    </a>
    <a href="/soccer" className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-300 hover:text-zinc-100">
      Soccer Hub
    </a>
  </nav>
);

export const Card: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <section className={cn('rounded-xl border border-zinc-800 bg-zinc-900/60', className)}>{children}</section>
);

export const CardHeader: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <header className={cn('border-b border-zinc-800 px-4 py-3 sm:px-5', className)}>{children}</header>
);

export const CardBody: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <div className={cn('px-4 py-4 sm:px-5 sm:py-5', className)}>{children}</div>
);

export const SectionLabel: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <h2 className={cn('text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400', className)}>{children}</h2>
);

export const ValueText: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <span className={cn('font-mono tabular-nums text-zinc-100', className)}>{children}</span>
);

export const DataPill: FC<PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <span className={cn('inline-flex items-center rounded-md border border-zinc-700 px-2 py-1 font-mono text-xs tabular-nums text-zinc-200', className)}>{children}</span>
);

export const EmptyBlock: FC<{ message: string; className?: string }> = ({ message, className }) => (
  <div className={cn('rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-400', className)}>{message}</div>
);

export const LoadingBlock: FC<{ label?: string }> = ({ label = 'Loading data…' }) => (
  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-400">{label}</div>
);

export const MetricCell: FC<{ label: string; value: React.ReactNode; className?: string }> = ({ label, value, className }) => (
  <div className={cn('rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-3', className)}>
    <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</div>
    <div className="mt-1 text-sm font-semibold text-zinc-100">{value}</div>
  </div>
);
