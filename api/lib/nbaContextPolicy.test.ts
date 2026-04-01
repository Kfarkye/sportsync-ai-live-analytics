import { describe, expect, it } from 'vitest';
import {
  buildNbaPromptContextBlock,
  deriveNbaContextState,
} from './nbaContextPolicy.js';

function packetFixture(status: 'ready' | 'suppressed' | 'unavailable') {
  return {
    availability: {
      seasonContext: status === 'ready',
      liveStateContext: status === 'ready',
      environmentContext: status === 'ready',
      recentOverlaySupplement: false,
    },
    seasonContext: {
      label: 'This point in the season',
      status,
      scope: 'SEASON',
      summary: 'Season summary text.',
      sampleLabel: '44 games',
    },
    liveStateContext: {
      label: 'How games like this usually finish',
      status,
      scope: 'HISTORICAL_BACKBONE',
      summary: 'Live-state summary text.',
      sampleLabel: '612 rows across 38 matches',
    },
    environmentContext: {
      label: 'What kind of game this tends to become',
      status,
      scope: 'ENVIRONMENT',
      summary: 'Environment summary text.',
      sampleLabel: '24 games',
    },
  };
}

describe('nbaContextPolicy prompt-state fixtures', () => {
  it('available fixture keeps AVAILABLE policy mode', () => {
    const packet = packetFixture('ready');
    const block = buildNbaPromptContextBlock(packet);

    expect(deriveNbaContextState(packet)).toBe('available');
    expect(block).toContain('NBA_CONTEXT_STATE: AVAILABLE');
    expect(block).toContain('Use provided NBA context summaries directly');
  });

  it('suppressed fixture applies one-sentence and anti-speculation policy', () => {
    const packet = packetFixture('suppressed');
    const block = buildNbaPromptContextBlock(packet);

    expect(deriveNbaContextState(packet)).toBe('suppressed');
    expect(block).toContain('NBA_CONTEXT_STATE: SUPPRESSED');
    expect(block).toContain('at most one sentence');
    expect(block).toContain('intentionally suppressed for this matchup');
    expect(block).toContain('Do not use causal or speculative language');
  });

  it('unavailable fixture applies one-sentence and live-facts-only policy', () => {
    const packet = packetFixture('unavailable');
    const block = buildNbaPromptContextBlock(packet);

    expect(deriveNbaContextState(packet)).toBe('unavailable');
    expect(block).toContain('NBA_CONTEXT_STATE: UNAVAILABLE');
    expect(block).toContain('at most one sentence');
    expect(block).toContain('unavailable right now');
    expect(block).toContain('Do not infer season-pattern or historical game-shape claims');
  });
});

