import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
// Need service role key for writes
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function extractSpread(text: string): number | null {
    if (!text) return null;
    if (/pk|pick'?em/i.test(text)) return 0;

    // Match patterns like +5.5, -3.5, etc.
    const match = text.match(/([+-]\d+\.?\d*)/);
    if (match) {
        const num = parseFloat(match[1]);
        if (!isNaN(num) && Math.abs(num) < 50) return num;
    }
    return null;
}

async function backfillTennisGamesSpread() {
    console.log('=== BACKFILL TENNIS GAMES_SPREAD analyzed_spread ===\n');

    if (!supabaseKey) {
        console.log('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
        console.log('Run with: SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/backfill_tennis_spread.ts');
        return;
    }

    // Find all GAMES_SPREAD picks with null analyzed_spread
    const { data: records, error } = await supabase
        .from('pregame_intel')
        .select('intel_id, recommended_pick, analyzed_spread, grading_metadata')
        .is('analyzed_spread', null)
        .in('pick_result', ['WIN', 'LOSS', 'PUSH']);

    if (error) {
        console.log('Error fetching records:', error);
        return;
    }

    // Filter to GAMES_SPREAD type only
    const gamesSpreadRecords = records?.filter(r =>
        r.grading_metadata?.type === 'GAMES_SPREAD'
    ) || [];

    console.log(`Found ${gamesSpreadRecords.length} GAMES_SPREAD records with null analyzed_spread\n`);

    // Extract and prepare updates
    const updates: { intel_id: string, spread: number }[] = [];
    const noExtract: any[] = [];

    gamesSpreadRecords.forEach(r => {
        const spread = extractSpread(r.recommended_pick);
        if (spread !== null) {
            updates.push({ intel_id: r.intel_id, spread });
        } else {
            noExtract.push(r);
        }
    });

    console.log(`Can extract spread: ${updates.length}`);
    console.log(`Cannot extract: ${noExtract.length}`);

    if (noExtract.length > 0) {
        console.log('\nRecords without extractable spread:');
        noExtract.forEach(r => {
            console.log(`  ${r.intel_id}: "${r.recommended_pick}"`);
        });
    }

    // Perform updates in batches
    console.log(`\nUpdating ${updates.length} records...`);

    let success = 0;
    let failed = 0;

    for (const update of updates) {
        const { error: updateError } = await supabase
            .from('pregame_intel')
            .update({ analyzed_spread: update.spread })
            .eq('intel_id', update.intel_id);

        if (updateError) {
            console.log(`Failed to update ${update.intel_id}:`, updateError.message);
            failed++;
        } else {
            success++;
        }
    }

    console.log(`\n=== COMPLETE ===`);
    console.log(`Updated: ${success}`);
    console.log(`Failed: ${failed}`);
}

backfillTennisGamesSpread();
