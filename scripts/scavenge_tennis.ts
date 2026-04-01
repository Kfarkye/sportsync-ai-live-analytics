
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env vars manually
try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf-8');
        envConfig.split('\n').forEach(line => {
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                const val = values.join('=').trim().replace(/^['\"]|['\"]$/g, '');
                if (!process.env[key.trim()]) process.env[key.trim()] = val;
            }
        });
    }
} catch (e) {
    console.error("Error loading .env manually", e);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(url, key);

async function scavenge() {
    console.log("--- Starting Tennis Score & Grading Scavenger ---");

    const { data: picks } = await supabase.from('pregame_intel')
        .select('*')
        .eq('sport', 'tennis')
        .eq('pick_result', 'PENDING');

    if (!picks?.length) {
        console.log("No pending tennis picks.");
        return;
    }

    const dates = [...new Set(picks.map(p => p.generated_at.split('T')[0]))];

    for (const dateStr of dates) {
        console.log(`\n--- Date: ${dateStr} ---`);
        const yyyymmdd = dateStr.replace(/-/g, '');
        const urls = [
            `https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=${yyyymmdd}`,
            `https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard?dates=${yyyymmdd}`
        ];

        let allEvents: any[] = [];
        for (const url of urls) {
            try {
                const resp = await fetch(url);
                const data = await resp.json();
                if (data.events) allEvents.push(...data.events);
            } catch (e) { }
        }

        const datePicks = picks.filter(p => p.generated_at.split('T')[0] === dateStr);
        for (const pick of datePicks) {
            const h = pick.home_team.toLowerCase();
            const a = pick.away_team.toLowerCase();

            const event = allEvents.find(e => {
                const comp = e.competitions?.[0];
                if (!comp) return false;
                const eH = (comp.competitors?.find((c: any) => c.homeAway === 'home')?.athlete?.displayName || "").toLowerCase();
                const eA = (comp.competitors?.find((c: any) => c.homeAway === 'away')?.athlete?.displayName || "").toLowerCase();
                return (h.includes(eH) || eH.includes(h)) && (a.includes(eA) || eA.includes(a));
            });

            if (event && (event.status?.type?.state === 'post' || event.status?.type?.state === 'final')) {
                const comp = event.competitions[0];
                const homeComp = comp.competitors.find((c: any) => c.homeAway === 'home');
                const awayComp = comp.competitors.find((c: any) => c.homeAway === 'away');

                const homeSets = parseInt(homeComp.score);
                const awaySets = parseInt(awayComp.score);
                const homeGames = homeComp.linescores?.reduce((acc: number, ls: any) => acc + (parseInt(ls.value) || 0), 0) || 0;
                const awayGames = awayComp.linescores?.reduce((acc: number, ls: any) => acc + (parseInt(ls.value) || 0), 0) || 0;

                console.log(`\nGrading: ${pick.home_team} vs ${pick.away_team}`);
                console.log(`Scores: Sets ${homeSets}-${awaySets}, Games ${homeGames}-${awayGames}`);
                console.log(`Pick: ${pick.recommended_pick}`);

                // Simple Grading Logic
                let outcome = 'PENDING';
                let reason = '';
                const meta = pick.grading_metadata || {};
                const isGames = pick.recommended_pick.toLowerCase().includes('games');

                let resultHome = isGames ? homeGames : homeSets;
                let resultAway = isGames ? awayGames : awaySets;

                if (meta.type === 'SPREAD') {
                    const match = pick.recommended_pick.match(/([+-]?\d+\.?\d*)/);
                    const line = pick.analyzed_spread ?? (match ? parseFloat(match[0]) : null);

                    if (line !== null) {
                        let pickedMargin, effectiveLine;
                        if (meta.side === 'HOME') {
                            pickedMargin = resultHome - resultAway;
                            effectiveLine = line;
                        } else {
                            pickedMargin = resultAway - resultHome;
                            effectiveLine = -line;
                        }
                        const cover = pickedMargin + effectiveLine;
                        outcome = cover > 0 ? 'WIN' : (cover < 0 ? 'LOSS' : 'PUSH');
                        reason = `${outcome} (Cover ${cover})`;
                    }
                } else if (meta.type === 'TOTAL' || pick.recommended_pick.includes('Over') || pick.recommended_pick.includes('Under')) {
                    const match = pick.recommended_pick.match(/(\d+\.?\d*)/);
                    const line = pick.analyzed_total ?? (match ? parseFloat(match[0]) : null);
                    if (line !== null) {
                        const total = resultHome + resultAway;
                        const isOver = pick.recommended_pick.includes('Over');
                        if (isOver) {
                            outcome = total > line ? 'WIN' : (total < line ? 'LOSS' : 'PUSH');
                        } else {
                            outcome = total < line ? 'WIN' : (total > line ? 'LOSS' : 'PUSH');
                        }
                        reason = `${outcome} (Total ${total} vs ${line})`;
                    }
                } else {
                    // Moneyline / PK
                    const winner = resultHome > resultAway ? 'HOME' : (resultAway > resultHome ? 'AWAY' : 'DRAW');
                    outcome = meta.side === winner ? 'WIN' : 'LOSS';
                    reason = `${outcome} (${winner} won)`;
                }

                if (outcome !== 'PENDING') {
                    console.log(`>> RESULT: ${outcome} - ${reason}`);
                    await supabase.from('pregame_intel').update({
                        pick_result: outcome,
                        graded_at: new Date().toISOString(),
                        actual_home_score: homeSets,
                        actual_away_score: awaySets
                    }).eq('intel_id', pick.intel_id);
                }
            }
        }
    }
}

scavenge();
