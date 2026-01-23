
const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';
const endpoint = 'hockey/nhl';

async function checkEspnNhl() {
    console.log(`--- CHECKING ESPN NHL SCOREBOARD ---`);
    const url = `${ESPN_BASE_URL}/${endpoint}/scoreboard?_t=${Date.now()}`;
    const res = await fetch(url);
    const data = await res.json();

    const events = data.events || [];
    console.log(`Found ${events.length} events for NHL.`);

    for (const event of events) {
        console.log(`Event ID: ${event.id}, Name: ${event.name}, Status: ${event.status?.type?.state}`);
        const competition = event.competitions?.[0];
        if (competition) {
            const home = competition.competitors.find(c => c.homeAway === 'home');
            const away = competition.competitors.find(c => c.homeAway === 'away');
            console.log(`  Teams: ${away?.team?.displayName} @ ${home?.team?.displayName}`);
            console.log(`  Date: ${event.date}`);

            if (event.id === '401803060') {
                console.log('--- FETCHING SUMMARY FOR 401803060 ---');
                const sUrl = `${ESPN_BASE_URL}/${endpoint}/summary?event=${event.id}`;
                const sRes = await fetch(sUrl);
                const sData = await sRes.json();
                console.log('Summary structure check:', {
                    has_header: !!sData.header,
                    has_pickcenter: !!sData.pickcenter,
                    has_boxscore: !!sData.boxscore,
                    home_score: sData.header?.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.score
                });
            }
        }
    }
}

checkEspnNhl();
