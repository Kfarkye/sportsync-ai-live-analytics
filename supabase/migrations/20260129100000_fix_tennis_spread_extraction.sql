-- ============================================================
-- TITANIUM ANALYTICS v3.6: FIX TENNIS GAMES_SPREAD BUCKETING
-- Description: Extract spread from recommended_pick when analyzed_spread is null
-- This prevents GAMES_SPREAD picks from falling into PICK_EM bucket
-- ============================================================

BEGIN;

DROP VIEW IF EXISTS vw_titan_api_gateway CASCADE;
DROP VIEW IF EXISTS vw_titan_trends CASCADE;
DROP VIEW IF EXISTS vw_titan_heatmap CASCADE;
DROP VIEW IF EXISTS vw_titan_buckets CASCADE;
DROP VIEW IF EXISTS vw_titan_summary CASCADE;
DROP VIEW IF EXISTS vw_titan_leagues CASCADE;
DROP VIEW IF EXISTS vw_titan_master CASCADE;

-- ============================================================
-- MASTER VIEW: Now extracts spread from recommended_pick as fallback
-- ============================================================
CREATE OR REPLACE VIEW vw_titan_master AS
WITH cleaned_data AS (
    SELECT 
        pi.intel_id,
        pi.match_id,
        pi.game_date,
        pi.league_id,
        COALESCE(
            pi.grading_metadata->>'side', 
            pi.grading_metadata->>'player', 
            pi.grading_metadata->>'team',
            'UNKNOWN'
        ) AS pick_side,
        
        (pi.grading_metadata->>'odds')::numeric AS pick_odds,
        
        pi.pick_result,
        pi.final_home_score,
        pi.final_away_score,
        
        -- FIX: Extract spread from recommended_pick if analyzed_spread is null
        CASE 
            -- First try analyzed_spread
            WHEN pi.analyzed_spread IS NOT NULL THEN
                CASE 
                    WHEN pi.analyzed_spread::text = 'PK' THEN 0::numeric
                    WHEN pi.analyzed_spread::text ~ '[^0-9.-]' THEN 
                         NULLIF(regexp_replace(pi.analyzed_spread::text, '[^0-9.-]', '', 'g'), '')::numeric
                    ELSE NULLIF(pi.analyzed_spread::text, '')::numeric
                END
            -- Fallback: Extract from recommended_pick (e.g., "Team +5.5 Games")
            WHEN pi.recommended_pick ~ '[+-]\d+\.?\d*' THEN
                (regexp_match(pi.recommended_pick, '([+-]?\d+\.?\d*)'))[1]::numeric
            -- Pick'em patterns
            WHEN pi.recommended_pick ~* 'pk|pick.?em' THEN 0::numeric
            ELSE NULL::numeric
        END AS spread,

        (pi.grading_metadata->>'type') AS pick_type,
        pi.recommended_pick
        
    FROM pregame_intel pi
    WHERE 
        (
             (pi.grading_metadata->>'type') IN ('SPREAD', 'MONEYLINE', 'GAMES_SPREAD', 'SETS_SPREAD', 'TOTAL')
             OR 
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

    CASE 
        -- Tennis GAMES_SPREAD: use spread sign to determine fav/dog
        WHEN pick_type IN ('GAMES_SPREAD', 'SETS_SPREAD') THEN
            CASE
                WHEN spread < 0 THEN 'FAVORITE'
                WHEN spread > 0 THEN 'UNDERDOG'
                ELSE 'PICK_EM'
            END
            
        -- Moneyline without spread: use odds
        WHEN spread IS NULL AND pick_odds IS NOT NULL THEN
            CASE
                WHEN pick_odds < 0 THEN 'FAVORITE'
                WHEN pick_odds > 0 THEN 'UNDERDOG'
                ELSE 'PICK_EM'
            END

        -- Standard spread logic
        WHEN pick_side = 'HOME' AND spread > 0 THEN 'HOME_DOG'
        WHEN pick_side = 'HOME' AND spread <= 0 THEN 'HOME_FAV'
        WHEN pick_side = 'AWAY' AND spread > 0 THEN 'ROAD_FAV'
        WHEN pick_side = 'AWAY' AND spread <= 0 THEN 'ROAD_DOG'

        -- TOTAL picks
        WHEN pick_side IN ('OVER', 'UNDER') THEN pick_side
        
        ELSE 'UNCATEGORIZED'
    END AS category,

    CASE 
        WHEN pick_type IN ('GAMES_SPREAD', 'SETS_SPREAD') THEN (spread > 0)
        WHEN spread IS NULL AND pick_odds IS NOT NULL THEN (pick_odds > 0)
        WHEN pick_side = 'HOME' AND spread > 0 THEN TRUE
        WHEN pick_side = 'AWAY' AND spread <= 0 THEN TRUE
        ELSE FALSE
    END AS is_underdog,

    CASE 
        WHEN spread IS NULL THEN '5_Moneyline'
        WHEN ABS(spread) <= 3 THEN '1_Tight (0-3)'
        WHEN ABS(spread) <= 7 THEN '2_Key (3.5-7)'
        WHEN ABS(spread) <= 10 THEN '3_Medium (7.5-10)'
        ELSE '4_Blowout (10+)'
    END AS bucket_id,

    CASE 
        WHEN final_home_score IS NULL OR final_away_score IS NULL THEN NULL
        WHEN league_id IN ('atp', 'wta', 'tennis') THEN NULL
        WHEN pick_side = 'HOME' THEN (final_home_score + COALESCE(spread,0)) - final_away_score
        WHEN pick_side = 'AWAY' THEN (final_away_score + COALESCE(spread,0)*-1) - final_home_score 
        ELSE NULL
    END AS cover_margin

FROM cleaned_data;

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
        COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
        COUNT(*) FILTER (WHERE pick_result = 'PUSH') as pushes
    FROM vw_titan_master
    WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
    GROUP BY bucket_id
)
SELECT *,
    ROUND((wins::numeric / NULLIF(wins + losses, 0)) * 100, 1) as win_rate
FROM bucket_stats;

-- SUMMARY
CREATE VIEW vw_titan_summary AS
WITH stats AS (
    SELECT 
        COUNT(*) FILTER (WHERE pick_result = 'WIN') as total_wins,
        COUNT(*) FILTER (WHERE pick_result = 'LOSS') as total_losses,
        COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')) as total_picks
    FROM vw_titan_master
),
best_cat AS (
    SELECT 
        category as best_category,
        ROUND((COUNT(*) FILTER (WHERE pick_result = 'WIN')::numeric / 
               NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0)) * 100, 1) as best_category_win_rate
    FROM vw_titan_master
    WHERE pick_result IN ('WIN', 'LOSS')
    GROUP BY category
    HAVING COUNT(*) >= 10
    ORDER BY 2 DESC
    LIMIT 1
)
SELECT 
    s.total_picks,
    s.total_wins,
    s.total_losses,
    ROUND((s.total_wins::numeric / NULLIF(s.total_wins + s.total_losses, 0)) * 100, 1) as global_win_rate,
    bc.best_category,
    bc.best_category_win_rate
FROM stats s, best_cat bc;

-- HEATMAP
CREATE VIEW vw_titan_heatmap AS
SELECT 
    category,
    bucket_id,
    COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
    COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
    ROUND((COUNT(*) FILTER (WHERE pick_result = 'WIN')::numeric / 
           NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0)) * 100, 1) as win_rate
FROM vw_titan_master
WHERE pick_result IN ('WIN', 'LOSS')
GROUP BY category, bucket_id;

-- TRENDS
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
    SUM(daily_wins) OVER (ORDER BY game_date) as cumulative_wins,
    SUM(daily_losses) OVER (ORDER BY game_date) as cumulative_losses,
    ROUND((daily_wins::numeric / NULLIF(daily_wins + daily_losses, 0)) * 100, 1) as daily_win_rate
FROM daily_stats
ORDER BY game_date DESC;

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
