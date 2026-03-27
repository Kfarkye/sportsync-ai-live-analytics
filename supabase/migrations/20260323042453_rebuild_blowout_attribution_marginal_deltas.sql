
DROP VIEW IF EXISTS v_blowout_attribution CASCADE;

CREATE OR REPLACE VIEW v_blowout_attribution AS
WITH 

-- League baseline: what the market expects on average
league_baseline AS (
  SELECT ROUND(AVG((pg.home_score + pg.away_score) - pg.dk_total)::numeric, 2) AS baseline_delta
  FROM nba_postgame pg WHERE pg.home_score > 0 AND pg.dk_total IS NOT NULL
),

-- Candidate games from pregame_intel involving blowout-profile teams
blowout_candidates AS (
  SELECT 
    pi.match_id, pi.home_team, pi.away_team, pi.game_date,
    pi.recommended_pick AS main_model_pick,
    pi.confidence_tier AS main_model_confidence,
    COALESCE(pi.analyzed_spread, pi.spread_line, pi.pick_point)::numeric AS analyzed_spread,
    pi.analyzed_total,
    pi.pick_result,
    COALESCE(pi.final_home_score, pi.actual_home_score) AS final_home,
    COALESCE(pi.final_away_score, pi.actual_away_score) AS final_away,
    CASE 
      WHEN pi.home_team IN ('Washington Wizards','Utah Jazz','Philadelphia 76ers','Brooklyn Nets','Portland Trail Blazers','Charlotte Hornets')
        THEN pi.home_team
      ELSE pi.away_team
    END AS trigger_team,
    CASE 
      WHEN pi.home_team IN ('Washington Wizards','Utah Jazz','Philadelphia 76ers','Brooklyn Nets','Portland Trail Blazers','Charlotte Hornets')
        THEN pi.away_team
      ELSE pi.home_team
    END AS opponent_team
  FROM pregame_intel pi
  WHERE pi.league_id = 'nba'
    AND ABS(COALESCE(pi.analyzed_spread, pi.spread_line, pi.pick_point, 0)) >= 10
    AND (pi.home_team IN ('Washington Wizards','Utah Jazz','Philadelphia 76ers','Brooklyn Nets','Portland Trail Blazers','Charlotte Hornets')
      OR pi.away_team IN ('Washington Wizards','Utah Jazz','Philadelphia 76ers','Brooklyn Nets','Portland Trail Blazers','Charlotte Hornets'))
),

-- SIGNAL 1: Team marginal delta (what the market underprices for this team)
team_marginals AS (
  SELECT 
    team,
    COUNT(*) AS team_games,
    ROUND(AVG(actual - total)::numeric, 2) AS team_avg_delta,
    ROUND(AVG(actual - total)::numeric - (SELECT baseline_delta FROM league_baseline), 2) AS team_marginal
  FROM (
    SELECT 
      CASE WHEN pg.home_team IN ('Washington Wizards','Utah Jazz','Philadelphia 76ers','Brooklyn Nets','Portland Trail Blazers','Charlotte Hornets')
        THEN pg.home_team ELSE pg.away_team END AS team,
      (pg.home_score + pg.away_score)::numeric AS actual, pg.dk_total AS total
    FROM nba_postgame pg
    WHERE pg.home_score > 0 AND pg.dk_total IS NOT NULL
      AND (pg.home_team IN ('Washington Wizards','Utah Jazz','Philadelphia 76ers','Brooklyn Nets','Portland Trail Blazers','Charlotte Hornets')
        OR pg.away_team IN ('Washington Wizards','Utah Jazz','Philadelphia 76ers','Brooklyn Nets','Portland Trail Blazers','Charlotte Hornets'))
  ) sub GROUP BY team
),

-- SIGNAL 2: Lead ref marginal delta (what the market CAN'T price — assigned day-of)
lead_refs AS (
  SELECT DISTINCT ON (go.match_id)
    go.match_id, go.official_name AS lead_ref
  FROM game_officials go WHERE go.league_id = 'nba' AND go.official_order = 1
  ORDER BY go.match_id, go.created_at DESC
),

ref_marginals AS (
  SELECT 
    go.official_name,
    COUNT(DISTINCT go.match_id) AS ref_games,
    ROUND(AVG((pg.home_score + pg.away_score) - pg.dk_total)::numeric, 2) AS ref_avg_delta,
    ROUND(AVG((pg.home_score + pg.away_score) - pg.dk_total)::numeric 
      - (SELECT baseline_delta FROM league_baseline), 2) AS ref_marginal
  FROM game_officials go
  JOIN nba_postgame pg ON go.match_id = pg.id
  WHERE go.league_id = 'nba' AND go.official_order = 1 AND pg.home_score > 0 AND pg.dk_total IS NOT NULL
  GROUP BY go.official_name
),

-- SIGNAL 3: Opponent coach marginal delta (partially priced but interaction isn't)
opp_coaches AS (
  SELECT team_name, coach_name FROM coaches WHERE league_id = 'nba'
),

coach_marginals AS (
  SELECT 
    c.coach_name,
    COUNT(*) AS coach_games,
    ROUND(AVG((pg.home_score + pg.away_score) - pg.dk_total)::numeric, 2) AS coach_avg_delta,
    ROUND(AVG((pg.home_score + pg.away_score) - pg.dk_total)::numeric 
      - (SELECT baseline_delta FROM league_baseline), 2) AS coach_marginal
  FROM coaches c
  JOIN nba_postgame pg ON (c.team_name = pg.home_team OR c.team_name = pg.away_team)
  WHERE c.league_id = 'nba' AND pg.home_score > 0 AND pg.dk_total IS NOT NULL
  GROUP BY c.coach_name
)

SELECT
  bc.match_id, bc.game_date, bc.home_team, bc.away_team,
  bc.trigger_team, bc.opponent_team,
  bc.analyzed_spread, bc.analyzed_total,
  bc.main_model_pick, bc.main_model_confidence,
  
  -- MARGINAL DELTAS (what the market misses)
  (SELECT baseline_delta FROM league_baseline) AS market_baseline,
  
  -- Team: how much does the market underprice this team?
  tm.team_marginal,
  tm.team_avg_delta,
  tm.team_games,
  
  -- Ref: NOT priced at all (assigned day-of)
  lr.lead_ref,
  rm.ref_marginal,
  rm.ref_avg_delta,
  rm.ref_games,
  
  -- Coach: partially priced, but interaction with blowout team isn't
  oc.coach_name AS opp_coach,
  cm.coach_marginal AS opp_coach_marginal,
  cm.coach_avg_delta AS opp_coach_avg_delta,
  cm.coach_games,
  
  -- COMBINED EXPECTED EDGE: sum of marginal deltas
  -- This is the total points the market is expected to miss
  ROUND(COALESCE(tm.team_marginal, 0) + COALESCE(rm.ref_marginal, 0) + COALESCE(cm.coach_marginal, 0), 2) AS combined_edge,
  
  -- CONFLUENCE TIER (based on combined edge, not raw over %)
  CASE
    -- TIER 1: Combined edge >= +5 points (market is underpricing by 5+)
    WHEN COALESCE(tm.team_marginal, 0) + COALESCE(rm.ref_marginal, 0) + COALESCE(cm.coach_marginal, 0) >= 5 THEN 1
    -- TIER 2: Combined edge >= +2 points
    WHEN COALESCE(tm.team_marginal, 0) + COALESCE(rm.ref_marginal, 0) + COALESCE(cm.coach_marginal, 0) >= 2 THEN 2
    -- TIER 4: Combined edge <= -3 (market is OVERPRICING; these go under)
    WHEN COALESCE(tm.team_marginal, 0) + COALESCE(rm.ref_marginal, 0) + COALESCE(cm.coach_marginal, 0) <= -3 THEN 4
    -- TIER 3: Marginal signals conflict or are near zero
    ELSE 3
  END AS confluence_tier,
  
  CASE
    WHEN COALESCE(tm.team_marginal, 0) + COALESCE(rm.ref_marginal, 0) + COALESCE(cm.coach_marginal, 0) >= 5 THEN 'MAX_OVER'
    WHEN COALESCE(tm.team_marginal, 0) + COALESCE(rm.ref_marginal, 0) + COALESCE(cm.coach_marginal, 0) >= 2 THEN 'LEAN_OVER'
    WHEN COALESCE(tm.team_marginal, 0) + COALESCE(rm.ref_marginal, 0) + COALESCE(cm.coach_marginal, 0) <= -3 THEN 'NO_PLAY'
    ELSE 'NEUTRAL'
  END AS confluence_label,
  
  CASE
    WHEN COALESCE(tm.team_marginal, 0) + COALESCE(rm.ref_marginal, 0) + COALESCE(cm.coach_marginal, 0) >= 2
    THEN 'GAME_TOTAL_OVER ' || bc.analyzed_total
    ELSE 'SKIP'
  END AS overlay_pick,
  
  -- Grading
  bc.final_home, bc.final_away,
  CASE WHEN bc.final_home IS NOT NULL THEN bc.final_home + bc.final_away END AS actual_total,
  CASE 
    WHEN bc.final_home IS NOT NULL AND (bc.final_home + bc.final_away) > bc.analyzed_total THEN 'OVER'
    WHEN bc.final_home IS NOT NULL AND (bc.final_home + bc.final_away) < bc.analyzed_total THEN 'UNDER'
    WHEN bc.final_home IS NOT NULL THEN 'PUSH'
  END AS actual_ou_result,
  bc.pick_result AS main_model_result

FROM blowout_candidates bc
LEFT JOIN team_marginals tm ON tm.team = bc.trigger_team
LEFT JOIN lead_refs lr ON lr.match_id = bc.match_id
LEFT JOIN ref_marginals rm ON rm.official_name = lr.lead_ref
LEFT JOIN opp_coaches oc ON oc.team_name = bc.opponent_team
LEFT JOIN coach_marginals cm ON cm.coach_name = oc.coach_name
WHERE bc.trigger_team IS NOT NULL
ORDER BY bc.game_date DESC, confluence_tier ASC;

COMMENT ON VIEW v_blowout_attribution IS 
  'Attribution model using MARGINAL DELTAS (what the market misses). team_marginal = market underpricing of team, ref_marginal = unpriced ref impact (assigned day-of), opp_coach_marginal = partially unpriced coach tendency. combined_edge = sum of all three = expected points the market misses. Tier 1 = edge >= 5pts, Tier 2 = edge >= 2pts.';
;
