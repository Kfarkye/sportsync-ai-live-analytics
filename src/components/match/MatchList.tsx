
import React, { useMemo } from 'react';
import { Match, MatchStatus, Sport, Linescore } from '@/types';
import { LEAGUES } from '@/constants';
import MatchRow from './MatchRow';
import TeamLogo from '../shared/TeamLogo';
import { cn } from '@/lib/essence';
import { LayoutGroup, motion } from 'framer-motion';
import { getPeriodDisplay } from '../../utils/matchUtils';
import { useAppStore } from '../../store/appStore';
import { FeedSkeleton } from '../ui/Skeleton';

interface MatchListProps {
    matches: Match[];
    onSelectMatch: (match: Match) => void;
    isLoading: boolean;
    pinnedMatchIds: ReadonlySet<string>;
    onTogglePin: (id: string, e: React.MouseEvent | React.KeyboardEvent) => void;
    isMatchLive: (match: Match) => boolean;
    isMatchFinal: (match: Match) => boolean;
    onOpenPricing: () => void;
}

const MotionDiv = motion.div;

// ============================================================================
// WIDGETS
// ============================================================================

// --- Tennis Set Score Display (matches MatchRow's TennisSetScores) ---
const HeroSetScores: React.FC<{ linescores?: Linescore[] }> = ({ linescores }) => {
    if (!linescores || linescores.length === 0) return <span className="text-sm text-zinc-600 font-mono">-</span>;
    return (
        <div className="flex items-center gap-1 font-mono text-sm tabular-nums">
            {linescores.map((ls, idx) => (
                <span key={idx} className={ls.winner ? "text-white font-bold" : "text-zinc-500"}>{ls.value ?? '-'}</span>
            ))}
        </div>
    );
};

// --- Player identity for tennis (flag + last name) ---
const TennisPlayerIdentity: React.FC<{ team: Match['homeTeam']; className?: string }> = ({ team, className }) => {
    const lastName = team.name.split(' ').pop() || team.name;
    return (
        <div className={cn("flex flex-col items-center gap-2", className)}>
            {team.flag ? (
                <div className="w-10 h-7 overflow-hidden rounded-[2px] shadow-md border border-white/10">
                    <img src={team.flag} alt="" className="w-full h-full object-cover" />
                </div>
            ) : (
                <TeamLogo logo={team.logo} name={team.name} className="w-10 h-10 object-contain drop-shadow-2xl" />
            )}
            <span className="text-sm font-bold text-white tracking-tight truncate max-w-[100px]">{lastName}</span>
        </div>
    );
};

const normalizeHex = (value?: string) => {
    if (!value) return '#1c1c1e';
    return value.startsWith('#') ? value : `#${value}`;
};

const FeaturedHero = ({ match, onClick, isLive }: { match: Match; onClick: () => void; isLive: boolean }) => {
    const homeColor = normalizeHex(match.homeTeam.color);
    const awayColor = normalizeHex(match.awayTeam.color);
    const bgGradient = `linear-gradient(135deg, ${awayColor}15 0%, #09090b 50%, ${homeColor}15 100%)`;
    const isTennis = match.sport === Sport.TENNIS;
    const scheduledTime = new Date(match.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const heroLabel = `${match.awayTeam.name} vs ${match.homeTeam.name}`;

    // Tennis: show round (R1, QF, SF, F). Team sports: show period/clock.
    const roundStr = match.round
        ? match.round.replace('Qualifying ', 'Q').replace('Round of ', 'R').replace('Round ', 'R')
        : null;

    return (
        <div
            onClick={onClick}
            role="button"
            tabIndex={0}
            aria-label={`Open ${heroLabel}`}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            }}
            className="relative h-[160px] rounded-2xl border border-white/10 overflow-hidden cursor-pointer group transition-all duration-500 hover:border-white/20 hover:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            style={{ background: '#09090b' }}
        >
            {/* Dynamic Background */}
            <div className="absolute inset-0 opacity-60 transition-opacity duration-500 group-hover:opacity-80" style={{ background: bgGradient }} />
            <div className="absolute inset-0 bg-black/20" />

            <div className="relative z-10 h-full flex flex-col justify-between p-5">
                {/* Top Row: Status */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {isLive && (
                            <div className="px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                <span className="text-label font-bold text-red-500 uppercase tracking-widest">Live</span>
                            </div>
                        )}
                        {!isLive && (
                            <div className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                                <span className="text-label font-bold text-zinc-400 uppercase tracking-widest">
                                    {scheduledTime}
                                </span>
                            </div>
                        )}
                        {/* Tennis round badge */}
                        {isTennis && roundStr && (
                            <div className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                                <span className="text-label font-bold text-zinc-400 uppercase tracking-widest">{roundStr}</span>
                            </div>
                        )}
                    </div>
                    <span className="text-caption font-bold text-white/30 uppercase tracking-widest">
                        {match.leagueId}
                    </span>
                </div>

                {/* Middle Row: Matchup */}
                <div className="flex items-center justify-between px-2">
                    {/* Player/Team 1 (Away) */}
                    {isTennis ? (
                        <TennisPlayerIdentity team={match.awayTeam} />
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <TeamLogo logo={match.awayTeam.logo} name={match.awayTeam.name} className="w-12 h-12 object-contain drop-shadow-2xl" />
                            <span className="text-sm font-bold text-white tracking-tight">{match.awayTeam.abbreviation || match.awayTeam.name.substring(0, 3).toUpperCase()}</span>
                        </div>
                    )}

                    {/* Score Center */}
                    <div className="flex flex-col items-center gap-1">
                        {isLive || (match.homeScore !== undefined && match.homeScore !== null) ? (
                            isTennis ? (
                                /* Tennis: Set-by-set scores for each player */
                                <div className="flex flex-col items-center gap-1.5">
                                    <HeroSetScores linescores={match.awayTeam.linescores} />
                                    <div className="w-12 h-px bg-white/10" />
                                    <HeroSetScores linescores={match.homeTeam.linescores} />
                                </div>
                            ) : (
                                /* Team sports: Big score */
                                <div className="text-3xl font-mono font-bold text-white tracking-tighter tabular-nums flex items-center gap-3">
                                    <span>{match.awayScore}</span>
                                    <span className="text-white/20">-</span>
                                    <span>{match.homeScore}</span>
                                </div>
                            )
                        ) : (
                            <span className="text-2xl font-black text-white/20 italic">VS</span>
                        )}
                    </div>

                    {/* Player/Team 2 (Home) */}
                    {isTennis ? (
                        <TennisPlayerIdentity team={match.homeTeam} />
                    ) : (
                        <div className="flex flex-col items-center gap-2">
                            <TeamLogo logo={match.homeTeam.logo} name={match.homeTeam.name} className="w-12 h-12 object-contain drop-shadow-2xl" />
                            <span className="text-sm font-bold text-white tracking-tight">{match.homeTeam.abbreviation || match.homeTeam.name.substring(0, 3).toUpperCase()}</span>
                        </div>
                    )}
                </div>

                {/* Bottom Row: Context */}
                <div className="flex items-center justify-center">
                    <span className="text-caption font-bold text-white/40 uppercase tracking-widest truncate max-w-[200px]">
                        {isLive
                            ? (isTennis && roundStr ? roundStr : getPeriodDisplay(match))
                            : 'Headline Event'
                        }
                    </span>
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const MatchList: React.FC<MatchListProps> = ({
    matches,
    onSelectMatch,
    isLoading,
    pinnedMatchIds,
    onTogglePin,
    isMatchLive,
    isMatchFinal,
    onOpenPricing,
}) => {
    const { selectedSport } = useAppStore();
    const selectedSportKey = String(selectedSport);

    const { favorites, groupedMatches, featuredMatch, featuredMatches } = useMemo(() => {
        const favs: Match[] = [];
        const rest: Match[] = [];

        matches.forEach(m => {
            if (pinnedMatchIds.has(m.id)) favs.push(m);
            else rest.push(m);
        });

        const groups: Map<string, Match[]> = new Map();
        rest.forEach(m => {
            if (!groups.has(m.leagueId)) groups.set(m.leagueId, []);
            groups.get(m.leagueId)?.push(m);
        });

        // Sort live first inside groups
        groups.forEach((groupMatches) => {
            groupMatches.sort((a, b) => {
                const isALive = isMatchLive(a);
                const isBLive = isMatchLive(b);
                if (isALive && !isBLive) return -1;
                if (!isALive && isBLive) return 1;
                return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
            });
        });

        const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
            const idxA = LEAGUES.findIndex(l => l.id === a[0]);
            const idxB = LEAGUES.findIndex(l => l.id === b[0]);
            return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });

        let featured = matches.find(m => isMatchLive(m) && pinnedMatchIds.has(m.id)) ||
            matches.find(m => isMatchLive(m)) ||
            matches[0];

        // Headlines Logic
        // Select top 2 games from priority leagues
        const majors = new Set(['nba', 'nfl', 'ncaaf', 'ncaab']);
        const possibleHeadlines = matches
            .filter(m => majors.has(m.leagueId.toLowerCase()) && !isMatchFinal(m))
            .sort((a, b) => {
                // 1. Live overrides all
                const aLive = isMatchLive(a);
                const bLive = isMatchLive(b);
                if (aLive !== bLive) return aLive ? -1 : 1;

                // 2. Start time ascending (soonest first)
                return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
            });

        // If not enough majors, look at everything
        const headlines = possibleHeadlines.length > 0
            ? possibleHeadlines.slice(0, 2)
            : matches.filter(m => !isMatchFinal(m)).slice(0, 2);

        return { favorites: favs, groupedMatches: sortedGroups, featuredMatch: featured, featuredMatches: headlines };
    }, [matches, pinnedMatchIds, isMatchLive]);

    if (isLoading && matches.length === 0) {
        return <FeedSkeleton />;
    }

    if (matches.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-zinc-600">
                <span className="text-xl mb-4 opacity-50">∅</span>
                <span className="text-sm font-medium uppercase tracking-widest opacity-70">No Action</span>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-transparent pb-32">
            <LayoutGroup>
                <div className="max-w-7xl mx-auto px-0 lg:px-6 w-full">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-12 items-start">

                        {/* FEED COLUMN */}
                        <div className="min-w-0 flex flex-col gap-10">


                            {/* Favorites */}
                            {favorites.length > 0 && (
                                <section className="px-0">
                                    <div className="flex items-center gap-2 mb-4 px-4 lg:px-1">
                                        <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
                                        <span className="text-footnote font-semibold text-zinc-500 uppercase tracking-widest">Watchlist</span>
                                    </div>
                                    <div className="border-t border-edge-strong">
                                        {favorites.map(match => (
                                            <MatchRow
                                                key={`fav-${match.id}`}
                                                match={match}
                                                isPinned={true}
                                                isLive={isMatchLive(match)}
                                                isFinal={isMatchFinal(match)}
                                                onSelect={() => onSelectMatch(match)}
                                                onTogglePin={(e) => onTogglePin(match.id, e)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* League Groups */}
                            <div className="space-y-8">
                                {groupedMatches.map(([leagueId, leagueMatches], groupIndex) => {
                                    const leagueConfig = LEAGUES.find(l => l.id === leagueId);
                                    const leagueName = leagueConfig?.name || leagueId.toUpperCase();

                                    // Get earliest game time for header
                                    const earliestTime = leagueMatches.length > 0
                                        ? new Date(Math.min(...leagueMatches.map(m => new Date(m.startTime).getTime())))
                                            .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                                        : '';

                                    return (
                                        <MotionDiv
                                            key={leagueId}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: groupIndex * 0.05 }}
                                        >
                                            {/* Pure Typography League Header */}
                                            {selectedSportKey === 'all' && (
                                                <div className="px-4 pt-8 pb-3 flex items-baseline justify-between">
                                                    <div className="flex items-baseline gap-3">
                                                        <h3 className="text-xs font-medium text-white/90 tracking-wide uppercase">
                                                            {leagueName}
                                                        </h3>
                                                        <span className="text-caption font-normal text-zinc-500 tracking-wide">
                                                            {earliestTime}
                                                        </span>
                                                    </div>
                                                    <span className="text-caption font-normal text-zinc-600 tabular-nums tracking-wide">
                                                        {leagueMatches.length}
                                                    </span>
                                                </div>
                                            )}

                                            <div className="border-b border-edge">
                                                {leagueMatches.map((match, rowIndex) => (
                                                    <MotionDiv
                                                        key={match.id}
                                                        initial={{ opacity: 0, y: 6 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{
                                                            duration: 0.3,
                                                            delay: groupIndex * 0.06 + rowIndex * 0.03,
                                                            ease: [0.22, 1, 0.36, 1],
                                                        }}
                                                    >
                                                        <MatchRow
                                                            match={match}
                                                            isPinned={pinnedMatchIds.has(match.id)}
                                                            isLive={isMatchLive(match)}
                                                            isFinal={isMatchFinal(match)}
                                                            onSelect={() => onSelectMatch(match)}
                                                            onTogglePin={(e) => onTogglePin(match.id, e)}
                                                        />
                                                    </MotionDiv>
                                                ))}
                                            </div>
                                        </MotionDiv>
                                    );
                                })}
                            </div>
                        </div>

                        {/* SIDEBAR WIDGETS (Desktop) - Synced to 112px + gap */}
                        <div className="hidden lg:flex flex-col sticky top-[128px] space-y-6">

                            {/* HEADLINE ACTS (Moved to Sidebar) */}
                            {featuredMatches.length > 0 && (
                                <section className="mb-2">
                                    <div className="flex items-center gap-2 mb-3 px-1">
                                        <span className="w-1.5 h-1.5 bg-brand-cyan rounded-full shadow-glow-cyan-sm animate-pulse" />
                                        <span className="text-caption font-semibold text-zinc-500 uppercase tracking-widest">Headline Events</span>
                                    </div>
                                    <div className="flex flex-col gap-4">
                                        {featuredMatches.map(match => (
                                            <FeaturedHero
                                                key={`feat-${match.id}`}
                                                match={match}
                                                onClick={() => onSelectMatch(match)}
                                                isLive={isMatchLive(match)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* Promo Widget */}
                            <div className="p-8 rounded-2xl bg-zinc-900/30 border border-edge-subtle relative overflow-hidden group">
                                <h3 className="text-footnote font-bold text-[#2997FF] uppercase tracking-widest mb-3">
                                    Pro Access
                                </h3>
                                <p className="text-body-sm text-zinc-400 mb-6 leading-relaxed font-medium tracking-tight">
                                    Real-time institutional feeds and sharp money indicators.
                                </p>
                                <button
                                    type="button"
                                    onClick={onOpenPricing}
                                    className="w-full py-3 bg-white hover:bg-zinc-200 text-black text-footnote font-bold uppercase tracking-widest rounded-full transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                                >
                                    Upgrade
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </LayoutGroup>
        </div>
    );
};

export default MatchList;
