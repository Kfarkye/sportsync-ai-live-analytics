-- ============================================================
-- TITANIUM ANALYTICS v3.4: FIX TRENDS TO SHOW DAILY RECORD
-- ============================================================

BEGIN;

DROP VIEW IF EXISTS vw_titan_api_gateway CASCADE;
DROP VIEW IF EXISTS vw_titan_trends CASCADE;

-- TRENDS (Now with proper record, not misleading "units")
CREATE VIEW vw_titan_trends AS
WITH daily_stats AS (
    SELECT 
        game_date,
        COUNT(*) as daily_picks,
        COUNT(*) FILTER (WHERE pick_result = 'WIN') as daily_wins,
        COUNT(*) FILTER (WHERE pick_result = 'LOSS') as daily_losses,
        COUNT(*) FILTER (WHERE pick_result = 'PUSH') as daily_pushes
    FROM vw_titan_master
    WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
    GROUP BY game_date
)
SELECT 
    game_date,
    daily_picks,
    daily_wins,
    daily_losses,
    daily_pushes,
    -- Cumulative record
    SUM(daily_wins) OVER (ORDER BY game_date) as cumulative_wins,
    SUM(daily_losses) OVER (ORDER BY game_date) as cumulative_losses,
    -- Daily win rate
    ROUND((daily_wins::numeric / NULLIF(daily_wins + daily_losses, 0)) * 100, 1) as daily_win_rate
FROM daily_stats
ORDER BY game_date DESC;

-- API GATEWAY (Rebuild with updated trends)
CREATE VIEW vw_titan_api_gateway AS
SELECT 
    json_build_object(
        'executive', (SELECT row_to_json(s) FROM vw_titan_summary s),
        'leagues', (SELECT json_agg(l) FROM vw_titan_leagues l),
        'buckets', (SELECT json_agg(b) FROM vw_titan_buckets b),
        'heatmap', (SELECT json_agg(h) FROM vw_titan_heatmap h),
        'trends', (SELECT json_agg(t) FROM vw_titan_trends t)
    ) as payload;

COMMIT;
