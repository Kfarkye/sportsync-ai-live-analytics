import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

const WEEKLY_CONTEXT_TABLE = 'mv_nba_weekly_context';
const LIVE_STATE_CONTEXT_TABLE = 'mv_nba_live_state_context';
const REF_ENVIRONMENT_TABLE = 'mv_nba_ref_environment';
const VENUE_ENVIRONMENT_TABLE = 'mv_nba_venue_environment';

export type NbaContextScope = 'HISTORICAL_BACKBONE' | 'RECENT_OVERLAY';
export type NbaExposureTier = 'READY' | 'LIMITED' | 'HIDE';
export type NbaSurfaceState = 'ready' | 'limited' | 'empty' | 'unavailable';
export type NbaSurfaceReason =
  | 'ok'
  | 'no_qualifying_sample'
  | 'missing_relation'
  | 'query_failed';

export interface NbaWeeklyContextRow {
  week_start: string;
  week_of_season: number;
  games: number;
  probability_rows: number;
  avg_entries_per_game: number | null;
  win_brier_espn: number | null;
  win_brier_market: number | null;
  total_over_calibration_gap_pp: number | null;
  spread_cover_calibration_gap_pp: number | null;
  market_minus_espn_gap_pp: number | null;
  avg_absolute_repricing_step: number | null;
  false_certainty_rate_pct: number | null;
  avg_pregame_home_win_prob: number | null;
  avg_anchor_total: number | null;
  avg_final_total: number | null;
  avg_total_residual_points: number | null;
  avg_estimated_pace: number | null;
  pace_delta_vs_season: number | null;
  avg_combined_fouls: number | null;
  foul_delta_vs_season: number | null;
  blowout_rate_pct: number | null;
  market_overlay_row_rate_pct: number | null;
  recent_overlay_row_rate_pct: number | null;
  total_environment_tag: string;
  pace_environment_tag: string;
  min_games_threshold: number;
  meets_sample_threshold: boolean;
  exposure_tier: NbaExposureTier;
  updated_at: string;
}

export interface NbaLiveStateContextRow {
  context_scope: NbaContextScope;
  progress_bucket: string;
  home_win_prob_bucket: string;
  total_over_prob_bucket: string;
  overlay_period_key: string;
  overlay_remaining_minute_bucket: string;
  score_diff_bucket: string;
  bonus_shape: string;
  rows: number;
  matches: number;
  market_matches: number;
  rich_overlay_matches: number;
  actual_home_win_pct: number | null;
  actual_over_pct: number | null;
  espn_home_calibration_gap_pp: number | null;
  espn_total_calibration_gap_pp: number | null;
  market_home_calibration_gap_pp: number | null;
  market_minus_espn_gap_pp: number | null;
  false_certainty_rate_pct: number | null;
  avg_total_residual_points: number | null;
  avg_estimated_pace: number | null;
  avg_combined_fouls: number | null;
  avg_progress_fraction: number | null;
  min_rows_threshold: number;
  min_matches_threshold: number;
  meets_sample_threshold: boolean;
  exposure_tier: NbaExposureTier;
  updated_at: string;
}

export interface NbaRefEnvironmentRow {
  lead_ref: string;
  games: number;
  distinct_crews: number;
  avg_combined_fouls: number | null;
  foul_delta_vs_baseline: number | null;
  avg_estimated_pace: number | null;
  pace_delta_vs_baseline: number | null;
  avg_total_residual_points: number | null;
  avg_home_side_residual_pp: number | null;
  avg_margin_residual_points: number | null;
  total_residual_sd: number | null;
  blowout_rate_pct: number | null;
  avg_attendance: number | null;
  variance_environment_tag: string;
  min_games_threshold: number;
  meets_sample_threshold: boolean;
  exposure_tier: NbaExposureTier;
  updated_at: string;
}

export interface NbaVenueEnvironmentRow {
  venue_name: string;
  games: number;
  avg_combined_fouls: number | null;
  foul_delta_vs_baseline: number | null;
  avg_estimated_pace: number | null;
  pace_delta_vs_baseline: number | null;
  avg_total_residual_points: number | null;
  avg_home_side_residual_pp: number | null;
  avg_margin_residual_points: number | null;
  total_residual_sd: number | null;
  blowout_rate_pct: number | null;
  avg_attendance: number | null;
  variance_environment_tag: string;
  min_games_threshold: number;
  meets_sample_threshold: boolean;
  exposure_tier: NbaExposureTier;
  updated_at: string;
}

export interface NbaSurfaceResult<T> {
  state: NbaSurfaceState;
  reason: NbaSurfaceReason;
  data: T | null;
  message: string | null;
  matchStrategy: string | null;
}

export interface NbaCollectionResult<T> {
  state: NbaSurfaceState;
  reason: NbaSurfaceReason;
  items: T[];
  message: string | null;
}

export interface NbaWeeklyContextSeriesRequest {
  limit?: number;
}

export interface NbaWeeklyContextRequest {
  asOf?: Date | string | null;
}

export interface NbaLiveStateLookupInput {
  asOf?: Date | string | null;
  progressFraction?: number | null;
  homeWinProb?: number | string | null;
  totalOverProb?: number | string | null;
  period?: number | string | null;
  clock?: string | null;
  homeScore?: number | string | null;
  awayScore?: number | string | null;
  homeBonusState?: string | null;
  awayBonusState?: string | null;
}

export interface NbaEnvironmentLookupInput {
  venueName?: string | null;
  leadRef?: string | null;
}

export interface NbaProductContextInput extends NbaLiveStateLookupInput, NbaEnvironmentLookupInput {}

export interface NbaDerivedContextFilters {
  weekStart: string;
  progressBucket: string;
  homeWinProbBucket: string;
  totalOverProbBucket: string;
  overlayPeriodKey: string;
  overlayRemainingMinuteBucket: string;
  scoreDiffBucket: string;
  bonusShape: string;
}

export interface NbaLiveStateContextBundle {
  derived: NbaDerivedContextFilters;
  historical: NbaSurfaceResult<NbaLiveStateContextRow>;
  recentOverlay: NbaSurfaceResult<NbaLiveStateContextRow>;
  primaryScope: NbaContextScope | null;
}

export interface NbaEnvironmentContextBundle {
  venue: NbaSurfaceResult<NbaVenueEnvironmentRow>;
  officiating: NbaSurfaceResult<NbaRefEnvironmentRow>;
}

export interface NbaProductContextPayload {
  derived: NbaDerivedContextFilters;
  weekly: NbaSurfaceResult<NbaWeeklyContextRow>;
  liveState: NbaLiveStateContextBundle;
  environment: NbaEnvironmentContextBundle;
}

type QueryFilterValue = string | number | boolean;

interface QueryFilter {
  column: string;
  value: QueryFilterValue;
}

interface LiveStateLookupPlan {
  name: string;
  filters: QueryFilter[];
  limit: number;
}

interface QueryChain<TData = unknown> extends PromiseLike<{ data: TData | null; error: PostgrestError | null }> {
  eq(column: string, value: QueryFilterValue): QueryChain<TData>;
  neq(column: string, value: QueryFilterValue): QueryChain<TData>;
  ilike(column: string, pattern: string): QueryChain<TData>;
  order(column: string, options?: { ascending?: boolean }): QueryChain<TData>;
  limit(count: number): QueryChain<TData>;
  maybeSingle(): QueryChain<TData>;
}

function surfaceFromExposure(exposureTier: NbaExposureTier | null | undefined): NbaSurfaceState {
  if (exposureTier === 'READY') return 'ready';
  if (exposureTier === 'LIMITED') return 'limited';
  return 'empty';
}

function errorText(error: PostgrestError | null): string {
  if (!error) return '';
  return [error.message, error.details, error.hint, error.code].filter(Boolean).join(' | ');
}

function isMissingRelationError(error: PostgrestError | null): boolean {
  const text = errorText(error).toLowerCase();
  return (
    error?.code === 'PGRST205' ||
    text.includes('could not find the table') ||
    text.includes('could not find the relation') ||
    text.includes('relation') && text.includes('does not exist')
  );
}

function unavailableSurface<T>(message: string): NbaSurfaceResult<T> {
  return {
    state: 'unavailable',
    reason: 'missing_relation',
    data: null,
    message,
    matchStrategy: null,
  };
}

function unavailableCollection<T>(message: string): NbaCollectionResult<T> {
  return {
    state: 'unavailable',
    reason: 'missing_relation',
    items: [],
    message,
  };
}

function emptySurface<T>(message: string, matchStrategy: string | null = null): NbaSurfaceResult<T> {
  return {
    state: 'empty',
    reason: 'no_qualifying_sample',
    data: null,
    message,
    matchStrategy,
  };
}

function collectionFromItems<T extends { exposure_tier: NbaExposureTier }>(
  items: T[],
  emptyMessage: string,
): NbaCollectionResult<T> {
  if (!items.length) {
    return {
      state: 'empty',
      reason: 'no_qualifying_sample',
      items: [],
      message: emptyMessage,
    };
  }
  const state = items.some((item) => item.exposure_tier === 'READY') ? 'ready' : 'limited';
  return {
    state,
    reason: 'ok',
    items,
    message: null,
  };
}

function safeNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/[^0-9+.-]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeProbability(value: unknown): number | null {
  const parsed = safeNumber(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

function parseClockSeconds(clock: string | null | undefined): number | null {
  if (!clock) return null;
  const trimmed = clock.trim();
  if (!trimmed) return null;
  if (trimmed.includes(':')) {
    const [minutesText, secondsText] = trimmed.split(':');
    const minutes = Number(minutesText);
    const seconds = Number(secondsText);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    return minutes * 60 + seconds;
  }
  return safeNumber(trimmed);
}

function nbaRemainingMinutes(period: unknown, clock: string | null | undefined): number | null {
  const normalizedPeriod = safeNumber(period);
  const seconds = parseClockSeconds(clock);
  if (!Number.isFinite(normalizedPeriod) || !Number.isFinite(seconds) || normalizedPeriod <= 0) return null;
  if (normalizedPeriod <= 4) return (4 - normalizedPeriod) * 12 + seconds / 60;
  return seconds / 60;
}

function probabilityBucket(probability: unknown): string {
  const normalized = normalizeProbability(probability);
  if (!Number.isFinite(normalized)) return 'NA';
  const lower = clamp(Math.floor(normalized * 10), 0, 9) * 10;
  return `${lower}-${lower + 10}%`;
}

function progressBucket(progressFraction: unknown): string {
  const normalized = safeNumber(progressFraction);
  if (!Number.isFinite(normalized)) return 'NA';
  const lower = clamp(Math.floor(normalized * 10), 0, 9) * 10;
  return `${lower}-${lower + 10}%`;
}

function scoreDiffBucket(scoreDiff: unknown): string {
  const diff = safeNumber(scoreDiff);
  if (!Number.isFinite(diff)) return 'NA';
  if (diff <= -15) return 'TRAIL_15P_PLUS';
  if (diff <= -8) return 'TRAIL_8_TO_14';
  if (diff <= -4) return 'TRAIL_4_TO_7';
  if (diff <= -1) return 'TRAIL_1_TO_3';
  if (diff === 0) return 'TIED';
  if (diff <= 3) return 'LEAD_1_TO_3';
  if (diff <= 7) return 'LEAD_4_TO_7';
  if (diff <= 14) return 'LEAD_8_TO_14';
  return 'LEAD_15P_PLUS';
}

function remainingMinuteBucket(minutes: unknown): string {
  const parsed = safeNumber(minutes);
  if (!Number.isFinite(parsed)) return 'NA';
  if (parsed >= 36) return '36-48';
  if (parsed >= 24) return '24-36';
  if (parsed >= 18) return '18-24';
  if (parsed >= 12) return '12-18';
  if (parsed >= 6) return '6-12';
  if (parsed >= 3) return '3-6';
  if (parsed >= 1) return '1-3';
  return '0-1';
}

function normalizeBonusToken(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'NA';
}

function toDateValue(value: Date | string | null | undefined): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfIsoWeek(value: Date | string | null | undefined): string {
  const date = toDateValue(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return formatDateKey(date);
}

function bucketLowerBound(bucket: string | null | undefined): number | null {
  if (!bucket || bucket === 'NA') return null;
  const match = bucket.match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

function bucketDistance(left: string | null | undefined, right: string | null | undefined): number {
  if (!left || !right || left === 'NA' || right === 'NA') return 2;
  const leftBound = bucketLowerBound(left);
  const rightBound = bucketLowerBound(right);
  if (!Number.isFinite(leftBound) || !Number.isFinite(rightBound)) return 2;
  return Math.abs((leftBound as number) - (rightBound as number)) / 10;
}

function scoreHistoricalCandidate(
  row: NbaLiveStateContextRow,
  target: NbaDerivedContextFilters,
): number {
  let score = 0;
  score += row.exposure_tier === 'READY' ? 100 : 50;
  score += Math.min(row.rows, 4000) / 100;
  score += Math.min(row.matches, 250) / 5;
  score -= bucketDistance(row.progress_bucket, target.progressBucket) * 18;
  score -= bucketDistance(row.home_win_prob_bucket, target.homeWinProbBucket) * 14;
  score -= bucketDistance(row.total_over_prob_bucket, target.totalOverProbBucket) * 10;
  return score;
}

function scoreRecentCandidate(
  row: NbaLiveStateContextRow,
  target: NbaDerivedContextFilters,
): number {
  let score = 0;
  score += row.exposure_tier === 'READY' ? 100 : 50;
  score += Math.min(row.rows, 200) / 10;
  score += Math.min(row.matches, 50) / 2;
  if (row.overlay_period_key === target.overlayPeriodKey) score += 12;
  if (row.overlay_remaining_minute_bucket === target.overlayRemainingMinuteBucket) score += 16;
  if (row.score_diff_bucket === target.scoreDiffBucket) score += 14;
  if (target.bonusShape !== 'NA' && row.bonus_shape === target.bonusShape) score += 8;
  score -= bucketDistance(row.home_win_prob_bucket, target.homeWinProbBucket) * 10;
  score -= bucketDistance(row.total_over_prob_bucket, target.totalOverProbBucket) * 8;
  return score;
}

function selectBestLiveStateCandidate(
  rows: NbaLiveStateContextRow[],
  scope: NbaContextScope,
  target: NbaDerivedContextFilters,
): NbaLiveStateContextRow | null {
  if (!rows.length) return null;
  const scored = rows
    .map((row) => ({
      row,
      score:
        scope === 'RECENT_OVERLAY'
          ? scoreRecentCandidate(row, target)
          : scoreHistoricalCandidate(row, target),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.row.matches !== left.row.matches) return right.row.matches - left.row.matches;
      return right.row.rows - left.row.rows;
    });
  return scored[0]?.row ?? null;
}

type EqFilterable<TQuery> = {
  eq(column: string, value: QueryFilterValue): TQuery;
};

function applyFilters<TQuery extends EqFilterable<TQuery>>(query: TQuery, filters: QueryFilter[]): TQuery {
  let nextQuery = query;
  for (const filter of filters) {
    nextQuery = nextQuery.eq(filter.column, filter.value);
  }
  return nextQuery;
}

async function runListQuery<T extends { exposure_tier: NbaExposureTier }>(
  table: string,
  build: (query: QueryChain<T[]>) => QueryChain<T[]>,
  emptyMessage: string,
): Promise<NbaCollectionResult<T>> {
  const baseQuery = supabase.from(table).select('*').neq('exposure_tier', 'HIDE') as unknown as QueryChain<T[]>;
  const { data, error } = await build(baseQuery);

  if (error) {
    if (isMissingRelationError(error)) {
      return unavailableCollection<T>(
        'NBA context views are not available on this environment yet. Keep the UI in fallback mode.',
      );
    }
    return {
      state: 'unavailable',
      reason: 'query_failed',
      items: [],
      message: errorText(error),
    };
  }

  return collectionFromItems((data ?? []) as T[], emptyMessage);
}

async function runSingleQuery<T extends { exposure_tier: NbaExposureTier }>(
  table: string,
  build: (query: QueryChain<T>) => QueryChain<T>,
  emptyMessage: string,
): Promise<NbaSurfaceResult<T>> {
  const baseQuery = supabase.from(table).select('*').neq('exposure_tier', 'HIDE') as unknown as QueryChain<T>;
  const { data, error } = await build(baseQuery);

  if (error) {
    if (isMissingRelationError(error)) {
      return unavailableSurface<T>(
        'NBA context views are not available on this environment yet. Keep the UI in fallback mode.',
      );
    }
    return {
      state: 'unavailable',
      reason: 'query_failed',
      data: null,
      message: errorText(error),
      matchStrategy: null,
    };
  }

  const row = (data as T | null) ?? null;
  if (!row) return emptySurface<T>(emptyMessage);

  return {
    state: surfaceFromExposure(row.exposure_tier),
    reason: 'ok',
    data: row,
    message: null,
    matchStrategy: 'exact',
  };
}

function buildHistoricalPlans(target: NbaDerivedContextFilters): LiveStateLookupPlan[] {
  const plans: LiveStateLookupPlan[] = [];

  if (
    target.progressBucket !== 'NA' &&
    target.homeWinProbBucket !== 'NA' &&
    target.totalOverProbBucket !== 'NA'
  ) {
    plans.push({
      name: 'exact',
      limit: 1,
      filters: [
        { column: 'progress_bucket', value: target.progressBucket },
        { column: 'home_win_prob_bucket', value: target.homeWinProbBucket },
        { column: 'total_over_prob_bucket', value: target.totalOverProbBucket },
      ],
    });
  }

  if (target.progressBucket !== 'NA' && target.homeWinProbBucket !== 'NA') {
    plans.push({
      name: 'progress_home',
      limit: 30,
      filters: [
        { column: 'progress_bucket', value: target.progressBucket },
        { column: 'home_win_prob_bucket', value: target.homeWinProbBucket },
      ],
    });
  }

  if (target.progressBucket !== 'NA') {
    plans.push({
      name: 'progress_only',
      limit: 60,
      filters: [{ column: 'progress_bucket', value: target.progressBucket }],
    });
  }

  if (target.homeWinProbBucket !== 'NA') {
    plans.push({
      name: 'probability_only',
      limit: 60,
      filters: [{ column: 'home_win_prob_bucket', value: target.homeWinProbBucket }],
    });
  }

  return plans;
}

function buildRecentPlans(target: NbaDerivedContextFilters): LiveStateLookupPlan[] {
  const plans: LiveStateLookupPlan[] = [];
  const baseRecentFilters: QueryFilter[] = [];

  if (target.overlayPeriodKey !== 'NA') {
    baseRecentFilters.push({ column: 'overlay_period_key', value: target.overlayPeriodKey });
  }
  if (target.overlayRemainingMinuteBucket !== 'NA') {
    baseRecentFilters.push({
      column: 'overlay_remaining_minute_bucket',
      value: target.overlayRemainingMinuteBucket,
    });
  }
  if (target.scoreDiffBucket !== 'NA') {
    baseRecentFilters.push({ column: 'score_diff_bucket', value: target.scoreDiffBucket });
  }

  if (
    baseRecentFilters.length >= 3 &&
    target.homeWinProbBucket !== 'NA' &&
    target.totalOverProbBucket !== 'NA' &&
    target.bonusShape !== 'NA'
  ) {
    plans.push({
      name: 'exact',
      limit: 1,
      filters: [
        ...baseRecentFilters,
        { column: 'home_win_prob_bucket', value: target.homeWinProbBucket },
        { column: 'total_over_prob_bucket', value: target.totalOverProbBucket },
        { column: 'bonus_shape', value: target.bonusShape },
      ],
    });
  }

  if (
    baseRecentFilters.length >= 3 &&
    target.homeWinProbBucket !== 'NA' &&
    target.totalOverProbBucket !== 'NA'
  ) {
    plans.push({
      name: 'time_score_probability',
      limit: 24,
      filters: [
        ...baseRecentFilters,
        { column: 'home_win_prob_bucket', value: target.homeWinProbBucket },
        { column: 'total_over_prob_bucket', value: target.totalOverProbBucket },
      ],
    });
  }

  if (baseRecentFilters.length >= 3) {
    plans.push({
      name: 'time_score',
      limit: 40,
      filters: baseRecentFilters,
    });
  }

  if (target.overlayPeriodKey !== 'NA' && target.overlayRemainingMinuteBucket !== 'NA') {
    plans.push({
      name: 'period_time',
      limit: 60,
      filters: [
        { column: 'overlay_period_key', value: target.overlayPeriodKey },
        { column: 'overlay_remaining_minute_bucket', value: target.overlayRemainingMinuteBucket },
      ],
    });
  }

  return plans;
}

async function fetchLiveStateForScope(
  scope: NbaContextScope,
  target: NbaDerivedContextFilters,
): Promise<NbaSurfaceResult<NbaLiveStateContextRow>> {
  const plans = scope === 'RECENT_OVERLAY' ? buildRecentPlans(target) : buildHistoricalPlans(target);

  for (const plan of plans) {
    let query = supabase
      .from(LIVE_STATE_CONTEXT_TABLE)
      .select('*')
      .eq('context_scope', scope)
      .neq('exposure_tier', 'HIDE')
      .order('meets_sample_threshold', { ascending: false })
      .order('matches', { ascending: false })
      .order('rows', { ascending: false })
      .limit(plan.limit);

    query = applyFilters(query, plan.filters);

    const { data, error } = await query;
    if (error) {
      if (isMissingRelationError(error)) {
        return unavailableSurface<NbaLiveStateContextRow>(
          'NBA live-state context is not available on this environment yet. Keep the UI in fallback mode.',
        );
      }
      return {
        state: 'unavailable',
        reason: 'query_failed',
        data: null,
        message: errorText(error),
        matchStrategy: null,
      };
    }

    const rows = (data ?? []) as NbaLiveStateContextRow[];
    if (!rows.length) continue;

    const best = selectBestLiveStateCandidate(rows, scope, target);
    if (!best) continue;

    return {
      state: surfaceFromExposure(best.exposure_tier),
      reason: 'ok',
      data: best,
      message: null,
      matchStrategy: plan.name,
    };
  }

  return emptySurface<NbaLiveStateContextRow>(
    scope === 'RECENT_OVERLAY'
      ? 'No qualifying recent overlay bucket matched this live state yet.'
      : 'No qualifying historical backbone bucket matched this live state yet.',
  );
}

function pickPrimaryLiveStateSurface(
  historical: NbaSurfaceResult<NbaLiveStateContextRow>,
  recentOverlay: NbaSurfaceResult<NbaLiveStateContextRow>,
): NbaContextScope | null {
  if (historical.data) return 'HISTORICAL_BACKBONE';
  if (recentOverlay.data) return 'RECENT_OVERLAY';
  return null;
}

export function deriveNbaContextFilters(input: NbaLiveStateLookupInput = {}): NbaDerivedContextFilters {
  const remainingMinutes = nbaRemainingMinutes(input.period, input.clock);
  const explicitProgress = safeNumber(input.progressFraction);
  const derivedProgress =
    Number.isFinite(explicitProgress) && explicitProgress != null
      ? clamp(explicitProgress, 0, 1)
      : Number.isFinite(remainingMinutes)
        ? clamp((48 - (remainingMinutes as number)) / 48, 0, 1)
        : null;
  const homeScore = safeNumber(input.homeScore);
  const awayScore = safeNumber(input.awayScore);
  const scoreDiff =
    Number.isFinite(homeScore) && Number.isFinite(awayScore)
      ? (homeScore as number) - (awayScore as number)
      : null;

  return {
    weekStart: startOfIsoWeek(input.asOf),
    progressBucket: progressBucket(derivedProgress),
    homeWinProbBucket: probabilityBucket(input.homeWinProb),
    totalOverProbBucket: probabilityBucket(input.totalOverProb),
    overlayPeriodKey: Number.isFinite(safeNumber(input.period))
      ? String(Math.trunc(safeNumber(input.period) as number))
      : 'NA',
    overlayRemainingMinuteBucket: remainingMinuteBucket(remainingMinutes),
    scoreDiffBucket: scoreDiffBucket(scoreDiff),
    bonusShape: `${normalizeBonusToken(input.homeBonusState)}|${normalizeBonusToken(input.awayBonusState)}`,
  };
}

async function fetchVenueEnvironment(
  venueName: string | null | undefined,
): Promise<NbaSurfaceResult<NbaVenueEnvironmentRow>> {
  const trimmed = venueName?.trim();
  if (!trimmed) {
    return emptySurface<NbaVenueEnvironmentRow>('No venue was provided for the context lookup.');
  }

  const exact = await runSingleQuery<NbaVenueEnvironmentRow>(
    VENUE_ENVIRONMENT_TABLE,
    (query) => query.ilike('venue_name', trimmed).maybeSingle(),
    `No qualifying venue environment was found for ${trimmed}.`,
  );

  if (exact.data || exact.state === 'unavailable') return exact;

  return runSingleQuery<NbaVenueEnvironmentRow>(
    VENUE_ENVIRONMENT_TABLE,
    (query) => query.ilike('venue_name', `%${trimmed}%`).limit(1).maybeSingle(),
    `No qualifying venue environment was found for ${trimmed}.`,
  );
}

async function fetchRefEnvironment(
  leadRef: string | null | undefined,
): Promise<NbaSurfaceResult<NbaRefEnvironmentRow>> {
  const trimmed = leadRef?.trim();
  if (!trimmed) {
    return emptySurface<NbaRefEnvironmentRow>('No lead referee was provided for the context lookup.');
  }

  const exact = await runSingleQuery<NbaRefEnvironmentRow>(
    REF_ENVIRONMENT_TABLE,
    (query) => query.ilike('lead_ref', trimmed).maybeSingle(),
    `No qualifying referee environment was found for ${trimmed}.`,
  );

  if (exact.data || exact.state === 'unavailable') return exact;

  return runSingleQuery<NbaRefEnvironmentRow>(
    REF_ENVIRONMENT_TABLE,
    (query) => query.ilike('lead_ref', `%${trimmed}%`).limit(1).maybeSingle(),
    `No qualifying referee environment was found for ${trimmed}.`,
  );
}

export async function fetchNbaWeeklyContextSeries(
  request: NbaWeeklyContextSeriesRequest = {},
): Promise<NbaCollectionResult<NbaWeeklyContextRow>> {
  const limit = request.limit ?? 8;
  return runListQuery<NbaWeeklyContextRow>(
    WEEKLY_CONTEXT_TABLE,
    (query) => query.order('week_start', { ascending: false }).limit(limit),
    'No qualifying NBA weekly context rows are available yet.',
  );
}

export async function fetchNbaWeeklyContext(
  request: NbaWeeklyContextRequest = {},
): Promise<NbaSurfaceResult<NbaWeeklyContextRow>> {
  const weekStart = startOfIsoWeek(request.asOf);
  return runSingleQuery<NbaWeeklyContextRow>(
    WEEKLY_CONTEXT_TABLE,
    (query) => query.eq('week_start', weekStart).maybeSingle(),
    `No qualifying NBA weekly context exists for the week of ${weekStart}.`,
  );
}

export async function fetchNbaLiveStateContext(
  input: NbaLiveStateLookupInput = {},
): Promise<NbaLiveStateContextBundle> {
  const derived = deriveNbaContextFilters(input);
  const [historical, recentOverlay] = await Promise.all([
    fetchLiveStateForScope('HISTORICAL_BACKBONE', derived),
    fetchLiveStateForScope('RECENT_OVERLAY', derived),
  ]);

  return {
    derived,
    historical,
    recentOverlay,
    primaryScope: pickPrimaryLiveStateSurface(historical, recentOverlay),
  };
}

export async function fetchNbaEnvironmentContext(
  input: NbaEnvironmentLookupInput = {},
): Promise<NbaEnvironmentContextBundle> {
  const [venue, officiating] = await Promise.all([
    fetchVenueEnvironment(input.venueName),
    fetchRefEnvironment(input.leadRef),
  ]);

  return {
    venue,
    officiating,
  };
}

export async function fetchNbaProductContext(
  input: NbaProductContextInput = {},
): Promise<NbaProductContextPayload> {
  const [weekly, liveState, environment] = await Promise.all([
    fetchNbaWeeklyContext({ asOf: input.asOf }),
    fetchNbaLiveStateContext(input),
    fetchNbaEnvironmentContext(input),
  ]);

  return {
    derived: liveState.derived,
    weekly,
    liveState,
    environment,
  };
}

export const nbaContextService = {
  fetchWeeklyContext: fetchNbaWeeklyContext,
  fetchWeeklyContextSeries: fetchNbaWeeklyContextSeries,
  fetchLiveStateContext: fetchNbaLiveStateContext,
  fetchEnvironmentContext: fetchNbaEnvironmentContext,
  fetchProductContext: fetchNbaProductContext,
};

export const __test = {
  bucketDistance,
  pickPrimaryLiveStateSurface,
  selectBestLiveStateCandidate,
  scoreHistoricalCandidate,
  scoreRecentCandidate,
};
