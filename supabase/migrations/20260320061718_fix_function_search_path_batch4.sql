
-- Fix mutable search_path batch 4: invoke + jsonb + kalshi + mark + match + nba functions
ALTER FUNCTION public.invoke_soccer_1h_odds_tracker() SET search_path = '';
ALTER FUNCTION public.invoke_sync_player_props() SET search_path = '';
ALTER FUNCTION public.jsonb_numeric_key(jsonb, text) SET search_path = '';
ALTER FUNCTION public.kalshi_team_match_score(text, text) SET search_path = '';
ALTER FUNCTION public.mark_stale_intel() SET search_path = '';
ALTER FUNCTION public.match_chat_knowledge(vector, double precision, integer) SET search_path = '';
ALTER FUNCTION public.nba_clock_to_seconds(text) SET search_path = '';
ALTER FUNCTION public.nba_context_exposure_tier(bigint, bigint, integer, integer) SET search_path = '';
ALTER FUNCTION public.nba_elapsed_minutes(integer, text) SET search_path = '';
ALTER FUNCTION public.nba_game_script_class(integer, numeric, integer, text, text, text, integer, integer, text) SET search_path = '';
ALTER FUNCTION public.nba_intentional_foul_likelihood_class(integer, numeric, integer, integer, integer, integer, integer) SET search_path = '';
ALTER FUNCTION public.nba_observed_pace_48(jsonb, integer, text) SET search_path = '';
ALTER FUNCTION public.nba_observed_possessions(jsonb) SET search_path = '';
ALTER FUNCTION public.nba_observed_team_possessions(jsonb, text) SET search_path = '';
ALTER FUNCTION public.nba_probability_bucket(numeric) SET search_path = '';
ALTER FUNCTION public.nba_progress_bucket(numeric) SET search_path = '';
ALTER FUNCTION public.nba_remaining_minute_bucket(numeric) SET search_path = '';
ALTER FUNCTION public.nba_remaining_minutes(integer, text) SET search_path = '';
ALTER FUNCTION public.nba_remaining_possessions_v2(jsonb, integer, text, numeric, integer, integer, integer, integer, integer, text, text, text) SET search_path = '';
ALTER FUNCTION public.nba_score_diff_bucket(numeric) SET search_path = '';
ALTER FUNCTION public.normalize_entity_id(text) SET search_path = '';
ALTER FUNCTION public.normalize_probability(numeric) SET search_path = '';
ALTER FUNCTION public.normalize_team_slug(text) SET search_path = '';
ALTER FUNCTION public.parse_record(text) SET search_path = '';
ALTER FUNCTION public.parse_spread_magnitude(text) SET search_path = '';
;
