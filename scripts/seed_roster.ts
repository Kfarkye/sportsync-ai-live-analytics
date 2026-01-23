// scripts/seed_roster.ts
// Purpose: Seeds the team_rosters table with data from user-provided JSON files.
// Usage: SUPABASE_SERVICE_ROLE_KEY=your_key npx tsx scripts/seed_roster.ts [json_path]

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// JSON files to process (add more as needed)
const JSON_FILES = [
    '/Users/k.far.88/Downloads/los-angeles-lakers-roster-2025-26.json',
    '/Users/k.far.88/Downloads/boston-celtics-roster-2025-26.json',
];

interface PlayerEntry {
    name: string;
    position: string;
    number: string;
    height?: string;
    weight?: string;
    age?: number;
    nationality?: string;
    status?: string;
    injury?: string;
}

interface RosterFile {
    teamName: string;
    league?: string;
    season?: string;
    players: PlayerEntry[];
}

async function clearTeamRoster(team: string) {
    console.log(`🗑️ Clearing existing roster for ${team}...`);
    const { error } = await supabase
        .from('team_rosters')
        .delete()
        .eq('team', team);

    if (error) {
        console.error(`❌ Error clearing ${team}:`, error.message);
    }
}

async function seedFromJson(filePath: string) {
    const fileName = filePath.split('/').pop() || filePath;
    console.log(`\n📂 Loading: ${fileName}`);

    if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        return;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data: RosterFile = JSON.parse(raw);

    const teamName = data.teamName;
    const players = data.players || [];

    if (!teamName || players.length === 0) {
        console.error(`❌ Invalid JSON structure in ${fileName}`);
        return;
    }

    console.log(`🏀 Team: ${teamName} | Players: ${players.length}`);

    // Clear existing roster for this team first
    await clearTeamRoster(teamName);

    let successCount = 0;

    for (const player of players) {
        const { error } = await supabase
            .from('team_rosters')
            .upsert({
                team: teamName,
                sport: data.league || 'NBA',
                player_name: player.name,
                position: player.position,
                jersey_number: parseInt(player.number) || null,
                status: player.status || 'Active',
                injury_report: player.injury || null
            }, {
                onConflict: 'player_name,team,sport'
            });

        if (error) {
            console.error(`❌ Error seeding ${player.name}:`, error.message);
        } else {
            console.log(`  ✅ #${player.number} ${player.name} (${player.position}) - ${player.status || 'Active'}`);
            successCount++;
        }
    }

    console.log(`✅ Seeded ${successCount}/${players.length} players for ${teamName}`);
}

async function syncInjuries() {
    console.log('\n🔄 Syncing with injury_snapshots...');

    const { data: injuries, error } = await supabase
        .from('injury_snapshots')
        .select('*')
        .eq('sport', 'NBA')
        .order('report_date', { ascending: false });

    if (error) {
        console.error('❌ Error fetching injuries:', error.message);
        return;
    }

    let syncCount = 0;
    for (const injury of injuries || []) {
        const { data, error: updateError } = await supabase
            .from('team_rosters')
            .update({
                status: injury.status,
                injury_report: injury.report,
                injury_date: injury.report_date
            })
            .eq('player_name', injury.player_name)
            .select();

        if (!updateError && data && data.length > 0) {
            console.log(`  🏥 Updated ${injury.player_name}: ${injury.status}`);
            syncCount++;
        }
    }

    console.log(`\n✅ Synced ${syncCount} injury statuses`);
}

async function main() {
    console.log('🏀 Seeding Team Rosters from JSON files...\n');

    // Process CLI arg or all files
    const cliPath = process.argv[2];

    if (cliPath) {
        await seedFromJson(cliPath);
    } else {
        for (const filePath of JSON_FILES) {
            await seedFromJson(filePath);
        }
    }

    // Sync injuries after seeding
    await syncInjuries();

    console.log('\n🎉 Roster seeding complete!');
}

main().catch(console.error);
