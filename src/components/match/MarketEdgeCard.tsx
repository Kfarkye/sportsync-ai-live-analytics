// ═══════════════════════════════════════════════════════════════════════════════
// MarketEdgeCard.tsx — AI Market Intelligence
//
// The "What does this mean?" card.
//
// Most people don't know what prediction markets are. They don't know what
// "edge" means. They don't know what "-142" means. This card translates
// Polymarket probability + sportsbook divergence into plain English.
//
// Example output:
//   "The Lakers are 63% favorites in the prediction market, where traders
//    have bet $4.2M on this game. Sportsbooks are less confident at 58%,
//    creating a 5% gap. When this gap exists, the market tends to be right
//    68% of the time."
//
// Architecture:
//   - Runs client-side from pre-computed data (no API call per render)
//   - Template-driven for instant display, AI-enhanced when available
//   - Degrades gracefully: template → cached AI → loading
// ═══════════════════════════════════════════════════════════════════════════════

import React, { memo, useMemo } from 'react';
import { cn } from '@/lib/essence';
import { polyProbToPercent, americanToImpliedProb } from '@/hooks/usePolyOdds';

// ─── Types ─────────────────────────────────────────────────────────────────

interface MarketEdgeCardProps {
  homeTeam: string;
  awayTeam: string;
  homePolyProb: number;       // 0–1
  awayPolyProb: number;       // 0–1
  homeMoneyline?: number;     // American odds
  awayMoneyline?: number;
  volume?: number;
  gameStartTime?: string;
  /** Pre-computed AI narrative (from pregame-intel or edge function) */
  aiNarrative?: string;
  className?: string;
}

// ─── Template Engine ───────────────────────────────────────────────────────
// Generates human-readable market analysis from raw numbers.
// No API call needed — runs instantly from data already in memory.

function generateInsight(props: MarketEdgeCardProps): {
  headline: string;
  body: string;
  signal: 'strong_value' | 'mild_value' | 'aligned' | 'books_edge' | 'no_data';
  confidence: 'high' | 'medium' | 'low';
} {
  const {
    homeTeam, awayTeam,
    homePolyProb, awayPolyProb,
    homeMoneyline, awayMoneyline,
    volume,
  } = props;

  const homePct = polyProbToPercent(homePolyProb);
  const awayPct = polyProbToPercent(awayPolyProb);

  // Determine favorite
  const favTeam = homePct >= awayPct ? homeTeam : awayTeam;
  const favPct = Math.max(homePct, awayPct);
  const dogTeam = homePct >= awayPct ? awayTeam : homeTeam;
  const dogPct = Math.min(homePct, awayPct);

  const volStr = volume ? formatVol(volume) : null;
  const hasBooks = homeMoneyline !== undefined && awayMoneyline !== undefined;

  // No sportsbook comparison available
  if (!hasBooks) {
    const confidence = (volume ?? 0) > 500000 ? 'high' : (volume ?? 0) > 50000 ? 'medium' : 'low';
    return {
      headline: `${favTeam} ${favPct}% favorite`,
      body: `Prediction market traders give ${favTeam} a ${favPct}% chance of winning${volStr ? `, backed by ${volStr} in trading volume` : ''}. ${dogTeam} is priced at ${dogPct}%.`,
      signal: 'no_data',
      confidence,
    };
  }

  // Calculate edge
  const favIsHome = homePct >= awayPct;
  const favMoneyline = favIsHome ? homeMoneyline! : awayMoneyline!;
  const dogMoneyline = favIsHome ? awayMoneyline! : homeMoneyline!;
  const favBookProb = Math.round(americanToImpliedProb(favMoneyline) * 100);
  const dogBookProb = Math.round(americanToImpliedProb(dogMoneyline) * 100);

  const favEdge = favPct - favBookProb;
  const absEdge = Math.abs(favEdge);

  // Determine signal strength
  let signal: 'strong_value' | 'mild_value' | 'aligned' | 'books_edge' | 'no_data';
  if (absEdge >= 5) {
    signal = favEdge > 0 ? 'strong_value' : 'books_edge';
  } else if (absEdge >= 2) {
    signal = favEdge > 0 ? 'mild_value' : 'books_edge';
  } else {
    signal = 'aligned';
  }

  const confidence = (volume ?? 0) > 1000000 ? 'high' : (volume ?? 0) > 100000 ? 'medium' : 'low';

  // Generate human-readable text
  switch (signal) {
    case 'strong_value':
      return {
        headline: `${absEdge}% edge on ${favTeam}`,
        body: `Traders give ${favTeam} a ${favPct}% chance — ${absEdge} points higher than what sportsbooks imply (${favBookProb}%). ${volStr ? `With ${volStr} traded, this` : 'This'} is a notable gap. When prediction markets diverge this much from books, the market tends to be pricing in information the books haven't adjusted to yet.`,
        signal,
        confidence,
      };
    case 'mild_value':
      return {
        headline: `Slight edge on ${favTeam}`,
        body: `The prediction market prices ${favTeam} at ${favPct}%, a touch above the ${favBookProb}% implied by sportsbooks. A ${absEdge}-point gap suggests mild disagreement between the two markets${volStr ? ` on ${volStr} in volume` : ''}.`,
        signal,
        confidence,
      };
    case 'books_edge':
      return {
        headline: `Books more bullish on ${favTeam}`,
        body: `Sportsbooks imply ${favTeam} at ${favBookProb}%, but prediction market traders are less confident at ${favPct}%. The ${absEdge}-point gap means books may be overvaluing the favorite${volStr ? ` — traders have put ${volStr} behind their assessment` : ''}.`,
        signal,
        confidence,
      };
    default:
      return {
        headline: `Markets aligned`,
        body: `Both prediction markets (${favPct}%) and sportsbooks (${favBookProb}%) agree on ${favTeam} as the favorite. When markets are this tight, there's no clear edge signal in either direction.`,
        signal,
        confidence,
      };
  }
}

function formatVol(vol: number): string {
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
  return `$${vol.toFixed(0)}`;
}

// ─── Signal Icon ───────────────────────────────────────────────────────────

const SIGNAL_CONFIG = {
  strong_value: { icon: '↑', color: '#059669', bg: 'rgba(5,150,105,0.06)', label: 'Value Signal' },
  mild_value:   { icon: '↗', color: '#059669', bg: 'rgba(5,150,105,0.04)', label: 'Mild Value' },
  aligned:      { icon: '=', color: '#94a3b8', bg: '#f8fafc', label: 'Aligned' },
  books_edge:   { icon: '↓', color: '#f59e0b', bg: 'rgba(245,158,11,0.04)', label: 'Books Edge' },
  no_data:      { icon: '○', color: '#94a3b8', bg: '#f8fafc', label: 'Market Only' },
};

// ─── Component ─────────────────────────────────────────────────────────────

const MarketEdgeCard: React.FC<MarketEdgeCardProps> = memo((props) => {
  const { className, aiNarrative } = props;

  const insight = useMemo(() => generateInsight(props), [
    props.homeTeam, props.awayTeam,
    props.homePolyProb, props.awayPolyProb,
    props.homeMoneyline, props.awayMoneyline,
    props.volume,
  ]);

  const config = SIGNAL_CONFIG[insight.signal];

  return (
    <div
      className={cn("rounded-xl border bg-white overflow-hidden", className)}
      style={{ borderColor: '#e2e8f0' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: '#f1f5f9' }}>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center w-5 h-5 rounded-md text-[11px] font-bold"
            style={{ backgroundColor: config.bg, color: config.color }}
          >
            {config.icon}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#0f172a' }}>
            AI Market Edge
          </span>
        </div>
        <span
          className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
          style={{ color: config.color, backgroundColor: config.bg }}
        >
          {config.label}
        </span>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-2">
        {/* Headline */}
        <h4 className="text-[14px] font-bold tracking-tight" style={{ color: '#0f172a' }}>
          {insight.headline}
        </h4>

        {/* Body — AI narrative if available, otherwise template */}
        <p className="text-[12px] leading-[1.6] font-medium" style={{ color: '#64748b' }}>
          {aiNarrative || insight.body}
        </p>

        {/* Confidence indicator */}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex items-center gap-0.5">
            {[1, 2, 3].map((bar) => (
              <div
                key={bar}
                className="w-1 rounded-full transition-colors"
                style={{
                  height: 6 + bar * 2,
                  backgroundColor: bar <= (insight.confidence === 'high' ? 3 : insight.confidence === 'medium' ? 2 : 1)
                    ? config.color
                    : '#e2e8f0',
                }}
              />
            ))}
          </div>
          <span className="text-[9px] font-medium uppercase tracking-wider" style={{ color: '#94a3b8' }}>
            {insight.confidence} confidence
          </span>
          <span className="text-[9px]" style={{ color: '#cbd5e1' }}>·</span>
          <span className="text-[9px] font-medium" style={{ color: '#94a3b8' }}>
            Polymarket + sportsbook data
          </span>
        </div>
      </div>
    </div>
  );
});
MarketEdgeCard.displayName = 'MarketEdgeCard';

export default MarketEdgeCard;
