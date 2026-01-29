import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
    if (!supabaseKey) {
        console.log('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
        console.log('Set it and re-run: SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/run_migration.ts');
        return;
    }

    console.log('Dropping old views...');

    // Drop views in order
    const drops = [
        'vw_titan_api_gateway',
        'vw_titan_trends',
        'vw_titan_heatmap',
        'vw_titan_buckets',
        'vw_titan_summary',
        'vw_titan_leagues',
        'vw_titan_master'
    ];

    for (const view of drops) {
        const { error } = await supabase.rpc('exec_sql', {
            sql: `DROP VIEW IF EXISTS ${view} CASCADE`
        });
        if (error) console.log(`Drop ${view}:`, error.message);
    }

    console.log('Creating vw_titan_master with spread extraction fix...');

    const masterViewSQL = `
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
        
        CASE 
            WHEN pi.analyzed_spread IS NOT NULL THEN
                CASE 
                    WHEN pi.analyzed_spread::text = 'PK' THEN 0::numeric
                    WHEN pi.analyzed_spread::text ~ '[^0-9.-]' THEN 
                         NULLIF(regexp_replace(pi.analyzed_spread::text, '[^0-9.-]', '', 'g'), '')::numeric
                    ELSE NULLIF(pi.analyzed_spread::text, '')::numeric
                END
            WHEN pi.recommended_pick ~ '[+-]\\d+\\.?\\d*' THEN
                (regexp_match(pi.recommended_pick, '([+-]?\\d+\\.?\\d*)'))[1]::numeric
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
        WHEN pick_type IN ('GAMES_SPREAD', 'SETS_SPREAD') THEN
            CASE
                WHEN spread < 0 THEN 'FAVORITE'
                WHEN spread > 0 THEN 'UNDERDOG'
                ELSE 'PICK_EM'
            END
        WHEN spread IS NULL AND pick_odds IS NOT NULL THEN
            CASE
                WHEN pick_odds < 0 THEN 'FAVORITE'
                WHEN pick_odds > 0 THEN 'UNDERDOG'
                ELSE 'PICK_EM'
            END
        WHEN pick_side = 'HOME' AND spread > 0 THEN 'HOME_DOG'
        WHEN pick_side = 'HOME' AND spread <= 0 THEN 'HOME_FAV'
        WHEN pick_side = 'AWAY' AND spread > 0 THEN 'ROAD_FAV'
        WHEN pick_side = 'AWAY' AND spread <= 0 THEN 'ROAD_DOG'
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

FROM cleaned_data`;

    // This won't work via RPC - user needs to run via Dashboard
    console.log('\n=== MIGRATION SQL ===');
    console.log('Please run this SQL in Supabase Dashboard > SQL Editor:\n');
    console.log('File: supabase/migrations/20260129100000_fix_tennis_spread_extraction.sql');
}

runMigration();
