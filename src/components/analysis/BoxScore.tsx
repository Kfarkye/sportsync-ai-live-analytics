import React, { useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import { User, Target } from 'lucide-react';
import { Match, StatItem, Team, PlayerPropBet, Sport } from '../../types';
import TeamLogo from '../shared/TeamLogo';
import { cn, ESSENCE } from '../../lib/essence';
import { getMatchDisplayStats, hasLineScoreData } from '../../utils/statDisplay';

// ============================================================================
// 1. LINE SCORE GRID - ELITE EDITION
// ============================================================================

interface LineScoreGridProps {
  match: Match;
  isLive?: boolean;
}

/**
 * LineScoreGrid - Period by period breakdown with elite polish
 */
export const LineScoreGrid: React.FC<LineScoreGridProps> = memo(({ match, isLive }) => {
  const sportKey = String(match.sport || '').toUpperCase();
  const leagueKey = match.leagueId?.toLowerCase() || '';
  const isTennis = match.sport === Sport.TENNIS || ['atp', 'wta'].includes(leagueKey);
  const isBaseball = sportKey.includes('BASEBALL') || leagueKey.includes('mlb');
  const isSoccer = sportKey.includes('SOCCER') || leagueKey.includes('mls');
  const isHockey = sportKey.includes('HOCKEY') || leagueKey.includes('nhl');
  const isBasketball = sportKey.includes('BASKETBALL') || leagueKey.includes('nba') || leagueKey.includes('wnba');
  const isFootball = sportKey.includes('FOOTBALL') || leagueKey.includes('nfl') || leagueKey.includes('cfb');

  const periods = useMemo(() => {
    const homeLen = match.homeTeam.linescores?.length || 0;
    const awayLen = match.awayTeam.linescores?.length || 0;
    const regulation = (() => {
      if (isTennis) return Math.max(homeLen, awayLen, 3);
      if (typeof match.regulationPeriods === 'number' && match.regulationPeriods > 0) {
        return match.regulationPeriods;
      }
      if (isSoccer) return 2;
      if (isHockey) return 3;
      if (isBaseball) return 9;
      if (isFootball) return 4;
      if (isBasketball) return 4;
      return 4;
    })();
    return Math.max(homeLen, awayLen, regulation);
  }, [
    match.homeTeam.linescores,
    match.awayTeam.linescores,
    match.regulationPeriods,
    isTennis,
    isSoccer,
    isHockey,
    isBaseball,
    isFootball,
    isBasketball,
  ]);

  const periodRange = Array.from({ length: periods }, (_, i) => i + 1);

  const getScore = (team: Team, period: number) => {
    const ls = team.linescores?.find(l => l.period === period);
    if (!ls) return '-';
    const raw = ls.value;
    if (isTennis && raw !== undefined && raw !== null && typeof ls.tiebreak === 'number') {
      return `${raw}(${ls.tiebreak})`;
    }
    return raw !== undefined && raw !== null ? String(raw) : '-';
  };
  const getPeriodLabel = (period: number) => {
    const label =
      match.homeTeam.linescores?.find(l => l.period === period)?.label ||
      match.awayTeam.linescores?.find(l => l.period === period)?.label;
    if (label) return String(label).toUpperCase();
    if (isTennis) return `S${period}`;
    if (isBaseball) return String(period);
    const regulation = typeof match.regulationPeriods === 'number' && match.regulationPeriods > 0
      ? match.regulationPeriods
      : (isSoccer ? 2 : isHockey ? 3 : isFootball || isBasketball ? 4 : 4);
    if (isSoccer && period > regulation) {
      if (period === regulation + 1) return 'ET';
      if (period === regulation + 2) return 'PEN';
      return `ET${period - regulation}`;
    }
    if (period > regulation) {
      const otIndex = period - regulation;
      return otIndex <= 1 ? 'OT' : `OT${otIndex}`;
    }
    return String(period);
  };

  const hasLines = hasLineScoreData(match);

  if (!hasLines) {
    const homeTotal = match.homeScore ?? 0;
    const awayTotal = match.awayScore ?? 0;
    const isHomeWinning = homeTotal > awayTotal;
    const isAwayWinning = awayTotal > homeTotal;
    const isTied = homeTotal === awayTotal;

    return (
      <div className="w-full overflow-x-auto no-scrollbar">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="py-3 text-left w-28 px-1">
                <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Team</span>
              </th>
              <th className="py-3 px-3 text-center w-16 bg-white/[0.03] rounded-t-lg">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Tot</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {[match.awayTeam, match.homeTeam].map((team, idx) => {
              const isWinning = idx === 0 ? isAwayWinning : isHomeWinning;
              const totalScore = idx === 0 ? awayTotal : homeTotal;
              return (
                <tr key={team.id} className="group transition-colors hover:bg-white/[0.015]">
                  <td className="py-4 px-1">
                    <div className="flex items-center gap-2.5">
                      <TeamLogo logo={team.logo} className="w-6 h-6 opacity-80 group-hover:opacity-100 transition-opacity" />
                      <span className="text-[10px] font-black text-zinc-400 group-hover:text-zinc-200 transition-colors uppercase tracking-widest">
                        {team.abbreviation || team.shortName}
                      </span>
                    </div>
                  </td>
                  <td className={cn("py-4 px-3 text-center bg-white/[0.03] border-l border-white/[0.04]", idx === 1 && "rounded-b-lg")}>
                    <span className={cn(
                      "font-mono text-[18px] font-black tabular-nums tracking-tighter",
                      isWinning ? "text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]" : "text-zinc-400",
                      isTied && "text-zinc-300"
                    )}>
                      {totalScore}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Determine winner for total highlight
  const homeTotal = match.homeScore ?? 0;
  const awayTotal = match.awayScore ?? 0;
  const isHomeWinning = homeTotal > awayTotal;
  const isAwayWinning = awayTotal > homeTotal;
  const isTied = homeTotal === awayTotal;

  // Stagger animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.08 }
    }
  };

  const rowVariants = {
    hidden: { opacity: 0, x: -8 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: "easeOut" as const } }
  };

  return (
    <motion.div
      className="w-full overflow-x-auto no-scrollbar"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-white/[0.06]">
            <th className="py-3 text-left w-28 px-1">
              <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Team</span>
            </th>
            {periodRange.map(p => (
              <th key={p} className="py-3 px-3 text-center">
                <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">
                  {getPeriodLabel(p)}
                </span>
              </th>
            ))}
            <th className="py-3 px-3 text-center w-16 bg-white/[0.03] rounded-t-lg">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Tot</span>
            </th>
          </tr>
        </thead>
        <motion.tbody variants={containerVariants}>
          {[match.awayTeam, match.homeTeam].map((team, idx) => {
            const isWinning = idx === 0 ? isAwayWinning : isHomeWinning;
            const totalScore = idx === 0 ? awayTotal : homeTotal;

            return (
              <motion.tr
                key={team.id}
                className="group transition-colors hover:bg-white/[0.015]"
                variants={rowVariants}
              >
                <td className="py-4 px-1">
                  <div className="flex items-center gap-2.5">
                    <TeamLogo logo={team.logo} className="w-6 h-6 opacity-80 group-hover:opacity-100 transition-opacity" />
                    <span className="text-[10px] font-black text-zinc-400 group-hover:text-zinc-200 transition-colors uppercase tracking-widest">
                      {team.abbreviation || team.shortName}
                    </span>
                  </div>
                </td>
                {periodRange.map(p => (
                  <td key={p} className="py-4 px-3 text-center">
                    <span className="font-mono text-[14px] font-medium text-zinc-500 tabular-nums">
                      {getScore(team, p)}
                    </span>
                  </td>
                ))}
                <td className={cn(
                  "py-4 px-3 text-center bg-white/[0.03] border-l border-white/[0.04]",
                  idx === 1 && "rounded-b-lg"
                )}>
                  <span className={cn(
                    "font-mono text-[18px] font-black tabular-nums tracking-tighter",
                    isWinning ? "text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]" : "text-zinc-400",
                    isTied && "text-zinc-300"
                  )}>
                    {totalScore}
                  </span>
                </td>
              </motion.tr>
            );
          })}
        </motion.tbody>
      </table>
    </motion.div>
  );
});

LineScoreGrid.displayName = 'LineScoreGrid';

// ============================================================================
// 2. TEAM STATS GRID
// ============================================================================

interface TeamStatsGridProps {
  stats: StatItem[];
  match: Match;
  colors: { home: string; away: string };
}

/**
 * TeamStatsGrid - Comparison bar chart for match statistics
 */
export const TeamStatsGrid: React.FC<TeamStatsGridProps> = memo(({ stats, colors }) => {
  if (!stats || stats.length === 0) return null;

  return (
    <div className="relative">
      <div className="space-y-5">
        {stats.map((stat, i) => {
          const parseStat = (val: any) => {
            if (typeof val !== 'string' && typeof val !== 'number') return 0;
            const parsed = parseFloat(String(val).replace(/[^0-9.]/g, ''));
            return isNaN(parsed) ? 0 : parsed;
          };

          const hVal = parseStat(stat.homeValue);
          const aVal = parseStat(stat.awayValue);
          const total = hVal + aVal;
          const hPct = total > 0 ? (hVal / total) * 100 : 50;
          const aPct = total > 0 ? (aVal / total) * 100 : 50;

          return (
            <div key={i} className="space-y-2">
              <div className="flex justify-between items-end">
                <span className="text-[12px] font-mono font-semibold text-white/90 tabular-nums">{stat.awayValue}</span>
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.2em]">{stat.label}</span>
                <span className="text-[12px] font-mono font-semibold text-white/90 tabular-nums">{stat.homeValue}</span>
              </div>
              <div className="h-1.5 w-full bg-white/[0.03] rounded-full overflow-hidden flex">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${aPct}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="h-full"
                  style={{ backgroundColor: colors.away, boxShadow: `0 0 12px ${colors.away}30` }}
                />
                <div className="w-px h-full bg-black/40" />
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${hPct}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="h-full"
                  style={{ backgroundColor: colors.home, boxShadow: `0 0 12px ${colors.home}30` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

TeamStatsGrid.displayName = 'TeamStatsGrid';

// ============================================================================
// 3. LIVE PLAYER PROPS
// ============================================================================

interface PlayerPropGroup {
  playerName: string;
  headshotUrl?: string;
  team?: string;
  props: PlayerPropBet[];
}

/**
 * ClassicPlayerProps - Apple x Stripe x Vercel Design Language
 * 
 * Design Principles:
 * - Apple: Clean whitespace, precise typography, subtle hierarchy
 * - Stripe: Table precision, clean data alignment, professional focus
 * - Vercel: Dark-first, monospace numbers, minimal decoration
 */
export const ClassicPlayerProps: React.FC<{ match: Match }> = memo(({ match }) => {
  const dbProps = match.dbProps || [];

  const groups = useMemo(() => {
    const map = new Map<string, PlayerPropGroup>();
    dbProps.forEach(p => {
      if (!map.has(p.playerName)) {
        map.set(p.playerName, {
          playerName: p.playerName,
          headshotUrl: p.headshotUrl,
          team: p.team,
          props: []
        });
      }
      map.get(p.playerName)!.props.push(p);
    });
    return Array.from(map.values());
  }, [dbProps]);

  if (groups.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-zinc-900/50 flex items-center justify-center mb-4">
          <Target size={20} className="text-zinc-700" />
        </div>
        <span className="text-[11px] font-medium text-zinc-600 uppercase tracking-[0.1em]">No Active Props</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div
          key={group.playerName}
          className="group bg-white/[0.02] border border-white/[0.04] rounded-2xl p-4 transition-all active:scale-[0.99] touch-pan-y"
        >
          {/* Player Identity — Concise for mobile */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative w-10 h-10 rounded-full bg-zinc-900 overflow-hidden ring-1 ring-white/10">
              {group.headshotUrl ? (
                <img
                  src={group.headshotUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User size={16} className="text-zinc-700" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-[15px] font-bold text-white tracking-tight truncate leading-none">
                {group.playerName}
              </h4>
              <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest mt-1 opacity-70">
                {group.team}
              </p>
            </div>
          </div>

          {/* High-Density Row Layout */}
          <div className="space-y-1">
            {group.props.map((prop, j) => {
              const isOver = prop.side === 'over';

              return (
                <div
                  key={j}
                  className="flex items-center justify-between py-3 px-3 rounded-xl bg-white/[0.02] border border-white/[0.02] transition-colors active:bg-white/[0.05]"
                >
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-1 h-3 rounded-full",
                      isOver ? "bg-emerald-500/40" : "bg-rose-500/40"
                    )} />
                    <span className="text-[12px] text-zinc-400 font-medium">
                      {prop.betType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="text-[15px] font-black font-mono text-white tabular-nums tracking-tighter">
                      {prop.lineValue}
                    </span>

                    <div className={cn(
                      "flex items-center justify-center min-w-[56px] py-1 px-2 rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all",
                      isOver
                        ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                        : "text-rose-400 bg-rose-500/10 border border-rose-500/20"
                    )}>
                      {prop.side}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});

ClassicPlayerProps.displayName = 'ClassicPlayerProps';

// ============================================================================
// 4. MAIN BOX SCORE COMPONENT
// ============================================================================

const normalizeColor = (color: string | undefined, fallback: string): string => {
  if (!color) return fallback;
  const c = color.trim();
  if (c.startsWith('#')) return c;
  return `#${c}`;
};

/**
 * BoxScore - Primary statistical overview for a match (all sports)
 */
const BoxScore: React.FC<{ match: Match }> = memo(({ match }) => {
  const stats = useMemo(() => getMatchDisplayStats(match, 8), [match]);
  const homeColor = normalizeColor(match.homeTeam?.color, '#3B82F6');
  const awayColor = normalizeColor(match.awayTeam?.color, '#EF4444');

  if (!stats.length && !hasLineScoreData(match)) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Line Score</span>
          </div>
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
            {(match.leagueId || match.sport || '').toString().toUpperCase()}
          </span>
        </div>
        <LineScoreGrid match={match} />
      </div>

      {stats.length > 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Team Stats</span>
          </div>
          <TeamStatsGrid stats={stats} match={match} colors={{ home: homeColor, away: awayColor }} />
        </div>
      )}
    </div>
  );
});

BoxScore.displayName = 'BoxScore';

export default BoxScore;
