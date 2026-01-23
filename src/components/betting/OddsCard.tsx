
import React, { useMemo, useRef, memo } from 'react';
import { Match, Sport } from '../../types';
import { cn, ESSENCE } from '../../lib/essence';
import { analyzeSpread, analyzeTotal, analyzeMoneyline } from '../../utils/oddsUtils';
import { isGameInProgress, isGameFinished } from '../../utils/matchUtils';
import { TrendingUp, TrendingDown } from 'lucide-react';
import TeamLogo from '../shared/TeamLogo';
import { motion } from 'framer-motion';
import { useValueFlash, institutionalFlashVariants } from '../../hooks/useValueFlash';

/* -------------------------------------------------------------------------- */
/*                               DATA HARDENING LAYER                         */
/* -------------------------------------------------------------------------- */

const useStableOdds = (match: Match) => {
    const cache = useRef<{ spread: any; total: any; ml: any; provider: string; ts: number } | null>(null);

    const currentSpread = useMemo(() => analyzeSpread(match), [match]);
    const currentTotal = useMemo(() => analyzeTotal(match), [match]);
    const currentMl = useMemo(() => analyzeMoneyline(match), [match]);
    const currentProvider = currentSpread.provider;

    const isValid = currentSpread.display !== '-' || currentMl.home !== '-';

    const data = useMemo(() => {
        const incoming = { spread: currentSpread, total: currentTotal, ml: currentMl };
        if (!isValid) return cache.current;

        if (!cache.current) {
            cache.current = { ...incoming, provider: currentProvider, ts: Date.now() };
            return cache.current;
        }

        const simplified = (d: any) => JSON.stringify({
            s: d.spread.display,
            t: d.total.display,
            m: d.ml.home, ma: d.ml.away
        });

        if (simplified(incoming) === simplified(cache.current)) {
            return cache.current;
        }

        cache.current = { ...incoming, provider: currentProvider, ts: Date.now() };
        return cache.current;
    }, [currentSpread, currentTotal, currentMl, isValid, currentProvider]);

    return { data, isStale: !isValid && cache.current !== null };
};

/* -------------------------------------------------------------------------- */
/*                      ELITE DESIGN SYSTEM - UNIFIED                         */
/* -------------------------------------------------------------------------- */

/** Movement indicator for line changes */
const MovementIndicator = memo(({ current, previous }: { current?: string, previous?: string }) => {
    const curVal = current ? parseFloat(current.replace(/[^0-9.-]/g, '')) : undefined;
    const prevVal = previous ? parseFloat(previous.replace(/[^0-9.-]/g, '')) : undefined;

    if (curVal === undefined || prevVal === undefined || curVal === prevVal) return null;
    const diff = curVal - prevVal;
    const isPositive = diff > 0;

    return (
        <div className={`flex items-center gap-0.5 text-[9px] font-semibold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isPositive ? <TrendingUp size={9} strokeWidth={2.5} /> : <TrendingDown size={9} strokeWidth={2.5} />}
            <span className="tabular-nums">{Math.abs(diff).toFixed(1)}</span>
        </div>
    );
});
MovementIndicator.displayName = 'MovementIndicator';

/** Minimal odds cell matching PregameOdds style */
const OddsCell = memo(({ value, subValue, prefix }: { value?: string, subValue?: string, prefix?: string }) => {
    const isFlashing = useValueFlash(value);

    const displayValue = useMemo(() => {
        if (!value || value === '-') return '-';
        if (prefix && !value.startsWith(prefix)) return `${prefix}${value}`;
        return value;
    }, [value, prefix]);

    return (
        <motion.div
            variants={institutionalFlashVariants}
            animate={isFlashing ? "flash" : "initial"}
            className="flex flex-col items-center justify-center py-1"
        >
            <div className="flex items-baseline gap-1">
                <span className="text-[15px] font-semibold text-white tabular-nums tracking-tight">
                    {displayValue}
                </span>
                {subValue && subValue !== '-' && (
                    <span className="text-[10px] text-zinc-500 font-medium tabular-nums">
                        {subValue}
                    </span>
                )}
            </div>
        </motion.div>
    );
});
OddsCell.displayName = 'OddsCell';

export const OddsCard = memo(({ match }: { match: Match }) => {
    const { data, isStale } = useStableOdds(match);
    const isLiveMatch = isGameInProgress(match.status);
    const isLiveOdds = data?.spread?.provider === 'Live' || data?.ml?.provider === 'Live' || match.current_odds?.provider === 'Live';
    const isLive = isLiveMatch || isLiveOdds;
    const isFinal = isGameFinished(match.status);
    const isHalftime = match.status === 'STATUS_HALFTIME' || String(match.status).includes('HALFTIME');

    // Status label logic
    const oddsLabel = isFinal ? 'Closing Lines' : isLive ? 'Live Lines' : 'Game Lines';

    return (
        <div className={cn(
            "relative",
            isStale && "opacity-50 grayscale"
        )}>
            {/* Section Header - Elite Style */}
            <div className="flex items-center gap-2 mb-5">
                <div className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    isFinal ? "bg-zinc-500" : isLive ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"
                )} />
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">
                    {oddsLabel}
                </span>
                {isHalftime && (
                    <div className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/10">
                        <span className="text-[9px] font-bold uppercase text-amber-400">HALF</span>
                    </div>
                )}
            </div>

            {/* Column Headers */}
            <div className="flex items-center gap-4 mb-3 pb-3 border-b border-white/[0.04]">
                <div className="w-28 shrink-0">
                    <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em]">Team</span>
                </div>
                <div className="grid grid-cols-3 gap-2 flex-1">
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] text-center">Spread</div>
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] text-center">
                        {match.sport === Sport.TENNIS ? 'Games' : 'Total'}
                    </div>
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] text-center">Money</div>
                </div>
            </div>

            {/* Away Team Row */}
            <div className="flex items-center gap-4 py-4 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors duration-150 -mx-2 px-2 rounded-lg">
                <div className="w-28 flex items-center gap-2.5 shrink-0">
                    <TeamLogo logo={match.awayTeam.logo} className="w-7 h-7 drop-shadow-md" />
                    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-[0.1em]">
                        {match.awayTeam.abbreviation || match.awayTeam.shortName}
                    </span>
                </div>
                <div className="grid grid-cols-3 gap-2 flex-1">
                    <OddsCell value={data?.spread?.awayDisplay} subValue={data?.spread?.awayJuice} />
                    <OddsCell value={data?.total?.overDisplay} subValue={data?.total?.overJuice} prefix="o" />
                    <OddsCell value={data?.ml?.away} />
                </div>
            </div>

            {/* Home Team Row */}
            <div className="flex items-center gap-4 py-4 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors duration-150 -mx-2 px-2 rounded-lg">
                <div className="w-28 flex items-center gap-2.5 shrink-0">
                    <TeamLogo logo={match.homeTeam.logo} className="w-7 h-7 drop-shadow-md" />
                    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-[0.1em]">
                        {match.homeTeam.abbreviation || match.homeTeam.shortName}
                    </span>
                </div>
                <div className="grid grid-cols-3 gap-2 flex-1">
                    <OddsCell value={data?.spread?.display} subValue={data?.spread?.homeJuice} />
                    <OddsCell value={data?.total?.underDisplay} subValue={data?.total?.underJuice} prefix="u" />
                    <OddsCell value={data?.ml?.home} />
                </div>
            </div>
        </div>
    );
});
OddsCard.displayName = 'OddsCard';

export default OddsCard;
