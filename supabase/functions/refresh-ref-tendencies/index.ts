declare const Deno: any;

/**
 * REFRESH REF TENDENCIES
 *
 * Purpose: Rebuild APP_REF_TENDENCIES_CURRENT source tables from finalized NBA game + official data.
 *
 * Called by: finalize-games-cron step 4d (post-grade), manual, or Firebase orchestration.
 *
 * Zone: OPS (SRE+Amazon) + DATA/ID (Amazon+Google).
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const startMs = Date.now();
  const trace: string[] = [];

  try {
    trace.push(`[boot] refresh-ref-tendencies @ ${new Date().toISOString()}`);

    const { data: refreshResult, error: rpcErr } = await supabase.rpc("refresh_ref_tendencies_records", {
      p_sport: "basketball",
    });

    if (rpcErr) {
      trace.push(`[error] RPC failed: ${rpcErr.message}`);
      throw rpcErr;
    }

    trace.push(`[refresh] refresh_ref_tendencies_records returned: ${JSON.stringify(refreshResult ?? {})}`);

    const [teamHead, coachHead, playerHead] = await Promise.all([
      supabase.from("ref_team_records").select("id,updated_at", { count: "exact", head: true }).eq("sport", "basketball"),
      supabase.from("ref_coach_records").select("id,updated_at", { count: "exact", head: true }).eq("sport", "basketball"),
      supabase.from("ref_player_records").select("id,updated_at", { count: "exact", head: true }).eq("sport", "basketball"),
    ]);

    const { data: latestTeam } = await supabase
      .from("ref_team_records")
      .select("updated_at")
      .eq("sport", "basketball")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestUpdatedAt = latestTeam?.updated_at ?? null;

    trace.push(`[post-check] team_rows=${teamHead.count ?? 0}, coach_rows=${coachHead.count ?? 0}, player_rows=${playerHead.count ?? 0}`);
    trace.push(`[post-check] latest_team_updated_at=${latestUpdatedAt ?? 'null'}`);

    try {
      await supabase.from("job_runs").insert({
        job_name: "refresh_ref_tendencies",
        target_object: "APP_REF_TENDENCIES_CURRENT",
        trigger_type: "cron",
        status: "succeeded",
        started_at: new Date(startMs).toISOString(),
        finished_at: new Date().toISOString(),
        rows_written: (teamHead.count ?? 0) + (coachHead.count ?? 0) + (playerHead.count ?? 0),
        meta: { trace, refresh_result: refreshResult ?? null },
      });
    } catch {
      trace.push("[warn] job_runs logging failed (non-fatal)");
    }

    return new Response(JSON.stringify({
      status: "REFRESHED",
      team_rows: teamHead.count ?? 0,
      coach_rows: coachHead.count ?? 0,
      player_rows: playerHead.count ?? 0,
      latest_updated_at: latestUpdatedAt,
      duration_ms: Date.now() - startMs,
      trace,
    }), { headers: CORS_HEADERS });
  } catch (err: any) {
    trace.push(`[fatal] ${err.message}`);
    console.error("[refresh-ref-tendencies] Fatal:", err);

    try {
      await supabase.from("job_runs").insert({
        job_name: "refresh_ref_tendencies",
        target_object: "APP_REF_TENDENCIES_CURRENT",
        trigger_type: "cron",
        status: "failed",
        started_at: new Date(startMs).toISOString(),
        finished_at: new Date().toISOString(),
        error_message: err.message,
        meta: { trace },
      });
    } catch {
      // best-effort
    }

    return new Response(JSON.stringify({
      status: "ERROR",
      error: err.message,
      duration_ms: Date.now() - startMs,
      trace,
    }), { status: 500, headers: CORS_HEADERS });
  }
});
