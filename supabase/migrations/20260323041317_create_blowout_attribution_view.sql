
-- BLOWOUT ATTRIBUTION MODEL (VIEW)
-- Reads from: pregame_intel, matches, opening_lines, game_officials,
--             official_tendencies, coaches, nba_postgame, team_ou_splits (via sportsync)
-- Purpose: After the main model runs, this view isolates blowout-profile games
--          and attributes a confluence tier from ref, coach, and team O/U signals.

CREATE OR REPLACE VIEW v_blowout_attribution AS
WITH 

-- Step 1: Identify blowout-profile games from today's pregame_intel
-- (spread >= 12 and at least one bottom-tier team)
blowout_candidates AS (
  SELECT 
    pi.match_id,
    pi.home_team,
    pi.away_team,
    pi.game_date,
    pi.recommended_pick AS main_model_pick,
    pi.confidence_tier AS main_model_confidence,
    pi.analyzed_spread,
    pi.analyzed_total,
    pi.pick_result,
    pi.actual_home_score,
    pi.actual_away_score,
    -- Identify which team is the blowout trigger
    CASE 
      WHEN pi.home_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
        AND pi.analyzed_spread > 0 THEN pi.home_team  -- home team is underdog
      WHEN pi.away_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
        AND pi.analyzed_spread < 0 THEN pi.away_team  -- away team is underdog
      ELSE NULL
    END AS trigger_team,
    -- Opponent team
    CASE 
      WHEN pi.home_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
        AND pi.analyzed_spread > 0 THEN pi.away_team
      WHEN pi.away_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
        AND pi.analyzed_spread < 0 THEN pi.home_team
      ELSE NULL
    END AS opponent_team
  FROM pregame_intel pi
  WHERE pi.league_id = 'nba'
    AND ABS(COALESCE(pi.analyzed_spread, 0)) >= 12
),

-- Step 2: Get lead ref for each game
lead_refs AS (
  SELECT DISTINCT ON (go.match_id)
    go.match_id,
    go.official_name AS lead_ref
  FROM game_officials go
  WHERE go.league_id = 'nba'
    AND go.official_order = 1
  ORDER BY go.match_id, go.created_at DESC
),

-- Step 3: Get lead ref's league-wide over %
ref_league_stats AS (
  SELECT 
    go.official_name,
    COUNT(DISTINCT go.match_id) AS ref_total_games,
    ROUND(100.0 * SUM(CASE WHEN (pg.home_score + pg.away_score) > pg.dk_total THEN 1 ELSE 0 END)::numeric /
      NULLIF(SUM(CASE WHEN pg.dk_total IS NOT NULL THEN 1 ELSE 0 END), 0), 1) AS ref_league_over_pct
  FROM game_officials go
  JOIN nba_postgame pg ON go.match_id = pg.id
  WHERE go.league_id = 'nba'
    AND go.official_order = 1
    AND pg.home_score > 0
  GROUP BY go.official_name
),

-- Step 4: Get opponent coach
opp_coaches AS (
  SELECT 
    c.team_name,
    c.coach_name
  FROM coaches c
  WHERE c.league_id = 'nba'
),

-- Step 5: Get opponent coach's season-long over %
coach_ou_stats AS (
  SELECT 
    c.coach_name,
    COUNT(*) AS coach_total_games,
    ROUND(100.0 * SUM(CASE WHEN (pg.home_score + pg.away_score) > pg.dk_total THEN 1 ELSE 0 END)::numeric /
      NULLIF(SUM(CASE WHEN pg.dk_total IS NOT NULL THEN 1 ELSE 0 END), 0), 1) AS coach_over_pct,
    ROUND(AVG((pg.home_score + pg.away_score) - pg.dk_total)::numeric, 1) AS coach_avg_delta
  FROM coaches c
  JOIN nba_postgame pg ON (c.team_name = pg.home_team OR c.team_name = pg.away_team)
  WHERE c.league_id = 'nba'
    AND pg.home_score > 0
    AND pg.dk_total IS NOT NULL
  GROUP BY c.coach_name
),

-- Step 6: Get trigger team's O/U rate from nba_postgame (full season)
team_ou_stats AS (
  SELECT 
    team,
    COUNT(*) AS team_games,
    SUM(CASE WHEN actual > total THEN 1 ELSE 0 END) AS team_overs,
    ROUND(100.0 * SUM(CASE WHEN actual > total THEN 1 ELSE 0 END)::numeric / 
      NULLIF(COUNT(*), 0), 1) AS team_over_pct,
    ROUND(AVG(actual - total)::numeric, 1) AS team_avg_delta
  FROM (
    SELECT 
      CASE WHEN pg.home_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
        THEN pg.home_team ELSE pg.away_team END AS team,
      (pg.home_score + pg.away_score) AS actual,
      pg.dk_total AS total
    FROM nba_postgame pg
    WHERE pg.home_score > 0
      AND pg.dk_total IS NOT NULL
      AND (pg.home_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
        OR pg.away_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers'))
  ) sub
  GROUP BY team
)

-- Final SELECT: assemble the attribution
SELECT
  bc.match_id,
  bc.game_date,
  bc.home_team,
  bc.away_team,
  bc.trigger_team,
  bc.opponent_team,
  bc.analyzed_spread,
  bc.analyzed_total,
  
  -- Main model (read-only)
  bc.main_model_pick,
  bc.main_model_confidence,
  
  -- Team signal
  ts.team_over_pct,
  ts.team_avg_delta,
  ts.team_games,
  
  -- Ref signal
  lr.lead_ref,
  rls.ref_league_over_pct,
  rls.ref_total_games AS ref_games,
  
  -- Coach signal
  oc.coach_name AS opp_coach,
  cos.coach_over_pct AS opp_coach_over_pct,
  cos.coach_avg_delta AS opp_coach_avg_delta,
  cos.coach_total_games AS coach_games,
  
  -- CONFLUENCE TIER
  CASE
    -- TIER 1: All 3 signals align OVER
    WHEN COALESCE(ts.team_over_pct, 0) >= 55
      AND COALESCE(rls.ref_league_over_pct, 50) >= 58
      AND COALESCE(cos.coach_over_pct, 50) >= 50
    THEN 1
    
    -- TIER 2: Team + one other signal OVER
    WHEN COALESCE(ts.team_over_pct, 0) >= 55
      AND (COALESCE(rls.ref_league_over_pct, 50) >= 55 OR COALESCE(cos.coach_over_pct, 50) >= 50)
    THEN 2
    
    -- TIER 4: Coach is strong under AND ref is under
    WHEN COALESCE(cos.coach_over_pct, 50) < 43
      AND COALESCE(rls.ref_league_over_pct, 50) < 45
    THEN 4
    
    -- TIER 3: Conflict (team says over, but coach/ref say under)
    ELSE 3
  END AS confluence_tier,
  
  CASE
    WHEN COALESCE(ts.team_over_pct, 0) >= 55
      AND COALESCE(rls.ref_league_over_pct, 50) >= 58
      AND COALESCE(cos.coach_over_pct, 50) >= 50
    THEN 'MAX_OVER'
    WHEN COALESCE(ts.team_over_pct, 0) >= 55
      AND (COALESCE(rls.ref_league_over_pct, 50) >= 55 OR COALESCE(cos.coach_over_pct, 50) >= 50)
    THEN 'STANDARD_OVER'
    WHEN COALESCE(cos.coach_over_pct, 50) < 43
      AND COALESCE(rls.ref_league_over_pct, 50) < 45
    THEN 'NO_PLAY'
    ELSE 'CONFLICT'
  END AS confluence_label,
  
  -- Overlay recommendation
  CASE
    WHEN COALESCE(ts.team_over_pct, 0) >= 55
      AND COALESCE(rls.ref_league_over_pct, 50) >= 58
      AND COALESCE(cos.coach_over_pct, 50) >= 50
    THEN 'GAME_TOTAL_OVER ' || bc.analyzed_total
    WHEN COALESCE(ts.team_over_pct, 0) >= 55
      AND (COALESCE(rls.ref_league_over_pct, 50) >= 55 OR COALESCE(cos.coach_over_pct, 50) >= 50)
    THEN 'GAME_TOTAL_OVER ' || bc.analyzed_total
    ELSE 'SKIP'
  END AS overlay_pick,
  
  -- Estimated hit rate
  CASE
    WHEN COALESCE(ts.team_over_pct, 0) >= 55
      AND COALESCE(rls.ref_league_over_pct, 50) >= 58
      AND COALESCE(cos.coach_over_pct, 50) >= 50
    THEN 75.0
    WHEN COALESCE(ts.team_over_pct, 0) >= 55
      AND (COALESCE(rls.ref_league_over_pct, 50) >= 55 OR COALESCE(cos.coach_over_pct, 50) >= 50)
    THEN 60.0
    WHEN COALESCE(cos.coach_over_pct, 50) < 43
      AND COALESCE(rls.ref_league_over_pct, 50) < 45
    THEN 25.0
    ELSE 45.0
  END AS estimated_hit_rate,
  
  -- Actual result (for grading completed games)
  bc.actual_home_score,
  bc.actual_away_score,
  CASE WHEN bc.actual_home_score IS NOT NULL AND bc.actual_away_score IS NOT NULL
    THEN bc.actual_home_score + bc.actual_away_score END AS actual_total,
  CASE 
    WHEN bc.actual_home_score IS NOT NULL AND bc.actual_away_score IS NOT NULL
      AND (bc.actual_home_score + bc.actual_away_score) > bc.analyzed_total THEN 'OVER'
    WHEN bc.actual_home_score IS NOT NULL AND bc.actual_away_score IS NOT NULL
      AND (bc.actual_home_score + bc.actual_away_score) < bc.analyzed_total THEN 'UNDER'
    WHEN bc.actual_home_score IS NOT NULL AND bc.actual_away_score IS NOT NULL THEN 'PUSH'
    ELSE NULL
  END AS actual_ou_result,
  
  bc.pick_result AS main_model_result

FROM blowout_candidates bc

LEFT JOIN team_ou_stats ts ON ts.team = bc.trigger_team
LEFT JOIN lead_refs lr ON lr.match_id = bc.match_id
LEFT JOIN ref_league_stats rls ON rls.official_name = lr.lead_ref
LEFT JOIN opp_coaches oc ON oc.team_name = bc.opponent_team
LEFT JOIN coach_ou_stats cos ON cos.coach_name = oc.coach_name

WHERE bc.trigger_team IS NOT NULL

ORDER BY bc.game_date DESC, confluence_tier ASC;

COMMENT ON VIEW v_blowout_attribution IS 
  'Attribution model that layers ref × coach × team O/U confluence on top of existing pregame_intel picks. Read-only view — does NOT modify the main model. Query with: SELECT * FROM v_blowout_attribution WHERE game_date = CURRENT_DATE';
;
