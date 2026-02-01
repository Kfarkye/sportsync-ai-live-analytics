-- 20260201000100_fix_v_ready_for_intel_all_sports.sql
-- Fix: Soccer (Bundesliga, Liga MX) was excluded because view required specific key names
-- Strategy: Check multiple key variants for spread AND total
--   - Tennis: ML-only is acceptable
--   - All other sports: require SOME spread + SOME total (flexible key names)

begin;

drop view if exists public.v_ready_for_intel;

create view public.v_ready_for_intel as
select
  m.id,
  m.home_team,
  m.away_team,
  m.start_time,
  m.sport,
  m.league_id,
  m.status,
  m.current_odds,
  m.odds_home_spread_safe,
  m.odds_total_safe
from public.matches m
where
  m.status IN ('STATUS_SCHEDULED', 'SCHEDULED')
  AND m.start_time > (NOW() - INTERVAL '1 hour')
  AND m.current_odds IS NOT NULL
  AND (
    -- TENNIS PATH: allow through if ANY usable market exists (ML-only is fine)
    (
      coalesce(lower(m.sport), '') = 'tennis'
      AND (
        (m.current_odds->>'homeMl') is not null
        or (m.current_odds->>'awayMl') is not null
        or (m.current_odds->>'home_ml') is not null
        or (m.current_odds->>'away_ml') is not null
        or (m.current_odds->>'homeWin') is not null
        or (m.current_odds->>'awayWin') is not null
        or (m.current_odds->>'gamesHandicap') is not null
        or (m.current_odds->>'spread') is not null
        or (m.current_odds->>'total') is not null
      )
    )
    OR
    -- ALL OTHER SPORTS: require spread + total (flexible key names)
    (
      coalesce(lower(m.sport), '') <> 'tennis'
      AND (
        -- Has SOME spread key
        (m.current_odds->>'homeSpread') is not null
        OR (m.current_odds->>'awaySpread') is not null
        OR (m.current_odds->>'spread') is not null
        OR (m.current_odds->>'spread_home') is not null
        OR (m.current_odds->>'spread_home_value') is not null
        OR (m.current_odds->>'home_spread') is not null
        OR jsonb_typeof(m.current_odds->'spread_best') = 'object'
      )
      AND (
        -- Has SOME total key
        (m.current_odds->>'total') is not null
        OR (m.current_odds->>'total_value') is not null
        OR (m.current_odds->>'overUnder') is not null
        OR (m.current_odds->>'gameTotal') is not null
        OR jsonb_typeof(m.current_odds->'total_best') = 'object'
      )
    )
  );

commit;
