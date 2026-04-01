
const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';
const leagues = [
    'basketball/nba',
    'basketball/mens-college-basketball',
    'hockey/nhl',
    'football/nfl',
    'baseball/mlb'
];

async function findIds() {
    const targetIds = ['401825838', '401826012'];
    console.log(`--- SEARCHING FOR IDS ${targetIds.join(', ')} ---`);

    for (const league of leagues) {
        const url = `${ESPN_BASE_URL}/${league}/scoreboard?_t=${Date.now()}`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            const events = data.events || [];

            for (const id of targetIds) {
                const found = events.find(e => e.id === id);
                if (found) {
                    console.log(`FOUND ID ${id} in LEAGUE ${league}!`);
                    console.log(`  Name: ${found.name}`);
                }
            }
        } catch (e) {
            console.error(`Error checking ${league}: ${e.message}`);
        }
    }
}

findIds();
