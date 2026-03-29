-- NBA player attachment hardening:
-- 1) persistent alias map table for player prop identity resolution
-- 2) refresh function to seed unambiguous alias rows from player_game_stats + player_prop_bets
-- 3) one-time canonicalization pass for existing NBA player_prop_bets rows missing/weak identity

CREATE TABLE IF NOT EXISTS public.player_prop_identity_aliases (
  id bigserial PRIMARY KEY,
  league_id text NOT NULL,
  espn_player_id text NOT NULL,
  canonical_player_name text NOT NULL,
  alias_name text NOT NULL,
  alias_key text NOT NULL,
  team_name text,
  team_key text NOT NULL DEFAULT '',
  sample_count integer NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'auto_seed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_player_prop_identity_aliases_scope
  ON public.player_prop_identity_aliases (league_id, alias_key, team_key);

CREATE INDEX IF NOT EXISTS idx_player_prop_identity_aliases_player
  ON public.player_prop_identity_aliases (league_id, espn_player_id);

CREATE OR REPLACE FUNCTION public.refresh_player_prop_identity_aliases(p_league text DEFAULT 'nba')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
  v_league text := lower(coalesce(p_league, 'nba'));
BEGIN
  DELETE FROM public.player_prop_identity_aliases
  WHERE league_id = v_league
    AND source LIKE 'auto_%';

  WITH pgs_source AS (
    SELECT
      lower(coalesce(pgs.league_id, '')) AS league_id,
      NULLIF(trim(pgs.espn_player_id::text), '') AS espn_player_id,
      NULLIF(trim(pgs.player_name), '') AS alias_name,
      NULLIF(trim(pgs.team), '') AS team_name,
      public.norm_name_key(pgs.player_name) AS alias_key,
      public.norm_name_key(pgs.team) AS team_key,
      'auto_pgs_observed'::text AS source
    FROM public.player_game_stats pgs
    WHERE lower(coalesce(pgs.league_id, '')) = v_league
      AND NULLIF(trim(pgs.espn_player_id::text), '') IS NOT NULL
      AND NULLIF(trim(pgs.player_name), '') IS NOT NULL
  ),
  pgs_initial_last AS (
    SELECT
      pgs.league_id,
      pgs.espn_player_id,
      CONCAT(
        upper(left(split_part(pgs.alias_name, ' ', 1), 1)),
        '. ',
        (
          regexp_split_to_array(trim(pgs.alias_name), '\s+')
        )[array_length(regexp_split_to_array(trim(pgs.alias_name), '\s+'), 1)]
      ) AS alias_name,
      pgs.team_name,
      public.norm_name_key(
        CONCAT(
          left(split_part(pgs.alias_name, ' ', 1), 1),
          (
            regexp_split_to_array(trim(pgs.alias_name), '\s+')
          )[array_length(regexp_split_to_array(trim(pgs.alias_name), '\s+'), 1)]
        )
      ) AS alias_key,
      pgs.team_key,
      'auto_pgs_initial_last'::text AS source
    FROM pgs_source pgs
    WHERE pgs.alias_name IS NOT NULL
      AND array_length(regexp_split_to_array(trim(pgs.alias_name), '\s+'), 1) >= 2
  ),
  pb_source AS (
    SELECT
      lower(coalesce(pb.league, '')) AS league_id,
      NULLIF(trim(pb.espn_player_id::text), '') AS espn_player_id,
      NULLIF(trim(pb.player_name), '') AS alias_name,
      NULLIF(trim(pb.team), '') AS team_name,
      public.norm_name_key(pb.player_name) AS alias_key,
      public.norm_name_key(pb.team) AS team_key,
      'auto_bets_observed'::text AS source
    FROM public.player_prop_bets pb
    WHERE lower(coalesce(pb.league, '')) = v_league
      AND NULLIF(trim(pb.espn_player_id::text), '') IS NOT NULL
      AND NULLIF(trim(pb.player_name), '') IS NOT NULL
      AND lower(coalesce(pb.bet_type, '')) IN (
        'points', 'threes_made', 'rebounds', 'assists', 'pra',
        'pts_rebs', 'pts_asts', 'steals', 'blocks', 'turnovers', 'fantasy_score'
      )
  ),
  alias_candidates AS (
    SELECT * FROM pgs_source
    UNION ALL
    SELECT * FROM pgs_initial_last
    UNION ALL
    SELECT * FROM pb_source
  ),
  canonical_name_choice AS (
    SELECT
      c.league_id,
      c.espn_player_id,
      c.alias_name AS canonical_player_name
    FROM (
      SELECT
        ac.league_id,
        ac.espn_player_id,
        ac.alias_name,
        row_number() OVER (
          PARTITION BY ac.league_id, ac.espn_player_id
          ORDER BY count(*) DESC, length(ac.alias_name) DESC, max(ac.alias_name) DESC
        ) AS rn
      FROM alias_candidates ac
      WHERE ac.alias_name IS NOT NULL
        AND ac.alias_name <> ''
      GROUP BY ac.league_id, ac.espn_player_id, ac.alias_name
    ) c
    WHERE c.rn = 1
  ),
  team_scoped AS (
    SELECT
      ac.league_id,
      ac.alias_key,
      ac.team_key,
      min(ac.team_name) AS team_name,
      max(ac.espn_player_id) AS espn_player_id,
      count(*)::int AS sample_count,
      count(DISTINCT ac.espn_player_id) AS id_count
    FROM alias_candidates ac
    WHERE ac.alias_key IS NOT NULL
      AND ac.alias_key <> ''
      AND ac.team_key IS NOT NULL
      AND ac.team_key <> ''
      AND ac.espn_player_id IS NOT NULL
    GROUP BY ac.league_id, ac.alias_key, ac.team_key
  ),
  global_scoped AS (
    SELECT
      ac.league_id,
      ac.alias_key,
      ''::text AS team_key,
      NULL::text AS team_name,
      max(ac.espn_player_id) AS espn_player_id,
      count(*)::int AS sample_count,
      count(DISTINCT ac.espn_player_id) AS id_count
    FROM alias_candidates ac
    WHERE ac.alias_key IS NOT NULL
      AND ac.alias_key <> ''
      AND ac.espn_player_id IS NOT NULL
    GROUP BY ac.league_id, ac.alias_key
  ),
  eligible AS (
    SELECT league_id, alias_key, team_key, team_name, espn_player_id, sample_count
    FROM team_scoped
    WHERE id_count = 1
    UNION ALL
    SELECT league_id, alias_key, team_key, team_name, espn_player_id, sample_count
    FROM global_scoped
    WHERE id_count = 1
  )
  INSERT INTO public.player_prop_identity_aliases (
    league_id,
    espn_player_id,
    canonical_player_name,
    alias_name,
    alias_key,
    team_name,
    team_key,
    sample_count,
    source,
    created_at,
    updated_at
  )
  SELECT
    e.league_id,
    e.espn_player_id,
    coalesce(cn.canonical_player_name, e.alias_key) AS canonical_player_name,
    coalesce(cn.canonical_player_name, e.alias_key) AS alias_name,
    e.alias_key,
    e.team_name,
    e.team_key,
    e.sample_count,
    'auto_seed'::text AS source,
    now(),
    now()
  FROM eligible e
  LEFT JOIN canonical_name_choice cn
    ON cn.league_id = e.league_id
   AND cn.espn_player_id = e.espn_player_id
  ON CONFLICT (league_id, alias_key, team_key)
  DO UPDATE SET
    espn_player_id = EXCLUDED.espn_player_id,
    canonical_player_name = EXCLUDED.canonical_player_name,
    alias_name = EXCLUDED.alias_name,
    team_name = EXCLUDED.team_name,
    sample_count = EXCLUDED.sample_count,
    source = EXCLUDED.source,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_player_prop_identity_aliases(text) TO service_role;

CREATE OR REPLACE FUNCTION public.backfill_nba_player_prop_attachment_batch(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  WITH mapped AS (
    SELECT
      pb.id,
      pia.espn_player_id AS canonical_espn_player_id,
      row_number() OVER (
        PARTITION BY pb.id
        ORDER BY
          CASE
            WHEN pia.team_key <> '' AND pia.team_key = public.norm_name_key(coalesce(pb.team, '')) THEN 0
            ELSE 1
          END,
          pia.sample_count DESC,
          pia.updated_at DESC
      ) AS rn
    FROM public.player_prop_bets pb
    JOIN public.player_prop_identity_aliases pia
      ON pia.league_id = lower(coalesce(pb.league, ''))
     AND pia.alias_key = public.norm_name_key(pb.player_name)
     AND (
          pia.team_key = ''
          OR pia.team_key = public.norm_name_key(coalesce(pb.team, ''))
     )
    WHERE lower(coalesce(pb.league, '')) = 'nba'
      AND pb.match_id LIKE '%_nba'
      AND lower(coalesce(pb.bet_type, '')) IN (
        'points', 'threes_made', 'rebounds', 'assists', 'pra',
        'pts_rebs', 'pts_asts', 'steals', 'blocks', 'turnovers', 'fantasy_score'
      )
      AND lower(coalesce(pb.side, '')) IN ('over', 'under')
      AND (
        NULLIF(trim(pb.espn_player_id::text), '') IS NULL
        OR public.norm_name_key(pb.player_name) <> public.norm_name_key(pia.canonical_player_name)
      )
  ),
  chosen AS (
    SELECT
      m.id,
      m.canonical_espn_player_id
    FROM mapped m
    WHERE m.rn = 1
    ORDER BY m.id
    LIMIT GREATEST(coalesce(p_limit, 5000), 1)
  ),
  updated AS (
    UPDATE public.player_prop_bets pb
    SET
      espn_player_id = c.canonical_espn_player_id,
      player_id = coalesce(pb.player_id, c.canonical_espn_player_id)
    FROM chosen c
    WHERE pb.id = c.id
      AND (
        pb.espn_player_id IS DISTINCT FROM c.canonical_espn_player_id
        OR pb.player_id IS DISTINCT FROM coalesce(pb.player_id, c.canonical_espn_player_id)
      )
    RETURNING 1
  )
  SELECT count(*)::int INTO v_rows
  FROM updated;

  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_nba_player_prop_attachment_batch(integer) TO service_role;
