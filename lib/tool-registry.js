const FUNCTION_DECLARATIONS = [
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
const MAX_TOOL_ROUNDS = 4;
const MAX_CONCURRENT_TOOLS = 4;
const TOOL_TIMEOUT_MS = 8e3;
const DEADLINE_BUFFER_MS = 1e4;
const TOOL_ENABLED_TASK_TYPES = ["grounding", "analysis"];
const TOOL_CONFIG = {
  functionCallingConfig: {
    mode: "AUTO"
  }
};
export {
  DEADLINE_BUFFER_MS,
  FUNCTION_DECLARATIONS,
  MAX_CONCURRENT_TOOLS,
  MAX_TOOL_ROUNDS,
  TOOL_CONFIG,
  TOOL_ENABLED_TASK_TYPES,
  TOOL_TIMEOUT_MS
};
