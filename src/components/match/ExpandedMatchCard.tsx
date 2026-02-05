import React, { useMemo } from 'react';
import { Match } from '@/types';
import TeamLogo from '../shared/TeamLogo';
import { analyzeSpread, analyzeTotal } from '../../utils/oddsUtils';
import { Check, X } from 'lucide-react';

interface ExpandedMatchCardProps {
  match: Match;
  onClick: () => void;
}

type BetResult = 'win' | 'loss' | 'push' | null;

interface ResultBadgeProps {
  label: string;
  value: string;
  result: BetResult;
}

const ResultBadge: React.FC<ResultBadgeProps> = ({ label, value, result }) => {
  const styles = {
    win: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    loss: 'bg-red-500/10 border-red-500/20 text-red-400',
    push: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
    null: 'bg-zinc-800/50 border-zinc-700 text-zinc-500'
  };

  const icons = {
    win: <Check size={12} strokeWidth={3} />,
    loss: <X size={12} strokeWidth={3} />,
    push: <span className="text-[10px] font-bold">P</span>,
    null: null
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${styles[result ?? 'null']}`}>
      <span className="text-[10px] uppercase tracking-wider opacity-60">{label}</span>
      <span className="font-bold font-mono">{value}</span>
      {icons[result ?? 'null']}
    </div>
  );
};

const TeamRow: React.FC<{
  team: Match['homeTeam'];
  score: number;
  isWinner: boolean;
}> = ({ team, score, isWinner }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-3">
      <TeamLogo logo={team.logo} name={team.name} className="w-7 h-7" />
      <div>
        <span className={`font-semibold ${isWinner ? 'text-white' : 'text-zinc-500'}`}>
          {team.shortName || team.name}
        </span>
        <span className="text-[10px] text-zinc-600 ml-2 font-mono">
          {team.record || ''}
        </span>
      </div>
    </div>
    <div className="flex items-center gap-2">
      {isWinner && <Check size={14} className="text-emerald-400" />}
      <span className={`text-xl font-bold font-mono tabular-nums ${isWinner ? 'text-white' : 'text-zinc-600'}`}>
        {score}
      </span>
    </div>
  </div>
);

const ExpandedMatchCard: React.FC<ExpandedMatchCardProps> = ({ match, onClick }) => {
  const spreadData = useMemo(() => analyzeSpread(match), [match]);
  const totalData = useMemo(() => analyzeTotal(match), [match]);

  const homeWinner = match.homeScore > match.awayScore;
  const awayWinner = match.awayScore > match.homeScore;

  const spreadResult: BetResult = spreadData.result === 'won' ? 'win'
    : spreadData.result === 'push' ? 'push'
      : spreadData.result === 'lost' ? 'loss'
        : null;

  const totalResult: BetResult = totalData.result === 'PUSH' ? 'push'
    : totalData.result ? 'win'
      : null;

  const spreadDisplay = spreadData.line !== null
    ? `${spreadData.isHomeFav ? match.homeTeam.abbreviation || match.homeTeam.shortName : match.awayTeam.abbreviation || match.awayTeam.shortName} ${spreadData.display}`
    : null;

  const totalDisplay = totalData.line !== null
    ? `${totalData.result === 'OVER' ? 'O' : totalData.result === 'UNDER' ? 'U' : ''} ${totalData.displayLine}`
    : null;

  return (
    <div
      onClick={onClick}
      className="bg-[#0A0A0A] border border-white/[0.06] rounded-2xl p-5 cursor-pointer hover:border-white/[0.12] hover:bg-white/[0.01] transition-all duration-200"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full" />
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Final</span>
        </div>
        <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wide">
          {match.leagueId?.toUpperCase() || match.sport}
        </span>
      </div>

      {/* Teams */}
      <div className="space-y-3 mb-5">
        <TeamRow team={match.awayTeam} score={match.awayScore} isWinner={awayWinner} />
        <div className="h-px bg-white/[0.04]" />
        <TeamRow team={match.homeTeam} score={match.homeScore} isWinner={homeWinner} />
      </div>

      {/* Betting Results */}
      {(spreadDisplay || totalDisplay) && (
        <div className="pt-4 border-t border-white/[0.06] flex flex-wrap gap-2">
          {spreadDisplay && (
            <ResultBadge label="ATS" value={spreadDisplay} result={spreadResult} />
          )}
          {totalDisplay && (
            <ResultBadge label="O/U" value={totalDisplay} result={totalResult} />
          )}
        </div>
      )}
    </div>
  );
};

export default ExpandedMatchCard;
