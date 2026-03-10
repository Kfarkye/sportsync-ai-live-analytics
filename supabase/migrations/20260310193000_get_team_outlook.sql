CREATE OR REPLACE FUNCTION public.get_team_outlook(
  p_team_name TEXT,
  p_league_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  WITH normalized AS (
    SELECT
      p_team_name AS team_name,
      lower(regexp_replace(p_team_name, '[^a-z0-9]+', ' ', 'gi')) AS team_key,
      CASE
        WHEN p_league_id IS NULL OR btrim(p_league_id) = '' THEN NULL
        ELSE p_league_id
      END AS league_filter
  ),
  team_matches AS (
    SELECT
      m.id,
      m.home_team,
      m.away_team,
      m.home_team_id,
      m.away_team_id,
      m.league_id,
      m.start_time,
      m.home_score,
      m.away_score,
      (m.home_score + m.away_score) AS total_goals
    FROM matches m
    CROSS JOIN normalized n
    WHERE m.status IN ('STATUS_FINAL', 'STATUS_FULL_TIME')
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND (n.league_filter IS NULL OR m.league_id = n.league_filter)
      AND (
        m.home_team = n.team_name
        OR m.away_team = n.team_name
        OR lower(regexp_replace(m.home_team, '[^a-z0-9]+', ' ', 'gi')) = n.team_key
        OR lower(regexp_replace(m.away_team, '[^a-z0-9]+', ' ', 'gi')) = n.team_key
      )
  ),
  per_league_totals AS (
    SELECT
      tm.league_id,
      count(*)::INT AS games,
      count(*) FILTER (WHERE tm.total_goals BETWEEN 2 AND 3)::INT AS band_23,
      round(
        100.0 * count(*) FILTER (WHERE tm.total_goals BETWEEN 2 AND 3)
        / NULLIF(count(*), 0),
        1
      ) AS band_23_pct
    FROM team_matches tm
    GROUP BY tm.league_id
  ),
  profile AS (
    SELECT
      ou.league_id,
      coalesce(t.games, 0)::INT AS games,
      coalesce(ou.games_with_line, 0)::INT AS games_with_line,
      coalesce(ou.over_count, 0)::INT AS over_count,
      coalesce(ou.under_count, 0)::INT AS under_count,
      coalesce(ou.push_count, 0)::INT AS push_count,
      round(ou.over_rate::NUMERIC, 1) AS over_rate,
      round(ou.under_rate::NUMERIC, 1) AS under_rate,
      round(ou.avg_posted_total::NUMERIC, 1) AS avg_line,
      round(ou.avg_actual_total::NUMERIC, 1) AS avg_actual,
      coalesce(t.band_23, 0)::INT AS band_23,
      t.band_23_pct
    FROM mv_team_ou_vs_line ou
    CROSS JOIN normalized n
    LEFT JOIN per_league_totals t
      ON t.league_id = ou.league_id
    WHERE ou.team_name = n.team_name
      AND (n.league_filter IS NULL OR ou.league_id = n.league_filter)
  ),
  primary_goal_league AS (
    SELECT coalesce(
      (
        SELECT tm.league_id
        FROM team_matches tm
        WHERE tm.league_id NOT IN ('uefa.champions', 'uefa.europa')
        GROUP BY tm.league_id
        ORDER BY count(*) DESC, max(tm.start_time) DESC
        LIMIT 1
      ),
      (
        SELECT tm.league_id
        FROM team_matches tm
        GROUP BY tm.league_id
        ORDER BY count(*) DESC, max(tm.start_time) DESC
        LIMIT 1
      )
    ) AS league_id
  ),
  goal_dist AS (
    SELECT
      tm.total_goals AS total,
      count(*)::INT AS games,
      round(
        100.0 * count(*)
        / NULLIF(sum(count(*)) OVER (), 0),
        1
      ) AS pct
    FROM team_matches tm
    JOIN primary_goal_league pgl
      ON pgl.league_id = tm.league_id
    GROUP BY tm.total_goals
    ORDER BY tm.total_goals
  ),
  band AS (
    SELECT
      count(*)::INT AS total_games,
      count(*) FILTER (WHERE tm.total_goals BETWEEN 2 AND 3)::INT AS band_23,
      round(
        100.0 * count(*) FILTER (WHERE tm.total_goals BETWEEN 2 AND 3)
        / NULLIF(count(*), 0),
        1
      ) AS band_23_pct
    FROM team_matches tm
  ),
  upcoming AS (
    SELECT
      m.id,
      m.home_team,
      m.away_team,
      m.home_team_id,
      m.away_team_id,
      m.league_id,
      m.start_time,
      CASE
        WHEN m.home_team = n.team_name
          OR lower(regexp_replace(m.home_team, '[^a-z0-9]+', ' ', 'gi')) = n.team_key
        THEN 'Home'
        ELSE 'Away'
      END AS venue,
      CASE
        WHEN m.home_team = n.team_name
          OR lower(regexp_replace(m.home_team, '[^a-z0-9]+', ' ', 'gi')) = n.team_key
        THEN m.away_team
        ELSE m.home_team
      END AS opponent,
      CASE
        WHEN m.home_team = n.team_name
          OR lower(regexp_replace(m.home_team, '[^a-z0-9]+', ' ', 'gi')) = n.team_key
        THEN m.home_team_id
        ELSE m.away_team_id
      END AS team_espn_id,
      CASE
        WHEN m.home_team = n.team_name
          OR lower(regexp_replace(m.home_team, '[^a-z0-9]+', ' ', 'gi')) = n.team_key
        THEN m.away_team_id
        ELSE m.home_team_id
      END AS opponent_espn_id
    FROM matches m
    CROSS JOIN normalized n
    WHERE (n.league_filter IS NULL OR m.league_id = n.league_filter)
      AND m.start_time > now()
      AND m.status NOT IN ('STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_CANCELED', 'STATUS_POSTPONED')
      AND (
        m.home_team = n.team_name
        OR m.away_team = n.team_name
        OR lower(regexp_replace(m.home_team, '[^a-z0-9]+', ' ', 'gi')) = n.team_key
        OR lower(regexp_replace(m.away_team, '[^a-z0-9]+', ' ', 'gi')) = n.team_key
      )
    ORDER BY m.start_time
    LIMIT 5
  ),
  fixtures AS (
    SELECT
      u.id,
      u.home_team,
      u.away_team,
      u.league_id,
      u.start_time,
      u.venue,
      u.opponent,
      u.team_espn_id,
      u.opponent_espn_id,
      opp_ou.over_rate AS opp_over_rate,
      opp_ou.under_rate AS opp_under_rate,
      opp_ou.games_with_line AS opp_ou_sample,
      round(opp_ou.avg_actual_total::NUMERIC, 1) AS opp_avg_actual,
      opp_form.form_string AS opp_form,
      opp_form.wins AS opp_w,
      opp_form.draws AS opp_d,
      opp_form.losses AS opp_l
    FROM upcoming u
    LEFT JOIN mv_team_ou_vs_line opp_ou
      ON opp_ou.team_name = u.opponent
     AND opp_ou.league_id = u.league_id
    LEFT JOIN mv_team_rolling_form opp_form
      ON opp_form.team_name = u.opponent
     AND opp_form.league_id = u.league_id
  ),
  team_identity AS (
    SELECT
      coalesce(
        (
          SELECT CASE
            WHEN tm.home_team = n.team_name
              OR lower(regexp_replace(tm.home_team, '[^a-z0-9]+', ' ', 'gi')) = n.team_key
            THEN tm.home_team
            ELSE tm.away_team
          END
          FROM team_matches tm
          CROSS JOIN normalized n
          ORDER BY tm.start_time DESC
          LIMIT 1
        ),
        p_team_name
      ) AS team_name,
      (
        SELECT CASE
          WHEN tm.home_team = n.team_name
            OR lower(regexp_replace(tm.home_team, '[^a-z0-9]+', ' ', 'gi')) = n.team_key
          THEN tm.home_team_id
          ELSE tm.away_team_id
        END
        FROM team_matches tm
        CROSS JOIN normalized n
        ORDER BY tm.start_time DESC
        LIMIT 1
      ) AS team_espn_id
  )
  SELECT jsonb_build_object(
    'team', (SELECT ti.team_name FROM team_identity ti),
    'team_espn_id', (SELECT ti.team_espn_id FROM team_identity ti),
    'goal_dist_league_id', (SELECT pgl.league_id FROM primary_goal_league pgl),
    'profile', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.games DESC, p.league_id) FROM profile p), '[]'::JSONB),
    'goal_dist', coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.total) FROM goal_dist g), '[]'::JSONB),
    'band', coalesce((SELECT to_jsonb(b) FROM band b), '{}'::JSONB),
    'fixtures', coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.start_time) FROM fixtures f), '[]'::JSONB)
  )
  INTO v_result;

  RETURN coalesce(v_result, '{}'::JSONB);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_outlook(TEXT, TEXT) TO anon, authenticated, service_role;
