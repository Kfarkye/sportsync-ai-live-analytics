-- 1. Trigger all 3 functions
SELECT invoke_ingest_odds();
SELECT invoke_sync_player_props();
SELECT invoke_pregame_intel_cron();

-- 2. Check the net extension responses (we want to see the "logs" field in the body if possible)
-- Note: Some functions might return 200 OK but then fail internally, which we'll see in Supabase Dashboard Logs.
SELECT 
    q.url,
    r.status,
    r.body
FROM net.http_request_queue q
JOIN net.http_responses r ON q.id = r.id
ORDER BY q.created_at DESC
LIMIT 5;
