import React, { useState, useEffect, useMemo } from 'react';
import { GoalieMatchupData, GoalieProfile, Team } from '@/types';
import { Shield, CheckCircle2, AlertCircle, TrendingUp, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import TeamLogo from './shared/TeamLogo';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/essence';

interface GoalieMatchupProps {
  matchId: string;
  homeTeam: Team;
  awayTeam: Team;
}

/**
 * SOTA GOALIE CARD
 * Elevation: Glassmorphic Ring + Team Accent Glow
 * Typography: Monospace Ledger
 */
const GoalieCard = ({
  goalie,
  team,
  isHome
}: {
  goalie: GoalieProfile;
  team: Team;
  isHome: boolean;
}) => {
  const [imgError, setImgError] = useState(false);
  const isConfirmed = goalie.status === 'confirmed';

  const teamColor = team.color ? `#${team.color.replace('#', '')}` : (isHome ? '#3B82F6' : '#EF4444');

  // Headshot URL - Precision Fallback
  const hasValidId = goalie.id && goalie.id !== '0' && goalie.id !== 'null';
  const headshotUrl = goalie.headshot || (hasValidId ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nhl/players/full/${goalie.id}.png&w=120&h=120&scale=crop` : null);

  const gaa = goalie.stats?.gaa;
  const svPct = goalie.stats?.svPct;
  const record = goalie.stats?.record;
  const reasoning = goalie.stats?.reasoning;
  const bettingInsight = goalie.stats?.bettingInsight;

  return (
    <div className={cn(
      "group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 transition-all duration-500 hover:border-zinc-300",
      isHome ? "items-end text-right" : "items-start text-left"
    )}>
      {/* Cinematic Ambient Glow */}
      <div
        className={cn(
          "absolute top-[-20%] w-[60%] h-[140%] blur-[60px] opacity-[0.08] group-hover:opacity-[0.12] transition-opacity duration-700 pointer-events-none",
          isHome ? "-right-[10%]" : "-left-[10%]"
        )}
        style={{ background: `radial-gradient(circle, ${teamColor} 0%, transparent 70%)` }}
      />

      {/* Header: Status Badge */}
      <div className={cn(
        "relative z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.15em] border mb-6 transition-all duration-500",
        isConfirmed
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[0_0_15px_rgba(16,185,129,0.08)]"
          : "border-amber-200 bg-amber-50 text-amber-700",
        isHome ? "flex-row-reverse" : "flex-row"
      )}>
        {isConfirmed ? (
          <div className="relative">
            <CheckCircle2 size={12} strokeWidth={3} />
            <div className="absolute inset-0 animate-pulse bg-emerald-500 blur-sm opacity-25" />
          </div>
        ) : (
          <AlertCircle size={12} strokeWidth={3} />
        )}
        <span>{goalie.status || 'Projected'}</span>
      </div>

      {/* Hero Presentation */}
      <div className={cn(
        "relative z-10 flex items-center gap-5 mb-6",
        isHome ? "flex-row-reverse" : "flex-row"
      )}>
        {/* Headshot with Glassmorphic Ring */}
        <div className="relative shrink-0 group/headshot">
          <div
            className="absolute inset-[-4px] rounded-full blur-sm opacity-20 group-hover/headshot:opacity-40 transition-opacity duration-500"
            style={{ background: teamColor }}
          />
          <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 p-0.5 shadow-sm ring-1 ring-zinc-200 ring-inset">
            {headshotUrl && !imgError ? (
              <img
                src={headshotUrl}
                alt={goalie.name}
                className="w-full h-full object-cover saturate-[0.85] contrast-[1.05]"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-zinc-100 p-2.5">
                <TeamLogo logo={team.logo} name={team.name} className="h-full w-full object-contain grayscale opacity-40 transition-opacity group-hover/headshot:opacity-60" />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col">
          <h4 className="text-[18px] font-bold leading-tight tracking-tight text-zinc-900 transition-colors group-hover:text-zinc-700">
            {goalie.name || 'Unannounced'}
          </h4>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">{team.shortName}</span>
            <div className="h-1 w-1 rounded-full bg-zinc-300" />
            <span className="text-[10px] font-mono font-bold italic text-zinc-500">Primary Netminder</span>
          </div>
        </div>
      </div>

      {/* The Stats Ledger (Digital Monospace) */}
      <div className={cn(
        "relative z-10 grid w-full grid-cols-3 gap-6 border-y border-zinc-200 py-4",
        isHome ? "text-right" : "text-left"
      )}>
        <div className="flex flex-col gap-1">
          <span className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500">GAA</span>
          <span className="text-xl font-mono font-black tabular-nums text-zinc-700">{gaa || '0.00'}</span>
        </div>
        <div className="flex flex-col gap-1 border-x border-zinc-200 px-4">
          <span className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500">SV%</span>
          <span className="text-xl font-mono font-black tabular-nums tracking-tighter text-zinc-900">{svPct || '.000'}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500">Record</span>
          <span className="text-xl font-mono font-black tabular-nums text-zinc-700">{record || '---'}</span>
        </div>
      </div>

      {/* Insights Section */}
      {(reasoning || bettingInsight) && (
        <div className="relative z-10 mt-5 w-full space-y-3">
          {bettingInsight && (
            <div className={cn(
              "flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5",
              isHome ? "flex-row-reverse" : "flex-row"
            )}>
              <TrendingUp size={14} className="mt-0.5 shrink-0 text-emerald-600" />
              <p className="text-[11px] font-medium leading-relaxed text-zinc-700">{bettingInsight}</p>
            </div>
          )}
          {reasoning && (
            <div className={cn(
              "flex items-start gap-2.5 px-1",
              isHome ? "flex-row-reverse" : "flex-row"
            )}>
              <Info size={13} className="mt-0.5 shrink-0 text-zinc-500" />
              <p className="text-[11px] font-medium italic leading-relaxed text-zinc-600">{reasoning}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const GoalieMatchup: React.FC<GoalieMatchupProps> = ({ matchId, homeTeam, awayTeam }) => {
  const [data, setData] = useState<GoalieMatchupData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGoalies = async () => {
      setLoading(true);
      // Ensure matchId is present
      if (!matchId) {
        setLoading(false);
        return;
      }

      const { data: dbData, error } = await supabase
        .from('starting_goalies')
        .select('*')
        .eq('match_id', matchId)
        .maybeSingle();

      if (dbData) {
        type GoalieStatsRaw = string | { wins?: number; losses?: number; otl?: number; gaa?: number | string; savePercentage?: number | string; svPct?: number | string; reasoning?: string; bettingInsight?: string } | null | undefined;
        const parseStats = (raw: GoalieStatsRaw) => {
          let s: GoalieStatsRaw = raw;
          if (typeof raw === 'string') {
            try { s = JSON.parse(raw); } catch { s = {}; }
          }
          if (!s || typeof s !== 'object') s = {};
          const stats = s as { wins?: number; losses?: number; otl?: number; gaa?: number | string; savePercentage?: number | string; svPct?: number | string; reasoning?: string; bettingInsight?: string };

          const w = stats.wins ?? 0;
          const l = stats.losses ?? 0;
          const ot = stats.otl ?? 0;
          const rec = `${w}-${l}-${ot}`;

          return {
            gaa: stats.gaa ? Number(stats.gaa).toFixed(2) : '0.00',
            svPct: stats.savePercentage || stats.svPct ? (Number(stats.savePercentage || stats.svPct)).toFixed(3) : '.000',
            record: rec === '0-0-0' ? '---' : rec,
            reasoning: stats.reasoning,
            bettingInsight: stats.bettingInsight
          };
        };

        setData({
          home: {
            id: dbData.home_goalie_id,
            name: dbData.home_goalie_name,
            status: dbData.home_status,
            stats: parseStats(dbData.home_stats),
            source: dbData.home_source
          },
          away: {
            id: dbData.away_goalie_id,
            name: dbData.away_goalie_name,
            status: dbData.away_status,
            stats: parseStats(dbData.away_stats),
            source: dbData.away_source
          }
        });
      }
      setLoading(false);
    };

    fetchGoalies();
  }, [matchId]);

  if (loading || !data) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="w-full mb-12"
    >
      {/* Section Header */}
      <div className="flex items-center justify-between mb-5 px-1">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2">
            <Shield size={14} className="text-indigo-600" />
          </div>
          <div>
            <h3 className="text-[12px] font-black uppercase tracking-[0.3em] text-zinc-900">Netminder Duet</h3>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Primary Personnel Context</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">
          <div className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-pulse" />
          <span>Authoritative Intelligence</span>
        </div>
      </div>

      {/* Verses Grid */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 shadow-sm md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="bg-white"
        >
          <GoalieCard goalie={data.away} team={awayTeam} isHome={false} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="bg-white border-l border-slate-200"
        >
          <GoalieCard goalie={data.home} team={homeTeam} isHome={true} />
        </motion.div>
      </div>
    </motion.div>
  );
};
