import { supabase } from "@/lib/supabase";
import type { MlbLiveUrlContextResponse } from "@/types/mlbLiveUrlContext";

export async function fetchMlbLiveUrlContext(
  gameId: string,
  emitInsight = true,
): Promise<MlbLiveUrlContextResponse> {
  const trimmed = gameId.trim();
  if (!trimmed) {
    throw new Error("gameId is required");
  }

  const { data, error } = await supabase.functions.invoke("mlb-live-url-context", {
    body: {
      game_id: trimmed,
      emit_insight: emitInsight,
    },
  });

  if (error) {
    throw new Error(error.message || "Failed to fetch MLB live url context");
  }

  if (!data || typeof data !== "object" || data.status !== "ok") {
    const message = typeof data?.error === "string" ? data.error : "Invalid MLB live url context response";
    throw new Error(message);
  }

  return data as MlbLiveUrlContextResponse;
}
