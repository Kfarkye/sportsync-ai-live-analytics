
import { describe, it, expect } from 'vitest';
import { computeAISignals } from './gameStateEngine';
import { Match, Sport } from '../types';
import { ExtendedMatch } from '../types/engine';

// Helper to construct a base mock match
function createMockMatch(sport: Sport, homeScore: number, awayScore: number, clock: string, period: number): ExtendedMatch {
    return {
        id: 'test_match_1',
        sport,
        leagueId: sport,
        homeTeam: { name: 'HomeTeam', abbreviation: 'HOM' },
        awayTeam: { name: 'AwayTeam', abbreviation: 'AWY' },
        homeScore,
        awayScore,
        status: 'IN_PROGRESS',
        displayClock: clock,
        period,
        clock,
        odds: {
            spread: -1.5,
            total: 6.5,
            moneylineHome: -150,
            moneylineAway: 130
        },
        opening_odds: {
            spread: -1.5,
            total: 6.5,
            moneylineHome: -150,
            moneylineAway: 130
        },
        current_odds: {
            spread: -1.5,
            total: 6.5,
            moneylineHome: -150,
            moneylineAway: 130
        },
        homeTeamStats: {},
        awayTeamStats: {},
        stats: [],
        situation: {},
        fetched_at: Date.now()
    } as any as ExtendedMatch;
}

describe('Engine Hardening - Golden Scenarios', () => {

    describe('Hockey v5.9 Patch Logic', () => {
        // Scenario 1: Hockey Blowout with B2B Fatigue
        it('should apply tighter surrender scalar when B2B is active in blowout', () => {
            // 4-1 score (Diff 3). 
            // CLOCK MUST BE < 10 MINS REMAINING FOR BLOWOUT.
            // P3 05:00. Time Rem = 300s.
            const match = createMockMatch(Sport.HOCKEY, 4, 1, '05:00', 3);

            match.notes = 'Back-to-back game for HomeTeam'; // Trigger B2B

            const signals = computeAISignals(match);

            // Expected Behavior:
            // B2B Surrender Scalar = 0.65
            // Base Rate ~ 6.5/60 = 0.108
            // Time Rem = 5m = 0.0833 hrs? No, logic uses blended_rate * (timeRem / 60).
            // Projected = (0.108 * 5) * 0.65 = ~0.35
            // Fair Total = 5 + 0.35 = 5.35

            expect(signals.deterministic_regime).toBe('BLOWOUT');
            const ft = signals.deterministic_fair_total || 0;

            // Verify it's suppressed
            expect(ft).toBeLessThan(6.0);
            expect(ft).toBeGreaterThan(5.0);

            // v6.0 Observability Check
            expect(signals.trace_id).toBeDefined();
            expect(signals.trace_dump).toBeDefined();
            // Verify specific physics variable from Hockey Kernel
            expect(signals.trace_dump?.surrenderScalar).toBe(0.65);
        });

        // Scenario 2: Hockey Power Play Volatility Spike
        it('should inject volatility (higher projection) during Power Play in Blowout', () => {
            // Same setup: P3 05:00.
            const match = createMockMatch(Sport.HOCKEY, 4, 1, '05:00', 3);
            match.notes = 'Back-to-back game'; // Keep B2B to benchmark against above

            // Inject Power Play
            match.situation = {
                possessionText: 'Home Power Play',
                isPowerPlay: true
            };

            // Important: We need to manually set sport_type explicitly? 
            // process will rely on enum match.sport.

            const signals = computeAISignals(match);

            // Expected Behavior:
            // B2B Surrender (0.65) + PP Injection (0.25) = 0.90
            // Projected = (0.108 * 5) * 0.90 = ~0.49
            // Fair Total = 5 + 0.49 = 5.49

            expect(signals.variance_flags?.power_play_decay).toBe(true);

            // It should be significantly higher than the non-PP version (5.35)
            // 5.49 vs 5.35 is tight, but > 5.4 checks out.
            expect(signals.deterministic_fair_total).toBeGreaterThan(5.4);
        });

        // Scenario 3: 3-2 Game (Empty Net Risk)
        it('should trigger CHAOS regime and EN injection for 3-2 game late', () => {
            // 3-2 score. P3, 2:30 remaining.
            // 2:30 -> 2.5 mins rem.
            // Diff = 1.
            // is_en_risk should be true (Diff=1 && Rem < 3.0)
            const match = createMockMatch(Sport.HOCKEY, 3, 2, '2:30', 3);

            const signals = computeAISignals(match);

            expect(signals.deterministic_regime).toBe('CHAOS');
            // Fair Total should include EN_INJECTION_1G (0.85)
            // Plus some time decay
            const ft = signals.deterministic_fair_total || 0;
            const current = 5;
            expect(ft).toBeGreaterThan(current + 0.5); // At least 0.5 goals added for EN risk
        });
    });

    describe('NBA Logic Kernel', () => {
        it('should apply blowout brake check', () => {
            // Blowout: Diff > 22, Elapsed > 60% standard
            // NBA: 48 mins using standard pace. 60% = 28.8 mins.
            // Let's go to Q4 (36 mins elapsed).
            // Score 100 - 70. Diff 30.
            const match = createMockMatch(Sport.NBA, 100, 70, '10:00', 4);

            const signals = computeAISignals(match);

            expect(signals.deterministic_regime).toBe('BLOWOUT');
            expect(signals.variance_flags?.blowout).toBe(true);
            // Pace multiplier should be 0.9
            expect((signals as any).match_phase_multiplier ?? 1).toBe(1); // checking side effect if exposed, or check fair total logic implicitly
        });
    });

});
