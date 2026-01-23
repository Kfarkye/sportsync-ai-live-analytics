/* ============================================================================
   ChatWidget.tsx
   "Obsidian" — Production Master (v15.0)
   
   Changelog v15.0:
   ├─ FEAT: Gemini grounding inline citations (injectCitations)
   ├─ FEAT: Sources footer with collapsible numbered list
   ├─ FEAT: extractSourcesFromGrounding utility
   └─ TYPES: GroundingSegment, GroundingSupport, GroundingChunk, GroundingMetadata
============================================================================ */

import React, {
  useState, useEffect, useRef, useCallback, useMemo, memo, Component,
  createContext, useContext,
  type ReactNode, type FC, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject,
} from 'react';
import {
  X, Terminal, RefreshCw, Plus, ArrowUp, Copy, ChevronRight, Minus, Zap, Activity,
  User, MoreHorizontal, StopCircle, Mic, MicOff, Search, PenTool, Cpu,
  Image as ImageIcon, Sparkles, TrendingUp, CheckCircle2, Scale, ScrollText, ArrowRight, Target, Link,
} from 'lucide-react';
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
interface Attachment { readonly file: File; readonly base64: string; readonly mimeType: string; }

// Gemini Grounding Types
interface GroundingSegment { readonly startIndex: number; readonly endIndex: number; readonly text?: string; }
interface GroundingSupport { readonly segment: GroundingSegment; readonly groundingChunkIndices: readonly number[]; readonly confidenceScores?: readonly number[]; }
interface GroundingChunk { readonly web?: { readonly uri: string; readonly title: string }; readonly retrievedContext?: { readonly uri: string; readonly title: string }; }
interface GroundingMetadata { readonly groundingChunks?: readonly GroundingChunk[]; readonly groundingSupports?: readonly GroundingSupport[]; readonly webSearchQueries?: readonly string[]; }

interface MatchContext {
  readonly id: string;
  readonly homeTeam?: { readonly name: string };
  readonly awayTeam?: { readonly name: string };
  readonly home_team?: string;
  readonly away_team?: string;
  readonly leagueId?: string;
  readonly league_id?: string;
}

interface ChatWidgetProps { readonly currentMatch?: MatchContext; readonly inline?: boolean; }
interface InnerChatWidgetProps extends ChatWidgetProps { readonly isMinimized?: boolean; readonly setIsMinimized?: (v: boolean) => void; }

interface EdgeServiceContext {
  readonly session_id?: string;
  readonly conversation_id?: string;
  readonly current_match?: { readonly match_id: string; readonly home_team: string; readonly away_team: string; readonly league: string; } | null;
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
interface PipelineStage { readonly name: string; readonly value: string; }
interface MatchStatsData { readonly type?: 'match_stats'; readonly WinProb?: string; readonly ExpectedGoals?: string; }
interface PipelineBriefData { readonly type?: 'pipeline_brief'; readonly stages?: readonly PipelineStage[]; }
interface ProspectProfileData { readonly type?: 'prospect_profile'; readonly name: string; readonly title: string; }

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
// CONSTANTS
// ============================================================================

const UNIFIED_TACTICAL_HEADER = 'flex items-center gap-2 mt-6 mb-3 text-[11px] font-bold text-white/90 uppercase tracking-widest select-none';
const ARTIFACT_BG = 'bg-[#0a0a0b]';
const BORDER_COLOR = 'border-white/[0.08]';

const DESIGN = {
  radius: { lg: 'rounded-[14px]', xl: 'rounded-[20px]', pill: 'rounded-full' },
  glass: {
    panel: 'bg-[#050505] border border-white/[0.08]',
    surface: 'bg-[#121212] border border-white/[0.06]',
    input: 'bg-[#161616] border border-white/[0.08] focus-within:border-white/20',
    chip: 'bg-white/[0.06] hover:bg-white/[0.1] border border-transparent hover:border-white/[0.05] transition-all',
  },
  typography: {
    h1: 'text-[13px] font-medium text-white tracking-[-0.01em]',
    body: 'text-[15px] text-[#A1A1AA] leading-[1.65] font-sans tracking-[-0.01em] antialiased',
    mono: 'font-mono text-[11px] leading-relaxed',
    label: 'text-[11px] font-bold uppercase tracking-widest text-white/50',
  },
  spring: {
    fluid: { type: 'spring', damping: 25, stiffness: 300, mass: 0.5 } as Transition,
    snappy: { type: 'spring', damping: 20, stiffness: 400 } as Transition,
  },
} as const;

const SLASH_COMMANDS = [
  { icon: Sparkles, label: 'Analyze', cmd: '/analyze ', description: 'Deep analysis' },
  { icon: Search, label: 'Search', cmd: '/search ', description: 'Search sources' },
  { icon: PenTool, label: 'Draft', cmd: '/draft ', description: 'Generate draft' },
  { icon: Cpu, label: 'Reason', cmd: '/reason ', description: 'Step-by-step reasoning' },
  { icon: ImageIcon, label: 'Imagine', cmd: '/imagine ', description: 'Visual concepts' },
] as const;

// ============================================================================
// UTILITIES
// ============================================================================

function cn(...inputs: ClassValue[]): string { return twMerge(clsx(inputs)); }
function generateId(): string { return crypto.randomUUID(); }
function triggerHaptic(): void { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10); }

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

function createSparklinePath(points: readonly number[], width: number, height: number): string {
  if (points.length < 2) return '';
  const max = Math.max(...points), min = Math.min(...points), range = max - min || 1;
  const stepX = width / (points.length - 1);
  return points.map((v, i) => {
    const x = i * stepX, y = height - ((v - min) / range) * height;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
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

function isPipelineBriefData(d: unknown): d is PipelineBriefData {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  if (o.type === 'pipeline_brief') return true;
  if (!Array.isArray(o.stages)) return false;
  return o.stages.every((s): s is PipelineStage => typeof s === 'object' && s !== null && 'name' in s && 'value' in s);
}

function isProspectProfileData(d: unknown): d is ProspectProfileData | readonly ProspectProfileData[] {
  if (!d) return false;
  if (Array.isArray(d)) return d.every(i => typeof i === 'object' && i !== null && 'name' in i && 'title' in i);
  if (typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return o.type === 'prospect_profile' || (!!o.name && !!o.title);
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
    // Use Vercel /api/chat for Gemini 3 (60s timeout vs Supabase's 30s)
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content
        })),
        session_id: context.session_id,
        conversation_id: context.conversation_id,
        gameContext: context.current_match
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
    } finally {
      reader.releaseLock();
    }
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
            initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute bottom-32 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2.5 bg-[#1C1C1E] border border-white/10 rounded-full shadow-2xl">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span className="text-[13px] font-medium text-white">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
};

function useToast(): ToastContextValue { return useContext(ToastContext); }

// ============================================================================
// MICRO-COMPONENTS
// ============================================================================

export const NeuralPulse = memo<{ active?: boolean; className?: string; size?: number }>(
  ({ active = false, className, size = 12 }) => (
    <div className={cn('relative flex items-center justify-center', className)} style={{ width: size, height: size }} role="status" aria-label={active ? 'Active' : 'Inactive'}>
      <AnimatePresence>
        {active && <motion.div initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: [0, 0.4, 0], scale: 2 }} exit={{ opacity: 0 }} transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }} className="absolute inset-0 rounded-full bg-indigo-500/40 blur-[4px]" />}
      </AnimatePresence>
      <div className={cn('rounded-full transition-all duration-300', active ? 'bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.6)]' : 'bg-white/20')} style={{ width: size / 2.5, height: size / 2.5 }} />
    </div>
  )
);
NeuralPulse.displayName = 'NeuralPulse';

// Dynamic Island - Premium Thinking Indicator with Pulse Ring
const THINKING_STATES = ['Scanning lines...', 'Checking trends...', 'Verifying splits...', 'Grading edge...'] as const;
const ThinkingPill: FC<{ onStop?: () => void; status?: 'thinking' | 'streaming' | 'grounding' }> = memo(({ onStop, status = 'thinking' }) => {
  const [stateIndex, setStateIndex] = useState(0);
  useEffect(() => {
    if (status !== 'thinking') return;
    const interval = setInterval(() => setStateIndex(i => (i + 1) % THINKING_STATES.length), 2000);
    return () => clearInterval(interval);
  }, [status]);

  const displayText = status === 'streaming' ? 'Streaming...' : status === 'grounding' ? 'Sourcing intel...' : THINKING_STATES[stateIndex];

  return (
    <motion.div
      role="status"
      aria-label="Processing"
      initial={{ opacity: 0, scale: 0.8, width: 48 }}
      animate={{ opacity: 1, scale: 1, width: 180 }}
      exit={{ opacity: 0, scale: 0.8, width: 48 }}
      transition={{ type: 'spring', damping: 20, stiffness: 300 }}
      className="absolute bottom-[100%] left-1/2 -translate-x-1/2 mb-4 flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-xl border border-white/10 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)_inset] z-30"
    >
      {/* Pulse Ring */}
      <motion.div
        className="relative"
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="w-2 h-2 rounded-full bg-gradient-to-br from-blue-400 to-purple-500" />
        <motion.div
          className="absolute inset-0 rounded-full bg-blue-400/50"
          animate={{ scale: [1, 2], opacity: [0.5, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
        />
      </motion.div>
      <span className="text-[11px] font-medium text-white/80 whitespace-nowrap">
        {displayText}
      </span>
      {onStop && (
        <button type="button" onClick={onStop} className="ml-1 p-1 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors" aria-label="Stop">
          <StopCircle size={12} />
        </button>
      )}
    </motion.div>
  );
});
ThinkingPill.displayName = 'ThinkingPill';


const SlashCommandMenu: FC<{ onSelect: (cmd: string) => void }> = memo(({ onSelect }) => (
  <motion.div role="listbox" aria-label="Commands" initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }}
    className={cn('absolute bottom-full left-0 mb-2 w-full p-1.5 bg-[#161616] border border-white/10', DESIGN.radius.lg, 'shadow-2xl overflow-hidden')}>
    <div className="text-[10px] font-medium text-white/30 px-3 py-2 uppercase tracking-wider">Commands</div>
    {SLASH_COMMANDS.map(item => (
      <button key={item.cmd} type="button" role="option" onClick={() => onSelect(item.cmd)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/5 text-left transition-colors group">
        <item.icon size={14} className="text-white/40 group-hover:text-white transition-colors" />
        <span className="text-[13px] font-medium text-white/80 group-hover:text-white transition-colors">{item.label}</span>
      </button>
    ))}
  </motion.div>
));
SlashCommandMenu.displayName = 'SlashCommandMenu';

const Sparkline: FC<{ data: readonly number[]; color?: string; width?: number; height?: number }> = memo(({ data, color = '#6366f1', width = 60, height = 20 }) => {
  const path = useMemo(() => createSparklinePath(data, width, height), [data, width, height]);
  const lastY = useMemo(() => {
    if (data.length === 0) return height / 2;
    const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
    return height - ((data[data.length - 1] - min) / range) * height;
  }, [data, height]);
  if (data.length < 2) return null;
  return (
    <svg width={width} height={height} className="overflow-visible" role="img" aria-label="Trend">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={lastY} r="2" fill={color} />
    </svg>
  );
});
Sparkline.displayName = 'Sparkline';

const CopyButton: FC<{ content: string }> = memo(({ content }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { }
  }, [content]);
  return (
    <button type="button" onClick={handleCopy} className="p-1.5 rounded-md hover:bg-white/10 text-white/30 hover:text-white transition-colors" aria-label={copied ? 'Copied' : 'Copy'}>
      {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
    </button>
  );
});
CopyButton.displayName = 'CopyButton';

// ============================================================================
// ARTIFACTS
// ============================================================================

const MatchStatsArtifact: FC<{ data: MatchStatsData }> = memo(({ data }) => {
  const momentum = useMemo(() => [12, 18, 15, 25, 22, 30, 42, 38, 50], []);
  return (
    <div className={cn('my-5 overflow-hidden border shadow-2xl', BORDER_COLOR, ARTIFACT_BG, DESIGN.radius.lg)} role="region" aria-label="Live market">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04] bg-white/[0.01]">
        <div className="flex items-center gap-2"><Activity size={14} className="text-emerald-400" /><span className="text-[12px] font-medium text-white/60">Live Market</span></div>
      </div>
      <div className="p-4 space-y-5">
        <div className="flex justify-between items-end">
          <div><span className={DESIGN.typography.label}>Forecast</span><span className="block text-2xl font-semibold text-white tracking-tight mt-1">{data.WinProb ?? '42%'}</span></div>
          <div className="text-right"><span className={cn(DESIGN.typography.label, 'block mb-1')}>Pace</span><Sparkline data={momentum} color="#34d399" /></div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-white/[0.06] rounded-lg overflow-hidden border border-white/[0.04]">
          <div className="bg-[#121212] p-3"><span className={cn(DESIGN.typography.label, 'block mb-1')}>Intensity</span><span className="text-sm font-medium text-white">{data.ExpectedGoals ?? '1.85'}</span></div>
          <div className="bg-[#121212] p-3"><span className={cn(DESIGN.typography.label, 'block mb-1')}>Confidence</span><span className="text-sm font-medium text-emerald-400 flex items-center gap-1"><Zap size={12} /> High</span></div>
        </div>
      </div>
    </div>
  );
});
MatchStatsArtifact.displayName = 'MatchStatsArtifact';

const PipelineArtifact: FC<{ data: PipelineBriefData }> = memo(({ data }) => {
  const stages = data.stages ?? [{ name: 'Qualified', value: '12' }, { name: 'Proposal', value: '5' }];
  return (
    <div className={cn('my-5 border overflow-hidden', BORDER_COLOR, ARTIFACT_BG, DESIGN.radius.lg)} role="region" aria-label="Pipeline">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400"><Target size={18} /></div>
          <div><h3 className="text-sm font-bold text-white">Velocity</h3><p className="text-[11px] text-white/40">Flow analysis</p></div>
        </div>
        <div className="space-y-3">
          {stages.map((stage, i) => (
            <div key={stage.name} className="flex justify-between items-center text-xs p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.02]">
              <span className="text-white/90 font-medium">{stage.name}</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(parseInt(stage.value, 10) * 10, 100)}%` }} transition={{ delay: i * 0.1 }} className="h-full bg-indigo-500 rounded-full" />
                </div>
                <span className="font-mono text-white/80 font-medium w-5 text-right">{stage.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
PipelineArtifact.displayName = 'PipelineArtifact';

const ProspectArtifact: FC<{ data: ProspectProfileData | readonly ProspectProfileData[]; onAction?: (a: string) => void }> = memo(({ data, onAction }) => {
  const { showToast } = useToast();
  const profiles = Array.isArray(data) ? data : [data];
  return (
    <div className="my-5 grid grid-cols-1 gap-3" role="list" aria-label="Prospects">
      {profiles.map((p, i) => (
        <div key={`${p.name}-${i}`} className={cn('group relative overflow-hidden rounded-xl border p-4 shadow-lg', BORDER_COLOR, ARTIFACT_BG)} role="listitem">
          <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500/50" />
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-white/40 border border-white/[0.04]"><User size={16} /></div>
              <div><div className="text-[13px] font-semibold text-white">{p.name}</div><div className="text-[11px] text-indigo-300/80">{p.title}</div></div>
            </div>
            <button type="button" aria-label="Options" className="text-white/20 hover:text-white transition-colors"><MoreHorizontal size={14} /></button>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => onAction?.(`Draft outreach to ${p.name}`)} className="flex-1 py-1.5 rounded-md text-[11px] font-medium text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.04] transition-colors">Connect</button>
            <button type="button" onClick={() => showToast(`Saved ${p.name.split(' ')[0]}`)} className="flex-1 py-1.5 rounded-md text-[11px] font-medium text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.04] transition-colors">Save</button>
          </div>
        </div>
      ))}
    </div>
  );
});
ProspectArtifact.displayName = 'ProspectArtifact';

// ============================================================================
// SMART CHIPS
// ============================================================================

const SmartChips: FC<{ onSelect: (t: string) => void; hasMatch: boolean }> = memo(({ onSelect, hasMatch }) => {
  const chips = useMemo(() => hasMatch
    ? [{ label: 'Sharp Report', query: 'Give me the full sharp report with splits, line movement, and injury impact.' }, { label: 'Best Bet', query: 'What is the best bet for this game?' }, { label: 'Public Fade', query: 'Where is the public heavy and should we fade?' }, { label: 'Player Props', query: 'Analyze the best player prop edges.' }]
    : [{ label: 'Today\'s Edge', query: 'What games have the sharpest edge today?' }, { label: 'Line Movement', query: 'Show me the biggest line moves today.' }, { label: 'Public Splits', query: 'Where is the public heavily favored?' }, { label: 'Injury Intel', query: 'Any major injury news affecting lines?' }], [hasMatch]);
  return (
    <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide" role="group" aria-label="Quick actions">
      {chips.map(c => (
        <motion.button key={c.label} type="button" onClick={() => onSelect(c.query)} whileHover={{ scale: 1.02, y: -1 }} whileTap={{ scale: 0.98 }}
          className={cn('px-4 py-2.5 flex-shrink-0 backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.05] transition-all', DESIGN.radius.pill, 'shadow-[0_2px_12px_rgba(0,0,0,0.3)]')}>
          <span className="text-[12px] font-semibold tracking-wide text-white/70 hover:text-white/90 transition-colors uppercase">{c.label}</span>
        </motion.button>
      ))}
    </div>
  );
});
SmartChips.displayName = 'SmartChips';

// ============================================================================
// MESSAGE BUBBLE
// ============================================================================

const HEADER_ICONS: Record<string, typeof ArrowRight> = { Context: ScrollText, Fundamentals: Scale, Flow: TrendingUp, Principle: Scale, Opportunity: Zap };
const TEXT_REPLACEMENTS: Record<string, string> = { 'The Narrative:': 'Context', 'The Structural Reality:': 'Fundamentals', 'The Market Read:': 'Flow', 'Price Error:': 'Opportunity', 'The Rule:': 'Principle', 'Rule:': 'Principle' };

function processTextForHeaders(text: string): React.ReactNode[] {
  let processed = text;
  for (const [k, v] of Object.entries(TEXT_REPLACEMENTS)) processed = processed.replaceAll(k, `${v}:`);
  if (processed === text) return [<span key="t" className="text-[#A1A1AA]">{text}</span>];
  const parts = processed.split(/((?:Context|Fundamentals|Flow|Opportunity|Principle):)/g);
  return parts.map((p, i) => {
    if (p.endsWith(':')) {
      const title = p.replace(':', '');
      const Icon = HEADER_ICONS[title] ?? ArrowRight;
      return <span key={i} className={UNIFIED_TACTICAL_HEADER}><Icon size={12} className="text-indigo-400" />{title}</span>;
    }
    return <span key={i} className="text-[#A1A1AA]">{p}</span>;
  });
}

const MessageBubble: FC<{ message: Message; isLast: boolean; onAction: (t: string) => void }> = memo(({ message, onAction }) => {
  const isUser = message.role === 'user';
  const textContent = useMemo(() => {
    const raw = extractTextContent(message.content);
    return isUser ? raw : injectCitations(raw, message.groundingMetadata);
  }, [message.content, message.groundingMetadata, isUser]);
  const displaySources = useMemo(() => message.sources?.length ? message.sources : extractSourcesFromGrounding(message.groundingMetadata), [message.sources, message.groundingMetadata]);
  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={DESIGN.spring.fluid} className={cn('flex flex-col mb-8 w-full relative', isUser ? 'items-end' : 'items-start')}>
      {!isUser && (message.isStreaming || textContent) && (
        <div className="flex items-center gap-2 mb-2 ml-1">
          <span className={cn(DESIGN.typography.label, 'text-white/30 uppercase')}>Edge</span>
        </div>
      )}
      <div className={cn('relative max-w-[92%] md:max-w-[85%]', isUser ? 'bg-white text-black shadow-lg rounded-[20px] rounded-tr-sm' : 'bg-transparent text-white')}>
        <div className={cn('py-2', isUser ? 'px-5 py-3.5' : 'px-0')}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} className={cn('prose max-w-none', isUser ? 'prose-p:text-black/90 prose-p:font-medium' : 'prose-invert')} components={{
            h1: ({ children }) => <h1 className="text-[10px] font-mono font-medium text-white/30 uppercase tracking-[0.2em] mb-4 mt-8">{children}</h1>,
            h2: ({ children }) => <h2 className="text-[10px] font-mono font-medium text-white/30 uppercase tracking-[0.2em] mb-3 mt-6">{children}</h2>,
            p: ({ children }) => {
              const els = React.Children.toArray(children);
              if (els.length === 1 && typeof els[0] === 'string' && els[0].startsWith('VERDICT:')) {
                const t = els[0].replace('VERDICT:', '').trim();
                return (
                  <div className={cn('my-6 rounded-2xl border overflow-hidden', 'backdrop-blur-xl bg-white/[0.04] border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.02)]')} role="region" aria-label="Verdict">
                    <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
                      <span className="text-[10px] font-mono tracking-[0.2em] text-white/40 uppercase">Verdict</span>
                      <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" /><span className="text-[9px] font-mono text-indigo-400 uppercase tracking-wider">Live</span></div>
                    </div>
                    <div className="p-5"><div className="text-[15px] font-medium text-white leading-[1.7] tracking-tight">{t}</div></div>
                  </div>
                );
              }
              return <p className={cn(DESIGN.typography.body, isUser ? 'text-[#0a0a0b]' : 'text-[#A1A1AA] leading-[1.7]', 'mb-5 last:mb-0')}>{els.map((c, i) => typeof c === 'string' ? <React.Fragment key={i}>{processTextForHeaders(c)}</React.Fragment> : c)}</p>;
            },
            strong: ({ children }) => {
              const t = String(children);
              for (const [k, v] of Object.entries(TEXT_REPLACEMENTS)) if (t.includes(k.replace(':', ''))) return <span className={UNIFIED_TACTICAL_HEADER}>{v}</span>;
              if (t === t.toUpperCase() && t.trim().endsWith(':') && !isUser) return <span className="inline-block font-mono text-white/40 uppercase tracking-[0.15em] text-[9px] mr-1.5">{t.replace(':', '')}</span>;
              return <strong className="font-semibold text-white/90">{children}</strong>;
            },
            code: ({ className, children }) => {
              const isInline = !className?.includes('language-');
              if (isInline) return <code className="px-1.5 py-0.5 rounded bg-white/10 text-[12px] font-mono text-indigo-200">{children}</code>;
              if (className === 'language-json') {
                const d = tryParseJson(String(children).replace(/\n$/, ''));
                if (d) {
                  if (isMatchStatsData(d)) return <MatchStatsArtifact data={d} />;
                  if (isPipelineBriefData(d)) return <PipelineArtifact data={d} />;
                  if (isProspectProfileData(d)) return <ProspectArtifact data={d} onAction={onAction} />;
                }
              }
              return null;
            },
            ul: ({ children }) => <ul className="space-y-2 mb-4 ml-1">{children}</ul>,
            li: ({ children }) => <li className="flex gap-3 items-start"><span className="mt-2 w-1 h-1 rounded-full bg-white/40 shrink-0" /><span>{children}</span></li>,
            a: ({ href, children }) => {
              // Check if this is a citation link (numbered like [1], [2])
              const childText = String(children);
              const isCitation = /^\d+$/.test(childText.trim());
              if (isCitation) {
                return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center align-baseline ml-0.5 text-indigo-400/60 hover:text-indigo-300 transition-colors" title={href}><Link size={10} /></a>;
              }
              return <a href={href} target="_blank" rel="noopener noreferrer" className="text-white hover:text-indigo-300 underline underline-offset-4 decoration-white/20 transition-colors">{children}</a>;
            },
          }}>{textContent}</ReactMarkdown>
        </div>
      </div>
      {!isUser && !message.isStreaming && displaySources.length > 0 && (
        <div className="mt-2 ml-1 w-full max-w-[85%]">
          <details className="group/sources">
            <summary className="list-none cursor-pointer flex items-center gap-1.5 text-[10px] font-bold text-white/20 hover:text-white/40 transition-colors uppercase tracking-widest">
              <ChevronRight size={10} className="group-open/sources:rotate-90 transition-transform" /><span>Sources ({displaySources.length})</span>
            </summary>
            <div className="mt-2 space-y-1.5">
              {displaySources.map((s, i) => (
                <a key={`${s.uri}-${i}`} href={s.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0F0F10] border border-white/5 hover:border-white/10 transition-colors group/link">
                  <span className="flex-shrink-0 w-5 h-5 rounded bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                  <span className="text-[11px] text-white/60 group-hover/link:text-white/80 truncate transition-colors">{s.title}</span>
                  <ArrowRight size={10} className="flex-shrink-0 text-white/20 group-hover/link:text-white/40 -rotate-45 transition-colors" />
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
  isProcessing: boolean; isVoiceMode: boolean; onVoiceModeChange: (v: boolean) => void; showCommandMenu: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>; fileInputRef: RefObject<HTMLInputElement | null>;
}

const InputDeck: FC<InputDeckProps> = memo(({ value, onChange, onSend, onStop, attachments, onAttachmentsChange, isProcessing, isVoiceMode, onVoiceModeChange, showCommandMenu, inputRef, fileInputRef }) => {
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isProcessing && !showCommandMenu) onSend(); }
  }, [onSend, isProcessing, showCommandMenu]);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      const file = files[0], reader = new FileReader();
      reader.onload = () => onAttachmentsChange([...attachments, { file, base64: (reader.result as string).split(',')[1], mimeType: file.type }]);
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  }, [attachments, onAttachmentsChange]);

  const removeAttachment = useCallback((i: number) => onAttachmentsChange(attachments.filter((_, x) => x !== i)), [attachments, onAttachmentsChange]);

  const toggleVoice = useCallback(() => {
    const API = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!API) return;
    if (isVoiceMode && recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null; onVoiceModeChange(false); return; }
    const r = new API(); recognitionRef.current = r;
    r.continuous = false; r.interimResults = true;
    r.onresult = (e) => { const t = e.results[0]?.[0]?.transcript; if (t) onChange(t); };
    r.onend = () => { recognitionRef.current = null; onVoiceModeChange(false); };
    r.onerror = () => { recognitionRef.current = null; onVoiceModeChange(false); };
    onVoiceModeChange(true); r.start();
  }, [isVoiceMode, onChange, onVoiceModeChange]);

  useEffect(() => () => { if (recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null; } }, []);

  const canSend = value.trim() || attachments.length > 0;

  return (
    <motion.div layout className={cn('flex flex-col gap-2 p-1.5 relative transition-all duration-300', DESIGN.radius.xl, DESIGN.glass.input, isVoiceMode && 'shadow-[0_0_30px_-5px_rgba(99,102,241,0.3)] border-indigo-500/30')}>
      {attachments.length > 0 && (
        <div className="flex gap-2 overflow-x-auto p-2">
          {attachments.map((a, i) => (
            <div key={`${a.file.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-lg text-[11px] text-white border border-white/10">
              <span className="max-w-[100px] truncate">{a.file.name}</span>
              <button type="button" onClick={() => removeAttachment(i)} aria-label={`Remove ${a.file.name}`}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 p-1">
        <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Attach" className="p-2.5 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-colors"><Plus size={18} /></button>
        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
        {isVoiceMode ? (
          <div className="flex-1 flex items-center justify-center h-[44px] gap-1" role="status" aria-label="Listening">
            {[...Array(5)].map((_, i) => <motion.div key={i} animate={{ height: [8, 16 + Math.random() * 16, 8] }} transition={{ duration: 0.5 + Math.random() * 0.5, repeat: Infinity }} className="w-1 bg-indigo-500 rounded-full" />)}
            <span className="text-xs text-white/50 ml-2">Listening...</span>
          </div>
        ) : (
          <textarea ref={inputRef} value={value} onChange={e => onChange(e.target.value)} onKeyDown={handleKeyDown} placeholder={showCommandMenu ? 'Type command...' : 'Ask for edge, splits, or props...'} rows={1} className="flex-1 bg-transparent border-none outline-none text-[15px] text-white placeholder:text-white/20 resize-none py-3 min-h-[44px] max-h-[120px]" aria-label="Input" />
        )}
        <div className="flex items-center gap-1 pb-1">
          {!value && attachments.length === 0 && (
            <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={toggleVoice} aria-label={isVoiceMode ? 'Stop' : 'Voice'} className={cn('p-2 rounded-lg transition-colors', isVoiceMode ? 'text-rose-400 bg-rose-500/10' : 'text-white/40 hover:bg-white/10')}>
              {isVoiceMode ? <MicOff size={18} /> : <Mic size={18} />}
            </motion.button>
          )}
          <motion.button type="button" whileTap={{ scale: 0.95 }} onClick={() => (isProcessing ? onStop() : onSend())} aria-label={isProcessing ? 'Stop' : 'Send'} disabled={!canSend && !isProcessing && !isVoiceMode} className={cn('p-2 rounded-lg transition-all duration-300', canSend ? 'bg-white text-black shadow-lg scale-100' : 'bg-white/5 text-white/20 scale-90')}>
            {isProcessing ? <RefreshCw size={16} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={2.5} />}
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
  const [showCommandMenu, setShowCommandMenu] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const { session_id, conversation_id } = useChatContext({ match: currentMatch });

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, isProcessing]);
  useEffect(() => { if (!inline) inputRef.current?.focus(); }, [inline]);
  useEffect(() => { setShowCommandMenu(input === '/'); }, [input]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort(); abortControllerRef.current = null; setIsProcessing(false);
      setMessages(p => p.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
      triggerHaptic();
    }
  }, []);

  const executeSend = useCallback(async (forcedQuery?: string) => {
    const query = forcedQuery ?? input.trim();
    if ((!query && attachments.length === 0) || isProcessing) return;

    setIsProcessing(true); setInput(''); setIsVoiceMode(false); setShowCommandMenu(false);

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

      const context: EdgeServiceContext = { session_id, conversation_id, current_match: currentMatch ? { match_id: currentMatch.id, home_team: currentMatch.homeTeam?.name ?? currentMatch.home_team ?? '', away_team: currentMatch.awayTeam?.name ?? currentMatch.away_team ?? '', league: currentMatch.leagueId ?? currentMatch.league_id ?? '' } : null };

      let contentBuffer = '', thoughtBuffer = '';
      let groundingBuffer: GroundingMetadata | undefined;
      abortControllerRef.current = new AbortController();

      await edgeService.chat(wirePayload, context, (chunk) => {
        if (chunk.type === 'text') { contentBuffer += chunk.content ?? ''; setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, content: contentBuffer } : m)); }
        if (chunk.type === 'thought') { thoughtBuffer += chunk.content ?? ''; setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, thoughts: thoughtBuffer } : m)); }
        if (chunk.type === 'grounding' && chunk.groundingMetadata) { groundingBuffer = chunk.groundingMetadata; }
        if (chunk.type === 'done') setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, isStreaming: false, sources: chunk.sources, groundingMetadata: chunk.groundingMetadata ?? groundingBuffer } : m));
      }, abortControllerRef.current.signal);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, content: 'Connection interrupted.', isStreaming: false } : m));
    } finally { setIsProcessing(false); abortControllerRef.current = null; }
  }, [input, attachments, isProcessing, session_id, conversation_id, currentMatch]);

  const handleSelectCommand = useCallback((cmd: string) => { setInput(cmd); inputRef.current?.focus(); }, []);

  if (isMinimized && !inline && setIsMinimized) {
    return (
      <motion.button type="button" layoutId="chat-widget" onClick={() => setIsMinimized(false)} className={cn('group flex items-center gap-3 px-5 py-3', DESIGN.glass.panel, DESIGN.radius.pill, 'shadow-2xl')} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }} aria-label="Open chat">
        <div className="relative"><Terminal size={14} className="text-white" /><span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /></div>
        <span className="text-[13px] font-medium text-white/90">Edge</span>
      </motion.button>
    );
  }

  return (
    <ToastProvider>
      <div className={cn('isolate flex flex-col overflow-hidden transition-all duration-500', inline ? 'w-full h-full border-0 bg-transparent' : cn('w-full md:w-[420px] h-[100dvh] md:h-[min(720px,90dvh)]', DESIGN.glass.panel, DESIGN.radius.lg, 'shadow-2xl'))} role="region" aria-label="Chat">
        {!inline && (
          <header className="relative z-20 flex items-center justify-between px-6 pt-5 pb-2">
            <span className="text-[14px] font-semibold text-white tracking-tight">Edge</span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setIsMinimized?.(true)} aria-label="Minimize" className="text-white/30 hover:text-white transition-colors"><Minus size={16} /></button>
              <button type="button" onClick={() => toggleGlobalChat(false)} aria-label="Close" className="text-white/30 hover:text-white transition-colors"><X size={16} /></button>
            </div>
          </header>
        )}
        <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto px-5 pt-4 pb-56 scroll-smooth scrollbar-hide" role="log" aria-label="Messages" aria-live="polite">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-6"><Terminal size={24} className="text-white/40" /></div>
              <p className="text-white/40 text-[13px] font-medium">Ask anything...</p>
            </div>
          ) : <AnimatePresence mode="popLayout">{messages.map((m, i) => <MessageBubble key={m.id} message={m} isLast={i === messages.length - 1} onAction={executeSend} />)}</AnimatePresence>}
        </div>
        <footer className="absolute bottom-0 left-0 right-0 z-30 px-4 pb-5 pt-8 bg-gradient-to-t from-black via-black/95 to-transparent">
          <AnimatePresence>{isProcessing && <ThinkingPill onStop={handleStop} />}</AnimatePresence>
          <AnimatePresence>{messages.length < 2 && !isProcessing && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-3"><SmartChips onSelect={setInput} hasMatch={!!currentMatch} /></motion.div>}</AnimatePresence>
          <div className="backdrop-blur-2xl bg-black/60 border border-white/[0.08] rounded-[24px] shadow-[0_16px_64px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.02)]">
            <InputDeck value={input} onChange={setInput} onSend={executeSend} onStop={handleStop} attachments={attachments} onAttachmentsChange={setAttachments} isProcessing={isProcessing} isVoiceMode={isVoiceMode} onVoiceModeChange={setIsVoiceMode} showCommandMenu={false} inputRef={inputRef} fileInputRef={fileInputRef} />
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
  render() { if (this.state.hasError) return <div className="p-4 text-rose-400 text-xs font-mono" role="alert">System Error</div>; return this.props.children; }
}

const ChatWidget: FC<ChatWidgetProps> = ({ currentMatch, inline }) => {
  const { isGlobalChatOpen } = useAppStore();
  const [isMinimized, setIsMinimized] = useState(false);
  if (inline) return <InnerChatWidget currentMatch={currentMatch} inline={inline} />;
  return (
    <ChatErrorBoundary>
      <AnimatePresence>
        {isGlobalChatOpen && (
          <motion.div initial={{ opacity: 0, y: 50, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 50, scale: 0.95 }} transition={DESIGN.spring.fluid} className={cn('fixed z-[9999]', isMinimized ? 'bottom-6 right-6' : 'inset-0 md:inset-auto md:bottom-6 md:right-6')}>
            <InnerChatWidget currentMatch={currentMatch} inline={false} isMinimized={isMinimized} setIsMinimized={setIsMinimized} />
          </motion.div>
        )}
      </AnimatePresence>
    </ChatErrorBoundary>
  );
};

export default ChatWidget;