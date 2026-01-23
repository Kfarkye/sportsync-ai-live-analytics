-- NBA Team Priors Seed Data
-- Source: Basketball Reference / Cleaning the Glass approximations
-- These are regressed, clamped expectations for the v3.0 engine
-- Includes both 2024-25 and 2025-26 seasons

-- ============================================================================
-- 2024-25 SEASON (Historical - for calibration/backtest)
-- ============================================================================

INSERT INTO nba_team_priors (season, team, pace_pre48, exp_3pa_rate, exp_3p_pct, exp_2p_pct, exp_ftr, exp_tov_pct, exp_orb_pct)
VALUES
  -- Eastern Conference (2024-25)
  ('2024-25', 'Boston Celtics', 99.5, 0.42, 0.38, 0.54, 0.24, 0.12, 0.24),
  ('2024-25', 'Milwaukee Bucks', 100.2, 0.38, 0.37, 0.55, 0.28, 0.13, 0.26),
  ('2024-25', 'Philadelphia 76ers', 98.8, 0.36, 0.36, 0.53, 0.30, 0.14, 0.25),
  ('2024-25', 'Cleveland Cavaliers', 97.5, 0.35, 0.37, 0.56, 0.26, 0.12, 0.27),
  ('2024-25', 'New York Knicks', 98.0, 0.34, 0.36, 0.52, 0.25, 0.13, 0.28),
  ('2024-25', 'Brooklyn Nets', 99.0, 0.40, 0.35, 0.51, 0.23, 0.14, 0.23),
  ('2024-25', 'Miami Heat', 97.2, 0.38, 0.36, 0.53, 0.27, 0.13, 0.24),
  ('2024-25', 'Atlanta Hawks', 100.5, 0.37, 0.35, 0.52, 0.26, 0.14, 0.25),
  ('2024-25', 'Chicago Bulls', 98.5, 0.33, 0.35, 0.51, 0.24, 0.13, 0.26),
  ('2024-25', 'Toronto Raptors', 99.8, 0.36, 0.34, 0.50, 0.25, 0.14, 0.25),
  ('2024-25', 'Indiana Pacers', 102.5, 0.39, 0.37, 0.55, 0.23, 0.12, 0.24),
  ('2024-25', 'Orlando Magic', 96.5, 0.34, 0.34, 0.52, 0.28, 0.13, 0.28),
  ('2024-25', 'Charlotte Hornets', 99.2, 0.38, 0.33, 0.49, 0.24, 0.15, 0.24),
  ('2024-25', 'Washington Wizards', 100.0, 0.37, 0.33, 0.48, 0.25, 0.15, 0.25),
  ('2024-25', 'Detroit Pistons', 98.0, 0.35, 0.33, 0.49, 0.26, 0.14, 0.26),
  
  -- Western Conference (2024-25)
  ('2024-25', 'Denver Nuggets', 98.2, 0.35, 0.37, 0.56, 0.26, 0.12, 0.27),
  ('2024-25', 'Oklahoma City Thunder', 99.8, 0.40, 0.37, 0.54, 0.25, 0.12, 0.26),
  ('2024-25', 'Minnesota Timberwolves', 97.0, 0.38, 0.36, 0.53, 0.27, 0.13, 0.28),
  ('2024-25', 'Phoenix Suns', 98.5, 0.37, 0.36, 0.54, 0.25, 0.13, 0.24),
  ('2024-25', 'LA Clippers', 97.8, 0.39, 0.37, 0.53, 0.26, 0.13, 0.25),
  ('2024-25', 'Los Angeles Lakers', 99.2, 0.35, 0.35, 0.54, 0.28, 0.14, 0.26),
  ('2024-25', 'Sacramento Kings', 100.8, 0.36, 0.36, 0.54, 0.24, 0.13, 0.25),
  ('2024-25', 'Golden State Warriors', 99.5, 0.41, 0.38, 0.52, 0.24, 0.14, 0.24),
  ('2024-25', 'Dallas Mavericks', 98.0, 0.42, 0.37, 0.53, 0.26, 0.13, 0.25),
  ('2024-25', 'New Orleans Pelicans', 99.0, 0.34, 0.35, 0.54, 0.27, 0.13, 0.27),
  ('2024-25', 'Houston Rockets', 98.5, 0.39, 0.34, 0.51, 0.26, 0.14, 0.28),
  ('2024-25', 'Memphis Grizzlies', 100.2, 0.33, 0.34, 0.52, 0.27, 0.14, 0.29),
  ('2024-25', 'Utah Jazz', 99.5, 0.40, 0.34, 0.50, 0.25, 0.14, 0.26),
  ('2024-25', 'San Antonio Spurs', 98.8, 0.36, 0.33, 0.50, 0.27, 0.15, 0.27),
  ('2024-25', 'Portland Trail Blazers', 99.0, 0.38, 0.33, 0.49, 0.25, 0.15, 0.25)
ON CONFLICT (season, team) DO UPDATE SET
  pace_pre48 = EXCLUDED.pace_pre48,
  exp_3pa_rate = EXCLUDED.exp_3pa_rate,
  exp_3p_pct = EXCLUDED.exp_3p_pct,
  exp_2p_pct = EXCLUDED.exp_2p_pct,
  exp_ftr = EXCLUDED.exp_ftr,
  exp_tov_pct = EXCLUDED.exp_tov_pct,
  exp_orb_pct = EXCLUDED.exp_orb_pct,
  updated_at = NOW();

-- ============================================================================
-- 2025-26 SEASON (Current - for live production)
-- Note: These are projected/early-season estimates. Update weekly via calibration.
-- ============================================================================

INSERT INTO nba_team_priors (season, team, pace_pre48, exp_3pa_rate, exp_3p_pct, exp_2p_pct, exp_ftr, exp_tov_pct, exp_orb_pct)
VALUES
  -- Eastern Conference (2025-26)
  ('2025-26', 'Boston Celtics', 99.8, 0.43, 0.38, 0.55, 0.23, 0.11, 0.24),
  ('2025-26', 'Milwaukee Bucks', 99.5, 0.39, 0.37, 0.54, 0.27, 0.13, 0.26),
  ('2025-26', 'Philadelphia 76ers', 98.2, 0.37, 0.36, 0.53, 0.29, 0.13, 0.25),
  ('2025-26', 'Cleveland Cavaliers', 98.0, 0.36, 0.38, 0.56, 0.25, 0.12, 0.27),
  ('2025-26', 'New York Knicks', 97.5, 0.35, 0.37, 0.53, 0.26, 0.12, 0.28),
  ('2025-26', 'Brooklyn Nets', 100.2, 0.41, 0.34, 0.50, 0.24, 0.14, 0.23),
  ('2025-26', 'Miami Heat', 96.8, 0.39, 0.36, 0.52, 0.26, 0.13, 0.25),
  ('2025-26', 'Atlanta Hawks', 101.0, 0.38, 0.35, 0.52, 0.25, 0.14, 0.25),
  ('2025-26', 'Chicago Bulls', 98.0, 0.34, 0.35, 0.51, 0.25, 0.13, 0.26),
  ('2025-26', 'Toronto Raptors', 100.5, 0.37, 0.34, 0.50, 0.24, 0.14, 0.25),
  ('2025-26', 'Indiana Pacers', 103.0, 0.40, 0.37, 0.55, 0.22, 0.12, 0.24),
  ('2025-26', 'Orlando Magic', 96.0, 0.35, 0.35, 0.53, 0.27, 0.12, 0.29),
  ('2025-26', 'Charlotte Hornets', 99.5, 0.39, 0.33, 0.49, 0.23, 0.15, 0.24),
  ('2025-26', 'Washington Wizards', 100.5, 0.38, 0.32, 0.48, 0.24, 0.15, 0.25),
  ('2025-26', 'Detroit Pistons', 99.0, 0.36, 0.34, 0.50, 0.25, 0.14, 0.27),
  
  -- Western Conference (2025-26)
  ('2025-26', 'Denver Nuggets', 97.8, 0.36, 0.37, 0.55, 0.25, 0.12, 0.27),
  ('2025-26', 'Oklahoma City Thunder', 100.5, 0.41, 0.38, 0.55, 0.24, 0.11, 0.27),
  ('2025-26', 'Minnesota Timberwolves', 96.5, 0.39, 0.36, 0.52, 0.26, 0.13, 0.28),
  ('2025-26', 'Phoenix Suns', 98.0, 0.38, 0.36, 0.53, 0.24, 0.13, 0.24),
  ('2025-26', 'LA Clippers', 97.2, 0.40, 0.36, 0.52, 0.25, 0.13, 0.25),
  ('2025-26', 'Los Angeles Lakers', 99.5, 0.36, 0.35, 0.54, 0.27, 0.13, 0.26),
  ('2025-26', 'Sacramento Kings', 101.2, 0.37, 0.36, 0.54, 0.23, 0.13, 0.25),
  ('2025-26', 'Golden State Warriors', 99.0, 0.42, 0.37, 0.52, 0.23, 0.14, 0.24),
  ('2025-26', 'Dallas Mavericks', 98.5, 0.43, 0.37, 0.53, 0.25, 0.12, 0.25),
  ('2025-26', 'New Orleans Pelicans', 98.5, 0.35, 0.35, 0.53, 0.26, 0.13, 0.27),
  ('2025-26', 'Houston Rockets', 99.0, 0.40, 0.35, 0.52, 0.25, 0.13, 0.29),
  ('2025-26', 'Memphis Grizzlies', 101.0, 0.34, 0.35, 0.53, 0.26, 0.13, 0.29),
  ('2025-26', 'Utah Jazz', 100.0, 0.41, 0.33, 0.49, 0.24, 0.14, 0.26),
  ('2025-26', 'San Antonio Spurs', 99.2, 0.37, 0.34, 0.51, 0.26, 0.14, 0.27),
  ('2025-26', 'Portland Trail Blazers', 99.5, 0.39, 0.33, 0.49, 0.24, 0.15, 0.25)
ON CONFLICT (season, team) DO UPDATE SET
  pace_pre48 = EXCLUDED.pace_pre48,
  exp_3pa_rate = EXCLUDED.exp_3pa_rate,
  exp_3p_pct = EXCLUDED.exp_3p_pct,
  exp_2p_pct = EXCLUDED.exp_2p_pct,
  exp_ftr = EXCLUDED.exp_ftr,
  exp_tov_pct = EXCLUDED.exp_tov_pct,
  exp_orb_pct = EXCLUDED.exp_orb_pct,
  updated_at = NOW();

-- Verify the data was inserted
SELECT season, COUNT(*) as team_count FROM nba_team_priors GROUP BY season ORDER BY season;
