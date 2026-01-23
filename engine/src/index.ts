/**
 * NBA Live Totals Control Engine v3.0 - Index
 * Public API exports
 */

// Types
export * from './types';

// Configuration
export { CONFIG } from './config';

// Math utilities
export * from './math';

// Core modules
export * from './possessions';
export * from './expectations';
export * from './lineup';
export * from './endgame';
export * from './volatility';

// Main engine
export { computeControlTable, validateControlTableInput } from './controlTable';

// Triggers
export * from './triggers';

// Sanity
export * from './sanity';

// Explainability
export * from './explain';

// Backtest
export { runBacktest, printBacktestSummary } from './backtest';

