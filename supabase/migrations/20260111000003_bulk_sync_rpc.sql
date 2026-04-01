-- 20260111000003_bulk_sync_rpc.sql
-- High-performance bulk update function for odds orchestration

create or replace function bulk_update_match_odds(payload jsonb)
returns void
language plpgsql
security definer
as $$
begin
  update matches as m
  set
    current_odds = (item->'current_odds')::jsonb,
    opening_odds = coalesce(m.opening_odds, (item->'opening_odds')::jsonb), -- Only set if currently null
    is_opening_locked = coalesce((item->>'is_opening_locked')::boolean, m.is_opening_locked),
    last_odds_update = (item->>'last_odds_update')::timestamptz,
    status = coalesce(item->>'status', m.status), -- Only update status if explicitly provided
    odds_api_event_id = (item->>'odds_api_event_id')::text
  from jsonb_array_elements(payload) as item
  where m.id = (item->>'id')::text;
end;
$$;

SELECT 'Bulk Sync RPC Created: Ready for high-volume orchestration' as status;
