// ═══════════════════════════════════════════════════════════════════════════════
// OddsLens.tsx — Three-mode odds display system
//
// The Drip shows predictions the way they should be read:
//
//   IMPLIED   → "58.0%" — Implied probability
//   AMERICAN  → "-138"  — American odds
//   DECIMAL   → "1.72"  — Decimal odds
//
// Design: Jony Ive minimalism. The pill is tappable (Apple Stocks pattern).
// Every tap cycles IMPLIED → AMERICAN → DECIMAL globally across all pills.
//
// Data hierarchy:
//   Polymarket share price (primary) → sportsbook implied prob (comparison)
//   Edge = polyProb - bookImpliedProb
//
// Conversion math:
//   prob → American: p≥50% → -(p/(1-p))×100 | p<50% → +((1-p)/p)×100
//   American → implied: neg → |odds|/(|odds|+100) | pos → 100/(odds+100)
// ═══════════════════════════════════════════════════════════════════════════════

import React, { memo } from 'react';
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

function probToDecimal(prob: number): string {
  if (prob <= 0 || prob >= 100) return '-';
  const decimal = 100 / prob;
  return decimal.toFixed(2);
}

// ─── Color Logic ───────────────────────────────────────────────────────────

interface PillColors {
  text: string;
  bg: string;
  border: string;
}

function getPillColors(mode: OddsLensMode, value: number | undefined, isFavorite: boolean): PillColors {
  if (mode === 'AMERICAN') {
    return isFavorite
      ? { text: '#0b5a45', bg: '#edfbf4', border: '#5ac9a5' }
      : { text: '#4b5563', bg: '#ffffff', border: '#d1d5db' };
  }

  if (mode === 'DECIMAL') {
    return isFavorite
      ? { text: '#0b5a45', bg: '#edfbf4', border: '#5ac9a5' }
      : { text: '#4b5563', bg: '#ffffff', border: '#d1d5db' };
  }

  // IMPLIED
  return isFavorite
    ? { text: '#0b5a45', bg: '#edfbf4', border: '#5ac9a5' }
    : { text: '#4b5563', bg: '#ffffff', border: '#d1d5db' };
}

// ─── OddsLensPill ──────────────────────────────────────────────────────────

interface OddsLensPillProps {
  value: number | undefined;
  isFavorite: boolean;
}

export const OddsLensPill: React.FC<OddsLensPillProps> = memo(({ value, isFavorite }) => {
  const oddsLens = useAppStore((s) => s.oddsLens);

  if (value === undefined || value === null || value <= 0 || value > 100) {
    return <span className="w-[46px] shrink-0" aria-hidden="true" />;
  }

  let display: string;
  switch (oddsLens) {
    case 'AMERICAN':
      display = probToAmerican(value);
      break;
    case 'DECIMAL':
      display = probToDecimal(value);
      break;
    default:
      display = `${value.toFixed(1)}%`;
  }

  const colors = getPillColors(oddsLens, value, isFavorite);
  const isOddsMode = oddsLens === 'AMERICAN';
  const isDecimalMode = oddsLens === 'DECIMAL';

  // Mini bar dimensions
  const showMiniBar = oddsLens === 'IMPLIED' && value !== undefined;
  const barWidth = 36;
  const barHeight = 3;

  return (
    <span
      aria-label={display}
      className="inline-flex items-center justify-center gap-1.5 tabular-nums font-semibold select-none relative"
      style={{
        fontSize: isDecimalMode ? 10 : 11,
        minWidth: isOddsMode ? 48 : isDecimalMode ? 52 : 42,
        height: 22,
        padding: '0 6px',
        borderRadius: 6,
        letterSpacing: isOddsMode || isDecimalMode ? '-0.02em' : '-0.01em',
        fontFamily: isOddsMode || isDecimalMode ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
        color: colors.text,
        border: `1px solid ${colors.border}`,
        backgroundColor: colors.bg,
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
    </span>
  );
});
OddsLensPill.displayName = 'OddsLensPill';

// ─── OddsLensToggle ────────────────────────────────────────────────────────

const MODE_LABELS: Record<OddsLensMode, { icon: string; label: string }> = {
  IMPLIED: { icon: '%', label: 'Implied Probability' },
  AMERICAN: { icon: '±', label: 'American Odds' },
  DECIMAL: { icon: '△', label: 'Decimal Odds' },
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
      {(['IMPLIED', 'AMERICAN', 'DECIMAL'] as OddsLensMode[]).map((mode) => {
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
              backgroundColor: active ? '#edfbf4' : 'transparent',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px rgba(90,201,165,0.5)' : 'none',
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
  IMPLIED: 'Implied probability format',
  AMERICAN: 'American odds format',
  DECIMAL: 'Decimal odds format',
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
