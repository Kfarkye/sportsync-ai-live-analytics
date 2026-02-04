
import { supabase } from '../lib/supabase';

export interface ContextData {
  oddsHistory?: {
    open: unknown;
    current: unknown;
  };
  schedule?: {
    home: unknown;
    away: unknown;
  };
}

export const fetchMatchContext = async (matchId: string, homeTeamId: string, awayTeamId: string): Promise<ContextData> => {
  try {
    // Parallel fetch for odds history and schedule context
    const [oddsRes, scheduleRes] = await Promise.all([
      supabase
        .from('odds_history')
        .select('*')
        .eq('game_id', matchId)
        .order('recorded_at', { ascending: true }),
      
      supabase
        .from('team_schedule_context')
        .select('*')
        .eq('game_id', matchId)
        .in('team_id', [homeTeamId, awayTeamId])
    ]);

    // Process Odds History
    let oddsHistory = undefined;
    if (oddsRes.data && oddsRes.data.length > 0) {
      const open = oddsRes.data[0];
      const current = oddsRes.data[oddsRes.data.length - 1];
      oddsHistory = { open, current };
    }

    // Process Schedule
    let schedule = undefined;
    if (scheduleRes.data && scheduleRes.data.length > 0) {
      const home = scheduleRes.data.find(d => d.team_id === homeTeamId);
      const away = scheduleRes.data.find(d => d.team_id === awayTeamId);
      schedule = { home, away };
    }

    return { oddsHistory, schedule };
  } catch (e) {
    console.warn('[ContextService] Failed to fetch match context:', e);
    return {};
  }
};
