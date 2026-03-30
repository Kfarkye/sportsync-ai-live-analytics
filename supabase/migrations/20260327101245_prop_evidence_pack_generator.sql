CREATE OR REPLACE FUNCTION public.generate_prop_evidence_pack()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_cards jsonb;
BEGIN
  WITH
  -- 1. Baseline rows: all context, launch markets, ≥10 GP
  baselines AS (
    SELECT
      c.player_name,
      c.bet_type AS market,
      c.line_bucket AS line,
      c.games AS gp,
      c.overs,
      c.unders,
      c.pushes,
      c.over_pct AS rate,
      c.avg_actual AS avg,
      c.median_actual AS median,
      CASE
        WHEN c.games >= 15 THEN 'feature'
        WHEN c.games >= 10 THEN 'edge'
        ELSE 'display'
      END AS tier,
      CASE
        WHEN c.games >= 15 AND (c.over_pct >= 65.0 OR c.over_pct <= 35.0) THEN true
        ELSE false
      END AS is_hero,
      CASE
        WHEN c.over_pct >= 65.0 THEN 'over'
        WHEN c.over_pct <= 35.0 THEN 'under'
        ELSE 'none'
      END AS direction
    FROM public.prop_hit_rate_cache c
    WHERE c.context_key = 'all'
      AND c.bet_type IN ('threes_made', 'rebounds', 'assists')
      AND c.games >= 10
  ),
  -- 2. Supporting context rows: ≥5 GP, launch contexts only
  supports_ranked AS (
    SELECT
      c.player_name,
      c.bet_type AS market,
      c.line_bucket AS line,
      c.context_key,
      c.context_value,
      c.games AS gp,
      c.over_pct AS rate,
      CASE
        WHEN c.over_pct >= 50.0 THEN 'over'
        WHEN c.over_pct < 50.0 THEN 'under'
        ELSE 'neutral'
      END AS direction,
      ROW_NUMBER() OVER (
        PARTITION BY c.player_name, c.bet_type, c.line_bucket
        ORDER BY c.games DESC, abs(c.over_pct - 50.0) DESC
      ) AS rn
    FROM public.prop_hit_rate_cache c
    WHERE c.context_key IN ('venue', 'opp_pace_tier', 'rest_days', 'season_phase')
      AND c.bet_type IN ('threes_made', 'rebounds', 'assists')
      AND c.games >= 5
  ),
  -- 3. Cap at 3 chips per card
  supports_capped AS (
    SELECT * FROM supports_ranked WHERE rn <= 3
  ),
  -- 4. Aggregate supporting contexts into array
  supports_agg AS (
    SELECT
      s.player_name,
      s.market,
      s.line,
      jsonb_agg(
        jsonb_build_object(
          'label', CASE s.context_key
            WHEN 'venue' THEN s.context_value
            WHEN 'opp_pace_tier' THEN 'vs ' || s.context_value || ' pace'
            WHEN 'rest_days' THEN 'Rest: ' || s.context_value
            WHEN 'season_phase' THEN s.context_value || ' season'
            ELSE s.context_value
          END,
          'gp', s.gp,
          'rate', s.rate,
          'direction', s.direction
        )
        ORDER BY s.rn
      ) AS chips
    FROM supports_capped s
    GROUP BY s.player_name, s.market, s.line
  ),
  -- 5. Assemble final cards
  cards AS (
    SELECT
      jsonb_build_object(
        'player_name', b.player_name,
        'market', b.market,
        'line', b.line,
        'direction', b.direction,
        'baseline', jsonb_build_object(
          'gp', b.gp,
          'record', b.overs || '-' || b.unders,
          'rate', b.rate,
          'avg', b.avg,
          'median', b.median,
          'tier', b.tier,
          'is_hero', b.is_hero
        ),
        'supporting_contexts', COALESCE(sa.chips, '[]'::jsonb)
      ) AS card
    FROM baselines b
    LEFT JOIN supports_agg sa
      ON sa.player_name = b.player_name
     AND sa.market = b.market
     AND sa.line = b.line
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'version', 'v1',
    'markets', ARRAY['threes_made', 'rebounds', 'assists'],
    'gates', jsonb_build_object(
      'baseline_min_gp', 10,
      'hero_min_gp', 15,
      'hero_rate_threshold', 65.0,
      'support_min_gp', 5,
      'max_support_chips', 3
    ),
    'total_cards', (SELECT count(*) FROM cards),
    'hero_cards', (SELECT count(*) FROM cards WHERE (card->'baseline'->>'is_hero')::boolean = true),
    'cards', (SELECT jsonb_agg(card ORDER BY
      (card->'baseline'->>'is_hero')::boolean DESC,
      (card->'baseline'->>'gp')::int DESC,
      abs((card->'baseline'->>'rate')::numeric - 50.0) DESC
    ) FROM cards)
  ) INTO v_cards;

  RETURN v_cards;
END;
$$;;
