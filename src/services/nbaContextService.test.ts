import { describe, expect, it } from 'vitest';
import type { NbaLiveStateContextRow, NbaSurfaceResult } from '@/services/nbaContextService';
import { __test, deriveNbaContextFilters } from '@/services/nbaContextService';

function makeLiveStateRow(overrides: Partial<NbaLiveStateContextRow> = {}): NbaLiveStateContextRow {
  return {
    context_scope: 'HISTORICAL_BACKBONE',
    progress_bucket: '50-60%',
    home_win_prob_bucket: '60-70%',
    total_over_prob_bucket: '40-50%',
    overlay_period_key: '4',
    overlay_remaining_minute_bucket: '3-6',
    score_diff_bucket: 'LEAD_1_TO_3',
    bonus_shape: 'NA|NA',
    rows: 600,
    matches: 40,
    market_matches: 20,
    rich_overlay_matches: 10,
    actual_home_win_pct: 64,
    actual_over_pct: 48,
    espn_home_calibration_gap_pp: 2,
    espn_total_calibration_gap_pp: 1,
    market_home_calibration_gap_pp: -1,
    market_minus_espn_gap_pp: -2,
    false_certainty_rate_pct: 4,
    avg_total_residual_points: 1.5,
    avg_estimated_pace: 98.7,
    avg_combined_fouls: 39.4,
    avg_progress_fraction: 0.55,
    min_rows_threshold: 250,
    min_matches_threshold: 25,
    meets_sample_threshold: true,
    exposure_tier: 'READY',
    updated_at: '2026-03-17T00:00:00Z',
    ...overrides,
  };
}

describe('deriveNbaContextFilters', () => {
  it('maps raw live inputs into MV bucket keys', () => {
    const filters = deriveNbaContextFilters({
      asOf: '2026-03-17T04:00:00Z',
      progressFraction: 0.56,
      homeWinProb: 0.64,
      totalOverProb: 42,
      period: 4,
      clock: '4:32',
      homeScore: 101,
      awayScore: 98,
      homeBonusState: 'DOUBLE',
      awayBonusState: 'SINGLE',
    });

    expect(filters.weekStart).toBe('2026-03-16');
    expect(filters.progressBucket).toBe('50-60%');
    expect(filters.homeWinProbBucket).toBe('60-70%');
    expect(filters.totalOverProbBucket).toBe('40-50%');
    expect(filters.overlayPeriodKey).toBe('4');
    expect(filters.overlayRemainingMinuteBucket).toBe('3-6');
    expect(filters.scoreDiffBucket).toBe('LEAD_1_TO_3');
    expect(filters.bonusShape).toBe('DOUBLE|SINGLE');
  });
});

describe('live-state selection helpers', () => {
  it('prefers the closest historical bucket over a looser one', () => {
    const target = deriveNbaContextFilters({
      progressFraction: 0.55,
      homeWinProb: 0.64,
      totalOverProb: 0.42,
    });

    const exact = makeLiveStateRow();
    const loose = makeLiveStateRow({
      progress_bucket: '40-50%',
      home_win_prob_bucket: '50-60%',
      total_over_prob_bucket: '20-30%',
      rows: 1200,
      matches: 90,
    });

    const winner = __test.selectBestLiveStateCandidate(
      [loose, exact],
      'HISTORICAL_BACKBONE',
      target,
    );

    expect(winner).toEqual(exact);
  });

  it('keeps historical backbone as the primary surface when both scopes are present', () => {
    const historical: NbaSurfaceResult<NbaLiveStateContextRow> = {
      state: 'ready',
      reason: 'ok',
      data: makeLiveStateRow(),
      message: null,
      matchStrategy: 'exact',
    };
    const recent: NbaSurfaceResult<NbaLiveStateContextRow> = {
      state: 'ready',
      reason: 'ok',
      data: makeLiveStateRow({
        context_scope: 'RECENT_OVERLAY',
        rows: 80,
        matches: 8,
      }),
      message: null,
      matchStrategy: 'time_score_probability',
    };

    expect(__test.pickPrimaryLiveStateSurface(historical, recent)).toBe('HISTORICAL_BACKBONE');
  });
});
