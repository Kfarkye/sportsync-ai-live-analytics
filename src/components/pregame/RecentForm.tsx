// ===================================================================
// RecentForm.tsx
// ARCHITECTURE: "SOTA Production" • Apple/Google Quality Standards
// AESTHETIC: Porsche Luxury • Jony Ive Minimalism • Jobs Narrative
// ===================================================================

import React from 'react';
import { motion } from 'framer-motion';
import { TeamStats } from '../../services/espnPreGame';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '../../lib/essence';

// ─────────────────────────────────────────────────────────────────
// 🎨 DESIGN TOKENS & PHYSICS
// ─────────────────────────────────────────────────────────────────

// "Aluminum Switch" Physics: High stiffness, critical damping
const PHYSICS_SWITCH = { type: "spring", stiffness: 380, damping: 35, mass: 0.8 };
const STAGGER_DELAY = 0.05;

// ─────────────────────────────────────────────────────────────────
// 🧩 TYPES
// ─────────────────────────────────────────────────────────────────

interface RecentFormProps {
  homeTeam: TeamStats;
  awayTeam: TeamStats;
  homeName: string;
  awayName: string;
  homeLogo?: string;
  awayLogo?: string;
  homeColor?: string;
  awayColor?: string;
}

interface RecentOpponent {
  score?: string | number;
  logo?: string;
  shortName?: string;
  name?: string;
}

interface RecentGame {
  result?: 'W' | 'L' | 'D' | string;
  teamScore?: string | number;
  date?: string;
  opponent?: RecentOpponent;
}

// ─────────────────────────────────────────────────────────────────
// 💎 MICRO-COMPONENTS (PURE GEOMETRY)
// ─────────────────────────────────────────────────────────────────

// "Status LED" Stream: Pure CSS indicators for Win/Loss streak
const StreakTimeline = ({ games, teamColor }: { games: RecentGame[]; teamColor?: string }) => {
  return (
    <div className="flex items-center gap-[3px] opacity-90" title="Last 5 Games">
      {games.map((g, i) => {
        const result = g.result || 'D';
        const isWin = result === 'W';
        const isLoss = result === 'L';
        const color = isWin && teamColor ? (teamColor.startsWith('#') ? teamColor : `#${teamColor}`) : undefined;

        return (
          <div key={i} className="relative group/dot">
            <div
              className={cn(
                "rounded-[1px] transition-all duration-300",
                isWin ? "w-1.5 h-3" : "w-1 h-2",
                isWin ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" : isLoss ? "bg-zinc-700" : "bg-zinc-600"
              )}
              style={isWin && color ? { backgroundColor: color, boxShadow: `0 0 8px ${color}66` } : undefined}
            />
          </div>
        );
      })}
    </div>
  );
};

// "Data Row" with Active Laser Interaction
const GameRow = ({
  game,
  align = 'left',
  teamColor
}: {
  game: RecentGame;
  align?: 'left' | 'right';
  teamColor?: string
}) => {
  const result = (game.result as 'W' | 'L' | 'D') || 'D';
  const teamScore = parseInt(String(game.teamScore)) || 0;
  const oppScore = parseInt(String(game.opponent?.score)) || 0;

  // Strict Technical Date Format: "10.24" (Manual parsing to avoid hydration errors)
  const dateObj = game.date ? new Date(game.date) : null;
  const dateStr = dateObj
    ? `${dateObj.getMonth() + 1}.${dateObj.getDate()}`
    : '--.--';

  const isWin = result === 'W';
  const activeColor = teamColor ? (teamColor.startsWith('#') ? teamColor : `#${teamColor}`) : '#fff';

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, x: align === 'left' ? -10 : 10 }, visible: { opacity: 1, x: 0 } }}
      transition={PHYSICS_SWITCH}
      className={cn(
        "group relative flex items-center py-2.5 transition-colors duration-300 hover:bg-white/[0.02] cursor-default",
        align === 'right' ? "flex-row-reverse text-right" : "text-left"
      )}
    >
      {/* Active Laser Line (Symmetrical Interaction) */}
      <div className={cn(
        "absolute top-0 bottom-0 w-[2px] bg-white scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-center opacity-0 group-hover:opacity-100 shadow-[0_0_10px_rgba(255,255,255,0.4)]",
        align === 'right' ? "right-0" : "left-0"
      )} style={{ backgroundColor: isWin ? activeColor : undefined }} />

      {/* 1. Date (Technical Mono) */}
      <div className={cn(
        "w-12 shrink-0 font-mono text-[9px] text-zinc-600 tracking-wider group-hover:text-zinc-400 transition-colors select-none",
        align === 'right' ? "pr-0 pl-2" : "pl-3 pr-2"
      )}>
        {dateStr}
      </div>

      {/* 2. Opponent Identity */}
      <div className={cn(
        "flex-1 flex items-center gap-3 min-w-0 px-2",
        align === 'right' ? "flex-row-reverse justify-end" : ""
      )}>
        <div className="relative w-5 h-5 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity grayscale group-hover:grayscale-0">
          <TeamLogo logo={game.opponent?.logo} className="w-full h-full object-contain" />
        </div>
        <span className="text-[12px] font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors tracking-tight truncate uppercase">
          {game.opponent?.shortName || game.opponent?.name?.split(' ').pop() || 'OPP'}
        </span>
      </div>

      {/* 3. Result Metrics (Instrument Cluster Style) */}
      <div className={cn(
        "w-24 shrink-0 flex items-center gap-2.5 font-mono",
        align === 'right' ? "flex-row-reverse pl-3" : "justify-end pr-3"
      )}>
        <div
          className={cn(
            "flex items-center justify-center w-5 h-5 rounded-[2px] text-[10px] font-bold border transition-colors duration-300",
            isWin
              ? "bg-white/[0.05] border-white/10 text-white shadow-[0_0_8px_rgba(255,255,255,0.05)]"
              : "bg-transparent border-zinc-800 text-zinc-600"
          )}
          style={isWin ? { borderColor: activeColor, color: activeColor } : undefined}
        >
          {result}
        </div>
        <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors tabular-nums tracking-wide">
          {teamScore}-{oppScore}
        </span>
      </div>
    </motion.div>
  );
};

// ─────────────────────────────────────────────────────────────────
// 🏛️ MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

const RecentForm: React.FC<RecentFormProps> = ({
  homeTeam, awayTeam, homeName, awayName, homeColor, awayColor
}) => {
  const awayGames = (awayTeam?.last5 || []) as RecentGame[];
  const homeGames = (homeTeam?.last5 || []) as RecentGame[];

  if (!homeTeam && !awayTeam) return null;

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">

        {/* AWAY TEAM COLUMN */}
        <section>
          {/* Header (Spec Sheet Label) */}
          <div className="flex items-end justify-between mb-6 pb-2 border-b border-white/[0.06]">
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.25em] font-mono select-none">
                01 // AWAY FORM
              </span>
              <div className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full" style={{ backgroundColor: awayColor || '#fff' }} />
                <span className="text-[13px] font-semibold text-zinc-200 tracking-wide uppercase">
                  {awayName}
                </span>
              </div>
            </div>
            <StreakTimeline games={awayGames} teamColor={awayColor} />
          </div>

          {/* List */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-10%" }}
            variants={{ visible: { transition: { staggerChildren: STAGGER_DELAY } } }}
            className="space-y-px"
          >
            {awayGames.map((g, i) => (
              <GameRow key={i} game={g} align="left" teamColor={awayColor} />
            ))}
          </motion.div>
        </section>

        {/* HOME TEAM COLUMN (Mirrored) */}
        <section>
          {/* Header (Mirrored) */}
          <div className="flex items-end justify-between flex-row-reverse mb-6 pb-2 border-b border-white/[0.06]">
            <div className="flex flex-col gap-1 items-end text-right">
              <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.25em] font-mono select-none">
                02 // HOME FORM
              </span>
              <div className="flex items-center gap-2 flex-row-reverse">
                <div className="w-1 h-1 rounded-full" style={{ backgroundColor: homeColor || '#fff' }} />
                <span className="text-[13px] font-semibold text-zinc-200 tracking-wide uppercase">
                  {homeName}
                </span>
              </div>
            </div>
            <StreakTimeline games={homeGames} teamColor={homeColor} />
          </div>

          {/* List */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-10%" }}
            variants={{ visible: { transition: { staggerChildren: STAGGER_DELAY } } }}
            className="space-y-px"
          >
            {homeGames.map((g, i) => (
              <GameRow key={i} game={g} align="right" teamColor={homeColor} />
            ))}
          </motion.div>
        </section>

      </div>
    </div>
  );
};

export default RecentForm;
