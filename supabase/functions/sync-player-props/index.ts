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

interface PlayerGameIdentityRow {
    match_id: string;
    league_id: string | null;
    espn_player_id: string | null;
    player_name: string | null;
    team: string | null;
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

interface PlayerPropIdentityAliasRow {
    league_id: string | null;
    espn_player_id: string | null;
    canonical_player_name: string | null;
    alias_key: string | null;
    team_key: string | null;
    team_name: string | null;
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

const MATCH_QUERY_BATCH_SIZE = 250;

function buildHeadshotUrl(leagueId: string, athleteId: string | number): string {
    return `https://a.espncdn.com/combiner/i?img=/i/headshots/${leagueId}/players/full/${athleteId}.png&w=96&h=96`;
}

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

interface MatchIdentityIndex {
    exactMap: Map<string, Athlete>;
    initialLastMap: Map<string, Athlete>;
    initialLastCollisions: Set<string>;
}

interface AliasCandidate {
    athlete: Athlete;
    teamKey: string;
}

function ensureMatchIdentityIndex(
    matchIdentityMap: Map<string, MatchIdentityIndex>,
    matchId: string,
): MatchIdentityIndex {
    const existing = matchIdentityMap.get(matchId);
    if (existing) return existing;
    const created: MatchIdentityIndex = {
        exactMap: new Map<string, Athlete>(),
        initialLastMap: new Map<string, Athlete>(),
        initialLastCollisions: new Set<string>(),
    };
    matchIdentityMap.set(matchId, created);
    return created;
}

async function loadMatchIdentityFromPlayerStats(
    supabase: ReturnType<typeof createClient>,
    matches: PropMatch[],
): Promise<Map<string, MatchIdentityIndex>> {
    const out = new Map<string, MatchIdentityIndex>();
    const matchIds = matches.map((m) => m.id).filter(Boolean);
    if (matchIds.length === 0) return out;

    for (let i = 0; i < matchIds.length; i += MATCH_QUERY_BATCH_SIZE) {
        const batch = matchIds.slice(i, i + MATCH_QUERY_BATCH_SIZE);
        const { data, error } = await supabase
            .from('player_game_stats')
            .select('match_id, league_id, espn_player_id, player_name, team')
            .in('match_id', batch);

        if (error) {
            throw new Error(`player_game_stats identity lookup failed: ${error.message}`);
        }

        for (const row of (data ?? []) as PlayerGameIdentityRow[]) {
            const athleteId = String(row.espn_player_id ?? '').trim();
            const displayName = String(row.player_name ?? '').trim();
            if (!row.match_id || !athleteId || !displayName) continue;

            const index = ensureMatchIdentityIndex(out, row.match_id);
            const athlete: Athlete = {
                id: athleteId,
                displayName,
                team: row.team ?? undefined,
                headshot: buildHeadshotUrl(row.league_id ?? 'nba', athleteId),
            };

            indexAthlete(
                index.exactMap,
                index.initialLastMap,
                index.initialLastCollisions,
                athlete,
                [row.player_name],
            );
        }
    }

    return out;
}

async function loadPlayerIdentityAliases(
    supabase: ReturnType<typeof createClient>,
    leagues: string[],
): Promise<Map<string, AliasCandidate[]>> {
    const out = new Map<string, AliasCandidate[]>();
    if (leagues.length === 0) return out;

    const uniqueLeagues = Array.from(new Set(leagues.map((l) => (l || '').trim().toLowerCase()).filter(Boolean)));
    if (uniqueLeagues.length === 0) return out;

    const { data, error } = await supabase
        .from('player_prop_identity_aliases')
        .select('league_id, espn_player_id, canonical_player_name, alias_key, team_key, team_name')
        .in('league_id', uniqueLeagues);

    if (error) {
        throw new Error(`player_prop_identity_aliases lookup failed: ${error.message}`);
    }

    for (const row of (data ?? []) as PlayerPropIdentityAliasRow[]) {
        const leagueId = String(row.league_id ?? '').trim().toLowerCase();
        const athleteId = String(row.espn_player_id ?? '').trim();
        const canonicalName = String(row.canonical_player_name ?? '').trim();
        const aliasKey = String(row.alias_key ?? '').trim();
        const teamKey = String(row.team_key ?? '').trim();

        if (!leagueId || !athleteId || !canonicalName || !aliasKey) continue;

        const athlete: Athlete = {
            id: athleteId,
            displayName: canonicalName,
            team: row.team_name ?? undefined,
            headshot: buildHeadshotUrl(leagueId, athleteId),
        };
        const key = `${leagueId}|${aliasKey}`;
        const list = out.get(key) ?? [];
        list.push({ athlete, teamKey });
        out.set(key, list);
    }

    return out;
}

function resolveAthleteFromAlias(
    match: PropMatch,
    playerName: string,
    aliasLookup: Map<string, AliasCandidate[]>,
): Athlete | undefined {
    const leagueId = String(match.league_id ?? '').trim().toLowerCase();
    const aliasKey = normalizePlayerToken(playerName);
    if (!leagueId || !aliasKey) return undefined;

    const candidates = aliasLookup.get(`${leagueId}|${aliasKey}`) ?? [];
    if (candidates.length === 0) return undefined;

    const matchTeamKeys = new Set([
        normalizePlayerToken(match.home_team),
        normalizePlayerToken(match.away_team),
        normalizeTeamToken(match.home_team),
        normalizeTeamToken(match.away_team),
    ]);

    const teamScoped = candidates.filter((candidate) => candidate.teamKey && matchTeamKeys.has(candidate.teamKey));
    if (teamScoped.length === 1) return teamScoped[0].athlete;
    if (teamScoped.length > 1) return undefined;

    const global = candidates.filter((candidate) => !candidate.teamKey);
    if (global.length === 1) return global[0].athlete;
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

function selectBookmakers(bookmakers: any[], sportKey: string): any[] {
    if (!Array.isArray(bookmakers) || bookmakers.length === 0) return [];
    const preferred = resolveBookPreference(sportKey);
    const scored = bookmakers
        .filter((book) => book?.key && Array.isArray(book?.markets) && book.markets.length > 0)
        .map((book: any) => {
            const key = String(book?.key || '').toLowerCase();
            const preferredRank = preferred.indexOf(key);
            return {
                book,
                rank: preferredRank === -1 ? 999 : preferredRank,
                key,
            };
        })
        .sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.key.localeCompare(b.key);
        });

    const deduped: any[] = [];
    const seen = new Set<string>();
    for (const row of scored) {
        const key = String(row.book?.key || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        deduped.push(row.book);
        seen.add(key);
    }
    return deduped;
}

function shouldReplacePropCandidate(existing: any, candidate: any): boolean {
    const existingLine = Number(existing?.line_value ?? Number.NaN);
    const candidateLine = Number(candidate?.line_value ?? Number.NaN);
    const existingLineValid = Number.isFinite(existingLine);
    const candidateLineValid = Number.isFinite(candidateLine);

    if (!existingLineValid && candidateLineValid) return true;
    if (existingLineValid && !candidateLineValid) return false;
    if (existingLineValid && candidateLineValid && existingLine !== candidateLine) {
        return candidateLine < existingLine;
    }

    const existingOdds = Number(existing?.odds_american ?? Number.NaN);
    const candidateOdds = Number(candidate?.odds_american ?? Number.NaN);
    const existingOddsValid = Number.isFinite(existingOdds);
    const candidateOddsValid = Number.isFinite(candidateOdds);

    if (!existingOddsValid && candidateOddsValid) return true;
    if (existingOddsValid && !candidateOddsValid) return false;
    if (existingOddsValid && candidateOddsValid) {
        const existingDistance = Math.abs(Math.abs(existingOdds) - 110);
        const candidateDistance = Math.abs(Math.abs(candidateOdds) - 110);
        if (candidateDistance !== existingDistance) return candidateDistance < existingDistance;
    }

    return false;
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
    const historicalIdentityFallbackByMatch = new Map<string, MatchIdentityIndex>();
    let totalPropsUpserted = 0;
    let nbaPropsUpserted = 0;
    let nbaMinEventDate: string | null = null;

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

        let aliasLookup = new Map<string, AliasCandidate[]>();
        try {
            aliasLookup = await loadPlayerIdentityAliases(
                supabase,
                (matches as PropMatch[]).map((m) => m.league_id),
            );
            logs.push({
                event: 'player_identity_alias_loaded',
                alias_keys: aliasLookup.size,
            });
        } catch (aliasErr: any) {
            logs.push({
                event: 'player_identity_alias_load_failed',
                error: aliasErr?.message ?? String(aliasErr),
            });
        }

        const identityMap = await loadMatchIdentityFromPlayerStats(supabase, matches as PropMatch[]);
        identityMap.forEach((value, key) => historicalIdentityFallbackByMatch.set(key, value));
        logs.push({
            event: useHistoricalWindow ? 'historical_identity_loaded' : 'match_identity_loaded',
            matches_with_identity: historicalIdentityFallbackByMatch.size,
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
                const historicalIdentity = historicalIdentityFallbackByMatch.get(match.id);
                let historicalIdentityHits = 0;
                let aliasIdentityHits = 0;
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
                            ? buildHeadshotUrl(match.league_id, a.id)
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

                    // Always merge full team rosters. Summary/leader payloads are often partial.
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
                                    const headshot = a.headshot?.href || buildHeadshotUrl(match.league_id, a.id);
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

                const selectedBooks = selectBookmakers(bookmakers, sportKey);
                if (selectedBooks.length === 0) {
                    logs.push({ event: "no_prop_books", matchId: match.id });
                    continue;
                }

                const eventDate = match.start_time.split('T')[0];
                const dedupedRows = new Map<string, any>();

                for (const book of selectedBooks) {
                    for (const market of (book.markets ?? [])) {
                        const betType = MARKET_TO_ENUM[market.key];
                        if (!betType) continue;

                        for (const outcome of (market.outcomes ?? [])) {
                            // Outcome usually has: name (Over/Under/Yes/No), description (Player Name), price, point
                            const playerName = String(outcome.description || outcome.name || '').trim();
                            if (!playerName) continue;
                            const side = (outcome.name === 'Over' || outcome.name === 'Under') ? outcome.name.toLowerCase() : 'yes';

                            // Link Athlete Data
                            let athlete = resolveAthlete(playerName, athleteMap, athleteInitialLastMap);
                            if (!athlete && historicalIdentity) {
                                athlete = resolveAthlete(playerName, historicalIdentity.exactMap, historicalIdentity.initialLastMap);
                                if (athlete) historicalIdentityHits += 1;
                            }
                            if (!athlete) {
                                athlete = resolveAthleteFromAlias(match, playerName, aliasLookup);
                                if (athlete) aliasIdentityHits += 1;
                            }
                            const canonicalPlayerName = String(athlete?.displayName || playerName).trim();
                            if (!canonicalPlayerName) continue;

                            if (!athlete) {
                                console.warn(`[Props: ${match.id}] ⚠️ Player mismatch: "${playerName}" not found in ESPN roster.`);
                            }

                            const candidateRow = {
                                match_id: match.id,
                                player_id: athlete?.id ?? null,
                                espn_player_id: athlete?.id ?? null,
                                player_name: canonicalPlayerName,
                                headshot_url: athlete?.headshot ?? null,
                                team: athlete?.team ?? null,
                                bet_type: betType,
                                market_label: `${market.key.replace(/_/g, ' ').toUpperCase()} ${outcome.point || ''}`,
                                line_value: outcome.point || 1, // Anytime TD might not have point
                                odds_american: outcome.price,
                                side: side,
                                provider: book.key,
                                sportsbook: book.title,
                                event_date: eventDate,
                                league: match.league_id
                            };

                            const identityKey = athlete?.id
                                ? `id:${String(athlete.id)}`
                                : `name:${normalizePlayerToken(canonicalPlayerName)}`;
                            const dedupeKey = `${String(book.key || '').toLowerCase()}|${identityKey}|${betType}|${side}`;
                            const existing = dedupedRows.get(dedupeKey);
                            if (!existing || shouldReplacePropCandidate(existing, candidateRow)) {
                                dedupedRows.set(dedupeKey, candidateRow);
                            }
                        }
                    }
                }

                const propUpserts = Array.from(dedupedRows.values());
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
                        totalPropsUpserted += propUpserts.length;
                        if (match.league_id === 'nba') {
                            nbaPropsUpserted += propUpserts.length;
                            if (!nbaMinEventDate || eventDate < nbaMinEventDate) nbaMinEventDate = eventDate;
                        }
                        logs.push({
                            event: "props_synced",
                            matchId: match.id,
                            count: propUpserts.length,
                            books_used: selectedBooks.length,
                            historical_identity_hits: historicalIdentityHits,
                            alias_identity_hits: aliasIdentityHits,
                        });
                        const overs = propUpserts.filter(p => p.side === 'over').length;
                        const unders = propUpserts.filter(p => p.side === 'under').length;
                        console.log(`[Props: ${match.id}] ✅ Synced ${propUpserts.length} props (${overs} Over, ${unders} Under).`);
                    }
                }

            } catch (e: any) {
                logs.push({ event: "match_process_exception", matchId: match.id, error: e.message });
            }
        }

        if (nbaPropsUpserted > 0) {
            const sinceDate = nbaMinEventDate
                ?? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            logs.push({
                event: "nba_prop_pipeline_triggered",
                since_date: sinceDate,
                nba_props_upserted: nbaPropsUpserted,
            });
            try {
                const { data: pipelineResult, error: pipelineErr } = await supabase.rpc("run_player_prop_pipeline", {
                    p_since_date: sinceDate,
                });
                if (pipelineErr) {
                    logs.push({
                        event: "nba_prop_pipeline_error",
                        since_date: sinceDate,
                        error: pipelineErr.message,
                    });
                } else {
                    logs.push({
                        event: "nba_prop_pipeline_complete",
                        since_date: sinceDate,
                        result: pipelineResult ?? null,
                    });
                }
            } catch (pipelineErr: any) {
                logs.push({
                    event: "nba_prop_pipeline_exception",
                    since_date: sinceDate,
                    error: pipelineErr?.message ?? String(pipelineErr),
                });
            }
        }

        return new Response(JSON.stringify({
            success: true,
            total_props_upserted: totalPropsUpserted,
            nba_props_upserted: nbaPropsUpserted,
            nba_since_date: nbaMinEventDate,
            logs,
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message, logs }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
