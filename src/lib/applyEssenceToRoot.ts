import { applySportsSyncTokensToRoot } from './design-tokens';

/**
 * Backward-compatible bridge.
 * Runtime token application now delegates to the SportsSync warm-light SSOT.
 */
export function applyEssenceToRoot(): void {
    applySportsSyncTokensToRoot();
}
