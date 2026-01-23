
import React from 'react';
import { TeamSplitData } from '../types/venue';
import TeamLogo from './shared/TeamLogo';
import { ArrowUpRight, ArrowDownRight, Home, Plane, Activity, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';

const MotionDiv = motion.div as any;

interface VenueSplitsCardProps {
  data: TeamSplitData;
  teamColor?: string;
}

const MetricRow = ({
  label,
  value,
  max,
  barColor,
  icon: Icon,
  delay = 0
}: {
  label: string,
  value: number,
  max: number,
  barColor: string,
  icon: any,
  delay?: number
}) => {
  const widthPct = max > 0 ? Math.max((value / max) * 100, 2) : 0; // Min 2% width if val > 0

  return (
    <div className="flex flex-col gap-2 mb-4 group/row">
      <div className="flex justify-between items-center text-[10px]">
        <div className="flex items-center gap-1.5 text-zinc-500 group-hover/row:text-zinc-300 transition-colors">
          <Icon size={10} strokeWidth={2.5} />
          <span className="font-bold uppercase tracking-[0.15em]">{label}</span>
        </div>
        <span className="font-sans font-semibold text-white tabular-nums tracking-tight">
          {value.toFixed(1)} <span className="text-zinc-600 text-[9px] font-sans font-normal">PPG</span>
        </span>
      </div>

      <div className="h-2 w-full bg-white/[0.04] rounded-full overflow-hidden relative">
        <MotionDiv
          initial={{ width: 0 }}
          animate={{ width: `${widthPct}%` }}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1], delay }}
          className="h-full rounded-full relative z-10"
          style={{ backgroundColor: barColor, boxShadow: `0 0 12px ${barColor}40` }}
        />
        {/* Subtle shine effect on bar */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none z-20" />
      </div>
    </div>
  );
};

const VenueSplitsCard: React.FC<VenueSplitsCardProps> = ({ data, teamColor = '#4F46E5' }) => {
  const homeVal = data.scoring?.home || 0;
  const awayVal = data.scoring?.away || 0;
  const delta = data.scoring?.delta || (homeVal - awayVal);
  const isPositive = delta > 0;

  // Calculate max for scale (add padding)
  const maxVal = Math.max(homeVal, awayVal) * 1.15;

  return (
    <MotionDiv
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1.0] }}
      className="relative flex flex-col py-4 border-b border-white/[0.04] last:border-0"
    >

      {/* Header */}
      <div className="pb-2 flex justify-between items-start relative z-10">
        <div className="flex items-center gap-4">
          <MotionDiv
            whileHover={{ rotate: 5, scale: 1.1 }}
            className="w-12 h-12 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center shadow-lg backdrop-blur-md"
          >
            <TeamLogo logo={data.team.logo_url} name={data.team.name} className="w-8 h-8 object-contain drop-shadow-md" />
          </MotionDiv>
          <div className="flex flex-col">
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em] leading-none mb-1.5">Team Analysis</span>
            <h3 className="text-lg font-bold text-white tracking-tight leading-none truncate max-w-[140px]">
              {data.team.name}
            </h3>
          </div>
        </div>

        {/* Delta Badge - Forensic Pill */}
        <div
          className="flex flex-col items-end justify-center px-2 py-1 rounded-lg border bg-white/[0.02] border-white/[0.06]"
        >
          <span className="text-[8px] font-black uppercase tracking-widest mb-0.5 text-zinc-500">
            Home Edge
          </span>
          <div className="flex items-center gap-1 font-mono font-bold text-sm leading-none text-white">
            {isPositive ? <ArrowUpRight size={12} style={{ color: teamColor }} /> : <ArrowDownRight size={12} className="text-rose-400" />}
            {Math.abs(delta).toFixed(1)}
          </div>
        </div>
      </div>

      {/* Bars */}
      <div className="py-4 relative z-10">
        <MetricRow
          label="Home"
          value={homeVal}
          max={maxVal}
          barColor={teamColor}
          icon={Home}
          delay={0.1}
        />
        <MetricRow
          label="Away"
          value={awayVal}
          max={maxVal}
          barColor="#52525b" // Zinc-600 for contrast ("Road Gray")
          icon={Plane}
          delay={0.2}
        />
      </div>

      {/* Footer Context */}
      <div className="py-2 flex items-center justify-between opacity-60">

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-zinc-500">
            <TrendingUp size={10} />
            <span className="text-[9px] font-bold uppercase tracking-widest">L3 Trend</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xs font-sans font-semibold tabular-nums text-zinc-300 group-hover:text-white transition-colors">{data.recency?.last_3_avg?.toFixed(1) || '-'}</span>
            <span className="text-[9px] text-zinc-600">PPG</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1.5 text-zinc-500">
            <span className="text-[9px] font-bold uppercase tracking-widest">Sample</span>
            <Activity size={10} />
          </div>
          <span className="text-xs font-sans font-semibold tabular-nums text-zinc-300 group-hover:text-white transition-colors">
            {data.games?.total || 0} <span className="text-[9px] text-zinc-600 font-sans font-normal">Gms</span>
          </span>
        </div>

      </div>
    </MotionDiv>
  );
};

export default VenueSplitsCard;
