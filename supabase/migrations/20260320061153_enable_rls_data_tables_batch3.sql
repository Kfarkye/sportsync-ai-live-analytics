
-- Enable RLS on remaining data tables (service write + public read)

-- Soccer data tables
ALTER TABLE public.soccer_bet365_team_odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soccer_extended_market_odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soccer_match_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soccer_player_odds ENABLE ROW LEVEL SECURITY;

-- Player / team data tables
ALTER TABLE public.player_impact_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_match_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_betting_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_game_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_tempo ENABLE ROW LEVEL SECURITY;

-- MLB extra
ALTER TABLE public.mlb_batter_game_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mlb_inning_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mlb_pitcher_game_logs ENABLE ROW LEVEL SECURITY;

-- NHL extra
ALTER TABLE public.nhl_goalie_game_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_period_scores ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "service_role_all" ON public.soccer_bet365_team_odds FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.soccer_bet365_team_odds FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.soccer_extended_market_odds FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.soccer_extended_market_odds FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.soccer_match_result FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.soccer_match_result FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.soccer_player_odds FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.soccer_player_odds FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.player_impact_cache FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.player_impact_cache FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.player_match_ratings FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.player_match_ratings FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.team_betting_records FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.team_betting_records FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.team_game_context FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.team_game_context FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.team_mappings FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.team_mappings FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.team_rosters FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.team_rosters FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.team_tempo FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.team_tempo FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.mlb_batter_game_logs FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.mlb_batter_game_logs FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.mlb_inning_scores FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.mlb_inning_scores FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.mlb_pitcher_game_logs FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.mlb_pitcher_game_logs FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.nhl_goalie_game_logs FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.nhl_goalie_game_logs FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.nhl_period_scores FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.nhl_period_scores FOR SELECT USING (true);
;
