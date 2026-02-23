
import React, { useEffect, useState, useRef, useMemo, useCallback, KeyboardEvent } from 'react';
import { Search, Bot, Command, CornerDownLeft, ArrowRight } from 'lucide-react';
import { Match, MatchStatus, Team } from '@/types';
import TeamLogo from '../shared/TeamLogo';
import { cn, ESSENCE } from '@/lib/essence';

interface CommandPaletteProps {
  matches: Match[];
  onSelect: (match: Match) => void;
  isOpen: boolean;
  onClose: () => void;
}

const MAX_RESULTS = 5;

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="hidden sm:inline-flex items-center justify-center h-5 min-w-[20px] px-1 text-caption font-medium font-sans text-zinc-500 bg-[#1A1A1A] border border-white/10 rounded-[4px] mx-0.5 shadow-sm">
    {children}
  </kbd>
);

const MatchItem = React.memo(({ match, isActive, onSelect, onMouseEnter }: { match: Match, isActive: boolean, onSelect: (m: Match) => void, onMouseEnter: () => void }) => {
  return (
    <li
      onClick={() => onSelect(match)}
      onMouseEnter={onMouseEnter}
      className={cn(
        "cursor-pointer flex items-center justify-between p-3 mx-2 rounded-lg transition-all duration-150 group relative",
        isActive ? 'bg-white/[0.08]' : 'hover:bg-overlay-muted'
      )}
    >
      {/* Active Indicator Bar */}
      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 bg-white rounded-r-full shadow-[0_0_10px_white]" />
      )}

      <div className="flex items-center gap-4 pl-3">
        <div className="flex -space-x-2">
          <TeamLogo logo={match.homeTeam.logo} className="w-5 h-5 rounded-full bg-black ring-1 ring-white/10 z-10" />
          <TeamLogo logo={match.awayTeam.logo} className="w-5 h-5 rounded-full bg-black ring-1 ring-white/10" />
        </div>
        <div>
          <div className={cn("text-sm font-medium", isActive ? 'text-white' : 'text-zinc-300')}>
            {match.homeTeam.name} <span className="text-zinc-600 text-xs mx-1">vs</span> {match.awayTeam.name}
          </div>
          <div className="text-caption text-zinc-500 font-medium uppercase tracking-wide flex items-center gap-2">
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
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 10);
      document.body.style.overflow = 'hidden';
    } else {
      setQuery('');
      setActiveIndex(0);
      document.body.style.overflow = 'unset';
    }
  }, [isOpen]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter' && filteredMatches.length > 0) {
      e.preventDefault();
      onSelect(filteredMatches[activeIndex]);
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % filteredMatches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + filteredMatches.length) % filteredMatches.length);
    }
  }, [filteredMatches, activeIndex, onClose, onSelect]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className={cn(
        "relative w-full max-w-[640px] rounded-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col shadow-2xl",
        ESSENCE.glass.panel
      )}>

        {/* Search Header */}
        <div className="flex items-center px-4 py-4 border-b border-white/5 bg-overlay-subtle">
          <Search className="w-5 h-5 text-zinc-500 mr-3" strokeWidth={2} />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-none text-lg text-white placeholder-zinc-600 focus:outline-none font-medium"
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
        <div className="py-2 max-h-[400px] overflow-y-auto custom-scrollbar bg-[#09090B]">
          {filteredMatches.length === 0 ? (
            <div className="py-12 text-center text-zinc-600 flex flex-col items-center gap-2">
              <Search size={24} className="opacity-20" />
              <p className="text-sm">No matches found.</p>
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
        <div className="bg-[#0C0C0E] border-t border-white/5 px-4 py-2 flex items-center justify-between text-caption text-zinc-500 font-medium">
          <span className="flex items-center gap-1.5"><Bot size={10} className="text-violet-500" /> Powered by Sharp Edge AI</span>
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
