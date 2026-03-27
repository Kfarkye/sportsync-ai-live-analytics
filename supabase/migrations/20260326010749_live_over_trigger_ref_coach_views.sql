-- Live NBA over trigger framework with ref x coach adjustment.
-- Produces:
--   1) public.v_nba_live_over_trigger_curve (threshold table per live game)
--   2) public.v_nba_live_over_trigger (single adjusted trigger per live game)

DROP VIEW IF EXISTS public.v_nba_live_over_trigger CASCADE;
DROP VIEW IF EXISTS public.v_nba_live_over_trigger_curve CASCADE;

CREATE OR REPLACE VIEW public.v_nba_live_over_trigger_curve AS
WITH live_latest AS (
  SELECT DISTINCT ON (los.match_id)
    los.match_id,
    los.captured_at,
    los.period,
    los.clock,
    los.home_score,
    los.away_score,
    los.home_team,
    los.away_team,
    los.total::numeric AS live_total,
    los.over_price,
    los.under_price
  FROM public.live_odds_snapshots los
  WHERE los.sport = 'basketball'
    AND los.league_id = 'nba'
    AND los.total IS NOT NULL
    AND los.status = 'STATUS_IN_PROGRESS'
    AND los.captured_at >= now() - interval '4 hours'
  ORDER BY los.match_id, los.captured_at DESC
),
live_state AS (
  SELECT
    ll.*,
    (ll.home_score + ll.away_score)::numeric AS live_points,
    CASE
      WHEN ll.clock LIKE '%:%' THEN split_part(ll.clock, ':', 1)::numeric + (split_part(ll.clock, ':', 2)::numeric / 60.0)
      WHEN ll.clock ~ '^[0-9]+(\\.[0-9]+)?$' THEN (ll.clock::numeric / 60.0)
      ELSE NULL
    END AS q_rem_minutes
  FROM live_latest ll
),
live_state2 AS (
  SELECT
    ls.*,
    CASE
      WHEN ls.period <= 4 THEN ((4 - ls.period) * 12) + ls.q_rem_minutes
      ELSE ls.q_rem_minutes
    END AS game_rem_minutes
  FROM live_state ls
  WHERE ls.q_rem_minutes IS NOT NULL
),
historical_snapshots AS (
  SELECT
    los.match_id,
    los.captured_at,
    los.period,
    (los.home_score + los.away_score)::numeric AS snapshot_points,
    los.total::numeric AS snapshot_total,
    CASE
      WHEN los.clock LIKE '%:%' THEN split_part(los.clock, ':', 1)::numeric + (split_part(los.clock, ':', 2)::numeric / 60.0)
      WHEN los.clock ~ '^[0-9]+(\\.[0-9]+)?$' THEN (los.clock::numeric / 60.0)
      ELSE NULL
    END AS q_rem_minutes,
    (m.home_score + m.away_score)::numeric AS final_total
  FROM public.live_odds_snapshots los
  JOIN public.matches m
    ON m.id = los.match_id
  WHERE los.sport = 'basketball'
    AND los.league_id = 'nba'
    AND los.total IS NOT NULL
    AND los.period BETWEEN 1 AND 5
    AND m.status = 'STATUS_FINAL'
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
),
historical_snapshots2 AS (
  SELECT
    hs.*,
    CASE
      WHEN hs.period <= 4 THEN ((4 - hs.period) * 12) + hs.q_rem_minutes
      ELSE hs.q_rem_minutes
    END AS game_rem_minutes
  FROM historical_snapshots hs
  WHERE hs.q_rem_minutes IS NOT NULL
),
comp_ranked AS (
  SELECT
    ls.match_id AS live_match_id,
    hs2.match_id AS hist_match_id,
    hs2.final_total,
    (
      abs(hs2.game_rem_minutes - ls.game_rem_minutes) * 1.8
      + abs(hs2.snapshot_points - ls.live_points) * 1.2
      + abs(hs2.snapshot_total - ls.live_total) * 0.25
    ) AS comp_distance,
    row_number() OVER (
      PARTITION BY ls.match_id, hs2.match_id
      ORDER BY
        (
          abs(hs2.game_rem_minutes - ls.game_rem_minutes) * 1.8
          + abs(hs2.snapshot_points - ls.live_points) * 1.2
          + abs(hs2.snapshot_total - ls.live_total) * 0.25
        ),
        hs2.captured_at DESC
    ) AS rn_per_hist_game
  FROM live_state2 ls
  JOIN historical_snapshots2 hs2
    ON hs2.match_id <> ls.match_id
   AND hs2.period = ls.period
   AND abs(hs2.game_rem_minutes - ls.game_rem_minutes) <= 3.0
   AND abs(hs2.snapshot_points - ls.live_points) <= 12
   AND abs(hs2.snapshot_total - ls.live_total) <= 16
),
comp_best_per_game AS (
  SELECT *
  FROM comp_ranked
  WHERE rn_per_hist_game = 1
),
comp_top AS (
  SELECT *
  FROM (
    SELECT
      cb.*,
      row_number() OVER (
        PARTITION BY cb.live_match_id
        ORDER BY cb.comp_distance ASC
      ) AS rn_global
    FROM comp_best_per_game cb
  ) ranked
  WHERE rn_global <= 25
),
comp_summary AS (
  SELECT
    live_match_id AS match_id,
    count(*) AS comp_games,
    avg(comp_distance) AS avg_comp_distance
  FROM comp_top
  GROUP BY live_match_id
),
threshold_grid AS (
  SELECT
    ls.match_id,
    gs.threshold::numeric AS threshold
  FROM live_state2 ls
  CROSS JOIN LATERAL (
    SELECT generate_series(
      greatest(floor(ls.live_total) - 10, 185)::int,
      least(ceil(ls.live_total) + 8, 245)::int,
      1
    ) AS threshold
  ) gs
),
curve AS (
  SELECT
    tg.match_id,
    tg.threshold,
    count(*) AS sample_games,
    avg(CASE WHEN ct.final_total > tg.threshold THEN 1.0 ELSE 0.0 END) AS over_win_rate,
    avg(ct.final_total - tg.threshold) AS avg_margin_vs_threshold,
    stddev_pop(ct.final_total) AS stddev_final_total
  FROM threshold_grid tg
  JOIN comp_top ct
    ON ct.live_match_id = tg.match_id
  GROUP BY tg.match_id, tg.threshold
)
SELECT
  ls.match_id,
  ls.captured_at,
  ls.home_team,
  ls.away_team,
  ls.period,
  ls.clock,
  ls.home_score,
  ls.away_score,
  ls.live_total,
  ls.over_price,
  ls.under_price,
  c.threshold,
  c.sample_games,
  c.over_win_rate,
  round((100.0 * c.over_win_rate)::numeric, 1) AS over_win_rate_pct,
  round((100.0 * (c.over_win_rate - 0.5238))::numeric, 1) AS over_edge_pct,
  round(c.avg_margin_vs_threshold::numeric, 2) AS avg_margin_vs_threshold,
  round((
    least(1.0, c.sample_games / 35.0)
    * greatest(0.35, 1.0 - coalesce(c.stddev_final_total, 22.0) / 70.0)
  )::numeric, 3) AS base_confidence_score,
  cs.comp_games,
  round(cs.avg_comp_distance::numeric, 3) AS avg_comp_distance
FROM curve c
JOIN live_state2 ls
  ON ls.match_id = c.match_id
JOIN comp_summary cs
  ON cs.match_id = c.match_id
WHERE cs.comp_games >= 15;

CREATE OR REPLACE VIEW public.v_nba_live_over_trigger AS
WITH live_base AS (
  SELECT DISTINCT ON (v.match_id)
    v.match_id,
    v.captured_at,
    v.home_team,
    v.away_team,
    v.period,
    v.clock,
    v.home_score,
    v.away_score,
    v.live_total,
    v.over_price,
    v.under_price,
    v.comp_games,
    v.avg_comp_distance
  FROM public.v_nba_live_over_trigger_curve v
  ORDER BY v.match_id, v.captured_at DESC
),
base_pick AS (
  SELECT DISTINCT ON (v.match_id)
    v.match_id,
    v.threshold AS base_trigger,
    v.sample_games AS base_sample_games,
    v.over_win_rate AS base_over_win_rate,
    v.over_win_rate_pct AS base_over_win_rate_pct,
    v.over_edge_pct AS base_over_edge_pct,
    v.avg_margin_vs_threshold AS base_avg_margin,
    v.base_confidence_score AS base_confidence
  FROM public.v_nba_live_over_trigger_curve v
  WHERE v.sample_games >= 20
    AND v.over_win_rate >= 0.5238
  ORDER BY
    v.match_id,
    CASE WHEN v.over_win_rate >= 0.55 THEN 0 ELSE 1 END,
    v.threshold DESC
),
league_baseline AS (
  SELECT avg((home_score + away_score)::numeric) AS league_avg_total
  FROM public.matches
  WHERE sport = 'basketball'
    AND league_id = 'nba'
    AND status = 'STATUS_FINAL'
    AND home_score IS NOT NULL
    AND away_score IS NOT NULL
),
current_coaches AS (
  SELECT
    lb.match_id,
    hc.coach_name AS home_coach,
    ac.coach_name AS away_coach
  FROM live_base lb
  LEFT JOIN public.coaches hc
    ON hc.team_name = lb.home_team
   AND hc.sport = 'basketball'
  LEFT JOIN public.coaches ac
    ON ac.team_name = lb.away_team
   AND ac.sport = 'basketball'
),
crew AS (
  SELECT
    lb.match_id,
    go.official_name,
    go.official_position,
    CASE
      WHEN lower(go.official_position) LIKE '%crew chief%' THEN 1.00
      WHEN lower(go.official_position) LIKE '%referee%' THEN 0.88
      WHEN lower(go.official_position) LIKE '%umpire%' THEN 0.80
      ELSE 0.75
    END AS role_weight
  FROM live_base lb
  JOIN public.game_officials go
    ON go.match_id = lb.match_id
),
ref_rows AS (
  SELECT
    c.match_id,
    c.official_name,
    c.official_position,
    c.role_weight,
    rcr.games,
    rcr.over_pct::numeric AS over_pct,
    rcr.avg_total::numeric AS avg_total,
    rcr.ats_cover_pct::numeric AS ats_cover_pct,
    rcr.avg_margin::numeric AS avg_margin
  FROM crew c
  JOIN live_base lb
    ON lb.match_id = c.match_id
  JOIN current_coaches cc
    ON cc.match_id = c.match_id
  LEFT JOIN public.ref_coach_records rcr
    ON rcr.sport = 'basketball'
   AND rcr.ref_name = c.official_name
   AND (
     (rcr.coach = cc.home_coach AND rcr.team = lb.home_team)
     OR (rcr.coach = cc.away_coach AND rcr.team = lb.away_team)
   )
),
ref_delta AS (
  SELECT
    rr.match_id,
    greatest(-2.0, least(2.0,
      sum(
        (
          ((coalesce(rr.avg_total, lb.league_avg_total) - lb.league_avg_total) * 0.45)
          + ((coalesce(rr.over_pct, 50.0) - 50.0) * 0.04)
        )
        * least(1.0, coalesce(rr.games, 0)::numeric / (coalesce(rr.games, 0)::numeric + 14.0))
        * rr.role_weight
      )
      / nullif(sum(least(1.0, coalesce(rr.games, 0)::numeric / (coalesce(rr.games, 0)::numeric + 14.0)) * rr.role_weight), 0)
    )) AS ref_coach_delta_points,
    sum(coalesce(rr.games, 0)) AS ref_coach_sample_games,
    count(*) FILTER (WHERE rr.games IS NOT NULL) AS populated_ref_rows,
    least(1.0, sum(coalesce(rr.games, 0))::numeric / 40.0)
      * least(1.0, count(*) FILTER (WHERE rr.games IS NOT NULL)::numeric / 4.0) AS ref_confidence
  FROM ref_rows rr
  CROSS JOIN league_baseline lb
  GROUP BY rr.match_id
)
SELECT
  lb.match_id,
  lb.captured_at,
  lb.home_team,
  lb.away_team,
  lb.period,
  lb.clock,
  lb.home_score,
  lb.away_score,
  lb.live_total,
  lb.over_price,
  lb.under_price,
  lb.comp_games,
  lb.avg_comp_distance,
  bp.base_trigger,
  bp.base_sample_games,
  bp.base_over_win_rate,
  bp.base_over_win_rate_pct,
  bp.base_over_edge_pct,
  bp.base_avg_margin,
  bp.base_confidence,
  coalesce(rd.ref_coach_delta_points, 0)::numeric AS ref_coach_delta_points,
  rd.ref_coach_sample_games,
  rd.populated_ref_rows,
  coalesce(rd.ref_confidence, 0)::numeric AS ref_confidence,
  round((bp.base_trigger + coalesce(rd.ref_coach_delta_points, 0))::numeric, 2) AS adjusted_trigger,
  round((0.70 * bp.base_confidence + 0.30 * coalesce(rd.ref_confidence, 0))::numeric, 3) AS overall_confidence,
  CASE
    WHEN (0.70 * bp.base_confidence + 0.30 * coalesce(rd.ref_confidence, 0)) >= 0.72 THEN 'HIGH'
    WHEN (0.70 * bp.base_confidence + 0.30 * coalesce(rd.ref_confidence, 0)) >= 0.52 THEN 'MEDIUM'
    ELSE 'LOW'
  END AS confidence_tier,
  CASE
    WHEN lb.live_total <= (bp.base_trigger + coalesce(rd.ref_coach_delta_points, 0)) THEN 'BUY_OVER'
    WHEN lb.live_total <= (bp.base_trigger + coalesce(rd.ref_coach_delta_points, 0) + 2.0) THEN 'WATCH'
    ELSE 'WAIT'
  END AS trigger_state
FROM live_base lb
LEFT JOIN base_pick bp
  ON bp.match_id = lb.match_id
LEFT JOIN ref_delta rd
  ON rd.match_id = lb.match_id;

CREATE INDEX IF NOT EXISTS idx_live_odds_snapshots_nba_live_latest
  ON public.live_odds_snapshots (league_id, sport, match_id, captured_at DESC)
  WHERE sport = 'basketball' AND league_id = 'nba' AND total IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_live_odds_snapshots_nba_period_scan
  ON public.live_odds_snapshots (league_id, sport, period, captured_at DESC)
  WHERE sport = 'basketball' AND league_id = 'nba' AND total IS NOT NULL;

GRANT SELECT ON public.v_nba_live_over_trigger_curve TO anon, authenticated, service_role;
GRANT SELECT ON public.v_nba_live_over_trigger TO anon, authenticated, service_role;;
