import React, { memo } from 'react';
import { cn } from '@/lib/essence';
import type { MatchStreakSummary, TeamStreakRow } from '@/hooks/useMatchStreaks';

interface StreakInsightsPanelProps {
  summary?: MatchStreakSummary;
  homeLabel: string;
  awayLabel: string;
  sport?: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const formatRate = (value: number): string => `${Math.round(value)}%`;

const formatDelta = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;

const DeviationBar = ({ delta }: { delta: number }) => {
  const intensity = clamp(Math.abs(delta), 0, 40);
  const widthPct = (intensity / 40) * 50;
  const isUp = delta >= 0;

  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-300" />
      <span
        className={cn(
          'absolute top-0 h-full rounded-full',
          isUp ? 'bg-emerald-500/80' : 'bg-rose-500/75',
        )}
        style={{
          left: isUp ? '50%' : `${50 - widthPct}%`,
          width: `${widthPct}%`,
        }}
      />
    </div>
  );
};

const StreakMetricRow = ({ row }: { row: TeamStreakRow }) => (
  <div
    className={cn(
      'rounded-xl border px-3 py-2.5',
      row.hot ? 'border-slate-300 bg-white shadow-[0_8px_18px_-14px_rgba(15,23,42,0.35)]' : 'border-slate-200 bg-slate-50/60',
    )}
  >
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">{row.metric}</p>
      <p className="font-mono text-[12px] font-bold tabular-nums text-slate-900">{formatRate(row.rate)}</p>
    </div>
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500">N {row.sample}</p>
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500">League {formatRate(row.leagueAvg)}</p>
    </div>
    <DeviationBar delta={row.delta} />
    <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-600">
      Difference {formatDelta(row.delta)}
    </p>
  </div>
);

const TeamColumn = ({
  title,
  rows,
  crossLeagueRows,
  showCrossLeague,
}: {
  title: string;
  rows: TeamStreakRow[];
  crossLeagueRows: TeamStreakRow[];
  showCrossLeague: boolean;
}) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <h4 className="truncate text-[12px] font-semibold tracking-tight text-slate-900">{title}</h4>
      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-600">
        {rows.length} signals
      </span>
    </div>

    {rows.length === 0 ? (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-[12px] text-slate-500">
        No strong form lines yet.
      </div>
    ) : (
      <div className="space-y-2.5">
        {rows.slice(0, 8).map((row) => (
          <StreakMetricRow key={row.id} row={row} />
        ))}
      </div>
    )}

    {showCrossLeague && crossLeagueRows.length > 0 && (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-3 py-2.5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
          Other competitions
        </p>
        <div className="space-y-2">
          {crossLeagueRows.slice(0, 3).map((row) => (
            <div key={`x-${row.id}`} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-slate-700">{row.metric}</span>
              <span className="shrink-0 font-mono tabular-nums text-slate-800">
                {formatRate(row.rate)} ({formatDelta(row.delta)})
              </span>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
);

const BaselineRow = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
    <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
    <p className="mt-0.5 font-mono text-[11px] font-semibold tabular-nums text-slate-900">{value}</p>
  </div>
);

const StreakInsightsPanel = ({ summary, homeLabel, awayLabel, sport }: StreakInsightsPanelProps) => {
  if (!summary) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-[12px] text-slate-500">
        Team form lines are still syncing for this match.
      </div>
    );
  }

  const baseline = summary.baseline;
  const sportKey = String(sport || summary.sport || '').toLowerCase();
  const isSoccer = sportKey.includes('soccer');
  const isBaseball = sportKey.includes('baseball');
  const avgTotalLabel = isSoccer ? 'Avg goals' : isBaseball ? 'Avg runs' : 'Avg points';

  return (
    <section className="space-y-4">
      {baseline && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">League baseline</p>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500">
              {baseline.leagueLabel} · {baseline.matches} matches
            </span>
          </div>
          {isSoccer ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <BaselineRow label="Over 2.5" value={formatRate(baseline.over25)} />
              <BaselineRow label="Both score" value={formatRate(baseline.btts)} />
              <BaselineRow label="Clean sheet" value={formatRate(baseline.cleanSheet)} />
              <BaselineRow label={avgTotalLabel} value={baseline.avgTotal.toFixed(2)} />
              <BaselineRow label="Hot signals" value={`${summary.hotCount}/${summary.totalCount || 0}`} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <BaselineRow label={avgTotalLabel} value={baseline.avgTotal.toFixed(1)} />
              <BaselineRow label="League games" value={String(baseline.matches)} />
              <BaselineRow label="Hot signals" value={`${summary.hotCount}/${summary.totalCount || 0}`} />
              <BaselineRow label="Tracked signals" value={String(summary.totalCount)} />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <TeamColumn
          title={homeLabel}
          rows={summary.home}
          crossLeagueRows={summary.crossLeagueHome}
          showCrossLeague={isSoccer}
        />
        <TeamColumn
          title={awayLabel}
          rows={summary.away}
          crossLeagueRows={summary.crossLeagueAway}
          showCrossLeague={isSoccer}
        />
      </div>
    </section>
  );
};

export default memo(StreakInsightsPanel);
