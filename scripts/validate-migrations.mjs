#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');

if (!fs.existsSync(migrationsDir)) {
  console.error('❌ Missing supabase/migrations directory');
  process.exit(1);
}

const files = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort();

const violations = [];
const warnings = [];
const seen = new Map();
const format = /^(\d{14})_[a-z0-9_]+\.sql$/;

for (const file of files) {
  const match = file.match(format);
  if (!match) {
    warnings.push(`Legacy migration filename (non-versioned): ${file}`);
    continue;
  }

  const version = match[1];
  if (seen.has(version)) {
    violations.push(`Duplicate migration version ${version}: ${seen.get(version)} and ${file}`);
  } else {
    seen.set(version, file);
  }
}

if (warnings.length > 0) {
  console.warn('⚠️  Legacy migrations detected (allowed):');
  for (const warning of warnings.slice(0, 20)) {
    console.warn(`- ${warning}`);
  }
  if (warnings.length > 20) {
    console.warn(`- ... and ${warnings.length - 20} more`);
  }
  console.warn('');
}

if (violations.length > 0) {
  console.error('❌ Migration validation failed:\n');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`✅ Migration validation passed (${files.length} SQL files).`);
