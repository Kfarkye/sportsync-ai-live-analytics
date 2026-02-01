-- 20260131000100_fix_v_ready_for_intel_tennis.sql
-- Fix: Tennis was excluded because v_ready_for_intel required homeSpread + total keys.
-- Strategy: sport-aware gating:
--   - Non-tennis: require spread + total (existing behavior)
--   - Tennis: require ANY usable market (ML or tennis-specific spread/total keys)

begin;

-- Drop and recreate to avoid "create or replace view" dependency surprises
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
    -- TENNIS PATH: allow through if ANY usable market exists
    (
      coalesce(lower(m.sport), '') = 'tennis'
      AND (
        -- Moneyline present
        (m.current_odds->>'homeMl') is not null
        or (m.current_odds->>'awayMl') is not null
        or (m.current_odds->>'home_ml') is not null
        or (m.current_odds->>'away_ml') is not null
        or (m.current_odds->>'homeWin') is not null
        or (m.current_odds->>'awayWin') is not null

        -- Tennis handicap / games spread (common variants)
        or (m.current_odds->>'gamesHandicap') is not null
        or (m.current_odds->>'homeGamesHandicap') is not null
        or (m.current_odds->>'awayGamesHandicap') is not null
        or (m.current_odds->>'spread_home_value') is not null
        or (m.current_odds->>'spread') is not null

        -- Tennis totals (total games, sets, etc)
        or (m.current_odds->>'totalGames') is not null
        or (m.current_odds->>'gamesTotal') is not null
        or (m.current_odds->>'total_value') is not null
        or (m.current_odds->>'total') is not null
      )
    )
    OR
    -- NON-TENNIS PATH: preserve strict gate (spread + total)
    (
      coalesce(lower(m.sport), '') <> 'tennis'
      AND (m.current_odds->>'homeSpread') is not null
      AND (m.current_odds->>'total') is not null
    )
  );

commit;
