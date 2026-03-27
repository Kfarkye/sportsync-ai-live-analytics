
-- Must drop first due to column type change
DROP VIEW IF EXISTS v_blowout_attribution CASCADE;

CREATE OR REPLACE VIEW v_blowout_attribution AS
WITH 

blowout_candidates AS (
  SELECT 
    pi.match_id,
    pi.home_team,
    pi.away_team,
    pi.game_date,
    pi.recommended_pick AS main_model_pick,
    pi.confidence_tier AS main_model_confidence,
    COALESCE(pi.analyzed_spread, pi.spread_line, pi.pick_point)::numeric AS analyzed_spread,
    pi.analyzed_total,
    pi.pick_result,
    pi.actual_home_score,
    pi.actual_away_score,
    pi.final_home_score,
    pi.final_away_score,
    CASE 
      WHEN pi.home_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
        THEN pi.home_team
      WHEN pi.away_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
        THEN pi.away_team
      ELSE NULL
    END AS trigger_team,
    CASE 
      WHEN pi.home_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
        THEN pi.away_team
      ELSE pi.home_team
    END AS opponent_team
  FROM pregame_intel pi
  WHERE pi.league_id = 'nba'
    AND ABS(COALESCE(pi.analyzed_spread, pi.spread_line, pi.pick_point, 0)) >= 10
    AND (pi.home_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
      OR pi.away_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers'))
),

lead_refs AS (
  SELECT DISTINCT ON (go.match_id)
    go.match_id, go.official_name AS lead_ref
  FROM game_officials go
  WHERE go.league_id = 'nba' AND go.official_order = 1
  ORDER BY go.match_id, go.created_at DESC
),

ref_league_stats AS (
  SELECT 
    go.official_name,
    COUNT(DISTINCT go.match_id) AS ref_total_games,
    ROUND(100.0 * SUM(CASE WHEN (pg.home_score + pg.away_score) > pg.dk_total THEN 1 ELSE 0 END)::numeric /
      NULLIF(SUM(CASE WHEN pg.dk_total IS NOT NULL THEN 1 ELSE 0 END), 0), 1) AS ref_league_over_pct
  FROM game_officials go
  JOIN nba_postgame pg ON go.match_id = pg.id
  WHERE go.league_id = 'nba' AND go.official_order = 1 AND pg.home_score > 0
  GROUP BY go.official_name
),

opp_coaches AS (
  SELECT team_name, coach_name FROM coaches WHERE league_id = 'nba'
),

coach_ou_stats AS (
  SELECT 
    c.coach_name,
    COUNT(*) AS coach_total_games,
    ROUND(100.0 * SUM(CASE WHEN (pg.home_score + pg.away_score) > pg.dk_total THEN 1 ELSE 0 END)::numeric /
      NULLIF(SUM(CASE WHEN pg.dk_total IS NOT NULL THEN 1 ELSE 0 END), 0), 1) AS coach_over_pct,
    ROUND(AVG((pg.home_score + pg.away_score) - pg.dk_total)::numeric, 1) AS coach_avg_delta
  FROM coaches c
  JOIN nba_postgame pg ON (c.team_name = pg.home_team OR c.team_name = pg.away_team)
  WHERE c.league_id = 'nba' AND pg.home_score > 0 AND pg.dk_total IS NOT NULL
  GROUP BY c.coach_name
),

team_ou_stats AS (
  SELECT 
    team,
    COUNT(*) AS team_games,
    ROUND(100.0 * SUM(CASE WHEN actual > total THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0), 1) AS team_over_pct,
    ROUND(AVG(actual - total)::numeric, 1) AS team_avg_delta
  FROM (
    SELECT 
      CASE WHEN pg.home_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
        THEN pg.home_team ELSE pg.away_team END AS team,
      (pg.home_score + pg.away_score)::numeric AS actual,
      pg.dk_total AS total
    FROM nba_postgame pg
    WHERE pg.home_score > 0 AND pg.dk_total IS NOT NULL
      AND (pg.home_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers')
        OR pg.away_team IN ('Washington Wizards','Brooklyn Nets','Utah Jazz','Charlotte Hornets','Portland Trail Blazers','Philadelphia 76ers'))
  ) sub
  GROUP BY team
)

SELECT
  bc.match_id, bc.game_date, bc.home_team, bc.away_team,
  bc.trigger_team, bc.opponent_team,
  bc.analyzed_spread, bc.analyzed_total,
  bc.main_model_pick, bc.main_model_confidence,
  
  ts.team_over_pct, ts.team_avg_delta, ts.team_games,
  lr.lead_ref, rls.ref_league_over_pct, rls.ref_total_games AS ref_games,
  oc.coach_name AS opp_coach, cos.coach_over_pct AS opp_coach_over_pct,
  cos.coach_avg_delta AS opp_coach_avg_delta, cos.coach_total_games AS coach_games,
  
  CASE
    WHEN COALESCE(ts.team_over_pct,0) >= 55 AND COALESCE(rls.ref_league_over_pct,50) >= 58 AND COALESCE(cos.coach_over_pct,50) >= 50 THEN 1
    WHEN COALESCE(ts.team_over_pct,0) >= 55 AND (COALESCE(rls.ref_league_over_pct,50) >= 55 OR COALESCE(cos.coach_over_pct,50) >= 50) THEN 2
    WHEN COALESCE(cos.coach_over_pct,50) < 43 AND COALESCE(rls.ref_league_over_pct,50) < 45 THEN 4
    ELSE 3
  END AS confluence_tier,
  
  CASE
    WHEN COALESCE(ts.team_over_pct,0) >= 55 AND COALESCE(rls.ref_league_over_pct,50) >= 58 AND COALESCE(cos.coach_over_pct,50) >= 50 THEN 'MAX_OVER'
    WHEN COALESCE(ts.team_over_pct,0) >= 55 AND (COALESCE(rls.ref_league_over_pct,50) >= 55 OR COALESCE(cos.coach_over_pct,50) >= 50) THEN 'STANDARD_OVER'
    WHEN COALESCE(cos.coach_over_pct,50) < 43 AND COALESCE(rls.ref_league_over_pct,50) < 45 THEN 'NO_PLAY'
    ELSE 'CONFLICT'
  END AS confluence_label,
  
  CASE
    WHEN COALESCE(ts.team_over_pct,0) >= 55 AND (COALESCE(rls.ref_league_over_pct,50) >= 55 OR COALESCE(cos.coach_over_pct,50) >= 50)
    THEN 'GAME_TOTAL_OVER ' || bc.analyzed_total
    ELSE 'SKIP'
  END AS overlay_pick,
  
  -- Grading
  COALESCE(bc.final_home_score, bc.actual_home_score) AS final_home_score,
  COALESCE(bc.final_away_score, bc.actual_away_score) AS final_away_score,
  CASE WHEN COALESCE(bc.final_home_score, bc.actual_home_score) IS NOT NULL
    THEN COALESCE(bc.final_home_score, bc.actual_home_score) + COALESCE(bc.final_away_score, bc.actual_away_score) 
  END AS actual_total,
  CASE 
    WHEN COALESCE(bc.final_home_score, bc.actual_home_score) IS NOT NULL
      AND (COALESCE(bc.final_home_score, bc.actual_home_score) + COALESCE(bc.final_away_score, bc.actual_away_score)) > bc.analyzed_total THEN 'OVER'
    WHEN COALESCE(bc.final_home_score, bc.actual_home_score) IS NOT NULL
      AND (COALESCE(bc.final_home_score, bc.actual_home_score) + COALESCE(bc.final_away_score, bc.actual_away_score)) < bc.analyzed_total THEN 'UNDER'
    WHEN COALESCE(bc.final_home_score, bc.actual_home_score) IS NOT NULL THEN 'PUSH'
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
  'Attribution model (READ-ONLY VIEW). Layers ref × coach × team O/U confluence on top of pregame_intel. Zero writes, zero changes to main model.';
;
