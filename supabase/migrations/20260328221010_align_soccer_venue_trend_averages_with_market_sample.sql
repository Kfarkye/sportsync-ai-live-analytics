-- Align soccer team+venue trend averages with validated market-line sample semantics.
-- Graded record remains win/loss only, while average fields include all line-bearing games (including pushes).
-- Zone: DATA/ID (Amazon+Google)

DROP VIEW IF EXISTS public.vw_soccer_team_total_venue_page;
DROP MATERIALIZED VIEW IF EXISTS public.mv_soccer_team_total_venue_trends;

CREATE MATERIALIZED VIEW public.mv_soccer_team_total_venue_trends AS
WITH aggregated AS (
  SELECT
    g.league_id,
    g.team_name,
    g.venue,
    count(*) FILTER (WHERE NOT g.is_push)::int AS graded_games,
    count(*) FILTER (WHERE g.is_under_win)::int AS under_wins,
    count(*) FILTER (WHERE g.is_under_loss)::int AS under_losses,
    round(avg(g.market_total_line), 2) AS avg_line,
    round(avg(g.actual_total_goals), 2) AS avg_total,
    round(avg(g.under_odds_american::numeric), 0)::int AS avg_under_odds_american,
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

GRANT SELECT ON public.mv_soccer_team_total_venue_trends TO anon, authenticated, service_role;
GRANT SELECT ON public.vw_soccer_team_total_venue_page TO anon, authenticated, service_role;
