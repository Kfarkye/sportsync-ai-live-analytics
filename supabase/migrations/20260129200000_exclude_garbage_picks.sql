-- ============================================================
-- TITANIUM ANALYTICS v3.7: EXCLUDE GARBAGE PICKS (PATCHED v2)
-- Fixes:
-- 1) AWAY category sign mapping corrected (ROAD_DOG for +spread, ROAD_FAV for -spread)
-- 2) cover_margin for AWAY uses (away + spread) - home (no negation)
-- 3) TOTALS route to OVER/UNDER before spread logic
-- 4) bucket_id excludes totals/no-spread from spread buckets
-- 5) Tennis-first guard for odds-based FAVORITE/UNDERDOG
-- 6) Explicit PICK_EM for spread=0
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
-- MASTER VIEW: Excludes garbage picks
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

        -- Extract spread (prefer analyzed_spread; fallback to regex in recommended_pick)
        CASE
            WHEN pi.analyzed_spread IS NOT NULL THEN
                CASE
                    WHEN pi.analyzed_spread::text = 'PK' THEN 0::numeric
                    WHEN pi.analyzed_spread::text ~ '[^0-9.-]' THEN
                        NULLIF(regexp_replace(pi.analyzed_spread::text, '[^0-9.-]', '', 'g'), '')::numeric
                    ELSE NULLIF(pi.analyzed_spread::text, '')::numeric
                END
            WHEN pi.recommended_pick ~ '[+-]\d+\.?\d*'
                 AND NOT pi.recommended_pick ~ ' -?0$'
            THEN (regexp_match(pi.recommended_pick, '([+-]?\d+\.?\d*)'))[1]::numeric
            ELSE NULL::numeric
        END AS spread,

        (pi.grading_metadata->>'type') AS pick_type,
        pi.recommended_pick
    FROM pregame_intel pi
    WHERE
        (
            (pi.grading_metadata->>'type') IN ('SPREAD', 'GAMES_SPREAD', 'SETS_SPREAD', 'TOTAL')
            OR (pi.grading_metadata->>'type' IS NULL AND (pi.analyzed_spread IS NOT NULL OR pi.recommended_pick ~ '[+-]\d+\.?\d*'))
        )
        -- Exclude explicit MONEYLINE type
        AND COALESCE(pi.grading_metadata->>'type', '') != 'MONEYLINE'
        -- Exclude known garbage formats
        AND NOT pi.recommended_pick ~ ' -?0$'
        AND NOT pi.recommended_pick ~* ' ml$'
        AND NOT pi.recommended_pick ~* 'moneyline'
        AND NOT pi.recommended_pick ~* ' pk$'
        AND NOT pi.recommended_pick ~* 'pick.?em'
        -- Allow odds-only rows ONLY for tennis (to reclassify legacy NULL-spread tennis)
        AND (
            pi.league_id IN ('atp','wta','tennis')
            OR pi.analyzed_spread IS NOT NULL
            OR pi.recommended_pick ~ '[+-]\d+\.?\d*'
        )
),
categorized_data AS (
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
        pick_type,
        pick_odds,

        CASE
            -- =========================
            -- TENNIS: categorize by odds only
            -- =========================
            WHEN league_id IN ('atp','wta','tennis') THEN
                CASE
                    WHEN pick_odds IS NOT NULL AND pick_odds < 0 THEN 'FAVORITE'
                    WHEN pick_odds IS NOT NULL AND pick_odds >= 0 THEN 'UNDERDOG'
                    WHEN spread IS NOT NULL AND spread < 0 THEN 'FAVORITE'
                    WHEN spread IS NOT NULL AND spread > 0 THEN 'UNDERDOG'
                    ELSE 'INTEGRITY_ARTIFACT'
                END

            -- =========================
            -- TOTALS: OVER/UNDER only
            -- =========================
            WHEN pick_side IN ('OVER','UNDER') THEN pick_side

            -- =========================
            -- SPREADS: explicit PICK_EM for 0
            -- =========================
            WHEN spread = 0 THEN 'PICK_EM'

            -- HOME spreads
            WHEN pick_side = 'HOME' AND spread > 0 THEN 'HOME_DOG'
            WHEN pick_side = 'HOME' AND spread < 0 THEN 'HOME_FAV'

            -- AWAY spreads (FIXED)
            WHEN pick_side = 'AWAY' AND spread > 0 THEN 'ROAD_DOG'
            WHEN pick_side = 'AWAY' AND spread < 0 THEN 'ROAD_FAV'

            -- Odds-only (non-tennis) should not reach here due to cleaned_data filter; keep as integrity
            WHEN spread IS NULL AND pick_odds IS NOT NULL THEN 'INTEGRITY_ARTIFACT'

            ELSE 'UNCATEGORIZED'
        END AS category,

        CASE
            -- Tennis: odds-based underdog
            WHEN league_id IN ('atp','wta','tennis') THEN
                CASE
                    WHEN pick_odds IS NOT NULL THEN (pick_odds >= 0)
                    WHEN spread IS NOT NULL THEN (spread > 0)
                    ELSE NULL
                END

            -- Totals: not underdog
            WHEN pick_side IN ('OVER','UNDER') THEN FALSE

            -- Spreads: underdog = +spread (works for HOME/AWAY)
            WHEN spread IS NOT NULL THEN (spread > 0)

            ELSE NULL
        END AS is_underdog,

        CASE
            -- Totals get their own bucket even if spread is NULL
            WHEN pick_side IN ('OVER','UNDER') THEN '0_Total'
            -- No spread data
            WHEN spread IS NULL THEN '5_NoSpread'
            WHEN ABS(spread) <= 3 THEN '1_Tight (0-3)'
            WHEN ABS(spread) <= 7 THEN '2_Key (3.5-7)'
            WHEN ABS(spread) <= 10 THEN '3_Medium (7.5-10)'
            ELSE '4_Blowout (10+)'
        END AS bucket_id,

        CASE
            WHEN final_home_score IS NULL OR final_away_score IS NULL THEN NULL
            WHEN league_id IN ('atp','wta','tennis') THEN NULL
            WHEN pick_side = 'HOME' THEN (final_home_score + COALESCE(spread,0)) - final_away_score
            WHEN pick_side = 'AWAY' THEN (final_away_score + COALESCE(spread,0)) - final_home_score  -- FIXED
            ELSE NULL
        END AS cover_margin

    FROM cleaned_data
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
    category,
    is_underdog,
    bucket_id,
    cover_margin
FROM categorized_data
WHERE category != 'UNCATEGORIZED';

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

-- BUCKETS (only spread buckets 1-4, excludes totals and no-spread)
CREATE VIEW vw_titan_buckets AS
WITH bucket_stats AS (
    SELECT
        bucket_id,
        COUNT(*) AS total_picks,
        COUNT(*) FILTER (WHERE pick_result = 'WIN') AS wins,
        COUNT(*) FILTER (WHERE pick_result = 'LOSS') AS losses,
        COUNT(*) FILTER (WHERE pick_result = 'PUSH') AS pushes
    FROM vw_titan_master
    WHERE pick_result IN ('WIN','LOSS','PUSH')
      AND bucket_id ~ '^[1-4]_'
    GROUP BY bucket_id
)
SELECT
    *,
    ROUND((wins::numeric / NULLIF(wins + losses, 0)) * 100, 1) AS win_rate
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
