-- Preserve prop display names in MLB outcomes so same-name players can remain disambiguated
-- for downstream cache keys that currently key on player_name.

DO $$
DECLARE
  v_def text;
  v_old text := 'COALESCE(bm.athlete_name, pm.athlete_name, bp.player_name) AS out_player_name,';
  v_new text := 'COALESCE(NULLIF(bp.player_name, ''''), bm.athlete_name, pm.athlete_name) AS out_player_name,';
BEGIN
  SELECT pg_get_functiondef('public.refresh_mlb_prop_outcomes(date)'::regprocedure)
    INTO v_def;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Expected function fragment not found; aborting safe rewrite';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$$;

GRANT EXECUTE ON FUNCTION public.refresh_mlb_prop_outcomes(date) TO service_role;
