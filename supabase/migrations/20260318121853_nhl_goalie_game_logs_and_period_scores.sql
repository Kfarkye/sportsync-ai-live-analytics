
-- ============================================================================
-- NHL Goalie Game Logs: individual goalie performance per game
-- ============================================================================
CREATE TABLE IF NOT EXISTS nhl_goalie_game_logs (
  id TEXT PRIMARY KEY,                    -- {espn_event_id}_{athlete_id}_nhl
  espn_event_id TEXT NOT NULL,
  match_id TEXT REFERENCES nhl_postgame(id),
  athlete_id TEXT NOT NULL,
  athlete_name TEXT NOT NULL,
  team TEXT NOT NULL,
  opponent TEXT,
  is_home BOOLEAN,
  start_time TIMESTAMPTZ,
  
  -- Core goalie stats
  decision TEXT,                          -- W, L, OTL, or NULL (no decision)
  is_starter BOOLEAN DEFAULT false,
  
  saves INTEGER,
  goals_against INTEGER,
  shots_faced INTEGER,
  save_percentage NUMERIC(5,3),           -- e.g. 0.925
  goals_against_average NUMERIC(5,2),     -- from ESPN (not computed per game)
  time_on_ice TEXT,                        -- "59:42" format from ESPN
  time_on_ice_seconds INTEGER,            -- parsed to seconds for computation
  
  -- Advanced
  even_strength_saves INTEGER,
  even_strength_shots INTEGER,
  power_play_saves INTEGER,
  power_play_shots INTEGER,
  short_handed_saves INTEGER,
  short_handed_shots INTEGER,
  
  -- Game context (denormalized from nhl_postgame for fast joins)
  team_score INTEGER,
  opponent_score INTEGER,
  total_goals INTEGER,                     -- team_score + opponent_score
  dk_total NUMERIC,                        -- line from nhl_postgame
  dk_spread NUMERIC,
  dk_home_ml INTEGER,
  dk_away_ml INTEGER,
  
  -- Betting result columns (computed on insert)
  is_over BOOLEAN,                         -- total_goals > dk_total
  is_under BOOLEAN,                        -- total_goals < dk_total
  is_push_ou BOOLEAN,                      -- total_goals = dk_total
  team_covered BOOLEAN,                    -- team beat the spread
  team_won_ml BOOLEAN,                     -- team won outright
  
  -- Raw stats blob for future parsing
  raw_stats JSONB,
  
  -- Audit
  season_type TEXT DEFAULT 'regular',
  drain_version TEXT DEFAULT 'v1',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(espn_event_id, athlete_id)
);

CREATE INDEX idx_nhl_goalie_logs_athlete ON nhl_goalie_game_logs(athlete_id);
CREATE INDEX idx_nhl_goalie_logs_team ON nhl_goalie_game_logs(team);
CREATE INDEX idx_nhl_goalie_logs_start_time ON nhl_goalie_game_logs(start_time DESC);
CREATE INDEX idx_nhl_goalie_logs_starter ON nhl_goalie_game_logs(is_starter) WHERE is_starter = true;
CREATE INDEX idx_nhl_goalie_logs_match ON nhl_goalie_game_logs(match_id);

-- ============================================================================
-- NHL Period Scores: period-by-period scoring per game
-- ============================================================================
CREATE TABLE IF NOT EXISTS nhl_period_scores (
  id TEXT PRIMARY KEY,                    -- same as nhl_postgame.id
  espn_event_id TEXT NOT NULL,
  home_team TEXT,
  away_team TEXT,
  start_time TIMESTAMPTZ,
  
  -- Period scores (arrays)
  home_periods INTEGER[],                 -- [1, 0, 2] for a 3-2 win
  away_periods INTEGER[],
  
  -- Computed splits
  home_p1_goals INTEGER,
  away_p1_goals INTEGER,
  home_p2_goals INTEGER,
  away_p2_goals INTEGER,
  home_p3_goals INTEGER,
  away_p3_goals INTEGER,
  
  -- First period total
  p1_total_goals INTEGER,                 -- home_p1 + away_p1
  
  -- Regulation total (excludes OT/SO)
  regulation_total INTEGER,
  
  -- OT/SO
  went_to_ot BOOLEAN DEFAULT false,
  went_to_shootout BOOLEAN DEFAULT false,
  ot_home_goals INTEGER,
  ot_away_goals INTEGER,
  
  -- Denormalized line for fast O/U calcs
  dk_total NUMERIC,
  
  -- First period scoring
  p1_scored_first TEXT,                   -- 'home', 'away', or 'neither'
  
  drain_version TEXT DEFAULT 'v1',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_nhl_period_scores_start ON nhl_period_scores(start_time DESC);

-- ============================================================================
-- MV: NHL Goalie Profiles (season-level aggregates for starters)
-- ============================================================================
CREATE MATERIALIZED VIEW mv_nhl_goalie_profiles AS
WITH starter_games AS (
  SELECT 
    g.athlete_id,
    g.athlete_name,
    g.team,
    g.start_time,
    g.saves,
    g.goals_against,
    g.shots_faced,
    g.save_percentage,
    g.time_on_ice_seconds,
    g.decision,
    g.is_home,
    g.total_goals,
    g.dk_total,
    g.dk_spread,
    g.is_over,
    g.is_under,
    g.team_covered,
    g.team_won_ml,
    ROW_NUMBER() OVER (PARTITION BY g.athlete_id ORDER BY g.start_time DESC) as recency
  FROM nhl_goalie_game_logs g
  WHERE g.is_starter = true
    AND g.season_type = 'regular'
),
season_stats AS (
  SELECT
    athlete_id,
    athlete_name,
    team,
    COUNT(*) as starts,
    COUNT(*) FILTER (WHERE decision = 'W') as wins,
    COUNT(*) FILTER (WHERE decision = 'L') as losses,
    COUNT(*) FILTER (WHERE decision = 'OTL') as otl,
    ROUND(AVG(goals_against)::numeric, 2) as avg_goals_against,
    ROUND(AVG(saves)::numeric, 1) as avg_saves,
    ROUND(AVG(shots_faced)::numeric, 1) as avg_shots_faced,
    ROUND(AVG(save_percentage)::numeric, 3) as avg_save_pct,
    ROUND(SUM(goals_against)::numeric / NULLIF(SUM(time_on_ice_seconds)::numeric / 3600, 0), 2) as computed_gaa,
    ROUND(SUM(saves)::numeric / NULLIF(SUM(shots_faced), 0), 3) as computed_sv_pct,
    
    -- Betting records (season)
    COUNT(*) FILTER (WHERE is_over = true) as season_overs,
    COUNT(*) FILTER (WHERE is_under = true) as season_unders,
    COUNT(*) FILTER (WHERE team_covered = true) as season_covers,
    COUNT(*) FILTER (WHERE team_covered = false) as season_non_covers,
    COUNT(*) FILTER (WHERE team_won_ml = true) as season_ml_wins,
    COUNT(*) FILTER (WHERE team_won_ml = false) as season_ml_losses,
    
    -- Home/Road splits
    COUNT(*) FILTER (WHERE is_home = true) as home_starts,
    ROUND(AVG(goals_against) FILTER (WHERE is_home = true)::numeric, 2) as home_avg_ga,
    ROUND(AVG(save_percentage) FILTER (WHERE is_home = true)::numeric, 3) as home_sv_pct,
    COUNT(*) FILTER (WHERE is_home = false) as road_starts,
    ROUND(AVG(goals_against) FILTER (WHERE is_home = false)::numeric, 2) as road_avg_ga,
    ROUND(AVG(save_percentage) FILTER (WHERE is_home = false)::numeric, 3) as road_sv_pct
  FROM starter_games
  GROUP BY athlete_id, athlete_name, team
),
last_5 AS (
  SELECT
    athlete_id,
    COUNT(*) as l5_starts,
    COUNT(*) FILTER (WHERE decision = 'W') as l5_wins,
    COUNT(*) FILTER (WHERE decision = 'L') as l5_losses,
    COUNT(*) FILTER (WHERE decision = 'OTL') as l5_otl,
    ROUND(AVG(goals_against)::numeric, 2) as l5_avg_ga,
    ROUND(AVG(save_percentage)::numeric, 3) as l5_sv_pct,
    COUNT(*) FILTER (WHERE is_over = true) as l5_overs,
    COUNT(*) FILTER (WHERE is_under = true) as l5_unders,
    COUNT(*) FILTER (WHERE team_covered = true) as l5_covers
  FROM starter_games
  WHERE recency <= 5
  GROUP BY athlete_id
),
last_10 AS (
  SELECT
    athlete_id,
    COUNT(*) as l10_starts,
    COUNT(*) FILTER (WHERE decision = 'W') as l10_wins,
    COUNT(*) FILTER (WHERE decision = 'L') as l10_losses,
    COUNT(*) FILTER (WHERE decision = 'OTL') as l10_otl,
    ROUND(AVG(goals_against)::numeric, 2) as l10_avg_ga,
    ROUND(AVG(save_percentage)::numeric, 3) as l10_sv_pct,
    COUNT(*) FILTER (WHERE is_over = true) as l10_overs,
    COUNT(*) FILTER (WHERE is_under = true) as l10_unders,
    COUNT(*) FILTER (WHERE team_covered = true) as l10_covers
  FROM starter_games
  WHERE recency <= 10
  GROUP BY athlete_id
)
SELECT
  s.*,
  
  -- Last 5 window
  l5.l5_starts, l5.l5_wins, l5.l5_losses, l5.l5_otl,
  l5.l5_avg_ga, l5.l5_sv_pct,
  l5.l5_overs, l5.l5_unders, l5.l5_covers,
  
  -- Last 10 window
  l10.l10_starts, l10.l10_wins, l10.l10_losses, l10.l10_otl,
  l10.l10_avg_ga, l10.l10_sv_pct,
  l10.l10_overs, l10.l10_unders, l10.l10_covers,
  
  -- O/U rates
  ROUND(s.season_overs::numeric / NULLIF(s.season_overs + s.season_unders, 0) * 100, 1) as season_over_pct,
  ROUND(s.season_covers::numeric / NULLIF(s.season_covers + s.season_non_covers, 0) * 100, 1) as season_cover_pct,
  ROUND(l10.l10_overs::numeric / NULLIF(l10.l10_overs + l10.l10_unders, 0) * 100, 1) as l10_over_pct,
  ROUND(l5.l5_overs::numeric / NULLIF(l5.l5_overs + l5.l5_unders, 0) * 100, 1) as l5_over_pct
  
FROM season_stats s
LEFT JOIN last_5 l5 ON l5.athlete_id = s.athlete_id
LEFT JOIN last_10 l10 ON l10.athlete_id = s.athlete_id
WHERE s.starts >= 3;

CREATE UNIQUE INDEX idx_mv_nhl_goalie_profiles_athlete ON mv_nhl_goalie_profiles(athlete_id);

-- Grant access
GRANT SELECT ON nhl_goalie_game_logs TO anon, authenticated;
GRANT SELECT ON nhl_period_scores TO anon, authenticated;
GRANT SELECT ON mv_nhl_goalie_profiles TO anon, authenticated;
;
