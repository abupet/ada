# AGENTS.md v1
# Operational rules for Codex on ADA

This file defines **how Codex must operate** when developing ADA.
It is aligned with `handoff.md` and is **mandatory**.

---

## 1. Source of truth

Codex must follow, in this order:

1. `handoff.md` (primary operational guide)
2. `specs/PROMPT.md` (current version requirements)
3. Existing codebase and tests
4. CI feedback (GitHub Actions)

If instructions conflict, **handoff.md wins**.

---

## 2. Development rules

### 2.1 Branching
- Never work on `main`
- Always create a dedicated branch
- Naming:
  - `feat/<short-description>`
  - `fix/<short-description>`
  - `ci/<short-description>`

### 2.2 Commits
- Small, focused commits
- Clear messages
- No unrelated changes

---

## 3. Specs lifecycle

- Active specs live in:
  - `specs/PROMPT.md`

- After full implementation:
  1. Rename to `PROMPT+<version>.md`
  2. Move to `specs/archive/`
  3. Only after CI (PR) is green

Never archive specs early.

---

## 4. Local testing (required)

```bash
npm ci
npm run serve          # http://localhost:4173
npx playwright test --grep "@smoke"
```

Full suite if needed:
```bash
npx playwright test
```

Local `.env` may be used but never committed.

---

## 5. CI on GitHub

### 5.1 CI (PR) – mandatory
- Runs on every PR
- MODE=MOCK
- STRICT_NETWORK=0
- Must be green to merge

### 5.2 CI (REAL)
Triggered by:
- Nightly schedule
- Label `run-real`
- Automatic labeling for risky paths

REAL configuration:
- MODE=REAL
- STRICT_NETWORK=1
- ALLOW_OPENAI=1
- STRICT_ALLOW_HOSTS=cdnjs.cloudflare.com

---

## 6. Labels

Automatically applied:
- ci
- tests
- docs
- backend
- docs

Special:
- `run-real` → triggers REAL tests

Codex must not remove labels manually.

---

## 7. Handling CI failures

When CI (PR) fails:
1. Read the automatic PR comment
2. Open the linked run
3. Identify root cause
4. Use artifacts if Playwright failed
5. Fix and push

Never bypass tests.

---

## 8. Explicit prohibitions

- ❌ Do not use `ada-tests.sh` in GitHub CI
- ❌ Do not disable or skip tests
- ❌ Do not commit secrets
- ❌ Do not merge without CI (PR) green
- ❌ Do not change workflows without understanding impact

---

## 9. Definition of done

A change is complete only when:
- Specs are implemented
- CI (PR) is green
- Any triggered CI (REAL) is green
- Specs are archived correctly

---

Codex must operate as if CI enforcement were absolute.
