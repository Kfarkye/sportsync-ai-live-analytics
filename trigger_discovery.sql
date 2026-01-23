-- Manually trigger the Match Discovery Cron (Capture Opening Lines)
-- Run this in the Supabase SQL Editor

SELECT invoke_match_discovery();

-- Check the logs to see the result (optional)
-- SELECT * FROM pregame_intel_log ORDER BY created_at DESC LIMIT 5;
