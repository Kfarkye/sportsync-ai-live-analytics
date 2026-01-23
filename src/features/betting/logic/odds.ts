
import { Match, MatchOdds, MatchStatus, Sport } from '../../../types';

export type BetResult = 'won' | 'lost' | 'push' | 'void' | null;

export interface SpreadAnalysis {
    line: number | null;
    display: string;
    result: BetResult;
    isHomeFav: boolean;
    label: string;
}

export interface TotalAnalysis {
    line: number | null;
    display: string;
    result: 'OVER' | 'UNDER' | 'PUSH' | null;
}

// Helper: Is the match final?
const isFinal = (status: MatchStatus | string) => {
    const s = String(status).toUpperCase();
    return ['FINISHED', 'FINAL', 'STATUS_FINAL', 'FT', 'AET', 'PK', 'COMPLETED'].some(k => s.includes(k));
};

// Helper: Extract numeric value safely
const parseLine = (val: any): number | null => {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'number') return val;
    const clean = String(val).replace(/[^\d.-]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
};

// Domain Logic: Spread
export const analyzeSpread = (match: Match): SpreadAnalysis => {
    // 1. Resolve Line
    const odds = match.closing_odds || match.current_odds || match.odds || {};
    let homeSpread = parseLine(odds.homeSpread || odds.spread);
    
    // Auto-invert if away spread is present but home is missing
    if (homeSpread === null && odds.awaySpread) {
        const away = parseLine(odds.awaySpread);
        if (away !== null) homeSpread = -away;
    }

    const isHomeFav = (homeSpread !== null && homeSpread < 0);
    
    // 2. Format Display
    let display = '-';
    if (homeSpread !== null) {
        if (homeSpread === 0) display = 'PK';
        else display = homeSpread > 0 ? `+${homeSpread}` : `${homeSpread}`;
    }

    // 3. Calculate Result
    let result: BetResult = null;
    if (isFinal(match.status) && homeSpread !== null) {
        const diff = (match.homeScore + homeSpread) - match.awayScore;
        if (Math.abs(diff) < 0.1) result = 'push';
        else result = diff > 0 ? 'won' : 'lost';
    }

    return {
        line: homeSpread,
        display,
        result,
        isHomeFav,
        label: match.sport === Sport.BASEBALL ? 'Run Line' : match.sport === Sport.HOCKEY ? 'Puck Line' : 'Spread'
    };
};

// Domain Logic: Total
export const analyzeTotal = (match: Match): TotalAnalysis => {
    const odds = match.closing_odds || match.current_odds || match.odds || {};
    const line = parseLine(odds.overUnder || odds.total);
    
    let result: TotalAnalysis['result'] = null;
    if (isFinal(match.status) && line !== null) {
        const totalScore = match.homeScore + match.awayScore;
        if (totalScore > line) result = 'OVER';
        else if (totalScore < line) result = 'UNDER';
        else result = 'PUSH';
    }

    return {
        line,
        display: line ? String(line) : '-',
        result
    };
};
