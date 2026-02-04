import { GoogleGenAI } from "@google/genai";
import { Match, MatchIntelligence, MatchAngle, NarrativeIntel } from "../types";
import { getDbMatchId } from "../utils/matchUtils";
import { supabase } from '../lib/supabase';

// Always use process.env.API_KEY with named parameter as per guidelines
const ai = new GoogleGenAI({ apiKey: (process.env as any).API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY });

class InstitutionalKernel {
  private cache = new Map<string, { data: JsonValue; ts: number }>();
  private readonly PERSIST_KEY = 'SHARPEDGE_KERNEL_CACHE_V3_PRO';

  constructor() {
    this.hydrate();
  }

  private hydrate() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.PERSIST_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        const now = Date.now();
        // Hydrate only items from last 1 hour
        Object.entries(data).forEach(([key, entry]: [string, any]) => {
          if (now - entry.ts < 1000 * 60 * 60) {
            this.cache.set(key, entry);
          }
        });
      }
    } catch (e) {
      console.warn('[KernelCache] Hydration failed:', e);
    }
  }

  private hibernate() {
    if (typeof window === 'undefined') return;
    try {
      const entries = Array.from(this.cache.entries()).slice(-10);
      localStorage.setItem(this.PERSIST_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (e) {
      console.warn('[KernelCache] Hibernation failed:', e);
    }
  }

  async getMatchIntelligence(match: Match): Promise<MatchIntelligence> {
    const dbId = getDbMatchId(match.id, match.leagueId);
    const cacheKey = `kernel_v3_pro_${dbId}_${match.homeScore}_${match.awayScore}`;

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      if (Date.now() - cached.ts < 15000) return cached.data;
    }

    try {
      console.log(`[Kernel-Execute] Initiating live analysis for ${dbId}`);

      const { data, error } = await supabase.functions.invoke('analyze-match', {
        body: {
          match_id: dbId,
          sport: match.sport,
          snapshot: {
            score: `${match.awayScore}-${match.homeScore}`,
            clock: match.displayClock || "0:00",
            market_total: match.current_odds?.total || match.odds?.overUnder || 0,
            fair_total: (match as any).ai_signals?.deterministic_fair_total || 0
          },
          ai_signals: (match as any).ai_signals
        }
      });

      if (error || !data.sharp_data) {
        throw new Error("Malformed Analysis Packet");
      }

      const result: MatchIntelligence = {
        summary: data.sharp_data.headline,
        tacticalAnalysis: data.sharp_data.analysis || data.sharp_data.the_read,
        prediction: {
          pick: data.sharp_data.recommendation?.side || "NEUTRAL",
          confidence: {
            score: data.sharp_data.confidence_level || 70,
            label: 'STRONG',
            tier: 'STRONG'
          } as any,
          reasoning: data.sharp_data.executive_bullets?.driver || "Audit Complete.",
          betType: data.sharp_data.recommendation?.market_type || "TOTAL"
        },
        thought_trace: data.thought_trace,
        sources: data.sources || []
      };

      this.cache.set(cacheKey, { data: result, ts: Date.now() });
      this.hibernate();
      return result;
    } catch (e: JsonValue) {
      console.error(`[Kernel-Fault] Pipeline failure: ${e.message}`);
      return {
        summary: "Link Calibrating",
        tacticalAnalysis: "The Live AI Kernel is currently synchronizing with the data feed.",
        prediction: {
          pick: "NEUTRAL",
          confidence: { score: 0, label: 'WAITING', tier: 'PASS' } as any,
          reasoning: "Sync in progress.",
          betType: "TOTAL"
        },
        thought_trace: "Pipeline Error: " + e.message
      };
    }
  }

  async generateScoutingMap(match: Match): Promise<string | null> {
    try {
      const { data, error } = await supabase.functions.invoke('multimodal', {
        body: { task: 'scouting_map', payload: { home: match.homeTeam.name, away: match.awayTeam.name } }
      });

      if (error || !data?.image) return null;
      return `data:image/png;base64,${data.image}`;
    } catch {
      return null;
    }
  }

  async playAudioBriefing(text: string) {
    try {
      const { data, error } = await supabase.functions.invoke('multimodal', {
        body: { task: 'audio_briefing', payload: { text } }
      });

      if (error) throw error;

      if (data?.audio) {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const buffer = await this.decodeAudioData(this.base64ToUint8Array(data.audio), audioCtx);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start();
      }
    } catch (e) {
      console.warn("Audio briefing failed", e);
    }
  }

  private base64ToUint8Array(base64: string) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
  }

  private async decodeAudioData(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
    return buffer;
  }

  async fetchMatchAngle(match: Match): Promise<MatchAngle> {
    const intel = await this.getMatchIntelligence(match);
    return {
      summary: intel.summary,
      keyFactors: [],
      recommendedPlays: [
        {
          label: intel.prediction.pick,
          odds: "OFF",
          confidence: intel.prediction.confidence as any
        }
      ]
    };
  }

  async fetchNarrativeAnalysis(match: Match): Promise<NarrativeIntel> {
    const intel = await this.getMatchIntelligence(match);
    return {
      headline: intel.summary,
      mainRant: intel.tacticalAnalysis,
      psychologyFactors: [],
      analogies: [],
      blazingPick: {
        selection: intel.prediction.pick,
        confidence: intel.prediction.confidence as any,
        reason: intel.prediction.reasoning
      }
    };
  }
}

export const geminiService = new InstitutionalKernel();
