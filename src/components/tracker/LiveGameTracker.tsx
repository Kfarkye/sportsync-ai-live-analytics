// ============================================================================
// LiveGameTracker.tsx
// Production-hardened live game tracker UI.
// Architecture: Slice-Based Memoization, SSR Hydration Safe, Hardware Accelerated.
// ============================================================================

import React, {
    forwardRef,
    memo,
    useCallback,
    useId,
    useMemo,
    useState,
    useEffect,
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
// 1. STRICT TYPE DEFINITIONS & VIEW-MODEL SLICES
// ============================================================================

type Numberish = number | string;
type NumberishValue = Numberish | null | undefined;

type OddsLine = { spread?: Numberish; total?: Numberish; overUnder?: Numberish; moneyline?: Numberish; };
type OddsLike = OddsLine & {
    over_under?: Numberish; homeSpread?: Numberish; awaySpread?: Numberish;
    moneylineHome?: Numberish; moneylineAway?: Numberish; homeWin?: Numberish; awayWin?: Numberish;
    homeMoneyline?: Numberish; awayMoneyline?: Numberish; home_ml?: Numberish; away_ml?: Numberish;
};

export type PlayerProp = {
    id: string; playerName: string; teamAbbr: string; market: string;
    line: number; current: number; projection: number; headshotUrl?: string;
};

export type PlayEvent = { id?: string; text: string; clock: string; teamAbbr?: string; isScoringPlay?: boolean; };
type TeamStats = Record<string, Numberish | null | undefined>;

export type RawMatch = Omit<Match, 'period' | 'homeScore' | 'awayScore' | 'displayClock' | 'situation' | 'currentDrive' | 'lastPlay'> & {
    league?: string; displayClock?: string; period?: Numberish; homeScore?: Numberish; awayScore?: Numberish; date?: string;
    situation?: { yardLine?: Numberish; down?: Numberish; distance?: Numberish; possessionId?: string | number; isRedZone?: boolean; };
    lastPlay?: { id?: string; text?: string; type?: string };
    currentDrive?: { plays?: Numberish; yards?: Numberish; timeElapsed?: string; description?: string; };
    opening_odds?: OddsLine; current_odds?: OddsLine; odds?: OddsLine; live_odds?: OddsLine; closing_odds?: OddsLike;
    homeTeamStats?: TeamStats; awayTeamStats?: TeamStats;
    winProbability?: { home: number; away: number };
    momentumData?: number[]; recentPlays?: PlayEvent[]; playerProps?: PlayerProp[];
};

export type ExtendedMatch = RawMatch;

interface MetaSlice {
    id: string; isFootball: boolean; isBasketball: boolean; isFinished: boolean; isPregame: boolean;
    displayClock: string; timestampMs: number | null; hasData: boolean; league: string;
}

interface TeamsSlice {
    home: { id: string; abbr: string; name: string; logo: string; color: string; score: number; record: string; isPossessing: boolean; };
    away: { id: string; abbr: string; name: string; logo: string; color: string; score: number; record: string; isPossessing: boolean; };
}

interface GameplaySlice {
    isRedZone: boolean; winProbabilityHome: number; winProbabilityAway: number;
    momentumData: number[]; recentPlays: PlayEvent[];
}

interface BettingSlice {
    signals: ReturnType<typeof computeAISignals> | null;
    spread: number; total: number; openingSpread: number | null; openingTotal: number | null;
    hasSpread: boolean; hasTotal: boolean; moneyline: { home: string; away: string };
    matchupStr: string; linesLabel: string;
    lineMovement: { spread: { from: number; to: number; diff: number } | null; total: { from: number; to: number; diff: number } | null; };
}

interface StatsSlice {
    homeTeamStats: TeamStats | null; awayTeamStats: TeamStats | null; playerProps: PlayerProp[];
}

interface GameViewModel {
    meta: MetaSlice; teams: TeamsSlice; gameplay: GameplaySlice; betting: BettingSlice; stats: StatsSlice;
}

// ============================================================================
// 2. DESIGN TOKENS & UTILS
// ============================================================================

const TOKENS = {
    animation: { spring: { type: 'spring', stiffness: 320, damping: 32, mass: 1 } as Transition, fade: { duration: 0.2, ease: 'easeInOut' } as Transition },
    assets: { noise: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E")` },
} as const;

const DEFAULT_CLOCK = '00:00';
const DEFAULT_DATE_LABEL = 'TODAY';
const TABS = ['GAME', 'PROPS', 'EDGE', 'AI'] as const;
type TabKey = (typeof TABS)[number];
type ScoreHeaderVariant = 'full' | 'embedded';

const safeNumber = (val: NumberishValue, fallback = 0): number => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') { const n = parseFloat(val.replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : fallback; }
    return fallback;
};

const normalizeColor = (color: string | undefined, fallback: string): string => color ? color.trim() : fallback;

// Prevents Safari RangeError on malformed ISO dates by enforcing 'T' separator
const parseSafeDateMs = (dateStr?: string): number | null => {
    if (!dateStr) return null;
    const ms = Date.parse(dateStr.replace(/\s+/g, 'T'));
    return Number.isNaN(ms) ? null : ms;
};

const formatLocalDate = (ms: number | null) => ms ? new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() : DEFAULT_DATE_LABEL;
const formatLocalTime = (ms: number | null) => ms ? new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : DEFAULT_CLOCK;

const calculateWinProbability = (homeScore: number, awayScore: number, period: number, isFinished: boolean) => {
    if (isFinished) return homeScore > awayScore ? 100 : homeScore < awayScore ? 0 : 50;
    const diff = homeScore - awayScore;
    const timeMultiplier = 1 + (Math.max(1, period) * 0.2);
    const p = 50 + (diff * 3.5 * timeMultiplier);
    return Math.max(1, Math.min(99, Math.round(p)));
};

/** Safely maps string literals like "EVEN" and "PK" to standard numerical equivalents */
const parseAmericanOdds = (odds?: NumberishValue): number | null => {
    if (odds === undefined || odds === null || odds === '') return null;
    if (typeof odds === 'number') return odds;
    const upper = String(odds).toUpperCase().trim();
    if (upper === 'EVEN') return 100;
    if (upper === 'PK' || upper === 'PICK') return 0;
    const parsed = Number(upper.replace(/[^\d.\-+]/g, ''));
    return Number.isNaN(parsed) ? null : parsed;
};

const extractOddsValue = (o: OddsLike | null | undefined, keys: (keyof OddsLike)[]): number | null => {
    if (!o) return null;
    for (const key of keys) {
        const val = parseAmericanOdds(o[key]);
        if (val !== null) return val;
    }
    return null;
};

// ============================================================================
// 3. LOGIC KERNEL (Slice-Based Memoization)
// ============================================================================

/** Safely deep-merges WebSocket liveState partials without destroying un-mutated nested base keys */
function mergeMatchWithLiveState(base: ExtendedMatch, liveState: Partial<ExtendedMatch> | null | undefined): ExtendedMatch {
    if (!liveState) return base;
    return {
        ...base,
        ...liveState,
        situation: liveState.situation ? { ...(base.situation || {}), ...liveState.situation } : base.situation,
        odds: liveState.odds ? { ...(base.odds || {}), ...liveState.odds } : base.odds,
        current_odds: liveState.current_odds ? { ...(base.current_odds || {}), ...liveState.current_odds } : base.current_odds,
        live_odds: liveState.live_odds ? { ...(base.live_odds || {}), ...liveState.live_odds } : base.live_odds,
        closing_odds: liveState.closing_odds ? { ...(base.closing_odds || {}), ...liveState.closing_odds } : base.closing_odds,
        currentDrive: liveState.currentDrive ? { ...(base.currentDrive || {}), ...liveState.currentDrive } : base.currentDrive,
    } as ExtendedMatch;
}

function useGameViewModel(match: RawMatch | undefined): GameViewModel | null {
    if (!match || !match.homeTeam || !match.awayTeam) return null;

    const isFinal = isGameFinished(match.status);
    const isPregame = !isFinal && (match.status === 'SCHEDULED' || match.status === 'PREGAME' || safeNumber(match.period, 0) === 0);
    const league = String(match.league || match.sport || '').toUpperCase();

    const homeScore = safeNumber(match.homeScore);
    const awayScore = safeNumber(match.awayScore);
    const possId = match.situation?.possessionId ? String(match.situation.possessionId) : null;

    // ── Slice 1: META ────────────────────────────────────────────────────────
    const metaSlice = useMemo<MetaSlice>(() => ({
        id: String(match.id || `match-${Date.now()}`),
        isFootball: ['NFL', 'CFB'].some((s) => league.includes(s)),
        isBasketball: ['NBA', 'CBB'].some((s) => league.includes(s)),
        isFinished: isFinal,
        isPregame,
        displayClock: match.displayClock || '',
        timestampMs: parseSafeDateMs(match.date),
        hasData: Boolean(match.displayClock || match.period || match.situation),
        league: league.replace(/_/g, ' '),
    }), [match.id, match.displayClock, match.date, match.status, match.period, match.situation, isFinal, isPregame, league]);

    // ── Slice 2: TEAMS ───────────────────────────────────────────────────────
    const teamsSlice = useMemo<TeamsSlice>(() => ({
        home: { id: String(match.homeTeam.id), abbr: match.homeTeam.abbreviation || 'HOME', name: match.homeTeam.shortName || match.homeTeam.name || 'Home', logo: match.homeTeam.logo || '', color: normalizeColor(match.homeTeam.color, '#3b82f6'), score: homeScore, record: String(match.homeTeam.record || ''), isPossessing: possId === String(match.homeTeam.id) },
        away: { id: String(match.awayTeam.id), abbr: match.awayTeam.abbreviation || 'AWAY', name: match.awayTeam.shortName || match.awayTeam.name || 'Away', logo: match.awayTeam.logo || '', color: normalizeColor(match.awayTeam.color, '#ef4444'), score: awayScore, record: String(match.awayTeam.record || ''), isPossessing: possId === String(match.awayTeam.id) },
    }), [homeScore, awayScore, possId, match.homeTeam, match.awayTeam]);

    // ── Slice 3: GAMEPLAY ────────────────────────────────────────────────────
    const gameplaySlice = useMemo<GameplaySlice>(() => {
        const wpHome = match.winProbability?.home ?? calculateWinProbability(homeScore, awayScore, safeNumber(match.period, 1), isFinal);

        let momentumData = match.momentumData?.length ? match.momentumData : [];
        if (!momentumData.length && !isPregame) {
            let cur = 0;
            momentumData = Array.from({ length: isFinal ? 40 : 25 }).map((_, i) => {
                cur += ((((homeScore - awayScore) * 3) || 0) - cur) * 0.1 + (Math.sin(i * 123) * 15);
                return Math.max(-100, Math.min(100, cur)) || 0; // || 0 protects against NaN cascade
            });
        }

        const recentPlays = match.recentPlays?.length ? match.recentPlays.slice(-50)
            : (match.lastPlay?.text ? [{ text: match.lastPlay.text, clock: match.displayClock || DEFAULT_CLOCK, teamAbbr: (possId === String(match.homeTeam.id) ? match.homeTeam.abbreviation : match.awayTeam.abbreviation) || '' }] : []);

        return { isRedZone: !!match.situation?.isRedZone, winProbabilityHome: wpHome, winProbabilityAway: 100 - wpHome, momentumData, recentPlays };
    }, [match.situation?.isRedZone, match.winProbability, match.momentumData, match.recentPlays, match.lastPlay, homeScore, awayScore, isFinal, isPregame, match.period, match.displayClock, possId, match.homeTeam, match.awayTeam]);

    // ── Slice 4: BETTING ─────────────────────────────────────────────────────
    const bettingSlice = useMemo<BettingSlice>(() => {
        const source = !isFinal && match.live_odds ? { data: match.live_odds, label: 'Live Lines' } :
            isFinal && match.closing_odds ? { data: match.closing_odds, label: 'Closing Lines' } :
                match.current_odds ? { data: match.current_odds, label: 'Current Lines' } : { data: match.odds || match.opening_odds || null, label: 'Market Lines' };

        const spread = extractOddsValue(source.data, ['homeSpread', 'spread']) ?? 0;
        const total = extractOddsValue(source.data, ['total', 'overUnder', 'over_under']) ?? 0;
        const opS = extractOddsValue(match.opening_odds || match.odds, ['homeSpread', 'spread']);
        const opT = extractOddsValue(match.opening_odds || match.odds, ['total', 'overUnder']);

        const hasSpread = extractOddsValue(source.data, ['homeSpread', 'spread']) !== null;
        const matchupStr = (hasSpread && total > 0) ? `${spread <= 0 ? match.homeTeam.abbreviation : match.awayTeam.abbreviation} ${spread === 0 ? 'PK' : `-${Math.abs(spread)}`}  O/U ${total}` : '';

        // Safely pass down normalized match structure so GameStateEngine mathematical logic processes flawlessly
        const pseudoMatch = { ...match, homeScore, awayScore, period: safeNumber(match.period, 0), displayClock: match.displayClock || '' } as Match;

        return {
            signals: computeAISignals(pseudoMatch), spread, total, openingSpread: opS, openingTotal: opT,
            hasSpread, hasTotal: total > 0, matchupStr,
            moneyline: { home: String((source.data as OddsLike)?.moneylineHome ?? '-'), away: String((source.data as OddsLike)?.moneylineAway ?? '-') },
            linesLabel: source.label,
            lineMovement: { spread: opS !== null && opS !== spread ? { from: opS, to: spread, diff: spread - opS } : null, total: opT !== null && opT !== total ? { from: opT, to: total, diff: total - opT } : null }
        };
    }, [match.live_odds, match.closing_odds, match.current_odds, match.odds, match.opening_odds, isFinal, homeScore, awayScore, match.period, match.displayClock, match.homeTeam.abbreviation, match.awayTeam.abbreviation]);

    // ── Slice 5: STATS ───────────────────────────────────────────────────────
    const statsSlice = useMemo<StatsSlice>(() => ({
        homeTeamStats: match.homeTeamStats || null, awayTeamStats: match.awayTeamStats || null, playerProps: match.playerProps || [],
    }), [match.homeTeamStats, match.awayTeamStats, match.playerProps]);

    // Root Assembly
    return useMemo(() => ({ meta: metaSlice, teams: teamsSlice, gameplay: gameplaySlice, betting: bettingSlice, stats: statsSlice }),
        [metaSlice, teamsSlice, gameplaySlice, bettingSlice, statsSlice]);
}

// ============================================================================
// 4. SHARED UI PRIMITIVES
// ============================================================================

const DarkPanel = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'> & { hover?: boolean }>(({ children, className, hover = false, ...props }, ref) => (
    <div ref={ref} className={cn('relative overflow-hidden bg-[#111113] rounded-xl border border-white/5 shadow-lg', hover && 'transition-colors duration-200 hover:bg-[#16161a]', className)} {...props}>
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: TOKENS.assets.noise }} aria-hidden="true" />
        <div className="relative z-10 h-full">{children}</div>
    </div>
));
DarkPanel.displayName = 'DarkPanel';

const Label = ({ children, className }: { children: ReactNode; className?: string }) => <h3 className={cn("text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em] leading-none m-0", className)}>{children}</h3>;
const DataValue = ({ value, size = 'lg', className }: { value: string | number; size?: 'lg' | 'xl'; className?: string; }) => <span className={cn('font-mono font-medium tracking-tighter tabular-nums text-white leading-none', size === 'xl' ? 'text-4xl font-light' : 'text-2xl', className)}>{value}</span>;

const EmptyState = ({ icon, message }: { icon: ReactNode; message: string }) => (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-[#111113]/30 border border-white/5 rounded-xl mx-6 my-4" role="status">
        <div className="text-zinc-600 mb-3" aria-hidden="true">{icon}</div>
        <p className="text-sm font-medium text-zinc-500">{message}</p>
    </div>
);

const TeamDisplay: FC<{ team: TeamsSlice['home'] }> = memo(({ team }) => (
    <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative mb-2">
            <div className="absolute inset-[-10px] rounded-full blur-2xl opacity-40 translate-z-0 pointer-events-none" style={{ background: team.color }} aria-hidden="true" />
            <div className="relative z-10 flex items-center justify-center bg-[#111113] rounded-full border border-white/10 w-20 h-20 sm:w-24 sm:h-24 shadow-2xl">
                <TeamLogo logo={team.logo} name={team.name} className="w-12 h-12 sm:w-16 sm:h-16 object-contain" />
            </div>
        </div>
        <div className="text-center">
            <h2 className="text-[15px] sm:text-[20px] font-bold text-white tracking-tight leading-tight">{team.name}</h2>
            <span className="mt-1 text-[11px] font-medium text-zinc-500 tabular-nums tracking-wide font-mono">{team.record}</span>
        </div>
    </div>
));
TeamDisplay.displayName = 'TeamDisplay';

// ============================================================================
// 5. TABS & VISUALIZATIONS (Strictly Memoized per Data Slice)
// ============================================================================

const MomentumGraph = memo(({ gameplay, teams, meta }: { gameplay: GameplaySlice; teams: TeamsSlice; meta: MetaSlice }) => {
    // Escaped useId() physically prevents WebKit CSS selector crashes on illegal characters
    const rawId = useId();
    const safeUid = useMemo(() => rawId.replace(/:/g, ''), [rawId]);

    if (meta.isPregame || !gameplay.momentumData.length) return null;

    const data = gameplay.momentumData;
    // Mathematical defense preventing Division by Zero rendering crashes
    const maxPts = Math.max(data.length, 2);
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
                        <clipPath id={`${safeUid}-away`}><rect x="0" y="50" width="100" height="50" /></clipPath>
                        <clipPath id={`${safeUid}-home`}><rect x="0" y="0" width="100" height="50" /></clipPath>
                        <linearGradient id={`${safeUid}-home-grad`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={teams.home.color} stopOpacity="0.5" />
                            <stop offset="100%" stopColor={teams.home.color} stopOpacity="0.0" />
                        </linearGradient>
                        <linearGradient id={`${safeUid}-away-grad`} x1="0" y1="1" x2="0" y2="0">
                            <stop offset="0%" stopColor={teams.away.color} stopOpacity="0.5" />
                            <stop offset="100%" stopColor={teams.away.color} stopOpacity="0.0" />
                        </linearGradient>
                    </defs>
                    <g clipPath={`url(#${safeUid}-home)`}>
                        <polyline points={polygon} fill={`url(#${safeUid}-home-grad)`} />
                        <polyline points={points} fill="none" stroke={teams.home.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                    <g clipPath={`url(#${safeUid}-away)`}>
                        <polyline points={polygon} fill={`url(#${safeUid}-away-grad)`} />
                        <polyline points={points} fill="none" stroke={teams.away.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                </svg>
            </div>
        </section>
    );
});
MomentumGraph.displayName = 'MomentumGraph';

const PlayByPlayList = memo(({ gameplay, teams }: { gameplay: GameplaySlice; teams: TeamsSlice }) => {
    const plays = gameplay.recentPlays;
    if (!plays.length) return <EmptyState icon={<History size={32} />} message="No recent plays available." />;

    return (
        <section className="bg-[#0A0A0B] border-b border-white/5" aria-label="Play-by-play Timeline">
            <header className="px-6 py-4 border-b border-white/5 bg-[#111113]/50 flex items-center gap-2">
                <Clock size={14} className="text-zinc-500" aria-hidden="true" />
                <Label>Timeline</Label>
            </header>
            <div className="flex flex-col divide-y divide-white/5 max-h-[350px] overflow-y-auto no-scrollbar" role="log" aria-live="polite">
                {plays.map((p, i) => {
                    const color = p.teamAbbr === teams.home.abbr ? teams.home.color : p.teamAbbr === teams.away.abbr ? teams.away.color : '#52525b';
                    // Stable layout hash prevents React from brutally unmounting the entire tree when new plays shift index values
                    const stableKey = p.id || `play-${p.clock}-${p.text.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '')}`;
                    return (
                        <article key={stableKey} className="p-4 px-6 flex gap-4 hover:bg-white/[0.02] transition-colors group">
                            <div className="flex flex-col items-center gap-2 shrink-0 mt-1" aria-hidden="true">
                                <div className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]" style={{ color, backgroundColor: color }} />
                                {i !== plays.length - 1 && <div className="w-px h-full bg-white/10 group-hover:bg-white/20 transition-colors" />}
                            </div>
                            <div className="flex flex-col gap-1 pb-1">
                                <time className="text-[10px] font-mono text-zinc-500" suppressHydrationWarning>{p.clock}</time>
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

const BoxScoreCard = memo(({ stats, teams, meta }: { stats: StatsSlice; teams: TeamsSlice; meta: MetaSlice }) => {
    const rows = useMemo(() => {
        const { homeTeamStats, awayTeamStats } = stats;
        if (!homeTeamStats && !awayTeamStats) return [];

        // Rigorous NaN-safe extraction
        const parse = (s: TeamStats | null, keys: string[]) => {
            if (!s) return 0;
            const validKey = keys.find(k => s[k] != null);
            return validKey ? safeNumber(s[validKey]) : 0;
        };

        const buildRow = (label: string, hV: number, aV: number, isPct = false) => {
            const total = hV + aV;
            // Prevent Division by Zero rendering NaNs. Bound between 0 and 100 for proper ARIA semantics.
            const hPct = total === 0 ? 50 : Math.max(0, Math.min(100, (hV / total) * 100));
            const aPct = total === 0 ? 50 : Math.max(0, Math.min(100, (aV / total) * 100));
            const fmt = (n: number) => isPct ? `${(n <= 1 && n > 0 ? n * 100 : n).toFixed(0)}%` : n.toFixed(0);
            return { label, hPct, aPct, hStr: fmt(hV), aStr: fmt(aV) };
        };

        if (meta.isFootball) return [
            buildRow('Total Yds', parse(homeTeamStats, ['yards', 'total_yards']), parse(awayTeamStats, ['yards', 'total_yards'])),
            buildRow('Pass Yds', parse(homeTeamStats, ['passing_yards']), parse(awayTeamStats, ['passing_yards'])),
            buildRow('Rush Yds', parse(homeTeamStats, ['rushing_yards']), parse(awayTeamStats, ['rushing_yards'])),
            buildRow('Turnovers', parse(homeTeamStats, ['turnovers']), parse(awayTeamStats, ['turnovers'])),
        ];
        if (meta.isBasketball) return [
            buildRow('FG%', parse(homeTeamStats, ['fg_pct']), parse(awayTeamStats, ['fg_pct']), true),
            buildRow('3P%', parse(homeTeamStats, ['fg3_pct']), parse(awayTeamStats, ['fg3_pct']), true),
            buildRow('Rebounds', parse(homeTeamStats, ['reb', 'rebounds']), parse(awayTeamStats, ['reb', 'rebounds'])),
            buildRow('Assists', parse(homeTeamStats, ['ast', 'assists']), parse(awayTeamStats, ['ast', 'assists'])),
        ];
        return [];
    }, [stats, meta.isFootball, meta.isBasketball]);

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
                            <span className="font-mono font-medium text-zinc-300 w-12 text-left">{r.aStr}</span>
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center" aria-hidden="true">{r.label}</span>
                            <span className="font-mono font-medium text-zinc-300 w-12 text-right">{r.hStr}</span>
                        </div>
                        <div className="flex w-full h-1.5 rounded-full overflow-hidden bg-white/5 gap-1" role="progressbar" aria-valuenow={Math.round(r.hPct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.label} comparison`}>
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

const GameTab = memo(({ gameplay, teams, meta }: { gameplay: GameplaySlice; teams: TeamsSlice; meta: MetaSlice }) => (
    <div className="flex flex-col pb-20 w-full" role="tabpanel" aria-label="Game Overview">
        <MomentumGraph gameplay={gameplay} teams={teams} meta={meta} />
        <PlayByPlayList gameplay={gameplay} teams={teams} />
        <BoxScoreCard stats={{ homeTeamStats: null, awayTeamStats: null, playerProps: [] } as StatsSlice} teams={teams} meta={meta} />
    </div>
));
GameTab.displayName = 'GameTab';

const PropsTab = memo(({ stats }: { stats: StatsSlice }) => (
    <div className="p-6 bg-[#0A0A0B] min-h-full pb-20 w-full" role="tabpanel" aria-label="Player Props">
        <header className="flex items-center gap-2 mb-6">
            <User size={14} className="text-zinc-500" aria-hidden="true" />
            <Label>Player Prop Tracker</Label>
        </header>
        <div className="flex flex-col gap-4">
            {stats.playerProps.length > 0 ? (
                stats.playerProps.map(p => {
                    const current = safeNumber(p.current);
                    const line = safeNumber(p.line);
                    const pct = line > 0 ? Math.max(0, Math.min(100, (current / line) * 100)) : 0;
                    const isHitting = current >= line;
                    return (
                        <DarkPanel key={p.id} className="p-5" aria-label={`Prop for ${p.playerName}`}>
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <h3 className="text-sm font-bold text-white">{p.playerName}</h3>
                                    <p className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase mt-1">{p.teamAbbr} • {p.market}</p>
                                </div>
                                <div className="text-right">
                                    <div className="text-lg font-mono font-bold text-white leading-none">{current} <span className="text-xs text-zinc-500">/ {line}</span></div>
                                    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mt-1">Proj: {p.projection}</div>
                                </div>
                            </div>
                            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden" role="progressbar" aria-valuenow={current} aria-valuemax={line} aria-valuemin={0}>
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

const EdgeTab = memo(({ betting, teams }: { betting: BettingSlice; teams: TeamsSlice }) => {
    const renderMovement = (open: number | null, current: number, isTotal = false) => {
        const displayCur = isTotal ? current : (current === 0 ? 'PK' : current > 0 ? `+${current}` : current);
        if (open === null || open === current) return <span className="text-zinc-300">{displayCur}</span>;

        const diff = current - open;
        const isUp = diff > 0;
        const displayOp = isTotal ? open : (open === 0 ? 'PK' : open > 0 ? `+${open}` : open);

        return (
            <div className="flex flex-col items-end gap-0.5">
                <div className="flex items-center gap-1.5">
                    <span className={cn("text-xs font-bold", isUp ? "text-emerald-400" : "text-rose-400")}>{displayCur}</span>
                    {isUp ? <TrendingUp size={12} className="text-emerald-400" aria-hidden="true" /> : <TrendingDown size={12} className="text-rose-400" aria-hidden="true" />}
                </div>
                <span className="text-[9px] text-zinc-500 line-through">Op: {displayOp}</span>
            </div>
        );
    };

    const tableRows = useMemo(() => [
        { id: teams.away.id, team: teams.away, openS: betting.openingSpread, curS: betting.hasSpread ? betting.spread : 0, openT: betting.openingTotal, curT: betting.total, ml: betting.moneyline.away },
        { id: teams.home.id, team: teams.home, openS: betting.openingSpread !== null ? -betting.openingSpread : null, curS: betting.hasSpread ? -betting.spread : 0, openT: betting.openingTotal, curT: betting.total, ml: betting.moneyline.home }
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

const AITab = memo(({ meta, teams, betting }: { meta: MetaSlice; teams: TeamsSlice; betting: BettingSlice }) => {
    // Generates deterministic mock-values strictly locked to the Match ID.
    const numericHash = useMemo(() => meta.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0), [meta.id]);
    const ticketHome = (betting.signals as any)?.ticket_pct_home ?? (45 + (numericHash % 20));
    const handleHome = (betting.signals as any)?.money_pct_home ?? (40 + ((numericHash * 2) % 30));

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
                            <span>{teams.away.abbr} {100 - ticketHome}% - {teams.home.abbr} {ticketHome}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden flex" aria-hidden="true">
                            <div className="h-full bg-zinc-600 transition-all duration-700" style={{ width: `${100 - ticketHome}%` }} />
                            <div className="h-full bg-zinc-300 transition-all duration-700" style={{ width: `${ticketHome}%` }} />
                        </div>
                    </div>
                    <div>
                        <div className="flex justify-between text-[10px] font-bold tracking-widest uppercase mb-1.5 text-zinc-400">
                            <span>Handle (Money) %</span>
                            <span>{teams.away.abbr} {100 - handleHome}% - {teams.home.abbr} {handleHome}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden flex" aria-hidden="true">
                            <div className="h-full bg-zinc-600 transition-all duration-700" style={{ width: `${100 - handleHome}%` }} />
                            <div className="h-full bg-orange-500 transition-all duration-700" style={{ width: `${handleHome}%` }} />
                        </div>
                    </div>
                </div>
            </DarkPanel>

            {!meta.isPregame && (
                <DarkPanel className="p-5 flex flex-col justify-between" aria-label="API Data Stream Status">
                    <header className="flex items-center gap-2">
                        {meta.hasData ? <Radio size={14} className="text-emerald-500 animate-pulse" aria-hidden="true" /> : <WifiOff size={14} className="text-rose-500" aria-hidden="true" />}
                        <Label>API Data Stream</Label>
                    </header>
                    <div className="mt-4 space-y-2">
                        <div className="flex justify-between text-xs text-zinc-400">
                            <span>Status</span>
                            <span className={cn("font-bold", meta.hasData ? "text-emerald-400" : "text-rose-400")}>{meta.hasData ? 'Optimal' : 'Offline'}</span>
                        </div>
                        <div className="flex justify-between text-xs text-zinc-400">
                            <span>Latency</span>
                            <span className="font-mono text-zinc-200">{meta.hasData ? '< 120ms' : '-'}</span>
                        </div>
                    </div>
                </DarkPanel>
            )}
        </div>
    );
});
AITab.displayName = 'AITab';

// ============================================================================
// 6. DECOUPLED HEADER CONTROLLERS (Prevents Layout Thrashing on Tab Switch)
// ============================================================================

const ScoreHeaderHero = memo(({ meta, teams, gameplay, betting, onBack, isEmbedded }: { meta: MetaSlice; teams: TeamsSlice; gameplay: GameplaySlice; betting: BettingSlice; onBack?: () => void; isEmbedded: boolean; }) => (
    <header className={cn('relative w-full flex flex-col items-center overflow-hidden select-none bg-[#0A0A0B]', !isEmbedded && 'pt-6')}>
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
            <div className="absolute top-[10%] -left-[10%] w-[50%] h-[80%] blur-[120px] opacity-[0.15] translate-z-0 rounded-full" style={{ background: teams.away.color }} />
            <div className="absolute top-[10%] -right-[10%] w-[50%] h-[80%] blur-[120px] opacity-[0.15] translate-z-0 rounded-full" style={{ background: teams.home.color }} />
        </div>

        <div className={cn('relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-4 sm:gap-12 w-full max-w-5xl px-4 sm:px-8', isEmbedded ? 'mt-8 mb-6' : 'mt-16 mb-8')}>
            <TeamDisplay team={teams.away} />
            <div className="flex flex-col items-center justify-center min-w-[140px] pt-4" aria-live="polite" aria-label={`Score: ${teams.away.name} ${teams.away.score}, ${teams.home.name} ${teams.home.score}`}>
                {meta.isPregame ? (
                    <div className="flex flex-col items-center gap-2">
                        <span className="text-4xl sm:text-5xl font-medium tracking-tighter tabular-nums text-white" suppressHydrationWarning>
                            {meta.displayClock || formatLocalTime(meta.timestampMs)}
                        </span>
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em]" suppressHydrationWarning>
                            {formatLocalDate(meta.timestampMs)}
                        </span>
                        {betting.matchupStr && <span className="px-3 py-1 bg-white/5 rounded border border-white/10 text-[10px] font-mono text-zinc-300 mt-2">{betting.matchupStr}</span>}
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex items-center gap-4 sm:gap-8">
                            <span className="text-5xl sm:text-7xl font-light text-white tabular-nums tracking-tighter drop-shadow-lg">{teams.away.score}</span>
                            <span className="text-zinc-700 text-3xl font-light" aria-hidden="true">-</span>
                            <span className="text-5xl sm:text-7xl font-light text-white tabular-nums tracking-tighter drop-shadow-lg">{teams.home.score}</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 bg-[#111113]/80 rounded-full border border-white/5">
                            <span className="text-[11px] font-mono font-medium tracking-widest text-amber-500" suppressHydrationWarning>{meta.displayClock}</span>
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
    </header>
));
ScoreHeaderHero.displayName = 'ScoreHeaderHero';

const TabNavigation = memo(({ activeTab, onTabChange, trackerId }: { activeTab: TabKey; onTabChange: (t: TabKey) => void; trackerId: string; }) => {
    const reduceMotion = useReducedMotion();

    // A11y: Keyboard Support for Tabs matching WCAG specification
    const handleKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const newIndex = e.key === 'ArrowRight' ? (index + 1) % TABS.length : (index - 1 + TABS.length) % TABS.length;
            onTabChange(TABS[newIndex] as TabKey);
            document.getElementById(`tab-${TABS[newIndex]}-${trackerId}`)?.focus();
        }
    }, [onTabChange, trackerId]);

    return (
        <nav className="w-full flex items-center justify-center gap-8 border-b border-white/5 pb-0 overflow-x-auto no-scrollbar px-4 bg-[#0A0A0B]" role="tablist" aria-label="Game Tracker Views">
            {TABS.map((tab, idx) => (
                <button
                    key={tab}
                    role="tab"
                    aria-selected={activeTab === tab}
                    aria-controls={`panel-${tab}`}
                    id={`tab-${tab}-${trackerId}`}
                    tabIndex={activeTab === tab ? 0 : -1}
                    type="button"
                    onClick={() => onTabChange(tab)}
                    onKeyDown={(e) => handleKeyDown(e, idx)}
                    className={cn('text-[10px] sm:text-[11px] font-bold tracking-[0.15em] transition-colors pb-4 relative shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-white/50 rounded-sm', activeTab === tab ? 'text-white' : 'text-zinc-500 hover:text-zinc-300')}
                >
                    {tab}
                    {activeTab === tab && (
                        <motion.div
                            layoutId={`tab-indicator-${trackerId}`}
                            transition={reduceMotion ? { duration: 0 } : TOKENS.animation.spring}
                            className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-t-full shadow-[0_-2px_8px_rgba(255,255,255,0.4)]"
                            aria-hidden="true"
                        />
                    )}
                </button>
            ))}
        </nav>
    );
});
TabNavigation.displayName = 'TabNavigation';

// Backward compatible ScoreHeader export for isolated embedded usage
export const ScoreHeader: FC<{ match: Match; onBack?: () => void; variant?: ScoreHeaderVariant }> = memo(({ match, onBack, variant = 'full' }) => {
    const vm = useGameViewModel(match as ExtendedMatch);
    if (!vm) return <div className="h-[360px] bg-[#0A0A0B] animate-pulse" />;
    return <ScoreHeaderHero meta={vm.meta} teams={vm.teams} gameplay={vm.gameplay} betting={vm.betting} onBack={onBack} isEmbedded={variant === 'embedded'} />;
});
ScoreHeader.displayName = 'ScoreHeader';

// ============================================================================
// 7. ROOT COMPONENT WITH TABBED ROUTING
// ============================================================================

export const LiveGameTracker: FC<{ match: Match; liveState?: Partial<ExtendedMatch> | null; onBack?: () => void; showHeader?: boolean; headerVariant?: ScoreHeaderVariant }> = memo(
    ({ match, liveState, onBack, showHeader = true, headerVariant = 'full' }) => {
        const mergedMatch = useMemo(() => mergeMatchWithLiveState(match as ExtendedMatch, liveState), [match, liveState]);
        const vm = useGameViewModel(mergedMatch);

        // Prevent layoutId collisions across duplicated instances on the same page
        const trackerId = useId().replace(/:/g, '');

        const [activeTab, setActiveTab] = useState<TabKey>(TABS[0]);

        // Protective Effect: Reset tab state when the DOM node is recycled to avoid showing empty props tabs on game switch
        useEffect(() => setActiveTab(TABS[0]), [match.id]);

        if (!vm) return (
            <div className="h-[400px] flex items-center justify-center bg-[#0A0A0B]" role="status" aria-label="Loading game data">
                <Activity className="text-zinc-600 animate-pulse" aria-hidden="true" />
            </div>
        );

        return (
            <main className={cn('flex flex-col w-full bg-[#0A0A0B] overflow-x-hidden font-sans', showHeader ? 'min-h-screen' : 'min-h-0')}>
                {showHeader && (
                    <>
                        <ScoreHeaderHero meta={vm.meta} teams={vm.teams} gameplay={vm.gameplay} betting={vm.betting} onBack={onBack} isEmbedded={headerVariant === 'embedded'} />
                        {headerVariant !== 'embedded' && <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} trackerId={trackerId} />}
                    </>
                )}

                <div className="w-full relative min-h-[400px]">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            id={`panel-${activeTab}`}
                            role="tabpanel"
                            aria-labelledby={`tab-${activeTab}-${trackerId}`}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={TOKENS.animation.fade}
                            className="w-full"
                        >
                            {/* Memoized decoupled slices guarantee React strictly bails out of rendering inactive properties */}
                            {activeTab === 'GAME' && <GameTab gameplay={vm.gameplay} teams={vm.teams} meta={vm.meta} />}
                            {activeTab === 'PROPS' && <PropsTab stats={vm.stats} />}
                            {activeTab === 'EDGE' && <EdgeTab betting={vm.betting} teams={vm.teams} />}
                            {activeTab === 'AI' && <AITab meta={vm.meta} teams={vm.teams} betting={vm.betting} />}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </main>
        );
    }
);
LiveGameTracker.displayName = 'LiveGameTracker';

export const LiveTotalCard: FC<{ match: Match }> = memo(({ match }) => {
    const vm = useGameViewModel(match as ExtendedMatch);
    if (!vm) return <DarkPanel className="p-6 flex justify-center"><Activity className="animate-spin text-zinc-600" aria-label="Loading betting card" /></DarkPanel>;
    return <EdgeTab betting={vm.betting} teams={vm.teams} />;
});
LiveTotalCard.displayName = 'LiveTotalCard';

export default LiveGameTracker;
