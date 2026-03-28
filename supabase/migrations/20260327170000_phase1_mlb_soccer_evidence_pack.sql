-- Phase 1 MVP: MLB evidence pack + soccer player unblock
-- ZONES:
-- DATA/ID: tables, views, RPCs
-- OPS: cron hooks for sync/refresh orchestration

-- Ensure core prop columns exist for cross-league grading compatibility.
ALTER TABLE IF EXISTS public.player_prop_bets
  ADD COLUMN IF NOT EXISTS espn_player_id text;

-- Shared helper used by rolling views and odds normalization.
CREATE OR REPLACE FUNCTION public.jsonb_numeric_any(p_payload jsonb, p_keys text[])
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    SELECT CASE
      WHEN NULLIF(BTRIM(p_payload ->> k), '') IS NULL THEN NULL
      WHEN BTRIM(p_payload ->> k) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (BTRIM(p_payload ->> k))::numeric
      ELSE NULL
    END
    FROM unnest(p_keys) AS k
    WHERE p_payload IS NOT NULL
      AND p_payload ? k
      AND NULLIF(BTRIM(p_payload ->> k), '') IS NOT NULL
    LIMIT 1
  );
$$;

-- ============================================================
-- 1) MLB Projected Lineups (advisory)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mlb_projected_lineups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  team text NOT NULL,
  batting_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirmed boolean NOT NULL DEFAULT false,
  source text NOT NULL,
  source_url text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  confidence_score numeric(4,3) NOT NULL DEFAULT 0.300,
  raw_payload jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mlb_projected_lineups_game_team_source_uidx
  ON public.mlb_projected_lineups (game_id, team, source);
CREATE INDEX IF NOT EXISTS mlb_projected_lineups_game_team_captured_idx
  ON public.mlb_projected_lineups (game_id, team, captured_at DESC);

ALTER TABLE public.mlb_projected_lineups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mlb_projected_lineups'
      AND policyname = 'service_role_all_mlb_projected_lineups'
  ) THEN
    CREATE POLICY service_role_all_mlb_projected_lineups
      ON public.mlb_projected_lineups
      FOR ALL
      USING ((select auth.role()) = 'service_role')
      WITH CHECK ((select auth.role()) = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mlb_projected_lineups'
      AND policyname = 'public_read_mlb_projected_lineups'
  ) THEN
    CREATE POLICY public_read_mlb_projected_lineups
      ON public.mlb_projected_lineups
      FOR SELECT
      USING (true);
  END IF;
END
$$;

CREATE OR REPLACE VIEW public.v_mlb_latest_projected_lineups AS
WITH ranked AS (
  SELECT
    l.*,
    row_number() OVER (
      PARTITION BY l.game_id, l.team
      ORDER BY l.confirmed DESC, l.confidence_score DESC, l.captured_at DESC
    ) AS rn
  FROM public.mlb_projected_lineups l
)
SELECT
  game_id,
  team,
  batting_order,
  confirmed,
  confidence_score,
  source,
  source_url,
  captured_at,
  updated_at
FROM ranked
WHERE rn = 1;

CREATE OR REPLACE FUNCTION public.get_mlb_lineup_advisory(
  p_game_id text DEFAULT NULL,
  p_team text DEFAULT NULL
)
RETURNS TABLE(
  game_id text,
  team text,
  lineup jsonb,
  confirmed boolean,
  confidence_score numeric,
  source text,
  source_url text,
  captured_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT
    v.game_id,
    v.team,
    v.batting_order AS lineup,
    v.confirmed,
    v.confidence_score,
    v.source,
    v.source_url,
    v.captured_at
  FROM public.v_mlb_latest_projected_lineups v
  WHERE (p_game_id IS NULL OR v.game_id = p_game_id)
    AND (p_team IS NULL OR lower(v.team) = lower(p_team))
  ORDER BY v.captured_at DESC;
$$;

-- ============================================================
-- 2) Soccer player match stats (unblock player evidence)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.soccer_player_match_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id text NOT NULL,
  espn_event_id text,
  league_id text NOT NULL,
  game_date date,
  team text,
  opponent text,
  player_id text NOT NULL,
  player_name text NOT NULL,
  position text,
  minutes int,
  is_starter boolean,
  goals int,
  assists int,
  shots int,
  shots_on_target int,
  key_passes int,
  yellow_cards int,
  red_cards int,
  source text NOT NULL DEFAULT 'espn_summary',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS soccer_player_match_stats_uidx
  ON public.soccer_player_match_stats (match_id, player_id);
CREATE INDEX IF NOT EXISTS soccer_player_match_stats_player_date_idx
  ON public.soccer_player_match_stats (player_name, game_date DESC);
CREATE INDEX IF NOT EXISTS soccer_player_match_stats_team_date_idx
  ON public.soccer_player_match_stats (team, game_date DESC);
CREATE INDEX IF NOT EXISTS soccer_player_match_stats_league_date_idx
  ON public.soccer_player_match_stats (league_id, game_date DESC);

ALTER TABLE public.soccer_player_match_stats ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'soccer_player_match_stats'
      AND policyname = 'service_role_all_soccer_player_match_stats'
  ) THEN
    CREATE POLICY service_role_all_soccer_player_match_stats
      ON public.soccer_player_match_stats
      FOR ALL
      USING ((select auth.role()) = 'service_role')
      WITH CHECK ((select auth.role()) = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'soccer_player_match_stats'
      AND policyname = 'public_read_soccer_player_match_stats'
  ) THEN
    CREATE POLICY public_read_soccer_player_match_stats
      ON public.soccer_player_match_stats
      FOR SELECT
      USING (true);
  END IF;
END
$$;

-- ============================================================
-- 3) MLB prop outcomes on core pipeline tables
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_mlb_prop_outcomes(p_since_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF p_since_date IS NULL THEN
    DELETE FROM public.player_prop_outcomes WHERE league_id = 'mlb';
  ELSE
    DELETE FROM public.player_prop_outcomes
    WHERE league_id = 'mlb'
      AND game_date >= p_since_date;
  END IF;

  WITH base_props AS (
    SELECT
      pb.match_id,
      NULLIF(trim(pb.espn_player_id::text), '') AS espn_player_id,
      pb.player_name,
      pb.team,
      pb.opponent,
      lower(pb.bet_type) AS bet_type,
      pb.line_value::numeric AS line_value,
      lower(pb.side) AS side,
      pb.event_date,
      COALESCE(pb.sportsbook, pb.provider) AS sportsbook,
      pb.provider,
      pb.odds_american,
      pb.open_line,
      pb.line_movement
    FROM public.player_prop_bets pb
    WHERE lower(COALESCE(pb.league, '')) = 'mlb'
      AND lower(COALESCE(pb.bet_type, '')) IN ('pitcher_strikeouts', 'batter_hits', 'batter_total_bases')
      AND lower(COALESCE(pb.side, '')) IN ('over', 'under')
      AND pb.line_value IS NOT NULL
      AND (p_since_date IS NULL OR pb.event_date >= p_since_date)
  ),
  batter_match AS (
    SELECT
      bp.match_id,
      bp.player_name,
      bp.espn_player_id,
      bgl.athlete_id,
      bgl.athlete_name,
      bgl.team,
      bgl.opponent,
      bgl.game_date::date AS game_date,
      bgl.is_home,
      bgl.hits,
      bgl.total_bases,
      row_number() OVER (
        PARTITION BY bp.match_id, bp.player_name
        ORDER BY COALESCE(bgl.plate_appearances, 0) DESC, COALESCE(bgl.at_bats, 0) DESC
      ) AS rn
    FROM base_props bp
    JOIN public.mlb_batter_game_logs bgl
      ON bgl.match_id = bp.match_id
     AND (
       (bp.espn_player_id IS NOT NULL AND bp.espn_player_id = bgl.athlete_id)
       OR regexp_replace(lower(coalesce(bp.player_name, '')), '[^a-z0-9]', '', 'g')
          = regexp_replace(lower(coalesce(bgl.athlete_name, '')), '[^a-z0-9]', '', 'g')
     )
  ),
  pitcher_match AS (
    SELECT
      bp.match_id,
      bp.player_name,
      bp.espn_player_id,
      pgl.athlete_id,
      pgl.athlete_name,
      pgl.team,
      pgl.opponent,
      pgl.game_date::date AS game_date,
      pgl.is_home,
      pgl.strikeouts,
      row_number() OVER (
        PARTITION BY bp.match_id, bp.player_name
        ORDER BY COALESCE(pgl.innings_outs, 0) DESC, COALESCE(pgl.pitches_thrown, 0) DESC
      ) AS rn
    FROM base_props bp
    JOIN public.mlb_pitcher_game_logs pgl
      ON pgl.match_id = bp.match_id
     AND (
       (bp.espn_player_id IS NOT NULL AND bp.espn_player_id = pgl.athlete_id)
       OR regexp_replace(lower(coalesce(bp.player_name, '')), '[^a-z0-9]', '', 'g')
          = regexp_replace(lower(coalesce(pgl.athlete_name, '')), '[^a-z0-9]', '', 'g')
     )
  ),
  resolved AS (
    SELECT
      bp.*,
      COALESCE(bm.athlete_id, pm.athlete_id, bp.espn_player_id) AS out_espn_player_id,
      COALESCE(bm.athlete_name, pm.athlete_name, bp.player_name) AS out_player_name,
      COALESCE(bm.team, pm.team, bp.team) AS out_team,
      COALESCE(bm.opponent, pm.opponent, bp.opponent) AS out_opponent,
      COALESCE(bm.game_date, pm.game_date, bp.event_date) AS out_game_date,
      CASE
        WHEN bm.is_home IS TRUE OR pm.is_home IS TRUE THEN 'HOME'
        WHEN bm.is_home IS FALSE OR pm.is_home IS FALSE THEN 'AWAY'
        ELSE NULL
      END AS venue,
      CASE
        WHEN bp.bet_type = 'pitcher_strikeouts' THEN pm.strikeouts::numeric
        WHEN bp.bet_type = 'batter_hits' THEN bm.hits::numeric
        WHEN bp.bet_type = 'batter_total_bases' THEN bm.total_bases::numeric
        ELSE NULL
      END AS actual_value
    FROM base_props bp
    LEFT JOIN batter_match bm
      ON bm.match_id = bp.match_id
     AND bm.player_name = bp.player_name
     AND bm.rn = 1
    LEFT JOIN pitcher_match pm
      ON pm.match_id = bp.match_id
     AND pm.player_name = bp.player_name
     AND pm.rn = 1
  ),
  scored AS (
    SELECT
      r.*,
      CASE
        WHEN r.actual_value IS NULL THEN 'pending'
        WHEN r.side = 'over' AND r.actual_value > r.line_value THEN 'won'
        WHEN r.side = 'over' AND r.actual_value < r.line_value THEN 'lost'
        WHEN r.side = 'under' AND r.actual_value < r.line_value THEN 'won'
        WHEN r.side = 'under' AND r.actual_value > r.line_value THEN 'lost'
        ELSE 'push'
      END AS result,
      CASE
        WHEN r.actual_value IS NULL THEN NULL
        WHEN r.side = 'over' THEN r.actual_value - r.line_value
        WHEN r.side = 'under' THEN r.line_value - r.actual_value
        ELSE NULL
      END AS margin
    FROM resolved r
  )
  INSERT INTO public.player_prop_outcomes (
    match_id,
    espn_player_id,
    player_name,
    team,
    opponent,
    game_date,
    league_id,
    season,
    bet_type,
    line_value,
    side,
    actual_value,
    result,
    margin,
    venue,
    rest_days,
    travel_pattern,
    month_num,
    season_phase,
    opp_pace_rank,
    opp_pace_tier,
    opp_drtg_rank,
    key_teammates_out,
    crew_chief,
    ref_player_delta,
    ref_player_sample_games,
    ref_player_window,
    ref_player_baseline,
    sportsbook,
    odds_american,
    opening_line,
    line_movement,
    source
  )
  SELECT
    s.match_id,
    s.out_espn_player_id,
    s.out_player_name,
    COALESCE(s.out_team, 'UNKNOWN') AS team,
    COALESCE(s.out_opponent, 'UNKNOWN') AS opponent,
    s.out_game_date,
    'mlb'::text AS league_id,
    to_char(s.out_game_date, 'YYYY') AS season,
    s.bet_type,
    s.line_value,
    s.side,
    s.actual_value,
    s.result,
    s.margin,
    s.venue,
    NULL::integer AS rest_days,
    NULL::text AS travel_pattern,
    EXTRACT(MONTH FROM s.out_game_date)::int AS month_num,
    CASE
      WHEN EXTRACT(MONTH FROM s.out_game_date)::int IN (3,4) THEN 'EARLY'
      WHEN EXTRACT(MONTH FROM s.out_game_date)::int IN (5,6) THEN 'MID'
      WHEN EXTRACT(MONTH FROM s.out_game_date)::int IN (7,8) THEN 'LATE'
      ELSE 'STRETCH'
    END AS season_phase,
    NULL::integer AS opp_pace_rank,
    NULL::text AS opp_pace_tier,
    NULL::integer AS opp_drtg_rank,
    NULL::text[] AS key_teammates_out,
    NULL::text AS crew_chief,
    NULL::numeric AS ref_player_delta,
    NULL::integer AS ref_player_sample_games,
    NULL::text AS ref_player_window,
    NULL::text AS ref_player_baseline,
    s.sportsbook,
    s.odds_american,
    s.open_line,
    s.line_movement,
    'derived_mlb'::text AS source
  FROM scored s
  WHERE s.out_game_date IS NOT NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

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
      o.espn_player_id,
      o.player_name,
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
    SELECT espn_player_id, player_name, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'all'::text AS context_key, 'all'::text AS context_value
    FROM src
    UNION ALL
    SELECT espn_player_id, player_name, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'venue', coalesce(venue, 'UNKNOWN')
    FROM src
    WHERE venue IS NOT NULL
    UNION ALL
    SELECT espn_player_id, player_name, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'opponent', coalesce(opponent, 'UNKNOWN')
    FROM src
    WHERE opponent IS NOT NULL
    UNION ALL
    SELECT espn_player_id, player_name, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'season_phase', coalesce(season_phase, 'UNKNOWN')
    FROM src
    WHERE season_phase IS NOT NULL
  ),
  agg AS (
    SELECT
      e.espn_player_id,
      e.player_name,
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
      round(avg(abs(e.margin))::numeric, 3) AS margin_abs,
      max(e.game_date) AS last_game_date,
      CASE
        WHEN count(*) >= 15 THEN 'STRONG'
        WHEN count(*) >= 8 THEN 'MODERATE'
        WHEN count(*) >= 3 THEN 'THIN'
        ELSE 'INSUFFICIENT'
      END AS sample_tier
    FROM expanded e
    GROUP BY e.espn_player_id, e.player_name, e.bet_type, e.line_bucket, e.context_key, e.context_value
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
    margin_abs,
    last_game_date,
    sample_tier,
    updated_at
  )
  SELECT
    a.espn_player_id,
    a.player_name,
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
    a.margin_abs,
    a.last_game_date,
    a.sample_tier,
    now()
  FROM agg a;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_mlb_prop_pipeline(p_since_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_outcomes integer := 0;
  v_cache integer := 0;
BEGIN
  v_outcomes := public.refresh_mlb_prop_outcomes(p_since_date);
  v_cache := public.refresh_prop_hit_rate_cache_by_league('mlb', p_since_date);

  RETURN jsonb_build_object(
    'league', 'mlb',
    'player_prop_outcomes_upserts', v_outcomes,
    'prop_hit_rate_cache_upserts', v_cache,
    'ran_at', now()
  );
END;
$$;

-- League-aware wrappers while preserving existing NBA function signatures.
CREATE OR REPLACE FUNCTION public.refresh_player_prop_outcomes(
  p_since_date date,
  p_league text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_league text := lower(coalesce(p_league, 'nba'));
BEGIN
  IF v_league = 'mlb' THEN
    RETURN public.refresh_mlb_prop_outcomes(p_since_date);
  END IF;

  RETURN public.refresh_player_prop_outcomes(p_since_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_prop_hit_rate_cache(
  p_since_date date,
  p_league text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_league text := lower(coalesce(p_league, 'nba'));
  v_rows integer := 0;
BEGIN
  IF v_league = 'mlb' THEN
    RETURN public.refresh_prop_hit_rate_cache_by_league('mlb', p_since_date);
  END IF;

  PERFORM public.refresh_prop_hit_rate_cache();
  SELECT count(*)::int INTO v_rows
  FROM public.prop_hit_rate_cache
  WHERE lower(coalesce(league_id, '')) = 'nba';

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_player_prop_pipeline(
  p_since_date date,
  p_league text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_league text := lower(coalesce(p_league, 'nba'));
BEGIN
  IF v_league = 'mlb' THEN
    RETURN public.run_mlb_prop_pipeline(p_since_date);
  END IF;

  RETURN public.run_player_prop_pipeline(p_since_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_prop_context_by_league(
  p_player text,
  p_bet_type text,
  p_line numeric,
  p_league text DEFAULT 'mlb'
)
RETURNS TABLE(
  context_key text,
  context_value text,
  games integer,
  overs integer,
  unders integer,
  pushes integer,
  over_pct numeric,
  avg_actual numeric,
  avg_margin numeric,
  median_actual numeric,
  sample_tier text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT
    c.context_key,
    c.context_value,
    c.games,
    c.overs,
    c.unders,
    c.pushes,
    c.over_pct,
    c.avg_actual,
    c.avg_margin,
    c.median_actual,
    c.sample_tier
  FROM public.prop_hit_rate_cache c
  WHERE c.player_name = p_player
    AND c.bet_type = p_bet_type
    AND c.line_bucket = p_line
    AND lower(coalesce(c.league_id, '')) = lower(coalesce(p_league, 'mlb'))
  ORDER BY
    CASE c.context_key
      WHEN 'all' THEN 0
      WHEN 'venue' THEN 1
      WHEN 'opponent' THEN 2
      WHEN 'season_phase' THEN 3
      ELSE 4
    END,
    c.games DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_prop_context(
  p_player text,
  p_bet_type text,
  p_line numeric,
  p_league text
)
RETURNS TABLE(
  context_key text,
  context_value text,
  games integer,
  overs integer,
  unders integer,
  pushes integer,
  over_pct numeric,
  avg_actual numeric,
  avg_margin numeric,
  median_actual numeric,
  sample_tier text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT *
  FROM public.get_prop_context_by_league(p_player, p_bet_type, p_line, p_league);
$$;

-- ============================================================
-- 4) MLB rolling form materialized view (ATS/O-U/F5)
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS public.mv_mlb_team_rolling_form;

CREATE MATERIALIZED VIEW public.mv_mlb_team_rolling_form AS
WITH ge_open AS (
  SELECT DISTINCT ON (ge.match_id)
    ge.match_id,
    ge.odds_open
  FROM public.game_events ge
  WHERE ge.league_id = 'mlb'
    AND ge.odds_open IS NOT NULL
  ORDER BY ge.match_id, ge.created_at ASC
),
ge_close AS (
  SELECT DISTINCT ON (ge.match_id)
    ge.match_id,
    ge.odds_close
  FROM public.game_events ge
  WHERE ge.league_id = 'mlb'
    AND ge.odds_close IS NOT NULL
  ORDER BY ge.match_id, ge.created_at DESC
),
base AS (
  SELECT
    pg.id AS match_id,
    pg.start_time,
    pg.home_team,
    pg.away_team,
    pg.home_score,
    pg.away_score,
    (pg.home_score + pg.away_score)::numeric AS total_points,
    (pg.home_score - pg.away_score)::numeric AS home_margin,
    COALESCE(
      public.jsonb_numeric_any(m.opening_odds, ARRAY['total','overUnder']),
      public.jsonb_numeric_any(go.odds_open, ARRAY['total','overUnder'])
    ) AS total_open,
    COALESCE(
      public.jsonb_numeric_any(m.closing_odds, ARRAY['total','overUnder']),
      public.jsonb_numeric_any(gc.odds_close, ARRAY['total','overUnder']),
      pg.dk_total
    ) AS total_close,
    COALESCE(
      public.jsonb_numeric_any(m.closing_odds, ARRAY['homeSpread','home_spread','spread']),
      public.jsonb_numeric_any(gc.odds_close, ARRAY['homeSpread','home_spread','spread']),
      pg.home_run_line
    ) AS home_spread_close,
    i.home_f5_runs,
    i.away_f5_runs,
    CASE
      WHEN COALESCE(
        public.jsonb_numeric_any(m.closing_odds, ARRAY['total','overUnder']),
        public.jsonb_numeric_any(gc.odds_close, ARRAY['total','overUnder']),
        pg.dk_total
      ) IS NOT NULL
      THEN round((COALESCE(
        public.jsonb_numeric_any(m.closing_odds, ARRAY['total','overUnder']),
        public.jsonb_numeric_any(gc.odds_close, ARRAY['total','overUnder']),
        pg.dk_total
      ) * 0.55)::numeric, 1)
      ELSE NULL
    END AS f5_line_derived
  FROM public.mlb_postgame pg
  LEFT JOIN public.matches m
    ON m.id = pg.id
  LEFT JOIN ge_open go
    ON go.match_id = pg.id
  LEFT JOIN ge_close gc
    ON gc.match_id = pg.id
  LEFT JOIN public.mlb_inning_scores i
    ON i.match_id = pg.id
  WHERE pg.home_score IS NOT NULL
    AND pg.away_score IS NOT NULL
),
team_rows AS (
  SELECT
    b.match_id,
    b.start_time,
    b.home_team AS team_name,
    b.away_team AS opponent,
    true AS is_home,
    b.home_margin AS team_margin,
    b.total_points,
    b.total_open,
    b.total_close,
    b.home_spread_close AS team_spread_close,
    (b.home_f5_runs + b.away_f5_runs)::numeric AS f5_total,
    b.f5_line_derived
  FROM base b
  UNION ALL
  SELECT
    b.match_id,
    b.start_time,
    b.away_team AS team_name,
    b.home_team AS opponent,
    false AS is_home,
    -b.home_margin AS team_margin,
    b.total_points,
    b.total_open,
    b.total_close,
    CASE WHEN b.home_spread_close IS NOT NULL THEN -b.home_spread_close ELSE NULL END AS team_spread_close,
    (b.home_f5_runs + b.away_f5_runs)::numeric AS f5_total,
    b.f5_line_derived
  FROM base b
),
team_rows_with_results AS (
  SELECT
    tr.*,
    CASE
      WHEN tr.team_spread_close IS NULL THEN NULL
      WHEN (tr.team_margin + tr.team_spread_close) > 0 THEN 'WIN'
      WHEN (tr.team_margin + tr.team_spread_close) < 0 THEN 'LOSS'
      ELSE 'PUSH'
    END AS ats_result,
    CASE
      WHEN tr.total_close IS NULL THEN NULL
      WHEN tr.total_points > tr.total_close THEN 'OVER'
      WHEN tr.total_points < tr.total_close THEN 'UNDER'
      ELSE 'PUSH'
    END AS ou_result,
    CASE
      WHEN tr.f5_line_derived IS NULL OR tr.f5_total IS NULL THEN NULL
      WHEN tr.f5_total > tr.f5_line_derived THEN 'OVER'
      WHEN tr.f5_total < tr.f5_line_derived THEN 'UNDER'
      ELSE 'PUSH'
    END AS f5_result,
    CASE
      WHEN tr.total_close IS NOT NULL THEN tr.total_points - tr.total_close
      ELSE NULL
    END AS total_vs_close
  FROM team_rows tr
),
with_splits AS (
  SELECT
    tr.*,
    'ALL'::text AS split_scope
  FROM team_rows_with_results tr
  UNION ALL
  SELECT tr.*, CASE WHEN tr.is_home THEN 'HOME' ELSE 'AWAY' END AS split_scope
  FROM team_rows_with_results tr
),
ranked AS (
  SELECT
    ws.*,
    row_number() OVER (
      PARTITION BY ws.team_name, ws.split_scope
      ORDER BY ws.start_time DESC, ws.match_id DESC
    ) AS rn
  FROM with_splits ws
),
window_defs AS (
  SELECT * FROM (VALUES
    ('LAST_10'::text, 10),
    ('LAST_20'::text, 20),
    ('SEASON'::text, 999999)
  ) v(sample_window, max_games)
),
selected AS (
  SELECT
    wd.sample_window,
    r.team_name,
    r.split_scope,
    r.match_id,
    r.start_time,
    r.ats_result,
    r.ou_result,
    r.f5_result,
    r.total_points,
    r.total_vs_close,
    r.team_margin
  FROM ranked r
  JOIN window_defs wd
    ON r.rn <= wd.max_games
)
SELECT
  s.team_name,
  s.split_scope,
  s.sample_window,
  count(*)::int AS games,
  sum(CASE WHEN s.ats_result = 'WIN' THEN 1 ELSE 0 END)::int AS ats_wins,
  sum(CASE WHEN s.ats_result = 'LOSS' THEN 1 ELSE 0 END)::int AS ats_losses,
  sum(CASE WHEN s.ats_result = 'PUSH' THEN 1 ELSE 0 END)::int AS ats_pushes,
  round(100.0 * avg(CASE WHEN s.ats_result = 'WIN' THEN 1.0 ELSE 0.0 END), 2) AS ats_cover_pct,
  sum(CASE WHEN s.ou_result = 'OVER' THEN 1 ELSE 0 END)::int AS ou_overs,
  sum(CASE WHEN s.ou_result = 'UNDER' THEN 1 ELSE 0 END)::int AS ou_unders,
  sum(CASE WHEN s.ou_result = 'PUSH' THEN 1 ELSE 0 END)::int AS ou_pushes,
  round(100.0 * avg(CASE WHEN s.ou_result = 'OVER' THEN 1.0 ELSE 0.0 END), 2) AS ou_over_pct,
  sum(CASE WHEN s.f5_result = 'OVER' THEN 1 ELSE 0 END)::int AS f5_overs,
  sum(CASE WHEN s.f5_result = 'UNDER' THEN 1 ELSE 0 END)::int AS f5_unders,
  sum(CASE WHEN s.f5_result = 'PUSH' THEN 1 ELSE 0 END)::int AS f5_pushes,
  round(100.0 * avg(CASE WHEN s.f5_result = 'OVER' THEN 1.0 ELSE 0.0 END), 2) AS f5_over_pct,
  round(avg(s.total_points)::numeric, 3) AS avg_total_points,
  round(avg(s.total_vs_close)::numeric, 3) AS avg_total_vs_close,
  round(avg(s.team_margin)::numeric, 3) AS avg_margin,
  max(s.start_time) AS last_game_time,
  now() AS updated_at
FROM selected s
GROUP BY s.team_name, s.split_scope, s.sample_window;

CREATE UNIQUE INDEX mv_mlb_team_rolling_form_uidx
  ON public.mv_mlb_team_rolling_form (team_name, split_scope, sample_window);

CREATE INDEX mv_mlb_team_rolling_form_last_game_idx
  ON public.mv_mlb_team_rolling_form (last_game_time DESC);

CREATE OR REPLACE FUNCTION public.refresh_mlb_team_rolling_form()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_mlb_team_rolling_form;
END;
$$;

-- ============================================================
-- 5) Grants
-- ============================================================
GRANT SELECT ON public.mlb_projected_lineups TO anon, authenticated, service_role;
GRANT SELECT ON public.v_mlb_latest_projected_lineups TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_mlb_lineup_advisory(text, text) TO anon, authenticated, service_role;

GRANT SELECT ON public.soccer_player_match_stats TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.refresh_mlb_prop_outcomes(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_prop_hit_rate_cache_by_league(text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_mlb_prop_pipeline(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_player_prop_outcomes(date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_prop_hit_rate_cache(date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_player_prop_pipeline(date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_prop_context_by_league(text, text, numeric, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_prop_context(text, text, numeric, text) TO anon, authenticated, service_role;

GRANT SELECT ON public.mv_mlb_team_rolling_form TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_mlb_team_rolling_form() TO service_role;

-- ============================================================
-- 6) Cron jobs (if pg_cron exists)
-- ============================================================
DO $cron$
DECLARE
  v_jobid integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'sync-player-props-mlb-2h' LIMIT 1;
    IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;

    PERFORM cron.schedule(
      'sync-player-props-mlb-2h',
      '5 */2 * * *',
      $$SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sync-player-props?league=mlb',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );$$
    );

    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'mlb-prop-outcomes-2h' LIMIT 1;
    IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;

    PERFORM cron.schedule(
      'mlb-prop-outcomes-2h',
      '20 */2 * * *',
      $$SELECT public.run_mlb_prop_pipeline((now()::date - 7));$$
    );

    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'sync-mlb-projected-lineups-10am-pt' LIMIT 1;
    IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;

    PERFORM cron.schedule(
      'sync-mlb-projected-lineups-10am-pt',
      '0 17 * * *',
      $$SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sync-mlb-projected-lineups?days=2&limit=80',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );$$
    );

    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'sync-mlb-projected-lineups-hourly-sameday' LIMIT 1;
    IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;

    PERFORM cron.schedule(
      'sync-mlb-projected-lineups-hourly-sameday',
      '15 17-23 * * *',
      $$SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sync-mlb-projected-lineups?days=2&limit=80',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );$$
    );

    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'sync-soccer-player-match-stats-2h' LIMIT 1;
    IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;

    PERFORM cron.schedule(
      'sync-soccer-player-match-stats-2h',
      '35 */2 * * *',
      $$SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sync-soccer-player-match-stats?days=30&limit=80',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );$$
    );

    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'refresh-mlb-team-rolling-form-30m' LIMIT 1;
    IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;

    PERFORM cron.schedule(
      'refresh-mlb-team-rolling-form-30m',
      '*/30 * * * *',
      $$SELECT public.refresh_mlb_team_rolling_form();$$
    );
  END IF;
END
$cron$;

COMMENT ON TABLE public.mlb_projected_lineups IS
'Advisory lineup feed for MLB evidence cards. Includes source and confidence metadata.';

COMMENT ON TABLE public.soccer_player_match_stats IS
'Per-player per-match soccer stats from ESPN summaries for player evidence pages.';

COMMENT ON MATERIALIZED VIEW public.mv_mlb_team_rolling_form IS
'Precomputed MLB team rolling ATS/O-U/F5 form by split and sample window for team cards.';
