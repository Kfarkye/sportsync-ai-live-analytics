import React from 'react';
import { motion } from 'framer-motion';
import { MatchEdgeTag } from '@/types';
import { cn } from '@/lib/essence';

interface MatchEdgeTagsProps {
    tags?: MatchEdgeTag[];
    className?: string;
    size?: 'sm' | 'md' | 'lg';
}

export const MatchEdgeTags: React.FC<MatchEdgeTagsProps> = ({ tags, className, size = 'md' }) => {
    if (!tags || tags.length === 0) return null;

    // Filter to only show active tags
    const activeTags = tags.filter(t => t.status === 'active');
    if (activeTags.length === 0) return null;

    const getTagColor = (tag: MatchEdgeTag) => {
        // Structural edges get a purple/indigo hue
        if (tag.tag_type === 'structural_edge') {
            return {
                bg: 'bg-indigo-50/80',
                text: 'text-indigo-600',
                border: 'border-indigo-200/60',
                dot: 'bg-indigo-500',
                glow: 'shadow-[0_0_8px_rgba(99,102,241,0.2)]'
            };
        }
        // Price edges get an emerald/green hue
        return {
            bg: 'bg-emerald-50/80',
            text: 'text-emerald-700',
            border: 'border-emerald-200/60',
            dot: 'bg-emerald-500',
            glow: 'shadow-[0_0_8px_rgba(16,185,129,0.2)]'
        };
    };

    const formatTagLabel = (tag: MatchEdgeTag) => {
        switch (tag.trend_key) {
            case 'serie_a_away_fav_ats':
                return 'Away Fav ATS';
            case 'epl_high_total_under':
                return 'High Total Under';
            case 'epl_draw_value':
                return `Draw +${tag.edge_payload.draw_price || 'EV'}`;
            default:
                return tag.trend_key.replace(/_/g, ' ').toUpperCase();
        }
    };

    const formatTagDetail = (tag: MatchEdgeTag) => {
        if (tag.trend_key === 'epl_draw_value') return 'Price Edge';
        if (tag.trend_key === 'epl_high_total_under') return `Total ${tag.edge_payload.market_total}`;
        if (tag.trend_key === 'serie_a_away_fav_ats') return `Spread ${tag.edge_payload.spread || 'N/A'}`;
        return 'Structural Edge';
    };

    return (
        <div className={cn("flex flex-wrap gap-2 items-center", className)}>
            {activeTags.map((tag, idx) => {
                const colors = getTagColor(tag);
                const label = formatTagLabel(tag);
                const detail = formatTagDetail(tag);

                return (
                    <motion.div
                        key={`${tag.trend_key}-${idx}`}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: "spring", stiffness: 400, damping: 25, delay: idx * 0.05 }}
                        className={cn(
                            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 backdrop-blur-sm",
                            colors.bg,
                            colors.border,
                            colors.glow,
                            size === 'sm' && "px-2 py-0.5"
                        )}
                    >
                        <div className={cn("w-1 h-1 rounded-full", colors.dot)} />
                        <span className={cn(
                            "font-bold uppercase tracking-widest",
                            colors.text,
                            size === 'sm' ? "text-[8px]" : "text-[9px]"
                        )}>
                            {label}
                        </span>
                        <span className="w-[1px] h-3 bg-black/10 mx-0.5" />
                        <span className={cn(
                            "font-medium tabular-nums opacity-80",
                            colors.text,
                            size === 'sm' ? "text-[8px]" : "text-[9px]"
                        )}>
                            {detail}
                        </span>
                    </motion.div>
                );
            })}
        </div>
    );
};
