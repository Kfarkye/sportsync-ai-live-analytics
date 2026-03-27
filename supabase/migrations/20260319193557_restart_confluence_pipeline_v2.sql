
-- 1. Create the Batch Confluence Grader
CREATE OR REPLACE FUNCTION public.grade_todays_confluence(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    match_record RECORD;
    graded_count integer := 0;
    result jsonb;
BEGIN
    FOR match_record IN (
        SELECT m.id, m.league_id
        FROM public.matches m
        WHERE m.status IN ('STATUS_FINAL', 'FINAL')
          AND m.start_time::date = p_date
          AND m.league_id IN ('nba', 'mens-college-basketball', 'nhl')
          AND NOT EXISTS (
              SELECT 1 FROM public.confluence_signals cs WHERE cs.match_id = m.id
          )
    ) LOOP
        result := public.record_confluence_signal(match_record.id);
        IF result->>'status' = 'ok' THEN
            graded_count := graded_count + 1;
        END IF;
    END LOOP;

    RETURN graded_count;
END;
$$;

-- 2. Register the Cron Job
-- Fires at 03:00, 05:00, 07:00, 09:00, 11:00 UTC = 10pm, 12am, 2am, 4am, 6am ET
SELECT cron.schedule(
    'grade-confluence-signals',
    '0 3,5,7,9,11 * * *',
    $$ SELECT public.grade_todays_confluence() $$
);
;
