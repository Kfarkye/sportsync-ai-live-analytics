/**
 * Team Brand Colors — Static lookup by team name keyword
 *
 * Primary hex colors for NBA, NHL, NFL, NCAAB teams.
 * Keyed by lowercase team name fragment for fuzzy matching.
 * Sources: ESPN brand guidelines, teamcolorcodes.com, nba-color npm package.
 *
 * Usage: getTeamColor("Lakers") → "#552583"
 */

const TEAM_COLORS: Record<string, string> = {
    // ── NBA ────────────────────────────────────────────────
    hawks: '#E03A3E',
    celtics: '#007A33',
    nets: '#000000',
    hornets: '#1D1160',
    bulls: '#CE1141',
    cavaliers: '#6F263D',
    mavericks: '#00538C',
    nuggets: '#0E2240',
    pistons: '#C8102E',
    warriors: '#1D428A',
    rockets: '#CE1141',
    pacers: '#002D62',
    clippers: '#C8102E',
    lakers: '#552583',
    grizzlies: '#5D76A9',
    heat: '#98002E',
    bucks: '#00471B',
    timberwolves: '#0C2340',
    pelicans: '#0C2340',
    knicks: '#006BB6',
    thunder: '#007AC1',
    magic: '#0077C0',
    '76ers': '#006BB6',
    sixers: '#006BB6',
    suns: '#1D1160',
    blazers: '#E03A3E',
    'trail blazers': '#E03A3E',
    kings: '#5A2D81',
    spurs: '#C4CED4',
    raptors: '#CE1141',
    jazz: '#002B5C',
    wizards: '#002B5C',

    // ── NHL ────────────────────────────────────────────────
    ducks: '#F47A38',
    coyotes: '#8C2633',
    bruins: '#FFB81C',
    sabres: '#003087',
    flames: '#D2001C',
    hurricanes: '#CC0000',
    blackhawks: '#CF0A2C',
    avalanche: '#6F263D',
    'blue jackets': '#002654',
    stars: '#006847',
    'red wings': '#CE1141',
    oilers: '#041E42',
    panthers: '#041E42',
    canadiens: '#AF1E2D',
    predators: '#FFB81C',
    devils: '#CE1141',
    islanders: '#00539B',
    rangers: '#0038A8',
    senators: '#C52032',
    flyers: '#F74902',
    penguins: '#FCB514',
    sharks: '#006D75',
    kraken: '#99D9D9',
    blues: '#002F87',
    lightning: '#002868',
    'maple leafs': '#00205B',
    canucks: '#00205B',
    golden: '#B4975A',
    knights: '#B4975A',
    capitals: '#C8102E',
    jets: '#041E42',
    wild: '#154734',

    // ── NFL ────────────────────────────────────────────────
    cardinals: '#97233F',
    falcons: '#A71930',
    ravens: '#241773',
    bills: '#00338D',
    bengals: '#FB4F14',
    browns: '#311D00',
    cowboys: '#003594',
    broncos: '#FB4F14',
    lions: '#0076B6',
    packers: '#203731',
    texans: '#03202F',
    colts: '#002C5F',
    jaguars: '#006778',
    chiefs: '#E31837',
    raiders: '#000000',
    chargers: '#002A5E',
    rams: '#003594',
    dolphins: '#008E97',
    vikings: '#4F2683',
    patriots: '#002244',
    saints: '#D3BC8D',
    giants: '#0B2265',
    eagles: '#004C54',
    steelers: '#FFB612',
    '49ers': '#AA0000',
    seahawks: '#002244',
    buccaneers: '#D50A0A',
    titans: '#0C2340',
    commanders: '#5A1414',
    bears: '#0B162A',
};

/**
 * Get primary brand color for a team name.
 * Matches against the last word(s) of the team name for maximum flexibility.
 * Returns hex string or undefined if no match.
 */
export function getTeamColor(teamName: string): string | undefined {
    if (!teamName) return undefined;
    const lower = teamName.toLowerCase().trim();

    // Direct lookup
    if (TEAM_COLORS[lower]) return TEAM_COLORS[lower];

    // Try each key as substring match
    for (const [key, color] of Object.entries(TEAM_COLORS)) {
        if (lower.includes(key) || key.includes(lower)) return color;
    }

    return undefined;
}

export default TEAM_COLORS;
