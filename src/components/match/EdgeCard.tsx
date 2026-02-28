// ═══════════════════════════════════════════════════════════════════════════════
// EdgeCard.tsx — Market Divergence Intelligence
//
// Shows the gap between what prediction markets think (Polymarket, no vig)
// and what sportsbooks are offering (vig-adjusted).
//
// This divergence IS the product. It's the signal sharp bettors pay for.
//
// Visual language:
//   Green bar → Polymarket MORE confident than books (potential value bet)
//   Red bar   → Polymarket LESS confident than books (books have edge)
//   Gray      → Markets aligned (no divergence signal)
//
// Architecture:
//   polyProb (0–1)      → from poly_odds table
//   bookImpliedProb     → derived from American odds via americanToImpliedProb()
//   edge                → polyProb - bookImpliedProb (positive = value)
// ═══════════════════════════════════════════════════════════════════════════════

import React, { memo, useMemo } from 'react';
import { cn } from '@/lib/essence';
import { americanToImpliedProb, polyProbToPercent } from '@/hooks/usePolyOdds';

// ─── Types ─────────────────────────────────────────────────────────────────

interface EdgeCardProps {
  homeTeam: string;
  awayTeam: string;
  /** Polymarket probability 0–1 */
  homePolyProb: number;
  awayPolyProb: number;
  /** Sportsbook moneyline American odds */
  homeMoneyline?: number;
  awayMoneyline?: number;
  /** Total USD volume on Polymarket */
  volume?: number;
  className?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatEdge(edge: number): string {
  const sign = edge > 0 ? '+' : '';
  return `${sign}${edge.toFixed(1)}%`;
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
  return `$${vol.toFixed(0)}`;
}

function edgeColor(edge: number): { text: string; bg: string; bar: string } {
  if (Math.abs(edge) < 1) {
    return { text: '#94a3b8', bg: '#f8fafc', bar: '#e2e8f0' };
  }
  if (edge > 0) {
    return { text: '#059669', bg: 'rgba(5,150,105,0.04)', bar: '#059669' };
  }
  return { text: '#dc2626', bg: 'rgba(220,38,38,0.03)', bar: '#dc2626' };
}

// ─── Component ─────────────────────────────────────────────────────────────

const EdgeCard: React.FC<EdgeCardProps> = memo(({
  homeTeam,
  awayTeam,
  homePolyProb,
  awayPolyProb,
  homeMoneyline,
  awayMoneyline,
  volume,
  className,
}) => {
  const edges = useMemo(() => {
    const homeBookProb = homeMoneyline !== undefined ? americanToImpliedProb(homeMoneyline) : null;
    const awayBookProb = awayMoneyline !== undefined ? americanToImpliedProb(awayMoneyline) : null;

    return {
      home: {
        polyPct: polyProbToPercent(homePolyProb),
        bookPct: homeBookProb !== null ? Math.round(homeBookProb * 100) : null,
        edge: homeBookProb !== null ? Math.round((homePolyProb - homeBookProb) * 1000) / 10 : null,
      },
      away: {
        polyPct: polyProbToPercent(awayPolyProb),
        bookPct: awayBookProb !== null ? Math.round(awayBookProb * 100) : null,
        edge: awayBookProb !== null ? Math.round((awayPolyProb - awayBookProb) * 1000) / 10 : null,
      },
    };
  }, [homePolyProb, awayPolyProb, homeMoneyline, awayMoneyline]);

  const hasBooks = edges.home.bookPct !== null || edges.away.bookPct !== null;

  return (
    <div
      className={cn(
        "rounded-xl border bg-white overflow-hidden",
        className
      )}
      style={{ borderColor: '#e2e8f0' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: '#f1f5f9' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#0f172a' }}>
            Market Edge
          </span>
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest"
            style={{ backgroundColor: '#f0fdf4', color: '#059669', border: '1px solid rgba(5,150,105,0.15)' }}
          >
            <span className="w-1 h-1 rounded-full bg-emerald-500" />
            Live
          </span>
        </div>
        {volume !== undefined && volume > 0 && (
          <span className="text-[9px] font-medium tabular-nums" style={{ color: '#94a3b8' }}>
            {formatVolume(volume)} traded
          </span>
        )}
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_60px_60px_60px] items-center px-4 py-1.5 border-b" style={{ borderColor: '#f8fafc' }}>
        <span className="text-[8px] font-bold uppercase tracking-[0.1em]" style={{ color: '#cbd5e1' }}>Team</span>
        <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-center" style={{ color: '#cbd5e1' }}>Market</span>
        <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-center" style={{ color: '#cbd5e1' }}>Books</span>
        <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-center" style={{ color: '#cbd5e1' }}>Edge</span>
      </div>

      {/* Rows */}
      {[
        { name: awayTeam, ...edges.away },
        { name: homeTeam, ...edges.home },
      ].map((row, i) => {
        const rowEdge = row.edge ?? 0;
        const colors = edgeColor(rowEdge);
        const barWidth = Math.min(Math.abs(rowEdge) * 4, 100); // Scale: 25% edge = full bar

        return (
          <div
            key={i}
            className={cn(
              "grid grid-cols-[1fr_60px_60px_60px] items-center px-4 py-2.5",
              i === 0 && "border-b"
            )}
            style={{
              borderColor: '#f8fafc',
              backgroundColor: row.edge !== null && Math.abs(row.edge) >= 3 ? colors.bg : 'transparent',
            }}
          >
            {/* Team name */}
            <span className="text-[13px] font-semibold truncate" style={{ color: '#0f172a' }}>
              {row.name}
            </span>

            {/* Poly probability */}
            <span className="text-[13px] font-mono font-bold tabular-nums text-center" style={{ color: '#059669' }}>
              {row.polyPct}%
            </span>

            {/* Book implied probability */}
            <span className="text-[13px] font-mono font-medium tabular-nums text-center" style={{ color: '#64748b' }}>
              {row.bookPct !== null ? `${row.bookPct}%` : '-'}
            </span>

            {/* Edge with micro-bar */}
            <div className="flex flex-col items-center gap-0.5">
              <span
                className="text-[12px] font-mono font-bold tabular-nums"
                style={{ color: row.edge !== null ? colors.text : '#cbd5e1' }}
              >
                {row.edge !== null ? formatEdge(row.edge) : '-'}
              </span>
              {row.edge !== null && Math.abs(row.edge) >= 0.5 && (
                <div className="w-full h-[2px] rounded-full overflow-hidden" style={{ backgroundColor: '#f1f5f9' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: colors.bar,
                      marginLeft: row.edge < 0 ? 'auto' : 0,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Footer insight */}
      {hasBooks && (edges.home.edge !== null || edges.away.edge !== null) && (
        <div className="px-4 py-2 border-t" style={{ borderColor: '#f1f5f9' }}>
          <EdgeInsight homeEdge={edges.home.edge} awayEdge={edges.away.edge} homeTeam={homeTeam} awayTeam={awayTeam} />
        </div>
      )}
    </div>
  );
});
EdgeCard.displayName = 'EdgeCard';

// ─── Edge Insight (micro-copy) ─────────────────────────────────────────────

const EdgeInsight: React.FC<{
  homeEdge: number | null;
  awayEdge: number | null;
  homeTeam: string;
  awayTeam: string;
}> = memo(({ homeEdge, awayEdge, homeTeam, awayTeam }) => {
  const maxEdge = Math.max(Math.abs(homeEdge ?? 0), Math.abs(awayEdge ?? 0));

  if (maxEdge < 1) {
    return (
      <span className="text-[10px] font-medium" style={{ color: '#94a3b8' }}>
        Markets aligned — no significant divergence
      </span>
    );
  }

  const biggerEdge = Math.abs(homeEdge ?? 0) > Math.abs(awayEdge ?? 0) ? homeEdge : awayEdge;
  const team = Math.abs(homeEdge ?? 0) > Math.abs(awayEdge ?? 0) ? homeTeam : awayTeam;

  if (biggerEdge !== null && biggerEdge > 0) {
    return (
      <span className="text-[10px] font-medium" style={{ color: '#059669' }}>
        Prediction market sees more value on {team} than books
      </span>
    );
  }

  return (
    <span className="text-[10px] font-medium" style={{ color: '#94a3b8' }}>
      Books pricing {team} more aggressively than prediction market
    </span>
  );
});
EdgeInsight.displayName = 'EdgeInsight';

export default EdgeCard;
