import React, { memo, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/essence';

interface TeamLogoProps {
  logo?: string;
  name?: string;
  className?: string;
  abbreviation?: string;
  sport?: string;
  color?: string;
  variant?: 'default' | 'card';
  isLive?: boolean;
}

const NBA_ESPN_ABBREV_MAP: Record<string, string> = {
  ATL: 'atl',
  BOS: 'bos',
  BKN: 'bkn',
  CHA: 'cha',
  CHI: 'chi',
  CLE: 'cle',
  DAL: 'dal',
  DEN: 'den',
  DET: 'det',
  GSW: 'gs',
  HOU: 'hou',
  IND: 'ind',
  LAC: 'lac',
  LAL: 'lal',
  MEM: 'mem',
  MIA: 'mia',
  MIL: 'mil',
  MIN: 'min',
  NOP: 'no',
  NYK: 'ny',
  OKC: 'okc',
  ORL: 'orl',
  PHI: 'phi',
  PHX: 'phx',
  POR: 'por',
  SAC: 'sac',
  SAS: 'sa',
  TOR: 'tor',
  UTA: 'utah',
  WAS: 'wsh',
};

const SPORT_PATH_MAP: Record<string, string> = {
  NBA: 'nba',
  WNBA: 'wnba',
  NFL: 'nfl',
  NCAAF: 'ncf',
  COLLEGE_FOOTBALL: 'ncf',
  HOCKEY: 'nhl',
  NHL: 'nhl',
  BASEBALL: 'mlb',
  MLB: 'mlb',
  SOCCER: 'soccer',
  MLS: 'soccer',
};

const toColor = (value?: string): string => {
  if (!value) return '#4F46E5';
  if (value.startsWith('#')) return value;
  return `#${value}`;
};

const initialsFromName = (name?: string): string => {
  const text = (name || '').trim();
  if (!text) return 'TM';
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
};

const normalizeSportPath = (sport?: string, logo?: string): string | undefined => {
  const normalized = String(sport || '').toUpperCase();
  if (SPORT_PATH_MAP[normalized]) return SPORT_PATH_MAP[normalized];

  const fromLogo = logo?.match(/teamlogos\/([^/]+)/i)?.[1];
  if (fromLogo) return fromLogo.toLowerCase();
  return undefined;
};

const normalizeAbbreviation = (abbr?: string, sportPath?: string): string | undefined => {
  const value = (abbr || '').trim().toUpperCase();
  if (!value) return undefined;
  if (sportPath === 'nba') return NBA_ESPN_ABBREV_MAP[value] || value.toLowerCase();
  return value.toLowerCase();
};

const buildEspnLogoUrl = (sportPath?: string, abbreviation?: string): string | undefined => {
  if (!sportPath || !abbreviation) return undefined;
  return `https://a.espncdn.com/i/teamlogos/${sportPath}/500/${abbreviation}.png`;
};

const TeamLogo: React.FC<TeamLogoProps> = ({
  logo,
  name = 'Team',
  className = 'w-8 h-8',
  abbreviation,
  sport,
  color,
  variant = 'default',
  isLive = false,
}) => {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const sportPath = useMemo(() => normalizeSportPath(sport, logo), [sport, logo]);
  const normalizedAbbr = useMemo(() => normalizeAbbreviation(abbreviation, sportPath), [abbreviation, sportPath]);
  const espnLogo = useMemo(() => buildEspnLogoUrl(sportPath, normalizedAbbr), [sportPath, normalizedAbbr]);

  const sources = useMemo(() => {
    const output: string[] = [];
    if (espnLogo) output.push(espnLogo);
    if (logo && !output.includes(logo)) output.push(logo);
    return output;
  }, [espnLogo, logo]);

  const currentSource = sources[sourceIndex];
  const fallbackText = (abbreviation || initialsFromName(name)).slice(0, 3).toUpperCase();
  const fallbackColor = toColor(color);

  useEffect(() => {
    setSourceIndex(0);
    setLoaded(false);
    setFailed(false);
  }, [espnLogo, logo]);

  const handleError = () => {
    if (sourceIndex < sources.length - 1) {
      setSourceIndex((prev) => prev + 1);
      setLoaded(false);
      return;
    }
    setFailed(true);
  };

  const isCard = variant === 'card';
  const containerClasses = cn(
    'relative shrink-0 overflow-hidden select-none flex items-center justify-center',
    isCard ? 'rounded-2xl border border-[#E5E5E5] bg-[#F8F8F8]' : 'rounded-full bg-[#F8F8F8]',
    isLive && 'ring-1 ring-[#00C896]/35',
    className
  );

  return (
    <div className={containerClasses} aria-label={name} title={name}>
      {!failed && currentSource && !loaded && (
        <div className={cn('absolute inset-0 animate-pulse', isCard ? 'bg-[#E5E5E5]/65' : 'bg-[#E5E5E5]/85')} />
      )}

      {!failed && currentSource ? (
        <img
          src={currentSource}
          alt={name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={handleError}
          className={cn(
            'h-full w-full object-contain transition-opacity duration-200',
            loaded ? 'opacity-100' : 'opacity-0'
          )}
        />
      ) : (
        <div
          className={cn(
            'h-full w-full flex items-center justify-center text-white font-semibold tracking-[0.03em]',
            NUMERIC_FALLBACK_CLASS
          )}
          style={{ backgroundColor: fallbackColor }}
        >
          {fallbackText}
        </div>
      )}
    </div>
  );
};

const NUMERIC_FALLBACK_CLASS = 'text-[0.42em]';

export default memo(TeamLogo);
