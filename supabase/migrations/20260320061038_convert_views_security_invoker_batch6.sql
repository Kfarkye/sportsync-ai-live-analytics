
-- Convert SECURITY DEFINER views to SECURITY INVOKER (batch 6: titan + wc + final views)
ALTER VIEW public.v_todays_middle_alerts SET (security_invoker = on);
ALTER VIEW public.v_trigger_hedge_windows SET (security_invoker = on);
ALTER VIEW public.v_trigger_performance_summary SET (security_invoker = on);
ALTER VIEW public.v_wc26_venue_graph SET (security_invoker = on);
ALTER VIEW public.vw_titan_api_gateway SET (security_invoker = on);
ALTER VIEW public.vw_titan_buckets SET (security_invoker = on);
ALTER VIEW public.vw_titan_heatmap SET (security_invoker = on);
ALTER VIEW public.vw_titan_leagues SET (security_invoker = on);
ALTER VIEW public.vw_titan_master SET (security_invoker = on);
ALTER VIEW public.vw_titan_summary SET (security_invoker = on);
ALTER VIEW public.vw_titan_trends SET (security_invoker = on);
ALTER VIEW public.wc_historical_dashboard SET (security_invoker = on);
ALTER VIEW public.wc_third_place_race SET (security_invoker = on);
;
