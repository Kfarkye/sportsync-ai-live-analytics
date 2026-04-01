// scripts/seed_team_tempo.ts
// Seeds the team_tempo table with NBA analytics data
// Usage: SUPABASE_SERVICE_ROLE_KEY=your_key npx tsx scripts/seed_team_tempo.ts

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// NBA Tempo Data - Jan 15, 2026
const TEMPO_DATA = [
    { team: "Oklahoma City Thunder", pace: 97.3, ortg: 120.5, drtg: 107.6, net_rtg: 12.9, ppm: 120.5, ats_record: "65-38-2", ats_l10: "8-2-0", ats_l5: "4-1-0", over_record: 56, under_record: 49, over_l10: 6, over_l5: 3, under_l10: 4, under_l5: 2, push_record: 2, ortg_l10: 122.1, ortg_l5: 123.5, pace_l10: 98.1, pace_l5: 98.5, ppm_l10: 122.5, ppm_l5: 124, rank: 1 },
    { team: "Cleveland Cavaliers", pace: 98.5, ortg: 121.9, drtg: 112.4, net_rtg: 9.5, ppm: 121.9, ats_record: "54-37-0", ats_l10: "6-4-0", ats_l5: "3-2-0", over_record: 55, under_record: 35, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 1, ortg_l10: 120.5, ortg_l5: 121, pace_l10: 99, pace_l5: 99.2, ppm_l10: 120, ppm_l5: 121.5, rank: 2 },
    { team: "Boston Celtics", pace: 98, ortg: 116.3, drtg: 107.2, net_rtg: 9.1, ppm: 116.3, ats_record: "44-49-0", ats_l10: "5-5-0", ats_l5: "2-3-0", over_record: 54, under_record: 28, over_l10: 6, over_l5: 3, under_l10: 4, under_l5: 2, push_record: 0, ortg_l10: 115, ortg_l5: 114.5, pace_l10: 98.5, pace_l5: 98.8, ppm_l10: 115.5, ppm_l5: 116, rank: 3 },
    { team: "Houston Rockets", pace: 99.5, ortg: 114.3, drtg: 109.8, net_rtg: 4.5, ppm: 114.3, ats_record: "27-18-1", ats_l10: "7-3-0", ats_l5: "4-1-0", over_record: 31, under_record: 43, over_l10: 4, over_l5: 2, under_l10: 6, under_l5: 3, push_record: 1, ortg_l10: 115.5, ortg_l5: 116, pace_l10: 100, pace_l5: 100.5, ppm_l10: 115, ppm_l5: 116.5, rank: 4 },
    { team: "New York Knicks", pace: 96.5, ortg: 115.8, drtg: 111.7, net_rtg: 4.1, ppm: 115.8, ats_record: "24-22-1", ats_l10: "5-5-0", ats_l5: "3-2-0", over_record: 34, under_record: 27, over_l10: 5, over_l5: 3, under_l10: 5, under_l5: 2, push_record: 1, ortg_l10: 116, ortg_l5: 116.5, pace_l10: 97, pace_l5: 97.2, ppm_l10: 116.5, ppm_l5: 117, rank: 5 },
    { team: "Denver Nuggets", pace: 97.8, ortg: 120.8, drtg: 116.9, net_rtg: 3.9, ppm: 120.8, ats_record: "23-22-1", ats_l10: "6-4-0", ats_l5: "3-2-0", over_record: 52, under_record: 30, over_l10: 7, over_l5: 4, under_l10: 3, under_l5: 1, push_record: 1, ortg_l10: 121.5, ortg_l5: 122, pace_l10: 98.2, pace_l5: 98.5, ppm_l10: 122, ppm_l5: 123, rank: 6 },
    { team: "Los Angeles Clippers", pace: 98.2, ortg: 112.9, drtg: 108.2, net_rtg: 4.7, ppm: 112.9, ats_record: "29-17-0", ats_l10: "7-3-0", ats_l5: "4-1-0", over_record: 46, under_record: 39, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 0, ortg_l10: 114, ortg_l5: 114.5, pace_l10: 98.5, pace_l5: 98.8, ppm_l10: 113.5, ppm_l5: 114, rank: 7 },
    { team: "Minnesota Timberwolves", pace: 97.3, ortg: 114.3, drtg: 109.3, net_rtg: 5, ppm: 114.3, ats_record: "39-42-1", ats_l10: "8-2-0", ats_l5: "4-1-0", over_record: 52, under_record: 44, over_l10: 6, over_l5: 3, under_l10: 4, under_l5: 2, push_record: 1, ortg_l10: 115.5, ortg_l5: 116, pace_l10: 97.8, pace_l5: 98, ppm_l10: 115, ppm_l5: 116, rank: 8 },
    { team: "Indiana Pacers", pace: 101.5, ortg: 117.4, drtg: 115.1, net_rtg: 2.3, ppm: 117.4, ats_record: "23-21-1", ats_l10: "5-5-0", ats_l5: "2-3-0", over_record: 38, under_record: 44, over_l10: 6, over_l5: 3, under_l10: 4, under_l5: 2, push_record: 1, ortg_l10: 118, ortg_l5: 118.5, pace_l10: 102, pace_l5: 102.5, ppm_l10: 118.5, ppm_l5: 119, rank: 9 },
    { team: "Los Angeles Lakers", pace: 100.2, ortg: 113.4, drtg: 112.2, net_rtg: 1.2, ppm: 113.4, ats_record: "22-22-1", ats_l10: "4-6-0", ats_l5: "2-3-0", over_record: 45, under_record: 47, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 1, ortg_l10: 114, ortg_l5: 114.5, pace_l10: 100.5, pace_l5: 100.8, ppm_l10: 114, ppm_l5: 114.5, rank: 10 },
    { team: "Milwaukee Bucks", pace: 99.8, ortg: 115.5, drtg: 113, net_rtg: 2.5, ppm: 115.5, ats_record: "22-23-1", ats_l10: "5-5-0", ats_l5: "3-2-0", over_record: 48, under_record: 53, over_l10: 4, over_l5: 2, under_l10: 6, under_l5: 3, push_record: 1, ortg_l10: 116, ortg_l5: 116.5, pace_l10: 100, pace_l5: 100.2, ppm_l10: 116, ppm_l5: 116.5, rank: 11 },
    { team: "Golden State Warriors", pace: 99, ortg: 113.8, drtg: 113.2, net_rtg: 0.6, ppm: 113.8, ats_record: "33-28-0", ats_l10: "6-4-0", ats_l5: "3-2-0", over_record: 31, under_record: 30, over_l10: 5, over_l5: 3, under_l10: 5, under_l5: 2, push_record: 0, ortg_l10: 114.5, ortg_l5: 115, pace_l10: 99.5, pace_l5: 99.8, ppm_l10: 114.5, ppm_l5: 115, rank: 12 },
    { team: "Memphis Grizzlies", pace: 98.5, ortg: 112, drtg: 111.5, net_rtg: 0.5, ppm: 112, ats_record: "31-16-0", ats_l10: "7-3-0", ats_l5: "4-1-0", over_record: 45, under_record: 45, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 0, ortg_l10: 113, ortg_l5: 113.5, pace_l10: 99, pace_l5: 99.2, ppm_l10: 113, ppm_l5: 113.5, rank: 13 },
    { team: "Detroit Pistons", pace: 98.8, ortg: 115.5, drtg: 113.6, net_rtg: 1.9, ppm: 115.5, ats_record: "23-21-2", ats_l10: "5-5-0", ats_l5: "2-3-0", over_record: 44, under_record: 28, over_l10: 6, over_l5: 3, under_l10: 4, under_l5: 2, push_record: 2, ortg_l10: 116, ortg_l5: 116.5, pace_l10: 99.2, pace_l5: 99.5, ppm_l10: 116.5, ppm_l5: 117, rank: 14 },
    { team: "Orlando Magic", pace: 97, ortg: 105.4, drtg: 105.5, net_rtg: -0.1, ppm: 105.4, ats_record: "23-24-1", ats_l10: "4-6-0", ats_l5: "2-3-0", over_record: 36, under_record: 47, over_l10: 4, over_l5: 2, under_l10: 6, under_l5: 3, push_record: 1, ortg_l10: 106, ortg_l5: 106.5, pace_l10: 97.5, pace_l5: 97.8, ppm_l10: 106, ppm_l5: 106.5, rank: 15 },
    { team: "Sacramento Kings", pace: 98.2, ortg: 116.7, drtg: 116.2, net_rtg: 0.5, ppm: 115.7, ats_record: "15-25-0", ats_l10: "3-7-0", ats_l5: "1-4-0", over_record: 44, under_record: 46, over_l10: 5, over_l5: 3, under_l10: 5, under_l5: 2, push_record: 0, ortg_l10: 117, ortg_l5: 117.5, pace_l10: 98.5, pace_l5: 98.8, ppm_l10: 116.5, ppm_l5: 117, rank: 16 },
    { team: "Atlanta Hawks", pace: 100.5, ortg: 118.2, drtg: 119.3, net_rtg: -1.1, ppm: 118.2, ats_record: "21-20-0", ats_l10: "5-5-0", ats_l5: "3-2-0", over_record: 35, under_record: 41, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 0, ortg_l10: 119, ortg_l5: 119.5, pace_l10: 101, pace_l5: 101.2, ppm_l10: 119, ppm_l5: 119.5, rank: 17 },
    { team: "Chicago Bulls", pace: 99, ortg: 117.8, drtg: 119.4, net_rtg: -1.6, ppm: 117.8, ats_record: "19-20-0", ats_l10: "4-6-0", ats_l5: "2-3-0", over_record: 37, under_record: 30, over_l10: 6, over_l5: 3, under_l10: 4, under_l5: 2, push_record: 0, ortg_l10: 118.5, ortg_l5: 119, pace_l10: 99.5, pace_l5: 99.8, ppm_l10: 118.5, ppm_l5: 119, rank: 18 },
    { team: "Dallas Mavericks", pace: 98, ortg: 115, drtg: 115.5, net_rtg: -0.5, ppm: 115, ats_record: "23-23-1", ats_l10: "5-5-0", ats_l5: "3-2-0", over_record: 44, under_record: 50, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 1, ortg_l10: 115.5, ortg_l5: 116, pace_l10: 98.5, pace_l5: 98.8, ppm_l10: 115.5, ppm_l5: 116, rank: 19 },
    { team: "Miami Heat", pace: 97.5, ortg: 110.6, drtg: 110, net_rtg: 0.6, ppm: 110.6, ats_record: "23-17-0", ats_l10: "6-4-0", ats_l5: "3-2-0", over_record: 44, under_record: 48, over_l10: 4, over_l5: 2, under_l10: 6, under_l5: 3, push_record: 0, ortg_l10: 111, ortg_l5: 111.5, pace_l10: 98, pace_l5: 98.2, ppm_l10: 111, ppm_l5: 111.5, rank: 20 },
    { team: "Phoenix Suns", pace: 98.5, ortg: 114, drtg: 114.5, net_rtg: -0.5, ppm: 114, ats_record: "29-11-0", ats_l10: "7-3-0", ats_l5: "4-1-0", over_record: 46, under_record: 52, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 0, ortg_l10: 114.5, ortg_l5: 115, pace_l10: 99, pace_l5: 99.2, ppm_l10: 114.5, ppm_l5: 115, rank: 21 },
    { team: "Portland Trail Blazers", pace: 98, ortg: 111, drtg: 115, net_rtg: -4, ppm: 111, ats_record: "26-20-1", ats_l10: "5-5-0", ats_l5: "3-2-0", over_record: 22, under_record: 27, over_l10: 4, over_l5: 2, under_l10: 6, under_l5: 3, push_record: 1, ortg_l10: 111.5, ortg_l5: 112, pace_l10: 98.5, pace_l5: 98.8, ppm_l10: 111.5, ppm_l5: 112, rank: 22 },
    { team: "San Antonio Spurs", pace: 99, ortg: 112, drtg: 116, net_rtg: -4, ppm: 112, ats_record: "24-16-0", ats_l10: "6-4-0", ats_l5: "3-2-0", over_record: 35, under_record: 28, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 0, ortg_l10: 112.5, ortg_l5: 113, pace_l10: 99.5, pace_l5: 99.8, ppm_l10: 112.5, ppm_l5: 113, rank: 23 },
    { team: "Toronto Raptors", pace: 98.5, ortg: 110.9, drtg: 115.2, net_rtg: -4.3, ppm: 110.9, ats_record: "48-32-2", ats_l10: "6-4-0", ats_l5: "3-2-0", over_record: 41, under_record: 41, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 2, ortg_l10: 111.5, ortg_l5: 112, pace_l10: 99, pace_l5: 99.2, ppm_l10: 111.5, ppm_l5: 112, rank: 24 },
    { team: "Brooklyn Nets", pace: 97.5, ortg: 105.1, drtg: 112.2, net_rtg: -7.1, ppm: 105.1, ats_record: "23-23-1", ats_l10: "4-6-0", ats_l5: "2-3-0", over_record: 37, under_record: 43, over_l10: 4, over_l5: 2, under_l10: 6, under_l5: 3, push_record: 1, ortg_l10: 105.5, ortg_l5: 106, pace_l10: 98, pace_l5: 98.2, ppm_l10: 105.5, ppm_l5: 106, rank: 25 },
    { team: "Philadelphia 76ers", pace: 98, ortg: 109.6, drtg: 115.8, net_rtg: -6.2, ppm: 109.6, ats_record: "21-17-0", ats_l10: "5-5-0", ats_l5: "2-3-0", over_record: 52, under_record: 48, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 0, ortg_l10: 110, ortg_l5: 110.5, pace_l10: 98.5, pace_l5: 98.8, ppm_l10: 110, ppm_l5: 110.5, rank: 26 },
    { team: "New Orleans Pelicans", pace: 99.1, ortg: 110.4, drtg: 119.9, net_rtg: -9.5, ppm: 109.8, ats_record: "19-28-0", ats_l10: "3-7-0", ats_l5: "1-4-0", over_record: 44, under_record: 46, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 0, ortg_l10: 111, ortg_l5: 111.5, pace_l10: 99.5, pace_l5: 99.8, ppm_l10: 110.5, ppm_l5: 111, rank: 27 },
    { team: "Charlotte Hornets", pace: 98.5, ortg: 105.1, drtg: 114.2, net_rtg: -9.1, ppm: 105.1, ats_record: "22-19-1", ats_l10: "5-5-0", ats_l5: "2-3-0", over_record: 27, under_record: 30, over_l10: 4, over_l5: 2, under_l10: 6, under_l5: 3, push_record: 1, ortg_l10: 105.5, ortg_l5: 106, pace_l10: 99, pace_l5: 99.2, ppm_l10: 105.5, ppm_l5: 106, rank: 28 },
    { team: "Washington Wizards", pace: 100.9, ortg: 108, drtg: 120.4, net_rtg: -12.4, ppm: 108, ats_record: "35-47-0", ats_l10: "4-6-0", ats_l5: "2-3-0", over_record: 40, under_record: 34, over_l10: 5, over_l5: 2, under_l10: 5, under_l5: 3, push_record: 0, ortg_l10: 108.5, ortg_l5: 109, pace_l10: 101.5, pace_l5: 101.8, ppm_l10: 108.5, ppm_l5: 109, rank: 29 },
    { team: "Utah Jazz", pace: 98.5, ortg: 108, drtg: 118, net_rtg: -10, ppm: 108, ats_record: "23-22-0", ats_l10: "4-6-0", ats_l5: "2-3-0", over_record: 28, under_record: 35, over_l10: 4, over_l5: 2, under_l10: 6, under_l5: 3, push_record: 0, ortg_l10: 108.5, ortg_l5: 109, pace_l10: 99, pace_l5: 99.2, ppm_l10: 108.5, ppm_l5: 109, rank: 30 }
];

async function seedTempoData() {
    console.log('🏀 Seeding NBA Team Tempo Data...');

    const records = TEMPO_DATA.map(t => ({
        ...t,
        league_id: 'nba',
        updated_at: new Date().toISOString()
    }));

    const { error } = await supabase.from('team_tempo').upsert(records, {
        onConflict: 'team,league_id'
    });

    if (error) {
        console.error('❌ Error seeding tempo data:', error.message);
    } else {
        console.log(`✅ Seeded ${records.length} teams with tempo data`);
    }
}

seedTempoData();
