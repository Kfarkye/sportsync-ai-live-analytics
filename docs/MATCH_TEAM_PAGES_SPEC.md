# Antigravity Agent Prompt: Match Pages + Team Pages — The Drip

## What This Is

A sports data platform where **every completed match gets its own page** and **every team gets its own dashboard**. The database is already filled by automated nightly pipelines. Your job is building the page layer. Data in, pages out.

**Repo:** https://github.com/Kfarkye/sportsync-ai-live-analytics  
**Stack:** Vite + React 19 + TypeScript + Tailwind 3 + Supabase + Framer Motion + Vercel  
**Deployed at:** sportsync-ai-live-analytics.vercel.app (will become thedrip.to)

---

## What Already Exists

The repo has 238 commits. It's a Vite SPA with Zustand state management, no router currently installed. Key existing code:

- `src/App.tsx` — Root component wrapping QueryClient → AuthProvider → AppShell
- `src/components/layout/AppShell.tsx` — Current navigation via `activeView` state ('FEED' | 'LIVE' | 'TITAN')
- `src/lib/supabase.ts` — Supabase client already configured (uses VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
- `src/lib/essence.ts` — Existing design utilities (cn helper, etc.)
- `vercel.json` — SPA fallback already handles `/((?!api/|assets/).*)` → `/index.html`

---

## Scaffolded Files (Already In Repo)

These files are already written. Use them directly — do not rewrite or modify the data layer.

### `src/lib/slugs.ts` — URL Generation & Parsing
- `matchSlug(home, away, startTime)` → `"arsenal-vs-chelsea-2026-03-01"`
- `teamSlug(name)` → `"arsenal"`
- `parseMatchSlug(slug)` → `{ home, away, date }`
- `matchUrl()`, `teamUrl()` — canonical path builders
- `LEAGUE_LABELS`, `LEAGUE_SHORT` — display maps for all 6 leagues

### `src/lib/postgame.ts` — Supabase Queries + Types
- `SoccerPostgame` — full TypeScript interface for all 83 columns
- `fetchMatchBySlug(home, away, date)` — single match query
- `fetchTeamMatches(teamName, leagueId?)` — all matches for a team
- `fetchLeagueMatches(leagueId)` — all matches in a league
- `fetchTeamsInLeague(leagueId)` — distinct team names
- `fetchTeamMeta(teamName)` — logo, colors from teams table
- `computeTeamRecord(matches, teamName)` — returns W/D/L + ATS + O/U + goals + clean sheets
- `getSpreadResult(match)` — covered/failed/push with margin
- `getTotalResult(match)` — over/under/push with actual total
- `getMLResult(match)` — home/away/draw
- `impliedProb(americanOdds)` — odds → probability
- `fmtOdds(odds)` — format with +/- sign

### `src/lib/obsidian.ts` — Design Tokens
- `fonts` — serif (Newsreader), mono (JetBrains Mono), sans (DM Sans)
- `colors` — bg (#080808), card (#0e0e0e), borders, text levels, accent green/red
- `shadows` — four-layer card shadow stack
- `animation` — fadeUp, revealScore, expandLine presets + 40ms stagger
- `fontImport` — Google Fonts URL

---

## Step 1: Install React Router

```bash
npm install react-router-dom
```

Update `src/App.tsx`:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
// ... existing imports ...

const MatchPage = lazy(() => import('./pages/MatchPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));

const App: FC = () => {
  // ... existing useEffect ...
  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/match/:slug" element={<Suspense fallback={<Loading />}><MatchPage /></Suspense>} />
              <Route path="/team/:slug" element={<Suspense fallback={<Loading />}><TeamPage /></Suspense>} />
              <Route path="/reports" element={<Suspense fallback={<Loading />}><ReportsPage /></Suspense>} />
              <Route path="*" element={<AppShell />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  );
};
```

The `vercel.json` SPA fallback already handles all routes → `/index.html`. No server config changes needed.

---

## Step 2: Build Match Page — `/match/:slug`

**File:** `src/pages/MatchPage.tsx`

**Data flow:** Read `slug` from URL params → `parseMatchSlug()` → `fetchMatchBySlug()` → render one row as full page.

### Hero Section
- Team crests from `fetchTeamMeta()` with monogram fallback (first letter + team color bg)
- Score in 56px Newsreader serif, team-colored radial glow behind each score
- Team names in DM Sans 600
- League badge + matchday + formatted date
- "FULL TIME" status pill
- Venue + attendance + referee subline

### Tab: Overview
- **Event Timeline:** Parse `goals`, `cards`, `substitutions` JSONB arrays. Render chronologically with vertical team-colored bars (2px), emoji icons (⚽🟨🟥🔄), minute markers in JetBrains Mono
- **Match Intelligence:** Newsreader italic paragraph insight box summarizing tactical story
- **KPI Tiles:** 3 contextual stats (e.g., total shots, possession delta, cards combined)

### Tab: Stats  
- Full stat comparison bars for: Possession, Shots, Shots on Target, Passes, Pass %, Corners, Fouls, Tackles, Clearances, Saves, Interceptions, Crosses, Long Balls, Offsides, Blocked Shots
- Layout: home value — label — away value
- Animated bars with team colors via framer-motion, 0.6s cubic-bezier, staggered 40ms
- All values from the flat columns — no JSONB parsing needed

### Tab: Lineups
- Parse `home_lineup` and `away_lineup` JSONB
- Group by position (GK / DEF / MID / FWD)
- Jersey number + player name
- Goal/assist/card indicators inline (cross-reference with goals/cards JSONB)
- Substitutes section below divider
- Red-carded players: strikethrough text

### Tab: Odds (conditional — only when `dk_home_ml !== null`)
- **3-Way Moneyline Grid:** Home / Draw / Away
  - Show American odds via `fmtOdds()`
  - Show implied probability via `impliedProb()`
  - Winning outcome: green highlight bg + "✓ Result" badge
- **Spread Panel:**
  - Show handicap line (dk_spread) + home/away prices
  - **ATS Result:** `getSpreadResult()` → "Covered by 0.5" or "Failed to cover by 1.5" — **this is the stat that doesn't exist on SofaScore, FotMob, Yahoo, or any pure sports data site**
  - Color-code green for covered, red for failed, gray for push
- **Total Panel:**
  - Show O/U line + over/under prices
  - Actual combined score + grading via `getTotalResult()`
- **Insight Box:** Natural language summary of closing market

### Tab: Form
- Last 6 results per team: W/D/L color-coded badges (20px squares, green/gray/red)
- H2H bar: proportional colored segments from all head-to-head matches in database

### SEO Meta Tags
```html
<title>Arsenal 2-1 Chelsea | Premier League MD28 | The Drip</title>
<meta property="og:title" content="Arsenal 2-1 Chelsea | Premier League MD28 | The Drip" />
<meta property="og:description" content="Arsenal beat Chelsea 2-1. DK closing: Arsenal -150. Covered -0.5. Full box score, stats, lineups, and closing lines." />
<link rel="canonical" href="https://thedrip.to/match/arsenal-vs-chelsea-2026-03-01" />
```

Set these dynamically via `document.title` and meta tag manipulation on mount.

---

## Step 3: Build Team Page — `/team/:slug`

**File:** `src/pages/TeamPage.tsx`

**Data flow:** Read `slug` from URL params → `fetchTeamMatches(slug)` → `computeTeamRecord()` → render aggregated dashboard.

### Hero Section
- Team crest (large, from `fetchTeamMeta()`) + team name in DM Sans 700
- League badge
- **Season Record:** W-D-L (straight up)
- **ATS Record:** Covered-Failed-Push — in green accent, large Newsreader serif numbers. **This is the hero stat. Make it prominent.**
- **O/U Record:** Over-Under-Push
- Cover percentage as large stat: e.g., "64.3%" in 48px Newsreader

### ATS Dashboard
- Overall ATS record with cover %
- ATS as favorite vs underdog (split by whether team had negative or positive spread)
- ATS home vs away
- ATS last 5 / last 10 trend
- Average margin vs spread

### O/U Dashboard
- Overall over/under record
- Average actual total vs closing total line
- Over rate home vs away

### Goals Summary
- Goals scored / conceded (total + per game avg)
- Clean sheets
- Goal difference

### Results List
- Every match, reverse chronological
- Each row: Score + opponent + date + spread result + total result + link to `/match/[slug]`
- Color-coded: green row border = covered, red = didn't, gray = push
- Each row clickable → match page via `matchUrl()`

### SEO Meta Tags
```html
<title>Arsenal 2025-26 | ATS Record, Stats & Results | The Drip</title>
<meta property="og:description" content="Arsenal ATS record: 18-10. Cover rate: 64.3%. Full season results with closing lines." />
```

---

## Step 4: Build Explorer/Index — `/reports`

**File:** `src/pages/ReportsPage.tsx`

### League Tabs
- EPL | LIGA | SA | BUN | L1 | MLS
- Default: EPL

### Toggle: MATCHES | TEAMS

### Match View
- Recent results as compact cards (reverse chronological)
- Each card: home score — away score, team names, date, league badge
- "ODDS" indicator badge when dk_home_ml is present
- Spread result inline: "Covered" / "Failed" in small colored text
- Click → `/match/[slug]`

### Team View (this is the differentiator)
- All teams in selected league
- **Sorted by ATS cover percentage** — not by league standings
- Columns: Team | ATS Record | Cover % | O/U Record | W-D-L
- Each row clickable → `/team/[slug]`
- Header explains: "Ranked by Against The Spread record"

---

## Design System: Obsidian Weissach

Import all tokens from `src/lib/obsidian.ts`. The three-font hierarchy is non-negotiable:

| Font | Use |
|------|-----|
| Newsreader (serif) | Scores, stat values, insight prose, KPI numbers, ATS headline |
| JetBrains Mono | Timestamps, odds values, data labels, minute markers |
| DM Sans | Team names, navigation, tab labels, UI chrome |

**Background:** #080808. **Cards:** #0e0e0e. **Borders:** rgba(255,255,255,0.04).

Add the Google Fonts import to `index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;1,400;1,500&family=JetBrains+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Match and team pages use dark theme (Obsidian).** The existing app uses light theme. Both can coexist — the postgame pages are their own visual world.

---

## Competitive Landscape — Why This Matters

**Covers.com + VegasInsider:** Show ATS records but no sports data (no box scores, no lineups, no stats).  
**SofaScore + FotMob:** Show sports data but zero betting data (no closing lines, no spread results, no ATS).  
**Yahoo Sports + broadcast sites:** US-focused sports data, minimal betting integration.  
**OddsPortal:** Shows odds from 50 books — drowning in numbers, no box scores.

**Nobody shows both.** The match page puts box scores + closing lines + ATS result on the same URL. The team page sorts by cover percentage instead of league standings. These two things don't exist together anywhere.

---

## Database Reference

**Supabase project:** `qffzvrnbzabcokqqrwbv`

| Table | Rows | Notes |
|-------|------|-------|
| soccer_postgame | 418 | 83 columns, ALL with DK odds |
| teams | 1,233 | logos, colors, league affiliations |
| nba_postgame | 363 | parallel schema (future expansion) |
| nhl_postgame | 286 | parallel schema |
| nfl_postgame | 28 | parallel schema |
| mlb_postgame | 130 | parallel schema |

**League distribution in soccer_postgame:**
- Serie A: 87 | EPL: 82 | Bundesliga: 80 | La Liga: 76 | Ligue 1: 63 | MLS: 30

All 418 matches have DK closing odds. Every single one.

---

## CRITICAL: Table Selection

**ALWAYS query `soccer_postgame`.** NEVER query `matches`.

The `matches` table is a pregame/live table with only 88 soccer rows and inconsistent league IDs (`esp.1`, `eng.1`, `ger.1` mixed formats). It is NOT the data source for postgame pages.

The `soccer_postgame` table has 418 rows, 83 columns, consistent league IDs (`epl`, `laliga`, `seriea`, `bundesliga`, `ligue1`, `mls`), and 100% DK odds coverage. All functions in `src/lib/postgame.ts` already query this table correctly. Import and use those functions — do not write raw Supabase queries against `matches`.

| Table | Use for pages? | Rows | League IDs |
|-------|---------------|------|------------|
| `soccer_postgame` | **YES** | 418 | `epl`, `laliga`, `seriea`, `bundesliga`, `ligue1`, `mls` |
| `matches` | **NO** | 88 soccer | `esp.1`, `eng.1` (inconsistent, DO NOT USE) |

---

## What NOT To Build

- No AI predictions or betting recommendations
- No user accounts or auth on these pages
- No multi-book odds aggregation — one book (DK closing) only
- No stubs, TODOs, placeholders, or mock data
- No features beyond what's specified
- No modifications to existing AppShell or current routes

---

## Priority Order

1. `npm install react-router-dom` + update App.tsx with routes
2. Add Google Fonts to index.html  
3. `src/pages/MatchPage.tsx` — fully rendering from soccer_postgame
4. `src/pages/TeamPage.tsx` — aggregating with ATS as hero stat
5. `src/pages/ReportsPage.tsx` — league tabs, match/team toggle, ATS sort
6. SEO meta tags on every page
7. Deploy to Vercel

---

## The Rule

One row = one page. One team = one dashboard. The drain runs tonight and adds more rows. Every new row is a new page. Every new page is a new indexed URL. The product grows while sleeping. Ship the pages.
