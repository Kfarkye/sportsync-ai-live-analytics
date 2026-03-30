import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://qffzvrnbzabcokqqrwbv.supabase.co';

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function isFinalStatus(status) {
  const s = String(status ?? '').toUpperCase();
  return s.includes('FINAL') || s.includes('COMPLETE');
}

function keyOf(teamName, venue) {
  return `${teamName}__${venue}`;
}

function normalizeNumeric(value) {
  if (value == null) return null;
  return Number(value);
}

function normalizeString(value) {
  if (value == null) return null;
  return String(value);
}

function matchesExpected(expected, actual, normalizeFn) {
  if (expected == null) return true;
  return normalizeFn(actual) === normalizeFn(expected);
}

async function fetchAllMatchIdsFromBase(supabase) {
  const pageSize = 1000;
  let from = 0;
  const ids = new Set();

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('mv_nba_team_venue_game_lines')
      .select('match_id')
      .range(from, to);

    if (error) {
      throw new Error(`Failed reading mv_nba_team_venue_game_lines: ${error.message}`);
    }

    if (!data || data.length === 0) break;
    for (const row of data) {
      ids.add(row.match_id);
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return Array.from(ids);
}

async function fetchMatchStatuses(supabase, matchIds) {
  const chunkSize = 200;
  const rows = [];

  for (let i = 0; i < matchIds.length; i += chunkSize) {
    const chunk = matchIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('matches')
      .select('id,status')
      .in('id', chunk);

    if (error) {
      throw new Error(`Failed reading matches status: ${error.message}`);
    }

    if (data?.length) rows.push(...data);
  }

  return rows;
}

async function main() {
  loadEnvFromFile('.env.local');
  loadEnvFromFile('.env');

  const supabaseUrl =
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!serviceRoleKey) {
    console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
    console.error('Set SUPABASE_SERVICE_ROLE_KEY and re-run this check.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`🔌 NBA structural assertion against ${supabaseUrl}`);

  // 1) Contamination guard
  const baseMatchIds = await fetchAllMatchIdsFromBase(supabase);
  const matchStatuses = await fetchMatchStatuses(supabase, baseMatchIds);
  const nonFinalRowsInBase = matchStatuses.filter((row) => !isFinalStatus(row.status)).length;

  // 2) Snapshot assertion (final-status-gated baseline)
  const expectedTotals = [
    { team_name: 'Utah Jazz', venue: 'HOME', over_record: '28-12', over_rate: 70.0, under_rate: null, avg_vs_close: 10.3 },
    { team_name: 'Phoenix Suns', venue: 'HOME', over_record: '13-27', over_rate: 32.5, under_rate: 67.5, avg_vs_close: -5.4 },
    { team_name: 'Minnesota Timberwolves', venue: 'HOME', over_record: '13-26', over_rate: 33.3, under_rate: 66.7, avg_vs_close: -4.9 },
    { team_name: 'Portland Trail Blazers', venue: 'HOME', over_record: '25-13', over_rate: 65.8, under_rate: null, avg_vs_close: 4.1 },
    { team_name: 'Golden State Warriors', venue: 'HOME', over_record: '23-15', over_rate: 60.5, under_rate: null, avg_vs_close: 4.8 },
    { team_name: 'Los Angeles Lakers', venue: 'HOME', over_record: '23-15', over_rate: 60.5, under_rate: null, avg_vs_close: 1.8 },
  ];

  const expectedAts = [
    { team_name: 'Boston Celtics', venue: 'AWAY', ats_record: '24-14', ats_cover_rate: 63.2 },
    { team_name: 'Minnesota Timberwolves', venue: 'AWAY', ats_record: '15-23', ats_cover_rate: 39.5 },
    { team_name: 'New York Knicks', venue: 'HOME', ats_record: '25-15', ats_cover_rate: 62.5 },
  ];

  const totalsTeamNames = [...new Set(expectedTotals.map((row) => row.team_name))];
  const atsTeamNames = [...new Set(expectedAts.map((row) => row.team_name))];

  const [{ data: totalsRows, error: totalsErr }, { data: atsRows, error: atsErr }] = await Promise.all([
    supabase
      .from('mv_nba_team_venue_totals_trends')
      .select('team_name,venue,over_record,over_rate,under_rate,avg_vs_close')
      .in('team_name', totalsTeamNames),
    supabase
      .from('mv_nba_team_venue_ats_trends')
      .select('team_name,venue,ats_record,ats_cover_rate')
      .in('team_name', atsTeamNames),
  ]);

  if (totalsErr) {
    throw new Error(`Failed reading totals trends MV: ${totalsErr.message}`);
  }

  if (atsErr) {
    throw new Error(`Failed reading ATS trends MV: ${atsErr.message}`);
  }

  const totalsByKey = new Map();
  for (const row of totalsRows ?? []) {
    totalsByKey.set(keyOf(row.team_name, row.venue), row);
  }

  const atsByKey = new Map();
  for (const row of atsRows ?? []) {
    atsByKey.set(keyOf(row.team_name, row.venue), row);
  }

  const mismatches = [];

  for (const exp of expectedTotals) {
    const actual = totalsByKey.get(keyOf(exp.team_name, exp.venue));
    if (!actual) {
      mismatches.push({ metric_type: 'totals', team_name: exp.team_name, venue: exp.venue, reason: 'missing row' });
      continue;
    }

    const checks = [
      matchesExpected(exp.over_record, actual.over_record, normalizeString),
      matchesExpected(exp.over_rate, actual.over_rate, normalizeNumeric),
      matchesExpected(exp.under_rate, actual.under_rate, normalizeNumeric),
      matchesExpected(exp.avg_vs_close, actual.avg_vs_close, normalizeNumeric),
    ];

    if (checks.some((v) => !v)) {
      mismatches.push({
        metric_type: 'totals',
        team_name: exp.team_name,
        venue: exp.venue,
        expected: exp,
        actual: {
          over_record: actual.over_record,
          over_rate: normalizeNumeric(actual.over_rate),
          under_rate: normalizeNumeric(actual.under_rate),
          avg_vs_close: normalizeNumeric(actual.avg_vs_close),
        },
      });
    }
  }

  for (const exp of expectedAts) {
    const actual = atsByKey.get(keyOf(exp.team_name, exp.venue));
    if (!actual) {
      mismatches.push({ metric_type: 'ats', team_name: exp.team_name, venue: exp.venue, reason: 'missing row' });
      continue;
    }

    const checks = [
      matchesExpected(exp.ats_record, actual.ats_record, normalizeString),
      matchesExpected(exp.ats_cover_rate, actual.ats_cover_rate, normalizeNumeric),
    ];

    if (checks.some((v) => !v)) {
      mismatches.push({
        metric_type: 'ats',
        team_name: exp.team_name,
        venue: exp.venue,
        expected: exp,
        actual: {
          ats_record: actual.ats_record,
          ats_cover_rate: normalizeNumeric(actual.ats_cover_rate),
        },
      });
    }
  }

  const checkedRows = expectedTotals.length + expectedAts.length;
  const failedRows = mismatches.length;
  const passedRows = checkedRows - failedRows;
  const allPass = nonFinalRowsInBase === 0 && failedRows === 0;

  console.log(`🧪 contamination_guard non_final_rows_in_base=${nonFinalRowsInBase}`);
  console.log(`🧪 snapshot_assertion checked_rows=${checkedRows} passed_rows=${passedRows} failed_rows=${failedRows} all_pass=${failedRows === 0}`);

  if (mismatches.length > 0) {
    console.error('❌ Snapshot mismatches detected:');
    for (const mismatch of mismatches) {
      console.error(`  - ${mismatch.metric_type} ${mismatch.team_name} ${mismatch.venue}: ${JSON.stringify(mismatch)}`);
    }
  }

  if (!allPass) {
    console.error('❌ NBA structural baseline assertion failed.');
    process.exit(1);
  }

  console.log('✅ NBA structural baseline assertion passed.');
}

main().catch((error) => {
  console.error(`❌ NBA structural baseline assertion errored: ${error.message}`);
  process.exit(1);
});
