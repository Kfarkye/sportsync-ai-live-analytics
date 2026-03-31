import React, { FC, useEffect, useMemo } from 'react';
import { useMatches } from '@/hooks/useMatches';
import { UnifiedHeader } from '@/components/layout/UnifiedHeader';
import { useAppStore } from '@/store/appStore';
import { Sport, Match } from '@/types';
import { useBaseballLive } from '@/components/baseball';
import { buildBullpenWeatherSignal } from '@/components/baseball/bullpenRisk';
import { Card } from '@/components/ui/Card';
import { cn, ESSENCE } from '@/lib/essence';
import { isGameInProgress } from '@/utils/matchUtils';

const riskTone = (signal: 'high' | 'med' | 'low') => {
  if (signal === 'high') return 'text-emerald-700 bg-emerald-50 border-emerald-100';
  if (signal === 'low') return 'text-rose-700 bg-rose-50 border-rose-100';
  return 'text-amber-700 bg-amber-50 border-amber-100';
};

const formatMatchLabel = (match: Match) =>
  `${match.awayTeam.shortName || match.awayTeam.name} @ ${match.homeTeam.shortName || match.homeTeam.name}`;

const getStatusLabel = (match: Match) =>
  match.displayClock || match.status || '';

const BullpenRow: FC<{ match: Match }> = ({ match }) => {
  const { data: baseballData, isLoading } = useBaseballLive(match.id, match.status, true);
  const edge = baseballData?.edge;
  const weather = edge?.weather;
  const bullpen = edge?.bullpen;
  const pitchCount = edge?.pitchCount;
  const adjusted = buildBullpenWeatherSignal(weather, bullpen, pitchCount);
  const adjustedTone = riskTone(adjusted.signal);

  return (
    <tr className="border-b border-slate-200/70 last:border-0">
      <td className="py-3 px-4 text-sm font-semibold text-slate-900">{formatMatchLabel(match)}</td>
      <td className="py-3 px-4 text-xs font-mono text-slate-500">{getStatusLabel(match)}</td>
      <td className="py-3 px-4 text-xs font-mono text-slate-700">{weather?.value || (isLoading ? 'Loading…' : '—')}</td>
      <td className="py-3 px-4 text-xs font-mono text-slate-700">{pitchCount?.value || (isLoading ? 'Loading…' : '—')}</td>
      <td className="py-3 px-4 text-xs font-mono text-slate-700">{bullpen?.value || (isLoading ? 'Loading…' : '—')}</td>
      <td className="py-3 px-4">
        <span className={cn('inline-flex items-center justify-center px-2.5 py-1 rounded-full border text-[11px] font-semibold', adjustedTone)}>
          {adjusted.value}
        </span>
      </td>
    </tr>
  );
};

const BullpensPage: FC = () => {
  const { setSelectedSport } = useAppStore();

  useEffect(() => {
    setSelectedSport(Sport.BASEBALL);
  }, [setSelectedSport]);

  const { data: matches = [], isLoading } = useMatches(new Date());

  const mlbMatches = useMemo(() => (
    matches.filter((match) => {
      const sport = String(match.sport || '').toUpperCase();
      const league = String(match.leagueId || '').toLowerCase();
      return sport.includes('BASEBALL') || league.includes('mlb');
    })
  ), [matches]);

  const liveFirstMatches = useMemo(() => {
    const live = mlbMatches.filter((match) => isGameInProgress(match.status));
    const upcoming = mlbMatches.filter((match) => !isGameInProgress(match.status));
    return [...live, ...upcoming];
  }, [mlbMatches]);

  return (
    <div className="min-h-screen bg-[var(--ss-bg,#FAFAF8)] text-[var(--ss-text-primary,#1A1A18)]">
      <UnifiedHeader />

      <main className="max-w-6xl mx-auto px-4 md:px-6 pb-20 pt-8">
        <div className="mb-6">
          <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-slate-400 mb-2">MLB Bullpens</div>
          <h1 className="font-serif text-3xl md:text-4xl font-semibold text-slate-900 tracking-tight">
            Bullpen Risk Board
          </h1>
          <p className="text-sm text-slate-600 mt-2 max-w-2xl">
            Late-inning bullpen risk adjusted by weather and starter depth for every MLB game on the slate.
          </p>
        </div>

        <Card variant="solid" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full border-collapse">
              <thead className="bg-[var(--ss-bg,#FAFAF8)]">
                <tr className="text-left text-[10px] font-mono uppercase tracking-[0.2em] text-slate-400">
                  <th className="py-3 px-4">Match</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Weather</th>
                  <th className="py-3 px-4">Starter Depth</th>
                  <th className="py-3 px-4">Bullpen</th>
                  <th className="py-3 px-4">Adjusted Risk</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td className="py-6 px-4 text-sm text-slate-500" colSpan={6}>Loading bullpen board…</td>
                  </tr>
                )}
                {!isLoading && liveFirstMatches.length === 0 && (
                  <tr>
                    <td className="py-6 px-4 text-sm text-slate-500" colSpan={6}>No MLB games on today’s slate.</td>
                  </tr>
                )}
                {liveFirstMatches.map((match) => (
                  <BullpenRow key={match.id} match={match} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="mt-4 text-[11px] text-slate-500">
          Weather and bullpen signals update with the live edge feed. Adjusted risk blends weather lift/suppression with bullpen quality and starter leash.
        </div>
      </main>
    </div>
  );
};

export default BullpensPage;
