
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// Manual ENV loading to avoid dependencies
const envContent = fs.readFileSync('.env', 'utf8');
const processEnv: Record<string, string> = {};
envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) processEnv[key.trim()] = valueParts.join('=').trim();
});

const supabaseUrl = processEnv.VITE_SUPABASE_URL!;
const supabaseKey = processEnv.SUPABASE_SERVICE_ROLE_KEY!;
const oddsApiKey = processEnv.ODDS_API_KEY || processEnv.VITE_ODDS_API_KEY;

if (!supabaseUrl || !supabaseKey || !oddsApiKey) {
    console.error("Missing environment variables. Ensure VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ODDS_API_KEY are set.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Re-implementing getBaseId for the script
const getBaseId = (id: string): string => {
    if (!id) return '';
    return id.split('_')[0];
};

const LEAGUE_MAP: Record<string, string> = {
    'nba': 'basketball_nba',
    'nfl': 'americanfootball_nfl',
    'mlb': 'baseball_mlb',
    'nhl': 'icehockey_nhl',
    'college-football': 'americanfootball_ncaaf',
    'mens-college-basketball': 'basketball_ncaab',
};

const MARKET_TO_ENUM: Record<string, string> = {
    'player_points': 'points',
    'player_rebounds': 'rebounds',
    'player_assists': 'assists',
    'player_threes': 'threes_made',
    'player_points_rebounds_assists': 'pra',
    'player_pass_yds': 'passing_yards',
    'player_pass_tds': 'passing_tds',
    'player_rush_yds': 'rushing_yards',
    'player_receptions': 'receptions',
    'player_reception_yds': 'receiving_yards',
    'player_anytime_td': 'anytime_td',
    'player_pass_interceptions': 'interceptions',
    'pitcher_strikeouts': 'strikeouts',
    'batter_hits': 'hits',
    'batter_total_bases': 'total_bases',
    'player_goals': 'goals',
    'player_shots_on_goal': 'goals', // Corrected mapping for NHL
};

const PLAYER_PROP_MARKETS: Record<string, string> = {
    'americanfootball_nfl': 'player_pass_yds,player_pass_tds,player_rush_yds,player_receptions,player_reception_yds,player_anytime_td,player_pass_interceptions',
    'basketball_nba': 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists',
    'icehockey_nhl': 'player_points,player_goals,player_shots_on_goal',
};

async function runRepro() {
    // Check Cleveland Cavs vs 76ers
    const matchId = "401810427_nba";
    console.log(`Starting repro for match: ${matchId}`);

    const { data: match, error: matchError } = await supabase
        .from('matches')
        .select('id, odds_api_event_id, league_id, home_team, away_team, start_time')
        .eq('id', matchId)
        .single();

    if (matchError || !match) {
        console.error("Match not found or error:", matchError);
        return;
    }

    const homeTeam = typeof match.home_team === 'string' ? match.home_team : match.home_team?.name;
    const awayTeam = typeof match.away_team === 'string' ? match.away_team : match.away_team?.name;

    console.log(`Match info: ${awayTeam} @ ${homeTeam}`);
    console.log(`Odds API ID: ${match.odds_api_event_id}`);

    if (!match.odds_api_event_id) {
        console.error("No Odds API ID for this match.");
        return;
    }

    const sportKey = LEAGUE_MAP[match.league_id] || 'basketball_nba';
    const markets = PLAYER_PROP_MARKETS[sportKey];

    if (!markets) {
        console.error("No prop markets configured for league:", match.league_id);
        return;
    }

    // Athlete Map logic (robust for repro)
    const athleteMap = new Map();
    const sport = match.league_id === 'nba' ? 'basketball' : 'hockey';
    const league = match.league_id === 'nba' ? 'nba' : 'nhl';

    // Try Summary first
    let summaryData: any = null;
    const espnSummaryUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${getBaseId(match.id)}`;

    console.log(`Fetching ESPN summary for athletes: ${espnSummaryUrl}`);
    const summaryRes = await fetch(espnSummaryUrl);
    if (summaryRes.ok) {
        summaryData = await summaryRes.json();
        const liveMembers = [
            ...(summaryData?.boxscore?.players?.flatMap((p: any) => p.athletes) || []),
            ...(summaryData?.leaders?.flatMap((l: any) => l.leaders?.map((ll: any) => ll.athlete)) || [])
        ].filter(Boolean);

        liveMembers.forEach((a: any) => {
            const norm = a.displayName?.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (norm) {
                athleteMap.set(norm, {
                    id: String(a.id),
                    headshot: a.headshot?.href,
                    team: null
                });
            }
        });
    }
    console.log(`Mapped ${athleteMap.size} athletes from summary.`);

    // If still empty (e.g. pre-game), try full roster
    if (athleteMap.size === 0) {
        const competitors = summaryData?.header?.competitions?.[0]?.competitors || [];

        console.log(`Summary athletes empty, fetching full rosters for ${competitors.length} competitors`);

        for (const comp of competitors) {
            const teamId = comp.id;
            if (!teamId) continue;
            const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/roster`;
            console.log(`Fetching roster for team ${teamId}: ${rosterUrl}`);
            const rRes = await fetch(rosterUrl);
            if (rRes.ok) {
                const rData: any = await rRes.json();
                const athletes = rData.athletes || rData.groups?.flatMap((g: any) => g.athletes) || [];
                athletes.forEach((a: any) => {
                    const norm = a.displayName?.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (norm) {
                        athleteMap.set(norm, {
                            id: String(a.id),
                            headshot: a.headshot?.href || `https://a.espncdn.com/combiner/i?img=/i/headshots/${league}/players/full/${a.id}.png&w=96&h=96`,
                            team: comp.team?.displayName
                        });
                    }
                });
            }
        }
        console.log(`Mapped ${athleteMap.size} athletes from rosters.`);
    }

    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${match.odds_api_event_id}/odds?apiKey=${oddsApiKey}&regions=us&markets=${markets}&oddsFormat=american&_t=${Date.now()}`;
    console.log(`Fetching Odds API: ${url.replace(oddsApiKey, 'REDACTED')}`);

    const res = await fetch(url);
    if (!res.ok) {
        console.error(`Odds API Error: ${res.status}`, await res.text());
        return;
    }

    const data: any = await res.json();
    const bookmakers = data.bookmakers || [];
    console.log(`API returned ${bookmakers.length} bookmakers.`);

    const preferred = ['draftkings', 'fanduel', 'bovada', 'betmgm', 'betrivers', 'caesars'];
    const book = bookmakers.sort((a: any, b: any) => {
        const ia = preferred.indexOf(a.key);
        const ib = preferred.indexOf(b.key);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })[0];

    if (!book) {
        console.error("No bookmakers found for props.");
        return;
    }

    console.log(`Selected bookmaker: ${book.title} (${book.key})`);

    const propUpserts: any[] = [];
    const eventDate = match.start_time.split('T')[0];

    for (const market of book.markets) {
        const betType = MARKET_TO_ENUM[market.key];
        if (!betType) continue;

        for (const outcome of market.outcomes) {
            const playerName = outcome.description || outcome.name;
            const side = (outcome.name === 'Over' || outcome.name === 'Under') ? outcome.name.toLowerCase() : 'yes';
            const normName = playerName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const athlete = athleteMap.get(normName);

            propUpserts.push({
                match_id: match.id,
                player_id: athlete?.id,
                player_name: playerName,
                headshot_url: athlete?.headshot,
                team: athlete?.team,
                bet_type: betType,
                market_label: `${market.key.replace(/_/g, ' ').toUpperCase()} ${outcome.point || ''}`,
                line_value: outcome.point || 1,
                odds_american: outcome.price,
                side: side,
                provider: book.key,
                sportsbook: book.title,
                event_date: eventDate,
                league: (match.league_id || '').toUpperCase(),
                last_updated: new Date().toISOString()
            });
        }
    }

    console.log(`Preparing to upsert ${propUpserts.length} props...`);
    if (propUpserts.length > 0) {
        const { error: upsertError } = await supabase
            .from('player_prop_bets')
            .upsert(propUpserts, {
                onConflict: 'match_id, player_name, bet_type, side, provider'
            });

        if (upsertError) {
            console.error("Upsert failed:", upsertError.message);
        } else {
            console.log(`Successfully upserted ${propUpserts.length} props.`);
        }
    }
}

runRepro();
