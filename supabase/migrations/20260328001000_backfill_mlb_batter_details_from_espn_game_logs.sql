-- Backfill missing MLB batter detail fields from espn_game_logs (additive, idempotent).
-- Precedence: keep existing mlb_batter_game_logs non-null values; only fill nulls.
-- TB precedence: existing total_bases -> espn_game_logs TB -> computed from components -> computed from SLG*AB.

WITH espn_logs AS (
  SELECT DISTINCT ON (
    egl.espn_event_id,
    COALESCE(
      NULLIF(BTRIM(egl.espn_athlete_id), ''),
      REGEXP_REPLACE(NULLIF(BTRIM(egl.athlete_id), ''), '_[a-z0-9.]+$', '', 'i')
    )
  )
    egl.espn_event_id,
    COALESCE(
      NULLIF(BTRIM(egl.espn_athlete_id), ''),
      REGEXP_REPLACE(NULLIF(BTRIM(egl.athlete_id), ''), '_[a-z0-9.]+$', '', 'i')
    ) AS athlete_id_norm,
    CASE WHEN BTRIM(COALESCE(egl.stats->>'AB', '')) ~ '^-?\\d+$' THEN (BTRIM(egl.stats->>'AB'))::int ELSE NULL END AS at_bats,
    CASE WHEN BTRIM(COALESCE(egl.stats->>'H', '')) ~ '^-?\\d+$' THEN (BTRIM(egl.stats->>'H'))::int ELSE NULL END AS hits,
    CASE WHEN BTRIM(COALESCE(egl.stats->>'2B', '')) ~ '^-?\\d+$' THEN (BTRIM(egl.stats->>'2B'))::int ELSE NULL END AS doubles,
    CASE WHEN BTRIM(COALESCE(egl.stats->>'3B', '')) ~ '^-?\\d+$' THEN (BTRIM(egl.stats->>'3B'))::int ELSE NULL END AS triples,
    CASE WHEN BTRIM(COALESCE(egl.stats->>'HR', '')) ~ '^-?\\d+$' THEN (BTRIM(egl.stats->>'HR'))::int ELSE NULL END AS home_runs,
    CASE WHEN BTRIM(COALESCE(egl.stats->>'SB', '')) ~ '^-?\\d+$' THEN (BTRIM(egl.stats->>'SB'))::int ELSE NULL END AS stolen_bases,
    CASE WHEN BTRIM(COALESCE(egl.stats->>'CS', '')) ~ '^-?\\d+$' THEN (BTRIM(egl.stats->>'CS'))::int ELSE NULL END AS caught_stealing,
    CASE WHEN BTRIM(COALESCE(egl.stats->>'HBP', '')) ~ '^-?\\d+$' THEN (BTRIM(egl.stats->>'HBP'))::int ELSE NULL END AS hit_by_pitch,
    CASE WHEN BTRIM(COALESCE(egl.stats->>'TB', '')) ~ '^-?\\d+$' THEN (BTRIM(egl.stats->>'TB'))::int ELSE NULL END AS total_bases,
    CASE WHEN BTRIM(COALESCE(egl.stats->>'SLG', '')) ~ '^-?\\d*\\.?\\d+$' THEN (BTRIM(egl.stats->>'SLG'))::numeric ELSE NULL END AS slg,
    CASE WHEN BTRIM(COALESCE(egl.stats->>'OPS', '')) ~ '^-?\\d*\\.?\\d+$' THEN (BTRIM(egl.stats->>'OPS'))::numeric ELSE NULL END AS ops
  FROM public.espn_game_logs egl
  WHERE LOWER(COALESCE(egl.sport, '')) = 'baseball'
    AND LOWER(COALESCE(egl.league_id, '')) = 'mlb'
    AND egl.stats IS NOT NULL
  ORDER BY
    egl.espn_event_id,
    COALESCE(
      NULLIF(BTRIM(egl.espn_athlete_id), ''),
      REGEXP_REPLACE(NULLIF(BTRIM(egl.athlete_id), ''), '_[a-z0-9.]+$', '', 'i')
    ),
    egl.created_at DESC
),
resolved AS (
  SELECT
    b.id,
    COALESCE(b.doubles, e.doubles) AS doubles_new,
    COALESCE(b.triples, e.triples) AS triples_new,
    COALESCE(b.stolen_bases, e.stolen_bases) AS stolen_bases_new,
    COALESCE(b.caught_stealing, e.caught_stealing) AS caught_stealing_new,
    COALESCE(b.hit_by_pitch, e.hit_by_pitch) AS hit_by_pitch_new,
    COALESCE(b.ops, e.ops) AS ops_new,
    COALESCE(
      b.total_bases,
      e.total_bases,
      CASE
        WHEN COALESCE(b.hits, e.hits) IS NOT NULL
         AND COALESCE(b.doubles, e.doubles) IS NOT NULL
         AND COALESCE(b.triples, e.triples) IS NOT NULL
         AND COALESCE(b.home_runs, e.home_runs) IS NOT NULL
        THEN
          COALESCE(b.hits, e.hits)
          + COALESCE(b.doubles, e.doubles)
          + 2 * COALESCE(b.triples, e.triples)
          + 3 * COALESCE(b.home_runs, e.home_runs)
        ELSE NULL
      END,
      CASE
        WHEN COALESCE(b.slg, e.slg) IS NOT NULL
         AND COALESCE(b.at_bats, e.at_bats) IS NOT NULL
         AND COALESCE(b.at_bats, e.at_bats) > 0
        THEN ROUND((COALESCE(b.slg, e.slg) * COALESCE(b.at_bats, e.at_bats))::numeric)::int
        ELSE NULL
      END
    ) AS total_bases_new
  FROM public.mlb_batter_game_logs b
  LEFT JOIN espn_logs e
    ON e.espn_event_id = b.espn_event_id
   AND e.athlete_id_norm = b.athlete_id
)
UPDATE public.mlb_batter_game_logs b
SET
  doubles = r.doubles_new,
  triples = r.triples_new,
  stolen_bases = r.stolen_bases_new,
  caught_stealing = r.caught_stealing_new,
  hit_by_pitch = r.hit_by_pitch_new,
  total_bases = r.total_bases_new,
  ops = r.ops_new,
  updated_at = NOW()
FROM resolved r
WHERE b.id = r.id
  AND (
    (b.doubles IS NULL AND r.doubles_new IS NOT NULL)
    OR (b.triples IS NULL AND r.triples_new IS NOT NULL)
    OR (b.stolen_bases IS NULL AND r.stolen_bases_new IS NOT NULL)
    OR (b.caught_stealing IS NULL AND r.caught_stealing_new IS NOT NULL)
    OR (b.hit_by_pitch IS NULL AND r.hit_by_pitch_new IS NOT NULL)
    OR (b.total_bases IS NULL AND r.total_bases_new IS NOT NULL)
    OR (b.ops IS NULL AND r.ops_new IS NOT NULL)
  );
