/**
 * PREGAME WATCH TAGS
 * UI Component rendering neutral pregame context
 * Zero stance. Pure intel. Apple Sports 2026 quality.
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
    AlertCircle,
    Plane,
    TrendingUp,
    Users,
    Clock,
    Activity
} from 'lucide-react';
import type { PregameContext } from '../../types';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface PregameWatchTagsProps {
    context: PregameContext | null;
    loading?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS COLORS
// ═══════════════════════════════════════════════════════════════════════════════

const injuryStatusColors: Record<string, { bg: string; text: string; border: string }> = {
    OUT: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20' },
    DOUBTFUL: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
    QUESTIONABLE: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
    PROBABLE: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
    IN: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', border: 'border-zinc-500/20' }
};

const travelFlagLabels: Record<string, string> = {
    B2B: "Back-to-Back",
    "3IN4": "3 in 4 Days",
    "4IN6": "4 in 6 Days",
    TIMEZONE: "Timezone Travel",
    ALTITUDE: "Altitude Game",
    REST_ADV: "Rest Advantage"
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const PregameWatchTags: React.FC<PregameWatchTagsProps> = ({ context, loading }) => {
    if (loading) {
        return (
            <div className="rounded-[20px] bg-[#0A0A0A] border border-white/[0.06] p-6">
                <div className="flex items-center justify-center h-32">
                    <div className="w-6 h-6 border-2 border-zinc-800 border-t-zinc-500 rounded-full animate-spin" />
                </div>
            </div>
        );
    }

    if (!context) {
        return (
            <div className="rounded-[20px] bg-[#0A0A0A] border border-white/[0.06] p-6">
                <div className="flex flex-col items-center justify-center h-32 text-center">
                    <Activity className="w-8 h-8 text-zinc-700 mb-3" />
                    <p className="text-[13px] text-zinc-600">No pregame context available</p>
                </div>
            </div>
        );
    }

    const hasInjuries = context.injuries.length > 0;
    const hasTravel = context.travel.length > 0;
    const hasSharp = context.market_signals.sharp.length > 0;
    const hasPublic = context.market_signals.public.length > 0;
    const hasNotes = context.context_notes.length > 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[20px] bg-[#0A0A0A] border border-white/[0.06] overflow-hidden"
        >
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/[0.04]">
                <div className="flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold text-zinc-300 uppercase tracking-wider">
                        Watch Tags
                    </h3>
                    <span className="text-[10px] text-zinc-600 font-mono">
                        {new Date(context.generated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                </div>
            </div>

            <div className="p-6 space-y-6">
                {/* Injuries Section */}
                {hasInjuries && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <AlertCircle className="w-4 h-4 text-rose-400" />
                            <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                                Injuries
                            </span>
                        </div>
                        <div className="space-y-2">
                            {context.injuries.map((injury, idx) => {
                                const colors = injuryStatusColors[injury.status];
                                return (
                                    <div
                                        key={idx}
                                        className={`flex items-center justify-between p-3 rounded-xl ${colors.bg} border ${colors.border}`}
                                    >
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[13px] font-medium text-zinc-200">
                                                    {injury.player}
                                                </span>
                                                <span className="text-[10px] text-zinc-600">
                                                    {injury.team}
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-zinc-500 mt-0.5">
                                                {injury.note}
                                            </p>
                                        </div>
                                        <span className={`text-[10px] font-bold ${colors.text} uppercase`}>
                                            {injury.status}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Travel Section */}
                {hasTravel && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Plane className="w-4 h-4 text-blue-400" />
                            <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                                Schedule
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {context.travel.map((t, idx) => (
                                <div
                                    key={idx}
                                    className="px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20"
                                >
                                    <div className="text-[11px] font-medium text-blue-400">
                                        {t.team}: {travelFlagLabels[t.flag]}
                                    </div>
                                    <p className="text-[10px] text-zinc-500 mt-0.5">{t.note}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Market Signals Section */}
                {(hasSharp || hasPublic) && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <TrendingUp className="w-4 h-4 text-amber-400" />
                            <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                                Market
                            </span>
                        </div>
                        <div className="space-y-2">
                            {context.market_signals.sharp.map((s, idx) => (
                                <div
                                    key={`sharp-${idx}`}
                                    className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold text-amber-400 uppercase">
                                            {s.signal}
                                        </span>
                                        <span className="text-[11px] text-zinc-400">{s.note}</span>
                                    </div>
                                </div>
                            ))}
                            {context.market_signals.public.map((p, idx) => (
                                <div
                                    key={`public-${idx}`}
                                    className="px-3 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <Users className="w-3 h-3 text-zinc-500" />
                                        <span className="text-[10px] font-medium text-zinc-500 uppercase">
                                            {p.signal.replace('_', ' ')}
                                        </span>
                                        <span className="text-[11px] text-zinc-400">{p.note}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Context Notes Section */}
                {hasNotes && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Clock className="w-4 h-4 text-zinc-400" />
                            <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                                Context
                            </span>
                        </div>
                        <ul className="space-y-1.5">
                            {context.context_notes.map((note, idx) => (
                                <li
                                    key={idx}
                                    className="flex items-start gap-2 text-[12px] text-zinc-400"
                                >
                                    <span className="text-zinc-600 mt-0.5">•</span>
                                    <span>{note}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </motion.div>
    );
};

export default PregameWatchTags;
