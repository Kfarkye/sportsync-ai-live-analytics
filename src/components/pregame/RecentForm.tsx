import React from 'react';
import { motion } from 'framer-motion';
import { TeamStats } from '../../services/espnPreGame';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '../../lib/essence';

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

/**
 * RecentForm v3.0 — Jony Ive Redesign
 * 
 * Philosophy: "Remove until it breaks, then add one thing back."
 * - Eliminated HOME/AWAY labels (context is obvious)
 * - Simplified date to abbreviated month + day
 * - Single-line score with subtle margin indicator
 * - Increased vertical rhythm for breathing room
 * - Refined streak dots with proportional sizing
 */

// Streak Timeline: Proportional dots, no shadows
const StreakTimeline = ({ games, teamColor }: { games: any[]; teamColor?: string }) => {
  return (
    <div className="flex items-center gap-1">
      {games.map((g, i) => {
        const result = g.result || 'D';
        const isWin = result === 'W';
        const isLoss = result === 'L';
        const color = isWin && teamColor ? `#${teamColor.replace('#', '')}` : undefined;

        return (
          <div
            key={i}
            className={cn(
              "rounded-full transition-all duration-300",
              isWin ? "w-2 h-2" : "w-1.5 h-1.5",
              isWin ? "bg-white" : isLoss ? "bg-rose-500/60" : "bg-zinc-600"
            )}
            style={isWin && color ? { backgroundColor: color } : undefined}
          />
        );
      })}
    </div>
  );
};

// Minimal Game Row: Pure restraint
const GameRow = ({ game, align = 'left', teamColor }: { game: any; align?: 'left' | 'right'; teamColor?: string }) => {
  const result = (game.result as 'W' | 'L' | 'D') || 'D';
  const teamScore = parseInt(game.teamScore) || 0;
  const oppScore = parseInt(game.opponent?.score) || 0;
  const margin = teamScore - oppScore;

  // Abbreviated date format
  const monthAbbr = game.date
    ? new Date(game.date).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
    : '';
  const dayNum = game.date ? new Date(game.date).getDate() : '';

  const isWin = result === 'W';
  const resultColor = isWin && teamColor
    ? `#${teamColor.replace('#', '')}`
    : isWin ? '#fff' : result === 'L' ? '#71717a' : '#52525b';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.3 }}
      className={cn(
        "flex items-center py-3 border-b border-white/[0.03] last:border-0 transition-colors duration-200",
        align === 'right' ? "flex-row-reverse" : ""
      )}
    >
      {/* Date: Minimal */}
      <div className={cn("w-14 shrink-0", align === 'right' ? "text-right" : "text-left")}>
        <span className="text-[10px] font-medium text-zinc-600 tabular-nums">
          {monthAbbr} {dayNum}
        </span>
      </div>

      {/* Opponent */}
      <div className={cn("flex-1 flex items-center gap-3", align === 'right' ? "flex-row-reverse" : "")}>
        <TeamLogo logo={game.opponent?.logo} className="w-6 h-6" />
        <span className="text-[14px] font-medium text-zinc-300 tracking-tight">
          {game.opponent?.shortName || game.opponent?.name?.split(' ').pop() || '—'}
        </span>
      </div>

      {/* Result: Single elegant line */}
      <div className={cn("flex items-center gap-2", align === 'right' ? "flex-row-reverse" : "")}>
        <span
          className="text-[13px] font-semibold tabular-nums tracking-tight uppercase"
          style={{ color: resultColor }}
        >
          {isWin ? 'W' : 'L'}
        </span>
        <span className="text-[11px] text-zinc-600 tabular-nums">
          {teamScore}–{oppScore}
        </span>
      </div>
    </motion.div>
  );
};

const RecentForm: React.FC<RecentFormProps> = ({ homeTeam, awayTeam, homeName, awayName, homeColor, awayColor }) => {
  const awayGames = awayTeam?.last5 || [];
  const homeGames = homeTeam?.last5 || [];

  if (!homeTeam && !awayTeam) return null;

  return (
    <div className="px-1">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16">

        {/* Away Team */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-2.5 rounded-sm" style={{ backgroundColor: awayColor || '#52525b' }} />
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.15em]">
                {awayName}
              </span>
            </div>
            <StreakTimeline games={awayGames} teamColor={awayColor} />
          </div>
          <div className="space-y-1">
            {awayGames.map((g: any, i: number) => (
              <GameRow key={i} game={g} align="left" teamColor={awayColor} />
            ))}
          </div>
        </section>

        {/* Home Team */}
        <section>
          <div className="flex items-center justify-between flex-row-reverse mb-4">
            <div className="flex items-center gap-1.5 flex-row-reverse">
              <div className="w-1 h-2.5 rounded-sm" style={{ backgroundColor: homeColor || '#52525b' }} />
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.15em]">
                {homeName}
              </span>
            </div>
            <StreakTimeline games={homeGames} teamColor={homeColor} />
          </div>
          <div className="space-y-1">
            {homeGames.map((g: any, i: number) => (
              <GameRow key={i} game={g} align="right" teamColor={homeColor} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default RecentForm;