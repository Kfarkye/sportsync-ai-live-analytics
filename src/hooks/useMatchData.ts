// hooks/useMatchData.ts (paste-and-go)
import { useEffect, useMemo, useRef, useState } from "react";
import { League, Match, MatchStatus } from "../types";
import { supabase } from "../lib/supabase";
import { fetchAllMatches } from "../services/espnService";

type UseMatchDataResult = {
  matches: Match[];
  isLoading: boolean;
  isValidating: boolean;
  error: string | null;
  refetch: () => void;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const toLocalDateKey = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const isLiveStatus = (s: unknown) =>
  s === MatchStatus.LIVE ||
  s === MatchStatus.HALFTIME ||
  s === "LIVE" ||
  s === "HALFTIME";

const computePollMs = (dateKey: string, todayKey: string, hasLive: boolean) => {
  // Past dates: no polling
  if (dateKey < todayKey) return 0;

  // Future dates: slow poll (odds can move, but not worth hammering)
  if (dateKey > todayKey) return 300_000; // 5 min

  // Today:
  if (hasLive) return 15_000; // 15s during live games
  return 60_000; // 60s otherwise
};

export const useMatchData = (leagues: League[], date: Date): UseMatchDataResult => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Stable keys (prevents unnecessary refetch when parent re-creates arrays)
  const leaguesKey = useMemo(() => {
    const ids = (leagues || []).map((l) => l.id).sort();
    return ids.join(",");
  }, [leagues]);

  const dateKey = useMemo(() => toLocalDateKey(date), [date]);
  const todayKey = useMemo(() => toLocalDateKey(new Date()), []); // computed once per mount

  // Refs to control races / overlapping polls
  const mountedRef = useRef<boolean>(false);
  const requestSeqRef = useRef<number>(0);
  const pollTimerRef = useRef<number | null>(null);
  const lastHasLiveRef = useRef<boolean>(false);

  const clearPoll = () => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const scheduleNextPoll = (ms: number, fn: () => void) => {
    clearPoll();
    if (ms <= 0) return;
    pollTimerRef.current = window.setTimeout(fn, ms);
  };

  const setDataSafely = (seq: number, next: Match[], nextError: string | null) => {
    // Only the latest request is allowed to update state
    if (!mountedRef.current) return;
    if (seq !== requestSeqRef.current) return;

    setMatches((prev) => {
      if (!Array.isArray(next)) return [];

      // PERSISTENCE ENGINE: Merge previous AI signals to maintain "Divergence Duration"
      return next.map(newM => {
        const oldM = prev.find(om => om.id === newM.id);
        if (oldM?.ai_signals) {
          return {
            ...newM,
            ai_signals: oldM.ai_signals // Carry over previous signals as a "prior"
          };
        }
        return newM;
      });
    });
    setError(nextError);
  };

  const fetchFromEdge = async (dateStr: string, seq: number): Promise<Match[]> => {
    // NOTE: If you later switch Edge payload to `leagueIds`, do it here only.
    const { data, error: edgeError } = await supabase.functions.invoke("fetch-matches", {
      body: {
        date: dateStr,
        leagues, // keep current contract
        oddsSportKey: "all",
      },
    });

    if (edgeError) throw edgeError;
    if (!Array.isArray(data)) throw new Error("Invalid data format from Edge");

    // Attach fetched_at timestamp for stale quote detection
    const fetchedTime = Date.now();
    return (data as Match[]).map(m => ({
      ...m,
      fetched_at: fetchedTime
    }));
  };

  const fetchWithFallback = async (mode: "initial" | "refresh" | "visible") => {
    const seq = ++requestSeqRef.current;

    // Loading semantics:
    // - initial: show skeleton
    // - refresh/visible: keep UI, show subtle validating state
    if (mode === "initial") {
      setIsLoading(true);
      setIsValidating(false);
    } else {
      setIsValidating(true);
    }
    setError(null);

    try {
      const dateStr = dateKey; // already local YYYY-MM-DD

      // 1) Edge (scores + odds)
      const edgeMatches = await fetchFromEdge(dateStr, seq);
      setDataSafely(seq, edgeMatches, null);

      const hasLive = edgeMatches.some((m) => isLiveStatus((m as any)?.status));
      lastHasLiveRef.current = hasLive;

      // Dynamic polling based on today/future/past and whether anything is live
      const pollMs = computePollMs(dateKey, todayKey, hasLive);
      scheduleNextPoll(pollMs, () => {
        if (!document.hidden) fetchWithFallback("refresh");
        else scheduleNextPoll(pollMs, () => fetchWithFallback("refresh")); // self-heal
      });
    } catch (e: unknown) {
      // 2) Fallback to client-side ESPN scores only
      try {
        const fallback = await fetchAllMatches(leagues, date);
        setDataSafely(seq, fallback, null);

        const hasLive = (fallback || []).some((m) => isLiveStatus((m as any)?.status));
        lastHasLiveRef.current = hasLive;

        const pollMs = computePollMs(dateKey, todayKey, hasLive);
        scheduleNextPoll(pollMs, () => {
          if (!document.hidden) fetchWithFallback("refresh");
          else scheduleNextPoll(pollMs, () => fetchWithFallback("refresh"));
        });
      } catch (fallbackError) {
        setDataSafely(seq, [], "Failed to load match data.");
        // Backoff on total failure
        const backoffMs = 120_000;
        scheduleNextPoll(backoffMs, () => {
          if (!document.hidden) fetchWithFallback("refresh");
        });
      }
    } finally {
      if (!mountedRef.current) return;
      if (mode === "initial") setIsLoading(false);
      setIsValidating(false);
    }
  };

  // Manual refetch API (useful for pull-to-refresh / retry button)
  const refetch = () => {
    if (!mountedRef.current) return;
    fetchWithFallback("refresh");
  };

  useEffect(() => {
    mountedRef.current = true;

    // Initial load
    fetchWithFallback("initial");

    // Visibility-triggered refresh (instant catch-up when tab becomes active)
    const onVis = () => {
      if (!document.hidden) fetchWithFallback("visible");
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      mountedRef.current = false;
      clearPoll();
      document.removeEventListener("visibilitychange", onVis);
    };
    // leaguesKey ensures we refetch if leagues genuinely change
    // dateKey ensures we refetch when the selected day changes
  }, [dateKey, leaguesKey]);

  return {
    matches: matches || [],
    isLoading,
    isValidating,
    error,
    refetch,
  };
};

