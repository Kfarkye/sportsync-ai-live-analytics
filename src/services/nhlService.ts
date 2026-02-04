
import { ShotEvent, HockeyGameData } from '../types';

const BASE_URL = 'https://api-web.nhle.com/v1';

// Helper to normalize team names for comparison (e.g. "Montreal Canadiens" -> "montreal")
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

const PROXIES = [
    (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
];

async function fetchWithFallback(url: string): Promise<any> {
    // Try direct first
    try {
        const res = await fetch(url);
        if (res.ok) return await res.json();
    } catch (e) {
        // Fall through to proxies
    }

    // Try proxies
    for (const proxy of PROXIES) {
        try {
            const proxyUrl = proxy(url);
            const res = await fetch(proxyUrl);
            if (res.ok) return await res.json();
        } catch (e) {
            continue;
        }
    }
    
    throw new Error(`Failed to fetch ${url}`);
}

export const fetchNhlGameDetails = async (homeTeamName: string, awayTeamName: string, date: Date): Promise<HockeyGameData | null> => {
  try {
    const dateStr = date.toISOString().split('T')[0];
    
    // 1. Fetch Schedule for the date to find the Game ID
    const scheduleData = await fetchWithFallback(`${BASE_URL}/score/${dateStr}`);

    if (!scheduleData || !scheduleData.games) return null;

    const game = scheduleData.games.find((g: unknown) => {
      const h = normalize(g.homeTeam.name.default);
      const a = normalize(g.awayTeam.name.default);
      const targetH = normalize(homeTeamName);
      
      // Check if our ESPN name is contained in NHL name or vice versa
      return h.includes(targetH) || targetH.includes(h);
    });

    if (!game) {
        return null;
    }

    // 2. Fetch Play-by-Play Data for coordinates
    const pbpData = await fetchWithFallback(`${BASE_URL}/gamecenter/${game.id}/play-by-play`);

    const shots: ShotEvent[] = [];

    // Parse plays
    if (pbpData.plays) {
        pbpData.plays.forEach((play: unknown) => {
            const type = play.typeDescKey;
            if (['goal', 'shot-on-goal', 'missed-shot', 'blocked-shot'].includes(type)) {
                if (play.details && typeof play.details.xCoord === 'number' && typeof play.details.yCoord === 'number') {
                    shots.push({
                        id: play.eventId,
                        x: play.details.xCoord,
                        y: play.details.yCoord,
                        type: type === 'goal' ? 'goal' : 'shot',
                        teamId: play.details.eventOwnerTeamId === game.homeTeam.id ? 'home' : 'away',
                        period: play.periodDescriptor.number,
                        timeInPeriod: play.timeInPeriod,
                        shooterName: play.details.shootingPlayerId ? `Player ${play.details.shootingPlayerId}` : 'Unknown'
                    });
                }
            }
        });
    }

    return {
        gameId: game.id.toString(),
        shots: shots,
        homeTeamAbbrev: game.homeTeam.abbrev,
        awayTeamAbbrev: game.awayTeam.abbrev
    };

  } catch (error) {
    // Fail silently to avoid cluttering logs for optional data
    return null;
  }
};
