// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getBaseId } from "../_shared/match-registry.ts";

interface PropMatch {
    id: string;
    odds_api_event_id: string;
    league_id: string;
    home_team: string;
    away_team: string;
    start_time: string;
}

interface Outcome {
    name: string;
    description?: string;
    price: number;
    point?: number;
}

interface Market {
    key: string;
    outcomes: Outcome[];
}

interface Athlete {
    id: string | number;
    headshot: string;
    team?: string;
    displayName?: string;
}

interface HistoricalEvent {
    id: string;
    commence_time: string;
    home_team: string;
    away_team: string;
}

interface HistoricalEventsResponse {
    data?: HistoricalEvent[];
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CONFIG = {
    oddsApi: {
        baseUrl: 'https://api.the-odds-api.com/v4',
        timeout: 15000,
    }
}

// Map sport league IDs to The Odds API sport keys
const LEAGUE_MAP: Record<string, string> = {
    'nba': 'basketball_nba',
    'nfl': 'americanfootball_nfl',
    'mlb': 'baseball_mlb',
    'nhl': 'icehockey_nhl',
    'college-football': 'americanfootball_ncaaf',
    'mens-college-basketball': 'basketball_ncaab',
};

// Map The Odds API market keys to database prop_bet_type enum
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
    // MLB v1 markets: keep canonical market keys for league-aware grading.
    'pitcher_strikeouts': 'pitcher_strikeouts',
    'batter_hits': 'batter_hits',
    'batter_total_bases': 'batter_total_bases',
    'player_goals': 'goals',
    'player_shots_on_goal': 'shots_on_goal',
};

const PLAYER_PROP_MARKETS: Record<string, string> = {
    'americanfootball_nfl': 'player_pass_yds,player_pass_tds,player_rush_yds,player_receptions,player_reception_yds,player_anytime_td,player_pass_interceptions',
    'americanfootball_ncaaf': 'player_pass_yds,player_pass_tds,player_rush_yds,player_receptions,player_reception_yds,player_anytime_td',
    'basketball_nba': 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists',
    'basketball_ncaab': 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists',
    'baseball_mlb': 'batter_hits,batter_total_bases,pitcher_strikeouts',
    'icehockey_nhl': 'player_points,player_goals,player_shots_on_goal',
};

const DEFAULT_BOOK_PREFERENCE = ['draftkings', 'fanduel', 'bovada', 'betmgm', 'betrivers', 'caesars'];
const BOOK_PREFERENCE_BY_SPORT: Record<string, string[]> = {
    // Phase 1 lock: MLB priority draftkings > fanduel > bovada > betmgm.
    'baseball_mlb': ['draftkings', 'fanduel', 'bovada', 'betmgm'],
};

function normalizeLeagueFilter(raw: string | null): string[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
}

function parseDateParam(raw: string | null): string | null {
    if (!raw) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const parsed = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return raw;
}

function buildHistoricalSnapshotTime(startTimeIso: string): string {
    const startMs = Date.parse(startTimeIso);
    if (!Number.isFinite(startMs)) return new Date().toISOString();
    const snapshot = new Date(startMs - 2 * 60 * 1000);
    return snapshot.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function normalizeTeamToken(value: string): string {
    const raw = (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    const aliased = raw
        .replace(/\bla clippers\b/g, 'los angeles clippers')
        .replace(/\bl\.a\. clippers\b/g, 'los angeles clippers')
        .replace(/\bla lakers\b/g, 'los angeles lakers')
        .replace(/\bl\.a\. lakers\b/g, 'los angeles lakers')
        .replace(/\bphx\b/g, 'phoenix')
        .replace(/\bny\b/g, 'new york');

    return aliased
        .replace(/[^a-z0-9]/g, '');
}

const PLAYER_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

function normalizePlayerToken(value: string): string {
    return (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function splitPlayerTokens(value: string): string[] {
    const normalized = (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

    while (normalized.length > 1) {
        const tail = normalized[normalized.length - 1];
        if (!PLAYER_SUFFIXES.has(tail)) break;
        normalized.pop();
    }

    return normalized;
}

function buildInitialLastKey(value: string): string {
    const tokens = splitPlayerTokens(value);
    if (tokens.length === 0) return '';
    if (tokens.length === 1) return tokens[0];
    const firstInitial = tokens[0]?.[0] ?? '';
    const last = tokens[tokens.length - 1] ?? '';
    return `${firstInitial}${last}`;
}

function setAliasWithCollisionGuard(
    target: Map<string, Athlete>,
    collisions: Set<string>,
    key: string,
    athlete: Athlete,
) {
    if (!key || collisions.has(key)) return;
    const existing = target.get(key);
    if (existing && String(existing.id) !== String(athlete.id)) {
        target.delete(key);
        collisions.add(key);
        return;
    }
    target.set(key, athlete);
}

function indexAthlete(
    exactMap: Map<string, Athlete>,
    initialLastMap: Map<string, Athlete>,
    initialLastCollisions: Set<string>,
    athlete: Athlete,
    rawNames: Array<string | null | undefined>,
) {
    for (const rawName of rawNames) {
        const name = (rawName || '').trim();
        if (!name) continue;

        const exactKey = normalizePlayerToken(name);
        if (exactKey) exactMap.set(exactKey, athlete);

        const initialLastKey = buildInitialLastKey(name);
        setAliasWithCollisionGuard(initialLastMap, initialLastCollisions, initialLastKey, athlete);
    }
}

function resolveAthlete(
    playerName: string,
    exactMap: Map<string, Athlete>,
    initialLastMap: Map<string, Athlete>,
): Athlete | undefined {
    const exactKey = normalizePlayerToken(playerName);
    if (exactKey && exactMap.has(exactKey)) {
        return exactMap.get(exactKey);
    }

    const initialLastKey = buildInitialLastKey(playerName);
    if (initialLastKey && initialLastMap.has(initialLastKey)) {
        return initialLastMap.get(initialLastKey);
    }

    return undefined;
}

function buildDateTeamKey(date: string, homeTeam: string, awayTeam: string): string {
    return `${date}|${normalizeTeamToken(homeTeam)}|${normalizeTeamToken(awayTeam)}`;
}

function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function isSyntheticOddsEventId(value: string): boolean {
    return value.startsWith('espn_core_');
}

async function fetchHistoricalEventsForDate(
    oddsApiKey: string,
    sportKey: string,
    date: string,
): Promise<HistoricalEvent[]> {
    const dateParam = `${date}T12:00:00Z`;
    const url =
        `${CONFIG.oddsApi.baseUrl}/historical/sports/${sportKey}/events` +
        `?apiKey=${oddsApiKey}&date=${encodeURIComponent(dateParam)}`;

    const response = await fetch(url);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`historical events fetch failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as HistoricalEventsResponse;
    return payload.data ?? [];
}

function resolveBookPreference(sportKey: string): string[] {
    return BOOK_PREFERENCE_BY_SPORT[sportKey] ?? DEFAULT_BOOK_PREFERENCE;
}

function pickBookmaker(bookmakers: any[], sportKey: string): any | null {
    if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null;
    const preferred = resolveBookPreference(sportKey);
    return [...bookmakers].sort((a: any, b: any) => {
        const ia = preferred.indexOf(String(a?.key || '').toLowerCase());
        const ib = preferred.indexOf(String(b?.key || '').toLowerCase());
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })[0] ?? null;
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('ODDS_API_KEY');

    if (!oddsApiKey) {
        return new Response(JSON.stringify({ error: "Missing ODDS_API_KEY" }), { status: 500, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const logs: { event: string;[key: string]: any }[] = [];
    const requestUrl = new URL(req.url);
    const requestedLeagues = normalizeLeagueFilter(requestUrl.searchParams.get('league'));
    const startDate = parseDateParam(requestUrl.searchParams.get('start_date'));
    const endDate = parseDateParam(requestUrl.searchParams.get('end_date'));
    const useHistoricalWindow = Boolean(startDate && endDate);
    const historicalEventsCache = new Map<string, HistoricalEvent[]>();

    try {
        if ((startDate && !endDate) || (!startDate && endDate)) {
            return new Response(JSON.stringify({
                error: 'Both start_date and end_date are required when using historical mode (YYYY-MM-DD).'
            }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        if (startDate && endDate && startDate > endDate) {
            return new Response(JSON.stringify({
                error: 'start_date cannot be after end_date.'
            }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 1. Get matches that have an Odds API Event ID.
        // Default mode: rolling 12h back to 24h ahead.
        // Historical mode: explicit date range for outage recovery.
        let matchesQuery = supabase
            .from('matches')
            .select('id, odds_api_event_id, league_id, home_team, away_team, start_time');

        if (useHistoricalWindow && startDate && endDate) {
            const rangeStartIso = `${startDate}T00:00:00Z`;
            const rangeEndExclusive = new Date(`${endDate}T00:00:00Z`);
            rangeEndExclusive.setUTCDate(rangeEndExclusive.getUTCDate() + 1);
            matchesQuery = matchesQuery
                .gte('start_time', rangeStartIso)
                .lt('start_time', rangeEndExclusive.toISOString());
        } else {
            const now = new Date();
            const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
            const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            matchesQuery = matchesQuery
                .not('odds_api_event_id', 'is', null)
                .gte('start_time', twelveHoursAgo.toISOString())
                .lte('start_time', tomorrow.toISOString());
        }

        if (requestedLeagues.length === 1) {
            matchesQuery = matchesQuery.eq('league_id', requestedLeagues[0]);
        } else if (requestedLeagues.length > 1) {
            matchesQuery = matchesQuery.in('league_id', requestedLeagues);
        }

        const { data: matches, error: matchesError } = await matchesQuery;

        if (matchesError) throw matchesError;

        if (!matches || matches.length === 0) {
            return new Response(JSON.stringify({
                message: "No matches found for prop sync",
                leagues: requestedLeagues.length > 0 ? requestedLeagues : 'all',
                mode: useHistoricalWindow ? 'historical' : 'rolling',
                start_date: startDate,
                end_date: endDate,
                logs
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        logs.push({
            event: "matches_found",
            count: matches.length,
            leagues: requestedLeagues.length > 0 ? requestedLeagues : 'all',
            mode: useHistoricalWindow ? 'historical' : 'rolling',
            start_date: startDate,
            end_date: endDate,
        });

        // 2. Process each match
        for (const match of (matches as PropMatch[])) {
            const sportKey = LEAGUE_MAP[match.league_id];
            const markets = PLAYER_PROP_MARKETS[sportKey];
            const oddsEventId = String(match.odds_api_event_id ?? '').trim();
            const matchEventDate = match.start_time.split('T')[0];

            if (!markets) {
                logs.push({ event: "skipping_match", matchId: match.id, reason: "No prop markets configured for league" });
                continue;
            }
            if (!oddsEventId && !useHistoricalWindow) {
                logs.push({ event: "skipping_match", matchId: match.id, reason: "Missing odds_api_event_id" });
                continue;
            }

            try {
                // --- ARCHITECTURE UPGRADE: Resolve Athletes from ESPN ---
                // For pre-game matches, boxscore/leaders won't exist yet.
                // We need to fetch actual team rosters to get headshots.
                const athleteMap = new Map<string, Athlete>();
                const athleteInitialLastMap = new Map<string, Athlete>();
                const athleteInitialLastCollisions = new Set<string>();
                const sportPath = match.league_id === 'nfl' ? 'football/nfl' :
                    match.league_id === 'nba' ? 'basketball/nba' :
                        match.league_id === 'mlb' ? 'baseball/mlb' :
                        match.league_id === 'nhl' ? 'hockey/nhl' :
                            match.league_id === 'college-football' ? 'football/college-football' :
                                match.league_id === 'mens-college-basketball' ? 'basketball/mens-college-basketball' :
                                    `${match.league_id}`;

                // Step 1: Try to get team IDs from event summary
                const espnSummaryUrl = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${getBaseId(match.id)}`;
                const summaryRes = await fetch(espnSummaryUrl);

                if (summaryRes.ok) {
                    const summaryData = await summaryRes.json();

                    // First try boxscore/leaders (for live/finished games)
                    const liveMembers = [
                        ...(summaryData?.boxscore?.players?.flatMap((p: any) => p.athletes) || []),
                        ...(summaryData?.leaders?.flatMap((l: any) => l.leaders?.map((ll: any) => ll.athlete)) || [])
                    ].filter(Boolean);

                    liveMembers.forEach(a => {
                        const displayName = (a.displayName || a.fullName || a.shortName || '').trim();
                        const headshot = a.headshot?.href || (a.id
                            ? `https://a.espncdn.com/combiner/i?img=/i/headshots/${match.league_id}/players/full/${a.id}.png&w=96&h=96`
                            : null);
                        if (!displayName || !headshot || !a.id) return;

                        // Robust ID comparison (cast to string)
                        const teamMatch = summaryData?.header?.competitions?.[0]?.competitors?.find(
                            (c: any) => String(c.id) === String(a.teamId),
                        );

                        const athlete: Athlete = {
                            id: String(a.id),
                            headshot,
                            team: teamMatch?.team?.displayName,
                            displayName,
                        };
                        indexAthlete(
                            athleteMap,
                            athleteInitialLastMap,
                            athleteInitialLastCollisions,
                            athlete,
                            [a.displayName, a.fullName, a.shortName],
                        );
                    });

                    // If no athletes found (pre-game), fetch full rosters
                    if (athleteMap.size === 0) {
                        const competitors = summaryData?.header?.competitions?.[0]?.competitors || [];
                        for (const comp of competitors) {
                            const teamId = comp.id;
                            if (!teamId) continue;

                            try {
                                const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/teams/${teamId}/roster`;
                                const rosterRes = await fetch(rosterUrl);
                                if (rosterRes.ok) {
                                    const rosterData = await rosterRes.json();
                                    const athletes = rosterData.athletes || rosterData.groups?.flatMap((g: any) => g.athletes) || [];
                                    athletes.forEach((a: any) => {
                                        const displayName = (a.displayName || a.fullName || a.shortName || '').trim();
                                        if (!displayName || !a.id) return;
                                        const headshot =
                                            a.headshot?.href ||
                                            `https://a.espncdn.com/combiner/i?img=/i/headshots/${match.league_id}/players/full/${a.id}.png&w=96&h=96`;
                                        const athlete: Athlete = {
                                            id: String(a.id),
                                            headshot,
                                            team: comp.team?.displayName,
                                            displayName,
                                        };
                                        indexAthlete(
                                            athleteMap,
                                            athleteInitialLastMap,
                                            athleteInitialLastCollisions,
                                            athlete,
                                            [a.displayName, a.fullName, a.shortName],
                                        );
                                    });
                                }
                            } catch (rosterErr) {
                                // Skip roster fetch errors silently
                            }
                        }
                    }
                }

                let resolvedOddsEventId = oddsEventId;
                if (useHistoricalWindow) {
                    const candidateDates = [matchEventDate, addDays(matchEventDate, -1), addDays(matchEventDate, 1)];
                    const candidateEvents: HistoricalEvent[] = [];

                    for (const candidateDate of candidateDates) {
                        const cacheKey = `${sportKey}|${candidateDate}`;
                        let eventsForDate = historicalEventsCache.get(cacheKey);
                        if (!eventsForDate) {
                            try {
                                eventsForDate = await fetchHistoricalEventsForDate(oddsApiKey, sportKey, candidateDate);
                                historicalEventsCache.set(cacheKey, eventsForDate);
                            } catch (eventsErr: any) {
                                logs.push({
                                    event: 'historical_events_error',
                                    matchId: match.id,
                                    date: candidateDate,
                                    error: eventsErr?.message ?? String(eventsErr),
                                });
                                eventsForDate = [];
                                historicalEventsCache.set(cacheKey, eventsForDate);
                            }
                        }
                        candidateEvents.push(...eventsForDate);
                    }

                    const normalizedHome = normalizeTeamToken(match.home_team);
                    const normalizedAway = normalizeTeamToken(match.away_team);
                    const matchedEvent = candidateEvents.find((evt) => {
                        const evtHome = normalizeTeamToken(evt.home_team);
                        const evtAway = normalizeTeamToken(evt.away_team);
                        return (
                            (normalizedHome === evtHome && normalizedAway === evtAway) ||
                            (normalizedHome === evtAway && normalizedAway === evtHome)
                        );
                    });

                    if (matchedEvent?.id && (
                        isSyntheticOddsEventId(oddsEventId) ||
                        !oddsEventId ||
                        matchedEvent.id !== oddsEventId
                    )) {
                        resolvedOddsEventId = matchedEvent.id;
                        logs.push({
                            event: 'historical_event_resolved',
                            matchId: match.id,
                            from_event_id: oddsEventId || null,
                            to_event_id: resolvedOddsEventId,
                            date: matchEventDate,
                        });
                    }
                }

                if (!resolvedOddsEventId) {
                    logs.push({
                        event: 'skipping_match',
                        matchId: match.id,
                        reason: 'Unable to resolve historical Odds API event id',
                        date: matchEventDate,
                    });
                    continue;
                }

                const liveUrl = `${CONFIG.oddsApi.baseUrl}/sports/${sportKey}/events/${resolvedOddsEventId}/odds?apiKey=${oddsApiKey}&regions=us&markets=${markets}&oddsFormat=american&_t=${Date.now()}`;
                const historicalSnapshotIso = buildHistoricalSnapshotTime(match.start_time);
                const historicalUrl =
                    `${CONFIG.oddsApi.baseUrl}/historical/sports/${sportKey}/events/${resolvedOddsEventId}/odds` +
                    `?apiKey=${oddsApiKey}&date=${encodeURIComponent(historicalSnapshotIso)}&regions=us&markets=${markets}&oddsFormat=american`;

                const requestUrlForMode = useHistoricalWindow ? historicalUrl : liveUrl;
                console.log(`[Props] Fetching (${useHistoricalWindow ? 'historical' : 'live'}): ${match.home_team} vs ${match.away_team} | URL: ${requestUrlForMode.replace(oddsApiKey, 'REDACTED')}`);

                const res = await fetch(requestUrlForMode);
                if (!res.ok) {
                    const errText = await res.text();
                    logs.push({
                        event: "api_error",
                        matchId: match.id,
                        status: res.status,
                        mode: useHistoricalWindow ? 'historical' : 'live',
                        error: errText
                    });
                    continue;
                }

                const data = await res.json();
                const bookmakers = useHistoricalWindow
                    ? (data?.data?.bookmakers || [])
                    : (data?.bookmakers || []);
                console.log(`[Props] API returned ${bookmakers.length} bookmakers for ${match.home_team}`);

                const book = pickBookmaker(bookmakers, sportKey);

                if (!book) {
                    logs.push({ event: "no_prop_books", matchId: match.id });
                    continue;
                }

                const propUpserts: any[] = [];
                const eventDate = match.start_time.split('T')[0];

                for (const market of book.markets) {
                    const betType = MARKET_TO_ENUM[market.key];
                    if (!betType) continue;

                    for (const outcome of market.outcomes) {
                        // Outcome usually has: name (Over/Under/Yes/No), description (Player Name), price, point
                        const playerName = outcome.description || outcome.name;
                        const side = (outcome.name === 'Over' || outcome.name === 'Under') ? outcome.name.toLowerCase() : 'yes';

                        // Link Athlete Data
                        const athlete = resolveAthlete(playerName, athleteMap, athleteInitialLastMap);
                        const canonicalPlayerName = (athlete?.displayName || playerName).trim();

                        if (!athlete) {
                            console.warn(`[Props: ${match.id}] ⚠️ Player mismatch: "${playerName}" not found in ESPN roster.`);
                        }

                        // Format for player_prop_bets schema
                        propUpserts.push({
                            match_id: match.id,
                            player_id: athlete?.id,
                            espn_player_id: athlete?.id,
                            player_name: canonicalPlayerName,
                            headshot_url: athlete?.headshot,
                            team: athlete?.team || (outcome.name?.includes('(') ? outcome.name.split('(')[1].replace(')', '') : null),
                            bet_type: betType,
                            market_label: `${market.key.replace(/_/g, ' ').toUpperCase()} ${outcome.point || ''}`,
                            line_value: outcome.point || 1, // Anytime TD might not have point
                            odds_american: outcome.price,
                            side: side,
                            provider: book.key,
                            sportsbook: book.title,
                            event_date: eventDate,
                            league: match.league_id
                        });
                    }
                }

                if (propUpserts.length > 0) {
                    const { error: upsertError } = await supabase
                        .from('player_prop_bets')
                        .upsert(propUpserts, {
                            onConflict: 'match_id, player_name, bet_type, side, provider'
                        });

                    if (upsertError) {
                        logs.push({ event: "upsert_error", matchId: match.id, error: upsertError.message });
                        console.error(`[Props: ${match.id}] ❌ Upsert failed: ${upsertError.message}`);
                    } else {
                        logs.push({ event: "props_synced", matchId: match.id, count: propUpserts.length });
                        const overs = propUpserts.filter(p => p.side === 'over').length;
                        const unders = propUpserts.filter(p => p.side === 'under').length;
                        console.log(`[Props: ${match.id}] ✅ Synced ${propUpserts.length} props (${overs} Over, ${unders} Under).`);
                    }
                }

            } catch (e: any) {
                logs.push({ event: "match_process_exception", matchId: match.id, error: e.message });
            }
        }

        return new Response(JSON.stringify({ success: true, logs }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message, logs }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
