CREATE OR REPLACE FUNCTION public.get_player_atgs_summary(p_match_id text)
RETURNS TABLE (
  player_name text,
  team text,
  pool text,
  appearances integer,
  wins integer,
  hit_rate numeric,
  avg_implied numeric,
  edge_vs_book numeric,
  avg_odds_decimal numeric,
  total_profit numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    spo.player_name,
    COALESCE(spo.team_name, spo.team) AS team,
    spo.pool,
    COUNT(*)::int AS appearances,
    COUNT(*) FILTER (WHERE lower(COALESCE(spo.result, '')) IN ('win', 'won', 'hit'))::int AS wins,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE lower(COALESCE(spo.result, '')) IN ('win', 'won', 'hit'))
      / NULLIF(COUNT(*), 0),
      1
    ) AS hit_rate,
    ROUND(AVG(spo.implied_prob), 1) AS avg_implied,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE lower(COALESCE(spo.result, '')) IN ('win', 'won', 'hit'))
      / NULLIF(COUNT(*), 0)
      - AVG(spo.implied_prob),
      1
    ) AS edge_vs_book,
    ROUND(AVG(spo.odds_decimal), 2) AS avg_odds_decimal,
    ROUND(
      SUM(
        CASE
          WHEN lower(COALESCE(spo.result, '')) IN ('win', 'won', 'hit') THEN COALESCE(spo.profit_decimal, 0)
          ELSE -1
        END
      ),
      2
    ) AS total_profit
  FROM public.soccer_player_odds spo
  WHERE spo.match_id = p_match_id
    AND spo.pool = 'anytime'
  GROUP BY spo.player_name, COALESCE(spo.team_name, spo.team), spo.pool
  HAVING COUNT(*) >= 5
  ORDER BY edge_vs_book DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_player_atgs_summary(text) TO anon, authenticated;
