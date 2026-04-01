import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const sharedRoot = path.join(root, 'packages', 'shared', 'src');
const sharedTypes = path.join(sharedRoot, 'types');
const sharedLib = path.join(sharedRoot, 'lib');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readFileSafe(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function writeIfChanged(dest, content) {
  const existing = await readFileSafe(dest);
  if (existing === content) return;
  await ensureDir(path.dirname(dest));
  await fs.writeFile(dest, content, 'utf8');
}

async function copyFile(src, dest) {
  const content = await fs.readFile(src, 'utf8');
  await writeIfChanged(dest, content);
}

async function copyDir(src, dest) {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
  }
}

async function syncTypes() {
  const files = await fs.readdir(sharedTypes);
  for (const name of files) {
    if (!name.endsWith('.ts')) continue;
    const src = path.join(sharedTypes, name);
    const dest = path.join(root, 'src', 'types', name);
    await copyFile(src, dest);
  }

  // Supabase _shared
  const sharedOut = path.join(root, 'supabase', 'functions', '_shared');
  await ensureDir(sharedOut);
  await copyFile(path.join(sharedTypes, 'index.ts'), path.join(sharedOut, 'index.ts'));
  await writeIfChanged(path.join(sharedOut, 'types.ts'), "export * from './index.ts';\n");
  await copyFile(path.join(sharedTypes, 'engine.ts'), path.join(sharedOut, 'engine.ts'));

  // Root shim
  await writeIfChanged(path.join(root, 'types.ts'), "export * from './src/types/index.ts';\n");
}

async function syncConstants() {
  await writeIfChanged(path.join(root, 'src', 'constants.ts'), "export * from '@shared/constants';\n");
  await writeIfChanged(path.join(root, 'constants.ts'), "export * from './src/constants.ts';\n");
}

async function syncEssence() {
  await copyFile(path.join(sharedLib, 'essence.ts'), path.join(root, 'src', 'lib', 'essence.ts'));
  await writeIfChanged(path.join(root, 'lib', 'essence.ts'), "export * from '../src/lib/essence.ts';\n");
}

async function syncSharedRuntime() {
  const sharedOut = path.join(root, 'supabase', 'functions', '_shared');
  await ensureDir(sharedOut);

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
    await copyFile(path.join(sharedRoot, name), path.join(sharedOut, name));
  }

  await copyDir(path.join(sharedRoot, 'engine'), path.join(sharedOut, 'engine'));
}

async function main() {
  await syncTypes();
  await syncConstants();
  await syncEssence();
  await syncSharedRuntime();
  console.log('Shared sync complete.');
}

main().catch((err) => {
  console.error('Shared sync failed:', err);
  process.exit(1);
});
