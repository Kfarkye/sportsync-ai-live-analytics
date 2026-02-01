---
trigger: always_on
---

# AI Coding Best Practices - Preventing Tech Debt

## Lessons Learned from Production Build Failures

This document captures key prompt strategies and practices to prevent the accumulation of tech debt when using AI assistants for coding.

---

## 🎯 Core Prompts to Use

### 1. Enforce Strict TypeScript
>
> "Use strict TypeScript with no `any` types"

Forces proper type definitions upfront rather than loose typing that breaks later.

### 2. Continuous Build Verification
>
> "Before adding features, run `npm run build` to verify no type errors"

Catches issues immediately instead of letting them stack up.

### 3. Single Source of Truth for Types
>
> "Define all shared types in a single source of truth file first"

Prevents duplicate/conflicting type definitions across the codebase.

### 4. Research Before Defining Types
>
> "When creating new string literal types, grep the codebase for all usages first"

Example: Before defining `type TabId = 'A' | 'B'`, search for all places that use tab IDs to capture all values.

### 5. Strict Mode from Day 1
>
> "For new projects: Set up Next.js with `strict: true` in tsconfig from day 1"

Catches issues during development, not just at build time.

---

## 🔄 Development Workflow Prompts

### 6. Incremental Verification
>
> "Always verify builds after each significant change"

Don't let 10 errors accumulate - fix 1 at a time.

### 7. Impact Analysis Before Refactoring
>
> "When refactoring types, use IDE 'Find All References' before changing"

Understand the full impact before making changes.

### 8. Exhaustive Type Discovery
>
> "For string union types, search codebase for all possible values before defining"

Prevents the "TabId is missing 'KANBAN'" type of errors.

### 9. Flexible Record Types
>
> "Prefer `Partial<T>` or `Record<string, T>` over strict Record types when values are dynamic"

`Partial<Record<TabId, T>>` is more forgiving than `Record<TabId, T>`.

### 10. CI Build Checks
>
> "Run the build in CI on every commit"

Catches issues before they accumulate in production.

---

## 🚨 Red Flags to Watch For

| Warning Sign | What It Means |
|--------------|---------------|
| `as any` everywhere | Types were bypassed, will break later |
| Multiple type definition files | Potential for drift and conflicts |
| No CI build step | Errors accumulate unchecked |
| `npm run dev` works but `build` fails | Strict mode not enabled in dev |
| Frequent type imports from different folders | No single source of truth |

---

## 📋 Pre-Production Checklist

Before deploying any AI-assisted code:

- [ ] `npm run build` passes with zero errors
- [ ] No `// @ts-ignore` comments
- [ ] No `as any` type casts (or justified ones only)
- [ ] All shared types come from ONE location
- [ ] String literal types include ALL possible values
- [ ] CI pipeline includes build step

---

## 💡 Why This Matters

AI assistants optimize for **immediate functionality** - getting code working. They don't naturally:

- Consider long-term maintainability
- Verify against production build settings  
- Check for type consistency across files
- Ensure exhaustive type unions

The prompts above force these considerations into the AI's workflow.

---

*Generated from a real production build failure debugging session - January 2026*
