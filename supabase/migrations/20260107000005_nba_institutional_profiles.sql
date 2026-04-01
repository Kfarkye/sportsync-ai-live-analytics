-- NBA 2025-26 Institutional Profiles (MEM & DEN)
-- Forensic grounding for AI analysis of pace and efficiency.

INSERT INTO public.institutional_team_profiles 
(team_id, league_id, q4_pace_delta, q4_efficiency_delta, q4_defensive_delta, meta_notes)
VALUES 
(
    'MEM', 
    'nba', 
    -1.12, 
    -0.45, 
    -0.85, 
    'Institutional Lockdown Profile: MEM slows down significantly in the second half. Strong Under trend (61% Under) due to defensive grit and controlled half-court sets.'
),
(
    'DEN', 
    'nba', 
    0.25, 
    0.85, 
    0.45, 
    'Institutional Juggernaut Profile: DEN maintains high offensive efficiency into the 4th. 66% Over rate due to consistent scoring and late-game offensive execution.'
)
ON CONFLICT (team_id) DO UPDATE SET
    q4_pace_delta = EXCLUDED.q4_pace_delta,
    q4_efficiency_delta = EXCLUDED.q4_efficiency_delta,
    q4_defensive_delta = EXCLUDED.q4_defensive_delta,
    meta_notes = EXCLUDED.meta_notes,
    updated_at = NOW();
