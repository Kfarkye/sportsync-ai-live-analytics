import React from 'react';
import type { ComponentType } from 'react';
import { TrendingUp, Users, Trophy, Activity } from 'lucide-react';

interface MarketIntelligenceProps {
    marketIntel?: {
        spread?: { home: number; away: number };
        total?: { over: number; under: number };
        moneyline?: { home: number; away: number };
        openingLine?: string;
        openingTotal?: string;
    };
    coaches?: {
        home?: { name: string; record: string };
        away?: { name: string; record: string };
    };
    homeTeamName: string;
    awayTeamName: string;
    isLive?: boolean;
}

const IntelligenceMetric = ({
    label,
    value,
    subValue,
    icon: Icon,
    colorClass = "text-zinc-400"
}: {
    label: string;
    value: string;
    subValue: string;
    icon: ComponentType<{ size?: number; className?: string }>;
    colorClass?: string;
}) => (
    <div className="flex flex-col gap-1.5 p-4 rounded-2xl bg-overlay-subtle border border-edge-subtle hover:bg-overlay-muted transition-colors">
        <div className="flex items-center gap-2">
            <Icon size={12} className={colorClass} />
            <span className="text-label font-black text-zinc-500 uppercase tracking-widest">{label}</span>
        </div>
        <div className="text-sm font-mono font-bold text-zinc-200">{value}</div>
        <div className="text-nano font-medium text-zinc-600 uppercase tracking-tight">{subValue}</div>
    </div>
);

const MarketIntelligence: React.FC<MarketIntelligenceProps> = ({ marketIntel, coaches, homeTeamName, awayTeamName, isLive }) => {
    // 1. Determine if Betting Splits are notable
    const hasSplits = !!(marketIntel?.spread || marketIntel?.total || marketIntel?.moneyline);
    const isSpreadNotable = marketIntel?.spread && Math.abs(marketIntel.spread.home - marketIntel.spread.away) >= 15;
    const isTotalNotable = marketIntel?.total && Math.abs(marketIntel.total.over - marketIntel.total.under) >= 15;

    // 2. Determine if Coaching Data is valid (Avoid "Pro Staff" placeholders)
    const hasHomeCoach = !!coaches?.home?.name && coaches.home.name !== 'Pro Staff';
    const hasAwayCoach = !!coaches?.away?.name && coaches.away.name !== 'Pro Staff';
    const hasTacticalData = hasHomeCoach || hasAwayCoach;

    if (!hasSplits && !hasTacticalData) return null;

    // Dynamic Grid Logic: 1 column if only one section exists
    const gridCols = (hasSplits && hasTacticalData) ? 'md:grid-cols-2' : 'grid-cols-1';

    return (
        <div className="relative overflow-hidden rounded-[24px] border border-edge-subtle bg-[#111113] shadow-2xl group flex flex-col transition-all duration-500 hover:border-white/[0.12]">
            {/* Ambient Background Glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.04] via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

            <div className="p-7">
                <div className={`grid grid-cols-1 ${gridCols} gap-10`}>
                    {/* Market HUD */}
                    {hasSplits && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-1.5 opacity-60">
                                <TrendingUp size={10} className="text-zinc-400" />
                                <span className="text-label font-black text-zinc-400 uppercase tracking-widest italic">{isLive ? 'Closing Consensus' : 'Betting Trends'}</span>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {marketIntel?.spread && (
                                    <IntelligenceMetric
                                        label="Spread"
                                        value={`${marketIntel.spread.home}% / ${marketIntel.spread.away}%`}
                                        subValue={isSpreadNotable ? "Heavy Action" : "Split Bets"}
                                        icon={Users}
                                        colorClass={isSpreadNotable ? "text-emerald-400" : "text-zinc-500"}
                                    />
                                )}
                                {marketIntel?.total && (
                                    <IntelligenceMetric
                                        label="Total (O/U)"
                                        value={`${marketIntel.total.over}% Over`}
                                        subValue={isTotalNotable ? "Heavy Action" : "Split Bets"}
                                        icon={Activity}
                                        colorClass={isTotalNotable ? "text-amber-400" : "text-zinc-500"}
                                    />
                                )}
                            </div>

                            {marketIntel?.openingLine && (
                                <div className="px-4 py-2 rounded-xl bg-overlay-ghost border border-edge-ghost flex justify-between items-center group/opening">
                                    <span className="text-label font-black text-zinc-600 uppercase tracking-widest">{isLive ? 'Full Game Line' : 'Opening Line'}</span>
                                    <span className="text-caption font-mono font-bold text-zinc-500 tracking-tighter italic group-hover:text-zinc-300 transition-colors">
                                        {marketIntel.openingLine}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Tactical HUD (Coaches) */}
                    {hasTacticalData && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-1.5 opacity-60">
                                <Trophy size={10} className="text-zinc-400" />
                                <span className="text-label font-black text-zinc-400 uppercase tracking-widest italic">Head Coaches</span>
                            </div>

                            <div className="space-y-3">
                                {hasHomeCoach && (
                                    <div className="flex justify-between items-center p-3.5 rounded-2xl bg-overlay-subtle border border-edge-subtle hover:bg-overlay-muted transition-all">
                                        <div className="flex flex-col">
                                            <span className="text-small font-bold text-zinc-100">{coaches?.home?.name}</span>
                                            <span className="text-nano font-black text-zinc-500 uppercase tracking-widest">{homeTeamName}</span>
                                        </div>
                                        <div className="text-caption font-mono font-bold text-zinc-400 bg-zinc-800/50 px-2 py-0.5 rounded border border-zinc-700/50">
                                            {coaches?.home?.record || '—'}
                                        </div>
                                    </div>
                                )}
                                {hasAwayCoach && (
                                    <div className="flex justify-between items-center p-3.5 rounded-2xl bg-overlay-subtle border border-edge-subtle hover:bg-overlay-muted transition-all">
                                        <div className="flex flex-col">
                                            <span className="text-small font-bold text-zinc-100">{coaches?.away?.name}</span>
                                            <span className="text-nano font-black text-zinc-500 uppercase tracking-widest">{awayTeamName}</span>
                                        </div>
                                        <div className="text-caption font-mono font-bold text-zinc-400 bg-zinc-800/50 px-2 py-0.5 rounded border border-zinc-700/50">
                                            {coaches?.away?.record || '—'}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MarketIntelligence;
