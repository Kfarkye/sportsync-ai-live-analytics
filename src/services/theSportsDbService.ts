import { Team } from '@/types';

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json/3';

export const enrichTeamData = async (teamName: string): Promise<Partial<Team> | null> => {
  try {
    // TheSportsDB search endpoint
    const response = await fetch(`${BASE_URL}/searchteams.php?t=${encodeURIComponent(teamName)}`);
    const data = await response.json();

    if (data.teams && data.teams.length > 0) {
      const team = data.teams[0];
      return {
        stadiumThumb: team.strStadiumThumb || undefined,
        fanArt: team.strTeamFanart1 || team.strTeamFanart2 || undefined,
        stadium: team.strStadium || undefined,
        logo: team.strTeamBadge || undefined // Prefer high-res badge if available
      };
    }
    return null;
  } catch (error) {
    console.warn(`Failed to enrich data for ${teamName}`, error);
    return null;
  }
};