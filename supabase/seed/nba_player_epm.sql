-- NBA Player EPM Seed Data (2025-26 Season)
-- Source: Dunks & Threes / EPM approximations
-- Top ~100 players by EPM for lineup adjustment calculations

INSERT INTO nba_player_epm (season, player_id, team, epm, updated_at)
VALUES
  -- Elite Tier (EPM > 6.0)
  ('2025-26', 'nikola_jokic', 'Denver Nuggets', 9.2, NOW()),
  ('2025-26', 'shai_gilgeous_alexander', 'Oklahoma City Thunder', 8.5, NOW()),
  ('2025-26', 'luka_doncic', 'Dallas Mavericks', 7.8, NOW()),
  ('2025-26', 'giannis_antetokounmpo', 'Milwaukee Bucks', 7.5, NOW()),
  ('2025-26', 'jayson_tatum', 'Boston Celtics', 7.2, NOW()),
  ('2025-26', 'anthony_davis', 'Los Angeles Lakers', 6.8, NOW()),
  ('2025-26', 'stephen_curry', 'Golden State Warriors', 6.5, NOW()),
  ('2025-26', 'anthony_edwards', 'Minnesota Timberwolves', 6.3, NOW()),
  ('2025-26', 'tyrese_haliburton', 'Indiana Pacers', 6.1, NOW()),
  
  -- Star Tier (EPM 4.0-6.0)
  ('2025-26', 'jaylen_brown', 'Boston Celtics', 5.8, NOW()),
  ('2025-26', 'donovan_mitchell', 'Cleveland Cavaliers', 5.5, NOW()),
  ('2025-26', 'lebron_james', 'Los Angeles Lakers', 5.3, NOW()),
  ('2025-26', 'kevin_durant', 'Phoenix Suns', 5.2, NOW()),
  ('2025-26', 'devin_booker', 'Phoenix Suns', 5.0, NOW()),
  ('2025-26', 'joel_embiid', 'Philadelphia 76ers', 4.8, NOW()),
  ('2025-26', 'kawhi_leonard', 'LA Clippers', 4.7, NOW()),
  ('2025-26', 'chet_holmgren', 'Oklahoma City Thunder', 4.5, NOW()),
  ('2025-26', 'paolo_banchero', 'Orlando Magic', 4.3, NOW()),
  ('2025-26', 'franz_wagner', 'Orlando Magic', 4.2, NOW()),
  ('2025-26', 'domantas_sabonis', 'Sacramento Kings', 4.1, NOW()),
  ('2025-26', 'jalen_brunson', 'New York Knicks', 4.0, NOW()),
  
  -- Above Average (EPM 2.0-4.0)
  ('2025-26', 'victor_wembanyama', 'San Antonio Spurs', 3.8, NOW()),
  ('2025-26', 'ja_morant', 'Memphis Grizzlies', 3.7, NOW()),
  ('2025-26', 'jimmy_butler', 'Miami Heat', 3.5, NOW()),
  ('2025-26', 'bam_adebayo', 'Miami Heat', 3.4, NOW()),
  ('2025-26', 'trae_young', 'Atlanta Hawks', 3.3, NOW()),
  ('2025-26', 'dejounte_murray', 'New Orleans Pelicans', 3.2, NOW()),
  ('2025-26', 'zion_williamson', 'New Orleans Pelicans', 3.1, NOW()),
  ('2025-26', 'de_aaron_fox', 'Sacramento Kings', 3.0, NOW()),
  ('2025-26', 'lauri_markkanen', 'Utah Jazz', 2.9, NOW()),
  ('2025-26', 'jalen_williams', 'Oklahoma City Thunder', 2.8, NOW()),
  ('2025-26', 'evan_mobley', 'Cleveland Cavaliers', 2.7, NOW()),
  ('2025-26', 'pascal_siakam', 'Indiana Pacers', 2.6, NOW()),
  ('2025-26', 'scottie_barnes', 'Toronto Raptors', 2.5, NOW()),
  ('2025-26', 'alperen_sengun', 'Houston Rockets', 2.4, NOW()),
  ('2025-26', 'mikal_bridges', 'New York Knicks', 2.3, NOW()),
  ('2025-26', 'derrick_white', 'Boston Celtics', 2.2, NOW()),
  ('2025-26', 'kristaps_porzingis', 'Boston Celtics', 2.1, NOW()),
  ('2025-26', 'jarrett_allen', 'Cleveland Cavaliers', 2.0, NOW()),
  
  -- Average Starters (EPM 0.0-2.0)
  ('2025-26', 'kyrie_irving', 'Dallas Mavericks', 1.8, NOW()),
  ('2025-26', 'damian_lillard', 'Milwaukee Bucks', 1.7, NOW()),
  ('2025-26', 'paul_george', 'Philadelphia 76ers', 1.6, NOW()),
  ('2025-26', 'fred_vanvleet', 'Houston Rockets', 1.5, NOW()),
  ('2025-26', 'draymond_green', 'Golden State Warriors', 1.4, NOW()),
  ('2025-26', 'rudy_gobert', 'Minnesota Timberwolves', 1.3, NOW()),
  ('2025-26', 'cade_cunningham', 'Detroit Pistons', 1.2, NOW()),
  ('2025-26', 'austin_reaves', 'Los Angeles Lakers', 1.1, NOW()),
  ('2025-26', 'tyler_herro', 'Miami Heat', 1.0, NOW()),
  ('2025-26', 'myles_turner', 'Indiana Pacers', 0.9, NOW()),
  ('2025-26', 'jrue_holiday', 'Boston Celtics', 0.8, NOW()),
  ('2025-26', 'anfernee_simons', 'Portland Trail Blazers', 0.7, NOW()),
  ('2025-26', 'deandre_ayton', 'Portland Trail Blazers', 0.6, NOW()),
  ('2025-26', 'brandon_ingram', 'New Orleans Pelicans', 0.5, NOW()),
  ('2025-26', 'og_anunoby', 'New York Knicks', 0.4, NOW()),
  ('2025-26', 'khris_middleton', 'Milwaukee Bucks', 0.3, NOW()),
  ('2025-26', 'herbert_jones', 'New Orleans Pelicans', 0.2, NOW()),
  ('2025-26', 'andrew_wiggins', 'Golden State Warriors', 0.1, NOW()),
  ('2025-26', 'brook_lopez', 'Milwaukee Bucks', 0.0, NOW()),
  
  -- Below Average (EPM -2.0 to 0.0)
  ('2025-26', 'lamelo_ball', 'Charlotte Hornets', -0.2, NOW()),
  ('2025-26', 'jordan_poole', 'Washington Wizards', -0.5, NOW()),
  ('2025-26', 'cam_thomas', 'Brooklyn Nets', -0.8, NOW()),
  ('2025-26', 'ben_simmons', 'Brooklyn Nets', -1.0, NOW()),
  ('2025-26', 'markelle_fultz', 'Orlando Magic', -1.2, NOW()),
  ('2025-26', 'kyle_kuzma', 'Washington Wizards', -1.5, NOW())
ON CONFLICT (season, player_id) DO UPDATE SET
  team = EXCLUDED.team,
  epm = EXCLUDED.epm,
  updated_at = NOW();

-- Verify the data
SELECT team, COUNT(*) as player_count, ROUND(AVG(epm)::numeric, 2) as avg_epm
FROM nba_player_epm 
WHERE season = '2025-26'
GROUP BY team
ORDER BY avg_epm DESC;
