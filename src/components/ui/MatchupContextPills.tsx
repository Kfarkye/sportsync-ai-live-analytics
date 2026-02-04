
import React, { memo } from 'react';
import { cn, ESSENCE } from '../../lib/essence';
import {
    MapPin,
    Thermometer,
    Tv,
    Calendar,
    Users,
    Info
} from 'lucide-react';
import { Sport } from '../../types';

interface MatchupContextPillsProps {
    venue?: { name: string; city: string; state: string };
    weather?: { temp: number | string; condition: string } | null;
    broadcast?: string;
    gameContext?: string | null;
    coaches?: { home: string, away: string };
    sport?: Sport;
    className?: string;
}

const ContextPill = ({ icon: Icon, value, color = "text-zinc-500" }: { icon: unknown, value: string, color?: string }) => (
    <div className="flex items-center gap-1.5">
        <Icon size={11} className={color} strokeWidth={2} />
        <span className="text-[10px] font-medium text-zinc-500 tracking-tight whitespace-nowrap">{value}</span>
    </div>
);

export const MatchupContextPills = memo(({
    venue,
    weather,
    broadcast,
    gameContext,
    coaches,
    sport,
    className
}: MatchupContextPillsProps) => {
    const isArenaSport = sport === Sport.NBA || sport === Sport.BASKETBALL || sport === Sport.COLLEGE_BASKETBALL || sport === Sport.WNBA;

    // Only show weather if significant/not indoor
    const showWeather = weather && weather.temp !== 0 && !isArenaSport;

    return (
        <div className={cn("flex flex-wrap gap-2.5", className)}>
            {/* 1. Game Context (Round/Bowl/Week) */}
            {gameContext && (
                <ContextPill
                    icon={Calendar}
                    value={gameContext}
                    color="text-amber-500/70"
                />
            )}

            {/* 2. Broadcast (Access) */}
            {broadcast && (
                <ContextPill
                    icon={Tv}
                    value={broadcast.toUpperCase().replace('NETWORK', '').trim()}
                    color="text-emerald-500/70"
                />
            )}

            {/* 3. Weather (Conditions) */}
            {showWeather && (
                <ContextPill
                    icon={Thermometer}
                    value={`${weather.temp}° ${weather.condition || ''}`}
                    color="text-blue-400/70"
                />
            )}

            {/* Coaches removed - secondary metadata that clutters the UI */}
        </div>
    );
});

MatchupContextPills.displayName = 'MatchupContextPills';
