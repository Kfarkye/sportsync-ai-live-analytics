-- Phoenix Suns 2025-26 Institutional Profile
-- Forensic grounding for AI analysis of ATS performance.

INSERT INTO public.institutional_team_profiles 
(team_id, league_id, q4_pace_delta, q4_efficiency_delta, q4_defensive_delta, meta_notes)
VALUES 
(
    'PHX', 
    'nba', 
    0.15, 
    1.12, 
    -0.10, 
    'Institutional Dominance Profile: PHX is the NBA premier ATS coverage team (69% Cover). High offensive efficiency delta in clutch time (+1.12) makes them reliable favorites.'
)
ON CONFLICT (team_id) DO UPDATE SET
    q4_pace_delta = EXCLUDED.q4_pace_delta,
    q4_efficiency_delta = EXCLUDED.q4_efficiency_delta,
    q4_defensive_delta = EXCLUDED.q4_defensive_delta,
    meta_notes = EXCLUDED.meta_notes,
    updated_at = NOW();
