
import React from 'react';
import { Match } from '@/types';
import MatchRow from './MatchRow';
import TeamLogo from '../shared/TeamLogo';
import { Clock, TrendingUp } from 'lucide-react';
import { ESSENCE } from '@/lib/essence';

interface MatchCardProps {
    match: Match;
    viewMode: 'GRID' | 'LIST';
    isPinned: boolean;
    isLive: boolean;
    isFinal: boolean;
    hasAction: boolean;
    onSelect: () => void;
    onTogglePin: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
}

const MatchCard: React.FC<MatchCardProps> = ({
    match,
    viewMode,
    isPinned,
    isLive,
    isFinal,
    hasAction,
    onSelect,
    onTogglePin
}) => {
    // LIST VIEW: Delegate to MatchRow (Already matches "All Tab")
    if (viewMode === 'LIST') {
        return (
            <MatchRow
                match={match}
                isPinned={isPinned}
                isLive={isLive}
                isFinal={isFinal}
                onSelect={onSelect}
                onTogglePin={(e) => onTogglePin(match.id, e)}
            />
        );
    }

    // GRID VIEW: Redesigned to match MatchRow aesthetics
    const homeWinner = isFinal && match.homeScore > match.awayScore;
    const awayWinner = isFinal && match.awayScore > match.homeScore;

    // Formatting Clock & Period
    let clockDisplay = match.displayClock || match.minute || '';
    let periodDisplay = match.period ? (match.sport === 'SOCCER' ? '' : `Q${match.period}`) : '';

    if (!isLive && !isFinal) {
        clockDisplay = new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        periodDisplay = new Date(match.startTime).toLocaleDateString([], { weekday: 'short' });
    }

    return (
        <div
            onClick={onSelect}
            className="group relative overflow-hidden hover:border-white/[0.08] transition-all duration-200 cursor-pointer flex flex-col h-full hover:-translate-y-0.5 select-none"
            style={{
                backgroundColor: ESSENCE.colors.surface.card,
                borderRadius: ESSENCE.radius.xl,
                border: `1px solid ${ESSENCE.colors.border.default}`,
                boxShadow: ESSENCE.shadows.obsidian,
            }}
        >
            {/* Obsidian Specular Edge Light */}
            <div
                className={isLive ? "absolute top-0 left-0 right-0 h-px z-20 animate-[breathe_3.5s_ease-in-out_infinite]" : "absolute top-0 left-0 right-0 h-px z-20"}
                style={{
                    background: `linear-gradient(90deg, transparent, ${ESSENCE.colors.accent.mintEdge} 30%, ${ESSENCE.colors.accent.mintEdge} 70%, transparent)`,
                    opacity: isLive ? undefined : 0.65,
                }}
            />

            {/* Status Header - Mimics MatchRow's Status Column */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-edge-subtle" style={{ backgroundColor: ESSENCE.colors.surface.elevated }}>
                <div className="flex items-center gap-2">
                    {isLive ? (
                        <div className="flex items-center gap-2">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                            </span>
                            <div className="flex flex-col leading-none">
                                <span className="text-caption font-bold text-rose-500 uppercase tracking-widest">Live</span>
                                <span className="text-caption text-white font-mono mt-0.5 font-bold">{clockDisplay}</span>
                            </div>
                        </div>
                    ) : isFinal ? (
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full" />
                            <span className="text-caption font-bold text-zinc-500 uppercase tracking-widest">Final</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <div className="p-1 rounded bg-white/5 text-zinc-500">
                                <Clock size={10} />
                            </div>
                            <div className="flex flex-col leading-none">
                                <span className="text-footnote font-bold text-zinc-300 tabular-nums">{clockDisplay}</span>
                                <span className="text-label text-zinc-600 uppercase font-bold">{periodDisplay}</span>
                            </div>
                        </div>
                    )}
                </div>

                <button
                    onClick={(e) => { e.stopPropagation(); onTogglePin(match.id, e); }}
                    className={`p-1.5 rounded-lg hover:bg-white/10 transition-colors ${isPinned ? 'text-amber-400' : 'text-zinc-600 group-hover:text-zinc-400'}`}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                </button>
            </div>

            {/* Teams & Scores */}
            <div className="p-4 flex-1 flex flex-col justify-center gap-4 relative">
                {/* Away */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <TeamLogo logo={match.awayTeam.logo} name={match.awayTeam.name} className="w-8 h-8 object-contain" />
                        <div className="min-w-0 flex flex-col">
                            <span className={`text-body-lg font-semibold tracking-tight truncate ${awayWinner || !isFinal ? 'text-white' : 'text-zinc-500'}`}>
                                {match.awayTeam.name}
                            </span>
                            <span className="text-caption text-zinc-600 font-mono">{match.awayTeam.record}</span>
                        </div>
                    </div>
                    <span className={`text-2xl font-mono font-bold tracking-tighter ${isLive || isFinal ? (awayWinner ? 'text-white' : 'text-zinc-500') : 'text-zinc-700'}`}>
                        {isLive || isFinal ? match.awayScore : '-'}
                    </span>
                </div>

                {/* Home */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <TeamLogo logo={match.homeTeam.logo} name={match.homeTeam.name} className="w-8 h-8 object-contain" />
                        <div className="min-w-0 flex flex-col">
                            <span className={`text-body-lg font-semibold tracking-tight truncate ${homeWinner || !isFinal ? 'text-white' : 'text-zinc-500'}`}>
                                {match.homeTeam.name}
                            </span>
                            <span className="text-caption text-zinc-600 font-mono">{match.homeTeam.record}</span>
                        </div>
                    </div>
                    <span className={`text-2xl font-mono font-bold tracking-tighter ${isLive || isFinal ? (homeWinner ? 'text-white' : 'text-zinc-500') : 'text-zinc-700'}`}>
                        {isLive || isFinal ? match.homeScore : '-'}
                    </span>
                </div>
            </div>

            {/* Footer / Odds - Styled to match MatchRow cells */}
            <div className="px-4 py-3 border-t border-edge-subtle flex items-center justify-between h-[52px]" style={{ backgroundColor: ESSENCE.colors.surface.elevated }}>
                <div className="flex items-center gap-2">
                    {(match.odds?.spread !== null && match.odds?.spread !== undefined && match.odds.spread !== '-') && (
                        <div className="flex flex-col items-start justify-center px-2.5 py-1 rounded bg-[#121212] border border-white/5 min-w-[64px]">
                            <span className="text-label text-zinc-500 uppercase font-bold leading-none mb-1">Spread</span>
                            <span className="text-small font-mono font-bold text-white leading-none tracking-tight">
                                {Number(match.odds.spread) === 0 ? 'PK' : match.odds.spread}
                            </span>
                        </div>
                    )}
                    {(match.odds?.overUnder !== null && match.odds?.overUnder !== undefined && match.odds.overUnder !== '-') && (
                        <div className="flex flex-col items-start justify-center px-2.5 py-1 rounded bg-[#121212] border border-white/5 min-w-[64px]">
                            <span className="text-label text-zinc-500 uppercase font-bold leading-none mb-1">Total</span>
                            <span className="text-small font-mono font-bold text-white leading-none tracking-tight">
                                {String(match.odds.overUnder).replace(/[OU]/g, '').trim()}
                            </span>
                        </div>
                    )}
                </div>

                {hasAction && (
                    <div className="flex items-center gap-1.5 text-caption font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                        <TrendingUp size={10} />
                        <span>Action</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MatchCard;
