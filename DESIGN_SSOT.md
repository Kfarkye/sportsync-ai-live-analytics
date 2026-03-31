# SportsSync Design SSOT

## Rule (Locked)
**SportsSync consumer-facing pages must follow the SportsSync warm-light design system.**

### Canonical SportsSync Consumer Surface
- Light background + warm neutral surfaces
- Colors:
  - `bg: #FAFAF8`
  - `surface: #FFFFFF`
  - `border: #E8E7E3`
  - `textPrimary: #1A1A18`
  - `textSecondary: #6B6B63`
  - `textTertiary: #9B9B91`
  - `accent: #C85A3A`
  - `positive: #2D8F5C`
  - `negative: #C85A3A`
- Typography:
  - Title: **Source Serif 4**
  - Body: **DM Sans**
  - Utility/quantitative: **JetBrains Mono**
- Geometry:
  - Card radius: `8px`
  - Controls radius: `6px`
- Interaction rules:
  - restrained borders and thin hierarchy
  - no dark mode overrides on SportsSync consumer surfaces

### Product Family Scope
- **TheDrip is a separate product family** and may keep a different shell/tokens.
- The two families should not share visual token files.
- If a page is under SportsSync consumer UX (home, props, matchups, trends, analytics pages, scoreboards), it must use the SportsSync tokens.

### Token Entry Point
- Canonical token source: `src/lib/design-tokens.ts`
- Shared runtime bridge: `src/lib/tokens.ts`
- Application-wide CSS application should come from:
  - `index.css`
  - `src/main.tsx` (application of token application layer)
- Verification:
  - `npm run verify:ssot:design`
