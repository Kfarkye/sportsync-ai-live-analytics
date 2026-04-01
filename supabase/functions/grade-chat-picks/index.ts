
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
};

interface ChatPick {
    id: string;
    match_id: string;
    home_team: string; // can be null
    away_team: string; // can be null
    league: string; // can be null
    pick_type: string;
    pick_side: string;
    pick_line: number | null;
    game_start_time: string | null;
}

const LEAGUE_MAP: Record<string, string> = {
    'nba': 'basketball/nba',
    'national basketball association': 'basketball/nba',
    'nhl': 'hockey/nhl',
    'national hockey league': 'hockey/nhl',
    'nfl': 'football/nfl',
    'national football league': 'football/nfl',
    'mlb': 'baseball/mlb',
    'major league baseball': 'baseball/mlb',
    'eng.1': 'soccer/eng.1',
    'premier league': 'soccer/eng.1',
    'esp.1': 'soccer/esp.1',
    'laliga': 'soccer/esp.1',
    'ita.1': 'soccer/ita.1',
    'serie a': 'soccer/ita.1',
    'ger.1': 'soccer/ger.1',
    'bundesliga': 'soccer/ger.1',
    'fra.1': 'soccer/fra.1',
    'ligue 1': 'soccer/fra.1',
    'uefa.champions': 'soccer/uefa.champions',
    'uefa champions league': 'soccer/uefa.champions',
    'uefa.europa': 'soccer/uefa.europa',
    'uefa europa league': 'soccer/uefa.europa',
    'uefa.conference': 'soccer/uefa.conference',
    'mls': 'soccer/usa.1'
};

function normalizeName(name: string): string {
    if (!name) return "";
    return name.toLowerCase()
        .replace(/\blive\b/g, '') // Remove whole word "live"
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
}

async function fetchGameResult(pick: ChatPick): Promise<{ winner: string, homeScore: number, awayScore: number, status: string, homeTeam: string, awayTeam: string } | null> {
    // Determine endpoint
    let sportLeague = 'basketball/nba'; // default
    if (pick.league) {
        const l = pick.league.toLowerCase().trim();
        if (LEAGUE_MAP[l]) sportLeague = LEAGUE_MAP[l];
        else if (l.includes('soccer') || l.includes('uefa')) sportLeague = `soccer/${l.replace(/[^a-z0-9.]/g, '')}`;
        else if (l.includes('basket')) sportLeague = 'basketball/nba';
        else if (l.includes('hockey')) sportLeague = 'hockey/nhl';
        else if (l.includes('football')) sportLeague = 'football/nfl';
    } else {
        // Try to infer from team name if league is null - crude fallback
        const teams = (pick.home_team || "") + " " + (pick.away_team || "") + " " + (pick.pick_side || "");
        if (teams.toLowerCase().includes('lightning')) sportLeague = 'hockey/nhl';
    }

    // Try parsing match_id for numeric ID
    // Formats: "401810480", "736985_ita.1", "nba_ind_bos..."
    let eventId = "";
    if (pick.match_id) {
        const match = pick.match_id.match(/^(\d+)/);
        if (match) eventId = match[1];
    }

    // Strategy 1: Direct Event API if we have an ID
    if (eventId) {
        console.log(`[${pick.id}] Fetching via Event ID: ${eventId} (${sportLeague})`);
        try {
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportLeague}/summary?event=${eventId}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                const header = data.header;
                // Check if final
                const completed = header.competitions[0].status.type.completed;
                if (completed) {
                    const compet = header.competitions[0];
                    const home = compet.competitors.find((c: any) => c.homeAway === 'home');
                    const away = compet.competitors.find((c: any) => c.homeAway === 'away');

                    // Winner detection
                    let winner = "";
                    if (parseInt(home.score) > parseInt(away.score)) winner = home.team.displayName;
                    else if (parseInt(away.score) > parseInt(home.score)) winner = away.team.displayName;
                    else winner = "DRAW"; // Soccer

                    return {
                        winner,
                        homeScore: parseInt(home.score),
                        awayScore: parseInt(away.score),
                        status: 'FINAL',
                        homeTeam: home.team.displayName,
                        awayTeam: away.team.displayName
                    };
                }
            }
        } catch (e) {
            console.error(`Error fetching summary for ${eventId}:`, e);
        }
    }

    // Strategy 2: Search by date/team if date is available
    // Need date. `nba_ind_bos_20260121` -> 20260121
    let dateStr = "";
    if (pick.game_start_time) {
        dateStr = pick.game_start_time.split('T')[0].replace(/-/g, '');
    } else if (pick.match_id) {
        const dateMatch = pick.match_id.match(/(\d{8})/);
        if (dateMatch) dateStr = dateMatch[1];
    }

    if (dateStr && (pick.home_team || pick.away_team)) {
        console.log(`[${pick.id}] Searching via Date/Team: ${dateStr} (${sportLeague})`);
        try {
            const url = `https://site.api.espn.com/apis/site/v2/sports/${sportLeague}/scoreboard?dates=${dateStr}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                const events = data.events || [];

                const targetHome = normalizeName(pick.home_team || "");
                const targetAway = normalizeName(pick.away_team || "");

                for (const evt of events) {
                    const competition = evt.competitions[0];
                    const home = competition.competitors.find((c: any) => c.homeAway === 'home');
                    const away = competition.competitors.find((c: any) => c.homeAway === 'away');

                    const evtHome = normalizeName(home.team.displayName);
                    const evtAway = normalizeName(away.team.displayName);

                    // Fuzzy match
                    const matchHome = targetHome && (evtHome.includes(targetHome) || targetHome.includes(evtHome));
                    const matchAway = targetAway && (evtAway.includes(targetAway) || targetAway.includes(evtAway));

                    if (matchHome || matchAway) {
                        if (competition.status.type.completed) {
                            let winner = "";
                            if (parseInt(home.score) > parseInt(away.score)) winner = home.team.displayName;
                            else if (parseInt(away.score) > parseInt(home.score)) winner = away.team.displayName;
                            else winner = "DRAW";

                            return {
                                winner,
                                homeScore: parseInt(home.score),
                                awayScore: parseInt(away.score),
                                status: 'FINAL',
                                homeTeam: home.team.displayName,
                                awayTeam: away.team.displayName
                            };
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`Error searches scoreboard:`, e);
        }
    }

    return null;
}

function determineGrade(pick: ChatPick, result: { winner: string, homeScore: number, awayScore: number, homeTeam: string, awayTeam: string }) {
    const type = pick.pick_type.toLowerCase();

    // NORMALIZE SIDE
    // Pick side might be "Milwaukee Bucks" or "UNDER" or "Magic Live"
    const side = pick.pick_side.toUpperCase();

    if (type === 'moneyline' || type === 'ml') {
        const homeNorm = normalizeName(result.homeTeam);
        const awayNorm = normalizeName(result.awayTeam);
        const pickNorm = normalizeName(pick.pick_side);
        const winnerNorm = normalizeName(result.winner);

        // Identify which team was picked
        let pickedTeam = "";
        if (pickNorm.includes(homeNorm) || homeNorm.includes(pickNorm)) pickedTeam = "HOME";
        else if (pickNorm.includes(awayNorm) || awayNorm.includes(pickNorm)) pickedTeam = "AWAY";

        if (!pickedTeam) return "PENDING_VERIFY_TEAM"; // Can't figure out who they picked

        if (pickedTeam === "HOME" && result.homeScore > result.awayScore) return "win";
        if (pickedTeam === "AWAY" && result.awayScore > result.homeScore) return "win";
        if (result.homeScore === result.awayScore) return "push"; // Draw in ML? 
        return "loss";
    }

    if (type === 'spread') {
        if (pick.pick_line === null) return "PENDING_NO_LINE";

        const homeNorm = normalizeName(result.homeTeam);
        const awayNorm = normalizeName(result.awayTeam);
        const pickNorm = normalizeName(pick.pick_side);

        let pickedTeam = "";
        if (pickNorm.includes(homeNorm) || homeNorm.includes(pickNorm)) pickedTeam = "HOME";
        else if (pickNorm.includes(awayNorm) || awayNorm.includes(pickNorm)) pickedTeam = "AWAY";

        if (!pickedTeam) return "PENDING_VERIFY_TEAM";

        // Formula: (PickScore - OppScore) + Line > 0 -> Win
        let diff = 0;
        if (pickedTeam === "HOME") {
            diff = result.homeScore - result.awayScore;
        } else {
            diff = result.awayScore - result.homeScore;
        }

        const margin = diff + pick.pick_line;
        if (margin > 0) return "win";
        if (margin < 0) return "loss";
        return "push";
    }

    if (type === 'total') {
        if (pick.pick_line === null) return "PENDING_NO_LINE";
        const totalScore = result.homeScore + result.awayScore;
        const line = pick.pick_line;

        if (side.includes('OVER')) {
            if (totalScore > line) return "win";
            if (totalScore < line) return "loss";
            return "push";
        }
        if (side.includes('UNDER')) {
            if (totalScore < line) return "win";
            if (totalScore > line) return "loss";
            return "push";
        }
    }

    return "PENDING_UNKNOWN_TYPE";
}


Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const updates: any[] = [];
    const trace: string[] = [];

    try {
        // Fetch pending picks
        const { data: pending, error } = await supabase
            .from('ai_chat_picks')
            .select('*')
            .or('result.is.null,result.eq.pending') // Fetch null or 'pending'
            .limit(50);

        if (error) throw error;
        trace.push(`Found ${pending.length} pending picks`);

        for (const pick of pending) {
            // Skip PASS picks
            if (pick.pick_side === 'PASS') {
                // Mark as void/push or keep null? Let's mark 'void'
                await supabase.from('ai_chat_picks').update({ result: 'void', graded_at: new Date().toISOString() }).eq('id', pick.id);
                trace.push(`Skipped/Voided PASS pick: ${pick.match_id}`);
                continue;
            }

            const gameResult = await fetchGameResult(pick);

            if (gameResult) {
                const grade = determineGrade(pick, gameResult);
                if (grade && grade !== 'PENDING_VERIFY_TEAM' && grade !== 'PENDING_UNKNOWN_TYPE' && grade !== 'PENDING_NO_LINE') {
                    updates.push({
                        id: pick.id,
                        result: grade,
                        graded_at: new Date().toISOString(),
                        match: `${gameResult.homeTeam} ${gameResult.homeScore} - ${gameResult.awayScore} ${gameResult.awayTeam}`
                    });
                    // Perform update directly
                    const { error: upErr } = await supabase
                        .from('ai_chat_picks')
                        .update({ result: grade, graded_at: new Date().toISOString() })
                        .eq('id', pick.id);

                    if (upErr) trace.push(`Error updating ${pick.id}: ${upErr.message}`);
                    else trace.push(`Graded ${pick.id} (${pick.match_id}): ${grade}`);

                } else {
                    trace.push(`Could not grade ${pick.id}: Reason ${grade}`);
                }
            } else {
                trace.push(`Could not find result for ${pick.match_id}`);
            }
        }

        return new Response(JSON.stringify({
            status: 'ok',
            processed: updates.length,
            trace
        }), { headers: CORS_HEADERS });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
});
