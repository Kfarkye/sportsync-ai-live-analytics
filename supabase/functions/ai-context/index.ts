declare const Deno: any;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

type AiPacket = {
  match?: {
    id?: string;
    home_team?: string;
    away_team?: string;
  };
  scoreboard?: {
    home?: number;
    away?: number;
    clock?: string;
    period?: number;
    as_of?: string;
  };
  market?: {
    live_total?: number;
    open_total?: number;
    movement_total?: number;
  };
  market_structure?: {
    clob_repricing?: {
      delta_open_to_latest?: number;
    };
    trigger_window?: {
      corridor_width_points?: number;
    };
  };
  answerability?: Record<string, boolean>;
  packet_meta?: {
    freshness_seconds?: number | null;
    as_of?: string | null;
  };
  events?: Array<{ t?: string; text?: string }>;
  trends?: Array<{ label?: string; value?: string }>;
};

function parseQuestionType(text: string): string {
  const q = (text || "").toLowerCase();
  if (q.includes("top scorer") || q.includes("most points") || q.includes("points")) return "top_scorer";
  if (q.includes("rebound")) return "rebounds";
  if (q.includes("assist")) return "assists";
  if (q.includes("odds") || q.includes("line") || q.includes("spread") || q.includes("total")) return "market";
  if (q.includes("what happened") || q.includes("last play") || q.includes("events")) return "events";
  return "general";
}

function buildEvidenceLines(packet: AiPacket): string[] {
  const lines: string[] = [];

  const away = packet.match?.away_team ?? "Away";
  const home = packet.match?.home_team ?? "Home";
  const awayScore = packet.scoreboard?.away;
  const homeScore = packet.scoreboard?.home;
  const clock = packet.scoreboard?.clock ?? "N/A";

  if (typeof awayScore === "number" && typeof homeScore === "number") {
    lines.push(`${away} ${awayScore} - ${homeScore} ${home} (${clock})`);
  }

  const move = packet.market?.movement_total;
  if (typeof move === "number") {
    const sign = move > 0 ? "+" : "";
    lines.push(`Total movement: ${sign}${move.toFixed(1)} (open ${packet.market?.open_total ?? "—"} -> live ${packet.market?.live_total ?? "—"})`);
  }

  const corridor = packet.market_structure?.trigger_window?.corridor_width_points;
  if (typeof corridor === "number") {
    lines.push(`Live corridor: ${corridor.toFixed(1)} points at trigger`);
  } else {
    const clobDelta = packet.market_structure?.clob_repricing?.delta_open_to_latest;
    if (typeof clobDelta === "number") {
      const sign = clobDelta > 0 ? "+" : "";
      lines.push(`Market repricing: ${sign}${clobDelta.toFixed(3)} vs open probability`);
    }
  }

  const topEvent = Array.isArray(packet.events) ? packet.events[packet.events.length - 1] : null;
  if (topEvent?.text) {
    lines.push(`Latest event: ${topEvent.t ?? "N/A"} ${topEvent.text}`);
  }

  if (Array.isArray(packet.trends) && packet.trends.length > 0) {
    const trend = packet.trends[0];
    lines.push(`Trend: ${trend.label ?? "Signal"} — ${trend.value ?? "Active"}`);
  }

  return lines.slice(0, 3);
}

async function logToolUsage(
  supabase: ReturnType<typeof createClient>,
  payload: {
    matchId: string;
    questionType: string;
    latencyMs: number;
    freshnessSeconds: number | null;
    missingFields: string[];
    success: boolean;
    error?: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from("ai_tool_logs").insert({
      tool_name: "get_live_context",
      match_id: payload.matchId,
      question_type: payload.questionType,
      latency_ms: payload.latencyMs,
      packet_freshness_seconds: payload.freshnessSeconds,
      missing_fields: payload.missingFields,
      success: payload.success,
      error: payload.error ?? null,
      meta: payload.meta ?? {},
    });
  } catch (err) {
    console.warn("[ai-context] log insert failed", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const url = new URL(req.url);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "missing_env", message: "Supabase environment is not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  try {
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }

    const matchId = String(body.match_id ?? url.searchParams.get("match_id") ?? "").trim();
    const question = String(body.question ?? url.searchParams.get("question") ?? "").trim();
    const questionType = parseQuestionType(question);
    const maxEvents = Math.max(1, Math.min(25, Number(body.max_events ?? url.searchParams.get("max_events") ?? 10)));

    if (!matchId) {
      return new Response(
        JSON.stringify({ error: "missing_match_id", message: "match_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data, error } = await supabase.rpc("get_ai_match_packet", {
      p_match_id: matchId,
      p_max_events: maxEvents,
    });

    if (error) {
      await logToolUsage(supabase, {
        matchId,
        questionType,
        latencyMs: Date.now() - startedAt,
        freshnessSeconds: null,
        missingFields: ["packet_error"],
        success: false,
        error: error.message,
      });

      return new Response(
        JSON.stringify({ error: "packet_fetch_failed", message: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const packet = (data ?? {}) as AiPacket;
    const answerability = packet.answerability ?? {};
    const missingFields = Object.entries(answerability)
      .filter(([, canAnswer]) => canAnswer === false)
      .map(([key]) => key);

    const freshness = typeof packet.packet_meta?.freshness_seconds === "number"
      ? packet.packet_meta.freshness_seconds
      : null;

    const evidenceLines = buildEvidenceLines(packet);

    await logToolUsage(supabase, {
      matchId,
      questionType,
      latencyMs: Date.now() - startedAt,
      freshnessSeconds: freshness,
      missingFields,
      success: true,
      meta: {
        has_scoreboard: Boolean(packet.scoreboard),
        evidence_lines: evidenceLines.length,
        packet_as_of: packet.packet_meta?.as_of ?? null,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        tool: "get_live_context",
        match_id: matchId,
        question_type: questionType,
        packet,
        evidence_lines: evidenceLines,
        packet_freshness_seconds: freshness,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "unexpected_error", message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
