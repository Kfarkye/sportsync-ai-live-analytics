-- QUOTA STATUS AUDIT
-- Check how many games were successfully processed before the quota hit

SELECT 
    COUNT(*) as total_intel,
    league_id,
    MIN(created_at) as earliest,
    MAX(created_at) as latest
FROM pregame_intel
WHERE created_at > now() - interval '1 hour'
GROUP BY league_id;
