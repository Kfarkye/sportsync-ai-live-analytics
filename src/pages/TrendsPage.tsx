import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getLeagueDisplayName } from '../utils/leagueDisplay';

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
  short_name?: unknown;
  abbreviation?: unknown;
  league_id?: unknown;
  logo_url?: unknown;
};

type LayerSummary = {
  layer: string;
  avgHitRate: number;
  count: number;
  above80: number;
  sampleAtLeast10: number;
  perfect: number;
};

type MatchFeedMetric = {
  avgGoals: number | null;
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
  'fifa.worldq.afc': 'FIFA World Cup Qualifiers — AFC',
  'fifa.worldq.conmebol': 'FIFA World Cup Qualifiers — CONMEBOL',
  'fifa.worldq.caf': 'FIFA World Cup Qualifiers — CAF',
  'fifa.worldq.uefa': 'FIFA World Cup Qualifiers — UEFA',
  'fifa.worldq.concacaf': 'FIFA World Cup Qualifiers — CONCACAF',
  'uefa.champions': 'UEFA Champions League',
  'uefa.europa': 'UEFA Europa League',
};

const LEAGUE_BADGE_ICONS: Record<string, string> = {
  nba: '🏀',
  nhl: '🏒',
  mlb: '⚾',
  mls: '⚽',
  'usa.1': '⚽',
  eng: '⚽',
  'eng.1': '⚽',
  epl: '⚽',
  esp: '⚽',
  'esp.1': '⚽',
  ita: '⚽',
  'ita.1': '⚽',
  ger: '⚽',
  'ger.1': '⚽',
  fra: '⚽',
  'fra.1': '⚽',
  l1: '⚽',
  liga: '⚽',
  laliga: '⚽',
  seriea: '⚽',
  ligue1: '⚽',
  mls: '⚽',
  uefa: '🏆',
  'uefa.champions': '🏆',
  'uefa.europa': '🏆',
  ncaab: '🏀',
  'mens-college-basketball': '🏀',
  'fifa.worldq.afc': '🌍',
  'fifa.worldq.conmebol': '🌎',
  'fifa.worldq.caf': '🌍',
  'fifa.worldq.uefa': '🇪🇺',
  'fifa.worldq.concacaf': '🌎',
};

function normalizeLeagueLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9.]/g, '');
}

function leagueDisplayLabel(value: string): string {
  return LEAGUE_BADGES[value] || LEAGUE_BADGES[normalizeLeagueLookupKey(value)] || getLeagueDisplayName(value);
}

function leagueDisplayIcon(value: string): string | null {
  const key = value.trim().toLowerCase();
  const compactKey = normalizeLeagueLookupKey(value);
  const normalizedWithDots = key.replace(/[^a-z0-9.]/g, '');
  const compactParts = compactKey.split('.');

  if (LEAGUE_BADGE_ICONS[key]) return LEAGUE_BADGE_ICONS[key];
  if (LEAGUE_BADGE_ICONS[compactKey]) return LEAGUE_BADGE_ICONS[compactKey];
  if (compactParts[0] && LEAGUE_BADGE_ICONS[compactParts[0]]) return LEAGUE_BADGE_ICONS[compactParts[0]];
  if (compactKey.startsWith('fifa.worldq')) return LEAGUE_BADGE_ICONS['fifa.worldq.afc'];
  if (normalizedWithDots.includes('uefa.')) return LEAGUE_BADGE_ICONS['uefa.champions'];

  if (key.includes('basketball') || key.includes('nba') || key.includes('ncaab')) return '🏀';
  if (key.includes('hockey') || key.includes('nhl')) return '🏒';
  if (key.includes('baseball') || key.includes('mlb')) return '⚾';

  return '🏆';
}

const LAYER_LABELS: Record<string, string> = {
  TEAM_ATS_LINE: 'ATS Line',
  TEAM_OU_LINE: 'O/U Line',
  SOCCER_1H_BTTS: '1H BTTS',
  SOCCER_HALF_GOALS: 'Half Goals',
  SOCCER_LATE_GOALS: 'Late Goals',
  SOCCER_CORNERS: 'Corners',
  SOCCER_CARDS: 'Cards',
  SOCCER_1H_TOTAL: '1H Total',
  SOCCER_CORNERS: 'Corners',
  SOCCER_TEAM_TOTAL: 'Team Total',
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
  if (v === 'UP' || v === 'POSITIVE') return 'TREND';
  if (v === 'DOWN' || v === 'NEGATIVE') return 'FADE';
  return 'NEUTRAL';
}

function inferDirectionFromTrend(trend: string): Direction {
  const lowered = trend.toLowerCase();

  if (/\bfade\b/.test(lowered)) return 'FADE';
  if (/\b(win|covered)\b/.test(lowered)) return 'TREND';
  if (/\b(ou|over|under|points)\b/.test(lowered)) return 'TREND';

  return 'NEUTRAL';
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
    SOCCER_LEAGUES.some((needle) =>
      normalizedWithDots === needle || normalizedWithDots.startsWith(`${needle}.`) || normalizedWithDots.includes(needle),
    ) ||
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
  return LAYER_LABELS[layer] ?? layer.replace(/_/g, ' ');
}

async function fetchTrends(minHit: number, minGames: number, layerFilter: string): Promise<TrendRow[]> {
  const params: Record<string, unknown> = {
    p_min_rate: minHit,
    p_limit: 5000,
  };
  if (layerFilter !== 'All') params.p_layer = layerFilter;

  const rpc = await supabase.rpc('get_trends', params);
  if (rpc.error) throw toTrendFetchError(rpc.error);

  const rows = Array.isArray(rpc.data) ? (rpc.data as RawTrendRow[]) : [];
  const parsed: TrendRow[] = [];

  for (const row of rows) {
    const layer = sanitizeLayer(
      normalizeText(row.layer, normalizeText(row.section ? sectionToLayer(row.section as string) : undefined)),
    );
    const team = normalizeText(row.team);
    const league = normalizeText(row.league);
    const trend = normalizeText(row.trend);
    const sample = normalizeInteger(row.sample, 0);
    const hitRate = normalizeNumber(row.hit_rate, 0);

    if (!team || !trend || sample < minGames) continue;
    const explicitSignal = normalizeDirection(row.signal_type);
    const inferredSignal = inferDirectionFromTrend(trend);
    const resolvedSignal = inferredSignal === 'NEUTRAL' ? explicitSignal : inferredSignal;

    parsed.push({
      layer,
      team,
      league,
      trend,
      record: normalizeText(row.record),
      hit_rate: hitRate,
      sample,
      last_held: normalizeBoolean(row.last_held),
      signal_type: resolvedSignal,
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

function normalizePercent(value: number | null): number | null {
  if (!Number.isFinite(value ?? Number.NaN) || value == null) return null;
  if (value < 0) return null;
  if (value > 100) return null;
  return value <= 1 ? value * 100 : value;
}

function normalizeIntegerMetric(value: number | null, max: number): number | null {
  if (!Number.isFinite(value ?? Number.NaN) || value == null) return null;
  if (value < 0 || value > max) return null;
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > 0.0001) return null;
  return rounded;
}

async function fetchMatchFeedSummary(): Promise<MatchFeedMetric | null> {
  const result = await supabase
    .from('match_feed')
    .select('*')
    .eq('status', 'finished')
    .limit(5000);

  if (result.error || !Array.isArray(result.data) || result.data.length === 0) {
    return null;
  }

  let goalsTotal = 0;
  let cornersTotal = 0;
  let cardsTotal = 0;
  let passTotal = 0;
  let shotTotal = 0;
  let overRoiTotal = 0;
  let atsRoiTotal = 0;

  let goalCount = 0;
  let cornerCount = 0;
  let cardCount = 0;
  let passCount = 0;
  let shotCount = 0;
  let overRoiCount = 0;
  let atsRoiCount = 0;

  for (const rawRow of result.data as unknown[]) {
    const row = rawRow as Record<string, unknown>;
    const leagueValue = normalizeText((row as Record<string, unknown>).league_id || (row as Record<string, unknown>).league || (row as Record<string, unknown>).sport);
    const isSoccer = sportFromLeague(leagueValue) === 'Soccer';

    const goalsAggregate = extractNumeric(row, ['goals', 'total_goals', 'goal_total']);
    const homeGoals = extractNumeric(row, ['home_goals', 'goals_for_home', 'home_score']);
    const awayGoals = extractNumeric(row, ['away_goals', 'goals_for_away', 'away_score']);
    const resolvedGoals =
      isSoccer && Number.isFinite(goalsAggregate ?? Number.NaN)
        ? goalsAggregate
        : isSoccer && Number.isFinite(homeGoals ?? Number.NaN) && Number.isFinite(awayGoals ?? Number.NaN)
          ? (homeGoals ?? 0) + (awayGoals ?? 0)
          : null;

    const cornersAggregate = extractNumeric(row, ['corners', 'total_corners', 'corner_count']);
    const cornerHome = extractNumeric(row, ['home_corners', 'corners_for_home']);
    const cornerAway = extractNumeric(row, ['away_corners', 'corners_for_away']);
    const resolvedCorners = isSoccer
      ? Number.isFinite(cornersAggregate ?? Number.NaN)
        ? cornersAggregate
        : Number.isFinite(cornerHome ?? Number.NaN) && Number.isFinite(cornerAway ?? Number.NaN)
          ? (cornerHome ?? 0) + (cornerAway ?? 0)
          : null
      : null;

    const cardsAggregate = extractNumeric(row, ['cards', 'total_cards', 'card_count']);
    const cardHome = extractNumeric(row, ['home_cards', 'cards_for_home', 'home_team_cards', 'home_yellow_cards', 'home_red_cards', 'home_card_total']);
    const cardAway = extractNumeric(row, ['away_cards', 'cards_for_away', 'away_team_cards', 'away_yellow_cards', 'away_red_cards', 'away_card_total']);
    const resolvedCards = isSoccer
      ? Number.isFinite(cardsAggregate ?? Number.NaN)
        ? cardsAggregate
        : Number.isFinite(cardHome ?? Number.NaN) && Number.isFinite(cardAway ?? Number.NaN)
          ? (cardHome ?? 0) + (cardAway ?? 0)
          : null
      : null;

    const passAggregate = extractNumeric(row, ['pass_pct', 'passes_pct', 'pass_percent', 'team_pass_pct', 'passing_pct']);
    const homePass = extractNumeric(row, ['home_pass_pct', 'team_home_pass_pct', 'home_pass_percentage', 'home_pass_accuracy']);
    const awayPass = extractNumeric(row, ['away_pass_pct', 'team_away_pass_pct', 'away_pass_percentage', 'away_pass_accuracy']);
    const pass = isSoccer
      ? Number.isFinite(passAggregate ?? Number.NaN)
        ? passAggregate
        : Number.isFinite(homePass ?? Number.NaN) && Number.isFinite(awayPass ?? Number.NaN)
          ? (homePass! + awayPass!) / 2
          : null
      : null;

    const shotAggregate = extractNumeric(row, ['shot_accuracy', 'shot_pct', 'shooting_accuracy', 'shots_accuracy']);
    const homeShot = extractNumeric(row, ['home_shot_accuracy', 'team_home_shot_accuracy', 'home_shooting_accuracy', 'home_shot_accuracy']);
    const awayShot = extractNumeric(row, ['away_shot_accuracy', 'team_away_shot_accuracy', 'away_shooting_accuracy', 'away_shot_accuracy']);
    const shot = isSoccer
      ? Number.isFinite(shotAggregate ?? Number.NaN)
        ? shotAggregate
        : Number.isFinite(homeShot ?? Number.NaN) && Number.isFinite(awayShot ?? Number.NaN)
          ? (homeShot! + awayShot!) / 2
          : null
      : null;
    const overRoi = extractNumeric(row, ['over_roi', 'roi_over', 'odds_over_roi']);
    const homeAtsRoi = extractNumeric(row, ['home_ats_roi', 'ats_home_roi', 'ats_roi_home']);

    const cleanGoals = normalizeIntegerMetric(resolvedGoals, 50);
    const cleanCorners = normalizeIntegerMetric(resolvedCorners, 40);
    const cleanCards = normalizeIntegerMetric(resolvedCards, 20);
    const cleanPass = pass !== null ? normalizePercent(pass) : null;
    const cleanShot = shot !== null ? normalizePercent(shot) : null;

    if (cleanGoals !== null) {
      goalsTotal += cleanGoals;
      goalCount += 1;
    }
    if (cleanCorners !== null) {
      cornersTotal += cleanCorners;
      cornerCount += 1;
    }
    if (cleanCards !== null) {
      cardsTotal += cleanCards;
      cardCount += 1;
    }
    if (cleanPass !== null) {
      passTotal += cleanPass;
      passCount += 1;
    }
    if (cleanShot !== null) {
      shotTotal += cleanShot;
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
    avgGoals: goalCount > 0 ? goalsTotal / goalCount : null,
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

  const teamSet = Array.from(new Set(rows.map((row) => row.team)));
  const leagueSet = Array.from(new Set(rows.map((row) => row.league).filter(Boolean)));
  const lookup = new Map<string, string>();
  const cache: LogoLookup = {};

  try {
    const exact = await supabase
      .from('team_logos')
      .select('team_name,league_id,logo_url')
      .in('team_name', teamSet);

    if (!exact.error && Array.isArray(exact.data)) {
      for (const row of exact.data as TeamRow[]) {
        const key = teamLeagueKey(normalizeText(row.team_name), normalizeText(row.league_id));
        const logo = normalizeText(row.logo_url);
        if (!logo) continue;
        lookup.set(key, logo);
        if (normalizeText(row.team_name)) cache[normalizeText(row.team_name)] = logo;
      }
    }
  } catch (_err) {
    // Fallback only if team logo table is not matching
  }

  if (lookup.size === 0 && teamSet.length > 0) {
    try {
      const fallback = await supabase
        .from('teams')
        .select('name,short_name,abbreviation,logo_url,league_id')
        .in('name', teamSet)
        .limit(5000);
      if (!fallback.error && Array.isArray(fallback.data)) {
        for (const row of fallback.data as TeamFallbackRow[]) {
          const logo = normalizeText(row.logo_url);
          if (!logo) continue;
          const league = normalizeText(row.league_id, 'unknown');
          const name = normalizeText(row.name);
          const shortName = normalizeText(row.short_name);
          const abbr = normalizeText(row.abbreviation);
          if (name) {
            lookup.set(teamLeagueKey(name, league), logo);
            cache[name] = logo;
          }
          if (shortName) {
            lookup.set(teamLeagueKey(shortName, league), logo);
            cache[shortName] = logo;
          }
          if (abbr) {
            lookup.set(teamLeagueKey(abbr, league), logo);
            cache[abbr] = logo;
          }
        }
      }
    } catch (_err) {
      // fallback intentionally permissive
    }
  }

  if (lookup.size === 0 && leagueSet.length > 0) {
    try {
      const fallbackByLeague = await supabase
        .from('teams')
        .select('name,short_name,abbreviation,logo_url,league_id')
        .in('league_id', leagueSet)
        .limit(5000);
      if (!fallbackByLeague.error && Array.isArray(fallbackByLeague.data)) {
        for (const row of fallbackByLeague.data as TeamFallbackRow[]) {
          const logo = normalizeText(row.logo_url);
          if (!logo) continue;
          const league = normalizeText(row.league_id, 'unknown');
          const name = normalizeText(row.name);
          const shortName = normalizeText(row.short_name);
          const abbr = normalizeText(row.abbreviation);
          if (name) lookup.set(teamLeagueKey(name, league), logo);
          if (shortName) lookup.set(teamLeagueKey(shortName, league), logo);
          if (abbr) lookup.set(teamLeagueKey(abbr, league), logo);
        }
      }
    } catch (_err) {
      // keep partial cache
    }
  }

  const logos: LogoLookup = {};
  for (const row of rows) {
    const exact = lookup.get(teamLeagueKey(row.team, row.league));
    if (exact) {
      logos[teamLeagueKey(row.team, row.league)] = exact;
      continue;
    }
    const byTeam = lookup.get(teamAnyKey(row.team)) ?? cache[row.team];
    if (byTeam) {
      logos[teamLeagueKey(row.team, row.league)] = byTeam;
    }
  }
  return logos;
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
    <article className="rounded-lg border border-slate-200 bg-white p-3 min-w-[180px]">
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
      <span className={`w-11 text-xs font-mono font-semibold ${color === 'bg-emerald-500' ? 'text-emerald-600' : color === 'bg-amber-500' ? 'text-amber-500' : 'text-rose-500'}`}>{hitRate.toFixed(1)}%</span>
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

  const [matchFeedMetrics, setMatchFeedMetrics] = useState<MatchFeedMetric | null>(null);
  const [matchFeedError, setMatchFeedError] = useState(false);

  const requestSeq = useRef(0);
  const logoCacheRef = useRef<LogoLookup>({});

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
        setRows([]);
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

    const base = rows.filter((row) => {
      if (direction !== 'ALL' && row.signal_type !== direction) return false;
      if (signalFilter !== 'ALL' && directionFilter === 'ALL' && row.signal_type !== signalFilter) return false;
      if (sportFilter !== 'All') {
        const mapped = sportFromLeague(row.league);
        if (!mapped || mapped !== sportFilter) return false;
      }
      if (row.sample < minGames) return false;
      if (row.hit_rate < minHit) return false;
      if (query && `${row.team} ${row.trend}`.toLowerCase().indexOf(query) === -1) return false;
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
        title: 'AVG GOALS',
        value: matchFeedMetrics?.avgGoals == null ? 'N/A' : `${matchFeedMetrics.avgGoals.toFixed(1)}`,
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50"
            >
              Home
            </Link>
            <Link
              to="/trends"
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-50"
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

        <section className="rounded-xl border border-slate-200 bg-white p-3">
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

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
                Min games: <span className="tabular-nums text-slate-900">{minGames}</span>
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

        <section className="rounded-xl border border-slate-200 bg-white p-3">
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
                    selected ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {layerLabel(summary.layer)}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                    {summary.avgHitRate.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    n={summary.count} · ≥80%: {summary.above80} · n≥10: {summary.sampleAtLeast10} · perfect: {summary.perfect}
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

        <section className="rounded-xl border border-slate-200 bg-white">
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
                  <th className="px-4 py-2.5">Team / Entity</th>
                  <th className="px-4 py-2.5">League</th>
                  <th className="px-4 py-2.5">Signal</th>
                  <th className="px-4 py-2.5">Layer</th>
                  <th className="px-4 py-2.5">Signal Quality</th>
                  <th className="px-4 py-2.5 text-right">Game</th>
                  <th className="px-4 py-2.5">Direction</th>
                  <th className="px-4 py-2.5 text-center">Last held</th>
                </tr>
              </thead>
              <tbody>
                {loadingRows ? (
                    <tr>
                    <td colSpan={9}>
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
                    const leagueLabel = leagueDisplayLabel(row.league);
                    const leagueIcon = leagueDisplayIcon(row.league);
                    const strength = strengthScore(row);
                    return (
                      <tr key={`${row.team}-${row.league}-${row.trend}-${idx}`} className="border-t border-slate-200 hover:bg-slate-50">
                        <td className="px-4 py-3 text-right text-xs font-mono text-slate-500">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {logo ? (
                              <img
                                src={logo}
                                alt={row.team}
                                width={18}
                                height={18}
                                loading="eager"
                                decoding="async"
                                className="h-5 w-5 rounded-full border border-slate-200 object-contain bg-white"
                              />
                            ) : (
                              <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-slate-200 text-[10px] text-slate-500">
                                {row.team.slice(0, 2).toUpperCase()}
                              </span>
                            )}
                            <span className="font-medium text-slate-800">
                              {row.team}
                              {row.record ? <span className="ml-1.5 text-xs text-slate-400">({row.record})</span> : null}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                            {leagueIcon ? <span aria-hidden="true">{leagueIcon}</span> : null}
                            <span className="font-normal">{leagueLabel}</span>
                          </span>
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
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                      {apiRowCount === 0
                        ? 'No trend rows returned from get_trends. Check API key/project configuration for this deployment.'
                        : 'No trends for current filters. Try lowering min hit %, lowering min games, or clearing search/signal filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex items-center justify-between text-xs text-slate-400">
          <p>Board strength metric: hit rate × √game</p>
          <p>{loadingRows ? 'Updating…' : `${filtered.length} total`}</p>
        </section>
      </main>
    </div>
  );
}
