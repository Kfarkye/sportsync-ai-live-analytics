/**
 * ChatWidget Type Definitions
 * Extracted from ChatWidget.tsx §2
 */

import type { MatchOdds } from "@/types";

// ─── Grounding (Gemini Search) ───────────────────────────────────────────

export interface GroundingChunk {
  web?: { uri: string; title?: string };
}

export interface GroundingSupport {
  segment: {
    startIndex: number;
    endIndex: number;
    text?: string;
  };
  groundingChunkIndices: number[];
  confidenceScores?: number[];
}

export interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  groundingSupports?: GroundingSupport[];
  searchEntryPoint?: { renderedContent: string };
  webSearchQueries?: string[];
}

// ─── Messages ────────────────────────────────────────────────────────────

export interface TextContent { type: "text"; text: string }
export interface ImageContent { type: "image"; source: { type: "base64"; media_type: string; data: string } }
export interface FileContent { type: "file"; source: { type: "base64"; media_type: string; data: string } }
export type MessagePart = TextContent | ImageContent | FileContent;
export type MessageContent = string | MessagePart[];
export type VerdictOutcome = "tail" | "fade" | null;

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: MessageContent;
  thoughts?: string;
  groundingMetadata?: GroundingMetadata;
  isStreaming?: boolean;
  timestamp: string;
  verdictOutcome?: VerdictOutcome;
}

export interface Attachment { file: File; base64: string; mimeType: string }

// ─── Game Context ────────────────────────────────────────────────────────

export interface GameContext {
  match_id?: string;
  home_team?: string;
  away_team?: string;
  league?: string;
  sport?: string;
  start_time?: string;
  status?: string;
  period?: number;
  clock?: string;
  home_score?: number;
  away_score?: number;
  current_odds?: MatchOdds;
  opening_odds?: MatchOdds;
  closing_odds?: MatchOdds;
  [key: string]: unknown;
}

// ─── Widget Props ────────────────────────────────────────────────────────

export interface ChatWidgetProps { currentMatch?: GameContext; inline?: boolean }

export interface StreamChunk {
  type: "text" | "thought" | "grounding" | "error";
  content?: string;
  metadata?: GroundingMetadata;
  done?: boolean;
}

export type WireMessage = { role: "user" | "assistant"; content: MessageContent };

export interface ChatContextPayload {
  session_id?: string | null;
  conversation_id?: string | null;
  gameContext?: GameContext | null;
  run_id: string;
}

export type ConnectionStatus = "connected" | "reconnecting" | "offline";

// ─── Speech Recognition (Browser API) ────────────────────────────────────

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
  interface SpeechRecognitionResultList { readonly length: number; [index: number]: SpeechRecognitionResult }
  interface SpeechRecognitionResult { readonly length: number; readonly isFinal: boolean; [index: number]: SpeechRecognitionAlternative }
  interface SpeechRecognitionAlternative { readonly transcript: string; readonly confidence: number }
}
