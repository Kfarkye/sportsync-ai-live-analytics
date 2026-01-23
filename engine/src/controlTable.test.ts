/**
 * NBA Live Totals Control Engine v3.0 - Test Suite
 * 
 * Unit tests, property tests, and golden fixtures.
 * All tests must pass before deployment.
 */

import { describe, it, expect } from 'vitest';

// Import engine modules
import { CONFIG } from './config';
import { clamp, safeDivide, avg, roundTo } from './math';
import {
    computeTeamPossessions,
    computeGamePossessions,
    computeLivePace48,
    computeBlendWeight,
    computePaceBlend48,
    computeRemPoss,
    computePossessionsBundle
} from './possessions';
import {
    computeTeamLuckGap,
    computeGameLuckGap,
    computeTeamStructPpp,
    computeAnchorPpp,
    computeProjPpp,
    computeExpectationsBundle
} from './expectations';
import {
    computeTeamLineupAdjPpp,
    computeGameLineupAdjPpp,
    computeRawProj
} from './lineup';
import {
    computeFoulEv,
    computeOtEv,
    computeModelFair
} from './endgame';
import {
    computeBaseStd,
    computeTimeScalar,
    computeVolStd,
    computeEdgeZ
} from './volatility';
import { computeControlTable, validateControlTableInput } from './controlTable';
import { TeamBoxLine, ControlTableInput } from './types';

// ============================================================================
// MATH UTILITIES TESTS
// ============================================================================

describe('Math Utilities', () => {
    it('clamp respects bounds', () => {
        expect(clamp(5, 0, 10)).toBe(5);
        expect(clamp(-5, 0, 10)).toBe(0);
        expect(clamp(15, 0, 10)).toBe(10);
    });

    it('safeDivide handles zero denominator', () => {
        expect(safeDivide(10, 0)).toBe(0);
        expect(safeDivide(10, 0, 5)).toBe(5);
        expect(safeDivide(10, 2)).toBe(5);
    });

    it('avg computes average', () => {
        expect(avg(4, 6)).toBe(5);
        expect(avg(0, 10)).toBe(5);
    });

    it('roundTo rounds correctly', () => {
        expect(roundTo(3.14159, 2)).toBe(3.14);
        expect(roundTo(3.145, 2)).toBe(3.15);
    });
});

// ============================================================================
// POSSESSIONS TESTS
// ============================================================================

describe('Possessions Module', () => {
    const sampleBox: TeamBoxLine = {
        fga: 80,
        fgm: 35,
        threePA: 30,
        threePM: 12,
        fta: 20,
        ftm: 15,
        tov: 12,
        orb: 10
    };

    it('computeTeamPossessions uses correct formula', () => {
        // Poss = FGA + TOV + 0.44*FTA - ORB
        // = 80 + 12 + 0.44*20 - 10 = 80 + 12 + 8.8 - 10 = 90.8
        const poss = computeTeamPossessions(sampleBox);
        expect(poss).toBeCloseTo(90.8, 1);
    });

    it('possessions cannot be negative', () => {
        const weirdBox: TeamBoxLine = {
            fga: 5, fgm: 3, threePA: 2, threePM: 1,
            fta: 2, ftm: 1, tov: 1, orb: 20 // High ORB
        };
        expect(computeTeamPossessions(weirdBox)).toBeGreaterThanOrEqual(0);
    });

    it('computeLivePace48 scales to 48 minutes', () => {
        // 50 poss in 24 min = 100 pace/48
        expect(computeLivePace48(50, 24)).toBe(100);
        // 60 poss in 24 min = 120 pace/48
        expect(computeLivePace48(60, 24)).toBe(120);
    });

    it('computeBlendWeight bounds correctly', () => {
        expect(computeBlendWeight(0)).toBe(0);
        expect(computeBlendWeight(24)).toBe(0.5);
        expect(computeBlendWeight(48)).toBe(1);
        expect(computeBlendWeight(60)).toBe(1); // Clamped
    });

    it('computeRemPoss uses pace per 48 correctly', () => {
        // rem_min=24, paceBlend48=100 => (24/48)*100 = 50
        expect(computeRemPoss(24, 100)).toBe(50);
        // rem_min=12, paceBlend48=100 => (12/48)*100 = 25
        expect(computeRemPoss(12, 100)).toBe(25);
    });

    it('Rem_Poss unit conversion - NO 48x ERRORS', () => {
        // This is the critical test for unit coherence
        // If remMin=24 and pace=100, remPoss should be ~50, not ~2400
        const result = computeRemPoss(24, 100);
        expect(result).toBeLessThan(60); // Must be reasonable
        expect(result).toBeGreaterThan(40);
        expect(result).toBeCloseTo(50, 0);
    });
});

// ============================================================================
// EXPECTATIONS TESTS
// ============================================================================

describe('Expectations Module', () => {
    const box: TeamBoxLine = {
        fga: 80, fgm: 38,
        threePA: 30, threePM: 10, // Act 3P% = 33%
        fta: 20, ftm: 15,
        tov: 12, orb: 10
    };

    it('Luck sign convention: positive means cold shooting', () => {
        // If expected > actual, luck is positive (shot cold, will revert up)
        const exp3pPct = 0.40; // Expected 40%
        // Act 3PM = 10, Exp 3PM = 30 * 0.40 = 12
        // 3P luck = 3 * (12 - 10) = 6 (positive = cold)

        const luckGap = computeTeamLuckGap(box, exp3pPct, 0.52);
        expect(luckGap).toBeGreaterThan(0); // Cold shooting
    });

    it('Luck sign convention: negative means hot shooting', () => {
        // If actual > expected, luck is negative (shot hot, will revert down)
        const hotBox = { ...box, threePM: 15 }; // Actually hit 50%
        const luckGap = computeTeamLuckGap(hotBox, 0.35, 0.52);
        expect(luckGap).toBeLessThan(0); // Hot shooting
    });

    it('computeAnchorPpp is total/pace', () => {
        // closeTotal=220, pacePre48=100 => 220/100 = 2.2
        expect(computeAnchorPpp(220, 100)).toBe(2.2);
        expect(computeAnchorPpp(230, 100)).toBe(2.3);
    });

    it('computeProjPpp blends with weight', () => {
        // structPpp=2.4, anchorPpp=2.2, w=0.5
        // projPpp = 2.4*0.5 + 2.2*0.5 = 2.3
        expect(computeProjPpp(2.4, 2.2, 0.5)).toBe(2.3);
    });
});

// ============================================================================
// LINEUP TESTS
// ============================================================================

describe('Lineup Module', () => {
    it('EPM/100 conversion produces PPP deltas', () => {
        // sumCurrentEpm=5, avgTeamEpm=0 => (5-0)/100 = 0.05 PPP
        const adj = computeTeamLineupAdjPpp(5, 0);
        expect(adj).toBe(0.05);

        // sumCurrentEpm=10, avgTeamEpm=5 => (10-5)/100 = 0.05 PPP
        expect(computeTeamLineupAdjPpp(10, 5)).toBe(0.05);

        // sumCurrentEpm=-3, avgTeamEpm=0 => (-3-0)/100 = -0.03 PPP
        expect(computeTeamLineupAdjPpp(-3, 0)).toBe(-0.03);
    });

    it('computeRawProj adds score and remaining projection', () => {
        // currentScore=100, remPoss=50, projPpp=2.2, lineupAdj=0.05
        // rawProj = 100 + 50*(2.2+0.05) = 100 + 50*2.25 = 100 + 112.5 = 212.5
        expect(computeRawProj(100, 50, 2.2, 0.05)).toBe(212.5);
    });
});

// ============================================================================
// VOLATILITY TESTS
// ============================================================================

describe('Volatility Module', () => {
    it('Edge_Z shrinks volatility with remPoss', () => {
        // As remPoss decreases, timeScalar decreases, volStd decreases
        const timeScalar100 = computeTimeScalar(100);
        const timeScalar25 = computeTimeScalar(25);
        const timeScalar10 = computeTimeScalar(10);

        expect(timeScalar100).toBeGreaterThan(timeScalar25);
        expect(timeScalar25).toBeGreaterThan(timeScalar10);

        // Vol std also decreases
        const volStd100 = computeVolStd(13, timeScalar100);
        const volStd25 = computeVolStd(13, timeScalar25);
        expect(volStd100).toBeGreaterThan(volStd25);
    });

    it('computeEdgeZ returns correct sign', () => {
        // modelFair=230, liveMkt=220, volStd=10 => (230-220)/10 = 1.0 (OVER)
        expect(computeEdgeZ(230, 220, 10)).toBe(1.0);
        // modelFair=210, liveMkt=220, volStd=10 => (210-220)/10 = -1.0 (UNDER)
        expect(computeEdgeZ(210, 220, 10)).toBe(-1.0);
    });

    it('high 3PA rate increases base volatility', () => {
        const baseNormal = computeBaseStd(0.35);
        const baseHigh = computeBaseStd(0.45);
        expect(baseHigh).toBeGreaterThan(baseNormal);
        expect(baseHigh).toBeCloseTo(baseNormal * CONFIG.HIGH_3PA_STD_MULTIPLIER, 1);
    });
});

// ============================================================================
// ENDGAME TESTS
// ============================================================================

describe('Endgame Module', () => {
    it('Foul EV is 0 when remMin > threshold', () => {
        expect(computeFoulEv(5, 10, 3, 3, true, true)).toBe(0);
        expect(computeFoulEv(5, 5, 3, 3, true, true)).toBe(0);
    });

    it('Foul EV increases in close games late', () => {
        const foulEv2min = computeFoulEv(3, 2, 3, 3, true, true);
        const foulEv1min = computeFoulEv(3, 1, 3, 3, true, true);
        expect(foulEv1min).toBeGreaterThanOrEqual(foulEv2min);
    });

    it('In blowouts late, Foul EV approaches 0', () => {
        // 20 point lead with 1 min left - no intentional fouling
        const foulEv = computeFoulEv(20, 1, 3, 3, true, true);
        expect(foulEv).toBe(0);
    });

    it('OT EV is 0 in blowouts', () => {
        expect(computeOtEv(15, 0.5)).toBe(0);
        expect(computeOtEv(20, 1)).toBe(0);
    });

    it('OT EV is positive in tied games late', () => {
        expect(computeOtEv(0, 0.5)).toBeGreaterThan(0);
    });
});

// ============================================================================
// CONTROL TABLE INTEGRATION TESTS
// ============================================================================

describe('Control Table Integration', () => {
    const validInput: ControlTableInput = {
        mktAnchorTotal: 220,
        liveMarketTotal: 222,
        elapsedMin: 24,
        remMin: 24,
        ptsHome: 55,
        ptsAway: 50,
        homeBox: {
            fga: 45, fgm: 20, threePA: 15, threePM: 6,
            fta: 10, ftm: 8, tov: 6, orb: 5
        },
        awayBox: {
            fga: 42, fgm: 18, threePA: 14, threePM: 5,
            fta: 8, ftm: 6, tov: 7, orb: 4
        },
        exp3pPctHome: 0.36,
        exp2pPctHome: 0.52,
        exp3pPctAway: 0.36,
        exp2pPctAway: 0.52,
        pacePre48: 100,
        sumCurrentEpmHome: 2,
        avgTeamEpmHome: 0,
        sumCurrentEpmAway: -1,
        avgTeamEpmAway: 0,
    };

    it('computeControlTable produces valid output', () => {
        const output = computeControlTable(validInput);

        // All required fields present
        expect(output.anchorPpp).toBeDefined();
        expect(output.modelFair).toBeDefined();
        expect(output.edgeZ).toBeDefined();
        expect(output.volStd).toBeDefined();
        expect(output.remPoss).toBeDefined();
        expect(output.luckGap).toBeDefined();
        expect(output.structPpp).toBeDefined();
    });

    it('modelFair is reasonable', () => {
        const output = computeControlTable(validInput);
        // Current score is 105, about half the game done at typical pace
        // Model fair should be somewhere around 200-230
        expect(output.modelFair).toBeGreaterThan(180);
        expect(output.modelFair).toBeLessThan(260);
    });

    it('validateControlTableInput catches errors', () => {
        const badInput = { ...validInput, elapsedMin: -5 };
        const errors = validateControlTableInput(badInput);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.includes('elapsedMin'))).toBe(true);
    });

    it('output is deterministic', () => {
        const output1 = computeControlTable(validInput);
        const output2 = computeControlTable(validInput);

        expect(output1.modelFair).toBe(output2.modelFair);
        expect(output1.edgeZ).toBe(output2.edgeZ);
        expect(output1.remPoss).toBe(output2.remPoss);
    });
});

// ============================================================================
// GOLDEN FIXTURE TEST
// ============================================================================

describe('Golden Fixture', () => {
    it('matches expected output for known game state', () => {
        // This is a "golden" test case with known correct outputs
        const fixture: ControlTableInput = {
            mktAnchorTotal: 225,
            liveMarketTotal: 228,
            elapsedMin: 30,
            remMin: 18,
            ptsHome: 70,
            ptsAway: 65,
            homeBox: {
                fga: 60, fgm: 27, threePA: 22, threePM: 8,
                fta: 14, ftm: 11, tov: 8, orb: 6
            },
            awayBox: {
                fga: 55, fgm: 24, threePA: 18, threePM: 7,
                fta: 12, ftm: 9, tov: 9, orb: 5
            },
            exp3pPctHome: 0.37,
            exp2pPctHome: 0.53,
            exp3pPctAway: 0.36,
            exp2pPctAway: 0.52,
            pacePre48: 102,
            sumCurrentEpmHome: 3,
            avgTeamEpmHome: 0.5,
            sumCurrentEpmAway: 1,
            avgTeamEpmAway: 0,
        };

        const output = computeControlTable(fixture);

        // Verify key computed values are in expected ranges
        expect(output.w).toBeCloseTo(30 / 48, 2); // ~0.625
        expect(output.anchorPpp).toBeCloseTo(225 / 102, 2); // ~2.206
        expect(output.remPoss).toBeGreaterThan(30);
        expect(output.remPoss).toBeLessThan(50);

        // Model fair should be around 220-235 given current trajectory
        expect(output.modelFair).toBeGreaterThan(215);
        expect(output.modelFair).toBeLessThan(245);

        // Edge Z should be small (model close to market)
        expect(Math.abs(output.edgeZ)).toBeLessThan(2);
    });
});
