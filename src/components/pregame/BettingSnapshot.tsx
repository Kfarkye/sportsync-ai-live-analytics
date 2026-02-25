
import React from 'react';
import { MatchOdds, Team, Sport } from '@/types';
import { ArrowUpRight, TrendingUp, Percent } from 'lucide-react';

interface BettingSnapshotProps {
  odds: MatchOdds;
  homeTeam: Team;
  awayTeam: Team;
  sport?: Sport;
}

const calculateImpliedProb = (oddsStr?: string): string => {
  if (!oddsStr || oddsStr === '-' || oddsStr === 'Even' || oddsStr === 'N/A') return '-';
  const val = parseFloat(oddsStr);
  if (isNaN(val)) return '-';
  
  let prob = 0;
  if (val < 0) {
    prob = (-val) / (-val + 100);
  } else {
    prob = 100 / (val + 100);
  }
  return `${(prob * 100).toFixed(1)}%`;
};

const parseOddsValue = (str?: string | number) => {
  if (str === undefined || str === null || str === '-' || str === 'Even') return { main: '-', juice: '', val: 0 };
  const cleanStr = String(str).replace(/^[OU]\s*/, '');
  const parts = cleanStr.split('(');
  const main = parts[0].trim();
  const juice = parts[1] ? parts[1].replace(')', '').trim() : '-110'; // Default juice if missing usually -110 for spreads/totals
  const val = parseFloat(main);
  return { main, juice, val };
};

const formatVal = (val: number) => val > 0 ? `+${val}` : `${val}`;

const HeaderCell = ({ label, align = 'center' }: { label: string, align?: 'left' | 'center' | 'right' }) => (
    <div className={`
      text-[9px] font-bold text-zinc-500 uppercase tracking-[0.15em] py-2 px-3 border-r border-white/[0.06] last:border-r-0
      ${align === 'left' ? 'text-left' : align === 'right' ? 'text-right' : 'text-center'}
    `}>
        {label}
    </div>
);

const DenseCell = ({ 
  line, 
  juice, 
  highlight,
  isEmpty,
  label
}: { 
  line: string; 
  juice?: string; 
  highlight?: boolean;
  isEmpty?: boolean;
  label?: string;
}) => {
  const prob = !isEmpty && juice ? calculateImpliedProb(juice) : null;

  return (
    <div className={`
      relative flex flex-col justify-center h-[52px] px-3 border-r border-white/[0.06] last:border-r-0
      transition-colors duration-200 cursor-pointer group
      hover:bg-white/[0.02]
      ${highlight ? 'bg-[#53D337]/5' : ''}
    `}>
      {isEmpty ? (
          <span className="text-zinc-800 text-xs font-mono text-center">-</span>
      ) : (
          <div className="flex flex-col gap-0.5">
              <div className="flex justify-between items-baseline w-full">
                  <span className={`text-[13px] font-mono font-bold tracking-tighter ${highlight ? 'text-[#53D337]' : 'text-zinc-200 group-hover:text-white'}`}>
                      {line}
                  </span>
                  {juice && (
                      <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
                          {juice}
                      </span>
                  )}
              </div>
              
              <div className="flex justify-between items-center w-full">
                  {label && <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider">{label}</span>}
                  {prob && prob !== '-' && (
                      <div className="flex items-center gap-1 ml-auto">
                          <span className="text-[9px] font-mono text-zinc-600 group-hover:text-zinc-400 tabular-nums">{prob}</span>
                      </div>
                  )}
              </div>
          </div>
      )}
    </div>
  );
};

const BettingSnapshot: React.FC<BettingSnapshotProps> = ({ odds, homeTeam, awayTeam, sport }) => {
  const homeSpread = parseOddsValue(odds.homeSpread);
  const awaySpread = parseOddsValue(odds.awaySpread);
  const over = parseOddsValue(odds.over || odds.overUnder);
  const under = parseOddsValue(odds.under);
  
  let totalLine = '2.5'; 
  if (sport !== Sport.SOCCER) totalLine = '43.5';

  if (over.main !== '-' && !isNaN(over.val)) totalLine = Math.abs(over.val).toString();
  else if (odds.overUnder) totalLine = String(odds.overUnder).replace(/[OU+]/g, '').trim();

  const homeML = parseOddsValue(odds.homeWin);
  const awayML = parseOddsValue(odds.awayWin);
  const drawML = parseOddsValue(odds.draw);

  // Use abbreviations if available, else fallback to shortName
  const awayName = awayTeam.abbreviation || awayTeam.shortName;
  const homeName = homeTeam.abbreviation || homeTeam.shortName;

  return (
    <div className="bg-[#111113] rounded-xl border border-white/[0.1] overflow-hidden shadow-sm ring-1 ring-white/[0.05]">
        
        {/* Compact Header */}
        <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] bg-[#151517] border-b border-white/[0.04]">
            <HeaderCell label="Market" align="left" />
            <HeaderCell label="Spread" />
            <HeaderCell label="Total" />
            <HeaderCell label="Money" />
        </div>

        {/* Data Grid */}
        <div className="divide-y divide-white/[0.06]">
            
            {/* Away Row */}
            <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] items-stretch hover:bg-white/[0.01]">
                <div className="flex flex-col justify-center px-4 py-2 border-r border-white/[0.06]">
                    <span className="font-bold text-white text-[13px] tracking-tight truncate">{awayName}</span>
                    <span className="text-[9px] text-zinc-500 font-mono mt-0.5">AWAY</span>
                </div>
                <DenseCell 
                    line={awaySpread.main !== '-' ? formatVal(awaySpread.val) : '-'} 
                    juice={awaySpread.juice} 
                />
                <DenseCell 
                    line={`O ${totalLine}`} 
                    juice={over.juice || '-110'} 
                    label="Over"
                />
                <DenseCell 
                    line={awayML.main !== '-' ? formatVal(awayML.val) : '-'} 
                    juice={awayML.main} // ML juice is the odds itself
                    isEmpty={awayML.main === '-'}
                />
            </div>

            {/* Home Row */}
            <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] items-stretch hover:bg-white/[0.01]">
                <div className="flex flex-col justify-center px-4 py-2 border-r border-white/[0.06]">
                    <span className="font-bold text-white text-[13px] tracking-tight truncate">{homeName}</span>
                    <span className="text-[9px] text-zinc-500 font-mono mt-0.5">HOME</span>
                </div>
                <DenseCell 
                    line={homeSpread.main !== '-' ? formatVal(homeSpread.val) : '-'} 
                    juice={homeSpread.juice} 
                />
                <DenseCell 
                    line={`U ${totalLine}`} 
                    juice={under.juice || '-110'} 
                    label="Under"
                />
                <DenseCell 
                    line={homeML.main !== '-' ? formatVal(homeML.val) : '-'} 
                    juice={homeML.main}
                    isEmpty={homeML.main === '-'}
                />
            </div>

            {/* Draw Row (Soccer) */}
            {sport === Sport.SOCCER && (
                <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] items-stretch bg-[#080808]">
                    <div className="flex flex-col justify-center px-4 py-2 border-r border-white/[0.06]">
                        <span className="font-bold text-zinc-400 text-[13px] tracking-tight">Draw</span>
                    </div>
                    <div className="border-r border-white/[0.06] bg-[#111113]/50" />
                    <div className="border-r border-white/[0.06] bg-[#111113]/50" />
                    <DenseCell 
                        line={drawML.main !== '-' ? formatVal(drawML.val) : '-'} 
                        juice={drawML.main}
                        isEmpty={drawML.main === '-'}
                    />
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="bg-[#030303] border-t border-white/[0.04] px-3 py-1.5 flex justify-between items-center">
            <div className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]" />
                <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">Real-time Feed</span>
            </div>
            <div className="flex items-center gap-3">
                <span className="text-[9px] font-mono text-zinc-700">IMP PROB %</span>
                <button className="text-[9px] font-bold text-zinc-500 hover:text-white flex items-center gap-1 transition-colors uppercase tracking-wider group">
                    Full Board
                    <ArrowUpRight className="w-2.5 h-2.5 text-zinc-600 group-hover:text-white transition-colors" />
                </button>
            </div>
        </div>
    </div>
  );
};

export default BettingSnapshot;
