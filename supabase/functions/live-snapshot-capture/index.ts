
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MONITORED_LEAGUES = [
  { sport: 'football', league: 'nfl' },
  { sport: 'basketball', league: 'nba' },
  { sport: 'hockey', league: 'nhl' },
  { sport: 'football', league: 'college-football' },
  { sport: 'basketball', league: 'mens-college-basketball' },
  { sport: 'soccer', league: 'eng.1' }, // EPL
  { sport: 'soccer', league: 'uefa.champions' }
];

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  const stats = { scanned: 0, captured: 0, errors: [] as string[] };

  try {
    for (const conf of MONITORED_LEAGUES) {
      try {
        // Fetch Live Scoreboard
        const url = `${ESPN_BASE_URL}/${conf.sport}/${conf.league}/scoreboard?limit=100&live=true`; 
        // Note: &live=true filters for live games on some ESPN endpoints, but we'll filter manually to be safe
        
        const res = await fetch(url);
        if (!res.ok) throw new Error(`ESPN API ${res.status}`);
        
        const data = await res.json();
        const events = data.events || [];
        
        const liveEvents = events.filter((e: any) => e.status?.type?.state === 'in');
        stats.scanned += liveEvents.length;

        const snapshots = [];

        for (const event of liveEvents) {
          const competition = event.competitions?.[0];
          if (!competition) continue;

          const home = competition.competitors?.find((c: any) => c.homeAway === 'home');
          const away = competition.competitors?.find((c: any) => c.homeAway === 'away');
          
          if (!home || !away) continue;

          // Extract Basic Score/Time
          const matchId = event.id;
          const homeScore = parseInt(home.score || '0');
          const awayScore = parseInt(away.score || '0');
          const period = event.status?.period || 0;
          const clock = event.status?.displayClock || '0:00';

          // Extract Odds
          const odds = competition.odds?.[0] || {};
          
          // Spread Parsing (Home perspective usually)
          let spread = null;
          if (odds.details) {
             // e.g. "BUF -3.0" or "-3.0"
             const parts = odds.details.match(/[-+]?\d+(\.\d+)?/);
             if (parts) spread = parseFloat(parts[0]);
          }

          // Total Parsing
          let total = null;
          if (odds.overUnder) {
             total = parseFloat(odds.overUnder);
          }

          // Moneyline Parsing
          // ESPN structure varies: odds.homeTeamOdds.moneyLine OR odds.moneyline.home.current.odds
          let homeML = null;
          let awayML = null;

          if (odds.moneyline) {
             homeML = odds.moneyline.home?.current?.odds ?? odds.moneyline.home?.open?.odds;
             awayML = odds.moneyline.away?.current?.odds ?? odds.moneyline.away?.open?.odds;
          }
          
          // Fallback to older structure
          if (!homeML && odds.homeTeamOdds) homeML = odds.homeTeamOdds.moneyLine;
          if (!awayML && odds.awayTeamOdds) awayML = odds.awayTeamOdds.moneyLine;

          snapshots.push({
            match_id: matchId,
            period: period,
            game_clock: clock,
            home_score: homeScore,
            away_score: awayScore,
            spread: spread,
            total: total,
            home_ml: homeML ? String(homeML) : null,
            away_ml: awayML ? String(awayML) : null,
            // Capture raw odds provider if available to track source
            provider: odds.provider?.name || null
          });
        }

        // Batch Insert
        if (snapshots.length > 0) {
          const { error } = await supabase.from('match_snapshots').insert(snapshots);
          if (error) throw error;
          stats.captured += snapshots.length;
        }

      } catch (err: any) {
        console.error(`Error processing ${conf.league}:`, err);
        stats.errors.push(`${conf.league}: ${err.message}`);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      duration: Date.now() - startTime,
      ...stats 
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
