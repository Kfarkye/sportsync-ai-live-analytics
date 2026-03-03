import React from "react";
import type { Match } from "@/types";
import { cn } from "@/lib/essence";
import { useLiveIntelligenceCard } from "@/hooks/useLiveIntelligenceCard";

type Props = {
  match: Match;
};

const toneClass = {
  OVER: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UNDER: "bg-rose-50 text-rose-700 border-rose-200",
  HOME: "bg-sky-50 text-sky-700 border-sky-200",
  AWAY: "bg-indigo-50 text-indigo-700 border-indigo-200",
  PASS: "bg-slate-100 text-slate-600 border-slate-200",
} as const;

export const LiveIntelligenceCard: React.FC<Props> = ({ match }) => {
  const { data, isLoading } = useLiveIntelligenceCard(match);

  if (isLoading && !data) {
    return (
      <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-[0_2px_20px_rgba(0,0,0,0.02)]">
        <div className="mb-3 h-2 w-28 animate-pulse rounded bg-slate-200" />
        <div className="mb-2 h-4 w-2/3 animate-pulse rounded bg-slate-200" />
        <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
      </div>
    );
  }

  if (!data?.card) return null;

  const card = data.card;
  const tone = toneClass[card.lean] ?? toneClass.PASS;
  const drivers = Array.isArray(card.drivers)
    ? card.drivers.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const watchouts = Array.isArray(card.watchouts)
    ? card.watchouts.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-[0_2px_20px_rgba(0,0,0,0.02)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Live Intelligence
          </div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-tight text-slate-900">
            {card.headline}
          </h3>
        </div>
        <div className="text-right">
          <span
            className={cn(
              "inline-flex rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
              tone,
            )}
          >
            {card.market} · {card.lean}
          </span>
          <div className="mt-1 text-[11px] tabular-nums text-slate-500">
            {Math.round(card.confidence)}% confidence
          </div>
        </div>
      </div>

      <p className="mb-4 text-[13px] leading-relaxed text-slate-700">{card.thesis}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Drivers
          </div>
          <ul className="space-y-1">
            {(drivers.length > 0 ? drivers : ["No decisive live driver yet."]).map((driver, idx) => (
              <li key={idx} className="text-[12px] text-slate-700">
                • {driver}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Watchouts
          </div>
          <ul className="space-y-1">
            {(watchouts.length > 0 ? watchouts : ["Wait for the next high-leverage state change."]).map((watchout, idx) => (
              <li key={idx} className="text-[12px] text-slate-700">
                • {watchout}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 tabular-nums">
          State {data.state_hash}
        </span>
        {data.odds_context?.latest_total !== null &&
        data.odds_context?.latest_total !== undefined ? (
          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 tabular-nums">
            Total {data.odds_context.latest_total}
          </span>
        ) : null}
        {data.odds_context?.move_5m !== null &&
        data.odds_context?.move_5m !== undefined ? (
          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 tabular-nums">
            5m {data.odds_context.move_5m > 0 ? "+" : ""}
            {data.odds_context.move_5m.toFixed(1)}
          </span>
        ) : null}
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
          {data.cached ? "Cache hit" : "Fresh"}
        </span>
      </div>
    </div>
  );
};

export default LiveIntelligenceCard;
