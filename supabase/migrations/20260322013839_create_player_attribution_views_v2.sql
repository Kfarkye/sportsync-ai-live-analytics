
-- ============================================================
-- LAYER 5: REF x PLAYER (star whistle delta, shrunk)
-- Only for top usage players (>= 15 PPG and >= 20 games)
-- shrinkage_weight = N / (N + 8)
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ref_player_interaction AS
WITH star_players AS (
  SELECT 
    athlete_id,
    COUNT(*) AS games_played,
    AVG((stats->>'PTS')::numeric) AS ppg
  FROM espn_game_logs
  WHERE league_id = 'nba' AND stats->>'PTS' IS NOT NULL
  GROUP BY athlete_id
  HAVING AVG((stats->>'PTS')::numeric) >= 15 AND COUNT(*) >= 20
),
ref_player_games AS (
  SELECT 
    go.official_name AS ref,
    gl.athlete_id,
    ea.display_name AS player_name,
    gl.espn_event_id,
    (gl.stats->>'PTS')::numeric AS pts,
    (gl.stats->>'PF')::numeric AS personal_fouls,
    sp.ppg AS season_ppg,
    rb.avg_margin_vs_close AS ref_baseline
  FROM espn_game_logs gl
  JOIN star_players sp ON sp.athlete_id = gl.athlete_id
  JOIN game_officials go ON go.match_id = gl.espn_event_id || '_nba'
  JOIN espn_athletes ea ON ea.id = gl.athlete_id
  JOIN mv_ref_baseline rb ON rb.ref = go.official_name
    AND rb.season = CASE 
      WHEN EXTRACT(MONTH FROM gl.game_date) >= 10 
        THEN EXTRACT(YEAR FROM gl.game_date)::int
      ELSE EXTRACT(YEAR FROM gl.game_date)::int - 1
    END
  WHERE gl.league_id = 'nba'
    AND gl.stats->>'PTS' IS NOT NULL
)
SELECT 
  ref, 
  athlete_id,
  player_name,
  COUNT(*) AS meetings,
  ROUND(AVG(pts - season_ppg)::numeric, 2) AS raw_pts_delta,
  ROUND((AVG(pts - season_ppg) * (COUNT(*)::numeric / (COUNT(*) + 8)))::numeric, 2) AS shrunk_pts_delta,
  ROUND(AVG(personal_fouls)::numeric, 2) AS avg_pf_with_ref,
  ROUND((COUNT(*)::numeric / (COUNT(*) + 8))::numeric, 3) AS shrinkage_weight,
  ROUND(AVG(season_ppg)::numeric, 1) AS season_ppg
FROM ref_player_games
GROUP BY ref, athlete_id, player_name
HAVING COUNT(*) >= 3;

CREATE INDEX IF NOT EXISTS idx_mv_ref_player_ref 
  ON mv_ref_player_interaction (ref);
CREATE INDEX IF NOT EXISTS idx_mv_ref_player_athlete 
  ON mv_ref_player_interaction (athlete_id);

-- ============================================================
-- LAYER 6: PLAYER POWER (public narrative pricing weight)
-- How much scoring visibility does this player carry?
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_player_power AS
WITH player_game_totals AS (
  SELECT 
    gl.athlete_id,
    ea.display_name AS player_name,
    ea.team_name,
    ea.position_abbr,
    gl.espn_event_id,
    (gl.stats->>'PTS')::numeric AS pts,
    (gl.stats->>'MIN')::numeric AS mins,
    pg.home_score + pg.away_score AS game_total,
    pg.dk_total AS close,
    (pg.home_score + pg.away_score) - pg.dk_total AS margin
  FROM espn_game_logs gl
  JOIN espn_athletes ea ON ea.id = gl.athlete_id
  JOIN nba_postgame pg ON pg.espn_event_id = gl.espn_event_id
  WHERE gl.league_id = 'nba'
    AND gl.stats->>'PTS' IS NOT NULL
    AND gl.stats->>'MIN' IS NOT NULL
    AND pg.dk_total IS NOT NULL AND pg.home_score IS NOT NULL
)
SELECT 
  athlete_id,
  player_name,
  team_name,
  position_abbr,
  COUNT(*) AS games_played,
  ROUND(AVG(pts)::numeric, 1) AS ppg,
  ROUND(AVG(mins)::numeric, 1) AS mpg,
  ROUND(AVG(pts / NULLIF(game_total, 0))::numeric * 100, 1) AS usage_pct,
  ROUND(AVG(margin)::numeric, 2) AS avg_margin_vs_close,
  ROUND(AVG(game_total)::numeric, 1) AS avg_total,
  -- Narrative power: ppg × usage share × 10 (scaled)
  ROUND((AVG(pts) * AVG(pts / NULLIF(game_total, 0)) * 10)::numeric, 2) AS narrative_power_score
FROM player_game_totals
WHERE pts IS NOT NULL AND mins IS NOT NULL
GROUP BY athlete_id, player_name, team_name, position_abbr
HAVING COUNT(*) >= 15 AND AVG(pts) >= 10
ORDER BY AVG(pts) * AVG(pts / NULLIF(game_total, 0)) DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_player_power_athlete 
  ON mv_player_power (athlete_id);
;
