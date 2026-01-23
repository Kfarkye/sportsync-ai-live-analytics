
async function main() {
    const date = "20260108";
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${date}&limit=100`;
    console.log(`Checking ESPN: ${url}`);

    try {
        const res = await fetch(url);
        const data = await res.json();
        const events = data.events || [];
        console.log(`Found ${events.length} events on ESPN for ${date}.`);

        if (events.length > 0) {
            events.slice(0, 5).forEach(e => {
                const home = e.competitions[0].competitors.find(c => c.homeAway === 'home').team.displayName;
                const away = e.competitions[0].competitors.find(c => c.homeAway === 'away').team.displayName;
                console.log(`- ${away} @ ${home} (${e.id})`);
            });
        }
    } catch (e) {
        console.error("ESPN Check failed:", e);
    }
}

main();
