
-- NBA HOT STREAKS SEED DATA (Jan 2026)

INSERT INTO player_prop_streaks (
    player_id, player_name, team, sport, prop_type, streak_type, 
    streak_count, threshold, avg_value, last_game_date, is_active
) VALUES 
('2334', 'Kevin Durant', 'Phoenix Suns', 'NBA', 'points', 'OVER', 5, 26.5, 31.2, '2025-12-31', TRUE),
('4240394', 'Luka Doncic', 'Dallas Mavericks', 'NBA', 'assists', 'OVER', 4, 9.5, 11.4, '2025-12-30', TRUE),
('4277905', 'Jayson Tatum', 'Boston Celtics', 'NBA', 'threes_made', 'OVER', 6, 3.5, 5.0, '2025-12-31', TRUE),
('110', 'Nikola Jokic', 'Denver Nuggets', 'NBA', 'pra', 'OVER', 3, 44.5, 51.3, '2025-12-29', TRUE),
('3975', 'Stephen Curry', 'Golden State Warriors', 'NBA', 'points', 'UNDER', 3, 28.5, 21.0, '2025-12-30', TRUE),
('4395628', 'Anthony Edwards', 'Minnesota Timberwolves', 'NBA', 'points', 'OVER', 4, 25.5, 29.8, '2025-12-31', TRUE),
('4277811', 'Shai Gilgeous-Alexander', 'Oklahoma City Thunder', 'NBA', 'steals', 'OVER', 3, 1.5, 3.0, '2025-12-28', TRUE);

ON CONFLICT (player_id, prop_type, streak_type, threshold) DO UPDATE SET
    streak_count = EXCLUDED.streak_count,
    avg_value = EXCLUDED.avg_value,
    last_game_date = EXCLUDED.last_game_date,
    is_active = EXCLUDED.is_active;
