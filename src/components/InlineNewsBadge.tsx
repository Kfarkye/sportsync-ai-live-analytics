
import React from 'react';
import { Newspaper, BrainCircuit, Activity, ChevronRight, Zap } from 'lucide-react';
import { BadgeType } from '@/types/matchList';

interface InlineNewsBadgeProps {
  type: BadgeType;
  text: string;
  onClick?: () => void;
}

const CONFIG = {
  NEWS: {
    icon: Newspaper,
    color: 'text-rose-400',
    label: 'NEWS'
  },
  RECAP: {
    icon: Activity,
    color: 'text-violet-400',
    label: 'RECAP'
  },
  EDGE: {
    icon: BrainCircuit,
    color: 'text-emerald-400',
    label: 'EDGE'
  },
  LIVE: {
    icon: Zap,
    color: 'text-red-500',
    label: 'LIVE'
  }
};

const InlineNewsBadge: React.FC<InlineNewsBadgeProps> = ({ type, text, onClick }) => {
  const style = CONFIG[type];
  const Icon = style.icon;

  return (
    <div 
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className={`
        mt-3 px-3 py-2 
        bg-gradient-to-br from-white/[0.04] to-white/[0.01]
        backdrop-blur-md
        border border-slate-200
        rounded-xl
        flex items-center justify-between gap-3
        group cursor-pointer
        hover:from-white/[0.06]
        hover:border-slate-200
        transition-all duration-150
      `}
    >
      <div className={`flex items-center gap-2 ${style.color}`}>
        <Icon size={12} className={type === 'LIVE' ? 'animate-pulse' : ''} />
        <span className="text-[10px] font-bold uppercase tracking-wider">{style.label}</span>
      </div>
      
      <div className="h-3 w-px bg-white/10" />
      
      <span className="text-[13px] text-white/80 font-medium truncate flex-1 leading-none tracking-tight">
        {text}
      </span>
      
      <ChevronRight 
        size={14} 
        className="text-white/30 group-hover:text-white group-hover:translate-x-0.5 transition-all" 
      />
    </div>
  );
};

export default InlineNewsBadge;
