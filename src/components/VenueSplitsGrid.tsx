
import React, { useState } from 'react';
import { useScoringSplits } from '../hooks/useScoringSplits';
import VenueSplitsCard from './VenueSplitsCard';
import { Filter, ArrowUpDown, Loader2, MapPin } from 'lucide-react';
import { SortOption, SortOrder } from '@/types/venue';
import { motion, AnimatePresence } from 'framer-motion';

const MotionDiv = motion.div;

const LEAGUES = [
  { id: 'nba', label: 'NBA' },
  { id: 'nfl', label: 'NFL' },
  { id: 'nhl', label: 'NHL' },
  { id: 'mlb', label: 'MLB' },
  { id: 'ncaab', label: 'NCAAB' },
];

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'delta', label: 'Home Advantage (Delta)' },
  { id: 'home_ppg', label: 'Home Scoring' },
  { id: 'away_ppg', label: 'Away Scoring' },
  { id: 'last_3', label: 'Hot Streaks (L3)' },
];

const VenueSplitsGrid: React.FC = () => {
  const [activeLeague, setActiveLeague] = useState('nba');
  const [sortBy, setSortBy] = useState<SortOption>('delta');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const { data, isLoading } = useScoringSplits({
    leagueId: activeLeague,
    sortBy,
    sortOrder
  });

  const toggleSort = () => {
    setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
  };

  return (
    <div className="w-full space-y-6">
      
      {/* Controls Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl bg-[#09090B] border border-white/[0.08] shadow-lg">
        
        {/* League Selector */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 md:pb-0">
          <div className="p-2 bg-white/5 rounded-lg mr-2">
            <MapPin size={16} className="text-zinc-400" />
          </div>
          {LEAGUES.map(league => (
            <button
              key={league.id}
              onClick={() => setActiveLeague(league.id)}
              className={`
                px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap
                ${activeLeague === league.id 
                  ? 'bg-white text-black shadow-lg shadow-white/10' 
                  : 'bg-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}
              `}
            >
              {league.label}
            </button>
          ))}
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-3">
          <div className="relative group">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <select 
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="pl-9 pr-4 py-2 bg-[#121214] border border-white/10 rounded-lg text-xs font-medium text-white appearance-none focus:outline-none focus:border-white/20 hover:bg-[#161618] transition-colors cursor-pointer min-w-[160px]"
            >
              {SORT_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>

          <button 
            onClick={toggleSort}
            className="p-2 rounded-lg bg-[#121214] border border-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowUpDown size={14} className={sortOrder === 'asc' ? 'rotate-180' : ''} />
          </button>
        </div>
      </div>

      {/* Grid Content */}
      <div className="min-h-[400px]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
            <Loader2 className="w-8 h-8 animate-spin mb-4 text-zinc-700" />
            <span className="text-xs font-bold uppercase tracking-widest">Analyzing Venue Data...</span>
          </div>
        ) : (
          <MotionDiv 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            <AnimatePresence>
              {data?.data.map((teamData, idx) => (
                <MotionDiv
                  key={teamData.team.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <VenueSplitsCard data={teamData} />
                </MotionDiv>
              ))}
            </AnimatePresence>
          </MotionDiv>
        )}
      </div>
    </div>
  );
};

export default VenueSplitsGrid;
