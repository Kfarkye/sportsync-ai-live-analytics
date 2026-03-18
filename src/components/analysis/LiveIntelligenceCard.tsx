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

const meterClass = {
  OVER: "bg-emerald-500",
  UNDER: "bg-rose-500",
  HOME: "bg-sky-500",
  AWAY: "bg-indigo-500",
  PASS: "bg-slate-500",
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
  const meter = meterClass[card.lean] ?? meterClass.PASS;
  const drivers = Array.isArray(card.drivers)
    ? card.drivers.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const watchouts = Array.isArray(card.watchouts)
    ? card.watchouts.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const rawTrendItems = Array.isArray(card.trends)
    ? card.trends.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const trendItems =
    rawTrendItems.length > 0
      ? rawTrendItems
      : drivers.length > 0
        ? drivers.slice(0, 3).map((driver) => `Trend: ${driver}`)
        : ["Trend profile is still stabilizing in this live state."];
  const displayHeadline = /live market is balanced/i.test(card.headline)
    ? "Live Trend Pulse"
    : card.headline;
  const clampedConfidence = Math.max(0, Math.min(100, Math.round(card.confidence)));
  const stateHash =
    typeof data.state_hash === "string" && data.state_hash.trim().length > 0
      ? data.state_hash
      : "liv-ai-unknown";
  const shortState =
    stateHash.length > 14 ? stateHash.slice(0, 12) : stateHash;
  const provenance = stateHash.endsWith("-legacy")
    ? "Legacy model"
    : stateHash.endsWith("-fallback")
      ? "Local model"
      : "Edge model";

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_10px_32px_-24px_rgba(15,23,42,0.35)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Trends
          </div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-tight text-slate-900">
            {displayHeadline}
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
            {clampedConfidence}% confidence
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn("h-full rounded-full transition-all duration-500 ease-out", meter)}
            style={{ width: `${Math.max(6, clampedConfidence)}%` }}
          />
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Trend Feed
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80">
          {trendItems.map((trend, idx) => {
            const splitIndex = trend.indexOf(":");
            const hasLead = splitIndex > 0 && splitIndex < 44;
            const lead = hasLead ? trend.slice(0, splitIndex).trim() : "";
            const detail = hasLead ? trend.slice(splitIndex + 1).trim() : trend.trim();

            return (
              <div
                key={`${trend}-${idx}`}
                className={cn(
                  "px-3 py-2.5",
                  idx < trendItems.length - 1 ? "border-b border-slate-200/80" : "",
                )}
              >
                {hasLead ? (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="text-[12px] font-semibold text-slate-900">{lead}</span>
                    <span className="text-[12px] text-slate-700">{detail}</span>
                  </div>
                ) : (
                  <div className="text-[12px] text-slate-700">{detail}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="mb-4 text-[13px] leading-relaxed text-slate-700">{card.thesis}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Signals
          </div>
          <ul className="space-y-1">
            {(drivers.length > 0 ? drivers : ["No decisive supporting signal yet."]).map((driver, idx) => (
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
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
          {provenance}
        </span>
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 tabular-nums">
          State {shortState}
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
          {data.cached ? "Cache hit" : "Live"}
        </span>
      </div>
    </div>
  );
};

export default LiveIntelligenceCard;
