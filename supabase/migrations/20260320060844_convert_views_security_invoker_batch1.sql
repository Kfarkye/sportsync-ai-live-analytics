
-- Convert SECURITY DEFINER views to SECURITY INVOKER (batch 1: pick + analytics views)
ALTER VIEW public.clean_picks SET (security_invoker = on);
ALTER VIEW public.odds_health_audit SET (security_invoker = on);
ALTER VIEW public.pick_record_by_sport SET (security_invoker = on);
ALTER VIEW public.pick_record_daily SET (security_invoker = on);
ALTER VIEW public.pick_record_overall SET (security_invoker = on);
ALTER VIEW public.pick_today_detail SET (security_invoker = on);
ALTER VIEW public.pregame_intel_record SET (security_invoker = on);
ALTER VIEW public.v_ai_match_context SET (security_invoker = on);
ALTER VIEW public.v_ai_schedule_manifest SET (security_invoker = on);
ALTER VIEW public.v_arb_opportunities SET (security_invoker = on);
ALTER VIEW public.v_canonical_coverage SET (security_invoker = on);
ALTER VIEW public.v_canonical_drift_recent SET (security_invoker = on);
;
