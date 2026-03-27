
-- Enable RLS on remaining data tables (service write + public read)
-- Kalshi / prediction market tables
ALTER TABLE public.kalshi_events_active ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kalshi_line_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kalshi_orderbook_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kalshi_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kalshi_team_map ENABLE ROW LEVEL SECURITY;

-- Match / game data
ALTER TABLE public.match_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_edge_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_provider_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_officials ENABLE ROW LEVEL SECURITY;

-- Config / reference tables
ALTER TABLE public.canonical_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trend_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trend_ledger ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "service_role_all" ON public.kalshi_events_active FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.kalshi_events_active FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.kalshi_line_markets FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.kalshi_line_markets FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.kalshi_orderbook_snapshots FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.kalshi_orderbook_snapshots FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.kalshi_settlements FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.kalshi_settlements FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.kalshi_team_map FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.kalshi_team_map FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.match_outcomes FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.match_outcomes FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.match_edge_tags FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.match_edge_tags FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.game_provider_mappings FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.game_provider_mappings FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.game_officials FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.game_officials FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.canonical_teams FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.canonical_teams FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.league_config FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.league_config FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.sport_configurations FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.sport_configurations FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.venue_aliases FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.venue_aliases FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.trend_definitions FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.trend_definitions FOR SELECT USING (true);
CREATE POLICY "service_role_all" ON public.trend_ledger FOR ALL USING ((select auth.role()) = 'service_role');
CREATE POLICY "public_read" ON public.trend_ledger FOR SELECT USING (true);
;
