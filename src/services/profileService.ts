import { supabase } from '../lib/supabase';

export interface TeamProfile {
    team_id: string;
    league_id: string;
    q4_pace_delta: number;
    q4_efficiency_delta: number;
    q4_defensive_delta: number;
    meta_notes: string;
    last_audited_at: string;
    updated_at: string;
}

/**
 * Fetches institutional team profiles for a set of team IDs.
 */
export async function getTeamProfiles(teamIds: string[]): Promise<TeamProfile[]> {
    const { data, error } = await supabase
        .from('institutional_team_profiles')
        .select('*')
        .in('team_id', teamIds.map(id => id.toUpperCase()));

    if (error) {
        console.error('[ProfileService] Error fetching profiles:', error);
        return [];
    }

    return data || [];
}

/**
 * Upserts a team profile with new forensic data or notes.
 */
export async function upsertTeamProfile(profile: Partial<TeamProfile> & { team_id: string; league_id: string }) {
    const { data, error } = await supabase
        .from('institutional_team_profiles')
        .upsert({
            ...profile,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) {
        console.error('[ProfileService] Error upserting profile:', error);
        throw error;
    }

    return data;
}

/**
 * Updates only the meta notes for a team.
 */
export async function updateTeamNotes(teamId: string, notes: string) {
    const { data, error } = await supabase
        .from('institutional_team_profiles')
        .update({ meta_notes: notes, updated_at: new Date().toISOString() })
        .eq('team_id', teamId.toUpperCase())
        .select()
        .single();

    if (error) {
        console.error('[ProfileService] Error updating team notes:', error);
        throw error;
    }

    return data;
}
