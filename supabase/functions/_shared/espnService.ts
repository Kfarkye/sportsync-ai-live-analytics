/**
 * Enhanced ESPN Service - Fully utilizing ESPN API capabilities
 * 
 * ESPN API FEATURES UTILIZED:
 * 1. Scoreboard - Real-time scores, status, odds summary
 * 2. Summary - Detailed game data (box scores, plays, stats)
 * 3. Rankings - AP Poll, Coaches Poll, etc.
 * 4. Standings - Division/Conference standings
 * 5. Teams - Full team info including rosters
 * 6. News - Team-specific news articles
 * 7. Schedule - Team schedules for recent form
 * 8. Predictor - ESPN's win probability model
 */

import {
    League, Match, Sport, RankingItem, Team, MatchOdds
} from './types.ts';
import { generateCanonicalGameId } from './match-registry.ts';
import { debugManager } from './debug.ts';
import { LEAGUES } from './constants.ts';

import { resilientFetch, logger as Logger } from './resilience.ts';
import { EspnAdapters, Safe } from './espnAdapters.ts';
import { computeAISignals } from './gameStateEngine.ts';
import { safeSlice } from './oddsUtils.ts';
import { safeParseDate } from './dateUtils.ts';


// ============================================================================
// OPTIONAL PROXY HOOK (EDGE FUNCTIONS)
// ============================================================================

type ProxyInvoker = (endpoint: string, signal?: AbortSignal) => Promise<{ ok: boolean; status: number; json: () => Promise<any> } | null>;
let proxyInvoker: ProxyInvoker | null = null;
export const setEspnProxyInvoker = (invoker: ProxyInvoker | null) => {
    proxyInvoker = invoker;
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    API_BASE: 'https://site.api.espn.com/apis/site/v2/sports',
    V3_API_BASE: 'https://sports.core.api.espn.com/v3/sports',
    CDN_BASE: 'https://a.espncdn.com',
    REQUEST_TIMEOUT: 4000,
};

// Proxy fallbacks for CORS
const PUBLIC_PROXIES = [
    (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
];

// ============================================================================
// REQUEST HANDLERS
// ============================================================================

export async function fetchWithFallback(url: string): Promise<any> {
    // 1. Try Edge Function (optional proxy hook)
    if (proxyInvoker) {
        try {
            const u = new URL(url);
            const basePath = '/apis/site/v2/sports/';
            const idx = u.href.indexOf(basePath);
            if (idx > -1) {
                const endpoint = u.href.substring(idx + basePath.length);

                // Add explicit timeout to proxy call to prevent stalling on mobile
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

                const res = await proxyInvoker(endpoint, controller.signal);

                clearTimeout(timeoutId);

                if (res && res.ok) {
                    return res;
                }
            }
        } catch (e) {
            Logger.debug('ESPNService', 'Edge proxy unavailable or timed out');
        }
    }

    // 2. Try public CORS proxies
    for (const proxy of PUBLIC_PROXIES) {
        try {
            const proxyUrl = proxy(url);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
            const res = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) return res;
        } catch { continue; }
    }

    // 3. Direct fetch (works in Node.js/SSR)
    if (typeof window === 'undefined') {
        try { return await resilientFetch(url); } catch (e) { }
    }

    throw new Error('All ESPN API channels failed');
}

// ============================================================================
// STATUS NORMALIZATION
// ============================================================================

const normalizeStatus = (statusData: any): string => {
    if (!statusData) return 'SCHEDULED';
    const state = statusData.type?.state;
    const name = statusData.type?.name;

    if (state === 'pre') return 'SCHEDULED';
    if (state === 'in') return 'LIVE';
    if (state === 'post') return 'FINISHED';

    if (name === 'STATUS_FINAL') return 'FINISHED';
    if (name === 'STATUS_FINAL_OT') return 'FINISHED';
    if (name === 'STATUS_SCHEDULED') return 'SCHEDULED';
    if (name === 'STATUS_IN_PROGRESS') return 'LIVE';
    if (name === 'STATUS_HALFTIME') return 'HALFTIME';
    if (name === 'STATUS_POSTPONED') return 'POSTPONED';
    if (name === 'STATUS_CANCELED') return 'CANCELLED';

    return name || 'SCHEDULED';
};

const getApiPath = (leagueId: string, sport: Sport): string => {
    const leagueConfig = LEAGUES.find(l => l.id === leagueId);
    return leagueConfig ? leagueConfig.apiEndpoint : `${sport.toLowerCase()}/${leagueId}`;
};

// ============================================================================
// HELPERS
// ============================================================================

const stripSuffix = (id: string): string => {
    if (!id) return '';
    return id.split('_')[0];
};

/**
 * Fetch scoreboard for a league on a specific date
 * This is the primary endpoint for match listings
 */
export const fetchLeagueMatches = async (
    league: League,
    date: Date
): Promise<Match[]> => {
    const dObj = safeParseDate(date);
    const year = dObj.getFullYear();
    const month = String(dObj.getMonth() + 1).padStart(2, '0');
    const day = String(dObj.getDate()).padStart(2, '0');
    let dateParam = `${year}${month}${day}`;

    // Fix: Use Weekly Range for Football to capture all games in the week
    if (league.sport === Sport.NFL || league.sport === Sport.COLLEGE_FOOTBALL) {
        const dayOfWeek = date.getDay(); // 0=Sun
        const diff = (dayOfWeek + 7 - 4) % 7; // Align to Thursday
        const start = new Date(date);
        start.setDate(date.getDate() - diff);

        const end = new Date(start);
        end.setDate(start.getDate() + 6);

        const fmt = (d: Date) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dy = String(d.getDate()).padStart(2, '0');
            return `${y}${m}${dy}`;
        };
        dateParam = `${fmt(start)}-${fmt(end)}`;
    }

    // Add group parameter for college sports to get all D1/FBS games
    let groups = '';
    if (league.id === 'mens-college-basketball') groups = '&groups=50';
    if (league.id === 'college-football') groups = '&groups=80';

    const url = `${CONFIG.API_BASE}/${league.apiEndpoint}/scoreboard?dates=${dateParam}${groups}&limit=250&_t=${Date.now()}`;

    try {
        const response = await fetchWithFallback(url);
        if (!response.ok) return [];

        const data = await response.json();
        if (!Array.isArray(data.events)) return [];

        // Tennis-specific: ESPN nests matches inside tournaments → groupings → competitions
        let events = data.events;
        if (league.sport === Sport.TENNIS) {
            events = events.flatMap((tournament: any) =>
                (tournament.groupings || []).flatMap((group: any) =>
                    (group.competitions || []).map((comp: any) => ({
                        ...tournament,
                        id: comp.id,
                        date: comp.date || comp.startDate,
                        status: comp.status,
                        competitions: [comp],
                    }))
                )
            );
            console.log(`[ESPN] Tennis flattened: ${data.events.length} tournaments → ${events.length} matches`);
        }

        // Debug: Log fetch results for Tennis and Liga MX
        if (league.id === 'mex.1' || league.sport === Sport.TENNIS) {
            console.log(`[ESPN] ${league.name}: ${events.length} events from API`);
        }

        return events.map((event: any) => {
            const competition = event.competitions?.[0];
            if (!competition?.competitors || competition.competitors.length < 2) return null;

            const homeComp = competition.competitors.find((c: any) => c.homeAway === 'home');
            const awayComp = competition.competitors.find((c: any) => c.homeAway === 'away');
            // Tennis uses competitor.athlete, other sports use competitor.team
            if (!(homeComp?.team || homeComp?.athlete) || !(awayComp?.team || awayComp?.athlete)) return null;

            return {
                id: Safe.string(event.id),
                leagueId: league.id,
                sport: league.sport,
                startTime: event.date,
                status: normalizeStatus(event.status),
                period: Safe.number(event.status?.period),
                displayClock: Safe.string(event.status?.displayClock),
                minute: Safe.string(event.status?.displayClock || event.status?.type?.detail),
                homeTeam: EspnAdapters.Team(homeComp, league.sport),
                awayTeam: EspnAdapters.Team(awayComp, league.sport),
                homeScore: Safe.score(homeComp?.score),
                awayScore: Safe.score(awayComp?.score),
                events: [],
                momentum: [],
                stats: [],
                odds: EspnAdapters.Odds(competition),
                canonical_id: generateCanonicalGameId(
                    homeComp.team?.displayName || homeComp.team?.name || homeComp.athlete?.displayName || 'Unknown',
                    awayComp.team?.displayName || awayComp.team?.name || awayComp.athlete?.displayName || 'Unknown',
                    event.date,
                    league.id
                ),
                // Game Context (for Intel tab)
                seasonType: event.season?.type,           // 1=Pre, 2=Regular, 3=Post
                name: event.name || event.shortName,      // e.g., "Wild Card Round"
                notes: competition.notes?.[0]?.headline,  // e.g., "NBA Cup Quarterfinal"
                // Tennis-specific context
                round: competition.round?.displayName,    // e.g., "Quarterfinal", "Round of 128"
                court: competition.venue?.court,          // e.g., "Rod Laver Arena", "Court 5"
            };

        }).filter((m: any | null): m is any => m !== null)
            .map(m => {
                try {
                    return { ...m, ai_signals: computeAISignals(m) };
                } catch (e) {
                    Logger.warn('ESPNService', 'computeAISignals failed', {
                        leagueId: league.id,
                        matchId: m.id,
                        error: String(e)
                    });
                    return { ...m, ai_signals: null };
                }
            });

    } catch (e) {
        Logger.debug('ESPNService', `fetchLeagueMatches failed: ${e}`);
        return [];
    }
};

/**
 * Fetch all matches across multiple leagues
 */
export const fetchAllMatches = async (
    leagues: League[],
    date: Date
): Promise<Match[]> => {
    const results = await Promise.allSettled(
        leagues.map(l => fetchLeagueMatches(l, date))
    );

    const matches = results
        .filter((r): r is PromiseFulfilledResult<Match[]> => r.status === 'fulfilled')
        .flatMap(r => r.value);

    matches.forEach(m => {
        debugManager.trace('ESPNService', 'Match Hydrated', m.id, { canonicalId: m.canonical_id, home: m.homeTeam.name, away: m.awayTeam.name });
    });

    // Sort by start time

    return matches.sort((a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
};

/**
 * Fetch extended match details (Box score, plays, stats, etc.)
 * This is called when user views a specific match
 */
export const fetchMatchDetailsExtended = async (
    matchId: string,
    sport: Sport,
    leagueId: string
): Promise<Partial<Match>> => {
    const apiPath = getApiPath(leagueId, sport);
    const espnId = stripSuffix(matchId);
    // Add cache-busting parameter for live games to prevent stale score data
    const url = `${CONFIG.API_BASE}/${apiPath}/summary?event=${espnId}&_t=${Date.now()}`;

    try {
        const response = await fetchWithFallback(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const competition = data.header?.competitions?.[0];

        if (!competition?.competitors || competition.competitors.length < 2) {
            return {};
        }

        const homeComp = competition.competitors.find((c: any) => c.homeAway === 'home');
        const awayComp = competition.competitors.find((c: any) => c.homeAway === 'away');
        const statusData = competition.status;
        const pickcenter = data.pickcenter;

        // Data Purity: Extracting raw team statistics objects for the engine
        const boxscore = data.boxscore;
        const homeStatsObj = boxscore?.teams?.find((t: any) => (t?.team?.id || t?.id) === homeComp?.id);
        const awayStatsObj = boxscore?.teams?.find((t: any) => (t?.team?.id || t?.id) === awayComp?.id);

        const result: Partial<Match> = {
            homeScore: Safe.score(homeComp?.score),
            awayScore: Safe.score(awayComp?.score),
            homeTeam: EspnAdapters.Team(homeComp, sport),
            awayTeam: EspnAdapters.Team(awayComp, sport),
            homeTeamStats: homeStatsObj,
            awayTeamStats: awayStatsObj,
            status: normalizeStatus(statusData),
            period: Safe.number(statusData?.period),
            displayClock: Safe.string(statusData?.displayClock),
            minute: Safe.string(statusData?.displayClock || statusData?.type?.detail),
            regulationPeriods: Safe.number(competition.regulationPeriods, 4),
            odds: EspnAdapters.Odds(competition, pickcenter),
            events: EspnAdapters.Events(data, sport),
            stats: EspnAdapters.Stats(data, sport),
            advancedMetrics: EspnAdapters.AdvancedMetrics(data, sport),
            playerStats: EspnAdapters.PlayerStats(data),
            leaders: EspnAdapters.Leaders(data),
            momentum: EspnAdapters.Momentum(data),
            context: EspnAdapters.Context(data),
            situation: EspnAdapters.Situation(data),
            currentDrive: EspnAdapters.Drive(data),
            lastPlay: EspnAdapters.LastPlay(data),
            predictor: EspnAdapters.Predictor(data)
        };

        // Compute signals with enriched data
        const fullMatch = result as Match;
        result.ai_signals = computeAISignals(fullMatch);

        return result;

    } catch (e) {
        Logger.debug('ESPNService', `fetchMatchDetailsExtended failed: ${e}`);
        return {};
    }
};

// ============================================================================
// TEAM-SPECIFIC ENDPOINTS
// ============================================================================

/**
 * Fetch team's last 5 games (Recent Form)
 */
export const fetchTeamLastFive = async (
    teamId: string,
    sport: Sport,
    leagueId: string
): Promise<any[]> => {
    const apiPath = getApiPath(leagueId, sport);

    // Tennis players are athletes, others are teams
    const entityType = sport === Sport.TENNIS ? 'athletes' : 'teams';
    const url = `${CONFIG.API_BASE}/${apiPath}/${entityType}/${teamId}/schedule`;

    try {
        const response = await fetchWithFallback(url);
        if (!response.ok) return [];

        const data = await response.json();
        if (!data.events) return [];

        const completed = data.events.filter((e: any) =>
            e.competitions?.[0]?.status?.type?.state === 'post'
        );

        completed.sort((a: any, b: any) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        );

        return safeSlice(completed, 0, 5).map((e: any) => {
            const c = e.competitions[0];

            // Handle both team (NBA/NFL) and athlete (Tennis) entities
            const teamComp = c.competitors.find((comp: any) =>
                (comp.team?.id === teamId) || (comp.athlete?.id === teamId) || (comp.id === teamId)
            );
            const oppComp = c.competitors.find((comp: any) =>
                (comp.team?.id !== teamId && comp.athlete?.id !== teamId && comp.id !== teamId)
            );

            const isHome = teamComp?.homeAway === 'home';

            let result = 'D';
            if (teamComp?.winner === true) result = 'W';
            else if (teamComp?.winner === false) result = 'L';
            else {
                // Fallback: Infer from score (some endpoints omit winner flag)
                const s1 = Number(teamComp?.score?.displayValue || teamComp?.score || -1);
                const s2 = Number(oppComp?.score?.displayValue || oppComp?.score || -1);
                if (s1 > -1 && s2 > -1) {
                    if (s1 > s2) result = 'W';
                    else if (s2 > s1) result = 'L';
                }
            }

            const oppEntity = oppComp?.team || oppComp?.athlete || oppComp || {};

            return {
                id: e.id,
                date: e.date,
                opponent: {
                    id: oppEntity.id,
                    name: oppEntity.displayName || oppEntity.fullName || 'Unknown',
                    shortName: oppEntity.shortDisplayName || oppEntity.abbreviation || 'UNK',
                    logo: oppEntity.logo || oppEntity.headshot?.href || oppEntity.logos?.[0]?.href,
                    score: oppComp?.score?.displayValue || oppComp?.score
                },
                teamScore: teamComp?.score?.displayValue || teamComp?.score,
                result,
                isHome
            };
        });
    } catch (e) {
        Logger.debug('ESPNService', `fetchTeamLastFive failed: ${e}`);
        return [];
    }
};

/**
 * Fetch team injury report
 */
export const fetchTeamInjuries = async (
    teamId: string,
    sport: Sport,
    leagueId: string
): Promise<any[]> => {
    const apiPath = getApiPath(leagueId, sport);
    const url = `${CONFIG.API_BASE}/${apiPath}/teams/${teamId}?enable=roster`;

    try {
        const response = await fetchWithFallback(url);
        if (!response.ok) return [];

        const data = await response.json();
        const athletes = data.team?.athletes || [];

        return athletes
            .filter((a: any) => a.injuries && a.injuries.length > 0)
            .map((a: any) => ({
                id: a.id,
                name: a.fullName || a.displayName,
                position: a.position?.abbreviation,
                headshot: a.headshot?.href,
                status: a.injuries[0]?.status,
                description: a.injuries[0]?.type?.description,
                details: a.injuries[0]?.details?.detail
            }));

    } catch (e) {
        Logger.debug('ESPNService', `fetchTeamInjuries failed: ${e}`);
        return [];
    }
};

/**
 * Fetch team roster
 */
export const fetchTeamRoster = async (
    teamId: string,
    sport: Sport,
    leagueId: string
): Promise<any[]> => {
    const apiPath = getApiPath(leagueId, sport);
    const url = `${CONFIG.API_BASE}/${apiPath}/teams/${teamId}/roster`;

    try {
        const response = await fetchWithFallback(url);
        if (!response.ok) return [];

        const data = await response.json();
        return data.athletes?.flatMap((group: any) =>
            group.items?.map((a: any) => ({
                id: a.id,
                name: a.fullName || a.displayName,
                jersey: a.jersey,
                position: a.position?.abbreviation,
                headshot: a.headshot?.href,
                age: a.age,
                height: a.height,
                weight: a.weight,
                experience: a.experience?.years
            })) || []
        ) || [];

    } catch (e) {
        Logger.debug('ESPNService', `fetchTeamRoster failed: ${e}`);
        return [];
    }
};

/**
 * Fetch team news articles
 */
export const fetchTeamNews = async (
    teamId: string,
    sport: Sport,
    leagueId: string,
    limit: number = 10
): Promise<any[]> => {
    const apiPath = getApiPath(leagueId, sport);
    const url = `${CONFIG.API_BASE}/${apiPath}/teams/${teamId}/news?limit=${limit}`;

    try {
        const response = await fetchWithFallback(url);
        if (!response.ok) return [];

        const data = await response.json();
        return data.articles?.map((article: any) => ({
            id: article.dataSourceIdentifier,
            headline: article.headline,
            description: article.description,
            published: article.published,
            type: article.type,
            premium: article.premium,
            images: article.images?.map((img: any) => img.url),
            links: article.links
        })) || [];

    } catch (e) {
        Logger.debug('ESPNService', `fetchTeamNews failed: ${e}`);
        return [];
    }
};

// ============================================================================
// LEAGUE-WIDE ENDPOINTS
// ============================================================================

/**
 * Fetch rankings (AP Poll, Coaches Poll, etc.)
 */
export const fetchRankings = async (
    sport: Sport,
    leagueId: string
): Promise<RankingItem[]> => {
    const apiPath = getApiPath(leagueId, sport);
    const url = `${CONFIG.API_BASE}/${apiPath}/rankings`;

    try {
        const response = await fetchWithFallback(url);
        if (!response.ok) return [];

        const data = await response.json();
        const poll = data.rankings?.find((r: any) => r.name === 'AP Top 25') || data.rankings?.[0];
        if (!poll?.ranks) return [];

        return poll.ranks.map((r: any) => ({
            rank: r.current,
            team: {
                id: r.team.id,
                name: r.team.name || r.team.nickname || r.team.location,
                logo: r.team.logo,
                record: r.recordSummary,
                color: r.team.color
            },
            trend: r.current - (r.previous || r.current),
            points: r.points,
            firstPlaceVotes: r.firstPlaceVotes
        }));

    } catch (e) {
        Logger.debug('ESPNService', `fetchRankings failed: ${e}`);
        return [];
    }
};

/**
 * Fetch league standings
 */
export const fetchStandings = async (
    sport: Sport,
    leagueId: string
): Promise<any> => {
    const apiPath = getApiPath(leagueId, sport);
    const url = `${CONFIG.API_BASE}/${apiPath}/standings`;

    try {
        const response = await fetchWithFallback(url);
        if (!response.ok) return null;

        const data = await response.json();
        return data.children?.map((division: any) => ({
            name: division.name,
            abbreviation: division.abbreviation,
            teams: division.standings?.entries?.map((entry: any) => ({
                team: {
                    id: entry.team.id,
                    name: entry.team.displayName,
                    shortName: entry.team.shortDisplayName,
                    logo: entry.team.logos?.[0]?.href
                },
                stats: entry.stats?.reduce((acc: any, stat: any) => {
                    acc[stat.name] = stat.displayValue;
                    return acc;
                }, {})
            })) || []
        })) || null;

    } catch (e) {
        Logger.debug('ESPNService', `fetchStandings failed: ${e}`);
        return null;
    }
};

/**
 * Fetch league leaders (stat leaders)
 */
export const fetchLeagueLeaders = async (
    sport: Sport,
    leagueId: string,
    category?: string
): Promise<any[]> => {
    const apiPath = getApiPath(leagueId, sport);
    const url = `${CONFIG.API_BASE}/${apiPath}/leaders${category ? `?category=${category}` : ''}`;

    try {
        const response = await fetchWithFallback(url);
        if (!response.ok) return [];

        const data = await response.json();
        return data.leaders?.map((cat: any) => ({
            name: cat.name,
            displayName: cat.displayName,
            leaders: safeSlice(cat.leaders, 0, 10).map((l: any) => ({
                rank: l.rank,
                athlete: {
                    id: l.athlete?.id,
                    name: l.athlete?.displayName,
                    headshot: l.athlete?.headshot?.href,
                    team: l.team?.abbreviation
                },
                value: l.displayValue,
                stat: l.value
            })) || []
        })) || [];

    } catch (e) {
        Logger.debug('ESPNService', `fetchLeagueLeaders failed: ${e}`);
        return [];
    }
};

// ============================================================================
// PREDICTOR / ANALYTICS ENDPOINTS
// ============================================================================

/**
 * Fetch ESPN's win probability & predictor data
 */
export const fetchPredictor = async (
    matchId: string,
    sport: Sport,
    leagueId: string
): Promise<any> => {
    const apiPath = getApiPath(leagueId, sport);
    const espnId = stripSuffix(matchId);
    const url = `${CONFIG.API_BASE}/${apiPath}/summary?event=${espnId}`;

    try {
        const response = await fetchWithFallback(url);
        if (!response.ok) return null;

        const data = await response.json();

        // Extract predictor data
        const predictor = data.predictor;
        const winProbability = data.winprobability;

        return {
            homeTeamChance: predictor?.homeTeam?.gameChance || predictor?.homeTeam?.chance?.value,
            awayTeamChance: predictor?.awayTeam?.gameChance || predictor?.awayTeam?.chance?.value,
            homeTeamLine: predictor?.homeTeam?.displayLine,
            awayTeamLine: predictor?.awayTeam?.displayLine,
            winProbHistory: winProbability?.map((wp: any) => ({
                homeWinPct: wp.homeWinPercentage,
                secondsElapsed: wp.secondsElapsed
            })) || []
        };

    } catch (e) {
        Logger.debug('ESPNService', `fetchPredictor failed: ${e}`);
        return null;
    }
};

/**
 * Fetch head-to-head history between two teams
 */
export const fetchHeadToHead = async (
    team1Id: string,
    team2Id: string,
    sport: Sport,
    leagueId: string,
    limit: number = 10
): Promise<any[]> => {
    // ESPN doesn't have a direct H2H endpoint, so we fetch team schedule and filter
    const apiPath = getApiPath(leagueId, sport);
    const currentYear = new Date().getFullYear();
    const entityType = sport === Sport.TENNIS ? 'athletes' : 'teams';
    const url = `${CONFIG.API_BASE}/${apiPath}/${entityType}/${team1Id}/schedule?season=${currentYear}&seasontype=2`;

    try {
        const response = await fetchWithFallback(url);
        if (!response.ok) return [];

        const data = await response.json();
        const h2hGames = data.events?.filter((e: any) => {
            const competitors = e.competitions?.[0]?.competitors;
            return competitors?.some((c: any) =>
                (c.team?.id === team2Id) || (c.athlete?.id === team2Id) || (c.id === team2Id)
            );
        }) || [];

        return safeSlice(h2hGames, 0, limit).map((e: any) => {
            const comp = e.competitions[0];
            const team1Comp = comp.competitors.find((c: any) =>
                (c.team?.id === team1Id) || (c.athlete?.id === team1Id) || (c.id === team1Id)
            );
            const team2Comp = comp.competitors.find((c: any) =>
                (c.team?.id === team2Id) || (c.athlete?.id === team2Id) || (c.id === team2Id)
            );

            return {
                id: e.id,
                date: e.date,
                team1Score: team1Comp?.score?.displayValue || team1Comp?.score,
                team2Score: team2Comp?.score?.displayValue || team2Comp?.score,
                team1Won: team1Comp?.winner,
                venue: comp.venue?.fullName
            };
        });

    } catch (e) {
        Logger.debug('ESPNService', `fetchHeadToHead failed: ${e}`);
        return [];
    }
};
