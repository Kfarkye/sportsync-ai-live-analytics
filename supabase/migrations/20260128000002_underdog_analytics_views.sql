-- ============================================================
-- UNDERDOG ANALYTICS DASHBOARD v2.0
-- Data Scientist Quality | Frontend-Ready JSON
-- 
-- INSTRUCTIONS: Copy this entire file and run in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- STEP 1: DROP ALL VIEWS (Clean Slate)
-- ============================================================

DROP VIEW IF EXISTS vw_bucket_distribution_json CASCADE;
DROP VIEW IF EXISTS vw_bucket_distribution CASCADE;
DROP VIEW IF EXISTS vw_distribution_heatmap CASCADE;
DROP VIEW IF EXISTS vw_underdog_trend CASCADE;
DROP VIEW IF EXISTS vw_spread_edge_analysis CASCADE;
DROP VIEW IF EXISTS vw_underdog_by_league_v2 CASCADE;
DROP VIEW IF EXISTS vw_underdog_home_away_split CASCADE;
DROP VIEW IF EXISTS vw_underdog_executive_summary CASCADE;
DROP VIEW IF EXISTS vw_pick_master CASCADE;

-- ============================================================
-- STEP 2: VALIDATE SCHEMA (Ensure columns exist)
-- ============================================================

-- Check that pregame_intel has required columns
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'pregame_intel' AND column_name = 'grading_metadata') THEN
        RAISE EXCEPTION 'Missing column: pregame_intel.grading_metadata';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'pregame_intel' AND column_name = 'analyzed_spread') THEN
        RAISE EXCEPTION 'Missing column: pregame_intel.analyzed_spread';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'pregame_intel' AND column_name = 'pick_result') THEN
        RAISE EXCEPTION 'Missing column: pregame_intel.pick_result';
    END IF;
    
    RAISE NOTICE 'Schema validation passed ✓';
END $$;


-- ============================================================
-- STEP 3: CREATE BASE VIEW (vw_pick_master)
-- ============================================================

CREATE OR REPLACE VIEW vw_pick_master AS
SELECT 
    pi.intel_id,
    pi.match_id,
    pi.game_date,
    pi.league_id,
    pi.home_team,
    pi.away_team,
    (pi.grading_metadata->>'side')::text AS pick_side,
    (pi.grading_metadata->>'type')::text AS pick_type,
    pi.analyzed_spread::numeric AS analyzed_spread,
    pi.pick_result,
    pi.final_home_score,
    pi.final_away_score,
    
    -- Underdog classification
    CASE 
        WHEN (pi.grading_metadata->>'side') = 'HOME' AND pi.analyzed_spread::numeric > 0 THEN TRUE
        WHEN (pi.grading_metadata->>'side') = 'AWAY' AND pi.analyzed_spread::numeric < 0 THEN TRUE
        ELSE FALSE
    END AS is_underdog_pick,
    
    -- Detailed classification
    CASE 
        WHEN pi.analyzed_spread IS NULL THEN 'NO_LINE'
        WHEN ABS(pi.analyzed_spread::numeric) <= 1 THEN 'PICK_EM'
        WHEN (pi.grading_metadata->>'side') = 'HOME' AND pi.analyzed_spread::numeric > 0 THEN 'HOME_UNDERDOG'
        WHEN (pi.grading_metadata->>'side') = 'HOME' AND pi.analyzed_spread::numeric < 0 THEN 'HOME_FAVORITE'
        WHEN (pi.grading_metadata->>'side') = 'AWAY' AND pi.analyzed_spread::numeric < 0 THEN 'ROAD_UNDERDOG'
        WHEN (pi.grading_metadata->>'side') = 'AWAY' AND pi.analyzed_spread::numeric > 0 THEN 'ROAD_FAVORITE'
        ELSE 'UNKNOWN'
    END AS pick_classification,
    
    -- Spread buckets
    CASE 
        WHEN ABS(pi.analyzed_spread::numeric) <= 3 THEN 'SMALL (1-3)'
        WHEN ABS(pi.analyzed_spread::numeric) <= 7 THEN 'MEDIUM (3.5-7)'
        WHEN ABS(pi.analyzed_spread::numeric) <= 10 THEN 'LARGE (7.5-10)'
        ELSE 'BLOWOUT (10+)'
    END AS spread_bucket,
    
    ABS(pi.analyzed_spread::numeric) AS spread_size,
    
    -- Units calculation (-110 juice)
    CASE 
        WHEN pi.pick_result = 'WIN' THEN 0.909
        WHEN pi.pick_result = 'LOSS' THEN -1.0
        WHEN pi.pick_result = 'PUSH' THEN 0.0
        ELSE NULL
    END AS units_result

FROM pregame_intel pi
WHERE (pi.grading_metadata->>'type') = 'SPREAD'
  AND pi.analyzed_spread IS NOT NULL;


-- ============================================================
-- STEP 4: EXECUTIVE SUMMARY (Dashboard Card)
-- ============================================================

CREATE OR REPLACE VIEW vw_underdog_executive_summary AS
SELECT 
    jsonb_build_object(
        'generated_at', NOW(),
        'total_graded_picks', COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')),
        'pending_picks', COUNT(*) FILTER (WHERE pick_result = 'PENDING'),
        
        'overall', jsonb_build_object(
            'record', CONCAT(
                COUNT(*) FILTER (WHERE pick_result = 'WIN'), '-',
                COUNT(*) FILTER (WHERE pick_result = 'LOSS'), '-',
                COUNT(*) FILTER (WHERE pick_result = 'PUSH')
            ),
            'win_rate', ROUND(100.0 * COUNT(*) FILTER (WHERE pick_result = 'WIN') / 
                NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0), 1),
            'roi_pct', ROUND(100.0 * SUM(units_result) / 
                NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0), 1),
            'units', ROUND(COALESCE(SUM(units_result), 0)::numeric, 2)
        ),
        
        'underdogs', jsonb_build_object(
            'total_picks', COUNT(*) FILTER (WHERE is_underdog_pick = TRUE),
            'record', CONCAT(
                COUNT(*) FILTER (WHERE is_underdog_pick = TRUE AND pick_result = 'WIN'), '-',
                COUNT(*) FILTER (WHERE is_underdog_pick = TRUE AND pick_result = 'LOSS')
            ),
            'win_rate', ROUND(100.0 * 
                COUNT(*) FILTER (WHERE is_underdog_pick = TRUE AND pick_result = 'WIN') / 
                NULLIF(COUNT(*) FILTER (WHERE is_underdog_pick = TRUE AND pick_result IN ('WIN', 'LOSS')), 0), 1),
            'roi_pct', ROUND(100.0 * 
                SUM(units_result) FILTER (WHERE is_underdog_pick = TRUE) / 
                NULLIF(COUNT(*) FILTER (WHERE is_underdog_pick = TRUE AND pick_result IN ('WIN', 'LOSS')), 0), 1),
            'units', ROUND(COALESCE(SUM(units_result) FILTER (WHERE is_underdog_pick = TRUE), 0)::numeric, 2)
        ),
        
        'favorites', jsonb_build_object(
            'total_picks', COUNT(*) FILTER (WHERE is_underdog_pick = FALSE),
            'record', CONCAT(
                COUNT(*) FILTER (WHERE is_underdog_pick = FALSE AND pick_result = 'WIN'), '-',
                COUNT(*) FILTER (WHERE is_underdog_pick = FALSE AND pick_result = 'LOSS')
            ),
            'win_rate', ROUND(100.0 * 
                COUNT(*) FILTER (WHERE is_underdog_pick = FALSE AND pick_result = 'WIN') / 
                NULLIF(COUNT(*) FILTER (WHERE is_underdog_pick = FALSE AND pick_result IN ('WIN', 'LOSS')), 0), 1),
            'roi_pct', ROUND(100.0 * 
                SUM(units_result) FILTER (WHERE is_underdog_pick = FALSE) / 
                NULLIF(COUNT(*) FILTER (WHERE is_underdog_pick = FALSE AND pick_result IN ('WIN', 'LOSS')), 0), 1),
            'units', ROUND(COALESCE(SUM(units_result) FILTER (WHERE is_underdog_pick = FALSE), 0)::numeric, 2)
        ),

        'insight', CASE 
            WHEN COALESCE(SUM(units_result) FILTER (WHERE is_underdog_pick = TRUE), 0) > 
                 COALESCE(SUM(units_result) FILTER (WHERE is_underdog_pick = FALSE), 0) 
            THEN 'Underdogs are outperforming favorites'
            ELSE 'Favorites are outperforming underdogs'
        END
    ) AS dashboard_data
FROM vw_pick_master;


-- ============================================================
-- STEP 5: HOME vs AWAY SPLIT
-- ============================================================

CREATE OR REPLACE VIEW vw_underdog_home_away_split AS
SELECT 
    pick_classification,
    pick_side,
    is_underdog_pick,
    COUNT(*) AS total_picks,
    COUNT(*) FILTER (WHERE pick_result = 'WIN') AS wins,
    COUNT(*) FILTER (WHERE pick_result = 'LOSS') AS losses,
    COUNT(*) FILTER (WHERE pick_result = 'PUSH') AS pushes,
    COUNT(*) FILTER (WHERE pick_result = 'PENDING') AS pending,
    ROUND(100.0 * COUNT(*) FILTER (WHERE pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0), 1) AS win_rate,
    ROUND(100.0 * SUM(units_result) / 
        NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0), 1) AS roi_pct,
    ROUND(COALESCE(SUM(units_result), 0)::numeric, 2) AS units,
    ROUND(AVG(spread_size)::numeric, 1) AS avg_spread,
    CASE 
        WHEN COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')) >= 50 THEN 'HIGH'
        WHEN COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')) >= 20 THEN 'MEDIUM'
        ELSE 'LOW'
    END AS sample_confidence
FROM vw_pick_master
WHERE pick_classification != 'NO_LINE'
GROUP BY pick_classification, pick_side, is_underdog_pick
ORDER BY is_underdog_pick DESC, pick_side, total_picks DESC;


-- ============================================================
-- STEP 6: BUCKET DISTRIBUTION (The Key View You Need)
-- ============================================================

CREATE OR REPLACE VIEW vw_bucket_distribution AS
WITH totals AS (
    SELECT 
        COUNT(*) AS total_picks,
        COUNT(*) FILTER (WHERE is_underdog_pick = TRUE) AS total_dogs,
        COUNT(*) FILTER (WHERE is_underdog_pick = FALSE) AS total_favs
    FROM vw_pick_master
),
buckets AS (
    SELECT 
        spread_bucket,
        is_underdog_pick,
        pick_classification,
        COUNT(*) AS picks_in_bucket,
        COUNT(*) FILTER (WHERE pick_result = 'WIN') AS wins,
        COUNT(*) FILTER (WHERE pick_result = 'LOSS') AS losses,
        ROUND(COALESCE(SUM(units_result), 0)::numeric, 2) AS units
    FROM vw_pick_master
    GROUP BY spread_bucket, is_underdog_pick, pick_classification
)
SELECT 
    b.spread_bucket,
    b.is_underdog_pick,
    b.pick_classification,
    b.picks_in_bucket,
    ROUND(100.0 * b.picks_in_bucket / NULLIF(t.total_picks, 0), 1) AS pct_of_total,
    ROUND(100.0 * b.picks_in_bucket / 
        CASE WHEN b.is_underdog_pick THEN NULLIF(t.total_dogs, 0) 
             ELSE NULLIF(t.total_favs, 0) END, 1) AS pct_of_category,
    REPEAT('█', LEAST(50, GREATEST(1, (b.picks_in_bucket * 50 / NULLIF(t.total_picks, 0))::int))) AS visual_bar,
    CONCAT(b.wins, '-', b.losses) AS record,
    ROUND(100.0 * b.wins / NULLIF(b.wins + b.losses, 0), 1) AS win_rate,
    b.units,
    CASE 
        WHEN (100.0 * b.wins / NULLIF(b.wins + b.losses, 0)) > 55 THEN '🔥'
        WHEN (100.0 * b.wins / NULLIF(b.wins + b.losses, 0)) > 52.4 THEN '✅'
        WHEN (100.0 * b.wins / NULLIF(b.wins + b.losses, 0)) < 45 THEN '❌'
        ELSE '📊'
    END AS signal
FROM buckets b
CROSS JOIN totals t
ORDER BY 
    CASE b.spread_bucket 
        WHEN 'SMALL (1-3)' THEN 1
        WHEN 'MEDIUM (3.5-7)' THEN 2
        WHEN 'LARGE (7.5-10)' THEN 3
        WHEN 'BLOWOUT (10+)' THEN 4
    END,
    b.is_underdog_pick DESC;


-- ============================================================
-- STEP 7: DISTRIBUTION HEATMAP (Classification x Bucket)
-- ============================================================

CREATE OR REPLACE VIEW vw_distribution_heatmap AS
SELECT 
    pick_classification,
    COUNT(*) FILTER (WHERE spread_bucket = 'SMALL (1-3)') AS small_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE spread_bucket = 'SMALL (1-3)' AND pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE spread_bucket = 'SMALL (1-3)' AND pick_result IN ('WIN', 'LOSS')), 0), 1) AS small_win_rate,
    COUNT(*) FILTER (WHERE spread_bucket = 'MEDIUM (3.5-7)') AS medium_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE spread_bucket = 'MEDIUM (3.5-7)' AND pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE spread_bucket = 'MEDIUM (3.5-7)' AND pick_result IN ('WIN', 'LOSS')), 0), 1) AS medium_win_rate,
    COUNT(*) FILTER (WHERE spread_bucket = 'LARGE (7.5-10)') AS large_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE spread_bucket = 'LARGE (7.5-10)' AND pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE spread_bucket = 'LARGE (7.5-10)' AND pick_result IN ('WIN', 'LOSS')), 0), 1) AS large_win_rate,
    COUNT(*) FILTER (WHERE spread_bucket = 'BLOWOUT (10+)') AS blowout_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE spread_bucket = 'BLOWOUT (10+)' AND pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE spread_bucket = 'BLOWOUT (10+)' AND pick_result IN ('WIN', 'LOSS')), 0), 1) AS blowout_win_rate,
    COUNT(*) AS total
FROM vw_pick_master
WHERE pick_classification NOT IN ('NO_LINE', 'UNKNOWN')
GROUP BY pick_classification
ORDER BY 
    CASE pick_classification 
        WHEN 'HOME_UNDERDOG' THEN 1
        WHEN 'ROAD_UNDERDOG' THEN 2
        WHEN 'HOME_FAVORITE' THEN 3
        WHEN 'ROAD_FAVORITE' THEN 4
        WHEN 'PICK_EM' THEN 5
    END;


-- ============================================================
-- STEP 8: LEAGUE BREAKDOWN (JSON)
-- ============================================================

CREATE OR REPLACE VIEW vw_underdog_by_league_v2 AS
SELECT 
    league_id,
    jsonb_build_object(
        'underdogs', jsonb_build_object(
            'record', CONCAT(
                COUNT(*) FILTER (WHERE is_underdog_pick = TRUE AND pick_result = 'WIN'), '-',
                COUNT(*) FILTER (WHERE is_underdog_pick = TRUE AND pick_result = 'LOSS')
            ),
            'win_rate', ROUND(100.0 * 
                COUNT(*) FILTER (WHERE is_underdog_pick = TRUE AND pick_result = 'WIN') / 
                NULLIF(COUNT(*) FILTER (WHERE is_underdog_pick = TRUE AND pick_result IN ('WIN', 'LOSS')), 0), 1),
            'units', ROUND(COALESCE(SUM(units_result) FILTER (WHERE is_underdog_pick = TRUE), 0)::numeric, 2)
        ),
        'favorites', jsonb_build_object(
            'record', CONCAT(
                COUNT(*) FILTER (WHERE is_underdog_pick = FALSE AND pick_result = 'WIN'), '-',
                COUNT(*) FILTER (WHERE is_underdog_pick = FALSE AND pick_result = 'LOSS')
            ),
            'win_rate', ROUND(100.0 * 
                COUNT(*) FILTER (WHERE is_underdog_pick = FALSE AND pick_result = 'WIN') / 
                NULLIF(COUNT(*) FILTER (WHERE is_underdog_pick = FALSE AND pick_result IN ('WIN', 'LOSS')), 0), 1),
            'units', ROUND(COALESCE(SUM(units_result) FILTER (WHERE is_underdog_pick = FALSE), 0)::numeric, 2)
        ),
        'home_dogs', jsonb_build_object(
            'record', CONCAT(
                COUNT(*) FILTER (WHERE pick_classification = 'HOME_UNDERDOG' AND pick_result = 'WIN'), '-',
                COUNT(*) FILTER (WHERE pick_classification = 'HOME_UNDERDOG' AND pick_result = 'LOSS')
            ),
            'win_rate', ROUND(100.0 * 
                COUNT(*) FILTER (WHERE pick_classification = 'HOME_UNDERDOG' AND pick_result = 'WIN') / 
                NULLIF(COUNT(*) FILTER (WHERE pick_classification = 'HOME_UNDERDOG' AND pick_result IN ('WIN', 'LOSS')), 0), 1)
        ),
        'road_dogs', jsonb_build_object(
            'record', CONCAT(
                COUNT(*) FILTER (WHERE pick_classification = 'ROAD_UNDERDOG' AND pick_result = 'WIN'), '-',
                COUNT(*) FILTER (WHERE pick_classification = 'ROAD_UNDERDOG' AND pick_result = 'LOSS')
            ),
            'win_rate', ROUND(100.0 * 
                COUNT(*) FILTER (WHERE pick_classification = 'ROAD_UNDERDOG' AND pick_result = 'WIN') / 
                NULLIF(COUNT(*) FILTER (WHERE pick_classification = 'ROAD_UNDERDOG' AND pick_result IN ('WIN', 'LOSS')), 0), 1)
        )
    ) AS league_stats
FROM vw_pick_master
GROUP BY league_id
ORDER BY COUNT(*) DESC;


-- ============================================================
-- STEP 9: 30-DAY TREND
-- ============================================================

CREATE OR REPLACE VIEW vw_underdog_trend AS
SELECT 
    game_date,
    COUNT(*) FILTER (WHERE is_underdog_pick = TRUE AND pick_result = 'WIN') AS dog_wins,
    COUNT(*) FILTER (WHERE is_underdog_pick = TRUE AND pick_result = 'LOSS') AS dog_losses,
    COUNT(*) FILTER (WHERE is_underdog_pick = FALSE AND pick_result = 'WIN') AS fav_wins,
    COUNT(*) FILTER (WHERE is_underdog_pick = FALSE AND pick_result = 'LOSS') AS fav_losses,
    ROUND(COALESCE(SUM(units_result) FILTER (WHERE is_underdog_pick = TRUE), 0)::numeric, 2) AS dog_units,
    ROUND(COALESCE(SUM(units_result) FILTER (WHERE is_underdog_pick = FALSE), 0)::numeric, 2) AS fav_units,
    ROUND(SUM(COALESCE(SUM(units_result) FILTER (WHERE is_underdog_pick = TRUE), 0)) 
        OVER (ORDER BY game_date)::numeric, 2) AS dog_units_cumulative,
    ROUND(SUM(COALESCE(SUM(units_result) FILTER (WHERE is_underdog_pick = FALSE), 0)) 
        OVER (ORDER BY game_date)::numeric, 2) AS fav_units_cumulative
FROM vw_pick_master
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
GROUP BY game_date
ORDER BY game_date DESC
LIMIT 30;


-- ============================================================
-- DONE! Now query these views:
-- ============================================================

-- SELECT * FROM vw_underdog_executive_summary;
-- SELECT * FROM vw_underdog_home_away_split;
-- SELECT * FROM vw_bucket_distribution;
-- SELECT * FROM vw_distribution_heatmap;
-- SELECT * FROM vw_underdog_by_league_v2;
-- SELECT * FROM vw_underdog_trend;

SELECT 'All views created successfully! ✓' AS status;
