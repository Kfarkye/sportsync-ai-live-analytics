
import React from 'react';
import { Match, MatchStatus } from '../../types';
import { TrendingUp, TrendingDown, Lock } from 'lucide-react';
import TeamLogo from '../shared/TeamLogo';

/* -------------------------------------------------------------------------- */
/*                            HELPER FUNCTIONS                                */
/* -------------------------------------------------------------------------- */

const safeParse = (val: any): number | undefined => {
    if (val === undefined || val === null) return undefined;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        if (val === '-' || val === '') return undefined;
        // Strip prefixes for cleaner parsing
        const cleaned = val.replace(/[ouOU]/g, '').replace(/[^\d.-]/g, '');
        const num = parseFloat(cleaned);
        if (!isNaN(num)) return val.includes('-') && num > 0 ? -num : num;
    }
    return undefined;
};

const fmt = (val?: number | string, isSpread = false) => {
    if (val === undefined || val === null) return '-';
    if (typeof val === 'string' && (val.includes('+') || val.includes('-'))) return val;

    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num)) return '-';

    if (num === 0 && isSpread) return 'PK';
    return num > 0 ? `+${num}` : `${num}`;
};

const fmtJuice = (val?: number | string) => {
    if (val === undefined || val === null || val === '') return '';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num)) return val.toString();
    return num > 0 ? `+${num}` : `${num}`;
};

/* -------------------------------------------------------------------------- */
/*                            SUB-COMPONENTS                                  */
/* -------------------------------------------------------------------------- */

const MovementIndicator = ({ current, open }: { current?: number, open?: number }) => {
    if (current === undefined || open === undefined || current === open) return null;
    const diff = current - open;
    const isPositive = diff > 0;

    return (
        <div className={`flex items-center gap-0.5 text-[9px] font-semibold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isPositive ? <TrendingUp size={9} strokeWidth={2.5} /> : <TrendingDown size={9} strokeWidth={2.5} />}
            <span className="tabular-nums">{Math.abs(diff).toFixed(1)}</span>
        </div>
    );
};

const OddsCell = ({
    label,
    value,
    subValue,
    open,
    prefix
}: {
    label: string,
    value?: string | number,
    subValue?: string | number,
    open?: string | number,
    prefix?: string
}) => {
    const curVal = safeParse(value);
    const opVal = safeParse(open);

    // Construct main display string
    let displayCurrent = fmt(value, label === 'Spread');
    let displayOpen = fmt(open, label === 'Spread');

    // Apply specific prefixes for Totals (o/u) if value exists
    if (prefix && curVal !== undefined) {
        displayCurrent = `${prefix}${Math.abs(curVal)}`;
    }
    if (prefix && opVal !== undefined) {
        displayOpen = `${prefix}${Math.abs(opVal)}`;
    }

    return (
        <div className="flex flex-col items-center justify-center py-1">
            <div className="flex items-baseline gap-1">
                <span className="text-[15px] font-bold text-white tabular-nums tracking-tight">{displayCurrent}</span>
                {subValue && (
                    <span className="text-[10px] text-zinc-500 font-medium tabular-nums">{fmtJuice(subValue)}</span>
                )}
                <MovementIndicator current={curVal} open={opVal} />
            </div>

            {opVal !== undefined && opVal !== curVal && (
                <div className="flex items-center gap-1 mt-1">
                    <span className="text-[9px] font-medium text-zinc-600 uppercase tracking-wide">Open</span>
                    <span className="text-[10px] text-zinc-500 font-medium tabular-nums">{displayOpen}</span>
                </div>
            )}
        </div>
    );
};

/* -------------------------------------------------------------------------- */
/*                               MAIN COMPONENT                               */
/* -------------------------------------------------------------------------- */

const PregameOdds = ({ match }: { match: Match }) => {
    const isFinal = [MatchStatus.FINISHED, "FINAL", "STATUS_FINAL", "STATUS_FINAL_OT", "COMPLETED"].includes(match.status as any);

    // Priority: match.closing_odds (if final) -> match.current_odds (DB) -> match.odds (API)
    const current = (isFinal && match.closing_odds) ? match.closing_odds : (match.current_odds || match.odds || {});
    const opening = match.opening_odds || {};

    // 1. Resolve 'Opening'
    const homeSpreadOpen = opening.homeSpread ?? opening.spread ?? opening.home_spread;
    const awaySpreadOpen = opening.awaySpread ?? opening.away_spread;
    const totalOpen = opening.overUnder ?? opening.total ?? opening.over_under ?? opening.total_line ?? opening.over;
    const homeMLOpen = opening.homeWin ?? opening.homeML ?? opening.home_ml;
    const awayMLOpen = opening.awayWin ?? opening.awayML ?? opening.away_ml;
    const drawMLOpen = opening.draw ?? opening.draw_ml ?? opening.drawML ?? opening.draw_moneyline;

    // 2. Resolve 'Current' (Fallback to Opening)
    let homeSpread = current.homeSpread ?? current.home_spread ?? current.spread ?? current.spread_home_value;
    if (homeSpread === undefined || homeSpread === null) homeSpread = homeSpreadOpen;

    let awaySpread = current.awaySpread ?? current.away_spread;
    if (awaySpread === undefined || awaySpread === null) awaySpread = awaySpreadOpen;

    // --- INTELLIGENT SPREAD PARSING (Fix for "CLE -5.5" strings) ---
    // If we have a string spread that includes a team name, resolve it to numeric values for both teams
    if (typeof homeSpread === 'string' && /^[A-Z]+(\s|&nbsp;)/i.test(homeSpread)) {
        try {
            // Remove typical artifacts
            const clean = homeSpread.replace(/&nbsp;/g, ' ').trim();
            const parts = clean.split(/\s+/);
            const valStr = parts[parts.length - 1];
            const teamStr = parts[0].toUpperCase();

            const num = parseFloat(valStr);
            if (!isNaN(num)) {
                const hAbbr = (match.homeTeam.abbreviation || match.homeTeam.shortName || '').toUpperCase();
                const aAbbr = (match.awayTeam.abbreviation || match.awayTeam.shortName || '').toUpperCase();

                // Check if string refers to Away Team
                if (teamStr === aAbbr || aAbbr.includes(teamStr)) {
                    awaySpread = num;
                    homeSpread = num * -1;
                }
                // Check if string refers to Home Team
                else if (teamStr === hAbbr || hAbbr.includes(teamStr)) {
                    homeSpread = num;
                    awaySpread = num * -1;
                }
                // Fallback: If just a number was somehow wrapped in text, try to use it
                else {
                    // Try to clean it anyway
                    homeSpread = num;
                    // We can't infer away spread safely if we don't know who the 'Team' string referred to,
                    // but usually 'Team -X' implies that Team.
                }
            }
        } catch (e) {
            // Fallback to existing strings
        }
    }

    let total = current.overUnder ?? current.over_under ?? current.total ?? current.total_line ?? current.over;
    // Clean string totals
    if (typeof total === 'string') total = total.replace(/[ouOU]/g, '').trim();
    if (total === undefined || total === null || total === '') total = totalOpen;

    let overLine = current.overLine ?? total;
    let underLine = current.underLine ?? total;
    if (typeof overLine === 'string' && /^[OU]\s/i.test(overLine)) overLine = overLine.replace(/^[OU]\s/i, '');
    if (typeof underLine === 'string' && /^[OU]\s/i.test(underLine)) underLine = underLine.replace(/^[OU]\s/i, '');

    let homeML = current.homeWin ?? current.home_ml ?? current.moneylineHome ?? current.homeMoneyline;
    if (homeML === undefined || homeML === null) homeML = homeMLOpen;

    let awayML = current.awayWin ?? current.away_ml ?? current.moneylineAway ?? current.awayMoneyline;
    if (awayML === undefined || awayML === null) awayML = awayMLOpen;

    let drawML = current.draw ?? current.draw_ml ?? current.drawML ?? current.draw_moneyline;
    if (drawML === undefined || drawML === null) drawML = drawMLOpen;

    // 3. Extract Juice (Odds) - Support both camelCase and snake_case
    // Priority: Direct keys -> Nested 'best' object (from live-odds-tracker) -> Fallback
    const homeSpreadOdds = current.homeSpreadOdds ?? current.home_spread_odds ?? current.spread_home_odds ?? current.spread_best?.home?.price;
    const awaySpreadOdds = current.awaySpreadOdds ?? current.away_spread_odds ?? current.spread_away_odds ?? current.spread_best?.away?.price;
    const overOdds = current.overOdds ?? current.over_odds ?? current.overPrice ?? current.over_price ?? current.overJuice ?? current.over_juice ?? current.totalOverOdds ?? current.total_best?.over?.price ?? '-110';
    const underOdds = current.underOdds ?? current.under_odds ?? current.underPrice ?? current.under_price ?? current.underJuice ?? current.under_juice ?? current.totalUnderOdds ?? current.total_best?.under?.price ?? '-110';

    // 4. Inference
    if (homeSpread !== undefined && homeSpread !== null && (awaySpread === undefined || awaySpread === null)) {
        const val = typeof homeSpread === 'string' ? parseFloat(homeSpread) : homeSpread;
        if (!isNaN(val)) awaySpread = val * -1;
    }
    if (awaySpread !== undefined && awaySpread !== null && (homeSpread === undefined || homeSpread === null)) {
        const val = typeof awaySpread === 'string' ? parseFloat(awaySpread) : awaySpread;
        if (!isNaN(val)) homeSpread = val * -1;
    }

    const provider = current.provider || opening.provider || 'Consensus';

    // Detect game state
    const isLive = [MatchStatus.LIVE, MatchStatus.HALFTIME, 'IN_PROGRESS', 'LIVE', 'HALFTIME', 'IN PROGRESS', 'FIRST_HALF', 'SECOND_HALF', 'STATUS_FIRST_HALF', 'STATUS_SECOND_HALF'].includes(match.status as any);

    // Check if we actually have live odds data (fetched from The Odds API in real-time)
    const hasLiveOdds = current.isLive || current.provider === 'Live';

    // For live games with live odds, show "Live Lines"; otherwise show "Opening Lines" for live games without live data
    const oddsLabel = isFinal ? 'Closing Lines' : (isLive && hasLiveOdds) ? 'Live Lines' : isLive ? 'Opening Lines' : 'Game Lines';
    const oddsSubLabel = isFinal ? '(Final)' : (isLive && hasLiveOdds) ? '(Updating in real-time)' : isLive ? '(Pre-game odds - Live odds unavailable)' : '';

    return (
        <div className="relative">
            {/* Section Header - Matches Gamecast Style */}
            <div className="flex items-center gap-2 mb-6">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">
                    {oddsLabel}
                </span>
                {oddsSubLabel && (
                    <span className="text-[9px] text-zinc-600">{oddsSubLabel}</span>
                )}
                {isLive && (
                    <div className={`ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-md ${hasLiveOdds ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${hasLiveOdds ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <span className={`text-[9px] font-bold uppercase ${hasLiveOdds ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {hasLiveOdds ? 'LIVE' : 'Pre-Game'}
                        </span>
                    </div>
                )}
            </div>

            {/* Column Headers */}
            <div className="flex items-center gap-4 mb-3 pb-3 border-b border-white/[0.04]">
                <div className="w-28 shrink-0">
                    <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em]">Team</span>
                </div>
                <div className="grid grid-cols-3 gap-2 flex-1">
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] text-center">Spread</div>
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] text-center">Total</div>
                    <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] text-center">Money</div>
                </div>
            </div>

            {/* Away Team Row */}
            <div className="flex items-center gap-4 py-5 border-b border-white/[0.04] transition-colors duration-150">
                <div className="w-28 flex items-center gap-2.5 shrink-0">
                    <TeamLogo logo={match.awayTeam.logo} className="w-7 h-7 drop-shadow-md" />
                    <span className="text-[11px] font-bold text-white uppercase tracking-[0.1em]">{match.awayTeam.abbreviation || match.awayTeam.shortName}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 flex-1">
                    <OddsCell label="Spread" value={awaySpread} subValue={awaySpreadOdds} open={awaySpreadOpen} />
                    <OddsCell label="Total" value={overLine} subValue={overOdds} open={totalOpen} prefix="o" />
                    <OddsCell label="Money" value={awayML} open={awayMLOpen} />
                </div>
            </div>

            {/* Home Team Row */}
            <div className="flex items-center gap-4 py-5 border-b border-white/[0.04] transition-colors duration-150">
                <div className="w-28 flex items-center gap-2.5 shrink-0">
                    <TeamLogo logo={match.homeTeam.logo} className="w-7 h-7 drop-shadow-md" />
                    <span className="text-[11px] font-bold text-white uppercase tracking-[0.1em]">{match.homeTeam.abbreviation || match.homeTeam.shortName}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 flex-1">
                    <OddsCell label="Spread" value={homeSpread} subValue={homeSpreadOdds} open={homeSpreadOpen} />
                    <OddsCell label="Total" value={underLine} subValue={underOdds} open={totalOpen} prefix="u" />
                    <OddsCell label="Money" value={homeML} open={homeMLOpen} />
                </div>
            </div>

            {/* Draw Row (Soccer) */}
            {match.sport === 'SOCCER' && (drawML || drawMLOpen) && (
                <div className="flex items-center gap-5 py-4 border-b border-white/[0.04] group/row hover:bg-white/[0.02] transition-colors duration-300">
                    <div className="w-24 flex items-center gap-3 shrink-0">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 border border-white/[0.06] flex items-center justify-center text-zinc-500 font-bold text-xs">X</div>
                        <span className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">Draw</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 flex-1">
                        <div className="invisible" />
                        <div className="invisible" />
                        <OddsCell label="Money" value={drawML} open={drawMLOpen} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default PregameOdds;
