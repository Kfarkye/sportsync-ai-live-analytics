import { GoogleGenAI } from "@google/genai";
import { Match, MatchIntelligence, MatchAngle, NarrativeIntel, UnifiedConfidence, ConfidenceTier } from "@/types";
import { getDbMatchId } from "../utils/matchUtils";
import { supabase } from '../lib/supabase';

type CacheEntry = { data: MatchIntelligence; ts: number };
type PersistedCache = Record<string, CacheEntry>;
type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

const resolveApiKey = () => {
  const nodeKey = typeof process !== 'undefined' ? process.env?.API_KEY : undefined;
  const viteKey = import.meta.env?.VITE_GEMINI_API_KEY;
  return nodeKey || viteKey || '';
};

const buildConfidence = (score: number, tier: ConfidenceTier, label?: string): UnifiedConfidence => {
  const actionState: UnifiedConfidence['actionState'] =
    tier === 'ELITE' || tier === 'STRONG' ? 'BUY' : tier === 'LEAN' ? 'LEAN' : 'READ';
  return { score, tier, label: label || tier, actionState };
};

// Always use process.env.API_KEY with named parameter as per guidelines
const ai = new GoogleGenAI({ apiKey: resolveApiKey() });

class InstitutionalKernel {
  private cache = new Map<string, CacheEntry>();
  private readonly PERSIST_KEY = 'SHARPEDGE_KERNEL_CACHE_V3_PRO';

  constructor() {
    this.hydrate();
  }

  private hydrate() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.PERSIST_KEY);
      if (raw) {
        const data = JSON.parse(raw) as PersistedCache;
        const now = Date.now();
        // Hydrate only items from last 1 hour
        Object.entries(data).forEach(([key, entry]) => {
          if (entry && typeof entry.ts === 'number' && now - entry.ts < 1000 * 60 * 60) {
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

      // ── Pack live match data ──────────────────────────────────────────
      // This is the moat. Everyone has pregame narratives.
      // Nobody is synthesizing live match data into a readable thesis.
      const liveStats = (match.stats || []).map(s => ({
        label: s.label,
        home: s.homeValue,
        away: s.awayValue,
      }));

      const keyEvents = (match.events || [])
        .filter(e => e.type === 'goal' || e.type === 'score' || e.type === 'card')
        .slice(-10)  // Last 10 key events
        .map(e => ({
          time: e.time || e.clock || '',
          type: e.type,
          detail: e.detail || e.description || e.text || '',
        }));

      const leaders = (match.leaders || []).slice(0, 4).map(l => ({
        stat: l.displayName || l.name,
        player: l.leaders?.[0]?.athlete?.displayName || l.leaders?.[0]?.athlete?.fullName || '',
        value: l.leaders?.[0]?.displayValue || '',
      }));

      const { data, error } = await supabase.functions.invoke('analyze-match', {
        body: {
          match_id: dbId,
          sport: match.sport,
          snapshot: {
            score: `${match.awayScore}-${match.homeScore}`,
            home_score: match.homeScore,
            away_score: match.awayScore,
            clock: match.displayClock || "0:00",
            period: match.period,
            status: match.status,
            home_team: match.homeTeam?.name || match.homeTeam?.shortName || 'Home',
            away_team: match.awayTeam?.name || match.awayTeam?.shortName || 'Away',
            market_total: match.current_odds?.total || match.odds?.overUnder || 0,
            fair_total: match.ai_signals?.deterministic_fair_total || 0,
            league_id: match.leagueId,
          },
          // Live match data — the AI reads the game, not the preview
          live_stats: liveStats,
          key_events: keyEvents,
          leaders: leaders,
          predictor: match.predictor ? {
            homeChance: match.predictor.homeTeamChance,
            awayChance: match.predictor.awayTeamChance,
          } : null,
          advanced_metrics: match.advancedMetrics || null,
          last_play: match.lastPlay ? {
            text: match.lastPlay.text,
            clock: match.lastPlay.clock,
            type: match.lastPlay.type,
          } : null,
          ai_signals: match.ai_signals
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
            tier: 'STRONG',
            actionState: 'BUY'
          },
          reasoning: data.sharp_data.executive_bullets?.driver || "Audit Complete.",
          betType: data.sharp_data.recommendation?.market_type || "TOTAL"
        },
        thought_trace: data.thought_trace,
        sources: data.sources || []
      };

      this.cache.set(cacheKey, { data: result, ts: Date.now() });
      this.hibernate();
      return result;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error(`[Kernel-Fault] Pipeline failure: ${err.message}`);
      return {
        summary: "Link Calibrating",
        tacticalAnalysis: "The Live AI Kernel is currently synchronizing with the data feed.",
        prediction: {
          pick: "NEUTRAL",
          confidence: buildConfidence(0, 'PASS', 'WAITING'),
          reasoning: "Sync in progress.",
          betType: "TOTAL"
        },
        thought_trace: "Pipeline Error: " + err.message
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
        const AudioCtor = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
        if (!AudioCtor) return;
        const audioCtx = new AudioCtor({ sampleRate: 24000 });
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
          confidence: intel.prediction.confidence
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
        confidence: intel.prediction.confidence,
        reason: intel.prediction.reasoning
      }
    };
  }
}

export const geminiService = new InstitutionalKernel();
