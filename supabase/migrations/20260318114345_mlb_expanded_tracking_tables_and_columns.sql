
-- =============================================
-- 1. MLB BATTER GAME LOGS (new table)
-- =============================================
CREATE TABLE IF NOT EXISTS mlb_batter_game_logs (
  id text PRIMARY KEY,
  match_id text NOT NULL,
  espn_event_id text,
  athlete_id text NOT NULL,
  athlete_name text NOT NULL,
  team text,
  team_abbr text,
  opponent text,
  is_home boolean,
  game_date timestamptz,
  batting_order int,
  position text,

  -- Core stats
  at_bats int,
  runs int,
  hits int,
  doubles int,
  triples int,
  home_runs int,
  rbi int,
  walks int,
  strikeouts int,
  stolen_bases int,
  caught_stealing int,
  hit_by_pitch int,

  -- Derived
  total_bases int,
  extra_base_hits int,
  batting_avg numeric,
  obp numeric,
  slg numeric,
  ops numeric,

  -- Advanced (from ESPN JSONB)
  isolated_power numeric,        -- ISOP
  secondary_avg numeric,         -- SECA
  runs_created numeric,          -- RC
  runs_created_27 numeric,       -- RC/27
  bb_k_ratio numeric,            -- BB/K
  ab_per_hr numeric,             -- AB/HR
  go_fo_ratio numeric,           -- GO/FO
  sb_pct numeric,                -- SB%
  war numeric,

  -- Props-relevant
  plate_appearances int,
  sac_flies int,
  sac_bunts int,
  gidp int,
  lob int,

  -- Raw blob
  raw_stats jsonb,

  -- Meta
  season_type text,
  drain_version text,
  last_drained_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_mlb_batter_logs_athlete ON mlb_batter_game_logs(athlete_id, game_date DESC);
CREATE INDEX idx_mlb_batter_logs_match ON mlb_batter_game_logs(match_id);
CREATE INDEX idx_mlb_batter_logs_team ON mlb_batter_game_logs(team, game_date DESC);

-- =============================================
-- 2. ADD COLUMNS TO mlb_postgame
-- =============================================

-- Umpire tracking
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_plate_umpire text;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_plate_umpire_id text;

-- Game context
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS day_night text;           -- 'day' or 'night'
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS series_game_number int;   -- 1, 2, 3, 4
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS series_length int;        -- 3 or 4 game series
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS run_line_result text;     -- 'cover', 'push', 'miss'
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_run_line numeric;    -- usually -1.5 or +1.5

-- Parsed team batting (from home_batting_stats JSONB)
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_iso numeric;         -- Isolated Power
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_iso numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_runs_created numeric; -- RC
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_runs_created numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_bb_k numeric;        -- BB/K ratio
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_bb_k numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_xbh int;             -- Extra base hits
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_xbh int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_war_batting numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_war_batting numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_go_fo numeric;       -- Ground out/fly out
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_go_fo numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_sb_pct numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_sb_pct numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_pa int;              -- Plate appearances
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_pa int;

-- Parsed team pitching (from home_pitching_stats JSONB)
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_ground_balls int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_ground_balls int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_fly_balls int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_fly_balls int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_gb_fb_ratio numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_gb_fb_ratio numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_k_9 numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_k_9 numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_k_bb numeric;        -- K/BB ratio
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_k_bb numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_opp_avg numeric;     -- OBA
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_opp_avg numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_opp_obp numeric;     -- OOBP
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_opp_obp numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_opp_slg numeric;     -- OSLUG
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_opp_slg numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_opp_ops numeric;     -- OOPS
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_opp_ops numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_quality_starts int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_quality_starts int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_inherited_runners int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_inherited_runners int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_inherited_scored int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_inherited_scored int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_holds int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_holds int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_blown_saves int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_blown_saves int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_save_opps int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_save_opps int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_tbf int;             -- Total batters faced
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_tbf int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_war_pitching numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_war_pitching numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_run_support numeric; -- RSA
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_run_support numeric;

-- Parsed fielding
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_errors int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_errors int;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_fielding_pct numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_fielding_pct numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS home_dwar numeric;
ALTER TABLE mlb_postgame ADD COLUMN IF NOT EXISTS away_dwar numeric;

-- =============================================
-- 3. ADD COLUMNS TO mlb_pitcher_game_logs
-- =============================================

-- Fill the gaps from the JSONB
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS strikes_thrown int;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS ground_balls_count int;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS fly_balls_count int;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS gb_fb_ratio numeric;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS game_score_value numeric;  -- GSC
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS quality_start boolean;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS total_batters_faced int;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS inherited_runners int;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS inherited_runners_scored int;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS holds int;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS blown_saves int;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS save_opportunities int;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS opp_batting_avg numeric;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS opp_obp numeric;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS opp_slg numeric;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS opp_ops numeric;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS k_per_9 numeric;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS k_bb_ratio numeric;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS pitches_per_inning numeric;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS strike_pct numeric;
ALTER TABLE mlb_pitcher_game_logs ADD COLUMN IF NOT EXISTS war_value numeric;

-- =============================================
-- 4. UMPIRE PROFILES MV
-- =============================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_mlb_umpire_profiles AS
SELECT
  home_plate_umpire,
  home_plate_umpire_id,
  COUNT(*) as games,
  ROUND(AVG(home_score + away_score)::numeric, 1) as avg_total_runs,
  ROUND(AVG(home_hits + away_hits)::numeric, 1) as avg_total_hits,
  ROUND(AVG(home_strikeouts_pitching + away_strikeouts_pitching)::numeric, 1) as avg_total_k,
  ROUND(AVG(home_walks_pitching + away_walks_pitching)::numeric, 1) as avg_total_bb,
  ROUND(AVG(home_home_runs + away_home_runs)::numeric, 1) as avg_total_hr,
  ROUND(AVG(CASE WHEN home_ground_balls IS NOT NULL THEN (home_ground_balls + away_ground_balls)::numeric END), 1) as avg_total_gb,
  ROUND(AVG(CASE WHEN home_fly_balls IS NOT NULL THEN (home_fly_balls + away_fly_balls)::numeric END), 1) as avg_total_fb,
  -- O/U tracking
  SUM(CASE WHEN dk_total IS NOT NULL AND (home_score + away_score) > dk_total THEN 1 ELSE 0 END) as overs,
  SUM(CASE WHEN dk_total IS NOT NULL AND (home_score + away_score) < dk_total THEN 1 ELSE 0 END) as unders,
  SUM(CASE WHEN dk_total IS NOT NULL AND (home_score + away_score) = dk_total THEN 1 ELSE 0 END) as pushes,
  ROUND(
    CASE WHEN SUM(CASE WHEN dk_total IS NOT NULL THEN 1 ELSE 0 END) > 0
    THEN SUM(CASE WHEN dk_total IS NOT NULL AND (home_score + away_score) > dk_total THEN 1 ELSE 0 END)::numeric 
         / SUM(CASE WHEN dk_total IS NOT NULL THEN 1 ELSE 0 END)
    END, 3
  ) as over_rate
FROM mlb_postgame
WHERE home_plate_umpire IS NOT NULL
GROUP BY home_plate_umpire, home_plate_umpire_id
HAVING COUNT(*) >= 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mlb_umpire_id ON mv_mlb_umpire_profiles(home_plate_umpire_id);
;
