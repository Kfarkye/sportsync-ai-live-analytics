import React, { useMemo, memo, forwardRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { MatchRowProps as BaseMatchRowProps } from '@/types/matchList';
import TeamLogo from '../shared/TeamLogo';
import { useAppStore, type OddsLensMode } from '@/store/appStore';
import { cn } from '@/lib/essence';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { getLeagueDisplayName } from '@/constants';
import { Sport, Linescore, Match } from '@/types';
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

const PHYSICS_MOTION = { type: 'spring' as const, stiffness: 420, damping: 30 };
const ROW_HOVER_MOTION = { y: 0, scale: 1 };
const ROW_TAP_MOTION = { scale: 0.992 };
const LOGO_W = 28;

const ScoreCell = memo(({ score, isWinner, isLoser }: { score: string | number | null | undefined; isWinner: boolean; isLoser: boolean }) => (
  <span
    className={cn(
      'inline-flex items-center justify-center font-mono tabular-nums font-semibold select-none w-[34px] h-[24px] max-[390px]:w-[30px] max-[390px]:h-[22px] rounded-[7px] text-[15px] max-[390px]:text-[13px] shrink-0 border',
      isLoser ? 'text-[#9B9B91] border-[#E8E7E3] bg-[#FAFAF8]' : 'text-[#1A1A18] border-[#E8E7E3] bg-white',
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

const toTitleCase = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const compact = (value: string, maxLen = 96): string => {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
};

const trendPreviewFromMatch = (match: Match): string | null => {
  const activeTags = (match.edge_tags || []).filter((tag) => tag?.status === 'active');
  for (const tag of activeTags) {
    const payload = tag.edge_payload || {};
    const trigger = typeof payload.trigger === 'string' ? payload.trigger : '';
    if (trigger.trim().length > 0) return compact(trigger);

    const key = typeof tag.trend_key === 'string' ? toTitleCase(tag.trend_key) : '';
    const side = typeof payload.recommended_side === 'string' ? payload.recommended_side.trim().toUpperCase() : '';
    if (key && side && side !== 'PASS') return `${key}: ${side}`;
    if (key) return key;
  }

  const summary = match.ai_signals?.context_summary;
  if (typeof summary === 'string' && summary.trim().length > 0) return compact(summary);
  return null;
};

const formatProbabilityValue = (probability: number, mode: OddsLensMode): string => {
  if (!Number.isFinite(probability) || probability <= 0 || probability > 100) return '—';
  if (mode === 'AMERICAN') return probabilityToAmerican(probability);
  if (mode === 'DECIMAL') return probabilityToDecimal(probability);
  return `${Math.round(probability)}%`;
};

const formatGapValue = (value: number): string => {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
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
      <span className="inline-flex items-center justify-center h-[36px] min-w-[86px] max-[390px]:min-w-[78px] rounded-full border border-[#E8E7E3] bg-white text-[#9B9B91] px-3 font-mono font-semibold text-[12px] tabular-nums">
        —
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center h-[36px] min-w-[86px] max-[390px]:min-w-[78px] rounded-full border px-3.5 max-[390px]:px-3 tabular-nums font-mono font-semibold text-[13px] max-[390px]:text-[12px] tracking-tight transition-all duration-300',
        isFavorite
          ? 'border-[#2D8F5C]/30 text-[#2D8F5C] bg-[#2D8F5C]/8'
          : 'border-[#E8E7E3] text-[#6B6B63] bg-white'
      )}
    >
      {formatProbabilityValue(value, oddsLens)}
    </span>
  );
});
ProbabilityPill.displayName = 'ProbabilityPill';

const GapPill = memo(({ value }: { value: number | undefined }) => {
  if (value === undefined || !Number.isFinite(value)) {
    return (
      <span className="inline-flex items-center justify-center h-[36px] min-w-[86px] max-[390px]:min-w-[78px] rounded-full border border-[#E8E7E3] bg-white text-[#9B9B91] px-3 font-mono font-semibold text-[12px] tabular-nums">
        —
      </span>
    );
  }

  const abs = Math.abs(value);
  const tone =
    abs < 0.2
      ? 'border-[#E8E7E3] text-[#6B6B63] bg-white'
      : value > 0
        ? 'border-[#2D8F5C]/30 text-[#2D8F5C] bg-[#2D8F5C]/8'
        : 'border-[#C85A3A]/30 text-[#C85A3A] bg-[#C85A3A]/8';

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center h-[36px] min-w-[86px] max-[390px]:min-w-[78px] rounded-full border px-3.5 max-[390px]:px-3 tabular-nums font-mono font-semibold text-[13px] max-[390px]:text-[12px] tracking-tight transition-all duration-300',
        tone
      )}
      aria-label={`Market gap ${formatGapValue(value)}`}
      title={`Book vs prediction-market gap ${formatGapValue(value)}`}
    >
      {formatGapValue(value)}
    </span>
  );
});
GapPill.displayName = 'GapPill';

const OddsChip = memo(({ label, display, mobileHidden }: MatchRowOddPayload) => {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 select-none rounded-[6px] border border-[#E8E7E3] bg-transparent px-2 py-1',
        mobileHidden ? 'max-[390px]:hidden' : undefined
      )}
      aria-label={`${label} ${display}`}
    >
      <span className="font-semibold uppercase text-[8px] tracking-[0.14em] text-[#9B9B91]" aria-hidden="true">
        {label}
      </span>
      <span className="font-mono font-semibold tabular-nums text-[11px] text-[#6B6B63]">
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
        ? 'opacity-100 scale-105'
        : 'opacity-45 group-hover:opacity-100 hover:opacity-100'
    )}
    aria-label={isPinned ? 'Unpin game' : 'Pin game'}
    title={isPinned ? 'Unpin game' : 'Pin game'}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className={cn('shrink-0 transition-colors', isPinned ? 'text-[#C85A3A]' : 'text-[#9B9B91]')}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  </button>
));
PinButton.displayName = 'PinButton';

// Tennis Set Scores
const TennisSetScores: React.FC<{ linescores?: Linescore[] | undefined }> = memo(({ linescores }) => {
  if (!linescores || linescores.length === 0) return <span className="text-[11px] text-[#9B9B91] font-mono tracking-widest">-</span>;

  return (
    <div className="flex items-center gap-[6px] font-mono text-[11px] tabular-nums leading-none">
      {linescores.map((ls, idx) => (
        <div
          key={idx}
          className={cn(
            'relative flex items-center justify-center w-5 h-5 rounded-[2px] transition-colors duration-300 select-none',
            ls.winner
              ? 'bg-[#FAFAF8] text-[#1A1A18] font-bold border border-[#E8E7E3]'
              : 'text-[#9B9B91] bg-transparent'
          )}
        >
          {ls.value ?? '-'}
          {ls.tiebreak && (
            <span className="absolute -top-[3px] -right-[4px] text-[8px] font-medium text-[#9B9B91] scale-75 origin-top-right">
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
  const prefersReducedMotion = useReducedMotion();
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
  const shouldShowGapRail = !isTennis && hasEdgeInsights;
  const shouldShowProbabilities = !isTennis && !shouldShowGapRail && (homeProb !== undefined || awayProb !== undefined);
  const probabilityRailLabel = shouldShowGapRail
    ? 'Book vs PM Gap'
    : oddsLens === 'IMPLIED'
      ? 'PM Probability'
      : 'PM Fair Price';
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
    (typeof drawProbFromOdds === 'number' && drawProbFromOdds > 0 && drawProbFromOdds <= 100)
      ? drawProbFromOdds
      : (typeof drawProbFromResidual === 'number' && drawProbFromResidual > 0.1 && drawProbFromResidual < 99.9 ? drawProbFromResidual : undefined);
  const showSoccerTieRow = match.sport === Sport.SOCCER && (drawPriceLabel !== null || drawProb !== undefined);
  const trendPreview = useMemo(() => trendPreviewFromMatch(match), [match]);

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
  const topAccentColor = isLive ? '#C85A3A' : isFinal ? '#9B9B91' : '#9B9B91';
  const handleSelect = () => onSelect?.(match);
  const railPrimaryLabel = isLive ? liveClock : isFinal ? dateStr : startTimeStr;
  const railSecondaryLabel = isLive ? (liveMeta || 'In Play') : isFinal ? '' : dateStr;

  return (
    <motion.div
      ref={ref}
      layout
      initial={false}
      transition={prefersReducedMotion ? { duration: 0 } : PHYSICS_MOTION}
      whileHover={prefersReducedMotion ? undefined : ROW_HOVER_MOTION}
      whileTap={prefersReducedMotion ? undefined : ROW_TAP_MOTION}
      onClick={handleSelect}
      role="button"
      tabIndex={0}
      aria-label={`${match.awayTeam?.name || 'Away Team'} vs ${match.homeTeam?.name || 'Home Team'}`}
      onKeyDown={(e: React.KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); handleSelect(); } }}
      className={cn(
        'group relative overflow-hidden px-3 py-3 sm:px-4 sm:py-4 max-[390px]:px-2.5 max-[390px]:py-2.5 cursor-pointer transform-gpu [-webkit-tap-highlight-color:transparent]',
        'focus-visible:ring-2 focus-visible:ring-[#BFDBFE] focus-visible:outline-none focus-visible:ring-inset',
        'transition-colors duration-200 active:scale-[0.992]',
        'border border-[#E8E7E3] bg-white rounded-[8px] shadow-none',
        isSelected
          ? 'border-[#D4D3CD] bg-[#FDFCFA]'
          : 'hover:border-[#E8E7E3] hover:bg-[#FDFCFA]'
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px]" style={{ background: `linear-gradient(90deg, transparent, ${topAccentColor}, transparent)` }} />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between gap-2 pb-2.5">
        <div className="min-w-0 flex items-center gap-2">
          {isLive ? (
            <>
              <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center shrink-0">
                <motion.span
                  className="absolute inline-flex h-2.5 w-2.5 rounded-full bg-[#C85A3A]/35"
                  animate={prefersReducedMotion ? { opacity: 1, scale: 1 } : { opacity: [1, 0.25, 1], scale: [1, 1.22, 1] }}
                  transition={prefersReducedMotion ? { duration: 0 } : { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#C85A3A]" />
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] font-bold text-[#C85A3A]">Live</span>
            </>
          ) : isFinal ? (
            <span className="inline-flex items-center rounded-md border border-[#E8E7E3] bg-white px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#9B9B91]">
              Final
            </span>
          ) : (
            <>
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] font-medium text-[#9B9B91]">Scheduled</span>
            </>
          )}

          <span className="sm:hidden text-[9px] font-medium uppercase tracking-[0.08em] text-[#9B9B91] truncate max-w-[140px]">
            {leagueDisplayName}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <PinButton isPinned={isPinned} onToggle={onTogglePin} />
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#E8E7E3] bg-white text-[#9B9B91] group-hover:text-[#1A1A18] group-hover:border-[#D4D3CD] transition-colors">
              <ChevronRight size={13} />
            </span>
        </div>
      </div>

      {/* Mobile sub-meta */}
      <div className="relative z-10 sm:hidden mb-2.5 flex items-center gap-1.5 text-[10px]">
        <span className="font-mono font-semibold tabular-nums text-[#1A1A18]" suppressHydrationWarning>{railPrimaryLabel}</span>
        {railSecondaryLabel ? (
          <>
            <span className="text-[#9B9B91]">·</span>
            <span className="font-medium text-[#6B6B63] uppercase tracking-[0.07em] truncate">
              {railSecondaryLabel}
            </span>
          </>
        ) : null}
      </div>

      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_90px] gap-3">
        {/* Team Data */}
        <div className="flex flex-col gap-2.5">
          <div className="hidden sm:flex items-center justify-end -mb-1">
            {shouldShowProbabilities && (
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#9B9B91]">
                {probabilityRailLabel}
              </span>
            )}
          </div>
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
            const railColor = isFav ? '#2D8F5C' : '#C85A3A';
            const displayEdge = typeof edge === 'number' ? `${edge > 0 ? '+' : ''}${edge.toFixed(1)}%` : null;
            const teamRing = team.color ? `#${String(team.color).replace(/^#/, '')}` : '#E8E7E3';

            return (
              <div key={team.id || idx} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-3 max-[390px]:gap-2">
                    <div
                      className="shrink-0 flex items-center justify-center rounded-full bg-white border shadow-none"
                      style={{
                        width: LOGO_W + 8,
                        height: LOGO_W + 8,
                        borderColor: `${teamRing}66`,
                        boxShadow: `0 5px 12px -10px rgba(16,34,58,0.45), inset 0 0 0 1px ${teamRing}22`
                      }}
                      aria-hidden="true"
                    >
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
                        isLoser ? 'text-[#9B9B91] font-medium' : 'text-[#1A1A18] font-semibold'
                      )}>
                        {team.name}
                      </span>
                      {team.record && !isLive && (
                        <span className="text-[10px] font-mono font-medium text-[#9B9B91] tabular-nums shrink-0 hidden sm:inline">
                          {team.record}
                        </span>
                      )}
                      {displayEdge && !shouldShowGapRail && (
                        <span className={cn(
                          'hidden sm:inline-flex items-center rounded-full px-1.5 py-[1px] text-[9px] font-mono font-semibold tabular-nums',
                          typeof edge === 'number' && edge >= 0 ? 'bg-[#2D8F5C]/8 text-[#2D8F5C] border border-[#2D8F5C]/25' : 'bg-[#C85A3A]/8 text-[#C85A3A] border border-[#C85A3A]/25'
                        )}>
                          Edge {displayEdge}
                        </span>
                      )}
                    </div>
                  </div>

                  {hasProbability && (
                    <div className="pl-[44px] pt-1.5 pr-1.5 max-[390px]:pl-[40px]">
                      <div className="h-[3px] rounded-full bg-[#E8E7E3] overflow-hidden">
                        <span className="block h-full rounded-full transition-all duration-500" style={{ width: trackWidth, backgroundColor: railColor }} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {showScores && (
                    <div className={cn('shrink-0 flex items-center justify-end', isTennis ? 'w-auto' : 'w-[34px] max-[390px]:w-[30px]')}>
                      {isTennis ? (
                        <TennisSetScores linescores={team.linescores} />
                      ) : (
                        <ScoreCell score={score} isWinner={isWinner} isLoser={isLoser} />
                      )}
                    </div>
                  )}

                  {shouldShowGapRail ? (
                    <GapPill value={typeof edge === 'number' ? edge : undefined} />
                  ) : shouldShowProbabilities ? (
                    <ProbabilityPill
                      value={prob}
                      isFavorite={isFav}
                      oddsLens={oddsLens}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}

          {showSoccerTieRow && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-3 max-[390px]:gap-2">
                  <span
                    className="shrink-0 inline-flex items-center justify-center rounded-full bg-white border border-[#E8E7E3] shadow-none"
                    style={{ width: LOGO_W + 8, height: LOGO_W + 8 }}
                    aria-hidden="true"
                  >
                    <span className="h-4 w-4 rounded-full border border-[#9CA9BF] bg-[linear-gradient(90deg,#9CA9BF_0%,#9CA9BF_50%,#F8FAFF_50%,#F8FAFF_100%)]" />
                  </span>

                  <div className="min-w-0 flex items-baseline gap-2">
                    <span className="text-[15px] max-[390px]:text-[14px] leading-[1.15] tracking-tight truncate font-semibold text-[#1A1A18]">
                      Tie
                    </span>
                  </div>
                </div>

                {typeof drawProb === 'number' && !shouldShowGapRail && (
                  <div className="pl-[44px] pt-1.5 pr-1.5 max-[390px]:pl-[40px]">
                    <div className="h-[3px] rounded-full bg-[#E8E7E3] overflow-hidden">
                      <span className="block h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(8, Math.min(100, Math.round(drawProb)))}%`, backgroundColor: '#9B9B91' }} />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {shouldShowGapRail ? (
                  <GapPill value={undefined} />
                ) : (
                  <ProbabilityPill
                    value={drawProb}
                    isFavorite={false}
                    oddsLens={oddsLens}
                  />
                )}
              </div>
            </div>
          )}

          {!isFinal && !isLive && trendPreview ? (
            <div className="mt-2 pt-2 border-t border-[#E8E7E3] flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center rounded-[6px] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-[#6B6B63] border border-[#E8E7E3] bg-transparent shrink-0">
                Trend
              </span>
              <span className="text-[11px] text-[#6B6B63] leading-tight truncate">
                {trendPreview}
              </span>
            </div>
          ) : null}

          {(hasOdds && !isFinal && !isLive) || hasEdgeInsights ? (
            <div className="mt-3 pt-2.5 border-t border-[#E8E7E3] flex items-center justify-between gap-3">
              <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1.5 min-w-0">
                <span className="inline-flex items-center rounded-[6px] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.14em] text-[#9B9B91] border border-[#E8E7E3] bg-transparent">
                  Markets
                </span>
                {hasOdds && !isFinal && !isLive ? oddsPayload.map((item) => (
                  <OddsChip
                    key={`${item.label}-${item.display}`}
                    label={item.label}
                    display={item.display}
                    mobileHidden={item.mobileHidden}
                  />
                )) : null}
                {typeof homeEdge === 'number' && !shouldShowGapRail && (
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-mono font-semibold tabular-nums',
                    homeEdge >= 0 ? 'bg-[#2D8F5C]/8 text-[#2D8F5C] border border-[#2D8F5C]/25' : 'bg-[#C85A3A]/8 text-[#C85A3A] border border-[#C85A3A]/25'
                  )}>
                    {match.homeTeam?.shortName || 'Home'} {homeEdge > 0 ? '+' : ''}{homeEdge.toFixed(1)}%
                  </span>
                )}
                {typeof awayEdge === 'number' && !shouldShowGapRail && (
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-mono font-semibold tabular-nums',
                    awayEdge >= 0 ? 'bg-[#2D8F5C]/8 text-[#2D8F5C] border border-[#2D8F5C]/25' : 'bg-[#C85A3A]/8 text-[#C85A3A] border border-[#C85A3A]/25'
                  )}>
                    {match.awayTeam?.shortName || 'Away'} {awayEdge > 0 ? '+' : ''}{awayEdge.toFixed(1)}%
                  </span>
                )}
              </div>

              <span className="inline-flex sm:hidden items-center gap-1 font-mono text-[9px] uppercase tracking-[0.11em] text-[#9B9B91] shrink-0">
                Open
                <ChevronRight size={10} />
              </span>
            </div>
          ) : null}
        </div>

        {/* Right meta rail */}
        <aside className="hidden sm:flex flex-col items-end justify-center gap-1 pl-3 border-l border-[#E8E7E3] min-w-[90px]">
          <span
            className={cn(
              'font-mono tabular-nums font-semibold text-[12px]',
              isLive ? 'text-[#C85A3A]' : isFinal ? 'text-[#9B9B91]' : 'text-[#1A1A18]'
            )}
            suppressHydrationWarning
          >
            {railPrimaryLabel}
          </span>
          {railSecondaryLabel ? (
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#6B6B63] text-right">
              {railSecondaryLabel}
            </span>
          ) : null}
          <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-[#9B9B91] text-right max-w-[86px] truncate">
            {leagueDisplayName}
          </span>
        </aside>
      </div>
    </motion.div>
  );
});

MatchRow.displayName = 'MatchRow';

export default MatchRow;
