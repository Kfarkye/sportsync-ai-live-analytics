CREATE OR REPLACE FUNCTION public.norm_name_key(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]', '', 'g')
$$;

CREATE OR REPLACE FUNCTION public.refresh_game_context(p_since_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  WITH base_games AS (
    SELECT
      np.id AS match_id,
      'nba'::text AS league_id,
      '2025-26'::text AS season,
      (np.start_time AT TIME ZONE 'America/New_York')::date AS game_date,
      np.home_team,
      np.away_team,
      m.home_team_id,
      m.away_team_id
    FROM public.nba_postgame np
    LEFT JOIN public.matches m
      ON m.id = np.id
    WHERE np.id LIKE '%_nba'
      AND np.start_time IS NOT NULL
      AND (p_since_date IS NULL OR (np.start_time AT TIME ZONE 'America/New_York')::date >= p_since_date)
  ),
  team_schedule AS (
    SELECT match_id, game_date, home_team AS team, 'HOME'::text AS venue FROM base_games
    UNION ALL
    SELECT match_id, game_date, away_team AS team, 'AWAY'::text AS venue FROM base_games
  ),
  team_schedule_enriched AS (
    SELECT
      ts.*,
      lag(ts.game_date) OVER (PARTITION BY ts.team ORDER BY ts.game_date, ts.match_id) AS prev_game_date,
      lag(ts.venue) OVER (PARTITION BY ts.team ORDER BY ts.game_date, ts.match_id) AS prev_venue
    FROM team_schedule ts
  ),
  team_schedule_features AS (
    SELECT
      tse.*,
      CASE
        WHEN tse.prev_game_date IS NULL THEN NULL
        ELSE GREATEST((tse.game_date - tse.prev_game_date) - 1, 0)
      END AS rest_days,
      CASE
        WHEN tse.prev_venue IS NULL THEN NULL
        WHEN tse.prev_venue = 'HOME' AND tse.venue = 'HOME' THEN 'HOME_TO_HOME'
        WHEN tse.prev_venue = 'HOME' AND tse.venue = 'AWAY' THEN 'HOME_TO_AWAY'
        WHEN tse.prev_venue = 'AWAY' AND tse.venue = 'HOME' THEN 'AWAY_TO_HOME'
        WHEN tse.prev_venue = 'AWAY' AND tse.venue = 'AWAY' THEN 'AWAY_TO_AWAY'
        ELSE NULL
      END AS travel_pattern
    FROM team_schedule_enriched tse
  ),
  team_tempo_ranked AS (
    SELECT
      tt.team,
      tt.pace,
      tt.drtg,
      dense_rank() OVER (ORDER BY tt.pace DESC NULLS LAST) AS pace_rank,
      dense_rank() OVER (ORDER BY tt.drtg ASC NULLS LAST) AS drtg_rank
    FROM public.team_tempo tt
    WHERE tt.league_id = 'nba'
  ),
  opening AS (
    SELECT DISTINCT ON (ol.match_id)
      ol.match_id,
      ol.total AS opening_total
    FROM public.opening_lines ol
    WHERE ol.match_id LIKE '%_nba'
    ORDER BY ol.match_id, ol.created_at ASC NULLS LAST
  ),
  closing AS (
    SELECT DISTINCT ON (cl.match_id)
      cl.match_id,
      cl.total AS closing_total,
      cl.home_spread AS closing_spread
    FROM public.closing_lines cl
    WHERE cl.match_id LIKE '%_nba'
    ORDER BY cl.match_id, cl.created_at DESC NULLS LAST
  ),
  officials AS (
    SELECT
      go.match_id,
      (array_agg(go.official_name ORDER BY
        CASE WHEN lower(coalesce(go.official_position, '')) = 'crew chief' THEN 0 ELSE 1 END,
        coalesce(go.official_order, 999),
        go.official_name
      ))[1] AS crew_chief,
      (array_agg(go.espn_official_id ORDER BY
        CASE WHEN lower(coalesce(go.official_position, '')) = 'crew chief' THEN 0 ELSE 1 END,
        coalesce(go.official_order, 999),
        go.official_name
      ))[1] AS crew_chief_id
    FROM public.game_officials go
    WHERE go.league_id = 'nba'
    GROUP BY go.match_id
  ),
  merged AS (
    SELECT
      bg.match_id,
      bg.league_id,
      bg.season,
      bg.game_date,
      bg.home_team,
      bg.away_team,
      bg.home_team_id,
      bg.away_team_id,
      hs.rest_days AS home_rest_days,
      hs.prev_venue AS home_prev_venue,
      hs.travel_pattern AS home_travel_pattern,
      aws.rest_days AS away_rest_days,
      aws.prev_venue AS away_prev_venue,
      aws.travel_pattern AS away_travel_pattern,
      htr.pace AS home_pace,
      htr.pace_rank AS home_pace_rank,
      htr.drtg AS home_drtg,
      htr.drtg_rank AS home_drtg_rank,
      atr.pace AS away_pace,
      atr.pace_rank AS away_pace_rank,
      atr.drtg AS away_drtg,
      atr.drtg_rank AS away_drtg_rank,
      off.crew_chief,
      off.crew_chief_id,
      CASE
        WHEN extract(isodow FROM bg.game_date) IN (6,7) THEN 'WEEKEND'
        ELSE 'REGULAR'
      END AS broadcast_slot,
      FALSE AS is_national_tv,
      op.opening_total,
      cl.closing_total,
      cl.closing_spread,
      CASE
        WHEN op.opening_total IS NOT NULL AND cl.closing_total IS NOT NULL
          THEN cl.closing_total - op.opening_total
        ELSE NULL
      END AS total_movement,
      extract(month FROM bg.game_date)::int AS month_num,
      CASE
        WHEN extract(month FROM bg.game_date)::int IN (10,11) THEN 'EARLY'
        WHEN extract(month FROM bg.game_date)::int IN (12,1) THEN 'MID'
        WHEN extract(month FROM bg.game_date)::int = 2 THEN 'LATE'
        WHEN extract(month FROM bg.game_date)::int IN (3,4) THEN 'STRETCH'
        ELSE 'PLAYOFF'
      END AS season_phase,
      'derived'::text AS source
    FROM base_games bg
    LEFT JOIN team_schedule_features hs
      ON hs.match_id = bg.match_id AND hs.team = bg.home_team
    LEFT JOIN team_schedule_features aws
      ON aws.match_id = bg.match_id AND aws.team = bg.away_team
    LEFT JOIN team_tempo_ranked htr
      ON public.norm_name_key(htr.team) = public.norm_name_key(bg.home_team)
    LEFT JOIN team_tempo_ranked atr
      ON public.norm_name_key(atr.team) = public.norm_name_key(bg.away_team)
    LEFT JOIN opening op
      ON op.match_id = bg.match_id
    LEFT JOIN closing cl
      ON cl.match_id = bg.match_id
    LEFT JOIN officials off
      ON off.match_id = bg.match_id
  )
  INSERT INTO public.game_context (
    match_id, league_id, season, game_date,
    home_team, away_team, home_team_id, away_team_id,
    home_rest_days, home_prev_venue, home_travel_pattern,
    away_rest_days, away_prev_venue, away_travel_pattern,
    home_pace, home_pace_rank, home_drtg, home_drtg_rank,
    away_pace, away_pace_rank, away_drtg, away_drtg_rank,
    crew_chief, crew_chief_id, broadcast_slot, is_national_tv,
    opening_total, closing_total, closing_spread, total_movement,
    month_num, season_phase, source, updated_at
  )
  SELECT
    match_id, league_id, season, game_date,
    home_team, away_team, home_team_id, away_team_id,
    home_rest_days, home_prev_venue, home_travel_pattern,
    away_rest_days, away_prev_venue, away_travel_pattern,
    home_pace, home_pace_rank, home_drtg, home_drtg_rank,
    away_pace, away_pace_rank, away_drtg, away_drtg_rank,
    crew_chief, crew_chief_id, broadcast_slot, is_national_tv,
    opening_total, closing_total, closing_spread, total_movement,
    month_num, season_phase, source, now()
  FROM merged
  ON CONFLICT (match_id) DO UPDATE
  SET
    league_id = EXCLUDED.league_id,
    season = EXCLUDED.season,
    game_date = EXCLUDED.game_date,
    home_team = EXCLUDED.home_team,
    away_team = EXCLUDED.away_team,
    home_team_id = EXCLUDED.home_team_id,
    away_team_id = EXCLUDED.away_team_id,
    home_rest_days = EXCLUDED.home_rest_days,
    home_prev_venue = EXCLUDED.home_prev_venue,
    home_travel_pattern = EXCLUDED.home_travel_pattern,
    away_rest_days = EXCLUDED.away_rest_days,
    away_prev_venue = EXCLUDED.away_prev_venue,
    away_travel_pattern = EXCLUDED.away_travel_pattern,
    home_pace = EXCLUDED.home_pace,
    home_pace_rank = EXCLUDED.home_pace_rank,
    home_drtg = EXCLUDED.home_drtg,
    home_drtg_rank = EXCLUDED.home_drtg_rank,
    away_pace = EXCLUDED.away_pace,
    away_pace_rank = EXCLUDED.away_pace_rank,
    away_drtg = EXCLUDED.away_drtg,
    away_drtg_rank = EXCLUDED.away_drtg_rank,
    crew_chief = EXCLUDED.crew_chief,
    crew_chief_id = EXCLUDED.crew_chief_id,
    broadcast_slot = EXCLUDED.broadcast_slot,
    is_national_tv = EXCLUDED.is_national_tv,
    opening_total = EXCLUDED.opening_total,
    closing_total = EXCLUDED.closing_total,
    closing_spread = EXCLUDED.closing_spread,
    total_movement = EXCLUDED.total_movement,
    month_num = EXCLUDED.month_num,
    season_phase = EXCLUDED.season_phase,
    source = EXCLUDED.source,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

INSERT INTO public.key_teammates (
  team,
  espn_player_id,
  player_name,
  espn_teammate_id,
  key_teammate,
  impact_type,
  detection_method,
  league_id,
  season,
  active
)
VALUES
  ('Minnesota Timberwolves', '4594268', 'Anthony Edwards', '3934673', 'Donte DiVincenzo', 'SPACING', 'manual_seed_v1', 'nba', '2025-26', true),
  ('Minnesota Timberwolves', '4594268', 'Anthony Edwards', '3064514', 'Julius Randle', 'SCORER', 'manual_seed_v1', 'nba', '2025-26', true),
  ('Minnesota Timberwolves', '4594268', 'Anthony Edwards', '4592492', 'Bones Hyland', 'PLAYMAKER', 'manual_seed_v1', 'nba', '2025-26', true),
  ('Denver Nuggets', '3112335', 'Nikola Jokic', '3936299', 'Jamal Murray', 'PLAYMAKER', 'manual_seed_v1', 'nba', '2025-26', true),
  ('Los Angeles Lakers', '1966', 'LeBron James', '6583', 'Anthony Davis', 'SCORER', 'manual_seed_v1', 'nba', '2025-26', true)
ON CONFLICT (player_name, key_teammate, season, league_id) DO UPDATE
SET
  team = EXCLUDED.team,
  espn_player_id = COALESCE(EXCLUDED.espn_player_id, public.key_teammates.espn_player_id),
  espn_teammate_id = COALESCE(EXCLUDED.espn_teammate_id, public.key_teammates.espn_teammate_id),
  impact_type = EXCLUDED.impact_type,
  detection_method = EXCLUDED.detection_method,
  active = true;

CREATE OR REPLACE FUNCTION public.refresh_player_teammate_log(p_since_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF p_since_date IS NULL THEN
    TRUNCATE TABLE public.player_teammate_log;
  ELSE
    DELETE FROM public.player_teammate_log WHERE game_date >= p_since_date;
  END IF;

  INSERT INTO public.player_teammate_log (
    match_id,
    espn_player_id,
    player_name,
    espn_teammate_id,
    teammate_name,
    teammate_played,
    teammate_minutes,
    game_date,
    team,
    league_id,
    season
  )
  SELECT
    pgs.match_id,
    COALESCE(pgs.espn_player_id, kt.espn_player_id) AS espn_player_id,
    pgs.player_name,
    kt.espn_teammate_id,
    kt.key_teammate,
    CASE
      WHEN teammate_row.match_id IS NULL THEN FALSE
      WHEN COALESCE(teammate_row.is_dnp, false) THEN FALSE
      WHEN COALESCE(teammate_row.minutes, 0) <= 0 THEN FALSE
      ELSE TRUE
    END AS teammate_played,
    teammate_row.minutes AS teammate_minutes,
    pgs.game_date,
    pgs.team,
    'nba'::text AS league_id,
    '2025-26'::text AS season
  FROM public.player_game_stats pgs
  JOIN public.key_teammates kt
    ON kt.active = TRUE
   AND kt.league_id = 'nba'
   AND public.norm_name_key(kt.team) = public.norm_name_key(pgs.team)
   AND (
      (kt.espn_player_id IS NOT NULL AND kt.espn_player_id = pgs.espn_player_id)
      OR (kt.espn_player_id IS NULL AND public.norm_name_key(kt.player_name) = public.norm_name_key(pgs.player_name))
   )
  LEFT JOIN public.player_game_stats teammate_row
    ON teammate_row.match_id = pgs.match_id
   AND (
      (kt.espn_teammate_id IS NOT NULL AND kt.espn_teammate_id = teammate_row.espn_player_id)
      OR (kt.espn_teammate_id IS NULL AND public.norm_name_key(kt.key_teammate) = public.norm_name_key(teammate_row.player_name))
   )
  WHERE pgs.league_id = 'nba'
    AND COALESCE(pgs.is_dnp, false) = false
    AND (p_since_date IS NULL OR pgs.game_date >= p_since_date)
  ON CONFLICT (match_id, player_name, teammate_name) DO UPDATE
  SET
    espn_player_id = EXCLUDED.espn_player_id,
    espn_teammate_id = EXCLUDED.espn_teammate_id,
    teammate_played = EXCLUDED.teammate_played,
    teammate_minutes = EXCLUDED.teammate_minutes,
    game_date = EXCLUDED.game_date,
    team = EXCLUDED.team,
    league_id = EXCLUDED.league_id,
    season = EXCLUDED.season;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_player_prop_outcomes(p_since_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF p_since_date IS NULL THEN
    TRUNCATE TABLE public.player_prop_outcomes;
  ELSE
    DELETE FROM public.player_prop_outcomes WHERE game_date >= p_since_date;
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
      pb.sportsbook,
      pb.provider,
      pb.odds_american,
      pb.open_line,
      pb.line_movement
    FROM public.player_prop_bets pb
    WHERE lower(COALESCE(pb.league, '')) = 'nba'
      AND pb.match_id LIKE '%_nba'
      AND lower(COALESCE(pb.bet_type, '')) IN (
        'points', 'threes_made', 'rebounds', 'assists', 'pra',
        'pts_rebs', 'pts_asts', 'steals', 'blocks', 'turnovers', 'fantasy_score'
      )
      AND lower(COALESCE(pb.side, '')) IN ('over', 'under')
      AND pb.line_value IS NOT NULL
      AND (p_since_date IS NULL OR pb.event_date >= p_since_date)
  ),
  resolved AS (
    SELECT
      bp.*,
      pgs.espn_player_id AS pgs_espn_player_id,
      pgs.player_name AS pgs_player_name,
      pgs.team AS pgs_team,
      pgs.opponent AS pgs_opponent,
      pgs.game_date AS pgs_game_date,
      pgs.venue AS pgs_venue,
      pgs.points,
      pgs.three_pm,
      pgs.rebounds,
      pgs.assists,
      pgs.pra,
      pgs.pts_rebs,
      pgs.pts_asts,
      pgs.steals,
      pgs.blocks,
      pgs.turnovers
    FROM base_props bp
    LEFT JOIN LATERAL (
      SELECT pgs.*
      FROM public.player_game_stats pgs
      WHERE pgs.match_id = bp.match_id
        AND (
          (bp.espn_player_id IS NOT NULL AND pgs.espn_player_id = bp.espn_player_id)
          OR (bp.espn_player_id IS NULL AND public.norm_name_key(pgs.player_name) = public.norm_name_key(bp.player_name))
        )
      ORDER BY
        CASE WHEN bp.espn_player_id IS NOT NULL AND pgs.espn_player_id = bp.espn_player_id THEN 0 ELSE 1 END,
        CASE WHEN bp.team IS NOT NULL AND public.norm_name_key(pgs.team) = public.norm_name_key(bp.team) THEN 0 ELSE 1 END,
        COALESCE(pgs.minutes, 0) DESC
      LIMIT 1
    ) pgs ON TRUE
  ),
  with_context AS (
    SELECT
      r.*,
      gc.game_date AS gc_game_date,
      gc.home_team AS gc_home_team,
      gc.away_team AS gc_away_team,
      gc.home_rest_days AS gc_home_rest_days,
      gc.away_rest_days AS gc_away_rest_days,
      gc.home_travel_pattern AS gc_home_travel_pattern,
      gc.away_travel_pattern AS gc_away_travel_pattern,
      gc.home_pace_rank AS gc_home_pace_rank,
      gc.away_pace_rank AS gc_away_pace_rank,
      gc.home_drtg_rank AS gc_home_drtg_rank,
      gc.away_drtg_rank AS gc_away_drtg_rank,
      gc.crew_chief AS gc_crew_chief,
      gc.season_phase AS gc_season_phase,
      gc.month_num AS gc_month_num,
      kt.key_teammates_out
    FROM resolved r
    LEFT JOIN public.game_context gc
      ON gc.match_id = r.match_id
    LEFT JOIN LATERAL (
      SELECT
        array_agg(ptl.teammate_name ORDER BY ptl.teammate_name)
          FILTER (WHERE ptl.teammate_played = false) AS key_teammates_out
      FROM public.player_teammate_log ptl
      WHERE ptl.match_id = r.match_id
        AND (
          (r.pgs_espn_player_id IS NOT NULL AND ptl.espn_player_id = r.pgs_espn_player_id)
          OR (
            r.pgs_espn_player_id IS NULL
            AND public.norm_name_key(ptl.player_name) = public.norm_name_key(COALESCE(r.pgs_player_name, r.player_name))
          )
        )
    ) kt ON TRUE
  ),
  scored_base AS (
    SELECT
      wc.*,
      COALESCE(wc.pgs_espn_player_id, wc.espn_player_id) AS out_espn_player_id,
      COALESCE(wc.pgs_player_name, wc.player_name) AS out_player_name,
      COALESCE(wc.pgs_team, wc.team, wc.gc_home_team, wc.gc_away_team) AS team_guess,
      COALESCE(
        wc.pgs_opponent,
        wc.opponent,
        CASE
          WHEN wc.gc_home_team IS NOT NULL
            AND public.norm_name_key(COALESCE(wc.pgs_team, wc.team, '')) = public.norm_name_key(wc.gc_home_team)
            THEN wc.gc_away_team
          WHEN wc.gc_away_team IS NOT NULL
            AND public.norm_name_key(COALESCE(wc.pgs_team, wc.team, '')) = public.norm_name_key(wc.gc_away_team)
            THEN wc.gc_home_team
          ELSE NULL
        END
      ) AS opponent_guess,
      COALESCE(wc.pgs_game_date, wc.gc_game_date, wc.event_date) AS out_game_date,
      COALESCE(
        wc.pgs_venue,
        CASE
          WHEN wc.gc_home_team IS NOT NULL
            AND public.norm_name_key(COALESCE(wc.pgs_team, wc.team, '')) = public.norm_name_key(wc.gc_home_team)
            THEN 'HOME'
          WHEN wc.gc_away_team IS NOT NULL
            AND public.norm_name_key(COALESCE(wc.pgs_team, wc.team, '')) = public.norm_name_key(wc.gc_away_team)
            THEN 'AWAY'
          ELSE NULL
        END
      ) AS venue_guess,
      CASE wc.bet_type
        WHEN 'points' THEN wc.points::numeric
        WHEN 'threes_made' THEN wc.three_pm::numeric
        WHEN 'rebounds' THEN wc.rebounds::numeric
        WHEN 'assists' THEN wc.assists::numeric
        WHEN 'pra' THEN wc.pra::numeric
        WHEN 'pts_rebs' THEN wc.pts_rebs::numeric
        WHEN 'pts_asts' THEN wc.pts_asts::numeric
        WHEN 'steals' THEN wc.steals::numeric
        WHEN 'blocks' THEN wc.blocks::numeric
        WHEN 'turnovers' THEN wc.turnovers::numeric
        WHEN 'fantasy_score' THEN
          CASE
            WHEN wc.points IS NULL AND wc.rebounds IS NULL AND wc.assists IS NULL
              AND wc.steals IS NULL AND wc.blocks IS NULL AND wc.turnovers IS NULL
              THEN NULL
            ELSE
              COALESCE(wc.points, 0)::numeric +
              (COALESCE(wc.rebounds, 0) * 1.2)::numeric +
              (COALESCE(wc.assists, 0) * 1.5)::numeric +
              (COALESCE(wc.steals, 0) * 3)::numeric +
              (COALESCE(wc.blocks, 0) * 3)::numeric -
              COALESCE(wc.turnovers, 0)::numeric
          END
        ELSE NULL
      END AS actual_value
    FROM with_context wc
  ),
  scored AS (
    SELECT
      sb.*,
      CASE
        WHEN sb.actual_value IS NULL THEN 'pending'
        WHEN sb.side = 'over' AND sb.actual_value > sb.line_value THEN 'won'
        WHEN sb.side = 'over' AND sb.actual_value < sb.line_value THEN 'lost'
        WHEN sb.side = 'under' AND sb.actual_value < sb.line_value THEN 'won'
        WHEN sb.side = 'under' AND sb.actual_value > sb.line_value THEN 'lost'
        ELSE 'push'
      END AS result,
      CASE
        WHEN sb.actual_value IS NULL THEN NULL
        WHEN sb.side = 'over' THEN sb.actual_value - sb.line_value
        WHEN sb.side = 'under' THEN sb.line_value - sb.actual_value
        ELSE NULL
      END AS margin,
      CASE
        WHEN sb.venue_guess = 'HOME' THEN sb.gc_home_rest_days
        WHEN sb.venue_guess = 'AWAY' THEN sb.gc_away_rest_days
        ELSE NULL
      END AS rest_days,
      CASE
        WHEN sb.venue_guess = 'HOME' THEN sb.gc_home_travel_pattern
        WHEN sb.venue_guess = 'AWAY' THEN sb.gc_away_travel_pattern
        ELSE NULL
      END AS travel_pattern,
      CASE
        WHEN sb.venue_guess = 'HOME' THEN sb.gc_away_pace_rank
        WHEN sb.venue_guess = 'AWAY' THEN sb.gc_home_pace_rank
        ELSE NULL
      END AS opp_pace_rank,
      CASE
        WHEN sb.venue_guess = 'HOME' THEN sb.gc_away_drtg_rank
        WHEN sb.venue_guess = 'AWAY' THEN sb.gc_home_drtg_rank
        ELSE NULL
      END AS opp_drtg_rank
    FROM scored_base sb
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
    COALESCE(s.team_guess, 'UNKNOWN') AS team,
    COALESCE(s.opponent_guess, 'UNKNOWN') AS opponent,
    s.out_game_date,
    'nba'::text AS league_id,
    '2025-26'::text AS season,
    s.bet_type,
    s.line_value,
    s.side,
    s.actual_value,
    s.result,
    s.margin,
    s.venue_guess,
    s.rest_days,
    s.travel_pattern,
    s.gc_month_num,
    s.gc_season_phase,
    s.opp_pace_rank,
    CASE
      WHEN s.opp_pace_rank IS NULL THEN NULL
      WHEN s.opp_pace_rank <= 10 THEN 'FAST'
      WHEN s.opp_pace_rank >= 21 THEN 'SLOW'
      ELSE 'MID'
    END AS opp_pace_tier,
    s.opp_drtg_rank,
    s.key_teammates_out,
    s.gc_crew_chief,
    NULL::numeric AS ref_player_delta,
    NULL::integer AS ref_player_sample_games,
    NULL::text AS ref_player_window,
    NULL::text AS ref_player_baseline,
    COALESCE(s.sportsbook, s.provider) AS sportsbook,
    s.odds_american,
    s.open_line,
    s.line_movement,
    'derived'::text AS source
  FROM scored s
  WHERE s.out_game_date IS NOT NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

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
  PERFORM public.refresh_prop_hit_rate_cache();

  SELECT count(*) INTO v_cache FROM public.prop_hit_rate_cache;

  RETURN jsonb_build_object(
    'game_context_upserts', v_gc,
    'player_teammate_log_upserts', v_ptl,
    'player_prop_outcomes_upserts', v_ppo,
    'prop_hit_rate_cache_rows', v_cache,
    'ran_at', now()
  );
END;
$$;

DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'sync-player-game-stats-hourly' LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'sync-player-game-stats-hourly',
  '15 * * * *',
  $$SELECT net.http_post(
    url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sync-player-game-stats',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{"batch_size":120}'::jsonb
  );$$
);

DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'player-prop-outcomes-nightly' LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'player-prop-outcomes-nightly',
  '45 8 * * *',
  $$SELECT public.run_player_prop_pipeline();$$
);
;
