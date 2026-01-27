# pull_request_template.md v1

## Summary
Describe what this PR changes and why.

## Type
- [ ] Bug fix
- [ ] Feature
- [ ] Refactor / Tech debt
- [ ] Tests
- [ ] Docs
- [ ] CI / Tooling

## Checklist (required)
- [ ] CI (PR) is green
- [ ] No secrets committed (policy checks pass)
- [ ] Release notes updated in `RELEASE_NOTES.md` (cumulative), if user-facing change
- [ ] Tests added/updated where appropriate

## Testing notes
- How to validate locally:
  - `npm ci`
  - `npm run serve` (port 4173)
  - `npx playwright test --grep "@smoke"`

## Risk / rollout
What could break? Any migration steps?

## Screenshots / artifacts (if relevant)
Attach UI screenshots or link to Playwright artifacts from the CI run.
