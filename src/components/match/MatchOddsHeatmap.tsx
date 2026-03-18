import React, { memo, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type KalshiEventCandidate = {
  event_ticker: string;
  title: string | null;
  home_team: string | null;
  away_team: string | null;
  game_date: string | null;
  status: string;
};

type KalshiSnapshotRow = {
  market_ticker: string;
  market_type: string | null;
  market_label: string | null;
  line_value: number | null;
  line_side: string | null;
  yes_price: number | null;
  no_price: number | null;
  volume: number | null;
  open_interest: number | null;
  yes_no_imbalance: number | null;
  recent_volume_imbalance: number | null;
  last_trade_side: string | null;
  captured_at: string;
};

type OddsPayload = {
  eventTicker: string | null;
  rows: KalshiSnapshotRow[];
};

interface MatchOddsHeatmapProps {
  homeTeamName: string;
  awayTeamName: string;
  startTime?: string;
  enabled?: boolean;
}

const clamp01 = (value: number | null | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
};

const normalizeToken = (value: string | null | undefined): string =>
  (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const americanOddsFromPrice = (price: number | null): number | null => {
  if (price === null || !Number.isFinite(price) || price <= 0 || price >= 1) return null;
  if (price === 0.5) return -100;
  if (price > 0.5) return Math.round(-((price / (1 - price)) * 100));
  return Math.round(((1 - price) / price) * 100);
};

const formatAmericanOdds = (odds: number | null): string => {
  if (odds === null || !Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
};

const deriveSides = (row: KalshiSnapshotRow): { yes: string; no: string } => {
  const side = (row.line_side || '').toLowerCase();
  const label = (row.market_label || '').toLowerCase();

  if (side === 'over' || label.includes('over')) return { yes: 'over', no: 'under' };
  if (side === 'under' || label.includes('under')) return { yes: 'under', no: 'over' };
  if (side === 'home') return { yes: 'home', no: 'away' };
  if (side === 'away') return { yes: 'away', no: 'home' };
  if (side === 'draw' || label.includes('draw') || label.includes('tie')) return { yes: 'draw', no: 'not draw' };
  if (side === 'yes') return { yes: 'yes', no: 'no' };
  if (side === 'no') return { yes: 'no', no: 'yes' };
  return { yes: 'yes', no: 'no' };
};

const actionState = (
  betImbalance: number,
  moneyImbalance: number,
  betSide: string,
  moneySide: string,
): 'split' | 'one-sided' | 'balanced' => {
  if (betImbalance >= 0.65 && moneyImbalance >= 0.55 && betSide !== moneySide) return 'split';
  if (betImbalance >= 0.65 && moneyImbalance >= 0.65 && betSide === moneySide) return 'one-sided';
  return 'balanced';
};

const marketSortRank = (row: KalshiSnapshotRow, mainTotalTicker: string | null): number => {
  const type = (row.market_type || '').toLowerCase();
  if (type === 'moneyline') return 10;
  if (mainTotalTicker && row.market_ticker === mainTotalTicker) return 20;
  if (type === 'spread') return 30;
  if (type === 'total') return 40;
  if (type === '1h_winner') return 50;
  if (type === '1h_total') return 60;
  return 70;
};

const marketRowComparator = (a: KalshiSnapshotRow, b: KalshiSnapshotRow, mainTotalTicker: string | null): number => {
  const rankDiff = marketSortRank(a, mainTotalTicker) - marketSortRank(b, mainTotalTicker);
  if (rankDiff !== 0) return rankDiff;

  const typeA = (a.market_type || '').toLowerCase();
  const typeB = (b.market_type || '').toLowerCase();
  if (typeA === 'moneyline' && typeB === 'moneyline') {
    const key = (row: KalshiSnapshotRow) => {
      const side = (row.line_side || '').toLowerCase();
      const label = (row.market_label || '').toLowerCase();
      if (side === 'home' || label.includes('home')) return 1;
      if (side === 'draw' || label.includes('draw') || label.includes('tie')) return 2;
      if (side === 'away' || label.includes('away')) return 3;
      return 4;
    };
    const sideDiff = key(a) - key(b);
    if (sideDiff !== 0) return sideDiff;
  }

  if (typeA === 'total' && typeB === 'total') {
    const lineA = typeof a.line_value === 'number' ? a.line_value : Number.POSITIVE_INFINITY;
    const lineB = typeof b.line_value === 'number' ? b.line_value : Number.POSITIVE_INFINITY;
    if (lineA !== lineB) return lineA - lineB;
  }

  return (a.market_label || a.market_ticker).localeCompare(b.market_label || b.market_ticker);
};

const pickEventForMatch = (
  events: KalshiEventCandidate[],
  homeTeamName: string,
  awayTeamName: string,
): KalshiEventCandidate | null => {
  const home = normalizeToken(homeTeamName);
  const away = normalizeToken(awayTeamName);

  const candidates = events
    .map((event) => {
      const text = normalizeToken(`${event.title || ''} ${event.home_team || ''} ${event.away_team || ''}`);
      const homeHit = text.includes(home) ? home.length : 0;
      const awayHit = text.includes(away) ? away.length : 0;
      const score = homeHit + awayHit;
      return { event, score, both: homeHit > 0 && awayHit > 0 };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      if (a.both !== b.both) return a.both ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      const dateA = Date.parse(a.event.game_date || '');
      const dateB = Date.parse(b.event.game_date || '');
      if (Number.isFinite(dateA) && Number.isFinite(dateB)) return dateA - dateB;
      return 0;
    });

  return candidates[0]?.event || null;
};

const MatchOddsHeatmap = ({ homeTeamName, awayTeamName, startTime, enabled = false }: MatchOddsHeatmapProps) => {
  const [propsExpanded, setPropsExpanded] = useState(false);

  const { data: oddsPayload } = useQuery<OddsPayload>({
    queryKey: ['match-details', 'odds-heatmap', homeTeamName, awayTeamName, startTime || ''],
    enabled: enabled && Boolean(homeTeamName && awayTeamName),
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const date = startTime ? new Date(startTime) : new Date();
      const minDate = new Date(date);
      minDate.setDate(minDate.getDate() - 1);
      const maxDate = new Date(date);
      maxDate.setDate(maxDate.getDate() + 1);

      const minIso = minDate.toISOString().slice(0, 10);
      const maxIso = maxDate.toISOString().slice(0, 10);

      const { data: events, error: eventsError } = await supabase
        .from('kalshi_events_active')
        .select('event_ticker,title,home_team,away_team,game_date,status')
        .eq('status', 'active')
        .gte('game_date', minIso)
        .lte('game_date', maxIso)
        .order('game_date', { ascending: true })
        .limit(300);

      if (eventsError) throw eventsError;
      const event = pickEventForMatch((events || []) as KalshiEventCandidate[], homeTeamName, awayTeamName);
      if (!event) return { eventTicker: null, rows: [] };

      const { data: snapshots, error: snapshotsError } = await supabase
        .from('kalshi_orderbook_snapshots')
        .select('market_ticker,market_type,market_label,line_value,line_side,yes_price,no_price,volume,open_interest,yes_no_imbalance,recent_volume_imbalance,last_trade_side,captured_at')
        .eq('event_ticker', event.event_ticker)
        .order('captured_at', { ascending: false })
        .limit(600);

      if (snapshotsError) throw snapshotsError;

      const deduped = new Map<string, KalshiSnapshotRow>();
      (snapshots || []).forEach((row) => {
        const ticker = String(row.market_ticker || '').trim();
        if (!ticker || deduped.has(ticker)) return;
        deduped.set(ticker, row as KalshiSnapshotRow);
      });

      return {
        eventTicker: event.event_ticker,
        rows: Array.from(deduped.values()),
      };
    },
  });

  const orderedOddsRows = useMemo(() => {
    const rows = oddsPayload?.rows || [];
    if (!rows.length) return { nonProps: [] as KalshiSnapshotRow[], props: [] as KalshiSnapshotRow[] };

    const totals = rows.filter((row) => (row.market_type || '').toLowerCase() === 'total');
    const mainTotal = totals.length
      ? [...totals].sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0))[0]
      : null;
    const mainTotalTicker = mainTotal?.market_ticker || null;

    const sorted = [...rows].sort((a, b) => marketRowComparator(a, b, mainTotalTicker));
    return {
      nonProps: sorted.filter((row) => (row.market_type || '').toLowerCase() !== 'prop'),
      props: sorted.filter((row) => (row.market_type || '').toLowerCase() === 'prop'),
    };
  }, [oddsPayload?.rows]);

  return (
    <div className="mx-auto w-full max-w-[420px] space-y-2.5">
      {oddsPayload?.rows?.length ? (
        <>
          {[...orderedOddsRows.nonProps, ...(propsExpanded ? orderedOddsRows.props : [])].map((row) => {
            const yesSideInfo = deriveSides(row);
            const yesPrice = typeof row.yes_price === 'number'
              ? row.yes_price
              : typeof row.no_price === 'number'
                ? Number((1 - row.no_price).toFixed(4))
                : null;
            const american = americanOddsFromPrice(yesPrice);

            const betsRaw = clamp01(row.recent_volume_imbalance);
            const moneyRaw = clamp01(row.yes_no_imbalance);
            const betSide = betsRaw >= 0.5 ? yesSideInfo.yes : yesSideInfo.no;
            const moneySide = moneyRaw >= 0.5 ? yesSideInfo.yes : yesSideInfo.no;
            const betImbalance = betsRaw >= 0.5 ? betsRaw : 1 - betsRaw;
            const moneyImbalance = moneyRaw >= 0.5 ? moneyRaw : 1 - moneyRaw;
            const state = actionState(betImbalance, moneyImbalance, betSide, moneySide);

            const actionLabel =
              state === 'split'
                ? 'Split action'
                : state === 'one-sided'
                  ? 'One-sided'
                  : 'Balanced';

            const betsFillClass = state === 'balanced' ? 'from-[#888780] to-[#B4B2A9]' : 'from-[#1D9E75] to-[#5DCAA5]';
            const moneyFillClass =
              state === 'split'
                ? 'from-[#E24B4A] to-[#F09595]'
                : state === 'balanced'
                  ? 'from-[#888780] to-[#B4B2A9]'
                  : 'from-[#1D9E75] to-[#5DCAA5]';
            const actionTone =
              state === 'split' ? 'text-[#E24B4A]'
                : state === 'one-sided' ? 'text-[#1D9E75]'
                  : 'text-slate-500';

            return (
              <div key={row.market_ticker} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0 truncate text-[13px] font-medium text-slate-900 tracking-tight">
                    <span>{row.market_label || row.market_ticker}</span>
                    <span className="font-mono tabular-nums text-slate-900"> · {yesPrice === null ? '—' : `${Math.round(yesPrice * 100)}¢`}</span>
                  </div>
                  <div className="shrink-0 text-right text-[12px] text-slate-700 font-mono tabular-nums">
                    {formatAmericanOdds(american)}
                  </div>
                </div>

                <div className="mt-2.5 space-y-2.5">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Bets</span>
                      <span className="font-mono tabular-nums text-slate-700">{Math.round(betImbalance * 100)}% {betSide}</span>
                    </div>
                    <div className="h-2 rounded-[4px] bg-slate-100 overflow-hidden border border-slate-200/80">
                      <div
                        className={`h-full bg-gradient-to-r ${betsFillClass} transition-all duration-200`}
                        style={{ width: `${Math.round(betImbalance * 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Money</span>
                      <span className="font-mono tabular-nums text-slate-700">{Math.round(moneyImbalance * 100)}% {moneySide}</span>
                    </div>
                    <div className="h-2 rounded-[4px] bg-slate-100 overflow-hidden border border-slate-200/80 flex">
                      <div
                        className={`h-full bg-gradient-to-r ${moneyFillClass} transition-all duration-200`}
                        style={{
                          width: `${Math.round(moneyImbalance * 100)}%`,
                          marginLeft: state === 'split' || moneyRaw < 0.5 ? 'auto' : undefined,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className={`mt-2 text-[11px] font-medium tracking-[0.03em] ${actionTone}`}>
                  {actionLabel}
                </div>
              </div>
            );
          })}

          {!propsExpanded && orderedOddsRows.props.length > 0 ? (
            <button
              type="button"
              onClick={() => setPropsExpanded(true)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-slate-700 hover:bg-slate-100"
            >
              Show props ({orderedOddsRows.props.length})
            </button>
          ) : null}

          <div className="flex items-center justify-center gap-4 pt-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-[999px] bg-[#1D9E75]" />One-sided</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-[999px] bg-[#E24B4A]" />Opposing</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-[999px] bg-[#888780]" />Balanced</span>
          </div>
        </>
      ) : (
        <div className="text-[11px] text-slate-500">No exchange data available</div>
      )}
    </div>
  );
};

export default memo(MatchOddsHeatmap);
