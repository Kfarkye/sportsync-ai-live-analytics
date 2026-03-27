
-- Enable RLS on data tables (service write + public read)
-- These are core data tables queried by the frontend or views

-- Postgame tables
ALTER TABLE public.nba_postgame ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_postgame ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_postgame ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mlb_postgame ENABLE ROW LEVEL SECURITY;

-- Odds / market data tables
ALTER TABLE public.espn_core_odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.espn_summary_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.first_half_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.futures_odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_context_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_odds_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_total_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_movement_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_halftime_odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_halftime_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v3_odds_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_market_snapshots ENABLE ROW LEVEL SECURITY;

-- Service ALL + public read policies
CREATE POLICY "service_role_all" ON public.nba_postgame FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.nba_postgame FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.nhl_postgame FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.nhl_postgame FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.nfl_postgame FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.nfl_postgame FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.mlb_postgame FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.mlb_postgame FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.espn_core_odds FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.espn_core_odds FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.espn_summary_snapshots FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.espn_summary_snapshots FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.first_half_lines FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.first_half_lines FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.futures_odds FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.futures_odds FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.live_context_snapshots FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.live_context_snapshots FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.live_odds_snapshots FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.live_odds_snapshots FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.live_total_ranges FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.live_total_ranges FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.line_movement_triggers FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.line_movement_triggers FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.match_halftime_odds FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.match_halftime_odds FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.match_halftime_scores FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.match_halftime_scores FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.v3_odds_snapshots FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.v3_odds_snapshots FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.price_snapshots FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.price_snapshots FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.prediction_market_snapshots FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.prediction_market_snapshots FOR SELECT USING (true);
;
