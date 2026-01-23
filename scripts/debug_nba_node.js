
import https from 'https';

const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

// Simple fetch polyfill for Node if needed
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function checkNbaOpeningLines() {
    console.log("Fetching NBA scoreboard...");
    // Get today's date in YYYYMMDD
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const url = `${ESPN_API}?dates=${today}&limit=200`;

    try {
        const data = await fetchJson(url);

        console.log(`Found ${data.events?.length || 0} events.`);

        for (const event of data.events || []) {
            console.log(`\nMatch: ${event.name} (${event.shortName})`);
            console.log(`ID: ${event.id}`);
            console.log(`Status: ${event.status?.type?.state}`);

            const competitions = event.competitions || [];
            for (const comp of competitions) {
                const odds = comp.odds || [];
                console.log(`Odds Providers Found: ${odds.length}`);

                if (odds.length === 0) {
                    console.log("  [WARNING] No odds array found.");
                    continue;
                }

                odds.forEach((o, i) => {
                    console.log(`  Provider [${i}]: ${o.provider?.name}`);
                    console.log(`    Details: ${o.details}`);
                    console.log(`    Over/Under: ${o.overUnder}`);

                    // Inspect the nested structure we rely on
                    if (o.pointSpread) {
                        console.log(`    pointSpread.home.open.line: ${o.pointSpread?.home?.open?.line}`);
                        console.log(`    pointSpread.home.current.line: ${o.pointSpread?.home?.current?.line}`);
                    } else {
                        console.log("    [WARNING] No pointSpread object found.");
                    }

                    if (o.total) {
                        console.log(`    total.over.open.line: ${o.total?.over?.open?.line}`);
                    } else {
                        // Some sports use flat 'overUnder' instead of nested total
                        console.log("    [Check] top-level overUnder: " + o.overUnder);
                    }
                });
            }
        }

    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

checkNbaOpeningLines();
