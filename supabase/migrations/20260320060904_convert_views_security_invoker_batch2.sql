
-- Convert SECURITY DEFINER views to SECURITY INVOKER (batch 2: research + market views)
ALTER VIEW public.v_basketball_timeout_response_research_grade SET (security_invoker = on);
ALTER VIEW public.v_basketball_timeout_response_summary SET (security_invoker = on);
ALTER VIEW public.v_clob_repricing_delta SET (security_invoker = on);
ALTER VIEW public.v_dk_risk_steam_maturity SET (security_invoker = on);
ALTER VIEW public.v_entity_mapping_duplicates_espn SET (security_invoker = on);
ALTER VIEW public.v_entity_mapping_gaps SET (security_invoker = on);
ALTER VIEW public.v_espn_extreme_triggers SET (security_invoker = on);
ALTER VIEW public.v_first_goal_repricing SET (security_invoker = on);
ALTER VIEW public.v_first_goal_repricing_clean SET (security_invoker = on);
ALTER VIEW public.v_five_stream_convergence SET (security_invoker = on);
ALTER VIEW public.v_identity_gaps SET (security_invoker = on);
ALTER VIEW public.v_kalshi_book_timeseries SET (security_invoker = on);
;
