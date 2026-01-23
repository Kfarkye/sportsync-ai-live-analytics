
import { dbService } from "./dbService";
import { supabase } from '../lib/supabase';
import { Match } from '../types';
import { LEAGUES } from '../constants';
import { normalizeOpeningLines, normalizeClosingLines, isMatchFinal, getOddsValue, normalizeEnhancedOdds } from '../utils/oddsUtils';
import { getCanonicalMatchId } from '../utils/matchRegistry';
import { debugManager } from '../lib/debug';

// --- CONFIGURATION ---
const CONFIG = {
  ENABLE_LOGGING: true,
  LOG_LEVEL: 'INFO',
  DEBUG_TARGET: "Rams",
  PERF_METRICS: true,
  QUERY_WINDOW_HOURS: 48,
  MATCH_TOLERANCE_HOURS: 36,
  ODDS_DECIMAL_THRESHOLD: 20,
  MIN_MASCOT_LEN: 2,
  MAX_MONEYLINE: 7500,
  CACHE_TTL_MS: 30000,
};

// --- CACHE STATE ---
const MEMORY_CACHE = {
  feeds: null as { data: any[], timestamp: number } | null,
  processed: new Map<string, { data: Match, timestamp: number }>()
};

// --- LOGGING ---
const Logger = {
  emit: (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', msg: string, meta?: any, contextKey?: string) => {
    if (!CONFIG.ENABLE_LOGGING) return;
    const entry = { timestamp: new Date().toISOString(), level, context: 'OddsService', message: msg, ...(contextKey ? { matchKey: contextKey } : {}), ...meta };
    if (typeof window !== 'undefined') {
      const styles = { ERROR: 'color: #ef4444', WARN: 'color: #f59e0b', INFO: 'color: #3b82f6', DEBUG: 'color: #a855f7' };
      console.log(`%c[${level}] ${contextKey ? `[${contextKey}] ` : ''}${msg}`, styles[level], meta || '');
    } else {
      console.log(JSON.stringify(entry));
    }
  },
  debug: (msg: string, ctxKey?: string, meta?: any) => Logger.emit('DEBUG', msg, meta, ctxKey),
  info: (msg: string, ctxKey?: string, meta?: any) => Logger.emit('INFO', msg, meta, ctxKey),
  warn: (msg: string, ctxKey?: string, meta?: any) => Logger.emit('WARN', msg, meta, ctxKey),
  error: (msg: string, err?: any, ctxKey?: string) => Logger.emit('ERROR', msg, { error: err }, ctxKey),
  timer: (label: string) => {
    const start = performance.now();
    return () => {
      const duration = (performance.now() - start).toFixed(2);
      Logger.info(`${label} completed`, undefined, { durationMs: duration });
    };
  }
};

// --- TYPES ---
export interface OddsPoint { value: number; price: number; formattedPoint: string; formattedPrice: string; bookmaker: string; }
export interface DetailedOdds {
  moneyline?: { home: OddsPoint; away: OddsPoint; draw?: OddsPoint; marketSize?: number };
  spread?: { home: OddsPoint; away: OddsPoint };
  total?: { over: OddsPoint; under: OddsPoint };
}
interface Outcome { name: string; price: number; point?: number; }
interface Market { key: string; outcomes: Outcome[]; }
interface Bookmaker { key: string; title: string; markets: Market[]; last_update: string; }
interface MarketFeed {
  home_team: string; away_team: string; commence_time: string; last_updated: string;
  raw_bookmakers: Bookmaker[] | string; sport_key: string; canonical_id?: string;
}
interface CachedFeed extends MarketFeed {
  _homeNorm: string; _awayNorm: string; _homeMascot: string; _awayMascot: string;
  _matchKey: string; _timestamp: number; _books: Bookmaker[];
  _bestSpread?: any; _bestH2h?: any; _bestTotal?: any; _isLive?: boolean;
}

// --- NORMALIZATION HELPERS ---
const normalize = (name: string): string => {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, '').trim();
};

const getIdentifiers = (name: string): string[] => {
  const norm = normalize(name);
  if (!norm) return [];
  const parts = norm.split(' ');
  const mascot = parts[parts.length - 1];
  const primary = parts[0];
  return [mascot, primary];
};

const getMatchKey = (teamA: string, teamB: string, sportKey?: string): string => {
  const idsA = getIdentifiers(teamA);
  const idsB = getIdentifiers(teamB);
  const baseKey = [idsA[0], idsB[0]].sort().join('_');
  return sportKey ? `${sportKey}:${baseKey}` : baseKey;
};

// Helper: Chunk array into smaller batches
const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

// --- MAIN SERVICE ---
export const mergePremiumOdds = async (matches: Match[]): Promise<Match[]> => {
  const endServiceTimer = Logger.timer('Total Odds Merge');
  if (!matches || matches.length === 0) return [];

  try {
    const leaguesInMatches = new Set(matches.map(m => m.leagueId));
    const keysToFetch = LEAGUES.filter(l => leaguesInMatches.has(l.id) && l.oddsKey).map(l => l.oddsKey);
    // Even if no odds keys, we might want to fetch stats/scores from DB if checking canonicals
    // But original logic returned early. We'll keep it for now but be mindful.
    if (keysToFetch.length === 0) return matches;

    const startTimes = matches.map(m => new Date(m.startTime).getTime()).filter(t => !isNaN(t));
    const minTime = startTimes.length ? Math.min(...startTimes) : Date.now();
    const maxTime = startTimes.length ? Math.max(...startTimes) : Date.now();
    const queryStart = new Date(minTime - (CONFIG.QUERY_WINDOW_HOURS * 3600 * 1000)).toISOString();
    const queryEnd = new Date(maxTime + (CONFIG.QUERY_WINDOW_HOURS * 3600 * 1000)).toISOString();

    // 1. Fetch Market Feeds (these filter by sport_key, so usually not too huge, but safer to check)
    // Sport keys are few, so one query is fine usually.
    const feedsRes = await supabase.from('market_feeds')
      .select('*')
      .in('sport_key', keysToFetch)
      .gte('commence_time', queryStart)
      .lte('commence_time', queryEnd)
      .order('last_updated', { ascending: false });

    // 2. CHUNKED QUERIES for Matches, Opening, Closing (IDs can be thousands)
    const matchesChunks = chunkArray(matches, 40); // 40 items per chunk to keep URL safe

    // Preparation for parallel execution
    const dbMatchesPromise = Promise.all(matchesChunks.map(chunk =>
      supabase.from('matches')
        .select('id, current_odds, status, home_score, away_score, display_clock, updated_at, is_shielded')
        .in('id', chunk.map(m => getCanonicalMatchId(m.id, m.leagueId)))
    ));

    const openingPromise = Promise.all(matchesChunks.map(chunk =>
      supabase.from('opening_lines').select('*').in('match_id', chunk.map(m => m.id))
    ));

    const closingPromise = Promise.all(matchesChunks.map(chunk =>
      supabase.from('closing_lines').select('*').in('match_id', chunk.map(m => m.id))
    ));

    const [dbMatchesResults, openingResults, closingResults] = await Promise.all([
      dbMatchesPromise,
      openingPromise,
      closingPromise
    ]);

    // Flatten results
    const rawFeeds = feedsRes.data || [];
    const dbMatches = dbMatchesResults.flatMap(r => r.data || []);
    const openingData = openingResults.flatMap(r => r.data || []);
    const closingData = closingResults.flatMap(r => r.data || []);

    const openingMap = new Map(openingData.map(r => [r.match_id, normalizeOpeningLines(r)]));
    const closingMap = new Map(closingData.map(r => [r.match_id, normalizeClosingLines(r)]));

    // Index feeds
    const cachedFeeds: CachedFeed[] = rawFeeds.map(f => ({
      ...f,
      _matchKey: getMatchKey(f.home_team, f.away_team, f.sport_key),
      _books: typeof f.raw_bookmakers === 'string' ? JSON.parse(f.raw_bookmakers) : (f.raw_bookmakers || []),
      _bestSpread: f.best_spread, _bestH2h: f.best_h2h, _bestTotal: f.best_total, _isLive: f.is_live
    }));

    const feedIdMap = new Map(cachedFeeds.filter(f => f.canonical_id).map(f => [f.canonical_id!, f]));
    const strictMap = new Map<string, CachedFeed[]>();
    const idMap = new Map<string, CachedFeed[]>();

    cachedFeeds.forEach(f => {
      if (!strictMap.has(f._matchKey)) strictMap.set(f._matchKey, []);
      strictMap.get(f._matchKey)!.push(f);
      [...getIdentifiers(f.home_team), ...getIdentifiers(f.away_team)].forEach(id => {
        if (!idMap.has(id)) idMap.set(id, []);
        idMap.get(id)!.push(f);
      });
    });

    debugManager.info('OddsService', 'Feeds Prepared', undefined, { feedCount: cachedFeeds.length, withCanonical: feedIdMap.size });

    return matches.map(match => {
      try {
        const hIds = getIdentifiers(match.homeTeam.name);
        const aIds = getIdentifiers(match.awayTeam.name);
        const lObj = LEAGUES.find(l => l.id === match.leagueId);
        const mKey = getMatchKey(match.homeTeam.name, match.awayTeam.name, lObj?.oddsKey);

        // Pre-Merge DB Data
        const dbM = dbMatches.find(m => m.id === getCanonicalMatchId(match.id, match.leagueId));
        if (dbM) {
          if (dbM.current_odds) match.current_odds = dbM.current_odds;
          if (dbM.is_shielded && !isMatchFinal(match.status)) {
            if (dbM.status) match.status = dbM.status;
            if (dbM.home_score !== undefined) match.homeScore = dbM.home_score;
            if (dbM.away_score !== undefined) match.awayScore = dbM.away_score;
            if (dbM.display_clock) match.displayClock = dbM.display_clock;
          }
        }

        match.opening_odds = openingMap.get(match.id);
        if (isMatchFinal(match.status)) match.closing_odds = closingMap.get(match.id);

        // Resolve Feed
        let feed = feedIdMap.get(match.canonical_id || '');
        let method = 'CANONICAL';

        if (!feed) {
          feed = strictMap.get(mKey)?.[0];
          method = 'STRICT';
        }

        if (!feed) {
          const candidates = [...hIds, ...aIds].flatMap(id => idMap.get(id) || []);
          feed = candidates.find(f => {
            const fIds = [...getIdentifiers(f.home_team), ...getIdentifiers(f.away_team)];
            return hIds.some(id => fIds.includes(id)) && aIds.some(id => fIds.includes(id));
          });
          method = 'FUZZY';
        }

        debugManager.trace('OddsService', 'Resolving Feed', match.id, { method, canonicalId: match.canonical_id, mKey, found: !!feed });

        if (feed) {
          const odds = normalizeEnhancedOdds({
            ...feed,
            match_id: match.id,
            homeML: feed._bestH2h?.home?.price, awayML: feed._bestH2h?.away?.price, drawML: feed._bestH2h?.draw?.price,
            homeSpread: feed._bestSpread?.home?.point, awaySpread: feed._bestSpread?.home?.point,
            total: feed._bestTotal?.over?.point,
            provider: feed._isLive ? "Live" : (feed._bestSpread?.home?.bookmaker || "Consensus")
          });
          match.odds = odds;
          if (feed._isLive) match.current_odds = { ...match.current_odds, ...odds, isLive: true };
        }

        return match;
      } catch (err) {
        Logger.error("Error merging match odds", match.id, err);
        return match;
      }
    });

  } catch (e) {
    Logger.error("Critical Service Failure", e);
    return matches;
  } finally {
    endServiceTimer();
  }
};
