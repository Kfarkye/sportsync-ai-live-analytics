
-- ============================================================
-- LAYER 1: REF BASELINE (points vs close per crew tier)
-- Per-season ref under rates + margin vs close
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ref_baseline AS
SELECT 
  go.official_name AS ref,
  CASE 
    WHEN EXTRACT(MONTH FROM pg.start_time) >= 10 
      THEN EXTRACT(YEAR FROM pg.start_time)::int
    ELSE EXTRACT(YEAR FROM pg.start_time)::int - 1
  END AS season,
  COUNT(*) AS games,
  AVG(CASE WHEN (pg.home_score + pg.away_score) < pg.dk_total THEN 1.0 ELSE 0.0 END) AS under_rate,
  AVG((pg.home_score + pg.away_score) - pg.dk_total) AS avg_margin_vs_close,
  AVG(COALESCE(pg.home_fouls, 0) + COALESCE(pg.away_fouls, 0)) AS avg_fouls,
  AVG(pg.home_score + pg.away_score) AS avg_total
FROM game_officials go
JOIN nba_postgame pg ON go.match_id = pg.espn_event_id || '_nba'
WHERE go.match_id LIKE '%_nba'
  AND pg.dk_total IS NOT NULL 
  AND pg.home_score IS NOT NULL
GROUP BY go.official_name, 
  CASE 
    WHEN EXTRACT(MONTH FROM pg.start_time) >= 10 
      THEN EXTRACT(YEAR FROM pg.start_time)::int
    ELSE EXTRACT(YEAR FROM pg.start_time)::int - 1
  END
HAVING COUNT(*) >= 10;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_ref_baseline_ref_season 
  ON mv_ref_baseline (ref, season);

-- ============================================================
-- LAYER 2: COACH BASELINE (team as proxy, points vs close)
-- Per-season coach/team totals tendency
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_coach_baseline AS
SELECT 
  pg.home_team AS team,
  c.coach_name,
  CASE 
    WHEN EXTRACT(MONTH FROM pg.start_time) >= 10 
      THEN EXTRACT(YEAR FROM pg.start_time)::int
    ELSE EXTRACT(YEAR FROM pg.start_time)::int - 1
  END AS season,
  COUNT(*) AS home_games,
  AVG(CASE WHEN (pg.home_score + pg.away_score) < pg.dk_total THEN 1.0 ELSE 0.0 END) AS under_rate,
  AVG((pg.home_score + pg.away_score) - pg.dk_total) AS avg_margin_vs_close,
  AVG(pg.home_score + pg.away_score) AS avg_total,
  AVG(COALESCE(pg.home_fouls, 0) + COALESCE(pg.away_fouls, 0)) AS avg_fouls
FROM nba_postgame pg
LEFT JOIN coaches c ON c.team_name = pg.home_team AND c.league_id = 'nba'
WHERE pg.dk_total IS NOT NULL AND pg.home_score IS NOT NULL
GROUP BY pg.home_team, c.coach_name,
  CASE 
    WHEN EXTRACT(MONTH FROM pg.start_time) >= 10 
      THEN EXTRACT(YEAR FROM pg.start_time)::int
    ELSE EXTRACT(YEAR FROM pg.start_time)::int - 1
  END
HAVING COUNT(*) >= 5;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_coach_baseline_team_season 
  ON mv_coach_baseline (team, season);

-- ============================================================
-- LAYER 3: TEAM IDENTITY (season OU record, pace profile)
-- Includes both home and away games
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_team_identity AS
WITH home AS (
  SELECT home_team AS team,
    CASE WHEN EXTRACT(MONTH FROM start_time) >= 10 
      THEN EXTRACT(YEAR FROM start_time)::int
      ELSE EXTRACT(YEAR FROM start_time)::int - 1 END AS season,
    home_score + away_score AS total, dk_total AS close,
    CASE WHEN (home_score + away_score) < dk_total THEN 1.0 ELSE 0.0 END AS went_under
  FROM nba_postgame WHERE dk_total IS NOT NULL AND home_score IS NOT NULL
),
away AS (
  SELECT away_team AS team,
    CASE WHEN EXTRACT(MONTH FROM start_time) >= 10 
      THEN EXTRACT(YEAR FROM start_time)::int
      ELSE EXTRACT(YEAR FROM start_time)::int - 1 END AS season,
    home_score + away_score AS total, dk_total AS close,
    CASE WHEN (home_score + away_score) < dk_total THEN 1.0 ELSE 0.0 END AS went_under
  FROM nba_postgame WHERE dk_total IS NOT NULL AND home_score IS NOT NULL
),
combined AS (
  SELECT * FROM home UNION ALL SELECT * FROM away
)
SELECT 
  team, season,
  COUNT(*) AS games,
  AVG(went_under) AS under_rate,
  AVG(total - close) AS avg_margin_vs_close,
  AVG(total) AS avg_total
FROM combined
GROUP BY team, season
HAVING COUNT(*) >= 10;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_team_identity_team_season 
  ON mv_team_identity (team, season);

-- ============================================================
-- LAYER 4: REF x COACH INTERACTION (with shrinkage)
-- interaction = actual_margin - ref_baseline - coach_baseline
-- shrinkage_weight = N / (N + 5)
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ref_coach_interaction AS
WITH ref_team_games AS (
  SELECT 
    go.official_name AS ref,
    pg.home_team AS team,
    pg.espn_event_id,
    (pg.home_score + pg.away_score) - pg.dk_total AS margin,
    rb.avg_margin_vs_close AS ref_baseline,
    cb.avg_margin_vs_close AS coach_baseline
  FROM game_officials go
  JOIN nba_postgame pg ON go.match_id = pg.espn_event_id || '_nba'
  JOIN mv_ref_baseline rb ON rb.ref = go.official_name 
    AND rb.season = CASE 
      WHEN EXTRACT(MONTH FROM pg.start_time) >= 10 
        THEN EXTRACT(YEAR FROM pg.start_time)::int
      ELSE EXTRACT(YEAR FROM pg.start_time)::int - 1
    END
  JOIN mv_coach_baseline cb ON cb.team = pg.home_team
    AND cb.season = CASE 
      WHEN EXTRACT(MONTH FROM pg.start_time) >= 10 
        THEN EXTRACT(YEAR FROM pg.start_time)::int
      ELSE EXTRACT(YEAR FROM pg.start_time)::int - 1
    END
  WHERE go.match_id LIKE '%_nba'
    AND pg.dk_total IS NOT NULL AND pg.home_score IS NOT NULL
)
SELECT 
  ref, team,
  COUNT(*) AS meetings,
  -- Raw interaction
  ROUND((AVG(margin) - AVG(ref_baseline) - AVG(coach_baseline))::numeric, 2) AS raw_interaction,
  -- Shrunk interaction: weight = N / (N + 5)
  ROUND(((AVG(margin) - AVG(ref_baseline) - AVG(coach_baseline)) 
    * (COUNT(*)::numeric / (COUNT(*) + 5)))::numeric, 2) AS shrunk_interaction,
  ROUND((COUNT(*)::numeric / (COUNT(*) + 5))::numeric, 3) AS shrinkage_weight,
  ROUND(AVG(margin)::numeric, 2) AS actual_avg_margin,
  ROUND(AVG(ref_baseline)::numeric, 2) AS ref_baseline_avg,
  ROUND(AVG(coach_baseline)::numeric, 2) AS coach_baseline_avg
FROM ref_team_games
GROUP BY ref, team
HAVING COUNT(*) >= 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_ref_coach_ref_team 
  ON mv_ref_coach_interaction (ref, team);
;
