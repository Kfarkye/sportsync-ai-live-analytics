
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkBestCategory() {
    console.log('=== CHECKING BEST CATEGORY ===\n');

    // We can't query the view directly as it might not be created/accessible via anon key depending on RLS
    // But we can simulate it with a query

    // Fetch all graded picks with category info if possible, or just raw data
    // Since we don't have the 'category' column in raw table, we have to replicate the logic or use the view if available.
    // Let's try querying the view first, it might work if exposed.

    const { data: viewData, error } = await supabase
        .from('vw_titan_summary')
        .select('*');

    if (!error && viewData && viewData.length > 0) {
        console.log('Found Summary View Data:', viewData[0]);
        return;
    }

    if (error) console.log('View access error (expected):', error.message);

    // Fallback: Calculate manually from raw picks
    // This is hard because "category" logic matches SQL logic...
    // Let's just find the best *League* for now as a proxy, or Tennis Favorites if possible.

    console.log('Calculating manually...');

    // Get all picks
    const { data: picks } = await supabase
        .from('pregame_intel')
        .select('league_id, pick_result, grading_metadata, recommended_pick')
        .in('pick_result', ['WIN', 'LOSS']);

    if (!picks) return;

    const categories: Record<string, { wins: number, losses: number }> = {};

    picks.forEach(p => {
        let cat = 'Other';
        const type = p.grading_metadata?.type;
        const spread = p.grading_metadata?.spread || p.grading_metadata?.analyzed_spread;
        const odds = p.grading_metadata?.odds;

        // Simplified categorization for quick check
        if (p.league_id.includes('atp') || p.league_id.includes('wta')) {
            // Check if favorite
            // This is rough estimation, deeper logic is in SQL
            cat = 'Tennis';
        } else {
            cat = p.league_id.toUpperCase();
        }

        if (!categories[cat]) categories[cat] = { wins: 0, losses: 0 };

        if (p.pick_result === 'WIN') categories[cat].wins++;
        if (p.pick_result === 'LOSS') categories[cat].losses++;
    });

    console.log('Category Performance:');
    for (const [cat, stats] of Object.entries(categories)) {
        const total = stats.wins + stats.losses;
        if (total < 5) continue;
        const rate = (stats.wins / total * 100).toFixed(1);
        console.log(`${cat}: ${stats.wins}-${stats.losses} (${rate}%)`);
    }
}

checkBestCategory();
