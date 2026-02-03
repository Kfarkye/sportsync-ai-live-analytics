export interface TeamSplitData {
    team: {
        name: string;
        logo_url: string;
        id?: string;
    };
    scoring: {
        home: number;
        away: number;
        delta: number;
    };
    recency?: {
        last_3_avg?: number;
    };
    games?: {
        total: number;
        home?: number;
        away?: number;
    };
}

export type SortOption = 'delta' | 'home' | 'away' | 'total' | 'home_ppg' | 'away_ppg' | 'last_3';
export type SortOrder = 'asc' | 'desc';

export interface ScoringSplitsResponse {
    data: TeamSplitData[]; // Changed from splits to data to match usage
    lastUpdated: string;
}
