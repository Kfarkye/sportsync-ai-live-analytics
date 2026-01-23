// scripts/seed_injury_report.ts
// Purpose: Seeds the injury_snapshots table with user-provided NBA injury report data.
// Usage: SUPABASE_SERVICE_ROLE_KEY=your_key npx tsx scripts/seed_injury_report.ts [path_to_json]

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Default path or CLI arg
const JSON_FILE = process.argv[2] || '/Users/k.far.88/Downloads/NBA-Injury-Report-2026-01-14 (1).json';

interface InjuryEntry {
    team: string;
    player: string;
    status: string;
    injury?: string;
    description?: string;
    date?: string;
}

async function seedInjuryReport() {
    console.log('🏥 Seeding NBA Injury Report into injury_snapshots...\n');

    if (!fs.existsSync(JSON_FILE)) {
        console.error(`❌ File not found: ${JSON_FILE}`);
        process.exit(1);
    }

    const raw = fs.readFileSync(JSON_FILE, 'utf-8');
    const data = JSON.parse(raw);

    // Handle different JSON structures
    let injuries: InjuryEntry[] = [];

    if (Array.isArray(data)) {
        injuries = data;
    } else if (data.injuries) {
        injuries = data.injuries;
    } else if (data.players) {
        injuries = data.players;
    } else {
        // Try to iterate over team keys
        Object.keys(data).forEach(teamKey => {
            if (Array.isArray(data[teamKey])) {
                data[teamKey].forEach((player: any) => {
                    injuries.push({
                        team: teamKey,
                        player: player.player || player.name || player.playerName,
                        status: player.status || 'Questionable',
                        injury: player.injury || player.description || player.reason
                    });
                });
            }
        });
    }

    if (injuries.length === 0) {
        console.log('⚠️ No injuries found in JSON. Structure may be unexpected.');
        console.log('First 500 chars of file:', raw.substring(0, 500));
        process.exit(1);
    }

    const today = new Date().toISOString().split('T')[0];
    let successCount = 0;

    for (const entry of injuries) {
        const playerName = entry.player || (entry as any).name || (entry as any).playerName;
        const teamName = entry.team || 'Unknown';
        const status = entry.status || 'Questionable';
        const report = entry.injury || entry.description || '';

        if (!playerName) {
            console.warn('⚠️ Skipping entry without player name:', entry);
            continue;
        }

        const { error } = await supabase
            .from('injury_snapshots')
            .upsert({
                sport: 'NBA',
                team: teamName,
                player_name: playerName,
                status: status,
                report: report,
                report_date: today
            }, {
                onConflict: 'player_name,team,sport,report_date'
            });

        if (error) {
            console.error(`❌ Error seeding ${playerName}:`, error.message);
        } else {
            successCount++;
        }
    }

    console.log(`\n✅ Seeded ${successCount} injury records for ${today}`);
}

seedInjuryReport().catch(console.error);
