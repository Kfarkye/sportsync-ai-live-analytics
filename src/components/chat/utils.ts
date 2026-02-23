/**
 * ChatWidget Utilities
 * Extracted from ChatWidget.tsx §3
 * 
 * Pure functions — no React, no side effects (except triggerHaptic).
 */

import type { ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type {
  GroundingChunk,
  GroundingSupport,
  GroundingMetadata,
  Message,
  MessageContent,
  GameContext,
  Attachment,
} from "./types";
import {
  REGEX_CITATION_PLACEHOLDER,
  REGEX_SPLIT_COMMA,
  REGEX_MULTI_SPACE,
  REGEX_CLEAN_CITE_LINK,
  REGEX_CLEAN_SUPPORT_CITE,
  REGEX_CLEAN_HYDRATED_CITE,
  REGEX_CLEAN_SUPERSCRIPT_CITE,
  REGEX_CLEAN_LINK,
  REGEX_CLEAN_REF,
  REGEX_CLEAN_CONF,
  REGEX_EXTRACT_CONF,
  REGEX_SIGNED_NUMERIC,
  REGEX_VERDICT_MATCH,
  REGEX_EDGE_SECTION_HEADER,
  REGEX_MATCHUP_LINE,
  EXCLUDED_SECTIONS,
  CITE_MARKER,
  BRAND_COLOR_MAP,
  DEFAULT_BRAND,
  LIVE_BRAND,
  LIVE_PATH_BRANDS,
  LIVE_STATUS_TOKENS,
  FINAL_STATUS_TOKENS,
  type BrandInfo,
} from "./config";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* fallback */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function triggerHaptic(): void {
  try { if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(4); } catch { /* silent */ }
}

export function flattenText(children: ReactNode): string {
  return React.Children.toArray(children).reduce<string>((acc, child) => {
    if (typeof child === "string") return acc + child;
    if (typeof child === "number") return acc + String(child);
    if (React.isValidElement<{ children?: ReactNode }>(child)) return acc + flattenText(child.props.children);
    return acc;
  }, "");
}

export function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "textarea" || tag === "input" || el.getAttribute("contenteditable") === "true";
}

export function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** DJB2 hash of chunk URIs for collision-safe cache keys. */
export function chunkFingerprint(chunks: GroundingChunk[]): string {
  let hash = 0;
  const uris = chunks.map((c) => c.web?.uri ?? "").join("|");
  for (let i = 0; i < uris.length; i++) hash = ((hash << 5) - hash + uris.charCodeAt(i)) | 0;
  return hash.toString(36);
}

/**
 * LRU cache using Map insertion-order guarantee.
 * On get: re-inserts entry to mark as recently used.
 * On set: evicts oldest entry when capacity exceeded.
 * Eliminates the full-wipe render spikes of the previous Map.clear() strategy.
 */
export class LRUCache<K, V> {
  private readonly max: number;
  private readonly map = new Map<K, V>();

  constructor(max: number) {
    this.max = max;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      // Delete oldest (first entry in insertion order)
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

const supportCitationCache = new LRUCache<string, string>(256);

/**
 * Support-based Citation Inserter (Descending Index Algorithm).
 *
 * Maps Gemini groundingSupports to exact phrases in the response text,
 * wrapping each supported phrase as an invisible inline hyperlink.
 *
 * Design: The phrase IS the link. No brand names appear in the text.
 * No "per ESPN", no "[1]", no attribution language. Clean prose.
 * Hover reveals source via brand-color underline.
 *
 * Falls back to hydrateCitations() when groundingSupports is absent.
 */
export function injectSupportCitations(
  text: string,
  metadata?: GroundingMetadata,
  isStreaming?: boolean,
): string {
  // Gate: only run on completed (non-streaming) messages with valid supports
  if (
    !text ||
    isStreaming ||
    !metadata?.groundingSupports?.length ||
    !metadata?.groundingChunks?.length
  ) {
    return hydrateCitations(text, metadata);
  }

  const supports = metadata.groundingSupports;
  const chunks = metadata.groundingChunks;
  const cacheKey = `support2:${text.length}:${text.slice(0, 64)}:${supports.length}:${chunkFingerprint(chunks)}`;
  const cached = supportCitationCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const textBytes = encoder.encode(text);

  // Step 1: Build resolved supports with character-level positions
  interface ResolvedSupport {
    charStart: number;
    charEnd: number;
    uri: string;           // First valid source URI
    brandColor: string;    // Brand hover color (for data attribute)
  }

  const resolved: ResolvedSupport[] = [];

  for (const support of supports) {
    const { segment, groundingChunkIndices } = support;
    if (!segment || !groundingChunkIndices?.length) continue;

    const startIndex = segment.startIndex ?? 0;
    const endIndex = segment.endIndex ?? 0;
    // Degenerate segment guard
    if (endIndex <= 0 || startIndex >= endIndex) continue;
    if (endIndex > textBytes.length) continue;

    // Resolve character positions from byte offsets
    let charStart: number;
    let charEnd: number;

    const decodedStart = decoder.decode(textBytes.slice(0, startIndex));
    charStart = decodedStart.length;
    const decodedEnd = decoder.decode(textBytes.slice(0, endIndex));
    charEnd = decodedEnd.length;

    // Verification: if segment.text is provided, confirm alignment
    if (segment.text) {
      const decodedSegment = decoder.decode(textBytes.slice(startIndex, endIndex));
      if (decodedSegment !== segment.text) {
        // Byte/char mismatch — fall back to indexOf
        const found = text.indexOf(segment.text);
        if (found === -1) continue;
        charStart = found;
        charEnd = found + segment.text.length;
      }
    }

    // Skip segments inside fenced code blocks
    const prefix = text.slice(0, charStart);
    const fenceCount = (prefix.match(/```/g) || []).length;
    if (fenceCount % 2 !== 0) continue;

    // Also skip inline code spans
    const segmentText = text.slice(charStart, charEnd);
    if (segmentText.includes("`")) continue;

    // Resolve chunk indices to first valid source URI
    // M-10: Filter out generic "Google" citations
    let bestUri = "";
    let bestBrand: BrandInfo = DEFAULT_BRAND;
    for (const idx of groundingChunkIndices) {
      if (idx < 0 || idx >= chunks.length) continue;
      const chunk = chunks[idx];
      if (!shouldRenderCitation(chunk)) continue; // M-10
      const uri = chunk?.web?.uri;
      if (!uri) continue;
      bestUri = uri;
      bestBrand = uriToBrandInfo(uri, chunk?.web?.title);
      break; // First valid source
    }

    if (!bestUri) continue;
    resolved.push({ charStart, charEnd, uri: bestUri, brandColor: bestBrand.color });
  }

  if (resolved.length === 0) {
    return hydrateCitations(text, metadata);
  }

  // Step 2: Sort by endIndex DESCENDING — bottom-to-top insertion prevents index shifting
  resolved.sort((a, b) => b.charEnd - a.charEnd);

  // Step 3: Remove overlapping segments — keep the longer segment
  const deduped: ResolvedSupport[] = [];
  for (const r of resolved) {
    const last = deduped[deduped.length - 1];
    // Since sorted descending by charEnd, overlaps occur when r.charEnd > last.charStart
    if (last && r.charEnd > last.charStart) {
      // Overlap detected — keep whichever is longer
      const lastLen = last.charEnd - last.charStart;
      const rLen = r.charEnd - r.charStart;
      if (rLen > lastLen) {
        deduped[deduped.length - 1] = r; // Replace with longer
      }
      // else: keep existing (already longer)
    } else {
      deduped.push(r);
    }
  }

  // Step 4: Splice — wrap each supported phrase as a markdown link (descending order preserves indices)
  let result = text;
  for (const { charStart, charEnd, uri, brandColor } of deduped) {
    const phraseText = result.slice(charStart, charEnd);
    // Skip empty or whitespace-only segments
    if (!phraseText.trim()) continue;
    // Escape any markdown link syntax already in the phrase
    const safePhrase = phraseText.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    // Encode brand color in the CITE_MARKER for the renderer
    const wrappedPhrase = `[${safePhrase}](${uri}${CITE_MARKER}${encodeURIComponent(brandColor)})`;
    result = result.slice(0, charStart) + wrappedPhrase + result.slice(charEnd);
  }

  supportCitationCache.set(cacheKey, result);
  return result;
}

const hydrationCache = new LRUCache<string, string>(256);

/** Unicode superscript digits for fallback citation numbers. */
export const SUPERSCRIPT_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
export function toSuperscript(n: number): string {
  return String(n).split("").map((d) => SUPERSCRIPT_DIGITS[parseInt(d, 10)] || d).join("");
}

/**
 * Fallback Citation Hydration (Superscript Numbers).
 *
 * Fires only when groundingSupports is absent. Replaces bracket citation
 * tokens ([1], [1.1], [1, 2]) with small superscript number links.
 * No brand names appear in the text — the fallback is degraded but invisible.
 *
 * Before: "Price fell to $15K [1] [2]. Erased all gains [1]."
 * After:  "Price fell to $15K[¹](url#__cite_sup__)[²](url#__cite_sup__). Erased all gains[¹](url#__cite_sup__)."
 */
export function hydrateCitations(text: string, metadata?: GroundingMetadata): string {
  if (!text || !metadata?.groundingChunks?.length) return text;
  const chunks = metadata.groundingChunks;
  const cacheKey = `inline2:${text.length}:${text.slice(0, 64)}:${chunks.length}:${chunkFingerprint(chunks)}`;
  const cached = hydrationCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const maxIndex = chunks.length;

  // Guard: Split on fenced code blocks — only hydrate prose segments.
  const CODE_FENCE = /(```[\s\S]*?```)/g;
  const segments = text.split(CODE_FENCE);

  // Matches one or more adjacent bracket tokens: [1] [2] or [1, 2] [3]
  const REGEX_ADJACENT_CITATIONS = /(?:\[(\d+(?:\.\d+)?(?:[\s,]+\d+(?:\.\d+)?)*)\](?!\()[\s]*)+/g;

  const hydrated = segments.map((segment) => {
    if (segment.startsWith("```")) return segment;

    return segment.replace(REGEX_ADJACENT_CITATIONS, (fullMatch) => {
      const superscripts: string[] = [];
      const seenUri = new Set<string>();

      let m: RegExpExecArray | null;
      const tokenRe = /\[(\d+(?:\.\d+)?(?:[\s,]+\d+(?:\.\d+)?)*)\](?!\()/g;
      while ((m = tokenRe.exec(fullMatch)) !== null) {
        const parts = m[1].split(REGEX_SPLIT_COMMA).filter((p: string) => p.trim());
        for (const part of parts) {
          const trimmed = part.trim();
          const num = parseFloat(trimmed);
          if (Number.isNaN(num)) continue;
          const index = Math.floor(num) - 1;
          if (index < 0 || index >= maxIndex) continue;
          const chunk = chunks[index];
          if (!shouldRenderCitation(chunk)) continue; // M-10
          const uri = chunk?.web?.uri;
          if (uri && !seenUri.has(uri)) {
            seenUri.add(uri);
            const sup = toSuperscript(index + 1);
            superscripts.push(`[${sup}](${uri}#__cite_sup__)`);
          }
        }
      }

      if (superscripts.length === 0) return fullMatch;
      return superscripts.join("");
    });
  }).join("");

  const cleaned = hydrated.replace(REGEX_MULTI_SPACE, " ");
  hydrationCache.set(cacheKey, cleaned);
  return cleaned;
}


export function extractTextContent(content: MessageContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.find((c) => c.type === "text")?.text ?? "";
  return "";
}

export function cleanVerdictContent(text: string): string {
  if (!text) return "";
  const cleaned = text
    .replace(REGEX_CLEAN_CITE_LINK, "$1")       // [phrase](url#__cite__...) → phrase
    .replace(REGEX_CLEAN_SUPERSCRIPT_CITE, "")   // [¹](url#__cite_sup__) → ""
    .replace(REGEX_CLEAN_SUPPORT_CITE, "")       // legacy: " per [Brand](url)" → ""
    .replace(REGEX_CLEAN_HYDRATED_CITE, "")      // legacy: " ([Brand](url))" → ""
    .replace(REGEX_CLEAN_LINK, "")               // [1](url) → ""
    .replace(REGEX_CLEAN_REF, "")                // [1] → ""
    .replace(REGEX_CLEAN_CONF, "")               // (Confidence: High) → ""
    .replace(REGEX_MULTI_SPACE, " ")
    .trim();
  // M-26: Normalize typography
  return normalizeTypography(cleaned);
}

type ConfidenceLevel = "high" | "medium" | "low";

/** Extract confidence level from raw verdict text before it gets cleaned. */
export function extractConfidence(text: string): ConfidenceLevel {
  const match = REGEX_EXTRACT_CONF.exec(text);
  if (!match) return "high"; // default — most verdicts are high confidence
  const level = match[1].toLowerCase();
  if (level === "medium" || level === "med") return "medium";
  if (level === "low") return "low";
  return "high";
}

/** Maps confidence level to visual bar percentage. */
export function confidenceToPercent(level: ConfidenceLevel): number {
  switch (level) {
    case "high": return 88;
    case "medium": return 58;
    case "low": return 30;
  }
}

export function hostnameToBrandInfo(hostname: string): BrandInfo {
  const h = hostname.replace(/^www\./, "").toLowerCase();
  if (BRAND_COLOR_MAP[h]) return BRAND_COLOR_MAP[h];
  // Walk up subdomains: "vertexaisearch.cloud.google.com" → "cloud.google.com" → "google.com"
  const parts = h.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    if (BRAND_COLOR_MAP[parent]) return BRAND_COLOR_MAP[parent];
  }
  const base = parts[0] || "Source";
  return { name: base.charAt(0).toUpperCase() + base.slice(1), color: DEFAULT_BRAND.color };
}

export function getHostname(href?: string): string {
  if (!href) return "Source";
  try { return new URL(href).hostname.replace(/^www\./, ""); } catch { return "Source"; }
}

/**
 * Brand resolution — resolves source identity (name + hover color) for a grounding chunk.
 *
 * Google Search grounding returns redirect URIs through vertexaisearch.cloud.google.com.
 * The URI hostname resolves to "Google" for every source. The chunk's title field contains
 * the ACTUAL source domain (e.g. "espn.com", "basketball-reference.com"). Title takes
 * priority over hostname when it looks like a domain.
 *
 * Brand names are used ONLY for hover color resolution and debug logging.
 * They never appear as visible text in the response.
 */
/**
 * M-10: Filter out generic search engine citations that should never be visible.
 * Returns true if the citation should be rendered, false if it should be hidden.
 */
export function shouldRenderCitation(chunk: GroundingChunk): boolean {
  const title = (chunk?.web?.title || "").toLowerCase().trim();
  const uri = chunk?.web?.uri || "";

  // Filter generic "Google" / "Google Search" citations
  if (title === "google" || title === "google search") return false;
  if (/^https?:\/\/(www\.)?google\.(com|[a-z]{2})\/?$/.test(uri)) return false;

  return true;
}

export function uriToBrandInfo(href?: string, title?: string): BrandInfo {
  if (!href) return DEFAULT_BRAND;
  // 1. Live endpoint paths (satellite proxies)
  try {
    const url = new URL(href);
    for (const [pattern, brand] of LIVE_PATH_BRANDS) {
      if (pattern.test(url.pathname)) return brand;
    }
  } catch { /* fall through */ }
  // 2. Title field — actual source domain for Google Search grounding
  if (title) {
    const t = title.replace(/^www\./, "").toLowerCase().trim();
    if (t.includes(".")) return hostnameToBrandInfo(t);
    // Title without dots — check if it contains a known brand keyword
    const tLower = t.toLowerCase();
    if (tLower.includes("espn"))                   return BRAND_COLOR_MAP["espn.com"];
    if (tLower.includes("basketball-reference"))   return BRAND_COLOR_MAP["basketball-reference.com"];
    if (tLower.includes("the athletic") || tLower.includes("theathletic")) return BRAND_COLOR_MAP["theathletic.com"];
    if (tLower.includes("covers"))                 return BRAND_COLOR_MAP["covers.com"];
  }
  // 3. URI hostname fallback
  return hostnameToBrandInfo(getHostname(href));
}

export function buildWireContent(text: string, attachments: Attachment[]): MessageContent {
  if (attachments.length === 0) return text;
  const parts: MessagePart[] = [{ type: "text", text: text || "Analyze this." }];
  for (const a of attachments) {
    parts.push(
      a.mimeType.startsWith("image/")
        ? { type: "image", source: { type: "base64", media_type: a.mimeType, data: a.base64 } }
        : { type: "file", source: { type: "base64", media_type: a.mimeType, data: a.base64 } }
    );
  }
  return parts;
}

export function getRetryDelay(attempt: number): number {
  const delay = Math.min(RETRY_CONFIG.baseDelay * Math.pow(2, attempt), RETRY_CONFIG.maxDelay);
  const jitter = delay * RETRY_CONFIG.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, delay + jitter);
}

export function getTimePhase(): "pregame" | "live" | "postgame" {
  const hour = new Date().getHours();
  if (hour < 16) return "pregame";
  if (hour < 23) return "live";
  return "postgame";
}

export function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function toNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeGameContext(
  currentMatch?: GameContext | null,
  storedMatch?: Record<string, unknown> | null,
): GameContext | null {
  const raw = (currentMatch || {}) as Record<string, unknown>;
  const store = (storedMatch || {}) as Record<string, unknown>;
  const homeTeam = (raw.homeTeam as Record<string, unknown> | undefined)?.name;
  const awayTeam = (raw.awayTeam as Record<string, unknown> | undefined)?.name;
  const startRaw = raw.start_time ?? raw.startTime ?? store.start_time;
  const startIso =
    typeof startRaw === "string"
      ? startRaw
      : startRaw instanceof Date
        ? startRaw.toISOString()
        : undefined;
  const normalized: GameContext = {
    ...store,
    match_id: toStringOrUndefined(store.match_id) || toStringOrUndefined(raw.match_id) || toStringOrUndefined(raw.id),
    home_team: toStringOrUndefined(store.home_team) || toStringOrUndefined(raw.home_team) || toStringOrUndefined(homeTeam),
    away_team: toStringOrUndefined(store.away_team) || toStringOrUndefined(raw.away_team) || toStringOrUndefined(awayTeam),
    league: toStringOrUndefined(store.league) || toStringOrUndefined(raw.league) || toStringOrUndefined(raw.leagueId),
    sport: toStringOrUndefined(store.sport) || toStringOrUndefined(raw.sport),
    start_time: startIso,
    status: toStringOrUndefined(raw.status) || toStringOrUndefined(raw.game_status) || toStringOrUndefined(store.status),
    period: toNumberOrUndefined(raw.period),
    clock: toStringOrUndefined(raw.displayClock) || toStringOrUndefined(raw.display_clock) || toStringOrUndefined(raw.clock) || toStringOrUndefined(store.clock),
    home_score: toNumberOrUndefined(raw.homeScore) ?? toNumberOrUndefined(raw.home_score),
    away_score: toNumberOrUndefined(raw.awayScore) ?? toNumberOrUndefined(raw.away_score),
    current_odds: (raw.current_odds as MatchOdds | undefined) || (raw.odds as MatchOdds | undefined) || (store.current_odds as MatchOdds | undefined),
    opening_odds: (raw.opening_odds as MatchOdds | undefined) || (store.opening_odds as MatchOdds | undefined),
    closing_odds: (raw.closing_odds as MatchOdds | undefined) || (store.closing_odds as MatchOdds | undefined),
  };
  const hasSignal = Boolean(
    normalized.match_id ||
      normalized.home_team ||
      normalized.away_team ||
      normalized.current_odds ||
      normalized.home_score !== undefined ||
      normalized.away_score !== undefined,
  );
  return hasSignal ? normalized : null;
}

export function resolveConfidenceValue(level: ConfidenceLevel, rawText?: string): number {
  const explicit = rawText?.match(/\b(\d{1,3})%\b/);
  if (explicit) {
    const numeric = Number(explicit[1]);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.min(100, numeric));
    }
  }
  return confidenceToPercent(level);
}

interface ParsedEdgeVerdict {
  teamName: string;
  spread: string;
  odds: string;
  summaryLabel: string;
}

export function parseEdgeVerdict(rawVerdict: string): ParsedEdgeVerdict {
  const cleaned = cleanVerdictContent(rawVerdict)
    .replace(/^\*+|\*+$/g, "")
    // Strip parenthetical bet-type labels: (Live Spread), (Moneyline), (ML), (Asian Handicap), (Pregame), etc.
    .replace(/\s*\((?:Live\s+)?(?:Spread|Moneyline|ML|Asian\s+Handicap|Pregame|Alt(?:ernate)?\s+\w+|Game\s+\w+|Match\s+\w+)[^)]*\)/gi, "")
    // Strip trailing "/ value" patterns — raw total leaking from schema
    .replace(/\s*\/\s*[OoUu]?\d+(?:\.\d+)?\s*$/, "")
    // Fix leading zeros on numeric values: 01.5 → 1.5
    .replace(/\b0+(\d+(?:\.\d+)?)/g, "$1")
    // Replace hyphen-minus before digits with proper minus sign (U+2212)
    .replace(/-(?=\d)/g, "\u2212")
    .trim();
  if (!cleaned) {
    return { teamName: "No Edge", spread: "N/A", odds: "N/A", summaryLabel: "" };
  }
  const signedMatches = Array.from(cleaned.matchAll(REGEX_SIGNED_NUMERIC));
  const totalMatch = cleaned.match(/^(.*?)\b(over|under)\s*(\d+(?:\.\d+)?)/i);
  if (signedMatches.length === 0) {
    if (totalMatch) {
      const prefix = (totalMatch[1] || "").replace(/[—:-]+$/g, "").trim();
      const totalPrefix = totalMatch[2].charAt(0).toLowerCase();
      return {
        teamName: prefix || "Total",
        spread: `${totalPrefix}${totalMatch[3]}`,
        odds: "N/A",
        summaryLabel: cleaned,
      };
    }
    return {
      teamName: cleaned,
      spread: /\bML\b/i.test(cleaned) ? "ML" : "N/A",
      odds: "N/A",
      summaryLabel: cleaned,
    };
  }
  if (totalMatch) {
    const prefix = (totalMatch[1] || "").replace(/[—:-]+$/g, "").trim();
    const totalPrefix = totalMatch[2].charAt(0).toLowerCase();
    const lastSigned = signedMatches[signedMatches.length - 1][0];
    return {
      teamName: prefix || "Total",
      spread: `${totalPrefix}${totalMatch[3]}`,
      odds: lastSigned,
      summaryLabel: cleaned,
    };
  }
  if (/\bML\b/i.test(cleaned) && signedMatches.length >= 1) {
    const firstSigned = signedMatches[0];
    const teamRaw = cleaned
      .slice(0, firstSigned.index)
      .replace(/\bML\b/i, "")
      .replace(/[(@-]+$/g, "")
      .trim();
    const odds = signedMatches[signedMatches.length - 1][0];
    return { teamName: teamRaw || cleaned, spread: "ML", odds, summaryLabel: cleaned };
  }
  const firstSigned = signedMatches[0];
  const lastSigned = signedMatches[signedMatches.length - 1];
  const teamRaw = cleaned
    .slice(0, firstSigned.index)
    .replace(/\bML\b/i, "")
    .replace(/[(@-]+$/g, "")
    .trim();
  const spread = signedMatches.length >= 2
    ? firstSigned[0]
    : /\bML\b/i.test(cleaned) ? "ML" : firstSigned[0];
  const odds = signedMatches.length >= 2 ? lastSigned[0] : "N/A";
  return { teamName: teamRaw || cleaned, spread, odds, summaryLabel: cleaned };
}

export function extractEdgeSynopses(rawText: string): string[] {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/);
  const synopses: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || "";
    if (!REGEX_VERDICT_MATCH.test(line)) continue;
    let synopsis = "";
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = (lines[j] || "").trim();
      if (!nextLine) continue;
      if (REGEX_VERDICT_MATCH.test(nextLine)) break;
      // If line IS a section header, extract any content after the header label
      const headerMatch = nextLine.match(REGEX_EDGE_SECTION_HEADER);
      const candidate = headerMatch
        ? nextLine.slice(headerMatch[0].length).replace(/^[:\s*]+/, "").trim()
        : nextLine;
      if (!candidate) continue;
      const cleanedLine = candidate
        .replace(/^[-*•]\s*/, "")
        .replace(/\*+/g, "")
        .replace(REGEX_CITATION_PLACEHOLDER, "")
        .replace(REGEX_MULTI_SPACE, " ")
        .trim();
      if (!cleanedLine || cleanedLine.length < 10) continue;
      synopsis = cleanedLine;
      break;
    }
    synopses.push(synopsis);
  }
  return synopses;
}

export function extractMatchupLines(rawText: string): string[] {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/);
  const matchups: string[] = [];
  for (const line of lines) {
    const match = line.trim().match(REGEX_MATCHUP_LINE);
    if (match?.[1]) {
      const cleaned = match[1].replace(/\*+/g, "").replace(/^:+/, "").trim();
      matchups.push(normalizeTypography(cleaned));
    }
  }
  return matchups;
}

export function stripMatchupLines(content: string): string {
  if (!content) return content;
  const lines = content.split(/\r?\n/);
  return lines.filter(line => !REGEX_MATCHUP_LINE.test(line.trim())).join("\n");
}

export function splitPickContent(rawContent: string): { pickContent: string; analysisBlocks: string[] } {
  if (!rawContent) return { pickContent: rawContent, analysisBlocks: [] };
  const lines = rawContent.split("\n");
  const verdictIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (REGEX_VERDICT_MATCH.test(lines[i])) verdictIndices.push(i);
  }
  if (verdictIndices.length === 0) return { pickContent: rawContent, analysisBlocks: [] };

  const pickSegments: string[] = [];
  const analysisBlocks: string[] = [];
  const preamble = lines.slice(0, verdictIndices[0]).join("\n").trim();
  if (preamble) pickSegments.push(preamble);

  for (let v = 0; v < verdictIndices.length; v++) {
    const start = verdictIndices[v];
    const end = v + 1 < verdictIndices.length ? verdictIndices[v + 1] : lines.length;
    const block = lines.slice(start, end);

    // Find where analysis section headers begin (e.g. **KEY FACTORS**)
    let analysisStartIndex = -1;
    for (let i = 1; i < block.length; i++) {
      const trimmed = block[i].trim();
      if (!trimmed) continue;
      const stripped = trimmed.replace(/\*+/g, "").trim().toUpperCase();
      if (REGEX_EDGE_SECTION_HEADER.test(stripped)) {
        analysisStartIndex = i;
        break;
      }
      let nextNonEmpty = "";
      for (let j = i + 1; j < block.length; j++) {
        if (block[j].trim()) { nextNonEmpty = block[j].trim().replace(/\*+/g, "").trim().toUpperCase(); break; }
      }
      if (REGEX_EDGE_SECTION_HEADER.test(nextNonEmpty)) {
        continue;
      }
    }

    // Pick part = ONLY the verdict line itself + matchup lines.
    // Body text (synopsis) after the verdict line is already rendered
    // inside EdgeVerdictCard via the synopses prop — including it here
    // causes the text to render twice (once in the card, once below it).
    const verdictLine = block[0];
    const matchupLines = block.slice(1, analysisStartIndex === -1 ? block.length : analysisStartIndex)
      .filter(l => REGEX_MATCHUP_LINE.test(l.trim()));
    const pickPart = [verdictLine, ...matchupLines].join("\n");
    const analysisPart = analysisStartIndex === -1 ? "" : block.slice(analysisStartIndex).join("\n");

    if (pickPart.trim()) pickSegments.push(pickPart.trim());
    if (analysisPart.trim()) analysisBlocks.push(stripExcludedSections(analysisPart.trim()));
  }

  return {
    pickContent: stripExcludedSections(pickSegments.join("\n\n")),
    analysisBlocks,
  };
}

/**
 * M-05/M-06: Normalize section header text.
 * Strips trailing "LIVE", "PREGAME", trailing colons/punctuation.
 * Also strips leading bullet characters (M-13).
 */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/^[●•·‣]\s*/, "")             // M-13: Strip leading bullet (incl. emerald ●)
    .replace(/\*+/g, "")                    // Strip bold markdown artifacts
    .replace(/\s+LIVE\s*$/i, "")           // M-05: "WHAT TO WATCH LIVE" → "WHAT TO WATCH"
    .replace(/\s+PREGAME\s*$/i, "")        // Guard against "WHAT TO WATCH PREGAME"
    .replace(/:+\s*$/, "")                 // M-06: "INVALIDATION:" → "INVALIDATION"
    .trim();
}

/**
 * Strip excluded sections (e.g. "THE EDGE") from markdown content.
 * Walks lines: when an excluded section header is found, skips all lines
 * until the next recognized (non-excluded) section header.
 */
export function stripExcludedSections(content: string): string {
  if (!content) return content;
  const lines = content.split("\n");
  const result: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const stripped = line.replace(/\*+/g, "").replace(/^[●•·‣]\s*/, "").trim();
    const upper = stripped.toUpperCase();

    if (REGEX_EDGE_SECTION_HEADER.test(upper)) {
      const headerName = stripped.replace(/[:\s]+$/, "").toLowerCase();
      if (EXCLUDED_SECTIONS.some(s => headerName === s)) {
        skipping = true;
        continue;
      }
      // Non-excluded section header — stop skipping
      skipping = false;
    }

    if (!skipping) {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * M-26: Normalize typography — proper em-dashes, ellipsis, smart quotes.
 * Applied to prose content for typographic polish.
 * Note: Smart quote replacement is conservative — only applies to clear prose
 * patterns, never inside numbers, odds values, or code-like content.
 */
export function normalizeTypography(text: string): string {
  return text
    .replace(/--/g, "\u2014")               // Double hyphen → em-dash
    .replace(/(\d)\u2013(\d)/g, "$1\u2013$2") // Keep en-dash between numbers
    .replace(/(?<!\d)\u2013(?!\d)/g, "\u2014") // En-dash in prose → em-dash
    .replace(/\.{3}/g, "\u2026")            // Three dots → ellipsis
    .replace(/(^|[\s(])"(?=\S)/gm, "$1\u201C") // Smart open double quote (after whitespace/start)
    .replace(/"(?=[\s,.;:!?)—\u2014]|$)/gm, "\u201D") // Smart close double quote (before punct/end)
    .replace(/(^|[\s(])'(?=\S)/gm, "$1\u2018") // Smart open single quote (after whitespace/start)
    .replace(/'(?=[\s,.;:!?)—\u2014]|$)/gm, "\u2019"); // Smart close single/apostrophe
}

/**
 * M-15: Normalize team names to canonical display forms.
 * Maps formal/abbreviated names to the common display name.
 */
export const TEAM_DISPLAY_NAMES: Record<string, string> = {
  // Serie A
  "Internazionale": "Inter Milan",
  "Inter": "Inter Milan",
  "FC Internazionale Milano": "Inter Milan",
  "Juventus FC": "Juventus",
  "AC Milan": "Milan",
  "SSC Napoli": "Napoli",
  "AS Roma": "Roma",
  "SS Lazio": "Lazio",
  // La Liga
  "FC Barcelona": "Barcelona",
  "Real Madrid CF": "Real Madrid",
  "Club Atletico de Madrid": "Atlético Madrid",
  "Atletico Madrid": "Atlético Madrid",
  // Bundesliga
  "FC Bayern München": "Bayern München",
  "Bayern Munich": "Bayern München",
  "Borussia Dortmund": "Dortmund",
  "RB Leipzig": "Leipzig",
  "Bayer 04 Leverkusen": "Leverkusen",
  // Ligue 1
  "Paris Saint-Germain": "PSG",
  "Paris Saint-Germain FC": "PSG",
  "Olympique de Marseille": "Marseille",
  "Olympique Lyonnais": "Lyon",
  // Premier League
  "Manchester United": "Man United",
  "Manchester City": "Man City",
  "Tottenham Hotspur": "Tottenham",
  "Wolverhampton Wanderers": "Wolves",
  "West Ham United": "West Ham",
  "Newcastle United": "Newcastle",
  // Liga MX
  "Club América": "América",
  "CF Monterrey": "Monterrey",
  "Club León": "León",
  "Guadalajara": "Chivas",
  "CD Guadalajara": "Chivas",
  // MLS
  "Los Angeles FC": "LAFC",
  "New York Red Bulls": "NY Red Bulls",
  "Inter Miami CF": "Inter Miami",
  // NFL formal names
  "New England Patriots": "Patriots",
  "Kansas City Chiefs": "Chiefs",
  "San Francisco 49ers": "49ers",
  "Green Bay Packers": "Packers",
  "Tampa Bay Buccaneers": "Buccaneers",
};

export function normalizeTeamName(raw: string): string {
  return TEAM_DISPLAY_NAMES[raw] || raw;
}

/**
 * M-07: Parse "WHAT TO WATCH" flat prose into structured layers.
 * Splits "IF X → THEN Y, as Z" into condition/action/reasoning.
 */
export function parseWatchFallback(text: string): {
  condition: string; action: string; reasoning: string;
} {
  const arrowSplit = text.split(/\s*→\s*/);
  if (arrowSplit.length >= 2) {
    const condition = arrowSplit[0]
      .replace(/^(?:WHAT TO WATCH\s*(?:LIVE)?\s*)?/i, "")
      .replace(/^IF\s+/i, "")
      .trim();
    const afterArrow = arrowSplit.slice(1).join("→");
    const commaSplit = afterArrow.split(/,\s*(?:as|because|since)\s+/i);
    const action = (commaSplit[0] || "")
      .replace(/^THEN\s+/i, "")
      .replace(/^look for\s+/i, "")
      .trim();
    const reasoning = (commaSplit[1] || "").trim();
    return { condition, action, reasoning };
  }
  return { condition: text, action: "", reasoning: "" };
}

export function extractVerdictPayload(text: string): string {
  if (!text) return "";
  const verdictIdx = text.toLowerCase().indexOf("verdict:");
  if (verdictIdx === -1) return text.trim();
  return text.slice(verdictIdx + "verdict:".length).trim();
}

export function deriveGamePhase(gameContext?: GameContext | null): "pregame" | "live" | "postgame" {
  if (!gameContext) return getTimePhase();
  const status = String(gameContext.status || "").toUpperCase();
  if (LIVE_STATUS_TOKENS.some((token) => status.includes(token))) return "live";
  if (FINAL_STATUS_TOKENS.some((token) => status.includes(token))) return "postgame";
  if (gameContext.start_time) {
    const kickoff = new Date(gameContext.start_time).getTime();
    if (Number.isFinite(kickoff)) {
      const deltaMs = kickoff - Date.now();
      if (deltaMs <= -2 * 60 * 60 * 1000) return "postgame";
      if (deltaMs <= 0) return "live";
    }
  }
  return "pregame";
}

export function getMatchupLabel(gameContext?: GameContext | null): string | null {
  const home = gameContext?.home_team;
  const away = gameContext?.away_team;
  if (home && away) return `${away} @ ${home}`;
  if (home || away) return `${away || home}`;
  return null;
}

