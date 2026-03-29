#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL and/or SUPABASE key env vars.");
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const REQUIRED_SECTIONS = [
  "game_id",
  "game_url",
  "start_time_utc",
  "status",
  "teams",
  "market",
  "environment",
  "lineups",
  "starters",
  "bullpens",
  "pregame_edges",
  "live_state",
];

function validateCanonical(payload) {
  const errors = [];
  for (const key of REQUIRED_SECTIONS) {
    if (!(key in payload)) errors.push(`missing ${key}`);
  }
  return errors;
}

async function callContext(gameId) {
  const url = `${SUPABASE_URL}/functions/v1/mlb-live-url-context`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
    },
    body: JSON.stringify({ game_id: gameId, emit_insight: true }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${gameId}: HTTP ${res.status} ${JSON.stringify(json)}`);
  }
  if (!json?.canonical_game) {
    throw new Error(`${gameId}: canonical_game missing`);
  }
  const validationErrors = validateCanonical(json.canonical_game);
  if (validationErrors.length > 0) {
    throw new Error(`${gameId}: ${validationErrors.join(", ")}`);
  }
  return {
    gameId,
    status: json.canonical_game.status,
    emitted: Boolean(json.live_output),
    triggerCount: Array.isArray(json.trigger_results) ? json.trigger_results.length : 0,
  };
}

async function main() {
  const { data, error } = await client
    .from("matches")
    .select("id, status, start_time")
    .eq("league_id", "mlb")
    .in("status", ["STATUS_SCHEDULED", "STATUS_IN_PROGRESS", "STATUS_FINAL"])
    .order("start_time", { ascending: false })
    .limit(40);

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("No MLB matches found for smoke test");
  }

  const pregame = data.find((row) => String(row.status).toUpperCase() === "STATUS_SCHEDULED");
  const live = data.find((row) => String(row.status).toUpperCase() === "STATUS_IN_PROGRESS");

  const targets = [pregame?.id, live?.id].filter(Boolean);
  if (targets.length === 0) {
    throw new Error("No scheduled or in-progress MLB games available for smoke test");
  }

  const results = [];
  for (const gameId of targets) {
    const result = await callContext(gameId);
    results.push(result);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked_games: results.length,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error?.message || String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
