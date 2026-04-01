
export type InsightType = 'SU_STREAK' | 'ATS_DOMINANCE' | 'TOTAL_TREND' | 'H2H_DOMINANCE';
export type InsightCategory = 'STADIUM' | 'SITUATION' | 'HISTORY';

export interface MatchInsight {
    id: string;
    match_id: string;
    team_id?: string;
    sport: string;
    insight_type: InsightType;
    category: InsightCategory;
    summary: string;
    detail?: string;
    impact_level: number;
    is_active: boolean;
}

export interface TeamTrend {
    team_id: string;
    sport: string;
    context: 'OVERALL' | 'HOME' | 'AWAY';
    su_wins: number;
    su_losses: number;
    su_streak: number;
    ats_wins: number;
    ats_losses: number;
    ats_pushes: number;
    ats_streak: number;
    ou_overs: number;
    ou_unders: number;
    ou_pushes: number;
}
