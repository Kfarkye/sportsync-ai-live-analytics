import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Radar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { cn } from '@/lib/essence';
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
} from '@/components/ui';

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

const formatTimestamp = (ts: string) => {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatGeneratedAt = (ts: string | undefined) => {
  if (!ts) return 'Waiting for sync';
  const date = new Date(ts);
  return `Updated ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

const formatLine = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  return value > 0 ? `+${value}` : `${value}`;
};

const formatTotal = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

const formatPricePair = (left: number | null, right: number | null) => {
  const formatPrice = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return '—';
    return value > 0 ? `+${value}` : `${value}`;
  };

  return `${formatPrice(left)}/${formatPrice(right)}`;
};

const formatMoneyline = (row: PulseRow) => {
  if (!row.post) return '—';

  const formatPrice = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return '—';
    return value > 0 ? `+${value}` : `${value}`;
  };

  if (row.post.drawMl !== null) {
    return `${formatPrice(row.post.homeMl)}/${formatPrice(row.post.drawMl)}/${formatPrice(row.post.awayMl)}`;
  }

  return `${formatPrice(row.post.homeMl)}/${formatPrice(row.post.awayMl)}`;
};

const changeArrow = (before: number | null | undefined, after: number | null | undefined) => {
  if (before === null || before === undefined || after === null || after === undefined || before === after) return '';
  return after > before ? ' ↑' : ' ↓';
};

const eventTag = (row: PulseRow) => {
  if (row.rowType === 'odds') return 'ODDS';
  if (row.rowType === 'timeout') return 'TIMEOUT';
  if (row.rowType === 'period_end') return 'END';
  if (row.eventType === 'goal' || row.eventType === 'score') return 'SCORE';
  return 'PLAY';
};

const eventDetail = (row: PulseRow) => {
  if (row.rowType === 'odds') return 'Odds checkpoint';
  if (row.rowType === 'period_end') return 'Period end';
  if (row.rowType === 'timeout') return 'Timeout';
  return row.eventLabel || 'Play';
};

const scoreStateLabel = (tag: string) =>
  tag
    .split('_')
    .join(' ')
    .toLowerCase();

const playDescription = (row: PulseRow) => row.playText || row.eventLabel || '—';

const noteForRow = (row: PulseRow) => {
  if (row.rowType !== 'odds') return null;
  return row.note;
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
        const message = err instanceof Error ? err.message : 'Live impulse unavailable';
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

  const oddsRows = useMemo(() => rows.filter((row) => row.rowType === 'odds'), [rows]);
  const latestTapeRow = rows[0] ?? null;

  const columns = useMemo<DataTableColumn<PulseRow>[]>(
    () => [
      {
        id: 'time',
        header: 'Time',
        width: '88px',
        cell: (row) => (
          <div className="space-y-1">
            <div className="font-mono text-[13px] font-semibold text-slate-700">
              {row.clock || formatTimestamp(row.ts)}
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {row.period || formatTimestamp(row.ts)}
            </div>
          </div>
        ),
      },
      {
        id: 'event',
        header: 'Event',
        width: '132px',
        cell: (row) => (
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-900">
              {eventTag(row)}
            </div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
              {eventDetail(row)}
            </div>
          </div>
        ),
      },
      {
        id: 'score',
        header: 'Score',
        width: '126px',
        cell: (row) => (
          <div className="space-y-1">
            <div className="font-mono text-[13px] font-semibold text-slate-800">{row.score}</div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
              {scoreStateLabel(row.scoreStateTag)}
            </div>
          </div>
        ),
      },
      {
        id: 'total',
        header: 'O/U',
        width: '72px',
        cell: (row) => (
          <div className="text-[13px] font-medium text-slate-800">
            {row.rowType === 'odds' ? (
              <>
                {formatTotal(row.post?.totalLine ?? null)}
                {changeArrow(row.pre?.totalLine, row.post?.totalLine)}
              </>
            ) : '—'}
          </div>
        ),
      },
      {
        id: 'price',
        header: 'O/U Price',
        width: '128px',
        cell: (row) => (
          <div className="text-[13px] font-medium text-slate-800">
            {row.rowType === 'odds'
              ? formatPricePair(row.post?.overPrice ?? null, row.post?.underPrice ?? null)
              : '—'}
          </div>
        ),
      },
      {
        id: 'spread',
        header: 'Spread',
        width: '96px',
        cell: (row) => (
          <div className="text-[13px] font-medium text-slate-800">
            {row.rowType === 'odds' ? (
              <>
                {formatLine(row.post?.spreadLine ?? null)}
                {changeArrow(row.pre?.spreadLine, row.post?.spreadLine)}
              </>
            ) : '—'}
          </div>
        ),
      },
      {
        id: 'ml',
        header: 'ML',
        width: '120px',
        cell: (row) => (
          <div className="text-[13px] font-medium text-slate-800">
            {row.rowType === 'odds' ? formatMoneyline(row) : '—'}
          </div>
        ),
      },
      {
        id: 'play',
        header: 'Play',
        width: 'minmax(320px,1fr)',
        cell: (row) => (
          <div className="space-y-1">
            <div className="text-[14px] font-medium leading-6 text-slate-950">{playDescription(row)}</div>
            {noteForRow(row) ? (
              <div className="text-[12px] leading-5 text-slate-500">{noteForRow(row)}</div>
            ) : null}
          </div>
        ),
      },
    ],
    [],
  );

  const emptyState = error ? (
    <EmptyState
      icon={<Radar size={24} />}
      message="LIVE IMPULSE OFFLINE"
      description={error}
    />
  ) : (
    <EmptyState
      icon={<BarChart3 size={24} />}
      message="WAITING FOR CHECKPOINTS"
      description="This tape fills with fixed 10-minute odds rows and separate play-by-play rows as the game progresses."
    />
  );

  return (
    <div className="w-full space-y-5">
      <PageHeader
        compact
        eyebrow={showSectionEyebrow ? 'Live Impulse' : undefined}
        title="Live Tape"
        description={pulse?.summary ?? 'Plays and fixed 10-minute odds checkpoints in one ordered timeline.'}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 pb-3 text-[12px] text-slate-500">
        <span className="font-medium text-slate-700">{formatGeneratedAt(pulse?.generatedAt)}</span>
        <span>{oddsRows.length} checkpoints</span>
        <span>{rows.length} total rows</span>
        <span>{pulse?.windowMinutes ?? 10}-minute cadence</span>
        <span className="uppercase tracking-[0.14em]">{pulse?.sport ?? 'Live'}</span>
      </div>

      {latestTapeRow ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Latest</div>
          <div className="mt-1 text-[14px] font-medium text-slate-900">{playDescription(latestTapeRow)}</div>
          <div className="mt-1 text-[12px] text-slate-500">
            {latestTapeRow.period || 'Live'} {latestTapeRow.clock || formatTimestamp(latestTapeRow.ts)}
            {' '}•{' '}
            {latestTapeRow.score}
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey="id"
        density="compact"
        loading={loading && !pulse}
        emptyState={emptyState}
        rowTone={(row) => {
          if (row.rowType === 'odds') return 'muted';
          if (row.rowType === 'timeout' || row.rowType === 'period_end') return 'muted';
          return 'default';
        }}
      />
    </div>
  );
};

export default ForecastHistoryTable;
