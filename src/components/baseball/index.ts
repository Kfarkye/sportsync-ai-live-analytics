// ============================================================================
// src/components/baseball/index.ts
// Barrel export — baseball module
// ============================================================================

export { default as BaseballGamePanel } from './BaseballLivePanel';
export {
  BaseballLineScore,
  BaseballEdgePanel,
  BaseballScoringSummary,
} from './BaseballLivePanel';

export { useBaseballLive } from './useBaseballLive';

export type {
  BaseballLiveData,
  BaseballPitcher,
  BaseballBatter,
  BaseballEdgeData,
  BaseballEdgeSignal,
  BaseballScoringPlay,
  PitchEvent,
  PitchResult,
  DueUpPlayer,
  InningHalf,
  ConvergenceTier,
  EdgeInput,
} from './types';

export {
  computeConvergence,
  ordinalSuffix,
  formatInning,
  isStaleTs,
  relativeTime,
} from './types';
