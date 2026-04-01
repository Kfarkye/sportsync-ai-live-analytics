
import { createClient } from 'npm:@supabase/supabase-js@2'

const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

async function checkNbaOpeningLines() {
    console.log("Fetching NBA scoreboard...");
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const url = `${ESPN_API}?dates=${today}&limit=200`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        console.log(`Found ${data.events?.length || 0} events.`);

        for (const event of data.events || []) {
            console.log(`\nMatch: ${event.name} (${event.shortName})`);
            console.log(`ID: ${event.id}`);
            console.log(`Status: ${event.status?.type?.state}`);

            const competitions = event.competitions || [];
            for (const comp of competitions) {
                const odds = comp.odds || [];
                console.log(`Odds Providers Found: ${odds.length}`);

                odds.forEach((o: any, i: number) => {
                    console.log(`  Provider [${i}]: ${o.provider?.name}`);
                    console.log(`    Details: ${o.details}`);
                    console.log(`    Over/Under: ${o.overUnder}`);
                    console.log(`    Spread: ${o.spread}`);
                    console.log(`    Moneyline: Home ${o.homeTeamOdds?.moneyLine} / Away ${o.awayTeamOdds?.moneyLine}`);
                });
            }
        }

    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

checkNbaOpeningLines();
