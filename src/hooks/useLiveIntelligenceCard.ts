import { useQuery } from "@tanstack/react-query";
import type { Match } from "@/types";
import { isGameInProgress } from "@/utils/matchUtils";
import {
  computeLiveIntelligenceQueryKey,
  fetchLiveIntelligenceCard,
  type LiveIntelligenceResponse,
} from "@/services/liveIntelligenceService";

const REFRESH_MS = 30_000;

export function useLiveIntelligenceCard(match: Match) {
  const isLive = isGameInProgress(match.status);
  const key = computeLiveIntelligenceQueryKey(match);

  return useQuery<LiveIntelligenceResponse>({
    queryKey: ["live-intelligence-card", match.id, key],
    queryFn: () => fetchLiveIntelligenceCard(match),
    enabled: Boolean(match?.id) && isLive,
    staleTime: REFRESH_MS,
    gcTime: REFRESH_MS * 2,
    refetchOnWindowFocus: false,
    refetchInterval: isLive ? REFRESH_MS : false,
  });
}

