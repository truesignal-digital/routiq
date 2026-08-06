# 04 — branches read + branch management UI

Status: done (2026-08-06) — visually verified: create (uppercase transform, DUPLICATE_BRANCH_CODE on field), rename (code locked + hint), deactivate/reactivate badges, LAST_BRANCH alert in-dialog. Screenshot: visual-04-branches-screen.png
Depends: 01, 02

## Goal

ADMIN manages branches in the web app: list (incl. inactive), create, rename, deactivate/reactivate.

## Scope

1. **Read** `apps/api/src/reads/branches.ts` (+ route): ADMIN-only list of ALL branches in workspace (active + inactive): id, code, name, timezone, active, rowVersion, createdAt if available. Follow ADR-0003 list contract + existing read patterns (`reads/members.ts` is the closest sibling — Users screen). Contract read schema in `packages/contracts/src/reads/`.
2. **Screen** `apps/web/src/screens/BranchesScreen.tsx` (or `users/`-adjacent placement matching UsersScreen): DataTable per registry conventions (columns: code, name, timezone, status badge active/inactive), row actions rename + deactivate/reactivate (confirm dialog with LAST_BRANCH error surfaced), "Nouvelle agence" create dialog (code, name, timezone select defaulting Africa/Douala; client-generates branchId uuid). Optimistic-concurrency conflict → existing conflict-toast pattern (see assets actions `conflictBody`). Route + nav entry visible to ADMIN only (mirror how Users screen gates).
3. **i18n**: full fr ("Agences", "Nouvelle agence", "Renommer", "Désactiver", "Réactiver", status labels, hints explaining code immutability: "Le code apparaît dans les numéros de pièces et ne peut pas changer.") + en parity. No preset overlay entries (branch chrome is vocabulary-neutral).
4. **Screen tests**: render list, create flow fires command with generated uuid, deactivate confirm, LAST_BRANCH error banner, non-ADMIN sees no nav entry.

## Out of scope

Switcher (05). Member scope editing (exists — `BranchScopeField` picks up new branches automatically via reference read; verify and state in report).

## Evaluate before build

Read `docs/agents/` conventions + memory of DataTable/toast/tabs conventions in the UI registry; match UsersScreen structure closely. Confirm where ADMIN-gating helper lives.

## Verify

`pnpm typecheck`; `pnpm --filter @routiq/web exec vitest run` full; api read test (Docker). VISUAL: orchestrator walks create → rename → deactivate → reactivate in browser against local stack before commit.
