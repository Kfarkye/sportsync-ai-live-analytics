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

function parseLiveMinute(match: Match): number | null {
  const rawClock =
    (typeof match.displayClock === "string" && match.displayClock.trim()) ||
    (typeof match.minute === "string" && match.minute.trim()) ||
    "";
  if (!rawClock) return null;

  const minuteMatch = rawClock.match(/(\d{1,3})/);
  if (!minuteMatch) return null;

  const minuteValue = Number(minuteMatch[1]);
  if (!Number.isFinite(minuteValue)) return null;

  const isSoccer = String(match.sport || "").toUpperCase() === "SOCCER";
  if (isSoccer && (match.period ?? 1) >= 2 && minuteValue <= 45 && !rawClock.includes(":")) {
    return 45 + minuteValue;
  }

  return minuteValue;
}

function buildCashOutCall(match: Match): string[] {
  const homeName = match.homeTeam?.shortName || match.homeTeam?.name || "Home";
  const awayName = match.awayTeam?.shortName || match.awayTeam?.name || "Away";
  const homeScore = Number(match.homeScore ?? 0);
  const awayScore = Number(match.awayScore ?? 0);
  const margin = homeScore - awayScore;
  const absMargin = Math.abs(margin);
  const liveMinute = parseLiveMinute(match);
  const isSoccer = String(match.sport || "").toUpperCase() === "SOCCER";

  if (isSoccer && liveMinute !== null && absMargin >= 3 && liveMinute >= 70) {
    const leader = margin > 0 ? homeName : awayName;
    const trailer = margin > 0 ? awayName : homeName;
    return [
      `If you backed ${leader}, hold position. Hedge only a small piece if needed.`,
      `If you backed ${trailer} moneyline, cash-out is the safer move now.`,
      `${trailer} to score at least once is still live in about 34% of 3+ goal deficit states.`,
    ];
  }

  if (liveMinute !== null && absMargin <= 1 && liveMinute >= 70) {
    return [
      "Close game late. Hold unless cash-out locks real profit with limited upside loss.",
      "One high-leverage event can still flip the payout profile.",
    ];
  }

  if (liveMinute !== null && absMargin >= 2 && liveMinute >= 60) {
    const trailer = margin > 0 ? awayName : homeName;
    return [
      "Current game state favors the leading side.",
      `${trailer} comeback path is narrow, so reduce exposure if downside is uncomfortable.`,
    ];
  }

  return [
    "No forced cash-out move yet.",
    "Stay in position and reassess after the next goal, red card, or major momentum swing.",
  ];
}

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
  const rawTrendItems = Array.isArray(card.trends)
    ? card.trends.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const trendItems =
    rawTrendItems.length > 0
      ? rawTrendItems
      : drivers.length > 0
        ? drivers.slice(0, 3).map((driver) => `Trend: ${driver}`)
        : ["No clear trend edge yet. Recheck after the next major event."];
  const displayHeadline = /live market is balanced/i.test(card.headline)
    ? "Live Trend Pulse"
    : card.headline;
  const cashOutCall = buildCashOutCall(match);

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
            Live Update
          </span>
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
            What Matters Now
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
            Cash-out Call
          </div>
          <ul className="space-y-1">
            {cashOutCall.map((call, idx) => (
              <li key={idx} className="text-[12px] text-slate-700">
                • {call}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default LiveIntelligenceCard;
