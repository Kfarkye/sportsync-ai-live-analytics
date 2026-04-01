
// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

import { createClient } from '@supabase/supabase-js';
import { EspnAdapters, Safe } from '../supabase/functions/_shared/espnAdapters.ts';
import { getCanonicalMatchId, LEAGUE_SUFFIX_MAP, resolveCanonicalMatch, resolveCanonicalVenue, resolveCanonicalOfficial } from '../supabase/functions/_shared/match-registry.ts';
import { computeAISignals } from '../supabase/functions/_shared/gameStateEngine.ts';
import { Sport } from '../supabase/functions/_shared/types.ts';
import fs from 'fs';

// --- ENV SETUP ---
const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    db: { schema: 'public' }
});

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';
const MONITOR_LEAGUES = [
    { id: 'nfl', sport_type: Sport.NFL, endpoint: 'football/nfl' },
    { id: 'college-football', sport_type: Sport.COLLEGE_FOOTBALL, endpoint: 'football/college-football' },
    { id: 'nba', sport_type: Sport.NBA, endpoint: 'basketball/nba' },
    { id: 'mens-college-basketball', sport_type: Sport.COLLEGE_BASKETBALL, endpoint: 'basketball/mens-college-basketball' },
    { id: 'mlb', sport_type: Sport.BASEBALL, endpoint: 'baseball/mlb' },
    { id: 'nhl', sport_type: Sport.HOCKEY, endpoint: 'hockey/nhl' },
    { id: 'wnba', sport_type: Sport.WNBA, endpoint: 'basketball/wnba' },
    { id: 'eng.1', sport_type: Sport.SOCCER, endpoint: 'soccer/eng.1' },
    { id: 'esp.1', sport_type: Sport.SOCCER, endpoint: 'soccer/esp.1' },
    { id: 'usa.1', sport_type: Sport.SOCCER, endpoint: 'soccer/usa.1' },
    { id: 'ger.1', sport_type: Sport.SOCCER, endpoint: 'soccer/ger.1' },
    { id: 'ita.1', sport_type: Sport.SOCCER, endpoint: 'soccer/ita.1' },
    { id: 'fra.1', sport_type: Sport.SOCCER, endpoint: 'soccer/fra.1' },
    { id: 'uefa.champions', sport_type: Sport.SOCCER, endpoint: 'soccer/uefa.champions' },
    { id: 'uefa.europa', sport_type: Sport.SOCCER, endpoint: 'soccer/uefa.europa' },
    { id: 'caf.nations', sport_type: Sport.SOCCER, endpoint: 'soccer/caf.nations' }
];

const REVERSE_LEAGUE_MAP: Record<string, string> = Object.entries(LEAGUE_SUFFIX_MAP).reduce((acc, [k, v]) => ({
    ...acc,
    [v.replace('_', '')]: k
}), {});

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
    let attempt = 0;
    while (attempt < retries) {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
                return res;
            }
            return res;
        } catch (err: any) {
            attempt++;
            if (attempt === retries) throw err;
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    throw new Error('Unreachable');
}

async function processLiveGame(event: any, league: any) {
    const matchId = event.id;
    const dbMatchId = getCanonicalMatchId(matchId, league.id);
    console.log(`[Processing] ${dbMatchId} (${league.id})`);
    const summaryUrl = `${ESPN_BASE_URL}/${league.endpoint}/summary?event=${matchId}&_t=${Date.now()}`;

    try {
        const res = await fetchWithRetry(summaryUrl);
        const data = await res.json();

        const header = data.header || {};
        const competition = header.competitions?.[0];
        if (!competition) return;

        const homeComp = competition.competitors.find((c: any) => c.homeAway === 'home');
        const awayComp = competition.competitors.find((c: any) => c.homeAway === 'away');
        const pickcenter = data.pickcenter;

        // --- Odds Logic ---
        const currentOdds = EspnAdapters.Odds(competition, pickcenter);
        let openingOdds = data.header?.competitions?.[0]?.odds?.[1] || data.header?.competitions?.[0]?.odds?.[0] || {};

        if ((!openingOdds.overUnder && !openingOdds.spread) && (currentOdds.overUnder || currentOdds.spread)) {
            openingOdds = currentOdds;
        }

        // --- Match Data Construction ---
        const boxscore = data.boxscore;

        const match: any = {
            id: dbMatchId,
            league_id: league.id,
            sport: league.sport_type,
            status: competition.status?.type?.name || 'LIVE',
            period: Safe.number(competition.status?.period),
            displayClock: Safe.string(competition.status?.displayClock),
            home_team: homeComp?.team?.displayName,
            away_team: awayComp?.team?.displayName,
            homeTeam: EspnAdapters.Team(homeComp, league.sport_type),
            awayTeam: EspnAdapters.Team(awayComp, league.sport_type),
            home_team_id: homeComp?.id,
            away_team_id: awayComp?.id,
            home_score: Safe.score(homeComp?.score),
            away_score: Safe.score(awayComp?.score),
            homeTeamStats: boxscore?.teams?.find((t: any) => t?.team?.id === homeComp?.id),
            awayTeamStats: boxscore?.teams?.find((t: any) => t?.team?.id === awayComp?.id),
            opening_odds: openingOdds,
            current_odds: currentOdds,
            situation: EspnAdapters.Situation(data),
            currentDrive: EspnAdapters.Drive(data),
            lastPlay: EspnAdapters.LastPlay(data),
            venue: { is_indoor: data.gameInfo?.venue?.indoor },
            notes: competition.notes?.[0]?.headline
        };

        // FIXED LOGIC: Use snake_case
        let homeScore = match.home_score;
        let awayScore = match.away_score;

        // --- DB Write: Matches ---
        const matchPayload = {
            id: dbMatchId,
            league_id: league.id,
            sport: league.sport_type,
            home_team_id: (match as any).home_team_id,
            away_team_id: (match as any).away_team_id,
            home_team: match.home_team,
            away_team: match.away_team,
            start_time: event.date,
            status: match.status,
            period: match.period,
            display_clock: match.displayClock,
            home_score: homeScore,
            away_score: awayScore,
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            leagueId: league.id,
            current_odds: match.current_odds,
            opening_odds: match.opening_odds,
            ingest_trace: ["Manual Fix Script"],
            last_updated: new Date().toISOString()
        };

        console.log(`[Upserting] ${dbMatchId} -> Status: ${match.status}, Score: ${awayScore}-${homeScore}`);
        const { error: matchError } = await supabase.from('matches').upsert(matchPayload);
        if (matchError) {
            console.error(`[Matches] Upsert FAILED for ${dbMatchId}:`, matchError.message);
        }
    } catch (err: any) {
        console.error(`Error processing match ${matchId}`, err);
    }
}

async function run() {
    console.log('--- MANUAL INGEST FIX ---');

    // 1. Get pending picks
    const startOfDay = '2026-01-13T00:00:00Z';
    const endOfDay = '2026-01-14T00:00:00Z';
    const { data: pending, error } = await supabase
        .from('pregame_intel')
        .select('match_id')
        .neq('match_id', 'CRON_SENTINEL')
        .eq('pick_result', 'PENDING')
        .gte('generated_at', startOfDay)
        .lt('generated_at', endOfDay);

    if (error || !pending) {
        console.error('No pending picks found or error:', error);
        return;
    }

    console.log(`Found ${pending.length} pending picks to process.`);
    const matchIds = pending.map(p => p.match_id);
    console.log('Match IDs:', matchIds);
    console.log('Reverse Map Keys:', Object.keys(REVERSE_LEAGUE_MAP));

    // 2. Fetch and Ingest
    for (const dbMatchId of matchIds) {
        console.log(`Looping: ${dbMatchId}`);
        // Extract suffix for league lookup
        const suffix = dbMatchId.includes('_') ? dbMatchId.split('_').pop() : null;
        console.log(`Suffix: ${suffix}`);

        if (!suffix || !REVERSE_LEAGUE_MAP[suffix]) {
            console.warn(`[Skip] Unknown league suffix for ${dbMatchId}`);
            continue;
        }


        const dbLeagueId = REVERSE_LEAGUE_MAP[suffix];
        console.log(`DB League ID: ${dbLeagueId}`);

        // Map DB league keys to ESPN keys used in MONITOR_LEAGUES
        const DB_TO_ESPN: Record<string, string> = {
            'basketball_ncaab': 'mens-college-basketball',
            'americanfootball_nfl': 'nfl',
            'basketball_nba': 'nba',
            'hockey_nhl': 'nhl',
            'icehockey_nhl': 'nhl'
        };

        const espnLeagueId = DB_TO_ESPN[dbLeagueId] || dbLeagueId;
        const league = MONITOR_LEAGUES.find(l => l.id === espnLeagueId);

        if (!league) {
            console.log(`League not found in MONITOR_LEAGUES (looked for ${espnLeagueId})`);
            continue;
        }

        const espnId = dbMatchId.split('_')[0]; // simple split assumption for manual script

        // Construct event object stub (minimal needed for processLiveGame)
        const event = { id: espnId, date: new Date().toISOString() }; // Date is approx, shouldn't matter for summary fetch

        console.log(`Processing event ${espnId}...`);
        await processLiveGame(event, league);
        console.log(`Done ${espnId}`);
    }
}

run();
