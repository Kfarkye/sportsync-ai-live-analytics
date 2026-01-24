/* ============================================================================
   ChatWidget.tsx
   "Obsidian Kinetics" — Production Master (v18.1)
   
   DESIGN SYSTEM: "Fluid Physics" (Apple Motion x Vercel Type x Stripe Borders)
   FEATURES:
   ├─ MOTION: Spring-based layout projection (no linear animations)
   ├─ UI: Tactical HUD (Amber), Verdict Ticket (Holographic), Nano-Citations
   ├─ INPUT: Morphing Dynamic Island for Voice/Text
   └─ LOGIC: Full v18.0 backend compatibility (Live/Vision/Voice)
============================================================================ */

import React, {
  useState, useEffect, useRef, useCallback, useMemo, memo, Component,
  createContext, useContext,
  type ReactNode, type FC, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence, type Transition, LayoutGroup } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '../lib/supabase';
import { useChatContext } from '../hooks/useChatContext';
import { useAppStore } from '../store/appStore';
import {
  X, Plus, ArrowUp, Copy, CheckCircle2,
  Minimize2, Mic, MicOff, StopCircle,
  Image as ImageIcon, AlertTriangle
} from 'lucide-react';

// ============================================================================
// 1. DESIGN SYSTEM (FLUID PHYSICS)
// ============================================================================

const SYSTEM = {
  // Interaction Physics (Apple Spring)
  anim: {
    fluid: { type: 'spring', damping: 24, stiffness: 300, mass: 0.8 } as Transition,
    snappy: { type: 'spring', damping: 20, stiffness: 400, mass: 0.5 } as Transition,
    morph: { type: 'spring', damping: 25, stiffness: 280 } as Transition,
    spring: { type: 'spring', damping: 25, stiffness: 200 } as Transition,
    smooth: { type: 'spring', damping: 30, stiffness: 250 } as Transition,
  },
  // Surfaces (Vercel Dark Mode + Glass)
  surface: {
    void: 'bg-[#050505]',
    panel: 'bg-[#0a0a0b] border border-white/[0.08] shadow-2xl',
    glass: 'bg-white/[0.02] backdrop-blur-2xl border border-white/[0.08]',
    glassHigh: 'bg-white/[0.04] backdrop-blur-xl border border-white/[0.1]',
    hud: 'bg-[#1a1400]/80 border border-amber-500/20', // Tactical HUD
    base: 'bg-[#121214]',
  },
  edge: {
    soft: 'border-white/10',
    subtle: 'border-white/5',
  },
  ink: {
    primary: 'text-white',
    secondary: 'text-[#A1A1AA]',
    ghost: 'text-[#52525B]',
    muted: 'text-[#71717A]',
  },
  // Typography (Geist/Inter Style)
  type: {
    nano: 'text-[9px] tracking-[0.15em] uppercase font-bold font-mono text-zinc-500',
    micro: 'text-[10px] tracking-widest font-bold uppercase font-sans',
    caption: 'text-[12px] font-normal leading-relaxed text-zinc-400',
    body: 'text-[15px] leading-[1.7] tracking-[-0.01em] font-normal antialiased text-[#A1A1AA]',
    h1: 'text-[13px] font-medium tracking-[-0.01em] text-white',
    display: 'text-2xl font-bold tracking-tight text-white',
  },
  // Shape
  geo: {
    pill: 'rounded-full',
    card: 'rounded-[20px]',
    dot: 'w-[5px] h-[5px] rounded-full',
  },
  radius: {
    sm: 'rounded-md',
    md: 'rounded-lg',
    lg: 'rounded-xl',
    xl: 'rounded-2xl',
  }
} as const;

function cn(...inputs: ClassValue[]): string { return twMerge(clsx(inputs)); }
function generateId(): string { return crypto.randomUUID(); }
function triggerHaptic(): void { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(5); }

function tryParseJson<T = unknown>(str: string): T | null { try { return JSON.parse(str) as T; } catch { return null; } }

// ============================================================================
// 2. MESSAGE LOGIC
// ============================================================================

interface Message { id: string; role: 'user' | 'assistant'; content: any; thoughts?: string; sources?: any[]; groundingMetadata?: any; isStreaming?: boolean; timestamp: string; }
interface Attachment { file: File; base64: string; mimeType: string; storageUrl?: string; }
interface ChatWidgetProps { currentMatch?: any; inline?: boolean; }
interface InnerChatWidgetProps extends ChatWidgetProps { isMinimized?: boolean; setIsMinimized?: (v: boolean) => void; }

function extractTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.find(c => c.type === 'text')?.text ?? '';
  return '';
}

function injectCitations(text: string, metadata?: any): string {
  if (!metadata?.groundingSupports || !metadata?.groundingChunks) return text;
  const sorted = [...metadata.groundingSupports].sort((a: any, b: any) => b.segment.endIndex - a.segment.endIndex);
  let result = text;
  for (const s of sorted) {
    if (s.segment.endIndex > result.length) continue;
    const links = s.groundingChunkIndices
      .filter((i: number) => metadata.groundingChunks[i]?.web?.uri)
      .map((i: number) => `[${i + 1}](${metadata.groundingChunks[i].web.uri})`).join('');
    if (links) result = result.slice(0, s.segment.endIndex) + ` ${links}` + result.slice(s.segment.endIndex);
  }
  return result;
}

function extractSources(metadata?: any): any[] {
  if (!metadata?.groundingChunks) return [];
  return metadata.groundingChunks.filter((c: any) => c.web?.uri).map((c: any) => ({ title: c.web.title, uri: c.web.uri }));
}

const edgeService = {
  async chat(messages: any[], context: any, onChunk: (c: any) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...context }), signal
    });
    if (!res.ok) throw new Error('Stream failed');
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t || t === '[DONE]') continue;
          const json = tryParseJson(t.startsWith('data:') ? t.slice(5) : t);
          if (json) onChunk(json);
        }
      }
    } finally { reader!.releaseLock(); }
  },
};

// ============================================================================
// 3. MICRO-COMPONENTS
// ============================================================================

const ToastContext = createContext<{ showToast: (m: string) => void }>({ showToast: () => { } });
const ToastProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<{ id: string; message: string } | null>(null);
  const timeoutRef = useRef<any>();
  const showToast = useCallback((message: string) => {
    const id = generateId(); setToast({ id, message }); triggerHaptic();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setToast(c => c?.id === id ? null : c), 2500);
  }, []);
  return (
    <ToastContext.Provider value={useMemo(() => ({ showToast }), [showToast])}>
      {children}
      <AnimatePresence>
        {toast && (
          <motion.div key={toast.id} initial={{ opacity: 0, y: 20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} transition={SYSTEM.anim.snappy}
            className="absolute bottom-28 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-4 py-2.5 bg-[#1C1C1E] border border-white/10 rounded-full shadow-2xl">
            <CheckCircle2 size={14} className="text-emerald-400" /><span className="text-[13px] font-medium text-white">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
};

const OrbitalRadar = memo(() => (
  <div className="relative w-5 h-5 flex items-center justify-center">
    <div className="absolute w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
    <motion.div className="absolute inset-0 border border-white/20 rounded-full" animate={{ scale: [0.8, 1.5], opacity: [1, 0] }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }} />
    <motion.div className="absolute w-full h-full border-t border-emerald-500/50 rounded-full" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />
  </div>
));

const CopyButton: FC<{ content: string }> = memo(({ content }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content); setCopied(true); triggerHaptic(); setTimeout(() => setCopied(false), 1500);
  }, [content]);
  return (
    <button onClick={handleCopy} className={cn("p-1.5 rounded-md transition-colors", copied ? "text-emerald-400" : "text-zinc-500 hover:text-white hover:bg-white/10")}>
      {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
    </button>
  );
});

const ThinkingPill: FC<{ onStop?: () => void; status?: string }> = memo(({ onStop, status = 'thinking' }) => {
  const STATES = ['CHECKING LINES', 'SCANNING SHARP MONEY', 'GRADING EDGE', 'VERIFYING SPLITS'];
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (status === 'thinking') { const i = setInterval(() => setIdx(p => (p + 1) % STATES.length), 2000); return () => clearInterval(i); } }, [status]);
  const text = status === 'streaming' ? 'LIVE FEED' : status === 'grounding' ? 'SOURCING' : STATES[idx];
  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10, scale: 0.9 }} transition={SYSTEM.anim.snappy}
      className={cn('absolute bottom-[100%] left-1/2 -translate-x-1/2 mb-4 flex items-center gap-3 px-4 py-2', SYSTEM.geo.pill, 'bg-[#0A0A0A]/90 backdrop-blur-md border border-white/10 shadow-xl z-20')}>
      <OrbitalRadar />
      <AnimatePresence mode="wait"><motion.span key={text} initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn(SYSTEM.type.nano, 'text-white/80 min-w-[100px] text-center')}>{text}</motion.span></AnimatePresence>
      {onStop && <button onClick={onStop} className="ml-1 hover:text-white text-white/40 transition-colors"><StopCircle size={12} /></button>}
    </motion.div>
  );
});

const SmartChips: FC<{ onSelect: (t: string) => void; hasMatch: boolean }> = memo(({ onSelect, hasMatch }) => {
  const chips = hasMatch ? ['Sharp Report', 'Best Bet', 'Public Fade', 'Player Props'] : ['Edge Today', 'Line Moves', 'Public Splits', 'Injury News'];
  const q: Record<string, string> = { 'Sharp Report': 'Give me the full sharp report.', 'Best Bet': 'What is the best bet?', 'Public Fade': 'Where is the public heavy?', 'Player Props': 'Analyze props.', 'Edge Today': 'What has edge today?', 'Line Moves': 'Show line moves.', 'Public Splits': 'Public splits?', 'Injury News': 'Injury news?' };
  return (
    <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide px-1">
      {chips.map((c, i) => (
        <motion.button key={c} onClick={() => { triggerHaptic(); onSelect(q[c]); }}
          initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, ...SYSTEM.anim.snappy }}
          whileHover={{ scale: 1.04, backgroundColor: 'rgba(255,255,255,0.08)' }} whileTap={{ scale: 0.96 }}
          className={cn('px-3 py-2 bg-white/[0.03] border border-white/10 hover:border-white/20 transition-colors', SYSTEM.geo.card)}>
          <span className={cn(SYSTEM.type.micro, 'text-zinc-400')}>{c}</span>
        </motion.button>
      ))}
    </div>
  );
});

// ============================================================================
// 4. ARTIFACT RENDERERS
// ============================================================================

const VerdictTicket: FC<{ content: string }> = memo(({ content }) => (
  <motion.div layout initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SYSTEM.anim.spring}
    className="my-6 relative overflow-hidden rounded-[20px] bg-[#0e0e10] border border-white/10 shadow-2xl group">
    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity"><CheckCircle2 size={100} /></div>
    <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
      <span className={cn(SYSTEM.type.nano, "text-white/40")}>Final Determination</span>
      <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /><span className={cn(SYSTEM.type.nano, "text-emerald-400")}>Live</span></div>
    </div>
    <div className="p-6"><div className="text-2xl md:text-3xl font-semibold text-white tracking-tight leading-tight">{content}</div></div>
  </motion.div>
));

const TacticalHUD: FC<{ content: string }> = memo(({ content }) => (
  <motion.div layout initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={SYSTEM.anim.fluid}
    className={cn("my-6 relative overflow-hidden rounded-r-xl border-l-2 border-l-amber-500", SYSTEM.surface.hud)}>
    <div className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={14} className="text-amber-500" />
        <span className={cn(SYSTEM.type.nano, "text-amber-500 tracking-widest")}>Tactical HUD</span>
      </div>
      <div className="text-[14px] text-amber-100/90 leading-relaxed font-medium">{content}</div>
    </div>
    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-amber-500/[0.03] to-transparent pointer-events-none" />
  </motion.div>
));

// ============================================================================
// 5. MESSAGE BUBBLE
// ============================================================================

const MessageBubble: FC<{ message: Message; isLast: boolean; onAction: (t: string) => void }> = memo(({ message }) => {
  const isUser = message.role === 'user';
  const textContent = useMemo(() => {
    const raw = extractTextContent(message.content);
    return isUser ? raw : injectCitations(raw, message.groundingMetadata);
  }, [message.content, message.groundingMetadata, isUser]);
  const sources = useMemo(() => extractSources(message.groundingMetadata), [message.groundingMetadata]);

  return (
    <motion.div layout="position" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={SYSTEM.anim.fluid} className={cn('flex flex-col mb-8 w-full relative group', isUser ? 'items-end' : 'items-start')}>
      {!isUser && !message.isStreaming && <div className="absolute -left-8 top-0 opacity-0 group-hover:opacity-100 transition-opacity"><CopyButton content={textContent} /></div>}

      <div className={cn('relative max-w-[92%] md:max-w-[85%]', isUser ? 'bg-white text-black rounded-[20px] rounded-tr-sm shadow-lg px-5 py-3' : 'bg-transparent text-white px-0')}>
        <div className={cn("prose prose-invert max-w-none", isUser && "prose-p:text-black/90")}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            p: ({ children }) => {
              const t = String(React.Children.toArray(children)[0] || '');
              if (t.startsWith('VERDICT:')) return <VerdictTicket content={t.replace('VERDICT:', '').trim()} />;
              if (t.includes('WHAT TO WATCH LIVE')) { const c = t.replace(/WHAT TO WATCH LIVE:?/i, '').trim(); return c.length > 5 ? <TacticalHUD content={c} /> : null; }
              return <p className={cn(SYSTEM.type.body, isUser ? "text-black" : "text-[#A1A1AA]", "mb-4 last:mb-0")}>{children}</p>;
            },
            strong: ({ children }) => {
              const t = String(children);
              if (['Analytical Walkthrough', 'Market Dynamics', 'Sentiment Signal'].some(k => t.includes(k))) return <div className="mt-8 mb-3 pb-1 border-b border-white/10 text-[11px] font-mono text-emerald-400 uppercase tracking-widest">{children}</div>;
              return <strong className="font-semibold text-white">{children}</strong>;
            },
            a: ({ href, children }) => {
              const t = String(children);
              if (/^\[?\d+\]?$/.test(t.trim())) return <a href={href} target="_blank" rel="noopener" className="inline-flex items-center justify-center ml-1 -mt-2 w-4 h-4 rounded-[4px] bg-white/10 hover:bg-emerald-500 hover:text-white text-[9px] font-bold text-white/60 transition-all no-underline">{t.replace(/[\[\]]/g, '')}</a>;
              return <a href={href} target="_blank" rel="noopener" className="text-emerald-400 hover:text-emerald-300 underline decoration-emerald-500/30 underline-offset-4 transition-colors">{children}</a>;
            }
          }}>{textContent}</ReactMarkdown>
        </div>
      </div>

      {!isUser && !message.isStreaming && sources.length > 0 && (
        <div className="mt-2 ml-1 w-full max-w-[85%]">
          <details className="group/sources">
            <summary className={cn('list-none cursor-pointer flex items-center gap-2 select-none', SYSTEM.type.nano, 'text-zinc-600 hover:text-zinc-400 transition-colors')}>
              <span className="group-open/sources:rotate-90 transition-transform">›</span><span>Sources ({sources.length})</span>
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-2 pl-2">
              {sources.map((s, i) => (
                <a key={i} href={s.uri} target="_blank" rel="noopener" className={cn('flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-white/10 transition-all group/link')}>
                  <span className="w-4 h-4 flex items-center justify-center rounded text-[9px] bg-zinc-800 text-zinc-400 font-mono">{i + 1}</span>
                  <span className="text-[11px] text-zinc-500 group-hover/link:text-zinc-300 truncate">{s.title}</span>
                </a>
              ))}
            </div>
          </details>
        </div>
      )}
    </motion.div>
  );
});

// ============================================================================
// 6. INPUT DECK
// ============================================================================

const InputDeck: FC<{ value: string; onChange: (v: string) => void; onSend: () => void; onStop: () => void; attachments: Attachment[]; onAttach: (a: Attachment[]) => void; isProcessing: boolean; isVoiceMode: boolean; onVoiceModeChange: (v: boolean) => void; inputRef: RefObject<HTMLTextAreaElement | null>; fileInputRef: RefObject<HTMLInputElement | null>; }> = memo(({ value, onChange, onSend, onStop, attachments, onAttach, isProcessing, isVoiceMode, onVoiceModeChange, inputRef, fileInputRef }) => {
  const recognitionRef = useRef<any>(null);
  const handleKeyDown = (e: ReactKeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (value.trim() || attachments.length) onSend(); } };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const f = e.target.files[0];
      const r = new FileReader();
      r.onload = async () => {
        const base64 = (r.result as string).split(',')[1];
        onAttach([...attachments, { file: f, base64, mimeType: f.type }]);
      };
      r.readAsDataURL(f);
    }
    e.target.value = '';
  };

  const toggleVoice = () => {
    const API = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!API) return;
    if (isVoiceMode) { recognitionRef.current?.abort(); onVoiceModeChange(false); }
    else {
      const r = new API(); r.continuous = false; r.interimResults = true;
      r.onresult = (e: any) => { const t = e.results[0]?.[0]?.transcript; if (t) onChange(t); };
      r.onend = () => onVoiceModeChange(false);
      recognitionRef.current = r; onVoiceModeChange(true); r.start();
    }
    triggerHaptic();
  };

  return (
    <motion.div layout className={cn('flex flex-col gap-2 p-2 relative overflow-hidden', SYSTEM.geo.card, 'bg-[#0F0F10] border transition-all duration-300', isVoiceMode ? 'border-emerald-500/30 shadow-[0_0_30px_-10px_rgba(16,185,129,0.2)]' : 'border-white/[0.08]')} transition={SYSTEM.anim.morph}>
      <AnimatePresence>{attachments.length > 0 && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex gap-2 overflow-x-auto p-1 mb-1 scrollbar-hide">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.05] rounded-md border border-white/[0.05]"><ImageIcon size={12} className="text-white/50" /><span className="text-[10px] text-zinc-400 max-w-[80px] truncate">{a.file.name}</span><button onClick={() => onAttach(attachments.filter((_, x) => x !== i))} className="text-zinc-500 hover:text-white"><X size={10} /></button></div>
          ))}
        </motion.div>
      )}</AnimatePresence>

      <div className="flex items-end gap-2">
        <button onClick={() => fileInputRef.current?.click()} className="p-3 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"><Plus size={20} strokeWidth={1.5} /></button>
        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} accept="image/*,application/pdf" />
        {isVoiceMode ? (
          <div className="flex-1 flex items-center justify-center h-[48px] gap-3"><OrbitalRadar /><span className={cn(SYSTEM.type.nano, 'text-emerald-500 tracking-widest')}>LISTENING</span></div>
        ) : (
          <textarea ref={inputRef} value={value} onChange={e => onChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask for edge, splits, or props..." rows={1} className={cn('flex-1 bg-transparent border-none outline-none resize-none py-3.5 min-h-[48px] max-h-[120px]', SYSTEM.type.body, 'text-white placeholder:text-white/20')} />
        )}
        <div className="flex items-center gap-1 pb-1">
          {!value && !attachments.length && <button onClick={toggleVoice} className={cn('p-3', SYSTEM.radius.lg, isVoiceMode ? 'text-rose-400 bg-rose-500/10' : 'text-zinc-500 hover:bg-white/5 hover:text-white')}>{isVoiceMode ? <MicOff size={18} /> : <Mic size={18} />}</button>}
          {(value || attachments.length > 0 || isProcessing) && <motion.button whileTap={{ scale: 0.95 }} onClick={() => isProcessing ? onStop() : onSend()} className={cn('p-2.5 rounded-xl transition-all duration-200', (value || attachments.length || isProcessing) ? 'bg-white text-black shadow-lg' : 'bg-white/5 text-zinc-600')}>{isProcessing ? <StopCircle size={18} className="animate-pulse" /> : <ArrowUp size={18} strokeWidth={2.5} />}</motion.button>}
        </div>
      </div>
    </motion.div>
  );
});

// ============================================================================
// 7. MAIN WIDGET
// ============================================================================

const InnerChatWidget: FC<InnerChatWidgetProps> = ({ currentMatch, inline, isMinimized, setIsMinimized }) => {
  const { toggleGlobalChat } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const { session_id, conversation_id } = useChatContext({ match: currentMatch });

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, isProcessing]);

  const handleSend = useCallback(async (q?: string) => {
    const text = q ?? input.trim();
    if ((!text && !attachments.length) || isProcessing) return;
    if (abortRef.current) abortRef.current.abort();

    setIsProcessing(true); setInput(''); setIsVoiceMode(false); triggerHaptic();
    const userMsg: Message = { id: generateId(), role: 'user', content: text || 'Analysis', timestamp: new Date().toISOString() };
    const aiMsgId = generateId();
    setMessages(prev => [...prev, userMsg, { id: aiMsgId, role: 'assistant', content: '', isStreaming: true, timestamp: new Date().toISOString() }]);

    try {
      const wireMessages = [...messagesRef.current, userMsg].map(m => ({ role: m.role, content: m.content }));
      if (attachments.length > 0) {
        wireMessages[wireMessages.length - 1].content = [{ type: 'text', text: text || 'Analyze this.' }, ...attachments.map(a => ({ type: a.mimeType.startsWith('image') ? 'image' : 'file', source: { type: 'base64', media_type: a.mimeType, data: a.base64 } }))];
        setAttachments([]);
      }

      const context = { session_id, conversation_id, gameContext: currentMatch, run_id: generateId() };
      abortRef.current = new AbortController();
      let fullText = '', fullThought = '', grounding: any;

      await edgeService.chat(wireMessages, context, (chunk) => {
        if (chunk.type === 'text') { fullText += chunk.content || ''; setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, content: fullText } : m)); }
        if (chunk.type === 'thought') { fullThought += chunk.content || ''; setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, thoughts: fullThought } : m)); }
        if (chunk.type === 'grounding') grounding = chunk.groundingMetadata;
        if (chunk.type === 'done') setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, isStreaming: false, sources: chunk.sources, groundingMetadata: chunk.groundingMetadata ?? grounding } : m));
      }, abortRef.current.signal);
    } catch (e: any) {
      if (e.name !== 'AbortError') setMessages(p => p.map(m => m.id === aiMsgId ? { ...m, content: 'Connection interrupted.', isStreaming: false } : m));
    } finally { setIsProcessing(false); abortRef.current = null; }
  }, [input, attachments, isProcessing, session_id, conversation_id, currentMatch]);

  if (isMinimized && !inline) return <motion.button layoutId="chat" onClick={() => setIsMinimized?.(false)} className={cn("flex items-center gap-3 px-6 py-3 rounded-full shadow-2xl", SYSTEM.surface.glassHigh)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}><div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /><span className={SYSTEM.type.h1}>Edge</span></motion.button>;

  return (
    <ToastProvider>
      <LayoutGroup>
        <motion.div layoutId={inline ? undefined : "chat"} className={cn("flex flex-col overflow-hidden transition-all duration-500", inline ? "w-full h-full bg-transparent" : cn("w-full md:w-[440px] h-[100dvh] md:h-[min(800px,90dvh)] rounded-[24px] shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)]", SYSTEM.surface.void, "border border-white/[0.08]"))}>
          {!inline && <header className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0 z-20 select-none"><div className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]" /><span className={cn(SYSTEM.type.h1, 'text-white')}>Obsidian<span className="text-white/30 font-normal">Ledger</span></span></div><div className="flex items-center gap-2"><button onClick={() => setIsMinimized?.(true)} className="p-2 text-zinc-500 hover:text-white"><Minimize2 size={16} /></button><button onClick={() => toggleGlobalChat(false)} className="p-2 text-zinc-500 hover:text-white"><X size={16} /></button></div></header>}
          <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-5 pt-4 pb-40 scroll-smooth scrollbar-hide"><AnimatePresence mode="popLayout">{messages.length === 0 ? <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="h-full flex flex-col items-center justify-center text-center opacity-50"><div className="w-16 h-16 rounded-3xl border border-white/10 bg-white/5 flex items-center justify-center mb-4"><div className="w-4 h-4 bg-white/20 rounded-sm" /></div><p className={SYSTEM.type.nano}>Awaiting market signal...</p></motion.div> : messages.map((m, i) => <MessageBubble key={m.id} message={m} isLast={i === messages.length - 1} onAction={handleSend} />)}</AnimatePresence></div>
          <footer className={cn('absolute bottom-0 left-0 right-0 z-30 px-4 pb-6 pt-12 bg-gradient-to-t from-[#030303] via-[#030303]/95 to-transparent pointer-events-none')}><div className="pointer-events-auto relative"><AnimatePresence>{isProcessing && <ThinkingPill onStop={() => abortRef.current?.abort()} />}</AnimatePresence><AnimatePresence>{messages.length < 2 && !isProcessing && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-4"><SmartChips onSelect={handleSend} hasMatch={!!currentMatch} /></motion.div>}</AnimatePresence><InputDeck value={input} onChange={setInput} onSend={() => handleSend()} onStop={() => abortRef.current?.abort()} attachments={attachments} onAttach={a => setAttachments(a)} isProcessing={isProcessing} isVoiceMode={isVoiceMode} onVoiceModeChange={setIsVoiceMode} inputRef={inputRef} fileInputRef={fileInputRef} /></div></footer>
        </motion.div>
      </LayoutGroup>
    </ToastProvider>
  );
};

const ChatWidget: FC<ChatWidgetProps> = (props) => {
  const { isGlobalChatOpen } = useAppStore();
  const [isMinimized, setIsMinimized] = useState(false);
  if (props.inline) return <InnerChatWidget {...props} inline />;
  return <AnimatePresence>{isGlobalChatOpen && <motion.div initial={{ opacity: 0, y: 60, scale: 0.95, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 60, scale: 0.95, filter: 'blur(8px)' }} transition={SYSTEM.anim.fluid} className={cn("fixed z-[9999]", isMinimized ? "bottom-6 right-6" : "inset-0 md:inset-auto md:bottom-6 md:right-6 md:max-w-[440px]")}><InnerChatWidget {...props} inline={false} isMinimized={isMinimized} setIsMinimized={setIsMinimized} /></motion.div>}</AnimatePresence>;
};

export default ChatWidget;