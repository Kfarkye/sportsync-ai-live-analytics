-- Hardening patch: ensure generate_prop_evidence_pack() always returns a valid cards array.
-- Supports both legacy cache context_key='all' and v2 context_key='market_baseline'.

CREATE OR REPLACE FUNCTION public.generate_prop_evidence_pack()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_baseline_min_gp integer := 10;
  v_edge_min_gp integer := 15;
  v_feature_min_gp integer := 30;
  v_book_min_gp integer := 3;
  v_support_min_gp integer := 5;
  v_hero_rate_threshold numeric := 65;
  v_model text := '3-layer: market_baseline + book_normalized + supporting_context';
  v_markets text[] := ARRAY['threes_made', 'rebounds', 'assists', 'points', 'pra'];
  v_payload jsonb;
BEGIN
  WITH baseline_source AS (
    SELECT
      CASE
        WHEN NULLIF(trim(c.espn_player_id::text), '') IS NOT NULL THEN 'id:' || NULLIF(trim(c.espn_player_id::text), '')
        ELSE 'name:' || public.norm_name_key(c.player_name)
      END AS player_key,
      NULLIF(trim(c.espn_player_id::text), '') AS espn_player_id,
      c.player_name,
      lower(c.bet_type) AS market,
      c.line_bucket::numeric AS line_bucket,
      c.games::int AS games,
      c.overs::int AS overs,
      c.unders::int AS unders,
      c.pushes::int AS pushes,
      c.over_pct::numeric AS over_pct,
      c.avg_actual::numeric AS avg_actual,
      c.median_actual::numeric AS median_actual,
      c.context_key,
      row_number() OVER (
        PARTITION BY
          CASE
            WHEN NULLIF(trim(c.espn_player_id::text), '') IS NOT NULL THEN 'id:' || NULLIF(trim(c.espn_player_id::text), '')
            ELSE 'name:' || public.norm_name_key(c.player_name)
          END,
          lower(c.bet_type),
          c.line_bucket
        ORDER BY
          CASE
            WHEN c.context_key = 'market_baseline' THEN 0
            WHEN c.context_key = 'all' THEN 1
            ELSE 2
          END,
          c.updated_at DESC NULLS LAST
      ) AS rn
    FROM public.prop_hit_rate_cache c
    WHERE lower(coalesce(c.league_id, '')) = 'nba'
      AND lower(c.bet_type) = ANY (v_markets)
      AND c.games >= v_baseline_min_gp
      AND c.context_key IN ('market_baseline', 'all')
  ),
  baseline_rows AS (
    SELECT *
    FROM baseline_source
    WHERE rn = 1
  ),
  name_choice AS (
    SELECT t.player_key, t.player_name
    FROM (
      SELECT
        b.player_key,
        b.player_name,
        row_number() OVER (
          PARTITION BY b.player_key
          ORDER BY b.games DESC, length(coalesce(b.player_name, '')) DESC, b.player_name
        ) AS rn
      FROM baseline_rows b
      WHERE b.player_name IS NOT NULL
        AND btrim(b.player_name) <> ''
    ) t
    WHERE t.rn = 1
  ),
  baseline_agg AS (
    SELECT
      b.player_key,
      max(b.espn_player_id) FILTER (WHERE b.espn_player_id IS NOT NULL) AS espn_player_id,
      max(b.player_name) FILTER (WHERE b.player_name IS NOT NULL AND btrim(b.player_name) <> '') AS fallback_player_name,
      b.market,
      sum(b.games)::int AS gp,
      sum(b.overs)::int AS overs,
      sum(b.unders)::int AS unders,
      sum(b.pushes)::int AS pushes,
      round(
        100.0 * sum(b.overs)::numeric / NULLIF((sum(b.overs) + sum(b.unders))::numeric, 0),
        1
      ) AS rate,
      round(sum(coalesce(b.avg_actual, 0) * b.games)::numeric / NULLIF(sum(b.games)::numeric, 0), 1) AS avg_actual,
      round(sum(coalesce(b.median_actual, 0) * b.games)::numeric / NULLIF(sum(b.games)::numeric, 0), 1) AS median_actual
    FROM baseline_rows b
    GROUP BY b.player_key, b.market
  ),
  current_line_ranked AS (
    SELECT
      b.player_key,
      b.market,
      b.line_bucket,
      b.games,
      b.overs,
      b.unders,
      b.avg_actual,
      b.median_actual,
      round(
        100.0 * b.overs::numeric / NULLIF((b.overs + b.unders)::numeric, 0),
        1
      ) AS line_rate,
      row_number() OVER (
        PARTITION BY b.player_key, b.market
        ORDER BY b.games DESC, abs(coalesce(b.over_pct, 50) - 50) DESC, b.line_bucket
      ) AS rn
    FROM baseline_rows b
  ),
  current_line AS (
    SELECT
      cl.player_key,
      cl.market,
      cl.line_bucket,
      cl.games,
      cl.overs,
      cl.unders,
      cl.avg_actual,
      cl.median_actual,
      cl.line_rate
    FROM current_line_ranked cl
    WHERE cl.rn = 1
  ),
  supporting_ranked AS (
    SELECT
      cl.player_key,
      cl.market,
      s.context_key,
      s.context_value,
      s.games,
      s.overs,
      s.unders,
      round(
        100.0 * s.overs::numeric / NULLIF((s.overs + s.unders)::numeric, 0),
        1
      ) AS rate,
      row_number() OVER (
        PARTITION BY cl.player_key, cl.market
        ORDER BY s.games DESC, abs(s.over_pct - 50.0) DESC
      ) AS rn
    FROM current_line cl
    JOIN public.prop_hit_rate_cache s
      ON lower(coalesce(s.league_id, '')) = 'nba'
     AND lower(s.bet_type) = cl.market
     AND s.line_bucket = cl.line_bucket
     AND s.games >= v_support_min_gp
     AND s.context_key IN ('supporting_context', 'venue', 'opp_pace_tier', 'rest_days', 'season_phase')
     AND (
       CASE
         WHEN NULLIF(trim(s.espn_player_id::text), '') IS NOT NULL THEN 'id:' || NULLIF(trim(s.espn_player_id::text), '')
         ELSE 'name:' || public.norm_name_key(s.player_name)
       END
     ) = cl.player_key
  ),
  supporting_agg AS (
    SELECT
      sr.player_key,
      sr.market,
      jsonb_agg(
        jsonb_build_object(
          'label', CASE sr.context_key
            WHEN 'venue' THEN sr.context_value
            WHEN 'opp_pace_tier' THEN 'vs ' || sr.context_value || ' pace'
            WHEN 'rest_days' THEN 'Rest: ' || sr.context_value
            WHEN 'season_phase' THEN sr.context_value || ' season'
            ELSE sr.context_value
          END,
          'gp', sr.games,
          'rate', sr.rate,
          'record', sr.overs || '-' || sr.unders,
          'direction', CASE
            WHEN sr.rate >= 50 THEN 'over'
            ELSE 'under'
          END
        )
        ORDER BY sr.rn
      ) AS chips
    FROM supporting_ranked sr
    WHERE sr.rn <= 3
    GROUP BY sr.player_key, sr.market
  ),
  book_ranked AS (
    SELECT
      cl.player_key,
      cl.market,
      s.context_value,
      s.line_bucket,
      s.games,
      s.overs,
      s.unders,
      round(
        100.0 * s.overs::numeric / NULLIF((s.overs + s.unders)::numeric, 0),
        1
      ) AS rate,
      row_number() OVER (
        PARTITION BY cl.player_key, cl.market
        ORDER BY s.games DESC, abs(s.over_pct - 50.0) DESC
      ) AS rn
    FROM current_line cl
    JOIN public.prop_hit_rate_cache s
      ON lower(coalesce(s.league_id, '')) = 'nba'
     AND lower(s.bet_type) = cl.market
     AND s.games >= v_book_min_gp
     AND s.context_key IN ('book_normalized', 'book', 'sportsbook', 'book_line')
     AND (
       CASE
         WHEN NULLIF(trim(s.espn_player_id::text), '') IS NOT NULL THEN 'id:' || NULLIF(trim(s.espn_player_id::text), '')
         ELSE 'name:' || public.norm_name_key(s.player_name)
       END
     ) = cl.player_key
  ),
  book_agg AS (
    SELECT
      br.player_key,
      br.market,
      jsonb_agg(
        jsonb_build_object(
          'book', CASE
            WHEN position('|' IN coalesce(br.context_value, '')) > 0 THEN split_part(br.context_value, '|', 1)
            ELSE coalesce(nullif(br.context_value, ''), 'Unknown')
          END,
          'line', br.line_bucket,
          'gp', br.games,
          'rate', br.rate
        )
        ORDER BY br.rn
      ) AS books
    FROM book_ranked br
    WHERE br.rn <= 4
    GROUP BY br.player_key, br.market
  ),
  cards AS (
    SELECT
      jsonb_build_object(
        'player_name', coalesce(nc.player_name, ba.fallback_player_name, 'UNKNOWN'),
        'market', ba.market,
        'direction', CASE
          WHEN ba.rate >= v_hero_rate_threshold THEN 'over'
          WHEN ba.rate <= (100 - v_hero_rate_threshold) THEN 'under'
          ELSE 'none'
        END,
        'baseline', jsonb_build_object(
          'gp', ba.gp,
          'avg', ba.avg_actual,
          'rate', ba.rate,
          'tier', CASE
            WHEN ba.gp >= v_feature_min_gp THEN 'feature'
            WHEN ba.gp >= v_edge_min_gp THEN 'edge'
            ELSE 'display'
          END,
          'median', ba.median_actual,
          'record', ba.overs || '-' || ba.unders,
          'is_hero', (
            ba.gp >= v_feature_min_gp
            AND (ba.rate >= v_hero_rate_threshold OR ba.rate <= (100 - v_hero_rate_threshold))
          )
        ),
        'book_context', coalesce(bo.books, '[]'::jsonb),
        'current_line', CASE
          WHEN cl.line_bucket IS NULL THEN NULL
          ELSE jsonb_build_object(
            'gp', cl.games,
            'avg', round(coalesce(cl.avg_actual, 0)::numeric, 1),
            'line', cl.line_bucket,
            'rate', cl.line_rate,
            'median', round(coalesce(cl.median_actual, 0)::numeric, 1),
            'record', cl.overs || '-' || cl.unders
          )
        END,
        'supporting_contexts', coalesce(sa.chips, '[]'::jsonb)
      ) AS card
    FROM baseline_agg ba
    LEFT JOIN name_choice nc
      ON nc.player_key = ba.player_key
    LEFT JOIN current_line cl
      ON cl.player_key = ba.player_key
     AND cl.market = ba.market
    LEFT JOIN supporting_agg sa
      ON sa.player_key = ba.player_key
     AND sa.market = ba.market
    LEFT JOIN book_agg bo
      ON bo.player_key = ba.player_key
     AND bo.market = ba.market
    WHERE ba.gp >= v_baseline_min_gp
  )
  SELECT jsonb_build_object(
    'cards', coalesce(
      (
        SELECT jsonb_agg(card ORDER BY
          ((card->'baseline'->>'is_hero')::boolean) DESC,
          (card->'baseline'->>'gp')::int DESC,
          abs((card->'baseline'->>'rate')::numeric - 50.0) DESC
        )
        FROM cards
      ),
      '[]'::jsonb
    ),
    'gates', jsonb_build_object(
      'book_min_gp', v_book_min_gp,
      'edge_min_gp', v_edge_min_gp,
      'feature_min_gp', v_feature_min_gp,
      'support_min_gp', v_support_min_gp,
      'baseline_min_gp', v_baseline_min_gp,
      'max_support_chips', 3,
      'hero_rate_threshold', v_hero_rate_threshold
    ),
    'model', v_model,
    'markets', v_markets,
    'version', 'v2',
    'hero_cards', coalesce((SELECT count(*) FROM cards WHERE ((card->'baseline'->>'is_hero')::boolean) = true), 0),
    'total_cards', coalesce((SELECT count(*) FROM cards), 0),
    'generated_at', now()
  ) INTO v_payload;

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_prop_evidence_pack() TO anon, authenticated, service_role;
