import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');

const sharedRoot = path.join(root, 'packages', 'shared', 'src');
const supaRoot = path.join(root, 'supabase', 'functions', '_shared');

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assertEqual(label, a, b) {
  if (a !== b) {
    throw new Error(`SSOT mismatch: ${label}`);
  }
}

function checkSharedPairs() {
  const sharedFiles = [
    'gates.ts',
    'oddsUtils.ts',
    'espnAdapters.ts',
    'espnService.ts',
    'match-registry.ts',
    'debug.ts',
    'resilience.ts',
    'constants.ts',
    'dateUtils.ts',
    'types.ts',
  ];

  const sharedPairs = [
    ...sharedFiles.map((name) => ({ source: name, target: name })),
    { source: path.join('types', 'engine.ts'), target: 'engine.ts' },
  ];

  for (const { source, target } of sharedPairs) {
    const sharedPath = path.join(sharedRoot, source);
    const supaPath = path.join(supaRoot, target);
    if (!fs.existsSync(sharedPath)) {
      throw new Error(`Missing shared file: ${sharedPath}`);
    }
    if (!fs.existsSync(supaPath)) {
      throw new Error(`Missing supabase file: ${supaPath}`);
    }
    assertEqual(target, read(sharedPath), read(supaPath));
  }
}

function checkNoLegacyDuplicates() {
  const legacy = path.join(supaRoot, 'odds-utils.ts');
  if (fs.existsSync(legacy)) {
    throw new Error('Legacy duplicate exists: supabase/functions/_shared/odds-utils.ts');
  }
}

try {
  run('node', ['scripts/sync_shared.js']);
  checkNoLegacyDuplicates();
  checkSharedPairs();
  run('npm', ['run', 'build']);
  console.log('SSOT verification complete.');
} catch (err) {
  console.error(String(err?.message || err));
  process.exit(1);
}
