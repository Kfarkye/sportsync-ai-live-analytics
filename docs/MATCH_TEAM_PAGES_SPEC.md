# Match / Team / League / Hub Pages Spec

## Data Source
- Primary table: `soccer_postgame` (required)
- Supplementary table: `poly_odds` (optional snapshot utility only)
- Do not use `matches` for postgame page rendering.

## Routes
- `/soccer`
- `/league/:slug`
- `/team/:slug?league=<league_id>`
- `/match/:slug`

## Slug Contract
- Match: `{league}-{home_team_slug}-vs-{away_team_slug}-{date}`
- Example: `epl-arsenal-vs-chelsea-2026-03-03`

## Implemented Data Layer
- `src/lib/postgame.ts`
  - `fetchRecentSoccerMatches(limit)`
  - `fetchSoccerHub()`
  - `fetchLeagueMatches(leagueId)`
  - `fetchTeamsInLeague(leagueId)`
  - `fetchTeamMatches(teamSlug, league?)`
  - `fetchMatchBySlug(slug)`
  - `parseMatchSlug()`, `buildMatchSlug()`, `slugifyTeam()`

## Page Components
- `src/pages/postgame/SoccerHubPage.tsx`
- `src/pages/postgame/LeaguePage.tsx`
- `src/pages/postgame/TeamPage.tsx`
- `src/pages/postgame/MatchPage.tsx`
- `src/pages/postgame/PostgameRouter.tsx`
- Shared UI shell: `src/pages/postgame/PostgamePrimitives.tsx`

## Routing Integration
- `src/App.tsx` routes based on `window.location.pathname`.
- Existing feed/live shell remains on `/`.
- Postgame pages render on direct URL paths above.

## Rendering Rules
- No AI/prediction sections.
- No mock data.
- Hide sections when source data is absent.
- Data-dense, postgame-focused layout.

## Verification Checklist
1. Open `/soccer` and verify league links + recent match links render.
2. Open `/league/laliga` and verify match cards + aggregate panel.
3. Open `/team/real-madrid?league=laliga` and verify season rows + trends.
4. Open a real match slug on `/match/:slug` and verify timeline/boxscore/odds/v5 panels.
