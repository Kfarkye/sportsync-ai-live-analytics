
-- Fix mutable search_path on custom functions (batch 1: utility + odds functions)
-- Setting search_path to '' prevents search_path injection attacks

ALTER FUNCTION public._extract_prop_stat(jsonb, text, text) SET search_path = '';
ALTER FUNCTION public._insert_halftime_odds_safe(text, text, text, text, text, text, text, text, text, text, numeric) SET search_path = '';
ALTER FUNCTION public._odds_backfill_tick() SET search_path = '';
ALTER FUNCTION public._odds_fire_batch(integer) SET search_path = '';
ALTER FUNCTION public._odds_process_responses() SET search_path = '';
ALTER FUNCTION public._parse_goal_minute(text) SET search_path = '';
ALTER FUNCTION public._pbp_backfill_tick() SET search_path = '';
ALTER FUNCTION public._pbp_fire_batch(integer) SET search_path = '';
ALTER FUNCTION public._pbp_process_responses() SET search_path = '';
ALTER FUNCTION public._phase0_clamp_numeric(numeric, numeric) SET search_path = '';
ALTER FUNCTION public._phase0_to_numeric(text) SET search_path = '';
ALTER FUNCTION public._phase0_uuid_from_text(text) SET search_path = '';
ALTER FUNCTION public.acquire_ingest_lock(text, integer) SET search_path = '';
ALTER FUNCTION public.acquire_intel_lease(text, integer, integer) SET search_path = '';
ALTER FUNCTION public.american_implied_probability(numeric) SET search_path = '';
ALTER FUNCTION public.american_to_implied(integer) SET search_path = '';
ALTER FUNCTION public.auto_score_entry_signals(date) SET search_path = '';
ALTER FUNCTION public.baseball_ip_to_outs(text) SET search_path = '';
ALTER FUNCTION public.baseball_outs_to_ip(numeric) SET search_path = '';
ALTER FUNCTION public.baseball_runs_through_inning(integer[], integer) SET search_path = '';
ALTER FUNCTION public.baseball_runs_through_inning(jsonb, integer) SET search_path = '';
ALTER FUNCTION public.baseball_safe_numeric(text) SET search_path = '';
ALTER FUNCTION public.bulk_update_match_odds(jsonb) SET search_path = '';
ALTER FUNCTION public.calculate_intel_signal(numeric, numeric, numeric, timestamptz) SET search_path = '';
ALTER FUNCTION public.capture_all_upcoming_prices() SET search_path = '';
ALTER FUNCTION public.capture_price_snapshot(text) SET search_path = '';
ALTER FUNCTION public.capture_soccer_live_odds_snapshots(integer, integer) SET search_path = '';
ALTER FUNCTION public.check_period_0_timing() SET search_path = '';
ALTER FUNCTION public.cleanup_old_nba_data() SET search_path = '';
;
