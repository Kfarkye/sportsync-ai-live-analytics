
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CacheResult } from '../services/dbService';

export type DataSource = 'db' | 'api' | 'db-stale' | null;

export interface UseDbFirstResult<T> {
  data: T | null;
  isLoading: boolean;
  isRevalidating: boolean;
  error: string | null;
  source: DataSource;
  retry: (force?: boolean) => void;
}

export const useDbFirst = <T>(
  dbFetch: () => Promise<CacheResult<T> | null>,
  apiFetch: () => Promise<T | null>,
  cacheFn?: (data: T) => Promise<void>,
  dependencies: React.DependencyList = []
): UseDbFirstResult<T> => {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>(null);

  // Use ref to avoid stale closure over `data` state in fetchFromApi
  const dataRef = useRef(data);
  dataRef.current = data;

  const fetchFromApi = useCallback(async () => {
    try {
      const apiData = await apiFetch();
      if (apiData) {
        setData(apiData);
        setSource('api');
        if (cacheFn) {
          // Fire and forget cache update
          cacheFn(apiData).catch(console.error);
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error("API/AI fetch failed:", e);
      if (!dataRef.current) {
        setError((e as Error).message || "An unexpected error occurred.");
      }
      return false;
    }
  }, [apiFetch, cacheFn]);

  const fetchData = useCallback(async (force = false) => {
    setIsLoading(true);
    setError(null);

    // 1. If forced, skip DB and go straight to API
    if (force) {
        const success = await fetchFromApi();
        if (!success) setError("Analysis generation failed.");
        setIsLoading(false);
        return;
    }

    // 2. Try database first
    try {
        const dbResult = await dbFetch();

        if (dbResult) {
          setData(dbResult.data);
          setIsLoading(false);

          if (dbResult.isStale) {
            // 3. Data is stale: Serve it, revalidate in background
            setSource('db-stale');
            setIsRevalidating(true);
            await fetchFromApi();
            setIsRevalidating(false);
          } else {
            // 4. Data is fresh
            setSource('db');
          }
        } else {
          // 5. No cache: Fetch from API (blocking)
          const success = await fetchFromApi();
          if (!success && !error) {
            setError("Data unavailable.");
          }
          setIsLoading(false);
        }
    } catch (e) {
        // Fallback to API if DB fails
        console.warn("DB Fetch failed, falling back to API", e);
        const success = await fetchFromApi();
        if (!success) setError("Data unavailable.");
        setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbFetch, fetchFromApi, ...dependencies]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, isRevalidating, error, source, retry: fetchData };
};
