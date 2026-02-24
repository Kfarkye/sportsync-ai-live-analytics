import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

declare const Deno: any;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── Structured Logger ────────────────────────────────────────────
const Logger = {
    info: (event: string, data: Record<string, any> = {}) =>
        console.log(JSON.stringify({ level: 'INFO', ts: new Date().toISOString(), event, ...data })),
    warn: (event: string, data: Record<string, any> = {}) =>
        console.warn(JSON.stringify({ level: 'WARN', ts: new Date().toISOString(), event, ...data })),
    error: (event: string, data: Record<string, any> = {}) =>
        console.error(JSON.stringify({ level: 'ERROR', ts: new Date().toISOString(), event, ...data })),
};

// ─── ESPN Config ──────────────────────────────────────────────────
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports';

const LEAGUE_MAP: Record<string, { sport: string; espn: string; suffix: string }> = {
    nba: { sport: 'basketball', espn: 'nba', suffix: '_nba' },
    nhl: { sport: 'hockey', espn: 'nhl', suffix: '_nhl' },
    nfl: { sport: 'football', espn: 'nfl', suffix: '_nfl' },
    mlb: { sport: 'baseball', espn: 'mlb', suffix: '_mlb' },
};

// ─── Types ────────────────────────────────────────────────────────
interface GameEvent {
    match_id: string;
    league_id: string;
    sport: string;
    event_type: string;
    sequence: number;
    period: number | null;
    clock: string | null;
    home_score: number;
    away_score: number;
    play_data: Record<string, any> | null;
    odds_snapshot: Record<string, any> | null;
    box_snapshot: Record<string, any> | null;
    source: string;
}

// ─── ESPN Fetcher (with timeout + error handling) ─────────────────
async function espnFetch(url: string): Promise<any | null> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) {
            Logger.warn('ESPN_FETCH_NON_OK', { url: url.substring(0, 120), status: res.status });
            return null;
        }
        return await res.json();
    } catch (e: any) {
        Logger.error('ESPN_FETCH_ERROR', { url: url.substring(0, 120), error: e.message });
        return null;
    }
}

// ─── Get Live Games from ESPN Scoreboard ──────────────────────────
async function getLiveGames(sport: string, espnLeague: string): Promise<any[]> {
    const url = `${ESPN_BASE}/${sport}/${espnLeague}/scoreboard`;
    const data = await espnFetch(url);
    if (!data?.events) return [];

    return data.events.filter((ev: any) => {
        const statusName = (ev.status?.type?.name || '').toUpperCase();
        return statusName.includes('IN_PROGRESS') || statusName.includes('HALFTIME');
    });
}

// ─── Fetch Play-by-Play from ESPN ─────────────────────────────────
async function getPlays(sport: string, espnLeague: string, eventId: string, competitionId: string): Promise<any[]> {
    const url = `${ESPN_BASE}/${sport}/${espnLeague}/events/${eventId}/competitions/${competitionId}/plays?limit=400`;
    const data = await espnFetch(url);
    return data?.items || [];
}

// ─── Fetch Current Odds from ESPN ─────────────────────────────────
async function getOdds(sport: string, espnLeague: string, eventId: string, competitionId: string): Promise<any | null> {
    const url = `${ESPN_BASE}/${sport}/${espnLeague}/events/${eventId}/competitions/${competitionId}/odds`;
    const data = await espnFetch(url);
    if (!data?.items?.[0]) return null;

    const item = data.items[0];
    return {
        spread: {
            home: item.homeTeamOdds?.spreadOdds ?? null,
            away: item.awayTeamOdds?.spreadOdds ?? null,
            line: item.spread ?? null,
        },
        total: {
            line: item.overUnder ?? null,
            over: item.overOdds ?? null,
            under: item.underOdds ?? null,
        },
        moneyline: {
            home: item.homeTeamOdds?.moneyLine ?? null,
            away: item.awayTeamOdds?.moneyLine ?? null,
        },
        provider: item.provider?.name ?? 'espn_consensus',
    };
}

// ─── Fetch Box Score (sampled, not every cycle) ───────────────────
// NOTE: uses competitionId in the path, NOT eventId
async function getBoxScore(sport: string, espnLeague: string, eventId: string, competitionId: string): Promise<any | null> {
    const url = `${ESPN_CORE}/${sport}/leagues/${espnLeague}/events/${eventId}/competitions/${competitionId}/competitors`;
    const data = await espnFetch(url);
    return data?.items ?? null;
}

// ─── Classify event_type from ESPN play data ──────────────────────
function classifyEventType(play: any): string {
    const typeText = (play.type?.text || '').toLowerCase();
    if (typeText.includes('end') && (typeText.includes('period') || typeText.includes('quarter') || typeText.includes('half'))) return 'period_end';
    if (typeText.includes('timeout')) return 'timeout';
    if (typeText.includes('challenge')) return 'challenge';
    if (typeText.includes('injury')) return 'injury';
    return 'play';
}

// ─── Normalize ESPN Play into GameEvent ───────────────────────────
function normalizePlay(
    play: any,
    matchId: string,
    leagueId: string,
    sport: string,
    odds: any | null
): GameEvent {
    return {
        match_id: matchId,
        league_id: leagueId,
        sport: sport,
        event_type: classifyEventType(play),
        sequence: play.sequenceNumber ?? play.id ?? 0,
        period: play.period?.number ?? null,
        clock: play.clock?.displayValue ?? null,
        home_score: play.homeScore ?? 0,
        away_score: play.awayScore ?? 0,
        play_data: {
            text: play.text ?? play.description ?? null,
            type: play.type?.text ?? play.type?.abbreviation ?? null,
            player: play.participants?.[0]?.athlete?.displayName ?? null,
            scoring_play: play.scoringPlay ?? false,
            points: play.pointValue ?? null,
            team_id: play.team?.id ?? null,
            wallclock: play.wallclock ?? null,
        },
        odds_snapshot: odds,
        box_snapshot: null, // Attached separately on sampled cycles
        source: 'espn',
    };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const startMs = Date.now();
    let totalInserted = 0;
    let totalSkipped = 0;
    let gamesProcessed = 0;
    const errors: string[] = [];

    // Allow targeting specific leagues via request body
    let targetLeagues = Object.keys(LEAGUE_MAP);
    try {
        const body = await req.json().catch(() => ({}));
        if (body.leagues && Array.isArray(body.leagues)) {
            targetLeagues = body.leagues.filter((l: string) => LEAGUE_MAP[l]);
        }
    } catch { /* use defaults */ }

    // Box score sampling: every 5th minute (approximation since pg_cron runs per-minute)
    const cycleMinute = new Date().getMinutes();
    const isBoxScoreCycle = cycleMinute % 5 === 0;

    try {
        for (const leagueKey of targetLeagues) {
            const cfg = LEAGUE_MAP[leagueKey];

            let liveGames: any[];
            try {
                liveGames = await getLiveGames(cfg.sport, cfg.espn);
            } catch (e: any) {
                Logger.error('SCOREBOARD_FETCH_FAILED', { league: leagueKey, error: e.message });
                errors.push(`${leagueKey} scoreboard: ${e.message}`);
                continue;
            }

            if (liveGames.length === 0) continue;
            Logger.info('LIVE_GAMES_FOUND', { league: leagueKey, count: liveGames.length });

            for (const event of liveGames) {
                const espnId = event.id;
                const comp = event.competitions?.[0];
                if (!comp) continue;

                const matchId = `${espnId}${cfg.suffix}`;
                const competitionId = comp.id;

                try {
                    // ── 1. Get last known sequence ──────────────────────────
                    // CRITICAL: Use .maybeSingle() not .single()
                    // .single() throws when no rows exist (first ingest for a game)
                    const { data: lastRow } = await supabase
                        .from('game_events')
                        .select('sequence')
                        .eq('match_id', matchId)
                        .order('sequence', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    const lastSequence = lastRow?.sequence ?? -1;

                    // ── 2. Fetch plays + odds in parallel ──────────────────
                    const [plays, odds] = await Promise.all([
                        getPlays(cfg.sport, cfg.espn, espnId, competitionId),
                        getOdds(cfg.sport, cfg.espn, espnId, competitionId),
                    ]);

                    // ── 3. Filter to only new plays ────────────────────────
                    const newPlays = plays.filter((p: any) => {
                        const seq = p.sequenceNumber ?? p.id ?? 0;
                        return seq > lastSequence;
                    });

                    if (newPlays.length === 0) {
                        totalSkipped++;
                        continue;
                    }

                    // ── 4. Normalize into GameEvent rows ───────────────────
                    const events: GameEvent[] = newPlays.map((p: any) =>
                        normalizePlay(p, matchId, leagueKey, cfg.sport, odds)
                    );

                    // ── 5. Attach box score on sampled cycles or period_end ─
                    const hasPeriodEnd = events.some(e => e.event_type === 'period_end');
                    if (isBoxScoreCycle || hasPeriodEnd) {
                        // NOTE: passes competitionId, not eventId, for the competitions path
                        const box = await getBoxScore(cfg.sport, cfg.espn, espnId, competitionId);
                        if (box && events.length > 0) {
                            events[events.length - 1].box_snapshot = box;
                        }
                    }

                    // ── 6. Batch upsert with dedup ─────────────────────────
                    // CRITICAL: Use .upsert() with ignoreDuplicates: true
                    // Plain .insert() throws 23505 on the unique constraint.
                    // .upsert() with ignoreDuplicates maps to ON CONFLICT DO NOTHING.
                    // Returned data array contains only newly inserted rows (skipped = empty).
                    const { data: inserted, error: upsertErr } = await supabase
                        .from('game_events')
                        .upsert(events, {
                            onConflict: 'match_id,event_type,sequence',
                            ignoreDuplicates: true,
                        })
                        .select('id');

                    if (upsertErr) {
                        Logger.error('UPSERT_FAILED', { matchId, error: upsertErr.message, code: upsertErr.code });
                        errors.push(`${matchId}: ${upsertErr.message}`);
                    } else {
                        const insertedCount = inserted?.length ?? 0;
                        totalInserted += insertedCount;
                        Logger.info('EVENTS_INSERTED', {
                            matchId,
                            attempted: events.length,
                            inserted: insertedCount,
                            lastSeq: events[events.length - 1].sequence,
                        });
                    }

                    // ── 7. Upsert game_recaps row ──────────────────────────
                    const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
                    const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
                    const gameDate = event.date ? event.date.split('T')[0] : new Date().toISOString().split('T')[0];
                    const statusName = (event.status?.type?.name || '').toUpperCase();
                    const recapStatus = statusName.includes('HALFTIME') ? 'HALFTIME' : 'LIVE';

                    // Slug includes ESPN event ID to prevent collisions on doubleheaders
                    const homeSlug = (home?.team?.displayName || 'home').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    const awaySlug = (away?.team?.displayName || 'away').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    const slug = `${awaySlug}-vs-${homeSlug}-${gameDate}-${espnId}`;

                    // Use actual row count from DB for events_count (not sequence math)
                    const { count: actualEventCount } = await supabase
                        .from('game_events')
                        .select('id', { count: 'exact', head: true })
                        .eq('match_id', matchId);

                    await supabase
                        .from('game_recaps')
                        .upsert({
                            match_id: matchId,
                            league_id: leagueKey,
                            sport: cfg.sport,
                            home_team: home?.team?.displayName || 'Unknown',
                            away_team: away?.team?.displayName || 'Unknown',
                            game_date: gameDate,
                            slug: slug,
                            status: recapStatus,
                            events_count: actualEventCount ?? 0,
                        }, { onConflict: 'match_id' });

                    gamesProcessed++;
                } catch (gameErr: any) {
                    Logger.error('GAME_PROCESS_ERROR', { matchId, error: gameErr.message });
                    errors.push(`${matchId}: ${gameErr.message}`);
                }
            }
        }

        const durationMs = Date.now() - startMs;
        Logger.info('INGEST_COMPLETE', {
            gamesProcessed,
            totalInserted,
            totalSkipped,
            durationMs,
            errorCount: errors.length,
        });

        return new Response(JSON.stringify({
            success: true,
            games_processed: gamesProcessed,
            events_inserted: totalInserted,
            games_skipped_no_new: totalSkipped,
            duration_ms: durationMs,
            errors: errors.length > 0 ? errors : undefined,
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (err: any) {
        Logger.error('FATAL_INGEST_ERROR', { error: err.message, stack: err.stack?.substring(0, 500) });
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
