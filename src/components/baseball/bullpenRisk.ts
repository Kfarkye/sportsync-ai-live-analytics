import type { BaseballEdgeSignal } from './types';

const SIGNAL_SCORES: Record<'high' | 'med' | 'low', number> = { high: 3, med: 2, low: 1 };

const scoreToSignal = (score: number): 'high' | 'med' | 'low' => {
  if (score >= 3) return 'high';
  if (score === 2) return 'med';
  return 'low';
};

const runEnvironmentLabel = (signal: 'high' | 'med' | 'low') =>
  signal === 'high' ? 'Boosted' : signal === 'low' ? 'Suppressed' : 'Neutral';

export const buildBullpenWeatherSignal = (
  weather: BaseballEdgeSignal | undefined,
  bullpen: BaseballEdgeSignal | undefined,
  pitchCount: BaseballEdgeSignal | undefined,
): BaseballEdgeSignal => {
  const bullpenSignal = bullpen?.signal ?? 'med';
  const weatherSignal = weather?.signal ?? 'med';
  const pitchSignal = pitchCount?.signal ?? 'med';

  let score = SIGNAL_SCORES[bullpenSignal];
  if (weatherSignal === 'high') score += 1;
  if (weatherSignal === 'low') score -= 1;
  if (pitchSignal === 'high') score += 1;
  if (pitchSignal === 'low') score -= 1;
  score = Math.max(1, Math.min(3, score));

  const adjustedSignal = scoreToSignal(score);
  const runEnv = runEnvironmentLabel(weatherSignal);
  const riskLabel = adjustedSignal === 'high' ? 'High Risk' : adjustedSignal === 'med' ? 'Moderate Risk' : 'Lower Risk';

  let summary = 'Bullpen risk holds steady in current conditions.';
  if (bullpenSignal === 'high' && weatherSignal === 'high') {
    summary = 'Bullpen risk rises after the 5th, and weather is helping carry.';
  } else if (bullpenSignal === 'high' && weatherSignal !== 'high') {
    summary = 'Bullpen risk is elevated once the starter exits.';
  } else if (bullpenSignal !== 'high' && weatherSignal === 'high') {
    summary = 'Weather is boosting carry, but bullpen depth keeps risk contained.';
  } else if (bullpenSignal === 'low' && weatherSignal === 'low') {
    summary = 'Suppressed run environment softens late risk.';
  }

  if (pitchSignal === 'high') {
    summary = `${summary} Starter leash looks short.`;
  }

  const inputs = [
    { field: 'Run Env', value: runEnv },
    ...(weather?.inputs ?? []).slice(0, 2),
    ...(bullpen?.inputs ?? []).slice(0, 2),
  ];

  return {
    label: 'Bullpen + Weather Risk',
    value: riskLabel,
    signal: adjustedSignal,
    detail: summary,
    inputs,
  };
};

export default buildBullpenWeatherSignal;
