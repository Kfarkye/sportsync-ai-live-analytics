
import React from 'react';
import { cn } from '@/lib/essence';

interface OddsCellProps {
  label: string;
  value?: string;
  subValue?: string;
  isLive?: boolean;
  active?: boolean;
  result?: 'covered' | 'lost' | 'push' | 'winning' | 'losing' | null;
}

const OddsCell = ({ label, value, subValue, isLive, active, result }: OddsCellProps) => {
  // Empty State
  if (!value || value === '-' || value === 'N/A') {
    return (
      <div className="flex flex-col items-center justify-center min-w-[48px] md:min-w-[56px] h-[44px] opacity-20 select-none">
        <div className="w-2 h-0.5 bg-zinc-500 rounded-full" />
      </div>
    );
  }

  // Result Styling - Compact
  let valueColor = isLive ? "text-[#FF375F]" : "text-zinc-200 group-hover/cell:text-white";
  let borderColor = "border-[#27272a]";
  let bgColor = "bg-[#121214]";
  let labelColor = "text-zinc-600 group-hover/cell:text-zinc-500";

  if (result === 'covered' || result === 'winning') {
    valueColor = "text-[#4ADE80] font-bold";
    bgColor = "bg-emerald-500/[0.08]";
    borderColor = "border-emerald-500/20";
  } else if (result === 'lost' || result === 'losing') {
    valueColor = "text-zinc-500 line-through decoration-zinc-600/50";
    bgColor = "bg-[#18181a]";
    borderColor = "border-edge-subtle";
  } else if (result === 'push') {
    valueColor = "text-amber-400";
    bgColor = "bg-amber-500/[0.08]";
    borderColor = "border-amber-500/20";
  } else if (active) {
    bgColor = "bg-overlay-emphasis";
    borderColor = "border-white/10";
    valueColor = "text-white";
  }

  return (
    <div className={cn(
        "group/cell relative flex flex-col items-center justify-center min-w-[48px] md:min-w-[56px] h-[44px] rounded-md border transition-all duration-200 cursor-default",
        borderColor,
        bgColor,
        result ? "shadow-sm" : "hover:bg-overlay-muted hover:border-white/[0.1]"
    )}>
        <div className="flex flex-col items-center leading-none gap-0.5">
            <div className="flex items-baseline gap-0.5">
                <span className={cn("text-small font-mono font-medium tracking-tighter tabular-nums transition-colors", valueColor)}>
                    {value}
                </span>
                {subValue && subValue !== '-' && (
                    <span className="text-label text-zinc-500 tabular-nums scale-90 origin-bottom-left">
                        {subValue}
                    </span>
                )}
            </div>
            <span className={cn("text-nano font-bold uppercase tracking-wider transition-colors", labelColor)}>
                {label}
            </span>
        </div>
        
        {/* Live Active Indicator */}
        {isLive && (result === 'covered' || result === 'winning') && (
           <div className="absolute top-1 right-1 w-1 h-1 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_4px_rgba(16,185,129,0.8)]" />
        )}
    </div>
  );
};

export default OddsCell;
