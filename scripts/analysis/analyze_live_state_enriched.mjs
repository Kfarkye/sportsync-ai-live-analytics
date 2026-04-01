import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const START = process.env.LIVE_STATE_START || '2025-10-02T00:00:00Z';
const END = process.env.LIVE_STATE_END || '2026-03-15T00:00:00Z';
const PAGE_SIZE = 1000;
const ENABLE_FEATURE_FAMILIES = process.env.ENABLE_FEATURE_FAMILIES === '1';

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

function parseClockSeconds(clock) {
  if (clock == null) return null;
  const cleaned = String(clock).trim().replace(/[^0-9:.]/g, '');
  if (!cleaned) return null;
  if (cleaned.includes(':')) {
    const [mins, secs] = cleaned.split(':');
    const mm = Number(mins);
    const ss = Number(secs);
    return Number.isFinite(mm) && Number.isFinite(ss) ? mm * 60 + ss : null;
  }
  const direct = Number(cleaned);
  return Number.isFinite(direct) ? direct : null;
}

function nbaRemainingMinutes(period, clock) {
  const p = Number(period);
  const seconds = parseClockSeconds(clock);
  if (!Number.isFinite(p) || !Number.isFinite(seconds) || p <= 0) return null;
  if (p <= 4) return (4 - p) * 12 + seconds / 60;
  return seconds / 60;
}

function statValue(stats, label, side) {
  if (!Array.isArray(stats)) return null;
  const row = stats.find((item) => String(item?.label || '').toLowerCase() === label.toLowerCase());
  if (!row) return null;
  return safeNumber(side === 'home' ? row.homeValue : row.awayValue);
}

function statPairPiece(stats, label, side, piece) {
  if (!Array.isArray(stats)) return null;
  const row = stats.find((item) => String(item?.label || '').toLowerCase() === label.toLowerCase());
  if (!row) return null;
  const raw = String(side === 'home' ? row.homeValue ?? '' : row.awayValue ?? '');
  const split = raw.split('-');
  if (!split[piece - 1]) return null;
  return safeNumber(split[piece - 1]);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundBucket(value, size) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value / size) * size;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function blendReferences(...values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function normalizeEntityId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.replace(/(_[A-Za-z0-9]+)$/, '');
}

function clampProbability(value) {
  if (!Number.isFinite(value)) return null;
  return clamp(value, 0.001, 0.999);
}

function parseRecentPossession(recentPlays, homeTeamId, awayTeamId) {
  if (!Array.isArray(recentPlays)) return { side: null, confidence: 'NONE', source: null };
  const normalizedHomeTeamId = normalizeEntityId(homeTeamId);
  const normalizedAwayTeamId = normalizeEntityId(awayTeamId);
  for (let i = recentPlays.length - 1; i >= 0; i -= 1) {
    const play = recentPlays[i];
    if (play?.teamId == null) continue;
    const teamId = normalizeEntityId(play.teamId);
    const side = teamId === normalizedHomeTeamId ? 'HOME' : teamId === normalizedAwayTeamId ? 'AWAY' : null;
    if (!side) continue;
    const text = `${play?.type || ''} ${play?.text || ''}`.toLowerCase();
    if (/(turnover|travel|bad pass|shot clock turnover|offensive foul)/.test(text)) {
      return { side: side === 'HOME' ? 'AWAY' : 'HOME', confidence: 'HIGH', source: 'recent_play_turnover' };
    }
    if (/(defensive rebound|offensive rebound|steal|gains possession)/.test(text)) {
      return { side, confidence: 'HIGH', source: 'recent_play_change' };
    }
    if (/jump ball/.test(text)) {
      return { side, confidence: 'MEDIUM', source: 'recent_play_jump_ball' };
    }
    if (/timeout/.test(text)) {
      return { side, confidence: 'MEDIUM', source: 'recent_play_timeout' };
    }
    if (/(makes .*free throw 2 of 2|makes .*free throw 3 of 3|makes .*jumper|makes .*layup|makes .*dunk|makes .*three point|made shot)/.test(text)) {
      return { side: side === 'HOME' ? 'AWAY' : 'HOME', confidence: 'LOW', source: 'recent_play_make' };
    }
  }
  return { side: null, confidence: 'NONE', source: null };
}

function fullKey(row, familyKey) {
  return familyKey ? `${baselineKey(row)}|${familyKey}` : null;
}

function baselineKey(row) {
  return `${row.period}|${row.minuteBucket}|${clamp(Math.round(row.scoreDiff), -20, 20)}`;
}

function parseSpreadMagnitude(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const match = text.match(/(-?\d+(?:\.\d+)?)(?!.*-?\d)/);
  if (!match) return safeNumber(text);
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

function nbaElapsedMinutes(period, clock) {
  const p = Number(period);
  const seconds = parseClockSeconds(clock);
  if (!Number.isFinite(p) || !Number.isFinite(seconds) || p <= 0) return null;
  if (p <= 4) return (p - 1) * 12 + (12 - seconds / 60);
  return 48 + (p - 5) * 5 + (5 - seconds / 60);
}

function statValueAny(stats, labels, side) {
  for (const label of labels) {
    const value = statValue(stats, label, side);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function deriveIntentionalFoulLikelihood({
  period,
  remainingMinutes,
  scoreDiff,
  trailingSide,
  homeFoulsToGive,
  awayFoulsToGive,
  homeTimeouts,
  awayTimeouts,
}) {
  if (Number(period) < 4 || !Number.isFinite(remainingMinutes) || remainingMinutes > 3.0) return 'NONE';
  const absDiff = Math.abs(Number(scoreDiff ?? 0));
  if (!trailingSide || absDiff < 3 || absDiff > 10) return 'NONE';

  const trailingFoulsToGive = trailingSide === 'HOME' ? homeFoulsToGive : awayFoulsToGive;
  const trailingTimeouts = trailingSide === 'HOME' ? homeTimeouts : awayTimeouts;

  if ((trailingFoulsToGive ?? 99) === 0 && trailingTimeouts > 0 && remainingMinutes <= 1.75 && absDiff >= 4 && absDiff <= 8) {
    return 'HIGH';
  }
  if ((trailingFoulsToGive ?? 99) <= 1 && remainingMinutes <= 2.5 && absDiff >= 4 && absDiff <= 9) {
    return 'MEDIUM';
  }
  if ((trailingFoulsToGive ?? 99) <= 1 && remainingMinutes <= 3.0 && absDiff >= 3 && absDiff <= 10) {
    return 'LOW';
  }
  return 'NONE';
}

function deriveGameScriptClass({
  period,
  remainingMinutes,
  scoreDiff,
  possessionSide,
  trailingSide,
  homeBonusState,
  awayBonusState,
  intentionalFoulLikelihoodClass,
  homeTimeouts,
  awayTimeouts,
}) {
  const absDiff = Math.abs(Number(scoreDiff ?? 0));
  if (Number(period) < 4 || !Number.isFinite(remainingMinutes) || remainingMinutes > 4) return 'NORMAL_FLOW';
  if (intentionalFoulLikelihoodClass === 'HIGH' || intentionalFoulLikelihoodClass === 'MEDIUM') return 'INTENTIONAL_FOUL_WINDOW';
  if (remainingMinutes <= 0.35 && absDiff <= 1) return 'LAST_SHOT';
  if (remainingMinutes <= 0.75 && absDiff <= 3 && possessionSide && trailingSide && possessionSide === trailingSide) return 'ONE_POSSESSION_CHASE';
  if (remainingMinutes <= 1.25 && absDiff <= 3 && possessionSide && trailingSide && possessionSide !== trailingSide) return 'LEADER_CONTROL';
  if (remainingMinutes <= 4 && homeBonusState !== 'NONE' && awayBonusState !== 'NONE') return 'DOUBLE_BONUS_ACCELERATION';
  if (remainingMinutes <= 2.5 && absDiff >= 10) return 'CLOCK_BURN';
  if ((homeTimeouts ?? 0) + (awayTimeouts ?? 0) <= 2 && remainingMinutes <= 1.5 && absDiff <= 6) return 'LOW_TIMEOUT_ENDGAME';
  return 'LATE_STANDARD';
}

function globalProbability(rows) {
  return mean(rows.map((row) => row.outcome)) ?? 0.5;
}

function buildStats(rows, keyFn) {
  const stats = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const current = stats.get(key) || { wins: 0, n: 0 };
    current.wins += row.outcome;
    current.n += 1;
    stats.set(key, current);
  }
  return stats;
}

function buildNumericStats(rows, keyFn, valueFn) {
  const stats = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const value = valueFn(row);
    if (!key || !Number.isFinite(value)) continue;
    const current = stats.get(key) || { sum: 0, n: 0 };
    current.sum += value;
    current.n += 1;
    stats.set(key, current);
  }
  return stats;
}

function smoothedProbability(stat, priorProb, priorWeight = 12) {
  if (!stat) return priorProb;
  return (stat.wins + priorProb * priorWeight) / (stat.n + priorWeight);
}

function smoothedAverage(stat, priorMean, priorWeight = 12) {
  if (!stat) return priorMean;
  return (stat.sum + priorMean * priorWeight) / (stat.n + priorWeight);
}

function makePredictor(trainRows, familyKeyFn) {
  const globalProb = globalProbability(trainRows);
  const baselineStats = buildStats(trainRows, baselineKey);
  const familyStats = buildStats(trainRows, (row) => fullKey(row, familyKeyFn ? familyKeyFn(row) : null));
  return (row) => {
    const base = smoothedProbability(baselineStats.get(baselineKey(row)), globalProb);
    if (!familyKeyFn) return base;
    const key = fullKey(row, familyKeyFn(row));
    if (!key) return base;
    const stat = familyStats.get(key);
    if (!stat || stat.n < 4) return base;
    return smoothedProbability(stat, base, 8);
  };
}

function scoreRows(rows, predictor) {
  return rows.map((row) => {
    const probability = predictor(row);
    const marketResidual = Number.isFinite(row.marketDevigHomeProb) ? row.outcome - row.marketDevigHomeProb : null;
    const gap = Number.isFinite(row.marketDevigHomeProb) ? probability - row.marketDevigHomeProb : null;
    return {
      ...row,
      probability,
      brier: (probability - row.outcome) ** 2,
      gap,
      marketResidual,
      gapAligned: Number.isFinite(gap) && Number.isFinite(marketResidual) ? gap * marketResidual : null,
      gapSignCorrect:
        Number.isFinite(gap) && Number.isFinite(marketResidual) && gap !== 0 && marketResidual !== 0
          ? Number(Math.sign(gap) === Math.sign(marketResidual))
          : null,
    };
  });
}

function summarizeScoredRows(scored) {
  const gapRows = scored.filter((row) => Number.isFinite(row.gap) && Number.isFinite(row.gapSignCorrect));
  gapRows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const topCount = Math.max(1, Math.floor(gapRows.length * 0.1));
  const topGapRows = gapRows.slice(0, topCount);

  return {
    brier: mean(scored.map((row) => row.brier)),
    topDecileGapSignAccuracy: mean(topGapRows.map((row) => row.gapSignCorrect)),
    topDecileGapAlignment: mean(topGapRows.map((row) => row.gapAligned)),
    topDecileMeanAbsGap: mean(topGapRows.map((row) => Math.abs(row.gap))),
    topDecileCount: topGapRows.length,
  };
}

function evaluateModel(rows, predictor) {
  return summarizeScoredRows(scoreRows(rows, predictor));
}

function familyDefinitions() {
  return [
    {
      id: 'pregame_anchor_v2',
      label: 'Pregame Anchor v2',
      key: (row) => {
        if (
          !Number.isFinite(row.pregameAnchorHomeProb) &&
          !Number.isFinite(row.pregameTotalAnchor) &&
          !Number.isFinite(row.openingSpreadAbs)
        ) {
          return null;
        }
        return [
          row.pregameFavoriteSide || 'NA',
          Number.isFinite(row.pregameFavoriteProb) ? roundBucket(row.pregameFavoriteProb, 0.05).toFixed(2) : 'na',
          Number.isFinite(row.pregameModelMarketDelta) ? roundBucket(row.pregameModelMarketDelta, 0.05).toFixed(2) : 'na',
          Number.isFinite(row.pregameTotalAnchor) ? String(roundBucket(row.pregameTotalAnchor, 5)) : 'na',
          Number.isFinite(row.openingSpreadAbs) ? String(roundBucket(row.openingSpreadAbs, 1)) : 'na',
        ].join('|');
      },
    },
    {
      id: 'possession',
      label: 'Possession',
      key: (row) => (row.possessionSide ? `${row.possessionSide}|${row.possessionConfidence}` : null),
    },
    {
      id: 'bonus_state',
      label: 'Bonus State',
      key: (row) =>
        `${row.homeBonusState || 'NONE'}|${row.awayBonusState || 'NONE'}|${row.homeFoulsToGive ?? -1}|${row.awayFoulsToGive ?? -1}`,
    },
    {
      id: 'timeouts',
      label: 'Timeouts',
      key: (row) =>
        Number.isFinite(row.homeTimeouts) && Number.isFinite(row.awayTimeouts)
          ? `${clamp(row.homeTimeouts, 0, 7)}|${clamp(row.awayTimeouts, 0, 7)}|${clamp(row.homeTimeouts - row.awayTimeouts, -3, 3)}`
          : null,
    },
    {
      id: 'remaining_possessions_v2',
      label: 'Remaining Possessions v2',
      key: (row) =>
        Number.isFinite(row.remainingPossessionsV2) && Number.isFinite(row.remainingPossessionsDelta)
          ? `${roundBucket(row.remainingPossessionsV2, 2)}|${roundBucket(row.remainingPossessionsDelta, 1)}|${roundBucket(row.observedPace48, 5)}`
          : null,
    },
    {
      id: 'game_script_class',
      label: 'Intentional Foul / Game Script',
      key: (row) =>
        row.gameScriptClass
          ? `${row.gameScriptClass}|${row.intentionalFoulLikelihoodClass || 'NONE'}|${row.trailingSide || 'TIE'}`
          : null,
    },
  ];
}

async function fetchAllPages(baseQueryFactory) {
  const results = [];
  let from = 0;
  while (true) {
    const { data, error } = await baseQueryFactory().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    results.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return results;
}

async function fetchByBatches(items, batchSize, handler) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const chunk = await handler(batch, i / batchSize);
    results.push(...chunk);
  }
  return results;
}

function buildBpiLookupRows(bpiRows) {
  const byMatch = new Map();
  for (const row of bpiRows) {
    const current = byMatch.get(row.match_id) || [];
    current.push(row);
    byMatch.set(row.match_id, current);
  }

  for (const rows of byMatch.values()) {
    rows.sort((left, right) => {
      const byCreatedAt = String(left.created_at || '').localeCompare(String(right.created_at || ''));
      if (byCreatedAt !== 0) return byCreatedAt;
      const byPeriod = Number(left.period ?? -1) - Number(right.period ?? -1);
      if (byPeriod !== 0) return byPeriod;
      return String(left.clock ?? '').localeCompare(String(right.clock ?? ''));
    });
  }

  return byMatch;
}

function findBestBpiRow(rows, snapshot) {
  if (!rows?.length) return {};

  const exact = rows.find(
    (row) => Number(row.period ?? -1) === Number(snapshot.period ?? -1) && String(row.clock ?? '') === String(snapshot.clock ?? ''),
  );
  if (exact?.play_data) return exact.play_data;

  const capturedAt = snapshot.captured_at ? new Date(snapshot.captured_at).getTime() : NaN;
  if (!Number.isFinite(capturedAt)) return rows.at(-1)?.play_data || {};

  let best = null;
  for (const row of rows) {
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : NaN;
    if (!Number.isFinite(createdAt) || createdAt > capturedAt) break;
    best = row;
  }

  return best?.play_data || rows.at(-1)?.play_data || {};
}

function buildMatchFolds(rows, foldCount = 5) {
  const orderedMatchIds = [...new Set(rows.map((row) => row.matchId))].sort((a, b) => {
    const left = rows.find((row) => row.matchId === a)?.startTime || '';
    const right = rows.find((row) => row.matchId === b)?.startTime || '';
    return left.localeCompare(right);
  });

  const effectiveFoldCount = orderedMatchIds.length > 1 ? Math.max(2, Math.min(foldCount, orderedMatchIds.length)) : 1;
  const foldSize = Math.max(1, Math.ceil(orderedMatchIds.length / effectiveFoldCount));
  const folds = [];

  for (let i = 0; i < effectiveFoldCount; i += 1) {
    const start = i * foldSize;
    const end = Math.min(start + foldSize, orderedMatchIds.length);
    const chunk = orderedMatchIds.slice(start, end);
    if (chunk.length) folds.push(new Set(chunk));
  }

  return {
    orderedMatchIds,
    folds,
    method: 'chronological_blocked_kfold',
    foldSize,
    foldCount: folds.length,
  };
}

function evaluateCrossValidated(rows, familyKeyFn, folds) {
  const scored = [];

  for (const foldMatches of folds) {
    const trainRows = rows.filter((row) => !foldMatches.has(row.matchId));
    const testRows = rows.filter((row) => foldMatches.has(row.matchId));
    if (!trainRows.length || !testRows.length) continue;

    const predictor = makePredictor(trainRows, familyKeyFn);
    scored.push(...scoreRows(testRows, predictor));
  }

  return {
    metrics: summarizeScoredRows(scored),
    scoredRows: scored,
  };
}

function makeReferenceResidualPredictor(trainRows, referenceSelector, familyKeyFn) {
  const usableRows = trainRows.filter((row) => Number.isFinite(referenceSelector(row)));
  const globalMean = mean(usableRows.map((row) => row.outcome - referenceSelector(row))) ?? 0;
  const baselineStats = buildNumericStats(usableRows, baselineKey, (row) => row.outcome - referenceSelector(row));
  const familyStats = buildNumericStats(
    usableRows,
    (row) => (familyKeyFn ? familyKeyFn(row) : null),
    (row) => row.outcome - referenceSelector(row),
  );

  return (row) => {
    const referenceProb = referenceSelector(row);
    if (!Number.isFinite(referenceProb)) return null;
    const baseResidual = smoothedAverage(baselineStats.get(baselineKey(row)), globalMean);
    if (!familyKeyFn) return clampProbability(referenceProb + baseResidual);

    const familyKey = familyKeyFn(row);
    if (!familyKey) return clampProbability(referenceProb + baseResidual);

    const familyResidualStat = familyStats.get(familyKey);
    if (!familyResidualStat || familyResidualStat.n < 4) return clampProbability(referenceProb + baseResidual);

    const familyResidual = smoothedAverage(familyResidualStat, globalMean, 6);
    return clampProbability(referenceProb + baseResidual + (familyResidual - globalMean));
  };
}

function summarizeReferenceResidualRows(scored) {
  const residualRows = scored.filter(
    (row) => Number.isFinite(row.predictedResidual) && Number.isFinite(row.actualResidual) && row.predictedResidual !== 0 && row.actualResidual !== 0,
  );
  const rankedRows = [...residualRows].sort((a, b) => Math.abs(b.predictedResidual) - Math.abs(a.predictedResidual));
  const topCount = Math.max(1, Math.floor(rankedRows.length * 0.1));
  const topRows = rankedRows.slice(0, topCount);

  return {
    referenceBrier: mean(scored.map((row) => (row.referenceProb - row.outcome) ** 2)),
    adjustedBrier: mean(scored.map((row) => (row.adjustedProb - row.outcome) ** 2)),
    residualMae: mean(scored.map((row) => Math.abs(row.predictedResidual - row.actualResidual))),
    residualRmse: Math.sqrt(mean(scored.map((row) => (row.predictedResidual - row.actualResidual) ** 2)) ?? 0),
    signAccuracy: mean(residualRows.map((row) => Number(Math.sign(row.predictedResidual) === Math.sign(row.actualResidual)))),
    topDecileSignAccuracy: mean(topRows.map((row) => Number(Math.sign(row.predictedResidual) === Math.sign(row.actualResidual)))),
    topDecileAlignment: mean(topRows.map((row) => row.predictedResidual * row.actualResidual)),
    topDecileCount: topRows.length,
  };
}

function evaluateReferenceResidualCrossValidated(rows, referenceSelector, familyKeyFn, folds) {
  const referenceRows = rows.filter((row) => Number.isFinite(referenceSelector(row)));
  const scored = [];

  for (const foldMatches of folds) {
    const trainRows = referenceRows.filter((row) => !foldMatches.has(row.matchId));
    const testRows = referenceRows.filter((row) => foldMatches.has(row.matchId));
    if (!trainRows.length || !testRows.length) continue;

    const predictor = makeReferenceResidualPredictor(trainRows, referenceSelector, familyKeyFn);
    for (const row of testRows) {
      const adjustedProb = predictor(row);
      const referenceProb = referenceSelector(row);
      scored.push({
        ...row,
        referenceProb,
        adjustedProb,
        predictedResidual: adjustedProb - referenceProb,
        actualResidual: row.outcome - referenceProb,
      });
    }
  }

  return {
    metrics: summarizeReferenceResidualRows(scored),
    scoredRows: scored,
  };
}

function makeReferenceNumericResidualPredictor(trainRows, actualSelector, referenceSelector, familyKeyFn) {
  const usableRows = trainRows.filter((row) => Number.isFinite(actualSelector(row)) && Number.isFinite(referenceSelector(row)));
  const globalMean = mean(usableRows.map((row) => actualSelector(row) - referenceSelector(row))) ?? 0;
  const baselineStats = buildNumericStats(usableRows, baselineKey, (row) => actualSelector(row) - referenceSelector(row));
  const familyStats = buildNumericStats(
    usableRows,
    (row) => (familyKeyFn ? familyKeyFn(row) : null),
    (row) => actualSelector(row) - referenceSelector(row),
  );

  return (row) => {
    const referenceValue = referenceSelector(row);
    if (!Number.isFinite(referenceValue)) return null;
    const baseResidual = smoothedAverage(baselineStats.get(baselineKey(row)), globalMean);
    if (!familyKeyFn) return referenceValue + baseResidual;

    const familyKey = familyKeyFn(row);
    if (!familyKey) return referenceValue + baseResidual;

    const familyResidualStat = familyStats.get(familyKey);
    if (!familyResidualStat || familyResidualStat.n < 4) return referenceValue + baseResidual;

    const familyResidual = smoothedAverage(familyResidualStat, globalMean, 6);
    return referenceValue + baseResidual + (familyResidual - globalMean);
  };
}

function summarizeNumericResidualRows(scored) {
  const residualRows = scored.filter(
    (row) => Number.isFinite(row.predictedResidual) && Number.isFinite(row.actualResidual) && row.predictedResidual !== 0 && row.actualResidual !== 0,
  );
  const rankedRows = [...residualRows].sort((a, b) => Math.abs(b.predictedResidual) - Math.abs(a.predictedResidual));
  const topCount = Math.max(1, Math.floor(rankedRows.length * 0.1));
  const topRows = rankedRows.slice(0, topCount);

  return {
    referenceMae: mean(scored.map((row) => Math.abs(row.referenceValue - row.actualValue))),
    adjustedMae: mean(scored.map((row) => Math.abs(row.adjustedValue - row.actualValue))),
    referenceRmse: Math.sqrt(mean(scored.map((row) => (row.referenceValue - row.actualValue) ** 2)) ?? 0),
    adjustedRmse: Math.sqrt(mean(scored.map((row) => (row.adjustedValue - row.actualValue) ** 2)) ?? 0),
    residualMae: mean(scored.map((row) => Math.abs(row.predictedResidual - row.actualResidual))),
    residualRmse: Math.sqrt(mean(scored.map((row) => (row.predictedResidual - row.actualResidual) ** 2)) ?? 0),
    signAccuracy: mean(residualRows.map((row) => Number(Math.sign(row.predictedResidual) === Math.sign(row.actualResidual)))),
    topDecileSignAccuracy: mean(topRows.map((row) => Number(Math.sign(row.predictedResidual) === Math.sign(row.actualResidual)))),
    topDecileAlignment: mean(topRows.map((row) => row.predictedResidual * row.actualResidual)),
    topDecileCount: topRows.length,
  };
}

function evaluateNumericResidualCrossValidated(rows, actualSelector, referenceSelector, familyKeyFn, folds) {
  const referenceRows = rows.filter((row) => Number.isFinite(actualSelector(row)) && Number.isFinite(referenceSelector(row)));
  const scored = [];

  for (const foldMatches of folds) {
    const trainRows = referenceRows.filter((row) => !foldMatches.has(row.matchId));
    const testRows = referenceRows.filter((row) => foldMatches.has(row.matchId));
    if (!trainRows.length || !testRows.length) continue;

    const predictor = makeReferenceNumericResidualPredictor(trainRows, actualSelector, referenceSelector, familyKeyFn);
    for (const row of testRows) {
      const adjustedValue = predictor(row);
      const referenceValue = referenceSelector(row);
      const actualValue = actualSelector(row);
      if (!Number.isFinite(adjustedValue) || !Number.isFinite(referenceValue) || !Number.isFinite(actualValue)) continue;
      scored.push({
        ...row,
        referenceValue,
        adjustedValue,
        predictedResidual: adjustedValue - referenceValue,
        actualResidual: actualValue - referenceValue,
        actualValue,
      });
    }
  }

  return {
    metrics: summarizeNumericResidualRows(scored),
    scoredRows: scored,
  };
}

async function main() {
  const env = loadEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const supabaseKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Loading NBA snapshots from ${START} to ${END}`);
  const snapshots = await fetchAllPages(() =>
    supabase
      .from('live_context_snapshots')
      .select('id,match_id,league_id,sport,captured_at,period,clock,home_score,away_score,odds_current,situation,recent_plays,stats,advanced_metrics,predictor')
      .eq('league_id', 'nba')
      .gte('period', 1)
      .not('clock', 'is', null)
      .gte('captured_at', START)
      .lt('captured_at', END)
      .order('captured_at', { ascending: true }),
  );

  const matchIds = [...new Set(snapshots.map((row) => row.match_id))];
  console.log(`Snapshots: ${snapshots.length}, matches: ${matchIds.length}`);

  const matches = await fetchByBatches(matchIds, 200, async (batch) => {
    const { data, error } = await supabase
      .from('matches')
      .select('id,start_time,status,home_score,away_score,home_team,away_team,home_team_id,away_team_id,opening_odds')
      .in('id', batch);
    if (error) throw error;
    return data || [];
  });

  const liveStates = await fetchByBatches(matchIds, 200, async (batch) => {
    const { data, error } = await supabase
      .from('live_game_state')
      .select('id,odds')
      .in('id', batch);
    if (error) throw error;
    return data || [];
  });

  const officials = await fetchByBatches(matchIds, 200, async (batch) => {
    const { data, error } = await supabase
      .from('game_officials')
      .select('match_id,official_name')
      .eq('league_id', 'nba')
      .in('match_id', batch);
    if (error) throw error;
    return data || [];
  });

  const postgames = await fetchByBatches(matchIds, 200, async (batch) => {
    const { data, error } = await supabase
      .from('nba_postgame')
      .select('id,start_time,home_score,away_score')
      .in('id', batch);
    if (error) throw error;
    return data || [];
  });

  const bpiRows = await fetchByBatches(matchIds, 20, async (batch, idx) => {
    const { data, error } = await supabase
      .from('game_events')
      .select('match_id,period,clock,created_at,play_data')
      .eq('event_type', 'bpi_probability')
      .in('match_id', batch)
      .order('created_at', { ascending: true })
      .range(0, 20000);
    if (error) throw error;
    if ((idx + 1) % 10 === 0) console.log(`Fetched BPI batch ${idx + 1}`);
    return data || [];
  });

  const matchMap = new Map(matches.map((row) => [row.id, row]));
  const liveStateMap = new Map(liveStates.map((row) => [row.id, row]));
  const postgameMap = new Map(
    postgames.map((row) => [
      row.id,
      {
        startTime: row.start_time,
        homeScore: Number(row.home_score),
        awayScore: Number(row.away_score),
        margin: Number(row.home_score) - Number(row.away_score),
        total: Number(row.home_score) + Number(row.away_score),
        outcome: Number(row.home_score) > Number(row.away_score) ? 1 : 0,
      },
    ]),
  );

  for (const row of matches) {
    if (postgameMap.has(row.id)) continue;
    if (!String(row.status || '').includes('FINAL')) continue;
    if (row.home_score == null || row.away_score == null) continue;
    postgameMap.set(row.id, {
      startTime: row.start_time,
      homeScore: Number(row.home_score),
      awayScore: Number(row.away_score),
      margin: Number(row.home_score) - Number(row.away_score),
      total: Number(row.home_score) + Number(row.away_score),
      outcome: Number(row.home_score) > Number(row.away_score) ? 1 : 0,
    });
  }

  const officialMap = new Map();
  for (const row of officials) {
    const current = officialMap.get(row.match_id) || [];
    current.push(row.official_name);
    officialMap.set(row.match_id, current);
  }

  const bpiByMatch = buildBpiLookupRows(bpiRows);

  const enrichedRows = [];
  for (const snapshot of snapshots) {
    const match = matchMap.get(snapshot.match_id);
    const postgame = postgameMap.get(snapshot.match_id);
    if (!match || !postgame) continue;

    const remainingMinutes = nbaRemainingMinutes(snapshot.period, snapshot.clock);
    const clockSeconds = parseClockSeconds(snapshot.clock);
    if (!Number.isFinite(remainingMinutes) || !Number.isFinite(clockSeconds) || Number(snapshot.period) <= 0) continue;

    const liveState = liveStateMap.get(snapshot.match_id);
    const bpi = findBestBpiRow(bpiByMatch.get(snapshot.match_id), snapshot);
    const situation = snapshot.situation || {};
    const stats = Array.isArray(snapshot.stats) ? snapshot.stats : [];
    const oddsCurrent = snapshot.odds_current || {};
    const t0Odds = liveState?.odds?.t0_snapshot?.odds || {};
    const possession = parseRecentPossession(snapshot.recent_plays, match.home_team_id, match.away_team_id);
    const crew = (officialMap.get(snapshot.match_id) || []).sort();

    const liveHomeMl = safeNumber(oddsCurrent.homeML ?? oddsCurrent.home_ml);
    const liveAwayMl = safeNumber(oddsCurrent.awayML ?? oddsCurrent.away_ml);
    const liveDevig = devigHomeProbability(liveHomeMl, liveAwayMl);
    const paceHome = safeNumber(snapshot.advanced_metrics?.core_api_efficiency?.home?.pace);
    const paceAway = safeNumber(snapshot.advanced_metrics?.core_api_efficiency?.away?.pace);
    const paceParts = [paceHome, paceAway].filter((value) => Number.isFinite(value));
    const paceLive = paceParts.length ? paceParts.reduce((sum, value) => sum + value, 0) / paceParts.length : null;
    const remainingPossessions = Number.isFinite(paceLive) ? (paceLive * remainingMinutes) / 48 : null;
    const elapsedMinutes = nbaElapsedMinutes(snapshot.period, snapshot.clock);

    const pregameHomeWp = normalizeProbability(bpi.bpiPregameWinPct ?? snapshot.predictor?.homeTeamChance);
    const currentBpiHomeWp = normalizeProbability(bpi.homeWinPct);
    const currentBpiHomeSpread = safeNumber(
      bpi.homeSpread ?? bpi.homeTeamSpread ?? bpi.spreadHome ?? bpi.spread ?? bpi.projectedSpread,
    );
    const currentBpiTotal = safeNumber(
      bpi.total ?? bpi.totalPoints ?? bpi.projectedTotal ?? bpi.overUnder ?? bpi.projectedPoints,
    );
    const marketHomeSpread = safeNumber(
      oddsCurrent.homeSpread ?? oddsCurrent.home_spread ?? oddsCurrent.spread ?? oddsCurrent.line,
    );
    const marketLiveTotal = safeNumber(
      oddsCurrent.total ?? oddsCurrent.total_value ?? oddsCurrent.overUnder ?? oddsCurrent.liveTotal,
    );
    const openingHomeMl = safeNumber(match.opening_odds?.homeWin ?? match.opening_odds?.home_ml);
    const openingAwayMl = safeNumber(match.opening_odds?.awayWin ?? match.opening_odds?.away_ml);
    const openingHomeDevigProb = devigHomeProbability(openingHomeMl, openingAwayMl);
    const openingTotal = safeNumber(match.opening_odds?.total ?? match.opening_odds?.overUnder);
    const openingSpreadAbs = parseSpreadMagnitude(match.opening_odds?.spread ?? match.opening_odds?.homeSpread ?? match.opening_odds?.awaySpread);
    const pregameAnchorHomeProb = openingHomeDevigProb ?? pregameHomeWp;
    const pregameFavoriteSide = Number.isFinite(pregameAnchorHomeProb) ? (pregameAnchorHomeProb >= 0.5 ? 'HOME' : 'AWAY') : null;
    const pregameFavoriteProb = Number.isFinite(pregameAnchorHomeProb)
      ? Math.max(pregameAnchorHomeProb, 1 - pregameAnchorHomeProb)
      : null;
    const pregameTotalAnchor = openingTotal ?? safeNumber(t0Odds.total ?? t0Odds.total_value ?? t0Odds.overUnder);
    const pregameModelMarketDelta =
      Number.isFinite(pregameHomeWp) && Number.isFinite(openingHomeDevigProb) ? pregameHomeWp - openingHomeDevigProb : null;

    const homeOffensiveRebounds = statValue(stats, 'Offensive Rebounds', 'home');
    const awayOffensiveRebounds = statValue(stats, 'Offensive Rebounds', 'away');
    const homeTotalTurnovers = statValueAny(stats, ['Total Turnovers', 'Turnovers', 'Team Turnovers'], 'home');
    const awayTotalTurnovers = statValueAny(stats, ['Total Turnovers', 'Turnovers', 'Team Turnovers'], 'away');
    const homeThreeRate = (() => {
      const attempts = statPairPiece(stats, 'FG', 'home', 2);
      const threes = statPairPiece(stats, '3PT', 'home', 2);
      return Number.isFinite(attempts) && attempts > 0 && Number.isFinite(threes) ? threes / attempts : null;
    })();
    const awayThreeRate = (() => {
      const attempts = statPairPiece(stats, 'FG', 'away', 2);
      const threes = statPairPiece(stats, '3PT', 'away', 2);
      return Number.isFinite(attempts) && attempts > 0 && Number.isFinite(threes) ? threes / attempts : null;
    })();
    const homeFreeThrowRate = (() => {
      const attempts = statPairPiece(stats, 'FG', 'home', 2);
      const fta = statPairPiece(stats, 'FT', 'home', 2);
      return Number.isFinite(attempts) && attempts > 0 && Number.isFinite(fta) ? fta / attempts : null;
    })();
    const awayFreeThrowRate = (() => {
      const attempts = statPairPiece(stats, 'FG', 'away', 2);
      const fta = statPairPiece(stats, 'FT', 'away', 2);
      return Number.isFinite(attempts) && attempts > 0 && Number.isFinite(fta) ? fta / attempts : null;
    })();
    const homePaintShare = (() => {
      const pip = statValue(stats, 'Points in Paint', 'home');
      return Number.isFinite(pip) && Number(snapshot.home_score) > 0 ? pip / Number(snapshot.home_score) : null;
    })();
    const awayPaintShare = (() => {
      const pip = statValue(stats, 'Points in Paint', 'away');
      return Number.isFinite(pip) && Number(snapshot.away_score) > 0 ? pip / Number(snapshot.away_score) : null;
    })();
    const homeFgAttempts = statPairPiece(stats, 'FG', 'home', 2);
    const awayFgAttempts = statPairPiece(stats, 'FG', 'away', 2);
    const homeFtAttempts = statPairPiece(stats, 'FT', 'home', 2);
    const awayFtAttempts = statPairPiece(stats, 'FT', 'away', 2);
    const homeObservedPossessions = [homeFgAttempts, homeFtAttempts, homeOffensiveRebounds, homeTotalTurnovers].every(Number.isFinite)
      ? homeFgAttempts + 0.44 * homeFtAttempts - homeOffensiveRebounds + homeTotalTurnovers
      : null;
    const awayObservedPossessions = [awayFgAttempts, awayFtAttempts, awayOffensiveRebounds, awayTotalTurnovers].every(Number.isFinite)
      ? awayFgAttempts + 0.44 * awayFtAttempts - awayOffensiveRebounds + awayTotalTurnovers
      : null;
    const observedPossessionParts = [homeObservedPossessions, awayObservedPossessions].filter((value) => Number.isFinite(value));
    const observedPossessions = observedPossessionParts.length
      ? observedPossessionParts.reduce((sum, value) => sum + value, 0) / observedPossessionParts.length
      : null;
    const observedPace48 = Number.isFinite(observedPossessions) && Number.isFinite(elapsedMinutes) && elapsedMinutes > 0
      ? (observedPossessions / elapsedMinutes) * 48
      : null;

    const intentionalFoulLikelihoodClass = deriveIntentionalFoulLikelihood({
      period: snapshot.period,
      remainingMinutes,
      scoreDiff: Number(snapshot.home_score ?? 0) - Number(snapshot.away_score ?? 0),
      trailingSide:
        Number(snapshot.home_score ?? 0) > Number(snapshot.away_score ?? 0)
          ? 'AWAY'
          : Number(snapshot.home_score ?? 0) < Number(snapshot.away_score ?? 0)
            ? 'HOME'
            : null,
      homeFoulsToGive: safeNumber(situation.homeFoulsToGive),
      awayFoulsToGive: safeNumber(situation.awayFoulsToGive),
      homeTimeouts: safeNumber(situation.homeTimeouts),
      awayTimeouts: safeNumber(situation.awayTimeouts),
    });

    const gameScriptClass = deriveGameScriptClass({
      period: snapshot.period,
      remainingMinutes,
      scoreDiff: Number(snapshot.home_score ?? 0) - Number(snapshot.away_score ?? 0),
      possessionSide: possession.side,
      trailingSide:
        Number(snapshot.home_score ?? 0) > Number(snapshot.away_score ?? 0)
          ? 'AWAY'
          : Number(snapshot.home_score ?? 0) < Number(snapshot.away_score ?? 0)
            ? 'HOME'
            : null,
      homeBonusState: situation.homeBonusState || null,
      awayBonusState: situation.awayBonusState || null,
      intentionalFoulLikelihoodClass,
      homeTimeouts: safeNumber(situation.homeTimeouts),
      awayTimeouts: safeNumber(situation.awayTimeouts),
    });

    const paceBlendWeight = Number.isFinite(elapsedMinutes) ? clamp(elapsedMinutes / 36, 0.2, 0.8) : 0.35;
    const blendedPace48 =
      Number.isFinite(observedPace48) && Number.isFinite(paceLive)
        ? observedPace48 * paceBlendWeight + paceLive * (1 - paceBlendWeight)
        : Number.isFinite(observedPace48)
          ? observedPace48
          : paceLive;
    const gameScriptMultiplier =
      intentionalFoulLikelihoodClass === 'HIGH'
        ? 1.18
        : intentionalFoulLikelihoodClass === 'MEDIUM'
          ? 1.1
          : intentionalFoulLikelihoodClass === 'LOW'
            ? 1.04
            : gameScriptClass === 'DOUBLE_BONUS_ACCELERATION'
              ? 1.06
              : gameScriptClass === 'LAST_SHOT' || gameScriptClass === 'CLOCK_BURN' || gameScriptClass === 'LEADER_CONTROL'
                ? 0.9
                : 1;
    const remainingPossessionsV2 = Number.isFinite(blendedPace48)
      ? (blendedPace48 * remainingMinutes * gameScriptMultiplier) / 48
      : null;
    const remainingPossessionsDelta =
      Number.isFinite(remainingPossessionsV2) && Number.isFinite(remainingPossessions)
        ? remainingPossessionsV2 - remainingPossessions
        : null;

    enrichedRows.push({
      matchId: snapshot.match_id,
      startTime: postgame.startTime,
      finalHomeScore: postgame.homeScore,
      finalAwayScore: postgame.awayScore,
      finalMargin: postgame.margin,
      finalTotal: postgame.total,
      outcome: postgame.outcome,
      period: Number(snapshot.period),
      minuteBucket: Math.floor(clockSeconds / 60),
      scoreDiff: Number(snapshot.home_score ?? 0) - Number(snapshot.away_score ?? 0),
      pregameHomeWp,
      currentBpiHomeWp,
      currentBpiHomeSpread,
      currentBpiTotal,
      marketDevigHomeProb: liveDevig,
      marketHomeSpread,
      marketLiveTotal,
      blendedHomeProb: blendReferences(currentBpiHomeWp, liveDevig),
      blendedHomeSpread: blendReferences(currentBpiHomeSpread, marketHomeSpread),
      blendedTotal: blendReferences(currentBpiTotal, marketLiveTotal),
      pregameAnchorHomeProb,
      pregameFavoriteSide,
      pregameFavoriteProb,
      pregameModelMarketDelta,
      pregameTotalAnchor,
      openingSpreadAbs,
      possessionSide: possession.side,
      possessionConfidence: possession.confidence,
      homeBonusState: situation.homeBonusState || null,
      awayBonusState: situation.awayBonusState || null,
      homeFoulsToGive: safeNumber(situation.homeFoulsToGive),
      awayFoulsToGive: safeNumber(situation.awayFoulsToGive),
      homeTimeouts: safeNumber(situation.homeTimeouts),
      awayTimeouts: safeNumber(situation.awayTimeouts),
      paceLive,
      observedPace48,
      remainingPossessions,
      remainingPossessionsV2,
      remainingPossessionsDelta,
      gameScriptClass,
      intentionalFoulLikelihoodClass,
      foulExtensionFlag:
        Number(snapshot.period) === 4 &&
        remainingMinutes <= 2.5 &&
        Math.abs(Number(snapshot.home_score ?? 0) - Number(snapshot.away_score ?? 0)) >= 3 &&
        Math.abs(Number(snapshot.home_score ?? 0) - Number(snapshot.away_score ?? 0)) <= 10 &&
        (
          (Number(snapshot.home_score ?? 0) < Number(snapshot.away_score ?? 0) && (safeNumber(situation.homeFoulsToGive) ?? 0) === 0) ||
          (Number(snapshot.home_score ?? 0) > Number(snapshot.away_score ?? 0) && (safeNumber(situation.awayFoulsToGive) ?? 0) === 0)
        ),
      homeThreeRate,
      awayThreeRate,
      homeFreeThrowRate,
      awayFreeThrowRate,
      homePaintShare,
      awayPaintShare,
      officialCrewKey: crew.length ? crew.join(' | ') : null,
      liveHomeMl,
      liveAwayMl,
      openingTotal,
      t0Total: safeNumber(t0Odds.total ?? t0Odds.total_value ?? t0Odds.overUnder),
    });
  }

  const { orderedMatchIds, folds, method: cvMethod, foldSize, foldCount } = buildMatchFolds(enrichedRows);
  const baselineResult = evaluateCrossValidated(enrichedRows, null, folds);
  const baselineMetrics = baselineResult.metrics;

  const residualSuite = {
    win: {
      bpi: evaluateReferenceResidualCrossValidated(
        enrichedRows,
        (row) => row.currentBpiHomeWp,
        null,
        folds,
      ).metrics,
      market: evaluateReferenceResidualCrossValidated(
        enrichedRows,
        (row) => row.marketDevigHomeProb,
        null,
        folds,
      ).metrics,
      blended: evaluateReferenceResidualCrossValidated(
        enrichedRows,
        (row) => row.blendedHomeProb,
        null,
        folds,
      ).metrics,
    },
    margin: {
      bpi: evaluateNumericResidualCrossValidated(
        enrichedRows,
        (row) => row.finalMargin,
        (row) => row.currentBpiHomeSpread,
        null,
        folds,
      ).metrics,
      market: evaluateNumericResidualCrossValidated(
        enrichedRows,
        (row) => row.finalMargin,
        (row) => row.marketHomeSpread,
        null,
        folds,
      ).metrics,
      blended: evaluateNumericResidualCrossValidated(
        enrichedRows,
        (row) => row.finalMargin,
        (row) => row.blendedHomeSpread,
        null,
        folds,
      ).metrics,
    },
    total: {
      bpi: evaluateNumericResidualCrossValidated(
        enrichedRows,
        (row) => row.finalTotal,
        (row) => row.currentBpiTotal,
        null,
        folds,
      ).metrics,
      market: evaluateNumericResidualCrossValidated(
        enrichedRows,
        (row) => row.finalTotal,
        (row) => row.marketLiveTotal,
        null,
        folds,
      ).metrics,
      blended: evaluateNumericResidualCrossValidated(
        enrichedRows,
        (row) => row.finalTotal,
        (row) => row.blendedTotal,
        null,
        folds,
      ).metrics,
    },
  };

  const espnReferenceRows = enrichedRows.filter((row) => Number.isFinite(row.currentBpiHomeWp));
  const espnReference = evaluateModel(espnReferenceRows, (row) => row.currentBpiHomeWp);

  let familyResults = [];
  let bpiResidualRanking = [];
  let marketResidualRanking = [];
  let cumulative = [];

  if (ENABLE_FEATURE_FAMILIES) {
    familyResults = familyDefinitions().map((family) => {
      const { metrics, scoredRows } = evaluateCrossValidated(enrichedRows, family.key, folds);
      return {
        id: family.id,
        label: family.label,
        coveragePct: mean(enrichedRows.map((row) => Number(family.key(row) != null))),
        brier: metrics.brier,
        brierLift: baselineMetrics.brier - metrics.brier,
        topDecileGapSignAccuracy: metrics.topDecileGapSignAccuracy,
        gapSignAccuracyLift: metrics.topDecileGapSignAccuracy - baselineMetrics.topDecileGapSignAccuracy,
        topDecileGapAlignment: metrics.topDecileGapAlignment,
        topDecileMeanAbsGap: metrics.topDecileMeanAbsGap,
        scoredRows: scoredRows.length,
      };
    }).sort((a, b) => (b.brierLift || 0) - (a.brierLift || 0));

    bpiResidualRanking = familyDefinitions().map((family) => {
      const { metrics, scoredRows } = evaluateReferenceResidualCrossValidated(
        enrichedRows,
        (row) => row.currentBpiHomeWp,
        family.key,
        folds,
      );
      return {
        id: family.id,
        label: family.label,
        coveragePct: mean(enrichedRows.map((row) => Number(family.key(row) != null))),
        adjustedBrier: metrics.adjustedBrier,
        brierLiftVsBaselineResidual: residualSuite.win.bpi.adjustedBrier - metrics.adjustedBrier,
        brierLiftVsRawBpi: metrics.referenceBrier - metrics.adjustedBrier,
        residualRmse: metrics.residualRmse,
        residualMae: metrics.residualMae,
        signAccuracy: metrics.signAccuracy,
        signAccuracyLift: (metrics.signAccuracy ?? 0) - (residualSuite.win.bpi.signAccuracy ?? 0),
        topDecileSignAccuracy: metrics.topDecileSignAccuracy,
        topDecileAlignment: metrics.topDecileAlignment,
        scoredRows: scoredRows.length,
      };
    }).sort((a, b) => (b.brierLiftVsBaselineResidual || 0) - (a.brierLiftVsBaselineResidual || 0));

    marketResidualRanking = familyDefinitions().map((family) => {
      const { metrics, scoredRows } = evaluateReferenceResidualCrossValidated(
        enrichedRows,
        (row) => row.marketDevigHomeProb,
        family.key,
        folds,
      );
      return {
        id: family.id,
        label: family.label,
        coveragePct: mean(enrichedRows.map((row) => Number(family.key(row) != null))),
        adjustedBrier: metrics.adjustedBrier,
        brierLiftVsBaselineResidual: residualSuite.win.market.adjustedBrier - metrics.adjustedBrier,
        brierLiftVsRawMarket: metrics.referenceBrier - metrics.adjustedBrier,
        residualRmse: metrics.residualRmse,
        residualMae: metrics.residualMae,
        signAccuracy: metrics.signAccuracy,
        signAccuracyLift: (metrics.signAccuracy ?? 0) - (residualSuite.win.market.signAccuracy ?? 0),
        topDecileSignAccuracy: metrics.topDecileSignAccuracy,
        topDecileAlignment: metrics.topDecileAlignment,
        scoredRows: scoredRows.length,
      };
    }).sort((a, b) => (b.brierLiftVsBaselineResidual || 0) - (a.brierLiftVsBaselineResidual || 0));

    cumulative = [];
    let currentFamilyKey = null;
    for (const family of familyDefinitions()) {
      const previousKey = currentFamilyKey;
      currentFamilyKey = previousKey
        ? (row) => {
            const left = previousKey(row);
            const right = family.key(row);
            if (!left && !right) return null;
            return `${left || 'na'}|${right || 'na'}`;
          }
        : family.key;
      const { metrics } = evaluateCrossValidated(enrichedRows, currentFamilyKey, folds);
      cumulative.push({
        id: family.id,
        label: family.label,
        brier: metrics.brier,
        brierLiftVsBaseline: baselineMetrics.brier - metrics.brier,
        topDecileGapSignAccuracy: metrics.topDecileGapSignAccuracy,
        gapSignAccuracyLiftVsBaseline: metrics.topDecileGapSignAccuracy - baselineMetrics.topDecileGapSignAccuracy,
      });
    }
  }

  const result = {
    window: { start: START, end: END },
    coverage: {
      snapshots: snapshots.length,
      enrichedRows: enrichedRows.length,
      uniqueMatches: orderedMatchIds.length,
      folds: folds.length,
      cvMethod,
      foldSize,
      foldCount,
      marketRows: enrichedRows.filter((row) => Number.isFinite(row.marketDevigHomeProb)).length,
      bpiRows: enrichedRows.filter((row) => Number.isFinite(row.currentBpiHomeWp)).length,
      possessionCoveragePct: mean(enrichedRows.map((row) => (row.possessionSide ? 1 : 0))),
    },
    baseline: baselineMetrics,
    residualSuite,
    espnCurrentBpiReference: espnReference,
    featureFamiliesEnabled: ENABLE_FEATURE_FAMILIES,
    familyRanking: familyResults,
    bpiResidualRanking,
    marketResidualRanking,
    cumulativePath: cumulative,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
