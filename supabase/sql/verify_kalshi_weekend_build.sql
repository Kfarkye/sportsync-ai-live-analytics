-- Weekend build verification: Kalshi snapshots + ESPN divergence wiring
-- Run in SQL editor or psql against sportsync-api.

-- 1) Migration applied
select
  version,
  inserted_at
from supabase_migrations.schema_migrations
where version in ('20260318000005')
order by version;

-- 2) Core DB objects present
select
  'mv_espn_kalshi_total_divergence_curve' as object_name,
  case when to_regclass('public.mv_espn_kalshi_total_divergence_curve') is not null then 'present' else 'missing' end as status
union all
select
  'apply_kalshi_closing_prices_from_snapshots(jsonb)',
  case when exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'apply_kalshi_closing_prices_from_snapshots'
  ) then 'present' else 'missing' end
union all
select
  'refresh_mv_espn_kalshi_total_divergence_curve()',
  case when exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'refresh_mv_espn_kalshi_total_divergence_curve'
  ) then 'present' else 'missing' end;

-- 3) Cron registration checks
select
  jobid,
  jobname,
  schedule,
  active,
  nodename,
  nodeport,
  database,
  username
from cron.job
where jobname in (
  'drain-kalshi-orderbook-discovery-nba',
  'drain-kalshi-orderbook-discovery-ncaamb',
  'drain-kalshi-orderbook-discovery-nhl',
  'drain-kalshi-orderbook-discovery-mlb',
  'drain-kalshi-orderbook-discovery-soccer',
  'drain-kalshi-orderbook-discovery-nfl',
  'drain-kalshi-orderbook-pregame',
  'drain-kalshi-orderbook-live',
  'refresh-mv-espn-kalshi-total-divergence'
)
order by jobname;

-- 4) Snapshot health (last 24h)
select
  snapshot_type,
  count(*)::bigint as rows_24h,
  min(captured_at) as first_capture_24h,
  max(captured_at) as latest_capture_24h
from public.kalshi_orderbook_snapshots
where captured_at >= now() - interval '24 hours'
group by snapshot_type
order by snapshot_type;

-- 5) Closing-price fill progress
select
  count(*)::bigint as total_kalshi_markets,
  count(*) filter (where closing_price is not null)::bigint as closing_price_filled,
  round(
    100.0 * count(*) filter (where closing_price is not null) / nullif(count(*), 0),
    2
  ) as closing_price_fill_pct
from public.kalshi_line_markets;

-- 6) Divergence MV population and anchor coverage
select
  count(*)::bigint as mv_rows,
  count(distinct match_id)::bigint as matches_covered,
  count(*) filter (where is_dk_anchor_line)::bigint as anchor_rows,
  max(match_start_time) as latest_match_start
from public.mv_espn_kalshi_total_divergence_curve;

-- 7) Recent anchor samples for consumer cards
select
  match_id,
  home_team,
  away_team,
  dk_open_total,
  kalshi_line_value,
  espn_opening_total_over_prob,
  kalshi_implied_over_prob,
  espn_kalshi_prob_gap,
  kalshi_price_source,
  kalshi_price_captured_at,
  latest_live_over_prob,
  latest_live_captured_at
from public.mv_espn_kalshi_total_divergence_curve
where is_dk_anchor_line
order by match_start_time desc
limit 20;
