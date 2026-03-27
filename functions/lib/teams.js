/**
 * NBA team metadata — name as stored in Supabase, slug for URL, accent color.
 * Team names MUST match the `home_team` / `away_team` values in the `matches` table.
 */
export const NBA_TEAMS = [
  { name: 'Atlanta Hawks',           slug: 'atlanta-hawks',           city: 'Atlanta',        mascot: 'Hawks',           accent: '#E03A3E' },
  { name: 'Boston Celtics',          slug: 'boston-celtics',           city: 'Boston',         mascot: 'Celtics',         accent: '#007A33' },
  { name: 'Brooklyn Nets',           slug: 'brooklyn-nets',            city: 'Brooklyn',       mascot: 'Nets',            accent: '#000000' },
  { name: 'Charlotte Hornets',       slug: 'charlotte-hornets',        city: 'Charlotte',      mascot: 'Hornets',         accent: '#1D1160' },
  { name: 'Chicago Bulls',           slug: 'chicago-bulls',            city: 'Chicago',        mascot: 'Bulls',           accent: '#CE1141' },
  { name: 'Cleveland Cavaliers',     slug: 'cleveland-cavaliers',      city: 'Cleveland',      mascot: 'Cavaliers',       accent: '#6F263D' },
  { name: 'Dallas Mavericks',        slug: 'dallas-mavericks',         city: 'Dallas',         mascot: 'Mavericks',       accent: '#00538C' },
  { name: 'Denver Nuggets',          slug: 'denver-nuggets',            city: 'Denver',         mascot: 'Nuggets',         accent: '#0E2240' },
  { name: 'Detroit Pistons',         slug: 'detroit-pistons',           city: 'Detroit',        mascot: 'Pistons',         accent: '#C8102E' },
  { name: 'Golden State Warriors',   slug: 'golden-state-warriors',    city: 'Golden State',   mascot: 'Warriors',        accent: '#1D428A' },
  { name: 'Houston Rockets',         slug: 'houston-rockets',           city: 'Houston',        mascot: 'Rockets',         accent: '#CE1141' },
  { name: 'Indiana Pacers',          slug: 'indiana-pacers',            city: 'Indiana',        mascot: 'Pacers',          accent: '#002D62' },
  { name: 'LA Clippers',             slug: 'la-clippers',              city: 'LA',             mascot: 'Clippers',        accent: '#C8102E' },
  { name: 'Los Angeles Lakers',      slug: 'los-angeles-lakers',       city: 'Los Angeles',    mascot: 'Lakers',          accent: '#552583' },
  { name: 'Memphis Grizzlies',       slug: 'memphis-grizzlies',        city: 'Memphis',        mascot: 'Grizzlies',       accent: '#5D76A9' },
  { name: 'Miami Heat',              slug: 'miami-heat',                city: 'Miami',          mascot: 'Heat',            accent: '#98002E' },
  { name: 'Milwaukee Bucks',         slug: 'milwaukee-bucks',           city: 'Milwaukee',      mascot: 'Bucks',           accent: '#00471B' },
  { name: 'Minnesota Timberwolves',  slug: 'minnesota-timberwolves',   city: 'Minnesota',      mascot: 'Timberwolves',    accent: '#0C2340' },
  { name: 'New Orleans Pelicans',    slug: 'new-orleans-pelicans',     city: 'New Orleans',    mascot: 'Pelicans',        accent: '#0C2340' },
  { name: 'New York Knicks',         slug: 'new-york-knicks',           city: 'New York',       mascot: 'Knicks',          accent: '#006BB6' },
  { name: 'Oklahoma City Thunder',   slug: 'oklahoma-city-thunder',    city: 'Oklahoma City',  mascot: 'Thunder',         accent: '#007AC1' },
  { name: 'Orlando Magic',           slug: 'orlando-magic',             city: 'Orlando',        mascot: 'Magic',           accent: '#0077C0' },
  { name: 'Philadelphia 76ers',      slug: 'philadelphia-76ers',        city: 'Philadelphia',   mascot: '76ers',           accent: '#006BB6' },
  { name: 'Phoenix Suns',            slug: 'phoenix-suns',              city: 'Phoenix',        mascot: 'Suns',            accent: '#1D1160' },
  { name: 'Portland Trail Blazers',  slug: 'portland-trail-blazers',   city: 'Portland',       mascot: 'Trail Blazers',   accent: '#E03A3E' },
  { name: 'Sacramento Kings',        slug: 'sacramento-kings',          city: 'Sacramento',     mascot: 'Kings',           accent: '#5A2D81' },
  { name: 'San Antonio Spurs',       slug: 'san-antonio-spurs',         city: 'San Antonio',    mascot: 'Spurs',           accent: '#C4CED4' },
  { name: 'Toronto Raptors',         slug: 'toronto-raptors',           city: 'Toronto',        mascot: 'Raptors',         accent: '#CE1141' },
  { name: 'Utah Jazz',               slug: 'utah-jazz',                 city: 'Utah',           mascot: 'Jazz',            accent: '#002B5C' },
  { name: 'Washington Wizards',      slug: 'washington-wizards',        city: 'Washington',     mascot: 'Wizards',         accent: '#002B5C' },
];

export function teamByName(name) {
  return NBA_TEAMS.find(t => t.name === name) || null;
}

export function teamBySlug(slug) {
  return NBA_TEAMS.find(t => t.slug === slug) || null;
}
