import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { cn } from '@/lib/essence';
import { BarChart3, Radar } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

interface PulseRow {
  id: string;
  ts: string;
  period: string | null;
  clock: string | null;
  score: string;
  scoreStateTag: string;
  rowType: 'odds' | 'play' | 'timeout' | 'period_end';
  eventType: string;
  eventLabel: string;
  moveMagnitude: 'small' | 'medium' | 'large';
  badge: 'Normal' | 'Sharp Move' | 'No Reaction';
  playText: string | null;
  note: string | null;
  pre?: ParsedOdds;
  post?: ParsedOdds;
}

interface ParsedOdds {
  spreadLine: number | null;
  spreadHomePrice: number | null;
  spreadAwayPrice: number | null;
  totalLine: number | null;
  overPrice: number | null;
  underPrice: number | null;
  homeMl: number | null;
  awayMl: number | null;
  drawMl: number | null;
  provider: string | null;
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

const eventChipClass = (row: PulseRow) => {
  if (row.rowType === 'odds') {
    return 'border-zinc-900/10 bg-zinc-900 text-white';
  }
  if (row.rowType === 'timeout') {
    return 'border-zinc-200 bg-zinc-100 text-zinc-700';
  }
  if (row.rowType === 'period_end') {
    return 'border-zinc-200 bg-white text-zinc-700';
  }
  return 'border-[#D7E1FF] bg-[#EEF3FF] text-[#335CFF]';
};

const noteClass = (row: PulseRow) => {
  if (row.rowType !== 'odds') return 'text-zinc-400';
  if (row.badge === 'Sharp Move') return 'text-[#0A7A3E]';
  if (row.badge === 'No Reaction') return 'text-zinc-400';
  return 'text-zinc-500';
};

const formatTimestamp = (ts: string) => {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatLine = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  if (value > 0) return `+${value}`;
  return `${value}`;
};

const formatTotal = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

const formatPricePair = (left: number | null, right: number | null) => {
  const fmt = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return '—';
    if (value > 0) return `+${value}`;
    return `${value}`;
  };
  return `${fmt(left)}/${fmt(right)}`;
};

const formatMoneyline = (row: PulseRow) => {
  if (!row.post) return '—';
  const home = row.post.homeMl;
  const away = row.post.awayMl;
  const draw = row.post.drawMl;
  const fmt = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return '—';
    if (value > 0) return `+${value}`;
    return `${value}`;
  };
  if (draw !== null) return `${fmt(home)}/${fmt(draw)}/${fmt(away)}`;
  return `${fmt(home)}/${fmt(away)}`;
};

const changeArrow = (before: number | null | undefined, after: number | null | undefined) => {
  if (before === null || before === undefined || after === null || after === undefined || before === after) return '';
  return after > before ? ' ↑' : ' ↓';
};

const eventChip = (row: PulseRow) => {
  if (row.rowType === 'odds') return 'ODDS';
  if (row.rowType === 'period_end') return 'END';
  if (row.rowType === 'timeout') return 'TIME';
  if (row.eventType === 'goal' || row.eventType === 'score') return 'SCORE';
  return 'PLAY';
};

const playLabel = (row: PulseRow) => {
  if (row.rowType === 'odds') return '—';
  return row.playText || row.eventLabel;
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
    if (!rows.length) return 'A 10-minute live tape of play-by-play and odds checkpoints will appear here once enough priced snapshots exist.';
    return `Ten-minute live tape: ${summary}`;
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
          <span className="text-caption font-bold text-zinc-500 uppercase tracking-widest">Live Impulse</span>
        </div>
      )}

      <div className="rounded-[22px] border border-edge-subtle bg-[#FAFAFA] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">10-Minute Tape</div>
            <p className="text-sm font-semibold leading-6 text-[#111111] sm:text-[15px]">{summary}</p>
          </div>
          <div className="hidden rounded-full border border-edge-subtle bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:flex sm:items-center">
            Live Sync
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-zinc-500">{seoCopy}</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<BarChart3 size={24} />}
          message="WAITING FOR CHECKPOINTS"
          description="This rail fills with fixed 10-minute odds rows and separate play rows as the game progresses."
        />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1080px] space-y-3">
            <div className="grid grid-cols-[88px_132px_110px_84px_120px_110px_128px_minmax(280px,1fr)] gap-4 border-b border-edge-subtle px-2 pb-3">
              <div className="text-label font-black uppercase tracking-widest text-zinc-500">Time</div>
              <div className="text-label font-black uppercase tracking-widest text-zinc-500">Event</div>
              <div className="text-label font-black uppercase tracking-widest text-zinc-500">Score</div>
              <div className="text-label font-black uppercase tracking-widest text-zinc-500">O/U</div>
              <div className="text-label font-black uppercase tracking-widest text-zinc-500">O/U Price</div>
              <div className="text-label font-black uppercase tracking-widest text-zinc-500">Spread</div>
              <div className="text-label font-black uppercase tracking-widest text-zinc-500">ML</div>
              <div className="text-label font-black uppercase tracking-widest text-zinc-500">Play</div>
            </div>

            <AnimatePresence mode="popLayout">
              {rows.map((row) => (
                <motion.div
                  key={row.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className={cn(
                    'grid grid-cols-[88px_132px_110px_84px_120px_110px_128px_minmax(280px,1fr)] gap-4 rounded-[20px] border px-4 py-4 transition-colors',
                    row.rowType === 'odds'
                      ? 'border-zinc-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.06)]'
                      : 'border-zinc-100 bg-[#FCFCFC]'
                  )}
                >
                  <div className="space-y-1">
                    <div className="text-footnote font-mono font-bold text-zinc-600">{row.clock || formatTimestamp(row.ts)}</div>
                    <div className="text-label font-bold uppercase text-zinc-500">{row.period || formatTimestamp(row.ts)}</div>
                  </div>

                  <div className="space-y-2">
                    <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em]', eventChipClass(row))}>
                      {eventChip(row)}
                    </span>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                      {row.rowType === 'odds' ? '10-minute checkpoint' : row.eventLabel}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-footnote font-mono font-bold text-zinc-700">{row.score}</div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{row.scoreStateTag}</div>
                  </div>

                  <div className="text-[13px] leading-6 text-zinc-800">
                    {row.rowType === 'odds' ? (
                      <>
                        {formatTotal(row.post?.totalLine ?? null)}
                        {changeArrow(row.pre?.totalLine, row.post?.totalLine)}
                      </>
                    ) : '—'}
                  </div>

                  <div className="text-[13px] leading-6 text-zinc-800">
                    {row.rowType === 'odds'
                      ? formatPricePair(row.post?.overPrice ?? null, row.post?.underPrice ?? null)
                      : '—'}
                  </div>

                  <div className="text-[13px] leading-6 text-zinc-800">
                    {row.rowType === 'odds' ? (
                      <>
                        {formatLine(row.post?.spreadLine ?? null)}
                        {changeArrow(row.pre?.spreadLine, row.post?.spreadLine)}
                      </>
                    ) : '—'}
                  </div>

                  <div className="text-[13px] leading-6 text-zinc-800">
                    {row.rowType === 'odds' ? formatMoneyline(row) : '—'}
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-semibold leading-5 text-zinc-900">{playLabel(row)}</div>
                    {row.note ? (
                      <div className={cn('text-[12px] leading-5', noteClass(row))}>{row.note}</div>
                    ) : null}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
};
