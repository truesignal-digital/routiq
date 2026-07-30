# 08 — Single-preset web UX

Status: ready-for-agent
Blocked by: 07

Roadmap item 2, web half. ADR-0004: "a single-preset workspace gets single-preset UX with no template picker." Today the web shows both business types to every tenant.

## Requirements

- Source of truth: `enabledPresets` from `/v1/me` (issue 07), surfaced wherever the web already holds `enabledModules` (find the session/me store and mirror the pattern).
- Mapping: sheet template `journey` ↔ `PASSENGER_TRANSPORT`, `haulage` ↔ `TRUCKING`. Put the mapping in one exported place (likely `apps/web/src/activities/sheet-model.ts`), not inline in screens.
- `ActivitySheetScreen` (`apps/web/src/screens/ActivitySheetScreen.tsx`): when one preset is enabled, no template switcher — render the single template directly (default template = the enabled one, URL/template param outside the enabled set falls back to it). Two presets → current behavior.
- `AssetRegisterScreen`: `templateCode` picker hidden when one preset; the field auto-set to it. Two → current behavior.
- Sweep for other preset-choice surfaces (grep web src for TEMPLATE_CODES / templateCode / journey-haulage switches, non-test) and collapse them the same way; list what you found in Comments.
- Grandfathered tenants (both presets returned) keep today's UX — no special casing beyond what 07 returns.
- Tests: single-preset → no switcher, correct template preselected, asset register auto-set; dual-preset → switcher present. Mirror the existing screen-test style (the repo has extensive screen tests).
- i18n: no new user-facing strings expected; if any are needed, fr + en both.

## Caution

`ActivitySheetScreen.tsx`, `sheet-model.ts` and several activities files are uncommitted work from the activities workstream sitting in the tree. Build on them as they are; keep edits minimal and scoped so the diff stays reviewable.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @routiq/web test` full green
- [ ] Manual check note: which screens collapse for a single-preset tenant
