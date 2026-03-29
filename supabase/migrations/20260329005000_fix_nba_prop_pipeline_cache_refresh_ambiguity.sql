-- Fix ambiguous overload resolution in public.run_player_prop_pipeline(date).
-- Some environments now contain multiple refresh_prop_hit_rate_cache overloads.
-- Calling refresh_prop_hit_rate_cache() without explicit signature can fail with:
--   function public.refresh_prop_hit_rate_cache() is not unique
-- This keeps NBA behavior explicit and stable.

CREATE OR REPLACE FUNCTION public.run_player_prop_pipeline(p_since_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_gc integer := 0;
  v_ptl integer := 0;
  v_ppo integer := 0;
  v_cache integer := 0;
BEGIN
  v_gc := public.refresh_game_context(p_since_date);
  v_ptl := public.refresh_player_teammate_log(p_since_date);
  v_ppo := public.refresh_player_prop_outcomes(p_since_date);
  v_cache := public.refresh_prop_hit_rate_cache_by_league('nba', p_since_date);

  RETURN jsonb_build_object(
    'game_context_upserts', v_gc,
    'player_teammate_log_upserts', v_ptl,
    'player_prop_outcomes_upserts', v_ppo,
    'prop_hit_rate_cache_rows', v_cache,
    'ran_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_player_prop_pipeline(date) TO service_role;
