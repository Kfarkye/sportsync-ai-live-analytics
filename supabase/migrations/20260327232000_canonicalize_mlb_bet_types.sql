-- One-time canonicalization for MLB prop bet types.
-- Legacy -> canonical mapping:
--   hits        -> batter_hits
--   total_bases -> batter_total_bases
--   strikeouts  -> pitcher_strikeouts

DO $$
DECLARE
  v_deleted_conflicts integer := 0;
  v_updated_bets integer := 0;
  v_updated_outcomes integer := 0;
  v_updated_cache integer := 0;
BEGIN
  WITH map AS (
    SELECT 'hits'::text AS legacy, 'batter_hits'::text AS canonical
    UNION ALL SELECT 'total_bases', 'batter_total_bases'
    UNION ALL SELECT 'strikeouts', 'pitcher_strikeouts'
  ),
  conflicts AS (
    SELECT l.id
    FROM public.player_prop_bets l
    JOIN map m
      ON lower(coalesce(l.bet_type, '')) = m.legacy
    JOIN public.player_prop_bets c
      ON c.match_id = l.match_id
     AND c.player_name = l.player_name
     AND c.side = l.side
     AND coalesce(c.provider, '') = coalesce(l.provider, '')
     AND lower(coalesce(c.bet_type, '')) = m.canonical
    WHERE lower(coalesce(l.league, '')) = 'mlb'
  )
  DELETE FROM public.player_prop_bets d
  USING conflicts x
  WHERE d.id = x.id;

  GET DIAGNOSTICS v_deleted_conflicts = ROW_COUNT;

  UPDATE public.player_prop_bets
  SET bet_type = CASE lower(coalesce(bet_type, ''))
    WHEN 'hits' THEN 'batter_hits'
    WHEN 'total_bases' THEN 'batter_total_bases'
    WHEN 'strikeouts' THEN 'pitcher_strikeouts'
    ELSE bet_type
  END
  WHERE lower(coalesce(league, '')) = 'mlb'
    AND lower(coalesce(bet_type, '')) IN ('hits', 'total_bases', 'strikeouts');

  GET DIAGNOSTICS v_updated_bets = ROW_COUNT;

  UPDATE public.player_prop_outcomes
  SET bet_type = CASE lower(coalesce(bet_type, ''))
    WHEN 'hits' THEN 'batter_hits'
    WHEN 'total_bases' THEN 'batter_total_bases'
    WHEN 'strikeouts' THEN 'pitcher_strikeouts'
    ELSE bet_type
  END
  WHERE lower(coalesce(league_id, '')) = 'mlb'
    AND lower(coalesce(bet_type, '')) IN ('hits', 'total_bases', 'strikeouts');

  GET DIAGNOSTICS v_updated_outcomes = ROW_COUNT;

  UPDATE public.prop_hit_rate_cache
  SET bet_type = CASE lower(coalesce(bet_type, ''))
    WHEN 'hits' THEN 'batter_hits'
    WHEN 'total_bases' THEN 'batter_total_bases'
    WHEN 'strikeouts' THEN 'pitcher_strikeouts'
    ELSE bet_type
  END
  WHERE lower(coalesce(league_id, '')) = 'mlb'
    AND lower(coalesce(bet_type, '')) IN ('hits', 'total_bases', 'strikeouts');

  GET DIAGNOSTICS v_updated_cache = ROW_COUNT;

  RAISE NOTICE 'MLB canonicalization: deleted_conflicts=%, updated_bets=%, updated_outcomes=%, updated_cache=%',
    v_deleted_conflicts, v_updated_bets, v_updated_outcomes, v_updated_cache;
END;
$$;
