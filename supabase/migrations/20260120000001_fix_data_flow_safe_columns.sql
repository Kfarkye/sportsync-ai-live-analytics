-- 20260120000001_fix_data_flow_safe_columns.sql
-- Fixes the bulk_update_match_odds RPC to populate flattened "safe" columns
-- and ensures both ingest-odds and live-odds-tracker schemas are supported.

create or replace function bulk_update_match_odds(payload jsonb)
returns void
language plpgsql
security definer
as $$
begin
  update matches as m
  set
    current_odds = (item->'current_odds')::jsonb,
    opening_odds = coalesce(m.opening_odds, (item->'opening_odds')::jsonb),
    is_opening_locked = coalesce((item->>'is_opening_locked')::boolean, m.is_opening_locked),
    last_odds_update = (item->>'last_odds_update')::timestamptz,
    status = coalesce(item->>'status', m.status),
    odds_api_event_id = item->>'odds_api_event_id',
    
    -- Sync Flattened Columns (Critical for Downstream AI and Filters)
    -- We coalesce multiple possible field names from different ingestors
    odds_home_spread_safe = (
      coalesce(
        item->'current_odds'->>'homeSpread',
        item->'current_odds'->>'spread_home_value'
      )
    )::numeric,
    
    odds_total_safe = (
      coalesce(
        item->'current_odds'->>'total',
        item->'current_odds'->>'total_value'
      )
    )::numeric,
    
    -- ML columns - handle the format '+100' or '-110' by stripping '+' if present
    odds_home_ml_safe = (
      replace(
        coalesce(
          item->'current_odds'->>'homeWin',
          item->'current_odds'->>'home_ml'
        ),
        '+', ''
      )
    )::numeric,
    
    odds_away_ml_safe = (
      replace(
        coalesce(
          item->'current_odds'->>'awayWin',
          item->'current_odds'->>'away_ml'
        ),
        '+', ''
      )
    )::numeric
    
  from jsonb_array_elements(payload) as item
  where m.id = item->>'id';
end;
$$;

SELECT 'RPC Fixed: Synchronizing flattened safe columns for AI and UI' as status;
