SELECT count(*) FROM player_prop_bets;
SELECT match_id, player_name, bet_type, line_value, odds_american, generated_at FROM player_prop_bets ORDER BY generated_at DESC LIMIT 20;
