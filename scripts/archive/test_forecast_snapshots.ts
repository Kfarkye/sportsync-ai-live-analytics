import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testSnapshots() {
    console.log('🚀 Testing Forecast Snapshots...');

    // 1. Get a test match
    const { data: match, error: matchError } = await supabase
        .from('matches')
        .select('id')
        .limit(1)
        .single();

    if (matchError || !match) {
        console.error('Error fetching test match:', matchError?.message);
        return;
    }

    const matchId = match.id;
    console.log(`Using Match ID: ${matchId}`);

    // 2. Insert a test snapshot
    const testSnapshot = {
        match_id: matchId,
        league_id: 'nba',
        period: 4,
        clock: '12:00',
        home_score: 100,
        away_score: 98,
        market_total: 220.5,
        fair_total: 218.4,
        edge_points: 2.1,
        edge_state: 'LEAN',
        regime: 'NORMAL',
        observed_ppm: 4.5,
        projected_ppm: 4.5
    };

    console.log('Inserting test snapshot...');
    const { data: insertData, error: insertError } = await supabase
        .from('live_forecast_snapshots')
        .upsert(testSnapshot, { onConflict: 'match_id,period,clock' })
        .select();

    if (insertError) {
        console.error('❌ Insert FAILED:', insertError.message);
        return;
    }
    console.log('✅ Insert successful:', insertData[0].id);

    // 3. Verify deduplication (Unique constraint)
    console.log('Testing unique constraint (should replace existing row)...');
    const { error: dupError } = await supabase
        .from('live_forecast_snapshots')
        .upsert(testSnapshot, { onConflict: 'match_id,period,clock' });

    if (dupError) {
        console.error('❌ Unique constraint FAILED (Expected upsert)', dupError.message);
    } else {
        console.log('✅ Unique constraint handled via upsert.');
    }

    // 4. Verify retrieval
    console.log('Fetching snapshots...');
    const { data: snapshots, error: fetchError } = await supabase
        .from('live_forecast_snapshots')
        .select('*')
        .eq('match_id', matchId)
        .order('created_at', { ascending: false });

    if (fetchError) {
        console.error('❌ Fetch FAILED:', fetchError.message);
        return;
    }
    console.log(`✅ Retrieved ${snapshots.length} snapshots.`);
    console.log('Latest snapshot:', snapshots[0]);

    console.log('\n🎉 Verification Complete!');
}

testSnapshots();
