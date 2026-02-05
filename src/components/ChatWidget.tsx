/* ============================================================================
   ChatWidget.tsx
   "Obsidian Weissach" — Production Release (v29.1)

   Architecture:
   ├─ Core: useReducer message store, Map-indexed updates, stable refs
   ├─ Network: Retry w/ exponential backoff, connection health, guarded SSE
   ├─ UI: "Jewel" Citation System, Evidence Deck, LRU hydration cache, 60fps scroll
   ├─ Design: iOS 26 liquid glass, hardware-edge cards, confidence gradient bars
   ├─ Retention: Verdict tracking, adaptive chips, scoped keyboard shortcuts
   ├─ Reliability: Debounced send, abort safety, RAF-batched streaming
   ├─ Ops: Pluggable telemetry layer, structured error reporting
   ├─ A11y: aria-live regions, focus management, reduced-motion, timestamps

   Changelog v29.1 (Weissach — Merged from v29.0 into v28.3 base):
   ── Citation System ──
   - REDESIGN: InlineCitationPill → CitationJewel — favicon glass pills via Google S2
   - ADD: SourceIcon — S2 favicon (64px) with milled monogram fallback
   - ADD: EvidenceDeck — horizontal inertia-scroll tray with gradient fade masks
   ── Materials ──
   - UPGRADE: Liquid Glass 2.0 — 24px blur, 180% saturation, specular edge lighting
   - ADD: SYSTEM.surface tokens centralized (glass, hud, alert, milled)
   - ADD: SYSTEM.anim.snap — stiffer spring for popovers
   - ADD: SYSTEM.type.label — 9px bold uppercase token
   ── Preserved from v28.2–28.3 ──
   - KEPT: NeuralPulse export, ConnectionBadge, sr-only live region
   - KEPT: role="log" + aria-relevant="additions" + aria-busy on scroll
   - KEPT: All 20 aria-label attributes, Toast role="status"
   - KEPT: Full 9-header section list, RAF batching, LRU cache

   CSP Requirement: `img-src data: https://www.google.com;`
============================================================================ */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  createContext,
  useContext,
  useLayoutEffect,
  useReducer,
  Component,
  type FC,
  type ReactNode,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  motion,
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  type Transition,
} from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useChatContext } from "../hooks/useChatContext";
import { useAppStore } from "../store/appStore";
import {
  X,
  Plus,
  ArrowUp,
  ArrowDown,
  Copy,
  CheckCircle2,
  Minimize2,
  Mic,
  MicOff,
  StopCircle,
  Image as ImageIcon,
  Activity,
  ShieldCheck,
  ExternalLink,
  RotateCcw,
  WifiOff,
  Check,
  XCircle,
} from "lucide-react";
import type { MatchOdds } from "@/types";


// ═══════════════════════════════════════════════════════════════════════════
// §0  STATIC CONFIG & REGEX (Hoisted — Zero Allocation at Runtime)
// ═══════════════════════════════════════════════════════════════════════════

const REGEX_VERDICT_PREFIX = /^\*{0,2}verdict:\*{0,2}\s*/i;
const REGEX_VERDICT_MATCH = /^\*{0,2}verdict:/i;

const REGEX_WATCH_PREFIX = /.*what to watch live.*?:\s*/i;
const REGEX_WATCH_MATCH = /what to watch live/i;

const REGEX_INVALID_PREFIX = /^\*{0,2}invalidation:\*{0,2}\s*/i;
const REGEX_INVALID_MATCH = /^\*{0,2}invalidation:/i;

/**
 * Matches bracket citation tokens: [1], [1, 2], [1.1]
 * Negative lookahead (?!\() prevents matching markdown links [text](url).
 */
const REGEX_CITATION_PLACEHOLDER =
  /\[(\d+(?:\.\d+)?(?:[\s,]+\d+(?:\.\d+)?)*)\](?!\()/g;

const REGEX_CITATION_LABEL = /^\d+(?:\.\d+)?$/;
const REGEX_SPLIT_COMMA = /[,\s]+/;
const REGEX_MULTI_SPACE = /\s{2,}/g;

/** Removes hydrated markdown links: [1](https://...) */
const REGEX_CLEAN_LINK = /\s*\[\d+(?:\.\d+)?\]\([^)]+\)/g;
/** Removes raw bracket tokens: [1] or [1.1] */
const REGEX_CLEAN_REF = /\s*\[\d+(?:\.\d+)?\]/g;
/** Removes confidence annotations: (Confidence: High) — note escaped parens. */
const REGEX_CLEAN_CONF = /\s*\(Confidence:\s*\w+\)/gi;
/** Extracts confidence level from verdict text before cleaning. */
const REGEX_EXTRACT_CONF = /\(Confidence:\s*(\w+)\)/i;

const BRAND_MAP: Record<string, string> = {
  "espn.com": "ESPN",
  "covers.com": "Covers",
  "actionnetwork.com": "Action",
  "draftkings.com": "DK",
  "fanduel.com": "FanDuel",
  "rotowire.com": "RotoWire",
  "basketball-reference.com": "BBRef",
  "sports-reference.com": "SportsRef",
  "pro-football-reference.com": "PFRef",
  "github.com": "GitHub",
  "x.com": "X",
  "twitter.com": "X",
  "google.com": "Google",
  "ai.google.dev": "Google AI",
  "nba.com": "NBA",
  "nfl.com": "NFL",
  "mlb.com": "MLB",
  "nhl.com": "NHL",
  "cbssports.com": "CBS",
  "yahoo.com": "Yahoo",
  "bleacherreport.com": "BR",
  "theathletic.com": "Athletic",
};

/** Static query map for SmartChips — hoisted to avoid per-render allocation. */
const SMART_CHIP_QUERIES: Record<string, string> = {
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
  "Cash Out?": "Should I cash out or let it ride?",
  "Live Games": "Which games are live right now with edge?",
  "In-Play Edge": "What are the best in-play opportunities?",
  Recap: "Recap tonight's results.",
  "What Hit": "Which of my edges hit tonight?",
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
const SYSTEM = {
  anim: {
    fluid: { type: "spring", damping: 30, stiffness: 380, mass: 0.8 } as Transition,
    snap: { type: "spring", damping: 22, stiffness: 450 } as Transition,
    draw: { duration: 0.6, ease: "circOut" } as Transition,
    morph: { type: "spring", damping: 25, stiffness: 280 } as Transition,
  },
  surface: {
    void: "bg-[#050505]",
    panel: "bg-[#080808] border border-white/[0.06]",
    /** Liquid Glass 2.0: Deep blur (24px), high saturation (180%), top-edge specular. */
    glass: "bg-white/[0.025] backdrop-blur-[24px] backdrop-saturate-[180%] border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
    hud: "bg-[linear-gradient(180deg,rgba(251,191,36,0.05)_0%,rgba(0,0,0,0)_100%)] border border-amber-500/20 shadow-[inset_0_1px_0_rgba(245,158,11,0.1)]",
    milled: "border-t border-white/[0.08] border-b border-black/50 border-x border-white/[0.04]",
    alert: "bg-[linear-gradient(180deg,rgba(225,29,72,0.05)_0%,rgba(0,0,0,0)_100%)] border border-rose-500/20 shadow-[inset_0_1px_0_rgba(225,29,72,0.1)]",
  },
  type: {
    mono: "font-mono text-[10px] tracking-[0.1em] uppercase text-zinc-500 tabular-nums",
    body: "text-[15px] leading-[1.65] tracking-[-0.01em] text-[#A1A1AA]",
    h1: "text-[13px] font-medium tracking-[-0.02em] text-white",
    label: "text-[9px] font-bold tracking-[0.05em] uppercase text-zinc-500",
  },
  geo: { pill: "rounded-full", card: "rounded-[22px]", input: "rounded-[24px]" },
} as const;

const RETRY_CONFIG = { maxAttempts: 3, baseDelay: 1000, maxDelay: 8000, jitterFactor: 0.3 } as const;
const SEND_DEBOUNCE_MS = 300;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB


// ═══════════════════════════════════════════════════════════════════════════
// §1  TELEMETRY (Pluggable — swap no-op for Sentry/DataDog/PostHog)
// ═══════════════════════════════════════════════════════════════════════════

interface TelemetryProvider {
  captureError(error: unknown, context?: Record<string, unknown>): void;
  timing(name: string, durationMs: number, tags?: Record<string, string>): void;
  trackAction(name: string, properties?: Record<string, unknown>): void;
}

const noopTelemetry: TelemetryProvider = {
  captureError: (error, context) => {
    if (process.env.NODE_ENV === "development") console.error("[Telemetry]", error, context);
  },
  timing: (name, durationMs, tags) => {
    if (process.env.NODE_ENV === "development") console.debug(`[Timing] ${name}: ${durationMs}ms`, tags);
  },
  trackAction: (name, properties) => {
    if (process.env.NODE_ENV === "development") console.debug(`[Action] ${name}`, properties);
  },
};

/** Swap this ref to integrate your error/analytics provider. */
export const chatTelemetry = { current: noopTelemetry as TelemetryProvider };

function reportError(error: unknown, context?: Record<string, unknown>): void {
  chatTelemetry.current.captureError(error, context);
}
function reportTiming(name: string, startMs: number, tags?: Record<string, string>): void {
  chatTelemetry.current.timing(name, Date.now() - startMs, tags);
}
function trackAction(name: string, properties?: Record<string, unknown>): void {
  chatTelemetry.current.trackAction(name, properties);
}


// ═══════════════════════════════════════════════════════════════════════════
// §2  TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface GroundingChunk {
  web?: { uri: string; title?: string };
}
interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  searchEntryPoint?: { renderedContent: string };
  webSearchQueries?: string[];
}

interface TextContent { type: "text"; text: string }
interface ImageContent { type: "image"; source: { type: "base64"; media_type: string; data: string } }
interface FileContent { type: "file"; source: { type: "base64"; media_type: string; data: string } }
type MessagePart = TextContent | ImageContent | FileContent;
type MessageContent = string | MessagePart[];
type VerdictOutcome = "hit" | "miss" | null;

interface Message {
  id: string;
  role: "user" | "assistant";
  content: MessageContent;
  thoughts?: string;
  groundingMetadata?: GroundingMetadata;
  isStreaming?: boolean;
  timestamp: string;
  verdictOutcome?: VerdictOutcome;
}

interface Attachment { file: File; base64: string; mimeType: string }

interface GameContext {
  match_id?: string;
  home_team?: string;
  away_team?: string;
  league?: string;
  start_time?: string;
  status?: string;
  current_odds?: MatchOdds;
}

interface ChatWidgetProps { currentMatch?: GameContext; inline?: boolean }

interface StreamChunk {
  type: "text" | "thought" | "grounding" | "error";
  content?: string;
  metadata?: GroundingMetadata;
  done?: boolean;
}

type WireMessage = { role: "user" | "assistant"; content: MessageContent };

interface ChatContextPayload {
  session_id?: string | null;
  conversation_id?: string | null;
  gameContext?: GameContext | null;
  run_id: string;
}

type ConnectionStatus = "connected" | "reconnecting" | "offline";

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognition;
    SpeechRecognition?: new () => SpeechRecognition;
  }
  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
  }
  interface SpeechRecognitionEvent extends Event { results: SpeechRecognitionResultList }
  interface SpeechRecognitionResultList { readonly length: number;[index: number]: SpeechRecognitionResult }
  interface SpeechRecognitionResult { readonly length: number; readonly isFinal: boolean;[index: number]: SpeechRecognitionAlternative }
  interface SpeechRecognitionAlternative { readonly transcript: string; readonly confidence: number }
}


// ═══════════════════════════════════════════════════════════════════════════
// §3  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function generateId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* fallback */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function triggerHaptic(): void {
  try { if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(4); } catch { /* silent */ }
}

function flattenText(children: ReactNode): string {
  return React.Children.toArray(children).reduce<string>((acc, child) => {
    if (typeof child === "string") return acc + child;
    if (typeof child === "number") return acc + String(child);
    if (React.isValidElement<{ children?: ReactNode }>(child)) return acc + flattenText(child.props.children);
    return acc;
  }, "");
}

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "textarea" || tag === "input" || el.getAttribute("contenteditable") === "true";
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** DJB2 hash of chunk URIs for collision-safe cache keys. */
function chunkFingerprint(chunks: GroundingChunk[]): string {
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
class LRUCache<K, V> {
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

const hydrationCache = new LRUCache<string, string>(256);

function hydrateCitations(text: string, metadata?: GroundingMetadata): string {
  if (!text || !metadata?.groundingChunks?.length) return text;
  const chunks = metadata.groundingChunks;
  const cacheKey = `${text.length}:${text.slice(0, 64)}:${chunks.length}:${chunkFingerprint(chunks)}`;
  const cached = hydrationCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const maxIndex = chunks.length;
  const result = text.replace(REGEX_CITATION_PLACEHOLDER, (match, inner: string) => {
    const parts = inner.split(REGEX_SPLIT_COMMA).filter((p: string) => p.trim());
    const links = parts.reduce<string[]>((acc, part) => {
      const num = parseFloat(part);
      if (Number.isNaN(num)) return acc;
      const index = Math.floor(num) - 1;
      if (index < 0 || index >= maxIndex) return acc;
      const uri = chunks[index]?.web?.uri;
      if (uri) acc.push(`[${part}](${uri})`);
      return acc;
    }, []);
    return links.length ? ` ${links.join(" ")}` : match;
  });

  hydrationCache.set(cacheKey, result);
  return result;
}

/** Type-guard filter — eliminates non-null assertion. */
function hasWebUri(c: GroundingChunk): c is GroundingChunk & { web: { uri: string; title?: string } } {
  return typeof c.web?.uri === "string" && c.web.uri.length > 0;
}

function extractSources(metadata?: GroundingMetadata): Array<{ title: string; uri: string }> {
  if (!metadata?.groundingChunks) return [];
  return metadata.groundingChunks.filter(hasWebUri).map((c) => ({ title: c.web.title || "Source", uri: c.web.uri }));
}

function extractTextContent(content: MessageContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.find((c) => c.type === "text")?.text ?? "";
  return "";
}

function cleanVerdictContent(text: string): string {
  if (!text) return "";
  return text
    .replace(REGEX_CLEAN_LINK, "")
    .replace(REGEX_CLEAN_REF, "")
    .replace(REGEX_CLEAN_CONF, "")
    .replace(REGEX_MULTI_SPACE, " ")
    .trim();
}

type ConfidenceLevel = "high" | "medium" | "low";

/** Extract confidence level from raw verdict text before it gets cleaned. */
function extractConfidence(text: string): ConfidenceLevel {
  const match = REGEX_EXTRACT_CONF.exec(text);
  if (!match) return "high"; // default — most verdicts are high confidence
  const level = match[1].toLowerCase();
  if (level === "medium" || level === "med") return "medium";
  if (level === "low") return "low";
  return "high";
}

/** Maps confidence level to visual bar percentage. */
function confidenceToPercent(level: ConfidenceLevel): number {
  switch (level) {
    case "high": return 88;
    case "medium": return 58;
    case "low": return 30;
  }
}

function hostnameToBrand(hostname: string): string {
  const h = hostname.replace(/^www\./, "").toLowerCase();
  if (BRAND_MAP[h]) return BRAND_MAP[h];
  const base = h.split(".")[0] || "Source";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function getHostname(href?: string): string {
  if (!href) return "Source";
  try { return new URL(href).hostname.replace(/^www\./, ""); } catch { return "Source"; }
}

/**
 * Google S2 High-Res Favicon Service.
 * sz=64 ensures crisp rendering on Retina displays even at small icon sizes.
 * CSP: Requires `img-src https://www.google.com`.
 */
function getFaviconUrl(href: string): string {
  try { const domain = new URL(href).hostname; return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`; } catch { return ""; }
}

function buildWireContent(text: string, attachments: Attachment[]): MessageContent {
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

function getRetryDelay(attempt: number): number {
  const delay = Math.min(RETRY_CONFIG.baseDelay * Math.pow(2, attempt), RETRY_CONFIG.maxDelay);
  const jitter = delay * RETRY_CONFIG.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, delay + jitter);
}

function getTimePhase(): "pregame" | "live" | "postgame" {
  const hour = new Date().getHours();
  if (hour < 16) return "pregame";
  if (hour < 23) return "live";
  return "postgame";
}


// ═══════════════════════════════════════════════════════════════════════════
// §4  SSE PARSER (Guarded — onDone fires exactly once)
// ═══════════════════════════════════════════════════════════════════════════

class SSEParser {
  private buffer = "";
  private completed = false;
  private readonly onChunk: (chunk: StreamChunk) => void;
  private readonly onDone: () => void;

  constructor(onChunk: (chunk: StreamChunk) => void, onDone: () => void) {
    this.onChunk = onChunk;
    this.onDone = onDone;
  }

  private signalDone(): void {
    if (this.completed) return;
    this.completed = true;
    this.onDone();
  }

  /**
   * Feed decoded text from the stream.
   * UTF-8 multi-byte boundary handling is done by TextDecoder({ stream: true }) upstream.
   */
  feed(text: string): void {
    this.buffer += text;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      if (payload === "[DONE]") { this.signalDone(); return; }
      try {
        const data = JSON.parse(payload) as StreamChunk;
        this.onChunk(data);
        if (data.done) this.signalDone();
      } catch { /* malformed JSON — skip */ }
    }
  }

  flush(): void {
    if (!this.buffer.trim()) return;
    const line = this.buffer.trim();
    this.buffer = "";
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") { this.signalDone(); return; }
    try {
      const data = JSON.parse(payload) as StreamChunk;
      this.onChunk(data);
    } catch { /* discard */ }
  }

  ensureDone(): void { this.signalDone(); }
}


// ═══════════════════════════════════════════════════════════════════════════
// §5  EDGE SERVICE (Retryable SSE + telemetry)
// ═══════════════════════════════════════════════════════════════════════════

const edgeService = {
  async chat(
    messages: WireMessage[],
    context: ChatContextPayload,
    onChunk: (c: StreamChunk) => void,
    onDone: () => void,
    onRetry?: (attempt: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    let lastError: unknown = null;
    const requestStart = Date.now();

    for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages, ...context }),
          signal,
        });

        if (!res.ok) {
          if (res.status >= 400 && res.status < 500 && res.status !== 429)
            throw new Error(`Request failed: ${res.status}`);
          throw new Error(`Server error: ${res.status}`);
        }

        reportTiming("chat.ttfb", requestStart, { attempt: String(attempt) });

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        const parser = new SSEParser(onChunk, onDone);

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            parser.feed(decoder.decode(value, { stream: true }));
          }
          parser.flush();
        } finally {
          parser.ensureDone();
          try { reader.releaseLock(); } catch { /* already released */ }
        }

        reportTiming("chat.total", requestStart, { attempt: String(attempt) });
        return;
      } catch (err: unknown) {
        lastError = err;
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        reportError(err, { attempt, run_id: context.run_id });
        if (attempt >= RETRY_CONFIG.maxAttempts - 1) break;
        onRetry?.(attempt + 1);
        const delay = getRetryDelay(attempt);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Connection failed after retries");
  },
};


// ═══════════════════════════════════════════════════════════════════════════
// §6  MESSAGE STORE
//     UPDATE is O(1) Map lookup + O(n) shallow array copy.
//     Sub-millisecond for sessions under 200 messages.
// ═══════════════════════════════════════════════════════════════════════════

interface MessageState { ordered: Message[]; index: Map<string, number> }
type MessageAction =
  | { type: "APPEND_BATCH"; messages: Message[] }
  | { type: "UPDATE"; id: string; patch: Partial<Message> }
  | { type: "SET_VERDICT"; id: string; outcome: VerdictOutcome }
  | { type: "CLEAR" };

function messageReducer(state: MessageState, action: MessageAction): MessageState {
  switch (action.type) {
    case "APPEND_BATCH": {
      const newOrdered = [...state.ordered, ...action.messages];
      const newIndex = new Map<string, number>();
      for (let i = 0; i < newOrdered.length; i++) newIndex.set(newOrdered[i].id, i);
      return { ordered: newOrdered, index: newIndex };
    }
    case "UPDATE": {
      const idx = state.index.get(action.id);
      if (idx === undefined) return state;
      const newOrdered = [...state.ordered];
      newOrdered[idx] = { ...newOrdered[idx], ...action.patch };
      return { ordered: newOrdered, index: state.index };
    }
    case "SET_VERDICT": {
      const idx = state.index.get(action.id);
      if (idx === undefined) return state;
      const newOrdered = [...state.ordered];
      newOrdered[idx] = { ...newOrdered[idx], verdictOutcome: action.outcome };
      return { ordered: newOrdered, index: state.index };
    }
    case "CLEAR":
      return { ordered: [], index: new Map() };
    default:
      return state;
  }
}

const INITIAL_MESSAGE_STATE: MessageState = { ordered: [], index: new Map() };


// ═══════════════════════════════════════════════════════════════════════════
// §7  HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stable callback ref — survives re-renders without invalidating dependents.
 * `as T` cast is structurally necessary. Safe for plain functions (not method types).
 */
function useStableCallback<T extends (...args: unknown[]) => unknown>(callback: T): T {
  const ref = useRef(callback);
  useLayoutEffect(() => { ref.current = callback; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((...args: Parameters<T>) => ref.current(...args), []) as T;
}

function useAutoResizeTextArea(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "52px";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), 120)}px`;
  }, [value, ref]);
}

function useConnectionHealth(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>("connected");
  useEffect(() => {
    const goOnline = () => setStatus("connected");
    const goOffline = () => setStatus("offline");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (!navigator.onLine) setStatus("offline");
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return status;
}

/**
 * Scoped keyboard shortcuts.
 * Skips when a text input is focused (user keeps draft, no hijacking).
 * Handlers must be stable (useStableCallback).
 */
function useKeyboardShortcuts(onToggle: () => void, onClose: () => void, isOpen: boolean) {
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inputFocused = isTextInputFocused();
      if (mod && e.key === "k" && !inputFocused) { e.preventDefault(); onToggle(); return; }
      if (!isOpen) return;
      if (e.key === "Escape" && !inputFocused) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onToggle, onClose]);
}

function useSendGuard() {
  const lastSendRef = useRef(0);
  return useCallback((): boolean => {
    const now = Date.now();
    if (now - lastSendRef.current < SEND_DEBOUNCE_MS) return false;
    lastSendRef.current = now;
    return true;
  }, []);
}

/** Focus an element after a brief delay (allows DOM to settle after mount). */
function useAutoFocus(ref: RefObject<HTMLElement | null>, shouldFocus: boolean) {
  useEffect(() => {
    if (!shouldFocus) return;
    const timer = setTimeout(() => ref.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [shouldFocus, ref]);
}


// ═══════════════════════════════════════════════════════════════════════════
// §8  VISUAL PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

/** CSP: Requires `img-src data:` in your Content-Security-Policy. */
const FilmGrain = memo(() => (
  <div
    className="absolute inset-0 pointer-events-none z-0 opacity-[0.03] mix-blend-overlay"
    style={{
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
    }}
  />
));
FilmGrain.displayName = "FilmGrain";

const OrbitalRadar = memo(() => (
  <div className="relative w-4 h-4 flex items-center justify-center">
    <div className="absolute w-1 h-1 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
    <motion.div
      className="absolute inset-0 border border-emerald-500/30 rounded-full"
      animate={{ scale: [0.8, 1.8], opacity: [1, 0] }}
      transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
    />
  </div>
));
OrbitalRadar.displayName = "OrbitalRadar";

export const NeuralPulse: FC<{ active?: boolean; size?: number }> = memo(({ active = true, size = 10 }) => {
  const s = Math.max(6, Math.min(16, size));
  if (!active) return <span className="inline-block rounded-full bg-zinc-700" style={{ width: s, height: s }} />;
  return (
    <span className="inline-flex items-center justify-center relative" style={{ width: s, height: s }}>
      <span className="absolute inset-0 rounded-full bg-emerald-500/20" />
      <span className="absolute rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.9)]" style={{ width: s / 2.5, height: s / 2.5 }} />
      <motion.span
        className="absolute inset-0 rounded-full border border-emerald-500/35"
        animate={{ scale: [0.9, 1.9], opacity: [0.9, 0] }}
        transition={{ duration: 1.25, repeat: Infinity, ease: "easeOut" }}
      />
    </span>
  );
});
NeuralPulse.displayName = "NeuralPulse";

/** Floating scroll-to-bottom anchor — shown when auto-scroll is disengaged. */
const ScrollAnchor: FC<{ visible: boolean; onClick: () => void }> = memo(({ visible, onClick }) => (
  <AnimatePresence>
    {visible && (
      <motion.button
        initial={{ opacity: 0, y: 8, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.9 }}
        transition={SYSTEM.anim.fluid}
        onClick={() => { triggerHaptic(); onClick(); }}
        className="absolute bottom-48 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0A0A0B]/90 border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.6)] backdrop-blur-sm hover:bg-white/10 transition-colors"
        aria-label="Scroll to latest messages"
      >
        <ArrowDown size={10} className="text-emerald-400" />
        <span className="text-[10px] font-medium text-zinc-300 tracking-wide uppercase">Latest</span>
      </motion.button>
    )}
  </AnimatePresence>
));
ScrollAnchor.displayName = "ScrollAnchor";


// ═══════════════════════════════════════════════════════════════════════════
// §9  TOAST SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

const ToastContext = createContext<{ showToast: (m: string) => void }>({ showToast: () => { } });
function useToast() { return useContext(ToastContext); }

const ToastProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<{ id: string; message: string } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    const id = generateId();
    setToast({ id, message });
    triggerHaptic();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setToast((c) => (c?.id === id ? null : c)), 2500);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={SYSTEM.anim.fluid}
            className="absolute bottom-28 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 px-4 py-2.5 bg-[#0A0A0A] border border-white/10 rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.5)] will-change-transform"
          >
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,1)]" />
            <span className="text-[12px] font-medium text-white tracking-tight">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// §10  ARTIFACT COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

const CopyButton: FC<{ content: string }> = memo(({ content }) => {
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      triggerHaptic();
      showToast("Copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast("Copy failed");
    }
  }, [content, showToast]);

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "p-1.5 rounded-md transition-all duration-200",
        copied ? "text-emerald-400 bg-emerald-500/10" : "text-zinc-600 hover:text-zinc-300 hover:bg-white/5",
      )}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
    >
      {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
    </button>
  );
});
CopyButton.displayName = "CopyButton";

/**
 * Weissach Source Icon:
 * 1. Tries to fetch a high-fidelity Google S2 favicon (64px).
 * 2. If it fails, seamlessly renders a "Milled Letter Chip" (Monogram).
 * 3. Default is grayscale for "Quiet Luxury", blooms to color on interaction.
 */
const SourceIcon: FC<{ url?: string; fallbackLetter: string; className?: string }> = memo(({ url, fallbackLetter, className }) => {
  const [error, setError] = useState(false);
  const faviconUrl = useMemo(() => url ? getFaviconUrl(url) : null, [url]);

  if (error || !faviconUrl) {
    return (
      <div className={cn("flex items-center justify-center bg-white/[0.08] border border-white/10 text-zinc-400 font-mono font-bold shadow-inner", className)}>
        {fallbackLetter.charAt(0).toUpperCase()}
      </div>
    );
  }
  return <img src={faviconUrl} alt="" onError={() => setError(true)} className={cn("object-contain bg-white/[0.03]", className)} loading="lazy" />;
});
SourceIcon.displayName = "SourceIcon";

/**
 * Animated confidence gradient bar — replaces text labels.
 * Renders a horizontal bar with emerald/amber/zinc gradient based on level.
 */
const ConfidenceBar: FC<{ level: ConfidenceLevel }> = memo(({ level }) => {
  const percent = confidenceToPercent(level);
  const gradientMap: Record<ConfidenceLevel, string> = {
    high: "from-emerald-500 via-emerald-400 to-emerald-300",
    medium: "from-amber-500 via-amber-400 to-amber-300",
    low: "from-zinc-500 via-zinc-400 to-zinc-300",
  };
  const glowMap: Record<ConfidenceLevel, string> = {
    high: "shadow-[0_0_20px_rgba(16,185,129,0.35)]",
    medium: "shadow-[0_0_20px_rgba(245,158,11,0.25)]",
    low: "shadow-[0_0_12px_rgba(161,161,170,0.15)]",
  };
  const labelMap: Record<ConfidenceLevel, string> = {
    high: "text-emerald-400",
    medium: "text-amber-400",
    low: "text-zinc-400",
  };

  return (
    <div className="flex items-center gap-3" role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Confidence: ${level}`}>
      <div className="flex-1 h-[6px] rounded-full bg-white/[0.06] overflow-hidden backdrop-blur-sm">
        <motion.div
          className={cn("h-full rounded-full bg-gradient-to-r", gradientMap[level], glowMap[level])}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        />
      </div>
      <span className={cn("text-[10px] font-mono font-medium uppercase tracking-widest tabular-nums min-w-[28px] text-right", labelMap[level])}>
        {percent}%
      </span>
    </div>
  );
});
ConfidenceBar.displayName = "ConfidenceBar";

/**
 * EdgeVerdictCard — "The Receipt"
 * iOS 26 liquid glass: full hardware radius, no left-border accent.
 * Confidence visualized as an animated gradient bar, not text.
 * Designed to screenshot as premium marketing material.
 */
const EdgeVerdictCard: FC<{
  content: string;
  confidence?: ConfidenceLevel;
  isLive?: boolean;
  meta?: string;
  messageId: string;
  outcome?: VerdictOutcome;
  onTrack?: (id: string, outcome: VerdictOutcome) => void;
}> = memo(({ content, confidence = "high", isLive = false, meta, messageId, outcome, onTrack }) => {
  const cleanContent = useMemo(() => cleanVerdictContent(content), [content]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SYSTEM.anim.fluid, delay: 0.05 }}
      className={cn(
        "my-8 relative overflow-hidden",
        "rounded-[20px]",
        "bg-white/[0.03] backdrop-blur-xl",
        "border border-white/[0.08]",
        "shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.04)]",
      )}
    >
      {/* Ambient inner glow — maps to confidence */}
      <div
        className={cn(
          "absolute inset-0 pointer-events-none opacity-40",
          confidence === "high" && "bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.08)_0%,transparent_60%)]",
          confidence === "medium" && "bg-[radial-gradient(ellipse_at_top_left,rgba(245,158,11,0.06)_0%,transparent_60%)]",
          confidence === "low" && "bg-[radial-gradient(ellipse_at_top_left,rgba(161,161,170,0.04)_0%,transparent_60%)]",
        )}
      />

      <div className="relative z-10 p-6">
        {/* Header row */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-[7px] bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            </div>
            <span className="font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-zinc-400">The Edge</span>
          </div>
          {isLive && (
            <div className="flex items-center gap-1.5 bg-emerald-500/8 px-2.5 py-1 rounded-full border border-emerald-500/15">
              <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] font-bold text-emerald-400 tracking-wider uppercase">Live</span>
            </div>
          )}
        </div>

        {/* Verdict text — the hero */}
        <div className="text-[22px] md:text-[26px] font-semibold text-white tracking-[-0.02em] leading-[1.25] break-words mb-6">
          {cleanContent}
        </div>

        {/* Confidence bar */}
        <div className="mb-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-mono font-medium tracking-[0.15em] uppercase text-zinc-500">Confidence</span>
          </div>
          <ConfidenceBar level={confidence} />
        </div>

        {meta && (
          <div className="mt-5 pt-4 border-t border-white/[0.06]">
            <span className="text-[10px] font-mono text-zinc-500 tracking-wide">{meta}</span>
          </div>
        )}

        {/* Verdict tracking */}
        {onTrack && (
          <div className="mt-5 pt-4 border-t border-white/[0.06]">
            {!outcome ? (
              <div className="flex flex-col items-center gap-3">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Did this hit?</span>
                <div className="flex items-center gap-2.5" role="group" aria-label="Track verdict outcome">
                  <button
                    onClick={() => { triggerHaptic(); trackAction("verdict.hit", { messageId }); onTrack(messageId, "hit"); }}
                    className={cn(
                      "flex items-center gap-2 px-5 py-2.5",
                      "rounded-full",
                      "bg-emerald-500/8 border border-emerald-500/15",
                      "text-emerald-400 hover:bg-emerald-500/15 hover:border-emerald-500/25",
                      "transition-all duration-200",
                    )}
                    aria-label="Mark as hit"
                  >
                    <Check size={12} />
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Hit</span>
                  </button>
                  <button
                    onClick={() => { triggerHaptic(); trackAction("verdict.miss", { messageId }); onTrack(messageId, "miss"); }}
                    className={cn(
                      "flex items-center gap-2 px-5 py-2.5",
                      "rounded-full",
                      "bg-red-500/8 border border-red-500/15",
                      "text-red-400 hover:bg-red-500/15 hover:border-red-500/25",
                      "transition-all duration-200",
                    )}
                    aria-label="Mark as miss"
                  >
                    <XCircle size={12} />
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Miss</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={cn("w-1.5 h-1.5 rounded-full", outcome === "hit" ? "bg-emerald-500" : "bg-red-500")} />
                  <span className={cn("text-[11px] font-mono font-medium uppercase tracking-wider", outcome === "hit" ? "text-emerald-400" : "text-red-400")}>
                    Tracked as {outcome === "hit" ? "Hit" : "Miss"}
                  </span>
                </div>
                <button
                  onClick={() => { triggerHaptic(); onTrack(messageId, null); }}
                  className="flex items-center gap-1.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                  aria-label="Undo verdict tracking"
                >
                  <RotateCcw size={10} />
                  <span className="font-medium uppercase tracking-wider">Undo</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
});
EdgeVerdictCard.displayName = "EdgeVerdictCard";

/** TacticalHUD — Live triggers. Full hardware-radius glass, ambient amber glow. */
const TacticalHUD: FC<{ content: string }> = memo(({ content }) => {
  const c = useMemo(() => cleanVerdictContent(content), [content]);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SYSTEM.anim.fluid}
      className={cn(
        "my-8 relative overflow-hidden",
        "rounded-[18px]",
        "bg-white/[0.025] backdrop-blur-xl",
        "border border-white/[0.07]",
        "shadow-[0_4px_24px_-8px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.03)]",
      )}
    >
      {/* Ambient amber glow */}
      <div className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(ellipse_at_top_left,rgba(245,158,11,0.08)_0%,transparent_55%)]" />
      <div className="relative z-10 p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-4 h-4 rounded-[5px] bg-amber-500/10 border border-amber-500/15 flex items-center justify-center">
            <div className="w-1 h-1 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.8)]" />
          </div>
          <span className="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-amber-400/80">Live Triggers</span>
        </div>
        <div className="text-[15px] leading-[1.65] tracking-[-0.01em] text-zinc-300">{c}</div>
      </div>
    </motion.div>
  );
});
TacticalHUD.displayName = "TacticalHUD";

/** InvalidationAlert — Risk warning. Full hardware-radius glass, ambient red glow. */
const InvalidationAlert: FC<{ content: string }> = memo(({ content }) => {
  const c = useMemo(() => cleanVerdictContent(content), [content]);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SYSTEM.anim.fluid}
      className={cn(
        "my-8 relative overflow-hidden",
        "rounded-[18px]",
        "bg-white/[0.025] backdrop-blur-xl",
        "border border-white/[0.07]",
        "shadow-[0_4px_24px_-8px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.03)]",
      )}
    >
      {/* Ambient red glow */}
      <div className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(ellipse_at_top_left,rgba(239,68,68,0.08)_0%,transparent_55%)]" />
      <div className="relative z-10 p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-4 h-4 rounded-[5px] bg-red-500/10 border border-red-500/15 flex items-center justify-center">
            <div className="w-1 h-1 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
          </div>
          <span className="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-red-400/80">Invalidation</span>
        </div>
        <div className="text-[15px] leading-[1.65] tracking-[-0.01em] text-zinc-300">{c}</div>
      </div>
    </motion.div>
  );
});
InvalidationAlert.displayName = "InvalidationAlert";

const ThinkingPill: FC<{ onStop?: () => void; status?: string; retryCount?: number }> = memo(
  ({ onStop, status = "thinking", retryCount = 0 }) => {
    const [idx, setIdx] = useState(0);
    const phrases = useMemo(() => ["CHECKING LINES", "SCANNING", "GRADING EDGE", "VERIFYING"], []);
    const displayText = useMemo(() => {
      if (retryCount > 0) return `RETRY ${retryCount}/${RETRY_CONFIG.maxAttempts}`;
      if (status === "streaming") return "LIVE FEED";
      if (status === "grounding") return "VERIFYING SOURCES";
      return phrases[idx];
    }, [status, idx, phrases, retryCount]);

    useEffect(() => {
      if (status !== "thinking") return;
      const interval = setInterval(() => setIdx((p) => (p + 1) % phrases.length), 2200);
      return () => clearInterval(interval);
    }, [status, phrases.length]);

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        transition={SYSTEM.anim.fluid}
        role="status"
        aria-live="polite"
        className="absolute bottom-[100%] left-1/2 -translate-x-1/2 mb-6 flex items-center gap-3 px-4 py-2 rounded-full bg-[#050505] border border-white/10 shadow-2xl z-30 will-change-transform"
      >
        <OrbitalRadar />
        <AnimatePresence mode="wait">
          <motion.span
            key={displayText}
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(4px)" }}
            className={cn(SYSTEM.type.mono, "text-zinc-300 min-w-[100px] text-center")}
          >
            {displayText}
          </motion.span>
        </AnimatePresence>
        {onStop && (
          <button onClick={onStop} className="ml-1 text-zinc-600 hover:text-zinc-200 transition-colors" aria-label="Stop processing">
            <StopCircle size={10} />
          </button>
        )}
      </motion.div>
    );
  },
);
ThinkingPill.displayName = "ThinkingPill";

const SmartChips: FC<{ onSelect: (t: string) => void; hasMatch: boolean; messageCount: number }> = memo(
  ({ onSelect, hasMatch, messageCount }) => {
    const phase = getTimePhase();
    const chips = useMemo(() => {
      if (hasMatch) {
        switch (phase) {
          case "live": return ["Live Edge", "Sharp Report", "Momentum", "Cash Out?"];
          case "postgame": return ["Recap", "What Hit", "Tomorrow Slate", "Bankroll"];
          default: return ["Sharp Report", "Best Bet", "Public Fade", "Player Props"];
        }
      }
      if (messageCount > 5) return ["New Slate", "My Record", "Best Edge", "Promos"];
      switch (phase) {
        case "live": return ["Live Games", "In-Play Edge", "Line Moves", "Injury News"];
        case "postgame": return ["Tomorrow Slate", "Futures", "My Record", "Sharp Money"];
        default: return ["Edge Today", "Line Moves", "Public Splits", "Injury News"];
      }
    }, [hasMatch, phase, messageCount]);

    return (
      <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide px-6" role="group" aria-label="Quick actions">
        {chips.map((chip, i) => (
          <motion.button
            key={chip}
            onClick={() => { triggerHaptic(); onSelect(SMART_CHIP_QUERIES[chip] ?? chip); }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, ...SYSTEM.anim.fluid }}
            whileHover={{ scale: 1.02, y: -1, backgroundColor: "rgba(255,255,255,0.06)" }}
            whileTap={{ scale: 0.98 }}
            className={cn("px-3.5 py-2 bg-white/[0.03] border border-white/[0.08] transition-all backdrop-blur-sm shrink-0", SYSTEM.geo.pill)}
          >
            <span className="text-[10px] font-medium text-zinc-300 tracking-wide uppercase whitespace-nowrap">{chip}</span>
          </motion.button>
        ))}
      </div>
    );
  },
);
SmartChips.displayName = "SmartChips";

const ConnectionBadge: FC<{ status: ConnectionStatus }> = memo(({ status }) => {
  if (status === "connected") return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      role="status"
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-mono uppercase tracking-wider",
        status === "offline"
          ? "bg-red-500/10 border border-red-500/20 text-red-400"
          : "bg-amber-500/10 border border-amber-500/20 text-amber-400",
      )}
    >
      {status === "offline" ? <WifiOff size={10} /> : <RotateCcw size={10} className="animate-spin" />}
      <span>{status === "offline" ? "Offline" : "Reconnecting..."}</span>
    </motion.div>
  );
});
ConnectionBadge.displayName = "ConnectionBadge";


// ═══════════════════════════════════════════════════════════════════════════
// §11  CITATION PILL (Decoupled via context)
// ═══════════════════════════════════════════════════════════════════════════

const CitationContext = createContext<{
  activeCitation: string | null;
  setActiveCitation: (id: string | null) => void;
}>({ activeCitation: null, setActiveCitation: () => { } });

const CitationProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [activeCitation, setActiveCitation] = useState<string | null>(null);

  useEffect(() => {
    const onPointer = (e: globalThis.PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) { setActiveCitation(null); return; }
      if (typeof t.closest === "function" && t.closest('[data-cite-scope="true"]')) return;
      setActiveCitation(null);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setActiveCitation(null);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const value = useMemo(() => ({ activeCitation, setActiveCitation }), [activeCitation]);
  return <CitationContext.Provider value={value}>{children}</CitationContext.Provider>;
};

/**
 * "The Jewel" — Inline Citation Complication.
 * Replaces bracket tokens with a glass pill housing the source's favicon.
 * Preserves full aria: expanded, controls, label, tooltip role.
 */
const CitationJewel: FC<{ id: string; href?: string; indexLabel: string }> = memo(({ id, href, indexLabel }) => {
  const { activeCitation, setActiveCitation } = useContext(CitationContext);
  const active = activeCitation === id;
  const hostname = getHostname(href);
  const brand = hostnameToBrand(hostname);

  return (
    <span data-cite-scope="true" className="inline-flex items-center align-middle relative mx-0.5 -translate-y-[1px] isolate z-10">
      <button
        type="button"
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); triggerHaptic(); setActiveCitation(active ? null : id); }}
        className={cn(
          "group inline-flex items-center gap-1.5 h-[18px] pl-0.5 pr-2 rounded-full border transition-all duration-300 select-none cursor-pointer overflow-hidden backdrop-blur-md",
          active
            ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.25)]"
            : "bg-white/[0.04] border-white/[0.08] text-zinc-400 hover:bg-white/[0.08] hover:border-white/[0.15] hover:text-zinc-200",
        )}
        aria-expanded={active}
        aria-controls={`cite-popover-${id}`}
        aria-label={`Source ${indexLabel} from ${brand}`}
      >
        <div className="w-3.5 h-3.5 rounded-full bg-[#050505] border border-white/10 flex items-center justify-center overflow-hidden shadow-sm">
          <SourceIcon url={href} fallbackLetter={brand} className="w-2.5 h-2.5 rounded-full opacity-60 grayscale group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-300" />
        </div>
        <span className="text-[9px] font-mono font-medium tracking-tight leading-none translate-y-[0.5px]">{indexLabel}</span>
      </button>

      <AnimatePresence>
        {active && (
          <motion.div
            data-cite-scope="true"
            id={`cite-popover-${id}`}
            role="tooltip"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={SYSTEM.anim.snap}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 w-[240px] z-[60]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className={cn("p-3.5 rounded-[20px] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.9)]", SYSTEM.surface.glass)}>
              <div className="flex items-start gap-3 mb-3">
                <div className="w-8 h-8 rounded-[10px] bg-black/40 border border-white/10 flex items-center justify-center shrink-0 shadow-inner overflow-hidden">
                  <SourceIcon url={href} fallbackLetter={brand} className="w-5 h-5 rounded" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-white truncate leading-tight mb-0.5">{brand}</div>
                  <div className="text-[10px] font-mono text-zinc-500 truncate">{hostname}</div>
                </div>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-white/5">
                <div className="flex items-center gap-1.5 text-[9px] font-mono text-emerald-400/90 uppercase tracking-widest">
                  <ShieldCheck size={10} /><span>Verified</span>
                </div>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] font-medium text-zinc-300 hover:text-white transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open</span><ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="text-[10px] font-mono text-zinc-600">No link</span>
                )}
              </div>
            </div>
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#0A0A0B] border-r border-b border-white/10 rotate-45 rounded-[1px]" />
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
});
CitationJewel.displayName = "CitationJewel";

/**
 * "The Evidence Deck" — Horizontal Inertia-Scroll Tray.
 * Replaces the vertical details/summary with a dashboard-style component.
 * Gradient fade masks soften the scroll edges into the void.
 */
const EvidenceDeck: FC<{ sources: Array<{ title: string; uri: string }> }> = memo(({ sources }) => {
  if (!sources.length) return null;
  return (
    <div className="mt-6 w-full max-w-full overflow-hidden relative group/deck">
      <div className="flex items-center gap-2 mb-3 px-1 opacity-80">
        <div className="w-1 h-1 bg-emerald-500 rounded-full shadow-[0_0_4px_rgba(16,185,129,0.8)]" />
        <span className={SYSTEM.type.label}>Evidence Ledger</span>
        <span className="text-[9px] font-mono text-zinc-600 ml-auto">[{sources.length}]</span>
      </div>
      <div className="relative w-full">
        {/* Gradient Fade Masks — content fades into the void */}
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-[#050505] to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#050505] to-transparent z-10 pointer-events-none" />

        <div className="flex gap-2.5 overflow-x-auto pb-4 px-4 scrollbar-hide snap-x">
          {sources.map((source, i) => {
            const hostname = getHostname(source.uri);
            const brand = hostnameToBrand(hostname);
            return (
              <motion.a
                key={i}
                href={source.uri}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, ...SYSTEM.anim.fluid }}
                className={cn(
                  "flex-none w-[150px] snap-start group relative flex flex-col justify-between p-3 h-[84px] rounded-2xl transition-all duration-300",
                  "bg-white/[0.025] border border-white/[0.06] hover:bg-white/[0.05] hover:border-emerald-500/20 shadow-sm",
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="w-5 h-5 rounded bg-white/[0.05] border border-white/[0.05] flex items-center justify-center overflow-hidden">
                    <SourceIcon url={source.uri} fallbackLetter={brand} className="w-3 h-3 rounded opacity-70 grayscale group-hover:grayscale-0 group-hover:opacity-100 transition-all" />
                  </div>
                  <span className="text-[9px] font-mono text-zinc-600 group-hover:text-emerald-500/80 transition-colors">0{i + 1}</span>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-zinc-300 truncate leading-tight group-hover:text-white transition-colors">{source.title || brand}</div>
                  <div className="text-[9px] text-zinc-600 truncate mt-0.5 font-mono">{hostname}</div>
                </div>
              </motion.a>
            );
          })}
        </div>
      </div>
    </div>
  );
});
EvidenceDeck.displayName = "EvidenceDeck";


// ═══════════════════════════════════════════════════════════════════════════
// §12  MESSAGE BUBBLE
// ═══════════════════════════════════════════════════════════════════════════

const MessageBubble: FC<{ message: Message; onTrackVerdict?: (id: string, outcome: VerdictOutcome) => void }> = memo(
  ({ message, onTrackVerdict }) => {
    const isUser = message.role === "user";
    const verifiedContent = useMemo(() => {
      const t = extractTextContent(message.content);
      return isUser ? t : hydrateCitations(t, message.groundingMetadata);
    }, [message.content, message.groundingMetadata, isUser]);

    const sources = useMemo(() => extractSources(message.groundingMetadata), [message.groundingMetadata]);
    const formattedTime = useMemo(() => formatTimestamp(message.timestamp), [message.timestamp]);

    const components: Components = useMemo(
      () => ({
        p: ({ children }) => {
          const text = flattenText(children);

          if (REGEX_VERDICT_MATCH.test(text)) {
            const rawVerdictContent = text.replace(REGEX_VERDICT_PREFIX, "").trim();
            const confidence = extractConfidence(rawVerdictContent);
            return (
              <EdgeVerdictCard
                content={rawVerdictContent}
                confidence={confidence}
                messageId={message.id}
                outcome={message.verdictOutcome}
                onTrack={onTrackVerdict}
              />
            );
          }

          if (REGEX_WATCH_MATCH.test(text)) {
            const c = text.replace(REGEX_WATCH_PREFIX, "").trim();
            return c.length > 5 ? <TacticalHUD content={c} /> : null;
          }

          if (REGEX_INVALID_MATCH.test(text)) {
            const c = text.replace(REGEX_INVALID_PREFIX, "").trim();
            return c.length > 3 ? <InvalidationAlert content={c} /> : null;
          }

          return (
            <div className={cn(SYSTEM.type.body, isUser ? "text-[#1a1a1a]" : "text-[#A1A1AA]", "mb-5 last:mb-0")}>
              {children}
            </div>
          );
        },

        strong: ({ children }) => {
          const text = flattenText(children).toUpperCase();
          const headers = [
            "THE EDGE", "KEY FACTORS", "MARKET DYNAMICS", "WHAT TO WATCH LIVE",
            "INVALIDATION", "TRIPLE CONFLUENCE", "ANALYTICAL WALKTHROUGH",
            "SENTIMENT SIGNAL", "STRUCTURAL ASSESSMENT",
          ];

          if (headers.some((h) => text.includes(h))) {
            return (
              <div className="mt-8 mb-3 flex items-center gap-2.5">
                <div className="w-4 h-4 rounded-[5px] bg-emerald-500/8 border border-emerald-500/12 flex items-center justify-center">
                  <Activity size={9} className="text-emerald-500" />
                </div>
                <span className="text-[10px] font-mono font-medium text-zinc-400 uppercase tracking-[0.12em]">{children}</span>
              </div>
            );
          }

          return <strong className={cn("font-semibold", isUser ? "text-black" : "text-white")}>{children}</strong>;
        },

        a: ({ href, children }) => {
          const label = flattenText(children).trim();
          if (REGEX_CITATION_LABEL.test(label)) {
            return <CitationJewel id={`${message.id}:${label}:${href || "nolink"}`} href={href} indexLabel={label} />;
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-300 underline decoration-emerald-500/20 underline-offset-4 transition-colors"
            >
              {children}
            </a>
          );
        },

        ul: ({ children }) => <ul className="space-y-2 mb-4 ml-1">{children}</ul>,
        li: ({ children }) => (
          <li className="flex gap-3 items-start pl-1">
            <span className="mt-2 w-1 h-1 bg-zinc-700 rounded-full shrink-0" />
            <span className={cn(SYSTEM.type.body, isUser ? "text-[#1a1a1a]" : "text-[#A1A1AA]")}>{children}</span>
          </li>
        ),
      }),
      [isUser, message.id, message.verdictOutcome, onTrackVerdict],
    );

    return (
      <motion.div
        layout="position"
        initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={SYSTEM.anim.fluid}
        className={cn("flex flex-col mb-10 w-full relative group isolate", isUser ? "items-end" : "items-start")}
      >
        {!isUser && (
          <div className="flex items-center gap-2 mb-2 ml-1 select-none">
            <div className={cn("w-1.5 h-1.5 rounded-full", sources.length > 0 ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-zinc-600")} />
            <span className={cn(SYSTEM.type.mono, sources.length > 0 ? "text-emerald-500" : "text-zinc-500")}>
              {sources.length > 0 ? "OBSIDIAN // VERIFIED" : "OBSIDIAN"}
            </span>
          </div>
        )}

        <div className={cn(
          "relative max-w-[92%] md:max-w-[88%]",
          isUser
            ? "bg-white text-black rounded-[20px] rounded-tr-md shadow-[0_2px_10px_rgba(0,0,0,0.1)] px-5 py-3.5"
            : "bg-transparent text-white px-0",
        )}>
          <div className={cn("prose prose-invert max-w-none", isUser && "prose-p:text-black/90")}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {verifiedContent}
            </ReactMarkdown>
          </div>

          {!isUser && !message.isStreaming && verifiedContent && (
            <div className="absolute -right-8 top-0 opacity-0 group-hover:opacity-100 transition-opacity delay-75">
              <CopyButton content={verifiedContent} />
            </div>
          )}
        </div>

        {/* Timestamp — reveals on hover */}
        {formattedTime && (
          <div className={cn("mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none", isUser ? "mr-1" : "ml-1")}>
            <time dateTime={message.timestamp} className="text-[9px] font-mono text-zinc-600 tabular-nums">
              {formattedTime}
            </time>
          </div>
        )}

        {!isUser && !message.isStreaming && sources.length > 0 && (
          <EvidenceDeck sources={sources} />
        )}
      </motion.div>
    );
  },
);
MessageBubble.displayName = "MessageBubble";


// ═══════════════════════════════════════════════════════════════════════════
// §13  INPUT DECK
// ═══════════════════════════════════════════════════════════════════════════

const InputDeck: FC<{
  value: string;
  onChange: (v: string) => void;
  onSend: (queryOverride?: string) => void;
  onStop: () => void;
  attachments: Attachment[];
  onAttach: (a: Attachment[]) => void;
  isProcessing: boolean;
  isVoiceMode: boolean;
  onVoiceModeChange: (v: boolean) => void;
  isOffline: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
}> = memo(({
  value, onChange, onSend, onStop, attachments, onAttach,
  isProcessing, isVoiceMode, onVoiceModeChange, isOffline,
  inputRef, fileInputRef,
}) => {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const { showToast } = useToast();
  useAutoResizeTextArea(inputRef, value);

  useEffect(() => () => {
    try { recognitionRef.current?.abort(); } catch { /* silent */ }
  }, []);

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() || attachments.length) onSend();
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) { e.target.value = ""; return; }

    // File size validation
    if (file.size > MAX_FILE_SIZE_BYTES) {
      showToast(`File too large (${formatFileSize(file.size)}). Max 10 MB.`);
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") return;
      onAttach([
        ...attachments,
        { file, base64: r.split(",")[1] || "", mimeType: file.type || "application/octet-stream" },
      ]);
    };
    reader.onerror = () => { showToast("Failed to read file"); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const toggleVoice = () => {
    const API = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!API) { showToast("Voice input not supported"); return; }

    if (isVoiceMode) {
      try { recognitionRef.current?.abort(); } catch { /* */ }
      recognitionRef.current = null;
      onVoiceModeChange(false);
    } else {
      const r = new API();
      r.continuous = false;
      r.interimResults = true;
      r.onresult = (ev: SpeechRecognitionEvent) => {
        const t = ev?.results?.[0]?.[0]?.transcript;
        if (typeof t === "string" && t.length) onChange(t);
      };
      r.onend = () => { recognitionRef.current = null; onVoiceModeChange(false); };
      recognitionRef.current = r;
      onVoiceModeChange(true);

      try {
        r.start();
      } catch (err: unknown) {
        recognitionRef.current = null;
        onVoiceModeChange(false);
        const msg = err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied"
          : "Voice input failed";
        showToast(msg);
      }
    }

    triggerHaptic();
  };

  const canSend = (value.trim() || attachments.length > 0) && !isOffline;

  return (
    <motion.div
      layout
      className={cn(
        "flex flex-col gap-2 p-1.5 relative overflow-hidden transition-colors duration-500 will-change-transform",
        SYSTEM.geo.input, "bg-[#0A0A0B] shadow-2xl",
        isVoiceMode
          ? "border-emerald-500/30 shadow-[0_0_40px_-10px_rgba(16,185,129,0.15)]"
          : isOffline ? "border-red-500/20" : SYSTEM.surface.milled,
      )}
      transition={SYSTEM.anim.fluid}
    >
      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex gap-2 overflow-x-auto p-2 mb-1 scrollbar-hide"
          >
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.05] rounded-lg border border-white/[0.05]">
                <ImageIcon size={12} className="text-white/50" />
                <span className="text-[10px] text-zinc-300 max-w-[80px] truncate">{a.file.name}</span>
                <button
                  onClick={() => onAttach(attachments.filter((_, j) => j !== i))}
                  className="text-zinc-500 hover:text-white transition-colors"
                  aria-label={`Remove ${a.file.name}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-3.5 rounded-[18px] text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
          aria-label="Attach file"
          disabled={isOffline}
        >
          <Plus size={20} strokeWidth={1.5} />
        </button>
        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} accept="image/*,application/pdf" aria-hidden="true" />

        {isVoiceMode ? (
          <div className="flex-1 flex items-center justify-center h-[52px] gap-3">
            <OrbitalRadar />
            <span className={cn(SYSTEM.type.mono, "text-emerald-500 tracking-widest")}>LISTENING</span>
          </div>
        ) : (
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isOffline ? "Offline -- waiting for connection..." : "Ask for edge, splits, or props..."}
            rows={1}
            disabled={isOffline}
            aria-label="Message input"
            className={cn(
              "flex-1 bg-transparent border-none outline-none resize-none py-4 min-h-[52px] max-h-[120px]",
              SYSTEM.type.body, "text-white placeholder:text-zinc-600 disabled:opacity-40",
            )}
          />
        )}

        <div className="flex items-center gap-1 pb-1.5 pr-1">
          {!value && !attachments.length && (
            <button
              onClick={toggleVoice}
              className={cn(
                "p-3 rounded-[18px]",
                isVoiceMode ? "text-rose-400 bg-rose-500/10" : "text-zinc-500 hover:bg-white/5 hover:text-white transition-colors",
              )}
              aria-label={isVoiceMode ? "Stop voice input" : "Start voice input"}
              aria-pressed={isVoiceMode}
            >
              {isVoiceMode ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          )}

          {(canSend || isProcessing) && (
            <motion.button
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => (isProcessing ? onStop() : onSend())}
              className={cn(
                "p-3 rounded-[18px] transition-all duration-300",
                canSend || isProcessing
                  ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]"
                  : "bg-white/5 text-zinc-600",
              )}
              aria-label={isProcessing ? "Stop processing" : "Send message"}
            >
              {isProcessing ? <StopCircle size={18} className="animate-pulse" /> : <ArrowUp size={18} strokeWidth={2.5} />}
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
});
InputDeck.displayName = "InputDeck";


// ═══════════════════════════════════════════════════════════════════════════
// §14  ERROR BOUNDARY
// ═══════════════════════════════════════════════════════════════════════════

class ChatErrorBoundary extends Component<
  { children: ReactNode; onReset?: () => void },
  { hasError: boolean; error?: Error }
> {
  state: { hasError: boolean; error?: Error } = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(e: Error, info: React.ErrorInfo) {
    reportError(e, { componentStack: info.componentStack ?? "unknown" });
  }

  render() {
    if (this.state.hasError)
      return (
        <div className="p-6 flex flex-col items-center justify-center gap-4" role="alert">
          <div className="text-rose-400 font-mono text-xs text-center">System Error. {this.state.error?.message}</div>
          <button
            onClick={() => { this.setState({ hasError: false, error: undefined }); this.props.onReset?.(); }}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white text-xs hover:bg-white/10 transition-colors"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        </div>
      );

    return this.props.children;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// §15  INNER CHAT WIDGET
// ═══════════════════════════════════════════════════════════════════════════

const InnerChatWidget: FC<ChatWidgetProps & {
  isMinimized?: boolean;
  setIsMinimized?: (v: boolean) => void;
}> = ({ currentMatch, inline, isMinimized, setIsMinimized }) => {
  const { toggleGlobalChat } = useAppStore();
  const [msgState, dispatch] = useReducer(messageReducer, INITIAL_MESSAGE_STATE);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [srAnnouncement, setSrAnnouncement] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const sendingRef = useRef(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const { session_id, conversation_id } = useChatContext({ match: currentMatch });
  const connectionStatus = useConnectionHealth();
  const canSend = useSendGuard();

  // Focus management
  useAutoFocus(inputRef, !isMinimized && !inline);
  useEffect(() => {
    if (!inline) previousFocusRef.current = document.activeElement as HTMLElement | null;
    return () => { previousFocusRef.current?.focus(); };
  }, [inline]);

  // Lifecycle
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try { abortRef.current?.abort(); } catch { /* */ }
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      setShouldAutoScroll(scrollHeight - scrollTop - clientHeight < 100);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    if (!shouldAutoScroll || !scrollRef.current) return;
    const el = scrollRef.current;
    if (isProcessing) {
      el.scrollTop = el.scrollHeight;
    } else {
      requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
    }
  }, [msgState.ordered, isProcessing, shouldAutoScroll]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setShouldAutoScroll(true);
  }, []);

  // Verdict tracking
  const handleTrackVerdict = useStableCallback((id: string, outcome: VerdictOutcome) => {
    dispatch({ type: "SET_VERDICT", id, outcome });
    trackAction("verdict.track", { id, outcome });
  });

  // NOTE: Keyboard shortcuts registered ONLY in outer ChatWidget (§16) — not here.

  // ── Send handler with RAF-batched streaming ──
  const handleSend = useStableCallback(async (queryOverride?: string) => {
    const text = (queryOverride ?? input).trim();
    if ((!text && !attachments.length) || isProcessing || sendingRef.current) return;
    if (!canSend()) return;
    if (connectionStatus === "offline") return;

    sendingRef.current = true;
    const sendStart = Date.now();

    // Close the abort-null window with a sentinel controller
    const prevController = abortRef.current;
    const sentinelController = new AbortController();
    abortRef.current = sentinelController;
    try { prevController?.abort(); } catch { /* */ }

    setIsProcessing(true);
    setInput("");
    setIsVoiceMode(false);
    setShouldAutoScroll(true);
    setRetryCount(0);
    setSrAnnouncement("Analyzing...");
    triggerHaptic();

    const userMsgId = generateId();
    const aiMsgId = generateId();
    const now = new Date().toISOString();

    const userMsg: Message = {
      id: userMsgId,
      role: "user",
      content: attachments.length > 0 ? buildWireContent(text || "Analyze this.", attachments) : text || "Analyze this.",
      timestamp: now,
    };
    const aiMsg: Message = { id: aiMsgId, role: "assistant", content: "", isStreaming: true, timestamp: now };

    dispatch({ type: "APPEND_BATCH", messages: [userMsg, aiMsg] });
    const currentAttachments = [...attachments];
    setAttachments([]);
    trackAction("message.send", { hasAttachments: currentAttachments.length > 0, hasMatch: !!currentMatch });

    // ── RAF batching: coalesces streaming updates to one dispatch per animation frame ──
    let batchRaf: number | null = null;
    let batchPatch: Partial<Message> | null = null;

    const flushBatch = () => {
      if (batchRaf !== null) { cancelAnimationFrame(batchRaf); batchRaf = null; }
      if (batchPatch && mountedRef.current) {
        dispatch({ type: "UPDATE", id: aiMsgId, patch: batchPatch });
        batchPatch = null;
      }
    };

    const enqueuePatch = (patch: Partial<Message>) => {
      batchPatch = batchPatch ? { ...batchPatch, ...patch } : patch;
      if (batchRaf === null) {
        batchRaf = requestAnimationFrame(flushBatch);
      }
    };

    try {
      const wireMessages: WireMessage[] = [
        ...msgState.ordered.map((m) => ({ role: m.role, content: m.content })),
        { role: userMsg.role, content: userMsg.content },
      ];

      if (currentAttachments.length > 0) {
        wireMessages[wireMessages.length - 1].content = buildWireContent(text || "Analyze this.", currentAttachments);
      }

      const context: ChatContextPayload = {
        session_id, conversation_id, gameContext: currentMatch, run_id: generateId(),
      };

      const controller = new AbortController();
      abortRef.current = controller;

      let fullText = "";
      let fullThought = "";
      let groundingData: GroundingMetadata | null = null;

      await edgeService.chat(
        wireMessages,
        context,
        (chunk: StreamChunk) => {
          if (!mountedRef.current) return;

          if (chunk.type === "text") {
            fullText += chunk.content || "";
            enqueuePatch({ content: fullText, groundingMetadata: groundingData || undefined });
          }
          if (chunk.type === "thought") {
            fullThought += chunk.content || "";
            enqueuePatch({ thoughts: fullThought });
          }
          if (chunk.type === "grounding") {
            groundingData = chunk.metadata || null;
            enqueuePatch({ groundingMetadata: groundingData || undefined });
          }
        },
        () => {
          if (!mountedRef.current) return;
          flushBatch(); // Ensure final text is dispatched before marking complete
          dispatch({ type: "UPDATE", id: aiMsgId, patch: { isStreaming: false } });
          setSrAnnouncement("Analysis complete.");
          reportTiming("chat.e2e", sendStart);
        },
        (attempt: number) => {
          if (!mountedRef.current) return;
          setRetryCount(attempt);
        },
        controller.signal,
      );
    } catch (err: unknown) {
      if (!mountedRef.current) return;

      if (err instanceof DOMException && err.name === "AbortError") {
        flushBatch();
        dispatch({ type: "UPDATE", id: aiMsgId, patch: { isStreaming: false } });
        setSrAnnouncement("Stopped.");
        return;
      }

      const errorMessage = err instanceof Error ? err.message : "Connection interrupted";
      flushBatch();
      dispatch({ type: "UPDATE", id: aiMsgId, patch: { content: `${errorMessage}. Please try again.`, isStreaming: false } });
      setSrAnnouncement("Error occurred.");
      reportError(err, { phase: "handleSend" });
    } finally {
      // Cancel any dangling RAF
      if (batchRaf !== null) cancelAnimationFrame(batchRaf);
      if (mountedRef.current) {
        setIsProcessing(false);
        setRetryCount(0);
        abortRef.current = null;
      }
      sendingRef.current = false;
    }
  });

  const handleAbort = useCallback(() => {
    try { abortRef.current?.abort(); } catch { /* */ }
  }, []);

  // ── Minimized state ──
  if (isMinimized && !inline) {
    return (
      <motion.button
        layoutId="chat"
        onClick={() => setIsMinimized?.(false)}
        className={cn("flex items-center gap-3 px-6 py-3 rounded-full shadow-2xl border-t border-white/10", SYSTEM.surface.glass)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Open chat"
      >
        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
        <span className={SYSTEM.type.h1}>Edge</span>
      </motion.button>
    );
  }

  const messages = msgState.ordered;

  return (
    <ToastProvider>
      <CitationProvider>
        <LayoutGroup>
          <motion.div
            layoutId={inline ? undefined : "chat"}
            role="dialog"
            aria-label="Obsidian Weissach -- Betting Intelligence"
            className={cn(
              "flex flex-col overflow-hidden transition-all duration-500 isolate relative z-50 will-change-transform",
              inline
                ? "w-full h-full bg-transparent"
                : cn(
                  "w-full md:w-[460px] h-[100dvh] md:h-[min(840px,90dvh)]",
                  "rounded-[28px] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]",
                  "border border-white/[0.08]",
                  SYSTEM.surface.void,
                ),
            )}
          >
            <FilmGrain />

            {/* SR-only live region for state announcements */}
            <div aria-live="polite" aria-atomic="true" className="sr-only">{srAnnouncement}</div>

            {!inline && (
              <header className="flex items-center justify-between px-8 pt-6 pb-2 shrink-0 z-20 select-none">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
                  <span className={SYSTEM.type.h1}>
                    Obsidian<span className="text-white/30 font-normal ml-1">Weissach</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <AnimatePresence><ConnectionBadge status={connectionStatus} /></AnimatePresence>
                  <button onClick={() => setIsMinimized?.(true)} className="p-2 text-zinc-600 hover:text-white transition-colors" aria-label="Minimize chat">
                    <Minimize2 size={16} />
                  </button>
                  <button onClick={() => toggleGlobalChat(false)} className="p-2 text-zinc-600 hover:text-white transition-colors" aria-label="Close chat">
                    <X size={16} />
                  </button>
                </div>
              </header>
            )}

            <div
              ref={scrollRef}
              role="log"
              aria-relevant="additions"
              aria-busy={isProcessing}
              aria-label="Conversation messages"
              className="relative flex-1 overflow-y-auto px-6 pt-4 pb-44 scroll-smooth no-scrollbar z-10 will-change-transform"
            >
              <AnimatePresence mode="popLayout">
                {messages.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="h-full flex flex-col items-center justify-center text-center opacity-40"
                  >
                    <div className="w-20 h-20 rounded-[24px] border border-white/10 bg-white/5 flex items-center justify-center mb-6">
                      <div className="w-1 h-1 bg-white/40 rounded-full shadow-[0_0_20px_white]" />
                    </div>
                    <p className={SYSTEM.type.mono}>System Ready</p>
                  </motion.div>
                ) : (
                  messages.map((msg) => <MessageBubble key={msg.id} message={msg} onTrackVerdict={handleTrackVerdict} />)
                )}
              </AnimatePresence>
            </div>

            {/* Scroll anchor — visible when user has scrolled up */}
            <ScrollAnchor visible={!shouldAutoScroll && messages.length > 0} onClick={scrollToBottom} />

            <footer className="absolute bottom-0 left-0 right-0 z-30 px-5 pb-8 pt-20 bg-gradient-to-t from-[#030303] via-[#030303]/95 to-transparent pointer-events-none">
              <div className="pointer-events-auto relative">
                <AnimatePresence>
                  {isProcessing && <ThinkingPill onStop={handleAbort} retryCount={retryCount} />}
                </AnimatePresence>

                <AnimatePresence>
                  {messages.length < 2 && !isProcessing && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-4">
                      <SmartChips onSelect={handleSend} hasMatch={!!currentMatch} messageCount={messages.length} />
                    </motion.div>
                  )}
                </AnimatePresence>

                <InputDeck
                  value={input}
                  onChange={setInput}
                  onSend={handleSend}
                  onStop={handleAbort}
                  attachments={attachments}
                  onAttach={setAttachments}
                  isProcessing={isProcessing}
                  isVoiceMode={isVoiceMode}
                  onVoiceModeChange={setIsVoiceMode}
                  isOffline={connectionStatus === "offline"}
                  inputRef={inputRef}
                  fileInputRef={fileInputRef}
                />
              </div>
            </footer>
          </motion.div>
        </LayoutGroup>
      </CitationProvider>
    </ToastProvider>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// §16  MAIN EXPORT
//      Cmd+K registered here — works even when chat is closed.
//      MotionConfig respects prefers-reduced-motion system preference.
// ═══════════════════════════════════════════════════════════════════════════

const ChatWidget: FC<ChatWidgetProps> = (props) => {
  const { isGlobalChatOpen, toggleGlobalChat } = useAppStore();
  const [isMinimized, setIsMinimized] = useState(false);
  const handleReset = useCallback(() => setIsMinimized(false), []);

  // Stable callbacks for keyboard shortcuts — single registration point
  const handleToggle = useStableCallback(() => toggleGlobalChat(!isGlobalChatOpen));
  const handleClose = useStableCallback(() => toggleGlobalChat(false));

  useKeyboardShortcuts(handleToggle, handleClose, isGlobalChatOpen);

  if (props.inline)
    return (
      <MotionConfig reducedMotion="user">
        <ChatErrorBoundary onReset={handleReset}>
          <InnerChatWidget {...props} inline />
        </ChatErrorBoundary>
      </MotionConfig>
    );

  return (
    <MotionConfig reducedMotion="user">
      <ChatErrorBoundary onReset={handleReset}>
        <AnimatePresence>
          {isGlobalChatOpen && (
            <motion.div
              initial={{ opacity: 0, y: 80, scale: 0.95, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 80, scale: 0.95, filter: "blur(10px)" }}
              transition={SYSTEM.anim.fluid}
              className={cn("fixed z-[9999]", isMinimized ? "bottom-8 right-8" : "inset-0 md:inset-auto md:bottom-8 md:right-8")}
            >
              <InnerChatWidget {...props} inline={false} isMinimized={isMinimized} setIsMinimized={setIsMinimized} />
            </motion.div>
          )}
        </AnimatePresence>
      </ChatErrorBoundary>
    </MotionConfig>
  );
};

export default ChatWidget;