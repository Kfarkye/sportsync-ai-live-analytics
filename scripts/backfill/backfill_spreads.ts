import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
// Need service role key to update
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseKey) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required');
    console.log('Run with: SUPABASE_SERVICE_ROLE_KEY=your_key npx tsx scripts/backfill_spreads.ts');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function backfillSpreads() {
    console.log('=== BACKFILL ANALYZED_SPREAD FROM RECOMMENDED_PICK ===\n');

    // Get all picks with null analyzed_spread but have a recommended_pick
    const { data, error } = await supabase
        .from('pregame_intel')
        .select('intel_id, recommended_pick, analyzed_spread')
        .is('analyzed_spread', null)
        .not('recommended_pick', 'is', null)
        .in('pick_result', ['WIN', 'LOSS', 'PUSH'])
        .limit(1000);

    if (error) {
        console.error('Error fetching:', error.message);
        return;
    }

    console.log(`Found ${data?.length} picks with missing analyzed_spread\n`);

    // Parse and extract spreads
    const spreadPattern = /([+-]?\d+\.?\d*)$/; // Matches spread at end of string
    const updates: { intel_id: string; spread: number }[] = [];

    data?.forEach((row: any) => {
        const rec = (row.recommended_pick || '').trim();
        const match = rec.match(spreadPattern);

        if (match) {
            const spread = parseFloat(match[1]);
            if (!isNaN(spread)) {
                updates.push({ intel_id: row.intel_id, spread });
            }
        }
    });

    console.log(`Extracted spreads for ${updates.length} picks`);

    // Show sample
    console.log('\n--- Sample updates ---');
    updates.slice(0, 10).forEach(u => {
        const original = data?.find(d => d.intel_id === u.intel_id)?.recommended_pick;
        console.log(`  "${original}" → ${u.spread}`);
    });

    // Execute updates
    console.log('\n--- Executing updates ---');
    let success = 0;
    let failed = 0;

    for (const update of updates) {
        const { error: updateError } = await supabase
            .from('pregame_intel')
            .update({ analyzed_spread: update.spread })
            .eq('intel_id', update.intel_id);

        if (updateError) {
            console.error(`Failed ${update.intel_id}: ${updateError.message}`);
            failed++;
        } else {
            success++;
        }
    }

    console.log(`\n✅ Updated: ${success}`);
    console.log(`❌ Failed: ${failed}`);
}

backfillSpreads();
