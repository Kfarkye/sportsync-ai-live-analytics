
-- Convert SECURITY DEFINER views to SECURITY INVOKER (batch 5: remaining views)
ALTER VIEW public.v_quarter_volatility_profiles SET (security_invoker = on);
ALTER VIEW public.v_ready_for_intel SET (security_invoker = on);
ALTER VIEW public.v_red_card_market_shift SET (security_invoker = on);
ALTER VIEW public.v_red_card_market_shift_clean SET (security_invoker = on);
ALTER VIEW public.v_soccer_first_goal_repricing_research_grade SET (security_invoker = on);
ALTER VIEW public.v_soccer_first_goal_repricing_summary SET (security_invoker = on);
ALTER VIEW public.v_soccer_postgame_compat SET (security_invoker = on);
ALTER VIEW public.v_soccer_red_card_market_shift_research_grade SET (security_invoker = on);
ALTER VIEW public.v_soccer_red_card_market_shift_summary SET (security_invoker = on);
ALTER VIEW public.v_source_divergence SET (security_invoker = on);
ALTER VIEW public.v_timeout_response_basketball SET (security_invoker = on);
ALTER VIEW public.v_timeout_response_basketball_clean SET (security_invoker = on);
;
