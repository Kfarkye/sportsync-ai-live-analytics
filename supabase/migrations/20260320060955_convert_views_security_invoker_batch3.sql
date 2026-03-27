
-- Convert SECURITY DEFINER views to SECURITY INVOKER (batch 3: kalshi + live + market views)
ALTER VIEW public.v_kalshi_event_flow SET (security_invoker = on);
ALTER VIEW public.v_kalshi_market_match_map SET (security_invoker = on);
ALTER VIEW public.v_live_market_snapshots_unified SET (security_invoker = on);
ALTER VIEW public.v_live_middle_alerts SET (security_invoker = on);
ALTER VIEW public.v_match_halftime_odds_market_status SET (security_invoker = on);
ALTER VIEW public.v_matches_canonical_gaps SET (security_invoker = on);
ALTER VIEW public.v_matches_canonical_mismatches SET (security_invoker = on);
ALTER VIEW public.v_middle_trigger_patterns SET (security_invoker = on);
ALTER VIEW public.v_mlb_postgame_compat SET (security_invoker = on);
ALTER VIEW public.v_nba_postgame_compat SET (security_invoker = on);
ALTER VIEW public.v_nba_probability_context_base SET (security_invoker = on);
ALTER VIEW public.v_nfl_postgame_compat SET (security_invoker = on);
;
