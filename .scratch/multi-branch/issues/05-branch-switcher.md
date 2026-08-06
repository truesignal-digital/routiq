# 05 — shell branch switcher + ambient current branch

Status: done (2026-08-06) — visually verified: switcher in header, selection narrows + persists across nav/reload (localStorage per workspace), asset form preselects current branch. Screenshot: visual-05-switcher.png
Depends: 04 (multi-branch workspace exists to test against)

## Goal

"Log into a branch" UX: a member whose scope spans >1 active branch picks a working branch once; lists and forms follow. Superboss toggles per-branch / all-branches.

## Scope

1. **Client state** `apps/web/src/shell/branch-context.tsx` (or auth-adjacent): `currentBranchId: string | "ALL"`, default "ALL", persisted localStorage key `routiq.branch.<workspaceSlug>`. Derived from `/v1/me` scope + reference branches read: options = active branches within caller scope. If scope resolves to exactly one branch → locked to it, no switcher rendered (current auto-collapse behavior preserved). If persisted id no longer valid (deactivated/scope-revoked) → reset to "ALL".
2. **Switcher UI** in AppShell sidebar/topbar (fits existing shell layout — judge placement from AppSidebar structure): Select showing branch name, "Toutes mes agences" option. fr/en strings.
3. **Wiring — lists**: assets, activities, finance entries, persons, dashboard reads default their `branchId` filter from context when set (user can still override per-table filter; explicit table filter wins). Touch points: `AssetsStub.tsx:81-96`, `ActivitiesScreen.tsx:76`, `activities/usePersons.ts:16`, `finance/useEntries.ts:22`, dashboard hook.
4. **Wiring — forms**: branch Select in AssetRegister/FinanceRecord/Persons/ActivitySheet preselects currentBranch when not "ALL" (still editable; server authorizes regardless).
5. **Tests**: context reducer/persistence unit tests; one screen test proving list hook receives branchId from context and that explicit filter overrides; switcher hidden when single-branch scope.

## Out of scope

Server-side "current branch" (deliberately none — spec decision 6). Per-branch dashboards beyond existing branchScoped reads.

## Evaluate before build

Check dashboard read (`reads/dashboard.ts` + web hook) actually accepts a branchId narrow param — if not, either add it (small ADR-0003-conformant param) or leave dashboard scope-wide and state so in the report. Decide with orchestrator before implementing dashboard wiring.

## Verify

`pnpm typecheck`; full web vitest. VISUAL: orchestrator in browser — multi-branch workspace, switch branch → lists narrow, forms preselect; single-branch user → no switcher; deactivate current branch in another tab → context resets gracefully on reload.
