# 16 — ICU: `{{count}}` keys render literal braces

Status: ready-for-agent
Phase: 4
Blocked by: —

**What to fix:** The app's i18next instance uses `i18next-icu`, so i18next-style `{{count}}` interpolation is dead — the braces render literally. Found by the ticket-10 worker via a probe test.

## Context

Known broken keys (both fr.json and en.json):
- `finance.periods.entryCount` → renders `{{count}} écriture(s)` verbatim.
- `finance.navigation.approvalsBadge` → `{{count}} approbations en attente` — used as an aria-label, so screen readers read the braces aloud.

ICU syntax works and is what `dataTable.rowCount` / `dataTable.selectedCount` (ticket 10) use: `{count, plural, one {# ligne chargée} other {# lignes chargées}}`.

## Tasks

- [ ] Grep both locale files for `{{` and convert every hit to ICU argument/plural syntax, with proper `plural` forms where the value is a count (kill the `(s)` hacks).
- [ ] Audit call sites pass the variable in the ICU name (`t(key, { count })` still works with ICU).
- [ ] Add a locales test asserting no `{{` remains in either file (guards against the i18next reflex).
- [ ] Render-test the two known-broken keys with a count and assert no braces in output.

## Acceptance

- [ ] `grep -n "{{" apps/web/src/i18n/locales/*.json` returns nothing
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green

## Out of scope

New keys, key renames, copy changes beyond the interpolation fix.

## Comments

- 2026-07-26 [codex] worker: committed as bbaff11 (locale JSON edits rode in 9742cba). 3 keys fixed incl. statusLocked {{date}}; no-{{ guard test added.
