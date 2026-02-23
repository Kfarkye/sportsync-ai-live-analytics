
import React from 'react';
import { TrendingUp, Zap, History, ShieldCheck } from 'lucide-react';
import { MatchInsight } from '@/types/historicalIntel';

interface InsightPillsProps {
    insights: MatchInsight[];
}

const InsightIcon = ({ type }: { type: string }) => {
    switch (type) {
        case 'SU_STREAK': return <Zap size={10} className="text-emerald-400" />;
        case 'ATS_DOMINANCE': return <TrendingUp size={10} className="text-blue-400" />;
        case 'TOTAL_TREND': return <TrendingUp size={10} className="text-indigo-400" />;
        case 'H2H_DOMINANCE': return <History size={10} className="text-amber-400" />;
        default: return <ShieldCheck size={10} className="text-zinc-400" />;
    }
};

const InsightPills: React.FC<InsightPillsProps> = ({ insights }) => {
    if (!insights || insights.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 mb-6">
            {insights.map((insight) => (
                <div
                    key={insight.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.03] border border-edge hover:bg-white/[0.05] transition-colors group cursor-default"
                    title={insight.detail}
                >
                    <InsightIcon type={insight.insight_type} />
                    <span className="text-caption font-black text-zinc-300 uppercase tracking-widest group-hover:text-white transition-colors">
                        {insight.summary}
                    </span>
                    {insight.impact_level >= 8 && (
                        <div className="w-1 h-1 rounded-full bg-rose-500 animate-pulse" />
                    )}
                </div>
            ))}
        </div>
    );
};

export default InsightPills;
