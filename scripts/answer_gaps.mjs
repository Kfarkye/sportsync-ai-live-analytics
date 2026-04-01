import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function answerGaps() {
    console.log("═══ ANSWERING 3 GAPS ═══\n");

    // GAP 1: Timestamp availability
    console.log("--- GAP 1: Timestamps ---");
    const { data: ts } = await supabase.from('player_prop_bets')
        .select('last_updated, updated_at, event_date')
        .not('last_updated', 'is', null)
        .order('last_updated', { ascending: false })
        .limit(5);
    console.log(`  Rows with last_updated: checking...`);
    const { count: tsCount } = await supabase.from('player_prop_bets').select('*', { count: 'exact', head: true }).not('last_updated', 'is', null);
    const { count: totalCount } = await supabase.from('player_prop_bets').select('*', { count: 'exact', head: true });
    console.log(`  ${tsCount}/${totalCount} rows have last_updated`);
    if (ts?.length) {
        console.log("  Most recent timestamps:");
        ts.forEach(r => console.log(`    last_updated=${r.last_updated}  updated_at=${r.updated_at}  event_date=${r.event_date}`));
    }
    // Date range
    const { data: oldest } = await supabase.from('player_prop_bets').select('last_updated, event_date').not('last_updated', 'is', null).order('last_updated', { ascending: true }).limit(1).maybeSingle();
    const { data: newest } = await supabase.from('player_prop_bets').select('last_updated, event_date').not('last_updated', 'is', null).order('last_updated', { ascending: false }).limit(1).maybeSingle();
    console.log(`  Date range: ${oldest?.last_updated || oldest?.event_date} → ${newest?.last_updated || newest?.event_date}`);

    // GAP 2: Sportsbook coverage
    console.log("\n--- GAP 2: Sportsbook Coverage ---");
    const { data: allBooks } = await supabase.from('player_prop_bets').select('sportsbook, provider');
    if (allBooks) {
        const books = {}, providers = {};
        allBooks.forEach(r => {
            books[r.sportsbook || 'NULL'] = (books[r.sportsbook || 'NULL'] || 0) + 1;
            providers[r.provider || 'NULL'] = (providers[r.provider || 'NULL'] || 0) + 1;
        });
        console.log("  Sportsbooks:");
        Object.entries(books).sort(([, a], [, b]) => b - a).forEach(([k, v]) => console.log(`    ${k}: ${v.toLocaleString()}`));
        console.log("  Providers:");
        Object.entries(providers).sort(([, a], [, b]) => b - a).forEach(([k, v]) => console.log(`    ${k}: ${v.toLocaleString()}`));
    }

    // GAP 3: Stable identifiers for dedupe
    console.log("\n--- GAP 3: Identifiers for Dedupe ---");
    const { count: hasPlayerId } = await supabase.from('player_prop_bets').select('*', { count: 'exact', head: true }).not('player_id', 'is', null);
    const { count: hasEspnId } = await supabase.from('player_prop_bets').select('*', { count: 'exact', head: true }).not('espn_player_id', 'is', null);
    const { count: hasMatchId } = await supabase.from('player_prop_bets').select('*', { count: 'exact', head: true }).not('match_id', 'is', null);
    console.log(`  player_id populated: ${hasPlayerId}/${totalCount}`);
    console.log(`  espn_player_id populated: ${hasEspnId}/${totalCount}`);
    console.log(`  match_id populated: ${hasMatchId}/${totalCount}`);

    // Unique players & markets count
    const { data: uniqPlayers } = await supabase.from('player_prop_bets').select('player_name');
    const { data: uniqMarkets } = await supabase.from('player_prop_bets').select('bet_type');
    if (uniqPlayers) {
        const players = new Set(uniqPlayers.map(r => r.player_name));
        console.log(`  Unique players: ${players.size}`);
    }
    if (uniqMarkets) {
        const markets = {};
        uniqMarkets.forEach(r => { markets[r.bet_type || 'NULL'] = (markets[r.bet_type || 'NULL'] || 0) + 1; });
        console.log("  Markets (bet_type):");
        Object.entries(markets).sort(([, a], [, b]) => b - a).forEach(([k, v]) => console.log(`    ${k}: ${v.toLocaleString()}`));
    }

    // GAP BONUS: How many unique props can be line-shopped? (same player+bet_type+line across multiple books)
    console.log("\n--- BONUS: Line Shopping Potential ---");
    const { data: shopSample } = await supabase.from('player_prop_bets')
        .select('player_name, bet_type, line_value, side, sportsbook, odds_american')
        .eq('side', 'over')
        .order('player_name')
        .limit(1000);
    if (shopSample) {
        const grouped = {};
        shopSample.forEach(r => {
            const key = `${r.player_name}|${r.bet_type}|${r.line_value}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push({ book: r.sportsbook, odds: r.odds_american });
        });
        const multiBook = Object.entries(grouped).filter(([, v]) => v.length > 1);
        console.log(`  Props with multiple books (out of ${Object.keys(grouped).length} unique props in sample): ${multiBook.length}`);
        if (multiBook.length > 0) {
            console.log("  Example:");
            multiBook.slice(0, 3).forEach(([k, v]) => {
                console.log(`    ${k}:`);
                v.forEach(b => console.log(`      ${b.book}: ${b.odds}`));
            });
        }
    }

    // Leagues breakdown
    console.log("\n--- League Distribution ---");
    const { data: leagues } = await supabase.from('player_prop_bets').select('league');
    if (leagues) {
        const dist = {};
        leagues.forEach(r => { dist[r.league || 'NULL'] = (dist[r.league || 'NULL'] || 0) + 1; });
        Object.entries(dist).sort(([, a], [, b]) => b - a).forEach(([k, v]) => console.log(`  ${k}: ${v.toLocaleString()}`));
    }

    console.log("\n✅ All gaps answered.");
}

answerGaps().catch(console.error);
