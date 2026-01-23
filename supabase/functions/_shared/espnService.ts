// supabase/functions/_shared/espnService.ts

export const fetchAllMatches = async (leagues: any[], date: Date) => {
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  const promises = leagues.map(async (league: any) => {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.apiEndpoint}/scoreboard?dates=${dateStr}&limit=200`;
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.events || []).map((e: any) => transformEvent(e, league));
    } catch {
      return [];
    }
  });

  const results = await Promise.all(promises);
  return results.flat().sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
};

const transformEvent = (event: any, league: any) => {
  const c = event.competitions[0];
  const home = c.competitors.find((x: any) => x.homeAway === 'home');
  const away = c.competitors.find((x: any) => x.homeAway === 'away');
  
  return {
    id: event.id,
    leagueId: league.id,
    sport: league.sport,
    startTime: event.date,
    status: event.status.type.name,
    period: event.status.period,
    displayClock: event.status.displayClock,
    minute: event.status.displayClock, // Alias
    homeTeam: transformTeam(home),
    awayTeam: transformTeam(away),
    homeScore: parseInt(home.score || '0'),
    awayScore: parseInt(away.score || '0'),
    // Odds handled by fetch-matches
  };
};

const transformTeam = (comp: any) => ({
  id: comp.team.id,
  name: comp.team.displayName,
  shortName: comp.team.shortDisplayName || comp.team.abbreviation,
  abbreviation: comp.team.abbreviation,
  logo: comp.team.logo || comp.team.logos?.[0]?.href,
  color: comp.team.color,
  record: comp.records?.[0]?.summary
});
