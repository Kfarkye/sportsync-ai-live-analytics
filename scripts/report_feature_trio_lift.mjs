import { spawnSync } from 'child_process';
import path from 'path';
import process from 'process';

const TRIO_IDS = new Set([
  'pregame_anchor_v2',
  'remaining_possessions_v2',
  'game_script_class',
]);

function extractJsonPayload(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().startsWith('{'));
  if (start === -1) {
    throw new Error('Runner output did not contain a JSON payload.');
  }
  const jsonText = lines.slice(start).join('\n').trim();
  return JSON.parse(jsonText);
}

function filterTrio(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => TRIO_IDS.has(String(row?.id || '')));
}

function main() {
  const cwd = process.cwd();
  const runnerPath = path.join(cwd, 'scripts', 'analyze_live_state_enriched.mjs');

  const run = spawnSync(process.execPath, [runnerPath], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      ENABLE_FEATURE_FAMILIES: '1',
    },
  });

  if (run.status !== 0) {
    const detail = [run.stdout, run.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`Runner failed with status ${run.status}\n${detail}`);
  }

  const payload = extractJsonPayload(run.stdout);

  const report = {
    generatedAt: new Date().toISOString(),
    window: payload.window,
    coverage: payload.coverage,
    baseline: payload.baseline,
    residualSuite: payload.residualSuite,
    trioLift: {
      familyRanking: filterTrio(payload.familyRanking),
      bpiResidualRanking: filterTrio(payload.bpiResidualRanking),
      marketResidualRanking: filterTrio(payload.marketResidualRanking),
      cumulativePath: filterTrio(payload.cumulativePath),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
