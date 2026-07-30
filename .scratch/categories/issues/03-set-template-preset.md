# 03 — `set-template-preset.v1`

Status: resolved
Blocked by: 01

## Task

The missing writer for `workspace_templates` on existing workspaces. Mirror `module-toggle.ts` (ADMIN, CORE, workspace scope, before/after audit). Handler in `apps/api/src/commands/set-template-preset.ts`.

## Requirements

- **Grandfather materialization** (spec § design decisions): zero rows for the workspace → this first call writes rows for ALL `TEMPLATE_CODES`: the target with the requested `enabled`, every other code `enabled=true`. Comment why (ending grandfathering must not silently disable the other preset). Later calls update the one row (rowVersion bump, `updatedByCommandId`).
- **Last-preset guard**: refuse disabling when it would leave zero enabled presets — stable 409 `LAST_PRESET` (+ fr/en strings). Compute inside the transaction against current rows (materialization included).
- Setting a preset to its current state → refuse `PRESET_ALREADY_SET` or succeed idempotently — decide, document, test (match whatever 02 chose for deactivate symmetry).
- Approval default (core pack) + `COMMAND_QUEUEABILITY` (decision — never queued) + server.ts import.
- Tests: materialization (zero-row workspace, disable TRUCKING → TRUCKING disabled AND PASSENGER_TRANSPORT explicitly enabled, workspace no longer grandfathered — assert via `presetEnablement`); last-preset guard; normal toggle on provisioned workspace; `/v1/me` reflects the change; audit before/after.
- Ops note for Comments when done: the command that backfills `sotrafret` in dev is one CLI-less dispatch away — document the exact payload an admin session would send, but do NOT run it against the dev DB (grandfathered UX is being demoed).

## Acceptance

- [ ] `pnpm typecheck` && full `pnpm --filter @routiq/api test` green
- [ ] Grandfather-transition test proves no silent disable of the untouched preset

## Comments

2026-07-30 — Done (Opus 5 worker cat-02 + review). set-template-preset.ts + tests. Grandfather materialization writes ALL preset rows on first call (others enabled=true) with per-row template_preset.materialized audit events; no-op guard deliberately skipped for the materializing call (ending grandfathering IS a state change). LAST_PRESET computed post-materialization inside the transaction. /v1/me asserted through the full transition cycle.

KNOWN GAP (systemic, worker-found): workspaces provisioned before a command existed have no approval_rules row for it — evaluateApproval rejects even ADMIN. Affects all five new commands on sotrafret/tenant-two/demo-passenger. Insert-only packs mean this is an ops SQL step per tenant until pack-replay-as-command lands (research item 2 / provision replay seam). Backfill payload documented in worker report; NOT run against dev.
