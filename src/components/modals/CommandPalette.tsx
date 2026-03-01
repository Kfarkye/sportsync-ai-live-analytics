
import React, { useEffect, useState, useRef, useMemo, useCallback, KeyboardEvent } from 'react';
import { Search, Bot, CornerDownLeft } from 'lucide-react';
import { Match, MatchStatus, Team } from '@/types';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '@/lib/essence';

interface CommandPaletteProps {
  matches: Match[];
  onSelect: (match: Match) => void;
  isOpen: boolean;
  onClose: () => void;
}

const MAX_RESULTS = 5;

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="mx-0.5 hidden h-5 min-w-[20px] items-center justify-center rounded-[4px] border border-zinc-200 bg-zinc-100 px-1 font-sans text-[10px] font-medium text-zinc-600 sm:inline-flex">
    {children}
  </kbd>
);

const MatchItem = React.memo(({ match, isActive, onSelect, onMouseEnter }: { match: Match, isActive: boolean, onSelect: (m: Match) => void, onMouseEnter: () => void }) => {
  return (
    <li
      onClick={() => onSelect(match)}
      onMouseEnter={onMouseEnter}
      className={cn(
        "group relative mx-2 flex cursor-pointer items-center justify-between rounded-lg p-3.5 transition-all duration-150",
        isActive ? 'bg-zinc-100' : 'hover:bg-zinc-50'
      )}
    >
      {/* Active Indicator Bar */}
      {isActive && (
        <div className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r-full bg-zinc-900" />
      )}

      <div className="flex items-center gap-4 pl-3">
        <div className="flex -space-x-2">
          <TeamLogo logo={match.homeTeam.logo} className="z-10 h-5 w-5 rounded-full bg-white ring-1 ring-zinc-200" />
          <TeamLogo logo={match.awayTeam.logo} className="h-5 w-5 rounded-full bg-white ring-1 ring-zinc-200" />
        </div>
        <div>
          <div className={cn("text-sm font-medium", isActive ? 'text-zinc-900' : 'text-zinc-700')}>
            {match.homeTeam.name} <span className="mx-1 text-xs text-zinc-400">vs</span> {match.awayTeam.name}
          </div>
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            {match.leagueId}
            {match.status === MatchStatus.LIVE && <span className="text-rose-500 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse" /> LIVE</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 pr-2">
        {isActive && <CornerDownLeft size={14} className="text-zinc-500" />}
      </div>
    </li>
  );
});

const CommandPalette: React.FC<CommandPaletteProps> = ({ matches, onSelect, isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredMatches = useMemo(() => {
    if (!query) return matches.slice(0, MAX_RESULTS);
    const lower = query.toLowerCase();
    return matches.filter(m =>
      m.homeTeam.name.toLowerCase().includes(lower) ||
      m.awayTeam.name.toLowerCase().includes(lower) ||
      m.leagueId.toLowerCase().includes(lower)
    ).slice(0, MAX_RESULTS);
  }, [matches, query]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 10);
      document.body.style.overflow = 'hidden';
    } else {
      setQuery('');
      setActiveIndex(0);
      document.body.style.overflow = previousOverflow;
    }
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter' && filteredMatches.length > 0) {
      e.preventDefault();
      onSelect(filteredMatches[activeIndex]);
      onClose();
    } else if (e.key === 'ArrowDown') {
      if (filteredMatches.length === 0) return;
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % filteredMatches.length);
    } else if (e.key === 'ArrowUp') {
      if (filteredMatches.length === 0) return;
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + filteredMatches.length) % filteredMatches.length);
    }
  }, [filteredMatches, activeIndex, onClose, onSelect]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4">
      <div
        className="absolute inset-0 bg-zinc-950/35 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />

      <div className="relative flex w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.16)] animate-in fade-in zoom-in-95 duration-200">

        {/* Search Header */}
        <div className="flex items-center border-b border-zinc-200 bg-white px-4 py-4">
          <Search className="mr-3 h-5 w-5 text-zinc-500" strokeWidth={2} />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 border-none bg-transparent text-lg font-medium text-zinc-900 placeholder-zinc-400 focus:outline-none"
            placeholder="Search teams..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />
          <div className="hidden sm:flex gap-1">
            <Kbd>ESC</Kbd>
          </div>
        </div>

        {/* Results */}
        <div className="custom-scrollbar max-h-[400px] overflow-y-auto bg-white py-2">
          {filteredMatches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-zinc-500">
              <Search size={24} className="opacity-20" />
              <p className="text-sm text-zinc-500">No commands match this query. Try a shorter keyword.</p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {filteredMatches.map((match, idx) => (
                <MatchItem
                  key={match.id}
                  match={match}
                  isActive={idx === activeIndex}
                  onSelect={(m) => { onSelect(m); onClose(); }}
                  onMouseEnter={() => setActiveIndex(idx)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-4 py-2 text-[10px] font-medium text-zinc-600">
          <span className="flex items-center gap-1.5"><Bot size={10} className="text-zinc-700" /> Powered by Sharp Edge AI</span>
          <div className="hidden sm:flex items-center gap-3">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> to navigate</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> to select</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
