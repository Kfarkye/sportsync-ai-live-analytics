/* ============================================================================
   tool-registry.ts
   Hybrid Tool-Calling Architecture — Tool Declarations & Constants

   Implements: Spec Section 4.1 (Registry), Lockdown 1, 7, 8
   
   4 core tools for Phase 1. Deferred: search_knowledge_base, get_live_game_state.
   
   CASING: All keys are lowerCamelCase — matches generativelanguage.googleapis.com
   wire format. Enum values (type, mode) are UPPERCASE strings.
   
   CRITICAL: get_schedule has NO required fields — all args have handler defaults.
   This maximizes AUTO success rate; the model can call get_schedule() with zero 
   args and get today's full slate.
============================================================================ */

// ── Function Declaration Schema ──────────────────────────────────────────

/**
 * Schema for a Gemini function declaration.
 * Keys are camelCase to match the generativelanguage.googleapis.com wire format.
 * Type enum values are UPPERCASE.
 */
export interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: "OBJECT";
        properties: Record<string, {
            type: string;
            description?: string;
            enum?: string[];
            items?: { type: string };
        }>;
        required?: string[];
    };
}

// ── Phase 1: 4 Core Tool Declarations ────────────────────────────────────

export const FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
    {
        name: "get_schedule",
        description: "Get upcoming and recent games for a sport on a date. Returns match IDs usable with other tools. Call when user asks about today's games, slate, or matchups.",
        parameters: {
            type: "OBJECT",
            properties: {
                date: {
                    type: "STRING",
                    description: "YYYY-MM-DD. Handler defaults to today ET if omitted."
                },
                sport: {
                    type: "STRING",
                    enum: ["NBA", "NFL", "NHL", "NCAAB", "NCAAF", "MLB", "EPL", "LALIGA", "BUNDESLIGA", "SERIEA", "LIGUE1"],
                    description: "League filter. Omit for all."
                },
                team: {
                    type: "STRING",
                    description: "Team name filter (partial match)."
                },
                days_ahead: {
                    type: "INTEGER",
                    description: "Days forward. Default 1. Max 14."
                }
            }
            // No required fields — all have sensible defaults in the handler.
            // This maximizes AUTO success rate; the model can call get_schedule()
            // with zero args and get today's full slate.
        }
    },
    {
        name: "get_team_injuries",
        description: "Get injury report, rest days, travel situation, fatigue data. Call BEFORE analyzing any matchup.",
        parameters: {
            type: "OBJECT",
            properties: {
                team: {
                    type: "STRING",
                    description: "Full team name (e.g., 'Boston Celtics')."
                },
                sport: {
                    type: "STRING",
                    enum: ["NBA", "NFL", "NHL", "NCAAB", "NCAAF", "MLB"],
                    description: "League."
                }
            },
            required: ["team"]
        }
    },
    {
        name: "get_team_tempo",
        description: "Get pace, offensive/defensive efficiency, ATS record, over/under trends. Call for quantitative analysis.",
        parameters: {
            type: "OBJECT",
            properties: {
                teams: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                    description: "Team names (e.g., ['Boston Celtics', 'New York Knicks'])."
                }
            },
            required: ["teams"]
        }
    },
    {
        name: "get_live_odds",
        description: "Get current and opening odds (spread, total, moneyline) for a match. Call when evaluating betting value or line movement.",
        parameters: {
            type: "OBJECT",
            properties: {
                match_id: {
                    type: "STRING",
                    description: "UUID of the match (from get_schedule or gameContext)."
                }
            },
            required: ["match_id"]
        }
    }
];

// Phase 1.5 tools (deferred):
// - search_knowledge_base (requires embedding call — extra failure mode)
// - get_live_game_state (pre-fetch already covers primary case)

// ── Constants ────────────────────────────────────────────────────────────

/** Max tool rounds per request before termination. Safety rail. */
export const MAX_TOOL_ROUNDS = 4;

/** Max concurrent tool executions per round. Prevents DB saturation. */
export const MAX_CONCURRENT_TOOLS = 4;

/** Per-tool execution timeout in ms. Individual tools that exceed this fail. */
export const TOOL_TIMEOUT_MS = 8_000;

/** 
 * Buffer in ms before hard deadline where tool calls are skipped.
 * If remaining time < this value, skip tool execution and return what we have.
 */
export const DEADLINE_BUFFER_MS = 10_000;

/** Task types that receive function declarations. Others get zero tool overhead. */
export const TOOL_ENABLED_TASK_TYPES = ["grounding", "analysis"] as const;

/**
 * Tool configuration for the Gemini REST API.
 * 
 * mode: "AUTO" — model decides when to call tools.
 * DO NOT use "ANY" (forces tool call on every turn).
 * 
 * allowedFunctionNames is NOT included because it is completely ignored
 * in AUTO mode (confirmed Gemini Deep Think Pass 3). To restrict tools,
 * physically filter the functionDeclarations array before sending.
 * 
 * CASING: camelCase keys, UPPERCASE enum value — matches wire format.
 */
export const TOOL_CONFIG = {
    functionCallingConfig: {
        mode: "AUTO" as const
    }
} as const;
