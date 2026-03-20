import React from 'react';
import TeamLogo from '../shared/TeamLogo';

interface RecentFormTeam {
  last5?: RecentGame[];
}

interface RecentFormProps {
  homeTeam: RecentFormTeam | null | undefined;
  awayTeam: RecentFormTeam | null | undefined;
  homeName: string;
  awayName: string;
  homeLogo?: string;
  awayLogo?: string;
  homeColor?: string;
  awayColor?: string;
}

interface RecentOpponent {
  score?: string | number;
  logo?: string;
  shortName?: string;
  name?: string;
}

interface RecentGame {
  result?: 'W' | 'L' | 'D' | string;
  teamScore?: string | number;
  date?: string;
  opponent?: RecentOpponent;
}

const normalizeResult = (value: string | undefined): 'W' | 'L' | 'D' => {
  const token = String(value || '').toUpperCase();
  if (token === 'W' || token === 'L' || token === 'D') return token;
  return 'D';
};

const toNum = (value: string | number | undefined): number | null => {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatShortDate = (value: string | undefined): string => {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const StreakDots = ({ games, teamColor }: { games: RecentGame[]; teamColor?: string }) => {
  if (games.length === 0) {
    return <span className="text-[10px] text-slate-500">No recent games</span>;
  }

  const resolvedColor = teamColor ? (teamColor.startsWith('#') ? teamColor : `#${teamColor}`) : '#1D4ED8';

  return (
    <div className="flex items-center gap-1" aria-label="Last five results">
      {games.slice(0, 5).map((game, index) => {
        const result = normalizeResult(game.result);
        const dotClass =
          result === 'W'
            ? 'border-transparent'
            : result === 'L'
              ? 'bg-slate-300 border-slate-300'
              : 'bg-white border-slate-300';
        const style = result === 'W' ? { backgroundColor: resolvedColor } : undefined;

        return (
          <span
            key={`${result}-${index}`}
            className={`inline-flex h-2.5 w-2.5 rounded-full border ${dotClass}`}
            style={style}
            title={result}
          />
        );
      })}
    </div>
  );
};

const FormRow = ({ game, align = 'left' }: { game: RecentGame; align?: 'left' | 'right' }) => {
  const result = normalizeResult(game.result);
  const teamScore = toNum(game.teamScore);
  const oppScore = toNum(game.opponent?.score);
  const scoreText =
    teamScore !== null && oppScore !== null
      ? `${teamScore}-${oppScore}`
      : teamScore !== null
        ? `${teamScore}-—`
        : '—';

  return (
    <div
      className={`grid grid-cols-[60px_minmax(0,1fr)_70px_30px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <div className="text-[10px] text-slate-500 font-mono tabular-nums">{formatShortDate(game.date)}</div>

      <div className={`flex items-center gap-2 min-w-0 ${align === 'right' ? 'justify-end' : ''}`}>
        {align === 'right' ? null : (
          <TeamLogo logo={game.opponent?.logo} className="h-4 w-4 shrink-0 object-contain opacity-85" />
        )}
        <span className="truncate text-[12px] font-medium text-slate-700">
          {game.opponent?.shortName || game.opponent?.name?.split(' ').pop() || 'Opponent'}
        </span>
        {align === 'right' ? (
          <TeamLogo logo={game.opponent?.logo} className="h-4 w-4 shrink-0 object-contain opacity-85" />
        ) : null}
      </div>

      <div className="text-[11px] font-mono tabular-nums text-slate-800">{scoreText}</div>

      <div className="flex justify-end">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-semibold ${
            result === 'W'
              ? 'bg-emerald-50 text-emerald-700'
              : result === 'L'
                ? 'bg-rose-50 text-rose-700'
                : 'bg-slate-100 text-slate-600'
          }`}
        >
          {result}
        </span>
      </div>
    </div>
  );
};

const TeamFormColumn = ({
  label,
  teamName,
  games,
  teamColor,
  align = 'left',
}: {
  label: string;
  teamName: string;
  games: RecentGame[];
  teamColor?: string;
  align?: 'left' | 'right';
}) => {
  return (
    <section className="space-y-3">
      <div className={`flex items-center justify-between gap-3 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <div className={`${align === 'right' ? 'text-right' : 'text-left'}`}>
          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
          <div className="text-[13px] font-semibold text-slate-800">{teamName}</div>
        </div>
        <StreakDots games={games} teamColor={teamColor} />
      </div>

      {games.length > 0 ? (
        <div className="space-y-2">
          {games.slice(0, 5).map((game, index) => (
            <FormRow key={`${teamName}-${index}`} game={game} align={align} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-500">
          Awaiting final results.
        </div>
      )}
    </section>
  );
};

const RecentForm: React.FC<RecentFormProps> = ({
  homeTeam,
  awayTeam,
  homeName,
  awayName,
  homeColor,
  awayColor,
}) => {
  const awayGames = awayTeam?.last5 ?? [];
  const homeGames = homeTeam?.last5 ?? [];

  if (!homeTeam && !awayTeam) return null;

  if (awayGames.length === 0 && homeGames.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-[12px] text-slate-600">
        Recent form appears after each team has recorded final games.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
      <TeamFormColumn
        label="Away Recent"
        teamName={awayName}
        games={awayGames}
        teamColor={awayColor}
        align="left"
      />
      <TeamFormColumn
        label="Home Recent"
        teamName={homeName}
        games={homeGames}
        teamColor={homeColor}
        align="right"
      />
    </div>
  );
};

export default RecentForm;
