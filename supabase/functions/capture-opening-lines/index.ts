import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getCanonicalMatchId } from '../_shared/match-registry.ts'

declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Promise<Response>): void
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
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

// League Registry (Decoupled ESPN API path vs DB schema)
interface LeagueConfig {
  dbSport: string    // DB canonical sport
  espnSport: string  // URL path sport
  league: string
  leagueId: string
  label: string
  groups?: string
}

const MONITORED_LEAGUES: LeagueConfig[] = [
  { dbSport: 'americanfootball', espnSport: 'football', league: 'nfl', leagueId: 'nfl', label: 'NFL' },
  { dbSport: 'basketball', espnSport: 'basketball', league: 'nba', leagueId: 'nba', label: 'NBA' },
  { dbSport: 'baseball', espnSport: 'baseball', league: 'mlb', leagueId: 'mlb', label: 'MLB' },
  { dbSport: 'icehockey', espnSport: 'hockey', league: 'nhl', leagueId: 'nhl', label: 'NHL' },
  { dbSport: 'basketball', espnSport: 'basketball', league: 'wnba', leagueId: 'wnba', label: 'WNBA' },
  { dbSport: 'basketball', espnSport: 'basketball', league: 'mens-college-basketball', leagueId: 'mens-college-basketball', label: 'NCAAB', groups: '50' },
  { dbSport: 'americanfootball', espnSport: 'football', league: 'college-football', leagueId: 'college-football', label: 'NCAAF', groups: '80' },
  { dbSport: 'soccer', espnSport: 'soccer', league: 'eng.1', leagueId: 'epl', label: 'EPL' },
  { dbSport: 'soccer', espnSport: 'soccer', league: 'esp.1', leagueId: 'laliga', label: 'La Liga' },
  { dbSport: 'soccer', espnSport: 'soccer', league: 'ger.1', leagueId: 'bundesliga', label: 'Bundesliga' },
  { dbSport: 'soccer', espnSport: 'soccer', league: 'ita.1', leagueId: 'seriea', label: 'Serie A' },
  { dbSport: 'soccer', espnSport: 'soccer', league: 'fra.1', leagueId: 'ligue1', label: 'Ligue 1' },
  { dbSport: 'soccer', espnSport: 'soccer', league: 'usa.1', leagueId: 'mls', label: 'MLS' },
  { dbSport: 'soccer', espnSport: 'soccer', league: 'uefa.champions', leagueId: 'ucl', label: 'UCL' },
  { dbSport: 'soccer', espnSport: 'soccer', league: 'uefa.europa', leagueId: 'uel', label: 'UEL' },
  { dbSport: 'mma', espnSport: 'mma', league: 'ufc', leagueId: 'ufc', label: 'UFC' },
  { dbSport: 'tennis', espnSport: 'tennis', league: 'atp', leagueId: 'atp', label: 'ATP' },
  { dbSport: 'tennis', espnSport: 'tennis', league: 'wta', leagueId: 'wta', label: 'WTA' },
  { dbSport: 'golf', espnSport: 'golf', league: 'pga', leagueId: 'pga', label: 'PGA' },
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
  sport: string
  home_team_id?: string
  away_team_id?: string
  home_team?: string
  away_team?: string
  start_time: string
  status: string
  opening_odds?: any
}

interface OpeningLineRecord {
  match_id: string
  home_spread: number | null
  away_spread: number | null
  total: number | null
  home_ml: number | null
  away_ml: number | null
  provider: string | null
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
  }
  homeTeamOdds?: { moneyLine?: string | number }
  awayTeamOdds?: { moneyLine?: string | number }
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

// Safe Type Converters
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

function parseAmerican(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const str = String(val).toLowerCase().trim();
  if (str === 'ev' || str === 'even') return 100;
  const num = parseInt(str.replace('+', ''), 10);
  return isNaN(num) ? null : num;
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

    let resolvedName = team.displayName || team.name || team.shortDisplayName || team.shortName || 'Unknown';

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

function extractMatch(event: ESPNEvent, leagueConfig: LeagueConfig): MatchRecord {
  const competition = event.competitions?.[0]
  const homeCompetitor = competition?.competitors?.find(c => c.homeAway === 'home')
  const awayCompetitor = competition?.competitors?.find(c => c.homeAway === 'away')

  const finalId = getCanonicalMatchId(event.id, leagueConfig.leagueId);
  const statusName = event.status?.type?.name || event.status?.type?.state || 'STATUS_SCHEDULED'

  const getResolvedName = (comp: any) => {
    const team = comp?.team;
    if (!team) return null;
    const name = team.displayName || team.name || team.shortDisplayName || team.shortName || null;
    if (name?.toLowerCase().includes('home team') || name?.toLowerCase().includes('away team')) return null;
    return name;
  };

  // 🚨 FIXED: Only attaches keys if they exist so it doesn't overwrite DB with nulls
  const matchRecord: MatchRecord = {
    id: finalId,
    league_id: leagueConfig.leagueId,
    sport: leagueConfig.dbSport,
    start_time: event.date,
    status: statusName,
  }

  const hId = homeCompetitor?.team?.id;
  if (hId) matchRecord.home_team_id = hId;
  const aId = awayCompetitor?.team?.id;
  if (aId) matchRecord.away_team_id = aId;

  const hName = getResolvedName(homeCompetitor);
  if (hName) matchRecord.home_team = hName;
  const aName = getResolvedName(awayCompetitor);
  if (aName) matchRecord.away_team = aName;

  return matchRecord;
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
    ?? parseTotalValue(odds.overUnder)
    ?? parseTotalValue((odds as any).total?.line);

  const homeMlRaw = normalizeOdds(odds.moneyline?.home?.open?.odds)
    ?? normalizeOdds(odds.moneyline?.home?.current?.odds)
    ?? normalizeOdds(odds.homeTeamOdds?.moneyLine)

  const awayMlRaw = normalizeOdds(odds.moneyline?.away?.open?.odds)
    ?? normalizeOdds(odds.moneyline?.away?.current?.odds)
    ?? normalizeOdds(odds.awayTeamOdds?.moneyLine)

  const isExtremeML = (ml: string | null) => {
    if (!ml) return false;
    if (ml.toUpperCase() === 'EVEN' || ml.toUpperCase() === 'EV') return false;
    const val = Math.abs(parseInt(ml.replace('+', ''), 10));
    if (isNaN(val)) return false;
    return val >= 4000 || val < 100;
  };

  const cleanHomeMl = isExtremeML(homeMlRaw) ? null : parseAmerican(homeMlRaw);
  const cleanAwayMl = isExtremeML(awayMlRaw) ? null : parseAmerican(awayMlRaw);

  let cleanTotal = total;
  if (total !== null) {
    const s = leagueConfig.dbSport.toLowerCase();
    if (s === 'basketball' && (total < 100 || total > 280)) cleanTotal = null;
    if (s === 'americanfootball' && (total < 20 || total > 85)) cleanTotal = null;
    if (s === 'baseball' && (total < 5 || total > 20)) cleanTotal = null;
    if (s === 'soccer' && (total < 1 || total > 10)) cleanTotal = null;
  }

  const hasValidLine = homeSpread !== null
    || awaySpread !== null
    || cleanTotal !== null
    || cleanHomeMl !== null
    || cleanAwayMl !== null

  if (!hasValidLine) return null

  return {
    match_id: getCanonicalMatchId(event.id, leagueConfig.leagueId),
    home_spread: homeSpread,
    away_spread: awaySpread,
    total: cleanTotal,
    home_ml: cleanHomeMl,
    away_ml: cleanAwayMl,
    provider: odds.provider?.name || null
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
  const { error } = await supabase.from('teams').upsert(teams, { onConflict: 'id', ignoreDuplicates: false })
  if (error) {
    log.error('Failed to upsert teams', { error: error.message, count: teams.length })
    return 0
  }
  return teams.length
}

async function upsertMatch(supabase: SupabaseClient, match: MatchRecord): Promise<boolean> {
  const { error } = await supabase.from('matches').upsert(match, { onConflict: 'id', ignoreDuplicates: false })
  if (error) {
    log.error('Failed to upsert match', { match_id: match.id, error: error.message })
    return false
  }
  return true
}

async function insertOpeningLine(supabase: SupabaseClient, record: OpeningLineRecord): Promise<boolean> {
  const existenceCheck = await supabase.from('opening_lines').select('match_id').eq('match_id', record.match_id).maybeSingle()
  if (existenceCheck.error || existenceCheck.data) return false

  const insertResult = await supabase.from('opening_lines').insert(record)
  if (insertResult.error) {
    if (insertResult.error.code !== '23505') {
      log.error('Database insert failed', { match_id: record.match_id, error: insertResult.error.message })
    }
    return false
  }
  return true
}

// Main Handler
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

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
    const supabase: SupabaseClient = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceRoleKey)
    const dates = generateDateRange(CONFIG.capture.scanWindowDays)

    for (const league of MONITORED_LEAGUES) {
      for (const dateStr of dates) {
        try {
          const groupsParam = league.groups ? `&groups=${league.groups}` : ''
          const url = `${CONFIG.espn.baseUrl}/${league.espnSport}/${league.league}/scoreboard?dates=${dateStr}&limit=${CONFIG.capture.maxEventsPerRequest}${groupsParam}`

          const res = await fetchWithRetry(url)
          if (!res) continue

          const data = await res.json()
          const events: ESPNEvent[] = data?.events || []

          for (const event of events) {
            result.scanned++
            const trace: string[] = []

            const gameState = event.status?.type?.state
            if (gameState !== 'pre') {
              result.skipped_in_progress++
              continue
            }

            const teams = extractTeams(event, league)
            const teamsUpserted = await upsertTeams(supabase, teams)
            result.teams_upserted += teamsUpserted

            const match = extractMatch(event, league)
            const record = extractOpeningLine(event, league)

            // 🚨 FIXED: Never overwrites opening odds unless we are officially inserting a true brand new opening line
            let insertedNewOpeningLine = false;
            if (record) {
              insertedNewOpeningLine = await insertOpeningLine(supabase, record)
              if (insertedNewOpeningLine) {
                result.new_openers++
                trace.push(`[Success] Opening line persisted`)
              }
            } else {
              result.skipped_no_odds++
            }

            if (match) {
              if (record && insertedNewOpeningLine) {
                match.opening_odds = {
                  homeSpread: record.home_spread,
                  awaySpread: record.away_spread,
                  total: record.total,
                  homeWin: record.home_ml,
                  awayWin: record.away_ml,
                  provider: record.provider
                }
              }
              const matchUpserted = await upsertMatch(supabase, match)
              if (matchUpserted) {
                result.matches_upserted++
              }
            }

          }
          await sleep(CONFIG.capture.rateLimitDelayMs)
        } catch (err) {
          result.errors.push({ league: league.label, date: dateStr, message: String(err), retryable: false })
        }
      }
      result.leagues_processed.push(league.label)
    }

    result.duration_ms = Date.now() - startTime
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error), duration_ms: Date.now() - startTime }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
