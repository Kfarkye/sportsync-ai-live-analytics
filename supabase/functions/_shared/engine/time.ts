
import { Sport } from "../types.ts";
import { ExtendedMatch } from "../types.ts";
import { SYSTEM_GATES, REGEX as GLOBAL_REGEX } from "../gates.ts";

// Inlined to avoid circular dependency with utils.ts
function isBasketball(s: Sport): boolean {
    const sport = String(s).toLowerCase();
    return sport === 'nba' || sport === 'basketball' || sport.includes('college-basketball') || sport.includes('ncaab');
}

function isFootball(s: Sport): boolean {
    return s === Sport.NFL || s === Sport.COLLEGE_FOOTBALL;
}

// Local Regex Overrides or fallbacks
const REGEX = {
    FINAL: GLOBAL_REGEX.FINAL,
    SOCCER_HT: GLOBAL_REGEX.SOCCER_HT,
    CLOCK_MMSS: GLOBAL_REGEX.CLOCK_MMSS,
    // Trap for "Final" variations often found in raw feeds
    STATUS_FINAL: /(?:final|finished|ft|end\s*of\s*game|post)/i
};

function clamp(n: number, lo: number, hi: number): number {
    if (Number.isNaN(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
}

function parseClockToSeconds(clockRaw: string): number {
    const raw = String(clockRaw || "0:00").trim().toLowerCase();

    if (REGEX.FINAL.test(raw)) return 0;

    if (raw.includes("+") && !raw.includes(":")) {
        const [baseRaw, addedRaw] = raw.split("+");
        return Math.max(0, ((parseFloat(baseRaw) || 0) + (parseFloat(addedRaw) || 0)) * 60);
    }

    const m = raw.match(REGEX.CLOCK_MMSS);
    if (!m) return 0;
    const mins = parseFloat(m[1]) || 0;
    const secs = parseFloat(m[2]) || 0;

    return Math.max(0, mins * 60 + secs);
}

function parseSoccerElapsedSeconds(period: number, clockRaw: string): number {
    const raw = (clockRaw || "").trim().toLowerCase();
    if (REGEX.SOCCER_HT.test(raw)) return SYSTEM_GATES.SOCCER_HALF_SECONDS;
    if (REGEX.FINAL.test(raw) || /\b(full)\b/.test(raw)) return SYSTEM_GATES.SOCCER_REG_SECONDS;

    const t = parseClockToSeconds(raw);
    if (period >= 2 && t < SYSTEM_GATES.SOCCER_HALF_SECONDS) {
        return clamp(SYSTEM_GATES.SOCCER_HALF_SECONDS + t, 0, SYSTEM_GATES.SOCCER_REG_SECONDS + SYSTEM_GATES.SOCCER_MAX_STOPPAGE);
    }
    return clamp(t, 0, SYSTEM_GATES.SOCCER_REG_SECONDS + SYSTEM_GATES.SOCCER_MAX_STOPPAGE);
}

export function isCollegeBasketball(match: any): boolean {
    const s = match.sport;
    const lid = match.leagueId?.toLowerCase() || '';
    return s === Sport.COLLEGE_BASKETBALL ||
        lid.includes('college-basketball') ||
        lid.includes('ncaab');
}

export function getBaseballInning(match: ExtendedMatch): number {
    return Math.max(1, Number(match.period) || 1);
}

export function getBaseballState(match: ExtendedMatch) {
    const sit = (match as any).situation || {};
    const txt = String(sit.possessionText || sit.inningHalf || "").toLowerCase();
    return {
        half: (txt.includes("bot") || txt.includes("btm")) ? "BOTTOM" : "TOP",
        outs: clamp(Number(sit.outs) || 0, 0, 3),
        inning: Math.max(1, Number(match.period) || 1)
    };
}

/**
 * 🛡️ ROBUST TIME PARSER
 * Handles "Zombie Games" where feed status lags behind reality.
 * Priorities:
 * 1. Explicit "Final" Status -> Returns Max Time
 * 2. Wall Clock Sanity Check -> If game started >3.5h ago, assume Final
 * 3. Score Sanity Check -> If score is huge but time is early, assume Final
 * 4. Standard Parsing
 */
export function getElapsedSeconds(match: ExtendedMatch): number {
    const sport = match.sport;
    const status = String(match.status || "").toUpperCase();

    // 1. FAST EXIT: Explicit Final Status
    if (REGEX.STATUS_FINAL.test(status)) {
        if (isBasketball(sport)) return isCollegeBasketball(match) ? 2400 : 2880;
        if (isFootball(sport)) return 3600;
        if (sport === Sport.HOCKEY) return 3600;
        if (sport === Sport.SOCCER) return SYSTEM_GATES.SOCCER_REG_SECONDS;
        if (sport === Sport.BASEBALL) return 9 * SYSTEM_GATES.MLB.SEC_PER_INNING;
        return 3600;
    }

    // 2. SETUP VARIABLES
    let period = match.period || 1;
    const clock = match.displayClock || "0:00";
    const clockUp = clock.toUpperCase();
    const startMs = match.startTime ? new Date(match.startTime).getTime() : 0;
    const nowMs = Date.now();
    const hoursSinceStart = startMs ? (nowMs - startMs) / 36e5 : 0; // Hours

    // 3. ZOMBIE PROTOCOL: Wall Clock Override
    // If the game started 3.5+ hours ago (NBA) or 4.5+ hours (NFL/MLB), 
    // and we aren't explicitly "Final" yet, the feed is likely dead/stuck.
    // Force "Final" state to prevent "Pre-Game" math on finished games.
    const ZOMBIE_THRESHOLD = isBasketball(sport) ? 3.5 : 4.5;
    if (startMs > 0 && hoursSinceStart > ZOMBIE_THRESHOLD) {
        if (isBasketball(sport)) return isCollegeBasketball(match) ? 2400 : 2880;
        if (isFootball(sport)) return 3600;
        if (sport === Sport.HOCKEY) return 3600;
        if (sport === Sport.SOCCER) return SYSTEM_GATES.SOCCER_REG_SECONDS;
    }

    // 4. SCORE SANITY CHECK (The "Impossible Under" Fix)
    // If it's "Period 1" but the score is 133-107, the feed is broken.
    if (isBasketball(sport)) {
        const totalScore = (Number((match as any).home_score) || 0) + (Number((match as any).away_score) || 0);
        // NBA Threshold: >180 pts (Impossible in 1st half) | NCAAB Threshold: >120 pts
        const sanityThreshold = isCollegeBasketball(match) ? 120 : 180;

        if (period <= 2 && totalScore > sanityThreshold) {
            return isCollegeBasketball(match) ? 2400 : 2880; // Force Final
        }
    }

    // 5. STANDARD PARSING LOGIC
    const isHalftime = status.includes("HALF") || status.includes("HT") ||
        clockUp.includes("HALF") || clockUp.includes("HT");
    const isBetweenPeriods = status.includes("END") || status.includes("BREAK") ||
        clockUp.includes("END") || clockUp.includes("BREAK");

    // Fix Period Parsing from Status Text
    if (period === 1) {
        if (status.includes("Q2") || status.includes("2ND")) period = 2;
        if (status.includes("Q3") || status.includes("3RD")) period = 3;
        if (status.includes("Q4") || status.includes("4TH")) period = 4;
        if (status.includes("P2") || status.includes("2ND PER")) period = 2;
        if (status.includes("P3") || status.includes("3RD PER")) period = 3;
        if (status.includes("OT") || status.includes("OVERTIME")) period = 5;
    }

    if (isBasketball(sport)) {
        const isNCAAB = isCollegeBasketball(match);
        const t = parseClockToSeconds(clock);
        const secPerPeriod = isNCAAB ? 1200 : 720;
        const regs = isNCAAB ? 2 : 4;
        const fullGameSecs = isNCAAB ? 2400 : 2880;

        if (isHalftime && isNCAAB) return 1200;
        if (isHalftime && !isNCAAB) return 1440;

        // Overtime logic
        if (period > regs) return (regs * secPerPeriod) + ((period - regs - 1) * 300) + clamp(300 - t, 0, 300);

        // Between periods logic
        if ((t === 0 || isBetweenPeriods) && period <= regs) return period * secPerPeriod;

        // Standard elapsed calculation
        let elapsed = ((period - 1) * secPerPeriod) + clamp(secPerPeriod - t, 0, secPerPeriod);

        // 🛡️ WALL-CLOCK FALLBACK (Enhanced for "Time Freeze")
        // If elapsed is 0 (or very low) but game started > 10 mins ago, trust Wall Clock.
        if (elapsed < 60 && startMs > 0 && hoursSinceStart > 0.15) {
            // SCALING FACTOR: 1 Game Minute ≈ 2.5 Wall Minutes
            const diffMins = (nowMs - startMs) / 60000;
            const estimatedGameMins = diffMins / 2.5;
            elapsed = Math.min(estimatedGameMins * 60, fullGameSecs);
        }

        return elapsed;
    }

    if (isFootball(sport)) {
        const t = parseClockToSeconds(clock);
        const secPerQ = 900;

        if (isHalftime) return 1800;

        let periodElapsed = 0;
        if (t > 900) {
            return t; // Data error, assume raw seconds
        } else if (t > 720 && period === 1) {
            // Clock > 12:00 in Q1? likely raw seconds remaining
            periodElapsed = Math.max(0, 900 - t);
        } else if (t < 180 && period === 1) {
            periodElapsed = t; // Low clock Q1
        } else {
            periodElapsed = Math.max(0, 900 - t);
        }

        if (period > 4) return 3600 + clamp(600 - t, 0, 600);
        if (isBetweenPeriods) return period * secPerQ;

        let elapsed = ((period - 1) * 900) + periodElapsed;

        // Football Wall-Clock Fallback
        if (elapsed < 60 && startMs > 0 && hoursSinceStart > 0.2) {
            const diffMins = (nowMs - startMs) / 60000;
            // Scaling: 1 Game Minute ≈ 3 Wall Minutes (NFL is slow)
            const estimatedGameMins = diffMins / 3.0;
            elapsed = Math.min(estimatedGameMins * 60, 3600);
        }
        return elapsed;
    }

    if (sport === Sport.HOCKEY) {
        const t = parseClockToSeconds(clock);
        if (isHalftime) return 1200;
        if (isBetweenPeriods) return period * 1200;

        if (period > 3) return 3600 + clamp(300 - t, 0, 300);
        return ((period - 1) * 1200) + clamp(1200 - t, 0, 1200);
    }

    if (sport === Sport.SOCCER) {
        let elapsed = parseSoccerElapsedSeconds(period, clock);
        // Fallback for dead clock in soccer
        if (elapsed === 0 && startMs > 0 && hoursSinceStart > 0.1 && hoursSinceStart < 2.0) {
            // Scaling: 1 Game Minute ≈ 1.1 Wall Minutes (Soccer is continuous)
            const diffMins = (nowMs - startMs) / 60000;
            const estimatedGameMins = diffMins / 1.1;
            elapsed = Math.min(estimatedGameMins * 60, SYSTEM_GATES.SOCCER_REG_SECONDS);
        }
        return elapsed;
    }

    if (sport === Sport.BASEBALL) return (getBaseballInning(match) - 1) * SYSTEM_GATES.MLB.SEC_PER_INNING;

    // Generic Fallback
    const t = parseClockToSeconds(clock);
    if (isHalftime) return (period === 1) ? 1800 : 3600;

    let totalElapsed = ((period - 1) * 900) + t;

    // Generic Wall-Clock
    if (totalElapsed < 60 && startMs > 0 && hoursSinceStart > 0.1 && hoursSinceStart < 3) {
        const diffMins = (nowMs - startMs) / 60000;
        totalElapsed = Math.min(diffMins * 60, 3600); // Assume 1:1 for generic
    }

    return totalElapsed;
}

export function getRemainingSeconds(match: ExtendedMatch): number {
    const elapsed = getElapsedSeconds(match);
    switch (match.sport) {
        case Sport.NFL: return clamp(3600 - elapsed, 0, 3600);
        case Sport.COLLEGE_FOOTBALL: return clamp(3600 - elapsed, 0, 3600);
        case Sport.NBA:
            return clamp(2880 - elapsed, 0, 2880);
        case Sport.BASKETBALL:
        case Sport.COLLEGE_BASKETBALL:
            const total = isCollegeBasketball(match) ? 2400 : 2880;
            return clamp(total - elapsed, 0, total);
        case Sport.HOCKEY: return clamp(3600 - elapsed, 0, 3600);
        case Sport.SOCCER:
            return elapsed >= SYSTEM_GATES.SOCCER_REG_SECONDS
                ? clamp(300 - (elapsed - SYSTEM_GATES.SOCCER_REG_SECONDS), 0, 300)
                : SYSTEM_GATES.SOCCER_REG_SECONDS - elapsed;
        case Sport.BASEBALL: {
            const { inning, half, outs } = getBaseballState(match);
            if (inning > 9) return 0;
            const outsElapsed = ((inning - 1) * 6) + (half === "BOTTOM" ? 3 : 0) + outs;
            return Math.max(0, 54 - outsElapsed) * SYSTEM_GATES.MLB.SEC_PER_OUT;
        }
        default: return clamp(3600 - elapsed, 0, 3600);
    }
}

export function calculateGameProgress(match: ExtendedMatch): number {
    if (match.sport === Sport.BASEBALL) {
        const inning = getBaseballInning(match);
        return inning > 9 ? 1.0 : clamp(((inning - 1) * 6) / 54, 0, 1);
    }
    const total = isBasketball(match.sport) ? (isCollegeBasketball(match) ? 2400 : 2880)
        : match.sport === Sport.HOCKEY ? 3600
            : match.sport === Sport.SOCCER ? 5400
                : 3600;
    return clamp(getElapsedSeconds(match) / total, 0, 1);
}

export function isFinalLikeClock(clockRaw: unknown, statusRaw?: string): boolean {
    const clock = String(clockRaw ?? "").trim().toLowerCase();
    const status = String(statusRaw ?? "").trim().toLowerCase();
    return REGEX.FINAL.test(clock) || REGEX.STATUS_FINAL.test(status);
}
