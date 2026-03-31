import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const toPath = (rel) => path.join(root, rel);
const read = (rel) => fs.readFileSync(toPath(rel), 'utf8');

function fail(message) {
  console.error(`❌ DESIGN SSOT VERIFICATION FAILED: ${message}`);
  process.exit(1);
}

function expectIncludes(file, needle, detail) {
  const content = read(file);
  if (!content.includes(needle)) {
    fail(`${detail || file} is missing expected marker: ${needle}`);
  }
}

function expectRegex(file, re, detail) {
  const content = read(file);
  if (!re.test(content)) {
    fail(`${detail || file} does not match expected pattern: ${re}`);
  }
}

function expectJsonValue(file, pathList, expected) {
  const content = JSON.parse(read(file));
  let cursor = content;
  for (const seg of pathList) {
    cursor = cursor?.[seg];
  }
  if (cursor !== expected) {
    fail(`${file}: ${pathList.join('.')} expected ${expected} but found ${String(cursor)}`);
  }
}

console.log('Design SSOT verify start');

expectRegex('AGENTS.md', /SportsSync consumer-facing pages must follow the SportsSync warm-light design system/);
expectRegex('DESIGN_SSOT.md', /SportsSync consumer-facing pages must follow the SportsSync warm-light design system/);
expectRegex('DESIGN_SSOT.md', /TheDrip is a separate product family/);

expectIncludes('src/lib/design-tokens.ts', "bg: '#FAFAF8'", 'design-tokens bg token');
expectIncludes('src/lib/design-tokens.ts', "surface: '#FFFFFF'", 'design-tokens surface token');
expectIncludes('src/lib/design-tokens.ts', "border: '#E8E7E3'", 'design-tokens border token');
expectIncludes('src/lib/design-tokens.ts', "textPrimary: '#1A1A18'", 'design-tokens textPrimary token');
expectIncludes('src/lib/design-tokens.ts', "textSecondary: '#6B6B63'", 'design-tokens textSecondary token');
expectIncludes('src/lib/design-tokens.ts', "textTertiary: '#9B9B91'", 'design-tokens textTertiary token');
expectIncludes('src/lib/design-tokens.ts', "accent: '#C85A3A'", 'design-tokens accent token');
expectIncludes('src/lib/design-tokens.ts', "positive: '#2D8F5C'", 'design-tokens positive token');
expectIncludes('src/lib/design-tokens.ts', "title: \"'Source Serif 4'", 'design-tokens title font token');
expectIncludes('src/lib/design-tokens.ts', "body: \"'DM Sans'", 'design-tokens body font token');
expectIncludes('src/lib/design-tokens.ts', "mono: \"'JetBrains Mono'", 'design-tokens mono font token');
expectIncludes('src/lib/design-tokens.ts', "card: '8px'", 'design-tokens radius token');
expectIncludes('src/lib/design-tokens.ts', "control: '6px'", 'design-tokens control radius token');

expectIncludes('src/lib/tokens.ts', 'SPORTSSYNC_TOKENS', 'shared token bridge');
expectIncludes('src/lib/tokens.ts', "accent: SPORTSSYNC_TOKENS.color.accent,", 'shared token bridge accent mapping');

expectIncludes('index.css', 'color-scheme: light', 'light theme declaration');
expectIncludes('index.css', 'font-family: var(--ss-font-body,', 'body font binding');

expectIncludes('package.json', '"verify:ssot:design": "node scripts/audit/verify_design_ssot.js"', 'package ssot design script');
expectIncludes('package.json', '"verify:ssot": "node scripts/audit/verify_ssot.js"', 'package ssot script path');
expectIncludes('.github/workflows/ci.yml', 'npm run verify:ssot:design', 'CI design SSOT guard');

const scripts = JSON.parse(read('package.json')).scripts || {};
if (typeof scripts['verify:ssot:design'] !== 'string' || !scripts['verify:ssot:design'].includes('scripts/audit/verify_design_ssot.js')) {
  fail('Invalid npm script verify:ssot:design command');
}

if (typeof scripts['verify:ssot'] !== 'string' || !scripts['verify:ssot'].includes('scripts/audit/verify_ssot.js')) {
  fail('Invalid npm script verify:ssot command path');
}

console.log('✅ DESIGN SSOT verification passed');
