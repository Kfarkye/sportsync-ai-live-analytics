
import { supabase } from '../lib/supabase';
import { Sport } from '../types';

export interface PropBet {
    label: string;     
    line: number;      
    overPrice: string; 
    underPrice: string;
    bookmaker: string; 
}

export const fetchOddsApiProps = async (
    sport: Sport, 
    homeTeamName: string, 
    awayTeamName: string
): Promise<Record<string, PropBet>> => {
    try {
        // --- SECURE CALL TO EDGE FUNCTION ---
        const { data, error } = await supabase.functions.invoke('get-odds', {
            body: { 
                sport, 
                homeTeam: homeTeamName, 
                awayTeam: awayTeamName 
            }
        });

        if (error) {
            console.warn('Supabase Edge Function Error:', error);
            return {};
        }

        // The Edge Function returns the fully processed map
        return data || {};

    } catch (e) {
        console.error('Error invoking get-odds:', e);
        return {};
    }
};
