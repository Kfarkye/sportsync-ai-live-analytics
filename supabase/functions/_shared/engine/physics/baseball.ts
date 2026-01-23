
import { ExtendedMatch, TeamEfficiencyMatrix, FairTotalActive } from "../../types.ts";
import { OddsSnapshot } from "../../types.ts";
import { SYSTEM_GATES } from "../../gates.ts";
import { computePitchingWHIP, safeDiv } from "../utils.ts";
import { getBaseballState } from "../time.ts";

export function calculateBaseballEfficiency(match: ExtendedMatch): TeamEfficiencyMatrix {
    const hWHIP = computePitchingWHIP(match, "HOME");
    const aWHIP = computePitchingWHIP(match, "AWAY");
    return {
        sport_type: "BASEBALL",
        home: { whip: hWHIP, pace: 9 },
        away: { whip: aWHIP, pace: 9 },
        context: `WHIP: H ${hWHIP.toFixed(2)} | A ${aWHIP.toFixed(2)}`
    };
}

export function calculateBaseballFairTotal(
    match: ExtendedMatch,
    odds: OddsSnapshot,
    efficiency: any,
    timeRem: number,
    currentPts: number
): { fairTotal: number; regime: string; sd: number; status?: string; reason?: string } {
    const { inning, half } = getBaseballState(match);

    if (inning >= 9 && half === "BOTTOM" && match.homeScore > match.awayScore) {
        return { fairTotal: currentPts, regime: "FINAL", sd: 0, status: "NO_BET", reason: "Game Final" };
    }

    let fairTotal = currentPts;
    let regime: FairTotalActive["regime"] = "NORMAL";

    if (inning > 9) {
        fairTotal = currentPts + SYSTEM_GATES.MLB.EXTRA_INNING_RUNS;
        regime = "CHAOS";
    } else {
        const outsRem = timeRem / SYSTEM_GATES.MLB.SEC_PER_OUT;
        const runsPerOut = safeDiv(odds.cur.total, 54);
        fairTotal = currentPts + (outsRem * runsPerOut);
    }

    return {
        fairTotal,
        regime,
        sd: 1.5
    };
}
