# UI Architecture Reset Spec

Status: Proposed
Owner: Product UI Reset
Benchmarks: UI -> Apple, DX -> Vercel, PERF -> Meta

## Why We Are Resetting

The current product does not have a styling problem first. It has an information architecture problem.

The app currently feels assembled because:

- multiple shell systems coexist
- multiple detail-page dialects coexist
- multiple data surfaces invent their own grammar
- analysis modules compete with the primary data surface

The target is not "make it prettier." The target is:

- one shell
- one page grammar
- one table grammar
- one summary-card grammar
- one mobile pattern

This is the path to a Covers-level product structure with a cleaner, more premium execution.

## Product Principles

### 1. Shell Is Plumbing

The shell should do four things only:

- establish brand
- establish navigation
- establish date/sport context
- establish page width and spacing

The shell should not behave like a hero component or a feature surface.

### 2. Rows Are Data, Cards Are Summaries

Dense information belongs in tables and list rows.
Summaries belong in cards.
We do not mix those responsibilities.

### 3. One Page Grammar Per Surface Type

Every major page should follow a predictable sequence:

1. page header
2. control/filter row
3. primary data surface
4. secondary modules

### 4. Restraint Over Personality

We will reduce:

- decorative pills
- cinematic gradients
- redundant labels
- multiple competing nav treatments
- multiple highlight colors

We will keep:

- one accent color
- one border system
- one spacing scale
- one uppercase micro-label style

### 5. Density With Order

The goal is not minimalism. The goal is organized density.
We want more usable information on screen with less visual improvisation.

## Canonical Layout System

### Canonical Desktop Shell

Desktop shell must be exactly:

1. global header
2. subnav / date / page controls
3. single centered content column

Rules:

- one max-width container for content
- one sticky top shell
- no parallel sidebar on desktop
- no second nav model embedded inside pages

### Canonical Mobile Shell

Mobile shell must be exactly:

1. compact top bar
2. one drawer pattern for sport/date/global nav
3. no bottom nav bar

Rules:

- do not run top nav and bottom nav together
- do not invent page-specific mobile navigation

## Canonical Page Grammar

### Index / Feed Pages

Required structure:

1. page title
2. filter bar
3. dense primary table or fixture list
4. optional right-rail modules only when clearly supportive

Examples:

- sportsbook odds matrix
- fixture schedule
- team/referee/player stat tables

### Match Detail Pages

Required structure:

1. compact match header
2. tab row
3. tab-specific primary surface
4. tab-specific secondary modules

Rules:

- the match header is context, not a hero
- tabs are flat and compact
- the first module under the tab row must be the primary surface for that tab

### Edge Tab Grammar

Required structure:

1. compact summary strip
2. primary live tape table
3. secondary analysis cards

Explicitly not allowed:

- giant hero cards
- cinematic AI panels above the primary table
- oversized "special" widgets that interrupt the reading flow

## Canonical UI Surface Types

Only these surface types should be allowed as first-class layout primitives:

### Table

Use for:

- odds grids
- live tape
- stat rankings
- fixtures
- structured market comparisons

Rules:

- stable columns
- low-variance row height
- no decorative icons in dense rows
- one meaning per column

Canonical API requirements:

- `columns`: fixed column definitions with explicit ids and labels
- `rows`: plain data rows only, with no presentation-specific mutation
- `density`: `compact` or `comfortable`
- `loading`: canonical skeleton row state
- `emptyState`: canonical empty state block
- `stickyHeader`: explicit boolean
- `rowKey`: explicit stable row identity
- `rowTone`: optional restrained row emphasis, never full custom row theming

Locked defaults:

- default density: `compact`
- default row height: low-variance and content-trimmed
- loading state: skeleton rows, not spinner-only
- empty state: one quiet empty panel with title + supporting copy
- sticky header: on for dense scrolling tables unless there is a strong reason not to

### SummaryCard

Use for:

- compact edge summaries
- key drivers
- watchouts
- matchup notes

Rules:

- short content only
- max 2-3 cards in a summary strip
- never replace the primary table

### FilterBar

Use for:

- sport selector
- market selector
- time horizon
- page mode

Rules:

- horizontal controls only
- fixed spacing
- no embedded prose

### SectionHeader

Use for:

- module titles
- subsection boundaries

Rules:

- uppercase micro-label
- optional right accessory
- no decorative icons by default

### StatChip

Use for:

- live/final/scheduled state
- line state
- compact context markers

Rules:

- tiny, quiet, and sparse
- never the primary content

## File Ownership Decisions

This section is strict. "Keep" means canonical. "Freeze" means do not expand. "Retire" means replace and remove after migration.

### Shell

#### Keep and simplify

- [AppShell.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/AppShell.tsx)
- [UnifiedHeader.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/UnifiedHeader.tsx)
- [MobileSportDrawer.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/MobileSportDrawer.tsx)

Required action:

- reduce `AppShell` to layout orchestration only
- reduce `UnifiedHeader` to one clean header + one secondary control row
- keep `MobileSportDrawer` as the sole mobile global navigation pattern

#### Freeze immediately

- [LandingPage.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/LandingPage.tsx)

Reason:

- separate page type; not part of the reusable shell grammar

#### Retire after migration

- [Navbar.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/Navbar.tsx)
- [Sidebar.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/Sidebar.tsx)

Reason:

- duplicate shell concepts
- create parallel navigation models

### Match Surfaces

#### Keep as canonical match-detail surface

- [MatchDetails.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/MatchDetails.tsx)

Required action:

- split into page sections and view adapters
- shrink the header
- flatten the tabs
- make each tab follow canonical grammar

#### Freeze immediately

- [MatchCard.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/MatchCard.tsx)
- [GameCard.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/GameCard.tsx)
- [ExpandedMatchCard.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/ExpandedMatchCard.tsx)
- [CompactLiveRow.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/CompactLiveRow.tsx)
- [MatchRow.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/MatchRow.tsx)

Reason:

- these should be normalized after shell and detail grammar are stable

#### Retire after migration

- [GameDetail.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/GameDetail.tsx)

Reason:

- legacy cinematic dialect
- violates the new page grammar
- incompatible with the Covers-level density target

### Analysis Surfaces

#### Keep and normalize

- [ForecastHistoryTable.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/analysis/ForecastHistoryTable.tsx)
- [LiveDashboard.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/analysis/LiveDashboard.tsx)
- [BoxScore.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/analysis/BoxScore.tsx)
- [LiveIntelligenceCard.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/analysis/LiveIntelligenceCard.tsx)

Required action:

- table surfaces become the primary reading experience
- cards become short summaries only
- no large bespoke widget layouts above primary tables

#### Freeze immediately

- [LiveAIInsight.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/analysis/LiveAIInsight.tsx)
- [LiveAnalysisCard.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/analysis/LiveAnalysisCard.tsx)
- [InsightCard.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/analysis/InsightCard.tsx)
- [IntelligenceWidgets.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/analysis/IntelligenceWidgets.tsx)

Reason:

- too much component personality
- too much overlap with compact summary-card role

### Betting Surfaces

#### Keep and normalize

- [OddsCard.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/betting/OddsCard.tsx)

Required action:

- converge toward an odds-matrix/table grammar
- reduce card behavior when table behavior is more legible

### UI Primitives

#### Keep

- [Card.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/ui/Card.tsx)
- [SectionHeader.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/ui/SectionHeader.tsx)
- [TableRail.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/ui/TableRail.tsx)
- [StatusChip.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/ui/StatusChip.tsx)

Required action:

- tighten the API
- reduce stylistic branching
- align all usages to one visual grammar

#### Add

- `FilterBar.tsx`
- `DataTable.tsx`
- `SummaryStrip.tsx`
- `PageHeader.tsx`

Reason:

- these are missing canonical primitives and are currently being improvised ad hoc

## Match Detail Target State

### Match Header

The match header should contain only:

- teams
- score
- game state
- core line
- compact win-prob / live-state strip

The match header should not contain:

- large empty vertical padding
- secondary analysis widgets
- oversized decorative chips

### Tabs

Tabs should be:

- flat
- compact
- text-first
- one active underline or quiet pill

Tabs should not be:

- oversized capsules
- hero controls
- heavy visual anchors

### Game Tab

Primary surface:

- box score / game summary table

Secondary surfaces:

- recent form
- matchup context

### Odds Tab

Primary surface:

- odds matrix or line movement table

Secondary surfaces:

- concise matchup market notes

### Edge Tab

Primary surface:

- live impulse tape table

Secondary surfaces:

- 2-3 compact summary cards
- watchouts
- drivers

No large story widgets above the tape.

### AI Tab

Primary surface:

- structured narrative panel

Secondary surfaces:

- supporting evidence cards

The AI tab is where we allow narrative. Not the Edge tab.

## Design System Rules

### Color

Allowed:

- one primary accent
- one success/live accent
- grayscale for structure

Not allowed:

- unrelated accent colors per module
- purple/blue/green/orange fighting in one page area

### Border System

Use one border rule:

- `1px`
- low-contrast neutral line
- same radius family everywhere

### Typography

Use one hierarchy:

- H1 page title
- H2 section title
- H3 card title
- uppercase micro-label
- compact row text

Rules:

- micro-labels are scarce and consistent
- body copy is short
- table text is compact and legible

### Spacing

Use one spacing scale:

- page sections: 24-32px
- cards: 16-20px
- table rows: compact by default

Do not create one-off spacing systems inside modules.

## Execution Plan

### Phase 1: Shell Reset

Files:

- [AppShell.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/AppShell.tsx)
- [UnifiedHeader.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/UnifiedHeader.tsx)
- [MobileSportDrawer.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/MobileSportDrawer.tsx)
- [Navbar.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/Navbar.tsx)
- [Sidebar.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/Sidebar.tsx)

Deliverables:

- one desktop shell
- one mobile nav pattern
- remove duplicate nav concepts

Acceptance checklist:

- `Navbar` and `Sidebar` are not imported anywhere
- desktop uses one header system only
- mobile uses one navigation pattern only
- shell width, padding, and border rules are consistent across feed and live views

### Phase 2: Primitive Reset

Files:

- [Card.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/ui/Card.tsx)
- [SectionHeader.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/ui/SectionHeader.tsx)
- [TableRail.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/ui/TableRail.tsx)

Add:

- `FilterBar.tsx`
- `DataTable.tsx`
- `SummaryStrip.tsx`
- `PageHeader.tsx`

Deliverables:

- one surface grammar
- one table grammar
- one summary-card grammar

Acceptance checklist:

- `PageHeader`, `FilterBar`, `DataTable`, and `SummaryStrip` exist
- `DataTable` API is documented and locked
- `Card`, `SectionHeader`, and `TableRail` no longer carry loose stylistic branching
- at least one existing surface is migrated onto the new primitives without adding new variants

### Phase 3: Match Detail Reset

Files:

- [MatchDetails.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/MatchDetails.tsx)
- [GameDetail.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/GameDetail.tsx)
- [ForecastHistoryTable.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/analysis/ForecastHistoryTable.tsx)
- [OddsCard.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/betting/OddsCard.tsx)

Deliverables:

- canonical match template
- compact header
- compact tabs
- edge tab centered on the live tape
- deprecate legacy match page

Acceptance checklist:

- `MatchDetails` uses the new primitive set
- the Edge tab follows `summary strip -> primary tape table -> secondary cards`
- the match header is compact and context-first
- `GameDetail` has no active imports and is queued for deletion or deleted

### Phase 4: Feed and Odds Pages

Files:

- [MatchList.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/MatchList.tsx)
- [LiveDashboard.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/analysis/LiveDashboard.tsx)
- [OddsCard.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/betting/OddsCard.tsx)

Deliverables:

- Covers-like density
- stable row/table anatomy
- same shell and filter grammar as detail pages

Acceptance checklist:

- feed and odds pages use the same filter-bar and table grammar
- row density and header behavior match the canonical table system
- no page-specific nav or layout dialect is introduced
- secondary modules remain subordinate to the primary data surface

## Non-Negotiables

- no new shell components until shell reset is complete
- no new page dialects
- no bottom nav return
- no oversized hero widgets inside match tabs
- no decorative icons inside dense data rows
- no card-first replacement for table-first problems

## Retirement Gate

When a component is marked `Retire after migration`, the retirement is not complete until all three conditions are true:

1. no active imports remain
2. replacement path is merged and live
3. old file is deleted in the same PR or the immediately following PR

Additional rule:

- no new imports may be introduced from retired components once the replacement path exists

## Definition of Done

We are done when:

- the shell is immediately legible
- every page feels related
- tables are dense but calm
- the user can predict where information will be
- summary cards support the table instead of competing with it
- the app feels organized before it feels expressive

## Immediate Next Build

Do this next, in order:

1. simplify [UnifiedHeader.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/UnifiedHeader.tsx)
2. remove shell duplication from [Navbar.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/Navbar.tsx) and [Sidebar.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/layout/Sidebar.tsx)
3. define `PageHeader`, `FilterBar`, `DataTable`, and `SummaryStrip`
4. lock the canonical `DataTable` API and defaults before any page migration
5. refactor [MatchDetails.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/MatchDetails.tsx) to the canonical grammar using those primitives
6. retire [GameDetail.tsx](/Users/k.far.88/Downloads/sportsync-ai-live-analytics-main/src/components/match/GameDetail.tsx) with the retirement gate enforced
