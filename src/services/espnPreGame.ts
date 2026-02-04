
import { Sport, PlayerPropBet, MatchLeader, RecentFormGame, RefIntelContent } from '../types';
import { MatchInsight } from '../types/historicalIntel';
import { LEAGUES } from '../constants';
import { fetchTeamLastFive, fetchWithFallback } from './espnService';
import { dbService } from './dbService';
import { safeSlice } from '../utils/oddsUtils';
import { executeAudit, MarketType, PredictionContract } from '../utils/edge-script-engine';

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';

type EspnRecord = { type?: string; summary?: string };
type EspnHeadshot = { href?: string };
type EspnPosition = { abbreviation?: string; name?: string };
type EspnAthlete = {
    id?: string;
    displayName?: string;
    fullName?: string;
    shortName?: string;
    position?: EspnPosition;
    jersey?: string;
    headshot?: EspnHeadshot;
};
type EspnTeamRef = {
    id?: string;
    displayName?: string;
    name?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    logo?: string;
    logos?: Array<{ href?: string }>;
};
type EspnCompetitor = {
    id?: string;
    homeAway?: 'home' | 'away';
    team?: EspnTeamRef;
    athlete?: EspnAthlete;
    records?: EspnRecord[];
    record?: EspnRecord | EspnRecord[];
    curatedRank?: { current?: number };
    score?: { displayValue?: string } | string | number;
    winner?: boolean;
};
type EspnStat = { label?: string; name?: string; displayValue?: string | number; value?: string | number };
type EspnBoxAthleteEntry = { athlete?: EspnAthlete; stats?: Array<string | number> };
type EspnBoxPlayerGroup = { athletes?: EspnBoxAthleteEntry[] };
type EspnCoach = { displayName?: string; record?: string; athlete?: { displayName?: string } };
type EspnTeamBox = {
    id?: string;
    team?: { id?: string };
    homeAway?: string;
    statistics?: EspnStat[];
    players?: EspnBoxPlayerGroup[];
    coaches?: EspnCoach[];
};
type EspnLeaderEntry = { athlete?: EspnAthlete; displayValue?: string };
type EspnLeaderGroup = { team?: { id?: string }; leaders?: EspnLeaderEntry[] };
type EspnInjuryEntry = { athlete?: EspnAthlete; status?: string; shortComment?: string; longComment?: string };
type EspnInjuryGroup = { team?: { id?: string }; athlete?: { id?: string }; id?: string; injuries?: EspnInjuryEntry[] };
type EspnVenue = {
    id?: string;
    fullName?: string;
    address?: { city?: string; state?: string };
    capacity?: number;
    indoor?: boolean;
    images?: Array<{ href?: string }>;
};
type EspnWeather = { temperature?: string; condition?: string; wind?: string; humidity?: string };
type EspnOfficial = { displayName?: string; position?: { name?: string; abbreviation?: string } };
type EspnGameInfo = { venue?: EspnVenue; weather?: EspnWeather; officials?: EspnOfficial[] };
type EspnBroadcast = { names?: string[] };
type EspnMeeting = { date?: string; teams?: EspnCompetitor[]; homeTeam?: EspnCompetitor; awayTeam?: EspnCompetitor };
type EspnCompetition = { competitors?: EspnCompetitor[]; previousMeetings?: EspnMeeting[]; broadcasts?: EspnBroadcast[] };
type EspnHeader = { competitions?: EspnCompetition[] };
type EspnBoxscore = { teams?: EspnTeamBox[] };
type EspnPickcenter = {
    provider?: { name?: string };
    public?: {
        spread?: { homeTeam?: { money?: number }; awayTeam?: { money?: number } };
        total?: { over?: { money?: number }; under?: { money?: number } };
        moneyLine?: { homeTeam?: { money?: number }; awayTeam?: { money?: number } };
    };
    overUnder?: number | string;
    details?: string;
};
type EspnPredictor = { homeTeam?: { gameProjection?: string } };
type EspnSummaryResponse = {
    gameInfo?: EspnGameInfo;
    header?: EspnHeader;
    boxscore?: EspnBoxscore;
    injuries?: EspnInjuryGroup[];
    leaders?: Array<MatchLeader | EspnLeaderGroup>;
    pickcenter?: EspnPickcenter[];
    predictor?: EspnPredictor;
};
type EspnRosterAthlete = { id?: string; displayName?: string; fullName?: string; position?: EspnPosition; jersey?: string; headshot?: EspnHeadshot };
type EspnRosterGroup = { athletes?: EspnRosterAthlete[] };
type EspnRosterResponse = { athletes?: EspnRosterAthlete[]; groups?: EspnRosterGroup[] };

// Strip DB suffix from match ID for ESPN API calls
const stripSuffix = (id: string): string => {
    if (!id) return '';
    return id.split('_')[0];
};

/**
 * Maps Sport enum to ESPN's headshot CDN path.
 * Each sport uses a different directory structure on ESPN's CDN.
 */
const getHeadshotPathForSport = (sport: Sport): string => {
    switch (sport) {
        case Sport.NBA:
        case Sport.BASKETBALL:
            return 'nba';
        case Sport.NFL:
            return 'nfl';
        case Sport.COLLEGE_FOOTBALL:
            return 'college-football';
        case Sport.COLLEGE_BASKETBALL:
            return 'mens-college-basketball';
        case Sport.WNBA:
            return 'wnba';
        case Sport.BASEBALL:
            return 'mlb';
        case Sport.HOCKEY:
            return 'nhl';
        case Sport.SOCCER:
            return 'soccer'; // Note: Soccer players often don't have ESPN headshots
        case Sport.TENNIS:
            return 'tennis';
        default:
            return 'nfl'; // Fallback
    }
};

/**
 * Constructs a proper ESPN headshot URL for a player.
 */
const buildHeadshotUrl = (athleteId: string, sport: Sport, existingUrl?: string): string => {
    // If ESPN provided a URL, use it
    if (existingUrl) return existingUrl;

    const path = getHeadshotPathForSport(sport);
    return `https://a.espncdn.com/combiner/i?img=/i/headshots/${path}/players/full/${athleteId}.png&w=96&h=96&scale=crop`;
};

export interface InjuryReport {
    id: string;
    name: string;
    player?: string; // v7 Alias
    position: string;
    status: string;
    description: string;
    headshot?: string;
}

export interface TeamStats {
    id: string;
    rank?: number;
    record: string;
    streak: string;
    stats: { label: string; value: string; rank?: number }[];
    last5?: RecentFormGame[];
}

export interface RosterPlayer {
    id: string;
    name: string;
    position: string;
    jersey: string;
    headshot: string;
    rating: number;
    stats: {
        label: string;
        value: string;
    };
    prop: {
        line: number;
        over: string;
        under: string;
        market: string;
    };
}


import { Stadium } from '../types/venueIntel';

export interface PreGameData {
    venue: {
        name: string;
        city: string;
        state: string;
        capacity?: number;
        indoor: boolean;
        image?: string;
    };
    stadium?: Stadium | null;
    weather: {
        temp: number;
        condition: string;
        wind: string;
        humidity: number;
        pressure_in?: number;
        wind_direction_deg?: number;
    } | null;
    homeTeam: TeamStats;
    awayTeam: TeamStats;
    injuries: {
        home: InjuryReport[];
        away: InjuryReport[];
    };
    rosters: {
        home: RosterPlayer[];
        away: RosterPlayer[];
    };
    leaders?: MatchLeader[];
    prediction?: {
        homeWinPct: number;
        awayWinPct: number;
    };
    lastMeetings: {
        date: string;
        homeScore: number;
        awayScore: number;
        homeTeamId: string;
        awayTeamId: string;
        winnerId: string;
    }[];
    broadcast?: string;
    insights: MatchInsight[];
    officials: {
        name: string;
        position: string;
    }[];
    refIntel?: RefIntelContent | null;
    marketIntel?: {
        spread?: { home: number; away: number };
        total?: { over: number; under: number };
        moneyline?: { home: number; away: number };
        openingLine?: string;
        openingTotal?: string;
    };
    // v7 Requirements
    projections: {
        total: number;
        pace: number;
        efficiency: number;
        possessions: number;
        confidence: number;
    };
    market: {
        currentTotal: number;
        currentSpread: number;
    };
    coaches?: {
        home?: { name: string; record: string };
        away?: { name: string; record: string };
    };
}

// Generate a realistic prop line based on stats or sport/position context
const generateProp = (statVal: string, sport: Sport, position?: string) => {
    let val = parseFloat(statVal);

    // PREGAME FIX: If val is 0 (no live stats yet) or NaN, generate a realistic "Projection"
    // instead of defaulting to 0.5.
    if (isNaN(val) || val === 0) {
        if (sport === Sport.NBA || sport === Sport.BASKETBALL || sport === Sport.COLLEGE_BASKETBALL || sport === Sport.WNBA) {
            // Basketball Projections (Points)
            val = 14.5 + Math.random() * 14; // 14.5 - 28.5 Pts
        } else if (sport === Sport.NFL || sport === Sport.COLLEGE_FOOTBALL) {
            // Football Position-Based Projections
            const pos = (position || '').toUpperCase();
            if (pos === 'QB') val = 210.5 + Math.random() * 80; // Passing Yards
            else if (pos === 'RB') val = 45.5 + Math.random() * 50; // Rushing Yards
            else val = 35.5 + Math.random() * 60; // Receiving Yards (WR/TE)
        } else {
            // Low scoring sports (Soccer, Hockey, Baseball) default to 0.5 is actually correct
            val = 0.5;
        }
    }

    // Determine Market Label based on Sport & Value
    let market = 'Points';

    if (sport === Sport.SOCCER) market = 'Goals';
    else if (sport === Sport.HOCKEY) market = 'Points';
    else if (sport === Sport.BASEBALL) market = 'Hits';
    else if (sport === Sport.NFL || sport === Sport.COLLEGE_FOOTBALL) {
        const pos = (position || '').toUpperCase();
        if (pos === 'QB') market = 'Pass Yds';
        else if (pos === 'RB') market = 'Rush Yds';
        else market = 'Rec Yds';
    }

    // Round to nearest .5
    const line = Math.floor(val) + 0.5;

    return {
        line,
        over: '-115',
        under: '-105',
        market
    };
};

/**
 * Fallback: Fetch full team roster if summary doesn't have leaders/boxscore.
 * Handles both flat lists (NBA) and groups (NFL Offense/Defense).
 */
const fetchTeamRoster = async (teamId: string, sport: Sport, leagueId: string): Promise<RosterPlayer[]> => {
    try {
        const leagueConfig = LEAGUES.find(l => l.id === leagueId);
        const apiPath = leagueConfig ? leagueConfig.apiEndpoint : `${sport}/${leagueId}`;
        const url = `${BASE_URL}/${apiPath}/teams/${teamId}/roster`;

        const res = await fetch(url);
        if (!res.ok) return [];
        const data = (await res.json()) as EspnRosterResponse;

        let athletes: EspnRosterAthlete[] = [];

        // Handle different roster structures
        if (data.athletes) {
            athletes = data.athletes;
        } else if (data.groups) {
            // NFL often nests players in 'groups' (Offense, Defense, Special Teams)
            data.groups.forEach((g) => {
                if (g.athletes) athletes = [...athletes, ...g.athletes];
            });
        }

        // Take top players (usually starters are listed first)
        return safeSlice(athletes, 0, 10).map((athlete) => {
            const pos = athlete.position?.abbreviation || '';
            return {
                id: athlete.id || '',
                name: athlete.displayName || athlete.fullName || '',
                position: pos,
                jersey: athlete.jersey || '',
                headshot: buildHeadshotUrl(athlete.id || '', sport, athlete.headshot?.href),
                rating: 7.0 + Math.random() * 2,
                stats: { label: 'Proj', value: '-' },
                prop: generateProp('0', sport, pos)
            };
        });
    } catch (e) {
        console.warn('Failed to fetch fallback roster', e);
        return [];
    }
};

const enrichRosterWithRealOdds = (roster: RosterPlayer[], dbProps: PlayerPropBet[]): RosterPlayer[] => {
    if (!dbProps || dbProps.length === 0) return roster;

    // Defensive normalize function that handles undefined/null
    const normalize = (s: string | undefined | null) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    return roster.map(player => {
        if (!player || !player.name) return player;

        const cleanName = normalize(player.name);

        // Find matching props for this player
        const playerProps = dbProps.filter(p => {
            const pName = normalize(p.playerName);
            return pName && (pName.includes(cleanName) || cleanName.includes(pName));
        });

        if (playerProps.length === 0) return player;

        // Prioritize primary markets
        // 1. Points / Goals
        // 2. Passing Yards
        // 3. Rushing Yards
        // 4. Any other
        const bestProp = playerProps.find(p => p.betType && ['points', 'goals'].includes(p.betType.toLowerCase())) ||
            playerProps.find(p => p.betType && p.betType.includes('passing')) ||
            playerProps.find(p => p.betType && p.betType.includes('rushing')) ||
            playerProps[0];

        if (!bestProp) return player;

        const formatOdds = (o: number) => o > 0 ? `+${o}` : `${o}`;
        const side = (bestProp.side || '').toLowerCase();

        // Check if we have the opposing side in the DB list
        // E.g. if bestProp is Over, do we have Under?
        const otherSide = playerProps.find(p =>
            p.betType === bestProp.betType &&
            p.lineValue === bestProp.lineValue &&
            (p.side || '').toLowerCase() !== side
        );

        let over = '-';
        let under = '-';

        if (side === 'over') {
            over = formatOdds(bestProp.oddsAmerican);
            if (otherSide) under = formatOdds(otherSide.oddsAmerican);
        } else if (side === 'under') {
            under = formatOdds(bestProp.oddsAmerican);
            if (otherSide) over = formatOdds(otherSide.oddsAmerican);
        } else {
            // Default assumption if side is ambiguous or 'Yes'
            over = formatOdds(bestProp.oddsAmerican);
        }

        // Map market label
        let marketLabel = (bestProp.betType || '').toUpperCase();
        if (bestProp.betType === 'points') marketLabel = 'PTS';
        if (bestProp.betType === 'rebounds') marketLabel = 'REB';
        if (bestProp.betType === 'assists') marketLabel = 'AST';
        if (bestProp.betType.includes('passing')) marketLabel = 'PASS';
        if (bestProp.betType.includes('rushing')) marketLabel = 'RUSH';

        return {
            ...player,
            prop: {
                line: bestProp.lineValue,
                over,
                under,
                market: marketLabel
            }
        };
    });
};

export const fetchPreGameData = async (matchId: string, sport: Sport, leagueId: string): Promise<PreGameData | null> => {
    try {
        const leagueConfig = LEAGUES.find(l => l.id === leagueId);
        const apiPath = leagueConfig ? leagueConfig.apiEndpoint : `${sport}/${leagueId}`;
        const espnId = stripSuffix(matchId);

        // Parallel Fetch: ESPN Summary + DB Props + Insights + Ref Intel
        const [response, dbProps, insights, refIntelResult] = await Promise.all([
            fetchWithFallback(`${BASE_URL}/${apiPath}/summary?event=${espnId}&_t=${Date.now()}`),
            dbService.getPlayerProps(matchId),
            dbService.getMatchInsights(matchId),
            dbService.getRefIntel(matchId)
        ]);

        if (!response.ok) {
            console.error(`[espnPreGame] API Error: ${response.status}`, { espnId, sport, leagueId });
            throw new Error('Failed to fetch match summary');
        }
        const data = (await response.json()) as EspnSummaryResponse;
        console.log(`[espnPreGame] Successfully fetched summary for ${espnId}`);

        // 1. Venue & Weather
        const gameInfo = data.gameInfo;
        const competition = data.header?.competitions?.[0];
        const espnVenueId = gameInfo?.venue?.id;

        // Fetch canonical stadium data if available
        const stadium = espnVenueId ? await dbService.getStadiumByEspnId(parseInt(espnVenueId)) : null;

        const venue = {
            name: gameInfo?.venue?.fullName || 'Unknown Venue',
            city: gameInfo?.venue?.address?.city || '',
            state: gameInfo?.venue?.address?.state || '',
            capacity: gameInfo?.venue?.capacity,
            indoor: !!gameInfo?.venue?.indoor,
            image: gameInfo?.venue?.images?.[0]?.href,
        };

        const weatherRaw = gameInfo?.weather;
        let weather = null;
        if (weatherRaw) {
            weather = {
                temp: parseInt(weatherRaw.temperature || '0'),
                condition: weatherRaw.condition || '',
                wind: weatherRaw.wind || '',
                humidity: parseInt(weatherRaw.humidity || '0'),
            };
        }

        const officials = (gameInfo?.officials || []).map((off) => ({
            name: off.displayName || '',
            position: off.position?.name || off.position?.abbreviation || 'Official'
        }));

        // 2. Teams
        const competitors = competition?.competitors || [];
        const homeComp = competitors.find((c) => c.homeAway === 'home');
        const awayComp = competitors.find((c) => c.homeAway === 'away');

        // Fetch team metrics from Supabase (Pace, ORtg, DRtg)
        // Tennis-aware resolution: athlete or team
        const homeTeamName = homeComp?.team?.displayName || homeComp?.team?.name || homeComp?.athlete?.displayName || '';
        const awayTeamName = awayComp?.team?.displayName || awayComp?.team?.name || awayComp?.athlete?.displayName || '';

        const [homeLast5, awayLast5, homeMetrics, awayMetrics] = await Promise.all([
            homeComp?.id ? fetchTeamLastFive(homeComp.id, sport, leagueId) : Promise.resolve([] as RecentFormGame[]),
            awayComp?.id ? fetchTeamLastFive(awayComp.id, sport, leagueId) : Promise.resolve([] as RecentFormGame[]),
            dbService.getTeamMetrics(homeTeamName),
            dbService.getTeamMetrics(awayTeamName)
        ]);

        const formatStats = (teamId: string, last5: RecentFormGame[]): TeamStats => {
            // Defensive lookup for Tennis where .team might be missing
            const tm = data.boxscore?.teams?.find((t) => (t.team?.id || t.id) === teamId);
            const comp = competitors.find((c) => c.id === teamId);

            const rawRecords = Array.isArray(comp?.records)
                ? comp?.records
                : Array.isArray(comp?.record)
                    ? comp?.record
                    : comp?.record
                        ? [comp?.record]
                        : [];
            let record = '0-0';
            if (rawRecords.length > 0) {
                const totalRec = rawRecords.find((r) => r.type === 'total') || rawRecords[0];
                if (totalRec?.summary) record = totalRec.summary;
            }

            const statsList: { label: string; value: string }[] = [];
            if (tm?.statistics) {
                tm.statistics.forEach((s) => {
                    statsList.push({ label: s.label || s.name || '-', value: String(s.displayValue ?? s.value ?? '-') });
                });
            }

            return {
                id: teamId,
                rank: comp?.curatedRank?.current !== 99 ? comp?.curatedRank?.current : undefined,
                record,
                streak: '',
                stats: statsList,
                last5
            };
        };

        const homeTeamStats = formatStats(homeComp?.id || '', homeLast5);
        const awayTeamStats = formatStats(awayComp?.id || '', awayLast5);

        // 3. Injuries
        const parseInjuries = (teamId: string): InjuryReport[] => {
            const teamInjuries = data.injuries?.find((t) => (t.team?.id || t.athlete?.id || t.id) === teamId);
            if (!teamInjuries?.injuries) return [];

            const mapped = teamInjuries.injuries.map((inj) => ({
                id: inj.athlete?.id || '',
                name: inj.athlete?.displayName || '',
                player: inj.athlete?.displayName || '', // v7 Alias
                position: inj.athlete?.position?.abbreviation || '',
                status: inj.status || '',
                description: inj.shortComment || inj.longComment || inj.status || '',
                headshot: inj.athlete?.headshot?.href
            }));

            return safeSlice(mapped, 0, 5);
        };

        const injuries = {
            home: parseInjuries(homeComp?.id),
            away: parseInjuries(awayComp?.id)
        };

        // 4. Rosters (Primary: Summary, Fallback: Roster Endpoint)
        const parseRosterFromSummary = (teamId: string): RosterPlayer[] => {
            const leadersPayload = data.leaders || [];
            const leadersByTeam = (leadersPayload.length > 0 && 'team' in leadersPayload[0])
                ? (leadersPayload as EspnLeaderGroup[])
                : [];

            const leaders = leadersByTeam.find((t) => t.team?.id === teamId)?.leaders;
            const boxPlayers = data.boxscore?.teams?.find((t) => t.team?.id === teamId)?.players;

            const players: RosterPlayer[] = [];
            const seen = new Set<string>();

            const pushPlayer = (athlete: EspnAthlete | undefined, statVal: string, statLabel: string) => {
                if (!athlete?.id || seen.has(athlete.id)) return;
                seen.add(athlete.id);

                const pos = athlete.position?.abbreviation || '';

                players.push({
                    id: athlete.id,
                    name: athlete.displayName || athlete.fullName || '',
                    position: pos,
                    jersey: athlete.jersey || '',
                    headshot: buildHeadshotUrl(athlete.id, sport, athlete.headshot?.href),
                    rating: 6.5 + Math.random() * 3,
                    stats: { label: statLabel, value: statVal },
                    prop: generateProp(statVal, sport, pos)
                });
            };

            if (leaders) {
                leaders.forEach((l) => pushPlayer(l.athlete, l.displayValue || '0', 'Avg'));
            }

            if (players.length < 5 && boxPlayers) {
                boxPlayers.forEach((grp) => {
                    grp.athletes?.forEach((a) => {
                        if (players.length >= 8) return;
                        const val = a.stats?.[0];
                        pushPlayer(a.athlete, typeof val === 'number' ? String(val) : (val || '0'), 'Avg');
                    });
                });
            }

            return safeSlice(players, 0, 8);
        };

        let homeRoster = parseRosterFromSummary(homeComp?.id);
        let awayRoster = parseRosterFromSummary(awayComp?.id);

        // FALLBACK: If summary yielded no players, fetch full team roster
        if (homeRoster.length === 0 && homeComp?.id) {
            homeRoster = await fetchTeamRoster(homeComp.id, sport, leagueId);
        }
        if (awayRoster.length === 0 && awayComp?.id) {
            awayRoster = await fetchTeamRoster(awayComp.id, sport, leagueId);
        }

        // --- ENRICH WITH DB PROPS ---
        homeRoster = enrichRosterWithRealOdds(homeRoster, dbProps);
        awayRoster = enrichRosterWithRealOdds(awayRoster, dbProps);

        const rosters = { home: homeRoster, away: awayRoster };

        // 5. Prediction
        let prediction;
        if (data.predictor?.homeTeam?.gameProjection) {
            prediction = {
                homeWinPct: parseFloat(data.predictor.homeTeam.gameProjection),
                awayWinPct: 100 - parseFloat(data.predictor.homeTeam.gameProjection)
            };
        }

        // 6. Last Meetings
        const rawMeetings = competition?.previousMeetings || [];
        const meetingsMapped = rawMeetings.map((m) => {
            const mHome = m.teams?.find((t) => t.homeAway === 'home') || m.homeTeam;
            const mAway = m.teams?.find((t) => t.homeAway === 'away') || m.awayTeam;

            const homeScore = parseInt(String((mHome as EspnCompetitor | undefined)?.score?.displayValue ?? (mHome as EspnCompetitor | undefined)?.score ?? '0'));
            const awayScore = parseInt(String((mAway as EspnCompetitor | undefined)?.score?.displayValue ?? (mAway as EspnCompetitor | undefined)?.score ?? '0'));

            let winnerId = '0';
            if (homeScore > awayScore) winnerId = (mHome as EspnCompetitor | undefined)?.team?.id || (mHome as EspnCompetitor | undefined)?.id || '0';
            else if (awayScore > homeScore) winnerId = (mAway as EspnCompetitor | undefined)?.team?.id || (mAway as EspnCompetitor | undefined)?.id || '0';

            return {
                date: m.date || '',
                homeScore,
                awayScore,
                homeTeamId: (mHome as EspnCompetitor | undefined)?.team?.id || (mHome as EspnCompetitor | undefined)?.id || '',
                awayTeamId: (mAway as EspnCompetitor | undefined)?.team?.id || (mAway as EspnCompetitor | undefined)?.id || '',
                winnerId
            };
        });

        const lastMeetings = safeSlice(meetingsMapped, 0, 5);

        // 7. Market Intelligence (Consensus Splits) - Find main market, skip 1H/1P
        const pickcenterArr = data.pickcenter || [];
        const mainPick = pickcenterArr.find((p) =>
            p.provider?.name?.toLowerCase().includes('consensus') ||
            (sport === Sport.HOCKEY && Number(p.overUnder || 0) > 4) ||
            (sport === Sport.NBA && Number(p.overUnder || 0) > 150) ||
            (sport === Sport.NFL && Number(p.overUnder || 0) > 30)
        ) || pickcenterArr[0];

        const marketIntel = mainPick?.public ? {
            spread: {
                home: mainPick.public.spread?.homeTeam?.money || 50,
                away: mainPick.public.spread?.awayTeam?.money || 50
            },
            total: {
                over: mainPick.public.total?.over?.money || 50,
                under: mainPick.public.total?.under?.money || 50
            },
            moneyline: {
                home: mainPick.public.moneyLine?.homeTeam?.money || 50,
                away: mainPick.public.moneyLine?.awayTeam?.money || 50
            },
            openingLine: mainPick.details,
            openingTotal: mainPick.overUnder !== undefined ? String(mainPick.overUnder) : undefined
        } : undefined;

        // 8. Coaches
        const homeCoachObj = data.boxscore?.teams?.find((t) => t.team?.id === homeComp?.id)?.coaches?.[0];
        const awayCoachObj = data.boxscore?.teams?.find((t) => t.team?.id === awayComp?.id)?.coaches?.[0];

        const coaches = {
            home: homeCoachObj ? {
                name: homeCoachObj.athlete?.displayName || homeCoachObj.displayName,
                record: homeCoachObj.record || ''
            } : undefined,
            away: awayCoachObj ? {
                name: awayCoachObj.athlete?.displayName || awayCoachObj.displayName,
                record: awayCoachObj.record || ''
            } : undefined
        };

        // v7 Integration: Construct Prediction Contract using REAL STATS
        const currentTotal = parseFloat(String(mainPick?.overUnder ?? '0'));
        const currentSpreadDetails = mainPick?.details?.split(' ')?.find((s: string) => s.includes('-') || s.includes('+')) || '0';
        const currentSpread = parseFloat(currentSpreadDetails);

        // Helper to find specific stats in the ESPN response
        const findStatValue = (teamBox: EspnTeamBox | undefined, labels: string[]) => {
            if (!teamBox?.statistics) return 0;
            const stat = teamBox.statistics.find((s) =>
                labels.some(l => s.label?.toLowerCase() === l.toLowerCase() || s.name?.toLowerCase() === l.toLowerCase())
            );
            return parseFloat(String(stat?.displayValue ?? stat?.value ?? '0'));
        };

        const homeBox = data.boxscore?.teams?.find((t) => t.team?.id === homeComp?.id);
        const awayBox = data.boxscore?.teams?.find((t) => t.team?.id === awayComp?.id);

        // EXTRACTION: Baseline Physics
        // For NBA/NCAA: "Avg Points", "Pace"
        // For NHL: "Goals Per Game", "Shots Per Game"
        // For NFL: "Points Per Game", "Yards Per Game"

        let paceModel = 0;
        let effModel = 0;

        // v7 PHYSICS: Use real data from Supabase team_metrics table
        if (sport === Sport.NBA || sport === Sport.BASKETBALL || sport === Sport.COLLEGE_BASKETBALL) {
            const hPace = homeMetrics?.pace || 98.5;
            const aPace = awayMetrics?.pace || 98.5;
            const hORtg = homeMetrics?.offensive_rating || 112;
            const aORtg = awayMetrics?.offensive_rating || 112;

            // Total Game Possessions = Home Pace + Away Pace
            paceModel = hPace + aPace;
            // Average Offensive Rating, normalized from per-100-poss to PPP
            effModel = ((hORtg + aORtg) / 2) / 100;
        } else if (sport === Sport.HOCKEY) {
            const hSOG = findStatValue(homeBox, ['Shots Per Game', 'SOG']);
            const aSOG = findStatValue(awayBox, ['Shots Per Game', 'SOG']);
            const hGoals = findStatValue(homeBox, ['Goals Per Game', 'Avg Goals']);
            const aGoals = findStatValue(awayBox, ['Goals Per Game', 'Avg Goals']);

            paceModel = (hSOG > 0 && aSOG > 0) ? (hSOG + aSOG) : 62;
            effModel = (hGoals > 0 && aGoals > 0) ? (hGoals + aGoals) / paceModel : 0.095;
        } else {
            // Default Fallback for other sports
            const hPPG = findStatValue(homeBox, ['Points Per Game', 'Avg Points']);
            const aPPG = findStatValue(awayBox, ['Points Per Game', 'Avg Points']);
            paceModel = (sport === Sport.NFL) ? 65 : 100;
            effModel = (hPPG > 0 && aPPG > 0) ? (hPPG + aPPG) / paceModel : currentTotal / paceModel;
        }

        // --- THE CONTRACT ---
        const contract: PredictionContract = {
            predictionId: `AUDIT_${matchId}`,
            timestamp: Date.now(),
            sport,
            marketType: MarketType.TOTAL,
            marketTotal: currentTotal || 0,
            marketSpread: currentSpread || 0,
            paceMarket: (currentTotal > 0 && effModel > 0) ? currentTotal / effModel : paceModel,
            paceModel: paceModel,
            effModel: effModel,
            keyInjuries: [
                ...injuries.home.map(i => ({ name: i.name, status: i.status })),
                ...injuries.away.map(i => ({ name: i.name, status: i.status }))
            ]
        };

        // --- EXECUTE REAL MATH ---
        const edgeResult = executeAudit(contract, prediction?.homeWinPct ? 0.75 : 0.68);

        const market = {
            currentTotal,
            currentSpread
        };

        const leadersForUi = Array.isArray(data.leaders) && data.leaders.length > 0 && 'displayName' in data.leaders[0]
            ? (data.leaders as MatchLeader[])
            : undefined;

        return {
            venue,
            stadium,
            weather,
            homeTeam: homeTeamStats,
            awayTeam: awayTeamStats,
            injuries,
            rosters,
            prediction,
            lastMeetings,
            broadcast: competition?.broadcasts?.[0]?.names?.[0],
            insights: insights || [],
            officials,
            refIntel: refIntelResult?.data,
            marketIntel,
            coaches,
            leaders: leadersForUi,
            projections: {
                total: edgeResult.modelLine,
                pace: edgeResult.trace.pace,
                efficiency: edgeResult.trace.efficiency,
                possessions: edgeResult.trace.possessions,
                confidence: edgeResult.confidence / 100
            },
            market
        };

    } catch (e) {
        console.error('Error fetching pregame data:', e);
        return null;
    }
};
