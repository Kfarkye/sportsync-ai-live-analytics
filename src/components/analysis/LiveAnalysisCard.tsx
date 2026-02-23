import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Match, EnhancedEdgeAnalysis, Sport, DeepIntel, AISignals, SharpOrigin, MatchIntelligence } from '@/types';
import { geminiService } from '../../services/geminiService';
import { dbService, CacheResult } from '../../services/dbService';
import { computeAISignals } from '../../services/gameStateEngine';
import { useDbFirst } from '../../hooks/useDbFirst';
import { getDbMatchId, isGameInProgress } from '../../utils/matchUtils';
import { cn, ESSENCE } from '@/lib/essence';
import {
  Sparkles, ShieldCheck, AlertTriangle,
  Activity, Lock, Ban, Swords, ShieldAlert,
  Timer, TrendingUp, Target, Scale, Crosshair, Goal,
  ExternalLink
} from 'lucide-react';
import { analyzeSpread, analyzeTotal, analyzeMoneyline, getOddsValue } from '../../utils/oddsUtils';

// --- Components ---

const SectionLabel = ({ children, color = 'zinc' }: { children: React.ReactNode; color?: string }) => (
  <div className={cn(
    "text-label font-black uppercase tracking-[0.4em] mb-6 flex items-center gap-6 opacity-50 select-none",
    color === 'emerald' ? 'text-emerald-400' :
      color === 'amber' ? 'text-amber-400' :
        color === 'rose' ? 'text-rose-400' :
          color === 'violet' ? 'text-violet-400' :
            color === 'indigo' ? 'text-indigo-400' :
              'text-zinc-500'
  )}>
    {children}
    <div className="flex-grow h-[0.5px] bg-overlay-emphasis" />
  </div>
);

const AnalysisSkeleton = () => (
  <div className={cn("p-10 space-y-8 animate-pulse", ESSENCE.card.base)}>
    <div className="h-3 w-40 bg-zinc-900 rounded" />
    <div className="grid grid-cols-2 gap-3">
      {[1, 2].map(i => <div key={i} className="h-24 bg-zinc-900 rounded-lg" />)}
    </div>
    <div className="h-48 bg-zinc-900 rounded-lg" />
  </div>
);




const SportAwareTensionWidget = ({
  match,
  signals,
  intel
}: {
  match: Match,
  signals: AISignals,
  intel?: MatchIntelligence
}) => {
  const blueprint = match.ai_signals?.blueprint;

  // v5.0: Use edge_state for UI gating (respect threshold taxonomy)
  const edgeState = signals.edge_state || 'NEUTRAL';
  const edgePoints = signals.edge_points || 0;

  // Direction is ONLY valid when edge_state is NOT NEUTRAL
  const lean = edgeState !== 'NEUTRAL'
    ? (blueprint?.direction || match.ai_signals?.narrative?.market_lean || 'NEUTRAL')
    : 'NEUTRAL';

  const hasInertia = signals.constraints?.liability_inertia;
  const hasResistance = signals.constraints?.sharp_resistance;

  // v5.0: Only show when we have ACTIONABLE data (PLAY or LEAN state)
  if (edgeState === 'NEUTRAL' && !hasInertia && !hasResistance) return null;

  // State-based styling
  const stateStyles = {
    'PLAY': { accent: 'emerald', borderColor: 'border-emerald-500/20' },
    'LEAN': { accent: 'amber', borderColor: 'border-amber-500/20' },
    'NEUTRAL': { accent: 'zinc', borderColor: 'border-edge-subtle' }
  };
  const style = stateStyles[edgeState];

  return (
    <div className={cn("relative overflow-hidden p-6 mb-8 bg-overlay-ghost border rounded-xl group", style.borderColor)}>
      <div className="flex justify-between items-center mb-6 relative z-10">
        <div className="flex items-center gap-3">
          {/* v5.0: Only show directional badge when NOT neutral */}
          {edgeState !== 'NEUTRAL' ? (
            <div className={cn(
              "px-3 py-1.5 rounded-lg border flex items-center gap-2",
              lean === 'OVER' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                lean === 'UNDER' ? "bg-rose-500/10 border-rose-500/20 text-rose-400" :
                  "bg-zinc-500/10 border-zinc-500/20 text-zinc-400"
            )}>
              <Activity size={12} />
              <span className="text-caption font-black uppercase tracking-widest">{lean}</span>
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-lg border bg-zinc-800/50 border-zinc-700 text-zinc-500 flex items-center gap-2">
              <Scale size={12} />
              <span className="text-caption font-black uppercase tracking-widest">MARKET ALIGNED</span>
            </div>
          )}
          {(hasInertia || hasResistance) && (
            <span className="text-label font-bold text-amber-500/60 uppercase tracking-widest">
              Market Friction
            </span>
          )}
        </div>
        {/* Edge State Badge */}
        {edgePoints > 0 && (
          <div className={cn(
            "px-2.5 py-1 rounded-full text-label font-black uppercase tracking-widest",
            edgeState === 'PLAY' ? "bg-emerald-500/20 text-emerald-400" :
              edgeState === 'LEAN' ? "bg-amber-500/20 text-amber-400" :
                "bg-zinc-800 text-zinc-500"
          )}>
            {edgePoints.toFixed(1)} PTS
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 relative z-10">
        <div className="p-4 bg-black/40 border border-white/5 rounded-lg flex flex-col gap-1">
          <span className="text-nano font-black uppercase tracking-widest text-zinc-600 leading-none">Projected Total</span>
          <span className={cn("text-2xl font-mono-ledger font-black tabular-nums tracking-tighter",
            edgeState === 'NEUTRAL' ? "text-zinc-400" : "text-emerald-400"
          )}>
            {blueprint?.model_number?.toFixed(1) || match.ai_signals?.deterministic_fair_total?.toFixed(1) || match.current_odds?.fairValue || '—'}
          </span>
        </div>
        <div className="p-4 bg-black/40 border border-white/5 rounded-lg flex flex-col gap-1">
          <span className="text-nano font-black uppercase tracking-widest text-zinc-600 leading-none">Vegas Line</span>
          <span className="text-2xl font-mono-ledger font-black text-white tabular-nums tracking-tighter">
            {blueprint?.line?.toFixed(1) || match.current_odds?.total || match.odds?.total || match.odds?.overUnder || '—'}
          </span>
        </div>
      </div>

      <p className="mt-4 text-caption text-zinc-500 leading-relaxed font-medium line-clamp-2">
        {edgeState === 'NEUTRAL'
          ? "Game is tracking close to Vegas expectations. No significant edge detected at this time."
          : lean === 'OVER'
            ? "This game is running hotter than Vegas projected. The pace suggests the total could go OVER."
            : "Scoring is coming slower than expected. The total is trending UNDER the Vegas line."}
      </p>
    </div>
  );
};

const PPMTracker = ({ ppm, edgeState, edgePoints, context, sport }: {
  ppm?: AISignals['ppm'] | null,
  edgeState?: 'PLAY' | 'LEAN' | 'NEUTRAL',
  edgePoints?: number,
  context?: { elapsed_mins: number; remaining_mins: number; current_score: string; period: number; clock: string },
  sport?: string
}) => {
  if (!ppm) return null;

  // Color coding based on edge state (not just delta)
  const stateConfig = {
    'PLAY': { bg: 'bg-emerald-500/[0.04]', border: 'border-emerald-500/20', badge: 'bg-emerald-500/20 text-emerald-400', label: 'LIVE EDGE' },
    'LEAN': { bg: 'bg-amber-500/[0.04]', border: 'border-amber-500/20', badge: 'bg-amber-500/20 text-amber-400', label: 'LEAN' },
    'NEUTRAL': { bg: 'bg-zinc-500/[0.02]', border: 'border-edge', badge: 'bg-zinc-800 text-zinc-500', label: 'NO EDGE' }
  };
  const config = stateConfig[edgeState || 'NEUTRAL'];

  const deltaColor = ppm.delta > 0 ? "text-emerald-400" : ppm.delta < 0 ? "text-rose-400" : "text-zinc-500";

  return (
    <div className={cn("mb-8 p-6 rounded-xl relative overflow-hidden border", config.bg, config.border)}>
      {/* Header with Edge State Badge */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-violet-500/10 rounded-lg text-violet-400">
            <Activity size={14} />
          </div>
          <div>
            <span className="text-label font-black uppercase tracking-widest text-violet-500/60 block">Live Pace Analysis</span>
            <span className="text-footnote font-bold text-white tracking-tight">Scoring Pace</span>
          </div>
        </div>
        <div className={cn("px-3 py-1 rounded-full flex items-center gap-1.5", config.badge)}>
          {edgeState === 'PLAY' && <Sparkles size={10} />}
          <span className="text-label font-black uppercase tracking-widest">{config.label}</span>
          {edgePoints !== undefined && edgePoints > 0 && (
            <span className="text-label font-mono-ledger font-bold ml-1">({edgePoints.toFixed(1)})</span>
          )}
        </div>
      </div>

      {/* PACE DATA (Invariant-Safe) */}
      <div className="grid grid-cols-3 gap-6 relative z-10 mb-4">
        <div className="flex flex-col gap-1">
          <span className="text-nano font-black uppercase tracking-widest text-zinc-600">Current Pace</span>
          <span className="text-xl font-mono-ledger font-black text-white tabular-nums tracking-tighter">{ppm.observed.toFixed(3)}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-nano font-black uppercase tracking-widest text-zinc-600">Expected Pace</span>
          <span className="text-xl font-mono-ledger font-black text-white tabular-nums tracking-tighter opacity-70">{ppm.projected.toFixed(3)}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-nano font-black uppercase tracking-widest text-zinc-600">Pace Diff</span>
          <span className={cn("text-xl font-mono-ledger font-black tabular-nums tracking-tighter", deltaColor)}>
            {ppm.delta > 0 ? "+" : ""}{ppm.delta.toFixed(3)}
          </span>
        </div>
      </div>

      {/* CONTEXT DATA (Time + Score for Trust) */}
      {context && (
        <div className="flex items-center justify-between pt-4 border-t border-edge-subtle">
          <div className="flex items-center gap-4 text-caption font-mono text-zinc-500">
            <span className="flex items-center gap-1.5">
              <Timer size={10} className="text-zinc-600" />
              <span className="font-bold">{context.clock}</span>
              <span className="text-zinc-600">P{context.period}</span>
            </span>
            <span className="text-zinc-700">|</span>
            <span className="font-bold text-zinc-400">{context.current_score}</span>
          </div>
          <div className="text-label text-zinc-600 font-mono">
            <span className="text-zinc-500">{context.remaining_mins.toFixed(0)}m</span> remaining
          </div>
        </div>
      )}

      {/* Visual bar (only show when NOT neutral) */}
      {edgeState !== 'NEUTRAL' && (
        <div className="mt-4 h-1 w-full bg-white/[0.03] rounded-full overflow-hidden">
          <div
            className={cn("h-full transition-all duration-1000", ppm.delta > 0 ? "bg-emerald-500" : "bg-rose-500")}
            style={{ width: `${Math.min(100, Math.abs(ppm.delta) * 200 + 10)}%` }}
          />
        </div>
      )}
    </div>
  );
};

const DraftKingsAnchor = ({ odds }: { odds?: Match['odds'] | null }) => {
  if (!odds?.draftkingsLink) return null;
  return (
    <a href={odds.draftkingsLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-1.5 bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/20 rounded-full transition-all group no-underline">
      <div className="flex items-center gap-2">
        <span className="text-[8.5px] font-black uppercase tracking-widest text-emerald-500/60 group-hover:text-emerald-400 transition-colors">DraftKings Anchor</span>
        <div className="w-1 h-1 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)] group-hover:scale-150 transition-transform" />
      </div>
      <ExternalLink size={10} className="text-emerald-500/40 group-hover:text-emerald-400 ml-1" />
    </a>
  );
};

const OddsAnchorGrid: React.FC<{ match: Match, signals: AISignals }> = ({ match, signals }) => {
  const s = analyzeSpread(match);
  const t = analyzeTotal(match);
  const m = analyzeMoneyline(match);
  const l = match.current_odds || match.odds;
  const opening = match.opening_odds || match.odds;
  const closing = match.closing_odds;

  const fmtVig = (vig?: number) => {
    if (!vig) return null;
    return vig > 0 ? `+${vig}` : String(vig);
  };

  const fmtSpread = (val: string | number | null | undefined, price?: number) => {
    const num = getOddsValue(val, 'spread');
    if (num === null) return '—';
    const disp = num === 0 ? 'PK' : (num > 0 ? `+${num}` : String(num));
    return (
      <div className="flex flex-col items-center leading-none group">
        <span className="text-4xl font-black tracking-[-0.05em] tabular-nums whitespace-nowrap">{disp}</span>
        {price && <span className="text-caption font-mono font-bold text-zinc-500 mt-1 uppercase">{fmtVig(price)}</span>}
      </div>
    );
  };

  const fmtTotal = (val: string | number | null | undefined, price?: number) => {
    const num = getOddsValue(val, 'total');
    if (num === null) return '—';
    return (
      <div className="flex flex-col items-center leading-none">
        <span className="text-4xl font-black tracking-[-0.05em] tabular-nums">{num}</span>
        {price && <span className="text-caption font-mono font-bold text-zinc-500 mt-1 uppercase">{fmtVig(price)}</span>}
      </div>
    );
  };

  const fmtML = (val: string | number | null | undefined) => {
    const num = getOddsValue(val, 'price');
    if (num === null) return '—';
    return num > 0 ? `+${num}` : String(num);
  };

  const targetAbbr = match.homeTeam.abbreviation || 'HOME';

  return (
    <div className="mb-24 rounded-sm overflow-hidden border border-edge bg-black/20 shadow-[0_24px_48px_rgba(0,0,0,0.5)]">
      <div className="grid grid-cols-4 gap-px bg-white/[0.08]">
        <div className="bg-zinc-950 p-6"><span className="text-[7px] font-black text-zinc-600 uppercase tracking-[0.5em] leading-none">Reference</span></div>
        <div className="bg-zinc-950 p-6 border-l border-white/[0.02]"><span className="text-[7px] font-black text-zinc-600 uppercase tracking-[0.5em] leading-none">Opening</span></div>
        <div className="bg-zinc-950 p-6 border-l border-white/[0.02]"><span className="text-[7px] font-black text-zinc-600 uppercase tracking-[0.5em] leading-none">Closing</span></div>
        <div className="bg-zinc-950 p-6 border-l border-white/[0.02] flex items-center justify-between col-span-1">
          <div className="flex flex-col gap-1">
            <span className="text-[7px] font-black text-emerald-500/60 uppercase tracking-[0.5em] leading-none">Live Slot</span>
            <span className="text-nano font-mono text-zinc-500 uppercase tracking-widest">{targetAbbr} Primary</span>
          </div>
          <DraftKingsAnchor odds={l} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-px bg-overlay-emphasis border-t border-edge">
        <div className="bg-black/40 p-12 flex items-center"><span className="text-label font-black text-white/40 uppercase tracking-ultra">{s.label || 'Spread'}</span></div>
        <div className="bg-black/40 p-12 text-center flex flex-col justify-center">{fmtSpread(opening?.homeSpread || opening?.home_spread || opening?.spread, signals.odds?.open?.spreadPrice)}</div>
        <div className="bg-black/40 p-12 text-center flex flex-col justify-center opacity-60">{closing ? fmtSpread(closing?.homeSpread || closing?.home_spread || closing?.spread) : '—'}</div>
        <div className="bg-black/40 p-12 flex flex-col justify-center">
          <div className="flex items-center gap-4">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.8)] animate-pulse" />
            <div className="flex flex-col">
              <span className="text-5xl font-black text-emerald-400 tracking-[-0.05em] tabular-nums">{s.display}</span>
              {signals.odds?.cur?.spreadPrice && <span className="text-caption font-mono font-bold text-emerald-500/60 mt-1 uppercase">{fmtVig(signals.odds.cur.spreadPrice)}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-px bg-overlay-emphasis border-t border-edge">
        <div className="bg-black/40 p-12 flex items-center"><span className="text-label font-black text-white/40 uppercase tracking-ultra">Total</span></div>
        <div className="bg-black/40 p-12 text-center flex flex-col justify-center">{fmtTotal(opening?.overUnder || opening?.total || opening?.total_line, signals.odds?.open?.totalPrice)}</div>
        <div className="bg-black/40 p-12 text-center flex flex-col justify-center opacity-60">{closing ? fmtTotal(closing?.overUnder || closing?.total || closing?.total_line) : '—'}</div>
        <div className="bg-black/40 p-12 flex flex-col justify-center">
          <div className="flex items-center gap-4">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.8)] animate-pulse" />
            <div className="flex flex-col">
              <span className="text-5xl font-black text-emerald-400 tracking-[-0.05em] tabular-nums">{t.display}</span>
              {signals.odds?.cur?.totalPrice && <span className="text-caption font-mono font-bold text-emerald-500/60 mt-1 uppercase">{fmtVig(signals.odds.cur.totalPrice)}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-px bg-overlay-emphasis border-t border-edge">
        <div className="bg-black/40 p-12 flex items-center"><span className="text-label font-black text-white/40 uppercase tracking-ultra">Money</span></div>
        <div className="bg-black/40 p-12 text-center"><span className="text-4xl font-black text-white/30 tracking-[-0.05em] tabular-nums">{fmtML(opening?.moneylineHome || opening?.homeWin || opening?.home_ml)}</span></div>
        <div className="bg-black/40 p-12 text-center"><span className="text-4xl font-black text-white/20 tracking-[-0.05em] tabular-nums">{closing ? fmtML(closing?.moneylineHome || closing?.homeWin || closing?.home_ml) : '—'}</span></div>
        <div className="bg-black/40 p-12 flex flex-col justify-center">
          <div className="flex items-center gap-4">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.8)] animate-pulse" />
            <span className="text-5xl font-black text-emerald-400 tracking-[-0.05em] tabular-nums">{m.home}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const QuantitativeSignature: React.FC<{ signals: AISignals }> = ({ signals }) => {
  if (!signals) return null;
  const constraints = signals.constraints;

  return (
    <div className="mb-8 p-6 bg-overlay-subtle border border-edge rounded-xl">
      <SectionLabel>Quantitative Signature</SectionLabel>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-6">
        <div className="space-y-2">
          <span className="text-caption font-semibold text-zinc-600 uppercase tracking-wide block">Resistance</span>
          <div className="flex items-center gap-2">
            <div className={cn("w-1.5 h-1.5 rounded-full", constraints.sharp_resistance ? "bg-emerald-500" : "bg-zinc-700")} />
            <span className={cn("text-footnote font-mono", constraints.sharp_resistance ? "text-emerald-400" : "text-zinc-500")}>{constraints.sharp_resistance ? "Sharp" : "Stable"}</span>
          </div>
        </div>
        <div className="space-y-2">
          <span className="text-caption font-semibold text-zinc-600 uppercase tracking-wide block">Public Shade</span>
          <div className="flex items-center gap-2">
            <div className={cn("w-1.5 h-1.5 rounded-full", constraints.public_shade ? "bg-amber-500" : "bg-zinc-700")} />
            <span className={cn("text-footnote font-mono", constraints.public_shade ? "text-amber-400" : "text-zinc-500")}>{constraints.public_shade ? "Active" : "None"}</span>
          </div>
        </div>
        <div className="space-y-2">
          <span className="text-caption font-semibold text-zinc-600 uppercase tracking-wide block">Efficiency</span>
          <span className={cn("text-small font-mono", (signals.efficiency_srs || 0) !== 0 ? "text-white" : "text-zinc-500")}>{(signals.efficiency_srs || 0) > 0 ? `+${signals.efficiency_srs!.toFixed(2)}` : (signals.efficiency_srs?.toFixed(2) || "0.00")}</span>
        </div>
        <div className="space-y-2">
          <span className="text-caption font-semibold text-zinc-600 uppercase tracking-wide block">Stability</span>
          <span className="text-small font-mono text-zinc-400">{signals.efficiency_srs ? (1.0 / (1.0 + Math.abs(signals.efficiency_srs) / 1.5)).toFixed(3) : "1.000"}</span>
        </div>
        <div className="space-y-2">
          <span className="text-caption font-semibold text-zinc-600 uppercase tracking-wide block">Adjustments</span>
          <span className={cn("text-small font-mono", (signals.news_adjustment || 0) !== 0 ? "text-amber-400" : "text-zinc-500")}>{(signals.news_adjustment || 0) > 0 ? `+${signals.news_adjustment!.toFixed(1)}` : (signals.news_adjustment?.toFixed(1) || "0.0")}</span>
        </div>
        <div className="space-y-2">
          <span className="text-caption font-semibold text-zinc-600 uppercase tracking-wide block">Targeting</span>
          <div className="flex items-center gap-2">
            <div className={cn("w-1.5 h-1.5 rounded-full", signals.is_total_override ? "bg-emerald-500" : "bg-zinc-700")} />
            <span className={cn("text-footnote font-mono", signals.is_total_override ? "text-emerald-400" : "text-zinc-500")}>{signals.is_total_override ? (signals.override_classification === 'DELAY' ? "Priority" : "Structural") : "Standard"}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const SharpOriginPill: React.FC<{ origin: SharpOrigin }> = ({ origin }) => {
  if (!origin) return null;
  const status = origin.status || 'NONE';
  const isActive = status === 'ACTIVE';
  const isPotential = status === 'POTENTIAL';
  const accentColor = isActive ? 'text-emerald-400' : isPotential ? 'text-amber-400' : 'text-zinc-600';
  const dotColor = isActive ? 'bg-emerald-500' : isPotential ? 'bg-amber-500' : 'bg-zinc-700';
  return (
    <div className="flex flex-col gap-2 p-4 bg-overlay-subtle border border-edge-subtle rounded-lg">
      <div className="flex items-center justify-between"><span className="text-caption font-semibold uppercase tracking-wide text-zinc-600">{origin.label}</span><div className={cn("w-1.5 h-1.5 rounded-full", dotColor)} /></div>
      <span className={cn("text-footnote font-mono", accentColor)}>{origin.status === 'NONE' ? 'Secure' : origin.value || origin.status}</span>
      <p className="text-footnote text-zinc-500 leading-relaxed line-clamp-2">{origin.description}</p>
    </div>
  );
};

const SharpOrigins: React.FC<{ signals: AISignals }> = ({ signals }) => {
  const origins = signals.sharp_origins;
  if (!origins) return null;
  return (
    <section className="mt-20">
      <SectionLabel color="zinc">Sharp Origins</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SharpOriginPill origin={origins.compute} />
        <SharpOriginPill origin={origins.data} />
        <SharpOriginPill origin={origins.limits} />
        <SharpOriginPill origin={origins.discipline} />
      </div>
    </section>
  );
};

// --- Main Analyst Component ---

export const LiveAnalysisCard: React.FC<{ match: Match }> = ({ match }) => {
  const isLive = isGameInProgress(match.status);

  // v3.6 - LOCAL TRUTH ENFORCEMENT
  // For LIVE games, we force re-computation to bypass stale DB caches.
  const ai_signals = useMemo(() => {
    if (isLive) return computeAISignals(match);
    return match.ai_signals || computeAISignals(match);
  }, [match, isLive]);

  const systemState = ai_signals.system_state;
  const dbId = getDbMatchId(match.id, match.leagueId);

  const { data: intel, isLoading: isIntelLoading } = useDbFirst<MatchIntelligence>(
    () => dbService.getCachedIntel(match.id) as Promise<CacheResult<MatchIntelligence> | null>,
    async () => geminiService.getMatchIntelligence(match),
    (data) => dbService.cacheIntel(match.id, data),
    [match.id]
  );

  const analysis = intel; // Adapt analysis to use the unified intel
  const isAnalysisLoading = isIntelLoading;

  const isLoading = isAnalysisLoading || isIntelLoading;

  if (isLoading) return <AnalysisSkeleton />;

  if (!analysis) {
    return (
      <div className="p-12 bg-black/40 backdrop-blur-3xl border border-white/5 rounded-sm flex flex-col items-center justify-center text-center">
        <span className="text-footnote font-black uppercase tracking-[0.4em] text-zinc-600 mb-6">Offline</span>
      </div>
    );
  }

  const isFootball = match.sport?.toLowerCase().includes('football') || match.sport === Sport.NFL || match.sport === Sport.COLLEGE_FOOTBALL;

  return (
    <div className={cn("p-8 relative overflow-hidden isolate", ESSENCE.card.base)}>
      {/* Obsidian Specular Edge Light */}
      <div
        className="absolute top-0 left-0 right-0 h-px z-20 animate-[breathe_3.5s_ease-in-out_infinite]"
        style={{
          background: `linear-gradient(90deg, transparent, ${ESSENCE.colors.accent.mintEdge} 30%, ${ESSENCE.colors.accent.mintEdge} 70%, transparent)`,
        }}
      />

      {/* 1. Status Bar */}
      <div className="flex items-center gap-4 mb-10 relative z-10">
        <div className={cn(
          "w-1.5 h-1.5 rounded-full transition-all duration-1000",
          systemState === 'ACTIVE' ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]" :
            systemState === 'OBSERVE' ? "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" : "bg-zinc-700"
        )} />
        <span className="text-label font-black uppercase tracking-[0.5em] text-white/30 select-none">
          {systemState}
        </span>
        <div className="flex-grow h-[0.5px] bg-white/[0.05]" />
        <span className="text-label font-mono text-zinc-700 tracking-wider font-bold">
          {new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* 2. Primary Metrics */}

      {/* --- LIVE AI ANALYSIS TEXT (RESTORED PRODUCT OUTPUT) --- */}
      <section className="mb-12 relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-brand-cyan/10 border border-brand-cyan/20 text-brand-cyan">
            <Sparkles size={18} />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight leading-none mb-1">
              Live Edge Analysis
            </h1>
            <p className="text-caption font-mono text-zinc-500 uppercase tracking-widest">
              Sharp Edge Kernel // Real-Time Processing
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-bold text-white leading-tight tracking-tight">
            {intel?.summary}
          </h2>

          <div className="p-6 rounded-2xl bg-overlay-subtle border border-edge-subtle backdrop-blur-sm">
            <p className="text-body text-zinc-400 leading-relaxed font-medium">
              {intel?.tacticalAnalysis}
            </p>
          </div>
        </div>
      </section>

      <SectionLabel color="indigo">Market Context</SectionLabel>

      {/* Integrity Note (Restyled for Product Feel) */}
      {(ai_signals.narrative?.signal_label === 'DATA INTEGRITY ERROR' || (intel?.integrityScore !== undefined && intel.integrityScore < 7)) && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-8 p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-4 relative overflow-hidden group"
        >
          <div className="relative z-10 w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
            <ShieldAlert size={20} className="text-amber-500" />
          </div>
          <div className="relative z-10 flex-1">
            <div className="text-footnote font-black text-amber-500 uppercase tracking-widest leading-none mb-1.5">
              Live Signal Observation
            </div>
            <div className="text-small text-zinc-400 font-medium leading-relaxed">
              {intel?.integrityFindings || "Local pace desync detected. Verifying ground truth data streams."}
            </div>
          </div>
        </motion.div>
      )}

      <SportAwareTensionWidget match={match} signals={ai_signals} />

      {/* v5.0: PPM COMPUTER GROUP ENGINE (Primary Driver with Edge Gating) */}
      <PPMTracker
        ppm={ai_signals.ppm}
        edgeState={ai_signals.edge_state}
        edgePoints={ai_signals.edge_points}
        context={ai_signals.context}
        sport={match.sport}
      />

      {/* 3. ODDS ANCHORS (Reference Truth Layer) */}
      <OddsAnchorGrid match={match} signals={ai_signals} />

      {/* 4. QUANTITATIVE SIGNATURE (SRS Gating) */}
      <QuantitativeSignature signals={ai_signals} />

      {/* 5. SHARP ORIGINS (Source Traceability) */}
      <SharpOrigins signals={ai_signals} />



      {/* Empty State Fallback */}
      {!ai_signals.ppm && !isFootball && (
        <div className="p-8 text-center border border-edge-subtle rounded-xl bg-overlay-ghost">
          <span className="text-caption font-bold uppercase tracking-ultra text-zinc-600">
            Awaiting live data feed...
          </span>
        </div>
      )}
    </div>
  );
};
