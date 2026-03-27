import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

declare const Deno: any;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NBA Backfill Drain — Patches 6 days of missing postgame data
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

function fmt(d: Date): string {
  return d.toISOString().split('T')[0].replace(/-/g, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeFetch(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function extractClosingOdds(comp: any): any {
  const odds = comp?.odds;
  if (!Array.isArray(odds) || odds.length === 0) return null;
  const p = odds[0];
  if (!p) return null;

  const total = p.overUnder;
  const homeML = p.homeTeamOdds?.moneyLine;
  const awayML = p.awayTeamOdds?.moneyLine;
  const details = p.details || '';

  let spreadHome: string | null = null;
  let spreadAway: string | null = null;
  if (details) {
    const m = details.match(/([-+]?\d+\.?\d*)/);
    if (m) {
      const val = parseFloat(m[1]);
      spreadAway = details.includes('-') ? `-${val}` : `+${val}`;
      spreadHome = details.includes('-') ? `+${val}` : `-${val}`;
    }
  }

  return {
    provider: p.provider?.name || 'ESPN',
    total, total_value: total,
    home_ml: homeML != null ? String(homeML) : null,
    away_ml: awayML != null ? String(awayML) : null,
    spread_home: spreadHome,
    spread_away: spreadAway,
    spread_home_value: spreadHome ? parseFloat(spreadHome) : null,
    captured_at: new Date().toISOString(),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const url = new URL(req.url);
  const startDate = url.searchParams.get('start') || '2026-03-20';
  const endDate = url.searchParams.get('end') || '2026-03-26';
  const fixTrigger = url.searchParams.get('fix_trigger') !== 'false';

  const t0 = Date.now();

  try {
    // Step 0: Test if writes work (game_recaps trigger may block)
    console.log('Testing write access...');

    let totalGames = 0;
    let updatedScores = 0;
    let updatedOdds = 0;
    const errors: string[] = [];
    const results: any[] = [];

    const current = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T23:59:59Z');

    while (current <= end) {
      const dateStr = fmt(current);
      const displayDate = current.toISOString().split('T')[0];

      try {
        const data = await safeFetch(`${ESPN_BASE}?dates=${dateStr}&limit=100`);
        const events = data.events || [];

        for (const event of events) {
          const comp = event.competitions?.[0];
          if (!comp) continue;

          const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
          const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
          if (!home || !away) continue;

          const matchId = `${event.id}_nba`;
          const status = comp.status?.type?.name;
          const homeScore = parseInt(home.score || '0');
          const awayScore = parseInt(away.score || '0');
          const homeName = home.team?.displayName || '?';
          const awayName = away.team?.displayName || '?';

          totalGames++;

          if (status === 'STATUS_FINAL') {
            const patch: any = {
              status: 'STATUS_FINAL',
              home_score: homeScore,
              away_score: awayScore,
              updated_at: new Date().toISOString(),
            };

            const closingOdds = extractClosingOdds(comp);
            if (closingOdds && (closingOdds.total || closingOdds.home_ml)) {
              patch.closing_odds = closingOdds;
            }

            const { error } = await supabase
              .from('matches')
              .update(patch)
              .eq('id', matchId);

            if (error) {
              errors.push(`${matchId}: ${error.message}`);
              results.push({ date: displayDate, game: `${awayName}@${homeName}`, status: 'FAIL', error: error.message });
            } else {
              updatedScores++;
              if (closingOdds?.total) updatedOdds++;
              results.push({
                date: displayDate,
                game: `${awayName} ${awayScore} @ ${homeName} ${homeScore}`,
                status: 'OK',
                odds: closingOdds?.total ? `O/U ${closingOdds.total}` : null,
              });
            }
          }
        }
      } catch (e: any) {
        errors.push(`${displayDate}: ${e.message}`);
      }

      current.setDate(current.getDate() + 1);
      await sleep(300);
    }

    return new Response(JSON.stringify({
      success: errors.length === 0 || updatedScores > 0,
      totalGames,
      updatedScores,
      updatedOdds,
      errorsCount: errors.length,
      durationMs: Date.now() - t0,
      results: results.slice(0, 100),
      errors: errors.slice(0, 20),
    }, null, 2), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack?.slice(0, 500) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
