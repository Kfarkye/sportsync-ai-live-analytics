// scripts/seed_master_schedule.ts
// Purpose: Seeds the team_game_context table with user-provided high-fidelity data.
// Usage: SUPABASE_SERVICE_ROLE_KEY=your_key npx tsx scripts/seed_master_schedule.ts

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Load JSON files from Downloads folder or specify paths
const JSON_FILES = [
    '/Users/k.far.88/Downloads/Atlanta_Hawks_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Boston_Celtics_Fatigue_2025_26 (1).json',
    '/Users/k.far.88/Downloads/Brooklyn_Nets_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Charlotte_Hornets_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Chicago_Bulls_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Cleveland_Cavaliers_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Dallas_Mavericks_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Denver_Nuggets_Fatigue_2025_26 (1).json',
    '/Users/k.far.88/Downloads/Detroit_Pistons_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Golden_State_Warriors_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Houston_Rockets_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Indiana_Pacers_Fatigue_2025_26 (3).json',
    '/Users/k.far.88/Downloads/LA_Clippers_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Los_Angeles_Lakers_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Memphis_Grizzlies_Fatigue_2025_26 (1).json',
    '/Users/k.far.88/Downloads/Milwaukee_Bucks_Fatigue_2025_26 (1).json',
    '/Users/k.far.88/Downloads/Minnesota_Timberwolves_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/New_Orleans_Pelicans_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/New_York_Knicks_Fatigue_2025_26 (1).json',
    '/Users/k.far.88/Downloads/Oklahoma_City_City_Thunder_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Philadelphia_76ers_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Phoenix_Suns_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Portland_Trail_Blazers_Fatigue_2025_26 (1).json',
    '/Users/k.far.88/Downloads/Orlando_Magic_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Sacramento_Kings_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/San_Antonio_Spurs_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Toronto_Raptors_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Utah_Jazz_Fatigue_2025_26.json',
    '/Users/k.far.88/Downloads/Washington_Wizards_Fatigue_2025_26.json'
];

interface GameEntry {
    date: string;
    opponent: string;
    restDays?: number;
    daysRest?: number;
    fatigueScore: number;
    isB2B?: boolean;
    isSecondOfB2B?: boolean;
    is3in4?: boolean;
    is4in5?: boolean;
    location?: string;
    isHome?: boolean;
    gameNumber?: number;
}

interface TeamSchedule {
    teamName: string;
    schedule: GameEntry[];
}

async function seedFromFile(filePath: string) {
    console.log(`📂 Loading: ${path.basename(filePath)}`);

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data: TeamSchedule = JSON.parse(raw);

    console.log(`🏀 Team: ${data.teamName} | Games: ${data.schedule.length}`);

    const records = data.schedule.map((s, idx) => ({
        team: data.teamName,
        league_id: 'nba',
        game_date: s.date,

        // NEW: Opponent & Location
        opponent: s.opponent,
        is_home: s.isHome ?? (s.location === 'Home'),

        // Fatigue Flags
        situation: s.isB2B ? (s.isSecondOfB2B ? 'B2B-2nd' : 'B2B') : s.is3in4 ? '3in4' : s.is4in5 ? '4in5' : 'Normal',
        rest_days: s.restDays ?? s.daysRest ?? 2,
        fatigue_score: s.fatigueScore,

        // NEW: Boolean flags
        is_b2b: s.isB2B ?? false,
        is_second_of_b2b: s.isSecondOfB2B ?? false,
        is_3in4: s.is3in4 ?? false,
        is_4in5: s.is4in5 ?? false,
        game_number: s.gameNumber ?? (idx + 1),

        // Meta
        injury_impact: 0,
        injury_notes: null,
        source: 'user_master_json'
    }));

    const { error } = await supabase.from('team_game_context').upsert(records, {
        onConflict: 'team,game_date,league_id'
    });

    if (error) {
        console.error(`❌ Error seeding ${data.teamName}:`, error.message);
    } else {
        console.log(`✅ Seeded ${records.length} games for ${data.teamName}`);
    }
}

async function main() {
    console.log("🌱 Seeding Master Fatigue Schedule into team_game_context...\n");

    for (const filePath of JSON_FILES) {
        if (fs.existsSync(filePath)) {
            await seedFromFile(filePath);
        } else {
            console.warn(`⚠️ File not found: ${filePath}`);
        }
    }

    console.log("\n🎉 Seeding complete!");
}

main();
