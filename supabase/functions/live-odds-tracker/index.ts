
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================================
// 1. CONFIGURATION
// ============================================================================

const CONFIG = {
    concurrency: 2,
    espn: {
        baseUrl: 'https://site.api.espn.com/apis/site/v2/sports',
        timeout: 8000,
        daysAhead: 3,
    },
    oddsApi: {
        baseUrl: 'https://api.the-odds-api.com/v4',
        timeout: 10000,
        // CRITICAL: daysFrom=3 ensures we catch late-night NHL/NBA games
        urlParams: '&regions=us,us2,uk,eu,au&markets=h2h,spreads,totals&oddsFormat=american&daysFrom=3',
        preferredBooks: ['pinnacle', 'circa', 'bookmaker', 'bet365', 'draftkings', 'fanduel', 'betmgm', 'bovada'],
    },
} as const

// Map ESPN Leagues -> Odds API Sport Keys
const LEAGUE_TO_ODDS_KEY: Record<string, string> = {
    'nfl': 'americanfootball_nfl',
    'college-football': 'americanfootball_ncaaf',
    'nba': 'basketball_nba',
    'mens-college-basketball': 'basketball_ncaab',
    'mlb': 'baseball_mlb',
    'nhl': 'icehockey_nhl',
    'eng.1': 'soccer_epl',
    'esp.1': 'soccer_spain_la_liga',
    'ger.1': 'soccer_germany_bundesliga',
    'ita.1': 'soccer_italy_serie_a',
    'fra.1': 'soccer_france_ligue_one',
    'usa.1': 'soccer_usa_mls',
    'uefa.champions': 'soccer_uefa_champs_league',
    'uefa.europa': 'soccer_uefa_europa_league',
}

// DB ID Suffixes (Crucial for Primary Keys matching espn-sync)
const SUFFIX_MAP: Record<string, string> = {
    'nba': '_nba', 'mens-college-basketball': '_ncaab',
    'nfl': '_nfl', 'college-football': '_ncaaf',
    'nhl': '_nhl', 'mlb': '_mlb',
    'eng.1': '_epl', 'esp.1': '_laliga', 'ger.1': '_bundesliga',
    'ita.1': '_seriea', 'fra.1': '_ligue1', 'uefa.champions': '_ucl',
    'uefa.europa': '_uel', 'mls': '_mls', 'usa.1': '_mls'
};

// Monitored leagues loop
const MONITORED_LEAGUES = [
    { sport: 'football', league: 'nfl' },
    { sport: 'football', league: 'college-football' },
    { sport: 'basketball', league: 'nba' },
    { sport: 'basketball', league: 'mens-college-basketball' },
    { sport: 'baseball', league: 'mlb' },
    { sport: 'hockey', league: 'nhl' },
    { sport: 'soccer', league: 'eng.1' },
    { sport: 'soccer', league: 'esp.1' },
    { sport: 'soccer', league: 'ger.1' },
    { sport: 'soccer', league: 'ita.1' },
    { sport: 'soccer', league: 'fra.1' },
    { sport: 'soccer', league: 'usa.1' },
    { sport: 'soccer', league: 'uefa.champions' },
    { sport: 'soccer', league: 'uefa.europa' },
];

// Comprehensive Team Aliases (For Fuzzy Match Fallback)
const TEAM_ALIASES: Record<string, string[]> = {
    'uconn': ['connecticut', 'uconnhuskies'],
    'usc': ['southerncalifornia', 'usctrojans'],
    'lsu': ['louisianastate'],
    'olemiss': ['mississippi'],
    'ncst': ['ncstate', 'northcarolinastate'],
    'ohiost': ['ohiostate'],
    'pennst': ['pennstate'],
    'manunited': ['manutd', 'manchesterunited'],
    'mancity': ['manchestercity'],
    'miamifl': ['miami', 'miamihurricanes'],
    'unc': ['northcarolina', 'tarheels'],
    'koln': ['fccologne', 'cologne', '1fckoln', '1fccologne'],
    'mainz': ['fsvmainz05', 'mainz05'],
    'stpauli': ['fcstpauli'],
    'monchengladbach': ['borussiamonchengladbach', 'monchengladbach'],
    'stlouis': ['stlouisblues', 'saintlouis'],
    'montreal': ['montrealcanadiens', 'montréal'],
    'utah': ['utahmammoth', 'utahhockeyclub', 'utahhc'],
    'losangeles': ['lakings', 'losangeleskings'],
    'genoa': ['genoacfc'],
    'cagliari': ['cagliaricalcio'],
    'milan': ['acmilan'],
    'inter': ['intermilan', 'internazionale', 'fcinternazionalemilano'],
    'roma': ['asroma'],
    'lazio': ['sslazio'],
    'napoli': ['sscnapoli'],
    'juventus': ['juventusfc'],
    'atalanta': ['atalantabc'],
    'lecce': ['uslecce'],
    'fiorentina': ['acffiorentina'],
    'bologna': ['bolognafc'],
    'torino': ['torinofc'],
    'empoli': ['empolifc'],
    'verona': ['hellasverona'],
    'udinese': ['udinesecalcio'],
    'sassuolo': ['ussassuolo'],
    'salernitana': ['ussalernitana'],
    'monza': ['acmonza'],
};

// ============================================================================
// 2. UTILITIES
// ============================================================================

const normalizeName = (s: string): string => {
    if (!s) return '';
    const raw = s.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\./g, '')
        .replace(/'/g, '')
        .replace(/[^a-z0-9]/g, '');

    for (const [key, aliases] of Object.entries(TEAM_ALIASES)) {
        if (raw === key || aliases.some(a => raw.includes(a))) return key;
    }
    return raw;
};

// Dice Coefficient (Math-based Similarity 0.0 - 1.0)
function getSimilarity(s1: string, s2: string): number {
    const a = normalizeName(s1);
    const b = normalizeName(s2);
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.95;

    const getBigrams = (str: string) => {
        const bigrams = new Set<string>();
        for (let i = 0; i < str.length - 1; i++) bigrams.add(str.substring(i, i + 2));
        return bigrams;
    };

    const aBigrams = getBigrams(a);
    const bBigrams = getBigrams(b);
    let intersection = 0;
    for (const bigram of aBigrams) if (bBigrams.has(bigram)) intersection++;

    return (2 * intersection) / (aBigrams.size + bBigrams.size);
}

// Status Mapper (Safety wrapper for DB Enum)
const mapStatus = (rawStatus: string) => {
    if (!rawStatus) return 'STATUS_SCHEDULED';
    const s = rawStatus.toUpperCase().replace(/\s/g, '_').replace(/\./g, '');

    if (['STATUS_FULL_TIME', 'FULL_TIME', 'FT', 'FINAL', 'STATUS_FINAL_PEN', 'STATUS_FINAL_AET', 'STATUS_FINAL_SO', 'STATUS_FINAL_OT'].includes(s)) return 'STATUS_FINAL';
    if (['HALFTIME', 'HT', 'STATUS_HALFTIME'].includes(s)) return 'STATUS_HALFTIME';
    if (['STATUS_POSTPONED', 'POSTPONED'].includes(s)) return 'STATUS_POSTPONED';
    if (['STATUS_CANCELED', 'CANCELED'].includes(s)) return 'STATUS_CANCELED';
    if (['STATUS_DELAYED', 'DELAYED'].includes(s)) return 'STATUS_DELAYED';

    return s.startsWith('STATUS_') ? s : `STATUS_${s}`;
};

const formatError = (e: any) => (typeof e === 'string' ? e : e?.message || JSON.stringify(e));

// ============================================================================
// 3. MAIN WORKER
// ============================================================================

let supabase: any;
const oddsCache = new Map<string, { data: any[], fetchedAt: number }>();

declare const Deno: {
    env: { get(key: string): string | undefined }
    serve(handler: (req: Request) => Promise<Response>): void
}

Deno.serve(async (_req: Request): Promise<Response> => {
    const metrics = {
        startedAt: new Date().toISOString(),
        leagues_processed: 0,
        matches_updated: 0,
        snapshots_created: 0,
        closing_lines_captured: 0,
        errors: [] as string[]
    }

    try {
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
        const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY')!

        supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

        // Process Leagues in Batches
        const queue = [...MONITORED_LEAGUES];
        console.log(`[Tracker] Starting cycle. Leagues to process: ${queue.length}`);

        while (queue.length > 0) {
            const batch = queue.splice(0, CONFIG.concurrency);
            await Promise.all(batch.map(item =>
                processLeague(item.sport, item.league, ODDS_API_KEY, metrics)
                    .catch(e => metrics.errors.push(`[${item.league}] ${formatError(e)}`))
            ));
        }

        console.log(`[Tracker] Complete: ${metrics.matches_updated} matches updated, ${metrics.snapshots_created} snapshots, ${metrics.closing_lines_captured} closing lines. Errors: ${metrics.errors.length}`);

        return new Response(JSON.stringify(metrics, null, 2), { headers: { 'Content-Type': 'application/json' } })
    } catch (err: any) {
        return new Response(JSON.stringify({ error: formatError(err), metrics }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
})

// ============================================================================
// 4. PROCESSING LOGIC
// ============================================================================

async function processLeague(sport: string, leagueId: string, apiKey: string, metrics: any) {
    // 1. Fetch ESPN Schedule (Source of Truth)
    const dateRange = getDateRange(CONFIG.espn.daysAhead);
    const espnUrl = `${CONFIG.espn.baseUrl}/${sport}/${leagueId}/scoreboard?limit=100&dates=${dateRange}`;
    const res = await fetchWithTimeout(espnUrl, CONFIG.espn.timeout);
    if (!res.ok) return;

    const data = await res.json();
    const events = data.events || [];
    if (events.length === 0) return;

    metrics.leagues_processed++;

    // 2. Fetch Odds API Data (Enrichment)
    const oddsKey = LEAGUE_TO_ODDS_KEY[leagueId];
    let oddsGames: any[] = [];

    if (oddsKey && apiKey) {
        oddsGames = await fetchOdds(oddsKey, apiKey);
    }

    // 3. Pre-fetch DB State (Optimization)
    const { data: dbMatches } = await supabase
        .from('matches')
        .select('id, status, closing_odds, current_odds')
        .eq('league_id', leagueId)
        .gte('start_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const updates: any[] = [];
    const snapshots: any[] = [];
    const closingLines: any[] = [];

    const suffix = SUFFIX_MAP[leagueId] || `_${sport}`;

    // 4. Match & Merge
    for (const event of events) {
        const c = event.competitions?.[0];
        if (!c) continue;

        const hComp = c.competitors.find((x: any) => x.homeAway === 'home');
        const aComp = c.competitors.find((x: any) => x.homeAway === 'away');
        if (!hComp || !aComp) continue;

        // A. Find Matching Odds
        // Try precise name match, then Dice Coefficient
        let oddsMatch = null;
        if (oddsGames.length > 0) {
            const hNorm = normalizeName(hComp.team.displayName);
            const aNorm = normalizeName(aComp.team.displayName);

            oddsMatch = oddsGames.find(g => {
                // Time Check (within 24h)
                if (Math.abs(new Date(g.commence_time).getTime() - new Date(event.date).getTime()) > 86400000) return false;

                // Name Check
                const oh = normalizeName(g.home_team);
                const oa = normalizeName(g.away_team);

                const hScore = getSimilarity(hNorm, oh);
                const aScore = getSimilarity(aNorm, oa);

                return (hScore > 0.6 && aScore > 0.6); // 60% confidence
            });
        }

        const odds = extractOdds(oddsMatch);

        // B. Generate Stable ID with suffix
        const matchId = event.id.includes('_') ? event.id : `${event.id}${suffix}`;

        // Ensure team IDs are normalized with suffixes
        const hId = hComp.team.id.includes('_') ? hComp.team.id : `${hComp.team.id}${suffix}`;
        const aId = aComp.team.id.includes('_') ? aComp.team.id : `${aComp.team.id}${suffix}`;

        // C. Ensure Teams Exist (IDEMPOTENT FIX)
        await upsertTeam(hComp.team, hId, leagueId);
        await upsertTeam(aComp.team, aId, leagueId);

        // D. Determine Status
        const safeStatus = mapStatus(event.status.type.name);
        const isLive = safeStatus === 'STATUS_IN_PROGRESS' || safeStatus === 'STATUS_HALFTIME' || safeStatus === 'STATUS_FIRST_HALF' || safeStatus === 'STATUS_SECOND_HALF' || safeStatus.includes('LIVE');

        // E. Logic: Closing Line Capture (Hardened Transition)
        const dbRecord = dbMatches?.find((m: any) => m.id === matchId);
        let closingOdds = dbRecord?.closing_odds || null;

        // AGGRESSIVE CAPTURE: If game is LIVE and we don't have a closing line yet
        // We capture the "First Live" odds as the best proxy for Closing if we missed the T-minus zero moment
        if (isLive && !closingOdds && odds.provider !== 'none') {
            console.log(`[CLOSING_CAPTURE] Match ${matchId} is LIVE. Archiving closing line.`);
            closingOdds = {
                ...odds,
                provider: odds.provider || 'Closing Consensus',
                captured_at: new Date().toISOString()
            };
            metrics.closing_lines_captured++;

            closingLines.push({
                match_id: matchId,
                home_spread: odds.spread_home,
                away_spread: odds.spread_away,
                total: odds.total ? String(odds.total) : null,
                home_ml: odds.home_ml,
                away_ml: odds.away_ml,
                draw_ml: odds.draw_ml,
                provider: odds.provider || 'Closing Consensus',
                captured_at: new Date().toISOString()
            });
        }

        // F. Build Payload
        const payload: any = {
            id: matchId,
            league_id: leagueId,
            home_team_id: hId,
            away_team_id: aId,
            home_team: hComp.team.displayName,
            away_team: aComp.team.displayName,
            start_time: event.date,
            status: safeStatus,
            status_state: event.status.type.state,
            display_clock: event.status.displayClock,
            period: event.status.period,
            home_score: parseInt(hComp.score || '0'),
            away_score: parseInt(aComp.score || '0'),
            closing_odds: closingOdds,
            last_updated: new Date().toISOString()
        };

        // Only update odds if they exist (don't overwrite with nulls)
        if (odds.provider !== 'none') {
            payload.current_odds = {
                ...odds,
                updated_at: new Date().toISOString(),
                isInstitutional: true,
                isLive: true
            };
            payload.odds_api_event_id = oddsMatch?.id;

            // Flattened Columns for easier querying
            payload.odds_home_ml_safe = odds.home_ml;
            payload.odds_away_ml_safe = odds.away_ml;

            // spread_home_value is the raw number
            payload.odds_home_spread_safe = odds.spread_home_value;
            payload.odds_away_spread_safe = odds.spread_home_value ? -1 * odds.spread_home_value : null;
            payload.odds_total_safe = odds.total_value;
        }

        // G. Race Condition Guard (Don't overwrite Final with non-Final)
        if (dbRecord?.status === 'STATUS_FINAL' && safeStatus !== 'STATUS_FINAL') {
            delete payload.status;
            delete payload.status_state;
        }

        updates.push(payload);

        // H. Live Snapshot
        if (isLive && odds.provider !== 'none') {
            snapshots.push({
                match_id: matchId,
                sport_key: oddsKey || 'unknown',
                home_score: payload.home_score,
                away_score: payload.away_score,
                spread_line: odds.spread_home,
                total_line: odds.total,
                is_live: true,
                captured_at: new Date().toISOString()
            });
        }
    }

    // 5. Bulk Execute
    if (updates.length > 0) {
        const { error } = await supabase.from('matches').upsert(updates, { onConflict: 'id' });
        if (error) metrics.errors.push(`[DB] ${leagueId}: ${error.message}`);
        else metrics.matches_updated += updates.length;
    }

    if (snapshots.length > 0) {
        await supabase.from('live_odds_snapshots').insert(snapshots);
        metrics.snapshots_created += snapshots.length;
    }

    if (closingLines.length > 0) {
        await supabase.from('closing_lines').upsert(closingLines, { onConflict: 'match_id' });
    }

    console.log(`[Tracker] ${leagueId}: ${updates.length} matches scanned, ${snapshots.length} snapshots created.`);
}

// ============================================================================
// 5. HELPERS
// ============================================================================

async function upsertTeam(team: any, id: string, leagueId: string) {
    // Explicitly use onConflict: 'id' to ensure idempotency
    await supabase.from('teams').upsert({
        id: id,
        name: team.displayName,
        short_name: team.shortDisplayName,
        abbreviation: team.abbreviation,
        logo_url: team.logo,
        color: team.color,
        league_id: leagueId
    }, { onConflict: 'id' });
}

async function fetchOdds(sportKey: string, apiKey: string) {
    // Check Cache
    const cached = oddsCache.get(sportKey);
    if (cached && Date.now() - cached.fetchedAt < 60000) return cached.data; // 1 min cache

    const url = `${CONFIG.oddsApi.baseUrl}/sports/${sportKey}/odds/?apiKey=${apiKey}${CONFIG.oddsApi.urlParams}&_t=${Date.now()}`;
    const res = await fetchWithTimeout(url, CONFIG.oddsApi.timeout);
    if (res.ok) {
        const data = await res.json();
        oddsCache.set(sportKey, { data, fetchedAt: Date.now() });

        // SIDE EFFECT: Keep market_feeds in sync for the Match Details Consensus logic
        if (Array.isArray(data) && data.length > 0) {
            try {
                const feedUpserts = data.map((event: any) => {
                    const lines = extractOdds(event);
                    return {
                        external_id: event.id,
                        sport_key: event.sport_key,
                        home_team: event.home_team,
                        away_team: event.away_team,
                        commence_time: event.commence_time,
                        raw_bookmakers: event.bookmakers,
                        best_spread: lines.spread_best,
                        best_total: lines.total_best,
                        best_h2h: lines.h2h_best,
                        is_live: new Date(event.commence_time) <= new Date(),
                        last_updated: new Date().toISOString()
                    };
                });

                await supabase.from('market_feeds').upsert(feedUpserts, { onConflict: 'external_id' });
            } catch (syncErr) {
                console.warn("[Odds-Sync] market_feeds update failed", syncErr);
            }
        }

        return data;
    }
    return [];
}

function extractOdds(game: any) {
    const odds: {
        provider: string,
        home_ml: string | null,
        away_ml: string | null,
        draw_ml: string | null,
        spread_home: string | null,
        spread_away: string | null,
        total: number | null,
        spread_home_value: number | null,
        total_value: number | null,
        h2h_best: any | null,
        spread_best: any | null,
        total_best: any | null
    } = {
        provider: 'none',
        home_ml: null, away_ml: null, draw_ml: null,
        spread_home: null, spread_away: null,
        total: null,
        // Raw values for _safe columns
        spread_home_value: null,
        total_value: null,
        h2h_best: null,
        spread_best: null,
        total_best: null
    };

    if (!game?.bookmakers?.length) return odds;

    const books = game.bookmakers.sort((a: any, b: any) => {
        const list = CONFIG.oddsApi.preferredBooks;
        const ia = list.indexOf(a.key); const ib = list.indexOf(b.key);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    const book = books[0];
    odds.provider = book.title;

    const getPrice = (k: string, n: string) => {
        const m = book.markets.find((x: any) => x.key === k);
        if (!m) return undefined;

        // Special handling for Draw - check multiple possible names
        if (n.toLowerCase() === 'draw') {
            const drawNames = ['Draw', 'draw', 'DRAW', 'Tie', 'tie', 'X', 'x', 'Empate'];
            for (const drawName of drawNames) {
                const outcome = m.outcomes.find((o: any) =>
                    o.name === drawName ||
                    o.name?.toLowerCase() === drawName.toLowerCase()
                );
                if (outcome?.price !== undefined) return outcome.price;
            }
        }

        return m.outcomes.find((o: any) => getSimilarity(o.name, n) > 0.8)?.price;
    }
    const getPoint = (k: string, n: string) => {
        const m = book.markets.find((x: any) => x.key === k);
        return m?.outcomes.find((o: any) => getSimilarity(o.name, n) > 0.8)?.point;
    }

    const h2hMarket = book.markets.find((x: any) => x.key === 'h2h');
    if (h2hMarket) {
        const home = h2hMarket.outcomes.find((o: any) => getSimilarity(o.name, game.home_team) > 0.8);
        const away = h2hMarket.outcomes.find((o: any) => getSimilarity(o.name, game.away_team) > 0.8);
        const draw = h2hMarket.outcomes.find((o: any) => ['Draw', 'Tie', 'X'].includes(o.name) || getSimilarity(o.name, 'Draw') > 0.8);
        odds.h2h_best = { home, away, draw, bookmaker: book.title };
    }

    const spreadMarket = book.markets.find((x: any) => x.key === 'spreads');
    if (spreadMarket) {
        const home = spreadMarket.outcomes.find((o: any) => getSimilarity(o.name, game.home_team) > 0.8);
        const away = spreadMarket.outcomes.find((o: any) => getSimilarity(o.name, game.away_team) > 0.8);
        odds.spread_best = { home, away, bookmaker: book.title };
    }

    const totalMarket = book.markets.find((x: any) => x.key === 'totals');
    if (totalMarket) {
        const over = totalMarket.outcomes.find((o: any) => o.name === 'Over');
        const under = totalMarket.outcomes.find((o: any) => o.name === 'Under');
        odds.total_best = { over, under, bookmaker: book.title };
    }

    odds.home_ml = fmt(odds.h2h_best?.home?.price);
    odds.away_ml = fmt(odds.h2h_best?.away?.price);
    odds.draw_ml = fmt(odds.h2h_best?.draw?.price);

    const spreadVal = odds.spread_best?.home?.point;
    if (spreadVal !== undefined) {
        odds.spread_home_value = spreadVal;
        odds.spread_home = spreadVal > 0 ? `+${spreadVal}` : `${spreadVal}`;
        odds.spread_away = spreadVal * -1 > 0 ? `+${spreadVal * -1}` : `${spreadVal * -1}`;
    }

    const totalVal = odds.total_best?.over?.point;
    if (totalVal !== undefined) {
        odds.total_value = totalVal;
        odds.total = totalVal;
    }

    return odds;
}

function fmt(p: number | undefined) {
    if (p === undefined || p === null) return null
    if (Math.abs(p) >= 100) return p > 0 ? `+${Math.round(p)}` : `${Math.round(p)}`
    return p >= 2.0 ? `+${Math.round((p - 1) * 100)}` : `${Math.round(-100 / (p - 1))}`
}

function getDateRange(days: number) {
    const today = new Date();
    // LOOKBACK FIX: Start from 2 days ago to catch final scores
    const start = new Date();
    start.setDate(today.getDate() - 2);

    const end = new Date();
    end.setDate(today.getDate() + days);

    return `${start.toISOString().split('T')[0].replace(/-/g, '')}-${end.toISOString().split('T')[0].replace(/-/g, '')}`;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try { return await fetch(url, { signal: c.signal }); }
    finally { clearTimeout(t); }
}
