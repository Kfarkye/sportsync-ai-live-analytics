/* ============================================================================
   ChatWidget.tsx
   "Obsidian Weissach" — Production Master (v26.1 Enhanced)
   
   ENHANCEMENTS (v26.1 Enhanced):
   ├─ PARSING: Recursive flattenText helper for safe Markdown parsing
   ├─ CITATIONS: Decimal regex /^[\d.]+$/ for [1.1] style chips
   ├─ TRIGGERS: Case-insensitive regex for VERDICT/INVALIDATION detection
   ├─ HEADERS: Normalized UPPERCASE matching for section styling
   ├─ PILL: Variable renamed to displayText to avoid scope conflicts
   └─ NEW: InvalidationAlert component for exit conditions
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
  Component,
  type FC,
  type ReactNode,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence, LayoutGroup, type Transition } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { supabase } from "../lib/supabase";
import { useChatContext } from "../hooks/useChatContext";
import { useAppStore } from "../store/appStore";
import {
  X,
  Plus,
  ArrowUp,
  Copy,
  CheckCircle2,
  Minimize2,
  Mic,
  MicOff,
  StopCircle,
  Image as ImageIcon,
  Zap,
  Activity,
  ChevronRight,
  ShieldCheck,
  Globe,
  ExternalLink,
  AlertTriangle
} from "lucide-react";

// =============================================================================
// UTILITIES
// =============================================================================

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function generateId(): string {
  return crypto.randomUUID();
}

function triggerHaptic(): void {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(4);
  }
}

/**
 * Recursive helper to extract raw text from React children.
 * Handles nested elements like <strong>, <em>, <a> etc.
 * 
 * @param children - React children to flatten
 * @returns Plain text string
 */
function flattenText(children: ReactNode): string {
  return React.Children.toArray(children).reduce<string>((acc, child) => {
    // Handle string nodes directly
    if (typeof child === "string") {
      return acc + child;
    }

    // Handle number nodes (convert to string)
    if (typeof child === "number") {
      return acc + String(child);
    }

    // Handle React elements with children prop
    if (React.isValidElement<{ children?: ReactNode }>(child)) {
      const elementChildren = child.props.children;
      if (elementChildren !== undefined && elementChildren !== null) {
        return acc + flattenText(elementChildren);
      }
    }

    return acc;
  }, "");
}

// =============================================================================
// HYDRATION ENGINE
// =============================================================================

/**
 * Hydrate explicit bracket citations [1], [1.1] with verified URLs from metadata.
 * Includes support for decimal citations and multi-citation blocks [1, 2].
 * 
 * @param text - Raw text with citation anchors
 * @param metadata - Grounding metadata from Gemini
 * @returns Text with markdown links
 */
function hydrateCitations(text: string, metadata?: any): string {
  if (!text) return "";
  if (!metadata?.groundingChunks || metadata.groundingChunks.length === 0) {
    return text;
  }

  const chunks = metadata.groundingChunks;
  const maxIndex = chunks.length;

  // Regex: Find [1], [1.1], [1, 2], but NOT if already a markdown link [1](
  return text.replace(/\[([\d,.\s]+)\](?!\()/g, (match, inner) => {
    const parts = inner.split(/[,\s]+/).filter((p: string) => p.trim());

    const links = parts.map((part: string) => {
      const num = parseFloat(part);
      if (isNaN(num)) return null;

      const index = Math.floor(num) - 1;  // [1] maps to index 0

      // SAFETY: Bounds check
      if (index < 0 || index >= maxIndex) return null;

      const chunk = chunks[index];
      return chunk?.web?.uri ? `[${part}](${chunk.web.uri})` : null;
    }).filter(Boolean);

    return links.length ? ` ${links.join(" ")}` : match;
  });
}

/**
 * Extract source list from grounding metadata.
 */
function extractSources(metadata?: any): Array<{ title: string; uri: string }> {
  if (!metadata?.groundingChunks) return [];

  return metadata.groundingChunks
    .filter((c: any) => c.web?.uri)
    .map((c: any) => ({
      title: c.web.title || "Source",
      uri: c.web.uri
    }));
}

/**
 * Extract text content from potentially complex message content.
 */
function extractTextContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textPart = content.find((c) => c.type === "text");
    return textPart?.text ?? "";
  }
  return "";
}

// =============================================================================
// CITATION UX (v26.2 ChatGPT-style pills)
// =============================================================================

/**
 * Clean verdict content for MARKET READ card.
 * Removes all citation links, raw brackets, and confidence text.
 */
function cleanVerdictContent(text: string): string {
  if (!text) return "";

  return text
    // Remove hydrated markdown links: [1.5](https://...)
    .replace(/\s*\[\d+(?:\.\d+)?\]\([^)]+\)/g, "")
    // Remove raw bracket citations: [1.5]
    .replace(/\s*\[\d+(?:\.\d+)?\]/g, "")
    // Remove confidence text: (Confidence: High/Medium/Low)
    .replace(/\s*\(Confidence:\s*\w+\)/gi, "")
    // Clean up double spaces and trim
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Sports-focused brand mapping for citation pills.
 */
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

/**
 * Convert hostname to readable brand name.
 */
function hostnameToBrand(hostname: string): string {
  const h = hostname.replace(/^www\./, "").toLowerCase();
  return BRAND_MAP[h] || h.split(".")[0].charAt(0).toUpperCase() + h.split(".")[0].slice(1);
}

/**
 * Safely extract hostname from URL.
 */
function getHostname(href?: string): string {
  if (!href) return "Source";
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

// =============================================================================
// WEISSACH DESIGN SYSTEM
// =============================================================================

const SYSTEM = {
  anim: {
    fluid: { type: "spring", damping: 30, stiffness: 380, mass: 0.8 } as Transition,
    draw: { duration: 0.6, ease: "circOut" } as Transition,
    morph: { type: "spring", damping: 25, stiffness: 280 } as Transition
  },
  surface: {
    void: "bg-[#050505]",
    panel: "bg-[#080808] border border-white/[0.06]",
    glass: "bg-white/[0.02] backdrop-blur-[20px] border border-white/[0.05]",
    hud: "bg-[linear-gradient(180deg,rgba(251,191,36,0.05)_0%,rgba(0,0,0,0)_100%)] border border-amber-500/20",
    milled: "border-t border-white/[0.08] border-b border-black/50 border-x border-white/[0.04]",
    alert: "bg-[linear-gradient(180deg,rgba(225,29,72,0.05)_0%,rgba(0,0,0,0)_100%)] border border-rose-500/20"
  },
  type: {
    mono: "font-mono text-[10px] tracking-[0.1em] uppercase text-zinc-500 tabular-nums",
    body: "text-[15px] leading-[1.65] tracking-[-0.01em] text-[#A1A1AA]",
    h1: "text-[13px] font-medium tracking-[-0.02em] text-white"
  },
  geo: {
    pill: "rounded-full",
    card: "rounded-[22px]",
    input: "rounded-[24px]"
  }
};

// =============================================================================
// TYPES — Strict Interfaces (Google/Apple Quality)
// =============================================================================

/**
 * Verified source from grounding search.
 */
interface Source {
  title: string;
  uri: string;
}

/**
 * Individual grounding chunk from Gemini search.
 */
interface GroundingChunk {
  web?: {
    uri: string;
    title?: string;
  };
}

/**
 * Grounding metadata from Gemini API response.
 */
interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  searchEntryPoint?: {
    renderedContent: string;
  };
  webSearchQueries?: string[];
}

/**
 * Text content part in a message.
 */
interface TextContent {
  type: "text";
  text: string;
}

/**
 * Image content part in a message.
 */
interface ImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

/**
 * Union type for all possible message content formats.
 */
type MessageContent = string | (TextContent | ImageContent)[];

/**
 * Chat message with full typing.
 */
interface Message {
  id: string;
  role: "user" | "assistant";
  content: MessageContent;
  thoughts?: string;
  sources?: Source[];
  groundingMetadata?: GroundingMetadata;
  isStreaming?: boolean;
  timestamp: string;
  error?: {
    message: string;
    retryable: boolean;
  };
}

/**
 * File attachment for multimodal messages.
 */
interface Attachment {
  file: File;
  base64: string;
  mimeType: string;
}

/**
 * Game context passed to the chat widget.
 */
interface GameContext {
  match_id?: string;
  home_team?: string;
  away_team?: string;
  league?: string;
  start_time?: string;
  status?: string;
  current_odds?: Record<string, unknown>;
}

/**
 * ChatWidget component props.
 */
interface ChatWidgetProps {
  currentMatch?: GameContext;
  inline?: boolean;
}

/**
 * Stream chunk from the edge function.
 */
interface StreamChunk {
  type: "text" | "thought" | "grounding" | "error";
  content?: string;
  metadata?: GroundingMetadata;
  done?: boolean;
}

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

  interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionResult {
    readonly length: number;
    readonly isFinal: boolean;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
  }

  interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }
}

// =============================================================================
// PREMIUM VISUAL COMPONENTS
// =============================================================================

const FilmGrain = memo(() => (
  <div
    className="absolute inset-0 pointer-events-none z-0 opacity-[0.03] mix-blend-overlay"
    style={{
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
    }}
  />
));

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

/**
 * InlineCitationPill - ChatGPT-style tap-toggle citation with domain branding.
 * Single active popover controlled by parent state.
 */
type InlineCitationPillProps = {
  id: string;
  href?: string;
  indexLabel: string;
  active: boolean;
  onToggle: (id: string) => void;
};

const InlineCitationPill: FC<InlineCitationPillProps> = memo(({ id, href, indexLabel, active, onToggle }) => {
  const hostname = getHostname(href);
  const brand = hostnameToBrand(hostname);

  return (
    <span className="inline-flex items-center align-middle relative mx-0.5 -translate-y-[1px]">
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          triggerHaptic();
          onToggle(id);
        }}
        className={cn(
          "inline-flex items-center gap-1 h-[18px] px-2 rounded-full border transition-all select-none cursor-pointer",
          active
            ? "bg-emerald-500/15 border-emerald-500/35 text-emerald-200 shadow-[0_0_18px_rgba(16,185,129,0.18)]"
            : "bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:bg-white/[0.05] hover:border-emerald-500/20 hover:text-zinc-300"
        )}
        aria-expanded={active}
        aria-controls={`cite-popover-${id}`}
      >
        <span className="text-[10px] font-medium tracking-wide">{brand}</span>
      </button>

      <AnimatePresence>
        {active && (
          <motion.div
            id={`cite-popover-${id}`}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={SYSTEM.anim.fluid}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[240px] z-50"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="p-3 bg-[#0A0A0B] border border-white/10 rounded-2xl shadow-[0_20px_40px_-10px_rgba(0,0,0,0.8)] backdrop-blur-xl">
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5">
                <ShieldCheck size={12} className="text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-white truncate">{brand}</div>
                  <div className="text-[9px] font-mono text-zinc-500 truncate">{hostname}</div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400/80 uppercase tracking-wider">
                  <Globe size={10} />
                  <span>Source {indexLabel}</span>
                </div>

                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open</span>
                    <ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="text-[10px] font-mono text-zinc-600">No link</span>
                )}
              </div>
            </div>

            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#0A0A0B] border-r border-b border-white/10 rotate-45" />
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
});

// =============================================================================
// TOAST SYSTEM
// =============================================================================

const ToastContext = createContext<{ showToast: (m: string) => void }>({
  showToast: () => { }
});

const ToastProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<{ id: string; message: string } | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((message: string) => {
    const id = generateId();
    setToast({ id, message });
    triggerHaptic();

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 2500);
  }, []);

  return (
    <ToastContext.Provider value={useMemo(() => ({ showToast }), [showToast])}>
      {children}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={SYSTEM.anim.fluid}
            className={cn(
              "absolute bottom-28 left-1/2 -translate-x-1/2 z-[70]",
              "flex items-center gap-3 px-4 py-2.5",
              "bg-[#0A0A0A] border border-white/10 rounded-full",
              "shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
            )}
          >
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,1)]" />
            <span className="text-[12px] font-medium text-white tracking-tight">
              {toast.message}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
};

// =============================================================================
// INTELLIGENCE ARTIFACT COMPONENTS
// =============================================================================

const CopyButton: FC<{ content: string }> = memo(({ content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    triggerHaptic();
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "p-1.5 rounded-md transition-all duration-200",
        copied
          ? "text-emerald-400 bg-emerald-500/10"
          : "text-zinc-600 hover:text-zinc-300 hover:bg-white/5"
      )}
    >
      {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
    </button>
  );
});

const VerdictTicket: FC<{ content: string }> = memo(({ content }) => {
  // Strip all citations and confidence text for clean display
  const cleanContent = useMemo(() => cleanVerdictContent(content), [content]);

  return (
    <motion.div
      layout
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={SYSTEM.anim.fluid}
      className={cn(
        "my-6 relative overflow-hidden rounded-[18px] bg-[#0A0A0B] shadow-2xl group select-none",
        SYSTEM.surface.milled
      )}
    >
      {/* Shimmer Effect */}
      <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_40%,rgba(255,255,255,0.03)_45%,transparent_50%)] bg-[length:200%_100%] animate-[shimmer_5s_infinite_linear] pointer-events-none" />

      {/* Header */}
      <div className="px-6 py-3.5 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
        <span className={SYSTEM.type.mono}>Market Read</span>
        <div className="flex items-center gap-2 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
          <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[9px] font-bold text-emerald-500 tracking-wider uppercase">
            Live
          </span>
        </div>
      </div>

      {/* Content - Clean plain text, no citations */}
      <div className="relative p-6 flex items-start gap-4">
        <div className="flex-1">
          <div className="text-2xl md:text-3xl font-medium text-white tracking-tight leading-tight tabular-nums">
            {cleanContent}
          </div>
        </div>

        {/* Checkmark Icon */}
        <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center bg-white/[0.02] flex-shrink-0">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-emerald-400"
          >
            <motion.path
              d="M20 6L9 17l-5-5"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={SYSTEM.anim.draw}
            />
          </svg>
        </div>
      </div>
    </motion.div>
  );
});

/**
 * TacticalHUD - Live Triggers card with premium subtle styling.
 * Typography-driven design, no icons.
 */
const TacticalHUD: FC<{ content: string }> = memo(({ content }) => {
  const cleanContent = useMemo(() => cleanVerdictContent(content), [content]);

  return (
    <motion.div
      layout
      initial={{ x: -5, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={SYSTEM.anim.fluid}
      className={cn(
        "my-6 relative overflow-hidden",
        "rounded-r-[12px] border-l-[2px] border-l-amber-500/60",
        "bg-[linear-gradient(135deg,rgba(245,158,11,0.04)_0%,transparent_60%)]"
      )}
    >
      <div className="py-4 px-5">
        {/* Header: Typography-only, no icon */}
        <div className="mb-3 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase text-amber-500">
          Live Triggers
        </div>
        {/* Body: Clean text, no citations */}
        <div className="text-[15px] leading-[1.6] tracking-[-0.01em] text-zinc-300">
          {cleanContent}
        </div>
      </div>
    </motion.div>
  );
});

/**
 * InvalidationAlert - Exit condition card with premium subtle styling.
 * Typography-driven design, no icons.
 */
const InvalidationAlert: FC<{ content: string }> = memo(({ content }) => {
  const cleanContent = useMemo(() => cleanVerdictContent(content), [content]);

  return (
    <motion.div
      layout
      initial={{ x: -5, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={SYSTEM.anim.fluid}
      className={cn(
        "my-6 relative overflow-hidden",
        "rounded-r-[12px] border-l-[2px] border-l-red-500/50",
        "bg-[linear-gradient(135deg,rgba(239,68,68,0.04)_0%,transparent_60%)]"
      )}
    >
      <div className="py-4 px-5">
        {/* Header: Typography-only, no icon */}
        <div className="mb-3 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase text-red-500">
          Invalidation
        </div>
        {/* Body: Clean text, no citations */}
        <div className="text-[15px] leading-[1.6] tracking-[-0.01em] text-zinc-300">
          {cleanContent}
        </div>
      </div>
    </motion.div>
  );
});

const ThinkingPill: FC<{ onStop?: () => void; status?: string }> = memo(({ onStop, status = "thinking" }) => {
  const [idx, setIdx] = useState(0);

  const phrases = ["CHECKING LINES", "SCANNING", "GRADING EDGE", "VERIFYING"];

  // FIX: Variable renamed to displayText to avoid scope conflict
  const displayText = useMemo(() => {
    if (status === "streaming") return "LIVE FEED";
    if (status === "grounding") return "VERIFYING SOURCES";
    return phrases[idx];
  }, [status, idx]);

  useEffect(() => {
    if (status === "thinking") {
      const interval = setInterval(() => {
        setIdx((prev) => (prev + 1) % phrases.length);
      }, 2200);
      return () => clearInterval(interval);
    }
  }, [status]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={SYSTEM.anim.fluid}
      className="absolute bottom-[100%] left-1/2 -translate-x-1/2 mb-6 flex items-center gap-3 px-4 py-2 rounded-full bg-[#050505] border border-white/10 shadow-2xl z-30"
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
        <button
          onClick={onStop}
          className="ml-1 text-zinc-600 hover:text-zinc-200 transition-colors"
        >
          <StopCircle size={10} />
        </button>
      )}
    </motion.div>
  );
});

const SmartChips: FC<{ onSelect: (t: string) => void; hasMatch: boolean }> = memo(
  ({ onSelect, hasMatch }) => {
    const chips = hasMatch
      ? ["Sharp Report", "Best Bet", "Public Fade", "Player Props"]
      : ["Edge Today", "Line Moves", "Public Splits", "Injury News"];

    const queries: Record<string, string> = {
      "Sharp Report": "Give me the full sharp report on this game.",
      "Best Bet": "What is the best bet for this game?",
      "Public Fade": "Where is the public heavy? Should I fade?",
      "Player Props": "Analyze the top player props.",
      "Edge Today": "What games have edge today?",
      "Line Moves": "Show me significant line moves.",
      "Public Splits": "What are the public betting splits?",
      "Injury News": "What's the latest injury news?"
    };

    return (
      <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide px-6">
        {chips.map((chip, i) => (
          <motion.button
            key={chip}
            onClick={() => {
              triggerHaptic();
              onSelect(queries[chip]);
            }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, ...SYSTEM.anim.fluid }}
            whileHover={{ scale: 1.02, y: -1, backgroundColor: "rgba(255,255,255,0.06)" }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "px-3.5 py-2 bg-white/[0.03] border border-white/[0.08]",
              "transition-all backdrop-blur-sm",
              SYSTEM.geo.pill
            )}
          >
            <span className="text-[10px] font-medium text-zinc-300 tracking-wide uppercase">
              {chip}
            </span>
          </motion.button>
        ))}
      </div>
    );
  }
);

// =============================================================================
// MESSAGE BUBBLE
// =============================================================================

const MessageBubble: FC<{
  message: Message;
  isLast: boolean;
  onAction: (t: string) => void;
  activeCitation: string | null;
  setActiveCitation: (id: string | null) => void;
}> = memo(({ message, activeCitation, setActiveCitation }) => {
  const isUser = message.role === "user";

  // Apply hydration to convert [1] anchors to [1](url) links
  const verifiedContent = useMemo(() => {
    const textContent = extractTextContent(message.content);
    if (isUser) return textContent;
    return hydrateCitations(textContent, message.groundingMetadata);
  }, [message.content, message.groundingMetadata, isUser]);

  const sources = useMemo(
    () => extractSources(message.groundingMetadata),
    [message.groundingMetadata]
  );

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={SYSTEM.anim.fluid}
      className={cn(
        "flex flex-col mb-10 w-full relative group",
        isUser ? "items-end" : "items-start"
      )}
    >
      {/* Header Badge */}
      {!isUser && (
        <div className="flex items-center gap-2 mb-2 ml-1 select-none">
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              sources.length > 0
                ? "bg-emerald-500 shadow-[0_0_8px_#10b981]"
                : "bg-zinc-600"
            )}
          />
          <span
            className={cn(
              SYSTEM.type.mono,
              sources.length > 0 ? "text-emerald-500" : "text-zinc-500"
            )}
          >
            {sources.length > 0 ? "OBSIDIAN // VERIFIED" : "OBSIDIAN"}
          </span>
        </div>
      )}

      {/* Message Content */}
      <div
        className={cn(
          "relative max-w-[92%] md:max-w-[88%]",
          isUser
            ? "bg-white text-black rounded-[20px] rounded-tr-md shadow-[0_2px_10px_rgba(0,0,0,0.1)] px-5 py-3.5"
            : "bg-transparent text-white px-0"
        )}
      >
        <div className={cn("prose prose-invert max-w-none", isUser && "prose-p:text-black/90")}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Use DIV for p to allow block-level children (Tickets/HUDs)
              p: ({ children }) => {
                // FIX: Use flattenText to check content even if it contains bold/links
                const text = flattenText(children);

                // REGEX: Robust matching (Case-Insensitive) for special sections
                // VERDICT detection - handles **VERDICT:**, *VERDICT:, VERDICT:
                if (/^\*{0,2}verdict:/i.test(text)) {
                  const cleanContent = text.replace(/^\*{0,2}verdict:\*{0,2}\s*/i, "").trim();
                  return <VerdictTicket content={cleanContent} />;
                }

                // Live Triggers detection
                if (/what to watch live/i.test(text)) {
                  const cleanContent = text.replace(/.*what to watch live.*?:\s*/i, "").trim();
                  return cleanContent.length > 5 ? <TacticalHUD content={cleanContent} /> : null;
                }

                // Invalidation detection - requires colon per prompt spec
                if (/^\*{0,2}invalidation:/i.test(text)) {
                  const cleanContent = text.replace(/^\*{0,2}invalidation:\*{0,2}\s*/i, "").trim();
                  return cleanContent.length > 3 ? <InvalidationAlert content={cleanContent} /> : null;
                }

                return (
                  <div
                    className={cn(
                      SYSTEM.type.body,
                      isUser ? "text-[#1a1a1a]" : "text-[#A1A1AA]",
                      "mb-5 last:mb-0"
                    )}
                  >
                    {children}
                  </div>
                );
              },

              strong: ({ children }) => {
                // FIX: Normalize to UPPERCASE for reliable header matching
                const text = flattenText(children).toUpperCase();

                const sectionHeaders = [
                  "THE EDGE",
                  "KEY FACTORS",
                  "MARKET DYNAMICS",
                  "WHAT TO WATCH LIVE",
                  "INVALIDATION",
                  "TRIPLE CONFLUENCE",
                  "ANALYTICAL WALKTHROUGH",
                  "SENTIMENT SIGNAL",
                  "STRUCTURAL ASSESSMENT"
                ];

                if (sectionHeaders.some((h) => text.includes(h))) {
                  return (
                    <div className="mt-8 mb-3 flex items-center gap-2 pb-2 border-b border-white/5">
                      <Activity size={12} className="text-emerald-500" />
                      <span className="text-[10px] font-mono text-emerald-500 uppercase tracking-widest">
                        {children}
                      </span>
                    </div>
                  );
                }

                return <strong className="font-semibold text-white">{children}</strong>;
              },

              a: ({ href, children }) => {
                const label = flattenText(children).trim();

                // Strict numeric detection for citations: 1, 1.5, etc.
                if (/^\d+(?:\.\d+)?$/.test(label)) {
                  const pillId = `${message.id}:${label}:${href || "nolink"}`;
                  return (
                    <InlineCitationPill
                      id={pillId}
                      href={href}
                      indexLabel={label}
                      active={activeCitation === pillId}
                      onToggle={(id) => setActiveCitation(activeCitation === id ? null : id)}
                    />
                  );
                }

                // Regular links
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

              ul: ({ children }) => (
                <ul className="space-y-2 mb-4 ml-1">{children}</ul>
              ),

              li: ({ children }) => (
                <li className="flex gap-3 items-start pl-1">
                  <span className="mt-2 w-1 h-1 bg-zinc-700 rounded-full shrink-0" />
                  <span className={SYSTEM.type.body}>{children}</span>
                </li>
              )
            }}
          >
            {verifiedContent}
          </ReactMarkdown>
        </div>

        {/* Copy Button (appears on hover) */}
        {!isUser && !message.isStreaming && verifiedContent && (
          <div className="absolute -right-8 top-0 opacity-0 group-hover:opacity-100 transition-opacity delay-75">
            <CopyButton content={verifiedContent} />
          </div>
        )}
      </div>

      {/* Evidence Ledger (collapsible sources) */}
      {!isUser && !message.isStreaming && sources.length > 0 && (
        <div className="mt-4 ml-1 w-full max-w-[85%]">
          <details className="group/sources">
            <summary
              className={cn(
                "list-none cursor-pointer flex items-center gap-2 select-none",
                "opacity-60 hover:opacity-100 transition-opacity duration-300",
                SYSTEM.type.mono
              )}
            >
              <ChevronRight
                size={10}
                className="group-open/sources:rotate-90 transition-transform duration-200"
              />
              <span>EVIDENCE_LEDGER [{sources.length}]</span>
            </summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 pl-2 border-l border-white/5">
              {sources.map((source, i) => {
                let hostname = "source";
                try {
                  hostname = new URL(source.uri).hostname;
                } catch { }

                return (
                  <a
                    key={i}
                    href={source.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-transparent hover:border-emerald-500/20 transition-all group/link"
                  >
                    <div className="w-5 h-5 rounded flex items-center justify-center bg-white/5 text-[10px] font-mono text-zinc-500 group-hover/link:text-emerald-400 border border-white/5">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-zinc-300 truncate font-medium group-hover/link:text-emerald-100">
                        {source.title || "Verified Source"}
                      </div>
                      <div className="text-[9px] text-zinc-600 truncate font-mono">
                        {hostname}
                      </div>
                    </div>
                    <ExternalLink
                      size={10}
                      className="text-zinc-600 group-hover/link:text-emerald-400 opacity-0 group-hover/link:opacity-100"
                    />
                  </a>
                );
              })}
            </div>
          </details>
        </div>
      )}
    </motion.div>
  );
});

// =============================================================================
// INPUT DECK
// =============================================================================

const InputDeck: FC<{
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  attachments: Attachment[];
  onAttach: (a: Attachment[]) => void;
  isProcessing: boolean;
  isVoiceMode: boolean;
  onVoiceModeChange: (v: boolean) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
}> = memo(
  ({
    value,
    onChange,
    onSend,
    onStop,
    attachments,
    onAttach,
    isProcessing,
    isVoiceMode,
    onVoiceModeChange,
    inputRef,
    fileInputRef
  }) => {
    const recognitionRef = useRef<any>(null);

    const handleKeyDown = (e: ReactKeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (value.trim() || attachments.length) onSend();
      }
    };

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) {
        const file = e.target.files[0];
        const reader = new FileReader();

        reader.onload = () => {
          onAttach([
            ...attachments,
            {
              file,
              base64: (reader.result as string).split(",")[1],
              mimeType: file.type
            }
          ]);
        };

        reader.readAsDataURL(file);
      }
      e.target.value = "";
    };

    const toggleVoice = () => {
      const SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechAPI) return;

      if (isVoiceMode) {
        recognitionRef.current?.abort();
        onVoiceModeChange(false);
      } else {
        const recognition = new SpeechAPI();
        recognition.continuous = false;
        recognition.interimResults = true;

        recognition.onresult = (event: any) => {
          const transcript = event.results[0]?.[0]?.transcript;
          if (transcript) onChange(transcript);
        };

        recognition.onend = () => onVoiceModeChange(false);

        recognitionRef.current = recognition;
        onVoiceModeChange(true);
        recognition.start();
      }

      triggerHaptic();
    };

    return (
      <motion.div
        layout
        className={cn(
          "flex flex-col gap-2 p-1.5 relative overflow-hidden transition-colors duration-500",
          SYSTEM.geo.input,
          "bg-[#0A0A0B] shadow-2xl",
          isVoiceMode
            ? "border-emerald-500/30 shadow-[0_0_40px_-10px_rgba(16,185,129,0.15)]"
            : SYSTEM.surface.milled
        )}
        transition={SYSTEM.anim.fluid}
      >
        {/* Attachment Preview */}
        <AnimatePresence>
          {attachments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex gap-2 overflow-x-auto p-2 mb-1 scrollbar-hide"
            >
              {attachments.map((attachment, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.05] rounded-lg border border-white/[0.05]"
                >
                  <ImageIcon size={12} className="text-white/50" />
                  <span className="text-[10px] text-zinc-300 max-w-[80px] truncate">
                    {attachment.file.name}
                  </span>
                  <button
                    onClick={() => onAttach(attachments.filter((_, idx) => idx !== i))}
                    className="text-zinc-500 hover:text-white transition-colors"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Row */}
        <div className="flex items-end gap-2">
          {/* File Upload Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-3.5 rounded-[18px] text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Plus size={20} strokeWidth={1.5} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileChange}
            accept="image/*,application/pdf"
          />

          {/* Voice Mode or Text Input */}
          {isVoiceMode ? (
            <div className="flex-1 flex items-center justify-center h-[52px] gap-3">
              <OrbitalRadar />
              <span className={cn(SYSTEM.type.mono, "text-emerald-500 tracking-widest")}>
                LISTENING
              </span>
            </div>
          ) : (
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask for edge, splits, or props..."
              rows={1}
              className={cn(
                "flex-1 bg-transparent border-none outline-none resize-none py-4",
                "min-h-[52px] max-h-[120px]",
                SYSTEM.type.body,
                "text-white placeholder:text-zinc-600"
              )}
            />
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-1 pb-1.5 pr-1">
            {/* Voice Toggle */}
            {!value && !attachments.length && (
              <button
                onClick={toggleVoice}
                className={cn(
                  "p-3 rounded-[18px]",
                  isVoiceMode
                    ? "text-rose-400 bg-rose-500/10"
                    : "text-zinc-500 hover:bg-white/5 hover:text-white transition-colors"
                )}
              >
                {isVoiceMode ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
            )}

            {/* Send/Stop Button */}
            {(value || attachments.length > 0 || isProcessing) && (
              <motion.button
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                whileTap={{ scale: 0.92 }}
                onClick={() => (isProcessing ? onStop() : onSend())}
                className={cn(
                  "p-3 rounded-[18px] transition-all duration-300",
                  value || attachments.length || isProcessing
                    ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]"
                    : "bg-white/5 text-zinc-600"
                )}
              >
                {isProcessing ? (
                  <StopCircle size={18} className="animate-pulse" />
                ) : (
                  <ArrowUp size={18} strokeWidth={2.5} />
                )}
              </motion.button>
            )}
          </div>
        </div>
      </motion.div>
    );
  }
);

// =============================================================================
// EDGE SERVICE
// =============================================================================

const edgeService = {
  async chat(
    messages: any[],
    context: any,
    onChunk: (c: any) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, ...context }),
      signal
    });

    if (!response.ok) {
      throw new Error(`Stream failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
          try {
            const data = JSON.parse(trimmed.slice(5));
            onChunk(data);
          } catch {
            // Ignore parse errors for malformed chunks
          }
        }
      }
    }
  }
};

// =============================================================================
// ERROR BOUNDARY
// =============================================================================

class ChatErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ChatWidget Error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={cn("p-6 text-rose-400 font-mono text-xs")}>
          System Error. Please refresh.
        </div>
      );
    }
    return this.props.children;
  }
}

// =============================================================================
// INNER CHAT WIDGET
// =============================================================================

const InnerChatWidget: FC<
  ChatWidgetProps & {
    isMinimized?: boolean;
    setIsMinimized?: (v: boolean) => void;
  }
> = ({ currentMatch, inline, isMinimized, setIsMinimized }) => {
  const { toggleGlobalChat } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isVoiceMode, setIsVoiceMode] = useState(false);

  // Citation popover state - single active popover across all messages
  const [activeCitation, setActiveCitation] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);

  const { session_id, conversation_id } = useChatContext({ match: currentMatch });

  // Keep ref in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Citation popover: Close on outside click (capture phase) and Escape key
  useEffect(() => {
    const closePopover = () => setActiveCitation(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePopover();
    };

    // Capture phase ensures we close even if nested content stops bubbling
    document.addEventListener("pointerdown", closePopover, true);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("pointerdown", closePopover, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [messages, isProcessing]);

  const handleSend = useCallback(
    async (queryOverride?: string) => {
      const text = queryOverride ?? input.trim();
      if ((!text && !attachments.length) || isProcessing) return;

      // Abort any existing request
      if (abortRef.current) abortRef.current.abort();

      setIsProcessing(true);
      setInput("");
      setIsVoiceMode(false);
      triggerHaptic();

      // Create user message
      const userMsg: Message = {
        id: generateId(),
        role: "user",
        content: text || "Analyze this.",
        timestamp: new Date().toISOString()
      };

      // Create placeholder for AI response
      const aiMsgId = generateId();
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: aiMsgId,
          role: "assistant",
          content: "",
          isStreaming: true,
          timestamp: new Date().toISOString()
        }
      ]);

      try {
        // Build wire messages
        const wireMessages = [...messagesRef.current, userMsg].map((m) => ({
          role: m.role,
          content: m.content
        }));

        // Handle attachments
        if (attachments.length > 0) {
          wireMessages[wireMessages.length - 1].content = [
            { type: "text", text: text || "Analyze this." },
            ...attachments.map((a) => ({
              type: a.mimeType.startsWith("image") ? "image" : "file",
              source: {
                type: "base64",
                media_type: a.mimeType,
                data: a.base64
              }
            }))
          ];
          setAttachments([]);
        }

        const context = {
          session_id,
          conversation_id,
          gameContext: currentMatch,
          run_id: generateId()
        };

        abortRef.current = new AbortController();

        let fullText = "";
        let fullThought = "";
        let groundingData: any = null;

        await edgeService.chat(
          wireMessages,
          context,
          (chunk) => {
            if (chunk.type === "text") {
              fullText += chunk.content || "";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: fullText, groundingMetadata: groundingData || m.groundingMetadata }
                    : m
                )
              );
            }

            if (chunk.type === "thought") {
              fullThought += chunk.content || "";
              setMessages((prev) =>
                prev.map((m) => (m.id === aiMsgId ? { ...m, thoughts: fullThought } : m))
              );
            }

            if (chunk.type === "grounding") {
              groundingData = chunk.metadata;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId ? { ...m, groundingMetadata: chunk.metadata } : m
                )
              );
            }

            if (chunk.done) {
              setMessages((prev) =>
                prev.map((m) => (m.id === aiMsgId ? { ...m, isStreaming: false } : m))
              );
            }
          },
          abortRef.current.signal
        );
      } catch (e: any) {
        if (e.name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? { ...m, content: "Connection interrupted. Please try again.", isStreaming: false }
                : m
            )
          );
        }
      } finally {
        setIsProcessing(false);
        abortRef.current = null;
      }
    },
    [input, attachments, isProcessing, session_id, conversation_id, currentMatch]
  );

  // Minimized state
  if (isMinimized && !inline) {
    return (
      <motion.button
        layoutId="chat"
        onClick={() => setIsMinimized?.(false)}
        className={cn(
          "flex items-center gap-3 px-6 py-3 rounded-full shadow-2xl border-t border-white/10",
          SYSTEM.surface.glass
        )}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
        <span className={SYSTEM.type.h1}>Edge</span>
      </motion.button>
    );
  }

  return (
    <ToastProvider>
      <LayoutGroup>
        <motion.div
          layoutId={inline ? undefined : "chat"}
          className={cn(
            "flex flex-col overflow-hidden transition-all duration-500 isolate relative z-50",
            inline
              ? "w-full h-full bg-transparent"
              : cn(
                "w-full md:w-[460px] h-[100dvh] md:h-[min(840px,90dvh)]",
                "rounded-[28px] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]",
                "border border-white/[0.08]",
                SYSTEM.surface.void
              )
          )}
        >
          <FilmGrain />

          {/* Header */}
          {!inline && (
            <header className="flex items-center justify-between px-8 pt-6 pb-2 shrink-0 z-20 select-none">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
                <span className={cn(SYSTEM.type.h1)}>
                  Obsidian
                  <span className="text-white/30 font-normal ml-1">Weissach</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsMinimized?.(true)}
                  className="p-2 text-zinc-600 hover:text-white transition-colors"
                >
                  <Minimize2 size={16} />
                </button>
                <button
                  onClick={() => toggleGlobalChat(false)}
                  className="p-2 text-zinc-600 hover:text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </header>
          )}

          {/* Messages Area */}
          <div
            ref={scrollRef}
            className="relative flex-1 overflow-y-auto px-6 pt-4 pb-44 scroll-smooth no-scrollbar z-10"
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
                messages.map((msg, i) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    isLast={i === messages.length - 1}
                    onAction={handleSend}
                    activeCitation={activeCitation}
                    setActiveCitation={setActiveCitation}
                  />
                ))
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <footer
            className={cn(
              "absolute bottom-0 left-0 right-0 z-30",
              "px-5 pb-8 pt-20",
              "bg-gradient-to-t from-[#030303] via-[#030303]/95 to-transparent",
              "pointer-events-none"
            )}
          >
            <div className="pointer-events-auto relative">
              {/* Thinking Pill */}
              <AnimatePresence>
                {isProcessing && <ThinkingPill onStop={() => abortRef.current?.abort()} />}
              </AnimatePresence>

              {/* Smart Chips */}
              <AnimatePresence>
                {messages.length < 2 && !isProcessing && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="mb-4"
                  >
                    <SmartChips onSelect={handleSend} hasMatch={!!currentMatch} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input */}
              <InputDeck
                value={input}
                onChange={setInput}
                onSend={() => handleSend()}
                onStop={() => abortRef.current?.abort()}
                attachments={attachments}
                onAttach={setAttachments}
                isProcessing={isProcessing}
                isVoiceMode={isVoiceMode}
                onVoiceModeChange={setIsVoiceMode}
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

// =============================================================================
// MAIN EXPORT
// =============================================================================

const ChatWidget: FC<ChatWidgetProps> = (props) => {
  const { isGlobalChatOpen } = useAppStore();
  const [isMinimized, setIsMinimized] = useState(false);

  // Inline mode
  if (props.inline) {
    return <InnerChatWidget {...props} inline />;
  }

  // Global overlay mode
  return (
    <ChatErrorBoundary>
      <AnimatePresence>
        {isGlobalChatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 80, scale: 0.95, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 80, scale: 0.95, filter: "blur(10px)" }}
            transition={SYSTEM.anim.fluid}
            className={cn(
              "fixed z-[9999]",
              isMinimized ? "bottom-8 right-8" : "inset-0 md:inset-auto md:bottom-8 md:right-8"
            )}
          >
            <InnerChatWidget
              {...props}
              inline={false}
              isMinimized={isMinimized}
              setIsMinimized={setIsMinimized}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </ChatErrorBoundary>
  );
};

export default ChatWidget;