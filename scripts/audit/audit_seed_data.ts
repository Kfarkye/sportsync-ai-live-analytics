// scripts/audit_seed_data.ts
// Audits all seed tables to verify data exists and is accurate
// Usage: npx tsx scripts/audit_seed_data.ts

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
    'https://qffzvrnbzabcokqqrwbv.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc'
);

async function audit() {
    console.log('='.repeat(60));
    console.log('🔍 SEED DATA AUDIT - ' + new Date().toISOString());
    console.log('='.repeat(60));

    // 1. NBA Team Priors
    console.log('\n📊 1. NBA_TEAM_PRIORS (O/D ratings for fair line calc)');
    const { data: priors, error: priorsErr } = await sb
        .from('nba_team_priors')
        .select('season, team, o_rating, d_rating')
        .order('season', { ascending: false })
        .limit(35);

    if (priorsErr) {
        console.log('   ❌ Error:', priorsErr.message);
    } else if (!priors || priors.length === 0) {
        console.log('   ❌ EMPTY - No team priors found!');
        console.log('   → RUN: Copy supabase/seed/nba_team_priors.sql to SQL Editor');
    } else {
        const seasons = [...new Set(priors.map(p => p.season))];
        console.log(`   ✅ Found ${priors.length} records`);
        console.log(`   Seasons: ${seasons.join(', ')}`);
        // Check for 2025-26 specifically
        const current = priors.filter(p => p.season === '2025-26');
        console.log(`   2025-26 teams: ${current.length}/30`);
        if (current.length < 30) {
            console.log('   ⚠️ INCOMPLETE - Need all 30 NBA teams for 2025-26');
        }
        // Sample data
        console.log('   Sample:', priors.slice(0, 3).map(p => `${p.team}: O=${p.o_rating}, D=${p.d_rating}`).join(' | '));
    }

    // 2. Team Game Context (fatigue/rest/B2B)
    console.log('\n📊 2. TEAM_GAME_CONTEXT (fatigue, rest days, B2B flags)');
    const { data: context, error: contextErr } = await sb
        .from('team_game_context')
        .select('team, game_date, situation, rest_days, fatigue_score')
        .gte('game_date', '2026-02-01')
        .order('game_date', { ascending: true })
        .limit(20);

    if (contextErr) {
        console.log('   ❌ Error:', contextErr.message);
    } else if (!context || context.length === 0) {
        console.log('   ❌ EMPTY - No game context found for Feb 2026!');
        console.log('   → RUN: npx tsx scripts/seed_master_schedule.ts');
    } else {
        const teams = [...new Set(context.map(c => c.team))];
        console.log(`   ✅ Found ${context.length} records`);
        console.log(`   Teams with data: ${teams.length}`);
        console.log('   Sample:', context.slice(0, 3).map(c => `${c.team} ${c.game_date}: ${c.situation}, rest=${c.rest_days}`).join(' | '));
    }

    // 3. NBA Player EPM
    console.log('\n📊 3. NBA_PLAYER_EPM (player impact values)');
    const { data: epm, error: epmErr } = await sb
        .from('nba_player_epm')
        .select('season, player_id, team, epm')
        .eq('season', '2025-26')
        .order('epm', { ascending: false })
        .limit(10);

    if (epmErr) {
        console.log('   ❌ Error:', epmErr.message);
    } else if (!epm || epm.length === 0) {
        console.log('   ❌ EMPTY - No player EPM found!');
        console.log('   → RUN: Copy supabase/seed/nba_player_epm.sql to SQL Editor');
    } else {
        console.log(`   ✅ Found ${epm.length}+ records`);
        console.log('   Top 5:', epm.slice(0, 5).map(p => `${p.player_id}: ${p.epm}`).join(', '));
    }

    // 4. Matches (upcoming)
    console.log('\n📊 4. MATCHES (upcoming games with odds)');
    const { data: matches, error: matchesErr } = await sb
        .from('matches')
        .select('id, home_team, away_team, league_id, current_spread, current_total, status')
        .gte('start_time', new Date().toISOString())
        .order('start_time', { ascending: true })
        .limit(15);

    if (matchesErr) {
        console.log('   ❌ Error:', matchesErr.message);
    } else if (!matches || matches.length === 0) {
        console.log('   ⚠️ No upcoming matches found');
    } else {
        console.log(`   ✅ Found ${matches.length} upcoming matches`);
        const withOdds = matches.filter(m => m.current_spread != null || m.current_total != null);
        console.log(`   With odds: ${withOdds.length}/${matches.length}`);
        console.log('   Sample:', matches.slice(0, 3).map(m => `${m.away_team} @ ${m.home_team} (${m.league_id})`).join(' | '));
    }

    // 5. Pregame Intel (recent)
    console.log('\n📊 5. PREGAME_INTEL (AI-generated intel)');
    const { data: intel, error: intelErr } = await sb
        .from('pregame_intel')
        .select('match_id, game_date, confidence_tier, logic_group, generated_at')
        .order('generated_at', { ascending: false })
        .limit(10);

    if (intelErr) {
        console.log('   ❌ Error:', intelErr.message);
    } else if (!intel || intel.length === 0) {
        console.log('   ⚠️ No intel generated yet');
    } else {
        console.log(`   ✅ Found ${intel.length} intel records`);
        const recent = intel.filter(i => {
            const age = Date.now() - new Date(i.generated_at).getTime();
            return age < 24 * 60 * 60 * 1000; // Last 24 hours
        });
        console.log(`   Last 24hrs: ${recent.length}`);
    }

    // 6. Injury Snapshots
    console.log('\n📊 6. INJURY_SNAPSHOTS (player injuries)');
    const { data: injuries, error: injErr } = await sb
        .from('injury_snapshots')
        .select('player_name, team, status, report_date')
        .order('report_date', { ascending: false })
        .limit(10);

    if (injErr) {
        console.log('   ❌ Error:', injErr.message);
    } else if (!injuries || injuries.length === 0) {
        console.log('   ⚠️ No injury data - forensic context will be limited');
        console.log('   → RUN: npx tsx scripts/seed_injury_report.ts <json_path>');
    } else {
        console.log(`   ✅ Found ${injuries.length}+ injury records`);
        console.log('   Most recent:', injuries[0]?.report_date);
    }

    console.log('\n' + '='.repeat(60));
    console.log('AUDIT COMPLETE');
    console.log('='.repeat(60));
}

audit().catch(console.error);
