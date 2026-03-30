declare const Deno: any;

/**
 * REFRESH NBA MASTER VIEWS
 *
 * Purpose: Refresh canonical NBA materialized views and dependent league-structural views
 * only when NBA final rows or safe odds rows changed since the last successful refresh.
 *
 * Called by: finalize-games-cron (event), Firebase orchestration, manual.
 *
 * Zones:
 * - OPS (SRE+Amazon): refresh orchestration, idempotent gating, and observability.
 * - DATA/ID (Amazon+Google): dependency-safe materialized view lifecycle.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

type RefreshRequest = {
  force_refresh?: boolean;
  trigger?: string;
  nba_finalized_count?: number;
  nba_finalized_match_ids?: string[];
};

type NBAProbeRow = {
  id: string;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  last_updated: string | null;
  updated_at: string | null;
  last_odds_update: string | null;
  odds_total_safe: number | null;
  odds_home_spread_safe: number | null;
};

function toMillis(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function isFinalStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? "").toUpperCase();
  return normalized.includes("FINAL") || normalized.includes("COMPLETE");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const startMs = Date.now();
  const runId = `refresh_nba_master_views_${startMs}`;
  const trace: string[] = [];

  let payload: RefreshRequest = {};
  try {
    payload = await req.json() as RefreshRequest;
  } catch {
    payload = {};
  }

  const forceRefresh = payload.force_refresh === true;

  try {
    trace.push(`[boot] refresh-nba-master-views @ ${new Date().toISOString()}`);

    const { count: matchCount, error: countErr } = await supabase
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("sport", "basketball")
      .eq("league_id", "nba");

    if (countErr) {
      trace.push(`[warn] pre-check count failed: ${countErr.message}`);
    } else {
      trace.push(`[pre-check] ${matchCount ?? 0} NBA matches in source table`);
      if ((matchCount ?? 0) === 0) {
        trace.push("[abort] no NBA matches found; skipping refresh");
        return new Response(JSON.stringify({
          status: "SKIPPED",
          reason: "no_source_data",
          duration_ms: Date.now() - startMs,
          trace,
        }), { headers: CORS_HEADERS });
      }
    }

    let lastSuccessAt: string | null = null;
    const { data: lastRunRows, error: lastRunErr } = await supabase
      .from("job_runs")
      .select("finished_at")
      .eq("job_name", "refresh_nba_master_views")
      .eq("status", "succeeded")
      .order("finished_at", { ascending: false })
      .limit(1);

    if (lastRunErr) {
      trace.push(`[warn] last-run lookup failed: ${lastRunErr.message}`);
    } else {
      lastSuccessAt = lastRunRows?.[0]?.finished_at ?? null;
    }

    let finalizedChangedSinceLast = 0;
    let safeOddsChangedSinceLast = 0;

    if (!forceRefresh && lastSuccessAt) {
      const { data: probeRows, error: probeErr } = await supabase
        .from("matches")
        .select("id,status,home_score,away_score,last_updated,updated_at,last_odds_update,odds_total_safe,odds_home_spread_safe")
        .eq("sport", "basketball")
        .eq("league_id", "nba");

      if (probeErr) {
        trace.push(`[warn] change-probe lookup failed: ${probeErr.message}`);
      } else {
        const sinceMs = toMillis(lastSuccessAt);
        for (const row of (probeRows ?? []) as NBAProbeRow[]) {
          const finalTouchMs = Math.max(toMillis(row.last_updated), toMillis(row.updated_at));
          const oddsTouchMs = Math.max(toMillis(row.last_odds_update), toMillis(row.last_updated), toMillis(row.updated_at));

          const hasFinalScore = row.home_score !== null && row.away_score !== null && isFinalStatus(row.status);
          const hasSafeOdds = hasFinalScore && row.odds_total_safe !== null && row.odds_home_spread_safe !== null;

          if (hasFinalScore && finalTouchMs > sinceMs) {
            finalizedChangedSinceLast += 1;
          }

          if (hasSafeOdds && oddsTouchMs > sinceMs) {
            safeOddsChangedSinceLast += 1;
          }
        }
      }

      trace.push(`[gate] since ${lastSuccessAt}: finalized_changed=${finalizedChangedSinceLast}, safe_odds_changed=${safeOddsChangedSinceLast}`);

      if (finalizedChangedSinceLast === 0 && safeOddsChangedSinceLast === 0) {
        trace.push("[skip] no NBA final/safe-odds changes since last successful refresh");
        return new Response(JSON.stringify({
          status: "SKIPPED",
          reason: "no_nba_changes_since_last_success",
          gate: {
            last_success_at: lastSuccessAt,
            finalized_changed: finalizedChangedSinceLast,
            safe_odds_changed: safeOddsChangedSinceLast,
          },
          duration_ms: Date.now() - startMs,
          trace,
        }), { headers: CORS_HEADERS });
      }
    } else if (forceRefresh) {
      trace.push("[gate] force_refresh=true; bypassing change gate");
    } else {
      trace.push("[gate] no prior successful run; refreshing now");
    }

    trace.push("[refresh] calling refresh_nba_master_views()");
    const { error: masterRpcErr } = await supabase.rpc("refresh_nba_master_views");
    if (masterRpcErr) {
      trace.push(`[error] master refresh RPC failed: ${masterRpcErr.message}`);
      throw masterRpcErr;
    }

    trace.push("[refresh] calling refresh_nba_league_structural_views()");
    const { data: structuralResult, error: structuralRpcErr } = await supabase.rpc("refresh_nba_league_structural_views");
    if (structuralRpcErr) {
      trace.push(`[error] structural refresh RPC failed: ${structuralRpcErr.message}`);
      throw structuralRpcErr;
    }

    const [
      gameViewCountResult,
      teamViewCountResult,
      structuralBaseCountResult,
      structuralTotalsCountResult,
      structuralAtsCountResult,
      structuralFlipCountResult,
    ] = await Promise.all([
      supabase.from("mv_nba_game_master").select("match_id", { count: "exact", head: true }),
      supabase.from("mv_nba_team_game_master").select("match_id", { count: "exact", head: true }),
      supabase.from("mv_nba_team_venue_game_lines").select("match_id", { count: "exact", head: true }),
      supabase.from("mv_nba_team_venue_totals_trends").select("team_name", { count: "exact", head: true }),
      supabase.from("mv_nba_team_venue_ats_trends").select("team_name", { count: "exact", head: true }),
      supabase.from("mv_nba_team_venue_flip_trends").select("team_name", { count: "exact", head: true }),
    ]);

    const gameViewCount = gameViewCountResult.count ?? 0;
    const teamViewCount = teamViewCountResult.count ?? 0;
    const structuralBaseCount = structuralBaseCountResult.count ?? 0;
    const structuralTotalsCount = structuralTotalsCountResult.count ?? 0;
    const structuralAtsCount = structuralAtsCountResult.count ?? 0;
    const structuralFlipCount = structuralFlipCountResult.count ?? 0;

    trace.push(`[post-check] mv_nba_game_master=${gameViewCount}`);
    trace.push(`[post-check] mv_nba_team_game_master=${teamViewCount}`);
    trace.push(`[post-check] mv_nba_team_venue_game_lines=${structuralBaseCount}`);
    trace.push(`[post-check] mv_nba_team_venue_totals_trends=${structuralTotalsCount}`);
    trace.push(`[post-check] mv_nba_team_venue_ats_trends=${structuralAtsCount}`);
    trace.push(`[post-check] mv_nba_team_venue_flip_trends=${structuralFlipCount}`);

    const totalRows =
      gameViewCount
      + teamViewCount
      + structuralBaseCount
      + structuralTotalsCount
      + structuralAtsCount
      + structuralFlipCount;

    try {
      await supabase.from("job_runs").insert({
        job_id: runId,
        job_name: "refresh_nba_master_views",
        target_object: "mv_nba_game_master",
        trigger_type: "event",
        status: "succeeded",
        started_at: new Date(startMs).toISOString(),
        finished_at: new Date().toISOString(),
        row_count: totalRows,
        rows_written: totalRows,
        metadata: {
          trigger: payload.trigger ?? null,
          nba_finalized_count: payload.nba_finalized_count ?? null,
          nba_finalized_match_ids: payload.nba_finalized_match_ids ?? null,
          gate: {
            last_success_at: lastSuccessAt,
            finalized_changed: finalizedChangedSinceLast,
            safe_odds_changed: safeOddsChangedSinceLast,
            force_refresh: forceRefresh,
          },
          structural_refresh_result: structuralResult ?? null,
          trace,
        },
      });
    } catch {
      trace.push("[warn] job_runs logging failed (non-fatal)");
    }

    return new Response(JSON.stringify({
      status: "REFRESHED",
      mv_nba_game_master: gameViewCount,
      mv_nba_team_game_master: teamViewCount,
      mv_nba_team_venue_game_lines: structuralBaseCount,
      mv_nba_team_venue_totals_trends: structuralTotalsCount,
      mv_nba_team_venue_ats_trends: structuralAtsCount,
      mv_nba_team_venue_flip_trends: structuralFlipCount,
      structural_refresh_result: structuralResult ?? null,
      gate: {
        last_success_at: lastSuccessAt,
        finalized_changed: finalizedChangedSinceLast,
        safe_odds_changed: safeOddsChangedSinceLast,
        force_refresh: forceRefresh,
      },
      duration_ms: Date.now() - startMs,
      trace,
    }), { headers: CORS_HEADERS });
  } catch (err: any) {
    trace.push(`[fatal] ${err?.message ?? "unknown error"}`);
    console.error("[refresh-nba-master-views] Fatal:", err);

    try {
      await supabase.from("job_runs").insert({
        job_id: runId,
        job_name: "refresh_nba_master_views",
        target_object: "mv_nba_game_master",
        trigger_type: "event",
        status: "failed",
        started_at: new Date(startMs).toISOString(),
        finished_at: new Date().toISOString(),
        error_message: err?.message ?? "unknown error",
        metadata: { trace },
      });
    } catch {
      // best effort
    }

    return new Response(JSON.stringify({
      status: "ERROR",
      error: err?.message ?? "unknown error",
      duration_ms: Date.now() - startMs,
      trace,
    }), { status: 500, headers: CORS_HEADERS });
  }
});
