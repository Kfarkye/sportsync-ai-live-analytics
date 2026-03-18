import { describe, expect, it } from 'vitest';
import {
  buildNbaProductContextPacket,
  buildUnavailableNbaProductContextPacket,
} from '@/services/nbaProductContext';
import type {
  NbaDerivedContextFilters,
  NbaLiveStateContextBundle,
  NbaLiveStateContextRow,
  NbaProductContextPayload,
  NbaRefEnvironmentRow,
  NbaSurfaceResult,
  NbaVenueEnvironmentRow,
  NbaWeeklyContextRow,
} from '@/services/nbaContextService';

const derived: NbaDerivedContextFilters = {
  weekStart: '2026-03-16',
  progressBucket: '50-60%',
  homeWinProbBucket: '60-70%',
  totalOverProbBucket: '40-50%',
  overlayPeriodKey: '4',
  overlayRemainingMinuteBucket: '3-6',
  scoreDiffBucket: 'LEAD_1_TO_3',
  bonusShape: 'DOUBLE|SINGLE',
};

function makeWeeklyRow(overrides: Partial<NbaWeeklyContextRow> = {}): NbaWeeklyContextRow {
  return {
    week_start: '2026-03-16',
    week_of_season: 24,
    games: 44,
    probability_rows: 21030,
    avg_entries_per_game: 477.95,
    win_brier_espn: 0.1355,
    win_brier_market: 0.0918,
    total_over_calibration_gap_pp: 2.4,
    spread_cover_calibration_gap_pp: -0.4,
    market_minus_espn_gap_pp: -1.7,
    avg_absolute_repricing_step: 0.028,
    false_certainty_rate_pct: 4.1,
    avg_pregame_home_win_prob: 0.61,
    avg_anchor_total: 229.5,
    avg_final_total: 236.4,
    avg_total_residual_points: 6.9,
    avg_estimated_pace: 100.1,
    pace_delta_vs_season: 1.6,
    avg_combined_fouls: 39.8,
    foul_delta_vs_season: 0.9,
    blowout_rate_pct: 31.8,
    market_overlay_row_rate_pct: 47.6,
    recent_overlay_row_rate_pct: 41.2,
    total_environment_tag: 'OVER_HEAVY',
    pace_environment_tag: 'NEUTRAL',
    min_games_threshold: 8,
    meets_sample_threshold: true,
    exposure_tier: 'READY',
    updated_at: '2026-03-17T00:00:00Z',
    ...overrides,
  };
}

function makeLiveStateRow(overrides: Partial<NbaLiveStateContextRow> = {}): NbaLiveStateContextRow {
  return {
    context_scope: 'HISTORICAL_BACKBONE',
    progress_bucket: '50-60%',
    home_win_prob_bucket: '60-70%',
    total_over_prob_bucket: '40-50%',
    overlay_period_key: '4',
    overlay_remaining_minute_bucket: '3-6',
    score_diff_bucket: 'LEAD_1_TO_3',
    bonus_shape: 'DOUBLE|SINGLE',
    rows: 612,
    matches: 38,
    market_matches: 20,
    rich_overlay_matches: 11,
    actual_home_win_pct: 64.1,
    actual_over_pct: 52.4,
    espn_home_calibration_gap_pp: 2.3,
    espn_total_calibration_gap_pp: 1.2,
    market_home_calibration_gap_pp: -0.7,
    market_minus_espn_gap_pp: -1.4,
    false_certainty_rate_pct: 4.6,
    avg_total_residual_points: 3.2,
    avg_estimated_pace: 99.2,
    avg_combined_fouls: 40.1,
    avg_progress_fraction: 0.56,
    min_rows_threshold: 250,
    min_matches_threshold: 25,
    meets_sample_threshold: true,
    exposure_tier: 'READY',
    updated_at: '2026-03-17T00:00:00Z',
    ...overrides,
  };
}

function makeVenueRow(overrides: Partial<NbaVenueEnvironmentRow> = {}): NbaVenueEnvironmentRow {
  return {
    venue_name: 'Delta Center',
    games: 24,
    avg_combined_fouls: 39.1,
    foul_delta_vs_baseline: 0.6,
    avg_estimated_pace: 100.8,
    pace_delta_vs_baseline: 1.9,
    avg_total_residual_points: 10.1,
    avg_home_side_residual_pp: 1.4,
    avg_margin_residual_points: 0.8,
    total_residual_sd: 12.2,
    blowout_rate_pct: 29.1,
    avg_attendance: 18111,
    variance_environment_tag: 'HIGH_VARIANCE',
    min_games_threshold: 8,
    meets_sample_threshold: true,
    exposure_tier: 'READY',
    updated_at: '2026-03-17T00:00:00Z',
    ...overrides,
  };
}

function makeRefRow(overrides: Partial<NbaRefEnvironmentRow> = {}): NbaRefEnvironmentRow {
  return {
    lead_ref: 'Rodney Mott',
    games: 19,
    distinct_crews: 8,
    avg_combined_fouls: 42.3,
    foul_delta_vs_baseline: 2.7,
    avg_estimated_pace: 102.0,
    pace_delta_vs_baseline: 4.0,
    avg_total_residual_points: 3.7,
    avg_home_side_residual_pp: 0.9,
    avg_margin_residual_points: 0.4,
    total_residual_sd: 10.7,
    blowout_rate_pct: 27.5,
    avg_attendance: 17780,
    variance_environment_tag: 'NORMAL_VARIANCE',
    min_games_threshold: 8,
    meets_sample_threshold: true,
    exposure_tier: 'READY',
    updated_at: '2026-03-17T00:00:00Z',
    ...overrides,
  };
}

function makeSurface<T extends { exposure_tier: 'READY' | 'LIMITED' | 'HIDE' }>(
  data: T | null,
  options: Partial<NbaSurfaceResult<T>> = {},
): NbaSurfaceResult<T> {
  return {
    state: data ? (data.exposure_tier === 'READY' ? 'ready' : 'limited') : 'empty',
    reason: data ? 'ok' : 'no_qualifying_sample',
    data,
    message: data ? null : 'No sample.',
    matchStrategy: 'exact',
    ...options,
  };
}

function makePayload(overrides: Partial<NbaProductContextPayload> = {}): NbaProductContextPayload {
  const liveState: NbaLiveStateContextBundle = {
    derived,
    historical: makeSurface(makeLiveStateRow()),
    recentOverlay: makeSurface(
      makeLiveStateRow({
        context_scope: 'RECENT_OVERLAY',
        rows: 88,
        matches: 9,
        min_rows_threshold: 50,
        min_matches_threshold: 5,
        avg_total_residual_points: 5.4,
      }),
    ),
    primaryScope: 'HISTORICAL_BACKBONE',
  };

  return {
    derived,
    weekly: makeSurface(makeWeeklyRow()),
    liveState,
    environment: {
      venue: makeSurface(makeVenueRow()),
      officiating: makeSurface(makeRefRow()),
    },
    ...overrides,
  };
}

describe('buildNbaProductContextPacket', () => {
  it('returns a stable unavailable packet contract when context is not accessible', () => {
    const packet = buildUnavailableNbaProductContextPacket(
      derived,
      'missing_relation',
      'NBA context views are not deployed in this environment.',
    );

    expect(packet.lookup.weekStart).toBe('2026-03-16');
    expect(packet.seasonContext.available).toBe(false);
    expect(packet.liveStateContext.available).toBe(false);
    expect(packet.environmentContext.available).toBe(false);
    expect(packet.seasonContext.status).toBe('unavailable');
    expect(packet.liveStateContext.status).toBe('unavailable');
    expect(packet.environmentContext.status).toBe('unavailable');
    expect(packet.seasonContext.detail).toContain('not deployed');
    expect(packet.availability.recentOverlaySupplement).toBe(false);
  });

  it('suppresses limited weekly context instead of exposing thin-sample copy', () => {
    const packet = buildNbaProductContextPacket(
      makePayload({
        weekly: makeSurface(makeWeeklyRow({ exposure_tier: 'LIMITED' }), {
          state: 'limited',
          reason: 'ok',
        }),
      }),
    );

    expect(packet.seasonContext.available).toBe(false);
    expect(packet.seasonContext.status).toBe('suppressed');
    expect(packet.seasonContext.reason).toBe('suppressed_limited_sample');
    expect(packet.seasonContext.summary).toBeNull();
  });

  it('uses historical backbone as the primary live-state section and recent overlay as supplement', () => {
    const packet = buildNbaProductContextPacket(makePayload());

    expect(packet.lookup.progressBucket).toBe('50-60%');
    expect(packet.liveStateContext.available).toBe(true);
    expect(packet.liveStateContext.scope).toBe('HISTORICAL_BACKBONE');
    expect(packet.liveStateContext.summary).toContain('home win rate');
    expect(packet.liveStateContext.supplement?.label).toBe('Recent overlay');
    expect(packet.availability.recentOverlaySupplement).toBe(true);
  });

  it('builds environment context from whichever qualified surface is available', () => {
    const packet = buildNbaProductContextPacket(
      makePayload({
        environment: {
          venue: makeSurface(null, {
            state: 'empty',
            reason: 'no_qualifying_sample',
            message: 'No venue sample.',
            matchStrategy: null,
          }),
          officiating: makeSurface(makeRefRow()),
        },
      }),
    );

    expect(packet.environmentContext.available).toBe(true);
    expect(packet.environmentContext.summary).toContain('lead crew');
    expect(packet.environmentContext.facts.some((fact) => fact.includes('Lead ref Rodney Mott'))).toBe(true);
  });
});
