declare const Deno: any;

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  buildCanonicalMlbGameObject,
} from "../_shared/mlb_live/canonical.ts";
import {
  formatMlbInsight,
  validateMlbInsightFormat,
} from "../_shared/mlb_live/formatter.ts";
import {
  evaluateSpeakSilentPolicy,
  SPEAK_POLICY_CONFIG,
} from "../_shared/mlb_live/policy.ts";
import {
  evaluateMlbTriggers,
  TRIGGER_DATA_MAPPING,
} from "../_shared/mlb_live/triggers.ts";
import { validateCanonicalObjectShape } from "../_shared/mlb_live/types.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type ReceiptRow = {
  trigger: string;
  ts_utc: string;
  severity: "low" | "medium" | "high";
};

function parseBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function toBaseUrl(): string {
  const configured =
    Deno.env.get("PUBLIC_APP_BASE_URL") ||
    Deno.env.get("SITE_URL") ||
    "https://sportsync-evidence.web.app";
  return configured.replace(/\/$/, "");
}

function asInningState(canonical: any) {
  return {
    inning: canonical.live_state.inning,
    half: canonical.live_state.half,
    outs: canonical.live_state.outs,
    balls: canonical.live_state.balls,
    strikes: canonical.live_state.strikes,
    runners: canonical.live_state.runners,
    pitcher: canonical.live_state.current_pitcher,
  };
}

function asMarketState(canonical: any) {
  return {
    opening: canonical.market.opening,
    current: canonical.market.current,
    environment_delta: canonical.environment.delta_run_environment,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const trace: string[] = [];
  const startedAt = Date.now();

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const gameId = String(
      (req.method === "GET" ? url.searchParams.get("game_id") : null) ??
        (body?.game_id ?? ""),
    ).trim();
    const includeInsight = parseBool(
      req.method === "GET" ? url.searchParams.get("emit_insight") : body?.emit_insight,
      true,
    );

    if (!gameId) {
      return new Response(JSON.stringify({ error: "game_id is required" }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    trace.push(`[boot] mlb-live-url-context game_id=${gameId}`);

    const canonical = await buildCanonicalMlbGameObject(supabase as any, gameId, toBaseUrl());
    const shapeCheck = validateCanonicalObjectShape(canonical);
    if (!shapeCheck.ok) {
      return new Response(
        JSON.stringify({
          error: "canonical_object_invalid",
          validation_errors: shapeCheck.errors,
          trace,
        }),
        { status: 500, headers: CORS_HEADERS },
      );
    }

    trace.push("[canonical] built");

    const triggerResults = evaluateMlbTriggers(canonical);
    const firedNames = triggerResults.filter((t) => t.fired).map((t) => t.trigger_name);

    const cooldownState: Record<string, ReceiptRow | undefined> = {};
    if (firedNames.length > 0) {
      const { data: receipts, error: receiptError } = await supabase
        .from("mlb_live_insight_receipts")
        .select("trigger, ts_utc, severity")
        .eq("game_id", gameId)
        .in("trigger", firedNames)
        .order("ts_utc", { ascending: false })
        .limit(50);

      if (receiptError) {
        trace.push(`[warn] cooldown receipt fetch failed: ${receiptError.message}`);
      } else if (Array.isArray(receipts)) {
        for (const row of receipts as ReceiptRow[]) {
          if (!cooldownState[row.trigger]) {
            cooldownState[row.trigger] = row;
          }
        }
      }
    }

    const speakDecision = evaluateSpeakSilentPolicy(triggerResults, cooldownState, new Date());
    let liveInsight = null;

    if (includeInsight && speakDecision.speak && speakDecision.chosen_trigger) {
      const formatted = formatMlbInsight(canonical, speakDecision.chosen_trigger);
      const outputCheck = validateMlbInsightFormat(formatted);
      if (!outputCheck.ok) {
        return new Response(
          JSON.stringify({
            error: "insight_output_invalid",
            validation_errors: outputCheck.errors,
            trace,
          }),
          { status: 500, headers: CORS_HEADERS },
        );
      }

      const insertPayload = {
        ts_utc: new Date().toISOString(),
        game_id: canonical.game_id,
        game_url: canonical.game_url,
        inning_state: asInningState(canonical),
        market_state: asMarketState(canonical),
        trigger: speakDecision.chosen_trigger.trigger_name,
        ai_summary: {
          what_changed: formatted.what_changed,
          why_it_matters: formatted.why_it_matters,
          what_to_watch_now: formatted.what_to_watch_now,
          text: formatted.text,
        },
        confidence: speakDecision.chosen_trigger.confidence_inputs.score,
        severity: speakDecision.chosen_trigger.severity,
        outcome_snapshot_later: null,
      };

      const { error: insertError } = await supabase
        .from("mlb_live_insight_receipts")
        .insert(insertPayload);

      if (insertError) {
        return new Response(
          JSON.stringify({
            error: "receipt_log_write_failed",
            message: insertError.message,
            trace,
          }),
          { status: 500, headers: CORS_HEADERS },
        );
      }

      liveInsight = formatted;
      trace.push("[receipt] emitted insight logged");
    } else {
      trace.push("[policy] silent");
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        game_id: gameId,
        game_url: canonical.game_url,
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        canonical_game: canonical,
        trigger_mapping: TRIGGER_DATA_MAPPING,
        trigger_results: triggerResults,
        speak_policy: {
          ...speakDecision,
          thresholds: SPEAK_POLICY_CONFIG,
        },
        live_output: liveInsight,
        trace,
      }),
      { headers: CORS_HEADERS },
    );
  } catch (error: any) {
    trace.push(`[fatal] ${error?.message ?? "unknown_error"}`);
    return new Response(
      JSON.stringify({
        error: "mlb_live_url_context_failed",
        message: error?.message ?? "Unknown error",
        duration_ms: Date.now() - startedAt,
        trace,
      }),
      { status: 500, headers: CORS_HEADERS },
    );
  }
});
