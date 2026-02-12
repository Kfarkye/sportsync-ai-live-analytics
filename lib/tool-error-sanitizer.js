const SAFE_MESSAGES = {
  get_schedule: "Schedule data temporarily unavailable.",
  get_team_injuries: "Injury data temporarily unavailable.",
  get_team_tempo: "Team tempo data temporarily unavailable.",
  get_live_odds: "Odds data temporarily unavailable.",
  get_live_game_state: "Live game data temporarily unavailable.",
  search_knowledge_base: "Knowledge base temporarily unavailable."
};
function sanitizeToolError(toolName, error, requestId) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(`[TOOL_ERROR] [${requestId || "no-id"}] ${toolName}:`, {
    message: err.message,
    stack: err.stack
  });
  return SAFE_MESSAGES[toolName] || "Data source temporarily unavailable.";
}
export {
  sanitizeToolError
};
