import React, { useState } from 'react';
import { InjuryReport } from '../../services/espnPreGame';
import { ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';

interface InjuryListProps {
  homeInjuries: InjuryReport[];
  awayInjuries: InjuryReport[];
  homeTeamName: string;
  awayTeamName: string;
}

const getStatusStyle = (status: string) => {
  const s = status.toLowerCase();
  if (s.includes('out') || s.includes('ir') || s.includes('injured reserve') || s.includes('suspended')) {
    return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
  }
  if (s.includes('doubtful')) {
    return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
  }
  if (s.includes('questionable')) {
    return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  }
  if (s.includes('probable') || s.includes('day-to-day') || s.includes('dtd')) {
    return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
  }
  return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
};

const PlayerAvatar = ({ src, name }: { src?: string; name: string }) => {
  const [error, setError] = useState(false);
  const initials = (name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="relative">
      <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-edge overflow-hidden shrink-0">
        {(!src || error) ? (
          <div className="w-full h-full flex items-center justify-center bg-zinc-850">
            <span className="text-label font-semibold text-zinc-500">{initials}</span>
          </div>
        ) : (
          <img
            src={src}
            alt={name}
            className="w-full h-full object-cover"
            onError={() => setError(true)}
            loading="lazy"
          />
        )}
      </div>
    </div>
  );
};

const InjuryRow: React.FC<{ injury: InjuryReport }> = ({ injury }) => (
  <div className="flex items-center gap-3 py-4 border-b border-edge-subtle last:border-0 hover:bg-white/[0.015] transition-colors duration-300">
    <PlayerAvatar src={injury.headshot} name={injury.name} />
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <h5 className="text-body-sm font-medium text-white tracking-tight leading-none">
            {injury.name}
          </h5>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-caption font-medium text-zinc-500">
              {injury.position}
            </span>
            {injury.description && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="text-caption font-medium text-zinc-600 truncate">
                  {injury.description}
                </span>
              </>
            )}
          </div>
        </div>
        <div className={`px-2 py-0.5 rounded-md text-label font-bold uppercase tracking-wider shrink-0 border ${getStatusStyle(injury.status)}`}>
          {injury.status}
        </div>
      </div>
    </div>
  </div>
);

const InjuryList: React.FC<InjuryListProps> = ({
  homeInjuries,
  awayInjuries,
  homeTeamName,
  awayTeamName,
}) => {
  const [expanded, setExpanded] = useState(false);

  const hasHome = homeInjuries.length > 0;
  const hasAway = awayInjuries.length > 0;
  const totalInjuries = homeInjuries.length + awayInjuries.length;
  const needsExpansion = totalInjuries > 6;

  if (!hasHome && !hasAway) {
    return null;
  }

  const displayLimit = expanded ? undefined : 3;

  return (
    <div>
      <div className={`space-y-8 ${expanded ? 'max-h-[400px] overflow-y-auto pr-1' : ''}`}>
        {hasAway && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-label font-bold text-zinc-600 uppercase tracking-widest">{awayTeamName}</span>
              <div className="flex-1 h-px bg-overlay-muted" />
            </div>
            <div>
              {awayInjuries.slice(0, displayLimit).map((inj, i) => (
                <InjuryRow key={inj?.id || i} injury={inj} />
              ))}
            </div>
          </div>
        )}

        {hasHome && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-label font-bold text-zinc-600 uppercase tracking-widest">{homeTeamName}</span>
              <div className="flex-1 h-px bg-overlay-muted" />
            </div>
            <div>
              {homeInjuries.slice(0, displayLimit).map((inj, i) => (
                <InjuryRow key={inj?.id || i} injury={inj} />
              ))}
            </div>
          </div>
        )}

        {needsExpansion && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full py-2.5 flex items-center justify-center gap-1.5 text-footnote font-medium text-zinc-500 hover:text-white transition-colors duration-150"
          >
            {expanded ? (
              <>Show less <ChevronUp size={12} strokeWidth={2.5} /></>
            ) : (
              <>Show all ({totalInjuries}) <ChevronDown size={12} strokeWidth={2.5} /></>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default InjuryList;