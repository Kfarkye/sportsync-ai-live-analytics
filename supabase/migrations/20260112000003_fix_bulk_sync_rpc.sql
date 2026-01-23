-- 20260112000003_fix_bulk_sync_rpc.sql
-- Fixes the bulk_update_match_odds RPC:
-- 1. Changes 'status' to 'status_state' to match actual schema
-- 2. Removes unnecessary ::text cast since matches.id is already TEXT

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
    status_state = coalesce(item->>'status_state', m.status_state),
    odds_api_event_id = item->>'odds_api_event_id'
  from jsonb_array_elements(payload) as item
  where m.id = item->>'id';
end;
$$;

SELECT 'Bulk Sync RPC Fixed: status_state and type casting corrected' as status;
