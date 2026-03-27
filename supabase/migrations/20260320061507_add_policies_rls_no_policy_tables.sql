
-- Add policies to tables that have RLS enabled but zero policies
-- These are ESPN/NCAAMB pipeline tables — service_role write + public read

-- ESPN tables
CREATE POLICY "service_role_all" ON public.espn_athletes FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.espn_athletes FOR SELECT USING (true);

CREATE POLICY "service_role_all" ON public.espn_drain_log FOR ALL USING ((select auth.role()) = 'service_role');

CREATE POLICY "service_role_all" ON public.espn_enrichment FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.espn_enrichment FOR SELECT USING (true);

CREATE POLICY "service_role_all" ON public.espn_game_logs FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.espn_game_logs FOR SELECT USING (true);

CREATE POLICY "service_role_all" ON public.espn_league_leaders FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.espn_league_leaders FOR SELECT USING (true);

CREATE POLICY "service_role_all" ON public.espn_stats_drain_log FOR ALL USING ((select auth.role()) = 'service_role');

CREATE POLICY "service_role_all" ON public.espn_team_season_stats FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.espn_team_season_stats FOR SELECT USING (true);

-- NCAAMB tables
CREATE POLICY "service_role_all" ON public.ncaamb_games FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.ncaamb_games FOR SELECT USING (true);

CREATE POLICY "service_role_all" ON public.ncaamb_ingest_log FOR ALL USING ((select auth.role()) = 'service_role');

CREATE POLICY "service_role_all" ON public.ncaamb_player_props FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.ncaamb_player_props FOR SELECT USING (true);

CREATE POLICY "service_role_all" ON public.ncaamb_team_odds FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.ncaamb_team_odds FOR SELECT USING (true);
;
