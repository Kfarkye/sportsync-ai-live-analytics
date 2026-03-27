
-- Fix mutable search_path batch 6: update + upsert + _ut functions
ALTER FUNCTION public.update_coaches_timestamp() SET search_path = '';
ALTER FUNCTION public.update_communication_template_metadata() SET search_path = '';
ALTER FUNCTION public.update_game_recaps_updated_at() SET search_path = '';
ALTER FUNCTION public.update_llm_picks_timestamp() SET search_path = '';
ALTER FUNCTION public.update_player_streak(text, text, text, text, text, text, numeric, numeric, text, date) SET search_path = '';
ALTER FUNCTION public.update_poly_odds_timestamp() SET search_path = '';
ALTER FUNCTION public.update_poly_props_timestamp() SET search_path = '';
ALTER FUNCTION public.update_smr_timestamp() SET search_path = '';
ALTER FUNCTION public.update_soccer_postgame_timestamp() SET search_path = '';
ALTER FUNCTION public.upsert_game_state_atomic(jsonb, jsonb, jsonb) SET search_path = '';
;
