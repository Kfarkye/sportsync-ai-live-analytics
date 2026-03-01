
import React, { useEffect, useState } from 'react';
import { Match, Sport, RecentFormGame } from '@/types';
import { fetchTeamLastFive } from '../services/espnService';
import TeamLogo from './shared/TeamLogo';
import OddsCard from './betting/OddsCard';
import { Flame, ShieldAlert, TrendingUp, AlertCircle } from 'lucide-react';

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
    <div className="group flex items-center justify-between border-b border-zinc-200 py-4 last:border-0">
        <div className="flex items-center gap-4">
            <TeamLogo logo={teamLogo} className="w-6 h-6 opacity-90" />
            <span className="text-[13px] font-medium text-zinc-700 transition-colors group-hover:text-zinc-900">{streak.label}</span>
        </div>
        <div className="flex items-center gap-3">
            {streak.icon && (
                <streak.icon 
                    size={14} 
                    className={streak.type === 'POSITIVE' ? 'text-emerald-500' : streak.type === 'NEGATIVE' ? 'text-rose-500' : 'text-amber-500'} 
                />
            )}
            <span className={`text-[13px] font-mono font-bold ${streak.type === 'POSITIVE' ? 'text-emerald-600' : streak.type === 'NEGATIVE' ? 'text-rose-600' : 'text-zinc-900'}`}>
                {streak.value}
            </span>
        </div>
    </div>
);

const SectionHeader = ({ title }: { title: string }) => (
    <div className="flex items-center justify-center mb-6 relative">
        <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-200"></div>
        </div>
        <span className="relative bg-white px-4 text-[11px] font-bold uppercase tracking-widest text-zinc-600">
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
        <div className="space-y-6">
            {/* Using the standard OddsCard grid instead of custom snapshot */}
            <div>
                <OddsCard match={match} />
            </div>
            
            <SectionHeader title="Team Streaks" />
            
            <div className="min-h-[200px] rounded-[14px] border border-zinc-200 bg-white px-6 py-2 shadow-sm">
                {loading ? (
                    <div className="flex h-[200px] items-center justify-center text-xs text-zinc-500 animate-pulse">
                        Analyzing trends...
                    </div>
                ) : streaks.length === 0 ? (
                    <div className="flex h-[200px] items-center justify-center text-xs italic text-zinc-500">
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

            <div>
                <SectionHeader title="Probability" />
                <div className="flex items-center justify-between rounded-[14px] border border-zinc-200 bg-white p-6 shadow-sm">
                     <div className="flex items-center gap-3">
                        <TeamLogo logo={match.homeTeam.logo} className="w-8 h-8" />
                        <div className="flex flex-col">
                            <span className="text-sm font-bold text-zinc-900">
                                {match.odds?.homeWin && String(match.odds.homeWin).includes('-') ? 'Favorite' : 'Underdog'}
                            </span>
                            <span className="text-[10px] text-zinc-500">Implied Probability</span>
                        </div>
                     </div>
                     
                     <div className="text-right">
                        <div className="text-xl font-mono font-bold text-emerald-600">
                            {match.win_probability?.home ? `${match.win_probability.home.toFixed(0)}%` : '-'}
                        </div>
                        <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-700">
                            {match.odds?.homeWin || '-'}
                        </span>
                     </div>
                </div>
            </div>
        </div>
    );
};

export default MatchesTab;
