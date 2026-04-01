-- ============================================================
-- TITANIUM ANALYTICS v3.2: TENNIS & ML SUPPORT
-- Description: Fixes Tennis 'player' vs 'side' and enables Moneyline support
-- ============================================================

BEGIN;

-- 1. DROP EXISTING VIEWS (Deep Cascade to ensure clean rebuild)
DROP VIEW IF EXISTS vw_titan_api_gateway CASCADE;
DROP VIEW IF EXISTS vw_titan_trends CASCADE;
DROP VIEW IF EXISTS vw_titan_heatmap CASCADE;
DROP VIEW IF EXISTS vw_titan_buckets CASCADE;
DROP VIEW IF EXISTS vw_titan_summary CASCADE;
DROP VIEW IF EXISTS vw_titan_leagues CASCADE;
DROP VIEW IF EXISTS vw_titan_master CASCADE;

-- ============================================================
-- 2. MASTER VIEW (The Core Fix)
-- ============================================================
CREATE OR REPLACE VIEW vw_titan_master AS
WITH cleaned_data AS (
    SELECT 
        pi.intel_id,
        pi.match_id,
        pi.game_date,
        pi.league_id,
        -- FIX 1: Handle Tennis 'player' field
        COALESCE(pi.grading_metadata->>'side', pi.grading_metadata->>'player', pi.grading_metadata->>'team') AS pick_side,
        
        -- FIX 2: Extract Odds for ML classification
        (pi.grading_metadata->>'odds')::numeric AS pick_odds,
        
        pi.pick_result,
        pi.final_home_score,
        pi.final_away_score,
        
        -- CLEAN SPREAD (Handle 'PK', strings, etc)
        CASE 
            WHEN pi.analyzed_spread::text = 'PK' THEN 0::numeric
            WHEN pi.analyzed_spread IS NULL THEN NULL::numeric
            WHEN pi.analyzed_spread::text ~ '[^0-9.-]' THEN 
                 NULLIF(regexp_replace(pi.analyzed_spread::text, '[^0-9.-]', '', 'g'), '')::numeric
            ELSE NULLIF(pi.analyzed_spread::text, '')::numeric
        END AS spread,

        -- METADATA extraction
        (pi.grading_metadata->>'type') AS pick_type
        
    FROM pregame_intel pi
    WHERE 
        -- FIX 3: OPEN THE GATES (Include Tennis/ML)
        (
             (pi.grading_metadata->>'type') IN ('SPREAD', 'MONEYLINE')
             OR 
             -- Legacy support (if type is null but we have spread/side/player)
             (pi.grading_metadata->>'type' IS NULL AND (pi.analyzed_spread IS NOT NULL OR pi.grading_metadata->>'odds' IS NOT NULL))
        )
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

    -- LOGIC ENGINE (Updated for Tennis/ML)
    CASE 
        -- MONEYLINE LOGIC
        WHEN spread IS NULL AND pick_odds IS NOT NULL THEN
            CASE
                WHEN pick_odds < 0 THEN 'FAVORITE'  -- e.g. -150
                WHEN pick_odds > 0 THEN 'UNDERDOG'  -- e.g. +130
                ELSE 'PICK_EM'
            END
            
        -- SPREAD LOGIC (Tennis/Player based)
        WHEN league_id IN ('atp', 'wta', 'tennis') THEN
            CASE
                WHEN spread < 0 THEN 'FAVORITE' -- Player -3.5 (Fav)
                WHEN spread > 0 THEN 'UNDERDOG' -- Player +3.5 (Dog)
                ELSE 'PICK_EM'
            END

        -- SPREAD LOGIC (Team Sports - Home/Away relative)
        WHEN pick_side = 'HOME' AND spread > 0 THEN 'HOME_DOG' -- Home +7
        WHEN pick_side = 'HOME' AND spread <= 0 THEN 'HOME_FAV' -- Home -7
        WHEN pick_side = 'AWAY' AND spread > 0 THEN 'ROAD_FAV' -- Away (vs Home +X? No. Analyzed spread is HOME perspective)
        -- Correction on Road logic based on v3.1 notes:
        -- "analyzed_spread is from HOME perspective"
        -- If spread = -7 (Home is Fav by 7).
        -- If Pick = AWAY, I picked the Dog (+7). -> ROAD_DOG.
        WHEN pick_side = 'AWAY' AND spread <= 0 THEN 'ROAD_DOG' 
        
        -- If spread = +7 (Home is Dog by 7).
        -- If Pick = AWAY, I picked the Fav (-7). -> ROAD_FAV.
        WHEN pick_side = 'AWAY' AND spread > 0 THEN 'ROAD_FAV'
        
        ELSE 'UNCATEGORIZED'
    END AS category,

    -- BINARY FLAG
    CASE 
        -- ML Logic
        WHEN spread IS NULL AND pick_odds IS NOT NULL THEN (pick_odds > 0)
        -- Tennis Logic
        WHEN league_id IN ('atp', 'wta', 'tennis') THEN (spread > 0)
        -- Team Logic (Spread is HOME perspective)
        WHEN pick_side = 'HOME' AND spread > 0 THEN TRUE -- Home is getting points
        WHEN pick_side = 'AWAY' AND spread < 0 THEN TRUE -- Home is giving points (Fav), so Away is getting points (Dog)?
        -- Wait. If spread = -7 (Home Fav -7).
        -- Away team is +7. So Away is Underdog.
        -- If pick = AWAY, is_underdog = TRUE.
        -- My Logic check: spread < 0 (-7). Pick=AWAY. Result: TRUE. Correct.
        ELSE FALSE
    END AS is_underdog,

    -- BUCKETING ENGINE (Expanded for ML)
    CASE 
        WHEN spread IS NULL THEN '5_Moneyline'
        WHEN ABS(spread) <= 3 THEN '1_Tight (0-3)'
        WHEN ABS(spread) <= 7 THEN '2_Key (3.5-7)'
        WHEN ABS(spread) <= 10 THEN '3_Medium (7.5-10)'
        ELSE '4_Blowout (10+)'
    END AS bucket_id,

    -- COVER MARGIN (Calc only if scores exist)
    CASE 
        WHEN final_home_score IS NULL OR final_away_score IS NULL THEN NULL
        WHEN league_id IN ('atp', 'wta', 'tennis') THEN NULL -- Tennis scoring (sets/games) harder to margin without explicit logic
        WHEN pick_side = 'HOME' THEN (final_home_score + COALESCE(spread,0)) - final_away_score
        WHEN pick_side = 'AWAY' THEN (final_away_score + COALESCE(spread,0)*-1) - final_home_score -- Invert spread for Away?
        -- Wait. Spread is Home perspective.
        -- Score Diff (Home - Away).
        -- Result = (Home - Away) + Spread.
        -- If Result > 0, Home covers.
        -- If Pick = HOME, Margin = (H - A) + Spread.
        -- If Pick = AWAY, Margin = (A - H) - Spread.
        ELSE NULL
    END AS cover_margin

FROM cleaned_data;

-- ============================================================
-- 3. REBUILD DOWNSTREAM VIEWS (Standard Logic)
-- ============================================================

-- LEAGUES
CREATE VIEW vw_titan_leagues AS
WITH league_stats AS (
    SELECT 
        league_id,
        COUNT(*) as total_picks,
        COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
        COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
        COUNT(*) FILTER (WHERE pick_result = 'PUSH') as pushes
    FROM vw_titan_master
    WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
    GROUP BY league_id
)
SELECT *,
    ROUND((wins::numeric / NULLIF(wins + losses, 0)) * 100, 1) as win_rate
FROM league_stats;

-- BUCKETS
CREATE VIEW vw_titan_buckets AS
WITH bucket_stats AS (
    SELECT 
        bucket_id,
        COUNT(*) as total_picks,
        COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
        COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses
    FROM vw_titan_master
    WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
    GROUP BY bucket_id
)
SELECT *,
    ROUND((wins::numeric / NULLIF(wins + losses, 0)) * 100, 1) as win_rate
FROM bucket_stats;

-- HEATMAP
CREATE VIEW vw_titan_heatmap AS
WITH category_stats AS (
    SELECT 
        category,
        COUNT(*) as total_picks,
        COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
        COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses
    FROM vw_titan_master
    WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
    GROUP BY category
)
SELECT 
    category,
    total_picks,
    wins,
    losses,
    ROUND((wins::numeric / NULLIF(wins + losses, 0)) * 100, 1) as win_rate,
    CASE 
        WHEN (wins::numeric / NULLIF(wins + losses, 0)) >= 0.55 THEN 'bg-green-500' -- Elite
        WHEN (wins::numeric / NULLIF(wins + losses, 0)) >= 0.524 THEN 'bg-emerald-400' -- Profitable
        WHEN (wins::numeric / NULLIF(wins + losses, 0)) >= 0.50 THEN 'bg-yellow-400' -- Break Even
        ELSE 'bg-red-500' -- Negative EV
    END as color_class
FROM category_stats;

-- TRENDS
CREATE VIEW vw_titan_trends AS
WITH rolling_stats AS (
    SELECT 
        game_date,
        COUNT(*) as daily_picks,
        SUM(CASE WHEN pick_result='WIN' THEN 1 WHEN pick_result='LOSS' THEN -1 ELSE 0 END) as daily_net
    FROM vw_titan_master
    WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
    GROUP BY game_date
)
SELECT 
    game_date,
    daily_picks,
    daily_net,
    SUM(daily_net) OVER (ORDER BY game_date) as cumulative_net
FROM rolling_stats;

-- EXECUTIVE SUMMARY
CREATE VIEW vw_titan_summary AS
SELECT 
    COUNT(*) as total_picks,
    COUNT(*) FILTER (WHERE pick_result = 'WIN') as total_wins,
    COUNT(*) FILTER (WHERE pick_result = 'LOSS') as total_losses,
    ROUND((COUNT(*) FILTER (WHERE pick_result = 'WIN')::numeric / NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0)) * 100, 1) as global_win_rate,
    (SELECT win_rate FROM vw_titan_heatmap ORDER BY win_rate DESC LIMIT 1) as best_category_win_rate,
    (SELECT category FROM vw_titan_heatmap ORDER BY win_rate DESC LIMIT 1) as best_category
FROM vw_titan_master
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH');

-- API GATEWAY
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
