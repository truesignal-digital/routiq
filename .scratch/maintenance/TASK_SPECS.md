# Maintenance module (work orders) — build specs

Variant D chosen from prototype (ticket #31): dense work-order table + per-row chronologie sheet.
MAINTENANCE module only. INVENTORY (stock) is a separate module and is OUT of this build entirely —
no stock tables, no stock commands, no Stock tab in the UI. The only future coupling point is
IssueStock targeting a work order, which will land with the INVENTORY module later.

Authority: ARCHITECTURE.md §5.1 catalog, CONTEXT.md glossary (Signalement, Work Order,
Remise en service, Operational Issue). Match their naming exactly.

## Domain decisions (fixed — do not re-litigate)

- **Commands (all `.v1`)**: `report-issue`, `create-work-order`, `complete-work-order`,
  `cancel-work-order`, `release-asset-to-service`.
- **Approval defaults** (registry): report-issue AUTO; create-work-order AUTO (threshold rules may
  add approval above expected cost — rule mechanism, not command logic); complete-work-order AUTO
  (same threshold mechanism on declared actual cost); cancel-work-order AUTO;
  release-asset-to-service ALWAYS 1 human approval, never AI, releaser ≠ performer when the
  linked issue is safety-critical.
- **Work order references at most one operational issue** (`issueId` optional — absent = preventive).
- **Safety-critical issue ⇒ asset UNAVAILABLE immediately** (availability interval opens at report).
  Only release-asset-to-service closes it. Availability ≠ lifecycle status.
- No new work orders on SOLD / RETIRED / WRITTEN_OFF assets.
- Money: `moneyMinor` (bigint minor units + currency); XAF exponent 0.
- IDs client-generated UUIDs (offline capture); issues + work orders are facts capturable offline;
  release-to-service is a decision — server only.
- Statuses (work order): OPEN → (closure declared) PENDING_CLOSE → CLOSED, or CANCELLED.
  Approval pipeline states (submitted/approved) come from the shared approval machinery,
  not duplicated as work-order columns.
- Corrections: append-only supersede — never edit a closed work order.

## Phase 1 — contracts (packages/contracts)

One file per command in `src/commands/`, composing `commandEnvelope` from `envelope.ts`.
Payloads minimal (MTP): report-issue { issueId, assetId, description, safetyCritical,
category? }; create-work-order { workOrderId, assetId, issueId?, description, expectedCostMinor?,
currency }; complete-work-order { workOrderId, actualCostMinor?, currency, summary?,
expectedVersion via envelope }; cancel-work-order { workOrderId, reason };
release-asset-to-service { assetId, workOrderId, note? }.
Register in index, COMMAND_QUEUEABILITY (issues/WO create/complete queueable offline;
release + cancel NOT queueable), approval-defaults registry. Tests per command file;
registry test must keep catching missing entries.

## Phase 2 — API (apps/api)

Tables: `operational_issues`, `work_orders`, `asset_availability_intervals` — workspace_id on all,
composite tenant FKs, row_version, created_by_command_id. Migration via drizzle-kit.
**Journal `when` MUST exceed the last applied entry's watermark — verify against
apps/api/drizzle/meta/_journal.json before finishing.**
**Approval-rule backfill migration for EXISTING workspaces** (mirror 0020/0026 pattern) for
release-asset-to-service — without it the command 403s APPROVAL_REQUIRED on live tenants.
Handlers implement CommandDefinition, registered via registerCommand, execute inside the
transaction. Testcontainers suites required — run them, Docker must be up.

Also: add `work_order_id` attribution to `financial_postings` (schema comment at the
financialPostings table explicitly defers it to this spec). Mirror the existing
`activity_id` pattern exactly: nullable uuid column + FK, `financial_postings_ws_work_order_idx`
index, optional `workOrderId` on the posting-line schema in
packages/contracts/src/commands/record-financial-entry.ts, handler validates the work order
exists in the workspace and is not CANCELLED. This is how labor/parts costs attach to a
work order (§4.2) and what the chronologie read joins on.

## Phase 3 — reads (apps/api + contracts/reads)

- `GET /v1/work-orders` — list with status, asset label, branch, expected/actual cost, issue link.
- `GET /v1/work-orders/:id` — detail + chronologie: ordered events from command receipts/audit
  (created, closure declared, approved, released, cancelled) + linked financial postings
  (postings carrying work_order_id).
- `GET /v1/issues` — signalements list with linked work order + availability state.

## Phase 4 — web (apps/web)

`/maintenance` route + nav entry gated on MAINTENANCE module (and capabilities once identity
branch merges — build against main's gating for now). Variant D layout, French-first:
Ordres de travail / Signalements tabs; DataTable (registry conventions — see
.scratch/ui registry docs and existing screens); row opens right-side sheet with chronologie
timeline + actions (Valider la clôture, Remise en service) permission-gated. NO Stock toggle.
i18n keys en + fr, no sentence concatenation. Reuse prototype's visual language, not its code —
prototype (main tree, untracked) is throwaway.

## Verification bar (every phase)

pnpm typecheck; package-scoped vitest suites green; API phases: testcontainers suites run
for real. Report failures verbatim.
