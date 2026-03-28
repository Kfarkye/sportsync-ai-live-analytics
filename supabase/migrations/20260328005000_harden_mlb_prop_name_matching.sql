-- Harden MLB prop matching after initial residual fix:
-- 1) normalize names with unaccent() and strip disambiguator suffixes like "(2002)"
-- 2) keep per-prop-row ranking and fallback identity matching for short-name variants

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
      pb.id AS prop_bet_id,
      pb.match_id,
      NULLIF(trim(pb.espn_player_id::text), '') AS espn_player_id,
      pb.player_name,
      pb.team,
      pb.opponent,
      regexp_replace(
        lower(public.unaccent(regexp_replace(coalesce(pb.player_name, ''), '\s*\([^)]*\)\s*$', '', 'g'))),
        '[^a-z0-9]', '', 'g'
      ) AS norm_player_name,
      left(
        regexp_replace(
          lower(public.unaccent(split_part(regexp_replace(coalesce(pb.player_name, ''), '\s*\([^)]*\)\s*$', '', 'g'), ' ', 1))),
          '[^a-z0-9]', '', 'g'
        ),
        1
      ) AS norm_first_initial,
      regexp_replace(
        lower(
          public.unaccent(
            coalesce(
              (regexp_split_to_array(trim(regexp_replace(coalesce(pb.player_name, ''), '\s*\([^)]*\)\s*$', '', 'g')), '\s+'))[
                array_length(regexp_split_to_array(trim(regexp_replace(coalesce(pb.player_name, ''), '\s*\([^)]*\)\s*$', '', 'g')), '\s+'), 1)
              ],
              ''
            )
          )
        ),
        '[^a-z0-9]', '', 'g'
      ) AS norm_last_name,
      regexp_replace(lower(coalesce(pb.team, '')), '[^a-z0-9]', '', 'g') AS norm_team,
      regexp_replace(lower(coalesce(pb.opponent, '')), '[^a-z0-9]', '', 'g') AS norm_opponent,
      CASE lower(coalesce(pb.bet_type, ''))
        WHEN 'strikeouts' THEN 'pitcher_strikeouts'
        WHEN 'hits' THEN 'batter_hits'
        WHEN 'total_bases' THEN 'batter_total_bases'
        ELSE lower(coalesce(pb.bet_type, ''))
      END AS bet_type,
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
      AND lower(COALESCE(pb.bet_type, '')) IN (
        'pitcher_strikeouts', 'batter_hits', 'batter_total_bases',
        'strikeouts', 'hits', 'total_bases'
      )
      AND lower(COALESCE(pb.side, '')) IN ('over', 'under')
      AND pb.line_value IS NOT NULL
      AND (p_since_date IS NULL OR pb.event_date >= p_since_date)
  ),
  batter_logs_norm AS (
    SELECT
      bgl.*,
      regexp_replace(
        lower(public.unaccent(coalesce(bgl.athlete_name, ''))),
        '[^a-z0-9]', '', 'g'
      ) AS norm_player_name,
      left(
        regexp_replace(
          lower(public.unaccent(split_part(coalesce(bgl.athlete_name, ''), ' ', 1))),
          '[^a-z0-9]', '', 'g'
        ),
        1
      ) AS norm_first_initial,
      regexp_replace(
        lower(
          public.unaccent(
            coalesce(
              (regexp_split_to_array(trim(coalesce(bgl.athlete_name, '')), '\s+'))[
                array_length(regexp_split_to_array(trim(coalesce(bgl.athlete_name, '')), '\s+'), 1)
              ],
              ''
            )
          )
        ),
        '[^a-z0-9]', '', 'g'
      ) AS norm_last_name,
      regexp_replace(lower(coalesce(bgl.team, '')), '[^a-z0-9]', '', 'g') AS norm_team,
      regexp_replace(lower(coalesce(bgl.opponent, '')), '[^a-z0-9]', '', 'g') AS norm_opponent
    FROM public.mlb_batter_game_logs bgl
  ),
  pitcher_logs_norm AS (
    SELECT
      pgl.*,
      regexp_replace(
        lower(public.unaccent(coalesce(pgl.athlete_name, ''))),
        '[^a-z0-9]', '', 'g'
      ) AS norm_player_name,
      left(
        regexp_replace(
          lower(public.unaccent(split_part(coalesce(pgl.athlete_name, ''), ' ', 1))),
          '[^a-z0-9]', '', 'g'
        ),
        1
      ) AS norm_first_initial,
      regexp_replace(
        lower(
          public.unaccent(
            coalesce(
              (regexp_split_to_array(trim(coalesce(pgl.athlete_name, '')), '\s+'))[
                array_length(regexp_split_to_array(trim(coalesce(pgl.athlete_name, '')), '\s+'), 1)
              ],
              ''
            )
          )
        ),
        '[^a-z0-9]', '', 'g'
      ) AS norm_last_name,
      regexp_replace(lower(coalesce(pgl.team, '')), '[^a-z0-9]', '', 'g') AS norm_team,
      regexp_replace(lower(coalesce(pgl.opponent, '')), '[^a-z0-9]', '', 'g') AS norm_opponent
    FROM public.mlb_pitcher_game_logs pgl
  ),
  batter_match AS (
    SELECT
      bp.prop_bet_id,
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
        PARTITION BY bp.prop_bet_id
        ORDER BY COALESCE(bgl.plate_appearances, 0) DESC, COALESCE(bgl.at_bats, 0) DESC
      ) AS rn
    FROM base_props bp
    JOIN batter_logs_norm bgl
      ON bgl.match_id = bp.match_id
     AND (
       (bp.espn_player_id IS NOT NULL AND bp.espn_player_id = bgl.athlete_id)
       OR bp.norm_player_name = bgl.norm_player_name
       OR (
         bp.norm_last_name <> ''
         AND bp.norm_last_name = bgl.norm_last_name
         AND bp.norm_first_initial <> ''
         AND bp.norm_first_initial = bgl.norm_first_initial
         AND (
           bp.norm_team = bgl.norm_team
           OR bp.norm_team = bgl.norm_opponent
           OR bp.norm_opponent = bgl.norm_team
           OR bp.norm_opponent = bgl.norm_opponent
         )
       )
     )
  ),
  pitcher_match AS (
    SELECT
      bp.prop_bet_id,
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
        PARTITION BY bp.prop_bet_id
        ORDER BY COALESCE(pgl.innings_outs, 0) DESC, COALESCE(pgl.pitches_thrown, 0) DESC
      ) AS rn
    FROM base_props bp
    JOIN pitcher_logs_norm pgl
      ON pgl.match_id = bp.match_id
     AND (
       (bp.espn_player_id IS NOT NULL AND bp.espn_player_id = pgl.athlete_id)
       OR bp.norm_player_name = pgl.norm_player_name
       OR (
         bp.norm_last_name <> ''
         AND bp.norm_last_name = pgl.norm_last_name
         AND bp.norm_first_initial <> ''
         AND bp.norm_first_initial = pgl.norm_first_initial
         AND (
           bp.norm_team = pgl.norm_team
           OR bp.norm_team = pgl.norm_opponent
           OR bp.norm_opponent = pgl.norm_team
           OR bp.norm_opponent = pgl.norm_opponent
         )
       )
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
      ON bm.prop_bet_id = bp.prop_bet_id
     AND bm.rn = 1
    LEFT JOIN pitcher_match pm
      ON pm.prop_bet_id = bp.prop_bet_id
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
    match_id, espn_player_id, player_name, team, opponent, game_date, league_id, season,
    bet_type, line_value, side, actual_value, result, margin, venue, rest_days, travel_pattern,
    month_num, season_phase, opp_pace_rank, opp_pace_tier, opp_drtg_rank, key_teammates_out,
    crew_chief, ref_player_delta, ref_player_sample_games, ref_player_window, ref_player_baseline,
    sportsbook, odds_american, opening_line, line_movement, source
  )
  SELECT
    s.match_id,
    s.out_espn_player_id,
    s.out_player_name,
    COALESCE(s.out_team, 'UNKNOWN'),
    COALESCE(s.out_opponent, 'UNKNOWN'),
    s.out_game_date,
    'mlb',
    to_char(s.out_game_date, 'YYYY'),
    s.bet_type,
    s.line_value,
    s.side,
    s.actual_value,
    s.result,
    s.margin,
    s.venue,
    NULL::integer,
    NULL::text,
    EXTRACT(MONTH FROM s.out_game_date)::int,
    CASE
      WHEN EXTRACT(MONTH FROM s.out_game_date)::int IN (3,4) THEN 'EARLY'
      WHEN EXTRACT(MONTH FROM s.out_game_date)::int IN (5,6) THEN 'MID'
      WHEN EXTRACT(MONTH FROM s.out_game_date)::int IN (7,8) THEN 'LATE'
      ELSE 'STRETCH'
    END,
    NULL::integer,
    NULL::text,
    NULL::integer,
    NULL::text[],
    NULL::text,
    NULL::numeric,
    NULL::integer,
    NULL::text,
    NULL::text,
    s.sportsbook,
    s.odds_american,
    s.open_line,
    s.line_movement,
    'derived_mlb'
  FROM scored s
  WHERE s.out_game_date IS NOT NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_mlb_prop_outcomes(date) TO service_role;
