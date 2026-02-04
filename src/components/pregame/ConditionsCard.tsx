
import React from 'react';
import type { ComponentType } from 'react';
import {
    Tv,
    Cloud,
    Mountain,
    Wind,
    Droplets,
    Thermometer,
    CloudRain,
    CloudSnow,
    Sun
} from 'lucide-react';
import { Stadium } from '../../types/venueIntel';
import { Sport } from '../../types';

interface ConditionsCardProps {
    venue: {
        name: string;
        city: string;
        state: string;
        indoor: boolean;
        capacity?: number;
    };
    stadium?: Stadium | null;
    weather: {
        temp: number;
        condition: string;
        wind: string;
        humidity: number;
        pressure_in?: number;
        wind_direction_deg?: number;
    } | null;
    broadcast?: string;
    sport?: Sport;
}

const WeatherIcon = ({ condition }: { condition: string }) => {
    const c = condition.toLowerCase();
    if (c.includes('rain') || c.includes('drizzle') || c.includes('shower')) return <CloudRain size={18} className="text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]" />;
    if (c.includes('snow') || c.includes('flurr')) return <CloudSnow size={18} className="text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />;
    if (c.includes('cloud') || c.includes('overcast')) return <Cloud size={18} className="text-zinc-400" />;
    if (c.includes('clear') || c.includes('sunny')) return <Sun size={18} className="text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />;
    return <Sun size={18} className="text-zinc-500" />;
};

const HUDMetric = ({
    label,
    value,
    subValue,
    icon: Icon,
    color = "text-zinc-500"
}: {
    label: string;
    value: string;
    subValue?: string;
    icon: ComponentType<{ size?: number; className?: string }>;
    color?: string;
}) => (
    <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-colors group/metric">
        <div className="flex items-center gap-2">
            <Icon size={12} className={color} />
            <span className="text-[11px] font-medium text-zinc-500">{label}</span>
        </div>
        <div className="flex flex-col">
            <span className="text-[14px] font-semibold text-zinc-200 group-hover/metric:text-white transition-colors">{value}</span>
            {subValue && <span className="text-[10px] font-medium text-zinc-600">{subValue}</span>}
        </div>
    </div>
);

const ConditionsCard: React.FC<ConditionsCardProps> = ({ venue, stadium, weather, broadcast, sport }) => {
    const isArenaSport = sport === Sport.NBA || sport === Sport.BASKETBALL || sport === Sport.COLLEGE_BASKETBALL || sport === Sport.WNBA;
    const isIndoorVenue = stadium?.roof_type === 'indoor' || venue.indoor || isArenaSport;
    const hasWeather = weather && weather.temp !== 0;

    // 1. Data Validation & Noteworthy Filters
    const windValue = parseInt(weather?.wind || '0');
    const isWindNotable = windValue >= 12; // High wind impacting game

    // Only show humidity if it's extreme AND we actually have a non-zero value
    const isHumNotable = !!(weather?.humidity && weather.humidity > 0 && (weather.humidity >= 75 || weather.humidity <= 20));

    // Only show altitude if it's significant (e.g. Denver/Mexico City/Salt Lake)
    const isAltNotable = !!(stadium?.altitude_ft && stadium.altitude_ft > 2000);

    return (
        <div className="relative">
            {/* Venue Row */}
            <div className="flex items-center gap-3 py-3 border-b border-white/[0.04]">
                <div className="w-9 h-9 rounded-lg bg-white/[0.025] flex items-center justify-center shrink-0">
                    <span className="text-base">🏟️</span>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-white truncate tracking-tight">
                        {stadium?.name || venue.name}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] font-medium text-zinc-500">{venue.city}{venue.state ? `, ${venue.state}` : ''}</span>
                        {venue.capacity && venue.capacity > 0 && (
                            <>
                                <span className="text-zinc-700">·</span>
                                <span className="text-[10px] font-medium text-zinc-600 tabular-nums">
                                    {venue.capacity.toLocaleString()}
                                </span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Weather Row - Only for outdoor sports */}
            {(!isArenaSport && (hasWeather || isIndoorVenue)) && (
                <div className="flex items-center gap-3 py-3 border-b border-white/[0.04]">
                    <div className="w-9 h-9 rounded-lg bg-white/[0.025] flex items-center justify-center shrink-0">
                        {isIndoorVenue ? <Thermometer size={16} strokeWidth={2} className="text-emerald-500/70" /> : <WeatherIcon condition={weather?.condition || ''} />}
                    </div>
                    <div className="flex-1">
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-[20px] font-bold text-white tabular-nums tracking-tight">
                                {isIndoorVenue ? (hasWeather ? weather?.temp : '72') : weather?.temp || '--'}°
                            </span>
                            <span className="text-[11px] text-zinc-500 font-medium">
                                {isIndoorVenue ? 'Indoor' : (weather?.condition || 'Weather')}
                            </span>
                        </div>
                        {/* Notable Conditions */}
                        {(isWindNotable || isHumNotable || isAltNotable) && (
                            <div className="flex items-center gap-3 mt-1">
                                {isWindNotable && (
                                    <div className="flex items-center gap-1 text-zinc-500">
                                        <Wind size={11} strokeWidth={2} />
                                        <span className="text-[10px] font-medium tabular-nums">{weather!.wind.split(' ')[0]} mph</span>
                                    </div>
                                )}
                                {isHumNotable && (
                                    <div className="flex items-center gap-1 text-zinc-500">
                                        <Droplets size={11} strokeWidth={2} />
                                        <span className="text-[10px] font-medium tabular-nums">{weather!.humidity}%</span>
                                    </div>
                                )}
                                {isAltNotable && (
                                    <div className="flex items-center gap-1 text-zinc-500">
                                        <Mountain size={11} strokeWidth={2} />
                                        <span className="text-[10px] font-medium tabular-nums">{stadium!.altitude_ft} ft</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Broadcast Row */}
            {broadcast && (
                <div className="flex items-center gap-3 py-3 border-b border-white/[0.04]">
                    <div className="w-9 h-9 rounded-lg bg-white/[0.025] flex items-center justify-center shrink-0">
                        <Tv size={14} strokeWidth={2} className="text-emerald-500" />
                    </div>
                    <div className="flex-1">
                        <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.12em] mb-0.5">Broadcast</div>
                        <div className="text-[13px] font-semibold text-white tracking-tight">
                            {broadcast.toUpperCase().replace('NETWORK', '').trim()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ConditionsCard;
