# 31 — `dispose-asset.v1`: the missing terminal lifecycle command

Status: ready-for-agent
Phase: 6
Blocked by: —

**What to build:** The MTP catalog (ARCHITECTURE.md §5.1) lists **DisposeAsset**, and it is the only lifecycle command never implemented — assets can be registered, commissioned and assigned, but never taken out of the fleet. What Linus calls "archiving" an asset is this command. Contracts + handler + schema migration + approval-rule seed **and backfill**. No UI (ticket 35).

## Design

### Contracts

`packages/contracts/src/commands/asset-lifecycle.ts` (already exported wholesale from `src/index.ts` line 11 — no barrel edit needed):

```ts
export const assetDisposalStatuses = ["SOLD", "RETIRED", "WRITTEN_OFF"] as const;

export const disposeAssetPayload = z.object({
  assetId: z.uuid(),
  targetStatus: z.enum(assetDisposalStatuses),
  /** Required: a disposal is a permanent, non-reversible lifecycle fact and the
   *  audit trail must carry why. */
  reason: z.string().min(1).max(500),
  disposedAt: z.iso.datetime({ offset: true }).optional(),
});
export type DisposeAssetPayload = z.infer<typeof disposeAssetPayload>;
```

Zod 4 spellings (`z.uuid()`, `z.iso.datetime({ offset: true })`) — the file's existing schemas show the house form. `reason` bounds match `rejectEntryPayload` (`packages/contracts/src/commands/approve-entry.ts`): `min(1).max(500)`. Add a payload test alongside the existing ones.

### Handler

`apps/api/src/commands/asset-lifecycle.ts`, mirroring `commissionAsset` in that file — same load-check-version-update-audit shape, same `CommandError` codes:

```ts
export const disposeAsset: CommandDefinition<DisposeAssetPayload> = {
  name: "dispose-asset",
  module: "ASSETS",
  version: 1,
  allowedRoles: ["ADMIN", "FINANCE_APPROVER"],
  payloadSchema: disposeAssetPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => assetBranchIds(tx, ctx, [payload.assetId]),
  },
  async execute(tx, ctx, envelope, payload) { /* ... */ },
};
registerCommand(disposeAsset);
```

Body, in order:

1. Load the asset scoped by `workspaceId` + `id`; missing → `CommandError(422, "REFERENCE_NOT_FOUND", { referenceType: "asset", referenceCode: payload.assetId })`.
2. `checkOptimisticVersion(envelope, asset.rowVersion)` — `updateAssetAtVersion` also throws `EXPECTED_VERSION_REQUIRED` when the envelope omits it, so `expectedVersion` is effectively mandatory. Good: the bulk path must not dispose a stale row.
3. **Terminal → terminal is `409 INVALID_STATE_TRANSITION`** with `{ from: asset.lifecycleStatus, to: payload.targetStatus }`, i.e. reject when `lifecycleStatus` is already one of `SOLD` / `RETIRED` / `WRITTEN_OFF`. **This is what makes bulk replay safe** (ticket 32/35): a second dispose of the same asset is a clean, per-row terminal refusal the dialog renders as a translated failure — not a silent second write, and not a crash that aborts the rest of the batch.
4. `updateAssetAtVersion(tx, ctx, envelope, asset.id, { lifecycleStatus: payload.targetStatus, disposedAt, disposalReason: payload.reason })` where `disposedAt = payload.disposedAt ? new Date(payload.disposedAt) : new Date()` (the `commissionedAt` pattern). `AssetVersionedChanges` is `Omit<Partial<typeof assets.$inferInsert>, "id" | "workspaceId" | "rowVersion" | "createdByCommandId">`, so the new columns are accepted the moment the schema has them.
5. `appendAuditEvent(..., { eventType: "asset.disposed", entityType: "asset", entityId: asset.id, beforeState, afterState, changedFields: ["lifecycleStatus", "disposedAt", "disposalReason", "rowVersion"] })`.
6. Return `{ recordId: asset.id, rowVersion: updated.rowVersion }`.

**Do NOT declare `operationalAssetId`.** The dispatcher rejects `SOLD`/`RETIRED`/`WRITTEN_OFF` targets with `409 ASSET_NOT_OPERATIONAL` before any handler runs (`apps/api/src/commands/dispatcher.ts` ~lines 248-264) — that guard exists to stop new *operational records* landing on a dead asset. `dispose-asset` targets a **live** asset and is the command that makes it dead; declaring the hook would make the command reject every legitimate call the moment the asset was already terminal, with the wrong code and no version check. The terminal→terminal refusal in step 3 is the handler's own business rule. Put this reasoning in a comment — it is exactly the kind of thing a later reader "fixes".

### Migration 1 — columns

New drizzle migration adding to `assets` (`apps/api/src/db/schema.ts` ~line 229, near `commissionedAt`):

```ts
disposedAt: timestamp("disposed_at", { withTimezone: true }),
disposalReason: text("disposal_reason"),
```

Both **nullable** — every existing asset is undisposed, and there is no sensible default. Generate with `pnpm db:generate`; commit the generated SQL and the `meta` journal update.

### Migration 2 — approval rules, seed AND backfill

**This is the easiest thing to miss in this whole batch, and it fails closed and silently.** `evaluateApproval` rejects any command with no matching rule as `403 APPROVAL_REQUIRED` — the safe default. Approval rules are inserted **only at workspace creation** (`defaultApprovalRules` in `apps/api/src/commands/approval-defaults.ts`, called from `apps/api/src/test/seed.ts`). Both pilot workspaces already exist. So adding the rule to `approval-defaults.ts` alone makes the command work in tests and **403 on every real call**.

Ship both halves in this ticket:

- **Seed:** add `dispose-asset` rows to `defaultApprovalRules` for `ADMIN` and `FINANCE_APPROVER`, wildcard filters (`categoryCode: null`, `branchId: null`, `amountMinMinor: null`, `amountMaxMinor: null`), matching the existing entries in that file. `apps/api/src/commands/registry.test.ts` already asserts every registered command has a catalog default and will fail loudly if you skip this — it is a guard, not the whole job.
- **Backfill:** a custom SQL migration modelled on `apps/api/drizzle/0012_finance_command_defaults.sql`. Copy its shape exactly: `INSERT ... SELECT w.id, 'dispose-asset', ... FROM workspaces w CROSS JOIN (VALUES ('ADMIN'), ('FINANCE_APPROVER')) AS rule(required_role) WHERE NOT EXISTS (...)` with the full `IS NULL` / `IS NOT DISTINCT FROM` guard so the insert is independently idempotent and safe to re-run after a partial apply.

**Role choice:** `ADMIN` + `FINANCE_APPROVER`. Disposal writes off an asset's book value, which is a finance decision, not an operations one — `OPS_MANAGER` is deliberately excluded (unlike commission/assign). A generic approval queue for disposals is out of scope for the pilot; role gating *is* the control.

### `rowVersion` on the assets read — already present

The plan flagged this as uncertain. Verified: `assetListItem` in `packages/contracts/src/reads/assets.ts` has `rowVersion: z.number()`, the read selects `rowVersion: assets.rowVersion` (`apps/api/src/reads/assets.ts`) and maps it, and the web-side `AssetListItem` (`apps/web/src/assets/model.ts`) plus the `api.ts` type guard both carry it. **Nothing to do.** Confirm by inspection; do not add a duplicate field.

## Tasks

- [ ] `disposeAssetPayload` + `assetDisposalStatuses` in `packages/contracts/src/commands/asset-lifecycle.ts`, with a payload test.
- [ ] `disposeAsset` handler in `apps/api/src/commands/asset-lifecycle.ts` + `registerCommand`, with the no-`operationalAssetId` comment.
- [ ] `disposed_at` / `disposal_reason` columns on `assets` in `apps/api/src/db/schema.ts` + generated migration.
- [ ] `dispose-asset` rows in `defaultApprovalRules` (ADMIN, FINANCE_APPROVER).
- [ ] Custom backfill migration for existing workspaces, idempotent, modelled on `0012_finance_command_defaults.sql`.
- [ ] Tests in `apps/api/src/commands/lifecycle.test.ts` (where the other asset-lifecycle commands are covered).

## Acceptance

- [ ] Test: ADMIN and FINANCE_APPROVER dispose successfully to each of `SOLD`, `RETIRED`, `WRITTEN_OFF`; row shows the new status, `disposedAt`, `disposalReason`, bumped `rowVersion`.
- [ ] Test: `OPS_MANAGER` and `FIELD_SUBMITTER` are refused (`ROLE_FORBIDDEN` / `APPROVAL_REQUIRED` — assert whichever the pipeline actually produces for a role with no matching rule, and pin it).
- [ ] Test: second dispose of an already-terminal asset → `409 INVALID_STATE_TRANSITION` carrying `from`/`to`, **not** `ASSET_NOT_OPERATIONAL`.
- [ ] Test: stale `expectedVersion` → `VERSION_CONFLICT`; missing `expectedVersion` → `EXPECTED_VERSION_REQUIRED`.
- [ ] Test: **replay idempotency** — the same envelope submitted twice returns the original result with `idempotentReplay: true` and writes exactly one command receipt and one audit event.
- [ ] Test: **post-terminal operational records are blocked** — after disposal, a command that declares `operationalAssetId` (e.g. `assign-asset`) on that asset is refused `ASSET_NOT_OPERATIONAL`.
- [ ] Test: `asset.disposed` audit event with correct before/after state and `changedFields`.
- [ ] Test: cross-tenant asset id → `REFERENCE_NOT_FOUND`, never a cross-workspace write.
- [ ] Test: **backfill proof** — against a workspace seeded *without* the new rule (simulating the pilot tenants), applying the backfill migration makes an ADMIN dispose succeed where it previously 403'd; running the migration twice inserts no duplicate rows.
- [ ] `pnpm --filter @routiq/api test && pnpm --filter @routiq/contracts test && pnpm typecheck` green; `registry.test.ts` green.

## Out of scope

Any UI (ticket 35), bulk fan-out (27), an approval queue for disposals, reversing a disposal, depreciation or book-value accounting on disposal, `disposed_at` in any read projection (the read publishes `lifecycleStatus`, which is what the UI gates on).
