
import React, { useEffect, useState, useMemo } from 'react';
import { Match, Sport, RecentFormGame } from '@/types';
import { fetchTeamLastFive } from '../services/espnService';
import TeamLogo from './shared/TeamLogo';
import { Flame, ShieldAlert, TrendingUp, Check, X, Minus, Activity, Lock, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import OddsCard from './betting/OddsCard';
import { ESSENCE } from '@/lib/essence';

// --- Types ---

interface Streak {
  teamId: string;
  type: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  label: string;
  value: string;
  icon?: React.ElementType;
}

// --- Logic: Streak Calculator ---

const calculateStreaks = (games: RecentFormGame[], teamId: string, sport: Sport): Streak[] => {
  if (!games || games.length === 0) return [];

  const streaks: Streak[] = [];
  
  // 1. Current Form Streak (W/L)
  let currentWin = 0;
  for (const g of games) { if (g.result === 'W') currentWin++; else break; }
  
  let currentLoss = 0;
  for (const g of games) { if (g.result === 'L') currentLoss++; else break; }

  let currentNoWin = 0;
  for (const g of games) { if (g.result !== 'W') currentNoWin++; else break; }

  // 2. Logic to push streaks
  if (currentWin >= 2) streaks.push({ teamId, type: 'POSITIVE', label: 'Wins', value: String(currentWin), icon: Flame });
  if (currentLoss >= 3) streaks.push({ teamId, type: 'NEGATIVE', label: 'Losses', value: String(currentLoss), icon: ShieldAlert });
  if (currentNoWin >= 3 && currentLoss < 3) streaks.push({ teamId, type: 'NEGATIVE', label: 'No wins', value: String(currentNoWin) });

  // 3. Scoring Trends (Over/Under)
  const isSoccer = sport === Sport.SOCCER;
  const isBasketball = sport === Sport.NBA || sport === Sport.COLLEGE_BASKETBALL;
  const threshold = isSoccer ? 2.5 : isBasketball ? 220 : 45;
  
  let overCount = 0;
  games.forEach(g => {
      const total = parseInt(g.teamScore) + parseInt(g.opponent.score);
      if (total > threshold) overCount++;
  });

  const sampleSize = games.length;
  if (overCount / sampleSize >= 0.8) {
      streaks.push({ 
          teamId, 
          type: 'NEUTRAL', 
          label: `Over ${threshold} ${isSoccer ? 'goals' : 'points'}`, 
          value: `${overCount}/${sampleSize}`, 
          icon: TrendingUp 
      });
  }

  // 4. Clean Sheets (Soccer)
  if (isSoccer) {
      let noCleanSheet = 0;
      for (const g of games) {
          if (parseInt(g.opponent.score) > 0) noCleanSheet++;
          else break;
      }
      if (noCleanSheet >= 3) {
          streaks.push({ teamId, type: 'NEGATIVE', label: 'No clean sheet', value: String(noCleanSheet), icon: AlertCircle });
      }
  }

  return streaks;
};

// --- Sub-Components ---

const StreakRow: React.FC<{ streak: Streak, teamLogo: string }> = ({ streak, teamLogo }) => (
    <div className="flex items-center justify-between py-4 border-b border-white/[0.06] last:border-0 group">
        <div className="flex items-center gap-4">
            <TeamLogo logo={teamLogo} className="w-6 h-6 opacity-90" />
            <span className="text-[13px] font-medium text-zinc-300 group-hover:text-white transition-colors">{streak.label}</span>
        </div>
        <div className="flex items-center gap-3">
            {streak.icon && (
                <streak.icon 
                    size={14} 
                    className={streak.type === 'POSITIVE' ? 'text-emerald-500' : streak.type === 'NEGATIVE' ? 'text-rose-500' : 'text-amber-500'} 
                />
            )}
            <span className={`text-[13px] font-mono font-bold ${streak.type === 'POSITIVE' ? 'text-emerald-400' : 'text-white'}`}>
                {streak.value}
            </span>
        </div>
    </div>
);

const SectionHeader = ({ title }: { title: string }) => (
    <div className="flex items-center justify-center mb-6 relative">
        <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/[0.06]"></div>
        </div>
        <span className="relative px-4 text-[11px] font-bold text-zinc-500 uppercase tracking-widest bg-[#111113]">
            {title}
        </span>
    </div>
);

const MatchesTab = ({ match }: { match: Match }) => {
    const [streaks, setStreaks] = useState<Streak[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                // Fetch recent games
                const [homeGames, awayGames] = await Promise.all([
                    fetchTeamLastFive(match.homeTeam.id, match.sport, match.leagueId),
                    fetchTeamLastFive(match.awayTeam.id, match.sport, match.leagueId)
                ]);

                const homeStreaks = calculateStreaks(homeGames, match.homeTeam.id, match.sport);
                const awayStreaks = calculateStreaks(awayGames, match.awayTeam.id, match.sport);

                setStreaks([...homeStreaks, ...awayStreaks]);
            } catch (e) {
                console.error("Failed to calc streaks", e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [match]);

    return (
        <div className="space-y-2">
            {/* Using the standard OddsCard grid instead of custom snapshot */}
            <div className="mb-8">
                <OddsCard match={match} />
            </div>
            
            <SectionHeader title="Team Streaks" />
            
            <div className="bg-[#111113] border border-white/[0.04] rounded-[14px] px-6 py-2 shadow-lg min-h-[200px]">
                {loading ? (
                    <div className="flex items-center justify-center h-[200px] text-zinc-500 text-xs animate-pulse">
                        Analyzing trends...
                    </div>
                ) : streaks.length === 0 ? (
                    <div className="flex items-center justify-center h-[200px] text-zinc-600 text-xs italic">
                        No significant streaks detected.
                    </div>
                ) : (
                    streaks.map((s, i) => (
                        <StreakRow 
                            key={i} 
                            streak={s} 
                            teamLogo={s.teamId === match.homeTeam.id ? match.homeTeam.logo : match.awayTeam.logo} 
                        />
                    ))
                )}
            </div>

            <div className="mt-8">
                <SectionHeader title="Probability" />
                <div className="bg-[#111113] border border-white/[0.04] rounded-[14px] p-6 flex justify-between items-center">
                     <div className="flex items-center gap-3">
                        <TeamLogo logo={match.homeTeam.logo} className="w-8 h-8" />
                        <div className="flex flex-col">
                            <span className="text-sm font-bold text-white">
                                {match.odds?.homeWin && String(match.odds.homeWin).includes('-') ? 'Favorite' : 'Underdog'}
                            </span>
                            <span className="text-[10px] text-zinc-500">Implied Probability</span>
                        </div>
                     </div>
                     
                     <div className="text-right">
                        <div className="text-xl font-mono font-bold text-emerald-400">
                            {match.win_probability?.home ? `${match.win_probability.home.toFixed(0)}%` : '-'}
                        </div>
                        <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest bg-zinc-800/50 px-2 py-0.5 rounded">
                            {match.odds?.homeWin || '-'}
                        </span>
                     </div>
                </div>
            </div>
        </div>
    );
};

export default MatchesTab;
