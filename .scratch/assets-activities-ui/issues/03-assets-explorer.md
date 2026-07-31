# 03 — Assets list on DataTable (`assets-explorer` block)

Status: resolved
Blocked by: 01, 02

## Task

Replace AssetsStub's hand-rolled card grid with the DataTable basis per the design doc wireframe. Register the screen as an `assets-explorer` block (like dashboard-home).

## Requirements

- Columns: asset (primary: `assetCode · name`, sole click target → detail), status (StatusBadge, existing tones), category, branch, registration (mobile hidden). Mobile meta: primary = asset+status per activityColumns pattern.
- Filters: search (server `search` param, debounced via DataTable's filter machinery), status select (ALL/IN_SERVICE/ATTENTION semantics preserved from today's pills), category select (categories read), branch select. All server-side.
- metric-strip fed by `/v1/assets/summary` (from 01) — no client counting anywhere.
- Keyset pager (loadMore/prev per the table basis); sort on assetCode via 01's sortFields.
- Keep: FAB on mobile, both EmptyState variants (narrowed vs truly empty), PermissionDenied/module gating, DocumentsLink reachable (as a row action or in-row link — pick what the table basis supports cleanly, note the choice).
- Delete `assets/model.ts` hand-rolled type; import contract inferred types everywhere it was used.
- AssetActions keeps working during this issue (still inline is fine — 04 reworks it); if the inline panel can't live in a table row sanely, coordinate: land 03+04 together rather than shipping a broken intermediate.
- Update the AssetsStub tests (roles/filters) to the new structure — keep their scenarios, don't delete coverage.

## Acceptance

- [ ] `pnpm typecheck` && full `pnpm --filter @routiq/web test` green (registry.test.ts includes assets-explorer)
- [ ] No client-side asset counting remains

## Comments

2026-07-31 — Done (ui-api/Opus + review). Committed ea47dd7 (with 04). DataTable + metric strip + server filters + assetCode sort; model.ts deleted for contract types; module gating added (old screen had none); reference read now carries branch ids (ticket 05 reuses). AssetsStub.tsx filename kept — rename deferred to a quiet moment (router.tsx contention).
