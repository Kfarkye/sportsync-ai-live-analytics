// scripts/map_season_fatigue.ts
// Purpose: Scans the matches table and pre-calculates fatigue for every team-game.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function mapSeasonFatigue() {
    console.log("🏀 Starting Season Fatigue Mapping...");

    // 1. Fetch all matches
    const { data: matches, error } = await supabase
        .from('matches')
        .select('id, home_team, away_team, start_time, league_id')
        .order('start_time', { ascending: true });

    if (error || !matches) {
        console.error("Error fetching matches:", error);
        return;
    }

    console.log(`📊 Found ${matches.length} matches. Processing...`);

    const teams = [...new Set(matches.flatMap(m => [m.home_team, m.away_team]))];
    const fatigueRecords: any[] = [];

    for (const team of teams) {
        const teamGames = matches.filter(m => m.home_team === team || m.away_team === team);

        for (let i = 0; i < teamGames.length; i++) {
            const currentGame = teamGames[i];
            const gameDate = currentGame.start_time.split('T')[0];
            const isHome = currentGame.home_team === team;
            const opponent = isHome ? currentGame.away_team : currentGame.home_team;

            let situation = 'Normal';
            let restDays = 3; // Default to fresh

            if (i > 0) {
                const prevGame = teamGames[i - 1];
                const diffTime = new Date(currentGame.start_time).getTime() - new Date(prevGame.start_time).getTime();
                restDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                if (restDays === 1) situation = 'B2B';

                // Check 3in4
                if (i >= 2) {
                    const twoGamesAgo = teamGames[i - 2];
                    const diff3 = new Date(currentGame.start_time).getTime() - new Date(twoGamesAgo.start_time).getTime();
                    const days3 = Math.floor(diff3 / (1000 * 60 * 60 * 24));
                    if (days3 <= 4) situation = '3in4';
                }

                // Check 4in5
                if (i >= 3) {
                    const threeGamesAgo = teamGames[i - 3];
                    const diff4 = new Date(currentGame.start_time).getTime() - new Date(threeGamesAgo.start_time).getTime();
                    const days4 = Math.floor(diff4 / (1000 * 60 * 60 * 24));
                    if (days4 <= 5) situation = '4in5';
                }
            }

            fatigueRecords.push({
                team,
                league_id: currentGame.league_id,
                game_date: gameDate,
                situation,
                rest_days: restDays,
                is_home: isHome,
                opponent
            });
        }
    }

    console.log(`💾 Upserting ${fatigueRecords.length} fatigue profiles...`);

    // Batch upsert in chunks of 500
    for (let i = 0; i < fatigueRecords.length; i += 500) {
        const chunk = fatigueRecords.slice(i, i + 500);
        const { error: upsertErr } = await supabase.from('team_season_fatigue').upsert(chunk);
        if (upsertErr) {
            console.error("Upsert error:", upsertErr);
        } else {
            console.log(`✅ Upserted chunk ${i / 500 + 1}`);
        }
    }

    console.log("🎉 Season Fatigue Mapping Complete!");
}

mapSeasonFatigue();
