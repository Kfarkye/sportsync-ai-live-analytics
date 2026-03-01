// ═══════════════════════════════════════════════════════════════════════════════
// OddsLens.tsx — Three-mode probability intelligence display
//
// The Drip shows predictions the way they should be read:
//
//   PROB  → "58%"    — Polymarket probability, no vig, real money conviction
//   ODDS  → "-138"   — American odds, for the traditional bettors
//   EDGE  → "+5.6%"  — Divergence between prediction market and sportsbooks
//
// Design: Jony Ive minimalism. The pill is tappable (Apple Stocks pattern).
// Every tap cycles PROB → ODDS → EDGE globally across all pills.
//
// Data hierarchy:
//   Polymarket share price (primary) → sportsbook implied prob (comparison)
//   Edge = polyProb - bookImpliedProb
//
// Conversion math:
//   prob → American: p≥50% → -(p/(1-p))×100 | p<50% → +((1-p)/p)×100
//   American → implied: neg → |odds|/(|odds|+100) | pos → 100/(odds+100)
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useCallback, memo } from 'react';
import { useAppStore, type OddsLensMode } from '@/store/appStore';

// ─── Conversions ───────────────────────────────────────────────────────────

/** Probability (0-100) → American odds string */
export function probToAmerican(prob: number): string {
  if (prob <= 0 || prob >= 100) return '-';
  const p = prob / 100;
  if (p >= 0.5) {
    return String(Math.round(-(p / (1 - p)) * 100));
  }
  return `+${Math.round(((1 - p) / p) * 100)}`;
}

/** Format edge value with sign */
function formatEdge(edge: number | undefined): string {
  if (edge === undefined || edge === null || isNaN(edge)) return '-';
  const sign = edge > 0 ? '+' : '';
  return `${sign}${edge.toFixed(1)}%`;
}

// ─── Color Logic ───────────────────────────────────────────────────────────

interface PillColors {
  text: string;
  bg: string;
  border: string;
}

function getPillColors(mode: OddsLensMode, value: number | undefined, isFavorite: boolean, edge?: number): PillColors {
  // EDGE mode: green = positive edge, red = negative, neutral = no edge
  if (mode === 'EDGE') {
    if (edge === undefined || edge === null || Math.abs(edge) < 0.5) {
      return { text: '#94a3b8', bg: 'transparent', border: '#e2e8f0' };
    }
    if (edge > 0) {
      return { text: '#059669', bg: 'rgba(5,150,105,0.04)', border: 'rgba(5,150,105,0.2)' };
    }
    return { text: '#dc2626', bg: 'rgba(220,38,38,0.03)', border: 'rgba(220,38,38,0.15)' };
  }

  // ODDS mode: favorite (negative odds) = dark neutral
  if (mode === 'ODDS') {
    const isNeg = value !== undefined && value >= 50;
    return isNeg
      ? { text: '#0f172a', bg: 'rgba(15,23,42,0.03)', border: '#cbd5e1' }
      : { text: '#94a3b8', bg: 'transparent', border: '#e2e8f0' };
  }

  // PROB mode: favorite = dark neutral, underdog = muted
  return isFavorite
    ? { text: '#0f172a', bg: 'rgba(15,23,42,0.03)', border: '#cbd5e1' }
    : { text: '#94a3b8', bg: 'transparent', border: '#e2e8f0' };
}

// ─── OddsLensPill ──────────────────────────────────────────────────────────

interface OddsLensPillProps {
  value: number | undefined;
  isFavorite: boolean;
  edge?: number;
}

export const OddsLensPill: React.FC<OddsLensPillProps> = memo(({ value, isFavorite, edge }) => {
  const oddsLens = useAppStore((s) => s.oddsLens);
  const toggleOddsLens = useAppStore((s) => s.toggleOddsLens);

  if (value === undefined || value === null || value <= 0 || value > 100) {
    return <span className="w-[46px] shrink-0" aria-hidden="true" />;
  }

  let display: string;
  switch (oddsLens) {
    case 'ODDS':
      display = probToAmerican(value);
      break;
    case 'EDGE':
      display = formatEdge(edge);
      break;
    default:
      display = `${Math.round(value)}%`;
  }

  const colors = getPillColors(oddsLens, value, isFavorite, edge);
  const isOddsMode = oddsLens === 'ODDS';
  const isEdgeMode = oddsLens === 'EDGE';

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleOddsLens();
  }, [toggleOddsLens]);

  // Mini bar dimensions
  const showMiniBar = oddsLens === 'PROB' && value !== undefined;
  const barWidth = 36;
  const barHeight = 3;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`${display} — tap to switch format`}
      className="inline-flex items-center justify-center gap-1.5 tabular-nums font-semibold select-none cursor-pointer transition-all duration-150 hover:opacity-80 active:scale-95 relative"
      style={{
        fontSize: isEdgeMode ? 10 : 11,
        minWidth: isOddsMode ? 48 : isEdgeMode ? 52 : 42,
        height: 22,
        padding: '0 6px',
        borderRadius: 6,
        letterSpacing: isOddsMode || isEdgeMode ? '-0.02em' : '-0.01em',
        fontFamily: isOddsMode || isEdgeMode ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
        color: colors.text,
        border: `1px solid ${colors.border}`,
        backgroundColor: colors.bg,
        outline: 'none',
      }}
    >
      <span>{display}</span>
      {showMiniBar && (
        <span
          className="hidden sm:inline-flex"
          style={{
            width: barWidth,
            height: barHeight,
            borderRadius: barHeight / 2,
            backgroundColor: '#e2e8f0',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: `${value}%`,
              height: '100%',
              borderRadius: barHeight / 2,
              backgroundColor: isFavorite ? '#334155' : '#cbd5e1',
              transition: 'width 0.4s ease',
            }}
          />
        </span>
      )}
    </button>
  );
});
OddsLensPill.displayName = 'OddsLensPill';

// ─── OddsLensToggle ────────────────────────────────────────────────────────

const MODE_LABELS: Record<OddsLensMode, { icon: string; label: string }> = {
  PROB: { icon: '%', label: 'Probability' },
  ODDS: { icon: '±', label: 'American Odds' },
  EDGE: { icon: 'Δ', label: 'Market Edge' },
};

export const OddsLensToggle: React.FC<{ className?: string }> = memo(({ className }) => {
  const oddsLens = useAppStore((s) => s.oddsLens);
  const setOddsLens = useAppStore((s) => s.setOddsLens);

  return (
    <div
      className={`inline-flex items-center gap-0 rounded-lg p-0.5 select-none ${className || ''}`}
      style={{
        backgroundColor: '#f8fafc',
        border: '1px solid #e2e8f0',
      }}
      role="radiogroup"
      aria-label="Odds display format"
    >
      {(['PROB', 'ODDS', 'EDGE'] as OddsLensMode[]).map((mode) => {
        const active = oddsLens === mode;
        const { icon, label } = MODE_LABELS[mode];

        return (
          <button
            key={mode}
            type="button"
            onClick={() => setOddsLens(mode)}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            className="transition-all duration-150"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 24,
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              letterSpacing: '-0.02em',
              color: active ? '#0f172a' : '#94a3b8',
              backgroundColor: active ? '#ffffff' : 'transparent',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)' : 'none',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
});
OddsLensToggle.displayName = 'OddsLensToggle';

// ─── OddsLensLabel ─────────────────────────────────────────────────────────

const MODE_DESCRIPTIONS: Record<OddsLensMode, string> = {
  PROB: 'Prediction market probability',
  ODDS: 'American odds format',
  EDGE: 'Market vs books divergence',
};

export const OddsLensLabel: React.FC = memo(() => {
  const oddsLens = useAppStore((s) => s.oddsLens);

  return (
    <span
      className="text-[9px] font-medium uppercase tracking-widest select-none"
      style={{ color: '#94a3b8' }}
    >
      {MODE_DESCRIPTIONS[oddsLens]}
    </span>
  );
});
OddsLensLabel.displayName = 'OddsLensLabel';

export default OddsLensPill;
