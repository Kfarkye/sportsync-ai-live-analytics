-- Soccer team+venue UNDER trends (market-line aware, Bet365 totals)
-- Zone: DATA/ID (Amazon+Google) + OPS (SRE+Amazon)

DROP VIEW IF EXISTS public.vw_soccer_team_total_venue_page;
DROP MATERIALIZED VIEW IF EXISTS public.mv_soccer_team_total_venue_trends;
DROP MATERIALIZED VIEW IF EXISTS public.mv_soccer_team_total_venue_games;
DROP FUNCTION IF EXISTS public.refresh_soccer_team_total_trend_views();

CREATE MATERIALIZED VIEW public.mv_soccer_team_total_venue_games AS
WITH source AS (
  SELECT
    s.match_id,
    s.league_id,
    s.match_date,
    s.home_team,
    s.away_team,
    s.b365_ou_handicap::numeric AS market_total_line,
    s.b365_under_dec::numeric AS under_odds_decimal,
    s.total_goals::numeric AS actual_total_goals
  FROM public.soccer_bet365_team_odds s
  WHERE s.b365_ou_handicap IS NOT NULL
    AND s.total_goals IS NOT NULL
),
expanded AS (
  SELECT
    src.match_id,
    src.league_id,
    src.match_date,
    src.home_team AS team_name,
    'HOME'::text AS venue,
    src.away_team AS opponent_name,
    src.market_total_line,
    src.under_odds_decimal,
    src.actual_total_goals
  FROM source src
  UNION ALL
  SELECT
    src.match_id,
    src.league_id,
    src.match_date,
    src.away_team AS team_name,
    'AWAY'::text AS venue,
    src.home_team AS opponent_name,
    src.market_total_line,
    src.under_odds_decimal,
    src.actual_total_goals
  FROM source src
)
SELECT
  e.match_id,
  e.league_id,
  e.match_date,
  e.team_name,
  e.venue,
  e.opponent_name,
  e.market_total_line,
  e.under_odds_decimal,
  CASE
    WHEN e.under_odds_decimal IS NULL OR e.under_odds_decimal <= 1 THEN NULL
    WHEN e.under_odds_decimal >= 2 THEN round((e.under_odds_decimal - 1) * 100)::int
    ELSE round(-100 / (e.under_odds_decimal - 1))::int
  END AS under_odds_american,
  e.actual_total_goals,
  CASE
    WHEN e.actual_total_goals < e.market_total_line THEN 'win'
    WHEN e.actual_total_goals > e.market_total_line THEN 'loss'
    ELSE 'push'
  END AS result_under,
  (e.actual_total_goals < e.market_total_line) AS is_under_win,
  (e.actual_total_goals > e.market_total_line) AS is_under_loss,
  (e.actual_total_goals = e.market_total_line) AS is_push
FROM expanded e;

CREATE UNIQUE INDEX mv_soccer_team_total_venue_games_uidx
  ON public.mv_soccer_team_total_venue_games (match_id, venue);

CREATE INDEX mv_soccer_team_total_venue_games_lookup_idx
  ON public.mv_soccer_team_total_venue_games (league_id, team_name, venue, match_date DESC);

CREATE MATERIALIZED VIEW public.mv_soccer_team_total_venue_trends AS
WITH aggregated AS (
  SELECT
    g.league_id,
    g.team_name,
    g.venue,
    count(*) FILTER (WHERE NOT g.is_push)::int AS graded_games,
    count(*) FILTER (WHERE g.is_under_win)::int AS under_wins,
    count(*) FILTER (WHERE g.is_under_loss)::int AS under_losses,
    round(avg(g.market_total_line) FILTER (WHERE NOT g.is_push), 2) AS avg_line,
    round(avg(g.actual_total_goals) FILTER (WHERE NOT g.is_push), 2) AS avg_total,
    round(avg(g.under_odds_american::numeric) FILTER (WHERE NOT g.is_push), 0)::int AS avg_under_odds_american,
    max(g.match_date) AS last_match_date
  FROM public.mv_soccer_team_total_venue_games g
  GROUP BY g.league_id, g.team_name, g.venue
)
SELECT
  a.league_id,
  a.team_name,
  a.venue,
  a.graded_games,
  a.under_wins,
  a.under_losses,
  (a.under_wins::text || '-' || a.under_losses::text) AS record,
  CASE
    WHEN a.graded_games > 0
      THEN round(100.0 * a.under_wins::numeric / a.graded_games, 1)
    ELSE NULL
  END AS under_pct,
  a.avg_line,
  a.avg_total,
  a.avg_under_odds_american,
  a.last_match_date,
  rank() OVER (
    PARTITION BY a.league_id
    ORDER BY
      CASE WHEN a.graded_games > 0 THEN a.under_wins::numeric / a.graded_games ELSE NULL END DESC NULLS LAST,
      a.graded_games DESC,
      a.under_wins DESC,
      a.team_name ASC
  )::int AS league_rank_under_pct,
  rank() OVER (
    ORDER BY
      CASE WHEN a.graded_games > 0 THEN a.under_wins::numeric / a.graded_games ELSE NULL END DESC NULLS LAST,
      a.graded_games DESC,
      a.under_wins DESC,
      a.team_name ASC
  )::int AS global_rank_under_pct
FROM aggregated a;

CREATE UNIQUE INDEX mv_soccer_team_total_venue_trends_uidx
  ON public.mv_soccer_team_total_venue_trends (league_id, team_name, venue);

CREATE INDEX mv_soccer_team_total_venue_trends_league_pct_idx
  ON public.mv_soccer_team_total_venue_trends (league_id, under_pct DESC, graded_games DESC);

CREATE INDEX mv_soccer_team_total_venue_trends_global_pct_idx
  ON public.mv_soccer_team_total_venue_trends (under_pct DESC, graded_games DESC);

CREATE OR REPLACE VIEW public.vw_soccer_team_total_venue_page AS
SELECT
  t.league_id,
  t.team_name,
  t.venue,
  t.graded_games,
  t.under_wins,
  t.under_losses,
  t.record,
  t.under_pct,
  t.avg_line,
  t.avg_total,
  t.avg_under_odds_american,
  t.last_match_date,
  t.league_rank_under_pct,
  t.global_rank_under_pct
FROM public.mv_soccer_team_total_venue_trends t;

CREATE OR REPLACE FUNCTION public.refresh_soccer_team_total_trend_views()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_games_rows bigint;
  v_trends_rows bigint;
BEGIN
  IF to_regclass('public.mv_soccer_team_total_venue_games') IS NULL THEN
    RAISE EXCEPTION 'Missing dependency: public.mv_soccer_team_total_venue_games';
  END IF;

  IF to_regclass('public.mv_soccer_team_total_venue_trends') IS NULL THEN
    RAISE EXCEPTION 'Missing dependency: public.mv_soccer_team_total_venue_trends';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.mv_soccer_team_total_venue_games'::regclass
      AND i.indisunique
      AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'Concurrent refresh prerequisite missing: unique index on mv_soccer_team_total_venue_games';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.mv_soccer_team_total_venue_trends'::regclass
      AND i.indisunique
      AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'Concurrent refresh prerequisite missing: unique index on mv_soccer_team_total_venue_trends';
  END IF;

  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_soccer_team_total_venue_games;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Base refresh failed (mv_soccer_team_total_venue_games); dependent refresh aborted: %', SQLERRM;
  END;

  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_soccer_team_total_venue_trends;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Dependent refresh failed (mv_soccer_team_total_venue_trends) after base refresh: %', SQLERRM;
  END;

  SELECT count(*)::bigint INTO v_games_rows
  FROM public.mv_soccer_team_total_venue_games;

  SELECT count(*)::bigint INTO v_trends_rows
  FROM public.mv_soccer_team_total_venue_trends;

  RETURN jsonb_build_object(
    'status', 'refreshed',
    'games_rows', v_games_rows,
    'trends_rows', v_trends_rows,
    'refreshed_at', now()
  );
END;
$$;

GRANT SELECT ON public.mv_soccer_team_total_venue_games TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_soccer_team_total_venue_trends TO anon, authenticated, service_role;
GRANT SELECT ON public.vw_soccer_team_total_venue_page TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_soccer_team_total_trend_views() TO service_role;

DO $cron$
DECLARE
  v_jobid integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    SELECT jobid INTO v_jobid
    FROM cron.job
    WHERE jobname = 'refresh-soccer-team-total-trends-30m'
    LIMIT 1;

    IF v_jobid IS NOT NULL THEN
      PERFORM cron.unschedule(v_jobid);
    END IF;

    PERFORM cron.schedule(
      'refresh-soccer-team-total-trends-30m',
      '*/30 * * * *',
      $$SELECT public.refresh_soccer_team_total_trend_views();$$
    );
  END IF;
END
$cron$;

COMMENT ON MATERIALIZED VIEW public.mv_soccer_team_total_venue_games IS
'Canonical one-row-per-team-per-match (HOME/AWAY) soccer totals grading object versus that match Bet365 O/U line.';

COMMENT ON MATERIALIZED VIEW public.mv_soccer_team_total_venue_trends IS
'Soccer trends page aggregate: team+venue UNDER performance against market total line (pushes excluded from graded record).';

COMMENT ON FUNCTION public.refresh_soccer_team_total_trend_views() IS
'Refreshes soccer team-total trend materialized views in dependency order with concurrent refresh guards.';

-- Validation query (sample teams from product brief):
-- SELECT league_id, team_name, venue, graded_games, under_wins, under_losses, record, under_pct, avg_line, avg_total
-- FROM public.vw_soccer_team_total_venue_page
-- WHERE (league_id, team_name, venue) IN (
--   ('epl','Wolverhampton Wanderers','AWAY'),
--   ('epl','Liverpool','HOME'),
--   ('epl','Everton','AWAY'),
--   ('epl','Sunderland','AWAY'),
--   ('seriea','Lazio','AWAY'),
--   ('bel.1','RAAL La Louvière','HOME'),
--   ('ligue1','Le Havre AC','AWAY'),
--   ('ned.1','FC Volendam','AWAY'),
--   ('sco.1','Aberdeen','AWAY')
-- )
-- ORDER BY under_pct DESC, graded_games DESC;
