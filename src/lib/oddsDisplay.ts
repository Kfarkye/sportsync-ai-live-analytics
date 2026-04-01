import type { OddsLensMode } from '@/store/appStore';

export const parseAmericanOdds = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim().toUpperCase();
  if (text === 'EVEN') return 100;
  if (text === 'PK' || text === 'PICK') return 0;
  const parsed = Number(text.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

export const americanToImpliedProbability = (odds: number): number => {
  if (odds === 0) return 50;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
};

export const americanToDecimalOdds = (odds: number): number => {
  if (odds === 0) return 2;
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
};

export const formatAmericanOdds = (odds: number): string => {
  if (odds === 0) return 'PK';
  return odds > 0 ? `+${Math.round(odds)}` : `${Math.round(odds)}`;
};

export const formatOddsByMode = (
  raw: unknown,
  mode: OddsLensMode,
  type: 'moneyline' | 'price' = 'moneyline',
): string | null => {
  const parsed = parseAmericanOdds(raw);
  if (parsed === null) return null;

  if (type === 'price' && mode === 'AMERICAN') return formatAmericanOdds(parsed);

  if (mode === 'IMPLIED') {
    return `${(americanToImpliedProbability(parsed) * 100).toFixed(1)}%`;
  }

  if (mode === 'DECIMAL') {
    return americanToDecimalOdds(parsed).toFixed(2);
  }

  return formatAmericanOdds(parsed);
};

