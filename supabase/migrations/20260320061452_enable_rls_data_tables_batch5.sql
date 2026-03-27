
-- Enable RLS on remaining tables (intel + WC + misc)

-- Intel / analysis tables
ALTER TABLE public.book_repricing_extremes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claude_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_intel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.confluence_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.importance_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.injury_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.narrative_intel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pinnacle_divergence_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poly_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regime_intel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.espn_probe_results ENABLE ROW LEVEL SECURITY;

-- WC tables
ALTER TABLE public.wc_base_camps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wc_group_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wc_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wc_knockout_bracket ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wc_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wc_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wc_travel_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wc_venues ENABLE ROW LEVEL SECURITY;

-- Policies for intel tables (service write + public read)
CREATE POLICY "service_role_all" ON public.book_repricing_extremes FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.book_repricing_extremes FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.claude_picks FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.claude_picks FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.coaching_intel FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.coaching_intel FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.confluence_signals FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.confluence_signals FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.importance_context FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.importance_context FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.injury_snapshots FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.injury_snapshots FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.narrative_intel FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.narrative_intel FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.pinnacle_divergence_signals FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.pinnacle_divergence_signals FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.poly_price_history FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.poly_price_history FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.regime_intel FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.regime_intel FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.espn_probe_results FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.espn_probe_results FOR SELECT USING (true);

-- Policies for WC tables (service write + public read)
CREATE POLICY "service_role_all" ON public.wc_base_camps FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.wc_base_camps FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.wc_group_standings FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.wc_group_standings FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.wc_groups FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.wc_groups FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.wc_knockout_bracket FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.wc_knockout_bracket FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.wc_matches FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.wc_matches FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.wc_teams FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.wc_teams FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.wc_travel_log FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.wc_travel_log FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.wc_venues FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.wc_venues FOR SELECT USING (true);
;
