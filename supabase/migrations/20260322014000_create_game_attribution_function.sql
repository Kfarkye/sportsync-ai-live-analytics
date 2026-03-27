
-- ============================================================
-- FULL GAME ATTRIBUTION FUNCTION
-- Takes an espn_event_id, returns the full 7-layer stack
-- All values in EPD (Expected Point Delta) vs close
-- ============================================================
CREATE OR REPLACE FUNCTION get_game_attribution(p_event_id TEXT)
RETURNS JSONB AS $$
DECLARE
  v_close NUMERIC;
  v_home_team TEXT;
  v_away_team TEXT;
  v_season INT;
  v_start_time TIMESTAMPTZ;
  v_spread NUMERIC;
  v_match_id TEXT;
  v_open_total NUMERIC;
  -- Layer scores
  v_game_structure NUMERIC := 0;
  v_ref_baseline NUMERIC := 0;
  v_coach_baseline NUMERIC := 0;
  v_team_identity NUMERIC := 0;
  v_ref_coach NUMERIC := 0;
  v_ref_player NUMERIC := 0;
  v_player_power NUMERIC := 0;
  v_narrative_residual NUMERIC := 0;
  -- Composite
  v_structural_score NUMERIC;
  v_line_move NUMERIC := 0;
  v_raw_residual NUMERIC;
  v_dead_zone NUMERIC := 1.0;  -- Computed from data: P25 of |open-close| moves
  -- Ref details
  v_crew_avg_u NUMERIC;
  v_crew_refs JSONB := '[]'::jsonb;
  -- Coach details
  v_home_coach TEXT;
  v_away_coach TEXT;
  v_ref_coach_details JSONB := '[]'::jsonb;
  v_ref_player_details JSONB := '[]'::jsonb;
  v_top_players JSONB := '[]'::jsonb;
BEGIN
  -- Get game basics
  v_match_id := p_event_id || '_nba';
  
  SELECT pg.dk_total, pg.home_team, pg.away_team, pg.start_time, 
    ABS(pg.dk_spread)
  INTO v_close, v_home_team, v_away_team, v_start_time, v_spread
  FROM nba_postgame pg
  WHERE pg.espn_event_id = p_event_id;
  
  -- If no postgame, try matches
  IF v_close IS NULL THEN
    SELECT m.odds_total_safe::numeric, m.home_team, m.away_team, m.start_time
    INTO v_close, v_home_team, v_away_team, v_start_time
    FROM matches m WHERE m.id = v_match_id;
  END IF;
  
  IF v_close IS NULL THEN
    RETURN jsonb_build_object('error', 'Game not found or no closing total');
  END IF;
  
  v_season := CASE 
    WHEN EXTRACT(MONTH FROM v_start_time) >= 10 
      THEN EXTRACT(YEAR FROM v_start_time)::int
    ELSE EXTRACT(YEAR FROM v_start_time)::int - 1
  END;
  
  -- Get open total for line move
  SELECT ol.total::numeric INTO v_open_total
  FROM opening_lines ol WHERE ol.match_id = v_match_id;
  
  IF v_open_total IS NOT NULL THEN
    v_line_move := v_close - v_open_total;
  END IF;

  -- ============================================================
  -- LAYER 0: GAME STRUCTURE
  -- Spread size + total band adjustment
  -- ============================================================
  v_game_structure := CASE
    WHEN v_spread >= 13 THEN 2.0    -- blowouts go over
    WHEN v_spread >= 9 THEN 0.5
    WHEN v_spread < 3 THEN -1.0     -- competitive games go under
    ELSE 0.0
  END + CASE
    WHEN v_close BETWEEN 215 AND 233 THEN -0.5  -- sweet spot for under
    WHEN v_close BETWEEN 234 AND 239 THEN 0.5   -- market gets these right (over)
    ELSE 0.0
  END;

  -- ============================================================
  -- LAYER 1: REF BASELINE
  -- Crew composite under rate → margin vs close
  -- ============================================================
  SELECT 
    AVG(rb.avg_margin_vs_close),
    AVG(rb.under_rate),
    jsonb_agg(jsonb_build_object(
      'name', rb.ref,
      'under_rate', ROUND(rb.under_rate::numeric * 100, 1),
      'games', rb.games,
      'margin', ROUND(rb.avg_margin_vs_close::numeric, 1)
    ))
  INTO v_ref_baseline, v_crew_avg_u, v_crew_refs
  FROM game_officials go
  JOIN mv_ref_baseline rb ON rb.ref = go.official_name AND rb.season = v_season
  WHERE go.match_id = v_match_id;
  
  v_ref_baseline := COALESCE(v_ref_baseline, 0);
  v_crew_avg_u := COALESCE(v_crew_avg_u, 0.523);

  -- ============================================================
  -- LAYER 2: COACH BASELINE
  -- Home team coach tendency
  -- ============================================================
  SELECT cb.avg_margin_vs_close, cb.coach_name
  INTO v_coach_baseline, v_home_coach
  FROM mv_coach_baseline cb 
  WHERE cb.team = v_home_team AND cb.season = v_season;
  
  v_coach_baseline := COALESCE(v_coach_baseline, 0);

  -- ============================================================
  -- LAYER 3: TEAM IDENTITY
  -- Both teams' season OU tendency
  -- ============================================================
  SELECT AVG(ti.avg_margin_vs_close)
  INTO v_team_identity
  FROM mv_team_identity ti
  WHERE ti.team IN (v_home_team, v_away_team) AND ti.season = v_season;
  
  v_team_identity := COALESCE(v_team_identity, 0);

  -- ============================================================
  -- LAYER 4: REF x COACH (shrunk interaction)
  -- ============================================================
  SELECT 
    COALESCE(SUM(rci.shrunk_interaction), 0),
    jsonb_agg(jsonb_build_object(
      'ref', rci.ref, 'team', rci.team,
      'meetings', rci.meetings,
      'raw', rci.raw_interaction,
      'shrunk', rci.shrunk_interaction,
      'weight', rci.shrinkage_weight
    ))
  INTO v_ref_coach, v_ref_coach_details
  FROM game_officials go
  JOIN mv_ref_coach_interaction rci ON rci.ref = go.official_name 
    AND rci.team = v_home_team
  WHERE go.match_id = v_match_id;
  
  v_ref_coach := COALESCE(v_ref_coach, 0);

  -- ============================================================
  -- LAYER 5: REF x PLAYER (shrunk, top players only)
  -- Sum of shrunk deltas for stars in this game
  -- ============================================================
  SELECT 
    COALESCE(SUM(rpi.shrunk_pts_delta), 0),
    jsonb_agg(jsonb_build_object(
      'ref', rpi.ref, 'player', rpi.player_name,
      'meetings', rpi.meetings,
      'raw_delta', rpi.raw_pts_delta,
      'shrunk_delta', rpi.shrunk_pts_delta,
      'weight', rpi.shrinkage_weight
    ))
  INTO v_ref_player, v_ref_player_details
  FROM game_officials go
  JOIN mv_ref_player_interaction rpi ON rpi.ref = go.official_name
  JOIN espn_athletes ea ON ea.id = rpi.athlete_id
  WHERE go.match_id = v_match_id
    AND ea.team_name IN (v_home_team, v_away_team);
  
  v_ref_player := COALESCE(v_ref_player, 0);

  -- ============================================================
  -- LAYER 6: PLAYER POWER (narrative pricing weight)
  -- Top narrative-weight players in this game
  -- ============================================================
  SELECT jsonb_agg(jsonb_build_object(
    'name', pp.player_name,
    'team', pp.team_name,
    'ppg', pp.ppg,
    'usage_pct', pp.usage_pct,
    'narrative_score', pp.narrative_power_score
  ) ORDER BY pp.narrative_power_score DESC)
  INTO v_top_players
  FROM mv_player_power pp
  WHERE pp.team_name IN (v_home_team, v_away_team);
  
  -- Player power as market-move attribution (scaled from narrative scores)
  SELECT COALESCE(SUM(pp.narrative_power_score * 0.1), 0)
  INTO v_player_power
  FROM mv_player_power pp
  WHERE pp.team_name IN (v_home_team, v_away_team)
    AND pp.ppg >= 20;

  -- ============================================================
  -- LAYER 7: PUBLIC NARRATIVE RESIDUAL
  -- What's left after structural stack is subtracted from line move
  -- ============================================================
  v_structural_score := v_game_structure + v_ref_baseline + v_coach_baseline 
    + v_team_identity + v_ref_coach + v_ref_player;
  
  v_raw_residual := v_line_move - v_structural_score;
  
  -- Apply dead zone (±1.0 from data)
  v_narrative_residual := CASE
    WHEN ABS(v_raw_residual) <= v_dead_zone THEN 0.0
    ELSE SIGN(v_raw_residual) * (ABS(v_raw_residual) - v_dead_zone)
  END;

  -- ============================================================
  -- RETURN FULL ATTRIBUTION
  -- ============================================================
  RETURN jsonb_build_object(
    'game', jsonb_build_object(
      'event_id', p_event_id,
      'home', v_home_team,
      'away', v_away_team,
      'close', v_close,
      'open', v_open_total,
      'line_move', ROUND(v_line_move, 1),
      'spread', v_spread,
      'season', v_season
    ),
    'attribution', jsonb_build_object(
      '0_game_structure', ROUND(v_game_structure, 2),
      '1_ref_baseline', ROUND(v_ref_baseline::numeric, 2),
      '2_coach_baseline', ROUND(v_coach_baseline::numeric, 2),
      '3_team_identity', ROUND(v_team_identity::numeric, 2),
      '4_ref_coach', ROUND(v_ref_coach::numeric, 2),
      '5_ref_player', ROUND(v_ref_player::numeric, 2),
      '6_player_power', ROUND(v_player_power::numeric, 2),
      '7_narrative_residual', ROUND(v_narrative_residual::numeric, 2)
    ),
    'summary', jsonb_build_object(
      'structural_score', ROUND(v_structural_score::numeric, 2),
      'line_move', ROUND(v_line_move, 2),
      'raw_residual', ROUND(v_raw_residual::numeric, 2),
      'narrative_residual', ROUND(v_narrative_residual::numeric, 2),
      'gap', ROUND((v_structural_score - v_line_move)::numeric, 2),
      'crew_avg_under', ROUND(v_crew_avg_u::numeric * 100, 1),
      'signal', CASE
        WHEN v_structural_score < -3 THEN 'STRONG_UNDER'
        WHEN v_structural_score < -1 THEN 'LEAN_UNDER'
        WHEN v_structural_score > 3 THEN 'STRONG_OVER'
        WHEN v_structural_score > 1 THEN 'LEAN_OVER'
        ELSE 'NEUTRAL'
      END,
      'conflict', CASE
        WHEN SIGN(v_structural_score) != SIGN(v_line_move) AND ABS(v_structural_score) > 2 
          THEN 'SEVERE'
        WHEN SIGN(v_structural_score) != SIGN(v_line_move) 
          THEN 'MODERATE'
        ELSE 'ALIGNED'
      END
    ),
    'details', jsonb_build_object(
      'crew', COALESCE(v_crew_refs, '[]'::jsonb),
      'ref_coach', COALESCE(v_ref_coach_details, '[]'::jsonb),
      'ref_player', COALESCE(v_ref_player_details, '[]'::jsonb),
      'top_players', COALESCE(v_top_players, '[]'::jsonb),
      'home_coach', v_home_coach
    )
  );
END;
$$ LANGUAGE plpgsql STABLE;
;
