import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Team } from '@/types';
import { dbService, TeamMetrics } from '../../services/dbService';
import { cn } from '@/lib/essence';

const MotionDiv = motion.div;

interface StatsComparisonProps {
    homeTeam: Team;
    awayTeam: Team;
    homeColor?: string;
    awayColor?: string;
}

/**
 * MARKET EFFICIENCY - STATE OF THE ART
 * 
 * Design Pattern: Matches defensive stats visual pattern
 * - Centered metric label
 * - Left-right team value positioning
 * - Bar growing from center
 * - Explicit delta values (+2.5, -1.2)
 * - No jargon, no interpretation required
 */

// Helper: Format delta with sign and color
const DeltaValue = ({ value, label }: { value: number; label?: string }) => {
    const isPositive = value > 0.5;
    const isNegative = value < -0.5;

    return (
        <div className="flex items-center gap-1.5">
            <span className={cn(
                "text-[12px] font-mono font-bold tabular-nums",
                isPositive ? "text-emerald-400" : isNegative ? "text-rose-400" : "text-slate-500"
            )}>
                {value > 0 ? '+' : ''}{value.toFixed(1)}
            </span>
            {label && (
                <span className={cn(
                    "text-[8px] font-black uppercase tracking-widest",
                    isPositive ? "text-emerald-500/60" : isNegative ? "text-rose-500/60" : "text-slate-500"
                )}>
                    {label}
                </span>
            )}
        </div>
    );
};

// Metric Row Component - Matches defensive stats pattern
const MetricRow = ({
    label,
    awayValue,
    homeValue,
    awayDelta,
    homeDelta,
    deltaLabel,
    awayName,
    homeName
}: {
    label: string;
    awayValue: number;
    homeValue: number;
    awayDelta: number;
    homeDelta: number;
    deltaLabel: string;
    awayName: string;
    homeName: string;
}) => {
    // Calculate bar percentages (normalized to max of both values)
    const maxVal = Math.max(awayValue, homeValue);
    const awayPct = (awayValue / maxVal) * 100;
    const homePct = (homeValue / maxVal) * 100;

    // Determine advantage
    const awayAdvantage = awayValue > homeValue;
    const homeAdvantage = homeValue > awayValue;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="py-6"
        >
            {/* Centered Label */}
            <div className="text-center mb-4">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em]">
                    {label}
                </span>
            </div>

            {/* Values + Bar */}
            <div className="flex items-center gap-4">
                {/* Away Team Value */}
                <div className="w-24 text-left">
                    <div className={cn(
                        "text-[20px] font-mono font-black tabular-nums leading-none mb-1",
                        awayAdvantage ? "text-slate-900" : "text-slate-500"
                    )}>
                        {awayValue.toFixed(1)}
                    </div>
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                        {awayName}
                    </div>
                    <DeltaValue value={awayDelta} label={deltaLabel} />
                </div>

                {/* Center Bar */}
                <div className="flex-1 relative h-2 bg-slate-200 rounded-full overflow-hidden">
                    {/* Away Bar (grows from center to left) */}
                    <MotionDiv
                        initial={{ width: 0 }}
                        whileInView={{ width: `${awayPct / 2}%` }}
                        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        className={cn(
                            "absolute right-1/2 top-0 h-full rounded-l-full origin-right",
                            awayAdvantage ? "bg-slate-900" : "bg-slate-300"
                        )}
                    />

                    {/* Home Bar (grows from center to right) */}
                    <MotionDiv
                        initial={{ width: 0 }}
                        whileInView={{ width: `${homePct / 2}%` }}
                        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        className={cn(
                            "absolute left-1/2 top-0 h-full rounded-r-full origin-left",
                            homeAdvantage ? "bg-slate-900" : "bg-slate-300"
                        )}
                    />

                    {/* Center Divider */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-4 bg-slate-200 z-10" />
                </div>

                {/* Home Team Value */}
                <div className="w-24 text-right">
                    <div className={cn(
                        "text-[20px] font-mono font-black tabular-nums leading-none mb-1",
                        homeAdvantage ? "text-slate-900" : "text-slate-500"
                    )}>
                        {homeValue.toFixed(1)}
                    </div>
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                        {homeName}
                    </div>
                    <div className="flex justify-end">
                        <DeltaValue value={homeDelta} label={deltaLabel} />
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

const StatsComparison: React.FC<StatsComparisonProps> = ({
    homeTeam,
    awayTeam
}) => {
    const [homeMetrics, setHomeMetrics] = useState<TeamMetrics | null>(null);
    const [awayMetrics, setAwayMetrics] = useState<TeamMetrics | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchMetrics = async () => {
            setIsLoading(true);
            const [home, away] = await Promise.all([
                dbService.getTeamMetrics(homeTeam.name),
                dbService.getTeamMetrics(awayTeam.name)
            ]);
            setHomeMetrics(home);
            setAwayMetrics(away);
            setIsLoading(false);
        };

        fetchMetrics();
    }, [homeTeam.name, awayTeam.name]);

    if (isLoading) return (
        <div className="p-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-slate-300 border-t-zinc-400 rounded-full animate-spin" />
        </div>
    );

    if (!homeMetrics || !awayMetrics) return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-16 flex flex-col items-center justify-center"
        >
            <div className="w-14 h-14 rounded-2xl bg-slate-200 border border-slate-200 flex items-center justify-center mb-4">
                <div className="w-5 h-5 border-2 border-slate-300 border-dashed rounded-full animate-pulse" />
            </div>
            <span className="text-[11px] font-black text-slate-500 uppercase tracking-[0.2em]">
                Team Metrics Unavailable
            </span>
        </motion.div>
    );

    // --- MARKET BASELINE (NBA averages) ---
    const MARKET_PACE = 100.0;
    const MARKET_ORTG = 114.5;
    const MARKET_DRTG = 114.5;

    // Calculate deltas
    const homePace = Number(homeMetrics.pace) || 100;
    const awayPace = Number(awayMetrics.pace) || 100;
    const homeOrtg = Number(homeMetrics.offensive_rating) || 114;
    const awayOrtg = Number(awayMetrics.offensive_rating) || 114;
    const homeDrtg = Number(homeMetrics.defensive_rating) || 114;
    const awayDrtg = Number(awayMetrics.defensive_rating) || 114;

    const metrics = [
        {
            id: 'pace',
            label: 'Pace (Possessions per Game)',
            awayValue: awayPace,
            homeValue: homePace,
            awayDelta: awayPace - MARKET_PACE,
            homeDelta: homePace - MARKET_PACE,
            deltaLabel: 'vs avg'
        },
        {
            id: 'ortg',
            label: 'Offensive Rating (Points per 100)',
            awayValue: awayOrtg,
            homeValue: homeOrtg,
            awayDelta: awayOrtg - MARKET_ORTG,
            homeDelta: homeOrtg - MARKET_ORTG,
            deltaLabel: 'vs avg'
        },
        {
            id: 'drtg',
            label: 'Defensive Rating (Points per 100)',
            awayValue: awayDrtg,
            homeValue: homeDrtg,
            // For defense, LOWER is better, so invert the delta display
            awayDelta: MARKET_DRTG - awayDrtg,
            homeDelta: MARKET_DRTG - homeDrtg,
            deltaLabel: 'better'
        }
    ];

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-transparent py-4"
        >
            {/* Header */}
            <div className="mb-6 border-b border-slate-200 pb-4">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                    Team Efficiency
                </span>
            </div>

            {/* Metrics Grid */}
            <div className="divide-y divide-slate-200">
                {metrics.map((metric) => (
                    <MetricRow
                        key={metric.id}
                        label={metric.label}
                        awayValue={metric.awayValue}
                        homeValue={metric.homeValue}
                        awayDelta={metric.awayDelta}
                        homeDelta={metric.homeDelta}
                        deltaLabel={metric.deltaLabel}
                        awayName={awayTeam.shortName || awayTeam.name}
                        homeName={homeTeam.shortName || homeTeam.name}
                    />
                ))}
            </div>
        </motion.div>
    );
};

export default StatsComparison;
