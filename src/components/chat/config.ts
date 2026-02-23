/**
 * ChatWidget Configuration & Constants
 * Extracted from ChatWidget.tsx §0
 */

import type { Transition } from "framer-motion";

export const REGEX_VERDICT_MATCH = /\bverdict\s*:/i;
export const REGEX_WATCH_PREFIX = /.*what to watch(?:\s+live)?.*?:\s*/i;
export const REGEX_WATCH_MATCH = /what to watch(?:\s+live)?/i;

export const REGEX_EDGE_SECTION_HEADER = /^(?:\*{0,2})?(THE EDGE|KEY FACTORS|MARKET DYNAMICS|WHAT TO WATCH(?:\s+LIVE)?|TRIPLE CONFLUENCE|WINNING EDGE\??|ANALYTICAL WALKTHROUGH|SENTIMENT SIGNAL|STRUCTURAL ASSESSMENT)(?:\*{0,2})?:?/i;
// Match "MATCHUP 2: Team A vs Team B — Feb 16, 7:00 PM ET" with optional brackets, bullets, markdown.
export const REGEX_MATCHUP_LINE = /^\s*(?:\[)?\s*(?:[●•·‣-]\s*)?(?:\*{1,3}\s*)?MATCHUP(?:\s*\d+)?\s*[:—-]\s*(.+?)(?:\s*\*{1,3})?\s*(?:\])?\s*$/i;

/** Sections that should never render in analysis */
export const EXCLUDED_SECTIONS = ['the edge', 'the_edge', 'edge', 'triple confluence', 'triple_confluence'];

export const REGEX_SIGNED_NUMERIC = /[+\-\u2212]\d+(?:\.\d+)?/g;

/**
 * Matches bracket citation tokens: [1], [1, 2], [1.1]
 * Negative lookahead (?!\() prevents matching markdown links [text](url).
 */
export const REGEX_CITATION_PLACEHOLDER =
  /\[(\d+(?:\.\d+)?(?:[\s,]+\d+(?:\.\d+)?)*)\](?!\()/g;

export const REGEX_SPLIT_COMMA = /[,\s]+/;
export const REGEX_MULTI_SPACE = /\s{2,}/g;

/** URL fragment appended to citation links — lets the <a> renderer distinguish citations from content links. */
export const CITE_MARKER = "#__cite__";

/** Strips inline citation links (phrase-as-link): [any text](url#__cite__) → "any text" */
export const REGEX_CLEAN_CITE_LINK = /\[([^\]]+)\]\([^)]*#__cite__[^)]*\)/g;

/** Strips old-style support-injected brand citations: " per [ESPN](url#__cite__), [BBRef](url#__cite__)" */
export const REGEX_CLEAN_SUPPORT_CITE = /\s*per\s+(?:\[[^\]]+\]\([^)]+\)(?:,\s*)?)+/g;

/** Strips old-style hydration-path parenthesized citations: " ([ESPN](url), [BBRef](url))" */
export const REGEX_CLEAN_HYDRATED_CITE = /\s*\((?:\[[^\]]+\]\([^)]+\)(?:,\s*)?)+\)/g;

/** Strips superscript fallback citations: text¹² → text */
export const REGEX_CLEAN_SUPERSCRIPT_CITE = /\s*\[([^\]]+)\]\([^)]*#__cite_sup__[^)]*\)/g;

/** Removes hydrated markdown links: [1](https://...) */
export const REGEX_CLEAN_LINK = /\s*\[\d+(?:\.\d+)?\]\([^)]+\)/g;
/** Removes raw bracket tokens: [1] or [1.1] */
export const REGEX_CLEAN_REF = /\s*\[\d+(?:\.\d+)?\]/g;
/** Removes confidence annotations: (Confidence: High) — note escaped parens. */
export const REGEX_CLEAN_CONF = /\s*\(Confidence:\s*\w+\)/gi;
/** Extracts confidence level from verdict text before cleaning. */
export const REGEX_EXTRACT_CONF = /\(Confidence:\s*(\w+)\)/i;

/**
 * Brand color map — used ONLY for hover styling and debug logging.
 * Brand names never appear in the response text. The phrase IS the link.
 */
export interface BrandInfo { name: string; color: string }
export const BRAND_COLOR_MAP: Record<string, BrandInfo> = {
  "espn.com":                        { name: "ESPN",     color: "#C2372E" },
  "covers.com":                      { name: "Covers",   color: "#1A8F3C" },
  "actionnetwork.com":               { name: "Action",   color: "#0066CC" },
  "draftkings.com":                  { name: "DK",       color: "#53D337" },
  "fanduel.com":                     { name: "FanDuel",  color: "#1493FF" },
  "rotowire.com":                    { name: "RotoWire", color: "#C2372E" },
  "basketball-reference.com":        { name: "BBRef",    color: "#D46A2F" },
  "sports-reference.com":            { name: "SportsRef",color: "#D46A2F" },
  "pro-football-reference.com":      { name: "PFRef",    color: "#D46A2F" },
  "nba.com":                         { name: "NBA",      color: "#1D428A" },
  "nfl.com":                         { name: "NFL",      color: "#013369" },
  "mlb.com":                         { name: "MLB",      color: "#002D72" },
  "nhl.com":                         { name: "NHL",      color: "#000000" },
  "cbssports.com":                   { name: "CBS",      color: "#0033A0" },
  "yahoo.com":                       { name: "Yahoo",    color: "#6001D2" },
  "bleacherreport.com":              { name: "BR",       color: "#000000" },
  "theathletic.com":                 { name: "Athletic", color: "#222222" },
  "x.com":                           { name: "X",        color: "#000000" },
  "twitter.com":                     { name: "X",        color: "#000000" },
  "google.com":                      { name: "Google",   color: "#4285F4" },
  "ai.google.dev":                   { name: "Google AI",color: "#4285F4" },
  "vertexaisearch.cloud.google.com": { name: "Google",   color: "#4285F4" },
  "discoveryengine.googleapis.com":  { name: "Google",   color: "#4285F4" },
};

/** Default brand info for unrecognized sources. */
export const DEFAULT_BRAND: BrandInfo = { name: "Web", color: "#71717A" };
/** Brand info for live satellite endpoints. */
export const LIVE_BRAND: BrandInfo = { name: "Live", color: "#10B981" };

/** Path-based brand overrides for live proxy endpoints. */
export const LIVE_PATH_BRANDS: Array<[RegExp, BrandInfo]> = [
  [/\/api\/live\/scores\//, { name: "Scores", color: "#10B981" }],
  [/\/api\/live\/odds\//,   { name: "Odds",   color: "#10B981" }],
  [/\/api\/live\/pbp\//,    { name: "PBP",    color: "#10B981" }],
];

export const EDGE_CARD_STAGE_DELAYS_MS = [0, 120, 220, 300, 480] as const;
export const EDGE_CARD_STAGGER_PER_CARD_MS = 150;
export const EDGE_CARD_SPRING = "cubic-bezier(0.16, 1, 0.3, 1)";
export const EDGE_CARD_EASE_OUT = "cubic-bezier(0.0, 0.0, 0.2, 1)";

export const LIVE_STATUS_TOKENS = ["IN_PROGRESS", "LIVE", "HALFTIME", "END_PERIOD", "Q1", "Q2", "Q3", "Q4", "OT"];
export const FINAL_STATUS_TOKENS = ["FINAL", "FINISHED", "COMPLETE"];

/** Static query map for SmartChips — hoisted to avoid per-render allocation. */
export const SMART_CHIP_QUERIES: Record<string, string> = {
  "Sharp Report": "Give me the full sharp report on this game.",
  "Best Bet": "What is the best bet for this game?",
  "Public Fade": "Where is the public heavy? Should I fade?",
  "Player Props": "Analyze the top player props.",
  "Edge Today": "What games have edge today?",
  "Line Moves": "Show me significant line moves.",
  "Public Splits": "What are the public betting splits?",
  "Injury News": "What's the latest injury news?",
  "Live Edge": "What live edges are available right now?",
  Momentum: "How has momentum shifted? Any live play?",
  "Live Games": "Which games are live right now with edge?",
  "In-Play Edge": "What are the best in-play opportunities?",
  Recap: "Recap tonight's results.",
  "What Tailed / Faded": "Which positions should I tail or fade based on tonight's outcomes?",
  "Tomorrow Slate": "Preview tomorrow's slate.",
  Bankroll: "How's my bankroll looking?",
  "New Slate": "What's on the slate today?",
  "My Record": "Show my recent record and ROI.",
  "Best Edge": "What's the highest confidence edge right now?",
  Promos: "Any sportsbook promos worth grabbing?",
  Futures: "Any futures with value right now?",
  "Sharp Money": "Where is the sharp money flowing?",
};

/**
 * Design system tokens — single source of truth.
 * `as Transition` casts required: Framer Motion's Transition union type
 * doesn't accept object literals directly. Safe — runtime values match shape.
 */
export const SYSTEM = {
  anim: {
    fluid: { type: "spring", damping: 30, stiffness: 380, mass: 0.8 } as Transition,
    snap: { type: "spring", damping: 22, stiffness: 450 } as Transition,
    draw: { duration: 0.6, ease: "circOut" } as Transition,
    morph: { type: "spring", damping: 25, stiffness: 280 } as Transition,
  },
  surface: {
    void: "bg-surface-base",
    panel: "bg-surface-base border border-edge",
    /** Liquid Glass 2.0: Deep blur (24px), high saturation (180%), top-edge specular. */
    glass: "bg-white/[0.025] backdrop-blur-[24px] backdrop-saturate-[180%] border border-edge-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
    hud: "bg-[linear-gradient(180deg,rgba(251,191,36,0.05)_0%,rgba(0,0,0,0)_100%)] border border-amber-500/20 shadow-[inset_0_1px_0_rgba(245,158,11,0.1)]",
    milled: "border-t border-edge-strong border-b border-black/50 border-x border-edge-subtle",
    alert: "bg-[linear-gradient(180deg,rgba(225,29,72,0.05)_0%,rgba(0,0,0,0)_100%)] border border-rose-500/20 shadow-[inset_0_1px_0_rgba(225,29,72,0.1)]",
  },
  type: {
    mono: "font-mono text-caption tracking-expanded uppercase text-zinc-500 tabular-nums",
    body: "text-body-lg leading-[1.72] tracking-[-0.005em] text-zinc-300",
    h1: "text-body-sm font-medium tracking-tight text-white",
    label: "text-label font-bold tracking-[0.05em] uppercase text-zinc-500",
  },
  geo: { pill: "rounded-full", card: "rounded-[22px]", input: "rounded-[24px]" },
} as const;

export const RETRY_CONFIG = { maxAttempts: 3, baseDelay: 1000, maxDelay: 8000, jitterFactor: 0.3 } as const;
export const SEND_DEBOUNCE_MS = 300;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
