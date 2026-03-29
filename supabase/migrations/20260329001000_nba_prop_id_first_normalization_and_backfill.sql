-- NBA prop identity hardening:
-- 1) outcomes matching: ID-first with name fallback even when ID is present
-- 2) cache aggregation: group by identity key (espn_player_id first, normalized name fallback)
-- 3) one-time additive backfill to normalize existing player_prop_bets names/ids and dedupe identity collisions

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.refresh_player_prop_outcomes(date)'::regprocedure)
    INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'refresh_player_prop_outcomes(date) not found';
  END IF;

  -- Always allow normalized name fallback, even when espn_player_id is present.
  v_def := regexp_replace(
    v_def,
    '\(bp\.espn_player_id IS NOT NULL AND pgs\.espn_player_id = bp\.espn_player_id\)\s+OR\s+\(bp\.espn_player_id IS NULL AND public\.norm_name_key\(pgs\.player_name\) = public\.norm_name_key\(bp\.player_name\)\)',
    '(bp.espn_player_id IS NOT NULL AND pgs.espn_player_id = bp.espn_player_id)
          OR public.norm_name_key(pgs.player_name) = public.norm_name_key(bp.player_name)',
    'g'
  );

  -- Keep strict ID-first ordering, then exact normalized-name match, then team/minutes tie-breakers.
  v_def := regexp_replace(
    v_def,
    'CASE WHEN bp\.espn_player_id IS NOT NULL AND pgs\.espn_player_id = bp\.espn_player_id THEN 0 ELSE 1 END,\s+CASE WHEN bp\.team IS NOT NULL AND public\.norm_name_key\(pgs\.team\) = public\.norm_name_key\(bp\.team\) THEN 0 ELSE 1 END,',
    'CASE WHEN bp.espn_player_id IS NOT NULL AND pgs.espn_player_id = bp.espn_player_id THEN 0 ELSE 1 END,
        CASE WHEN public.norm_name_key(pgs.player_name) = public.norm_name_key(bp.player_name) THEN 0 ELSE 1 END,
        CASE WHEN bp.team IS NOT NULL AND public.norm_name_key(pgs.team) = public.norm_name_key(bp.team) THEN 0 ELSE 1 END,',
    'g'
  );

  IF position('OR public.norm_name_key(pgs.player_name) = public.norm_name_key(bp.player_name)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Failed to patch refresh_player_prop_outcomes(date): expected fallback clause not found';
  END IF;

  EXECUTE v_def;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_prop_hit_rate_cache_by_league(
  p_league text DEFAULT 'mlb',
  p_since_date date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
  v_league text := lower(coalesce(p_league, 'mlb'));
BEGIN
  IF p_since_date IS NULL THEN
    DELETE FROM public.prop_hit_rate_cache
    WHERE lower(coalesce(league_id, '')) = v_league;
  ELSE
    DELETE FROM public.prop_hit_rate_cache
    WHERE lower(coalesce(league_id, '')) = v_league
      AND (last_game_date IS NULL OR last_game_date >= p_since_date);
  END IF;

  WITH src AS (
    SELECT
      NULLIF(trim(o.espn_player_id::text), '') AS espn_player_id,
      o.player_name,
      CASE
        WHEN NULLIF(trim(o.espn_player_id::text), '') IS NOT NULL
          THEN 'id:' || NULLIF(trim(o.espn_player_id::text), '')
        ELSE 'name:' || public.norm_name_key(o.player_name)
      END AS player_identity_key,
      lower(o.bet_type) AS bet_type,
      o.line_value::numeric AS line_bucket,
      lower(o.side) AS side,
      lower(o.result) AS result,
      o.actual_value,
      o.margin,
      o.venue,
      o.opponent,
      o.season_phase,
      o.game_date,
      o.season
    FROM public.player_prop_outcomes o
    WHERE lower(coalesce(o.league_id, '')) = v_league
      AND lower(coalesce(o.result, '')) IN ('won', 'lost', 'push')
      AND o.game_date IS NOT NULL
      AND (p_since_date IS NULL OR o.game_date >= p_since_date)
  ),
  expanded AS (
    SELECT espn_player_id, player_name, player_identity_key, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'all'::text AS context_key, 'all'::text AS context_value
    FROM src
    UNION ALL
    SELECT espn_player_id, player_name, player_identity_key, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'venue', coalesce(venue, 'UNKNOWN')
    FROM src
    WHERE venue IS NOT NULL
    UNION ALL
    SELECT espn_player_id, player_name, player_identity_key, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'opponent', coalesce(opponent, 'UNKNOWN')
    FROM src
    WHERE opponent IS NOT NULL
    UNION ALL
    SELECT espn_player_id, player_name, player_identity_key, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'season_phase', coalesce(season_phase, 'UNKNOWN')
    FROM src
    WHERE season_phase IS NOT NULL
  ),
  name_choice AS (
    SELECT
      t.player_identity_key,
      t.player_name
    FROM (
      SELECT
        e.player_identity_key,
        e.player_name,
        row_number() OVER (
          PARTITION BY e.player_identity_key
          ORDER BY count(*) DESC, length(e.player_name) DESC, max(e.game_date) DESC, max(e.player_name) DESC
        ) AS rn
      FROM expanded e
      WHERE e.player_name IS NOT NULL
        AND btrim(e.player_name) <> ''
      GROUP BY e.player_identity_key, e.player_name
    ) t
    WHERE t.rn = 1
  ),
  agg AS (
    SELECT
      e.player_identity_key,
      max(e.espn_player_id) FILTER (WHERE e.espn_player_id IS NOT NULL) AS espn_player_id,
      max(e.player_name) FILTER (WHERE e.player_name IS NOT NULL AND btrim(e.player_name) <> '') AS fallback_player_name,
      v_league AS league_id,
      max(e.season) AS season,
      e.bet_type,
      e.line_bucket,
      e.context_key,
      e.context_value,
      count(*)::int AS games,
      sum(CASE WHEN (e.side = 'over' AND e.result = 'won') OR (e.side = 'under' AND e.result = 'lost') THEN 1 ELSE 0 END)::int AS overs,
      sum(CASE WHEN (e.side = 'under' AND e.result = 'won') OR (e.side = 'over' AND e.result = 'lost') THEN 1 ELSE 0 END)::int AS unders,
      sum(CASE WHEN e.result = 'push' THEN 1 ELSE 0 END)::int AS pushes,
      round(100.0 * avg(CASE WHEN (e.side = 'over' AND e.result = 'won') OR (e.side = 'under' AND e.result = 'lost') THEN 1.0 ELSE 0.0 END), 2) AS over_pct,
      round(avg(e.actual_value)::numeric, 3) AS avg_actual,
      round(avg(e.margin)::numeric, 3) AS avg_margin,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY e.actual_value)::numeric, 3) AS median_actual,
      max(e.game_date) AS last_game_date
    FROM expanded e
    GROUP BY e.player_identity_key, e.bet_type, e.line_bucket, e.context_key, e.context_value
  )
  INSERT INTO public.prop_hit_rate_cache (
    espn_player_id,
    player_name,
    league_id,
    season,
    bet_type,
    line_bucket,
    context_key,
    context_value,
    games,
    overs,
    unders,
    pushes,
    over_pct,
    avg_actual,
    avg_margin,
    median_actual,
    last_game_date,
    updated_at
  )
  SELECT
    a.espn_player_id,
    coalesce(nc.player_name, a.fallback_player_name, 'UNKNOWN') AS player_name,
    a.league_id,
    a.season,
    a.bet_type,
    a.line_bucket,
    a.context_key,
    a.context_value,
    a.games,
    a.overs,
    a.unders,
    a.pushes,
    a.over_pct,
    a.avg_actual,
    a.avg_margin,
    a.median_actual,
    a.last_game_date,
    now()
  FROM agg a
  LEFT JOIN name_choice nc
    ON nc.player_identity_key = a.player_identity_key;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_prop_hit_rate_cache_by_league(text, date) TO service_role;

-- One-time idempotent cleanup: remove duplicate market rows that differ only by player name punctuation/format.
WITH ranked AS (
  SELECT
    pb.id,
    row_number() OVER (
      PARTITION BY
        pb.match_id,
        lower(coalesce(pb.bet_type, '')),
        lower(coalesce(pb.side, '')),
        lower(coalesce(pb.provider, '')),
        coalesce(NULLIF(trim(pb.espn_player_id::text), ''), 'name:' || public.norm_name_key(pb.player_name))
      ORDER BY
        CASE WHEN NULLIF(trim(pb.espn_player_id::text), '') IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN pb.player_name LIKE '%.%' THEN 0 ELSE 1 END,
        coalesce(pb.updated_at, pb.last_updated) DESC NULLS LAST,
        pb.id DESC
    ) AS rn
  FROM public.player_prop_bets pb
  WHERE lower(coalesce(pb.league, '')) = 'nba'
    AND pb.match_id LIKE '%_nba'
    AND lower(coalesce(pb.bet_type, '')) IN (
      'points', 'threes_made', 'rebounds', 'assists', 'pra',
      'pts_rebs', 'pts_asts', 'steals', 'blocks', 'turnovers', 'fantasy_score'
    )
    AND lower(coalesce(pb.side, '')) IN ('over', 'under')
)
DELETE FROM public.player_prop_bets pb
USING ranked r
WHERE pb.id = r.id
  AND r.rn > 1;

-- Canonicalize existing NBA player_prop_bets rows to ID-first identity and ESPN display naming.
WITH mapped AS (
  SELECT
    pb.id,
    NULLIF(trim(pgs.espn_player_id::text), '') AS canonical_espn_player_id,
    pgs.player_name AS canonical_player_name,
    row_number() OVER (
      PARTITION BY pb.id
      ORDER BY
        CASE
          WHEN NULLIF(trim(pb.espn_player_id::text), '') IS NOT NULL
           AND pgs.espn_player_id::text = trim(pb.espn_player_id::text)
            THEN 0
          ELSE 1
        END,
        CASE
          WHEN public.norm_name_key(pgs.player_name) = public.norm_name_key(pb.player_name)
            THEN 0
          ELSE 1
        END,
        CASE
          WHEN pb.team IS NOT NULL AND public.norm_name_key(pgs.team) = public.norm_name_key(pb.team)
            THEN 0
          ELSE 1
        END,
        coalesce(pgs.minutes, 0) DESC
    ) AS rn
  FROM public.player_prop_bets pb
  JOIN public.player_game_stats pgs
    ON pgs.match_id = pb.match_id
   AND (
        (NULLIF(trim(pb.espn_player_id::text), '') IS NOT NULL AND pgs.espn_player_id::text = trim(pb.espn_player_id::text))
        OR public.norm_name_key(pgs.player_name) = public.norm_name_key(pb.player_name)
   )
  WHERE lower(coalesce(pb.league, '')) = 'nba'
    AND pb.match_id LIKE '%_nba'
    AND lower(coalesce(pb.bet_type, '')) IN (
      'points', 'threes_made', 'rebounds', 'assists', 'pra',
      'pts_rebs', 'pts_asts', 'steals', 'blocks', 'turnovers', 'fantasy_score'
    )
    AND lower(coalesce(pb.side, '')) IN ('over', 'under')
)
UPDATE public.player_prop_bets pb
SET
  espn_player_id = coalesce(pb.espn_player_id, mapped.canonical_espn_player_id),
  player_id = coalesce(pb.player_id, mapped.canonical_espn_player_id),
  player_name = coalesce(mapped.canonical_player_name, pb.player_name)
FROM mapped
WHERE pb.id = mapped.id
  AND mapped.rn = 1
  AND (
    pb.player_name IS DISTINCT FROM coalesce(mapped.canonical_player_name, pb.player_name)
    OR pb.espn_player_id IS DISTINCT FROM coalesce(pb.espn_player_id, mapped.canonical_espn_player_id)
    OR pb.player_id IS DISTINCT FROM coalesce(pb.player_id, mapped.canonical_espn_player_id)
  );

-- Re-dedupe after canonicalization in case aliases converged to the same canonical player identity.
WITH ranked AS (
  SELECT
    pb.id,
    row_number() OVER (
      PARTITION BY
        pb.match_id,
        lower(coalesce(pb.bet_type, '')),
        lower(coalesce(pb.side, '')),
        lower(coalesce(pb.provider, '')),
        coalesce(NULLIF(trim(pb.espn_player_id::text), ''), 'name:' || public.norm_name_key(pb.player_name))
      ORDER BY
        CASE WHEN NULLIF(trim(pb.espn_player_id::text), '') IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN pb.player_name LIKE '%.%' THEN 0 ELSE 1 END,
        coalesce(pb.updated_at, pb.last_updated) DESC NULLS LAST,
        pb.id DESC
    ) AS rn
  FROM public.player_prop_bets pb
  WHERE lower(coalesce(pb.league, '')) = 'nba'
    AND pb.match_id LIKE '%_nba'
    AND lower(coalesce(pb.bet_type, '')) IN (
      'points', 'threes_made', 'rebounds', 'assists', 'pra',
      'pts_rebs', 'pts_asts', 'steals', 'blocks', 'turnovers', 'fantasy_score'
    )
    AND lower(coalesce(pb.side, '')) IN ('over', 'under')
)
DELETE FROM public.player_prop_bets pb
USING ranked r
WHERE pb.id = r.id
  AND r.rn > 1;
