
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Promise<Response>): void
}

// Configuration
const CONFIG = {
  supabase: {
    url: Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  },
  espn: {
    baseUrl: 'https://site.api.espn.com/apis/site/v2/sports',
    timeout: 10000,
  },
  capture: {
    scanWindowDays: 10,
    maxEventsPerRequest: 200,
    retryAttempts: 3,
    retryDelayMs: 1000,
    rateLimitDelayMs: 100,
  },
} as const

// League Registry
interface LeagueConfig {
  sport: string
  league: string
  leagueId: string
  label: string
  hasDrawLine: boolean
  groups?: string
}

const MONITORED_LEAGUES: LeagueConfig[] = [
  { sport: 'football', league: 'nfl', leagueId: 'nfl', label: 'NFL', hasDrawLine: false },
  { sport: 'basketball', league: 'nba', leagueId: 'nba', label: 'NBA', hasDrawLine: false },
  { sport: 'baseball', league: 'mlb', leagueId: 'mlb', label: 'MLB', hasDrawLine: false },
  { sport: 'hockey', league: 'nhl', leagueId: 'nhl', label: 'NHL', hasDrawLine: false },
  { sport: 'basketball', league: 'wnba', leagueId: 'wnba', label: 'WNBA', hasDrawLine: false },
  { sport: 'basketball', league: 'mens-college-basketball', leagueId: 'mens-college-basketball', label: 'NCAAB', hasDrawLine: false, groups: '50' },
  { sport: 'football', league: 'college-football', leagueId: 'college-football', label: 'NCAAF', hasDrawLine: false, groups: '80' },
  { sport: 'soccer', league: 'eng.1', leagueId: 'epl', label: 'EPL', hasDrawLine: true },
  { sport: 'soccer', league: 'esp.1', leagueId: 'laliga', label: 'La Liga', hasDrawLine: true },
  { sport: 'soccer', league: 'ger.1', leagueId: 'bundesliga', label: 'Bundesliga', hasDrawLine: true },
  { sport: 'soccer', league: 'ita.1', leagueId: 'seriea', label: 'Serie A', hasDrawLine: true },
  { sport: 'soccer', league: 'fra.1', leagueId: 'ligue1', label: 'Ligue 1', hasDrawLine: true },
  { sport: 'soccer', league: 'usa.1', leagueId: 'mls', label: 'MLS', hasDrawLine: true },
  { sport: 'soccer', league: 'uefa.champions', leagueId: 'ucl', label: 'UCL', hasDrawLine: true },
  { sport: 'soccer', league: 'uefa.europa', leagueId: 'uel', label: 'UEL', hasDrawLine: true },
  { sport: 'mma', league: 'ufc', leagueId: 'ufc', label: 'UFC', hasDrawLine: false },
  { sport: 'tennis', league: 'atp', leagueId: 'atp', label: 'ATP', hasDrawLine: false },
  { sport: 'tennis', league: 'wta', leagueId: 'wta', label: 'WTA', hasDrawLine: false },
  { sport: 'golf', league: 'pga', leagueId: 'pga', label: 'PGA', hasDrawLine: false },
]

// Types
interface TeamRecord {
  id: string
  name: string
  short_name: string | null
  abbreviation: string | null
  logo_url: string | null
  color: string | null
  league_id: string
}

interface MatchRecord {
  id: string
  league_id: string
  home_team_id: string | null
  away_team_id: string | null
  home_team: string | null
  away_team: string | null
  start_time: string
  status: string
  ingest_trace?: string[]
  last_ingest_error?: string
}

interface OpeningLineRecord {
  match_id: string
  sport: string
  source: string
  home_spread: number | null
  away_spread: number | null
  total: number | null
  home_ml: string | null
  away_ml: string | null
  draw_ml: string | null
  provider: string | null
  home_team: string | null
  away_team: string | null
}

interface CaptureResult {
  scanned: number
  new_openers: number
  teams_upserted: number
  matches_upserted: number
  skipped_in_progress: number
  skipped_no_odds: number
  errors: ErrorEntry[]
  duration_ms: number
  leagues_processed: string[]
}

interface ErrorEntry {
  league: string
  date: string
  message: string
  retryable: boolean
}

interface ESPNEvent {
  id: string
  date: string
  status?: { type?: { state?: string; name?: string } }
  competitions?: ESPNCompetition[]
}

interface ESPNCompetition {
  competitors?: ESPNCompetitor[]
  odds?: ESPNOdds[]
  venue?: {
    fullName?: string
    city?: string
    state?: string
  }
}

interface ESPNCompetitor {
  homeAway: 'home' | 'away'
  team?: {
    id?: string
    displayName?: string
    shortDisplayName?: string
    abbreviation?: string
    logo?: string
    color?: string
  }
}

interface ESPNOdds {
  provider?: { name?: string }
  details?: string
  overUnder?: number
  pointSpread?: {
    home?: { open?: { line?: string | number }; current?: { line?: string | number } }
    away?: { open?: { line?: string | number }; current?: { line?: string | number } }
  }
  total?: {
    over?: { open?: { line?: string | number }; current?: { line?: string | number } }
  }
  moneyline?: {
    home?: { open?: { odds?: string | number }; current?: { odds?: string | number } }
    away?: { open?: { odds?: string | number }; current?: { odds?: string | number } }
    draw?: { open?: { odds?: string | number }; current?: { odds?: string | number } }
  }
  homeTeamOdds?: { moneyLine?: string | number }
  awayTeamOdds?: { moneyLine?: string | number }
  drawOdds?: { moneyLine?: string | number }
}

// Logging
const log = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: 'INFO', msg, ...data, ts: new Date().toISOString() })),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ level: 'WARN', msg, ...data, ts: new Date().toISOString() })),
  error: (msg: string, data?: Record<string, unknown>) =>
    console.error(JSON.stringify({ level: 'ERROR', msg, ...data, ts: new Date().toISOString() })),
}

// Odds Normalization
function decimalToAmerican(decimal: number): string {
  if (decimal <= 1) return ''
  if (decimal >= 2.0) {
    return '+' + Math.round((decimal - 1) * 100)
  }
  return String(Math.round(-100 / (decimal - 1)))
}

function normalizeOdds(val: string | number | null | undefined): string | null {
  if (val === null || val === undefined) return null
  const strVal = String(val).trim()
  if (!strVal) return null

  //  Detection: ESPN often uses 1.02 as a "not set" placeholder
  const num = parseFloat(strVal)
  if (!isNaN(num)) {
    if (Math.abs(num - 1.02) < 0.001) return null; // Skip decimal placeholder
    if (Math.abs(num - 51) < 0.001) return null;   // Skip American placeholder (-5000)

    if (num > 1 && num < 100) {
      return decimalToAmerican(num)
    }
    if (num >= 100) return '+' + Math.round(num)
  }

  if (strVal.startsWith('+') || strVal.startsWith('-')) return strVal
  return strVal
}

function parseSpreadValue(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null
  const num = parseFloat(String(val))
  return isNaN(num) ? null : num
}

function parseTotalValue(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null
  const strVal = String(val)
  const cleaned = strVal.replace(/^[ou]/i, '').trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

// HTTP Utilities
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWithRetry(url: string, attempts: number = CONFIG.capture.retryAttempts): Promise<Response | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.espn.timeout)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)

      if (res.ok) return res

      if (res.status === 400 || res.status === 404) {
        log.warn('ESPN returned client error', { url, status: res.status })
        return null
      }

      if (res.status === 429) {
        const delay = CONFIG.capture.retryDelayMs * Math.pow(2, i + 2)
        log.warn('Rate limited by ESPN', { url, retryIn: delay })
        await sleep(delay)
        continue
      }

      if (res.status >= 500) {
        const delay = CONFIG.capture.retryDelayMs * Math.pow(2, i)
        log.warn('ESPN server error', { url, status: res.status, retryIn: delay })
        await sleep(delay)
        continue
      }

      return null
    } catch (err) {
      if (i === attempts - 1) {
        log.error('Fetch failed after retries', { url, error: String(err) })
        return null
      }
      await sleep(CONFIG.capture.retryDelayMs * Math.pow(2, i))
    }
  }
  return null
}

// Data Extraction
function extractTeams(event: ESPNEvent, leagueConfig: LeagueConfig): TeamRecord[] {
  const teams: TeamRecord[] = []
  const competition = event.competitions?.[0]

  for (const competitor of competition?.competitors || []) {
    const team = competitor.team as any
    if (!team?.id) continue

    // Robust name resolution
    let resolvedName = team.displayName || team.name || team.shortDisplayName || team.shortName || 'Unknown';

    // Filter out generic placeholders
    if (resolvedName.toLowerCase().includes('home team') || resolvedName.toLowerCase().includes('away team')) {
      resolvedName = 'Unknown';
    }

    teams.push({
      id: team.id,
      name: resolvedName,
      short_name: team.shortDisplayName || team.shortName || null,
      abbreviation: team.abbreviation || null,
      logo_url: team.logo || null,
      color: team.color || null,
      league_id: leagueConfig.leagueId,
    })
  }

  return teams
}

function extractMatch(event: ESPNEvent, leagueConfig: LeagueConfig): MatchRecord | null {
  const competition = event.competitions?.[0]
  const homeCompetitor = competition?.competitors?.find(c => c.homeAway === 'home')
  const awayCompetitor = competition?.competitors?.find(c => c.homeAway === 'away')

  // Standardize ID to Canonical Form
  const canonicalId = (event.id.includes('_')) ? event.id : `${event.id}_${leagueConfig.leagueId.replace('mens-college-basketball', 'ncaab').replace('college-football', 'ncaaf').replace('soccer-', '')}`;
  // Actually, let's use a mapping to be safe or just the existing logic if available.
  // I'll use a simple manual mapping here to avoid importing shared if it's too complex for Deno without import maps.
  let suffix = `_${leagueConfig.leagueId}`;
  if (leagueConfig.leagueId === 'mens-college-basketball') suffix = '_ncaab';
  if (leagueConfig.leagueId === 'college-football') suffix = '_ncaaf';
  if (leagueConfig.leagueId === 'nba') suffix = '_nba';
  if (leagueConfig.leagueId === 'nfl') suffix = '_nfl';
  if (leagueConfig.leagueId === 'mlb') suffix = '_mlb';
  if (leagueConfig.leagueId === 'nhl') suffix = '_nhl';

  const finalId = (event.id.includes('_')) ? event.id : `${event.id}${suffix}`;

  const statusName = event.status?.type?.name || event.status?.type?.state || 'STATUS_SCHEDULED'

  // Robust name resolution
  const getResolvedName = (comp: any) => {
    const team = comp?.team;
    if (!team) return null;
    const name = team.displayName || team.name || team.shortDisplayName || team.shortName || null;
    if (name?.toLowerCase().includes('home team') || name?.toLowerCase().includes('away team')) return null;
    return name;
  };

  return {
    id: finalId,
    league_id: leagueConfig.leagueId,
    home_team_id: homeCompetitor?.team?.id || null,
    away_team_id: awayCompetitor?.team?.id || null,
    home_team: getResolvedName(homeCompetitor),
    away_team: getResolvedName(awayCompetitor),
    start_time: event.date,
    status: statusName,
  }
}

function getCanonicalEventId(eventId: string, leagueConfig: LeagueConfig): string {
  if (eventId.includes('_')) return eventId;
  let suffix = `_${leagueConfig.leagueId}`;
  if (leagueConfig.leagueId === 'mens-college-basketball') suffix = '_ncaab';
  if (leagueConfig.leagueId === 'college-football') suffix = '_ncaaf';
  if (leagueConfig.leagueId === 'nba') suffix = '_nba';
  if (leagueConfig.leagueId === 'nfl') suffix = '_nfl';
  if (leagueConfig.leagueId === 'mlb') suffix = '_mlb';
  if (leagueConfig.leagueId === 'nhl') suffix = '_nhl';
  return `${eventId}${suffix}`;
}

function extractOpeningLine(event: ESPNEvent, leagueConfig: LeagueConfig): OpeningLineRecord | null {
  const competition = event.competitions?.[0]
  const odds = competition?.odds?.[0]
  if (!odds) return null

  let homeSpread = parseSpreadValue(odds.pointSpread?.home?.open?.line)
    ?? parseSpreadValue(odds.pointSpread?.home?.current?.line)
  let awaySpread = parseSpreadValue(odds.pointSpread?.away?.open?.line)
    ?? parseSpreadValue(odds.pointSpread?.away?.current?.line)

  if (homeSpread === null && awaySpread === null && odds.details) {
    const parsed = parseDetailsString(odds.details, competition?.competitors)
    homeSpread = parsed.homeSpread
    awaySpread = parsed.awaySpread
  }

  const total = parseTotalValue(odds.total?.over?.open?.line)
    ?? parseTotalValue(odds.total?.over?.current?.line)
    // Fallback: Some leagues like NBA might put the total directly in overUnder if detailed markets aren't fully formed
    ?? parseTotalValue(odds.overUnder)
    ?? parseTotalValue((odds as any).total?.line);

  const homeMl = normalizeOdds(odds.moneyline?.home?.open?.odds)
    ?? normalizeOdds(odds.moneyline?.home?.current?.odds)
    ?? normalizeOdds(odds.homeTeamOdds?.moneyLine)

  const awayMl = normalizeOdds(odds.moneyline?.away?.open?.odds)
    ?? normalizeOdds(odds.moneyline?.away?.current?.odds)
    ?? normalizeOdds(odds.awayTeamOdds?.moneyLine)

  let drawMl: string | null = null
  if (leagueConfig.hasDrawLine) {
    drawMl = normalizeOdds(odds.moneyline?.draw?.open?.odds)
      ?? normalizeOdds(odds.moneyline?.draw?.current?.odds)
      ?? normalizeOdds(odds.drawOdds?.moneyLine)
  }

  // Sanity Guard: Moneyline extreme values
  // Placeholder detection for -5000 (+/- 51 decimal) or similar outliers
  const isExtremeML = (ml: string | null) => {
    if (!ml) return false;
    const val = Math.abs(parseInt(ml.replace('+', ''), 10));
    return val >= 4000 || val <= 101; // Filter out -5000 style placeholders and extremely low juice s
  };

  const cleanHomeMl = isExtremeML(homeMl) ? null : homeMl;
  const cleanAwayMl = isExtremeML(awayMl) ? null : awayMl;

  // Sanity Guard: Total reasonableness by sport
  let cleanTotal = total;
  if (total !== null) {
    const s = leagueConfig.sport.toLowerCase();
    if (s === 'basketball' && (total < 100 || total > 280)) cleanTotal = null;
    if (s === 'football' && (total < 20 || total > 85)) cleanTotal = null;
    if (s === 'baseball' && (total < 5 || total > 20)) cleanTotal = null;
    if (s === 'soccer' && (total < 1 || total > 10)) cleanTotal = null;
  }

  const hasValidLine = homeSpread !== null
    || awaySpread !== null
    || cleanTotal !== null
    || cleanHomeMl !== null
    || cleanAwayMl !== null

  if (!hasValidLine) return null

  const homeCompetitor = competition?.competitors?.find(c => c.homeAway === 'home')
  const awayCompetitor = competition?.competitors?.find(c => c.homeAway === 'away')

  // Robust name resolution for opening lines
  const getResolvedName = (comp: any) => {
    const team = comp?.team;
    if (!team) return null;
    const name = team.displayName || team.name || team.shortDisplayName || team.shortName || null;
    if (name?.toLowerCase().includes('home team') || name?.toLowerCase().includes('away team')) return null;
    return name;
  };

  return {
    match_id: getCanonicalEventId(event.id, leagueConfig),
    sport: leagueConfig.label,
    source: leagueConfig.league,
    home_spread: homeSpread,
    away_spread: awaySpread,
    total: cleanTotal,
    home_ml: cleanHomeMl,
    away_ml: cleanAwayMl,
    draw_ml: drawMl,
    provider: odds.provider?.name || null,
    home_team: getResolvedName(homeCompetitor),
    away_team: getResolvedName(awayCompetitor),
  }
}

function parseDetailsString(
  details: string,
  competitors?: ESPNCompetitor[]
): { homeSpread: number | null; awaySpread: number | null } {
  const result = { homeSpread: null as number | null, awaySpread: null as number | null }
  const match = details.match(/([A-Z]{2,4})\s*([-+]?\d+(?:\.\d+)?)/i)
  if (!match) return result

  const [, abbr, spreadStr] = match
  const spreadVal = parseFloat(spreadStr)
  if (isNaN(spreadVal)) return result

  const homeTeam = competitors?.find(c => c.homeAway === 'home')?.team
  const awayTeam = competitors?.find(c => c.homeAway === 'away')?.team

  if (homeTeam?.abbreviation?.toUpperCase() === abbr.toUpperCase()) {
    result.homeSpread = spreadVal
  } else if (awayTeam?.abbreviation?.toUpperCase() === abbr.toUpperCase()) {
    result.awaySpread = spreadVal
  }

  return result
}

// Date Utilities
function generateDateRange(days: number): string[] {
  const dates: string[] = []
  const today = new Date()
  for (let i = 0; i < days; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    dates.push(d.toISOString().slice(0, 10).replace(/-/g, ''))
  }
  return dates
}

// Database Operations
async function upsertTeams(supabase: SupabaseClient, teams: TeamRecord[]): Promise<number> {
  if (teams.length === 0) return 0

  const { error } = await supabase
    .from('teams')
    .upsert(teams, { onConflict: 'id', ignoreDuplicates: false })

  if (error) {
    log.error('Failed to upsert teams', { error: error.message, count: teams.length })
    return 0
  }

  return teams.length
}

async function upsertMatch(supabase: SupabaseClient, match: MatchRecord, openingOdds?: any): Promise<boolean> {
  const payload: any = { ...match }
  if (openingOdds) {
    payload.opening_odds = openingOdds
  }

  const { error } = await supabase
    .from('matches')
    .upsert(payload, { onConflict: 'id', ignoreDuplicates: false })

  if (error) {
    log.error('Failed to upsert match', { match_id: match.id, error: error.message })
    return false
  }

  return true
}

async function insertOpeningLine(supabase: SupabaseClient, record: OpeningLineRecord): Promise<boolean> {
  // Check if already captured
  const existenceCheck = await supabase
    .from('opening_lines')
    .select('match_id')
    .eq('match_id', record.match_id)
    .maybeSingle()

  if (existenceCheck.error) {
    log.error('Existence check failed', {
      match_id: record.match_id,
      code: existenceCheck.error.code,
      error: existenceCheck.error.message,
    })
    return false
  }

  if (existenceCheck.data) {
    return false // Already exists
  }

  // Insert new opening line
  const insertResult = await supabase
    .from('opening_lines')
    .insert(record)

  if (insertResult.error) {
    if (insertResult.error.code === '23505') {
      return false // Race condition, already inserted
    }
    log.error('Database insert failed', {
      match_id: record.match_id,
      code: insertResult.error.code,
      error: insertResult.error.message
    })
    return false
  }

  return true
}

// Main Handler
Deno.serve(async (_req: Request): Promise<Response> => {
  const startTime = Date.now()

  const result: CaptureResult = {
    scanned: 0,
    new_openers: 0,
    teams_upserted: 0,
    matches_upserted: 0,
    skipped_in_progress: 0,
    skipped_no_odds: 0,
    errors: [],
    duration_ms: 0,
    leagues_processed: [],
  }

  try {
    const supabase: SupabaseClient = createClient(
      CONFIG.supabase.url,
      CONFIG.supabase.serviceRoleKey
    )

    const dates = generateDateRange(CONFIG.capture.scanWindowDays)
    log.info('Starting opening lines capture', {
      dates: dates.length,
      leagues: MONITORED_LEAGUES.length
    })

    for (const league of MONITORED_LEAGUES) {
      for (const dateStr of dates) {
        try {
          const groupsParam = league.groups ? `&groups=${league.groups}` : ''
          const url = `${CONFIG.espn.baseUrl}/${league.sport}/${league.league}/scoreboard?dates=${dateStr}&limit=${CONFIG.capture.maxEventsPerRequest}${groupsParam}`

          const res = await fetchWithRetry(url)
          if (!res) {
            result.errors.push({
              league: league.label,
              date: dateStr,
              message: 'Failed to fetch after retries',
              retryable: true,
            })
            continue
          }

          const data = await res.json()
          const events: ESPNEvent[] = data.events || []

          for (const event of events) {
            result.scanned++
            const trace: string[] = []
            trace.push(`[Init] Scanning match ${event.id} on ${dateStr} for ${league.label}`)

            const gameState = event.status?.type?.state
            if (gameState !== 'pre') {
              result.skipped_in_progress++
              continue
            }

            // Step 1: Upsert teams
            const teams = extractTeams(event, league)
            const teamsUpserted = await upsertTeams(supabase, teams)
            result.teams_upserted += teamsUpserted

            // Step 2: Upsert match
            const match = extractMatch(event, league)
            if (match) {
              match.ingest_trace = trace
              const matchUpserted = await upsertMatch(supabase, match)
              if (matchUpserted) {
                result.matches_upserted++
                trace.push(`[Match] Upserted core match metadata`)
              } else {
                trace.push(`[Match] Failed to upsert match metadata`)
              }
            }

            // Step 3: Extract and insert opening line
            const record = extractOpeningLine(event, league)
            if (!record) {
              result.skipped_no_odds++
              trace.push(`[Skip] No valid opening odds found in ESPN response`)

              // Still update the trace in the match record to explain why no odds
              if (match) {
                await supabase.from('matches').update({ ingest_trace: trace }).eq('id', match.id);
              }
              continue
            }

            trace.push(`[Odds] Extracted opening odds from ${record.provider || 'ESPN'}: S:${record.home_spread ?? 'N/A'}/${record.away_spread ?? 'N/A'} T:${record.total ?? 'N/A'}`);

            const inserted = await insertOpeningLine(supabase, record)
            if (inserted) {
              result.new_openers++
              trace.push(`[Success] Opening line persisted to registry`)
              log.info('Captured opening line', {
                match_id: record.match_id,
                league: league.label,
                provider: record.provider,
              })
            } else {
              trace.push(`[Sync] Opening line already exists or skipped`)
            }

            // Final trace update
            if (match) {
              await supabase.from('matches').update({ ingest_trace: trace }).eq('id', match.id);
            }
          }

          await sleep(CONFIG.capture.rateLimitDelayMs)

        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          log.error('League processing error', {
            league: league.label,
            date: dateStr,
            error: errorMsg
          })
          result.errors.push({
            league: league.label,
            date: dateStr,
            message: errorMsg,
            retryable: false,
          })
        }
      }
      result.leagues_processed.push(league.label)
    }

    result.duration_ms = Date.now() - startTime

    log.info('Capture complete', {
      scanned: result.scanned,
      new_openers: result.new_openers,
      teams_upserted: result.teams_upserted,
      matches_upserted: result.matches_upserted,
      errors: result.errors.length,
      duration_ms: result.duration_ms,
    })

    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    log.error('Fatal error in capture service', { error: errorMsg })

    return new Response(
      JSON.stringify({
        error: errorMsg,
        duration_ms: Date.now() - startTime
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
})
