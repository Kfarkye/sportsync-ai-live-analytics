// _shared/apexEngine.ts
// APEX ENGINE v3.0 - Deterministic Sports Physics Layer

export const APEX_CONFIG = {
    INJURY_WEIGHT: 0.40,
    MAX_INJURY_SCORE: 10.0, // Standardized 0-10 scale
    FATIGUE_BASE_PENALTY: 2.0,
    APRON_TAX_MULTIPLIER: 1.75,
    ATS_THRESHOLD: 0.60,
    ATS_BONUS_POINTS: 3.0,
    HOME_COURT: 2.6,
    AVG_PACE: 100.8,
};

export interface TeamInput {
    name: string;
    net_rating: number;
    market_injury_val: number; // Forensic Impact (0-10 scale)
    situation: string;
    fatigue_score?: number;    // High-fidelity User Data (0-100 scale)
    is_apron_team: boolean;
    ats_pct: number;
}

export interface GameMarket {
    matchup: string;
    vegas_line: number;
    ticket_pct: number;
    last_5_diff: number;
    underdog: string;
    home_inj_val: number;
    away_inj_val: number;
}

export interface SimulationResult {
    fairLine: number;
    homeNotes: string[];
    awayNotes: string[];
}

export interface AnalysisResult {
    story: string;
    action: string;
    size: string;
}

/**
 * ApexGameEngine - Deterministic Physics Simulation
 * Calculates fair lines based on net ratings, injuries, fatigue, and ATS trends.
 */
export class ApexGameEngine {
    private getEffectiveRating(team: TeamInput): { rating: number; notes: string[] } {
        let rating = team.net_rating || 0;
        const notes: string[] = [];

        // Injury Impact
        const injuryHit = (team.market_injury_val || 0) * APEX_CONFIG.INJURY_WEIGHT;
        rating -= injuryHit;
        if (injuryHit > 0) notes.push(`Injury Dampened (-${injuryHit.toFixed(1)})`);

        // Fatigue Penalty
        let fatHit = 0;
        if (team.fatigue_score && team.fatigue_score > 0) {
            // High-fidelity User Data (0-100 scale)
            // Scaling: 50 score = BASE_PENALTY (2.0)
            fatHit = (team.fatigue_score / 50) * APEX_CONFIG.FATIGUE_BASE_PENALTY;
            notes.push(`High-Q Fatigue (${team.fatigue_score}): -${fatHit.toFixed(1)}`);
        } else if (['B2B', '3in4', 'EndRoadTrip'].includes(team.situation)) {
            fatHit = APEX_CONFIG.FATIGUE_BASE_PENALTY;
            if (team.is_apron_team) {
                fatHit *= APEX_CONFIG.APRON_TAX_MULTIPLIER;
                notes.push("APRON FATIGUE CRUSH");
            } else {
                notes.push("Standard Fatigue");
            }
        }
        rating -= fatHit;

        // ATS Wagon Bonus
        if (team.ats_pct >= APEX_CONFIG.ATS_THRESHOLD) {
            rating += APEX_CONFIG.ATS_BONUS_POINTS;
            notes.push(`ATS WAGON (+${APEX_CONFIG.ATS_BONUS_POINTS})`);
        }

        return { rating, notes };
    }

    public simulate(home: TeamInput, away: TeamInput): SimulationResult {
        const h = this.getEffectiveRating(home);
        const a = this.getEffectiveRating(away);
        // Fair Line = -1 * (Home Rating Advantage + Home Court)
        const fairLine = -1 * ((h.rating - a.rating) + APEX_CONFIG.HOME_COURT);
        return {
            fairLine: Number(fairLine.toFixed(1)),
            homeNotes: h.notes,
            awayNotes: a.notes
        };
    }
}

/**
 * ApexMarketReader - Market Inefficiency Detection
 * Identifies structural edges based on Apex simulation vs Vegas lines.
 */
export class ApexMarketReader {
    public analyze(market: GameMarket, sim: SimulationResult): AnalysisResult {
        const { vegas_line, ticket_pct, last_5_diff, underdog } = market;
        const { fairLine, homeNotes, awayNotes } = sim;

        const recencyBias = (last_5_diff || 0) * 0.35;
        const publicPrice = fairLine + recencyBias;
        const deltaMath = vegas_line - fairLine;

        // Parse Team Names from Matchup
        const teams = market.matchup.split(' @ ');
        const awayTeam = teams[0] || 'Away';
        const homeTeam = teams[1] || 'Home';
        const modelPick = deltaMath > 0 ? homeTeam : awayTeam;

        let story = "Standard Market";
        let action = "PASS";
        let size = "1 Unit";
        const allNotes = [...homeNotes, ...awayNotes].join(' ');

        // STRUCTURAL MISMATCH: Apron team on fatigue
        if (Math.abs(deltaMath) > 4.0 && allNotes.includes("APRON FATIGUE CRUSH")) {
            story = "STRUCTURAL MISMATCH (Apron/Fatigue)";
            action = `BET ${modelPick} (Institutional Edge)`;
            size = "2 UNITS (Hammer)";
        }
        // THE STINK: Vegas Trap
        else if (ticket_pct > 75 && Math.abs(vegas_line - publicPrice) > 3.0 && Math.abs(deltaMath) < 1.0) {
            story = "THE STINK (Vegas Trap)";
            action = `FADE PUBLIC (Bet ${underdog})`;
            size = "1.5 Units";
        }
        // INJURY OVERREACTION: Ewing Theory
        else if (Math.abs(deltaMath) > 2.5 && (market.home_inj_val > 4 || market.away_inj_val > 4)) {
            story = "INJURY OVERREACTION (Ewing Theory)";
            action = `BET ${modelPick} (Value on ${modelPick})`;
            size = "1 Unit";
        }
        // MARKET LAG: Ride the ATS Trend
        else if (allNotes.includes("ATS WAGON")) {
            story = "MARKET LAG (Ride the Trend)";
            action = `BET ${modelPick} (Momentum)`;
            size = "1 Unit";
        }

        return { story, action, size };
    }
}
