
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Manual Env Load
try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf-8');
        envConfig.split('\n').forEach(line => {
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                const val = values.join('=').trim().replace(/^["']|["']$/g, '');
                if (!process.env[key.trim()]) process.env[key.trim()] = val;
            }
        });
    }
} catch (e) { console.error("Error loading .env", e); }

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("Missing Credentials"); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false } });

const LOOKBACK_DAYS = 14;
const ONE_DAY = 24 * 60 * 60 * 1000;

async function main() {
    console.log(`Analyzing last ${LOOKBACK_DAYS} days of picks (Normalized)...`);
    const today = new Date();
    const startDate = new Date(today.getTime() - (LOOKBACK_DAYS * ONE_DAY)).toISOString().split('T')[0];

    // 1. Fetch Completed Matches 
    const { data: matches, error: matchError } = await supabase.from('matches')
        .select(`id, league_id, sport, home_team, away_team, home_score, away_score, status, start_time`)
        .gte('start_time', startDate)
        .in('status', ['STATUS_FINAL', 'FINISHED', 'FINAL'])
        .not('home_score', 'is', null);

    if (matchError) { console.error(matchError); return; }
    const matchMap = new Map();
    matches?.forEach(m => matchMap.set(m.id, m));

    // 2. Fetch Intel
    const matchIds = Array.from(matchMap.keys());
    if (matchIds.length === 0) { console.log("No completed matches found."); return; }
    const { data: intelRows, error: intelError } = await supabase.from('pregame_intel')
        .select('match_id, recommended_pick, confidence_score')
        .in('match_id', matchIds);

    if (intelError) { console.error(intelError); return; }

    const stats: Record<string, { wins: number, losses: number, pushes: number, total: number }> = {};
    const initStat = () => ({ wins: 0, losses: 0, pushes: 0, total: 0 });

    for (const intel of intelRows || []) {
        const m = matchMap.get(intel.match_id);
        if (!m) continue;
        const pickText = intel.recommended_pick;
        if (!pickText) continue;

        let result = gradeNaive(pickText, m);
        if (result !== "UNKNOWN") {
            const rawSport = (m.sport || "unknown").toLowerCase();
            const rawLeague = (m.league_id || "unknown").toLowerCase();

            let sport = rawSport;
            if (sport === "football" || sport === "nfl") sport = "nfl";
            if (sport === "basketball" || sport === "nba" || sport === "college-basketball" || sport === "ncaab") sport = "basketball";
            if (sport === "soccer" || rawLeague.includes('.')) sport = "soccer";

            if (!stats[sport]) stats[sport] = initStat();
            updateStat(stats[sport], result);

            if (rawLeague !== sport && rawLeague.toLowerCase() !== sport) {
                const leagueKey = rawLeague.toLowerCase();
                if (leagueKey !== sport) {
                    if (!stats[leagueKey]) stats[leagueKey] = initStat();
                    updateStat(stats[leagueKey], result);
                }
            }
        }
    }

    console.log(`\n=== TREND ANALYSIS (Unified) ===\n`);
    const sortedKeys = Object.keys(stats).filter(k => stats[k].total >= 3).sort((a, b) => stats[b].total - stats[a].total);
    console.log(`CATEGORY                | REC (W-L-P) | WIN % | ADVICE`);
    console.log(`----------------------------------------------------------`);
    for (const key of sortedKeys) {
        const s = stats[key];
        const pct = (s.wins / (s.wins + s.losses)) * 100;
        let advice = "NEUTRAL";
        if (pct >= 60) advice = "🔥 TAIL";
        if (pct <= 40) advice = "🧊 FADE";
        console.log(`${key.padEnd(24)}| ${s.wins}-${s.losses}-${s.pushes}       | ${pct.toFixed(0)}%    | ${advice}`);
    }
}

function gradeNaive(pick: string, m: any): string {
    const h = m.home_score;
    const a = m.away_score;
    const isHome = matchTeamName(pick, m.home_team);
    const isAway = matchTeamName(pick, m.away_team);

    // Spread
    const spreadMatch = pick.match(/([-+]?[\d\.]+)\s*$/) || pick.match(/([-+]?[\d\.]+)/);
    if (spreadMatch && (isHome || isAway)) {
        const line = parseFloat(spreadMatch[1]);
        const margin = isHome ? (h - a) : (a - h);
        if (margin + line > 0) return "WIN";
        if (margin + line < 0) return "LOSS";
        return "PUSH";
    }
    // Over/Under
    const isOver = /Over/i.test(pick);
    const isUnder = /Under/i.test(pick);
    const lineMatch = pick.match(/(\d+\.?\d*)/);
    if ((isOver || isUnder) && lineMatch) {
        const line = parseFloat(lineMatch[1]);
        const total = h + a;
        if (isOver) return total > line ? "WIN" : (total < line ? "LOSS" : "PUSH");
        if (isUnder) return total < line ? "WIN" : (total > line ? "LOSS" : "PUSH");
    }
    // Moneyline
    if (isHome) return h > a ? "WIN" : "LOSS";
    if (isAway) return a > h ? "WIN" : "LOSS";
    return "UNKNOWN";
}

function updateStat(stat: any, result: string) {
    if (result === "WIN") stat.wins++;
    else if (result === "LOSS") stat.losses++;
    else if (result === "PUSH") stat.pushes++;
    stat.total++;
}

function matchTeamName(pick: string, team: any): boolean {
    const name = (typeof team === 'string' ? team : (team?.name || team?.displayName || "")).toLowerCase();
    if (!name) return false;
    const p = pick.toLowerCase();
    const parts = name.split(' ').filter(w => w.length > 3);
    return parts.some(part => p.includes(part)) || p.includes(name);
}

main();
