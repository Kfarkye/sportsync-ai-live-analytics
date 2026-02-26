import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
console.log(`🔌 Connected to ${SUPABASE_URL}\n`);

// Helper: safely query a table
async function probe(table, label, opts = {}) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) { console.log(`  ❌ ${label} (${table}): ${error.message}`); return 0; }
    console.log(`  ${count > 0 ? '✅' : '⚪'} ${label}: ${(count || 0).toLocaleString()} rows`);
    return count || 0;
}

// Helper: get most recent row timestamp
async function latest(table, col = 'created_at') {
    const { data, error } = await supabase.from(table).select(col).order(col, { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return null;
    return data[col];
}

async function main() {
    // ═══════════════════════════════════════════════════════
    // SECTION 1: Full table inventory
    // ═══════════════════════════════════════════════════════
    console.log("═══ TABLE INVENTORY ═══\n");

    console.log("📊 Core Data:");
    await probe('matches', 'Matches');
    await probe('teams', 'Teams');
    await probe('canonical_teams', 'Canonical Teams');
    await probe('league_config', 'League Config');

    console.log("\n💰 Odds & Market:");
    await probe('market_feeds', 'Market Feeds');
    const oddsSnaps = await probe('live_odds_snapshots', 'Live Odds Snapshots');
    await probe('closing_lines', 'Closing Lines');
    await probe('raw_odds_log', 'Raw Odds Log');

    console.log("\n🏟️ Live Game State:");
    await probe('live_game_state', 'Live Game State');
    await probe('live_match_states', 'Live Match States');
    await probe('match_snapshots', 'Match Snapshots');

    console.log("\n🏀 NBA Model:");
    const nbaPreds = await probe('nba_model_predictions', 'NBA Predictions');
    await probe('nba_game_state_history', 'NBA State History');
    await probe('nba_window_signals', 'NBA Window Signals');
    await probe('nba_market_snapshots', 'NBA Market Snapshots');
    await probe('nba_decisions', 'NBA Decisions');
    await probe('nba_team_priors', 'NBA Team Priors');
    await probe('nba_games', 'NBA Games');

    console.log("\n🧠 Intelligence & Picks:");
    const pregame = await probe('pregame_intel', 'Pregame Intel');
    const sharp = await probe('sharp_intel', 'Sharp Intel');
    const chatPicks = await probe('ai_chat_picks', 'AI Chat Picks');
    await probe('daily_thesis', 'Daily Thesis');
    await probe('pregame_intel_log', 'Intel Audit Log');

    console.log("\n📰 Content & Context:");
    await probe('match_news', 'Match News');
    await probe('team_game_context', 'Team Game Context');
    await probe('player_prop_bets', 'Player Props');
    await probe('team_trends', 'Team Trends');
    await probe('match_insights', 'Match Insights');
    await probe('game_results', 'Game Results');
    await probe('ref_intel', 'Ref Intel');

    // ═══════════════════════════════════════════════════════
    // SECTION 2: Recency check on key tables
    // ═══════════════════════════════════════════════════════
    console.log("\n═══ RECENCY CHECK ═══\n");

    const tables = ['matches', 'pregame_intel', 'sharp_intel', 'ai_chat_picks', 'live_odds_snapshots', 'nba_model_predictions', 'daily_thesis', 'match_news'];
    for (const t of tables) {
        const ts = await latest(t);
        if (ts) console.log(`  🕐 ${t}: latest = ${new Date(ts).toLocaleString()}`);
        else console.log(`  ⚪ ${t}: no timestamp found`);
    }

    // ═══════════════════════════════════════════════════════
    // SECTION 3: Pick performance breakdown
    // ═══════════════════════════════════════════════════════
    if (pregame > 0 || sharp > 0 || chatPicks > 0) {
        console.log("\n═══ PICK PERFORMANCE ═══\n");

        if (pregame > 0) {
            const { data } = await supabase.from('pregame_intel').select('pick_result');
            if (data) {
                const counts = {};
                data.forEach(r => { counts[r.pick_result] = (counts[r.pick_result] || 0) + 1; });
                console.log("  📋 Pregame Intel results:", JSON.stringify(counts));
            }
        }

        if (sharp > 0) {
            const { data } = await supabase.from('sharp_intel').select('pick_result');
            if (data) {
                const counts = {};
                data.forEach(r => { counts[r.pick_result] = (counts[r.pick_result] || 0) + 1; });
                console.log("  📋 Sharp Intel results:", JSON.stringify(counts));
            }
        }

        if (chatPicks > 0) {
            const { data } = await supabase.from('ai_chat_picks').select('result');
            if (data) {
                const counts = {};
                data.forEach(r => { counts[r.result] = (counts[r.result] || 0) + 1; });
                console.log("  📋 Chat Picks results:", JSON.stringify(counts));
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    // SECTION 4: Matches by sport/league
    // ═══════════════════════════════════════════════════════
    console.log("\n═══ MATCHES BY LEAGUE ═══\n");
    const { data: leagueData } = await supabase.from('matches').select('sport');
    if (leagueData) {
        const counts = {};
        leagueData.forEach(r => { counts[r.sport || 'UNKNOWN'] = (counts[r.sport || 'UNKNOWN'] || 0) + 1; });
        Object.entries(counts).sort(([, a], [, b]) => b - a).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    }

    console.log("\n✅ Audit complete.");
}

main().catch(console.error);
