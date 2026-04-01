# Branch Protection Settings (`main`)

Configure these in GitHub repository settings.

## Required protections
- Require pull request before merging.
- Require approvals: **1 minimum**.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merge.
- Require status checks to pass:
  - `ci / web-quality`
  - `migration-guard / validate-migrations` (when applicable)
- Require branches to be up to date before merging.
- Restrict who can push to `main` (maintainers only).
- Do not allow force pushes.
- Do not allow branch deletions.

## Recommended protections
- Require signed commits for maintainers.
- Enable merge queue when PR volume increases.
- Require linear history.

## Runtime-critical directory policy
For changes under:
- `supabase/functions/**`
- `supabase/migrations/**`
- `api/**`

Use an explicit rollback note in PR description and include runbook reference.
