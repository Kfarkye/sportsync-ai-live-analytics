-- 20260112000004_fix_rpc_status_column.sql
-- Fixes the bulk_update_match_odds RPC to use correct 'status' column (not status_state)

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
    odds_api_event_id = item->>'odds_api_event_id'
  from jsonb_array_elements(payload) as item
  where m.id = item->>'id';
end;
$$;

SELECT 'RPC Fixed: Using correct status column (not status_state)' as status;
