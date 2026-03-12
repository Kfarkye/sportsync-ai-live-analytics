import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { cn } from '@/lib/essence';
import { Activity, ArrowRight, BarChart3, Clock3, Radar, Waves } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

interface PulseRow {
  id: string;
  ts: string;
  period: string | null;
  clock: string | null;
  score: string;
  scoreStateTag: string;
  eventType: string;
  eventLabel: string;
  marketBefore: string;
  marketAfter: string;
  moveLabel: string;
  moveMagnitude: 'small' | 'medium' | 'large';
  badge: 'Normal' | 'Sharp Move' | 'Lagging' | 'No Reaction';
  explanation: string;
}

interface LiveMarketPulseResponse {
  matchId: string;
  sport: string;
  windowMinutes: number;
  generatedAt: string;
  summary: string;
  rows: PulseRow[];
  hasRows: boolean;
}

interface ForecastHistoryTableProps {
  matchId: string;
  showSectionEyebrow?: boolean;
}

const badgeClass = (badge: PulseRow['badge']) => {
  switch (badge) {
    case 'Sharp Move':
      return 'bg-[#DFF7E8] text-[#0A7A3E] border border-[#B5E7C8]';
    case 'Lagging':
      return 'bg-[#FFF3D9] text-[#A35A00] border border-[#F1D199]';
    case 'No Reaction':
      return 'bg-[#F5F5F5] text-[#737373] border border-[#E5E5E5]';
    default:
      return 'bg-[#EEF3FF] text-[#335CFF] border border-[#D7E1FF]';
  }
};

const moveClass = (magnitude: PulseRow['moveMagnitude']) => {
  switch (magnitude) {
    case 'large':
      return 'text-[#0A7A3E]';
    case 'medium':
      return 'text-[#335CFF]';
    default:
      return 'text-[#737373]';
  }
};

const formatTimestamp = (ts: string) => {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export const ForecastHistoryTable: React.FC<ForecastHistoryTableProps> = ({
  matchId,
  showSectionEyebrow = true,
}) => {
  const [pulse, setPulse] = useState<LiveMarketPulseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let intervalId: number | null = null;

    const fetchPulse = async () => {
      try {
        if (!mounted) return;
        const initial = pulse === null;
        if (initial) setLoading(true);
        const { data, error: invokeError } = await supabase.functions.invoke('live-market-pulse', {
          body: { matchId, windowMinutes: 10 },
        });

        if (invokeError) throw invokeError;
        if (!mounted) return;
        setPulse((data ?? null) as LiveMarketPulseResponse | null);
        setError(null);
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : 'Pulse unavailable';
        setError(message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchPulse();
    intervalId = window.setInterval(fetchPulse, 20_000);

    return () => {
      mounted = false;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [matchId]);

  const rows = pulse?.rows ?? [];
  const summary = pulse?.summary ?? 'Reading the last 10 minutes of play and market movement.';
  const seoCopy = useMemo(() => {
    if (!rows.length) return 'A 10-minute game tape of play-by-play and odds snapshots will appear here once the live market has enough priced checkpoints.';
    return `Ten-minute live game snapshots: ${summary}`;
  }, [rows.length, summary]);

  if (loading && !pulse) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="w-6 h-6 border-2 border-zinc-800 border-t-zinc-500 rounded-full motion-safe:animate-spin" />
      </div>
    );
  }

  if (error && !pulse) {
    return (
      <EmptyState
        icon={<Radar size={24} />}
        message="LIVE MARKET PULSE OFFLINE"
        description={error}
      />
    );
  }

  return (
    <div className="w-full space-y-4">
      {showSectionEyebrow && (
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
          <span className="text-caption font-bold text-zinc-500 uppercase tracking-widest">Live Market Pulse</span>
        </div>
      )}

      <div className="rounded-2xl border border-edge-subtle bg-[#FAFAFA] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">
              <Clock3 size={12} className="text-zinc-400" />
              10-Minute Snapshots
            </div>
            <p className="text-sm font-semibold leading-6 text-[#111111] sm:text-[15px]">{summary}</p>
          </div>
          <div className="hidden rounded-full border border-edge-subtle bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:flex sm:items-center sm:gap-2">
            <Waves size={12} />
            Live Sync
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-zinc-500">{seoCopy}</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<BarChart3 size={24} />}
          message="WAITING FOR CHECKPOINTS"
          description="This rail fills with fixed 10-minute market snapshots as the game progresses."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead>
              <tr className="border-b border-edge-subtle">
                <th className="py-3 px-2 text-label font-black text-zinc-500 uppercase tracking-widest">Time</th>
                <th className="py-3 px-2 text-label font-black text-zinc-500 uppercase tracking-widest text-center">Score</th>
                <th className="py-3 px-2 text-label font-black text-zinc-500 uppercase tracking-widest">Event</th>
                <th className="py-3 px-2 text-label font-black text-zinc-500 uppercase tracking-widest">Before</th>
                <th className="py-3 px-2 text-label font-black text-zinc-500 uppercase tracking-widest">After</th>
                <th className="py-3 px-2 text-label font-black text-zinc-500 uppercase tracking-widest text-center">Move</th>
                <th className="py-3 px-2 text-label font-black text-zinc-500 uppercase tracking-widest">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.02]">
              <AnimatePresence mode="popLayout">
                {rows.map((row) => (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="group hover:bg-white/[0.015] transition-colors"
                  >
                    <td className="py-3 px-2 align-top">
                      <div className="flex flex-col">
                        <span className="text-footnote font-mono font-bold text-zinc-300">{row.clock || formatTimestamp(row.ts)}</span>
                        <span className="text-label font-bold text-zinc-600 uppercase">{row.period || formatTimestamp(row.ts)}</span>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-center align-top">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-footnote font-mono font-bold text-zinc-500">{row.score}</span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{row.scoreStateTag}</span>
                      </div>
                    </td>
                    <td className="py-3 px-2 align-top">
                      <div className="space-y-2 max-w-[220px]">
                        <div className="flex items-center gap-2">
                          <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em]', badgeClass(row.badge))}>
                            {row.badge}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-[#111111] leading-5">{row.eventLabel}</p>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">{row.eventType.replace('_', ' ')}</p>
                      </div>
                    </td>
                    <td className="py-3 px-2 align-top">
                      <p className="max-w-[200px] text-[13px] leading-5 text-zinc-500">{row.marketBefore}</p>
                    </td>
                    <td className="py-3 px-2 align-top">
                      <div className="flex items-start gap-2 max-w-[220px]">
                        <ArrowRight size={14} className="mt-0.5 text-zinc-300" />
                        <p className="text-[13px] leading-5 text-[#111111]">{row.marketAfter}</p>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-center align-top">
                      <div className="flex flex-col items-center gap-2">
                        <span className={cn('text-sm font-mono font-bold', moveClass(row.moveMagnitude))}>{row.moveLabel}</span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{row.moveMagnitude}</span>
                      </div>
                    </td>
                    <td className="py-3 px-2 align-top">
                      <div className="flex items-start gap-2 max-w-[260px]">
                        <Activity size={13} className="mt-1 text-zinc-400" />
                        <p className="text-[13px] leading-5 text-zinc-500">{row.explanation}</p>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
