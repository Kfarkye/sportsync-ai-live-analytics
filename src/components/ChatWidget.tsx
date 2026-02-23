/* ============================================================================
   ChatWidget.tsx
   "Obsidian Weissach" — Production Release (v30.1 - The Receipt)

   Architecture:
   ├─ Core: useReducer message store, Map-indexed updates, stable refs
   ├─ Network: Retry w/ exponential backoff, connection health, guarded SSE
   ├─ UI: Inline Citation Hyperlinks, LRU hydration cache
   ├─ Design: "The Pick" Card, ConfidenceRing, Progressive Disclosure, Smart Odds
   ├─ Reliability: Debounced send, abort safety, RAF-batched streaming
   ├─ Ops: Pluggable telemetry layer, structured error reporting

   Changelog v30.1 (Weissach — Bug Sweep):
   ── Fixes ──
   - FIX: ScrollAnchor triggers when messages arrive while scrolled up
   - FIX: AbortController wired — Stop button truly aborts stream
   - FIX: Thoughts accumulation uses dedicated accumulator
   - FIX: Attachments cleared after send
   - FIX: Section numbering sequential (§0–§13)

   Changelog v30.0 (The Receipt Redesign):
   ── EdgeVerdictCard ──
   - AESTHETIC: Borderless "Phantom Slab" — deep void background, top specular light
   - FEATURE: Smart Odds Detection — auto-highlights (+1300, -110, u22.5)
   - LAYOUT: Hero-class typography (30px) with maximal negative space
   - UI: ConfidenceRing SVG radial gauge — animated fill with percent label
   - UX: Command strip footer for Tail/Fade validation
   - ADD: Watermark + Share action for screenshot readiness

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
  RotateCcw,
  WifiOff,
  Eye,
  EyeOff,
  ChevronDown,
} from "lucide-react";
import type { MatchOdds } from "@/types";
import { ESSENCE } from "@/lib/essence";


// ═══════════════════════════════════════════════════════════════════════════
// Extracted Modules (see src/components/chat/)
// ═══════════════════════════════════════════════════════════════════════════
import type {
  GroundingChunk,
  GroundingSupport,
  GroundingMetadata,
  TextContent,
  ImageContent,
  FileContent,
  MessagePart,
  MessageContent,
  Message,
  Attachment,
  GameContext,
  ChatWidgetProps,
  StreamChunk,
  WireMessage,
  ChatContextPayload,
  ConnectionStatus,
  VerdictOutcome,
} from "./chat/types";
import {
  REGEX_VERDICT_MATCH,
  REGEX_WATCH_PREFIX,
  REGEX_WATCH_MATCH,
  REGEX_EDGE_SECTION_HEADER,
  REGEX_MATCHUP_LINE,
  EXCLUDED_SECTIONS,
  REGEX_SIGNED_NUMERIC,
  REGEX_CITATION_PLACEHOLDER,
  REGEX_SPLIT_COMMA,
  REGEX_MULTI_SPACE,
  CITE_MARKER,
  REGEX_CLEAN_CITE_LINK,
  REGEX_CLEAN_SUPPORT_CITE,
  REGEX_CLEAN_HYDRATED_CITE,
  REGEX_CLEAN_SUPERSCRIPT_CITE,
  REGEX_CLEAN_LINK,
  REGEX_CLEAN_REF,
  REGEX_CLEAN_CONF,
  REGEX_EXTRACT_CONF,
  BRAND_COLOR_MAP,
  DEFAULT_BRAND,
  LIVE_BRAND,
  LIVE_PATH_BRANDS,
  EDGE_CARD_STAGE_DELAYS_MS,
  EDGE_CARD_STAGGER_PER_CARD_MS,
  EDGE_CARD_SPRING,
  EDGE_CARD_EASE_OUT,
  LIVE_STATUS_TOKENS,
  FINAL_STATUS_TOKENS,
  SMART_CHIP_QUERIES,
  SYSTEM,
  RETRY_CONFIG,
  SEND_DEBOUNCE_MS,
  MAX_FILE_SIZE_BYTES,
  type BrandInfo,
} from "./chat/config";
import {
  cn,
  generateId,
  triggerHaptic,
  flattenText,
  isTextInputFocused,
  formatTimestamp,
  formatFileSize,
  chunkFingerprint,
  LRUCache,
  injectSupportCitations,
  SUPERSCRIPT_DIGITS,
  toSuperscript,
  hydrateCitations,
  extractTextContent,
  cleanVerdictContent,
  extractConfidence,
  confidenceToPercent,
  hostnameToBrandInfo,
  getHostname,
  shouldRenderCitation,
  uriToBrandInfo,
  buildWireContent,
  getRetryDelay,
  getTimePhase,
  toStringOrUndefined,
  toNumberOrUndefined,
  normalizeGameContext,
  resolveConfidenceValue,
  parseEdgeVerdict,
  extractEdgeSynopses,
  detectCitationMode,
  parseCitationUrl,
  deriveGamePhase,
  isLiveGame,
  isSignedNumeric,
} from "./chat/utils";

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
        // 30s TTFB timeout — prevents indefinite hangs on bad networks.
        // Wraps caller signal so manual abort still works.
        const fetchController = new AbortController();
        const ttfbTimeout = setTimeout(() => fetchController.abort(new Error("Connection timed out")), 30_000);
        if (signal) signal.addEventListener("abort", () => fetchController.abort(), { once: true });

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages, ...context }),
          signal: fetchController.signal,
        });

        clearTimeout(ttfbTimeout);

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
        className="absolute bottom-32 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-base/90 border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.6)] backdrop-blur-sm hover:bg-white/10 transition-colors"
        aria-label="Scroll to latest messages"
      >
        <ArrowDown size={10} className="text-emerald-400" />
        <span className="text-caption font-medium text-zinc-300 tracking-wide uppercase">Latest</span>
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
            className="absolute bottom-28 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 px-4 py-2.5 bg-surface-base border border-white/10 rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.5)] will-change-transform"
          >
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,1)]" />
            <span className="text-small font-medium text-white tracking-tight">{toast.message}</span>
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
 * ─────────────────────────────────────────────────
 * Obsidian Weissach — Design Tokens (local to EdgeVerdictCard)
 * All values mirror ESSENCE but as inline-style primitives.
 * ─────────────────────────────────────────────────
 */
const OW = {
  card:     ESSENCE.colors.surface.card,
  elevated: ESSENCE.colors.surface.elevated,
  mint:     ESSENCE.colors.accent.mint,
  mintDim:  ESSENCE.colors.accent.mintDim,
  mintEdge: ESSENCE.colors.accent.mintEdge,
  gold:     ESSENCE.colors.accent.gold,
  goldDim:  ESSENCE.colors.accent.goldDim,
  red:      ESSENCE.colors.accent.rose,
  t1: ESSENCE.colors.text.primary,
  t2: ESSENCE.colors.text.secondary,
  t3: ESSENCE.colors.text.tertiary,
  t4: ESSENCE.colors.text.muted,
  tSys: ESSENCE.colors.text.ghost,
  border: ESSENCE.colors.border.default,
  sans: "'DM Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  mono: "'DM Mono', 'SF Mono', 'Fira Code', monospace",
  r:  16,   // M-23: Outer card radius — 16px
  ri: 10,   // M-23: Button/inner element radius — 10px
  ease: "cubic-bezier(0.25, 0.1, 0.25, 1)",
  shadow: ESSENCE.shadows.obsidian,
} as const;

/** ShareIcon — upload arrow for share button */
const OWShareIcon: FC = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <path d="M8 2v8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M4.5 5.5L8 2l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M13 10v2.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 12.5V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

/** CheckIcon — confirmation for copied state */
const OWCheckIcon: FC = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <path d="M3.5 8.5L6.5 11.5 12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/**
 * MetricsPanel — Obsidian Weissach collapsible metrics tray.
 * M-01: Three-column grid, center-distributed, no pipes, no ring.
 * M-02: CONF value in white (only EDGE gets color).
 * Numbers ABOVE labels for scanability.
 */
const MetricsPanel: FC<{
  confidence: number; edge?: number; winProb?: number; open: boolean;
}> = memo(({ confidence, edge, winProb, open }) => {
  return (
    <div style={{
      display: "grid",
      gridTemplateRows: open ? "1fr" : "0fr",
      opacity: open ? 1 : 0,
      transition: `grid-template-rows 0.3s ${OW.ease}, opacity 0.25s ${OW.ease}`,
      marginTop: open ? 12 : 0,
    }}>
      <div style={{ overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          textAlign: "center", padding: "20px 0",
          background: OW.elevated, borderRadius: OW.ri,
        }}>
          {/* CONF — always white */}
          <div>
            <div style={{
              fontFamily: OW.mono, fontSize: 20, fontWeight: 500,
              letterSpacing: "-0.01em", color: OW.t1,
            }}>{confidence}%</div>
            <div style={{
              fontFamily: OW.mono, fontSize: 12, fontWeight: 500,
              letterSpacing: "0.12em", textTransform: "uppercase",
              color: OW.t4, marginTop: 4,
            }}>CONF</div>
          </div>
          {/* EDGE — emerald when positive, amber when negative, white when zero */}
          <div>
            <div style={{
              fontFamily: OW.mono, fontSize: 20, fontWeight: 500,
              letterSpacing: "-0.01em",
              color: edge != null && edge > 0 ? OW.mint : edge != null && edge < 0 ? OW.gold : OW.t1,
            }}>{edge != null ? `${edge > 0 ? "+" : ""}${edge}%` : "—"}</div>
            <div style={{
              fontFamily: OW.mono, fontSize: 12, fontWeight: 500,
              letterSpacing: "0.12em", textTransform: "uppercase",
              color: OW.t4, marginTop: 4,
            }}>EDGE</div>
          </div>
          {/* WIN — always white */}
          <div>
            <div style={{
              fontFamily: OW.mono, fontSize: 20, fontWeight: 500,
              letterSpacing: "-0.01em", color: OW.t1,
            }}>{winProb != null ? `${winProb}%` : "—"}</div>
            <div style={{
              fontFamily: OW.mono, fontSize: 12, fontWeight: 500,
              letterSpacing: "0.12em", textTransform: "uppercase",
              color: OW.t4, marginTop: 4,
            }}>WIN</div>
          </div>
        </div>
      </div>
    </div>
  );
});
MetricsPanel.displayName = "MetricsPanel";

/**
 * EdgeVerdictCard — "Obsidian Weissach" FINAL
 *
 * Full card: THE PICK label → Hero headline →
 * Divider → Matchup line → Collapsible Metrics →
 * Synopsis block → Tail/Fade/Share footer → Analysis disclosure
 *
 * Features:
 * - Live game breathe animation on specular edge light
 * - Share button with capture state + watermark
 * - Tail/Fade hover states (mint glow on Tail, subtle lift on Fade)
 */
const EdgeVerdictCard: FC<{
  content: string;
  confidence?: ConfidenceLevel;
  synopsis?: string;
  matchupLine?: string;
  trackingKey: string;
  cardIndex?: number;
  outcome?: VerdictOutcome;
  onTrack?: (trackingKey: string, outcome: VerdictOutcome) => void;
  hasAnalysis?: boolean;
  analysisOpen?: boolean;
  onToggleAnalysis?: () => void;
}> = memo(({
  content, confidence = "high", synopsis, matchupLine, trackingKey,
  cardIndex = 0, outcome, onTrack,
  hasAnalysis, analysisOpen, onToggleAnalysis,
}) => {
  const parsedVerdict = useMemo(() => parseEdgeVerdict(content), [content]);
  const confidenceValue = useMemo(() => resolveConfidenceValue(confidence, content), [confidence, content]);
  const [entered, setEntered] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "capturing" | "copied">("idle");

  // Derive game phase and sportsbook from content
  const gamePhase = useMemo(() => getTimePhase(), []);
  const isLive = gamePhase === "live";

  useEffect(() => {
    const timer = window.setTimeout(() => setEntered(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  const stageStyle = useCallback((baseDelayMs: number): React.CSSProperties => {
    const effectiveDelay = (baseDelayMs + cardIndex * EDGE_CARD_STAGGER_PER_CARD_MS) / 1000;
    return {
      opacity: entered ? 1 : 0,
      transform: entered ? "translateY(0)" : "translateY(16px)",
      transition: `opacity 0.55s ${EDGE_CARD_EASE_OUT} ${effectiveDelay}s, transform 0.7s ${EDGE_CARD_SPRING} ${effectiveDelay}s`,
    };
  }, [cardIndex, entered]);

  // M-14: Ensure synopsis always exists — fallback to summaryLabel if extraction yielded nothing
  const resolvedSynopsis = (synopsis && synopsis.length > 0)
    ? synopsis
    : (parsedVerdict.summaryLabel && parsedVerdict.summaryLabel.length > 10 ? parsedVerdict.summaryLabel : "");
  const hasSynopsis = Boolean(resolvedSynopsis && resolvedSynopsis.length > 0);

  // Decompose headline into primary (team) + qualifier (spread/ML/odds)
  // M-15: Normalize team name to canonical display form
  const teamDisplay = normalizeTeamName(parsedVerdict.teamName);
  const odds = parsedVerdict.odds !== "N/A" ? parsedVerdict.odds : null;
  const qualifierPrimary = parsedVerdict.spread !== "N/A"
    ? (parsedVerdict.spread === "ML" ? "ML" : parsedVerdict.spread)
    : odds;
  const qualifierSecondary = parsedVerdict.spread !== "N/A" && odds ? odds : null;
  const qualifierForShare = qualifierPrimary
    ? `${qualifierPrimary}${qualifierSecondary ? ` ${qualifierSecondary}` : ""}`
    : "";
  const headline = teamDisplay + (qualifierForShare ? ` ${qualifierForShare}` : "");

  const handleToggle = useCallback((selection: "tail" | "fade") => {
    const next = outcome === selection ? null : selection;
    triggerHaptic();
    trackAction(`verdict.${selection}`, { trackingKey, selected: next === selection, cardIndex });
    onTrack?.(trackingKey, next);
  }, [cardIndex, onTrack, outcome, trackingKey]);

  const handleShare = useCallback(() => {
    if (shareState !== "idle") return;
    triggerHaptic();
    setShareState("capturing");
    const shareText = hasSynopsis
      ? `${headline}\n${resolvedSynopsis}\n\nthedrip.app`
      : `${headline}\n\nthedrip.app`;
    navigator.clipboard?.writeText(shareText.trim()).catch(() => {});
    trackAction("verdict.share", { trackingKey, cardIndex });
    setTimeout(() => {
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 2200);
    }, 500);
  }, [shareState, headline, hasSynopsis, synopsis, trackingKey, cardIndex]);

  const isCaptureMode = shareState === "capturing" || shareState === "copied";

  return (
    <motion.div layout className="relative overflow-hidden mb-3" style={{ borderRadius: OW.r }}>
      {/* Obsidian card surface */}
      <div style={{
        position: "relative", width: "100%",
        background: OW.card, borderRadius: OW.r,
        padding: "32px 24px 24px",
        boxShadow: OW.shadow, overflow: "hidden",
        fontFamily: OW.sans, color: OW.t1,
      }}>
        {/* Specular edge light — breathes on live games */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 1,
          background: `linear-gradient(90deg, transparent, ${OW.mintEdge} 30%, ${OW.mintEdge} 70%, transparent)`,
          opacity: isLive ? 1 : 0.65,
          animation: isLive ? "ow-breathe 3.5s ease-in-out infinite" : "none",
          zIndex: 3,
        }} aria-hidden="true" />

        {/* §1 THE PICK label */}
        <div style={stageStyle(EDGE_CARD_STAGE_DELAYS_MS[0])}>
          <div style={{
            fontFamily: OW.mono, fontSize: 9, fontWeight: 600,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: OW.t4, marginBottom: 8,
          }}>THE PICK</div>
        </div>

        {/* §2 Hero headline — team primary, qualifier secondary */}
        <div style={stageStyle(EDGE_CARD_STAGE_DELAYS_MS[1])}>
          <h3 style={{
            fontFamily: OW.sans, fontSize: 28, fontWeight: 700,
            lineHeight: 1.12, letterSpacing: "-0.02em",
            color: OW.t1, margin: 0,
          }}>
            {teamDisplay}
            {qualifierPrimary && (
              <span style={{
                fontFamily: OW.mono, fontWeight: 500,
                fontSize: 20, letterSpacing: "0.02em",
                color: OW.t3, marginLeft: 10,
              }}>
                {qualifierPrimary}
                {qualifierSecondary && (
                  <span style={{
                    marginLeft: 8,
                    fontSize: 12,
                    letterSpacing: "0.06em",
                    color: OW.t4,
                  }}>
                    {qualifierSecondary}
                  </span>
                )}
              </span>
            )}
          </h3>
        </div>

        {/* Matchup row — replaces "Best available odds" */}
        <>
          {/* M-16: Hairline divider — gradient-faded edges, consistent everywhere */}
          <div style={{ height: 1, background: "linear-gradient(to right, transparent, rgba(255,255,255,0.06) 15%, rgba(255,255,255,0.06) 85%, transparent)", margin: "20px 0 14px" }} />

          {/* §3 Matchup line + metrics toggle */}
          <div style={stageStyle(EDGE_CARD_STAGE_DELAYS_MS[2])}>
            <div style={{
              display: "flex", alignItems: "center",
              userSelect: "none", WebkitTapHighlightColor: "transparent",
            }}>
              {matchupLine && (
                <span style={{
                  fontFamily: OW.sans, fontSize: 12, fontWeight: 500,
                  color: OW.t3, letterSpacing: "0.005em", lineHeight: "20px",
                }}>
                  {matchupLine}
                </span>
              )}
              <div style={{ flex: 1, minWidth: 12 }} />
              <button onClick={() => setMetricsOpen(p => !p)} style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: 8,
                border: "none", cursor: "pointer", flexShrink: 0,
                background: metricsOpen ? "rgba(255,255,255,0.03)" : "transparent",
                color: OW.t4, transition: `all 0.2s ${OW.ease}`,
              }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none"
                  style={{
                    transform: metricsOpen ? "rotate(180deg)" : "rotate(0)",
                    transition: `transform 0.25s ${OW.ease}`,
                  }}>
                  <path d="M3 4.5L6 7.5 9 4.5" stroke="currentColor"
                    strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </>

        {/* §4 Collapsible Metrics tray */}
        <MetricsPanel
          confidence={confidenceValue}
          edge={confidenceValue >= 70 ? Math.round((confidenceValue - 50) * 0.3 * 10) / 10 : undefined}
          winProb={confidenceValue >= 50 ? Math.min(99, Math.round(confidenceValue * 0.65 + 5)) : undefined}
          open={metricsOpen && !isCaptureMode}
        />

        {/* §5 Synopsis — M-14: Always rendered when available (live and pregame alike) */}
        {hasSynopsis && (
          <div style={{
            marginTop: 20,
            fontFamily: OW.sans, fontSize: 14, fontWeight: 400,
            lineHeight: 1.78,
            color: OW.t2, letterSpacing: "0.005em",
            ...stageStyle(EDGE_CARD_STAGE_DELAYS_MS[3]),
          }}>
            {resolvedSynopsis}
          </div>
        )}

        {/* §6 Footer — M-11: Tail/Fade primary, Share ghost utility + M-22: 44px min touch targets */}
        <div style={{ marginTop: 20, position: "relative", minHeight: 44, ...stageStyle(EDGE_CARD_STAGE_DELAYS_MS[4]) }}>
          {/* Action buttons layer */}
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", gap: 8,
            opacity: isCaptureMode ? 0 : 1,
            transition: `opacity 0.2s ${OW.ease}`,
            pointerEvents: isCaptureMode ? "none" : "auto",
          }}>
            {onTrack && (
              <>
                {(["Tail", "Fade"] as const).map(label => {
                  const isTail = label === "Tail";
                  const isActive = outcome === label.toLowerCase();
                  return (
                    <button key={label}
                      onClick={() => handleToggle(label.toLowerCase() as "tail" | "fade")}
                      onMouseEnter={e => {
                        if (isActive) return;
                        const el = e.currentTarget;
                        el.style.borderColor = "transparent";
                        el.style.color = OW.t1;
                        el.style.background = "rgba(255,255,255,0.10)";
                      }}
                      onMouseLeave={e => {
                        if (isActive) return;
                        const el = e.currentTarget;
                        el.style.borderColor = "transparent";
                        el.style.color = OW.t1;
                        el.style.background = "rgba(255,255,255,0.06)";
                      }}
                      style={{
                        flex: 1, minHeight: 44, borderRadius: 10, // M-22: 44px touch target, M-23: 10px button radius
                        border: isActive ? `1px solid ${isTail ? OW.mintEdge : "rgba(239,68,68,0.15)"}` : "1px solid transparent",
                        background: isActive ? (isTail ? OW.mintDim : "rgba(239,68,68,0.04)") : "rgba(255,255,255,0.06)", // M-11: Filled bg
                        color: isActive ? (isTail ? OW.mint : OW.red) : OW.t1,
                        fontFamily: OW.sans, fontSize: 12, fontWeight: 500,
                        letterSpacing: "0.08em", textTransform: "uppercase",
                        cursor: "pointer", transition: `all 0.15s ${OW.ease}`,
                      }}>
                      {label}
                    </button>
                  );
                })}
              </>
            )}
            {/* Share button — M-11: Ghost style, narrower (content-width) */}
            <button onClick={handleShare} style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              gap: 4, minHeight: 44, padding: "0 16px", borderRadius: 10, // M-22, M-23
              border: `1px solid ${shareState === "copied" ? "rgba(54,232,150,0.2)" : OW.border}`,
              background: shareState === "copied" ? OW.mintDim : "transparent", // M-11: Ghost bg
              color: shareState === "copied" ? OW.mint : OW.t4, // M-11: Dimmer text
              fontFamily: OW.sans, fontSize: 12, fontWeight: 500,
              letterSpacing: "0.08em",
              cursor: shareState === "capturing" ? "wait" : "pointer",
              transition: `all 0.15s ${OW.ease}`, whiteSpace: "nowrap",
            }}>
              {shareState === "copied" ? <OWCheckIcon /> : shareState === "idle" ? <OWShareIcon /> : null}
              {shareState === "idle" ? "Share" : shareState === "capturing" ? "···" : "Copied"}
            </button>
          </div>

          {/* Watermark layer — visible in capture mode */}
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: isCaptureMode ? 1 : 0,
            transition: `opacity 0.25s ${OW.ease} ${isCaptureMode ? "0.1s" : "0s"}`,
            pointerEvents: "none",
          }}>
            <span style={{
              fontFamily: OW.mono, fontSize: 10, fontWeight: 400,
              letterSpacing: "0.06em", color: "rgba(255,255,255,0.18)",
            }}>thedrip.app</span>
          </div>
        </div>

        {/* §7 Disclosure Trigger — Analysis */}
        {hasAnalysis && (
          <div style={stageStyle(EDGE_CARD_STAGE_DELAYS_MS[4])}>
            {/* M-16: Consistent gradient-faded hairline */}
            <div style={{ height: 1, background: "linear-gradient(to right, transparent, rgba(255,255,255,0.06) 15%, rgba(255,255,255,0.06) 85%, transparent)", margin: "16px 0 12px" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { onToggleAnalysis?.(); triggerHaptic(); }}
                aria-expanded={analysisOpen}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  minHeight: 44, borderRadius: OW.ri, cursor: "pointer", transition: `all 0.15s ${OW.ease}`, // M-22: 44px touch target
                  background: analysisOpen ? OW.mintDim : "rgba(255,255,255,0.02)",
                  border: `1px solid ${analysisOpen ? OW.mintEdge : OW.border}`,
                }}
              >
                <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: analysisOpen ? OW.mint : OW.t4 }}>
                  Analysis
                </span>
                <motion.div animate={{ rotate: analysisOpen ? 180 : 0 }} transition={SYSTEM.anim.snap}>
                  <ChevronDown size={10} style={{ color: analysisOpen ? OW.mint : OW.t4 }} />
                </motion.div>
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
});
EdgeVerdictCard.displayName = "EdgeVerdictCard";

/**
 * TacticalHUD — "What to Watch" — M-07: Three-layer hierarchy.
 * Condition (white) → Action (emerald, with arrow) → Reasoning (dimmed).
 * Elevated card with amber glow. Border radius 12px (inner card per M-23).
 */
const TacticalHUD: FC<{ content: string }> = memo(({ content }) => {
  const c = useMemo(() => cleanVerdictContent(content), [content]);
  const parsed = useMemo(() => parseWatchFallback(c), [c]);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SYSTEM.anim.fluid}
      className={cn(
        "my-8 relative overflow-hidden",
        "rounded-xl",                          // M-23: 12px inner card radius
        "bg-surface-subtle",                        // M-24: Distinct elevated background
        "border border-edge-strong",          // M-24: Subtle but present border
        "shadow-[0_4px_24px_-8px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.03)]",
      )}
    >
      {/* Ambient amber glow */}
      <div className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(ellipse_at_top_left,rgba(245,158,11,0.08)_0%,transparent_55%)]" />
      <div className="relative z-10 p-5">
        {/* M-04: Section header in zinc-500 — neutral */}
        <p className="text-small font-mono font-medium tracking-spread uppercase text-zinc-500 mb-4">
          WHAT TO WATCH
        </p>

        {/* M-07: Three-layer structured rendering */}
        {parsed.action ? (
          <>
            {/* Condition — white, readable */}
            <p className="text-body-lg text-zinc-200 leading-relaxed">
              {parsed.condition}
            </p>
            {/* Action — emerald, the thing to do */}
            <p className="text-body-lg font-medium text-emerald-400 mt-2">
              → {parsed.action}
            </p>
            {/* Reasoning — dimmed, supporting */}
            {parsed.reasoning && (
              <p className="text-small text-zinc-500 leading-relaxed mt-2">
                {parsed.reasoning}
              </p>
            )}
          </>
        ) : (
          /* Fallback: flat prose when no arrow pattern found */
          <div className="text-body-lg leading-[1.72] tracking-[-0.005em] text-zinc-300">{c}</div>
        )}
      </div>
    </motion.div>
  );
});
TacticalHUD.displayName = "TacticalHUD";

/**
 * M-27: Pick card skeleton — shows while model generates verdict.
 * Matches final card dimensions for seamless cross-fade.
 */
const PickCardSkeleton: FC = memo(() => (
  <div style={{
    borderRadius: 16, background: OW.card,
    border: `1px solid ${OW.border}`, padding: "32px 24px 24px",
    boxShadow: OW.shadow, marginBottom: 12,
  }}>
    {/* THE PICK label skeleton */}
    <div style={{ height: 12, width: 64, borderRadius: 4, background: "rgba(255,255,255,0.04)" }}
      className="animate-pulse" />
    {/* Team name skeleton */}
    <div style={{ height: 28, width: 192, borderRadius: 4, background: "rgba(255,255,255,0.06)", marginTop: 16 }}
      className="animate-pulse" />
    {/* Hairline */}
    <div style={{ height: 1, width: "100%", background: "rgba(255,255,255,0.04)", margin: "24px 0 16px" }} />
    {/* Summary skeleton — two lines */}
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ height: 16, width: "100%", borderRadius: 4, background: "rgba(255,255,255,0.04)" }}
        className="animate-pulse" />
      <div style={{ height: 16, width: "80%", borderRadius: 4, background: "rgba(255,255,255,0.04)" }}
        className="animate-pulse" />
    </div>
  </div>
));
PickCardSkeleton.displayName = "PickCardSkeleton";

/**
 * M-25: AnalysisDisclosure — scroll-position-aware fade gradient.
 * Shows a bottom fade when more content exists below the fold.
 * Hides the fade when the user has scrolled to the bottom.
 */
const AnalysisDisclosure: FC<{
  analysisContent: string;
  components: Components;
}> = memo(({ analysisContent, components }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(true);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const checkScroll = () => {
      // Check if the content overflows the parent scroll container
      // Use the nearest scrollable ancestor to determine if content is cut off
      const parent = el.closest("[role='log']") || el.parentElement;
      if (!parent) return;
      const rect = el.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      // If the bottom of the content is within 80px of the parent's bottom, consider it scrolled to end
      const isNearBottom = rect.bottom <= parentRect.bottom + 80;
      setShowFade(!isNearBottom);
    };

    // Initial check after mount + render
    const timer = setTimeout(checkScroll, 100);
    // Listen to scroll on the nearest scrollable ancestor
    const scrollParent = el.closest("[role='log']");
    scrollParent?.addEventListener("scroll", checkScroll, { passive: true });

    return () => {
      clearTimeout(timer);
      scrollParent?.removeEventListener("scroll", checkScroll);
    };
  }, [analysisContent]);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ ...SYSTEM.anim.fluid, opacity: { duration: 0.25 } }}
      className="relative"
      style={{ overflow: "hidden" }}
    >
      <div ref={contentRef}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {analysisContent}
        </ReactMarkdown>
      </div>
      {/* M-25: Dynamic bottom fade — hides when scrolled to bottom */}
      <div
        className={cn(
          "sticky bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-surface-base to-transparent pointer-events-none transition-opacity duration-300",
          showFade ? "opacity-100" : "opacity-0",
        )}
      />
    </motion.div>
  );
});
AnalysisDisclosure.displayName = "AnalysisDisclosure";

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
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        transition={SYSTEM.anim.fluid}
        role="status"
        aria-live="polite"
        className="absolute bottom-[100%] left-1/2 -translate-x-1/2 mb-6 flex items-center gap-3 px-4 py-2 rounded-full bg-surface-base border border-white/10 shadow-2xl z-30 will-change-transform"
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
          <button onClick={onStop} className="ml-1 p-2 -m-2 text-zinc-600 hover:text-zinc-200 transition-colors" aria-label="Stop processing">
            <StopCircle size={10} />
          </button>
        )}
      </motion.div>
    );
  },
);
ThinkingPill.displayName = "ThinkingPill";

const SmartChips: FC<{
  onSelect: (t: string) => void;
  hasMatch: boolean;
  messageCount: number;
  gameContext?: GameContext | null;
}> = memo(
  ({ onSelect, hasMatch, messageCount, gameContext }) => {
    const phase = deriveGamePhase(gameContext);
    const matchupLabel = useMemo(() => getMatchupLabel(gameContext), [gameContext]);

    const chips = useMemo(() => {
      if (hasMatch) {
        switch (phase) {
          case "live": return ["Live Edge", "Sharp Report", "Momentum", "Live Games"];
          case "postgame": return ["Recap", "What Tailed / Faded", "Tomorrow Slate", "Bankroll"];
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
        {/* Matchup context chip — emerald accent, shows attached game */}
        {matchupLabel && (
          <div className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/[0.06] border border-emerald-500/[0.12] shrink-0 rounded-full">
            <div className="w-1 h-1 bg-emerald-500 rounded-full shadow-[0_0_4px_#10b981]" />
            <span className="text-caption font-mono font-medium text-emerald-400/90 tracking-wide uppercase whitespace-nowrap">{matchupLabel}</span>
          </div>
        )}
        {chips.map((chip, i) => (
          <motion.button
            key={chip}
            onClick={() => { triggerHaptic(); onSelect(SMART_CHIP_QUERIES[chip] ?? chip); }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: (matchupLabel ? i + 1 : i) * 0.04, ...SYSTEM.anim.fluid }}
            whileHover={{ scale: 1.02, y: -1, backgroundColor: "rgba(255,255,255,0.06)" }}
            whileTap={{ scale: 0.98 }}
            className={cn("px-3.5 py-2 bg-overlay-dim border border-edge-strong transition-all backdrop-blur-sm shrink-0", SYSTEM.geo.pill)}
          >
            <span className="text-caption font-medium text-zinc-300 tracking-wide uppercase whitespace-nowrap">{chip}</span>
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
        "flex items-center gap-2 px-3 py-1.5 rounded-full text-caption font-mono uppercase tracking-wider",
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
// §11  (Cleared — citations are now inline hyperlinks)
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// §12  MESSAGE BUBBLE
// ═══════════════════════════════════════════════════════════════════════════

const MessageBubble: FC<{
  message: Message;
  onTrackVerdict?: (trackingKey: string, outcome: VerdictOutcome) => void;
  verdictOutcomes?: Record<string, VerdictOutcome>;
  showCitations?: boolean;
}> = memo(
  ({ message, onTrackVerdict, verdictOutcomes, showCitations = true }) => {
    const isUser = message.role === "user";
    const rawText = useMemo(() => extractTextContent(message.content), [message.content]);
    const verifiedContent = useMemo(() => {
      const t = rawText;
      if (isUser) return t;
      const cited = showCitations
        ? injectSupportCitations(t, message.groundingMetadata, message.isStreaming)
        : t;
      // M-26: Apply typography normalization to all AI prose (em-dashes, ellipsis, smart quotes)
      // Only on completed messages to avoid interfering with streaming text
      return message.isStreaming ? cited : normalizeTypography(cited);
    }, [message.content, message.groundingMetadata, message.isStreaming, isUser, showCitations]);

    const formattedTime = useMemo(() => formatTimestamp(message.timestamp), [message.timestamp]);

    /** Edge synopses extracted once per message for verdict card enrichment */
    const synopses = useMemo(() => extractEdgeSynopses(rawText), [rawText]);
    const matchups = useMemo(() => extractMatchupLines(rawText), [rawText]);
    const contentSansMatchups = useMemo(
      () => (isUser ? verifiedContent : stripMatchupLines(verifiedContent)),
      [verifiedContent, isUser],
    );

    /**
     * Progressive Disclosure: Split content at verdict boundary.
     * The pick card is always visible. The analytical breakdown
     * (Key Factors, Market Dynamics, etc.) collapses behind disclosure.
     * During streaming, show everything — split only on completed messages.
     */
    const { pickContent, analysisBlocks } = useMemo(() => {
      if (isUser || !contentSansMatchups || message.isStreaming) {
        return { pickContent: contentSansMatchups, analysisBlocks: [] };
      }
      return splitPickContent(contentSansMatchups);
    }, [contentSansMatchups, isUser, message.isStreaming]);

    /** Double-disclosure state — controlled from here, triggered from the pick card */
    const [analysisOpenByKey, setAnalysisOpenByKey] = useState<Record<string, boolean>>({});
    const toggleAnalysis = useCallback((key: string) => {
      setAnalysisOpenByKey(prev => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const analysisComponents: Components = useMemo(() => ({
      p: ({ children }) => {
        const text = flattenText(children);
        if (REGEX_WATCH_MATCH.test(text)) {
          const c = text.replace(REGEX_WATCH_PREFIX, "").trim();
          return c.length > 5 ? <TacticalHUD content={c} /> : null;
        }
        return (
          <div className={cn(SYSTEM.type.body, isUser && "text-[#1a1a1a]", "mb-6 last:mb-0")}>
            {children}
          </div>
        );
      },
      strong: ({ children }) => {
        const rawText = flattenText(children);
        const text = rawText.toUpperCase();
        const isSection = REGEX_EDGE_SECTION_HEADER.test(text);
        if (isSection) {
          const normalized = normalizeHeader(rawText);
          if (EXCLUDED_SECTIONS.some(s => normalized.toLowerCase() === s)) {
            return null;
          }
          return (
            <div className="mb-3">
              <div style={{ height: 1, background: "linear-gradient(to right, transparent, rgba(255,255,255,0.06) 15%, rgba(255,255,255,0.06) 85%, transparent)" }} />
              <div className="mt-8 flex items-center gap-2.5">
                <div className="w-1 h-1 rounded-full bg-zinc-600" />
                <span className="text-small font-mono font-medium text-zinc-500 uppercase tracking-spread">{normalized}</span>
              </div>
            </div>
          );
        }
        const stripped = rawText.replace(/^[●•·‣]\s*/, "");
        return <strong className={cn("font-semibold", isUser ? "text-black" : "text-white")}>{stripped}</strong>;
      },
      a: ({ href, children }) => {
        const isCitation = href?.includes(CITE_MARKER);
        const isSuperscript = href?.includes("#__cite_sup__");
        let brandColor = "";
        let cleanHref = href || "";
        if (isCitation) {
          const markerIdx = cleanHref.indexOf(CITE_MARKER);
          const colorFragment = cleanHref.slice(markerIdx + CITE_MARKER.length);
          brandColor = decodeURIComponent(colorFragment);
          cleanHref = cleanHref.slice(0, markerIdx);
        } else if (isSuperscript) {
          cleanHref = cleanHref.replace("#__cite_sup__", "");
        }
        if (isSuperscript) {
          return (
            <a
              href={cleanHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-600 no-underline hover:text-zinc-400 text-[0.65em] align-super transition-colors duration-200"
            >
              {children}
            </a>
          );
        }
        if (isCitation) {
          const hoverStyle = brandColor
            ? { "--cite-hover-color": brandColor, "--cite-hover-underline": `${brandColor}40` } as React.CSSProperties
            : {};
          return (
            <a
              href={cleanHref}
              target="_blank"
              rel="noopener noreferrer"
              className="cite-link text-[#63636E] no-underline transition-all duration-200 hover:underline underline-offset-4 decoration-1"
              style={hoverStyle}
            >
              {children}
            </a>
          );
        }
        return (
          <a
            href={cleanHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400/70 no-underline hover:text-emerald-300 hover:underline decoration-emerald-500/30 underline-offset-4 transition-colors duration-200"
          >
            {children}
          </a>
        );
      },
      ul: ({ children }) => <ul className="space-y-2 mb-4 ml-1">{children}</ul>,
      li: ({ children }) => (
        <li className="flex gap-3 items-start pl-1">
          <span className="mt-2 w-1 h-1 bg-zinc-700 rounded-full shrink-0" />
          <span className={cn(SYSTEM.type.body, isUser && "text-[#1a1a1a]")}>{children}</span>
        </li>
      ),
    }), [isUser]);

    const components: Components = useMemo(
      () => {
        let verdictCardIndex = 0;

        return {
          p: ({ children }) => {
            const text = flattenText(children);

            if (REGEX_VERDICT_MATCH.test(text)) {
              const verdictPayload = extractVerdictPayload(text);
              const confidence = extractConfidence(verdictPayload);
              const trackingKey = `${message.id}:v${verdictCardIndex}`;
              const cardIdx = verdictCardIndex;
              verdictCardIndex++;
              const analysisBlock = analysisBlocks[cardIdx];
              const isOpen = Boolean(analysisOpenByKey[trackingKey]);
              return (
                <>
                  <EdgeVerdictCard
                    content={verdictPayload}
                    confidence={confidence}
                    synopsis={synopses[cardIdx]}
                    matchupLine={matchups[cardIdx]}
                    trackingKey={trackingKey}
                    cardIndex={cardIdx}
                    outcome={verdictOutcomes?.[trackingKey] ?? message.verdictOutcome}
                    onTrack={onTrackVerdict}
                    hasAnalysis={!!analysisBlock}
                    analysisOpen={isOpen}
                    onToggleAnalysis={() => toggleAnalysis(trackingKey)}
                  />
                  <AnimatePresence initial={false}>
                    {isOpen && analysisBlock && (
                      <AnalysisDisclosure analysisContent={analysisBlock} components={analysisComponents} />
                    )}
                  </AnimatePresence>
                </>
              );
            }

            if (REGEX_WATCH_MATCH.test(text)) {
              const c = text.replace(REGEX_WATCH_PREFIX, "").trim();
              return c.length > 5 ? <TacticalHUD content={c} /> : null;
            }

            // M-26: Apply typography normalization to body paragraphs
            return (
              <div className={cn(SYSTEM.type.body, isUser && "text-[#1a1a1a]", "mb-6 last:mb-0")}>
                {children}
              </div>
            );
          },

          strong: ({ children }) => {
            const rawText = flattenText(children);
            const text = rawText.toUpperCase();
            const isSection = REGEX_EDGE_SECTION_HEADER.test(text);

            if (isSection) {
              // M-04: All section headers zinc-500 — no emerald, no amber
              // M-05/M-06: Normalize header — strip LIVE, PREGAME, trailing colons
              // M-13: Strip inline bullet characters (•, ·, ‣, ●) before headers
              const normalized = normalizeHeader(rawText);
              // Safety net: skip excluded sections (e.g. THE EDGE) in case content filter missed them
              if (EXCLUDED_SECTIONS.some(s => normalized.toLowerCase() === s)) {
                return null;
              }
              return (
                <div className="mb-3">
                  {/* M-16/M-17: Hairline divider after 24px body bottom margin (from mb-6 on paragraphs) */}
                  <div style={{ height: 1, background: "linear-gradient(to right, transparent, rgba(255,255,255,0.06) 15%, rgba(255,255,255,0.06) 85%, transparent)" }} />
                  {/* M-17: 32px gap between hairline and section header */}
                  <div className="mt-8 flex items-center gap-2.5">
                    <div className="w-1 h-1 rounded-full bg-zinc-600" />
                    <span className="text-small font-mono font-medium text-zinc-500 uppercase tracking-spread">{normalized}</span>
                  </div>
                </div>
              );
            }

            // M-13: Strip bullet-prefixed bold sub-headers in prose (incl. ●)
            const stripped = rawText.replace(/^[●•·‣]\s*/, "");
            return <strong className={cn("font-semibold", isUser ? "text-black" : "text-white")}>{stripped}</strong>;
          },

          a: ({ href, children }) => {
            const isCitation = href?.includes(CITE_MARKER);
            const isSuperscript = href?.includes("#__cite_sup__");
            // Extract brand color from CITE_MARKER fragment: #__cite__%23RRGGBB or #__cite__#RRGGBB
            let brandColor = "";
            let cleanHref = href || "";
            if (isCitation) {
              const markerIdx = cleanHref.indexOf(CITE_MARKER);
              const colorFragment = cleanHref.slice(markerIdx + CITE_MARKER.length);
              brandColor = decodeURIComponent(colorFragment);
              cleanHref = cleanHref.slice(0, markerIdx);
            } else if (isSuperscript) {
              cleanHref = cleanHref.replace("#__cite_sup__", "");
            }

            if (isSuperscript) {
              // Superscript fallback: small, subtle, invisible-ish
              return (
                <a
                  href={cleanHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-600 no-underline hover:text-zinc-400 text-[0.65em] align-super transition-colors duration-200"
                >
                  {children}
                </a>
              );
            }

            if (isCitation) {
              // Invisible inline citation: phrase IS the link
              // Resting: zinc-500 (#63636E), no underline
              // Hover: brand color + hairline underline at 25% opacity
              const hoverStyle = brandColor
                ? { "--cite-hover-color": brandColor, "--cite-hover-underline": `${brandColor}40` } as React.CSSProperties
                : {};
              return (
                <a
                  href={cleanHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cite-link text-[#63636E] no-underline transition-all duration-200 hover:underline underline-offset-4 decoration-1"
                  style={hoverStyle}
                >
                  {children}
                </a>
              );
            }

            // Standard content link (non-citation)
            return (
              <a
                href={cleanHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400/70 no-underline hover:text-emerald-300 hover:underline decoration-emerald-500/30 underline-offset-4 transition-colors duration-200"
              >
                {children}
              </a>
            );
          },

          ul: ({ children }) => <ul className="space-y-2 mb-4 ml-1">{children}</ul>,
          li: ({ children }) => (
            <li className="flex gap-3 items-start pl-1">
              <span className="mt-2 w-1 h-1 bg-zinc-700 rounded-full shrink-0" />
              <span className={cn(SYSTEM.type.body, isUser && "text-[#1a1a1a]")}>{children}</span>
            </li>
          ),
        };
      },
      [analysisBlocks, analysisComponents, analysisOpenByKey, isUser, matchups, message.id, message.verdictOutcome, onTrackVerdict, synopses, toggleAnalysis, verdictOutcomes],
    );

    return (
      <motion.div
        initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={SYSTEM.anim.fluid}
        className={cn("flex flex-col mb-10 w-full relative group isolate", isUser ? "items-end" : "items-start")}
      >
        {/* M-18: iMessage-style flattened top-right corner for user bubbles */}
        <div className={cn(
          "relative max-w-[92%] md:max-w-[88%]",
          isUser
            ? "bg-white text-black rounded-[20px] rounded-tr-[6px] shadow-[0_2px_10px_rgba(0,0,0,0.1)] px-5 py-3.5"
            : "bg-transparent text-white px-0 max-w-full md:max-w-[96%]",
        )}>
          <div className={cn("prose prose-invert max-w-none", isUser && "prose-p:text-black/90")}>
            {/* M-27: Show skeleton while AI is generating but no content yet */}
            {!isUser && message.isStreaming && !pickContent?.trim() ? (
              <PickCardSkeleton />
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {pickContent}
              </ReactMarkdown>
            )}

          </div>

          {!isUser && !message.isStreaming && verifiedContent && !REGEX_VERDICT_MATCH.test(extractTextContent(message.content)) && (
            <div className="flex justify-end mt-2 opacity-0 group-hover:opacity-100 transition-opacity delay-75">
              <CopyButton content={verifiedContent} />
            </div>
          )}
        </div>

        {/* M-19: Timestamp always below, right-aligned, consistent for both roles */}
        {formattedTime && (
          <div className="text-right mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none">
            <time dateTime={message.timestamp} className="text-footnote text-zinc-600">
              {formattedTime}
            </time>
          </div>
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
        SYSTEM.geo.input, "bg-surface-base shadow-2xl focus-within:ring-1 focus-within:ring-white/[0.06]",
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
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-overlay-dim rounded-full border border-edge">
                <ImageIcon size={12} className="text-white/50" />
                <span className="text-caption text-zinc-300 max-w-[80px] truncate">{a.file.name}</span>
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
          className="p-3.5 rounded-[18px] text-zinc-500 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Attach file"
          disabled={isOffline || isProcessing}
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
            placeholder={isOffline ? "Offline -- waiting for connection..." : isProcessing ? "Waiting for response..." : "Ask for edge, splits, or props..."}
            rows={1}
            disabled={isOffline || isProcessing}
            aria-label="Message input"
            className={cn(
              "flex-1 bg-transparent border-none outline-none resize-none py-4 min-h-[52px] max-h-[120px]",
              SYSTEM.type.body, "text-white placeholder:text-zinc-600 disabled:opacity-40",
              "caret-amber-500/80 selection:bg-emerald-500/20",
            )}
          />
        )}

        {/* Unified action button — Send / Stop / Mic in one position */}
        <div className="flex items-center pb-1.5 pr-1">
          <motion.button
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              if (isProcessing) { onStop(); return; }
              if (canSend) { onSend(); return; }
              toggleVoice();
            }}
            className={cn(
              "p-3 rounded-[18px] transition-all duration-300",
              isProcessing
                ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]"
                : canSend
                  ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]"
                  : isVoiceMode
                    ? "text-rose-400 bg-rose-500/10"
                    : "text-zinc-500 hover:bg-white/5 hover:text-white",
            )}
            aria-label={isProcessing ? "Stop processing" : canSend ? "Send message" : isVoiceMode ? "Stop voice input" : "Start voice input"}
          >
            {isProcessing ? (
              <StopCircle size={18} className="animate-pulse" />
            ) : canSend ? (
              <ArrowUp size={18} strokeWidth={2.5} />
            ) : isVoiceMode ? (
              <MicOff size={18} />
            ) : (
              <Mic size={18} />
            )}
          </motion.button>
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
  const [hasUnseenContent, setHasUnseenContent] = useState(false);
  const [showCitations, setShowCitations] = useState(true);
  const unseenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevMsgCountRef = useRef(0);
  const wasStreamingRef = useRef(false);
  const [retryCount, setRetryCount] = useState(0);
  const [srAnnouncement, setSrAnnouncement] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const sendingRef = useRef(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Measure footer height to set scroll container bottom padding dynamically
  const [footerHeight, setFooterHeight] = useState(88);
  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setFooterHeight(entry.contentRect.height + 16);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { session_id, conversation_id } = useChatContext({ match: currentMatch });
  const connectionStatus = useConnectionHealth();
  const canSend = useSendGuard();

  /** Resilient game-context normalization — handles varied data shapes from API */
  const normalizedContext = useMemo(() => normalizeGameContext(currentMatch), [currentMatch]);

  /** Per-card verdict outcomes, persisted to localStorage for session continuity */
  const [verdictOutcomes, setVerdictOutcomes] = useState<Record<string, VerdictOutcome>>(() => {
    try {
      const stored = localStorage.getItem("obsidian_verdict_outcomes");
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  useEffect(() => {
    try { localStorage.setItem("obsidian_verdict_outcomes", JSON.stringify(verdictOutcomes)); } catch { /* quota exceeded — silent */ }
  }, [verdictOutcomes]);

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
      const nearBottom = scrollHeight - scrollTop - clientHeight < 200;
      setShouldAutoScroll(nearBottom);
      if (nearBottom) setHasUnseenContent(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Show LATEST only at opportune moments:
  // 1. A new message appears while user is scrolled up
  // 2. Streaming finishes while user is scrolled up
  useEffect(() => {
    const msgCount = msgState.ordered.length;
    const newMessage = msgCount > prevMsgCountRef.current;
    const streamingJustEnded = wasStreamingRef.current && !isProcessing;

    prevMsgCountRef.current = msgCount;
    wasStreamingRef.current = isProcessing;

    if (shouldAutoScroll || msgCount === 0) return;
    if (!newMessage && !streamingJustEnded) return;

    setHasUnseenContent(true);
    if (unseenTimerRef.current) clearTimeout(unseenTimerRef.current);
    unseenTimerRef.current = setTimeout(() => setHasUnseenContent(false), 4000);
    return () => { if (unseenTimerRef.current) clearTimeout(unseenTimerRef.current); };
  }, [msgState.ordered.length, isProcessing, shouldAutoScroll]);

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
    setHasUnseenContent(false);
  }, []);

  // Verdict tracking — persists per-card outcomes + updates message-level state
  const handleTrackVerdict = useStableCallback((trackingKey: string, outcome: VerdictOutcome) => {
    setVerdictOutcomes(prev => ({ ...prev, [trackingKey]: outcome }));
    const messageId = trackingKey.split(":")[0];
    dispatch({ type: "SET_VERDICT", id: messageId, outcome });
    trackAction("verdict.track", { trackingKey, outcome });
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
        session_id, conversation_id, gameContext: normalizedContext, run_id: generateId(),
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
                  "border border-edge-strong",
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
                  <button
                    onClick={() => setShowCitations(prev => !prev)}
                    className={cn("p-2 transition-colors", showCitations ? "text-emerald-400 hover:text-emerald-300" : "text-zinc-600 hover:text-zinc-400")}
                    aria-label={showCitations ? "Hide citations" : "Show citations"}
                    title={showCitations ? "Citations on" : "Citations off"}
                  >
                    {showCitations ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
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
              className="relative flex-1 overflow-y-auto px-6 pt-4 scroll-smooth no-scrollbar z-10 will-change-transform"
              style={{ paddingBottom: footerHeight }}
            >
              <AnimatePresence mode="popLayout">
                {messages.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="h-full flex flex-col items-center justify-center text-center opacity-40"
                  >
                    <div className="w-20 h-20 rounded-[24px] border border-edge bg-overlay-subtle flex items-center justify-center mb-6">
                      <div className="w-1.5 h-1.5 bg-emerald-500/60 rounded-full shadow-[0_0_20px_rgba(16,185,129,0.3)]" />
                    </div>
                    <p className={SYSTEM.type.mono}>System Ready</p>
                    <p className="text-caption text-zinc-700 mt-1.5 tracking-wide">
                      {deriveGamePhase(normalizedContext) === "live" ? "Games are live — ask for in-play edge" : deriveGamePhase(normalizedContext) === "postgame" ? "Markets closed — review your record" : "Pre-game window — find today's edge"}
                    </p>
                  </motion.div>
                ) : (
                  messages.map((msg) => <MessageBubble key={msg.id} message={msg} onTrackVerdict={handleTrackVerdict} verdictOutcomes={verdictOutcomes} showCitations={showCitations} />)
                )}
              </AnimatePresence>
            </div>

            {/* Scroll anchor — visible when user has scrolled up */}
            <ScrollAnchor visible={hasUnseenContent || (!shouldAutoScroll && msgState.ordered.length > 0)} onClick={scrollToBottom} />

            <footer ref={footerRef} className="absolute bottom-0 left-0 right-0 z-30 px-5 pb-8 pt-20 bg-gradient-to-t from-surface-base via-surface-base/95 to-transparent pointer-events-none">
              <div className="pointer-events-auto relative">
                <AnimatePresence>
                  {isProcessing && <ThinkingPill onStop={handleAbort} retryCount={retryCount} />}
                </AnimatePresence>

                <AnimatePresence>
                  {messages.length < 2 && !isProcessing && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-4">
                      <SmartChips onSelect={handleSend} hasMatch={!!currentMatch} messageCount={messages.length} gameContext={normalizedContext} />
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
