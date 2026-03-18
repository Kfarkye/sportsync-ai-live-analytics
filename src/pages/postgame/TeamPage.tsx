import React, { type FC, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMatchDateLabel, formatPct, formatSignedNumber, leagueLabel } from '@/lib/postgamePages';
import { useTeamPage } from '@/hooks/usePostgame';
import { useTeamHistory } from '@/hooks/useTeamHistory';
import { supabase } from '@/lib/supabase';
import {
  Card,
  CardBody,
  CardHeader,
  DataPill,
  EmptyBlock,
  LoadingBlock,
  MetricCell,
  PageShell,
  SectionLabel,
  TopNav,
  ValueText,
} from './PostgamePrimitives';

interface TeamPageProps {
  teamSlug: string;
  query: URLSearchParams;
}

type TeamInsightsTab = 'trends' | 'odds';

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

type OddsTabPayload = {
  eventTicker: string | null;
  rows: KalshiSnapshotRow[];
};

const rangeText = (range: { min: number | null; max: number | null; avg: number | null }, decimals = 1): string => {
  if (range.min === null || range.max === null || range.avg === null) return '—';
  return `${formatSignedNumber(range.min, decimals)} to ${formatSignedNumber(range.max, decimals)} (avg ${formatSignedNumber(range.avg, decimals)})`;
};

const resultTone = (value: 'W' | 'D' | 'L' | '—' | 'P' | 'O' | 'U') => {
  if (value === 'W' || value === 'O') return 'text-emerald-700';
  if (value === 'L' || value === 'U') return 'text-rose-700';
  return 'text-slate-700';
};

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
  moneySide: string
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

const pickEventForTeam = (events: KalshiEventCandidate[], teamName: string, teamSlug: string): KalshiEventCandidate | null => {
  const normalizedTeam = normalizeToken(teamName);
  const normalizedSlug = normalizeToken(teamSlug.replace(/-/g, ' '));
  const candidates = events
    .map((event) => {
      const text = normalizeToken(`${event.title || ''} ${event.home_team || ''} ${event.away_team || ''}`);
      const teamScore = text.includes(normalizedTeam) ? normalizedTeam.length : 0;
      const slugScore = text.includes(normalizedSlug) ? normalizedSlug.length : 0;
      const score = Math.max(teamScore, slugScore);
      return { event, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const dateA = Date.parse(a.event.game_date || '');
      const dateB = Date.parse(b.event.game_date || '');
      if (Number.isFinite(dateA) && Number.isFinite(dateB)) return dateA - dateB;
      return 0;
    });

  return candidates[0]?.event || null;
};

export const TeamPage: FC<TeamPageProps> = ({ teamSlug, query }) => {
  const leagueParam = query.get('league');
  const [insightTab, setInsightTab] = useState<TeamInsightsTab>('trends');
  const [propsExpanded, setPropsExpanded] = useState(false);
  const { data, isLoading, error } = useTeamPage(teamSlug, leagueParam);
  const {
    data: historyRows = [],
    isLoading: isHistoryLoading,
    error: historyError,
  } = useTeamHistory(teamSlug, leagueParam);

  const { data: oddsPayload } = useQuery<OddsTabPayload>({
    queryKey: ['postgame', 'team-odds', teamSlug, data?.teamName ?? ''],
    enabled: insightTab === 'odds' && Boolean(data?.teamName),
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: events, error: eventsError } = await supabase
        .from('kalshi_events_active')
        .select('event_ticker,title,home_team,away_team,game_date,status')
        .eq('status', 'active')
        .gte('game_date', today)
        .order('game_date', { ascending: true })
        .limit(300);

      if (eventsError) throw eventsError;
      const event = pickEventForTeam((events || []) as KalshiEventCandidate[], data?.teamName || '', teamSlug);
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
      ? [...totals].sort((a, b) => (Number(b.volume || 0) - Number(a.volume || 0)))[0]
      : null;
    const mainTotalTicker = mainTotal?.market_ticker || null;

    const sorted = [...rows].sort((a, b) => marketRowComparator(a, b, mainTotalTicker));
    return {
      nonProps: sorted.filter((row) => (row.market_type || '').toLowerCase() !== 'prop'),
      props: sorted.filter((row) => (row.market_type || '').toLowerCase() === 'prop'),
    };
  }, [oddsPayload?.rows]);

  const seasonRows = historyRows.length > 0 ? historyRows : (data?.rows ?? []);
  const seasonRecord = seasonRows.reduce(
    (acc, row) => {
      if (row.result === 'W') acc.wins += 1;
      if (row.result === 'D') acc.draws += 1;
      if (row.result === 'L') acc.losses += 1;
      acc.goalsFor += row.teamScore ?? 0;
      acc.goalsAgainst += row.oppScore ?? 0;
      return acc;
    },
    { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
  );

  return (
    <PageShell>
      <TopNav />

      {isLoading ? <LoadingBlock label="Loading team archive…" /> : null}
      {error ? <EmptyBlock message={`Failed to load team page: ${error.message}`} /> : null}

      {data ? (
        <div className="space-y-6 sm:space-y-8">
          <header className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Team</p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{data.teamName}</h1>
            <p className="text-sm text-slate-500">
              {data.leagueId ? leagueLabel(data.leagueId) : 'All Leagues'} · <ValueText>{seasonRows.length}</ValueText> matches
            </p>
          </header>

          {historyError ? (
            <EmptyBlock message={`Team history fallback active (using postgame rows): ${historyError.message}`} />
          ) : null}

          <Card>
            <CardHeader>
              <SectionLabel>Aggregate Stats</SectionLabel>
            </CardHeader>
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCell
                  label="Record"
                  value={
                    <ValueText>
                      {seasonRecord.wins}-{seasonRecord.draws}-{seasonRecord.losses}
                    </ValueText>
                  }
                />
                <MetricCell
                  label="Goals"
                  value={
                    <ValueText>
                      {seasonRecord.goalsFor}:{seasonRecord.goalsAgainst}
                    </ValueText>
                  }
                />
                <MetricCell
                  label="Avg Possession"
                  value={<ValueText>{data.aggregate.avgPossession === null ? '—' : `${data.aggregate.avgPossession.toFixed(1)}%`}</ValueText>}
                />
                <MetricCell
                  label="Avg xG"
                  value={
                    <ValueText>
                      {data.aggregate.avgXgFor === null ? '—' : data.aggregate.avgXgFor.toFixed(2)} /{' '}
                      {data.aggregate.avgXgAgainst === null ? '—' : data.aggregate.avgXgAgainst.toFixed(2)}
                    </ValueText>
                  }
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <SectionLabel>Team Card</SectionLabel>
                <div className="flex items-end gap-4 border-b border-slate-200/80">
                  <button
                    type="button"
                    onClick={() => setInsightTab('trends')}
                    className={`pb-2 text-[12px] font-medium tracking-[0.08em] uppercase ${
                      insightTab === 'trends'
                        ? 'text-slate-900 border-b-2 border-slate-900'
                        : 'text-slate-500'
                    }`}
                  >
                    Trends
                  </button>
                  <button
                    type="button"
                    onClick={() => setInsightTab('odds')}
                    className={`pb-2 text-[12px] font-medium tracking-[0.08em] uppercase ${
                      insightTab === 'odds'
                        ? 'text-slate-900 border-b-2 border-slate-900'
                        : 'text-slate-500'
                    }`}
                  >
                    Odds
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardBody>
              {insightTab === 'trends' ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <MetricCell label="BTTS" value={<ValueText>{formatPct(data.trends.bttsRate)}</ValueText>} />
                    <MetricCell label="First Goal" value={<ValueText>{formatPct(data.trends.firstGoalRate)}</ValueText>} />
                    <MetricCell label="Scored Both Halves" value={<ValueText>{formatPct(data.trends.scoredBothHalvesRate)}</ValueText>} />
                    <MetricCell label="Late Goal Frequency" value={<ValueText>{formatPct(data.trends.lateGoalRate)}</ValueText>} />
                    <MetricCell label="ML Trend" value={<span className="text-xs text-slate-700">{rangeText(data.trends.mlRange, 0)}</span>} />
                    <MetricCell label="Spread Trend" value={<span className="text-xs text-slate-700">{rangeText(data.trends.spreadRange, 1)}</span>} />
                    <MetricCell label="Total Trend" value={<span className="text-xs text-slate-700">{rangeText(data.trends.totalRange, 1)}</span>} className="sm:col-span-2 lg:col-span-1" />
                  </div>

                  {data.trends.htFtDistribution.length > 0 ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {data.trends.htFtDistribution.slice(0, 8).map((item) => (
                        <div key={item.key} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                          <div className="text-slate-500">HT/FT</div>
                          <div className="mt-1 font-mono text-slate-800">
                            {item.key} <span className="text-slate-500">({item.count})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mx-auto w-full max-w-[420px] space-y-3">
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
                          <div key={row.market_ticker} className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="flex items-baseline justify-between gap-2">
                              <div className="min-w-0 truncate text-[13px] font-medium text-slate-900">
                                <span>{row.market_label || row.market_ticker}</span>
                                <span className="font-mono tabular-nums"> · {yesPrice === null ? '—' : `${Math.round(yesPrice * 100)}¢`}</span>
                              </div>
                              <div className="shrink-0 text-right text-[12px] text-slate-500 font-mono tabular-nums">
                                {formatAmericanOdds(american)}
                              </div>
                            </div>

                            <div className="mt-3 space-y-2.5">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[11px] text-slate-500">
                                  <span>Bets</span>
                                  <span className="font-mono tabular-nums">{Math.round(betImbalance * 100)}% {betSide}</span>
                                </div>
                                <div className="h-2 rounded-[4px] bg-slate-200 overflow-hidden">
                                  <div
                                    className={`h-full bg-gradient-to-r ${betsFillClass}`}
                                    style={{ width: `${Math.round(betImbalance * 100)}%` }}
                                  />
                                </div>
                              </div>

                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[11px] text-slate-500">
                                  <span>Money</span>
                                  <span className="font-mono tabular-nums">{Math.round(moneyImbalance * 100)}% {moneySide}</span>
                                </div>
                                <div className="h-2 rounded-[4px] bg-slate-200 overflow-hidden flex">
                                  <div
                                    className={`h-full bg-gradient-to-r ${moneyFillClass}`}
                                    style={{
                                      width: `${Math.round(moneyImbalance * 100)}%`,
                                      marginLeft: state === 'split' || moneyRaw < 0.5 ? 'auto' : undefined,
                                    }}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className={`mt-2 text-[11px] font-medium ${actionTone}`}>
                              {actionLabel}
                            </div>
                          </div>
                        );
                      })}

                      {!propsExpanded && orderedOddsRows.props.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setPropsExpanded(true)}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-slate-600"
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
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <SectionLabel>Season Results</SectionLabel>
            </CardHeader>
            <CardBody className="p-0">
              {isHistoryLoading && (data?.rows?.length ?? 0) === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">Loading team history…</div>
              ) : seasonRows.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">No team matches found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="border-b border-slate-200">
                      <tr className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Opponent</th>
                        <th className="px-4 py-3 font-medium">Score</th>
                        <th className="px-4 py-3 font-medium">Result</th>
                        <th className="px-4 py-3 font-medium">ATS</th>
                        <th className="px-4 py-3 font-medium">O/U</th>
                        <th className="px-4 py-3 font-medium">Lines</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seasonRows.map((row) => (
                        <tr key={row.matchId} className="border-b border-slate-200 text-slate-800">
                          <td className="px-4 py-3 text-xs text-slate-500">{formatMatchDateLabel(row.startTime)}</td>
                          <td className="px-4 py-3">
                            <a href={`/match/${row.matchSlug}`} className="font-medium text-slate-900 hover:text-slate-800">
                              {row.isHome ? 'vs' : '@'} {row.opponent}
                            </a>
                          </td>
                          <td className="px-4 py-3">
                            <ValueText>
                              {row.teamScore ?? '—'}-{row.oppScore ?? '—'}
                            </ValueText>
                          </td>
                          <td className={`px-4 py-3 font-mono ${resultTone(row.result)}`}>{row.result}</td>
                          <td className={`px-4 py-3 font-mono ${resultTone(row.atsResult)}`}>{row.atsResult}</td>
                          <td className={`px-4 py-3 font-mono ${resultTone(row.ouResult)}`}>{row.ouResult}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <DataPill>SPR {row.spread === null ? '—' : formatSignedNumber(row.spread, 1)}</DataPill>
                              <DataPill>O/U {row.total ?? '—'}</DataPill>
                              <DataPill>ML {row.moneyline === null ? '—' : formatSignedNumber(row.moneyline, 0)}</DataPill>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </PageShell>
  );
};

export default TeamPage;
