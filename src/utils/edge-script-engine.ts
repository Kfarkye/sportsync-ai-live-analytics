import { Sport } from '@/types';

/**
 * THE EDGE SCRIPT (v7) - TYPESCRIPT IMPLEMENTATION
 * Translated from Python reference to bridge the "Demo Color" with "Real Math".
 */

export enum MarketType {
    TOTAL = "TOTAL",
    SPREAD = "SPREAD"
}

export type EdgeDirection = 'OVER' | 'UNDER' | 'HOME' | 'AWAY' | 'PASS';

export interface InjuryItem {
    name: string;
    status: string;
}

export interface EdgeSource {
    title?: string;
    url?: string;
    uri?: string;
}

export interface PredictionContract {
    predictionId: string;
    timestamp: number;
    sport: Sport;

    // THE AUDIT TARGET (The Price)
    marketType: MarketType;
    marketTotal: number;
    marketSpread: number;

    // THE BASELINE (The Context)
    paceMarket: number;

    // THE MODEL (The Projection)
    paceModel: number;
    effModel?: number;       // PPP (Total)
    modelSpread?: number;    // Spread Projection

    keyInjuries: InjuryItem[];
}

export interface EdgeResult {
    predictionId: string;
    marketType: string;
    impliedLine: number;
    modelLine: number;
    edgePoints: number;
    edgePercent: number;
    edgeDirection: EdgeDirection;
    confidence: number;

    implications: string[];
    sources?: EdgeSource[];
    keyInjuries: { name: string; status: string }[];

    trace: {
        pace: number;
        efficiency: number;
        possessions: number;
        pace_impact: number;
        rate_impact: number;
        [key: string]: number;
    };
}

/**
 * Solve Attribution: Stepwise Variance Decomposition
 */
export function solveAttribution(contract: PredictionContract) {
    let targetMarket: number;
    let targetModel: number;
    let rateMarket: number;
    let rateModel: number;
    let metricName: string;

    if (contract.marketType === MarketType.SPREAD) {
        targetMarket = contract.marketSpread;
        targetModel = contract.modelSpread || 0;

        rateMarket = contract.paceMarket > 0 ? targetMarket / contract.paceMarket : 0;
        rateModel = contract.paceModel > 0 ? targetModel / contract.paceModel : 0;
        metricName = "net_rating";
    } else {
        targetMarket = contract.marketTotal;
        rateModel = contract.effModel || 0;
        targetModel = contract.paceModel * rateModel;

        rateMarket = contract.paceMarket > 0 ? targetMarket / contract.paceMarket : 0;
        metricName = "efficiency";
    }

    // Step 1: Pace Impact (Volume @ Market Rate)
    const paceImpact = (contract.paceModel - contract.paceMarket) * rateMarket;

    // Step 2: Rate Impact (Rate @ Model Volume)
    const rateImpact = contract.paceModel * (rateModel - rateMarket);

    const edgeRaw = paceImpact + rateImpact;

    return {
        targetModel,
        paceImpact,
        rateImpact,
        edgeRaw,
        metricName,
        rateModel
    };
}

/**
 * Generate sport-specific implications from numeric impacts
 */
function generateImplications(sport: Sport, paceImpact: number, rateImpact: number, metricName: string): string[] {
    const bullets: string[] = [];

    if (Math.abs(paceImpact) >= 0.5) {
        const dir = paceImpact > 0 ? "High" : "Low";
        const unit = sport === Sport.HOCKEY ? "Event Density" : (sport === Sport.NFL ? "Tempo" : "Pace");
        bullets.push(`${unit} Variance: ${dir} volume projects ${Math.abs(paceImpact).toFixed(1)} pts impact`);
    }

    if (Math.abs(rateImpact) >= 0.5) {
        const dir = rateImpact > 0 ? "Clinical" : "Suppressed";
        const label = metricName === "efficiency" ? "Efficiency" : "Net Rating";
        bullets.push(`${label} Variance: ${dir} conversion projects ${Math.abs(rateImpact).toFixed(1)} pts impact`);
    }

    if (bullets.length === 0) {
        bullets.push("Model consistent with market structure");
    }

    return bullets;
}

/**
 * Execute Audit: Entry point for the UI
 */
export function executeAudit(contract: PredictionContract, rawConfidence: number): EdgeResult {
    const trace = solveAttribution(contract);

    // Rounding for Display Integrity (Policy: Pace + Rate = Edge)
    const dEdge = Math.round(trace.edgeRaw * 10) / 10;
    const dPace = Math.round(trace.paceImpact * 10) / 10;
    const dRate = Math.round((dEdge - dPace) * 10) / 10;

    const direction: EdgeDirection = dEdge > 0.1
        ? (contract.marketType === MarketType.TOTAL ? 'OVER' : 'AWAY')
        : (dEdge < -0.1 ? (contract.marketType === MarketType.TOTAL ? 'UNDER' : 'HOME') : 'PASS');

    const denom = contract.marketType === MarketType.TOTAL ? contract.marketTotal : Math.max(1, Math.abs(contract.marketSpread));
    const edgePercent = (Math.abs(dEdge) / denom) * 100;

    return {
        predictionId: contract.predictionId,
        marketType: contract.marketType,
        impliedLine: contract.marketType === MarketType.TOTAL ? contract.marketTotal : contract.marketSpread,
        modelLine: Math.round(trace.targetModel * 10) / 10,
        edgePoints: Math.abs(dEdge),
        edgePercent: Math.round(edgePercent * 10) / 10,
        edgeDirection: direction,
        confidence: Math.round(rawConfidence * 100),

        implications: generateImplications(contract.sport, dPace, dRate, trace.metricName),
        keyInjuries: [
            ...contract.keyInjuries,
            { name: "Availability", status: "Priced In" }
        ],

        trace: {
            pace: contract.paceModel,
            efficiency: trace.rateModel,
            possessions: contract.paceModel,
            pace_impact: dPace,
            rate_impact: dRate,
            [trace.metricName]: trace.rateModel
        }
    };
}
