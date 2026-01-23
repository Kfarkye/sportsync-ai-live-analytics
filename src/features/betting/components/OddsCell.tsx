
import React from 'react';
import { cn } from '../../../lib/essence';

interface OddsCellProps {
  label?: string;
  value?: string | number;
  isLive?: boolean;
  result?: 'won' | 'lost' | 'push' | 'void' | null;
  highlight?: boolean;
}

export const OddsCell = ({ label, value, isLive, result, highlight }: OddsCellProps) => {
  const displayValue = value === undefined || value === null || value === '' ? '-' : String(value);
  const isEmpty = displayValue === '-';

  // State Styles
  let bg = "bg-[#121214]";
  let text = "text-zinc-200";
  let border = "border-white/[0.04]";

  if (result === 'won') {
    bg = "bg-emerald-500/[0.08]";
    text = "text-emerald-400 font-bold";
    border = "border-emerald-500/20";
  } else if (result === 'lost') {
    text = "text-zinc-600 line-through";
  } else if (result === 'push' || result === 'void') {
    text = "text-amber-400";
    bg = "bg-amber-500/[0.08]";
    border = "border-amber-500/20";
  } else if (highlight) {
    bg = "bg-white/[0.06]";
    text = "text-white";
  }

  return (
    <div className={cn(
      "flex flex-col items-center justify-center h-[48px] rounded-lg border transition-all relative overflow-hidden",
      bg, border,
      isEmpty ? "opacity-30" : "hover:border-white/10"
    )}>
      <span className={cn("text-[13px] font-mono tracking-tight tabular-nums z-10", text)}>
        {displayValue}
      </span>
      {label && (
        <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-wider absolute bottom-1">
          {label}
        </span>
      )}
      {/* Live Pulse for Winning Bets */}
      {isLive && result === 'won' && (
        <div className="absolute top-1 right-1 w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
      )}
    </div>
  );
};
