import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import TeamLogo from '../components/shared/TeamLogo';
import { getLeagueDisplayName } from '../utils/leagueDisplay';
import { getTeamLogo as resolveEspnTeamLogo } from '../lib/teamColors';
import { getGatewayUrl } from '@/services/sportsyncAccessService';
import SEOHead from '@/components/seo/SEOHead';

type Direction = 'TREND' | 'FADE' | 'NEUTRAL';
type DirectionFilter = 'ALL' | Direction;
type SortMode = 'strength' | 'hit' | 'sample' | 'alpha';
type SportFilter = 'All' | 'Soccer' | 'NBA' | 'NHL' | 'MLB' | 'NCAAB' | 'MLS';

type RawTrendRow = {
  section?: unknown;
  layer?: unknown;
  team?: unknown;
  league?: unknown;
  trend?: unknown;
  record?: unknown;
  hit_rate?: unknown;
  sample?: unknown;
  last_held?: unknown;
  signal_type?: unknown;
};

type TrendRow = {
  layer: string;
  team: string;
  league: string;
  trend: string;
  record: string;
  hit_rate: number;
  sample: number;
  last_held: boolean | null;
  signal_type: Direction;
};

type LogoLookup = Record<string, string>;
type TeamRow = {
  team_name?: unknown;
  league_id?: unknown;
  logo_url?: unknown;
};

type TeamFallbackRow = {
  name?: unknown;
  league_id?: unknown;
  logo_url?: unknown;
};

type MatchRow = {
  id?: unknown;
  league_id?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  start_time?: unknown;
  status?: unknown;
};

type NextMatchInfo = {
  opponent: string;
  isHome: boolean;
  startsAt: string;
  startsLabel: string;
  isToday: boolean;
};

type NextMatchLookup = Record<string, NextMatchInfo | null>;

type LayerSummary = {
  layer: string;
  avgHitRate: number;
  count: number;
  above80: number;
  sampleAtLeast10: number;
  perfect: number;
};

type MatchFeedMetric = {
  avgTotalScore: number | null;
  avgCorners: number | null;
  avgCards: number | null;
  avgPassPct: number | null;
  avgShotAccuracy: number | null;
  overRoi: number | null;
  homeAtsRoi: number | null;
};

type TrendFetchError = {
  status?: number;
  code?: string;
  details?: string;
  message: string;
};

const SPORT_FILTERS: SportFilter[] = ['All', 'Soccer', 'NBA', 'NHL', 'MLB', 'NCAAB', 'MLS'];

const SOCCER_LEAGUES = [
  '.1',
  'uefa.',
  'fifa.',
  'eng.1',
  'esp.1',
  'ger.1',
  'fra.1',
  'ita.1',
  'ligue1',
  'laliga',
  'seriea',
  'bundesliga',
  'mex.1',
];
const SOCCER_MARKERS = ['eng1', 'esp1', 'ger1', 'fra1', 'ita1', 'ligue1', 'laliga', 'seriea', 'bundesliga', 'uefa', 'fifa', 'soccer', 'premierleague', 'premier'];

const LEAGUE_BADGES: Record<string, string> = {
  epl: 'Premier League',
  'eng.1': 'Premier League',
  esp: 'La Liga',
  'esp.1': 'La Liga',
  ger: 'Bundesliga',
  'ger.1': 'Bundesliga',
  fra: 'Ligue 1',
  'fra.1': 'Ligue 1',
  ita: 'Serie A',
  'ita.1': 'Serie A',
  l1: 'Ligue 1',
  mls: 'MLS',
  nba: 'NBA',
  nhl: 'NHL',
  mlb: 'MLB',
  ncaab: 'NCAAB',
  'mens-college-basketball': 'NCAAB',
  'usa.1': 'MLS',
  'fifa.worldq.afc': 'WCQ AFC',
  'fifa.worldq.conmebol': 'WCQ CONMEBOL',
  'fifa.worldq.caf': 'WCQ CAF',
  'fifa.worldq.uefa': 'WCQ UEFA',
  'fifa.worldq.concacaf': 'WCQ CONCACAF',
};

const LEAGUE_BADGE_ICON_URLS: Record<string, string> = {
  nba: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png',
  nhl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png',
  mlb: 'https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png',
  mls: 'https://a.espncdn.com/i/teamlogos/leagues/500/19.png',
  ncaab: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-basketball.png',
  'mens-college-basketball': 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-basketball.png',
  'eng.1': 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png',
  'esp.1': 'https://a.espncdn.com/i/leaguelogos/soccer/500/15.png',
  'ger.1': 'https://a.espncdn.com/i/leaguelogos/soccer/500/10.png',
  'fra.1': 'https://a.espncdn.com/i/leaguelogos/soccer/500/9.png',
  'ita.1': 'https://a.espncdn.com/i/leaguelogos/soccer/500/12.png',
  ligue1: 'https://a.espncdn.com/i/leaguelogos/soccer/500/8.png',
  laliga: 'https://a.espncdn.com/i/leaguelogos/soccer/500/5.png',
  seriea: 'https://a.espncdn.com/i/leaguelogos/soccer/500/16.png',
  bundesliga: 'https://a.espncdn.com/i/leaguelogos/soccer/500/11.png',
  epl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png',
  'usa.1': 'https://a.espncdn.com/i/leaguelogos/soccer/500/19.png',
  'uefa.champions': 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',
  'uefa.europa': 'https://a.espncdn.com/i/leaguelogos/soccer/500/2310.png',
  'fifa.worldq.afc': 'https://a.espncdn.com/i/leaguelogos/soccer/500/62.png',
  'fifa.worldq.caf': 'https://a.espncdn.com/i/leaguelogos/soccer/500/63.png',
  'fifa.worldq.uefa': 'https://a.espncdn.com/i/leaguelogos/soccer/500/67.png',
  'fifa.worldq.concacaf': 'https://a.espncdn.com/i/leaguelogos/soccer/500/64.png',
  'fifa.worldq.conmebol': 'https://a.espncdn.com/i/leaguelogos/soccer/500/65.png',
};

const LEAGUE_BADGE_ICON_EMOJIS: Record<string, string> = {
  nba: '🏀',
  nhl: '🏒',
  mlb: '⚾',
  mls: '⚽',
  ncaab: '🏀',
  'mens-college-basketball': '🏀',
  soccer: '⚽',
  'uefa.champions': '🏆',
  'uefa.europa': '🏆',
};

const LAYER_LABELS: Record<string, string> = {
  TEAM_ATS_LINE: 'ATS Line',
  TEAM_OU_LINE: 'O/U Line',
  SOCCER_1H_BTTS: '1H BTTS',
  SOCCER_HALF_GOALS: 'Half Goals',
  SOCCER_LATE_GOALS: 'Late Goals',
  SOCCER_CORNERS: 'Corners',
  SOCCER_CARDS: 'Cards',
  SOCCER_1H_TOTAL: '1H Total',
  SOCCER_TEAM_TOTAL: 'Team Total',
};

const TEAM_LOOKUP_BATCH_SIZE = 20;
const LEAGUE_LOOKUP_BATCH_SIZE = 80;
type TrendLookupTable = 'team_logos' | 'matches';
type TableAvailability = 'unknown' | 'available' | 'unavailable';

const LOOKUP_TABLE_AVAILABILITY: Record<TrendLookupTable, TableAvailability> = {
  team_logos: 'unknown',
  matches: 'unknown',
};

const LOOKUP_TABLE_PROBES: Partial<Record<TrendLookupTable, Promise<boolean>>> = {};
const SPORTS_GATEWAY_URL = getGatewayUrl();

const isTableUnavailableError = (error: unknown): boolean => {
  if (!error) return false;
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = `${candidate.code || ''} ${candidate.message || ''} ${candidate.details || ''} ${candidate.hint || ''}`.toLowerCase();
  return (
    text.includes('does not exist') ||
    text.includes('relation') ||
    text.includes('42p01') ||
    text.includes('404')
  );
};

const isRpcUnavailableError = (error: unknown, functionName: string): boolean => {
  if (!error) return false;
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = `${candidate.code || ''} ${candidate.message || ''} ${candidate.details || ''} ${candidate.hint || ''}`.toLowerCase();
  const fn = functionName.toLowerCase();
  return (
    text.includes('pgrst202') ||
    text.includes('42883') ||
    (text.includes(fn) && text.includes('does not exist')) ||
    (text.includes(fn) && text.includes('not found')) ||
    text.includes('could not find the function')
  );
};

const isTableAvailable = async (table: TrendLookupTable): Promise<boolean> => {
  const status = LOOKUP_TABLE_AVAILABILITY[table];
  if (status === 'available') return true;
  if (status === 'unavailable') return false;

  if (LOOKUP_TABLE_PROBES[table]) return LOOKUP_TABLE_PROBES[table]!;

  LOOKUP_TABLE_PROBES[table] = (async () => {
    try {
      const { error } = await supabase.from(table).select('*').limit(1);
      if (isTableUnavailableError(error)) {
        LOOKUP_TABLE_AVAILABILITY[table] = 'unavailable';
        return false;
      }
      LOOKUP_TABLE_AVAILABILITY[table] = 'available';
      return true;
    } catch {
      LOOKUP_TABLE_AVAILABILITY[table] = 'available';
      return true;
    }
  })();

  return LOOKUP_TABLE_PROBES[table]!;
};

function normalizeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeInteger(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return null;
}

function normalizeDirection(value: unknown): Direction {
  const v = normalizeText(value).toUpperCase();
  if (v === 'FADE') return 'FADE';
  if (v === 'NEUTRAL' || v === 'N/A' || v === 'NONE' || v === 'NAN') return 'NEUTRAL';
  if (v === 'TREND') return 'TREND';
  return 'TREND';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toTrendFetchError(error: unknown): TrendFetchError {
  if (!isObject(error)) {
    return { message: 'Unable to load trend data.' };
  }

  const status = typeof error.status === 'number' ? error.status : undefined;
  const code = typeof error.code === 'string' ? error.code : undefined;
  const details = typeof error.details === 'string' ? error.details : undefined;
  const message = typeof error.message === 'string' ? error.message : 'Unable to load trend data.';
  return {
    message,
    status,
    code,
    details,
  };
}

function sanitizeLayer(value: string): string {
  return value.trim();
}

function normalizeLeagueLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9.]/g, '');
}

function normalizeLeagueKey(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function leagueDisplayLabel(value: string): string {
  const key = value.trim().toLowerCase();
  return LEAGUE_BADGES[key] ?? LEAGUE_BADGES[normalizeLeagueLookupKey(value)] ?? getLeagueDisplayName(value);
}

function leagueDisplayIconUrl(value: string): string | null {
  const key = value.trim().toLowerCase();
  const compactKey = normalizeLeagueLookupKey(value);
  const compactParts = compactKey.split('.');
  if (LEAGUE_BADGE_ICON_URLS[key]) return LEAGUE_BADGE_ICON_URLS[key];
  if (LEAGUE_BADGE_ICON_URLS[compactKey]) return LEAGUE_BADGE_ICON_URLS[compactKey];
  if (compactParts[0] && LEAGUE_BADGE_ICON_URLS[compactParts[0]]) return LEAGUE_BADGE_ICON_URLS[compactParts[0]];
  if (compactKey.includes('nba') || compactKey.includes('ncaab')) return LEAGUE_BADGE_ICON_URLS.nba;
  if (compactKey.includes('nhl')) return LEAGUE_BADGE_ICON_URLS.nhl;
  if (compactKey.includes('mlb')) return LEAGUE_BADGE_ICON_URLS.mlb;
  return null;
}

function leagueDisplayIconFallback(value: string): string {
  const key = value.trim().toLowerCase();
  const compactKey = normalizeLeagueLookupKey(value);
  return LEAGUE_BADGE_ICON_EMOJIS[key] ?? LEAGUE_BADGE_ICON_EMOJIS[compactKey] ?? '🏆';
}

function sectionToLayer(section: string): string {
  const key = section.trim().toLowerCase();
  if (key === 'team') return 'TEAM';
  if (key === 'team ml') return 'TEAM_ML';
  if (key === 'against the spread') return 'TEAM_ATS_LINE';
  if (key === 'over/under the line') return 'TEAM_OU_LINE';
  if (key === 'first half both teams to score') return 'SOCCER_1H_BTTS';
  if (key === 'second half goals') return 'SOCCER_HALF_GOALS';
  if (key === 'late goals (after 75\')' || key === 'late goals') return 'SOCCER_LATE_GOALS';
  if (key === 'corners') return 'SOCCER_CORNERS';
  if (key === 'cards') return 'SOCCER_CARDS';
  if (key === 'league-wide trends') return 'LEAGUE';
  return section.trim();
}

function toSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function teamLeagueKey(team: string, league: string): string {
  return `${toSlug(team)}|${toSlug(league)}`;
}

function teamAnyKey(team: string): string {
  return `${toSlug(team)}|`;
}

function normalizeMatchTeam(value: string): string {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const chunkValues = <T,>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items];
  if (items.length === 0) return [];

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

function teamsMatch(rawTeamA: unknown, rawTeamB: unknown): boolean {
  const a = normalizeMatchTeam(normalizeText(rawTeamA));
  const b = normalizeMatchTeam(normalizeText(rawTeamB));
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

function formatNextGameTime(startTime: string): { label: string; isToday: boolean } {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return { label: 'TBD', isToday: false };

  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const gameDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((gameDayStart.getTime() - dayStart.getTime()) / 86_400_000);

  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  if (dayDiff === 0) return { label: `Today ${time}`, isToday: true };
  if (dayDiff === 1) return { label: `Tomorrow ${time}`, isToday: false };
  if (dayDiff === -1) return { label: `Yesterday ${time}`, isToday: false };
  return { label: `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`, isToday: false };
}

function dedupe(rows: TrendRow[]): TrendRow[] {
  const map = new Map<string, TrendRow>();

  for (const row of rows) {
    const key = `${toSlug(row.team)}|${toSlug(row.league)}|${toSlug(row.trend)}|${row.layer}`;
    const current = map.get(key);

    if (!current) {
      map.set(key, row);
      continue;
    }

    if (
      row.sample > current.sample ||
      (row.sample === current.sample && row.hit_rate > current.hit_rate) ||
      (row.sample === current.sample &&
        row.hit_rate === current.hit_rate &&
        row.signal_type === 'TREND' &&
        current.signal_type !== 'TREND')
    ) {
      map.set(key, row);
    }
  }

  return Array.from(map.values());
}

function sportFromLeague(leagueId: string): SportFilter | null {
  const normalized = leagueId.trim().toLowerCase();
  const normalizedAlnum = normalized.replace(/[^a-z0-9]/g, '');
  const normalizedWithDots = normalized.replace(/[^a-z0-9.]/g, '');

  if (normalized === 'nba' || normalized.startsWith('nba.')) return 'NBA';
  if (normalized === 'nhl' || normalized.startsWith('nhl.')) return 'NHL';
  if (normalized === 'mlb' || normalized.startsWith('mlb.')) return 'MLB';
  if (
    normalized === 'ncaab' ||
    normalized.startsWith('ncaab.') ||
    normalized === 'ncaa' ||
    normalized === 'mens-college-basketball' ||
    normalized === 'college-basketball' ||
    normalized.includes('ncaa') ||
    normalizedAlnum === 'ncaab' ||
    normalizedAlnum.startsWith('ncaa')
  ) {
    return 'NCAAB';
  }
  if (normalized === 'mls' || normalized.startsWith('mls.') || normalized.startsWith('usa.') || normalizedAlnum === 'usa1') return 'MLS';
  if (
    SOCCER_LEAGUES.some((needle) => normalizedWithDots === needle || normalizedWithDots.startsWith(`${needle}.`) || normalizedWithDots.includes(needle)) ||
    SOCCER_MARKERS.some((marker) => normalizedAlnum === marker || normalizedAlnum.includes(marker))
  ) {
    return 'Soccer';
  }
  return null;
}

function colorForScore(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 65) return 'text-amber-500';
  return 'text-rose-500';
}

function strengthScore(row: TrendRow): number {
  return row.hit_rate * Math.sqrt(row.sample);
}

function pickNextMatch(matches: MatchRow[], teamName: string): MatchRow | null {
  const target = normalizeMatchTeam(teamName);
  for (const match of matches) {
    if (teamsMatch(target, match.home_team) || teamsMatch(target, match.away_team)) {
      return match;
    }
  }
  return null;
}

function signalClass(signal: Direction): { label: string; color: string; bg: string; icon: string } {
  if (signal === 'TREND') {
    return {
      label: 'TREND',
      color: 'text-emerald-700',
      bg: 'bg-emerald-50 border-emerald-200',
      icon: '↑',
    };
  }
  if (signal === 'FADE') {
    return {
      label: 'FADE',
      color: 'text-rose-700',
      bg: 'bg-rose-50 border-rose-200',
      icon: '↓',
    };
  }
  return {
    label: 'NEUTRAL',
    color: 'text-slate-500',
    bg: 'bg-slate-50 border-slate-200',
    icon: '•',
  };
};

function layerLabel(layer: string): string {
  return LAYER_LABELS[layer] ?? layer.replace('_', ' ');
}

function buildNextGames(rows: MatchRow[]): MatchRow[] {
  const leagueSet = Array.from(new Set(rows.map((row) => normalizeLeagueKey(row.league_id)).filter(Boolean))).sort();
  const now = new Date().toISOString();
  return rows.filter((match) => {
    if (!match.start_time || !match.league_id) return false;
    const start = normalizeText(match.start_time);
    const league = normalizeLeagueKey(match.league_id);
    if (!start || !league) return false;
    if (start < now) return false;
    if (!leagueSet.includes(league)) return false;
    return true;
  });
}

async function fetchTrends(minHit: number, minGames: number, layerFilter: string): Promise<TrendRow[]> {
  const params: Record<string, unknown> = {
    p_min_rate: minHit,
    p_limit: 5000,
  };
  if (layerFilter !== 'All') params.p_layer = layerFilter;

  let sourceRows: RawTrendRow[] = [];
  const rpc = await supabase.rpc('get_trends', params);
  if (!rpc.error && Array.isArray(rpc.data) && rpc.data.length > 0) {
    sourceRows = rpc.data as RawTrendRow[];
  } else if (rpc.error && !isRpcUnavailableError(rpc.error, 'get_trends')) {
    throw toTrendFetchError(rpc.error);
  }

  if (sourceRows.length === 0) {
    const table = await supabase.from('trends').select('*').limit(5000);
    if (!table.error && Array.isArray(table.data) && table.data.length > 0) {
      sourceRows = table.data as RawTrendRow[];
    } else if (table.error && !isTableUnavailableError(table.error)) {
      throw toTrendFetchError(table.error);
    }
  }

  if (sourceRows.length === 0) {
    try {
      const url = new URL(SPORTS_GATEWAY_URL);
      url.searchParams.set('endpoint', 'trends');
      url.searchParams.set('limit', '200');
      const response = await fetch(url.toString(), { method: 'GET' });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (Array.isArray(payload?.data)) {
          sourceRows = payload.data as RawTrendRow[];
        }
      }
    } catch {
      // Keep downstream fallback behavior stable.
    }
  }

  const parsed: TrendRow[] = [];
  for (const raw of sourceRows) {
    const row = raw as Record<string, unknown>;
    const layer = sanitizeLayer(
      normalizeText(
        row.layer,
        normalizeText(row.section ? sectionToLayer(String(row.section)) : undefined, 'TEAM'),
      ),
    );
    const team = normalizeText(row.team, normalizeText(row.entity, normalizeText(row.team_name)));
    const league = normalizeText(row.league, normalizeText(row.league_id, normalizeText(row.sport_league)));
    const trend = normalizeText(row.trend, normalizeText(row.signal, normalizeText(row.description)));
    const sample = Math.round(
      normalizeNumber(
        row.sample,
        normalizeNumber(row.sample_size, normalizeNumber(row.games_sampled, normalizeNumber(row.n, 0))),
      ),
    );
    const hitRaw = normalizeNumber(
      row.hit_rate,
      normalizeNumber(row.success_rate, normalizeNumber(row.win_rate, normalizeNumber(row.rate, 0))),
    );
    const hitRate = hitRaw <= 1 ? hitRaw * 100 : hitRaw;
    const clampedHitRate = Math.min(100, Math.max(0, hitRate));

    if (!team || !league || !trend || sample < 1) continue;
    if (layerFilter !== 'All' && layer !== layerFilter) continue;

    parsed.push({
      layer,
      team,
      league,
      trend,
      record: normalizeText(row.record, normalizeText(row.data_window)),
      hit_rate: clampedHitRate,
      sample,
      last_held: normalizeBoolean(row.last_held ?? row.last_hit),
      signal_type: normalizeDirection(row.signal_type ?? row.direction ?? row.signal),
    });
  }

  return dedupe(parsed);
}

function extractNumeric(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = normalizeNumber((row as Record<string, unknown>)[key], Number.NaN);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function sumPair(left: number | null, right: number | null): number | null {
  if (!Number.isFinite(left ?? Number.NaN) && !Number.isFinite(right ?? Number.NaN)) return null;
  return (left ?? 0) + (right ?? 0);
}

function bounded(value: number | null, min: number, max: number): number | null {
  if (!Number.isFinite(value ?? Number.NaN)) return null;
  const next = value as number;
  if (next < min || next > max) return null;
  return next;
}

async function fetchMatchFeedSummary(): Promise<MatchFeedMetric | null> {
  const result = await supabase
    .from('match_feed')
    .select('*')
    .eq('status', 'finished')
    .limit(5000);

  let sourceRows: unknown[] = Array.isArray(result.data) ? result.data : [];
  if (result.error || sourceRows.length === 0) {
    try {
      const url = new URL(SPORTS_GATEWAY_URL);
      url.searchParams.set('endpoint', 'scores');
      url.searchParams.set('status', 'finished');
      url.searchParams.set('limit', '200');

      const response = await fetch(url.toString(), { method: 'GET' });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (Array.isArray(payload?.data)) {
          sourceRows = payload.data as unknown[];
        }
      }
    } catch {
      // Keep null fallback if no source is reachable.
    }
  }

  if (sourceRows.length === 0) {
    return null;
  }

  let totalScoreSum = 0;
  let cornersTotal = 0;
  let cardsTotal = 0;
  let passTotal = 0;
  let shotTotal = 0;
  let overRoiTotal = 0;
  let atsRoiTotal = 0;

  let totalScoreCount = 0;
  let cornerCount = 0;
  let cardCount = 0;
  let passCount = 0;
  let shotCount = 0;
  let overRoiCount = 0;
  let atsRoiCount = 0;

  for (const rawRow of sourceRows) {
    const row = rawRow as Record<string, unknown>;

    const homeScore = extractNumeric(row, ['home_score', 'home_points']);
    const awayScore = extractNumeric(row, ['away_score', 'away_points']);
    const totalScore = extractNumeric(row, ['total_score', 'total_points', 'combined_score']);
    const resolvedTotalScore = bounded(
      totalScore ?? sumPair(homeScore, awayScore),
      0,
      400,
    );

    const corners = extractNumeric(row, ['corners', 'total_corners', 'corner_count']);
    const cornerHome = extractNumeric(row, ['home_corners', 'corners_for_home']);
    const cornerAway = extractNumeric(row, ['away_corners', 'corners_for_away']);
    const resolvedCorners = bounded(corners ?? sumPair(cornerHome, cornerAway), 0, 40);

    const cards = extractNumeric(row, ['cards', 'total_cards', 'card_count']);
    const cardHome = extractNumeric(row, ['home_cards', 'cards_for_home', 'home_team_cards']);
    const cardAway = extractNumeric(row, ['away_cards', 'cards_for_away', 'away_team_cards']);
    const resolvedCards = bounded(cards ?? sumPair(cardHome, cardAway), 0, 20);

    const pass = bounded(
      extractNumeric(row, ['pass_pct', 'passes_pct', 'pass_percent', 'team_pass_pct', 'passing_pct']),
      0,
      100,
    );
    const shot = bounded(
      extractNumeric(row, ['shot_accuracy', 'shot_pct', 'shooting_accuracy', 'shots_accuracy']),
      0,
      100,
    );
    const overRoi = bounded(extractNumeric(row, ['over_roi', 'roi_over', 'odds_over_roi']), -200, 200);
    const homeAtsRoi = bounded(extractNumeric(row, ['home_ats_roi', 'ats_home_roi', 'ats_roi_home']), -200, 200);

    if (resolvedTotalScore !== null) {
      totalScoreSum += resolvedTotalScore;
      totalScoreCount += 1;
    }
    if (resolvedCorners !== null) {
      cornersTotal += resolvedCorners;
      cornerCount += 1;
    }
    if (resolvedCards !== null) {
      cardsTotal += resolvedCards;
      cardCount += 1;
    }
    if (pass !== null) {
      passTotal += pass;
      passCount += 1;
    }
    if (shot !== null) {
      shotTotal += shot;
      shotCount += 1;
    }
    if (overRoi !== null) {
      overRoiTotal += overRoi;
      overRoiCount += 1;
    }
    if (homeAtsRoi !== null) {
      atsRoiTotal += homeAtsRoi;
      atsRoiCount += 1;
    }
  }

  return {
    avgTotalScore: totalScoreCount > 0 ? totalScoreSum / totalScoreCount : null,
    avgCorners: cornerCount > 0 ? cornersTotal / cornerCount : null,
    avgCards: cardCount > 0 ? cardsTotal / cardCount : null,
    avgPassPct: passCount > 0 ? passTotal / passCount : null,
    avgShotAccuracy: shotCount > 0 ? shotTotal / shotCount : null,
    overRoi: overRoiCount > 0 ? overRoiTotal / overRoiCount : null,
    homeAtsRoi: atsRoiCount > 0 ? atsRoiTotal / atsRoiCount : null,
  };
}

async function fetchTeamLogos(rows: TrendRow[]): Promise<LogoLookup> {
  if (rows.length === 0) return {};

  const leagueSet = Array.from(new Set(rows.map((row) => normalizeLeagueKey(row.league)).filter(Boolean)));
  const lookup = new Map<string, string>();
  const cache: LogoLookup = {};
  const teamLogosAvailable = await isTableAvailable('team_logos');
  if (!teamLogosAvailable) return {};

  const ambiguousKeys = new Set<string>();
  let nonExactMatches = 0;
  let resolverLookups = 0;
  let resolverAvailable = true;

  if (leagueSet.length > 0) {
    for (const league of leagueSet) {
      if (!resolverAvailable) break;
      const leagueNames = Array.from(
        new Set(
          rows
            .filter((row) => normalizeLeagueKey(row.league) === league)
            .map((row) => normalizeText(row.team))
            .filter(Boolean),
        ),
      );

      const nameChunks = chunkValues(leagueNames, TEAM_LOOKUP_BATCH_SIZE);
      for (const chunk of nameChunks) {
        if (!resolverAvailable) break;
        if (chunk.length === 0) continue;

        resolverLookups += chunk.length;
        try {
          const resolved = await supabase.rpc('resolve_team_logos', {
            p_names: chunk,
            p_league_ids: [league],
          });

          if (resolved.error) {
            if (isRpcUnavailableError(resolved.error, 'resolve_team_logos')) {
              resolverAvailable = false;
            }
            continue;
          }

          if (Array.isArray(resolved.data)) {
            for (const result of resolved.data as Array<{
              input_name?: unknown;
              logo_url?: unknown;
              match_type?: unknown;
              is_ambiguous?: unknown;
            }>) {
              const inputName = normalizeText(result.input_name);
              if (!inputName) continue;

              const key = teamLeagueKey(inputName, league);
              const logo = normalizeText(result.logo_url);
              const matchType = normalizeText(result.match_type, 'unresolved').toLowerCase();
              const isAmbiguous = result.is_ambiguous === true;

              if (logo) {
                lookup.set(key, logo);
                cache[teamAnyKey(inputName)] = logo;
              }

              if (matchType !== 'exact') nonExactMatches += 1;
              if (isAmbiguous) ambiguousKeys.add(`${league}::${inputName}`);
            }
          }
        } catch (_err) {
          // Keep fallback path available.
        }
      }
    }
  }

  const hasMissingLogos = rows.some((row) => {
    const exact = lookup.get(teamLeagueKey(row.team, row.league));
    if (exact) return false;
    return !lookup.has(teamAnyKey(row.team)) && !cache[teamAnyKey(row.team)];
  });

  if (hasMissingLogos && leagueSet.length > 0) {
    const leagueChunks = chunkValues(leagueSet, TEAM_LOOKUP_BATCH_SIZE);
    for (const chunk of leagueChunks) {
      if (LOOKUP_TABLE_AVAILABILITY.team_logos === 'unavailable') break;
      try {
        const exact = await supabase
          .from('team_logos')
          .select('team_name,league_id,logo_url')
          .in('league_id', chunk);
        if (exact.error) {
          if (isTableUnavailableError(exact.error)) {
            LOOKUP_TABLE_AVAILABILITY.team_logos = 'unavailable';
          }
          continue;
        }
        if (Array.isArray(exact.data)) {
          for (const row of exact.data as TeamRow[]) {
            const key = teamLeagueKey(normalizeText(row.team_name), normalizeText(row.league_id));
            const logo = normalizeText(row.logo_url);
            if (!logo) continue;
            lookup.set(key, logo);
            const cachedTeamName = normalizeText(row.team_name);
            if (cachedTeamName) {
              cache[teamAnyKey(cachedTeamName)] = logo;
            }
          }
        }
      } catch (_err) {
        // Keep going with remaining queries if one request fails transiently.
      }
    }
  }

  const logos: LogoLookup = {};
  for (const row of rows) {
    const exact = lookup.get(teamLeagueKey(row.team, row.league));
    if (exact) {
      logos[teamLeagueKey(row.team, row.league)] = exact;
      continue;
    }
    const byTeam = lookup.get(teamAnyKey(row.team)) ?? cache[teamAnyKey(row.team)];
    if (byTeam) {
      logos[teamLeagueKey(row.team, row.league)] = byTeam;
    }
  }

  const unresolvedFinal = rows
    .map((row) => `${normalizeLeagueKey(row.league)}::${normalizeText(row.team)}`)
    .filter((key) => {
      const [league, team] = key.split('::');
      return !logos[teamLeagueKey(team, league)];
    });

  if (unresolvedFinal.length > 0 || ambiguousKeys.size > 0 || (resolverLookups > 0 && nonExactMatches / resolverLookups >= 0.25)) {
    console.warn('[Trends][resolve_team_logos]', {
      unresolved_count: unresolvedFinal.length,
      ambiguous_count: ambiguousKeys.size,
      non_exact_count: nonExactMatches,
      lookup_count: resolverLookups,
      unresolved_samples: unresolvedFinal.slice(0, 12),
      ambiguous_samples: Array.from(ambiguousKeys).slice(0, 12),
    });
  }

  return logos;
}

async function fetchNextGames(rows: TrendRow[]): Promise<NextMatchLookup> {
  const next: NextMatchLookup = {};
  if (rows.length === 0) return next;

  const leagueSet = Array.from(new Set(rows.map((row) => normalizeLeagueKey(row.league)).filter(Boolean)));
  if (leagueSet.length === 0) return next;
  if (!(await isTableAvailable('matches'))) {
    for (const row of rows) {
      next[teamLeagueKey(row.team, row.league)] = null;
    }
    return next;
  }

  const upcomingQueries = chunkValues(leagueSet, LEAGUE_LOOKUP_BATCH_SIZE).map((chunk) =>
    supabase
      .from('matches')
      .select('id,league_id,home_team,away_team,start_time,status')
      .in('league_id', chunk)
      .gte('start_time', new Date().toISOString())
      .in('status', ['scheduled', 'live', 'halftime'])
      .order('start_time', { ascending: true })
      .limit(5000)
  );

  const upcomingResponses = await Promise.all(upcomingQueries);

  const upcomingRows: MatchRow[] = [];
  for (const upcoming of upcomingResponses) {
    if (upcoming.error || !Array.isArray(upcoming.data) || upcoming.data.length === 0) continue;
    upcomingRows.push(...(upcoming.data as MatchRow[]));
  }

  if (upcomingRows.length === 0) {
    for (const row of rows) {
      next[teamLeagueKey(row.team, row.league)] = null;
    }
    return next;
  }

  const byLeague = new Map<string, MatchRow[]>();
  for (const match of upcomingRows) {
    const league = normalizeLeagueKey(match.league_id);
    const existing = byLeague.get(league) ?? [];
    existing.push(match);
    byLeague.set(league, existing);
  }

  for (const row of rows) {
    const key = teamLeagueKey(row.team, row.league);
    const leagueMatches = byLeague.get(normalizeLeagueKey(row.league));
    const match = leagueMatches ? pickNextMatch(leagueMatches, row.team) : null;
    if (!match || !normalizeText(match.start_time) || !normalizeText(match.home_team) || !normalizeText(match.away_team)) {
      next[key] = null;
      continue;
    }

    const isHome = teamsMatch(row.team, match.home_team);
    const opponent = isHome ? normalizeText(match.away_team) : normalizeText(match.home_team);
    const startsAt = normalizeText(match.start_time);
    const timeInfo = formatNextGameTime(startsAt);
    next[key] = {
      opponent,
      isHome,
      startsAt,
      startsLabel: timeInfo.label,
      isToday: timeInfo.isToday,
    };
  }

  return next;
}

function SummaryCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <article className="rounded-lg border border-slate-200 glass-material p-3 min-w-[180px]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </article>
  );
}

function SignalQualityBar({ hitRate, sample }: { hitRate: number; sample: number }) {
  const color =
    hitRate >= 80
      ? 'bg-emerald-500'
      : hitRate >= 65
        ? 'bg-amber-500'
        : 'bg-rose-500';
  const dots =
    sample >= 30 ? '●●●' : sample >= 15 ? '●●○' : sample >= 10 ? '●○○' : '○○○';

  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-[9px] text-slate-400">{dots}</span>
      <span className="h-2 w-20 overflow-hidden rounded-full bg-slate-100">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.min(100, hitRate)}%` }} />
      </span>
      <div className="flex min-w-[56px] items-center justify-end">
        <span
          className={`text-xs font-mono font-semibold ${
            color === 'bg-emerald-500'
              ? 'text-emerald-600'
              : color === 'bg-amber-500'
                ? 'text-amber-500'
                : 'text-rose-500'
          }`}
        >
          {hitRate.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function LastHeld({ value }: { value: boolean | null }) {
  if (value === true) return <span className="text-emerald-600 font-bold" aria-label="Held">✓</span>;
  if (value === false) return <span className="text-rose-600 font-bold" aria-label="Missed">×</span>;
  return <span className="text-slate-400">—</span>;
}

export default function TrendsPage() {
  const [rows, setRows] = useState<TrendRow[]>([]);
  const [logos, setLogos] = useState<LogoLookup>({});
  const [loadingRows, setLoadingRows] = useState(true);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [error, setError] = useState<TrendFetchError | null>(null);
  const [apiRowCount, setApiRowCount] = useState<number | null>(null);

  const [layerFilter, setLayerFilter] = useState<string>('All');
  const [sportFilter, setSportFilter] = useState<SportFilter>('All');
  const [signalFilter, setSignalFilter] = useState<'ALL' | Direction>('ALL');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
  const [sortBy, setSortBy] = useState<SortMode>('strength');
  const [search, setSearch] = useState('');
  const [minHit, setMinHit] = useState(80);
  const [minGames, setMinGames] = useState(10);
  const [nextGames, setNextGames] = useState<NextMatchLookup>({});

  const [matchFeedMetrics, setMatchFeedMetrics] = useState<MatchFeedMetric | null>(null);
  const [matchFeedError, setMatchFeedError] = useState(false);

  const requestSeq = useRef(0);
  const logoCacheRef = useRef<LogoLookup>({});
  const nextGamesRequestSeq = useRef(0);

  const layerOptions = useMemo(() => {
    const uniq = new Set<string>();
    for (const row of rows) uniq.add(row.layer);
    return ['All', ...Array.from(uniq).sort((a, b) => a.localeCompare(b))];
  }, [rows]);

  useEffect(() => {
    let isActive = true;
    const seq = ++requestSeq.current;
    const loadRows = async () => {
      setLoadingRows(true);
      setError(null);
      try {
        const loadedRows = await fetchTrends(minHit, minGames, layerFilter);
        if (!isActive || requestSeq.current !== seq) return;
        const stableRows = dedupe(loadedRows).sort((a, b) => b.hit_rate - a.hit_rate || b.sample - a.sample);
        setRows(stableRows);
        setApiRowCount(loadedRows.length);
        setError(null);
      } catch (err) {
        if (!isActive || requestSeq.current !== seq) return;
        setError(toTrendFetchError(err));
        setApiRowCount(0);
      } finally {
        if (isActive && requestSeq.current === seq) setLoadingRows(false);
      }
    };
    void loadRows();
    return () => {
      isActive = false;
    };
  }, [minHit, minGames, layerFilter]);

  useEffect(() => {
    let active = true;
    const seq = ++requestSeq.current;
    const loadLogos = async () => {
      const logoRows = rows;
      const cache = logoCacheRef.current;
      const needed = logoRows.filter((row) => !cache[teamLeagueKey(row.team, row.league)]);
      if (needed.length === 0) {
        const stable: LogoLookup = {};
        for (const row of logoRows) {
          const key = teamLeagueKey(row.team, row.league);
          stable[key] = cache[key];
        }
        setLogos(stable);
        return;
      }

      const fetched = await fetchTeamLogos(needed);
      if (!active || requestSeq.current !== seq) return;
      logoCacheRef.current = { ...cache, ...fetched };
      setLogos((prev) => {
        const next = { ...prev, ...fetched };
        for (const row of logoRows) {
          const exact = logoCacheRef.current[teamLeagueKey(row.team, row.league)] ?? next[teamLeagueKey(row.team, row.league)];
          if (exact) next[teamLeagueKey(row.team, row.league)] = exact;
        }
        return next;
      });
    };
    void loadLogos();
    return () => {
      active = false;
    };
  }, [rows]);

  useEffect(() => {
    let active = true;
    const seq = ++nextGamesRequestSeq.current;
    const loadNextGames = async () => {
      try {
        const next = await fetchNextGames(rows);
        if (!active || seq !== nextGamesRequestSeq.current) return;
        setNextGames(next);
      } catch (_error) {
        if (!active || seq !== nextGamesRequestSeq.current) return;
        // Keep previously resolved next-game lookups on transient failures.
      }
    };
    void loadNextGames();
    return () => {
      active = false;
    };
  }, [rows]);

  useEffect(() => {
    let active = true;
    const loadSummary = async () => {
      setLoadingMeta(true);
      try {
        const summary = await fetchMatchFeedSummary();
        if (!active) return;
        if (summary) {
          setMatchFeedMetrics(summary);
          setMatchFeedError(false);
        } else {
          setMatchFeedMetrics(null);
          setMatchFeedError(true);
        }
      } catch (_err) {
        if (!active) return;
        setMatchFeedMetrics(null);
        setMatchFeedError(true);
      } finally {
        if (active) setLoadingMeta(false);
      }
    };
    void loadSummary();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const direction = directionFilter !== 'ALL' ? directionFilter : signalFilter;
    const hasDirectionFilter = directionFilter !== 'ALL' || signalFilter !== 'ALL';

    const base = rows.filter((row) => {
      if (hasDirectionFilter && row.signal_type !== direction) return false;
      if (sportFilter !== 'All') {
        const mapped = sportFromLeague(row.league);
        if (!mapped || mapped !== sportFilter) return false;
      }
      if (row.sample < minGames) return false;
      if (row.hit_rate < minHit) return false;
      if (
        query &&
        `${row.team} ${row.trend} ${leagueDisplayLabel(row.league)} ${layerLabel(row.layer)}`
          .toLowerCase()
          .indexOf(query) === -1
      )
        return false;
      if (layerFilter !== 'All' && row.layer !== layerFilter) return false;
      return true;
    });

    const sorted = [...base];
    if (sortBy === 'hit') {
      sorted.sort((a, b) => b.hit_rate - a.hit_rate || b.sample - a.sample);
    } else if (sortBy === 'sample') {
      sorted.sort((a, b) => b.sample - a.sample || b.hit_rate - a.hit_rate);
    } else if (sortBy === 'alpha') {
      sorted.sort((a, b) => a.team.localeCompare(b.team) || a.trend.localeCompare(b.trend));
    } else {
      sorted.sort((a, b) => strengthScore(b) - strengthScore(a) || b.hit_rate - a.hit_rate);
    }
    return sorted;
  }, [rows, directionFilter, signalFilter, sportFilter, search, minGames, minHit, layerFilter, sortBy]);

  const layerSummary = useMemo(() => {
    const map = new Map<string, { totalHit: number; count: number; above80: number; sample10: number; perfect: number }>();

    for (const row of filtered) {
      const bucket = map.get(row.layer) ?? { totalHit: 0, count: 0, above80: 0, sample10: 0, perfect: 0 };
      bucket.count += 1;
      bucket.totalHit += row.hit_rate;
      if (row.hit_rate >= 80) bucket.above80 += 1;
      if (row.sample >= 10) bucket.sample10 += 1;
      if (row.hit_rate >= 99.999) bucket.perfect += 1;
      map.set(row.layer, bucket);
    }

    return Array.from(map.entries())
      .map(([layer, m]) => ({
        layer,
        count: m.count,
        avgHitRate: m.count > 0 ? m.totalHit / m.count : 0,
        above80: m.above80,
        sampleAtLeast10: m.sample10,
        perfect: m.perfect,
      }))
      .sort((a, b) => b.avgHitRate - a.avgHitRate);
  }, [filtered]);

  const kpiRows = useMemo(
    () => [
      {
        title: 'AVG TOTAL SCORE',
        value: matchFeedMetrics?.avgTotalScore == null ? 'N/A' : `${matchFeedMetrics.avgTotalScore.toFixed(1)}`,
      },
      {
        title: 'AVG CORNERS',
        value: matchFeedMetrics?.avgCorners == null ? 'N/A' : `${matchFeedMetrics.avgCorners.toFixed(1)}`,
      },
      {
        title: 'AVG CARDS',
        value: matchFeedMetrics?.avgCards == null ? 'N/A' : `${matchFeedMetrics.avgCards.toFixed(1)}`,
      },
      {
        title: 'AVG PASS %',
        value: matchFeedMetrics?.avgPassPct == null ? 'N/A' : `${matchFeedMetrics.avgPassPct.toFixed(1)}%`,
      },
      {
        title: 'AVG SHOT ACCURACY',
        value: matchFeedMetrics?.avgShotAccuracy == null ? 'N/A' : `${matchFeedMetrics.avgShotAccuracy.toFixed(1)}%`,
      },
      {
        title: 'OVER ROI',
        value: matchFeedMetrics?.overRoi == null ? 'N/A' : `${matchFeedMetrics.overRoi.toFixed(1)}%`,
      },
      {
        title: 'HOME ATS ROI',
        value: matchFeedMetrics?.homeAtsRoi == null ? 'N/A' : `${matchFeedMetrics.homeAtsRoi.toFixed(1)}%`,
      },
    ],
    [matchFeedMetrics],
  );

  return (
    <>
      <SEOHead
        title="Trends Board | The Drip"
        description="Live trend board with direction, hit rate, sample size, and next-game context across major leagues."
        canonicalPath="/trends"
      />
      <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="inline-flex items-center rounded-md border border-slate-300/80 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50"
            >
              Home
            </Link>
            <Link
              to="/trends"
              className="inline-flex items-center rounded-md border border-slate-300/80 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50"
            >
              Trends
            </Link>
          </div>
          <span className="text-xs text-slate-500">Trend Intelligence Board</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-10 pt-5 sm:px-6">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Trends</h1>
          <p className="text-sm text-slate-600">Live trend intelligence for all tracked leagues and layers.</p>
        </section>

        <section className="rounded-xl border border-slate-200 glass-material p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Board statistics</h2>
            {loadingMeta ? (
              <span className="text-xs text-slate-500">loading match stats…</span>
            ) : matchFeedError ? (
              <span className="text-xs text-amber-600">match_feed unavailable</span>
            ) : (
              <span className="text-xs text-slate-500">from finished match_feed</span>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 min-w-full">
              {kpiRows.map((card) => (
                <SummaryCard key={card.title} title={card.title} value={card.value} />
              ))}
            </div>
          </div>
        </section>

        {error && (
          <section className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <p className="font-semibold">Unable to load trend data.</p>
            <p>{error.message}</p>
            {error.status ? <p className="mt-1 text-xs text-rose-600">Status: {error.status}{error.code ? ` • Code: ${error.code}` : ''}</p> : null}
            {error.details ? <p className="mt-1 text-xs text-rose-600">{error.details}</p> : null}
            {(error.status === 401 || error.status === 403) ? (
              <p className="mt-1 text-xs">
                Verify production and local env vars: <strong>VITE_SUPABASE_URL</strong> and <strong>VITE_SUPABASE_ANON_KEY</strong> point at
                the same project.
              </p>
            ) : null}
          </section>
        )}

        <section className="rounded-xl border border-slate-200 glass-material p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Layer</span>
              <select
                value={layerFilter}
                onChange={(event) => setLayerFilter(event.target.value)}
                className="h-9 w-[240px] rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700"
              >
                {layerOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Sport</span>
              <select
                value={sportFilter}
                onChange={(event) => setSportFilter(event.target.value as SportFilter)}
                className="h-9 w-40 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700"
              >
                {SPORT_FILTERS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Signal</span>
              <select
                value={signalFilter}
                onChange={(event) => setSignalFilter(event.target.value as 'ALL' | Direction)}
                className="h-9 w-40 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700"
              >
                <option value="ALL">All</option>
                <option value="TREND">Trend</option>
                <option value="FADE">Fade</option>
                <option value="NEUTRAL">Neutral</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Sort</span>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SortMode)}
                className="h-9 w-36 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700"
              >
                <option value="strength">Strength</option>
                <option value="hit">Hit %</option>
                <option value="sample">Game</option>
                <option value="alpha">Alphabetical</option>
              </select>
            </label>

            <label className="flex flex-1 min-w-[220px] flex-col gap-1 text-xs">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Signal search</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Team or trend"
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Min hit %: <span className="tabular-nums text-slate-900">{minHit}%</span>
              </span>
              <input
                type="range"
                min={50}
                max={100}
                step={1}
                value={minHit}
                onChange={(event) => setMinHit(Number(event.target.value))}
                className="h-7 w-full"
              />
            </label>

            <label className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Min Game: <span className="tabular-nums text-slate-900">{minGames}</span>
              </span>
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={minGames}
                onChange={(event) => setMinGames(Number(event.target.value))}
                className="h-7 w-full"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(['ALL', 'TREND', 'FADE', 'NEUTRAL'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setDirectionFilter(tab)}
                className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                  directionFilter === tab
                    ? tab === 'FADE'
                      ? 'border-rose-300 bg-rose-50 text-rose-600'
                      : tab === 'NEUTRAL'
                        ? 'border-slate-300 bg-slate-100 text-slate-600'
                        : 'border-emerald-300 bg-emerald-50 text-emerald-600'
                    : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 glass-material p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Layer quality</h2>
            <span className="text-xs text-slate-500">{filtered.length} rows</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {layerSummary.map((summary) => {
              const selected = layerFilter === summary.layer;
              return (
                <button
                  key={summary.layer}
                  onClick={() => setLayerFilter(selected ? 'All' : summary.layer)}
                className={`rounded-lg border px-3 py-2 text-left ${
                    selected ? 'border-emerald-300 bg-emerald-50/75 glass-material' : 'border-slate-200/60 bg-white/60'
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {layerLabel(summary.layer)}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                    {summary.avgHitRate.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Rows: {summary.count} · 80%+: {summary.above80} · 10+ Games: {summary.sampleAtLeast10} · Perfect: {summary.perfect}
                  </p>
                </button>
              );
            })}
            {layerSummary.length === 0 && !loadingRows && (
              <div className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">
                No layer stats available for current filters.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 glass-material">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Trend board</h2>
            <span className="text-xs text-slate-500">
              Showing {filtered.length}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1200px] w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="w-12 px-4 py-2.5 text-right">#</th>
                  <th className="px-4 py-2.5">Team</th>
                  <th className="px-4 py-2.5">League</th>
                  <th className="px-4 py-2.5">Signal</th>
                  <th className="px-4 py-2.5">Layer</th>
                  <th className="px-4 py-2.5">Signal Quality</th>
                  <th className="px-4 py-2.5 text-right">Game</th>
                  <th className="px-4 py-2.5">Next Game</th>
                  <th className="px-4 py-2.5">Direction</th>
                  <th className="px-4 py-2.5 text-center">Last held</th>
                </tr>
              </thead>
              <tbody>
                {loadingRows ? (
                  <tr>
                    <td colSpan={10}>
                      <div className="px-4 py-8 space-y-2">
                        <div className="h-6 w-1/3 rounded bg-slate-200 animate-pulse" />
                        <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
                      </div>
                    </td>
                  </tr>
                ) : filtered.length > 0 ? (
                  filtered.map((row, idx) => {
                    const quality = signalClass(row.signal_type);
                    const key = teamLeagueKey(row.team, row.league);
                    const logo = logos[key];
                    const leagueLabel = LEAGUE_BADGES[row.league] ?? row.league;
                    const strength = strengthScore(row);
                    return (
                      <tr
                        key={`${row.team}-${row.league}-${row.trend}-${idx}`}
                        className="border-t border-slate-200/80 hover:bg-white/80"
                      >
                        <td className="px-4 py-3 text-right text-xs font-mono text-slate-500">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <TeamLogo
                              logo={logo ?? resolveEspnTeamLogo(row.team)}
                              name={row.team}
                              className="h-5 w-5"
                            />
                            <span className="font-medium text-slate-800">
                              {row.team}
                              {row.record ? <span className="ml-1.5 text-xs text-slate-400">({row.record})</span> : null}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                          <div className="flex items-center gap-2">
                            {leagueDisplayIconUrl(row.league) ? (
                              <img
                                src={leagueDisplayIconUrl(row.league) as string}
                                alt=""
                                className="h-4 w-4 rounded-full object-contain opacity-90"
                                loading="lazy"
                              />
                            ) : (
                              <span aria-hidden="true" className="text-[12px]">
                                {leagueDisplayIconFallback(row.league)}
                              </span>
                            )}
                            {leagueDisplayLabel(row.league)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{row.trend}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                            {layerLabel(row.layer)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <SignalQualityBar hitRate={row.hit_rate} sample={row.sample} />
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">{row.sample}</td>
                        <td className="px-4 py-3">
                          {(() => {
                            const next = nextGames[key];
                            if (!next) return <span className="text-slate-400 text-xs">No upcoming game</span>;
                            return (
                              <div className="flex items-center gap-2">
                                <TeamLogo
                                  logo={next.isHome ? resolveEspnTeamLogo(next.opponent) : resolveEspnTeamLogo(next.opponent)}
                                  name={next.opponent}
                                  className="h-4 w-4"
                                />
                                <div className="text-xs">
                                  <div className="font-medium text-slate-700">
                                    {next.isHome ? 'vs' : '@'} {next.opponent}
                                  </div>
                                  <div className="text-[10px] text-slate-500">{next.startsLabel}</div>
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${quality.color} ${quality.bg}`}>
                            <span>{quality.icon}</span>
                            <span>{quality.label}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <LastHeld value={row.last_held} />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">
                      {apiRowCount === 0
                        ? 'No trend rows returned from configured sources (RPC/table/gateway). Check environment project wiring and data sync.'
                        : 'No trends for current filters. Try lowering min hit %, lowering min games, or clearing search/signal filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex items-center justify-between text-xs text-slate-400">
          <p>Board strength metric: hit rate × √sample</p>
          <p>{loadingRows ? 'Updating…' : `${filtered.length} total`}</p>
        </section>
      </main>
      </div>
    </>
  );
}
