
import React, { useEffect, useState, useRef, useMemo, useCallback, KeyboardEvent } from 'react';
import { Search, Bot, CornerDownLeft, Calendar, Zap, BarChart3, Home, Clock, ArrowRight, Trophy } from 'lucide-react';
import { Match, MatchStatus } from '@/types';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '@/lib/essence';
import { useAppStore } from '../../store/appStore';
import { ORDERED_SPORTS, SPORT_CONFIG } from '@/constants';

// ============================================================================
// COMMAND PALETTE — Obsidian Control Surface
// ============================================================================
// Linear's ⌘K is the central nervous system.
// This handles: match search, sport switching, date navigation, view switching.
// ============================================================================

interface CommandPaletteProps {
  matches: Match[];
  onSelect: (match: Match) => void;
  isOpen: boolean;
  onClose: () => void;
}

const MAX_RESULTS = 5;
type ResultType = 'match' | 'action' | 'sport' | 'view';

interface CommandResult {
  id: string;
  type: ResultType;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  match?: Match;
  action?: () => void;
}

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="hidden sm:inline-flex items-center justify-center h-5 min-w-[20px] px-1 text-caption font-medium font-sans text-zinc-500 bg-surface-subtle border border-white/10 rounded-[4px] mx-0.5 shadow-sm">
    {children}
  </kbd>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-5 pt-4 pb-1.5">
    <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.15em]">{children}</span>
  </div>
);

const ResultItem = React.memo(({ result, isActive, onExecute, onMouseEnter }: {
  result: CommandResult; isActive: boolean; onExecute: () => void; onMouseEnter: () => void;
}) => (
  <li
    onClick={onExecute}
    onMouseEnter={onMouseEnter}
    role="option"
    aria-selected={isActive}
    className={cn(
      "cursor-pointer flex items-center justify-between p-3 mx-2 rounded-lg transition-all duration-150 group relative",
      isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
    )}
  >
    {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 bg-white rounded-r-full shadow-[0_0_10px_white]" />}

    <div className="flex items-center gap-3 pl-2 min-w-0">
      {result.type === 'match' && result.match ? (
        <div className="flex -space-x-2 flex-shrink-0">
          <TeamLogo logo={result.match.homeTeam.logo} className="w-5 h-5 rounded-full bg-black ring-1 ring-white/10 z-10" />
          <TeamLogo logo={result.match.awayTeam.logo} className="w-5 h-5 rounded-full bg-black ring-1 ring-white/10" />
        </div>
      ) : (
        <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center flex-shrink-0">
          {result.icon}
        </div>
      )}
      <div className="min-w-0">
        <div className={cn("text-sm font-medium truncate", isActive ? 'text-white' : 'text-zinc-300')}>{result.label}</div>
        {result.sublabel && (
          <div className="text-caption text-zinc-500 font-medium uppercase tracking-wide flex items-center gap-2 truncate">
            {result.sublabel}
            {result.type === 'match' && result.match?.status === MatchStatus.LIVE && (
              <span className="text-rose-500 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse" /> LIVE</span>
            )}
          </div>
        )}
      </div>
    </div>

    <div className="flex items-center gap-2 pl-2 flex-shrink-0">
      {result.type !== 'match' && <span className="text-[9px] font-medium text-zinc-600 uppercase tracking-widest">{result.type}</span>}
      {isActive && <CornerDownLeft size={14} className="text-zinc-500" />}
    </div>
  </li>
));

const CommandPalette: React.FC<CommandPaletteProps> = ({ matches, onSelect, isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setActiveView, setSelectedSport, setSelectedDate } = useAppStore();

  const quickActions = useMemo((): CommandResult[] => {
    const actions: CommandResult[] = [
      { id: 'view-feed', type: 'view', label: 'Go to Feed', sublabel: 'Home', icon: <Home size={14} className="text-zinc-400" />, action: () => setActiveView('FEED') },
      { id: 'view-live', type: 'view', label: 'Go to Live', sublabel: 'Live games', icon: <Zap size={14} className="text-zinc-400" />, action: () => setActiveView('LIVE') },
      { id: 'view-titan', type: 'view', label: 'Go to Titan', sublabel: 'Analytics', icon: <BarChart3 size={14} className="text-zinc-400" />, action: () => setActiveView('TITAN') },
      { id: 'date-today', type: 'action', label: 'Jump to Today', sublabel: 'Date', icon: <Calendar size={14} className="text-zinc-400" />, action: () => setSelectedDate(new Date().toISOString()) },
      { id: 'date-yesterday', type: 'action', label: 'Jump to Yesterday', sublabel: 'Date', icon: <Clock size={14} className="text-zinc-400" />, action: () => { const d = new Date(); d.setDate(d.getDate() - 1); setSelectedDate(d.toISOString()); } },
      { id: 'date-tomorrow', type: 'action', label: 'Jump to Tomorrow', sublabel: 'Date', icon: <ArrowRight size={14} className="text-zinc-400" />, action: () => { const d = new Date(); d.setDate(d.getDate() + 1); setSelectedDate(d.toISOString()); } },
    ];
    ORDERED_SPORTS.forEach(sport => {
      const cfg = SPORT_CONFIG[sport as keyof typeof SPORT_CONFIG];
      if (cfg) actions.push({ id: `sport-${sport}`, type: 'sport', label: cfg.label || sport, sublabel: 'Switch sport', icon: <Trophy size={14} className="text-zinc-400" />, action: () => setSelectedSport(sport) });
    });
    return actions;
  }, [setActiveView, setSelectedSport, setSelectedDate]);

  const results = useMemo((): CommandResult[] => {
    if (!query) {
      const matchResults = matches.slice(0, 3).map(m => ({ id: m.id, type: 'match' as const, label: `${m.homeTeam.name} vs ${m.awayTeam.name}`, sublabel: m.leagueId, match: m }));
      return [...matchResults, ...quickActions.slice(0, 4)];
    }
    const lower = query.toLowerCase();
    const filteredMatches = matches.filter(m => m.homeTeam.name.toLowerCase().includes(lower) || m.awayTeam.name.toLowerCase().includes(lower) || (m.homeTeam.abbreviation || '').toLowerCase().includes(lower) || (m.awayTeam.abbreviation || '').toLowerCase().includes(lower) || m.leagueId.toLowerCase().includes(lower)).slice(0, MAX_RESULTS).map(m => ({ id: m.id, type: 'match' as const, label: `${m.homeTeam.name} vs ${m.awayTeam.name}`, sublabel: m.leagueId, match: m }));
    const filteredActions = quickActions.filter(a => a.label.toLowerCase().includes(lower) || (a.sublabel || '').toLowerCase().includes(lower)).slice(0, 3);
    return [...filteredMatches, ...filteredActions];
  }, [query, matches, quickActions]);

  useEffect(() => {
    if (isOpen) { setTimeout(() => inputRef.current?.focus(), 10); document.body.style.overflow = 'hidden'; }
    else { setQuery(''); setActiveIndex(0); document.body.style.overflow = 'unset'; }
  }, [isOpen]);

  useEffect(() => { if (activeIndex >= results.length) setActiveIndex(Math.max(0, results.length - 1)); }, [results.length, activeIndex]);

  const executeResult = useCallback((r: CommandResult) => {
    if (r.type === 'match' && r.match) onSelect(r.match);
    else if (r.action) r.action();
    onClose();
  }, [onSelect, onClose]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter' && results.length > 0) { e.preventDefault(); executeResult(results[activeIndex]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(p => (p + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(p => (p - 1 + results.length) % results.length); }
  }, [results, activeIndex, onClose, executeResult]);

  if (!isOpen) return null;

  const matchGroup = results.filter(r => r.type === 'match');
  const actionGroup = results.filter(r => r.type !== 'match');

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4" role="dialog" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-[640px] rounded-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col bg-[#0A0A0B] border border-white/[0.06] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]">

        {/* Search */}
        <div className="flex items-center px-4 py-4 border-b border-white/[0.04] bg-white/[0.01]">
          <Search className="w-5 h-5 text-zinc-500 mr-3" strokeWidth={2} />
          <input ref={inputRef} type="text" role="combobox" aria-expanded={true} aria-controls="cmd-results"
            className="flex-1 bg-transparent border-none text-body-lg text-white placeholder-zinc-600 focus:outline-none font-medium tracking-tight"
            placeholder="Search games, switch sports, jump to date..."
            value={query} onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }} onKeyDown={handleKeyDown} autoComplete="off" />
          <Kbd>ESC</Kbd>
        </div>

        {/* Results */}
        <div id="cmd-results" role="listbox" className="py-1 max-h-[400px] overflow-y-auto custom-scrollbar">
          {results.length === 0 ? (
            <div className="py-12 text-center text-zinc-600 flex flex-col items-center gap-2">
              <Search size={24} className="opacity-20" />
              <p className="text-sm font-medium">No results found</p>
            </div>
          ) : (
            <>
              {matchGroup.length > 0 && (
                <><SectionLabel>Games</SectionLabel>
                  <ul className="space-y-0.5">{matchGroup.map(r => { const idx = results.indexOf(r); return <ResultItem key={r.id} result={r} isActive={idx === activeIndex} onExecute={() => executeResult(r)} onMouseEnter={() => setActiveIndex(idx)} />; })}</ul>
                </>
              )}
              {actionGroup.length > 0 && (
                <><SectionLabel>Quick Actions</SectionLabel>
                  <ul className="space-y-0.5">{actionGroup.map(r => { const idx = results.indexOf(r); return <ResultItem key={r.id} result={r} isActive={idx === activeIndex} onExecute={() => executeResult(r)} onMouseEnter={() => setActiveIndex(idx)} />; })}</ul>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.04] px-4 py-2.5 flex items-center justify-between text-caption text-zinc-600 font-medium">
          <span className="flex items-center gap-1.5"><Bot size={10} className="text-violet-500" /> Sharp Edge AI</span>
          <div className="hidden sm:flex items-center gap-3">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> select</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
