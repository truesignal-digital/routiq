# 04 — AssetActions → rowActions + dialogs

Status: ready-for-agent
Blocked by: 03

## Task

Retire the inline expanding panel strip. Commission and Assign-branch become entries in the DataTable `rowActions` ⋯ menu, each opening a Dialog (mirror ActivityActions' CloseDialog shape: header, form, footer, pending state, error banner, notify toast on success, query invalidation).

## Requirements

- Same gating as today: Commission only for REGISTERED; hidden entirely for read-only roles / disposed assets; `// role-config` seam preserved.
- Conflict (409) and approval-required outcomes render inside the dialog (toned like today's bg-warning/info) — not silent toasts.
- expectedVersion/rowVersion handling identical to current behavior.
- Detail screen: keep actions available there too (same dialogs, button row like ActivityDetail).
- Tests: migrate AssetActions test scenarios to the dialog flows; role gating; conflict path.

## Acceptance

- [ ] `pnpm typecheck` && full `pnpm --filter @routiq/web test` green
- [ ] No inline panel remnants; registry entry updated if the component file moved
