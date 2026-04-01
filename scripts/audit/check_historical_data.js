// scripts/check_historical_data.js
// Check ESPN and Odds API historical data availability

async function checkESPN() {
    console.log("📊 CHECKING ESPN HISTORICAL DATA\n");

    const dates = [
        '2026-01-21', // Recent
        '2026-01-14', // 2 weeks ago
        '2026-01-07', // 3 weeks ago
        '2025-12-20', // 1+ month ago
        '2025-11-15', // 2+ months ago
    ];

    for (const date of dates) {
        const dateStr = date.replace(/-/g, '');
        const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&limit=200`;

        try {
            const res = await fetch(url);
            if (!res.ok) {
                console.log(`   ${date}: ❌ HTTP ${res.status}`);
                continue;
            }
            const data = await res.json();
            const events = data.events || [];
            const finals = events.filter(e => e.competitions?.[0]?.status?.type?.name?.includes('STATUS_FINAL'));
            console.log(`   ${date}: ${finals.length} finished games (${events.length} total)`);
        } catch (e) {
            console.log(`   ${date}: ❌ Error: ${e.message}`);
        }
    }
}

async function checkOddsAPI() {
    console.log("\n📊 CHECKING ODDS API HISTORICAL DATA\n");

    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) {
        console.log("   ⚠️ ODDS_API_KEY not set - cannot check Odds API");
        console.log("   Set it with: export ODDS_API_KEY='your_key'");
        return;
    }

    // Check for basketball_ncaab
    const sport = 'basketball_ncaab';

    // Odds API historical scores endpoint
    const dates = ['2026-01-21', '2026-01-14'];

    for (const date of dates) {
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${apiKey}&daysFrom=3&dateFormat=iso`;

        try {
            const res = await fetch(url);
            if (!res.ok) {
                console.log(`   ${date}: ❌ HTTP ${res.status}`);
                continue;
            }
            const data = await res.json();
            console.log(`   Current scores: ${data.length} games returned`);

            // Check remaining quota
            const remaining = res.headers.get('x-requests-remaining');
            console.log(`   API quota remaining: ${remaining}`);
            break;
        } catch (e) {
            console.log(`   Error: ${e.message}`);
        }
    }

    // Check historical odds endpoint (if available)
    console.log("\n   Note: Odds API historical data requires premium plan");
    console.log("   Free tier only provides live/upcoming odds");
}

async function main() {
    await checkESPN();
    await checkOddsAPI();

    console.log("\n" + "=".repeat(60));
    console.log("\n✅ Check complete\n");
}

main();
