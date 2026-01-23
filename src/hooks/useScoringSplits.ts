
import { useState, useEffect } from 'react';
import { ScoringSplitsResponse, SortOption, SortOrder } from '../types/venue';
import { supabase } from '../lib/supabase';

interface UseScoringSplitsProps {
  leagueId: string;
  season?: string;
  sortBy?: SortOption;
  sortOrder?: SortOrder;
  limit?: number;
}

export const useScoringSplits = ({
  leagueId,
  season, // Optional: if undefined, backend picks current
  sortBy = 'delta',
  sortOrder = 'desc',
  limit = 50
}: UseScoringSplitsProps) => {
  const [data, setData] = useState<ScoringSplitsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchSplits = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Invoke the Supabase Edge Function
        // We use POST to easily send the configuration body
        const { data: responseData, error: responseError } = await supabase.functions.invoke('team-scoring-splits', {
          body: {
            league_id: leagueId,
            season,
            sort_by: sortBy,
            sort_order: sortOrder,
            limit
          },
          method: 'POST'
        });

        if (responseError) throw responseError;

        if (isMounted) {
          setData(responseData);
        }

      } catch (err: any) {
        console.error('Failed to fetch scoring splits:', err);
        if (isMounted) {
          setError(err.message || 'Failed to load real-time splits.');
          // We do NOT fall back to fallback data here to ensure "Real Data" integrity.
          // If the API fails, the UI will show the error state.
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchSplits();

    return () => { isMounted = false; };
  }, [leagueId, season, sortBy, sortOrder, limit]);

  return { data, isLoading, error };
};
