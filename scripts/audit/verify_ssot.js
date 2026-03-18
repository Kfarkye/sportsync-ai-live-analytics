import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

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

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function assertEqual(label, a, b) {
  if (a !== b) {
    throw new Error(`SSOT mismatch: ${label}`);
  }
}

function checkSharedPairs() {
  const sharedFiles = [
    'gates.ts',
    'gameStateEngine.ts',
    'oddsUtils.ts',
    'espnAdapters.ts',
    'espnService.ts',
    'match-registry.ts',
    'debug.ts',
    'resilience.ts',
    'constants.ts',
    'dateUtils.ts',
  ];

  for (const name of sharedFiles) {
    const sharedPath = path.join(sharedRoot, name);
    const supaPath = path.join(supaRoot, name);
    if (!fs.existsSync(sharedPath)) {
      throw new Error(`Missing shared file: ${sharedPath}`);
    }
    if (!fs.existsSync(supaPath)) {
      throw new Error(`Missing supabase file: ${supaPath}`);
    }
    assertEqual(name, read(sharedPath), read(supaPath));
  }
}

function checkEngineMirror() {
  const sharedEngine = path.join(sharedRoot, 'engine');
  const supaEngine = path.join(supaRoot, 'engine');
  const sharedFiles = listFiles(sharedEngine).map((p) => path.relative(sharedEngine, p));
  const supaFiles = listFiles(supaEngine).map((p) => path.relative(supaEngine, p));

  const sharedSet = new Set(sharedFiles);
  const supaSet = new Set(supaFiles);

  for (const rel of sharedFiles) {
    const a = path.join(sharedEngine, rel);
    const b = path.join(supaEngine, rel);
    if (!fs.existsSync(b)) {
      throw new Error(`Missing supabase engine file: ${rel}`);
    }
    assertEqual(`engine/${rel}`, read(a), read(b));
  }

  for (const rel of supaFiles) {
    if (!sharedSet.has(rel)) {
      throw new Error(`Extra supabase engine file: ${rel}`);
    }
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
  checkEngineMirror();
  run('npm', ['run', 'build']);
  console.log('SSOT verification complete.');
} catch (err) {
  console.error(String(err?.message || err));
  process.exit(1);
}
