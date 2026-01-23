/**
 * useChatContext Hook
 * 
 * Google-Grade Context Management for AI Chat
 */

import { useEffect, useCallback, useRef } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { pregameIntelService } from '../services/pregameIntelService';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface MatchContext {
    match_id: string;
    home_team: string;
    away_team: string;
    home_team_id?: string;  // ESPN team ID for injury lookups
    away_team_id?: string;  // ESPN team ID for injury lookups
    league: string;
    sport?: string;
    start_time?: string;
    status?: string;
    // Live Telemetry
    home_score?: number;
    away_score?: number;
    clock?: string;
    period?: number;
    pregame_intel?: any;
}

interface ChatContextState {
    // Session Management
    session_id: string;
    conversation_id: string | null;

    // Current Context
    current_match: MatchContext | null;

    // Behavioral Tracking
    viewed_matches: string[];
    last_match_viewed_at: number | null;

    // Actions
    setCurrentMatch: (match: MatchContext | null) => void;
    setConversationId: (id: string | null) => void;
    trackMatchView: (match_id: string) => void;
    clearContext: () => void;
}

// Generate a unique session ID
const generateSessionId = (): string => {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
};

// ═══════════════════════════════════════════════════════════════════════════
// ZUSTAND STORE (Persisted to localStorage)
// ═══════════════════════════════════════════════════════════════════════════

export const useChatContextStore = create<ChatContextState>()(
    persist(
        (set, get) => ({
            // Initialize with a session ID
            session_id: generateSessionId(),
            conversation_id: null,
            current_match: null,
            viewed_matches: [],
            last_match_viewed_at: null,

            setCurrentMatch: (match) => set({
                current_match: match,
                last_match_viewed_at: match ? Date.now() : null
            }),

            setConversationId: (id) => set({ conversation_id: id }),

            trackMatchView: (match_id) => {
                const { viewed_matches } = get();
                // Keep last 10 viewed matches
                const updated = [match_id, ...viewed_matches.filter(m => m !== match_id)].slice(0, 10);
                set({
                    viewed_matches: updated,
                    last_match_viewed_at: Date.now()
                });
            },

            clearContext: () => set({
                current_match: null,
                conversation_id: null,
                viewed_matches: [],
                last_match_viewed_at: null
            })
        }),
        {
            name: 'sharp-edge-chat-context',
            partialize: (state) => ({
                session_id: state.session_id,
                conversation_id: state.conversation_id,
                viewed_matches: state.viewed_matches
            })
        }
    )
);

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HOOK
// ═══════════════════════════════════════════════════════════════════════════

interface UseChatContextOptions {
    /** Current match the user is viewing (from MatchDetails page) */
    match?: any;
}

export function useChatContext(options: UseChatContextOptions = {}) {
    const { match } = options;
    const store = useChatContextStore();
    const viewStartTime = useRef<number>(Date.now());

    // ─────────────────────────────────────────────────────────────────────
    // EFFECT: Update current match context when viewing a match
    // ─────────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (match?.id) {
            // Map properties correctly from UI Match object to context payload
            // Including fallbacks for DB-format objects
            const matchContext: MatchContext = {
                match_id: match.id,
                home_team: match.homeTeam?.name || match.home_team_name || match.home_team || 'Home Team',
                away_team: match.awayTeam?.name || match.away_team_name || match.away_team || 'Away Team',
                league: match.leagueId || match.league_id || match.league || 'Unknown',
                sport: match.sport,
                start_time: typeof match.startTime === 'string' ? match.startTime :
                    match.startTime?.toISOString?.() || match.start_time,
                status: match.status,
                // Reactive Live Telemetry
                home_score: match.homeScore || match.home_score || 0,
                away_score: match.awayScore || match.away_score || 0,
                clock: match.displayClock || match.display_clock || '',
                period: match.period
            };

            store.setCurrentMatch(matchContext);
            store.trackMatchView(match.id);
            viewStartTime.current = Date.now();

            // Background Fetch: Ground the AI with professional intel (Gemini 3)
            pregameIntelService.fetchIntel(
                match.id,
                matchContext.home_team,
                matchContext.away_team,
                match.sport || '',
                matchContext.league || '',
                matchContext.start_time
            ).then(intel => {
                if (intel) {
                    store.setCurrentMatch({
                        ...matchContext,
                        pregame_intel: {
                            headline: intel.headline,
                            pick: intel.recommended_pick,
                            summary: intel.briefing,
                            logic_audit: intel.logic_authority,
                            key_factors: (intel.cards || []).slice(0, 3).map(c => ({
                                thesis: c.thesis,
                                impact: c.impact
                            }))
                        }
                    });
                }
            }).catch(() => null);
        } else {
            store.setCurrentMatch(null);
        }

        return () => { };
    }, [match?.id, match?.homeScore, match?.awayScore, match?.displayClock, match?.status]);

    const getChatPayload = useCallback(() => {
        // 🆕 Build live snapshot from current match for real-time AI awareness
        const liveSnapshot = match ? {
            score: `${match.awayScore ?? match.away_score ?? 0}-${match.homeScore ?? match.home_score ?? 0}`,
            clock: match.displayClock ?? match.display_clock ?? '',
            period: match.period ?? 0,
            status: match.status ?? 'SCHEDULED',
            spread: match.current_odds?.spread ?? match.odds?.spread ?? null,
            total: match.current_odds?.total ?? match.odds?.overUnder ?? null,
            moneyline_home: match.current_odds?.moneylineHome ?? null,
            moneyline_away: match.current_odds?.moneylineAway ?? null,
            timestamp: Date.now()
        } : null;

        return {
            session_id: store.session_id,
            conversation_id: store.conversation_id,
            current_match: store.current_match,
            // 🆕 REAL-TIME INJECTION: Client sends freshest data it has
            live_snapshot: liveSnapshot
        };
    }, [store.session_id, store.conversation_id, store.current_match, match]);

    const handleChatResponse = useCallback((response: any) => {
        if (response.conversation_id && response.conversation_id !== store.conversation_id) {
            store.setConversationId(response.conversation_id);
        }
    }, [store.conversation_id]);

    return {
        session_id: store.session_id,
        conversation_id: store.conversation_id,
        current_match: store.current_match,
        viewed_matches: store.viewed_matches,
        getChatPayload,
        handleChatResponse,
        clearContext: store.clearContext,
        hasActiveMatch: !!store.current_match,
        recentMatchId: store.viewed_matches[0] || null
    };
}

export default useChatContext;
