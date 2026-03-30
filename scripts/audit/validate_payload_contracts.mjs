#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const publicDir = join(root, 'public');
const propsDir = join(publicDir, 'props');
const trendsDir = join(publicDir, 'trends');
const failures = [];

function assertContract(ok, message) {
  if (!ok) failures.push(message);
}

function readText(path) {
  return readFileSync(path, 'utf-8');
}

function validatePropsContracts() {
  if (!existsSync(propsDir)) return;
  const entries = readdirSync(propsDir);
  const jsonFiles = entries.filter((name) => name.endsWith('.json') && name !== 'index.json' && name !== 'evidence-pack-fallback.json');

  for (const jsonName of jsonFiles) {
    const slug = jsonName.replace(/\.json$/, '');
    const htmlPath = join(propsDir, `${slug}.html`);
    const jsonPath = join(propsDir, jsonName);
    if (!existsSync(htmlPath)) {
      assertContract(false, `props/${slug}: missing HTML sibling for JSON payload`);
      continue;
    }

    const payload = JSON.parse(readText(jsonPath));
    const html = readText(htmlPath);
    const canonical = `<link rel="canonical" href="${payload.url}" />`;
    const alternatePrefix = `<link rel="alternate" type="application/json" href="${payload.url}.json"`;

    assertContract(html.includes(canonical), `props/${slug}: canonical link does not match payload.url`);
    assertContract(html.includes(alternatePrefix), `props/${slug}: alternate JSON link missing or mismatched`);
    assertContract(html.includes(payload.player_name), `props/${slug}: player_name missing from HTML output`);
  }
}

function validateTrendsContracts() {
  if (!existsSync(trendsDir)) return;
  const indexJsonPath = join(trendsDir, 'index.json');
  const indexHtmlPath = join(trendsDir, 'index.html');
  assertContract(existsSync(indexJsonPath), 'trends/index.json is required for machine-readable parity');
  assertContract(existsSync(indexHtmlPath), 'trends/index.html is missing');
  if (!existsSync(indexJsonPath) || !existsSync(indexHtmlPath)) return;

  const indexPayload = JSON.parse(readText(indexJsonPath));
  const indexHtml = readText(indexHtmlPath);
  assertContract(indexHtml.includes('<link rel="alternate" type="application/json" href="https://sportsync-evidence.web.app/trends/index.json"'), 'trends/index.html alternate JSON link mismatch');

  const teams = Array.isArray(indexPayload.teams) ? indexPayload.teams : [];
  for (const team of teams) {
    const slug = team.slug;
    const teamHtmlPath = join(trendsDir, `${slug}.html`);
    const teamJsonPath = join(trendsDir, `${slug}.json`);
    assertContract(existsSync(teamHtmlPath), `trends/${slug}.html missing`);
    assertContract(existsSync(teamJsonPath), `trends/${slug}.json missing`);
    if (!existsSync(teamHtmlPath) || !existsSync(teamJsonPath)) continue;

    const teamPayload = JSON.parse(readText(teamJsonPath));
    const teamHtml = readText(teamHtmlPath);
    const canonical = `<link rel="canonical" href="${teamPayload.url}" />`;
    const alternatePrefix = `<link rel="alternate" type="application/json" href="${teamPayload.json_url}"`;

    assertContract(teamHtml.includes(canonical), `trends/${slug}: canonical link mismatch`);
    assertContract(teamHtml.includes(alternatePrefix), `trends/${slug}: alternate JSON link mismatch`);
    assertContract(teamHtml.includes(teamPayload.team?.name || ''), `trends/${slug}: team name missing in HTML`);
    assertContract(teamHtml.includes(teamPayload.meta?.headline || ''), `trends/${slug}: headline mismatch between payload and HTML`);
    assertContract(indexHtml.includes(`/trends/${slug}`), `trends/index.html missing link to /trends/${slug}`);
  }
}

validatePropsContracts();
validateTrendsContracts();

if (failures.length > 0) {
  console.error('Payload contract validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Payload contract validation passed.');
