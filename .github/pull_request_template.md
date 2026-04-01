## Summary
- What changed:
- Why this is needed:

## Risk
- User-facing impact:
- Data/infra impact:
- Rollback plan:

## Validation
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run check:migrations` (if schema touched)
- [ ] Manual QA on affected pages/functions

## Change Scope
- [ ] No secrets added
- [ ] No unrelated file changes
- [ ] Feature flag included for risky behavior changes

## UI Design Gate (if UI touched)
- [ ] Uses the appropriate design system for the task (`Obsidian Weissach v7` for sports surfaces, or `docs/design/premium-ui-master-prompt.md` for category-agnostic premium UI)
- [ ] Visual system uses one restrained accent color
- [ ] Typography roles are explicit and limited (sans + optional one serif role + mono utility role)
- [ ] Glass usage is restrained (max two utility surface types; not used for primary reading surfaces)
- [ ] No gradient blobs, no decorative icon clutter, no generic "AI premium" styling
- [ ] Focal path is obvious within 5 seconds and spacing cadence is consistent

## Ops Notes
- Monitoring/alerts updated:
- Runbook updated (if behavior changed):
- Follow-up tasks:
