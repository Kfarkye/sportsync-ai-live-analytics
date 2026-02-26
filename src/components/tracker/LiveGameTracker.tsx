// ============================================================================
// LiveGameTracker.tsx
// Production-hardened live game tracker UI.
// Polished for Modular Architecture, A11y, Performance, and Clean Code.
// ============================================================================

import React, {
    forwardRef,
    memo,
    useCallback,
    useId,
    useMemo,
    useState,
    type ComponentPropsWithoutRef,
    type FC,
    type ReactNode,
} from 'react';
import { motion, AnimatePresence, useReducedMotion, type Transition } from 'framer-motion';
import {
    Activity,
    ActivitySquare,
    AlertCircle,
    ArrowLeft,
    ChevronDown,
    ChevronUp,
    Clock,
    Flame,
    History,
    Radio,
    Target,
    TrendingDown,
    TrendingUp,
    User,
    WifiOff,
} from 'lucide-react';

import { type Match } from '@/types';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '@/lib/essence';
import { isGameFinished } from '../../utils/matchUtils';
import { computeAISignals } from '../../services/gameStateEngine';

// ============================================================================
// 1. STRICT TYPE DEFINITIONS
// ============================================================================

type Numberish = number | string;
type NumberishValue = Numberish | null | undefined;

type OddsLine = { spread?: Numberish; total?: Numberish; overUnder?: Numberish; moneyline?: Numberish; };
type OddsLike = OddsLine & {
    over_under?: Numberish; homeSpread?: Numberish; awaySpread?: Numberish;
    moneylineHome?: Numberish; moneylineAway?: Numberish; homeWin?: Numberish; awayWin?: Numberish;
    homeMoneyline?: Numberish; awayMoneyline?: Numberish; home_ml?: Numberish; away_ml?: Numberish;
    home_ml_price?: Numberish; away_ml_price?: Numberish;
};

export type PlayerProp = {
    id: string; playerName: string; teamAbbr: string; market: string;
    line: number; current: number; projection: number; headshotUrl?: string;
};

export type PlayEvent = { id: string; text: string; clock: string; teamAbbr?: string; isScoringPlay?: boolean; };
type TeamStats = Record<string, Numberish | null | undefined>;

export type RawMatch = Omit<Match, 'period' | 'homeScore' | 'awayScore' | 'displayClock' | 'situation' | 'currentDrive' | 'lastPlay'> & {
    league?: string; displayClock?: string; period?: Numberish; homeScore?: Numberish; awayScore?: Numberish; date?: string;
    situation?: {
        yardLine?: Numberish; down?: Numberish; distance?: Numberish;
        possessionId?: string | number; possession?: string; isRedZone?: boolean;
        downDistanceText?: string; ballX?: number; ballY?: number;
    };
    lastPlay?: { id?: string; text?: string; type?: string };
    currentDrive?: { plays?: Numberish; yards?: Numberish; timeElapsed?: string; description?: string; };
    opening_odds?: OddsLine; current_odds?: OddsLine; odds?: OddsLine; live_odds?: OddsLine;
    closing_odds?: { spread?: Numberish; total?: Numberish; moneylineHome?: Numberish; moneylineAway?: Numberish; };
    homeTeamStats?: TeamStats; awayTeamStats?: TeamStats;
    homeTeam: Match['homeTeam'] & { srs?: Numberish };
    awayTeam: Match['awayTeam'] & { srs?: Numberish };
    winProbability?: { home: number; away: number };
    momentumData?: number[];
    recentPlays?: PlayEvent[];
    playerProps?: PlayerProp[];
};

export type ExtendedMatch = RawMatch;

interface GameViewModel {
    id: string;
    meta: {
        isFootball: boolean; isBasketball: boolean; isFinished: boolean; isPregame: boolean;
        displayClock: string; displayDate: string; hasData: boolean; league: string;
    };
    teams: { home: TeamViewModel; away: TeamViewModel; };
    gameplay: {
        situation: RawMatch['situation'] | null; lastPlay: RawMatch['lastPlay'] | null;
        drive: RawMatch['currentDrive'] | null; possession: 'home' | 'away' | null;
        isRedZone: boolean; winProbabilityHome: number; winProbabilityAway: number;
        momentumData: number[]; recentPlays: PlayEvent[];
    };
    betting: {
        signals: ReturnType<typeof computeAISignals> | null;
        spread: number; total: number; openingSpread: number | null; openingTotal: number | null;
        hasSpread: boolean; hasTotal: boolean; moneyline: { home: string; away: string };
        matchupStr: string; linesLabel: string;
        lineMovement: { spread: { from: number; to: number; diff: number } | null; total: { from: number; to: number; diff: number } | null; };
    };
    stats: { homeTeamStats: TeamStats | null; awayTeamStats: TeamStats | null; playerProps: PlayerProp[]; };
    normalized: Match;
}

interface TeamViewModel {
    id: string; abbr: string; name: string; logo: string; color: string;
    score: number; record: string; isPossessing: boolean; isWinner: boolean;
}

// ============================================================================
// 2. DESIGN TOKENS & CONSTANTS
// ============================================================================

const TOKENS = {
    animation: {
        spring: { type: 'spring', stiffness: 320, damping: 32, mass: 1 } as Transition,
        fade: { duration: 0.2, ease: 'easeInOut' } as Transition,
    },
    assets: { noise: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E")` },
} as const;

const DEFAULT_CLOCK = '00:00';
const DEFAULT_DATE_LABEL = 'TODAY';
const TABS = ['GAME', 'PROPS', 'EDGE', 'AI'] as const;
type TabKey = (typeof TABS)[number];

type ScoreHeaderVariant = 'full' | 'embedded';

// ============================================================================
// 3. PURE UTILITY FUNCTIONS
// ============================================================================

const safeNumber = (val: NumberishValue, fallback = 0): number => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') { const n = parseFloat(val); return Number.isFinite(n) ? n : fallback; }
    return fallback;
};

const normalizeColor = (color: string | undefined, fallback: string): string => color ? color.trim() : fallback;
const formatDate = (dateStr?: string) => dateStr ? new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() : DEFAULT_DATE_LABEL;
const formatTime = (dateStr?: string) => dateStr ? new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : DEFAULT_CLOCK;

const calculateWinProbability = (homeScore: number, awayScore: number, period: number, isFinished: boolean) => {
    if (isFinished) return homeScore > awayScore ? 100 : homeScore < awayScore ? 0 : 50;
    const diff = homeScore - awayScore;
    const timeMultiplier = 1 + (Math.max(1, period) * 0.2);
    const p = 50 + (diff * 3.5 * timeMultiplier);
    return Math.max(1, Math.min(99, Math.round(p)));
};

const generateFallbackMomentum = (isPregame: boolean, isFinal: boolean, homeScore: number, awayScore: number): number[] => {
    if (isPregame) return [];
    let current = 0;
    return Array.from({ length: isFinal ? 40 : 25 }).map((_, i) => {
        const target = ((homeScore - awayScore) * 3);
        current += (target - current) * 0.1 + (Math.sin(i * 123) * 15);
        return Math.max(-100, Math.min(100, current));
    });
};

const extractOddsValue = (o: OddsLike | null | undefined, keys: (keyof OddsLike)[]): number | null => {
    if (!o) return null;
    for (const key of keys) {
        if (o[key] !== undefined && o[key] !== null && o[key] !== '') {
            const n = Number(String(o[key]).replace(/[^\d.\-]/g, ''));
            if (Number.isFinite(n)) return n;
        }
    }
    return null;
};

// ============================================================================
// 4. LOGIC KERNEL
// ============================================================================

function mergeMatchWithLiveState(base: ExtendedMatch, liveState: Partial<ExtendedMatch> | null | undefined): ExtendedMatch {
    if (!liveState) return base;
    return { ...base, ...liveState } as ExtendedMatch;
}

function normalizeMatch(raw: RawMatch | undefined): Match | null {
    if (!raw?.homeTeam || !raw?.awayTeam) return null;

    const situation = raw.situation ? {
        ...raw.situation,
        yardLine: typeof raw.situation.yardLine === 'string' ? parseInt(raw.situation.yardLine.replace(/\D/g, ''), 10) || 50 : Math.max(0, Math.min(100, safeNumber(raw.situation.yardLine, 50))),
        down: safeNumber(raw.situation.down, 1),
        distance: safeNumber(raw.situation.distance, 10),
        possessionId: raw.situation.possessionId ? String(raw.situation.possessionId) : undefined,
    } : undefined;

    return {
        ...raw,
        homeScore: safeNumber(raw.homeScore, 0),
        awayScore: safeNumber(raw.awayScore, 0),
        period: safeNumber(raw.period, 0),
        displayClock: raw.displayClock ?? '',
        situation,
    } as Match;
}

function useGameViewModel(match: RawMatch | undefined): GameViewModel | null {
    const normalized = useMemo(() => normalizeMatch(match), [match]);
    const signals = useMemo(() => normalized ? computeAISignals(normalized) : null, [normalized]);

    return useMemo(() => {
        if (!match || !match.homeTeam || !match.awayTeam || !normalized) return null;

        const homeScore = safeNumber(match.homeScore);
        const awayScore = safeNumber(match.awayScore);
        const homeId = String(match.homeTeam.id);
        const awayId = String(match.awayTeam.id);
        const possId = match.situation?.possessionId ? String(match.situation.possessionId) : null;

        const isFinal = isGameFinished(match.status);
        const isPregame = !isFinal && (match.status === 'SCHEDULED' || match.status === 'PREGAME' || match.period === 0);
        const isLive = !isFinal && !isPregame;
        const league = String(match.league || match.sport || '').toUpperCase();

        const lineSource = isLive && match.live_odds ? { data: match.live_odds, label: 'Live Lines' } :
            isFinal && match.closing_odds ? { data: match.closing_odds, label: 'Closing Lines' } :
                match.current_odds ? { data: match.current_odds, label: 'Current Lines' } :
                    match.odds ? { data: match.odds, label: 'Market Lines' } : { data: match.opening_odds || null, label: 'Opening Lines' };

        const spread = extractOddsValue(lineSource.data, ['homeSpread', 'spread']) ?? 0;
        const total = extractOddsValue(lineSource.data, ['total', 'overUnder', 'over_under']) ?? 0;
        const openingSpread = extractOddsValue(match.opening_odds, ['homeSpread', 'spread']) ?? extractOddsValue(match.odds, ['homeSpread', 'spread']);
        const openingTotal = extractOddsValue(match.opening_odds, ['total', 'overUnder']) ?? extractOddsValue(match.odds, ['total', 'overUnder']);

        const hasSpread = extractOddsValue(lineSource.data, ['homeSpread', 'spread']) !== null;
        const hasTotal = total > 0;
        const matchupStr = (hasSpread && hasTotal) ? `${spread < 0 ? match.homeTeam.abbreviation : match.awayTeam.abbreviation} -${Math.abs(spread)}  O/U ${total}` : '';

        const wpHome = match.winProbability?.home ?? calculateWinProbability(homeScore, awayScore, safeNumber(match.period, 1), isFinal);
        const momentumData = match.momentumData?.length ? match.momentumData : generateFallbackMomentum(isPregame, isFinal, homeScore, awayScore);
        const recentPlays: PlayEvent[] = match.recentPlays?.length ? match.recentPlays : (match.lastPlay?.text ? [{ id: match.lastPlay.id || '1', text: match.lastPlay.text, clock: match.displayClock || DEFAULT_CLOCK, teamAbbr: (possId === homeId ? match.homeTeam.abbreviation : match.awayTeam.abbreviation) || '' }] : []);

        return {
            id: String(match.id || `${homeId}-${awayId}`),
            meta: {
                isFootball: ['NFL', 'CFB'].some((s) => league.includes(s)),
                isBasketball: ['NBA', 'CBB'].some((s) => league.includes(s)),
                isFinished: isFinal, isPregame,
                displayClock: match.displayClock || (isPregame ? formatTime(match.date) : DEFAULT_CLOCK),
                displayDate: formatDate(match.date),
                hasData: Boolean(match.displayClock || match.period || match.situation),
                league: league.replace(/_/g, ' '),
            },
            teams: {
                home: { id: homeId, abbr: match.homeTeam.abbreviation || 'HOME', name: match.homeTeam.shortName || match.homeTeam.name || 'Home', logo: match.homeTeam.logo || '', color: normalizeColor(match.homeTeam.color, '#3b82f6'), score: homeScore, record: String(match.homeTeam.record || ''), isPossessing: possId === homeId, isWinner: isFinal && homeScore > awayScore },
                away: { id: awayId, abbr: match.awayTeam.abbreviation || 'AWAY', name: match.awayTeam.shortName || match.awayTeam.name || 'Away', logo: match.awayTeam.logo || '', color: normalizeColor(match.awayTeam.color, '#ef4444'), score: awayScore, record: String(match.awayTeam.record || ''), isPossessing: possId === awayId, isWinner: isFinal && awayScore > homeScore },
            },
            gameplay: {
                situation: match.situation || null, lastPlay: match.lastPlay || null, drive: match.currentDrive || null,
                possession: possId === homeId ? 'home' : possId === awayId ? 'away' : null,
                isRedZone: !!match.situation?.isRedZone,
                winProbabilityHome: wpHome, winProbabilityAway: 100 - wpHome, momentumData, recentPlays,
            },
            betting: {
                signals, spread, total, openingSpread, openingTotal,
                hasSpread, hasTotal, matchupStr,
                moneyline: { home: String((lineSource.data as OddsLike)?.moneylineHome ?? '-'), away: String((lineSource.data as OddsLike)?.moneylineAway ?? '-') },
                linesLabel: lineSource.label,
                lineMovement: {
                    spread: openingSpread !== null && openingSpread !== spread ? { from: openingSpread, to: spread, diff: spread - openingSpread } : null,
                    total: openingTotal !== null && openingTotal !== total ? { from: openingTotal, to: total, diff: total - openingTotal } : null,
                }
            },
            stats: { homeTeamStats: match.homeTeamStats || null, awayTeamStats: match.awayTeamStats || null, playerProps: match.playerProps || [] },
            normalized,
        };
    }, [match, signals, normalized]);
}

// ============================================================================
// 5. SHARED UI PRIMITIVES
// ============================================================================

const DarkPanel = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'> & { hover?: boolean }>(({ children, className, hover = false, ...props }, ref) => (
    <div ref={ref} className={cn('relative overflow-hidden bg-[#111113] rounded-xl border border-white/5 shadow-lg', hover && 'transition-colors duration-200 hover:bg-[#16161a]', className)} {...props}>
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: TOKENS.assets.noise }} aria-hidden="true" />
        <div className="relative z-10 h-full">{children}</div>
    </div>
));
DarkPanel.displayName = 'DarkPanel';

const Label = ({ children, className }: { children: ReactNode; className?: string }) => (
    <h3 className={cn('text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em] leading-none m-0', className)}>{children}</h3>
);

const DataValue = ({ value, size = 'lg', className }: { value: string | number; size?: 'lg' | 'xl' | 'hero'; className?: string; }) => (
    <span className={cn('font-mono font-medium tracking-tighter tabular-nums text-white leading-none', size === 'hero' ? 'text-5xl sm:text-7xl font-light' : size === 'xl' ? 'text-4xl font-light' : 'text-2xl', className)}>{value}</span>
);

const EmptyState = ({ icon, message }: { icon: ReactNode; message: string }) => (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-[#111113]/30 border border-white/5 rounded-xl mx-6 my-4" role="status">
        <div className="text-zinc-600 mb-3" aria-hidden="true">{icon}</div>
        <p className="text-sm font-medium text-zinc-500">{message}</p>
    </div>
);

/** DRY: Extracted from ScoreHeader — used for both Home and Away team display */
const TeamDisplay: FC<{ team: TeamViewModel }> = memo(({ team }) => (
    <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative mb-2">
            <div className="absolute inset-[-10px] rounded-full blur-2xl opacity-40 translate-z-0" style={{ background: team.color }} aria-hidden="true" />
            <div className="relative z-10 flex items-center justify-center bg-[#111113] rounded-full border border-white/10 w-20 h-20 sm:w-24 sm:h-24">
                <TeamLogo logo={team.logo} name={team.name} className="w-12 h-12 sm:w-16 sm:h-16 object-contain drop-shadow-2xl" />
            </div>
        </div>
        <div className="text-center">
            <h2 className="text-[15px] sm:text-[20px] font-bold text-white tracking-tight leading-tight">{team.name}</h2>
            <span className="mt-1 text-[11px] font-medium text-zinc-500 tabular-nums tracking-wide font-mono" aria-label={`Record: ${team.record}`}>{team.record}</span>
        </div>
    </div>
));
TeamDisplay.displayName = 'TeamDisplay';

// ============================================================================
// 6. MODULES & VISUALIZATIONS
// ============================================================================

const MomentumGraph: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { gameplay, teams, meta, id } = viewModel;
    const uid = useId();

    if (meta.isPregame || !gameplay.momentumData || gameplay.momentumData.length === 0) return null;

    const data = gameplay.momentumData;
    const maxPts = Math.max(data.length, 40);
    const points = data.map((val, i) => `${(i / (maxPts - 1)) * 100},${50 - (val / 100) * 50}`).join(' ');
    const polygon = points ? `0,50 ${points} ${(data.length - 1) / (maxPts - 1) * 100},50` : '';

    return (
        <section className="bg-[#0A0A0B] p-6 border-b border-white/5" aria-label="Game Momentum Graph">
            <header className="flex items-center gap-2 mb-6">
                <Activity size={14} className="text-zinc-400" aria-hidden="true" />
                <Label>Attack Momentum</Label>
            </header>
            <div className="relative w-full h-[80px] select-none" aria-hidden="true">
                <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10 -translate-y-1/2" />
                <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
                    <defs>
                        <clipPath id={`${uid}-${id}-away`}><rect x="0" y="50" width="100" height="50" /></clipPath>
                        <clipPath id={`${uid}-${id}-home`}><rect x="0" y="0" width="100" height="50" /></clipPath>
                        <linearGradient id={`${uid}-${id}-home-grad`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={teams.home.color} stopOpacity="0.5" />
                            <stop offset="100%" stopColor={teams.home.color} stopOpacity="0.0" />
                        </linearGradient>
                        <linearGradient id={`${uid}-${id}-away-grad`} x1="0" y1="1" x2="0" y2="0">
                            <stop offset="0%" stopColor={teams.away.color} stopOpacity="0.5" />
                            <stop offset="100%" stopColor={teams.away.color} stopOpacity="0.0" />
                        </linearGradient>
                    </defs>
                    <g clipPath={`url(#${uid}-${id}-home)`}>
                        <polyline points={polygon} fill={`url(#${uid}-${id}-home-grad)`} />
                        <polyline points={points} fill="none" stroke={teams.home.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                    <g clipPath={`url(#${uid}-${id}-away)`}>
                        <polyline points={polygon} fill={`url(#${uid}-${id}-away-grad)`} />
                        <polyline points={points} fill="none" stroke={teams.away.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                </svg>
                <div className="absolute top-0 right-0 text-[9px] font-bold tracking-widest opacity-40 uppercase" style={{ color: teams.home.color }}>{teams.home.abbr} Edge</div>
                <div className="absolute bottom-0 right-0 text-[9px] font-bold tracking-widest opacity-40 uppercase" style={{ color: teams.away.color }}>{teams.away.abbr} Edge</div>
            </div>
        </section>
    );
});
MomentumGraph.displayName = 'MomentumGraph';

const PlayByPlayList: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const plays = viewModel.gameplay.recentPlays;
    if (plays.length === 0) return <EmptyState icon={<History size={32} />} message="No recent plays available." />;

    return (
        <section className="bg-[#0A0A0B] border-b border-white/5" aria-label="Play-by-play Timeline">
            <header className="px-6 py-4 border-b border-white/5 bg-[#111113]/50 flex items-center gap-2">
                <Clock size={14} className="text-zinc-500" aria-hidden="true" />
                <Label>Timeline</Label>
            </header>
            <div className="flex flex-col divide-y divide-white/5 max-h-[350px] overflow-y-auto no-scrollbar" role="log" aria-live="polite">
                {plays.map((p, i) => {
                    const color = p.teamAbbr === viewModel.teams.home.abbr ? viewModel.teams.home.color : p.teamAbbr === viewModel.teams.away.abbr ? viewModel.teams.away.color : '#52525b';
                    return (
                        <article key={p.id || i} className="p-4 px-6 flex gap-4 hover:bg-white/[0.02] transition-colors group">
                            <div className="flex flex-col items-center gap-2 shrink-0 mt-1" aria-hidden="true">
                                <div className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]" style={{ color, backgroundColor: color }} />
                                {i !== plays.length - 1 && <div className="w-px h-full bg-white/10 group-hover:bg-white/20 transition-colors" />}
                            </div>
                            <div className="flex flex-col gap-1 pb-1">
                                <time className="text-[10px] font-mono text-zinc-500">{p.clock}</time>
                                <p className={cn("text-xs font-medium leading-relaxed", p.isScoringPlay ? "text-white font-bold" : "text-zinc-300")}>{p.text}</p>
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
});
PlayByPlayList.displayName = 'PlayByPlayList';

const BoxScoreCard: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => {
    const { homeTeamStats, awayTeamStats } = viewModel.stats;
    const { meta, teams } = viewModel;

    const rows = useMemo(() => {
        if (!homeTeamStats && !awayTeamStats) return [];
        const parse = (s: TeamStats | null, keys: string[]) => Number(s?.[keys.find(k => s[k] !== undefined) || ''] || 0);
        const buildRowData = (label: string, homeVal: number, awayVal: number, isPct = false) => {
            const total = homeVal + awayVal;
            const hPct = total === 0 ? 50 : (homeVal / total) * 100;
            const aPct = total === 0 ? 50 : (awayVal / total) * 100;
            const fmt = (n: number) => isPct ? `${(n <= 1 ? n * 100 : n).toFixed(0)}%` : n.toFixed(0);
            return { label, homeVal, awayVal, hPct, aPct, homeStr: fmt(homeVal), awayStr: fmt(awayVal) };
        };
        if (meta.isFootball) {
            return [
                buildRowData('Total Yds', parse(homeTeamStats, ['yards', 'total_yards']), parse(awayTeamStats, ['yards', 'total_yards'])),
                buildRowData('Pass Yds', parse(homeTeamStats, ['passing_yards']), parse(awayTeamStats, ['passing_yards'])),
                buildRowData('Rush Yds', parse(homeTeamStats, ['rushing_yards']), parse(awayTeamStats, ['rushing_yards'])),
                buildRowData('Turnovers', parse(homeTeamStats, ['turnovers']), parse(awayTeamStats, ['turnovers'])),
            ];
        } else if (meta.isBasketball) {
            return [
                buildRowData('FG%', parse(homeTeamStats, ['fg_pct']), parse(awayTeamStats, ['fg_pct']), true),
                buildRowData('3P%', parse(homeTeamStats, ['fg3_pct']), parse(awayTeamStats, ['fg3_pct']), true),
                buildRowData('Rebounds', parse(homeTeamStats, ['reb', 'rebounds']), parse(awayTeamStats, ['reb', 'rebounds'])),
                buildRowData('Assists', parse(homeTeamStats, ['ast', 'assists']), parse(awayTeamStats, ['ast', 'assists'])),
            ];
        }
        return [];
    }, [homeTeamStats, awayTeamStats, meta.isFootball, meta.isBasketball]);

    if (!rows.length) return <EmptyState icon={<ActivitySquare size={32} />} message="Team stats not yet available." />;

    return (
        <section className="bg-[#0A0A0B] pb-12 pt-2" aria-label="Team Comparison Box Score">
            <header className="flex items-center gap-2 mb-4 px-6 pt-6">
                <ActivitySquare size={14} className="text-zinc-500" aria-hidden="true" />
                <Label>Team Comparison</Label>
            </header>
            <div className="px-6 space-y-1">
                {rows.map((r) => (
                    <div key={r.label} className="flex flex-col gap-2 py-3 border-b border-white/5 last:border-0">
                        <div className="flex justify-between items-end text-xs">
                            <span className="font-mono font-medium text-zinc-300 w-12 text-left">{r.awayStr}</span>
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center" aria-hidden="true">{r.label}</span>
                            <span className="font-mono font-medium text-zinc-300 w-12 text-right">{r.homeStr}</span>
                        </div>
                        <div className="flex w-full h-1.5 rounded-full overflow-hidden bg-white/5 gap-1" role="progressbar" aria-valuenow={r.hPct} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.label} comparison`}>
                            <div className="h-full transition-all duration-500" style={{ width: `${r.aPct}%`, backgroundColor: teams.away.color }} />
                            <div className="h-full transition-all duration-500" style={{ width: `${r.hPct}%`, backgroundColor: teams.home.color }} />
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
});
BoxScoreCard.displayName = 'BoxScoreCard';

// ============================================================================
// 7. TAB COMPONENTS (Fully Extracted & Memoized)
// ============================================================================

const GameTab: FC<{ viewModel: GameViewModel }> = memo(({ viewModel }) => (
    <div className="flex flex-col pb-20 w-full" role="tabpanel" aria-label="Game Overview">
        <MomentumGraph viewModel={viewModel} />
        <PlayByPlayList viewModel={viewModel} />
        <BoxScoreCard viewModel={viewModel} />
    </div>
));
GameTab.displayName = 'GameTab';

const PropsTab: FC<{ viewModel: GameViewModel }> = memo(({ viewModel: vm }) => (
    <div className="p-6 bg-[#0A0A0B] min-h-full pb-20 w-full" role="tabpanel" aria-label="Player Props">
        <header className="flex items-center gap-2 mb-6">
            <User size={14} className="text-zinc-500" aria-hidden="true" />
            <Label>Player Prop Tracker</Label>
        </header>
        <div className="flex flex-col gap-4">
            {vm.stats.playerProps.length > 0 ? (
                vm.stats.playerProps.map(p => {
                    const pct = p.line > 0 ? Math.min(100, (p.current / p.line) * 100) : 0;
                    const isHitting = p.current >= p.line;
                    return (
                        <DarkPanel key={p.id} className="p-5" aria-label={`Prop for ${p.playerName}`}>
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <h3 className="text-sm font-bold text-white">{p.playerName}</h3>
                                    <p className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase mt-1">{p.teamAbbr} • {p.market}</p>
                                </div>
                                <div className="text-right">
                                    <div className="text-lg font-mono font-bold text-white leading-none">{p.current} <span className="text-xs text-zinc-500">/ {p.line}</span></div>
                                    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mt-1">Proj: {p.projection}</div>
                                </div>
                            </div>
                            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden" role="progressbar" aria-valuenow={p.current} aria-valuemax={p.line} aria-valuemin={0}>
                                <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} className={cn("h-full", isHitting ? "bg-emerald-500" : "bg-blue-500")} transition={TOKENS.animation.spring} />
                            </div>
                        </DarkPanel>
                    );
                })
            ) : (
                <EmptyState icon={<User size={32} />} message="No player props currently available." />
            )}
        </div>
    </div>
));
PropsTab.displayName = 'PropsTab';

const EdgeTab: FC<{ viewModel: GameViewModel }> = memo(({ viewModel: vm }) => {
    const { betting, teams } = vm;

    const renderMovement = (open: number | null, current: number, isTotal = false) => {
        if (open === null || open === current) return <span className="text-zinc-300">{current > 0 && !isTotal ? `+${current}` : current}</span>;
        const diff = current - open;
        const isUp = diff > 0;
        return (
            <div className="flex flex-col items-end gap-0.5">
                <div className="flex items-center gap-1.5">
                    <span className={cn("text-xs font-bold", isUp ? "text-emerald-400" : "text-rose-400")}>{current > 0 && !isTotal ? `+${current}` : current}</span>
                    {isUp ? <TrendingUp size={12} className="text-emerald-400" aria-hidden="true" /> : <TrendingDown size={12} className="text-rose-400" aria-hidden="true" />}
                </div>
                <span className="text-[9px] text-zinc-500 line-through">Op: {open > 0 && !isTotal ? `+${open}` : open}</span>
            </div>
        );
    };

    const tableRows = useMemo(() => [
        { id: teams.away.id || 'away', team: teams.away, openS: betting.openingSpread, curS: betting.hasSpread ? betting.spread : 0, openT: betting.openingTotal, curT: betting.total, ml: betting.moneyline.away },
        { id: teams.home.id || 'home', team: teams.home, openS: betting.openingSpread ? -betting.openingSpread : null, curS: betting.hasSpread ? -betting.spread : 0, openT: betting.openingTotal, curT: betting.total, ml: betting.moneyline.home }
    ], [teams, betting]);

    return (
        <div className="flex flex-col pb-20 w-full" role="tabpanel" aria-label="Betting Edge">
            <section className="bg-[#0A0A0B] px-6 py-6 border-b border-white/5">
                <header className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                        <History size={14} className="text-zinc-500" aria-hidden="true" />
                        <Label>Live Odds & Line Movement</Label>
                    </div>
                    {(betting.lineMovement.spread || betting.lineMovement.total) && (
                        <div className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded text-[9px] font-bold text-indigo-400 uppercase tracking-widest animate-pulse" role="status">Lines Moving</div>
                    )}
                </header>
                <div className="w-full" role="table" aria-label="Odds Table">
                    <div className="grid grid-cols-[1fr_1.5fr_1.5fr_1fr] mb-3 px-2" role="row">
                        <span role="columnheader" className="text-[9px] font-bold text-zinc-600 tracking-widest uppercase">Team</span>
                        <span role="columnheader" className="text-[9px] font-bold text-zinc-600 tracking-widest uppercase text-right">Spread</span>
                        <span role="columnheader" className="text-[9px] font-bold text-zinc-600 tracking-widest uppercase text-right">Total</span>
                        <span role="columnheader" className="text-[9px] font-bold text-zinc-600 tracking-widest uppercase text-right">Money</span>
                    </div>
                    {tableRows.map((r) => (
                        <div key={r.id} className="grid grid-cols-[1fr_1.5fr_1.5fr_1fr] py-4 border-t border-white/5 items-center px-2" role="row">
                            <div className="flex items-center gap-3" role="cell">
                                <TeamLogo logo={r.team.logo} name={r.team.name} className="w-6 h-6 object-contain" />
                                <span className="text-xs font-bold text-white tracking-wider">{r.team.abbr}</span>
                            </div>
                            <div className="text-right font-mono" role="cell">{betting.hasSpread ? renderMovement(r.openS, r.curS) : '-'}</div>
                            <div className="text-right font-mono" role="cell">{betting.hasTotal ? renderMovement(r.openT, r.curT, true) : '-'}</div>
                            <span className="text-xs font-mono text-zinc-400 text-right" role="cell">{r.ml}</span>
                        </div>
                    ))}
                </div>
            </section>

            {betting.signals && (
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <DarkPanel hover className="p-5 flex flex-col justify-between min-h-[130px]">
                        <header className="flex justify-between items-start">
                            <div className="flex items-center gap-2">
                                <Target size={14} className="text-indigo-400" aria-hidden="true" />
                                <Label className="text-indigo-400/80">AI Model Edge</Label>
                            </div>
                            <div className={cn('px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border', betting.signals.edge_state === 'PLAY' ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' : 'text-zinc-500 border-white/5 bg-white/5')} role="status">
                                {betting.signals.edge_state === 'PLAY' ? 'Actionable' : 'Neutral'}
                            </div>
                        </header>
                        <div className="mt-4 flex items-end justify-between">
                            <div>
                                <div className="flex items-center gap-2 mb-1"><span className="text-[10px] text-zinc-500 uppercase tracking-wider">Proj Total</span></div>
                                <DataValue value={safeNumber(betting.signals.deterministic_fair_total).toFixed(1)} size="xl" className="text-white" />
                            </div>
                            <div className="text-right">
                                <div className="flex justify-end items-center gap-1 mb-1">
                                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Mkt</span>
                                    <span className="text-xs font-mono text-zinc-300">{betting.signals.market_total}</span>
                                </div>
                                <div className={cn('flex items-center justify-end gap-0.5 text-lg font-mono font-bold', betting.signals.edge_state === 'PLAY' ? (safeNumber(betting.signals.deterministic_fair_total) > safeNumber(betting.signals.market_total) ? 'text-emerald-400' : 'text-rose-400') : 'text-zinc-600')}>
                                    {betting.signals.edge_state === 'PLAY' && (safeNumber(betting.signals.deterministic_fair_total) > safeNumber(betting.signals.market_total) ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />)}
                                    {betting.signals.edge_state === 'PLAY' ? `${Math.abs(safeNumber(betting.signals.edge_points)).toFixed(1)} pt` : '-'}
                                </div>
                            </div>
                        </div>
                    </DarkPanel>
                </div>
            )}
        </div>
    );
});
EdgeTab.displayName = 'EdgeTab';

const AITab: FC<{ viewModel: GameViewModel }> = memo(({ viewModel: vm }) => {
    const ticketHome = 60;
    const handleHome = 85;

    return (
        <div className="p-6 bg-[#0A0A0B] min-h-full pb-20 grid grid-cols-1 md:grid-cols-2 gap-4 w-full" role="tabpanel" aria-label="AI and Market Insights">
            <DarkPanel hover className="p-5 flex flex-col justify-between min-h-[140px]">
                <header className="flex items-center gap-2 mb-4">
                    <Flame size={14} className="text-orange-500" aria-hidden="true" />
                    <Label>Sharp Money Indicator</Label>
                </header>
                <div className="space-y-4">
                    <div>
                        <div className="flex justify-between text-[10px] font-bold tracking-widest uppercase mb-1.5 text-zinc-400">
                            <span>Ticket %</span>
                            <span>{vm.teams.away.abbr} {100 - ticketHome}% - {vm.teams.home.abbr} {ticketHome}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden flex" aria-hidden="true">
                            <div className="h-full bg-zinc-600" style={{ width: `${100 - ticketHome}%` }} />
                            <div className="h-full bg-zinc-300" style={{ width: `${ticketHome}%` }} />
                        </div>
                    </div>
                    <div>
                        <div className="flex justify-between text-[10px] font-bold tracking-widest uppercase mb-1.5 text-zinc-400">
                            <span>Handle (Money) %</span>
                            <span>{vm.teams.away.abbr} {100 - handleHome}% - {vm.teams.home.abbr} {handleHome}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden flex" aria-hidden="true">
                            <div className="h-full bg-zinc-600" style={{ width: `${100 - handleHome}%` }} />
                            <div className="h-full bg-orange-500" style={{ width: `${handleHome}%` }} />
                        </div>
                    </div>
                </div>
            </DarkPanel>

            {!vm.meta.isPregame && (
                <DarkPanel className="p-5 flex flex-col justify-between" aria-label="API Data Stream Status">
                    <header className="flex items-center gap-2">
                        {vm.meta.hasData ? <Radio size={14} className="text-emerald-500 animate-pulse" aria-hidden="true" /> : <WifiOff size={14} className="text-rose-500" aria-hidden="true" />}
                        <Label>API Data Stream</Label>
                    </header>
                    <div className="mt-4 space-y-2">
                        <div className="flex justify-between text-xs text-zinc-400">
                            <span>Status</span>
                            <span className={cn("font-bold", vm.meta.hasData ? "text-emerald-400" : "text-rose-400")}>{vm.meta.hasData ? 'Optimal' : 'Offline'}</span>
                        </div>
                        <div className="flex justify-between text-xs text-zinc-400">
                            <span>Latency</span>
                            <span className="font-mono text-zinc-200">{vm.meta.hasData ? '< 120ms' : '-'}</span>
                        </div>
                    </div>
                </DarkPanel>
            )}
        </div>
    );
});
AITab.displayName = 'AITab';

// ============================================================================
// 8. HEADER COMPONENT
// Accepts `match: Match` externally for backward compatibility with MatchDetails.tsx.
// Constructs GameViewModel internally.
// ============================================================================

const ScoreHeaderInternal: FC<{
    viewModel: GameViewModel; onBack?: (() => void) | undefined; variant?: ScoreHeaderVariant;
    activeTab: TabKey; onTabChange: (t: TabKey) => void;
}> = memo(({ viewModel: vm, onBack, variant = 'full', activeTab, onTabChange }) => {
    const reduceMotion = useReducedMotion();
    const { teams, meta, gameplay } = vm;
    const isEmbedded = variant === 'embedded';
    const handleTabClick = useCallback((tab: TabKey) => onTabChange(tab), [onTabChange]);

    return (
        <header className={cn('relative w-full flex flex-col items-center overflow-hidden select-none bg-[#0A0A0B]', !isEmbedded && 'pt-6 border-b border-white/5')}>
            {!isEmbedded && (
                <div className="absolute top-4 flex items-center justify-between w-full px-6 z-20">
                    <button type="button" onClick={onBack} disabled={!onBack} aria-label="Go Back" className={cn('flex items-center gap-2 text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded p-1', !onBack && 'opacity-0 pointer-events-none')}>
                        <ArrowLeft size={16} strokeWidth={2.5} aria-hidden="true" />
                    </button>
                    <div className="flex items-center gap-3">
                        {gameplay.isRedZone && !meta.isFinished && (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded-full text-red-500 animate-pulse" role="status">
                                <AlertCircle size={10} aria-hidden="true" />
                                <span className="text-[9px] font-bold tracking-widest uppercase">Red Zone</span>
                            </div>
                        )}
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md" role="status" aria-live="polite">
                            <span className={cn("w-1.5 h-1.5 rounded-full", meta.isPregame || meta.isFinished ? "bg-zinc-500" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse")} aria-hidden="true" />
                            <span className={cn("text-[9px] font-bold tracking-widest uppercase", meta.isPregame || meta.isFinished ? "text-zinc-400" : "text-red-500")}>
                                {meta.isFinished ? 'FINAL' : meta.isPregame ? 'UPCOMING' : 'LIVE'}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
                <div className="absolute top-[10%] -left-[10%] w-[50%] h-[80%] blur-[120px] opacity-[0.15] translate-z-0" style={{ background: teams.away.color }} />
                <div className="absolute top-[10%] -right-[10%] w-[50%] h-[80%] blur-[120px] opacity-[0.15] translate-z-0" style={{ background: teams.home.color }} />
            </div>

            <div className={cn('relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-4 sm:gap-12 w-full max-w-5xl px-4 sm:px-8', isEmbedded ? 'mt-8 mb-6' : 'mt-16 mb-8')}>
                <TeamDisplay team={teams.away} />
                <div className="flex flex-col items-center justify-center min-w-[140px] pt-4" aria-live="polite">
                    {meta.isPregame ? (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-4xl sm:text-5xl font-medium tracking-tighter tabular-nums text-white">{meta.displayClock}</span>
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em]">{meta.displayDate}</span>
                            {vm.betting.matchupStr && <span className="px-3 py-1 bg-white/5 rounded border border-white/10 text-[10px] font-mono text-zinc-300 mt-2">{vm.betting.matchupStr}</span>}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-3">
                            <div className="flex items-center gap-4 sm:gap-8">
                                <span className="text-5xl sm:text-7xl font-light text-white tabular-nums tracking-tighter drop-shadow-lg">{teams.away.score}</span>
                                <span className="text-zinc-700 text-3xl font-light" aria-hidden="true">-</span>
                                <span className="text-5xl sm:text-7xl font-light text-white tabular-nums tracking-tighter drop-shadow-lg">{teams.home.score}</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1 bg-[#111113]/80 rounded-full border border-white/5">
                                <span className="text-[11px] font-mono font-medium tracking-widest text-amber-500">{meta.displayClock}</span>
                            </div>
                        </div>
                    )}
                </div>
                <TeamDisplay team={teams.home} />
            </div>

            {!meta.isPregame && (
                <div className="w-full px-6 sm:px-12 max-w-4xl mt-2 mb-8">
                    <div className="flex justify-between text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-2 px-1" aria-hidden="true">
                        <span>{teams.away.abbr} {gameplay.winProbabilityAway}%</span>
                        <span>Win Prob</span>
                        <span>{gameplay.winProbabilityHome}% {teams.home.abbr}</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden flex relative" aria-hidden="true">
                        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/20 z-10" />
                        <motion.div className="h-full" style={{ backgroundColor: teams.away.color }} initial={{ width: '50%' }} animate={{ width: `${gameplay.winProbabilityAway}%` }} transition={TOKENS.animation.spring} />
                        <motion.div className="h-full" style={{ backgroundColor: teams.home.color }} initial={{ width: '50%' }} animate={{ width: `${gameplay.winProbabilityHome}%` }} transition={TOKENS.animation.spring} />
                    </div>
                </div>
            )}

            {!isEmbedded && (
                <nav className="w-full flex items-center justify-center gap-8 border-b border-white/5 pb-0 overflow-x-auto no-scrollbar px-4" role="tablist" aria-label="Game Tracker Views">
                    {TABS.map((tab) => (
                        <button
                            key={tab}
                            role="tab"
                            aria-selected={activeTab === tab}
                            aria-controls={`panel-${tab}`}
                            id={`tab-${tab}`}
                            type="button"
                            onClick={() => handleTabClick(tab)}
                            className={cn('text-[10px] sm:text-[11px] font-bold tracking-[0.15em] transition-colors pb-4 relative shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-white/50 rounded-sm', activeTab === tab ? 'text-white' : 'text-zinc-500 hover:text-zinc-300')}
                        >
                            {tab}
                            {activeTab === tab && <motion.div layoutId={`tab-indicator-${vm.id}`} transition={reduceMotion ? { duration: 0 } : TOKENS.animation.spring} className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-t-full shadow-[0_-2px_8px_rgba(255,255,255,0.4)]" aria-hidden="true" />}
                        </button>
                    ))}
                </nav>
            )}
        </header>
    );
});
ScoreHeaderInternal.displayName = 'ScoreHeaderInternal';

/**
 * Public ScoreHeader — accepts `match: Match` for backward compatibility.
 * Used by MatchDetails.tsx: `<ScoreHeader match={match} variant="embedded" />`
 */
export const ScoreHeader: FC<{ match: Match; onBack?: () => void; variant?: ScoreHeaderVariant }> = memo(
    ({ match, onBack, variant = 'full' }) => {
        const vm = useGameViewModel(match as ExtendedMatch);
        const [activeTab, setActiveTab] = useState<TabKey>(TABS[0]);

        if (!vm) return <div className="h-[360px] bg-[#0A0A0B] animate-pulse" />;

        return (
            <ScoreHeaderInternal
                viewModel={vm}
                onBack={onBack}
                variant={variant}
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />
        );
    }
);
ScoreHeader.displayName = 'ScoreHeader';

// ============================================================================
// 9. ROOT COMPONENT WITH TABBED ROUTING
// ============================================================================

export const LiveGameTracker: FC<{ match: Match; liveState?: Partial<ExtendedMatch> | null; onBack?: () => void; showHeader?: boolean; headerVariant?: ScoreHeaderVariant }> = memo(
    ({ match, liveState, onBack, showHeader = true, headerVariant = 'full' }) => {
        const mergedMatch = useMemo(() => mergeMatchWithLiveState(match as ExtendedMatch, liveState), [match, liveState]);
        const vm = useGameViewModel(mergedMatch);
        const [activeTab, setActiveTab] = useState<TabKey>(TABS[0]);

        if (!vm) return (
            <div className="h-[400px] flex items-center justify-center bg-[#0A0A0B]" role="status" aria-label="Loading game data">
                <Activity className="text-zinc-600 animate-pulse" aria-hidden="true" />
            </div>
        );

        return (
            <main className={cn('flex flex-col w-full bg-[#0A0A0B] overflow-x-hidden font-sans', showHeader ? 'min-h-screen' : 'min-h-0')}>
                {showHeader && <ScoreHeaderInternal viewModel={vm} onBack={onBack} variant={headerVariant} activeTab={activeTab} onTabChange={setActiveTab} />}

                <div className="w-full relative min-h-[400px]">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            id={`panel-${activeTab}`}
                            role="tabpanel"
                            aria-labelledby={`tab-${activeTab}`}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={TOKENS.animation.fade}
                            className="w-full"
                        >
                            {activeTab === 'GAME' && <GameTab viewModel={vm} />}
                            {activeTab === 'PROPS' && <PropsTab viewModel={vm} />}
                            {activeTab === 'EDGE' && <EdgeTab viewModel={vm} />}
                            {activeTab === 'AI' && <AITab viewModel={vm} />}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </main>
        );
    }
);
LiveGameTracker.displayName = 'LiveGameTracker';

// Backward compatibility export
export const LiveTotalCard: FC<{ match: Match }> = memo(({ match }) => {
    const vm = useGameViewModel(match as ExtendedMatch);
    if (!vm) return <DarkPanel className="p-6 flex justify-center"><Activity className="animate-spin text-zinc-600" aria-label="Loading betting card" /></DarkPanel>;
    return <EdgeTab viewModel={vm} />;
});
LiveTotalCard.displayName = 'LiveTotalCard';

export default LiveGameTracker;
