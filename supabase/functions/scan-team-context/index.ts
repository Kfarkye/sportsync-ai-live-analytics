// scan-team-context/index.ts
// FAST VERSION: Uses existing injury_snapshots + schedule data instead of Gemini
// No Gemini call = no timeout risk

declare const Deno: any;

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Injury impact weights by status
const INJURY_WEIGHTS: Record<string, number> = {
    'OUT': 2.5,
    'DOUBTFUL': 2.0,
    'QUESTIONABLE': 1.0,
    'PROBABLE': 0.3,
    'DAY-TO-DAY': 1.5
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const requestId = crypto.randomUUID().slice(0, 8);
    console.log(`[${requestId}] 🔄 [CONTEXT-SCAN-START] Starting team context scan (FAST mode)...`);

    try {
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

        // 1. Get today's NBA games
        const { data: matches, error: matchErr } = await supabase
            .from('matches')
            .select('id, home_team, away_team, start_time')
            .eq('league_id', 'nba')
            .gte('start_time', `${today}T00:00:00Z`)
            .lte('start_time', `${tomorrow}T23:59:59Z`);

        if (matchErr || !matches?.length) {
            console.log(`[${requestId}] ⚠️ No NBA games found for ${today}`);
            return new Response(JSON.stringify({ status: "no_games", date: today }), { headers: CORS_HEADERS });
        }

        const teams = [...new Set(matches.flatMap((m: any) => [m.home_team, m.away_team]))];
        console.log(`[${requestId}] 🏀 Found ${teams.length} teams across ${matches.length} games`);

        // 2. Get injury data from injury_snapshots table (populated by scan-injuries)
        const { data: injuries } = await supabase
            .from('injury_snapshots')
            .select('team, player_name, status')
            .eq('sport', 'NBA')
            .gte('report_date', yesterday);

        console.log(`[${requestId}] 🩹 Found ${injuries?.length || 0} recent injuries from injury_snapshots`);

        // 2B. Get injured players from team_rosters (enriched with position data)
        const { data: rosterInjuries } = await supabase
            .from('team_rosters')
            .select('team, player_name, position, status, injury_report')
            .eq('sport', 'NBA')
            .neq('status', 'Active')
            .neq('status', 'Bench');

        console.log(`[${requestId}] 📋 Found ${rosterInjuries?.length || 0} players with non-active status from team_rosters`);

        // 3. Get recent games for advanced fatigue detection (look back 6 days)
        const { data: recentGames } = await supabase
            .from('matches')
            .select('home_team, away_team, start_time')
            .eq('league_id', 'nba')
            .gte('start_time', `${new Date(Date.now() - 6 * 86400000).toISOString()}`)
            .lt('start_time', `${today}T00:00:00Z`)
            .order('start_time', { ascending: false });

        // 4. Get historical picks for ATS calculation
        const { data: recentPicks } = await supabase
            .from('pregame_intel')
            .select('home_team, away_team, pick_result')
            .neq('pick_result', 'PENDING')
            .order('generated_at', { ascending: false })
            .limit(500);

        const datesToSeed = [today, tomorrow];
        let upsertCount = 0;

        for (const date of datesToSeed) {
            console.log(`[${requestId}] 📅 Seeding for ${date}...`);

            for (const team of teams as string[]) {
                // Calculate injury impact from injury_snapshots
                const teamInjuries = (injuries || []).filter((i: any) =>
                    i.team?.toLowerCase().includes(team.toLowerCase()) ||
                    team.toLowerCase().includes(i.team?.toLowerCase() || '')
                );

                // Also get from team_rosters for complete picture
                const teamRosterInjuries = (rosterInjuries || []).filter((r: any) =>
                    r.team?.toLowerCase().includes(team.toLowerCase()) ||
                    team.toLowerCase().includes(r.team?.toLowerCase() || '')
                );

                let injuryImpact = 0;
                const injuryNotes: string[] = [];
                const seenPlayers = new Set<string>();

                // First, process injury_snapshots (more recent/authoritative)
                for (const inj of teamInjuries) {
                    const status = (inj.status || '').toUpperCase();
                    const weight = INJURY_WEIGHTS[status] || 1.0;
                    injuryImpact += weight;
                    injuryNotes.push(`${inj.player_name} (${inj.status})`);
                    seenPlayers.add(inj.player_name.toLowerCase());
                }

                // Then, add roster injuries not already seen (with position for context)
                for (const ros of teamRosterInjuries) {
                    if (!seenPlayers.has(ros.player_name.toLowerCase())) {
                        const status = (ros.status || '').toUpperCase();
                        const weight = INJURY_WEIGHTS[status] || 1.0;
                        injuryImpact += weight;
                        const posLabel = ros.position ? ` [${ros.position}]` : '';
                        const note = ros.injury_report ? `: ${ros.injury_report}` : '';
                        injuryNotes.push(`${ros.player_name}${posLabel} (${ros.status}${note})`);
                    }
                }
                injuryImpact = Math.min(injuryImpact, 10); // Cap at 10

                // --- FATIGUE LOGIC (Advanced) ---
                const teamRecentGames = (recentGames || []).filter((g: any) =>
                    g.home_team === team || g.away_team === team
                );

                // For 'tomorrow', yesterday is 'today'
                const checkYesterday = date === today ? yesterday : today;
                const yesterdayGame = teamRecentGames.find((g: any) => g.start_time.split('T')[0] === checkYesterday);

                // Fatigue check
                const compareDate = new Date(date).getTime();
                const gamesInLast4 = teamRecentGames.filter((g: any) =>
                    new Date(g.start_time).getTime() > (compareDate - 4 * 24 * 60 * 60 * 1000)
                ).length;
                const gamesInLast5 = teamRecentGames.filter((g: any) =>
                    new Date(g.start_time).getTime() > (compareDate - 5 * 24 * 60 * 60 * 1000)
                ).length;

                let situation = 'Normal';
                let restDays = 2;

                if (yesterdayGame) {
                    situation = 'B2B';
                    restDays = 0;
                } else if (gamesInLast4 >= 3) {
                    situation = '3in4';
                    restDays = 1;
                } else if (gamesInLast5 >= 4) {
                    situation = '4in5';
                    restDays = 1;
                } else if (teamRecentGames.length === 0) {
                    restDays = 3;
                } else {
                    const lastGame = new Date(teamRecentGames[0].start_time);
                    restDays = Math.floor((new Date(date).getTime() - lastGame.getTime()) / (1000 * 60 * 60 * 24));
                }

                // --- ATS LOGIC ---
                const teamPicks = (recentPicks || []).filter((p: any) =>
                    p.home_team === team || p.away_team === team
                ).slice(0, 10);

                const wins = teamPicks.filter((p: any) => p.pick_result === 'WIN').length;
                const atsLast10 = teamPicks.length > 0 ? wins / teamPicks.length : 0.50;

                // Check for existing fatigue data (preserve user-seeded values)
                const { data: existing } = await supabase
                    .from('team_game_context')
                    .select('fatigue_score, source')
                    .eq('team', team)
                    .eq('game_date', date)
                    .eq('league_id', 'nba')
                    .single();

                // Preserve user-seeded fatigue_score if it exists and source is from user JSON
                const preserveFatigue = existing?.fatigue_score && existing?.source === 'user_master_json';
                const fatigueScore = preserveFatigue ? existing.fatigue_score : null;

                // Upsert (preserve fatigue_score from user seed)
                const upsertPayload: any = {
                    team,
                    league_id: 'nba',
                    game_date: date,
                    injury_impact: parseFloat(injuryImpact.toFixed(2)),
                    injury_notes: injuryNotes.length > 0 ? injuryNotes.join(', ') : "No major injuries reported",
                    situation,
                    rest_days: restDays,
                    ats_last_10: parseFloat(atsLast10.toFixed(2)),
                    updated_at: new Date().toISOString(),
                    source: preserveFatigue ? 'user_master_json' : 'computed'
                };

                // Only include fatigue_score if we have user-seeded data
                if (fatigueScore !== null) {
                    upsertPayload.fatigue_score = fatigueScore;
                }

                const { error: upsertErr } = await supabase.from('team_game_context').upsert(
                    upsertPayload,
                    { onConflict: 'team,game_date,league_id' }
                );

                if (!upsertErr) {
                    upsertCount++;
                }
            }
        }

        console.log(`[${requestId}] 🎉 [CONTEXT-SCAN-SUCCESS] Upserted ${upsertCount} records across ${datesToSeed.length} dates`);

        return new Response(JSON.stringify({
            status: "success",
            dates: datesToSeed,
            records_processed: upsertCount,
            mode: "FAST"
        }), { headers: CORS_HEADERS });

    } catch (err: any) {
        console.error(`[${requestId}] ❌ [CONTEXT-SCAN-FAIL]`, err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
});
