import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'qffzvrnbzabcokqqrwbv';
const SPORT = process.env.CONTEXT_STUDY_SPORT || 'nba';
const START = process.env.CONTEXT_STUDY_START || '2025-10-02T00:00:00Z';
const END = process.env.CONTEXT_STUDY_END || new Date().toISOString();
const OUTPUT_PATH = process.env.CONTEXT_STUDY_OUTPUT || '';
const PAGE_SIZE = 1000;
const TOP_N = Number(process.env.CONTEXT_STUDY_TOP_N || 10);
const MIN_STATE_ROWS = Number(process.env.CONTEXT_STUDY_MIN_BUCKET_ROWS || 250);
const MIN_RECENT_STATE_ROWS = Number(process.env.CONTEXT_RECENT_MIN_BUCKET_ROWS || 12);
const MIN_ENVIRONMENT_MATCHES = Number(process.env.CONTEXT_ENV_MIN_MATCHES || 8);
const OVERLAY_TOLERANCE_MS = Number(process.env.CONTEXT_OVERLAY_TOLERANCE_SECONDS || 180) * 1000;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const idx = line.indexOf('=');
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')];
      }),
  );
}

function loadEnv() {
  const cwd = process.cwd();
  return {
    ...readEnvFile(path.join(cwd, '.env')),
    ...readEnvFile(path.join(cwd, '.env.local')),
    ...process.env,
  };
}

function resolveSupabaseCredentials(env) {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
  const explicitKey =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    env.SERVICE_ROLE_KEY ||
    env.VITE_SUPABASE_ANON_KEY ||
    env.SUPABASE_ANON_KEY;
  if (url && explicitKey) return { url, key: explicitKey, source: 'env' };

  try {
    const output = execFileSync(
      'supabase',
      ['projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const apiKeys = JSON.parse(output);
    const serviceKey =
      apiKeys.find((item) => String(item?.name || '').toLowerCase().includes('service_role'))?.api_key ||
      apiKeys.find((item) => String(item?.name || '').toLowerCase().includes('service role'))?.api_key ||
      apiKeys.find((item) => String(item?.name || '').toLowerCase().includes('anon'))?.api_key;
    if (serviceKey) {
      return { url, key: serviceKey, source: 'supabase_cli' };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing Supabase credentials and CLI fallback failed: ${message}`);
  }

  throw new Error('Unable to resolve Supabase credentials.');
}

function safeNumber(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^0-9+.-]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProbability(value) {
  const n = safeNumber(value);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

function americanImpliedProbability(odds) {
  const n = safeNumber(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function devigHomeProbability(homeOdds, awayOdds) {
  const home = americanImpliedProbability(homeOdds);
  const away = americanImpliedProbability(awayOdds);
  if (!Number.isFinite(home) || !Number.isFinite(away) || home + away === 0) return null;
  return home / (home + away);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const mid = Math.floor(ordered.length / 2);
  if (ordered.length % 2) return ordered[mid];
  return (ordered[mid - 1] + ordered[mid]) / 2;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseMadeAttemptPair(value) {
  const raw = String(value || '');
  const [made, attempts] = raw.split('-').map((piece) => safeNumber(piece));
  return { made, attempts };
}

function estimateTeamPossessions({ fg, ft, offensiveRebounds, turnovers }) {
  const fieldGoals = parseMadeAttemptPair(fg).attempts;
  const freeThrows = parseMadeAttemptPair(ft).attempts;
  const offReb = safeNumber(offensiveRebounds);
  const tos = safeNumber(turnovers);
  if (![fieldGoals, freeThrows, offReb, tos].every(Number.isFinite)) return null;
  return fieldGoals + 0.44 * freeThrows - offReb + tos;
}

function parseClockSeconds(clock) {
  if (clock == null) return null;
  const raw = String(clock).trim();
  if (!raw || raw === '—') return null;
  if (raw.includes(':')) {
    const [mins, secs] = raw.split(':');
    const mm = Number(mins);
    const ss = Number(secs);
    return Number.isFinite(mm) && Number.isFinite(ss) ? mm * 60 + ss : null;
  }
  const numeric = safeNumber(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function nbaRemainingMinutes(period, clock) {
  const p = safeNumber(period);
  const seconds = parseClockSeconds(clock);
  if (!Number.isFinite(p) || !Number.isFinite(seconds) || p <= 0) return null;
  if (p <= 4) return (4 - p) * 12 + seconds / 60;
  return seconds / 60;
}

function probabilityBand(probability) {
  if (!Number.isFinite(probability)) return 'NA';
  const lower = clamp(Math.floor(probability * 10) * 10, 0, 90);
  return `${lower}-${lower + 10}%`;
}

function progressBand(progressFraction) {
  if (!Number.isFinite(progressFraction)) return 'NA';
  const lower = clamp(Math.floor(progressFraction * 10) * 10, 0, 90);
  return `${lower}-${lower + 10}%`;
}

function certaintyBand(probability) {
  if (!Number.isFinite(probability)) return 'NA';
  const certainty = Math.abs(probability - 0.5);
  if (certainty >= 0.45) return '95%+ certainty';
  if (certainty >= 0.35) return '85-95% certainty';
  if (certainty >= 0.25) return '75-85% certainty';
  if (certainty >= 0.15) return '65-75% certainty';
  return 'Coin-flip to 65%';
}

function scoreDiffBand(scoreDiff) {
  if (!Number.isFinite(scoreDiff)) return 'NA';
  if (scoreDiff <= -15) return 'TRAIL_15P_PLUS';
  if (scoreDiff <= -8) return 'TRAIL_8_TO_14';
  if (scoreDiff <= -4) return 'TRAIL_4_TO_7';
  if (scoreDiff <= -1) return 'TRAIL_1_TO_3';
  if (scoreDiff === 0) return 'TIED';
  if (scoreDiff <= 3) return 'LEAD_1_TO_3';
  if (scoreDiff <= 7) return 'LEAD_4_TO_7';
  if (scoreDiff <= 14) return 'LEAD_8_TO_14';
  return 'LEAD_15P_PLUS';
}

function remainingMinuteBand(minutes) {
  if (!Number.isFinite(minutes)) return 'NA';
  if (minutes >= 36) return '36-48';
  if (minutes >= 24) return '24-36';
  if (minutes >= 18) return '18-24';
  if (minutes >= 12) return '12-18';
  if (minutes >= 6) return '6-12';
  if (minutes >= 3) return '3-6';
  if (minutes >= 1) return '1-3';
  return '0-1';
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function startOfIsoWeek(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function weekKey(dateLike) {
  const start = startOfIsoWeek(dateLike);
  return start ? isoDate(start) : null;
}

function monthKey(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function buildMonthlyRanges(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate) return [];

  const ranges = [];
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  while (cursor < endDate) {
    const rangeStart = new Date(cursor);
    const rangeEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    ranges.push({
      label: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`,
      start: rangeStart > startDate ? rangeStart.toISOString() : startDate.toISOString(),
      end: rangeEnd < endDate ? rangeEnd.toISOString() : endDate.toISOString(),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return ranges.filter((range) => new Date(range.start) < new Date(range.end));
}

function firstFinite(candidates) {
  for (const candidate of candidates) {
    if (Number.isFinite(candidate)) return candidate;
  }
  return null;
}

function chooseAnchor(candidates) {
  for (const candidate of candidates) {
    if (candidate && Object.values(candidate.values || {}).some(Number.isFinite)) return candidate;
  }
  return { source: null, values: {} };
}

function parseOddsContainer(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return {
    homeMl: safeNumber(raw.homeML),
    awayMl: safeNumber(raw.awayML),
    homeSpread: safeNumber(raw.homeSpread),
    awaySpread: safeNumber(raw.awaySpread),
    total: safeNumber(raw.total),
    overPrice: safeNumber(raw.overOdds),
    underPrice: safeNumber(raw.underOdds),
    homeSpreadPrice: safeNumber(raw.homeSpreadOdds),
    awaySpreadPrice: safeNumber(raw.awaySpreadOdds),
    provider: raw.provider || null,
  };
}

function buildTimedLookup(rows, timeField, chooser = null) {
  const grouped = new Map();
  for (const row of rows) {
    const ts = new Date(row[timeField]).getTime();
    if (!Number.isFinite(ts)) continue;
    const matchId = row.match_id;
    if (!grouped.has(matchId)) grouped.set(matchId, []);
    grouped.get(matchId).push({ ...row, _ts: ts });
  }

  const lookup = new Map();
  for (const [matchId, items] of grouped.entries()) {
    items.sort((left, right) => left._ts - right._ts);
    if (!chooser) {
      lookup.set(matchId, items);
      continue;
    }

    const deduped = [];
    let i = 0;
    while (i < items.length) {
      const sameTime = [items[i]];
      let j = i + 1;
      while (j < items.length && items[j]._ts === items[i]._ts) {
        sameTime.push(items[j]);
        j += 1;
      }
      deduped.push(chooser(sameTime));
      i = j;
    }
    lookup.set(matchId, deduped);
  }

  return lookup;
}

function nearestTimedRow(lookup, matchId, targetTime, toleranceMs = OVERLAY_TOLERANCE_MS) {
  const items = lookup.get(matchId);
  if (!items?.length) return null;
  const targetTs = new Date(targetTime).getTime();
  if (!Number.isFinite(targetTs)) return null;

  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (items[mid]._ts < targetTs) low = mid + 1;
    else high = mid - 1;
  }

  const candidates = [];
  if (items[low]) candidates.push(items[low]);
  if (items[low - 1]) candidates.push(items[low - 1]);

  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate._ts - targetTs);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best && bestDistance <= toleranceMs ? best : null;
}

function progressAlignedRow(lookup, matchId, progressFraction, predicate = null) {
  const items = lookup.get(matchId);
  if (!items?.length) return null;
  const boundedProgress = clamp(Number.isFinite(progressFraction) ? progressFraction : 0, 0, 1);
  const targetIndex = Math.round(boundedProgress * (items.length - 1));
  if (!predicate) return items[targetIndex] || null;

  for (let radius = 0; radius < items.length; radius += 1) {
    const leftIndex = targetIndex - radius;
    const rightIndex = targetIndex + radius;
    if (items[leftIndex] && predicate(items[leftIndex])) return items[leftIndex];
    if (radius !== 0 && items[rightIndex] && predicate(items[rightIndex])) return items[rightIndex];
  }
  return null;
}

function providerPriority(row) {
  const provider = String(row?.provider_id || row?.provider || '').toLowerCase();
  if (provider.includes('draftkings')) return 0;
  if (provider.includes('pinnacle')) return 1;
  if (provider.includes('fanduel')) return 2;
  if (provider.includes('espn')) return 3;
  if (provider.includes('betmgm')) return 4;
  if (provider.includes('caesars')) return 5;
  if (provider.includes('betrivers')) return 6;
  return 99;
}

function chooseCanonicalOddsRow(rows) {
  return [...rows]
    .sort((left, right) => {
      const leftHasMl = Number.isFinite(safeNumber(left.home_ml)) && Number.isFinite(safeNumber(left.away_ml)) ? 0 : 1;
      const rightHasMl = Number.isFinite(safeNumber(right.home_ml)) && Number.isFinite(safeNumber(right.away_ml)) ? 0 : 1;
      if (leftHasMl !== rightHasMl) return leftHasMl - rightHasMl;
      const byProvider = providerPriority(left) - providerPriority(right);
      if (byProvider !== 0) return byProvider;
      return String(left.provider || '').localeCompare(String(right.provider || ''));
    })
    .at(0);
}

function fetchCountSummary(rows) {
  const times = rows.map((row) => row.last_modified || row.captured_at).filter(Boolean).sort();
  return {
    rows: rows.length,
    matches: new Set(rows.map((row) => row.match_id)).size,
    firstTimestamp: times[0] || null,
    lastTimestamp: times.at(-1) || null,
  };
}

function pushMetric(bucketMap, key, payload) {
  if (!key) return;
  if (!bucketMap.has(key)) {
    bucketMap.set(key, {
      key,
      rows: 0,
      matches: new Set(),
      modelProbSum: 0,
      marketProbSum: 0,
      outcomeSum: 0,
      brierSum: 0,
      marketBrierSum: 0,
      calibrationGapSum: 0,
      falseCertaintyCount: 0,
      totalResidualSum: 0,
      totalResidualCount: 0,
      combinedFoulsSum: 0,
      combinedFoulsCount: 0,
      paceSum: 0,
      paceCount: 0,
      scoreDiffSum: 0,
      progressSum: 0,
      marketGapSum: 0,
      marketGapCount: 0,
      providerCounts: new Map(),
    });
  }

  const bucket = bucketMap.get(key);
  bucket.rows += 1;
  bucket.matches.add(payload.matchId);

  if (Number.isFinite(payload.modelProb)) {
    bucket.modelProbSum += payload.modelProb;
    if (Number.isFinite(payload.outcome)) {
      bucket.brierSum += (payload.modelProb - payload.outcome) ** 2;
      bucket.calibrationGapSum += payload.outcome - payload.modelProb;
    }
  }

  if (Number.isFinite(payload.outcome)) bucket.outcomeSum += payload.outcome;
  if (payload.falseCertainty) bucket.falseCertaintyCount += 1;
  if (Number.isFinite(payload.marketProb)) {
    bucket.marketProbSum += payload.marketProb;
    if (Number.isFinite(payload.outcome)) {
      bucket.marketBrierSum += (payload.marketProb - payload.outcome) ** 2;
    }
  }
  if (Number.isFinite(payload.marketGap)) {
    bucket.marketGapSum += payload.marketGap;
    bucket.marketGapCount += 1;
  }
  if (Number.isFinite(payload.totalResidual)) {
    bucket.totalResidualSum += payload.totalResidual;
    bucket.totalResidualCount += 1;
  }
  if (Number.isFinite(payload.combinedFouls)) {
    bucket.combinedFoulsSum += payload.combinedFouls;
    bucket.combinedFoulsCount += 1;
  }
  if (Number.isFinite(payload.estimatedPace)) {
    bucket.paceSum += payload.estimatedPace;
    bucket.paceCount += 1;
  }
  if (Number.isFinite(payload.scoreDiff)) bucket.scoreDiffSum += payload.scoreDiff;
  if (Number.isFinite(payload.progressFraction)) bucket.progressSum += payload.progressFraction;
  if (payload.provider) {
    bucket.providerCounts.set(payload.provider, (bucket.providerCounts.get(payload.provider) || 0) + 1);
  }
}

function finalizeBucketMap(bucketMap, { minRows = MIN_STATE_ROWS, sortBy = 'absCalibrationGap' } = {}) {
  const rows = [...bucketMap.values()]
    .filter((bucket) => bucket.rows >= minRows)
    .map((bucket) => {
      const avgModelProb = bucket.rows ? bucket.modelProbSum / bucket.rows : null;
      const actualRate = bucket.rows ? bucket.outcomeSum / bucket.rows : null;
      const avgMarketProb = bucket.marketProbSum > 0 ? bucket.marketProbSum / bucket.rows : null;
      const calibrationGap = bucket.rows ? bucket.calibrationGapSum / bucket.rows : null;
      const avgTotalResidual = bucket.totalResidualCount ? bucket.totalResidualSum / bucket.totalResidualCount : null;
      const avgCombinedFouls = bucket.combinedFoulsCount ? bucket.combinedFoulsSum / bucket.combinedFoulsCount : null;
      const avgEstimatedPace = bucket.paceCount ? bucket.paceSum / bucket.paceCount : null;
      const avgMarketGap = bucket.marketGapCount ? bucket.marketGapSum / bucket.marketGapCount : null;
      const topProviders = [...bucket.providerCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([provider, count]) => ({ provider, count }));

      return {
        key: bucket.key,
        rows: bucket.rows,
        matches: bucket.matches.size,
        avgModelProb: round(avgModelProb),
        avgMarketProb: round(avgMarketProb),
        actualRate: round(actualRate),
        calibrationGap: round(calibrationGap),
        absCalibrationGap: round(Math.abs(calibrationGap ?? 0)),
        brier: round(bucket.rows ? bucket.brierSum / bucket.rows : null),
        marketBrier: round(bucket.rows ? bucket.marketBrierSum / bucket.rows : null),
        falseCertaintyRate: round(bucket.falseCertaintyCount / bucket.rows),
        avgTotalResidual: round(avgTotalResidual),
        avgCombinedFouls: round(avgCombinedFouls),
        avgEstimatedPace: round(avgEstimatedPace),
        avgMarketGap: round(avgMarketGap),
        avgScoreDiff: round(bucket.rows ? bucket.scoreDiffSum / bucket.rows : null),
        avgProgressFraction: round(bucket.rows ? bucket.progressSum / bucket.rows : null),
        topProviders,
      };
    });

  const sorter =
    sortBy === 'marketGap'
      ? (left, right) => Math.abs(right.avgMarketGap ?? 0) - Math.abs(left.avgMarketGap ?? 0)
      : (left, right) => Math.abs(right.calibrationGap ?? 0) - Math.abs(left.calibrationGap ?? 0);

  return rows.sort(sorter).slice(0, TOP_N);
}

async function fetchAllPages(baseQueryFactory, label = 'query', expectedCount = null) {
  const results = [];
  let from = 0;
  let page = 0;
  while (true) {
    const { data, error } = await baseQueryFactory().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    results.push(...(data || []));
    page += 1;
    const progressSuffix = Number.isFinite(expectedCount) && expectedCount > 0 ? ` / ${expectedCount}` : '';
    console.error(`${label}: fetched ${results.length}${progressSuffix} rows after page ${page}`);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return results;
}

async function fetchProbabilityLedger(supabase) {
  const monthlyRanges = buildMonthlyRanges(START, END);
  const counts = await Promise.all(
    monthlyRanges.map(async (range) => {
      const { count, error } = await supabase
        .from('espn_probabilities')
        .select('match_id', { count: 'exact', head: true })
        .eq('league_id', SPORT)
        .gte('last_modified', range.start)
        .lt('last_modified', range.end);
      if (error) throw error;
      return { ...range, count: count || 0 };
    }),
  );

  const chunks = await Promise.all(
    counts.map((range) =>
      fetchAllPages(() =>
        supabase
          .from('espn_probabilities')
          .select(
            'match_id,last_modified,sequence_number,play_id,home_win_pct,away_win_pct,spread_cover_prob_home,spread_push_prob,total_over_prob,total_push_prob,seconds_left',
          )
          .eq('league_id', SPORT)
          .gte('last_modified', range.start)
          .lt('last_modified', range.end)
          .order('last_modified', { ascending: true })
          .order('sequence_number', { ascending: true }),
      `espn_probabilities ${range.label}`, range.count),
    ),
  );

  return chunks.flat();
}

async function main() {
  const env = loadEnv();
  const credentials = resolveSupabaseCredentials(env);
  const supabase = createClient(credentials.url, credentials.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.error(`Loading ${SPORT} probability history from espn_probabilities (${START} → ${END}) using ${credentials.source} credentials...`);
  const espnProbabilityRows = await fetchProbabilityLedger(supabase);

  console.error('Loading match metadata, outcomes, officials, and recent overlays...');

  const [matchesRows, postgameRows, officialsRows, liveOddsRows, liveContextRows] = await Promise.all([
    fetchAllPages(
      () =>
        supabase
          .from('matches')
          .select(
            'id,start_time,home_team,away_team,status,opening_odds,closing_odds,current_odds,venue_name,venue_city,venue_state,venue_indoor,attendance',
          )
          .eq('league_id', SPORT)
          .order('start_time', { ascending: true }),
      'matches',
    ),
    fetchAllPages(
      () =>
        supabase
          .from('nba_postgame')
          .select(
            'id,start_time,home_team,away_team,home_score,away_score,match_status,venue,attendance,home_fg,away_fg,home_ft,away_ft,home_off_rebounds,away_off_rebounds,home_turnovers,away_turnovers,home_fouls,away_fouls,dk_home_ml,dk_away_ml,dk_spread,dk_home_spread_price,dk_away_spread_price,dk_total,dk_over_price,dk_under_price',
          )
          .like('id', `%_${SPORT}`)
          .order('start_time', { ascending: true }),
      'nba_postgame',
    ),
    fetchAllPages(
      () =>
        supabase
          .from('game_officials')
          .select('match_id,official_name,official_position,official_order,game_date')
          .eq('league_id', SPORT)
          .order('game_date', { ascending: true })
          .order('official_order', { ascending: true }),
      'game_officials',
    ),
    fetchAllPages(
      () =>
        supabase
          .from('live_odds_snapshots')
          .select(
            'match_id,captured_at,provider,provider_id,period,clock,home_score,away_score,home_ml,away_ml,total,spread_home,spread_away,spread_home_price,spread_away_price,over_price,under_price',
          )
          .eq('league_id', SPORT)
          .gte('captured_at', START)
          .lt('captured_at', END)
          .order('captured_at', { ascending: true }),
      'live_odds_snapshots',
    ),
    fetchAllPages(
      () =>
        supabase
          .from('live_context_snapshots')
          .select(
            'match_id,captured_at,period,clock,home_score,away_score,game_status,situation,predictor,match_context',
          )
          .eq('league_id', SPORT)
          .gte('captured_at', START)
          .lt('captured_at', END)
          .order('captured_at', { ascending: true }),
      'live_context_snapshots',
    ),
  ]);

  const matchesById = new Map(matchesRows.map((row) => [row.id, row]));
  const postgameById = new Map(postgameRows.map((row) => [row.id, row]));
  const officialsByMatch = new Map();
  for (const row of officialsRows) {
    if (!officialsByMatch.has(row.match_id)) officialsByMatch.set(row.match_id, []);
    officialsByMatch.get(row.match_id).push(row);
  }
  for (const crew of officialsByMatch.values()) {
    crew.sort((left, right) => Number(left.official_order ?? 99) - Number(right.official_order ?? 99));
  }

  const liveOddsRowsWithMoneyline = liveOddsRows.filter(
    (row) => Number.isFinite(safeNumber(row.home_ml)) && Number.isFinite(safeNumber(row.away_ml)),
  );
  const inGameLiveContextRows = liveContextRows.filter((row) => {
    const period = safeNumber(row.period);
    return Number.isFinite(period) && period >= 1 && row.clock != null;
  });

  const liveOddsLookup = buildTimedLookup(liveOddsRows, 'captured_at', chooseCanonicalOddsRow);
  const liveContextLookup = buildTimedLookup(inGameLiveContextRows, 'captured_at');

  const probabilityByMatch = new Map();
  for (const row of espnProbabilityRows) {
    if (!probabilityByMatch.has(row.match_id)) probabilityByMatch.set(row.match_id, []);
    probabilityByMatch.get(row.match_id).push(row);
  }
  for (const rows of probabilityByMatch.values()) {
    rows.sort((left, right) => {
      const byTime = String(left.last_modified).localeCompare(String(right.last_modified));
      if (byTime !== 0) return byTime;
      return Number(left.sequence_number ?? 0) - Number(right.sequence_number ?? 0);
    });
  }

  const seasonMatchSummaries = [];
  const canonicalRows = [];

  for (const [matchId, rows] of probabilityByMatch.entries()) {
    const matchMeta = matchesById.get(matchId) || null;
    const postgame = postgameById.get(matchId) || null;
    const homeScore = safeNumber(postgame?.home_score ?? matchMeta?.home_score);
    const awayScore = safeNumber(postgame?.away_score ?? matchMeta?.away_score);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    const outcome = homeScore > awayScore ? 1 : 0;
    const totalPoints = homeScore + awayScore;
    const homeMargin = homeScore - awayScore;
    const combinedFouls =
      Number.isFinite(safeNumber(postgame?.home_fouls)) && Number.isFinite(safeNumber(postgame?.away_fouls))
        ? safeNumber(postgame?.home_fouls) + safeNumber(postgame?.away_fouls)
        : null;
    const estimatedPace = mean(
      [
        estimateTeamPossessions({
          fg: postgame?.home_fg,
          ft: postgame?.home_ft,
          offensiveRebounds: postgame?.home_off_rebounds,
          turnovers: postgame?.home_turnovers,
        }),
        estimateTeamPossessions({
          fg: postgame?.away_fg,
          ft: postgame?.away_ft,
          offensiveRebounds: postgame?.away_off_rebounds,
          turnovers: postgame?.away_turnovers,
        }),
      ].filter(Number.isFinite),
    );

    const dkAnchor = {
      source: 'nba_postgame_dk',
      values: {
        homeMl: safeNumber(postgame?.dk_home_ml),
        awayMl: safeNumber(postgame?.dk_away_ml),
        homeSpread: safeNumber(postgame?.dk_spread),
        total: safeNumber(postgame?.dk_total),
        overPrice: safeNumber(postgame?.dk_over_price),
        underPrice: safeNumber(postgame?.dk_under_price),
        homeSpreadPrice: safeNumber(postgame?.dk_home_spread_price),
        awaySpreadPrice: safeNumber(postgame?.dk_away_spread_price),
      },
    };
    const closingAnchor = { source: 'matches_closing_odds', values: parseOddsContainer(matchMeta?.closing_odds) };
    const openingAnchor = { source: 'matches_opening_odds', values: parseOddsContainer(matchMeta?.opening_odds) };
    const currentAnchor = { source: 'matches_current_odds', values: parseOddsContainer(matchMeta?.current_odds) };

    const mlAnchor = chooseAnchor([dkAnchor, closingAnchor, openingAnchor, currentAnchor]);
    const totalAnchor = chooseAnchor(
      [dkAnchor, closingAnchor, openingAnchor, currentAnchor].filter((candidate) => Number.isFinite(candidate.values?.total)),
    );
    const spreadAnchor = chooseAnchor(
      [dkAnchor, closingAnchor, openingAnchor, currentAnchor].filter((candidate) => Number.isFinite(candidate.values?.homeSpread)),
    );

    const anchorHomeProb = devigHomeProbability(mlAnchor.values.homeMl, mlAnchor.values.awayMl);
    const anchorTotal = totalAnchor.values.total ?? null;
    const anchorSpreadHome = spreadAnchor.values.homeSpread ?? null;
    const totalOverOutcome =
      Number.isFinite(anchorTotal) && totalPoints !== anchorTotal ? Number(totalPoints > anchorTotal) : null;
    const spreadCoverOutcome =
      Number.isFinite(anchorSpreadHome) && homeMargin + anchorSpreadHome !== 0 ? Number(homeMargin + anchorSpreadHome > 0) : null;

    const sortedOfficials = officialsByMatch.get(matchId) || [];
    const leadOfficial =
      sortedOfficials.find((official) => String(official.official_position || '').toLowerCase() === 'referee') ||
      sortedOfficials.at(0) ||
      null;
    const crewKey = sortedOfficials.length
      ? sortedOfficials.map((official) => official.official_name).filter(Boolean).sort().join(' | ')
      : null;

    const matchStart = matchMeta?.start_time || postgame?.start_time || rows[0]?.last_modified || null;
    const initialHomeProb = normalizeProbability(rows[0]?.home_win_pct);
    const pregameFavoriteSide = Number.isFinite(initialHomeProb)
      ? initialHomeProb >= 0.5
        ? 'HOME'
        : 'AWAY'
      : Number.isFinite(anchorHomeProb)
        ? anchorHomeProb >= 0.5
          ? 'HOME'
          : 'AWAY'
        : 'NA';

    let previousHomeProb = null;
    const velocitySeries = [];
    let matchFalseCertaintyCount = 0;
    let matchedMarketRows = 0;
    let matchedRichRows = 0;

    rows.forEach((row, index) => {
      const homeWinProb = normalizeProbability(row.home_win_pct);
      const spreadCoverProbHome = normalizeProbability(row.spread_cover_prob_home);
      const totalOverProb = normalizeProbability(row.total_over_prob);
      const progressFraction = rows.length > 1 ? index / (rows.length - 1) : 0;
      const absDelta = Number.isFinite(previousHomeProb) && Number.isFinite(homeWinProb) ? Math.abs(homeWinProb - previousHomeProb) : null;
      if (Number.isFinite(absDelta)) velocitySeries.push(absDelta);
      previousHomeProb = homeWinProb;

      const falseCertainty =
        Number.isFinite(homeWinProb) &&
        ((homeWinProb >= 0.9 && outcome === 0) || (homeWinProb <= 0.1 && outcome === 1));
      if (falseCertainty) matchFalseCertaintyCount += 1;

      const tightMarketRow = nearestTimedRow(liveOddsLookup, matchId, row.last_modified);
      const progressMarketRow =
        tightMarketRow ||
        progressAlignedRow(
          liveOddsLookup,
          matchId,
          progressFraction,
          (candidate) => Number.isFinite(safeNumber(candidate.home_ml)) && Number.isFinite(safeNumber(candidate.away_ml)),
        );
      const marketRow = tightMarketRow || progressMarketRow;
      const marketJoinMode = tightMarketRow ? 'timestamp' : progressMarketRow ? 'progress' : null;

      const tightRichRow = nearestTimedRow(liveContextLookup, matchId, row.last_modified);
      const progressRichRow = tightRichRow || progressAlignedRow(liveContextLookup, matchId, progressFraction);
      const richRow = tightRichRow || progressRichRow;
      const richJoinMode = tightRichRow ? 'timestamp' : progressRichRow ? 'progress' : null;

      const marketHomeProb = marketRow ? devigHomeProbability(marketRow.home_ml, marketRow.away_ml) : null;
      if (Number.isFinite(marketHomeProb)) matchedMarketRows += 1;
      if (richRow) matchedRichRows += 1;

      const richScoreDiff = Number.isFinite(safeNumber(richRow?.home_score)) && Number.isFinite(safeNumber(richRow?.away_score))
        ? safeNumber(richRow?.home_score) - safeNumber(richRow?.away_score)
        : null;
      const richRemainingMinutes = nbaRemainingMinutes(richRow?.period, richRow?.clock);
      const richBonusShape = richRow
        ? `${richRow.situation?.homeBonusState || 'NONE'}|${richRow.situation?.awayBonusState || 'NONE'}`
        : null;

      canonicalRows.push({
        matchId,
        matchStart,
        week: weekKey(matchStart),
        month: monthKey(matchStart),
        outcome,
        homeWinProb,
        spreadCoverProbHome,
        totalOverProb,
        totalOverOutcome,
        spreadCoverOutcome,
        anchorHomeProb,
        anchorTotal,
        anchorSpreadHome,
        anchorMlSource: mlAnchor.source,
        anchorTotalSource: totalAnchor.source,
        anchorSpreadSource: spreadAnchor.source,
        totalPoints,
        homeMargin,
        combinedFouls,
        estimatedPace,
        pregameHomeProb: initialHomeProb,
        pregameFavoriteSide,
        lastModified: row.last_modified,
        sequenceNumber: safeNumber(row.sequence_number),
        progressFraction,
        progressBand: progressBand(progressFraction),
        homeWinBand: probabilityBand(homeWinProb),
        spreadCoverBand: probabilityBand(spreadCoverProbHome),
        totalOverBand: probabilityBand(totalOverProb),
        certaintyBand: certaintyBand(homeWinProb),
        absDeltaHomeWinProb: absDelta,
        falseCertainty,
        marketHomeProb,
        marketProvider: marketRow?.provider || null,
        marketProviderId: marketRow?.provider_id || null,
        marketJoinMode,
        marketPeriod: safeNumber(marketRow?.period),
        marketClock: marketRow?.clock || null,
        marketScoreDiff:
          Number.isFinite(safeNumber(marketRow?.home_score)) && Number.isFinite(safeNumber(marketRow?.away_score))
            ? safeNumber(marketRow?.home_score) - safeNumber(marketRow?.away_score)
            : null,
        marketRemainingMinutes: nbaRemainingMinutes(marketRow?.period, marketRow?.clock),
        liveMarketTotal: safeNumber(marketRow?.total),
        liveMarketTotalResidual: Number.isFinite(safeNumber(marketRow?.total)) ? totalPoints - safeNumber(marketRow?.total) : null,
        richPeriod: safeNumber(richRow?.period),
        richClock: richRow?.clock || null,
        richJoinMode,
        richScoreDiff,
        richRemainingMinutes,
        richBonusShape,
        richHomeTimeouts: safeNumber(richRow?.situation?.homeTimeouts),
        richAwayTimeouts: safeNumber(richRow?.situation?.awayTimeouts),
        leadOfficial: leadOfficial?.official_name || null,
        crewKey,
        venue:
          postgame?.venue ||
          matchMeta?.venue_name ||
          richRow?.match_context?.venue?.name ||
          null,
      });
    });

    seasonMatchSummaries.push({
      matchId,
      startTime: matchStart,
      week: weekKey(matchStart),
      month: monthKey(matchStart),
      rowCount: rows.length,
      avgAbsHomeWinDelta: mean(velocitySeries),
      medianAbsHomeWinDelta: median(velocitySeries),
      falseCertaintyRate: rows.length ? matchFalseCertaintyCount / rows.length : null,
      homeOutcome: outcome,
      pregameHomeProb: initialHomeProb,
      anchorHomeProb,
      anchorTotal,
      anchorSpreadHome,
      anchorMlSource: mlAnchor.source,
      anchorTotalSource: totalAnchor.source,
      anchorSpreadSource: spreadAnchor.source,
      totalPoints,
      totalOverOutcome,
      totalResidual: Number.isFinite(anchorTotal) ? totalPoints - anchorTotal : null,
      homeMargin,
      spreadResidual: Number.isFinite(anchorSpreadHome) ? homeMargin + anchorSpreadHome : null,
      combinedFouls,
      estimatedPace,
      blowout: Math.abs(homeMargin) >= 15,
      venue:
        postgame?.venue ||
        matchMeta?.venue_name ||
        null,
      attendance: safeNumber(postgame?.attendance ?? matchMeta?.attendance),
      leadOfficial: leadOfficial?.official_name || null,
      crewKey,
      matchedMarketRows,
      matchedRichRows,
    });
  }

  if (!canonicalRows.length) {
    throw new Error(`No canonical ${SPORT} rows were built from espn_probabilities in the selected window.`);
  }

  const seasonBaseline = {
    combinedFouls: mean(seasonMatchSummaries.map((row) => row.combinedFouls).filter(Number.isFinite)),
    estimatedPace: mean(seasonMatchSummaries.map((row) => row.estimatedPace).filter(Number.isFinite)),
    totalResidual: mean(seasonMatchSummaries.map((row) => row.totalResidual).filter(Number.isFinite)),
  };

  const seasonPeriodRows = new Map();
  for (const row of canonicalRows) {
    if (!seasonPeriodRows.has(row.week)) seasonPeriodRows.set(row.week, []);
    seasonPeriodRows.get(row.week).push(row);
  }

  const seasonPeriodMatches = new Map();
  for (const match of seasonMatchSummaries) {
    if (!seasonPeriodMatches.has(match.week)) seasonPeriodMatches.set(match.week, []);
    seasonPeriodMatches.get(match.week).push(match);
  }

  const monthlyRows = new Map();
  for (const row of canonicalRows) {
    if (!monthlyRows.has(row.month)) monthlyRows.set(row.month, []);
    monthlyRows.get(row.month).push(row);
  }

  const monthlyMatches = new Map();
  for (const match of seasonMatchSummaries) {
    if (!monthlyMatches.has(match.month)) monthlyMatches.set(match.month, []);
    monthlyMatches.get(match.month).push(match);
  }

  function buildSeasonContext(rowsByPeriod, matchesByPeriod) {
    return [...rowsByPeriod.entries()]
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
      .map(([periodKey, rows]) => {
        const matches = matchesByPeriod.get(periodKey) || [];
        const homeBrierRows = rows.filter((row) => Number.isFinite(row.homeWinProb));
        const marketRows = rows.filter((row) => Number.isFinite(row.marketHomeProb));
        return {
          period: periodKey,
          matches: matches.length,
          probabilityRows: rows.length,
          avgEntriesPerMatch: round(rows.length / Math.max(matches.length, 1), 2),
          homeWinBrier: round(mean(homeBrierRows.map((row) => (row.homeWinProb - row.outcome) ** 2))),
          marketHomeWinBrier: round(mean(marketRows.map((row) => (row.marketHomeProb - row.outcome) ** 2))),
          avgAbsoluteRepricingStep: round(mean(rows.map((row) => row.absDeltaHomeWinProb).filter(Number.isFinite))),
          falseCertaintyRate: round(mean(rows.map((row) => Number(row.falseCertainty)))),
          avgPregameHomeProb: round(mean(matches.map((row) => row.pregameHomeProb).filter(Number.isFinite))),
          avgAnchorTotal: round(mean(matches.map((row) => row.anchorTotal).filter(Number.isFinite)), 2),
          avgFinalTotal: round(mean(matches.map((row) => row.totalPoints).filter(Number.isFinite)), 2),
          avgTotalResidual: round(mean(matches.map((row) => row.totalResidual).filter(Number.isFinite)), 2),
          avgEstimatedPace: round(mean(matches.map((row) => row.estimatedPace).filter(Number.isFinite)), 2),
          paceDeltaVsSeason: round(
            mean(matches.map((row) => row.estimatedPace).filter(Number.isFinite)) - (seasonBaseline.estimatedPace ?? 0),
            2,
          ),
          avgCombinedFouls: round(mean(matches.map((row) => row.combinedFouls).filter(Number.isFinite)), 2),
          foulDeltaVsSeason: round(
            mean(matches.map((row) => row.combinedFouls).filter(Number.isFinite)) - (seasonBaseline.combinedFouls ?? 0),
            2,
          ),
          blowoutRate: round(mean(matches.map((row) => Number(row.blowout)))),
          marketOverlayRowRate: round(mean(rows.map((row) => Number(Number.isFinite(row.marketHomeProb))))),
          richOverlayRowRate: round(mean(rows.map((row) => Number(Number.isFinite(row.richPeriod))))),
        };
      });
  }

  const homeWinBucketMap = new Map();
  const totalBucketMap = new Map();
  const spreadBucketMap = new Map();
  const recentMarketBucketMap = new Map();
  const recentRichBucketMap = new Map();

  for (const row of canonicalRows) {
    pushMetric(homeWinBucketMap, `${row.progressBand}|${row.homeWinBand}`, {
      matchId: row.matchId,
      modelProb: row.homeWinProb,
      outcome: row.outcome,
      falseCertainty: row.falseCertainty,
      marketProb: row.marketHomeProb,
      marketGap: Number.isFinite(row.marketHomeProb) && Number.isFinite(row.homeWinProb) ? row.homeWinProb - row.marketHomeProb : null,
      combinedFouls: row.combinedFouls,
      estimatedPace: row.estimatedPace,
      progressFraction: row.progressFraction,
      provider: row.marketProvider,
    });

    if (Number.isFinite(row.totalOverProb) && Number.isFinite(row.totalOverOutcome)) {
      pushMetric(totalBucketMap, `${row.progressBand}|${row.totalOverBand}`, {
        matchId: row.matchId,
        modelProb: row.totalOverProb,
        outcome: row.totalOverOutcome,
        totalResidual: row.totalPoints - row.anchorTotal,
        combinedFouls: row.combinedFouls,
        estimatedPace: row.estimatedPace,
        progressFraction: row.progressFraction,
      });
    }

    if (Number.isFinite(row.spreadCoverProbHome) && Number.isFinite(row.spreadCoverOutcome)) {
      pushMetric(spreadBucketMap, `${row.progressBand}|${row.spreadCoverBand}`, {
        matchId: row.matchId,
        modelProb: row.spreadCoverProbHome,
        outcome: row.spreadCoverOutcome,
        combinedFouls: row.combinedFouls,
        estimatedPace: row.estimatedPace,
        progressFraction: row.progressFraction,
      });
    }

    if (Number.isFinite(row.marketHomeProb)) {
      const recentKey = [
        `P${row.marketPeriod ?? 'NA'}`,
        remainingMinuteBand(row.marketRemainingMinutes),
        scoreDiffBand(row.marketScoreDiff),
      ].join('|');
      pushMetric(recentMarketBucketMap, recentKey, {
        matchId: row.matchId,
        modelProb: row.homeWinProb,
        marketProb: row.marketHomeProb,
        outcome: row.outcome,
        falseCertainty: row.falseCertainty,
        scoreDiff: row.marketScoreDiff,
        progressFraction: row.progressFraction,
        provider: row.marketProvider,
      });
    }

    if (Number.isFinite(row.richPeriod) && Number.isFinite(row.richScoreDiff)) {
      const richKey = [
        `P${row.richPeriod}`,
        remainingMinuteBand(row.richRemainingMinutes),
        scoreDiffBand(row.richScoreDiff),
        row.richBonusShape || 'NONE|NONE',
      ].join('|');
      pushMetric(recentRichBucketMap, richKey, {
        matchId: row.matchId,
        modelProb: row.homeWinProb,
        marketProb: row.marketHomeProb,
        outcome: row.outcome,
        falseCertainty: row.falseCertainty,
        scoreDiff: row.richScoreDiff,
        combinedFouls: row.combinedFouls,
        estimatedPace: row.estimatedPace,
        progressFraction: row.progressFraction,
      });
    }
  }

  const leadOfficialStats = new Map();
  const venueStats = new Map();

  for (const match of seasonMatchSummaries) {
    if (match.leadOfficial) {
      if (!leadOfficialStats.has(match.leadOfficial)) leadOfficialStats.set(match.leadOfficial, []);
      leadOfficialStats.get(match.leadOfficial).push(match);
    }
    if (match.venue) {
      if (!venueStats.has(match.venue)) venueStats.set(match.venue, []);
      venueStats.get(match.venue).push(match);
    }
  }

  function summarizeEnvironment(groupedMatches, metricKey) {
    return [...groupedMatches.entries()]
      .map(([key, matches]) => {
        const avgCombinedFouls = mean(matches.map((row) => row.combinedFouls).filter(Number.isFinite));
        const avgEstimatedPace = mean(matches.map((row) => row.estimatedPace).filter(Number.isFinite));
        const avgTotalResidual = mean(matches.map((row) => row.totalResidual).filter(Number.isFinite));
        const avgAttendance = mean(matches.map((row) => row.attendance).filter(Number.isFinite));
        return {
          key,
          matches: matches.length,
          avgCombinedFouls: round(avgCombinedFouls, 2),
          foulDeltaVsSeason: round((avgCombinedFouls ?? 0) - (seasonBaseline.combinedFouls ?? 0), 2),
          avgEstimatedPace: round(avgEstimatedPace, 2),
          paceDeltaVsSeason: round((avgEstimatedPace ?? 0) - (seasonBaseline.estimatedPace ?? 0), 2),
          avgTotalResidual: round(avgTotalResidual, 2),
          blowoutRate: round(mean(matches.map((row) => Number(row.blowout)))),
          avgAttendance: round(avgAttendance, 0),
        };
      })
      .filter((row) => row.matches >= MIN_ENVIRONMENT_MATCHES)
      .sort((left, right) => Math.abs(right[metricKey] ?? 0) - Math.abs(left[metricKey] ?? 0))
      .slice(0, TOP_N);
  }

  const matchedMarketRows = canonicalRows.filter((row) => Number.isFinite(row.marketHomeProb));
  const matchedRichRows = canonicalRows.filter((row) => Number.isFinite(row.richPeriod));
  const providerCounts = new Map();
  const marketJoinModeCounts = new Map();
  const richJoinModeCounts = new Map();
  for (const row of matchedMarketRows) {
    const provider = row.marketProvider || 'unknown';
    providerCounts.set(provider, (providerCounts.get(provider) || 0) + 1);
    marketJoinModeCounts.set(row.marketJoinMode || 'unknown', (marketJoinModeCounts.get(row.marketJoinMode || 'unknown') || 0) + 1);
  }
  for (const row of matchedRichRows) {
    richJoinModeCounts.set(row.richJoinMode || 'unknown', (richJoinModeCounts.get(row.richJoinMode || 'unknown') || 0) + 1);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scope: {
      sport: SPORT,
      start: START,
      end: END,
      canonicalHistoricalTable: 'espn_probabilities',
      marketOverlayTable: 'live_odds_snapshots',
      richOverlayTable: 'live_context_snapshots',
      overlayToleranceSeconds: OVERLAY_TOLERANCE_MS / 1000,
      credentialSource: credentials.source,
    },
    coverage: {
      historicalProbabilityLedger: {
        ...fetchCountSummary(espnProbabilityRows),
        canonicalRows: canonicalRows.length,
        canonicalMatches: new Set(canonicalRows.map((row) => row.matchId)).size,
        canonicalWeeks: new Set(canonicalRows.map((row) => row.week).filter(Boolean)).size,
        canonicalMonths: new Set(canonicalRows.map((row) => row.month).filter(Boolean)).size,
      },
      outcomeCoverage: {
        matchesWithFinalOutcome: seasonMatchSummaries.length,
        matchesWithAnchorHomeMl: seasonMatchSummaries.filter((row) => Number.isFinite(row.anchorHomeProb)).length,
        matchesWithAnchorTotal: seasonMatchSummaries.filter((row) => Number.isFinite(row.anchorTotal)).length,
        matchesWithAnchorSpread: seasonMatchSummaries.filter((row) => Number.isFinite(row.anchorSpreadHome)).length,
        draftKingsAnchorMatches: seasonMatchSummaries.filter(
          (row) =>
            row.anchorMlSource === 'nba_postgame_dk' ||
            row.anchorTotalSource === 'nba_postgame_dk' ||
            row.anchorSpreadSource === 'nba_postgame_dk',
        ).length,
      },
      anchorSources: {
        moneyline: Object.fromEntries(
          [...new Set(seasonMatchSummaries.map((row) => row.anchorMlSource))]
            .filter(Boolean)
            .map((source) => [source, seasonMatchSummaries.filter((row) => row.anchorMlSource === source).length]),
        ),
        total: Object.fromEntries(
          [...new Set(seasonMatchSummaries.map((row) => row.anchorTotalSource))]
            .filter(Boolean)
            .map((source) => [source, seasonMatchSummaries.filter((row) => row.anchorTotalSource === source).length]),
        ),
        spread: Object.fromEntries(
          [...new Set(seasonMatchSummaries.map((row) => row.anchorSpreadSource))]
            .filter(Boolean)
            .map((source) => [source, seasonMatchSummaries.filter((row) => row.anchorSpreadSource === source).length]),
        ),
      },
      recentMarketOverlay: {
        ...fetchCountSummary(liveOddsRows),
        rowsWithMoneyline: liveOddsRowsWithMoneyline.length,
        matchedRows: matchedMarketRows.length,
        matchedMatches: new Set(matchedMarketRows.map((row) => row.matchId)).size,
        joinModes: Object.fromEntries([...marketJoinModeCounts.entries()].sort((left, right) => right[1] - left[1])),
        providerMix: [...providerCounts.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([provider, count]) => ({ provider, count })),
      },
      recentRichOverlay: {
        ...fetchCountSummary(liveContextRows),
        inGameRows: inGameLiveContextRows.length,
        matchedRows: matchedRichRows.length,
        matchedMatches: new Set(matchedRichRows.map((row) => row.matchId)).size,
        joinModes: Object.fromEntries([...richJoinModeCounts.entries()].sort((left, right) => right[1] - left[1])),
      },
      officials: {
        rows: officialsRows.length,
        matches: officialsByMatch.size,
      },
    },
    weeklySeasonStudy: buildSeasonContext(seasonPeriodRows, seasonPeriodMatches),
    monthlySeasonStudy: buildSeasonContext(monthlyRows, monthlyMatches),
    historicalProbabilityStudy: {
      homeWinStates: finalizeBucketMap(homeWinBucketMap, { minRows: MIN_STATE_ROWS, sortBy: 'absCalibrationGap' }),
      totalOverStates: finalizeBucketMap(totalBucketMap, { minRows: MIN_STATE_ROWS, sortBy: 'absCalibrationGap' }),
      spreadCoverStates: finalizeBucketMap(spreadBucketMap, { minRows: MIN_STATE_ROWS, sortBy: 'absCalibrationGap' }),
    },
    recentMarketOverlayStudy: {
      summary: {
        matchedRows: matchedMarketRows.length,
        matchedMatches: new Set(matchedMarketRows.map((row) => row.matchId)).size,
        firstTimestamp: matchedMarketRows[0]?.lastModified || null,
        lastTimestamp: matchedMarketRows.at(-1)?.lastModified || null,
        joinModes: Object.fromEntries([...marketJoinModeCounts.entries()].sort((left, right) => right[1] - left[1])),
        espnHomeWinBrier: round(mean(matchedMarketRows.map((row) => (row.homeWinProb - row.outcome) ** 2))),
        marketHomeWinBrier: round(mean(matchedMarketRows.map((row) => (row.marketHomeProb - row.outcome) ** 2))),
        avgEspnMinusMarket: round(
          mean(
            matchedMarketRows
              .map((row) => (Number.isFinite(row.homeWinProb) && Number.isFinite(row.marketHomeProb) ? row.homeWinProb - row.marketHomeProb : null))
              .filter(Number.isFinite),
          ),
        ),
        medianLiveTotalResidual: round(median(matchedMarketRows.map((row) => row.liveMarketTotalResidual).filter(Number.isFinite)), 2),
      },
      topMoneylineGapStates: finalizeBucketMap(recentMarketBucketMap, {
        minRows: MIN_RECENT_STATE_ROWS,
        sortBy: 'marketGap',
      }),
    },
    recentRichOverlayStudy: {
      summary: {
        matchedRows: matchedRichRows.length,
        matchedMatches: new Set(matchedRichRows.map((row) => row.matchId)).size,
        firstTimestamp: matchedRichRows[0]?.lastModified || null,
        lastTimestamp: matchedRichRows.at(-1)?.lastModified || null,
        joinModes: Object.fromEntries([...richJoinModeCounts.entries()].sort((left, right) => right[1] - left[1])),
        avgCombinedFouls: round(mean(matchedRichRows.map((row) => row.combinedFouls).filter(Number.isFinite)), 2),
        avgEstimatedPace: round(mean(matchedRichRows.map((row) => row.estimatedPace).filter(Number.isFinite)), 2),
      },
      topScoreboardContextStates: finalizeBucketMap(recentRichBucketMap, {
        minRows: MIN_RECENT_STATE_ROWS,
        sortBy: 'absCalibrationGap',
      }),
    },
    refVenueEnvironmentStudy: {
      leadOfficialsByFoulEnvironment: summarizeEnvironment(leadOfficialStats, 'foulDeltaVsSeason'),
      leadOfficialsByTotalResidual: summarizeEnvironment(leadOfficialStats, 'avgTotalResidual'),
      venuesByPaceEnvironment: summarizeEnvironment(venueStats, 'paceDeltaVsSeason'),
      venuesByTotalResidual: summarizeEnvironment(venueStats, 'avgTotalResidual'),
    },
    notes: [
      'Full-season historical live context comes from espn_probabilities, which stores sequence-level probability rows but not season-long scoreboard state.',
      'Recent live_odds_snapshots and live_context_snapshots are treated as overlays only; they do not yet cover the full NBA season window.',
      'Spread and total studies are evaluated against pregame anchor lines, because ESPN total_over_prob and spread_cover_prob_home are anchored to pregame lines, not live totals or live spreads.',
      matchedMarketRows.length === 0
        ? 'The current live odds overlay did not produce usable matches, even after progress alignment, so market residual sections remain coverage-limited.'
        : marketJoinModeCounts.has('progress')
          ? 'Where timestamp-tight matches were unavailable, the runner falls back to within-match progress alignment for overlay joins. Treat those overlay reads as inferred context rather than exact synchronized state.'
          : 'Live overlay rows are matched by nearest timestamp within the configured tolerance.',
    ],
  };

  const json = JSON.stringify(report, null, 2);
  if (OUTPUT_PATH) {
    fs.writeFileSync(OUTPUT_PATH, `${json}\n`, 'utf8');
  }
  console.log(json);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
