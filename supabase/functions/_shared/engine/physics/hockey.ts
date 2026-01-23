
import { OddsSnapshot, PregameConstraints } from "../../types.ts";
import { ExtendedMatch, TeamEfficiencyMatrix } from "../../types.ts";
import { SYSTEM_GATES } from "../../gates.ts";
import { getElapsedSeconds } from "../time.ts";
import { parseStatNumber, clamp, lerp, getStatNumber } from "../utils.ts";

export function calculateHockeyFairTotal(
    match: ExtendedMatch,
    efficiency: any,
    pregame: PregameConstraints,
    timeRem: number,
    currentPts: number,
    regime: "NORMAL" | "BLOWOUT"
): { fairTotal: number; regime: string; sd: number; flags?: any; trace?: any } {

    const { blended_rate, is_tied_decay, is_en_risk } = efficiency.global;
    let projectedFuture = blended_rate * (timeRem / 60);
    let finalRegime: string = regime;
    const varianceFlags: any = {};
    const elapsedMins = getElapsedSeconds(match) / 60;

    if (pregame.is_back_to_back) {
        projectedFuture *= 1.15;
    }

    const trace = {
        blended_rate,
        projectedFuture_initial: blended_rate * (timeRem / 60),
        regime_in: regime,
        regime_out: finalRegime,
        is_b2b: pregame.is_back_to_back,
        surrenderScalar: undefined as number | undefined,
        p3Inflation: undefined as number | undefined,
        proactive_decay_weight: undefined as number | undefined,
        en_injection: undefined as number | undefined,
        is_tied_decay,
        is_en_risk
    };

    if (elapsedMins >= 40) {
        if (regime === "BLOWOUT") {
            let surrenderScalar = pregame.is_back_to_back ? 0.65 : 0.70;

            const situation = (match as any).situation as any;
            const situationText = String(situation?.possessionText || "").toLowerCase();
            const REGEX_PP = /\b(pp|power\s*play|man\s*advantage|5\s*v\s*4|5\s*on\s*4|4\s*on\s*3)\b/i;
            const isPowerPlay = !!(match as any).situation?.isPowerPlay || REGEX_PP.test(situationText);

            if (isPowerPlay) {
                surrenderScalar += 0.25;
                varianceFlags.power_play_decay = true;
            }

            projectedFuture *= surrenderScalar;
            trace.surrenderScalar = surrenderScalar;
        } else {
            const inflation = pregame.is_back_to_back ? 1.35 : SYSTEM_GATES.NHL.P3_INFLATION;
            projectedFuture *= inflation;
            trace.p3Inflation = inflation;

            const diff = Math.abs(match.homeScore - match.awayScore);
            if (diff <= 2 && !is_en_risk) {
                const injection = diff === 1 ? SYSTEM_GATES.NHL.EN_INJECTION_1G : SYSTEM_GATES.NHL.EN_INJECTION_2G;

                const hScore = match.homeScore || 0;
                const aScore = match.awayScore || 0;
                const trailingSide = hScore < aScore ? "HOME" : "AWAY";
                const trailingTeam = trailingSide === "HOME" ? match.homeTeam : match.awayTeam;
                const tSRS = parseStatNumber((trailingTeam as any).srs ?? 0);

                const qualityScalar = tSRS > 0.5 ? 1.2 : (tSRS < -0.5 ? 0.8 : 1.0);
                const p3Ratio = clamp(timeRem / 1200, 0, 1);
                const decayWeight = lerp(0.1, 0.6, p3Ratio) * qualityScalar;

                projectedFuture += (injection * decayWeight);
                trace.en_injection = injection;
                trace.proactive_decay_weight = decayWeight;
            }
        }
    }

    if (is_tied_decay) projectedFuture *= SYSTEM_GATES.NHL.TIED_DECAY_MULT;
    if (is_en_risk) {
        const diff = Math.abs(match.homeScore - match.awayScore);
        projectedFuture += (diff === 1 ? SYSTEM_GATES.NHL.EN_INJECTION_1G : SYSTEM_GATES.NHL.EN_INJECTION_2G);
        finalRegime = "CHAOS";
    }

    return {
        fairTotal: currentPts + projectedFuture,
        regime: finalRegime,
        sd: 1.2,
        flags: varianceFlags,
        trace
    };
}

export function calculateHockeyEfficiency(match: ExtendedMatch, odds: OddsSnapshot): TeamEfficiencyMatrix {
    const home = (match as any).homeTeamStats;
    const away = (match as any).awayTeamStats;

    const elapsed = Math.max(0.1, getElapsedSeconds(match) / 60);
    const marketTotal = (odds.open.total > 0) ? odds.open.total : (odds.cur.total > 0 ? odds.cur.total : 6.5);
    const marketBaselineRate = marketTotal / 60.0;

    const hSOG = getStatNumber(home, "shotsongoal", "sog");
    const aSOG = getStatNumber(away, "shotsongoal", "sog");
    const totalSOG = hSOG + aSOG;

    const obsXG = totalSOG * SYSTEM_GATES.NHL.SOG_CONVERSION_AVG;
    const obsRate = obsXG / elapsed;

    const weight = clamp(totalSOG / SYSTEM_GATES.NHL.MIN_EVENTS_TRUST, 0.15, 1.0);
    const blendedRate = (obsRate * weight) + (marketBaselineRate * (1.0 - weight));

    const remMins = Math.max(0, 60 - elapsed);
    const diff = Math.abs(match.homeScore - match.awayScore);
    const isTiedDecay = remMins < 8.0 && diff === 0;

    const isEnRisk = (diff === 1 && remMins < 3.0) || (diff === 2 && remMins < 4.5);

    return {
        sport_type: "HOCKEY",
        home: { xg_rate: hSOG * SYSTEM_GATES.NHL.SOG_CONVERSION_AVG, sog: hSOG, projected_contribution: 0 },
        away: { xg_rate: aSOG * SYSTEM_GATES.NHL.SOG_CONVERSION_AVG, sog: aSOG, projected_contribution: 0 },
        global: { market_baseline: marketBaselineRate, blended_rate: blendedRate, is_tied_decay: isTiedDecay, is_en_risk: isEnRisk },
        context: `RATE: ${blendedRate.toFixed(3)} xG/min`
    };
}
