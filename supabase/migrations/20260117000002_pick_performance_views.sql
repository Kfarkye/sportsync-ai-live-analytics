-- Create views for pick performance reporting
-- Run this in Supabase SQL Editor

-- 1. OVERALL RECORD VIEW (Standardized Win Rate excludes Pushes)
CREATE OR REPLACE VIEW pick_record_overall AS
SELECT 
    COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
    COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
    COUNT(*) FILTER (WHERE pick_result = 'PUSH') as pushes,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0),
        1
    ) as win_pct
FROM pregame_intel
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH');

-- 2. RECORD BY SPORT VIEW
CREATE OR REPLACE VIEW pick_record_by_sport AS
SELECT 
    COALESCE(sport, league_id, 'unknown') as sport,
    COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
    COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
    COUNT(*) FILTER (WHERE pick_result = 'PUSH') as pushes,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0),
        1
    ) as win_pct
FROM pregame_intel
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
GROUP BY COALESCE(sport, league_id, 'unknown')
ORDER BY (COUNT(*) FILTER (WHERE pick_result = 'WIN') + COUNT(*) FILTER (WHERE pick_result = 'LOSS')) DESC;

-- 3. DAILY RECORD VIEW (Last 30 Days, timezone aware)
CREATE OR REPLACE VIEW pick_record_daily AS
SELECT 
    game_date,
    COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
    COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
    COUNT(*) FILTER (WHERE pick_result = 'PUSH') as pushes,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0),
        1
    ) as win_pct
FROM pregame_intel
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
  AND game_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date - INTERVAL '30 days'
GROUP BY game_date
ORDER BY game_date DESC;

-- 4. TODAY'S PICKS DETAIL VIEW (Null-safe concatenation)
CREATE OR REPLACE VIEW pick_today_detail AS
SELECT 
    match_id,
    sport,
    CONCAT(away_team, ' @ ', home_team) as matchup,
    recommended_pick,
    analyzed_spread,
    CONCAT(COALESCE(actual_away_score::text, '?'), '-', COALESCE(actual_home_score::text, '?')) as score,
    pick_result
FROM pregame_intel
WHERE game_date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date
  AND pick_result IS NOT NULL
ORDER BY pick_result DESC;

-- 5. WEEKLY SUMMARY VIEW
CREATE OR REPLACE VIEW pick_record_weekly AS
SELECT 
    DATE_TRUNC('week', game_date)::date as week_start,
    COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
    COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
    COUNT(*) FILTER (WHERE pick_result = 'PUSH') as pushes,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0),
        1
    ) as win_pct
FROM pregame_intel
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
GROUP BY DATE_TRUNC('week', game_date)
ORDER BY week_start DESC;

-- PERFORMANCE OPTIMIZATION (Indexing)
CREATE INDEX IF NOT EXISTS idx_pregame_intel_performance 
ON pregame_intel (game_date, pick_result, sport);

CREATE INDEX IF NOT EXISTS idx_pregame_intel_grading 
ON pregame_intel (pick_result) 
WHERE pick_result IS NOT NULL;
