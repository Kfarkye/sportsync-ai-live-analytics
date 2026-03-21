# World Cup 2026 Object-Ledger Spec

## Decision
World Cup launches as an object-ledger system centered on five canonical object types:

- `tournament`
- `group`
- `match`
- `team`
- `team_market`

The system is object-first, not page-first.

## Canonical Identities

- Tournament: `wc-2026`
- Group: `wc-2026-group-b`
- Match: `wc-2026-group-b-argentina-vs-mexico-2026-06-18`
- Team: `wc-2026-argentina`
- Team market: `wc-2026-argentina-to-qualify-group-b`

All identities are durable and map to stable public paths.

## Data Contract
Each object must support:

- `current state` (`object_ledger_current_state.state`)
- `append-only events` (`object_ledger_events`)
- `derived summaries` (for UI and SEO)

## Required Group Summaries

- `at_a_glance`
- `match_anchor`
- `history`
- `share_snapshot`
- `seo_summary`

Group pages prioritize prediction-market group contracts:

- `to qualify from group`
- `to win group`

These are exposed through `public.v_wc_group_summaries` to keep UI off raw ledger tables.

## Compatibility

- Source of truth remains `object_ledger_objects`.
- Legacy readers that still expect canonical registry fields should use
  `public.v_canonical_registry_compat`.
- The bridge is read-only and derived; no duplicate truth should be written.

## Shell Mapping

- Group page: static reference shell
- Match page: dynamic state shell
- Qualification calculator: calculator shell
- Share cards: share shell

## URL Taxonomy

- `/world-cup-2026`
- `/world-cup-2026/groups/group-b`
- `/world-cup-2026/groups/group-b/argentina-vs-mexico`
- `/world-cup-2026/teams/argentina`
- `/world-cup-2026/teams/argentina/to-qualify`

## First Build Slice (Implemented)

- Tournament object (`wc-2026`)
- Group object (`wc-2026-group-b`)
- Two match objects
- Team and team-market objects for Group B baseline
- Group page shell at `/world-cup-2026/groups/group-b`
- Group summaries: `at_a_glance`, `match_anchor`, `history`

## Agent Rule

Use this instruction for all follow-on implementation:

"World Cup must be implemented as an object-ledger system.

Canonical objects:
- tournament
- group
- match
- team
- team_market

Each object must support:
- current state
- append-only events
- derived summaries

Required group summaries:
- at_a_glance
- match_anchor
- history
- share_snapshot
- seo_summary

Shell mapping:
- group page = static reference shell
- match page = dynamic state shell
- qualification calculator = calculator shell
- share cards = share shell

Do not build page-first components.
Do not query raw tables directly from UI.
Do not create duplicate public identities for the same group, match, or team market."
