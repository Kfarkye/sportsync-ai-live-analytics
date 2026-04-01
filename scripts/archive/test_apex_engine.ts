
import { ApexGameEngine, ApexMarketReader, APEX_CONFIG, TeamInput, GameMarket } from "../supabase/functions/_shared/apexEngine.ts";

console.log("--- TESTING APEX ENGINE (TS PORT) ---");

// 1. SETUP SAMPLE DATA (GSW vs MIA) - Matches User's Python Example
const gsw: TeamInput = {
    name: 'Warriors',
    net_rating: 5.2,
    market_injury_val: 0.0,
    situation: 'Home_Rest',
    is_apron_team: false,
    ats_pct: 0.62
};

const mia: TeamInput = {
    name: 'Heat',
    net_rating: 1.5,
    market_injury_val: 4.5,
    situation: 'B2B',
    is_apron_team: true,
    ats_pct: 0.48
};

const market: GameMarket = {
    matchup: 'Heat @ Warriors',
    vegas_line: -6.5,
    ticket_pct: 82,
    last_5_diff: 12.0,
    underdog: 'Heat',
    home_inj_val: 0.0,
    away_inj_val: 4.5
};

// 2. RUN ENGINE
const engine = new ApexGameEngine();
const reader = new ApexMarketReader();

const sim = engine.simulate(gsw, mia);
const analysis = reader.analyze(market, sim);

// 3. LOG RESULTS
console.log(`\n[THE INPUTS]`);
console.log(`GSW Flags: ${sim.homeNotes.join(', ')}`);
console.log(`MIA Flags: ${sim.awayNotes.join(', ')}`);

console.log(`\n[THE TRIANGULATION]`);
console.log(`Your Math (Fair Price): Warriors ${sim.fairLine}`);
console.log(`Vegas Line:             Warriors ${market.vegas_line}`);
console.log(`Edge:                   ${(market.vegas_line - sim.fairLine).toFixed(1)} points`);

console.log(`\n[THE VERDICT]`);
console.log(`STORY:  ${analysis.story}`);
console.log(`ACTION: ${analysis.action}`);
console.log(`SIZE:   ${analysis.size}`);

// 4. ASSERTIONS
const expectedEdge = 3.0; // From Python script provided by user
const actualEdge = market.vegas_line - sim.fairLine;

if (Math.abs(actualEdge - expectedEdge) < 0.5) {
    console.log("\n✅ SUCCESS: Engine output matches Python reference.");
} else {
    console.error(`\n❌ FAILURE: Expected edge ~${expectedEdge}, got ${actualEdge.toFixed(1)}`);
}
