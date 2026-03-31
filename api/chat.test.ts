import { describe, expect, it } from 'vitest';
import {
  QUALITY_FAILURE_CODES,
  assessLiveQualityState,
  classifyQuestionType,
  getRequiredAnswerabilityKeys,
} from './chat.js';

describe('chat live-edge routing', () => {
  it('classifies live edges intent as market', () => {
    expect(classifyQuestionType('What live edges are available right now?')).toBe('market');
    expect(classifyQuestionType('Any edge available?')).toBe('market');
  });

  it('keeps event queries in events bucket', () => {
    expect(classifyQuestionType('What happened on the last play?')).toBe('events');
  });
});

describe('live quality guardrails', () => {
  it('requires market answerability for market questions', () => {
    expect(getRequiredAnswerabilityKeys('market')).toEqual(['can_answer_market_movement']);
  });

  it('returns OK when packet is present, fresh, and answerable', () => {
    const packet = {
      answerability: { can_answer_market_movement: true },
      packet_meta: { freshness_seconds: 12 },
    };

    const result = assessLiveQualityState({
      questionType: 'market',
      isLive: true,
      trustedPacketMatchId: 'match-1',
      trustedPacket: packet,
      trustedFreshnessSeconds: 12,
      inferenceMode: 'transition_grounded',
    });

    expect(result.qualityFailureCode).toBe(QUALITY_FAILURE_CODES.OK);
  });

  it('flags missing packet when required', () => {
    const result = assessLiveQualityState({
      questionType: 'market',
      isLive: true,
      trustedPacketMatchId: 'match-1',
      trustedPacket: null,
      trustedFreshnessSeconds: null,
      inferenceMode: 'snapshot_only',
    });

    expect(result.qualityFailureCode).toBe(QUALITY_FAILURE_CODES.PACKET_BYPASS);
  });

  it('flags stale packets before answering', () => {
    const packet = {
      answerability: { can_answer_market_movement: true },
      packet_meta: { freshness_seconds: 120 },
    };

    const result = assessLiveQualityState({
      questionType: 'market',
      isLive: true,
      trustedPacketMatchId: 'match-2',
      trustedPacket: packet,
      trustedFreshnessSeconds: 120,
      inferenceMode: 'transition_grounded',
    });

    expect(result.qualityFailureCode).toBe(QUALITY_FAILURE_CODES.STALE_CONFIDENT_ANSWER);
  });

  it('flags missing required fields', () => {
    const packet = {
      answerability: { can_answer_market_movement: false },
      packet_meta: { freshness_seconds: 10 },
    };

    const result = assessLiveQualityState({
      questionType: 'market',
      isLive: true,
      trustedPacketMatchId: 'match-3',
      trustedPacket: packet,
      trustedFreshnessSeconds: 10,
      inferenceMode: 'transition_grounded',
    });

    expect(result.qualityFailureCode).toBe(QUALITY_FAILURE_CODES.PARTIAL_PACKET_OVERREACH);
  });

  it('flags snapshot-only market reads', () => {
    const packet = {
      answerability: { can_answer_market_movement: true },
      packet_meta: { freshness_seconds: 10 },
    };

    const result = assessLiveQualityState({
      questionType: 'market',
      isLive: true,
      trustedPacketMatchId: 'match-4',
      trustedPacket: packet,
      trustedFreshnessSeconds: 10,
      inferenceMode: 'snapshot_only',
    });

    expect(result.qualityFailureCode).toBe(QUALITY_FAILURE_CODES.SNAPSHOT_AS_TRANSITION);
  });
});
