-- ===============================================================
-- MANUAL TRIGGER: Pregame Intel Cron
-- ===============================================================

-- 1. Create/Update the trigger function
CREATE OR REPLACE FUNCTION invoke_pregame_intel_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_url text;
  service_key text;
BEGIN
  -- Get configuration from vault (standard Supabase setup)
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1;
  
  -- Fallback logic for URL
  IF base_url IS NULL OR base_url = '' THEN
     base_url := 'https://' || current_database() || '.supabase.co';
  END IF;

  -- Make the HTTP call to the edge function
  IF base_url IS NOT NULL AND service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := base_url || '/functions/v1/pregame-intel-cron',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- 2. Execute the manual trigger
SELECT invoke_pregame_intel_cron();

-- 3. Verification Query:
/*
SELECT 
    m.start_time,
    m.home_team, 
    m.away_team, 
    CASE 
        WHEN p.match_id IS NOT NULL THEN '✅ READY' 
        ELSE '⚠️ WAITING' 
    END as cache_status
FROM matches m
LEFT JOIN pregame_intel p ON m.id = p.match_id
WHERE m.start_time BETWEEN NOW() AND (NOW() + INTERVAL '24 hours')
ORDER BY m.start_time ASC;
*/
