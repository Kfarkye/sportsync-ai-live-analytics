
-- Convert SECURITY DEFINER views to SECURITY INVOKER (batch 4: postgame + trend + soccer views)
ALTER VIEW public.v_nhl_postgame_compat SET (security_invoker = on);
ALTER VIEW public.v_overshoot_summary SET (security_invoker = on);
ALTER VIEW public.v_page_worthy_ats_trends SET (security_invoker = on);
ALTER VIEW public.v_page_worthy_ou_trends SET (security_invoker = on);
ALTER VIEW public.v_pbp_event_market_context SET (security_invoker = on);
ALTER VIEW public.v_pbp_events_normalized SET (security_invoker = on);
ALTER VIEW public.v_pickcenter_lines SET (security_invoker = on);
ALTER VIEW public.v_poly_live SET (security_invoker = on);
ALTER VIEW public.v_poly_moneyline SET (security_invoker = on);
ALTER VIEW public.v_postgame_canonical_gaps SET (security_invoker = on);
ALTER VIEW public.v_pregame_clv_summary SET (security_invoker = on);
ALTER VIEW public.v_pregame_middle_opportunities SET (security_invoker = on);
;
