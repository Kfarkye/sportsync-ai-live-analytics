/* ============================================================================
   ChatWidget.tsx
   "Obsidian Ledger" — Production Master (v17.2)
   
   Changelog v17.2:
   ├─ FEAT: CopyButton component with haptic feedback
   ├─ FEAT: DraftKings-style thinking states
   ├─ FEAT: Supabase Storage upload for attachment persistence
   ├─ FEAT: Gemini vision handles images natively
   ├─ DESIGN: Pure typographic UI (no icons)
   ├─ DESIGN: OrbitalDots processing indicator
   └─ CORE: Full Logic (Citations, Voice, Live Game Data)
============================================================================ */

import React, {
  useState, useEffect, useRef, useCallback, useMemo, memo, Component,
  createContext, useContext,
  type ReactNode, type FC, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence, type Transition } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '../lib/supabase';
import { useChatContext } from '../hooks/useChatContext';
import { useAppStore } from '../store/appStore';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface MessageContent {
  readonly type: 'text' | 'image' | 'file';
  readonly text?: string;
  readonly source?: { readonly type: 'base64'; readonly media_type: string; readonly data: string; };
}

interface Message {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly MessageContent[];
  readonly thoughts?: string;
  readonly sources?: readonly Source[];
  readonly groundingMetadata?: GroundingMetadata;
  readonly model?: string;
  readonly isStreaming?: boolean;
  readonly timestamp: string;
}

interface WireMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly MessageContent[];
}

interface Source { readonly title: string; readonly uri: string; readonly snippet?: string; }
interface Attachment {
  readonly file: File;
  readonly base64: string;
  readonly mimeType: string;
  readonly storageUrl?: string;
}

interface GroundingSegment { readonly startIndex: number; readonly endIndex: number; readonly text?: string; }
interface GroundingSupport { readonly segment: GroundingSegment; readonly groundingChunkIndices: readonly number[]; readonly confidenceScores?: readonly number[]; }
interface GroundingChunk { readonly web?: { readonly uri: string; readonly title: string }; readonly retrievedContext?: { readonly uri: string; readonly title: string }; }
interface GroundingMetadata { readonly groundingChunks?: readonly GroundingChunk[]; readonly groundingSupports?: readonly GroundingSupport[]; readonly webSearchQueries?: readonly string[]; }

interface MatchContext {
  readonly id: string;
  readonly homeTeam?: { readonly name: string; readonly score?: number };
  readonly awayTeam?: { readonly name: string; readonly score?: number };
  readonly home_team?: string;
  readonly away_team?: string;
  readonly home_score?: number;
  readonly away_score?: number;
  readonly leagueId?: string;
  readonly league_id?: string;
  readonly status?: string;
  readonly period?: string | number;
  readonly clock?: string;
  readonly [key: string]: unknown;
}

interface ChatWidgetProps { readonly currentMatch?: MatchContext; readonly inline?: boolean; }
interface InnerChatWidgetProps extends ChatWidgetProps { readonly isMinimized?: boolean; readonly setIsMinimized?: (v: boolean) => void; }

interface EdgeServiceContext {
  readonly session_id?: string;
  readonly conversation_id?: string;
  readonly current_match?: {
    readonly match_id: string;
    readonly home_team: string;
    readonly away_team: string;
    readonly home_team_id?: string;
    readonly away_team_id?: string;
    readonly league: string;
    readonly sport?: string;
    readonly home_score?: number;
    readonly away_score?: number;
    readonly status?: string;
    readonly clock?: string;
    [key: string]: unknown;
  } | null;
  readonly run_id?: string;
}

interface StreamChunk {
  readonly type: 'text' | 'thought' | 'done' | 'error' | 'grounding';
  readonly content?: string;
  readonly conversation_id?: string;
  readonly sources?: readonly Source[];
  readonly groundingMetadata?: GroundingMetadata;
  readonly model?: string;
}

interface ToastContextValue { readonly showToast: (msg: string) => void; }
interface MatchStatsData { readonly type?: 'match_stats'; readonly WinProb?: string; readonly ExpectedGoals?: string; }

interface SpeechRecognitionEvent extends Event { readonly results: SpeechRecognitionResultList; }
interface SpeechRecognitionResultList { readonly length: number;[index: number]: SpeechRecognitionResult; }
interface SpeechRecognitionResult { readonly length: number; readonly isFinal: boolean;[index: number]: SpeechRecognitionAlternative; }
interface SpeechRecognitionAlternative { readonly transcript: string; readonly confidence: number; }
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null; onerror: ((e: Event) => void) | null;
  start(): void; stop(): void; abort(): void;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    SpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

// ============================================================================
// DESIGN SYSTEM — TYPOGRAPHIC UI
// ============================================================================

const SYSTEM = {
  geo: {
    dot: 'w-[5px] h-[5px] rounded-full',
    bar: 'w-[2px] h-3 rounded-full',
    ring: 'w-2 h-2 rounded-full border',
    square: 'w-[6px] h-[6px] rounded-[1px]',
  },
  type: {
    nano: 'text-[9px] tracking-[0.12em] uppercase font-medium',
    micro: 'text-[10px] tracking-[0.08em] uppercase font-semibold',
    caption: 'text-[11px] tracking-[0.02em] font-medium',
    body: 'text-[15px] tracking-[-0.01em] leading-[1.65] font-normal',
    title: 'text-[13px] tracking-[-0.02em] font-semibold',
    display: 'text-[18px] tracking-[-0.03em] font-semibold',
  },
  surface: {
    void: 'bg-[#030303]',
    base: 'bg-[#0a0a0b]',
    raised: 'bg-[#111113]',
    elevated: 'bg-[#161618]',
    glass: 'bg-white/[0.02] backdrop-blur-xl',
  },
  edge: {
    subtle: 'border-white/[0.04]',
    soft: 'border-white/[0.08]',
    medium: 'border-white/[0.12]',
    strong: 'border-white/[0.20]',
  },
  ink: {
    ghost: 'text-white/20',
    muted: 'text-white/40',
    secondary: 'text-white/60',
    primary: 'text-white/90',
    inverse: 'text-black/90',
  },
  spring: {
    smooth: { type: 'spring', damping: 30, stiffness: 300, mass: 0.8 } as Transition,
    snappy: { type: 'spring', damping: 22, stiffness: 400, mass: 0.5 } as Transition,
    gentle: { type: 'spring', damping: 35, stiffness: 200, mass: 1 } as Transition,
  },
  radius: {
    sm: 'rounded-[8px]',
    md: 'rounded-[12px]',
    lg: 'rounded-[16px]',
    xl: 'rounded-[20px]',
    full: 'rounded-full',
  },
} as const;

// ============================================================================
// UTILITIES
// ============================================================================

function cn(...inputs: ClassValue[]): string { return twMerge(clsx(inputs)); }
function generateId(): string { return crypto.randomUUID(); }
function triggerHaptic(): void { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8); }

function tryParseJson<T = unknown>(str: string): T | null {
  try { return JSON.parse(str) as T; } catch { return null; }
}

function parseStreamLine(line: string): StreamChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const jsonStr = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
  if (jsonStr === '[DONE]' || jsonStr === '') return null;
  return tryParseJson<StreamChunk>(jsonStr);
}

function toWireMessage(msg: Message): WireMessage {
  return { role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content };
}

function extractTextContent(content: string | readonly MessageContent[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.find(c => c.type === 'text')?.text ?? '';
  return '';
}

function injectCitations(text: string, groundingMetadata?: GroundingMetadata): string {
  if (!groundingMetadata?.groundingSupports || !groundingMetadata?.groundingChunks) return text;
  const { groundingSupports, groundingChunks } = groundingMetadata;
  const sorted = [...groundingSupports].sort((a, b) => b.segment.endIndex - a.segment.endIndex);
  let result = text;
  for (const support of sorted) {
    const { endIndex } = support.segment;
    if (endIndex > result.length || endIndex < 0) continue;
    const links = support.groundingChunkIndices
      .filter((i) => i >= 0 && i < groundingChunks.length)
      .map((i) => { const c = groundingChunks[i]; const uri = c.web?.uri || c.retrievedContext?.uri; return uri ? `[${i + 1}](${uri})` : null; })
      .filter(Boolean).join(', ');
    if (links) result = result.slice(0, endIndex) + ` ${links}` + result.slice(endIndex);
  }
  return result;
}

function extractSourcesFromGrounding(groundingMetadata?: GroundingMetadata): Source[] {
  if (!groundingMetadata?.groundingChunks) return [];
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const c of groundingMetadata.groundingChunks) {
    const uri = c.web?.uri || c.retrievedContext?.uri;
    const title = c.web?.title || c.retrievedContext?.title || 'Source';
    if (uri && !seen.has(uri)) { seen.add(uri); sources.push({ uri, title }); }
  }
  return sources;
}

function isMatchStatsData(d: unknown): d is MatchStatsData {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return o.type === 'match_stats' || (!!o.WinProb && !!o.ExpectedGoals);
}

// ============================================================================
// SERVICE LAYER
// ============================================================================

const edgeService = {
  async chat(
    messages: readonly WireMessage[],
    context: EdgeServiceContext,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content })),
        session_id: context.session_id,
        conversation_id: context.conversation_id,
        gameContext: context.current_match,
        run_id: context.run_id
      }),
      signal,
    });
    if (!response.ok) throw new Error(`Connection refused: ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Stream unavailable');
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const chunk = parseStreamLine(line);
          if (chunk) {
            if (chunk.type === 'error') throw new Error(chunk.content ?? 'Stream error');
            onChunk(chunk);
          }
        }
      }
      if (buffer.trim()) {
        const chunk = parseStreamLine(buffer);
        if (chunk && chunk.type !== 'error') onChunk(chunk);
      }
    } finally { reader.releaseLock(); }
  },
};

// ============================================================================
// CONTEXT PROVIDERS
// ============================================================================

const ToastContext = createContext<ToastContextValue>({ showToast: () => undefined });

const ToastProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<{ id: string; message: string } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const showToast = useCallback((message: string) => {
    const id = generateId();
    setToast({ id, message });
    triggerHaptic();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setToast(c => c?.id === id ? null : c), 2500);
  }, []);
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);
  return (
    <ToastContext.Provider value={useMemo(() => ({ showToast }), [showToast])}>
      {children}
      <AnimatePresence>
        {toast && (
          <motion.div key={toast.id} role="status" aria-live="polite"
            initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={SYSTEM.spring.snappy}
            className={cn('absolute bottom-32 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-5 py-3', SYSTEM.surface.elevated, SYSTEM.radius.full, 'border', SYSTEM.edge.soft, 'shadow-[0_8px_32px_rgba(0,0,0,0.5)]')}>
            <span className={cn(SYSTEM.geo.dot, 'bg-emerald-400')} />
            <span className={cn(SYSTEM.type.caption, SYSTEM.ink.primary)}>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
};

function useToast(): ToastContextValue { return useContext(ToastContext); }

// ============================================================================
// GEOMETRIC INDICATORS
// ============================================================================

const OrbitalDots = memo(() => (
  <div className="relative w-5 h-5">
    <div className={cn('absolute inset-0 m-auto w-[5px] h-[5px] rounded-full bg-emerald-400')} />
    {[0, 1, 2].map((i) => (
      <motion.div key={i} className="absolute inset-0" animate={{ rotate: 360 }}
        transition={{ duration: 2.5 - i * 0.4, repeat: Infinity, ease: 'linear', delay: i * 0.15 }}>
        <div className="absolute w-[3px] h-[3px] rounded-full bg-emerald-400"
          style={{ top: '50%', left: '50%', transform: `translate(-50%, -50%) translateX(${7 + i * 2}px)`, opacity: 0.8 - i * 0.2 }} />
      </motion.div>
    ))}
  </div>
));
OrbitalDots.displayName = 'OrbitalDots';

const CopyButton: FC<{ content: string; className?: string }> = memo(({ content, className }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); triggerHaptic(); setTimeout(() => setCopied(false), 2000); } catch { }
  }, [content]);
  return (
    <button type="button" onClick={handleCopy} className={cn('px-2 py-1 transition-all duration-200', SYSTEM.radius.sm, SYSTEM.type.nano, copied ? 'text-emerald-400 bg-emerald-500/10' : cn(SYSTEM.ink.ghost, 'hover:text-white/50 hover:bg-white/5'), className)} aria-label={copied ? 'Copied' : 'Copy'}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
});
CopyButton.displayName = 'CopyButton';

// ============================================================================
// THINKING INDICATOR
// ============================================================================

const THINKING_PHASES = ['CHECKING LINES', 'SCANNING SHARP ACTION', 'GRADING EDGE', 'LOCKING IN'] as const;

const ThinkingPill: FC<{ onStop?: () => void; status?: 'thinking' | 'streaming' | 'grounding' }> = memo(({ onStop, status = 'thinking' }) => {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (status !== 'thinking') return;
    const interval = setInterval(() => setPhase(p => (p + 1) % THINKING_PHASES.length), 1800);
    return () => clearInterval(interval);
  }, [status]);
  const displayText = status === 'streaming' ? 'LIVE' : status === 'grounding' ? 'SOURCING' : THINKING_PHASES[phase];
  return (
    <motion.div role="status" aria-label="Processing"
      initial={{ opacity: 0, scale: 0.9, width: 40 }} animate={{ opacity: 1, scale: 1, width: 140 }}
      exit={{ opacity: 0, scale: 0.9, width: 40, transition: { duration: 0.15 } }} transition={SYSTEM.spring.snappy}
      className={cn('absolute bottom-[100%] left-1/2 -translate-x-1/2 mb-4 flex items-center justify-center gap-3 px-4 py-2.5', SYSTEM.radius.full, SYSTEM.surface.void, 'border', SYSTEM.edge.soft, 'shadow-[0_8px_40px_-8px_rgba(0,0,0,0.9)] backdrop-blur-xl')}>
      <OrbitalDots />
      <motion.span key={displayText} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cn(SYSTEM.type.nano, SYSTEM.ink.secondary, 'min-w-[60px]')}>{displayText}</motion.span>
      {onStop && <button type="button" onClick={onStop} className={cn('ml-1 px-2 py-0.5', SYSTEM.radius.full, SYSTEM.type.nano, SYSTEM.ink.muted, 'hover:bg-white/5')} aria-label="Stop">×</button>}
    </motion.div>
  );
});
ThinkingPill.displayName = 'ThinkingPill';

// ============================================================================
// SMART CHIPS
// ============================================================================

const SmartChips: FC<{ onSelect: (t: string) => void; hasMatch: boolean }> = memo(({ onSelect, hasMatch }) => {
  const chips = useMemo(() => hasMatch
    ? [{ label: 'Sharp Report', query: 'Give me the full sharp report with splits, line movement, and injury impact.' }, { label: 'Best Bet', query: 'What is the best bet for this game?' }, { label: 'Public Fade', query: 'Where is the public heavy and should we fade?' }, { label: 'Props', query: 'Analyze the best player prop edges.' }]
    : [{ label: 'Edge Today', query: 'What games have the sharpest edge today?' }, { label: 'Line Moves', query: 'Show me the biggest line moves today.' }, { label: 'Public', query: 'Where is the public heavily favored?' }, { label: 'Injuries', query: 'Any major injury news affecting lines?' }], [hasMatch]);
  return (
    <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide" role="group" aria-label="Quick actions">
      {chips.map((c, i) => (
        <motion.button key={c.label} type="button" onClick={() => { triggerHaptic(); onSelect(c.query); }}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SYSTEM.spring.snappy, delay: i * 0.05 }}
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          className={cn('group relative px-4 py-2.5 flex-shrink-0', SYSTEM.radius.full, 'bg-white/[0.02] hover:bg-white/[0.05] border', SYSTEM.edge.subtle, 'hover:border-white/[0.12] transition-all duration-200')}>
          <span className={cn(SYSTEM.type.micro, SYSTEM.ink.muted, 'group-hover:text-white/80 transition-colors')}>{c.label}</span>
        </motion.button>
      ))}
    </div>
  );
});
SmartChips.displayName = 'SmartChips';

// ============================================================================
// ARTIFACTS
// ============================================================================

const MatchStatsArtifact: FC<{ data: MatchStatsData }> = memo(({ data }) => {
  const momentum = useMemo(() => [12, 18, 15, 25, 22, 30, 42, 38, 50], []);
  return (
    <div className={cn('my-6 overflow-hidden', SYSTEM.surface.raised, SYSTEM.radius.lg, 'border', SYSTEM.edge.subtle, 'shadow-[0_4px_24px_rgba(0,0,0,0.3)]')} role="region" aria-label="Live market">
      <div className={cn('flex items-center justify-between px-5 py-3 border-b', SYSTEM.edge.subtle)}>
        <span className={cn(SYSTEM.type.nano, SYSTEM.ink.muted)}>Live Market</span>
        <span className={cn(SYSTEM.geo.dot, 'bg-emerald-400 animate-pulse')} />
      </div>
      <div className="p-5 space-y-5">
        <div className="flex justify-between items-end">
          <div>
            <span className={cn(SYSTEM.type.nano, SYSTEM.ink.ghost, 'block mb-1')}>Forecast</span>
            <span className={cn(SYSTEM.type.display, SYSTEM.ink.primary)}>{data.WinProb ?? '42%'}</span>
          </div>
          <div className="text-right">
            <span className={cn(SYSTEM.type.nano, SYSTEM.ink.ghost, 'block mb-2')}>Pace</span>
            <div className="flex items-end gap-[2px] h-5">
              {momentum.slice(-8).map((v, i) => (
                <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${(v / 50) * 100}%` }} transition={{ delay: i * 0.05, ...SYSTEM.spring.gentle }} className="w-[3px] bg-emerald-400/60 rounded-full" />
              ))}
            </div>
          </div>
        </div>
        <div className={cn('grid grid-cols-2 gap-px overflow-hidden', SYSTEM.radius.md, SYSTEM.surface.base)}>
          <div className={cn(SYSTEM.surface.raised, 'p-4')}>
            <span className={cn(SYSTEM.type.nano, SYSTEM.ink.ghost, 'block mb-1')}>Intensity</span>
            <span className={cn(SYSTEM.type.title, SYSTEM.ink.primary)}>{data.ExpectedGoals ?? '1.85'}</span>
          </div>
          <div className={cn(SYSTEM.surface.raised, 'p-4')}>
            <span className={cn(SYSTEM.type.nano, SYSTEM.ink.ghost, 'block mb-1')}>Confidence</span>
            <span className={cn(SYSTEM.type.title, 'text-emerald-400')}>High</span>
          </div>
        </div>
      </div>
    </div>
  );
});
MatchStatsArtifact.displayName = 'MatchStatsArtifact';

// ============================================================================
// MESSAGE BUBBLE
// ============================================================================

const MessageBubble: FC<{ message: Message; isLast: boolean; onAction: (t: string) => void }> = memo(({ message }) => {
  const isUser = message.role === 'user';
  const textContent = useMemo(() => {
    const raw = extractTextContent(message.content);
    return isUser ? raw : injectCitations(raw, message.groundingMetadata);
  }, [message.content, message.groundingMetadata, isUser]);
  const displaySources = useMemo(() => message.sources?.length ? message.sources : extractSourcesFromGrounding(message.groundingMetadata), [message.sources, message.groundingMetadata]);
  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={SYSTEM.spring.smooth} className={cn('flex flex-col mb-8 w-full relative', isUser ? 'items-end' : 'items-start')}>
      {!isUser && (message.isStreaming || textContent) && (
        <div className="flex items-center gap-2 mb-3 ml-1">
          <span className={cn(SYSTEM.geo.dot, 'bg-white/20')} />
          <span className={cn(SYSTEM.type.nano, SYSTEM.ink.ghost)}>Edge</span>
        </div>
      )}
      <div className={cn('relative max-w-[92%] md:max-w-[85%]', isUser ? cn('bg-white text-black', SYSTEM.radius.xl, 'rounded-tr-sm shadow-[0_4px_20px_rgba(255,255,255,0.1)]') : 'bg-transparent')}>
        <div className={cn(isUser ? 'px-5 py-4' : 'px-0 py-2')}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} className={cn('prose max-w-none', isUser ? 'prose-p:text-black/90' : 'prose-invert')} components={{
            p: ({ children }) => {
              const els = React.Children.toArray(children);
              if (els.length === 1 && typeof els[0] === 'string' && els[0].startsWith('VERDICT:')) {
                const content = els[0].replace('VERDICT:', '').trim();
                return (
                  <div className={cn('my-6 overflow-hidden', SYSTEM.radius.lg, SYSTEM.surface.glass, 'border', SYSTEM.edge.soft, 'shadow-[0_8px_40px_rgba(0,0,0,0.4)]')} role="region" aria-label="Verdict">
                    <div className={cn('px-5 py-3 flex items-center justify-between border-b', SYSTEM.edge.subtle)}>
                      <span className={cn(SYSTEM.type.nano, SYSTEM.ink.ghost)}>Verdict</span>
                      <span className={cn(SYSTEM.geo.dot, 'bg-indigo-400 animate-pulse')} />
                    </div>
                    <div className="p-5"><div className={cn(SYSTEM.type.body, SYSTEM.ink.primary, 'leading-relaxed')}>{content}</div></div>
                  </div>
                );
              }
              return <p className={cn(SYSTEM.type.body, isUser ? 'text-black/85' : SYSTEM.ink.secondary, 'mb-5 last:mb-0')}>{children}</p>;
            },
            strong: ({ children }) => <strong className={cn('font-semibold', isUser ? 'text-black' : SYSTEM.ink.primary)}>{children}</strong>,
            code: ({ className, children }) => {
              const isInline = !className?.includes('language-');
              if (isInline) return <code className={cn('px-1.5 py-0.5', SYSTEM.radius.sm, isUser ? 'bg-black/10 text-black/80' : 'bg-white/10 text-indigo-200', 'text-[12px] font-mono')}>{children}</code>;
              if (className === 'language-json') {
                const d = tryParseJson(String(children).replace(/\n$/, ''));
                if (d && isMatchStatsData(d)) return <MatchStatsArtifact data={d} />;
              }
              return null;
            },
            ul: ({ children }) => <ul className="space-y-2 mb-4 ml-1">{children}</ul>,
            li: ({ children }) => <li className="flex gap-3 items-start"><span className={cn(SYSTEM.geo.dot, 'bg-white/30 mt-2 shrink-0')} /><span className={SYSTEM.ink.secondary}>{children}</span></li>,
            a: ({ href, children }) => {
              const childText = String(children);
              if (/^\d+$/.test(childText.trim())) return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center align-baseline ml-0.5 text-indigo-400/60 hover:text-indigo-300" title={href}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg></a>;
              return <a href={href} target="_blank" rel="noopener noreferrer" className={cn(SYSTEM.ink.primary, 'underline underline-offset-4 decoration-white/20 hover:decoration-white/40')}>{children}</a>;
            },
          }}>{textContent}</ReactMarkdown>
        </div>
        {!isUser && !message.isStreaming && textContent && <motion.div initial={{ opacity: 0 }} whileHover={{ opacity: 1 }} className="absolute -right-2 top-0"><CopyButton content={textContent} /></motion.div>}
      </div>
      {!isUser && !message.isStreaming && displaySources.length > 0 && (
        <div className="mt-3 ml-1 w-full max-w-[85%]">
          <details className="group/sources">
            <summary className={cn('list-none cursor-pointer flex items-center gap-2', SYSTEM.type.nano, SYSTEM.ink.ghost, 'hover:text-white/40')}>
              <span className="group-open/sources:rotate-90 transition-transform">›</span>
              <span>Sources · {displaySources.length}</span>
            </summary>
            <div className="mt-3 space-y-2">
              {displaySources.map((s, i) => (
                <a key={`${s.uri}-${i}`} href={s.uri} target="_blank" rel="noopener noreferrer" className={cn('flex items-center gap-3 px-4 py-3', SYSTEM.radius.md, SYSTEM.surface.base, 'border', SYSTEM.edge.subtle, 'hover:border-white/10 group/link')}>
                  <span className={cn('flex-shrink-0 w-5 h-5 flex items-center justify-center', SYSTEM.radius.sm, 'bg-indigo-500/10 text-indigo-400', SYSTEM.type.nano)}>{i + 1}</span>
                  <span className={cn(SYSTEM.type.caption, SYSTEM.ink.muted, 'group-hover/link:text-white/70 truncate')}>{s.title}</span>
                  <span className={cn(SYSTEM.ink.ghost, 'group-hover/link:text-white/40 ml-auto')}>↗</span>
                </a>
              ))}
            </div>
          </details>
        </div>
      )}
    </motion.div>
  );
});
MessageBubble.displayName = 'MessageBubble';

// ============================================================================
// INPUT DECK
// ============================================================================

interface InputDeckProps {
  value: string; onChange: (v: string) => void; onSend: (q?: string) => void; onStop: () => void;
  attachments: readonly Attachment[]; onAttachmentsChange: (a: Attachment[]) => void;
  isProcessing: boolean; isVoiceMode: boolean; onVoiceModeChange: (v: boolean) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>; fileInputRef: RefObject<HTMLInputElement | null>;
}

const InputDeck: FC<InputDeckProps> = memo(({ value, onChange, onSend, onStop, attachments, onAttachmentsChange, isProcessing, isVoiceMode, onVoiceModeChange, inputRef, fileInputRef }) => {
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isProcessing) onSend(); } }, [onSend, isProcessing]);
  const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      const file = files[0], reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        onAttachmentsChange([...attachments, { file, base64, mimeType: file.type }]);
        try {
          const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
          const { data, error } = await supabase.storage.from('chat-attachments').upload(fileName, file, { contentType: file.type, upsert: false });
          if (!error && data) console.log('[attachment] ✅ Uploaded:', supabase.storage.from('chat-attachments').getPublicUrl(data.path).data.publicUrl);
        } catch { }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  }, [attachments, onAttachmentsChange]);
  const removeAttachment = useCallback((i: number) => onAttachmentsChange(attachments.filter((_, x) => x !== i)), [attachments, onAttachmentsChange]);
  const toggleVoice = useCallback(() => {
    const API = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!API) return;
    if (isVoiceMode && recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null; onVoiceModeChange(false); return; }
    const r = new API(); recognitionRef.current = r; r.continuous = false; r.interimResults = true;
    r.onresult = (e) => { const t = e.results[0]?.[0]?.transcript; if (t) onChange(t); };
    r.onend = () => { recognitionRef.current = null; onVoiceModeChange(false); };
    r.onerror = () => { recognitionRef.current = null; onVoiceModeChange(false); };
    onVoiceModeChange(true); r.start();
  }, [isVoiceMode, onChange, onVoiceModeChange]);
  useEffect(() => () => { if (recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null; } }, []);
  const canSend = value.trim() || attachments.length > 0;
  const hasVoice = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  return (
    <motion.div layout className={cn('flex flex-col gap-2 p-1.5 relative', SYSTEM.radius.xl, SYSTEM.surface.elevated, 'border', isVoiceMode ? 'border-indigo-500/30 shadow-[0_0_40px_-10px_rgba(99,102,241,0.3)]' : SYSTEM.edge.soft)}>
      {attachments.length > 0 && <div className="flex gap-2 overflow-x-auto p-2">{attachments.map((a, i) => <div key={`${a.file.name}-${i}`} className={cn('flex items-center gap-2 px-3 py-1.5', SYSTEM.radius.md, SYSTEM.surface.base, 'border', SYSTEM.edge.soft, SYSTEM.type.caption, SYSTEM.ink.secondary)}><span className="max-w-[100px] truncate">{a.file.name}</span><button type="button" onClick={() => removeAttachment(i)} className={cn(SYSTEM.ink.muted, 'hover:text-white')}>×</button></div>)}</div>}
      <div className="flex items-end gap-2 p-1">
        <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Attach" className={cn('p-3', SYSTEM.radius.lg, SYSTEM.ink.muted, 'hover:text-white hover:bg-white/5')}><span className="text-lg font-light">+</span></button>
        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
        {isVoiceMode ? <div className="flex-1 flex items-center justify-center h-[48px] gap-3"><OrbitalDots /><span className={cn(SYSTEM.type.caption, SYSTEM.ink.muted)}>Listening...</span></div>
          : <textarea ref={inputRef} value={value} onChange={e => onChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask for edge, splits, or props..." rows={1} className={cn('flex-1 bg-transparent border-none outline-none resize-none py-3 min-h-[48px] max-h-[120px]', SYSTEM.type.body, SYSTEM.ink.primary, 'placeholder:text-white/20')} aria-label="Message input" />}
        <div className="flex items-center gap-1 pb-1">
          {!value && attachments.length === 0 && hasVoice && <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={toggleVoice} aria-label={isVoiceMode ? 'Stop' : 'Voice'} className={cn('px-3 py-2', SYSTEM.radius.md, SYSTEM.type.micro, isVoiceMode ? 'text-rose-400 bg-rose-500/10' : cn(SYSTEM.ink.muted, 'hover:bg-white/5'))}>{isVoiceMode ? 'Stop' : 'Voice'}</motion.button>}
          <motion.button type="button" whileTap={{ scale: 0.95 }} onClick={() => (isProcessing ? onStop() : onSend())} aria-label={isProcessing ? 'Stop' : 'Send'} disabled={!canSend && !isProcessing && !isVoiceMode} className={cn('px-4 py-2', SYSTEM.radius.md, 'transition-all duration-200', canSend || isProcessing ? 'bg-white text-black shadow-[0_2px_12px_rgba(255,255,255,0.15)]' : cn('bg-white/5', SYSTEM.ink.ghost))}>
            {isProcessing ? <span className={cn(SYSTEM.type.micro, 'animate-pulse')}>Stop</span> : <span className={cn(SYSTEM.type.micro, canSend ? 'text-black' : SYSTEM.ink.ghost)}>↑</span>}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
});
InputDeck.displayName = 'InputDeck';

// ============================================================================
// INNER CHAT WIDGET
// ============================================================================

const InnerChatWidget: FC<InnerChatWidgetProps> = ({ currentMatch, inline, isMinimized, setIsMinimized }) => {
  const { toggleGlobalChat } = useAppStore();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const { session_id, conversation_id } = useChatContext({ match: currentMatch });
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, isProcessing]);
  useEffect(() => { if (!inline) inputRef.current?.focus(); }, [inline]);
  const handleStop = useCallback(() => { if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null; setIsProcessing(false); setMessages(p => p.map(m => m.isStreaming ? { ...m, isStreaming: false } : m)); triggerHaptic(); } }, []);
  const executeSend = useCallback(async (forcedQuery?: string) => {
    const query = forcedQuery ?? input.trim();
    if ((!query && attachments.length === 0) || isProcessing) return;
    handleStop(); setIsProcessing(true); setInput(''); setIsVoiceMode(false);
    const currentRunId = generateId(), controller = new AbortController();
    abortControllerRef.current = controller;
    const userMsg: Message = { id: generateId(), role: 'user', content: query || 'File Analysis', timestamp: new Date().toISOString() };
    const aiMsgId = generateId();
    setMessages(p => [...p, userMsg, { id: aiMsgId, role: 'assistant', content: '', isStreaming: true, timestamp: new Date().toISOString() }]);
    try {
      const currentMessages = messagesRef.current;
      let wirePayload: WireMessage[] = [...currentMessages.map(toWireMessage), toWireMessage(userMsg)];
      if (attachments.length > 0) {
        const lastIdx = wirePayload.length - 1;
        wirePayload[lastIdx] = { ...wirePayload[lastIdx], content: [{ type: 'text', text: query || 'Analyze these files.' }, ...attachments.map(a => ({ type: (a.mimeType.startsWith('image/') ? 'image' : 'file') as const, source: { type: 'base64' as const, media_type: a.mimeType, data: a.base64 } }))] };
        setAttachments([]);
      }
      const context: EdgeServiceContext = {
        session_id, conversation_id,
        current_match: currentMatch ? { match_id: currentMatch.id, home_team: currentMatch.homeTeam?.name ?? currentMatch.home_team ?? '', away_team: currentMatch.awayTeam?.name ?? currentMatch.away_team ?? '', home_team_id: (currentMatch as any).home_team_id, away_team_id: (currentMatch as any).away_team_id, league: currentMatch.leagueId ?? currentMatch.league_id ?? '', sport: (currentMatch.sport as string) ?? 'unknown', home_score: currentMatch.homeTeam?.score ?? currentMatch.home_score, away_score: currentMatch.awayTeam?.score ?? currentMatch.away_score, status: currentMatch.status, clock: currentMatch.clock } : null,
        run_id: currentRunId
      };
      let contentBuffer = '', thoughtBuffer = '';
      let groundingBuffer: GroundingMetadata | undefined;
      await edgeService.chat(wirePayload, context, (chunk) => {
        if (chunk.type === 'text') { contentBuffer += chunk.content ?? ''; setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, content: contentBuffer } : m)); }
        if (chunk.type === 'thought') { thoughtBuffer += chunk.content ?? ''; setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, thoughts: thoughtBuffer } : m)); }
        if (chunk.type === 'grounding' && chunk.groundingMetadata) groundingBuffer = chunk.groundingMetadata;
        if (chunk.type === 'done') setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, isStreaming: false, sources: chunk.sources, groundingMetadata: chunk.groundingMetadata ?? groundingBuffer } : m));
      }, abortControllerRef.current.signal);
    } catch (err) { if (err instanceof Error && err.name !== 'AbortError') setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, content: 'Connection interrupted.', isStreaming: false } : m)); }
    finally { setIsProcessing(false); abortControllerRef.current = null; }
  }, [input, attachments, isProcessing, session_id, conversation_id, currentMatch, handleStop]);
  if (isMinimized && !inline && setIsMinimized) {
    return (
      <motion.button type="button" layoutId="chat-widget" onClick={() => setIsMinimized(false)} className={cn('group flex items-center gap-3 px-5 py-3', SYSTEM.radius.full, SYSTEM.surface.base, 'border', SYSTEM.edge.soft, 'shadow-[0_8px_32px_rgba(0,0,0,0.5)]')} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} aria-label="Open chat">
        <div className="relative"><span className={cn(SYSTEM.geo.dot, 'bg-white')} /><span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /></div>
        <span className={cn(SYSTEM.type.title, SYSTEM.ink.primary)}>Edge</span>
      </motion.button>
    );
  }
  return (
    <ToastProvider>
      <div className={cn('isolate flex flex-col overflow-hidden', inline ? 'w-full h-full border-0 bg-transparent' : cn('w-full md:w-[420px] h-[100dvh] md:h-[min(720px,90dvh)]', SYSTEM.surface.base, SYSTEM.radius.lg, 'border', SYSTEM.edge.soft, 'shadow-[0_24px_80px_-12px_rgba(0,0,0,0.8)]'))} role="region" aria-label="Chat">
        {!inline && (
          <header className="relative z-20 flex items-center justify-between px-6 pt-5 pb-2">
            <div className="flex items-center gap-3"><span className={cn(SYSTEM.geo.dot, 'bg-white/60')} /><span className={cn(SYSTEM.type.title, SYSTEM.ink.primary)}>Edge</span></div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setIsMinimized?.(true)} aria-label="Minimize" className={cn('px-3 py-1.5', SYSTEM.radius.md, SYSTEM.type.micro, SYSTEM.ink.ghost, 'hover:text-white/40 hover:bg-white/5')}>—</button>
              <button type="button" onClick={() => toggleGlobalChat(false)} aria-label="Close" className={cn('px-3 py-1.5', SYSTEM.radius.md, SYSTEM.type.micro, SYSTEM.ink.ghost, 'hover:text-white/40 hover:bg-white/5')}>×</button>
            </div>
          </header>
        )}
        <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto px-5 pt-4 pb-56 scroll-smooth scrollbar-hide" role="log" aria-label="Messages" aria-live="polite">
          {messages.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="h-full flex flex-col items-center justify-center text-center">
              <div className={cn('w-14 h-14 flex items-center justify-center mb-6', SYSTEM.radius.xl, SYSTEM.surface.raised, 'border', SYSTEM.edge.subtle)}><span className={cn(SYSTEM.geo.square, 'w-3 h-3 bg-white/30')} /></div>
              <p className={cn(SYSTEM.type.caption, SYSTEM.ink.muted)}>Ask anything...</p>
            </motion.div>
          ) : <AnimatePresence mode="popLayout">{messages.map((m, i) => <MessageBubble key={m.id} message={m} isLast={i === messages.length - 1} onAction={executeSend} />)}</AnimatePresence>}
        </div>
        <footer className={cn('absolute bottom-0 left-0 right-0 z-30 px-4 pb-5 pt-12 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/98 to-transparent')}>
          <AnimatePresence>{isProcessing && <ThinkingPill onStop={handleStop} />}</AnimatePresence>
          <AnimatePresence>{messages.length < 2 && !isProcessing && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-3"><SmartChips onSelect={setInput} hasMatch={!!currentMatch} /></motion.div>}</AnimatePresence>
          <div className={cn('backdrop-blur-2xl', SYSTEM.surface.glass, 'border', SYSTEM.edge.soft, SYSTEM.radius.xl, 'shadow-[0_16px_64px_rgba(0,0,0,0.5)]')}>
            <InputDeck value={input} onChange={setInput} onSend={executeSend} onStop={handleStop} attachments={attachments} onAttachmentsChange={setAttachments} isProcessing={isProcessing} isVoiceMode={isVoiceMode} onVoiceModeChange={setIsVoiceMode} inputRef={inputRef} fileInputRef={fileInputRef} />
          </div>
        </footer>
      </div>
    </ToastProvider>
  );
};

// ============================================================================
// ERROR BOUNDARY & MAIN EXPORT
// ============================================================================

class ChatErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e: Error, i: React.ErrorInfo) { console.error('ChatWidget Error:', e, i); }
  render() {
    if (this.state.hasError) return <div className={cn('p-6', SYSTEM.type.caption, 'text-rose-400')} role="alert">System Error — Refresh to continue</div>;
    return this.props.children;
  }
}

const ChatWidget: FC<ChatWidgetProps> = ({ currentMatch, inline }) => {
  const { isGlobalChatOpen } = useAppStore();
  const [isMinimized, setIsMinimized] = useState(false);
  if (inline) return <InnerChatWidget currentMatch={currentMatch} inline={inline} />;
  return (
    <ChatErrorBoundary>
      <AnimatePresence>
        {isGlobalChatOpen && (
          <motion.div initial={{ opacity: 0, y: 50, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 50, scale: 0.96 }} transition={SYSTEM.spring.smooth} className={cn('fixed z-[9999]', isMinimized ? 'bottom-6 right-6' : 'inset-0 md:inset-auto md:bottom-6 md:right-6')}>
            <InnerChatWidget currentMatch={currentMatch} inline={false} isMinimized={isMinimized} setIsMinimized={setIsMinimized} />
          </motion.div>
        )}
      </AnimatePresence>
    </ChatErrorBoundary>
  );
};

export default ChatWidget;