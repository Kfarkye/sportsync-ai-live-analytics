
function extractPicks(response, thoughts) {
    const picks = [];
    const combinedText = `${response}\n${thoughts}`.toLowerCase();
    const cleanResponse = response.replace(/[\*_]/g, '');
    const confidence = 'medium';

    const totalPattern = /(?:take|bet|recommend|pick|play|edge|value|verdict|recommendation)[:\s\S]{0,100}?(?:the\s+)?(?:[a-z]+\s+)?(over|under)\s*(\d+\.?\d*)/gi;
    let match;
    while ((match = totalPattern.exec(cleanResponse)) !== null) {
        const side = match[1].toUpperCase();
        const line = parseFloat(match[2]);
        if (line > 2.0 && line < 300) {
            picks.push({ type: 'total', side, line });
        }
    }

    const spreadPattern = /(?:take|bet|recommend|pick|play|edge|value|verdict|recommendation)[:\s\S]{0,100}?(?:on\s+)?(?:the\s+)?(?!(?:over|under|total))([A-Za-z0-9\s]{2,25}?)\s*([-+]\d+\.?\d*)/gi;
    while ((match = spreadPattern.exec(cleanResponse)) !== null) {
        const team = match[1].trim();
        const line = parseFloat(match[2]);
        if (!/over|under|total|pass|verdict|evidence|narrative|reality|market/i.test(team) && team.length > 2) {
            picks.push({ type: 'spread', side: team, line });
        }
    }
    return picks;
}

const testCases = [
    { res: "Verdict: Structural Under 224.5", expected: [{ type: 'total', side: 'UNDER', line: 224.5 }] },
    { res: "I recommend the Over 210.0", expected: [{ type: 'total', side: 'OVER', line: 210.0 }] },
    { res: "Pick: Celtics -5.5", expected: [{ type: 'spread', side: 'Celtics', line: -5.5 }] },
    { res: "Verdict: Under 224.5", expected: [{ type: 'total', side: 'UNDER', line: 224.5 }] },
    { res: "Play: Under 224.5", expected: [{ type: 'total', side: 'UNDER', line: 224.5 }] },
    { res: "Verdict: Knicks -5.5", expected: [{ type: 'spread', side: 'Knicks', line: -5.5 }] }
];

testCases.forEach((tc, i) => {
    const actual = extractPicks(tc.res, "");
    console.log(`Test ${i + 1}: ${JSON.stringify(actual) === JSON.stringify(tc.expected) ? 'PASS' : 'FAIL'}`);
    if (JSON.stringify(actual) !== JSON.stringify(tc.expected)) {
        console.log(`  Expected: ${JSON.stringify(tc.expected)}`);
        console.log(`  Actual:   ${JSON.stringify(actual)}`);
    }
});
