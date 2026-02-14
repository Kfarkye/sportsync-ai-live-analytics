
import React, { useState } from 'react';
import { RosterPlayer } from '../../services/espnPreGame';
import { Team, Sport } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/essence';
import TeamLogo from '../shared/TeamLogo';

const MotionDiv = motion.div;

interface LineupPropsProps {
    homeRoster: RosterPlayer[];
    awayRoster: RosterPlayer[];
    homeTeam: Team;
    awayTeam: Team;
}

/**
 * PRODUCTION-GRADE PROP CARD
 * Semantic: Each element has documented meaning.
 * 
 * COLOR SEMANTICS:
 * - Team accent bar: Identity anchor
 * - Emerald: Over (bullish)
 * - Rose: Under (bearish)
 * - Indigo: Market/category indicator
 */
const PropCard: React.FC<{ player: RosterPlayer; teamColor: string }> = ({ player, teamColor }) => {
    const [imgError, setImgError] = useState(false);

    return (
        <div className="relative overflow-hidden rounded-lg bg-[#111113] border border-white/[0.04] shadow-lg group hover:border-white/[0.12] transition-all duration-300">
            {/* Team Identity Bar */}
            <div
                className="absolute top-0 left-0 w-[3px] h-full opacity-70 group-hover:opacity-100 transition-opacity"
                style={{ backgroundColor: teamColor }}
            />

            <div className="p-5 pl-6 relative z-10">
                {/* Header: Player Identity */}
                <div className="flex items-start justify-between mb-5">
                    <div className="flex items-center gap-4">
                        {/* Player Headshot */}
                        <div className="relative w-14 h-14 rounded-full bg-zinc-900 border border-white/10 overflow-hidden shadow-[inset_0_0_20px_rgba(0,0,0,0.5)] shrink-0">
                            {!imgError ? (
                                <img
                                    src={player.headshot}
                                    alt={player.name}
                                    className="w-full h-full object-cover opacity-95 group-hover:opacity-100 transition-opacity"
                                    loading="lazy"
                                    onError={() => setImgError(true)}
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                                    <span className="text-xs font-bold text-zinc-600">
                                        {player.jersey || '—'}
                                    </span>
                                </div>
                            )}
                        </div>
                        <div>
                            <div className="text-[14px] font-bold text-white leading-tight mb-1.5 tracking-tight">
                                {player.name}
                            </div>
                            <div className="flex items-center gap-2.5">
                                <span className="text-[10px] font-bold text-zinc-500 bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.04]">
                                    {player.position}
                                </span>
                                <span className="text-[10px] font-mono text-zinc-600">
                                    #{player.jersey}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Market Type Badge */}
                    <div className="px-3 py-1.5 rounded-md bg-indigo-500/10 border border-indigo-500/20">
                        <span className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.15em]">
                            {player.prop.market}
                        </span>
                    </div>
                </div>

                {/* Main Data: Line & Over/Under */}
                <div className="flex items-end justify-between bg-black/40 rounded-md p-4 border border-white/[0.03]">
                    <div className="flex flex-col">
                        <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] mb-2">
                            Projected Line
                        </span>
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-black text-white tabular-nums tracking-tighter leading-none">
                                {player.prop.line}
                            </span>
                            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide">
                                {player.prop.market?.split(' ')[0] || 'PTS'}
                            </span>
                        </div>
                    </div>

                    {/* Over/Under Buttons */}
                    <div className="flex gap-2">
                        <button className="flex flex-col items-center justify-center bg-[#0F0F0F] hover:bg-emerald-500/10 border border-white/[0.04] hover:border-emerald-500/30 rounded-md h-12 w-14 transition-all duration-300 group/btn">
                            <span className="text-[8px] font-bold text-zinc-600 uppercase mb-1 group-hover/btn:text-emerald-500/70">
                                Over
                            </span>
                            <span className="text-[13px] font-mono font-bold text-zinc-300 group-hover/btn:text-emerald-400 tabular-nums">
                                {player.prop.over}
                            </span>
                        </button>
                        <button className="flex flex-col items-center justify-center bg-[#0F0F0F] hover:bg-rose-500/10 border border-white/[0.04] hover:border-rose-500/30 rounded-md h-12 w-14 transition-all duration-300 group/btn">
                            <span className="text-[8px] font-bold text-zinc-600 uppercase mb-1 group-hover/btn:text-rose-500/70">
                                Under
                            </span>
                            <span className="text-[13px] font-mono font-bold text-zinc-300 group-hover/btn:text-rose-400 tabular-nums">
                                {player.prop.under}
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

/**
 * Empty State Component
 */
const EmptyState = () => (
    <div className="col-span-full py-20 flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-full bg-zinc-900 border border-white/[0.04] flex items-center justify-center mb-4">
            <div className="w-4 h-4 border-2 border-zinc-700 border-dashed rounded-full animate-spin [animation-duration:3s]" />
        </div>
        <div className="text-[11px] font-semibold text-zinc-600 uppercase tracking-[0.2em]">
            Props Unavailable
        </div>
        <div className="text-[10px] text-zinc-700 mt-1">
            Check back closer to game time
        </div>
    </div>
);

/**
 * MAIN LINEUP PROPS COMPONENT
 */
const LineupProps: React.FC<LineupPropsProps> = ({ homeRoster, awayRoster, homeTeam, awayTeam }) => {
    const [activeTab, setActiveTab] = useState<'home' | 'away'>('home');
    const activeRoster = activeTab === 'home' ? homeRoster : awayRoster;
    const activeTeam = activeTab === 'home' ? homeTeam : awayTeam;

    return (
        <div className="bg-[#080808] border border-white/[0.04] rounded-lg overflow-hidden shadow-2xl">
            {/* Tab Header */}
            <div className="flex border-b border-white/[0.05] bg-[#111113]">
                <button
                    onClick={() => setActiveTab('home')}
                    className={cn(
                        "flex-1 py-4 text-[11px] font-bold uppercase tracking-[0.2em] transition-all duration-300 relative flex items-center justify-center gap-3",
                        activeTab === 'home'
                            ? "text-white bg-white/[0.02]"
                            : "text-zinc-500 hover:text-zinc-300"
                    )}
                >
                    <TeamLogo logo={homeTeam.logo} className="w-5 h-5" />
                    {homeTeam.shortName}
                    {activeTab === 'home' && (
                        <MotionDiv
                            layoutId="lineup-tab-indicator"
                            className="absolute bottom-0 left-0 w-full h-[2px] bg-indigo-500"
                        />
                    )}
                </button>
                <div className="w-[1px] bg-white/[0.05]" />
                <button
                    onClick={() => setActiveTab('away')}
                    className={cn(
                        "flex-1 py-4 text-[11px] font-bold uppercase tracking-[0.2em] transition-all duration-300 relative flex items-center justify-center gap-3",
                        activeTab === 'away'
                            ? "text-white bg-white/[0.02]"
                            : "text-zinc-500 hover:text-zinc-300"
                    )}
                >
                    <TeamLogo logo={awayTeam.logo} className="w-5 h-5" />
                    {awayTeam.shortName}
                    {activeTab === 'away' && (
                        <MotionDiv
                            layoutId="lineup-tab-indicator"
                            className="absolute bottom-0 left-0 w-full h-[2px] bg-indigo-500"
                        />
                    )}
                </button>
            </div>

            {/* Content Grid */}
            <div className="p-5 bg-[#080808] min-h-[320px]">
                <AnimatePresence mode='wait'>
                    <MotionDiv
                        key={activeTab}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
                        className="grid grid-cols-1 md:grid-cols-2 gap-4"
                    >
                        {activeRoster && activeRoster.length > 0 ? (
                            activeRoster.map((p) => (
                                <PropCard key={p.id} player={p} teamColor={activeTeam.color || '#6366f1'} />
                            ))
                        ) : (
                            <EmptyState />
                        )}
                    </MotionDiv>
                </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-[#111113] border-t border-white/[0.05] flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/60 animate-pulse" />
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.15em]">
                        Live Projections
                    </span>
                </div>
                <span className="text-[9px] text-zinc-700 font-mono">
                    Powered by DraftKings
                </span>
            </div>
        </div>
    );
};

export default LineupProps;
