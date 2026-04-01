-- ============================================================
-- TITAN ANALYTICS ENGINE v3.1 (Corrected & Hardened)
-- Status: APPROVED FOR PRODUCTION
-- Corrections: Fixed Underdog reversal logic, Added RLS, Restored League Data
-- ============================================================

BEGIN;

-- 1. CLEANUP (Cascading drop to reset schema)
DROP VIEW IF EXISTS vw_titan_api_gateway CASCADE;
DROP VIEW IF EXISTS vw_titan_trends CASCADE;
DROP VIEW IF EXISTS vw_titan_heatmap CASCADE;
DROP VIEW IF EXISTS vw_titan_buckets CASCADE;
DROP VIEW IF EXISTS vw_titan_summary CASCADE;
DROP VIEW IF EXISTS vw_titan_leagues CASCADE;
DROP VIEW IF EXISTS vw_titan_master CASCADE;

-- 2. SECURITY & PERFORMANCE
-- RLS: Explicitly enable security
ALTER TABLE pregame_intel ENABLE ROW LEVEL SECURITY;

-- POLICY: Allow public read (Adjust 'true' to 'auth.role() = ''authenticated''' if private)
DROP POLICY IF EXISTS "Public Analytics Access" ON pregame_intel;
CREATE POLICY "Public Analytics Access" ON pregame_intel FOR SELECT USING (true);

-- INDEXES: GIN for JSONB and BTREE for Range/Sort
CREATE INDEX IF NOT EXISTS idx_pi_meta_gin ON pregame_intel USING GIN (grading_metadata);
CREATE INDEX IF NOT EXISTS idx_pi_spread ON pregame_intel (analyzed_spread); -- Raw column index (no cast)
CREATE INDEX IF NOT EXISTS idx_pi_result_date ON pregame_intel (pick_result, game_date DESC);


-- ============================================================
-- 3. MASTER ANALYTICS LAYER (The Source of Truth)
-- ============================================================
CREATE OR REPLACE VIEW vw_titan_master AS
WITH cleaned_spreads AS (
    SELECT 
        pi.intel_id,
        pi.match_id,
        pi.game_date,
        pi.league_id,
        (pi.grading_metadata->>'side')::text AS pick_side,
        pi.pick_result,
        pi.final_home_score,
        pi.final_away_score,
        
        -- A. DATA SAFETY ENGINE (Fixed: Text operations first, then numeric cast)
        CASE 
            WHEN pi.analyzed_spread::text = 'PK' THEN 0::numeric
            WHEN pi.analyzed_spread IS NULL THEN NULL::numeric
            WHEN pi.analyzed_spread::text ~ '[^0-9.-]' THEN 
                 NULLIF(regexp_replace(pi.analyzed_spread::text, '[^0-9.-]', '', 'g'), '')::numeric
            ELSE NULLIF(pi.analyzed_spread::text, '')::numeric
        END AS spread
        
    FROM pregame_intel pi
    WHERE (pi.grading_metadata->>'type') = 'SPREAD'
      AND pi.analyzed_spread IS NOT NULL
)
SELECT 
    intel_id,
    match_id,
    game_date,
    league_id,
    pick_side,
    spread,
    pick_result,
    final_home_score,
    final_away_score,

    -- B. LOGIC ENGINE (Fixed v3.1)
    -- Context: `analyzed_spread` is from HOME perspective.
    -- +7 means Home is Dog (+7), Away is Fav (-7).
    -- -7 means Home is Fav (-7), Away is Dog (+7).
    CASE 
        WHEN spread IS NULL THEN 'NO_LINE'
        WHEN ABS(spread) < 0.5 THEN 'PICK_EM'
        WHEN pick_side = 'HOME' AND spread > 0 THEN 'HOME_DOG'
        WHEN pick_side = 'HOME' AND spread <= 0 THEN 'HOME_FAV'
        WHEN pick_side = 'AWAY' AND spread > 0 THEN 'ROAD_FAV'
        WHEN pick_side = 'AWAY' AND spread <= 0 THEN 'ROAD_DOG'
        ELSE 'UNCATEGORIZED'
    END AS category,

    -- C. BINARY FLAG (Fixed v3.1)
    CASE 
        WHEN pick_side = 'HOME' AND spread > 0 THEN TRUE
        WHEN pick_side = 'AWAY' AND spread < 0 THEN TRUE
        ELSE FALSE
    END AS is_underdog,

    -- D. BUCKETING ENGINE
    CASE 
        WHEN ABS(spread) <= 3 THEN '1_Tight (0-3)'
        WHEN ABS(spread) <= 7 THEN '2_Key (3.5-7)'
        WHEN ABS(spread) <= 10 THEN '3_Medium (7.5-10)'
        ELSE '4_Blowout (10+)'
    END AS bucket_id,
    
    -- E. COVER MARGIN (Fixed v3.1)
    CASE 
        WHEN final_home_score IS NOT NULL AND pick_result IN ('WIN', 'LOSS', 'PUSH') THEN
            CASE 
                WHEN pick_side = 'HOME' THEN (final_home_score + spread) - final_away_score
                ELSE (final_away_score - spread) - final_home_score
            END
        ELSE NULL
    END AS cover_margin,

    -- F. FINANCIAL ENGINE (-110 Juice Standard)
    CASE 
        WHEN pick_result = 'LOSS' THEN -1.000
        WHEN pick_result = 'PUSH' THEN 0.000
        WHEN pick_result = 'WIN' THEN 0.9091 
        ELSE 0.000
    END AS unit_net

FROM cleaned_spreads;


-- ============================================================
-- 4. KPI SUMMARY VIEW
-- ============================================================
CREATE OR REPLACE VIEW vw_titan_summary AS
WITH stats AS (
    SELECT 
        COUNT(*) FILTER (WHERE pick_result IN ('WIN','LOSS','PUSH')) as total_graded,
        COUNT(*) FILTER (WHERE pick_result = 'PENDING') as total_pending,
        -- Dog Stats
        COUNT(*) FILTER (WHERE is_underdog AND pick_result = 'WIN') as dog_wins,
        COUNT(*) FILTER (WHERE is_underdog AND pick_result = 'LOSS') as dog_losses,
        SUM(unit_net) FILTER (WHERE is_underdog) as dog_units,
        -- Fav Stats
        COUNT(*) FILTER (WHERE NOT is_underdog AND pick_result = 'WIN') as fav_wins,
        COUNT(*) FILTER (WHERE NOT is_underdog AND pick_result = 'LOSS') as fav_losses,
        SUM(unit_net) FILTER (WHERE NOT is_underdog) as fav_units
    FROM vw_titan_master
)
SELECT jsonb_build_object(
    'meta', jsonb_build_object('lastUpdated', NOW(), 'totalVolume', total_graded + total_pending),
    'underdogs', jsonb_build_object(
        'label', 'Underdogs',
        'winRate', ROUND((100.0 * dog_wins / NULLIF(dog_wins + dog_losses, 0)), 1),
        'units', ROUND(dog_units::numeric, 2),
        'roi', ROUND((100.0 * dog_units / NULLIF(dog_wins + dog_losses, 0)), 1),
        'record', CONCAT(dog_wins, '-', dog_losses),
        'status', CASE WHEN dog_units > 0 THEN 'positive' ELSE 'negative' END
    ),
    'favorites', jsonb_build_object(
        'label', 'Favorites',
        'winRate', ROUND((100.0 * fav_wins / NULLIF(fav_wins + fav_losses, 0)), 1),
        'units', ROUND(fav_units::numeric, 2),
        'roi', ROUND((100.0 * fav_units / NULLIF(fav_wins + fav_losses, 0)), 1),
        'record', CONCAT(fav_wins, '-', fav_losses),
        'status', CASE WHEN fav_units > 0 THEN 'positive' ELSE 'negative' END
    )
) AS data FROM stats;


-- ============================================================
-- 5. LEAGUE BREAKDOWN (Restored v3.1)
-- ============================================================
CREATE OR REPLACE VIEW vw_titan_leagues AS
WITH league_stats AS (
    SELECT 
        league_id,
        COUNT(*) FILTER (WHERE is_underdog AND pick_result='WIN') as dog_wins,
        COUNT(*) FILTER (WHERE is_underdog AND pick_result='LOSS') as dog_losses,
        SUM(unit_net) FILTER (WHERE is_underdog) as dog_units,
        COUNT(*) FILTER (WHERE NOT is_underdog AND pick_result='WIN') as fav_wins,
        COUNT(*) FILTER (WHERE NOT is_underdog AND pick_result='LOSS') as fav_losses,
        SUM(unit_net) FILTER (WHERE NOT is_underdog) as fav_units,
        COUNT(*) as total_picks
    FROM vw_titan_master
    GROUP BY league_id
)
SELECT COALESCE(json_agg(json_build_object(
    'league', league_id,
    'underdog', json_build_object(
        'winRate', ROUND((100.0 * dog_wins / NULLIF(dog_wins + dog_losses, 0)), 1),
        'units', ROUND(COALESCE(dog_units, 0)::numeric, 2),
        'record', CONCAT(dog_wins, '-', dog_losses)
    ),
    'favorite', json_build_object(
        'winRate', ROUND((100.0 * fav_wins / NULLIF(fav_wins + fav_losses, 0)), 1),
        'units', ROUND(COALESCE(fav_units, 0)::numeric, 2),
        'record', CONCAT(fav_wins, '-', fav_losses)
    )
) ORDER BY total_picks DESC), '[]'::json) AS data
FROM league_stats;


-- ============================================================
-- 6. BUCKET DISTRIBUTION
-- ============================================================
CREATE OR REPLACE VIEW vw_titan_buckets AS
WITH bucket_stats AS (
    SELECT 
        bucket_id,
        COUNT(*) FILTER (WHERE is_underdog AND pick_result='WIN') as dog_wins,
        COUNT(*) FILTER (WHERE is_underdog AND pick_result='LOSS') as dog_losses,
        SUM(unit_net) FILTER (WHERE is_underdog) as dog_units,
        COUNT(*) FILTER (WHERE is_underdog) as dog_volume,
        COUNT(*) FILTER (WHERE NOT is_underdog AND pick_result='WIN') as fav_wins,
        COUNT(*) FILTER (WHERE NOT is_underdog AND pick_result='LOSS') as fav_losses,
        SUM(unit_net) FILTER (WHERE NOT is_underdog) as fav_units,
        COUNT(*) FILTER (WHERE NOT is_underdog) as fav_volume
    FROM vw_titan_master
    GROUP BY bucket_id
)
SELECT COALESCE(json_agg(json_build_object(
    'bucket', SUBSTRING(bucket_id FROM 3),
    'sortOrder', LEFT(bucket_id, 1)::int,
    'underdog', json_build_object(
        'winRate', ROUND((100.0 * dog_wins / NULLIF(dog_wins + dog_losses, 0)), 1),
        'units', ROUND(COALESCE(dog_units, 0)::numeric, 2),
        'volume', dog_volume
    ),
    'favorite', json_build_object(
        'winRate', ROUND((100.0 * fav_wins / NULLIF(fav_wins + fav_losses, 0)), 1),
        'units', ROUND(COALESCE(fav_units, 0)::numeric, 2),
        'volume', fav_volume
    )
) ORDER BY bucket_id), '[]'::json) AS data
FROM bucket_stats;


-- ============================================================
-- 7. HEATMAP MATRIX
-- ============================================================
CREATE OR REPLACE VIEW vw_titan_heatmap AS
WITH category_stats AS (
    SELECT 
        category,
        COUNT(*) FILTER (WHERE pick_result='WIN') as wins,
        COUNT(*) FILTER (WHERE pick_result='LOSS') as losses,
        SUM(unit_net) as units,
        COUNT(*) as volume
    FROM vw_titan_master
    WHERE category != 'UNCATEGORIZED'
    GROUP BY category
)
SELECT COALESCE(json_agg(json_build_object(
    'category', category,
    'winRate', ROUND((100.0 * wins / NULLIF(wins + losses, 0)), 1),
    'units', ROUND(COALESCE(units, 0)::numeric, 2),
    'volume', volume,
    'uiClass', CASE 
        WHEN units > 5 THEN 'bg-emerald-500 text-white' 
        WHEN units > 0 THEN 'bg-emerald-100 text-emerald-800' 
        WHEN units < -5 THEN 'bg-rose-500 text-white'   
        ELSE 'bg-rose-100 text-rose-800'                          
    END
) ORDER BY units DESC), '[]'::json) AS data
FROM category_stats;


-- ============================================================
-- 8. ROLLING TRENDS
-- ============================================================
CREATE OR REPLACE VIEW vw_titan_trends AS
WITH daily AS (
    SELECT 
        game_date,
        SUM(unit_net) FILTER (WHERE is_underdog) as dog_daily,
        SUM(unit_net) FILTER (WHERE NOT is_underdog) as fav_daily
    FROM vw_titan_master
    WHERE pick_result IN ('WIN','LOSS','PUSH')
    GROUP BY game_date
),
rolling_stats AS (
    SELECT 
        game_date,
        ROUND(SUM(dog_daily) OVER (ORDER BY game_date)::numeric, 2) as cumulative_dog,
        ROUND(SUM(fav_daily) OVER (ORDER BY game_date)::numeric, 2) as cumulative_fav,
        ROUND(STDDEV(COALESCE(dog_daily, 0)) OVER (ORDER BY game_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)::numeric, 2) as rolling_volatility
    FROM daily
    WHERE game_date >= (CURRENT_DATE - INTERVAL '60 days')
)
SELECT COALESCE(json_agg(json_build_object(
    'date', game_date,
    'cumulativeDog', cumulative_dog,
    'cumulativeFav', cumulative_fav,
    'rollingVolatility', rolling_volatility
) ORDER BY game_date ASC), '[]'::json) AS data
FROM rolling_stats;


-- ============================================================
-- 9. API GATEWAY (Titan One-Call)
-- ============================================================
CREATE OR REPLACE VIEW vw_titan_api_gateway AS
SELECT jsonb_build_object(
    'summary', (SELECT data FROM vw_titan_summary),
    'leagues', (SELECT data FROM vw_titan_leagues),
    'buckets', (SELECT data FROM vw_titan_buckets),
    'heatmap', (SELECT data FROM vw_titan_heatmap),
    'trends', (SELECT data FROM vw_titan_trends)
) AS payload;

COMMIT;
