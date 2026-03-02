import React, { type FC, useMemo } from 'react';
import { formatMatchDateLabel, formatPct, formatSignedNumber } from '@/lib/postgamePages';
import { useMatchBySlug } from '@/hooks/usePostgame';
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

interface MatchPageProps {
  slug: string;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const minToPercent = (minute: number | null): number => {
  if (minute === null) return 0;
  return clamp((minute / 95) * 100, 0, 100);
};

const eventTypeLabel = (type: string): string => {
  if (type === 'goal') return 'Goal';
  if (type === 'card') return 'Card';
  if (type === 'substitution') return 'Sub';
  return 'Event';
};

const sideLabel = (side: 'home' | 'away' | 'neutral', homeTeam: string, awayTeam: string): string => {
  if (side === 'home') return homeTeam;
  if (side === 'away') return awayTeam;
  return 'Neutral';
};

const boolLabel = (value: boolean | null): string => {
  if (value === null) return '—';
  return value ? 'Yes' : 'No';
};

const poolLabel = (pool: string): string => {
  if (pool === 'anytime') return 'Anytime';
  if (pool === 'first') return 'First Goal';
  if (pool === 'last') return 'Last Goal';
  if (pool === 'live_anytime') return 'Live Anytime';
  return pool;
};

const resultTone = (result: string | null): string => {
  if (result === 'win') return 'text-emerald-300';
  if (result === 'loss') return 'text-rose-300';
  return 'text-zinc-300';
};

export const MatchPage: FC<MatchPageProps> = ({ slug }) => {
  const { data, isLoading, error } = useMatchBySlug(slug);

  const timelineEvents = useMemo(() => data?.timeline ?? [], [data]);
  const scorerOddsByPool = useMemo(() => {
    const rows = data?.playerScorerOdds ?? [];
    const buckets = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.pool || 'unknown';
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }

    return Array.from(buckets.entries()).map(([pool, rowsInPool]) => ({
      pool,
      rows: rowsInPool
        .slice()
        .sort((a, b) => (a.oddsDecimal ?? Number.MAX_SAFE_INTEGER) - (b.oddsDecimal ?? Number.MAX_SAFE_INTEGER))
        .slice(0, 8),
    }));
  }, [data]);

  return (
    <PageShell>
      <TopNav />

      {isLoading ? <LoadingBlock label="Loading match page…" /> : null}
      {error ? <EmptyBlock message={`Failed to load match: ${error.message}`} /> : null}
      {!isLoading && !error && !data ? (
        <EmptyBlock
          message={`Match not found: ${slug}. Try either /match/{league}-{home}-vs-{away}-{date} or /match/{home}-vs-{away}-{date}.`}
        />
      ) : null}

      {data ? (
        <div className="space-y-6 sm:space-y-8">
          <Card>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{data.leagueName}</p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
                    {data.homeTeam} vs {data.awayTeam}
                  </h1>
                </div>
                <DataPill className="text-sm">
                  <ValueText>
                    {data.homeScore ?? '—'}-{data.awayScore ?? '—'}
                  </ValueText>
                </DataPill>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCell label="Date" value={<span className="text-xs text-zinc-300">{formatMatchDateLabel(data.startTime)}</span>} />
                <MetricCell label="Venue" value={data.venue ?? '—'} />
                <MetricCell label="Referee" value={data.referee ?? '—'} />
                <MetricCell label="Matchday" value={data.matchday ?? '—'} />
              </div>
            </CardBody>
          </Card>

          {timelineEvents.length > 0 ? (
            <Card>
              <CardHeader>
                <SectionLabel>Score Timeline</SectionLabel>
              </CardHeader>
              <CardBody>
                <div className="relative h-14 rounded-md border border-zinc-800 bg-zinc-900/50">
                  <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-zinc-700" />
                  <span className="absolute left-2 top-2 text-[10px] text-zinc-500">0'</span>
                  <span className="absolute right-2 top-2 text-[10px] text-zinc-500">90'</span>

                  {timelineEvents.map((event, index) => (
                    <div
                      key={`${event.type}-${event.minuteLabel}-${index}`}
                      className="absolute top-1/2"
                      style={{ left: `${minToPercent(event.minute)}%` }}
                      title={`${event.minuteLabel} ${sideLabel(event.teamSide, data.homeTeam, data.awayTeam)} ${event.playerName ?? ''}`}
                    >
                      <div className="h-3 w-0.5 -translate-y-1/2 bg-zinc-200" />
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {timelineEvents.map((event, index) => (
                    <div key={`tl-${index}-${event.minuteLabel}`} className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-zinc-300">{eventTypeLabel(event.type)}</span>
                        <ValueText>{event.minuteLabel}</ValueText>
                      </div>
                      <div className="mt-1 text-zinc-400">
                        {sideLabel(event.teamSide, data.homeTeam, data.awayTeam)} {event.playerName ? `· ${event.playerName}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {data.boxScore.length > 0 ? (
            <Card>
              <CardHeader>
                <SectionLabel>Box Score</SectionLabel>
              </CardHeader>
              <CardBody className="p-0">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="border-b border-zinc-800">
                    <tr className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                      <th className="px-4 py-3 font-medium">Stat</th>
                      <th className="px-4 py-3 font-medium">{data.homeTeam}</th>
                      <th className="px-4 py-3 font-medium">{data.awayTeam}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.boxScore.map((row) => (
                      <tr key={row.key} className="border-b border-zinc-800/80 text-zinc-200">
                        <td className="px-4 py-3 text-zinc-400">{row.label}</td>
                        <td className="px-4 py-3">
                          <ValueText>{row.home}</ValueText>
                        </td>
                        <td className="px-4 py-3">
                          <ValueText>{row.away}</ValueText>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          ) : null}

          {(data.odds.homeMoneyline !== null || data.odds.total !== null || data.odds.spread !== null) ? (
            <Card>
              <CardHeader>
                <SectionLabel>DraftKings Closing Odds</SectionLabel>
              </CardHeader>
              <CardBody>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <MetricCell
                    label="Moneyline"
                    value={
                      <div className="flex flex-wrap gap-2 text-xs">
                        <DataPill>{data.homeTeam} {formatSignedNumber(data.odds.homeMoneyline, 0)}</DataPill>
                        <DataPill>Draw {formatSignedNumber(data.odds.drawMoneyline, 0)}</DataPill>
                        <DataPill>{data.awayTeam} {formatSignedNumber(data.odds.awayMoneyline, 0)}</DataPill>
                      </div>
                    }
                  />
                  <MetricCell
                    label="Spread"
                    value={
                      <div className="flex flex-wrap gap-2 text-xs">
                        <DataPill>
                          {formatSignedNumber(data.odds.spread, 1)} ({formatSignedNumber(data.odds.homeSpreadPrice, 0)})
                        </DataPill>
                        <DataPill>{formatSignedNumber(data.odds.awaySpreadPrice, 0)}</DataPill>
                      </div>
                    }
                  />
                  <MetricCell
                    label="Total"
                    value={
                      <div className="flex flex-wrap gap-2 text-xs">
                        <DataPill>{data.odds.total ?? '—'}</DataPill>
                        <DataPill>Over {formatSignedNumber(data.odds.overPrice, 0)}</DataPill>
                        <DataPill>Under {formatSignedNumber(data.odds.underPrice, 0)}</DataPill>
                      </div>
                    }
                  />
                </div>
              </CardBody>
            </Card>
          ) : null}

          {data.bet365TeamOdds ? (
            <Card>
              <CardHeader>
                <SectionLabel>Bet365 Team Markets</SectionLabel>
              </CardHeader>
              <CardBody>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <MetricCell
                    label="3-Way Moneyline"
                    value={
                      <div className="flex flex-wrap gap-2 text-xs">
                        <DataPill>{data.homeTeam} {data.bet365TeamOdds.homeFractional ?? '—'}</DataPill>
                        <DataPill>Draw {data.bet365TeamOdds.drawFractional ?? '—'}</DataPill>
                        <DataPill>{data.awayTeam} {data.bet365TeamOdds.awayFractional ?? '—'}</DataPill>
                      </div>
                    }
                  />
                  <MetricCell
                    label="Goal Line O/U"
                    value={
                      <div className="flex flex-wrap gap-2 text-xs">
                        <DataPill>Line {data.bet365TeamOdds.ouHandicap ?? '—'}</DataPill>
                        <DataPill>Over {data.bet365TeamOdds.overFractional ?? '—'}</DataPill>
                        <DataPill>Under {data.bet365TeamOdds.underFractional ?? '—'}</DataPill>
                      </div>
                    }
                  />
                  <MetricCell
                    label="Double Chance"
                    value={
                      <div className="flex flex-wrap gap-2 text-xs">
                        <DataPill>1X {data.bet365TeamOdds.dcHomeDrawFractional ?? '—'}</DataPill>
                        <DataPill>X2 {data.bet365TeamOdds.dcDrawAwayFractional ?? '—'}</DataPill>
                        <DataPill>12 {data.bet365TeamOdds.dcHomeAwayFractional ?? '—'}</DataPill>
                      </div>
                    }
                  />
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <SectionLabel>v5 Game Flow</SectionLabel>
            </CardHeader>
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCell label="Drain Version" value={data.gameFlow.drainVersion ?? '—'} />
                <MetricCell label="HT / FT" value={data.gameFlow.htFtResult ?? '—'} />
                <MetricCell label="BTTS" value={boolLabel(data.gameFlow.btts)} />
                <MetricCell label="First Goal Team" value={data.gameFlow.firstGoalTeam ?? '—'} />
                <MetricCell label="First Goal Window" value={data.gameFlow.firstGoalInterval ?? '—'} />
                <MetricCell label="Last Goal Minute" value={<ValueText>{data.gameFlow.lastGoalMinute ?? '—'}</ValueText>} />
                <MetricCell
                  label="Half Splits"
                  value={
                    <ValueText>
                      {data.gameFlow.homeGoals1H ?? '—'}-{data.gameFlow.awayGoals1H ?? '—'} / {data.gameFlow.homeGoals2H ?? '—'}-{data.gameFlow.awayGoals2H ?? '—'}
                    </ValueText>
                  }
                />
                <MetricCell label="Goals 1H %" value={formatPct(data.gameFlow.goals1HPct)} />
                <MetricCell label="Late Goals" value={<ValueText>{data.gameFlow.lateGoals ?? '—'}</ValueText>} />
                <MetricCell label="Stoppage Goals" value={<ValueText>{data.gameFlow.stoppageTimeGoals ?? '—'}</ValueText>} />
                <MetricCell label="Penalty Awarded" value={boolLabel(data.gameFlow.penaltyAwarded)} />
                <MetricCell label="Total Penalties" value={<ValueText>{data.gameFlow.totalPenalties ?? '—'}</ValueText>} />
              </div>
            </CardBody>
          </Card>

          {data.lineups.length > 0 ? (
            <Card>
              <CardHeader>
                <SectionLabel>Lineups</SectionLabel>
              </CardHeader>
              <CardBody>
                <div className="grid gap-4 lg:grid-cols-2">
                  {data.lineups.map((lineup) => (
                    <div key={`${lineup.side}-${lineup.teamName}`} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold text-zinc-100">{lineup.teamName}</div>
                        <DataPill>{lineup.formation ?? 'Formation —'}</DataPill>
                      </div>
                      {lineup.starters.length > 0 ? (
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">Starting XI</div>
                          <div className="flex flex-wrap gap-1.5 text-xs text-zinc-300">
                            {lineup.starters.map((player) => (
                              <span key={`${lineup.side}-st-${player}`} className="rounded border border-zinc-800 px-2 py-1">
                                {player}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {lineup.substitutes.length > 0 ? (
                        <div className="mt-3">
                          <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">Substitutes</div>
                          <div className="flex flex-wrap gap-1.5 text-xs text-zinc-400">
                            {lineup.substitutes.map((player) => (
                              <span key={`${lineup.side}-sub-${player}`} className="rounded border border-zinc-800 px-2 py-1">
                                {player}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {data.events.length > 0 ? (
            <Card>
              <CardHeader>
                <SectionLabel>Events</SectionLabel>
              </CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-zinc-800">
                  {data.events.map((event, index) => (
                    <div key={`ev-${index}-${event.minuteLabel}-${event.type}`} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm sm:px-5">
                      <DataPill>{event.minuteLabel}</DataPill>
                      <DataPill className="text-zinc-400">{eventTypeLabel(event.type)}</DataPill>
                      <span className="text-zinc-200">{sideLabel(event.teamSide, data.homeTeam, data.awayTeam)}</span>
                      {event.playerName ? <span className="text-zinc-400">· {event.playerName}</span> : null}
                      {event.detail ? <span className="text-zinc-500">· {event.detail}</span> : null}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {scorerOddsByPool.length > 0 ? (
            <Card>
              <CardHeader>
                <SectionLabel>Bet365 Player Scorer Odds</SectionLabel>
              </CardHeader>
              <CardBody className="space-y-4">
                {scorerOddsByPool.map((bucket) => (
                  <div key={bucket.pool}>
                    <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500">{poolLabel(bucket.pool)}</div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {bucket.rows.map((row) => (
                        <div key={row.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
                          <div className="truncate font-medium text-zinc-100">{row.playerName}</div>
                          <div className="mt-1 flex items-center justify-between text-zinc-400">
                            <span>{row.oddsFractional ?? '—'}</span>
                            <span>{row.impliedProb === null ? '—' : `${row.impliedProb.toFixed(1)}%`}</span>
                          </div>
                          <div className={`mt-1 text-[10px] uppercase tracking-[0.08em] ${resultTone(row.result)}`}>
                            {row.result ?? 'ungraded'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}
    </PageShell>
  );
};

export default MatchPage;
