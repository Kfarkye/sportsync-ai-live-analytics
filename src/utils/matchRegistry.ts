/**
 * Match Registry
 * Canonical source of truth for all Sport/League ID mappings and normalization.
 */

export const LEAGUE_SUFFIX_MAP: Record<string, string> = {
    // Football
    'nfl': '_nfl',
    'college-football': '_ncaaf',

    // Basketball
    'nba': '_nba',
    'mens-college-basketball': '_ncaab',
    'wnba': '_wnba',

    // Baseball
    'mlb': '_mlb',

    // Hockey
    'nhl': '_nhl',

    // Soccer
    'eng.1': '_epl',
    'usa.1': '_mls',
    'esp.1': '_laliga',
    'ger.1': '_bundesliga',
    'ita.1': '_seriea',
    'fra.1': '_ligue1',
    'uefa.champions': '_ucl',
    'uefa.europa': '_uel',
    'caf.nations': '_afcon',

    // Tennis
    'atp': '_atp',
    'wta': '_wta'
};

/**
 * Maps raw league slugs to canonical league IDs.
 */
export const LEAGUE_ID_MAP: Record<string, string> = {
    'nba': 'nba',
    'nfl': 'nfl',
    'ncaaf': 'college-football',
    'ncaab': 'mens-college-basketball',
    'mlb': 'mlb',
    'nhl': 'nhl',
    'epl': 'eng.1',
    'laliga': 'esp.1',
    'mls': 'usa.1',
    'bundesliga': 'ger.1',
    'seriea': 'ita.1',
    'ligue1': 'fra.1',
    'ucl': 'uefa.champions',
    'uel': 'uefa.europa',
    'afcon': 'caf.nations',
    'wnba': 'wnba',

    // Tennis
    'atp': 'atp',
    'wta': 'wta'
};

/**
 * Normalizes a league ID or slug into a canonical league ID.
 */
export const getCanonicalLeagueId = (rawLeague: string): string => {
    if (!rawLeague) return '';
    const norm = rawLeague.toLowerCase();
    return LEAGUE_ID_MAP[norm] || norm;
};

/**
 * Normalizes a raw ID (e.g. "401825420") into a canonical DB ID (e.g. "401825420_ncaab").
 * If the ID already contains a suffix, it returns the original ID.
 */
export const getCanonicalMatchId = (rawId: string, leagueId?: string): string => {
    if (!rawId) return '';
    if (rawId.includes('_')) return rawId;

    const normalizedLeague = (leagueId || '').toLowerCase();
    const suffix = LEAGUE_SUFFIX_MAP[normalizedLeague] || '';

    return `${rawId}${suffix}`;
};

/**
 * Normalizes a team name into a stable slug for ID generation.
 * This is a fallback layer if DB-level mapping is not available.
 */
export const normalizeTeam = (name: string): string => {
    if (!name) return 'unknown';
    // Remove "The", "FC", etc for better root matching
    const clean = name.toLowerCase()
        .replace(/\b(the|fc|afc|sc|club)\b/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\b(state)\b/g, 'st')
        .replace(/\b(university)\b/g, 'univ')
        .replace(/\b(los angeles)\b/g, 'la')
        .replace(/\b(st louis)\b/g, 'stl')
        .replace(/\s+/g, '')
        .trim();
    return clean;
};

/**
 * Generates a deterministic, provider-agnostic ID for a game.
 * Format: YYYYMMDD_TEAM1_TEAM2_LEAGUE
 */
export const generateCanonicalGameId = (
    teamA: string,
    teamB: string,
    commenceTime: string | Date,
    leagueId: string
): string => {
    const date = new Date(commenceTime);
    if (isNaN(date.getTime())) return '';

    const datePart = date.toISOString().split('T')[0].replace(/-/g, '');

    // Normalize and Sort to ensure stable identity A@B == B@A
    const slugA = normalizeTeam(teamA);
    const slugB = normalizeTeam(teamB);
    const [teamFirst, teamSecond] = [slugA, slugB].sort();

    const league = (LEAGUE_SUFFIX_MAP[leagueId.toLowerCase()] || `_${leagueId}`).replace('_', '');

    return `${datePart}_${teamFirst}_${teamSecond}_${league}`;
};

/**
 * Validates if an ID is canonical (contains an underscore).
 */
export const isCanonicalId = (id: string): boolean => {
    return typeof id === 'string' && id.includes('_');
};
