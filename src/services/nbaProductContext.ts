import {
  deriveNbaContextFilters,
  fetchNbaProductContext,
  type NbaContextScope,
  type NbaDerivedContextFilters,
  type NbaExposureTier,
  type NbaLiveStateContextBundle,
  type NbaLiveStateContextRow,
  type NbaProductContextInput,
  type NbaProductContextPayload,
  type NbaRefEnvironmentRow,
  type NbaSurfaceReason,
  type NbaSurfaceResult,
  type NbaSurfaceState,
  type NbaVenueEnvironmentRow,
  type NbaWeeklyContextRow,
} from '@/services/nbaContextService';

export type NbaProductContextSectionStatus = 'ready' | 'suppressed' | 'unavailable';
export type NbaProductContextSectionReason =
  | NbaSurfaceReason
  | 'suppressed_limited_sample'
  | 'supplement_only'
  | 'missing_inputs';

export interface NbaProductContextPolicy {
  minExposureTier: 'READY';
  suppressLimitedSamples: true;
  preferHistoricalBackbone: true;
  allowRecentOverlaySupplement: true;
}

export interface NbaProductContextSample {
  games: number | null;
  matches: number | null;
  rows: number | null;
  minGames: number | null;
  minMatches: number | null;
  minRows: number | null;
}

export interface NbaProductContextSupplement {
  label: string;
  summary: string;
  sampleLabel: string | null;
  scope: NbaContextScope;
  exposureTier: NbaExposureTier;
  sample: NbaProductContextSample;
}

export interface NbaProductContextSection {
  label: string;
  available: boolean;
  status: NbaProductContextSectionStatus;
  reason: NbaProductContextSectionReason;
  scope: 'SEASON' | 'ENVIRONMENT' | NbaContextScope | null;
  surfaceState: NbaSurfaceState;
  exposureTier: NbaExposureTier | null;
  summary: string | null;
  detail: string | null;
  sampleLabel: string | null;
  sample: NbaProductContextSample;
  matchStrategy: string | null;
  facts: string[];
  supplement: NbaProductContextSupplement | null;
}

export interface NbaProductContextPacket {
  generatedAt: string;
  policy: NbaProductContextPolicy;
  lookup: NbaDerivedContextFilters;
  availability: {
    seasonContext: boolean;
    liveStateContext: boolean;
    environmentContext: boolean;
    recentOverlaySupplement: boolean;
  };
  seasonContext: NbaProductContextSection;
  liveStateContext: NbaProductContextSection;
  environmentContext: NbaProductContextSection;
}

export const NBA_PRODUCT_CONTEXT_POLICY: NbaProductContextPolicy = {
  minExposureTier: 'READY',
  suppressLimitedSamples: true,
  preferHistoricalBackbone: true,
  allowRecentOverlaySupplement: true,
};

const UNAVAILABLE_CONTEXT_MESSAGE = 'NBA context is unavailable for this environment right now.';

function formatSigned(value: number | null | undefined, digits = 1): string | null {
  if (!Number.isFinite(value)) return null;
  const normalized = Number(value);
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(digits)}`;
}

function formatPercent(value: number | null | undefined, digits = 1): string | null {
  if (!Number.isFinite(value)) return null;
  return `${Number(value).toFixed(digits)}%`;
}

function pluralize(value: number | null | undefined, singular: string, plural = `${singular}s`): string | null {
  if (!Number.isFinite(value)) return null;
  const normalized = Number(value);
  return `${normalized} ${normalized === 1 ? singular : plural}`;
}

function joinSentence(parts: Array<string | null | undefined>): string | null {
  const normalized = parts
    .map((part) => (typeof part === 'string' ? part.trim() : null))
    .filter((part): part is string => Boolean(part));
  if (!normalized.length) return null;
  return normalized.join(' ');
}

function buildGamesSample(games: number | null, minGames: number | null): NbaProductContextSample {
  return {
    games,
    matches: null,
    rows: null,
    minGames,
    minMatches: null,
    minRows: null,
  };
}

function buildRowsSample(
  rows: number | null,
  matches: number | null,
  minRows: number | null,
  minMatches: number | null,
): NbaProductContextSample {
  return {
    games: null,
    matches,
    rows,
    minGames: null,
    minMatches,
    minRows,
  };
}

function buildSampleLabel(sample: NbaProductContextSample): string | null {
  if (Number.isFinite(sample.rows) && Number.isFinite(sample.matches)) {
    return `${sample.rows} rows across ${sample.matches} matches`;
  }
  if (Number.isFinite(sample.games)) {
    return pluralize(sample.games, 'game');
  }
  if (Number.isFinite(sample.matches)) {
    return pluralize(sample.matches, 'match');
  }
  return null;
}

function productVisible<T>(surface: NbaSurfaceResult<T> | null | undefined): boolean {
  return Boolean(surface?.data && surface.state === 'ready' && surface.reason === 'ok');
}

function sectionReasonFromSurface<T>(surface: NbaSurfaceResult<T> | null | undefined): NbaProductContextSectionReason {
  if (!surface) return 'missing_inputs';
  if (surface.state === 'limited') return 'suppressed_limited_sample';
  return surface.reason;
}

function sectionStatusFromSurface<T>(
  surface: NbaSurfaceResult<T> | null | undefined,
  visible: boolean,
): NbaProductContextSectionStatus {
  if (visible) return 'ready';
  if (!surface || surface.state === 'unavailable') return 'unavailable';
  return 'suppressed';
}

function getPrimaryHistoricalRow(bundle: NbaLiveStateContextBundle): NbaLiveStateContextRow | null {
  return productVisible(bundle.historical) ? bundle.historical.data : null;
}

function getRecentOverlayRow(bundle: NbaLiveStateContextBundle): NbaLiveStateContextRow | null {
  const historicalVisible = productVisible(bundle.historical);
  if (!NBA_PRODUCT_CONTEXT_POLICY.allowRecentOverlaySupplement || !historicalVisible) return null;
  return productVisible(bundle.recentOverlay) ? bundle.recentOverlay.data : null;
}

function buildSectionBase(
  label: string,
  surfaceState: NbaSurfaceState,
  exposureTier: NbaExposureTier | null,
  reason: NbaProductContextSectionReason,
  status: NbaProductContextSectionStatus,
  scope: NbaProductContextSection['scope'],
  sample: NbaProductContextSample,
  matchStrategy: string | null,
): NbaProductContextSection {
  return {
    label,
    available: status === 'ready',
    status,
    reason,
    scope,
    surfaceState,
    exposureTier,
    summary: null,
    detail: null,
    sampleLabel: buildSampleLabel(sample),
    sample,
    matchStrategy,
    facts: [],
    supplement: null,
  };
}

function buildUnavailableSection(
  label: string,
  scope: NbaProductContextSection['scope'],
  reason: NbaProductContextSectionReason,
  detail: string | null,
): NbaProductContextSection {
  const section = buildSectionBase(
    label,
    'unavailable',
    null,
    reason,
    'unavailable',
    scope,
    {
      games: null,
      matches: null,
      rows: null,
      minGames: null,
      minMatches: null,
      minRows: null,
    },
    null,
  );
  section.detail = detail;
  return section;
}

function buildSeasonSection(payload: NbaProductContextPayload): NbaProductContextSection {
  const label = 'This point in the season';
  const surface = payload.weekly;
  const row = productVisible(surface) ? surface.data : null;
  const sample = buildGamesSample(row?.games ?? surface.data?.games ?? null, surface.data?.min_games_threshold ?? null);
  const section = buildSectionBase(
    label,
    surface.state,
    surface.data?.exposure_tier ?? null,
    sectionReasonFromSurface(surface),
    sectionStatusFromSurface(surface, Boolean(row)),
    'SEASON',
    sample,
    surface.matchStrategy,
  );

  if (!row) {
    section.detail = surface.message;
    return section;
  }

  const totalResidual = formatSigned(row.avg_total_residual_points, 1);
  const blowoutRate = formatPercent(row.blowout_rate_pct, 1);
  const paceDelta = formatSigned(row.pace_delta_vs_season, 1);
  const foulDelta = formatSigned(row.foul_delta_vs_season, 1);

  section.summary = joinSentence([
    `Week ${row.week_of_season} has run ${totalResidual ?? 'near even'} against anchor totals across ${row.games} games.`,
  ]);
  section.detail = joinSentence([
    blowoutRate ? `Blowout rate is ${blowoutRate}.` : null,
    paceDelta ? `Pace is ${paceDelta} versus the season baseline.` : null,
    foulDelta ? `Combined fouls are ${foulDelta} versus baseline.` : null,
  ]);
  section.facts = [
    `Total environment: ${row.total_environment_tag}`,
    `Pace environment: ${row.pace_environment_tag}`,
    blowoutRate ? `Blowout rate ${blowoutRate}` : null,
    row.win_brier_market !== null ? `Market win Brier ${row.win_brier_market}` : null,
  ].filter((fact): fact is string => Boolean(fact));
  return section;
}

function buildLiveStateSupplement(row: NbaLiveStateContextRow): NbaProductContextSupplement {
  const totalResidual = formatSigned(row.avg_total_residual_points, 1);
  const pace = formatSigned(row.avg_estimated_pace, 1);

  return {
    label: 'Recent overlay',
    summary:
      joinSentence([
        `Recent overlay in similar ${row.overlay_period_key !== 'NA' ? `period ${row.overlay_period_key}` : 'live'} states`,
        totalResidual ? `has run ${totalResidual} points versus anchor totals.` : null,
        pace ? `Estimated pace sits at ${pace}.` : null,
      ]) ?? 'Recent overlay is available.',
    sampleLabel: buildSampleLabel(
      buildRowsSample(row.rows, row.matches, row.min_rows_threshold, row.min_matches_threshold),
    ),
    scope: row.context_scope,
    exposureTier: row.exposure_tier,
    sample: buildRowsSample(row.rows, row.matches, row.min_rows_threshold, row.min_matches_threshold),
  };
}

function buildLiveStateSection(payload: NbaProductContextPayload): NbaProductContextSection {
  const label = 'How games like this usually finish';
  const primaryRow = getPrimaryHistoricalRow(payload.liveState);
  const primarySurface = payload.liveState.historical;
  const sample = buildRowsSample(
    primaryRow?.rows ?? primarySurface.data?.rows ?? null,
    primaryRow?.matches ?? primarySurface.data?.matches ?? null,
    primarySurface.data?.min_rows_threshold ?? null,
    primarySurface.data?.min_matches_threshold ?? null,
  );
  const section = buildSectionBase(
    label,
    primarySurface.state,
    primarySurface.data?.exposure_tier ?? null,
    sectionReasonFromSurface(primarySurface),
    sectionStatusFromSurface(primarySurface, Boolean(primaryRow)),
    primaryRow?.context_scope ?? 'HISTORICAL_BACKBONE',
    sample,
    primarySurface.matchStrategy,
  );

  if (!primaryRow) {
    section.detail = primarySurface.message;
    if (productVisible(payload.liveState.recentOverlay) && !productVisible(primarySurface)) {
      section.reason = 'supplement_only';
    }
    return section;
  }

  const homeWinRate = formatPercent(primaryRow.actual_home_win_pct, 1);
  const totalResidual = formatSigned(primaryRow.avg_total_residual_points, 1);
  const falseCertainty = formatPercent(primaryRow.false_certainty_rate_pct, 1);
  const espnGap = formatSigned(primaryRow.espn_home_calibration_gap_pp, 1);

  section.summary = joinSentence([
    homeWinRate
      ? `Similar states have produced a ${homeWinRate} home win rate across ${primaryRow.rows} rows and ${primaryRow.matches} matches.`
      : `Similar historical states are available across ${primaryRow.rows} rows and ${primaryRow.matches} matches.`,
  ]);
  section.detail = joinSentence([
    totalResidual ? `Those games have run ${totalResidual} points versus anchor totals.` : null,
    espnGap ? `ESPN home-win calibration has been ${espnGap} percentage points in this bucket.` : null,
    falseCertainty ? `False certainty has shown up ${falseCertainty} of the time.` : null,
  ]);
  section.facts = [
    `Progress bucket ${primaryRow.progress_bucket}`,
    `Home-win bucket ${primaryRow.home_win_prob_bucket}`,
    `Total-over bucket ${primaryRow.total_over_prob_bucket}`,
    totalResidual ? `Total residual ${totalResidual}` : null,
    falseCertainty ? `False certainty ${falseCertainty}` : null,
  ].filter((fact): fact is string => Boolean(fact));

  const supplementRow = getRecentOverlayRow(payload.liveState);
  if (supplementRow) {
    section.supplement = buildLiveStateSupplement(supplementRow);
  }

  return section;
}

function buildEnvironmentSummary(
  venueRow: NbaVenueEnvironmentRow | null,
  refRow: NbaRefEnvironmentRow | null,
): { summary: string | null; detail: string | null; facts: string[] } {
  const venueResidual = formatSigned(venueRow?.avg_total_residual_points, 1);
  const venuePace = formatSigned(venueRow?.pace_delta_vs_baseline, 1);
  const refPace = formatSigned(refRow?.pace_delta_vs_baseline, 1);
  const refFouls = formatSigned(refRow?.foul_delta_vs_baseline, 1);

  const summary = joinSentence([
    venueRow && venueResidual
      ? `This venue has run ${venueResidual} points versus anchor totals.`
      : venueRow
        ? `This venue has a qualified environment sample.`
        : null,
    refRow && (refPace || refFouls)
      ? `The lead crew trends ${refPace ? `${refPace} in pace` : 'near baseline pace'}${refFouls ? ` and ${refFouls} in fouls` : ''}.`
      : refRow
        ? `The lead crew has a qualified environment sample.`
        : null,
  ]);
  const detail = joinSentence([
    venuePace ? `Venue pace sits ${venuePace} versus baseline.` : null,
    venueRow?.variance_environment_tag ? `Venue variance is ${venueRow.variance_environment_tag}.` : null,
    refRow?.variance_environment_tag ? `Crew variance is ${refRow.variance_environment_tag}.` : null,
  ]);
  const facts = [
    venueRow?.venue_name ? `Venue ${venueRow.venue_name}` : null,
    venueResidual ? `Venue total residual ${venueResidual}` : null,
    refRow?.lead_ref ? `Lead ref ${refRow.lead_ref}` : null,
    refFouls ? `Ref foul delta ${refFouls}` : null,
    refPace ? `Ref pace delta ${refPace}` : null,
  ].filter((fact): fact is string => Boolean(fact));

  return { summary, detail, facts };
}

function buildEnvironmentSection(payload: NbaProductContextPayload): NbaProductContextSection {
  const label = 'What kind of game this tends to become';
  const venueRow = productVisible(payload.environment.venue) ? payload.environment.venue.data : null;
  const refRow = productVisible(payload.environment.officiating) ? payload.environment.officiating.data : null;
  const visible = Boolean(venueRow || refRow);

  const sample: NbaProductContextSample = {
    games: venueRow?.games ?? refRow?.games ?? payload.environment.venue.data?.games ?? payload.environment.officiating.data?.games ?? null,
    matches: null,
    rows: null,
    minGames:
      venueRow?.min_games_threshold ??
      refRow?.min_games_threshold ??
      payload.environment.venue.data?.min_games_threshold ??
      payload.environment.officiating.data?.min_games_threshold ??
      null,
    minMatches: null,
    minRows: null,
  };

  const surfaceState: NbaSurfaceState =
    payload.environment.venue.state === 'ready' || payload.environment.officiating.state === 'ready'
      ? 'ready'
      : payload.environment.venue.state === 'limited' || payload.environment.officiating.state === 'limited'
        ? 'limited'
        : payload.environment.venue.state === 'unavailable' && payload.environment.officiating.state === 'unavailable'
          ? 'unavailable'
          : 'empty';
  const reason: NbaProductContextSectionReason =
    visible
      ? 'ok'
      : payload.environment.venue.state === 'limited' || payload.environment.officiating.state === 'limited'
        ? 'suppressed_limited_sample'
        : payload.environment.venue.reason === 'missing_relation' && payload.environment.officiating.reason === 'missing_relation'
          ? 'missing_relation'
          : payload.environment.venue.reason === 'query_failed' || payload.environment.officiating.reason === 'query_failed'
            ? 'query_failed'
            : 'no_qualifying_sample';
  const status: NbaProductContextSectionStatus =
    visible ? 'ready' : surfaceState === 'unavailable' ? 'unavailable' : 'suppressed';

  const section = buildSectionBase(
    label,
    surfaceState,
    venueRow?.exposure_tier ?? refRow?.exposure_tier ?? null,
    reason,
    status,
    'ENVIRONMENT',
    sample,
    null,
  );

  if (!visible) {
    section.detail =
      payload.environment.venue.message ||
      payload.environment.officiating.message ||
      'No qualified venue or officiating environment is available yet.';
    return section;
  }

  const { summary, detail, facts } = buildEnvironmentSummary(venueRow, refRow);
  section.summary = summary;
  section.detail = detail;
  section.facts = facts;
  return section;
}

export function buildNbaProductContextPacket(payload: NbaProductContextPayload): NbaProductContextPacket {
  const seasonContext = buildSeasonSection(payload);
  const liveStateContext = buildLiveStateSection(payload);
  const environmentContext = buildEnvironmentSection(payload);

  return {
    generatedAt: new Date().toISOString(),
    policy: NBA_PRODUCT_CONTEXT_POLICY,
    lookup: payload.derived,
    availability: {
      seasonContext: seasonContext.available,
      liveStateContext: liveStateContext.available,
      environmentContext: environmentContext.available,
      recentOverlaySupplement: Boolean(liveStateContext.supplement),
    },
    seasonContext,
    liveStateContext,
    environmentContext,
  };
}

export function buildUnavailableNbaProductContextPacket(
  lookup: NbaDerivedContextFilters,
  reason: NbaProductContextSectionReason = 'query_failed',
  detail: string | null = UNAVAILABLE_CONTEXT_MESSAGE,
): NbaProductContextPacket {
  const seasonContext = buildUnavailableSection(
    'This point in the season',
    'SEASON',
    reason,
    detail,
  );
  const liveStateContext = buildUnavailableSection(
    'How games like this usually finish',
    'HISTORICAL_BACKBONE',
    reason,
    detail,
  );
  const environmentContext = buildUnavailableSection(
    'What kind of game this tends to become',
    'ENVIRONMENT',
    reason,
    detail,
  );

  return {
    generatedAt: new Date().toISOString(),
    policy: NBA_PRODUCT_CONTEXT_POLICY,
    lookup,
    availability: {
      seasonContext: false,
      liveStateContext: false,
      environmentContext: false,
      recentOverlaySupplement: false,
    },
    seasonContext,
    liveStateContext,
    environmentContext,
  };
}

export async function fetchNbaProductContextPacket(
  input: NbaProductContextInput = {},
): Promise<NbaProductContextPacket> {
  try {
    const payload = await fetchNbaProductContext(input);
    return buildNbaProductContextPacket(payload);
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : UNAVAILABLE_CONTEXT_MESSAGE;
    return buildUnavailableNbaProductContextPacket(
      deriveNbaContextFilters(input),
      'query_failed',
      detail,
    );
  }
}

export const nbaProductContextService = {
  fetchPacket: fetchNbaProductContextPacket,
  buildPacket: buildNbaProductContextPacket,
};

export const __test = {
  buildEnvironmentSection,
  buildLiveStateSection,
  buildSeasonSection,
};
