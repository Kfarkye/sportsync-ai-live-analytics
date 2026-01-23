import { useState, useEffect } from 'react';
import { pregameIntelService, PregameIntelResponse } from '../services/pregameIntelService';

export const usePregameIntel = (
    matchId: string,
    homeTeam: string,
    awayTeam: string,
    sport: string,
    league: string,
    startTime?: string
) => {
    const [intel, setIntel] = useState<PregameIntelResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetch = async () => {
        setLoading(true);
        try {
            const result = await pregameIntelService.fetchIntel(
                matchId,
                homeTeam,
                awayTeam,
                sport,
                league,
                startTime
            );
            setIntel(result);
            setError(result ? null : 'Unavailable');
        } catch (e) {
            setError('Connection Error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetch();
    }, [matchId]);

    return {
        intel,
        loading,
        error,
        refresh: fetch,
        clearCache: () => pregameIntelService.clearCache(matchId)
    };
};
