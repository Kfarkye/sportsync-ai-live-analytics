-- Fix silent ESPN drains by authenticating cron -> Edge Function requests.
-- Keeps verify_jwt enabled and reads keys from Vault at execution time.
-- Uses cron.alter_job API (works without direct UPDATE permission on cron.job).

DO $$
DECLARE
  v_secret_exists boolean;
  r record;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM vault.secrets
    WHERE name = 'supabase_service_role_key'
  )
  INTO v_secret_exists;

  IF NOT v_secret_exists THEN
    RAISE EXCEPTION 'Missing required vault secret: supabase_service_role_key';
  END IF;

  FOR r IN
    SELECT *
    FROM (
      VALUES
        (126, 'espn-enrichment-us-majors-2h', '15 */2 * * *', 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/espn-enrichment-drain?league=nba,nfl,nhl,mlb&days=5', 60000),
        (127, 'espn-enrichment-college-2h', '20 */2 * * *', 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/espn-enrichment-drain?league=ncaab,ncaaf&days=5', 60000),
        (128, 'espn-enrichment-soccer-2h', '25 */2 * * *', 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/espn-enrichment-drain?league=epl,laliga,seriea,bundesliga,ligue1,mls,ucl,fifawc,ned.1,por.1,bel.1,tur.1,bra.1,arg.1,sco.1&days=5', 60000),
        (129, 'espn-stats-leaders-6h', '0 */6 * * *', 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/espn-stats-drain?type=leaders&league=nba,nfl,nhl,mlb,ncaab,ncaaf,epl,laliga,seriea,bundesliga,ligue1,mls,ucl,ned.1,por.1,bel.1,tur.1,bra.1,arg.1,sco.1', 30000),
        (130, 'espn-stats-team-stats-6h', '10 */6 * * *', 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/espn-stats-drain?type=team_stats&league=nba,nfl,nhl,mlb,ncaab,ncaaf', 60000),
        (131, 'espn-stats-team-stats-soccer-6h', '12 */6 * * *', 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/espn-stats-drain?type=team_stats&league=epl,laliga,seriea,bundesliga,ligue1,mls,ucl,ned.1,por.1,bel.1,tur.1,bra.1,arg.1,sco.1', 60000),
        (132, 'espn-stats-athletes-us-daily', '0 6 * * *', 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/espn-stats-drain?type=athletes&league=nba,nfl,nhl,mlb,ncaab,ncaaf', 60000),
        (133, 'espn-stats-athletes-soccer-daily', '15 6 * * *', 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/espn-stats-drain?type=athletes&league=epl,laliga,seriea,bundesliga,ligue1,mls,ucl,ned.1,por.1,bel.1,tur.1,bra.1,arg.1,sco.1', 60000),
        (134, 'espn-stats-gamelogs-us-6h', '20 */6 * * *', 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/espn-stats-drain?type=game_logs&league=nba,nfl,nhl,mlb&per_team=3', 60000),
        (135, 'espn-stats-gamelogs-soccer-6h', '25 */6 * * *', 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/espn-stats-drain?type=game_logs&league=epl,laliga,seriea,bundesliga,ligue1,mls,ucl,ned.1,por.1,bel.1,tur.1,bra.1,arg.1,sco.1&per_team=3', 60000)
    ) AS t(jobid, jobname, schedule, url, timeout_ms)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM cron.job j
      WHERE j.jobid = r.jobid
        AND j.jobname = r.jobname
    ) THEN
      RAISE EXCEPTION 'Expected cron job missing or renamed: id=% name=%', r.jobid, r.jobname;
    END IF;

    PERFORM cron.alter_job(
      r.jobid,
      r.schedule,
      format(
$cmd$
SELECT net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key'),
    'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := %s
);
$cmd$,
        r.url,
        r.timeout_ms
      ),
      NULL,
      NULL,
      true
    );
  END LOOP;
END
$$;
