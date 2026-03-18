import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  deriveNbaContextFilters,
  fetchNbaEnvironmentContext,
  fetchNbaLiveStateContext,
  fetchNbaProductContext,
  fetchNbaWeeklyContext,
  fetchNbaWeeklyContextSeries,
  type NbaEnvironmentLookupInput,
  type NbaLiveStateLookupInput,
  type NbaProductContextInput,
  type NbaWeeklyContextRequest,
  type NbaWeeklyContextSeriesRequest,
} from '@/services/nbaContextService';
import {
  buildUnavailableNbaProductContextPacket,
  fetchNbaProductContextPacket,
  type NbaProductContextPacket,
} from '@/services/nbaProductContext';

const TEN_MINUTES = 1000 * 60 * 10;
const FIFTEEN_MINUTES = 1000 * 60 * 15;
const THIRTY_MINUTES = 1000 * 60 * 30;

function normalizeDateKey(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function normalizeEnvironmentKey(input: NbaEnvironmentLookupInput = {}) {
  return {
    venueName: input.venueName?.trim() || null,
    leadRef: input.leadRef?.trim() || null,
  };
}

function normalizeQueryErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'NBA context packet query failed.';
}

export function useNbaWeeklyContext(request: NbaWeeklyContextRequest = {}) {
  const asOfKey = normalizeDateKey(request.asOf);

  return useQuery({
    queryKey: ['nba-context', 'weekly', asOfKey],
    queryFn: () => fetchNbaWeeklyContext(request),
    staleTime: FIFTEEN_MINUTES,
    gcTime: THIRTY_MINUTES,
    refetchOnWindowFocus: false,
  });
}

export function useNbaWeeklyContextSeries(request: NbaWeeklyContextSeriesRequest = {}) {
  const limit = request.limit ?? 8;

  return useQuery({
    queryKey: ['nba-context', 'weekly-series', limit],
    queryFn: () => fetchNbaWeeklyContextSeries(request),
    staleTime: THIRTY_MINUTES,
    gcTime: THIRTY_MINUTES,
    refetchOnWindowFocus: false,
  });
}

export function useNbaLiveStateContext(input: NbaLiveStateLookupInput = {}) {
  const derivedKey = useMemo(() => deriveNbaContextFilters(input), [
    normalizeDateKey(input.asOf),
    input.progressFraction ?? null,
    input.homeWinProb ?? null,
    input.totalOverProb ?? null,
    input.period ?? null,
    input.clock ?? null,
    input.homeScore ?? null,
    input.awayScore ?? null,
    input.homeBonusState ?? null,
    input.awayBonusState ?? null,
  ]);

  return useQuery({
    queryKey: ['nba-context', 'live-state', derivedKey],
    queryFn: () => fetchNbaLiveStateContext(input),
    staleTime: TEN_MINUTES,
    gcTime: FIFTEEN_MINUTES,
    refetchOnWindowFocus: false,
  });
}

export function useNbaEnvironmentContext(input: NbaEnvironmentLookupInput = {}) {
  const normalizedKey = normalizeEnvironmentKey(input);

  return useQuery({
    queryKey: ['nba-context', 'environment', normalizedKey],
    queryFn: () => fetchNbaEnvironmentContext(input),
    staleTime: THIRTY_MINUTES,
    gcTime: THIRTY_MINUTES,
    refetchOnWindowFocus: false,
  });
}

export function useNbaProductContext(input: NbaProductContextInput = {}) {
  const derivedKey = useMemo(
    () => ({
      ...deriveNbaContextFilters(input),
      ...normalizeEnvironmentKey(input),
    }),
    [
      normalizeDateKey(input.asOf),
      input.progressFraction ?? null,
      input.homeWinProb ?? null,
      input.totalOverProb ?? null,
      input.period ?? null,
      input.clock ?? null,
      input.homeScore ?? null,
      input.awayScore ?? null,
      input.homeBonusState ?? null,
      input.awayBonusState ?? null,
      input.venueName ?? null,
      input.leadRef ?? null,
    ],
  );

  return useQuery({
    queryKey: ['nba-context', 'product', derivedKey],
    queryFn: () => fetchNbaProductContext(input),
    staleTime: TEN_MINUTES,
    gcTime: FIFTEEN_MINUTES,
    refetchOnWindowFocus: false,
  });
}

export function useNbaProductContextPacket(
  input: NbaProductContextInput = {},
  options: { enabled?: boolean } = {},
) {
  const lookup = useMemo(() => deriveNbaContextFilters(input), [
    normalizeDateKey(input.asOf),
    input.progressFraction ?? null,
    input.homeWinProb ?? null,
    input.totalOverProb ?? null,
    input.period ?? null,
    input.clock ?? null,
    input.homeScore ?? null,
    input.awayScore ?? null,
    input.homeBonusState ?? null,
    input.awayBonusState ?? null,
  ]);

  const derivedKey = useMemo(
    () => ({
      ...lookup,
      ...normalizeEnvironmentKey(input),
    }),
    [
      lookup,
      input.venueName ?? null,
      input.leadRef ?? null,
    ],
  );

  const placeholderPacket = useMemo(
    () => buildUnavailableNbaProductContextPacket(
      lookup,
      'missing_inputs',
      'NBA context is loading for this game state.',
    ),
    [lookup],
  );

  return useQuery<NbaProductContextPacket>({
    queryKey: ['nba-context', 'product-packet', derivedKey],
    queryFn: async () => {
      try {
        return await fetchNbaProductContextPacket(input);
      } catch (error) {
        return buildUnavailableNbaProductContextPacket(
          lookup,
          'query_failed',
          normalizeQueryErrorMessage(error),
        );
      }
    },
    placeholderData: placeholderPacket,
    enabled: options.enabled ?? true,
    staleTime: TEN_MINUTES,
    gcTime: FIFTEEN_MINUTES,
    refetchOnWindowFocus: false,
  });
}
