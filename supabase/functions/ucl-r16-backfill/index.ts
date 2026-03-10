import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ESPN_SCOREBOARD_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard";

type SeasonLegDates = {
  leg1: string[];
  leg2: string[];
};

const R16_DATES: Record<string, SeasonLegDates> = {
  "2022-23": {
    leg1: ["20230214", "20230215", "20230221", "20230222"],
    leg2: ["20230307", "20230308", "20230314", "20230315"],
  },
  "2023-24": {
    leg1: ["20240213", "20240214", "20240220", "20240221"],
    leg2: ["20240305", "20240306", "20240312", "20240313"],
  },
  "2024-25": {
    leg1: ["20250304", "20250305", "20250311", "20250312"],
    leg2: ["20250311", "20250312", "20250318", "20250319"],
  },
};

interface ESPNTeamNode {
  homeAway: "home" | "away";
  score?: string;
  team?: {
    id?: string;
    displayName?: string;
  };
}

interface ESPNCompetitionNode {
  competitors?: ESPNTeamNode[];
}

interface ESPNEvent {
  id: string;
  date?: string;
  status?: {
    type?: {
      name?: string;
    };
  };
  competitions?: ESPNCompetitionNode[];
}

interface ESPNScoreboardResponse {
  events?: ESPNEvent[];
}

type LegValue = "1" | "2";

function getLegForDate(season: string, dateStr: string): LegValue | null {
  const seasonDates = R16_DATES[season];
  if (!seasonDates) return null;

  const inLeg1 = seasonDates.leg1.includes(dateStr);
  const inLeg2 = seasonDates.leg2.includes(dateStr);

  if (inLeg1 && !inLeg2) return "1";
  if (!inLeg1 && inLeg2) return "2";

  // If date exists in both buckets (as in provided 2024-25 list), favor leg 2.
  if (inLeg1 && inLeg2) return "2";
  return null;
}

function parseScore(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function isCompletedStatus(statusName: string): boolean {
  const s = statusName.toUpperCase();
  return (
    s.includes("FINAL") ||
    s.includes("FULL_TIME") ||
    s.includes("STATUS_FINAL") ||
    s.includes("POST")
  );
}

function uniqueDatesForSeason(season: string): string[] {
  const seasonDates = R16_DATES[season];
  if (!seasonDates) return [];
  return Array.from(new Set([...seasonDates.leg1, ...seasonDates.leg2]));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const results: Array<{ id: string; status: string }> = [];
    let inserted = 0;
    let skipped = 0;
    let datesProcessed = 0;

    for (const season of Object.keys(R16_DATES)) {
      const dates = uniqueDatesForSeason(season);

      for (const dateStr of dates) {
        const leg = getLegForDate(season, dateStr);
        if (!leg) {
          results.push({
            id: `${season}:${dateStr}`,
            status: "SKIP: date not mapped to leg",
          });
          skipped += 1;
          continue;
        }

        const url = `${ESPN_SCOREBOARD_BASE}?dates=${dateStr}`;
        datesProcessed += 1;

        try {
          const response = await fetch(url);
          if (!response.ok) {
            results.push({
              id: `${season}:${dateStr}`,
              status: `HTTP ${response.status}`,
            });
            skipped += 1;
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }

          const payload = (await response.json()) as ESPNScoreboardResponse;
          const events = Array.isArray(payload.events) ? payload.events : [];

          for (const event of events) {
            const comp = event.competitions?.[0];
            if (!comp) {
              skipped += 1;
              results.push({
                id: `${season}:${dateStr}:no_comp`,
                status: "SKIP: no competition payload",
              });
              continue;
            }

            const home = comp.competitors?.find((c) => c.homeAway === "home");
            const away = comp.competitors?.find((c) => c.homeAway === "away");
            if (!home || !away) {
              skipped += 1;
              results.push({
                id: `${season}:${dateStr}:${event.id}`,
                status: "SKIP: missing home/away competitor",
              });
              continue;
            }

            const homeTeam = home.team?.displayName?.trim();
            const awayTeam = away.team?.displayName?.trim();
            if (!homeTeam || !awayTeam) {
              skipped += 1;
              results.push({
                id: `${season}:${dateStr}:${event.id}`,
                status: "SKIP: missing team names",
              });
              continue;
            }

            const statusName = event.status?.type?.name || "STATUS_FINAL";
            if (!isCompletedStatus(statusName)) {
              skipped += 1;
              results.push({
                id: `${event.id}_ucl_hist`,
                status: `SKIP: non-final status (${statusName})`,
              });
              continue;
            }

            const homeScore = parseScore(home.score);
            const awayScore = parseScore(away.score);
            const matchId = `${event.id}_ucl_hist`;

            const row = {
              id: matchId,
              league_id: "uefa.champions",
              sport: "soccer",
              home_team: homeTeam,
              away_team: awayTeam,
              home_team_id: home.team?.id || null,
              away_team_id: away.team?.id || null,
              start_time: event.date || null,
              status: statusName,
              home_score: homeScore,
              away_score: awayScore,
              updated_at: new Date().toISOString(),
              extra_data: {
                round: "R16",
                season,
                leg,
                espn_event_id: event.id,
                backfill: true,
              },
            };

            const { error } = await supabase
              .from("matches")
              .upsert(row, { onConflict: "id" });

            if (error) {
              skipped += 1;
              results.push({
                id: matchId,
                status: `ERROR: ${error.message}`,
              });
            } else {
              inserted += 1;
              results.push({
                id: matchId,
                status: "OK",
              });
            }
          }

          // ESPN rate-limit guard
          await new Promise((r) => setTimeout(r, 500));
        } catch (error) {
          skipped += 1;
          results.push({
            id: `${season}:${dateStr}`,
            status: `FETCH ERROR: ${(error as Error).message}`,
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        inserted,
        skipped,
        dates_processed: datesProcessed,
        total: results.length,
        results,
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message || "Unknown error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
