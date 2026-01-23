/**
 * NBA Live Totals Control Engine v3.0 - Standalone Test Runner
 * Run with: npx ts-node engine/src/runTests.ts
 */

// Math utilities
function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

function safeDivide(n: number, d: number, fb = 0): number {
    return d === 0 ? fb : n / d;
}

function avg(a: number, b: number): number {
    return (a + b) / 2;
}

// Config
const CONFIG = {
    GAME_MINUTES: 48,
    FTA_COEFFICIENT: 0.44,
    BASE_STD: 13.0,
    HIGH_3PA_THRESHOLD: 0.40,
    HIGH_3PA_STD_MULTIPLIER: 1.15,
    VOL_STD_MIN: 2.0,
    VOL_STD_MAX: 18.0,
    TIME_SCALAR_MIN: 0.20,
    TIME_SCALAR_MAX: 1.00,
};

// Possessions
function computeTeamPossessions(box: any): number {
    return Math.max(0, box.fga + box.tov + 0.44 * box.fta - box.orb);
}

function computeRemPoss(remMin: number, paceBlend48: number): number {
    // Corrected rem_min to remMin
    return (remMin / 48) * paceBlend48;
}

// Expectations
function computeTeamLuckGap(box: any, exp3pPct: number, exp2pPct: number): number {
    const exp3pm = box.threePA * exp3pPct;
    const twoPA = box.fga - box.threePA;
    const twoPM = box.fgm - box.threePM;
    const exp2pm = twoPA * exp2pPct;
    return 3 * (exp3pm - box.threePM) + 2 * (exp2pm - twoPM);
}

// Volatility
function computeTimeScalar(remPoss: number): number {
    return clamp(Math.sqrt(Math.max(1, remPoss) / 100), CONFIG.TIME_SCALAR_MIN, CONFIG.TIME_SCALAR_MAX);
}

function computeBaseStd(threeParate: number): number {
    let base = CONFIG.BASE_STD;
    if (threeParate > CONFIG.HIGH_3PA_THRESHOLD) base *= CONFIG.HIGH_3PA_STD_MULTIPLIER;
    return base;
}

// Tests
let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
    try {
        if (fn()) {
            console.log(`✅ PASS: ${name}`);
            passed++;
        } else {
            console.log(`❌ FAIL: ${name}`);
            failed++;
        }
    } catch (e: any) {
        console.log(`❌ ERROR: ${name} - ${e.message}`);
        failed++;
    }
}

function approxEqual(a: number, b: number, tolerance = 0.01): boolean {
    return Math.abs(a - b) <= tolerance;
}

console.log('\n🏀 NBA Live Totals Engine v3.0 - Test Suite\n');
console.log('='.repeat(50));

// MATH TESTS
console.log('\n📐 Math Utilities\n');

test('clamp respects bounds', () => {
    return clamp(5, 0, 10) === 5 && clamp(-5, 0, 10) === 0 && clamp(15, 0, 10) === 10;
});

test('safeDivide handles zero', () => {
    return safeDivide(10, 0) === 0 && safeDivide(10, 0, 5) === 5 && safeDivide(10, 2) === 5;
});

test('avg computes average', () => {
    return avg(4, 6) === 5 && avg(0, 10) === 5;
});

// POSSESSIONS TESTS
console.log('\n📊 Possessions Module\n');

test('computeTeamPossessions formula correct', () => {
    const box = { fga: 80, tov: 12, fta: 20, orb: 10, fgm: 35, threePA: 30, threePM: 12, ftm: 15 };
    const poss = computeTeamPossessions(box);
    // 80 + 12 + 0.44*20 - 10 = 90.8
    return approxEqual(poss, 90.8);
});

test('possessions cannot be negative', () => {
    const weirdBox = { fga: 5, tov: 1, fta: 2, orb: 20, fgm: 3, threePA: 2, threePM: 1, ftm: 1 };
    return computeTeamPossessions(weirdBox) >= 0;
});

test('Rem_Poss unit conversion - NO 48x ERRORS', () => {
    // rem_min=24, paceBlend48=100 => (24/48)*100 = 50
    const result = computeRemPoss(24, 100);
    return result > 40 && result < 60 && approxEqual(result, 50);
});

// EXPECTATIONS TESTS
console.log('\n🎲 Expectations Module\n');

test('Luck sign: positive means cold shooting', () => {
    const box = { fga: 80, fgm: 38, threePA: 30, threePM: 10, fta: 20, ftm: 15, tov: 12, orb: 10 };
    const luckGap = computeTeamLuckGap(box, 0.40, 0.52);
    return luckGap > 0; // Expected > actual = cold
});

test('Luck sign: negative means hot shooting', () => {
    const box = { fga: 80, fgm: 38, threePA: 30, threePM: 15, fta: 20, ftm: 15, tov: 12, orb: 10 };
    const luckGap = computeTeamLuckGap(box, 0.35, 0.52);
    return luckGap < 0; // Actual > expected = hot
});

// VOLATILITY TESTS
console.log('\n📈 Volatility Module\n');

test('Edge_Z shrinks volatility with remPoss', () => {
    const ts100 = computeTimeScalar(100);
    const ts25 = computeTimeScalar(25);
    const ts10 = computeTimeScalar(10);
    return ts100 > ts25 && ts25 > ts10;
});

test('high 3PA rate increases volatility', () => {
    const baseNormal = computeBaseStd(0.35);
    const baseHigh = computeBaseStd(0.45);
    return baseHigh > baseNormal;
});

// SUMMARY
console.log('\n' + '='.repeat(50));
console.log(`\n📋 Results: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
    console.log('✅ All tests passed!\n');
    // Fix: cast process to any to access Node global exit safely
    (process as any).exit(0);
} else {
    console.log('❌ Some tests failed.\n');
    // Fix: cast process to any to access Node global exit safely
    (process as any).exit(1);
}
