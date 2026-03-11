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

// ============================================================================
// TEAM LOGOS — Static ESPN CDN fallback for when match object is unavailable
// ============================================================================
// Pattern: https://a.espncdn.com/i/teamlogos/{sport}/500/scoreboard/{abbr}.png
// Keyed by lowercase team name fragment, same fuzzy matching as colors.

const TEAM_LOGOS: Record<string, string> = {
    // ── NBA ────────────────────────────────────────────────
    hawks: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/atl.png',
    celtics: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/bos.png',
    nets: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/bkn.png',
    hornets: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/cha.png',
    bulls: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/chi.png',
    cavaliers: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/cle.png',
    mavericks: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/dal.png',
    nuggets: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/den.png',
    pistons: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/det.png',
    warriors: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/gs.png',
    rockets: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/hou.png',
    pacers: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/ind.png',
    clippers: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/lac.png',
    lakers: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/lal.png',
    grizzlies: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/mem.png',
    heat: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/mia.png',
    bucks: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/mil.png',
    timberwolves: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/min.png',
    pelicans: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/no.png',
    knicks: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/ny.png',
    thunder: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/okc.png',
    magic: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/orl.png',
    '76ers': 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/phi.png',
    sixers: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/phi.png',
    suns: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/phx.png',
    blazers: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/por.png',
    'trail blazers': 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/por.png',
    kings: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/sac.png',
    spurs: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/sa.png',
    raptors: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/tor.png',
    jazz: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/utah.png',
    wizards: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/wsh.png',

    // ── NHL ────────────────────────────────────────────────
    ducks: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/ana.png',
    bruins: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/bos.png',
    sabres: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/buf.png',
    flames: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/cgy.png',
    hurricanes: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/car.png',
    blackhawks: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/chi.png',
    avalanche: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/col.png',
    'blue jackets': 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/cbj.png',
    stars: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/dal.png',
    'red wings': 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/det.png',
    oilers: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/edm.png',
    canadiens: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/mtl.png',
    predators: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/nsh.png',
    devils: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/njd.png',
    islanders: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/nyi.png',
    rangers: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/nyr.png',
    senators: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/ott.png',
    flyers: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/phi.png',
    penguins: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/pit.png',
    sharks: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/sj.png',
    kraken: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/sea.png',
    blues: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/stl.png',
    lightning: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/tb.png',
    'maple leafs': 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/tor.png',
    canucks: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/van.png',
    'golden knights': 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/vgk.png',
    capitals: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/wsh.png',
    jets: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/wpg.png',
    wild: 'https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/min.png',

    // ── NFL ────────────────────────────────────────────────
    cardinals: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ari.png',
    falcons: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/atl.png',
    ravens: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/bal.png',
    bills: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/buf.png',
    bengals: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/cin.png',
    browns: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/cle.png',
    cowboys: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/dal.png',
    broncos: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/den.png',
    lions: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/det.png',
    packers: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/gb.png',
    texans: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/hou.png',
    colts: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ind.png',
    jaguars: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/jax.png',
    chiefs: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/kc.png',
    raiders: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/lv.png',
    chargers: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/lac.png',
    rams: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/lar.png',
    dolphins: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/mia.png',
    'minnesota vikings': 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/min.png',
    patriots: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ne.png',
    saints: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/no.png',
    giants: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/nyg.png',
    'new york jets': 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/nyj.png',
    eagles: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/phi.png',
    steelers: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/pit.png',
    '49ers': 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/sf.png',
    seahawks: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/sea.png',
    buccaneers: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/tb.png',
    titans: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ten.png',
    commanders: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/wsh.png',
    bears: 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/chi.png',

    // ── MLB ────────────────────────────────────────────────
    diamondbacks: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/ari.png',
    'atlanta braves': 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/atl.png',
    braves: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/atl.png',
    orioles: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/bal.png',
    'red sox': 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/bos.png',
    cubs: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/chc.png',
    'white sox': 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/chw.png',
    reds: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/cin.png',
    guardians: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/cle.png',
    rockies: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/col.png',
    tigers: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/det.png',
    astros: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/hou.png',
    royals: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/kc.png',
    angels: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/laa.png',
    dodgers: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/lad.png',
    marlins: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/mia.png',
    brewers: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/mil.png',
    twins: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/min.png',
    mets: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/nym.png',
    yankees: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/nyy.png',
    athletics: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/oak.png',
    phillies: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/phi.png',
    pirates: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/pit.png',
    padres: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/sd.png',
    mariners: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/sea.png',
    rays: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/tb.png',
    'texas rangers': 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/tex.png',
    'blue jays': 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/tor.png',
    nationals: 'https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/wsh.png',

    // ── Soccer (EPL) ──────────────────────────────────────
    arsenal: 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png',
    'aston villa': 'https://a.espncdn.com/i/teamlogos/soccer/500/362.png',
    bournemouth: 'https://a.espncdn.com/i/teamlogos/soccer/500/349.png',
    brentford: 'https://a.espncdn.com/i/teamlogos/soccer/500/337.png',
    brighton: 'https://a.espncdn.com/i/teamlogos/soccer/500/331.png',
    chelsea: 'https://a.espncdn.com/i/teamlogos/soccer/500/363.png',
    'crystal palace': 'https://a.espncdn.com/i/teamlogos/soccer/500/384.png',
    everton: 'https://a.espncdn.com/i/teamlogos/soccer/500/368.png',
    fulham: 'https://a.espncdn.com/i/teamlogos/soccer/500/370.png',
    liverpool: 'https://a.espncdn.com/i/teamlogos/soccer/500/364.png',
    'manchester city': 'https://a.espncdn.com/i/teamlogos/soccer/500/382.png',
    'man city': 'https://a.espncdn.com/i/teamlogos/soccer/500/382.png',
    'manchester united': 'https://a.espncdn.com/i/teamlogos/soccer/500/360.png',
    'man utd': 'https://a.espncdn.com/i/teamlogos/soccer/500/360.png',
    newcastle: 'https://a.espncdn.com/i/teamlogos/soccer/500/361.png',
    tottenham: 'https://a.espncdn.com/i/teamlogos/soccer/500/367.png',
    'west ham': 'https://a.espncdn.com/i/teamlogos/soccer/500/371.png',
    wolves: 'https://a.espncdn.com/i/teamlogos/soccer/500/380.png',

    // ── Soccer (Champions League / Major) ─────────────────
    'real madrid': 'https://a.espncdn.com/i/teamlogos/soccer/500/86.png',
    barcelona: 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png',
    'bayern munich': 'https://a.espncdn.com/i/teamlogos/soccer/500/132.png',
    bayern: 'https://a.espncdn.com/i/teamlogos/soccer/500/132.png',
    'psg': 'https://a.espncdn.com/i/teamlogos/soccer/500/160.png',
    'inter milan': 'https://a.espncdn.com/i/teamlogos/soccer/500/110.png',
    'ac milan': 'https://a.espncdn.com/i/teamlogos/soccer/500/103.png',
    juventus: 'https://a.espncdn.com/i/teamlogos/soccer/500/111.png',
    dortmund: 'https://a.espncdn.com/i/teamlogos/soccer/500/124.png',
};

/**
 * Get ESPN CDN logo URL for a team name.
 * Same fuzzy substring matching as getTeamColor.
 * Returns URL string or undefined if no match.
 */
export function getTeamLogo(teamName: string): string | undefined {
    if (!teamName) return undefined;
    const lower = teamName.toLowerCase().trim();

    if (TEAM_LOGOS[lower]) return TEAM_LOGOS[lower];

    for (const [key, url] of Object.entries(TEAM_LOGOS)) {
        if (lower.includes(key) || key.includes(lower)) return url;
    }

    return undefined;
}

export default TEAM_COLORS;
