declare const Deno: any;

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const LEAGUE_URL_MAP: Record<string, { sport: string; league: string }> = {
  nba: { sport: "basketball", league: "nba" },
  "mens-college-basketball": { sport: "basketball", league: "mens-college-basketball" },
  nfl: { sport: "football", league: "nfl" },
  mlb: { sport: "baseball", league: "mlb" },
};

function toNumOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapLeagueForProbabilities(leagueId: string): string {
  if (leagueId === "nba") return "nba";
  if (leagueId === "mens-college-basketball") return "mens-college-basketball";
  if (leagueId === "nfl") return "nfl";
  if (leagueId === "mlb") return "mlb";
  return leagueId;
}

async function fetchProbabilities(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const activeLeagueIds = Object.keys(LEAGUE_URL_MAP);
    const { data: liveMatches, error: matchErr } = await supabase
      .from("matches")
      .select("id, league_id, sport, status")
      .eq("status", "STATUS_IN_PROGRESS")
      .in("league_id", activeLeagueIds)
      .limit(100);

    if (matchErr) throw matchErr;

    const stats = {
      live_matches: liveMatches?.length || 0,
      matches_processed: 0,
      rows_inserted: 0,
      matches_skipped: 0,
      errors: [] as string[],
    };

    for (const match of liveMatches || []) {
      const leagueId = mapLeagueForProbabilities(String(match.league_id || ""));
      const mapping = LEAGUE_URL_MAP[leagueId];
      if (!mapping) {
        stats.matches_skipped++;
        continue;
      }

      const espnEventId = String(match.id || "").split("_")[0];
      if (!espnEventId) {
        stats.matches_skipped++;
        continue;
      }

      stats.matches_processed++;

      try {
        const { data: maxSeqRow, error: maxSeqErr } = await supabase
          .from("espn_probabilities")
          .select("sequence_number")
          .eq("espn_event_id", espnEventId)
          .eq("league_id", leagueId)
          .order("sequence_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (maxSeqErr) {
          stats.errors.push(`${match.id}: max_seq_lookup_failed:${maxSeqErr.message}`);
          continue;
        }

        const maxSeq = toNumOrNull(maxSeqRow?.sequence_number) ?? -1;
        const url = `https://sports.core.api.espn.com/v2/sports/${mapping.sport}/leagues/${mapping.league}/events/${espnEventId}/competitions/${espnEventId}/probabilities?page=1&limit=50`;
        const payload = await fetchProbabilities(url);
        const items = Array.isArray(payload?.items) ? payload.items : [];

        if (items.length === 0) continue;

        const rows = items
          .map((item: any) => {
            const sequenceNumber = toNumOrNull(item?.sequenceNumber);
            if (sequenceNumber == null || sequenceNumber <= maxSeq) return null;

            const homeWinPct = toNumOrNull(item?.homeWinPercentage);
            const awayWinPctRaw = toNumOrNull(item?.awayWinPercentage);
            const tiePct = toNumOrNull(item?.tiePercentage);
            const awayWinPct = awayWinPctRaw != null
              ? awayWinPctRaw
              : (homeWinPct != null ? Math.max(0, 1 - homeWinPct - (tiePct || 0)) : null);

            return {
              match_id: String(match.id),
              espn_event_id: espnEventId,
              league_id: leagueId,
              sport: String(match.sport || mapping.sport),
              play_id: item?.playId != null ? String(item.playId) : null,
              sequence_number: sequenceNumber,
              home_win_pct: homeWinPct,
              away_win_pct: awayWinPct,
              tie_pct: tiePct,
              spread_cover_prob_home: toNumOrNull(item?.spreadWinPercentageHome),
              spread_push_prob: toNumOrNull(item?.spreadPushPercentage),
              total_over_prob: toNumOrNull(item?.overPercentage),
              total_push_prob: toNumOrNull(item?.totalPushPercentage),
              seconds_left: toNumOrNull(item?.secondsLeft),
              source_state: "live_drain",
              last_modified: new Date().toISOString(),
              created_at: new Date().toISOString(),
            };
          })
          .filter((row: any) => row !== null);

        if (rows.length === 0) continue;

        const { error: insertErr } = await supabase
          .from("espn_probabilities")
          .insert(rows);

        if (insertErr) {
          stats.errors.push(`${match.id}: insert_failed:${insertErr.message}`);
          continue;
        }

        stats.rows_inserted += rows.length;
      } catch (e: any) {
        stats.errors.push(`${match.id}: ${e?.message || String(e)}`);
      }
    }

    return new Response(JSON.stringify({ status: "ok", version: "2026-03-18.v2", ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ status: "error", error: e?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
