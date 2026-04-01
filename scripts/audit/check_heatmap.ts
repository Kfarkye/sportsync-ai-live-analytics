
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkHeatmapView() {
    console.log('=== CHECKING HEATMAP VIEW ===\n');

    const { data: viewData, error } = await supabase
        .from('vw_titan_heatmap')
        .select('*');

    if (error) {
        console.log('Error:', error);
        return;
    }

    // console.log(JSON.stringify(viewData, null, 2));

    // Aggregate by category to match dashboard table
    // Dashboard had: "Tennis (Favorites)", "Total Over", "Away Spread (Dog)", etc.
    // vw_titan_heatmap has: category, bucket_id, wins, losses ...

    // We can group by category
    const categories: Record<string, { wins: number, losses: number }> = {};

    viewData.forEach(row => {
        const cat = row.category;
        if (!categories[cat]) categories[cat] = { wins: 0, losses: 0 };
        categories[cat].wins += row.wins;
        categories[cat].losses += row.losses;
    });

    console.log('--- Aggregated Categories ---');
    for (const [cat, stats] of Object.entries(categories)) {
        const total = stats.wins + stats.losses;
        const rate = (stats.wins / total * 100).toFixed(1);
        console.log(`${cat}: ${stats.wins}-${stats.losses} (${rate}%)`);
    }

    // Also check buckets
    const { data: buckets } = await supabase.from('vw_titan_buckets').select('*');
    console.log('\n--- Buckets ---');
    console.log(JSON.stringify(buckets, null, 2));
}

checkHeatmapView();
