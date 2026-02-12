/* ============================================================================
   tool-error-sanitizer.ts
   Hybrid Tool-Calling Architecture — Error Sanitization

   Implements: Spec Section 4.3

   RULE: Every catch block in tool execution MUST use this. 
   No raw err.message to model. Ever.
   
   - Logs full error details to server console (message + stack)
   - Returns ONLY a safe, generic message to the model
   - Never exposes Supabase connection strings, table names, or infra details
============================================================================ */

/** Safe, user/model-facing error messages per tool. No infra details. */
const SAFE_MESSAGES: Record<string, string> = {
    get_schedule: "Schedule data temporarily unavailable.",
    get_team_injuries: "Injury data temporarily unavailable.",
    get_team_tempo: "Team tempo data temporarily unavailable.",
    get_live_odds: "Odds data temporarily unavailable.",
    get_live_game_state: "Live game data temporarily unavailable.",
    search_knowledge_base: "Knowledge base temporarily unavailable.",
};

/**
 * Sanitize a tool execution error for safe inclusion in AI model context.
 * 
 * Logs the full error (message + stack) to server console for debugging,
 * but returns only a generic safe message. This prevents infrastructure
 * details (Supabase URLs, table names, connection errors) from leaking
 * into the model's context or the user's response.
 * 
 * @param toolName - Name of the tool that failed
 * @param error - The caught error object
 * @param requestId - Optional request ID for log correlation
 * @returns A safe, generic error message string
 */
export function sanitizeToolError(
    toolName: string,
    error: Error | unknown,
    requestId?: string
): string {
    const err = error instanceof Error ? error : new Error(String(error));

    console.error(`[TOOL_ERROR] [${requestId || "no-id"}] ${toolName}:`, {
        message: err.message,
        stack: err.stack,
    });

    return SAFE_MESSAGES[toolName] || "Data source temporarily unavailable.";
}
