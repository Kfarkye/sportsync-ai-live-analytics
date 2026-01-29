import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function finalAudit() {
    console.log('=== FINAL TITAN ANALYTICS AUDIT ===\n');

    // Get summary
    const { data: summary } = await supabase.from('vw_titan_summary').select('*').single();
    console.log('EXECUTIVE SUMMARY:');
    console.log(`  Total Picks: ${summary?.total_picks}`);
    console.log(`  Record: ${summary?.total_wins}-${summary?.total_losses}`);
    console.log(`  Win Rate: ${summary?.global_win_rate}%`);
    console.log(`  Best Category: ${summary?.best_category} (${summary?.best_category_win_rate}%)`);

    // Get buckets
    const { data: buckets } = await supabase.from('vw_titan_buckets').select('*');
    console.log('\nBUCKET DISTRIBUTION:');
    buckets?.sort((a: any, b: any) => a.bucket_id.localeCompare(b.bucket_id)).forEach((b: any) => {
        console.log(`  ${b.bucket_id.padEnd(20)} ${b.wins}-${b.losses} (${b.win_rate}%)`);
    });

    // Get remaining UNCATEGORIZED
    const { data: uncat } = await supabase
        .from('vw_titan_master')
        .select('category, pick_result')
        .eq('category', 'UNCATEGORIZED')
        .in('pick_result', ['WIN', 'LOSS', 'PUSH']);

    // Get remaining PICK_EM
    const { data: pickEm } = await supabase
        .from('vw_titan_master')
        .select('category, pick_result')
        .eq('category', 'PICK_EM')
        .in('pick_result', ['WIN', 'LOSS', 'PUSH']);

    console.log('\nREMAINING EDGE CASES:');
    console.log(`  UNCATEGORIZED: ${uncat?.length} picks`);
    console.log(`  PICK_EM: ${pickEm?.length} picks`);

    // Verify total adds up
    const totalInBuckets = buckets?.reduce((sum: number, b: any) => sum + b.wins + b.losses + b.pushes, 0);
    console.log(`\nVERIFICATION:`);
    console.log(`  Sum of all buckets: ${totalInBuckets}`);
    console.log(`  Expected (total_picks): ${summary?.total_picks}`);
    console.log(`  Match: ${totalInBuckets === summary?.total_picks ? '✅ YES' : '❌ NO'}`);
}

finalAudit();
