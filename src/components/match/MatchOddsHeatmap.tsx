import React, { memo, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type KalshiEventCandidate = {
  event_ticker: string;
  title: string | null;
  home_team: string | null;
  away_team: string | null;
  game_date: string | null;
  status: string | null;
  last_snapshot_at?: string | null;
};

type SnapshotDiscoveryRow = {
  event_ticker: string;
  market_label: string | null;
  captured_at: string;
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
  homeAliases?: string[];
  awayAliases?: string[];
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

const buildVariants = (names: string[]): { phrases: string[]; tokens: string[] } => {
  const phraseSet = new Set<string>();
  const tokenSet = new Set<string>();

  names.forEach((name) => {
    const normalized = normalizeToken(name);
    if (!normalized) return;

    phraseSet.add(normalized);
    const tokens = normalized.split(' ').filter(Boolean);

    if (tokens.length >= 2) phraseSet.add(tokens.slice(0, 2).join(' '));
    if (tokens.length >= 3) phraseSet.add(tokens.slice(0, 3).join(' '));
    if (tokens.length >= 2) phraseSet.add(tokens.slice(0, tokens.length - 1).join(' '));

    tokens.forEach((token) => {
      if (token.length >= 3) tokenSet.add(token);
    });
  });

  return {
    phrases: Array.from(phraseSet).sort((a, b) => b.length - a.length),
    tokens: Array.from(tokenSet),
  };
};

const teamMatchScore = (eventText: string, team: { phrases: string[]; tokens: string[] }): number => {
  let phraseScore = 0;
  for (const phrase of team.phrases) {
    if (!phrase) continue;
    if (eventText.includes(phrase)) {
      phraseScore = Math.max(phraseScore, phrase.length * 2);
      break;
    }
  }

  const tokenHits = team.tokens.reduce((acc, token) => acc + (eventText.includes(token) ? 1 : 0), 0);
  return phraseScore + tokenHits * 3;
};

const pickEventForMatch = (
  events: KalshiEventCandidate[],
  homeNames: string[],
  awayNames: string[],
  startTime?: string,
): KalshiEventCandidate | null => {
  const homeTeam = buildVariants(homeNames);
  const awayTeam = buildVariants(awayNames);
  const gameDate = startTime ? new Date(startTime) : null;

  const ranked = events
    .map((event) => {
      const text = normalizeToken(`${event.title || ''} ${event.home_team || ''} ${event.away_team || ''}`);
      const homeScore = teamMatchScore(text, homeTeam);
      const awayScore = teamMatchScore(text, awayTeam);
      const score = homeScore + awayScore;
      const both = homeScore > 0 && awayScore > 0;

      const eventDate = event.game_date ? new Date(`${event.game_date}T12:00:00Z`) : null;
      const dateDistance = gameDate && eventDate
        ? Math.abs(eventDate.getTime() - gameDate.getTime())
        : Number.POSITIVE_INFINITY;

      const snapshotTime = event.last_snapshot_at ? Date.parse(event.last_snapshot_at) : 0;
      return { event, score, both, dateDistance, snapshotTime };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      if (a.both !== b.both) return a.both ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      if (a.dateDistance !== b.dateDistance) return a.dateDistance - b.dateDistance;
      return b.snapshotTime - a.snapshotTime;
    });

  return ranked[0]?.event || null;
};

const MatchOddsHeatmap = ({
  homeTeamName,
  awayTeamName,
  startTime,
  homeAliases = [],
  awayAliases = [],
  enabled = false,
}: MatchOddsHeatmapProps) => {
  const [propsExpanded, setPropsExpanded] = useState(false);

  const { data: oddsPayload, isFetching } = useQuery<OddsPayload>({
    queryKey: ['match-details', 'odds-heatmap', homeTeamName, awayTeamName, startTime || ''],
    enabled: enabled && Boolean(homeTeamName && awayTeamName),
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const homeNames = [homeTeamName, ...homeAliases].filter(Boolean);
      const awayNames = [awayTeamName, ...awayAliases].filter(Boolean);
      const homeTeam = buildVariants(homeNames);
      const awayTeam = buildVariants(awayNames);

      const queryEvents = async (dateScoped: boolean) => {
        const date = startTime ? new Date(startTime) : null;
        const minDate = date ? new Date(date) : null;
        const maxDate = date ? new Date(date) : null;

        if (minDate && maxDate) {
          minDate.setDate(minDate.getDate() - 2);
          maxDate.setDate(maxDate.getDate() + 2);
        }

        let query = supabase
          .from('kalshi_events_active')
          .select('event_ticker,title,home_team,away_team,game_date,status,last_snapshot_at')
          .order('game_date', { ascending: true })
          .limit(dateScoped ? 350 : 800);

        if (dateScoped && minDate && maxDate) {
          query = query
            .gte('game_date', minDate.toISOString().slice(0, 10))
            .lte('game_date', maxDate.toISOString().slice(0, 10));
        }

        const { data, error } = await query;
        if (error) return [] as KalshiEventCandidate[];
        return (data || []) as KalshiEventCandidate[];
      };

      const fetchSnapshotsForEvent = async (eventTicker: string): Promise<KalshiSnapshotRow[]> => {
        const { data: snapshots, error: snapshotsError } = await supabase
          .from('kalshi_orderbook_snapshots')
          .select('market_ticker,market_type,market_label,line_value,line_side,yes_price,no_price,volume,open_interest,yes_no_imbalance,recent_volume_imbalance,last_trade_side,captured_at')
          .eq('event_ticker', eventTicker)
          .order('captured_at', { ascending: false })
          .limit(900);

        if (snapshotsError) return [];

        const deduped = new Map<string, KalshiSnapshotRow>();
        (snapshots || []).forEach((row) => {
          const ticker = String(row.market_ticker || '').trim();
          if (!ticker || deduped.has(ticker)) return;
          deduped.set(ticker, row as KalshiSnapshotRow);
        });
        return Array.from(deduped.values());
      };

      const discoverEventFromSnapshots = async (): Promise<string | null> => {
        const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from('kalshi_orderbook_snapshots')
          .select('event_ticker,market_label,captured_at')
          .gte('captured_at', sevenDaysAgoIso)
          .order('captured_at', { ascending: false })
          .limit(2500);

        if (error || !data?.length) return null;

        const byEvent = new Map<string, { score: number; both: boolean; homeSeen: boolean; awaySeen: boolean; latest: number }>();
        (data as SnapshotDiscoveryRow[]).forEach((row) => {
          const eventTicker = String(row.event_ticker || '').trim();
          if (!eventTicker) return;
          const text = normalizeToken(row.market_label || '');
          if (!text) return;

          const homeScore = teamMatchScore(text, homeTeam);
          const awayScore = teamMatchScore(text, awayTeam);
          if (homeScore <= 0 && awayScore <= 0) return;

          const existing = byEvent.get(eventTicker) || {
            score: 0,
            both: false,
            homeSeen: false,
            awaySeen: false,
            latest: 0,
          };

          existing.score += homeScore + awayScore;
          existing.homeSeen = existing.homeSeen || homeScore > 0;
          existing.awaySeen = existing.awaySeen || awayScore > 0;
          existing.both = existing.homeSeen && existing.awaySeen;
          existing.latest = Math.max(existing.latest, Date.parse(row.captured_at || '') || 0);
          byEvent.set(eventTicker, existing);
        });

        const ranked = Array.from(byEvent.entries()).sort((a, b) => {
          if (a[1].both !== b[1].both) return a[1].both ? -1 : 1;
          if (b[1].score !== a[1].score) return b[1].score - a[1].score;
          return b[1].latest - a[1].latest;
        });

        const best = ranked[0];
        if (!best || best[1].score <= 0) return null;
        return best[0];
      };

      const scopedEvents = await queryEvents(true);
      let event = pickEventForMatch(scopedEvents, homeNames, awayNames, startTime);

      if (!event) {
        const broadEvents = await queryEvents(false);
        event = pickEventForMatch(broadEvents, homeNames, awayNames, startTime);
      }

      if (event) {
        const eventRows = await fetchSnapshotsForEvent(event.event_ticker);
        if (eventRows.length) {
          return { eventTicker: event.event_ticker, rows: eventRows };
        }
      }

      const snapshotEventTicker = await discoverEventFromSnapshots();
      if (snapshotEventTicker) {
        const snapshotRows = await fetchSnapshotsForEvent(snapshotEventTicker);
        if (snapshotRows.length) {
          return { eventTicker: snapshotEventTicker, rows: snapshotRows };
        }
      }

      return { eventTicker: event?.event_ticker || null, rows: [] };
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

  const allRows = [...orderedOddsRows.nonProps, ...(propsExpanded ? orderedOddsRows.props : [])];
  const latestCapturedAt = oddsPayload?.rows?.[0]?.captured_at;

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#D9E2F3] bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFF_100%)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-[#1D9E75]" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#10223A]">Exchange Board</span>
          {oddsPayload?.eventTicker ? (
            <span className="text-[10px] font-mono text-slate-500">{oddsPayload.eventTicker}</span>
          ) : null}
        </div>
        <span className="text-[10px] font-mono text-slate-500">
          {latestCapturedAt ? `Updated ${new Date(latestCapturedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Awaiting market stream'}
        </span>
      </div>

      {isFetching && !(oddsPayload?.rows?.length) ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[11px] text-slate-500">Syncing exchange depth...</div>
      ) : null}

      {allRows.length ? (
        <div className="space-y-2.5">
          {allRows.map((row) => {
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
              <div key={row.market_ticker} className="rounded-xl border border-[#D9E2F3] bg-white px-3.5 py-3 shadow-[0_10px_24px_-22px_rgba(16,34,58,0.45)]">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0 truncate text-[13px] font-medium text-[#10223A] tracking-tight">
                    <span>{row.market_label || row.market_ticker}</span>
                    <span className="font-mono tabular-nums text-[#10223A]"> · {yesPrice === null ? '—' : `${Math.round(yesPrice * 100)}¢`}</span>
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
                        style={{ width: `${Math.max(6, Math.round(betImbalance * 100))}%` }}
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
                          width: `${Math.max(6, Math.round(moneyImbalance * 100))}%`,
                          marginLeft: state === 'split' ? 'auto' : undefined,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className={`mt-2 text-[11px] font-semibold tracking-[0.03em] ${actionTone}`}>
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
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[11px] text-slate-500">No exchange data available</div>
      )}
    </div>
  );
};

export default memo(MatchOddsHeatmap);
