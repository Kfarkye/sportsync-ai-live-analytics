
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { X, TrendingUp, TrendingDown, Minus, Trophy, Loader2 } from 'lucide-react';
import { RankingItem, Sport } from '@/types';
import { fetchRankings } from '../../services/espnService';
import TeamLogo from '../shared/TeamLogo';
import { ESSENCE, cn } from '@/lib/essence';

const MotionDiv = motion.div;

interface RankingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sport: Sport;
  leagueId: string;
}

const TrendIndicator = ({ trend }: { trend: number }) => {
    // Note: ESPN trend is usually (Previous - Current). 
    // Example: Was 5, Now 3. Trend = 5 - 3 = 2. Positive = Improved.
    // Example: Was 3, Now 5. Trend = 3 - 5 = -2. Negative = Dropped.
    
    if (trend === 0) return <Minus size={10} className="text-zinc-600" />;
    
    const isUp = trend > 0;
    return (
        <div className={cn("flex items-center gap-0.5 text-[9px] font-bold", isUp ? "text-emerald-500" : "text-rose-500")}>
            {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            <span>{Math.abs(trend)}</span>
        </div>
    );
};

const RankingRow: React.FC<{ item: RankingItem }> = ({ item }) => (
    <div className="flex items-center py-3.5 px-6 border-b border-white/[0.04] active:bg-white/[0.02] transition-colors group">
        <div className="w-8 flex justify-center shrink-0">
            <span className="text-lg font-mono font-light text-white tracking-tighter">{item.rank}</span>
        </div>
        
        <div className="mx-4 relative">
            <div className="w-10 h-10 rounded-[14px] bg-[#1C1C1E] border border-white/[0.08] flex items-center justify-center shadow-sm overflow-hidden">
                <TeamLogo logo={item.team.logo} name={item.team.name} className="w-7 h-7 object-contain" />
            </div>
            {/* Tiny accent dot based on team color */}
            <div 
                className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-black"
                style={{ backgroundColor: item.team.color || '#333' }}
            />
        </div>

        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold text-white tracking-tight truncate">{item.team.name}</span>
                {item.firstPlaceVotes ? (
                    <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded text-white/60 font-medium">
                        ({item.firstPlaceVotes})
                    </span>
                ) : null}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] font-mono text-zinc-500">{item.team.record}</span>
                <span className="text-zinc-700 text-[8px]">•</span>
                <span className="text-[10px] text-zinc-600 font-medium">{item.points} PTS</span>
            </div>
        </div>

        <div className="w-10 flex justify-end">
            <TrendIndicator trend={item.trend} />
        </div>
    </div>
);

const RankingsDrawer: React.FC<RankingsDrawerProps> = ({ isOpen, onClose, sport, leagueId }) => {
    const [rankings, setRankings] = useState<RankingItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const load = async () => {
                setLoading(true);
                const data = await fetchRankings(sport, leagueId);
                setRankings(data);
                setLoading(false);
            };
            load();
        }
    }, [isOpen, sport, leagueId]);

    // Drag to dismiss
    const onDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        if (info.offset.y > 100 || info.velocity.y > 500) {
            onClose();
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <MotionDiv
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100]"
                    />

                    {/* Drawer */}
                    <MotionDiv
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ 
                            type: "spring", 
                            damping: 30, 
                            stiffness: 300, 
                            mass: 0.8 
                        }}
                        drag="y"
                        dragConstraints={{ top: 0 }}
                        dragElastic={0.05}
                        onDragEnd={onDragEnd}
                        className="fixed bottom-0 left-0 right-0 z-[101] flex flex-col max-h-[85vh] rounded-t-[32px] overflow-hidden shadow-[0_-20px_60px_rgba(0,0,0,0.9)]"
                        style={{ 
                            background: 'rgba(28, 28, 30, 0.85)', // System Gray 6 equivalent
                            backdropFilter: 'blur(24px) saturate(180%)',
                            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                            borderTop: '1px solid rgba(255,255,255,0.08)'
                        }}
                    >
                        {/* Drag Handle */}
                        <div className="w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
                            <div className="w-10 h-1 bg-white/20 rounded-full" />
                        </div>

                        {/* Header */}
                        <div className="px-6 py-4 flex items-center justify-between border-b border-white/[0.06]">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-500">
                                    <Trophy size={18} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-white tracking-tight leading-none">AP Top 25</h2>
                                    <p className="text-[11px] text-zinc-400 mt-0.5 font-medium">NCAA Football • Week 14</p>
                                </div>
                            </div>
                            <button 
                                onClick={onClose}
                                className="w-8 h-8 flex items-center justify-center bg-white/5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                            >
                                <X size={16} strokeWidth={2.5} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="overflow-y-auto flex-1 custom-scrollbar bg-[#050505]/50">
                            {loading ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-3">
                                    <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
                                    <span className="text-xs font-medium text-zinc-600 uppercase tracking-widest">Loading Poll...</span>
                                </div>
                            ) : rankings.length > 0 ? (
                                <div className="pb-12">
                                    {rankings.map((item) => (
                                        <RankingRow key={item.team.id} item={item} />
                                    ))}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
                                    <p>Rankings unavailable for this week.</p>
                                </div>
                            )}
                        </div>
                    </MotionDiv>
                </>
            )}
        </AnimatePresence>
    );
};

export default RankingsDrawer;
