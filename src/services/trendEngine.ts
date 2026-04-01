
import { dbService } from './dbService';
import { supabase } from '../lib/supabase';
import { MatchInsight, TeamTrend } from '@/types/historicalIntel';

/**
 * The Trend Engine is responsible for identifying statistical anomalies 
 * and persistent streaks that provide a betting edge.
 * 
 * In a production environment, this would run:
 * 1. Nightly (for season-long trends)
 * 2. Post-Game (to update streaks)
 */
export const trendEngine = {
    /**
     * Identifies high-impact trends for a specific match.
     * This combines the 'Fast Cache' (team_trends) and historical logic.
     */
    async generateMatchInsights(matchId: string, homeTeamId: string, awayTeamId: string, sport: string): Promise<MatchInsight[]> {
        const insights: Partial<MatchInsight>[] = [];

        // 1. Fetch current cached trends
        const [homeTrend, awayTrend] = await Promise.all([
            dbService.getTeamTrend(homeTeamId, sport, 'HOME'),
            dbService.getTeamTrend(awayTeamId, sport, 'AWAY')
        ]);

        // 2. Logic: Home Dominance
        if (homeTrend && homeTrend.su_streak >= 10) {
            insights.push({
                match_id: matchId,
                team_id: homeTeamId,
                sport,
                insight_type: 'SU_STREAK',
                category: 'SITUATION',
                summary: `Won ${homeTrend.su_streak} Straight at Home`,
                impact_level: homeTrend.su_streak >= 15 ? 10 : 8
            });
        }

        // 3. Logic: ATS Dominance (The "Cover" Machine)
        if (homeTrend && homeTrend.ats_wins >= 8 && (homeTrend.ats_wins / (homeTrend.ats_wins + homeTrend.ats_losses) >= 0.8)) {
            insights.push({
                match_id: matchId,
                team_id: homeTeamId,
                sport,
                insight_type: 'ATS_DOMINANCE',
                category: 'HISTORY',
                summary: `${homeTrend.ats_wins}-${homeTrend.ats_losses} ATS at Home`,
                impact_level: 9
            });
        }

        // 4. Logic: Away Slump / Road Warriors
        if (awayTrend && awayTrend.su_streak <= -5) {
            insights.push({
                match_id: matchId,
                team_id: awayTeamId,
                sport,
                insight_type: 'SU_STREAK',
                category: 'SITUATION',
                summary: `Lost ${Math.abs(awayTrend.su_streak)} Straight Away`,
                impact_level: 7
            });
        }

        // In a real scenario, we would then batch-upsert these into match_insights table
        return insights as MatchInsight[];
    },

    /**
     * Official Analytics: Calculates tendencies for an officiating crew.
     */
    async calculateMatchOfficialIntel(matchId: string, officials: { name: string, position: string }[], sport: string) {
        // 1. Fetch profiles for all officials in the crew
        // 2. Aggregate their collective Home Win % and Over Rate
        // 3. Identify if this specific combination is an outlier
        // 4. Upsert into ref_intel table
    },

    /**
     * Hardened Backfill: Processes raw game results to build the team_trends cache.
     */
    async processGameResult(gameId: string) {
        // 1. Fetch raw result from game_results
        // 2. Calculate SU, ATS, and OU outcomes
        // 3. Atomic update to team_trends table (increment wins/losses, update streaks)

        // --- Official Integration ---
        // 4. Fetch officials for this game from ESPN summary
        // 5. For each official:
        //    a. Ensure profile exists in official_profiles
        //    b. Record result in official_game_history
        //    c. Recalculate official_profiles lifetime stats

        // 6. Set is_processed = true
        console.log(`Processing trends for game ${gameId}...`);
    }
};
