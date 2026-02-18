import { Match } from './index.ts';
// import { BetResult } from './odds.ts'; // Don't alias BetResult here to avoid confusion

export type BadgeType = 'live' | 'final' | 'scheduled' | 'LIVE';

export interface MatchRowProps {
    match: Match;
    onSelect: (match?: Match) => void;
    showAnalysis?: boolean;
    isPinned?: boolean;
    isLive?: boolean;
    isFinal?: boolean;
    onTogglePin?: (e: any) => void;
}

export interface WeekOption {
    label: string;
    value: string;
    startDate?: Date;
    endDate?: Date;
    isCurrent?: boolean;
}

export interface SpreadResult {
    covered: boolean;
    line: string;
    isPush: boolean;
    teamId: string;
}

export interface TotalResult {
    hit: 'OVER' | 'UNDER' | 'PUSH';
    line: number;
    actual: number;
}

export interface BettingResult {
    spread: SpreadResult | null;
    total: TotalResult | null;
}
