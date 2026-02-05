"use client";

// ============================================================================
// src/components/analysis/InsightCard.tsx
// ============================================================================
//
//  THE DRIP — INTELLIGENCE CARD (SHAREABLE ASSET)
//  Architecture: Single-File Ecosystem • Runtime-Safe • Export-Ready
//  Aesthetic: Porsche Luxury • Jony Ive Minimalism • Jobs Narrative
//
//  Features:
//    1. Strict Data Contract (InsightCardData)
//    2. Runtime-Safe Transformer (toInsightCard)
//    3. Native PNG Export Engine (html-to-image)
//
// ============================================================================

import React, { memo, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../../lib/essence";

// Lazy import type for the export engine
type HtmlToImageModule = typeof import("html-to-image");

// ─────────────────────────────────────────────────────────────────
// 1) DATA CONTRACT (STRICT)
// ─────────────────────────────────────────────────────────────────

export type InsightOutcome = "HIT" | "MISS" | "PUSH";
export type BetSide = "OVER" | "UNDER";

export interface BookOffer {
  book: string;
  odds: string; // "+104"
  deepLink?: string;
  isBest?: boolean;
}

export interface InsightCardData {
  id: string;
  headerMode?: "player" | "team";
  player: {
    name: string;
    team: string; // "CLE"
    opponent: string; // "LAC"
    matchup?: string; // "DAL @ HOU"
    headshotUrl?: string;
  };
  bet: {
    segment: string; // "Over 6.5 Assists"
    line: number;
    side: BetSide;
    odds: string; // "+104" (best odds)
    book: string; // "FanDuel" | "DraftKings" | ...
    deepLink?: string; // Affiliate URL
    books?: BookOffer[]; // Optional multi-book chips
  };
  analysis: {
    rationale: string; // Max 360 chars
  };
  metrics: {
    dvpRank: number; // 1-30 (0 allowed as unknown)
    edgePercent: number; // e.g. 4.0
    probPercent: number; // e.g. 53.0
  };
  history: {
    l5HitRate: number; // 0-100
    outcomes: InsightOutcome[]; // [Newest ... Oldest]
  };
}

// ─────────────────────────────────────────────────────────────────
// 2) TRANSFORMER ADAPTER (RUNTIME SAFE)
// ─────────────────────────────────────────────────────────────────

/**
 * Adapter: Maps any upstream analysis object to strict InsightCardData.
 * Usage: <InsightCard data={toInsightCard(myPropObject)} />
 */
export function toInsightCard(input: unknown): InsightCardData {
  const compress = (text: string, limit = 360) => {
    const t = (text ?? "").trim();
    if (!t) return "Analysis pending...";
    if (t.length <= limit) return t;
    // Intelligent truncation at the last space before the limit
    const cut = t.lastIndexOf(" ", limit);
    return (cut > 0 ? t.slice(0, cut) : t.slice(0, limit)).trim() + "...";
  };

  const fmtOdds = (o: unknown) => {
    if (typeof o === "string" && o.trim()) {
      const s = o.trim();
      return s.startsWith("+") || s.startsWith("-") ? s : `+${s}`;
    }
    const n = toFiniteNumber(o, NaN);
    if (!Number.isFinite(n)) return "+0";
    const i = Math.trunc(n);
    return i > 0 ? `+${i}` : String(i);
  };

  const prop = isRecord(input) ? input : {};

  // Extraction & Sanitization
  const sideRaw = asString(prop["side"], "OVER").toUpperCase();
  const side: BetSide = sideRaw === "UNDER" ? "UNDER" : "OVER";
  const line = toFiniteNumber(prop["line"], 0);
  const statType = asString(prop["statType"], "Stat");

  const headerModeRaw = asString(prop["headerMode"], "player").toLowerCase();
  const headerMode: InsightCardData["headerMode"] = headerModeRaw === "team" ? "team" : "player";

  const playerName = asString(prop["playerName"], "Unknown");
  const team = asString(prop["team"], "UNK");
  const opponent = asString(prop["opponent"], "UNK");
  const matchupOverride = asOptionalString(prop["matchup"]);
  const derivedMatchup = matchupOverride || (team && opponent ? `${team} @ ${opponent}` : undefined);

  const teamName = asString(prop["teamName"], playerName);
  const opponentName = asString(prop["opponentName"], opponent);
  const teamLogoUrl = asOptionalString(prop["teamLogoUrl"]);
  const headshotUrl = headerMode === "team"
    ? (teamLogoUrl || asOptionalString(prop["headshotUrl"]))
    : asOptionalString(prop["headshotUrl"]);

  const bestBook = asString(prop["bestBook"], "Generic");
  const affiliateLink = asOptionalString(prop["affiliateLink"]);

  const dvpRank = clampInt(toFiniteNumber(prop["dvpRank"], 0), 0, 30);
  const edge = round1(toFiniteNumber(prop["edge"], 0));
  const prob = clamp(round1(toFiniteNumber(prop["probability"], 50)), 0, 100);

  const outcomes = normalizeOutcomes(prop["l5Results"]);
  const l5HitRate = clampInt(toFiniteNumber(prop["l5HitRate"], computeHitRate(outcomes)), 0, 100);

  const id = asString(prop["id"], randomId());

  const booksRaw = Array.isArray(prop["books"]) ? (prop["books"] as Array<Record<string, unknown>>) : [];
  const books: BookOffer[] = booksRaw.map((b) => ({
    book: asString(b.book ?? b.name, "Generic"),
    odds: fmtOdds(b.odds ?? b.price ?? b.american),
    deepLink: asOptionalString(b.deepLink ?? b.url ?? b.link),
    isBest: Boolean(b.isBest),
  }));

  const fallbackBook: BookOffer = {
    book: bestBook,
    odds: fmtOdds(prop["bestOdds"] ?? prop["odds"] ?? prop["best_odds"]),
    deepLink: affiliateLink,
    isBest: true,
  };

  const finalBooks = books.length ? books : [fallbackBook];
  const bestOffer = finalBooks.find((b) => b.isBest) || finalBooks[0];
  const customSegment = asOptionalString(prop["customSegment"]);

  return {
    id,
    headerMode,
    player: {
      name: headerMode === "team" ? teamName : playerName,
      team: headerMode === "team" ? asString(prop["teamAbbr"], team) : team,
      opponent: headerMode === "team" ? opponentName : opponent,
      matchup: derivedMatchup,
      headshotUrl,
    },
    bet: {
      segment: customSegment || `${side === "OVER" ? "Over" : "Under"} ${formatLine(line)} ${statType}`,
      line,
      side,
      odds: bestOffer.odds,
      book: bestOffer.book,
      deepLink: bestOffer.deepLink,
      books: finalBooks,
    },
    analysis: {
      rationale: compress(asString(prop["aiAnalysis"], "Intelligence unavailable.")),
    },
    metrics: {
      dvpRank,
      edgePercent: edge,
      probPercent: prob,
    },
    history: {
      l5HitRate,
      outcomes,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// 3) DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────

const PHYSICS_HOVER = { type: "spring", stiffness: 400, damping: 25 } as const;

function metricColor(type: "DVP" | "EDGE" | "PROB", value: number) {
  if (type === "DVP") return value > 0 && value <= 10 ? "text-emerald-400" : value >= 20 ? "text-rose-400" : "text-blue-400";
  if (type === "EDGE") return value >= 3 ? "text-emerald-400" : value > 0 ? "text-blue-400" : "text-zinc-400";
  if (type === "PROB") return value >= 55 ? "text-emerald-400" : value >= 50 ? "text-blue-400" : "text-zinc-400";
  return "text-white";
}

// ─────────────────────────────────────────────────────────────────
// 4) MICRO COMPONENTS (PURE SVG / NO EXTERNAL DEPS)
// ─────────────────────────────────────────────────────────────────

function IconShare(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M16 8a3 3 0 1 0-2.82-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 14a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z" stroke="currentColor" strokeWidth="2" />
      <path d="M18 13a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z" stroke="currentColor" strokeWidth="2" />
      <path d="M8.6 15.2l6.8 2.6M15.4 8.2L8.6 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconCheck(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSpinner(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 2a10 10 0 1 0 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

const DripMark = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
    <path d="M24 5c6 8 12 14 12 22a12 12 0 1 1-24 0c0-8 6-14 12-22Z" fill="currentColor" opacity="0.9" />
    <circle cx="24" cy="29" r="7" fill="#050505" />
    <path d="M21 29h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const BookLogo = ({ book }: { book: string }) => {
  const b = (book || "").toLowerCase();
  let style = "bg-zinc-700 text-white";
  let label = "B";

  if (b.includes("fanduel")) { style = "bg-[#00A3E0] text-white"; label = "FD"; }
  else if (b.includes("draftkings")) { style = "bg-[#53903f] text-black"; label = "DK"; }
  else if (b.includes("mgm")) { style = "bg-[#d4af37] text-black"; label = "MGM"; }
  else if (b.includes("caesars")) { style = "bg-[#0a4d46] text-white"; label = "CZR"; }

  return (
    <div className={cn("w-4 h-4 rounded-[3px] flex items-center justify-center", style)} title={book}>
      <span className="text-[9px] font-black leading-none tracking-tighter">{label}</span>
    </div>
  );
};

const BookChip = ({ offer }: { offer: BookOffer }) => {
  const isBest = Boolean(offer.isBest);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (offer.deepLink) window.open(offer.deepLink, "_blank", "noopener,noreferrer");
      }}
      disabled={!offer.deepLink}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors",
        offer.deepLink ? "bg-zinc-900 hover:bg-zinc-800 border-white/[0.08] text-zinc-200" : "bg-zinc-900/40 border-white/5 text-zinc-500",
        isBest && "border-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.25)]"
      )}
      aria-label={`Open ${offer.book} odds ${offer.odds}`}
    >
      <span className="text-[11px] font-mono font-bold tabular-nums">{offer.odds}</span>
      <BookLogo book={offer.book} />
    </button>
  );
};

const SmartChip = ({ label, value, colorClass }: { label: string; value: string; colorClass: string }) => (
  <div className="flex flex-col items-center justify-center py-2.5 rounded-xl bg-[#09090b] border border-white/[0.08] shadow-sm relative overflow-hidden group/chip">
    <div className="absolute inset-0 bg-white/[0.02] opacity-0 group-hover/chip:opacity-100 transition-opacity" />
    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-0.5">{label}</span>
    <span className={cn("text-[14px] font-bold tabular-nums tracking-tight", colorClass)}>{value}</span>
  </div>
);

const L5Strip = ({ outcomes, hitRate }: { outcomes: InsightOutcome[]; hitRate: number }) => (
  <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/[0.06]">
    <div className="flex items-baseline gap-1.5">
      <span className="text-[12px] font-medium text-zinc-400">Hit</span>
      <span className={cn("text-[13px] font-bold tabular-nums", hitRate >= 60 ? "text-emerald-400" : hitRate <= 40 ? "text-rose-400" : "text-zinc-200")}>
        {hitRate}%
      </span>
      <span className="text-[12px] font-medium text-zinc-400">in L5 Games</span>
    </div>

    <div className="flex items-center gap-1.5">
      {outcomes.slice(0, 5).map((res, i) => (
        <div
          key={`${res}-${i}`}
          className={cn(
            "w-8 h-1.5 rounded-full transition-all duration-300",
            res === "HIT" ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]" :
            res === "PUSH" ? "bg-zinc-600" : "bg-rose-500/90 shadow-[0_0_10px_rgba(239,68,68,0.25)]"
          )}
        />
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────
// 5) MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────

type ExportStatus = "IDLE" | "SUCCESS" | "ERROR";

type ExportPreset = "FEED" | "STORY";

export const InsightCard = memo(({ data }: { data: InsightCardData }) => {
  const { player, bet, analysis, metrics, history } = data;

  const cardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<ExportStatus>("IDLE");
  const [showShareMenu, setShowShareMenu] = useState(false);

  const isOver = bet.side === "OVER";
  const selectionColor = isOver ? "text-emerald-400" : "text-rose-400";
  const accentColor = isOver ? "text-emerald-500" : "text-rose-500";

  const matchupText = useMemo(() => {
    if (player.matchup) return player.matchup;
    if (player.team && player.opponent) return `${player.team} @ ${player.opponent}`;
    if (player.opponent) return `@ ${player.opponent}`;
    return player.team || "";
  }, [player.matchup, player.team, player.opponent]);

  const bookOffers = bet.books?.length ? bet.books : [{ book: bet.book, odds: bet.odds, deepLink: bet.deepLink, isBest: true }];
  const bestOffer = bookOffers.find((b) => b.isBest) || bookOffers[0];

  // Memoized formatters
  const dvpText = useMemo(() => {
    const r = clampInt(metrics.dvpRank, 0, 30);
    return r > 0 ? `${r}${ordinalSuffix(r)}` : "—";
  }, [metrics.dvpRank]);

  const edgeText = useMemo(() => {
    const e = round1(metrics.edgePercent);
    return e > 0 ? `+${e.toFixed(1)}%` : `${e.toFixed(1)}%`;
  }, [metrics.edgePercent]);

  const probText = useMemo(() => `${clamp(round1(metrics.probPercent), 0, 100).toFixed(1)}%`, [metrics.probPercent]);

  // 📸 EXPORT ENGINE
  const handleExport = async (preset: ExportPreset) => {
    if (!cardRef.current || isExporting) return;

    const target = preset === "STORY" ? { w: 1080, h: 1920 } : { w: 1080, h: 1350 };

    setExportStatus("IDLE");
    setShowShareMenu(false);

    try {
      setIsExporting(true);

      // 1. Wait for Fonts
      if (typeof document !== "undefined" && (document as any).fonts?.ready) {
        await (document as any).fonts.ready;
      }

      // 2. Wait for Render Cycle (Shows Watermark)
      await nextFrame();
      await sleep(20);

      // 3. Lazy Load Engine
      const mod: HtmlToImageModule = await import("html-to-image");
      const node = cardRef.current;
      const rect = node.getBoundingClientRect();
      const scale = Math.min(target.w / rect.width, target.h / rect.height);

      // 4. Build offscreen frame for consistent export size
      const frame = document.createElement("div");
      frame.style.width = `${target.w}px`;
      frame.style.height = `${target.h}px`;
      frame.style.background = "#050505";
      frame.style.display = "flex";
      frame.style.alignItems = "center";
      frame.style.justifyContent = "center";
      frame.style.position = "fixed";
      frame.style.left = "-99999px";
      frame.style.top = "0";
      frame.style.overflow = "hidden";

      const clone = node.cloneNode(true) as HTMLElement;
      clone.style.transform = `scale(${scale})`;
      clone.style.transformOrigin = "center";
      clone.style.margin = "0";

      frame.appendChild(clone);
      document.body.appendChild(frame);

      // 5. Generate PNG
      const dataUrl = await mod.toPng(frame, {
        cacheBust: true,
        pixelRatio: 1,
        backgroundColor: "#050505",
      });

      document.body.removeChild(frame);

      downloadDataUrl(dataUrl, buildFileName(player.name, bet.segment));

      setExportStatus("SUCCESS");
      setTimeout(() => setExportStatus("IDLE"), 2000);
    } catch (err) {
      console.error("InsightCard export failed:", err);
      setExportStatus("ERROR");
      setTimeout(() => setExportStatus("IDLE"), 2500);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative group/card w-full max-w-[420px]">

      {/* Export Action Button */}
      <AnimatePresence>
        {!isExporting && (
          <motion.button
            type="button"
            aria-label="Export InsightCard PNG"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowShareMenu((v) => !v)}
            className={cn(
              "absolute -top-3 -right-3 z-50 p-2.5 rounded-full shadow-xl backdrop-blur-md transition-all duration-300",
              "opacity-0 group-hover/card:opacity-100 translate-y-2 group-hover/card:translate-y-0",
              exportStatus === "SUCCESS"
                ? "bg-emerald-500 border border-emerald-400 text-black"
                : exportStatus === "ERROR"
                ? "bg-rose-500 border border-rose-400 text-black"
                : "bg-black/80 border border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-900"
            )}
          >
            {exportStatus === "SUCCESS" ? (
              <IconCheck width={16} height={16} />
            ) : exportStatus === "ERROR" ? (
              <IconShare width={16} height={16} />
            ) : (
              <IconShare width={16} height={16} />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Export Size Menu */}
      <AnimatePresence>
        {showShareMenu && !isExporting && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute -top-2 right-10 z-50 bg-[#0b0b0c] border border-white/[0.08] rounded-xl shadow-2xl p-2 flex flex-col gap-1"
          >
            <button
              type="button"
              onClick={() => handleExport("FEED")}
              className="px-3 py-2 rounded-lg text-[11px] font-semibold text-zinc-200 hover:bg-white/[0.05] text-left"
            >
              Export 1080×1350 (Feed)
            </button>
            <button
              type="button"
              onClick={() => handleExport("STORY")}
              className="px-3 py-2 rounded-lg text-[11px] font-semibold text-zinc-200 hover:bg-white/[0.05] text-left"
            >
              Export 1080×1920 (Story)
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card Content (Capture Target) */}
      <motion.div
        ref={cardRef}
        layout
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={!isExporting ? { y: -4, backgroundColor: "rgba(255,255,255,0.02)" } : {}}
        transition={PHYSICS_HOVER}
        data-exporting={isExporting ? "true" : "false"}
        className="relative w-full bg-[#1a1a1a] rounded-2xl border border-white/[0.08] p-6 shadow-2xl overflow-hidden cursor-default select-none"
      >
        {/* Active Edge Accent */}
        <div
          className={cn(
            "absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-current to-transparent opacity-80",
            isOver ? "text-emerald-500" : "text-rose-500"
          )}
        />

        {/* 1) HEADER ROW */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="relative w-12 h-12 rounded-full bg-zinc-900 border border-white/10 overflow-hidden shrink-0 shadow-lg">
              {player.headshotUrl ? (
                <img
                  src={player.headshotUrl}
                  crossOrigin="anonymous"
                  alt={player.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[12px] font-bold text-zinc-500">
                  {initials(player.name)}
                </div>
              )}
              <div className="absolute bottom-0 right-0 px-1.5 py-0.5 bg-black rounded-tl-md border-t border-l border-zinc-800">
                <span className="text-[8px] font-black text-zinc-300 block leading-none">{player.team}</span>
              </div>
            </div>

            <div className="flex flex-col justify-center min-w-0">
              <div className="flex items-baseline gap-2 min-w-0">
                <h3 className="text-[16px] font-bold text-white tracking-tight leading-none truncate">
                  {player.name}
                </h3>
                {matchupText && (
                  <span className="text-[11px] font-medium text-zinc-500 font-mono shrink-0">
                    • {matchupText}
                  </span>
                )}
              </div>

              <div className={cn("text-[14px] font-bold tracking-wide mt-1.5 uppercase", selectionColor)}>
                {bet.segment}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <div className="px-2.5 py-1 rounded-lg border border-white/[0.08] bg-zinc-900">
                <span className="text-[14px] font-mono font-bold text-white tabular-nums">{bestOffer.odds}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {bookOffers.map((offer, i) => (
                <BookChip key={`${offer.book}-${i}`} offer={offer} />
              ))}
            </div>
          </div>
        </div>

        {/* 2) ANALYSIS BLOCK */}
        <div className="mb-7 pl-1">
          <div className="relative pl-4 border-l-[3px] border-white/10">
            <p className="text-[16px] leading-[1.6] text-zinc-300 font-normal text-pretty tracking-tight">
              {analysis.rationale}
            </p>
          </div>
        </div>

        {/* 3) TRUTH ROW */}
        <div className="grid grid-cols-3 gap-3 mb-1">
          <SmartChip label="DVP" value={dvpText} colorClass={metricColor("DVP", metrics.dvpRank)} />
          <SmartChip label="EDGE" value={edgeText} colorClass={metricColor("EDGE", metrics.edgePercent)} />
          <SmartChip label="PROB" value={probText} colorClass={metricColor("PROB", metrics.probPercent)} />
        </div>

        {/* 4) FOOTER STRIP */}
        <L5Strip outcomes={history.outcomes} hitRate={history.l5HitRate} />

        {/* EXPORT WATERMARK */}
        {isExporting && (
          <div className="absolute bottom-3 right-4 opacity-60 flex items-center gap-2">
            <DripMark width={18} height={18} className="text-zinc-400" />
            <span className="text-[8px] font-black uppercase tracking-[0.3em] text-zinc-600">THE DRIP</span>
          </div>
        )}
      </motion.div>
    </div>
  );
});

InsightCard.displayName = "InsightCard";
export default InsightCard;

// ─────────────────────────────────────────────────────────────────
// UTILITIES (LOCAL ONLY)
// ─────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function asString(v: unknown, fallback: string): string {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function asOptionalString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function toFiniteNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function clampInt(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function formatLine(line: number) {
  if (!Number.isFinite(line)) return "0";
  const isInt = Math.abs(line - Math.trunc(line)) < 1e-9;
  return isInt ? String(Math.trunc(line)) : String(line);
}

function normalizeOutcomes(v: unknown): InsightOutcome[] {
  if (!Array.isArray(v)) return ["MISS", "MISS", "MISS", "MISS", "MISS"];
  const out: InsightOutcome[] = [];
  for (const item of v.slice(0, 5)) {
    const s = typeof item === "string" ? item.toUpperCase() : "";
    if (s === "HIT" || s === "MISS" || s === "PUSH") out.push(s as InsightOutcome);
  }
  while (out.length < 5) out.push("MISS");
  return out;
}

function computeHitRate(outcomes: InsightOutcome[]) {
  const o = outcomes.slice(0, 5);
  const hits = o.filter((x) => x === "HIT").length;
  return Math.round((hits / 5) * 100);
}

function randomId() {
  return Math.random().toString(36).slice(2, 11);
}

function initials(name: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "UN";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ordinalSuffix(n: number) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function buildFileName(playerName: string, segment: string) {
  const safe = (s: string) =>
    (s || "")
      .replace(/[^\w\-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
  const p = safe(playerName);
  const b = safe(segment);
  return `TheDrip_${p}_${b}.png`;
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.download = fileName;
  link.href = dataUrl;
  link.click();
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
