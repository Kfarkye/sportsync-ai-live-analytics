import React, { useMemo, memo, forwardRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { MatchRowProps as BaseMatchRowProps } from '@/types/matchList';
import TeamLogo from '../shared/TeamLogo';
import { useAppStore, type OddsLensMode } from '@/store/appStore';
import { cn } from '@/lib/essence';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { getLeagueDisplayName } from '@/constants';
import { Sport, Linescore } from '@/types';
import { buildMatchRowOdds, type MatchRowOddPayload } from '@/lib/matchOdds';

// Extend base props with poly data + selection state
interface MatchRowProps extends BaseMatchRowProps {
  isSelected?: boolean;
  /** Polymarket probability for home team (0-100) */
  polyHomeProb?: number;
  /** Polymarket probability for away team (0-100) */
  polyAwayProb?: number;
  /** Edge value for home team (divergence %) */
  homeEdge?: number;
  /** Edge value for away team (divergence %) */
  awayEdge?: number;
}

const PHYSICS_MOTION = { type: 'spring' as const, stiffness: 360, damping: 28 };
const ROW_HOVER_MOTION = { y: -1 };
const ROW_TAP_MOTION = { scale: 0.996 };
const LOGO_W = 28;

const ScoreCell = memo(({ score, isWinner, isLoser }: { score: string | number | null | undefined; isWinner: boolean; isLoser: boolean }) => (
  <span
    className={cn(
      'inline-flex items-center justify-center font-mono tabular-nums font-semibold select-none w-[30px] h-[22px] max-[390px]:w-[26px] max-[390px]:h-[20px] rounded-[6px] text-[14px] max-[390px]:text-[13px] shrink-0 border',
      isLoser ? 'text-[#8B93A5] border-[#DCE4F2] bg-[#F8FAFF]' : 'text-[#10223A] border-[#C7D3E8] bg-white',
      isWinner ? 'font-bold' : 'font-semibold'
    )}
  >
    {score ?? '-'}
  </span>
));
ScoreCell.displayName = 'ScoreCell';

const probabilityToAmerican = (probability: number): string => {
  if (probability <= 0 || probability >= 100) return '—';
  const p = probability / 100;
  if (p >= 0.5) return String(Math.round(-(p / (1 - p)) * 100));
  return `+${Math.round(((1 - p) / p) * 100)}`;
};

const probabilityToDecimal = (probability: number): string => {
  if (probability <= 0 || probability >= 100) return '—';
  return (100 / probability).toFixed(2);
};

const parseOddsLikeNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  if (!text) return null;
  if (text === 'EVEN') return 100;
  const parsed = Number(text.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const impliedProbabilityFromOddsRaw = (value: unknown): number | undefined => {
  const parsed = parseOddsLikeNumber(value);
  if (parsed === null) return undefined;
  if (parsed > 1 && parsed < 30) return (100 / parsed);
  if (parsed === 0) return 50;
  if (parsed > 0) return (100 / (parsed + 100)) * 100;
  return (Math.abs(parsed) / (Math.abs(parsed) + 100)) * 100;
};

const formatDrawPrice = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/x$/i.test(trimmed)) return trimmed;
    const rawNum = parseOddsLikeNumber(trimmed);
    if (rawNum !== null && rawNum > 1 && rawNum < 30) return `${rawNum.toFixed(2)}x`;
    return trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1 && value < 30) return `${value.toFixed(2)}x`;
    if (value > 0) return `+${Math.round(value)}`;
    if (value < 0) return `${Math.round(value)}`;
    return 'PK';
  }
  return String(value);
};

const formatProbabilityValue = (probability: number, mode: OddsLensMode): string => {
  if (!Number.isFinite(probability) || probability <= 0 || probability > 100) return '—';
  if (mode === 'AMERICAN') return probabilityToAmerican(probability);
  if (mode === 'DECIMAL') return probabilityToDecimal(probability);
  return `${Math.round(probability)}%`;
};

const ProbabilityPill = memo(({
  value,
  isFavorite,
  oddsLens,
}: {
  value: number | undefined;
  isFavorite: boolean;
  oddsLens: OddsLensMode;
}) => {
  if (value === undefined) {
    return (
      <span className="inline-flex items-center justify-center h-[34px] min-w-[76px] rounded-full border border-[#E1E8F4] bg-white text-slate-300 px-3 font-mono font-semibold text-[12px] tabular-nums">
        —
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center h-[34px] min-w-[76px] rounded-full border px-3 tabular-nums font-mono font-semibold text-[12px] tracking-tight transition-all duration-300',
        isFavorite
          ? 'border-[#5AC9A5] text-[#0B5A45] bg-[#ECFBF4]'
          : 'border-[#CED7E7] text-slate-700 bg-white'
      )}
    >
      {formatProbabilityValue(value, oddsLens)}
    </span>
  );
});
ProbabilityPill.displayName = 'ProbabilityPill';

const OddsChip = memo(({ label, display, mobileHidden }: MatchRowOddPayload) => {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 select-none',
        mobileHidden ? 'max-[390px]:hidden' : undefined
      )}
      aria-label={`${label} ${display}`}
    >
      <span className="font-semibold uppercase text-[8.5px] tracking-widest text-slate-400" aria-hidden="true">
        {label}
      </span>
      <span className="font-mono font-medium tabular-nums text-[10px] text-slate-600">
        {display}
      </span>
    </span>
  );
});
OddsChip.displayName = 'OddsChip';

const PinButton = memo(({ isPinned, onToggle }: { isPinned: boolean; onToggle?: ((e: any) => void) | undefined }) => (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onToggle?.(e); }}
    onPointerDown={(e) => e.stopPropagation()}
    className={cn(
      'shrink-0 p-2 -m-1.5 rounded transition-all duration-200',
      isPinned
        ? 'opacity-100'
        : 'opacity-45 group-hover:opacity-100 hover:opacity-100'
    )}
    aria-label={isPinned ? 'Unpin game' : 'Pin game'}
    title={isPinned ? 'Unpin game' : 'Pin game'}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className={cn('shrink-0 transition-colors', isPinned ? 'text-amber-500' : 'text-slate-400')}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  </button>
));
PinButton.displayName = 'PinButton';

// Tennis Set Scores
const TennisSetScores: React.FC<{ linescores?: Linescore[] | undefined }> = memo(({ linescores }) => {
  if (!linescores || linescores.length === 0) return <span className="text-[11px] text-slate-400 font-mono tracking-widest">-</span>;

  return (
    <div className="flex items-center gap-[6px] font-mono text-[11px] tabular-nums leading-none">
      {linescores.map((ls, idx) => (
        <div
          key={idx}
          className={cn(
            'relative flex items-center justify-center w-5 h-5 rounded-[2px] transition-colors duration-300 select-none',
            ls.winner
              ? 'bg-slate-100 text-slate-900 font-bold border border-slate-200'
              : 'text-slate-400 bg-transparent'
          )}
        >
          {ls.value ?? '-'}
          {ls.tiebreak && (
            <span className="absolute -top-[3px] -right-[4px] text-[8px] font-medium text-slate-400 scale-75 origin-top-right">
              {ls.tiebreak}
            </span>
          )}
        </div>
      ))}
    </div>
  );
});
TennisSetScores.displayName = 'TennisSetScores';

const MatchRow = forwardRef<HTMLDivElement, MatchRowProps>(({ 
  match,
  isPinned = false,
  isLive = false,
  isFinal = false,
  isSelected = false,
  polyHomeProb,
  polyAwayProb,
  homeEdge,
  awayEdge,
  onSelect,
  onTogglePin,
}, ref) => {
  const showScores = isLive || isFinal;
  const isTennis = match.sport === Sport.TENNIS;
  const oddsLens = useAppStore((state) => state.oddsLens);
  const leagueDisplayName = useMemo(() => getLeagueDisplayName(match.leagueId || ''), [match.leagueId]);

  // Priority: Polymarket (real money) > ESPN (model estimate)
  const homeProbRaw = polyHomeProb ?? match.win_probability?.home;
  const awayProbRaw = polyAwayProb ?? match.win_probability?.away;
  const homeProb = typeof homeProbRaw === 'number' && homeProbRaw > 0 && homeProbRaw <= 100 ? homeProbRaw : undefined;
  const awayProb = typeof awayProbRaw === 'number' && awayProbRaw > 0 && awayProbRaw <= 100 ? awayProbRaw : undefined;
  const homeFav = typeof homeProb === 'number' && typeof awayProb === 'number' ? homeProb > awayProb : false;
  const spread = match.odds?.homeSpread ?? match.odds?.spread ?? match.odds?.spread_home;
  const total = match.odds?.overUnder ?? match.odds?.total;
  const homeML = match.odds?.moneylineHome ?? match.odds?.homeML ?? match.odds?.homeWin ?? match.odds?.home_ml;
  const oddsPayload = useMemo(
    () => buildMatchRowOdds(spread, total, homeML, oddsLens, { maxMobileChips: 2, dedupeByValue: true }),
    [spread, total, homeML, oddsLens]
  );
  const hasOdds = oddsPayload.length > 0;
  const hasEdgeInsights = typeof homeEdge === 'number' || typeof awayEdge === 'number';
  const shouldShowProbabilities = !isTennis && (homeProb !== undefined || awayProb !== undefined);
  const drawRawOdds =
    match.odds?.draw ??
    match.odds?.drawWin ??
    match.odds?.drawML ??
    match.odds?.draw_ml ??
    match.odds?.draw_moneyline ??
    match.odds?.moneylineDraw;
  const drawPriceLabel = formatDrawPrice(drawRawOdds);
  const drawProbFromResidual = typeof homeProb === 'number' && typeof awayProb === 'number'
    ? Math.max(0, Math.min(100, 100 - (homeProb + awayProb)))
    : undefined;
  const drawProbFromOdds = impliedProbabilityFromOddsRaw(drawRawOdds);
  const drawProb =
    (typeof drawProbFromResidual === 'number' && drawProbFromResidual > 0.1 && drawProbFromResidual < 99.9)
      ? drawProbFromResidual
      : (typeof drawProbFromOdds === 'number' && drawProbFromOdds > 0 && drawProbFromOdds <= 100 ? drawProbFromOdds : undefined);
  const showSoccerTieRow = match.sport === Sport.SOCCER && (drawPriceLabel !== null || drawProb !== undefined);

  const { startTimeStr, dateStr, roundStr } = useMemo(() => {
    const d = new Date(match.startTime);
    return {
      startTimeStr: d
        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      dateStr: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      roundStr: match.round
        ? match.round.replace('Qualifying ', 'Q').replace('Round of ', 'R').replace('Round ', 'R')
        : null
    };
  }, [match.startTime, match.round]);

  const liveClock = match.displayClock || match.minute || 'LIVE';
  const liveMeta = isTennis && roundStr ? roundStr : getPeriodDisplay(match);
  const topAccentColor = isLive ? '#E11D48' : isFinal ? '#7C879A' : '#1D9E75';
  const handleSelect = () => onSelect?.(match);

  return (
    <motion.div
      ref={ref}
      layout
      initial={false}
      transition={PHYSICS_MOTION}
      whileHover={ROW_HOVER_MOTION}
      whileTap={ROW_TAP_MOTION}
      onClick={handleSelect}
      role="button"
      tabIndex={0}
      aria-label={`${match.awayTeam?.name || 'Away Team'} vs ${match.homeTeam?.name || 'Home Team'}`}
      onKeyDown={(e: React.KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); handleSelect(); } }}
      className={cn(
        'group relative overflow-hidden px-3.5 py-3.5 sm:px-4 sm:py-4 cursor-pointer transform-gpu [-webkit-tap-highlight-color:transparent]',
        'focus-visible:ring-2 focus-visible:ring-[#BFDBFE] focus-visible:outline-none focus-visible:ring-inset',
        'transition-all duration-300',
        'border border-[#D4DEEF] bg-[linear-gradient(180deg,#FFFFFF_0%,#F6F9FF_100%)] shadow-[0_16px_30px_-24px_rgba(16,34,58,0.38),inset_0_1px_0_rgba(255,255,255,0.95)] rounded-2xl',
        isSelected
          ? 'border-[#9ED8C5] bg-[linear-gradient(180deg,#F8FFFB_0%,#F1F9FF_100%)] shadow-[0_18px_34px_-24px_rgba(29,158,117,0.36),inset_0_1px_0_rgba(255,255,255,0.95)]'
          : 'hover:border-[#B7C8E4] hover:bg-[linear-gradient(180deg,#FFFFFF_0%,#F3F8FF_100%)]'
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${topAccentColor}, transparent)` }} />
      <div className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(11,99,246,0.12)_0%,rgba(11,99,246,0)_72%)]" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between gap-2 pb-3">
        <div className="min-w-0 flex items-center gap-2">
          {isLive ? (
            <>
              <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center shrink-0">
                <motion.span
                  className="absolute inline-flex h-2.5 w-2.5 rounded-full bg-rose-500/35"
                  animate={{ opacity: [1, 0.35, 1], scale: [1, 1.12, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-600" />
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] font-bold text-rose-600">Live</span>
              <span className="font-mono text-[11px] tabular-nums text-[#10223A] font-semibold">{liveClock}</span>
              {liveMeta ? (
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 truncate">{liveMeta}</span>
              ) : null}
            </>
          ) : isFinal ? (
            <span className="inline-flex items-center rounded-md border border-slate-300/90 bg-slate-100/85 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600">
              Final
            </span>
          ) : (
            <>
              <span className="font-mono text-[13px] tabular-nums font-semibold text-[#10223A]" suppressHydrationWarning>{startTimeStr}</span>
              <span className="text-[10px] font-medium text-slate-500" suppressHydrationWarning>{dateStr}</span>
              {isTennis && roundStr ? (
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400 truncate">{roundStr}</span>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="hidden sm:inline text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500 max-w-[130px] truncate">
            {leagueDisplayName}
          </span>
          <PinButton isPinned={isPinned} onToggle={onTogglePin} />
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#D8E2F2] bg-white text-slate-400 group-hover:text-[#10223A] group-hover:border-[#BFD0EA] transition-colors">
            <ChevronRight size={13} />
          </span>
        </div>
      </div>

      {/* Team Data */}
      <div className="relative z-10 flex flex-col gap-2.5">
        {[match.awayTeam, match.homeTeam].map((team, idx) => {
          // Guard against malformed API payloads where one team is null
          if (!team) return null;

          const isHome = idx === 1;
          const score = isHome ? match.homeScore : match.awayScore;
          const otherScore = isHome ? match.awayScore : match.homeScore;

          // Math-safe: coerce to Number to prevent string comparison bugs ("10" < "9")
          const numScore = Number(score);
          const numOther = Number(otherScore);
          const hasScores = score != null && otherScore != null && !isNaN(numScore) && !isNaN(numOther);
          const isWinner = isFinal && hasScores && numScore > numOther;
          const isLoser = isFinal && hasScores && numScore < numOther;

          const prob = isHome ? homeProb : awayProb;
          const isFav = isHome ? homeFav : !homeFav;
          const edge = isHome ? homeEdge : awayEdge;
          const hasProbability = typeof prob === 'number' && prob > 0 && prob <= 100;
          const trackWidth = hasProbability ? `${Math.max(8, Math.min(100, Math.round(prob)))}%` : '0%';
          const railColor = isFav ? '#1D9E75' : '#98A4B8';
          const displayEdge = typeof edge === 'number' ? `${edge > 0 ? '+' : ''}${edge.toFixed(1)}%` : null;

          return (
            <div key={team.id || idx} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-3 max-[390px]:gap-2.5">
                  <div className="shrink-0 flex items-center justify-center rounded-full bg-white border border-[#D8E2F2] shadow-[0_5px_12px_-10px_rgba(16,34,58,0.45)]" style={{ width: LOGO_W + 8, height: LOGO_W + 8 }} aria-hidden="true">
                    {isTennis && team.flag ? (
                      <div className="w-[18px] h-[13px] overflow-hidden rounded-[1px]">
                        <img src={team.flag} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <TeamLogo
                        logo={team.logo}
                        name={team.name}
                        teamColor={team.color}
                        className="w-[24px] h-[24px] object-contain relative z-10 transition-transform duration-300 group-hover:scale-110"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex items-baseline gap-2">
                    <span className={cn(
                      'text-[15px] max-[390px]:text-[14px] leading-[1.15] tracking-tight truncate transition-colors duration-300 select-none',
                      isLoser ? 'text-[#7B869B] font-medium' : 'text-[#10223A] font-semibold'
                    )}>
                      {team.name}
                    </span>
                    {team.record && !isLive && (
                      <span className="text-[10px] font-mono font-medium text-slate-400 tabular-nums shrink-0 hidden sm:inline">
                        {team.record}
                      </span>
                    )}
                    {displayEdge && (
                      <span className={cn(
                        'hidden sm:inline-flex items-center rounded-full px-1.5 py-[1px] text-[9px] font-mono font-semibold tabular-nums',
                        typeof edge === 'number' && edge >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                      )}>
                        Edge {displayEdge}
                      </span>
                    )}
                  </div>
                </div>

                {hasProbability && (
                  <div className="pl-[46px] pt-1.5 pr-1.5">
                    <div className="h-[3px] rounded-full bg-[#E3E9F4] overflow-hidden">
                      <span className="block h-full rounded-full transition-all duration-500" style={{ width: trackWidth, backgroundColor: railColor }} />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {showScores && (
                  <div className={cn('shrink-0 flex items-center justify-end', isTennis ? 'w-auto' : 'w-[32px] max-[390px]:w-[26px]')}>
                    {isTennis ? (
                      <TennisSetScores linescores={team.linescores} />
                    ) : (
                      <ScoreCell score={score} isWinner={isWinner} isLoser={isLoser} />
                    )}
                  </div>
                )}

                {shouldShowProbabilities && (
                  <ProbabilityPill
                    value={prob}
                    isFavorite={isFav}
                    oddsLens={oddsLens}
                  />
                )}
              </div>
            </div>
          );
        })}

        {showSoccerTieRow && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-3 max-[390px]:gap-2.5">
                <span
                  className="shrink-0 inline-flex items-center justify-center rounded-full bg-white border border-[#D8E2F2] shadow-[0_5px_12px_-10px_rgba(16,34,58,0.45)]"
                  style={{ width: LOGO_W + 8, height: LOGO_W + 8 }}
                  aria-hidden="true"
                >
                  <span className="h-4 w-4 rounded-full border border-[#9CA9BF] bg-[linear-gradient(90deg,#9CA9BF_0%,#9CA9BF_50%,#F8FAFF_50%,#F8FAFF_100%)]" />
                </span>

                <div className="min-w-0 flex items-baseline gap-2">
                  <span className="text-[15px] max-[390px]:text-[14px] leading-[1.15] tracking-tight truncate font-semibold text-[#10223A]">
                    Tie
                  </span>
                  {drawPriceLabel && (
                    <span className="text-[10px] font-mono font-medium text-slate-500 tabular-nums">
                      {drawPriceLabel}
                    </span>
                  )}
                </div>
              </div>

              {typeof drawProb === 'number' && (
                <div className="pl-[46px] pt-1.5 pr-1.5">
                  <div className="h-[3px] rounded-full bg-[#E3E9F4] overflow-hidden">
                    <span className="block h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(8, Math.min(100, Math.round(drawProb)))}%`, backgroundColor: '#98A4B8' }} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <ProbabilityPill
                value={drawProb}
                isFavorite={false}
                oddsLens={oddsLens}
              />
            </div>
          </div>
        )}
      </div>

      {(hasOdds && !isFinal && !isLive) || hasEdgeInsights ? (
        <div className="relative z-10 mt-3 pt-2.5 border-t border-[#E4EAF5] flex items-center justify-between gap-3">
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 min-w-0">
            {hasOdds && !isFinal && !isLive ? oddsPayload.map((item) => (
              <OddsChip
                key={`${item.label}-${item.display}`}
                label={item.label}
                display={item.display}
                mobileHidden={item.mobileHidden}
              />
            )) : null}
            {typeof homeEdge === 'number' && (
              <span className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-mono font-semibold tabular-nums',
                homeEdge >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
              )}>
                {match.homeTeam?.shortName || 'Home'} {homeEdge > 0 ? '+' : ''}{homeEdge.toFixed(1)}%
              </span>
            )}
            {typeof awayEdge === 'number' && (
              <span className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-mono font-semibold tabular-nums',
                awayEdge >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
              )}>
                {match.awayTeam?.shortName || 'Away'} {awayEdge > 0 ? '+' : ''}{awayEdge.toFixed(1)}%
              </span>
            )}
          </div>

          <span className="hidden sm:inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.11em] text-slate-500 shrink-0">
            Open Match
            <ChevronRight size={11} />
          </span>
        </div>
      ) : null}
    </motion.div>
  );
});

MatchRow.displayName = 'MatchRow';

export default MatchRow;
