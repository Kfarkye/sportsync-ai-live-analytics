
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// SRE Structured Logger - No Silent Failures
const Logger = {
  info: (event: string, data: Record<string, any> = {}) => console.log(JSON.stringify({ level: 'INFO', ts: new Date().toISOString(), event, ...data })),
  warn: (event: string, data: Record<string, any> = {}) => console.warn(JSON.stringify({ level: 'WARN', ts: new Date().toISOString(), event, ...data })),
  error: (event: string, data: Record<string, any> = {}) => console.error(JSON.stringify({ level: 'ERROR', ts: new Date().toISOString(), event, ...data })),
};

const CONFIG = {
  espn: {
    baseUrl: 'https://site.api.espn.com/apis/site/v2/sports',
    timeout: 15000,
    daysAhead: 10, // Increased to capture full playoff schedule
  }
}

const MONITORED_LEAGUES = [
  { sport: 'football', league: 'nfl' },
  { sport: 'football', league: 'college-football' },
  { sport: 'basketball', league: 'nba' },
  { sport: 'basketball', league: 'mens-college-basketball' },
  { sport: 'baseball', league: 'mlb' },
  { sport: 'hockey', league: 'nhl' },
  { sport: 'soccer', league: 'eng.1' },
  { sport: 'soccer', league: 'ita.1' },
  { sport: 'soccer', league: 'esp.1' },
  { sport: 'soccer', league: 'ger.1' },
];

const SUFFIX_MAP: Record<string, string> = {
  'nfl': '_nfl',
  'college-football': '_ncaaf',
  'nba': '_nba',
  'mens-college-basketball': '_ncaab',
  'mlb': '_mlb',
  'nhl': '_nhl',
  'eng.1': '_epl',
  'ita.1': '_seriea',
  'esp.1': '_laliga',
  'ger.1': '_bundesliga'
};

const mapStatus = (rawStatus: string) => {
  if (!rawStatus) return 'STATUS_SCHEDULED';
  const s = rawStatus.toUpperCase().replace(/\s/g, '_').replace(/\./g, '');
  if (['STATUS_FULL_TIME', 'FULL_TIME', 'FT', 'FINAL', 'STATUS_FINAL_PEN', 'STATUS_FINAL_OT'].includes(s)) return 'STATUS_FINAL';
  if (['HALFTIME', 'HT', 'STATUS_HALFTIME'].includes(s)) return 'STATUS_HALFTIME';
  if (['STATUS_IN_PROGRESS', 'IN_PROGRESS', 'LIVE'].includes(s)) return 'STATUS_IN_PROGRESS';
  return s.startsWith('STATUS_') ? s : `STATUS_${s}`;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const logs: any[] = [];
  const teamUpserts = new Map();
  const matchUpserts = new Map();

  try {
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + CONFIG.espn.daysAhead);
    const datesParam = `${today.toISOString().split('T')[0].replace(/-/g, '')}-${endDate.toISOString().split('T')[0].replace(/-/g, '')}`;

    // Parallel fetch leagues
    await Promise.all(MONITORED_LEAGUES.map(async ({ sport, league }) => {
      try {
        const groupsParam = league === 'mens-college-basketball' ? '&groups=50' : (league === 'college-football' ? '&groups=80' : '');
        const url = `${CONFIG.espn.baseUrl}/${sport}/${league}/scoreboard?limit=100&dates=${datesParam}${groupsParam}`;
        const res = await fetch(url);
        if (!res.ok) {
          Logger.warn('ESPN_FETCH_FAILED', { endpoint: 'espn-sync', league, status: res.status });
          return;
        }

        const data = await res.json();
        const events = data.events || [];
        const suffix = SUFFIX_MAP[league] || `_${sport}`;

        events.forEach((event: any) => {
          const comp = event.competitions?.[0];
          if (!comp) return;

          const home = comp.competitors.find((c: any) => c.homeAway === 'home');
          const away = comp.competitors.find((c: any) => c.homeAway === 'away');
          if (!home || !away) return;

          const matchId = `${event.id}${suffix}`;
          const hId = `${home.team.id}${suffix}`;
          const aId = `${away.team.id}${suffix}`;

          // Collect Teams
          [home.team, away.team].forEach(t => {
            const tid = `${t.id}${suffix}`;
            teamUpserts.set(tid, {
              id: tid,
              name: t.displayName,
              short_name: t.shortDisplayName,
              abbreviation: t.abbreviation,
              logo_url: t.logo,
              color: t.color,
              league_id: league
            });
          });

          // Collect Match
          const status = mapStatus(event.status.type.name);
          matchUpserts.set(matchId, {
            id: matchId,
            league_id: league,
            leagueId: league,
            home_team_id: hId,
            away_team_id: aId,
            home_team: home.team.displayName,
            away_team: away.team.displayName,
            homeTeam: home.team,
            awayTeam: away.team,
            start_time: event.date,
            startTime: event.date,
            status: status,
            period: event.status.period,
            display_clock: event.status.displayClock,
            home_score: parseInt(home.score || '0'),
            away_score: parseInt(away.score || '0'),
            last_updated: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        });
        logs.push({ league, count: events.length });
      } catch (e: any) {
        Logger.error('ESPN_LEAGUE_FETCH_ERROR', { endpoint: 'espn-sync', league, error: e.message });
        logs.push({ league, error: e.message });
      }
    }));

    // Perform Batch Upserts
    if (teamUpserts.size > 0) {
      const { error: tErr } = await supabase.from('teams').upsert(Array.from(teamUpserts.values()), { onConflict: 'id' });
      if (tErr) {
        Logger.error('BATCH_TEAM_UPSERT_FAILED', { endpoint: 'espn-sync', count: teamUpserts.size, error: tErr.message });
        logs.push({ event: "batch_team_error", error: tErr.message });
      } else {
        Logger.info('BATCH_TEAM_UPSERT_SUCCESS', { endpoint: 'espn-sync', count: teamUpserts.size });
      }
    }

    // --- SRE: Monotonicity Guard ---
    // Fetch existing live states to prevent stale scoreboard reversions
    interface MatchState {
      id: string;
      home_score: number | null;
      away_score: number | null;
      status: string | null;
    }

    const { data: existingMatches } = await supabase
      .from('matches')
      .select('id, home_score, away_score, status')
      .in('id', Array.from(matchUpserts.keys()));

    const existingMap = new Map<string, MatchState>((existingMatches as MatchState[] | null)?.map(m => [m.id, m]));

    matchUpserts.forEach((update, id) => {
      const existing = existingMap.get(id);
      if (existing) {
        const isLive = ['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'LIVE', 'IN_PROGRESS', 'HALFTIME'].some(k => existing.status?.toUpperCase().includes(k));

        // If live and not finalizing, enforce monotonicity
        if (isLive && update.status !== 'STATUS_FINAL') {
          const homeDowngrade = (existing.home_score || 0) > update.home_score;
          const awayDowngrade = (existing.away_score || 0) > update.away_score;

          if (homeDowngrade || awayDowngrade) {
            Logger.warn('MONOTONICITY_GUARD_TRIGGERED', {
              matchId: id,
              db: `${existing.home_score}-${existing.away_score}`,
              stale_scoreboard: `${update.home_score}-${update.away_score}`
            });
            update.home_score = Math.max(update.home_score, existing.home_score || 0);
            update.away_score = Math.max(update.away_score, existing.away_score || 0);
          }
        }
      }
    });

    if (matchUpserts.size > 0) {
      const { error: mErr } = await supabase.from('matches').upsert(Array.from(matchUpserts.values()), { onConflict: 'id' });
      if (mErr) {
        Logger.error('BATCH_MATCH_UPSERT_FAILED', { endpoint: 'espn-sync', count: matchUpserts.size, error: mErr.message });
        logs.push({ event: "batch_match_error", error: mErr.message });
      } else {
        Logger.info('BATCH_MATCH_UPSERT_SUCCESS', { endpoint: 'espn-sync', count: matchUpserts.size });
      }
    }

    return new Response(JSON.stringify({ success: true, matches: matchUpserts.size, logs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    Logger.error('FATAL_ESPN_SYNC', { endpoint: 'espn-sync', error: err.message, stack: err.stack?.substring(0, 500) });
    return new Response(JSON.stringify({ error: err.message, logs }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
