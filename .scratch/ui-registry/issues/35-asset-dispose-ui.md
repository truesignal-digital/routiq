# 35 — Asset disposal UI: single row and bulk

Status: ready-for-agent
Phase: 6
Blocked by: 27, 28, 31, 32, 34

**What to build:** Surface `dispose-asset.v1` (ticket 31) in the app — what Linus calls "archiving" an asset. Two paths: a single-asset action on the card, and a selection mode over the card grid feeding the shared bulk dialog from ticket 32. This is the ticket that proves the bulk machinery is reusable rather than approvals-specific.

Files: `apps/web/src/assets/AssetActions.tsx`, `apps/web/src/screens/AssetsStub.tsx` (+ tests), i18n catalogs. Both files are shared with earlier tickets — **land after 34.**

## Design

### Single-asset dispose in `AssetActions`

`AssetActions.tsx` already has the exact shape to extend: a `Panel` union (`idle | assign | conflict | approval | error`), a `run()` helper that submits, toasts via `notifyCommandSuccess("assets", ...)`, invalidates `["ws", slug, "assets"]`, and maps `VERSION_CONFLICT` → conflict panel, `APPROVAL_REQUIRED` → approval panel, everything else → `ErrorBanner`. Add a `dispose` panel to that union and a « Archiver » button beside the existing Commissionner/Affecter buttons.

The panel's form: a `targetStatus` `Select` over `SOLD` / `RETIRED` / `WRITTEN_OFF` (labels from the existing `assets.status.*` keys — both catalogs already have all six lifecycle statuses) and a **required** reason `Textarea`. Confirm is disabled until the reason is non-empty and ≤ 500 characters, matching the server's `disposeAssetPayload` bound.

Submit through a `CommandIntent` in a ref, exactly like the existing commission/assign intents, with `{ expectedVersion: asset.rowVersion }`:

```ts
disposeIntent.current ??= createCommandIntent<DisposeAssetPayload>(client, "dispose-asset", 1);
```

**Gating:**

- Hidden for terminal assets. The file already computes `const disposed = ["SOLD", "RETIRED", "WRITTEN_OFF"].includes(asset.lifecycleStatus)` — reuse it; disposing an already-disposed asset would come back `409 INVALID_STATE_TRANSITION`, so never offer it.
- Role-gated to **ADMIN and FINANCE_APPROVER**, matching the command's `allowedRoles` and its approval rules (ticket 31). `isReadOnlyRole` is too coarse — an `OPS_MANAGER` may commission and assign but must not dispose. Add a small `canDisposeAsset(role)` predicate rather than inlining the array; put it next to the asset model (`apps/web/src/assets/model.ts` or a new `apps/web/src/assets/permissions.ts`, mirroring `apps/web/src/finance/permissions.ts`). Leave a `// role-config` comment at the gate, the convention ticket 26 established.
- Server enforcement is the real control; this is only about not offering an action that will fail.

### Selection mode on the card grid

The grid is not a `DataTable`, so selection is built from ticket 28's standalone `SelectionBar` plus local state:

- A « Sélectionner » toggle in the toolbar row (beside the search field and filter tabs) enters selection mode; leaving it clears the selection.
- In selection mode each card gets a checkbox. Cards that are terminal, or that the role may not dispose, render **no** checkbox and are excluded from any select-all — the same `canDisposeAsset` + `disposed` predicates as above. In selection mode, `AssetActions` on the cards should be suppressed so the card has one meaning at a time.
- `SelectionBar` renders the count, a clear control, and « Archiver ({count}) ».
- **Selection is scoped to the current pager page** (ticket 34 put a real pager here), matching the table's page-scoped select-all and capping batch size on a 2G link. Selecting by asset id means paging away and back keeps the picks.

### Bulk dispose through the shared dialog

Reuse `apps/web/src/components/bulk-action-dialog.tsx` from ticket 32 — do not fork it. Here `TInput = { targetStatus: AssetDisposalStatus; reason: string }`: **one** target status and **one** reason for the whole batch, chosen once in the confirm phase. Per-row payloads are built by `toBulkRow`:

```ts
toBulkRow: (asset, input) => ({
  id: asset.id,
  payload: { assetId: asset.id, targetStatus: input.targetStatus, reason: input.reason },
  options: { expectedVersion: asset.rowVersion },   // per row, never shared
})
```

`AssetListItem` carries `rowVersion` (verified: contracts `assetListItem`, the API read's select, and the web `model.ts` interface all have it) — pass each asset's own.

The runner:

```ts
const disposeRunner = useRef(createBulkRunner<DisposeAssetPayload>(commandClient, "dispose-asset", 1));
```

Held in a **ref**, not state. Ticket 27 keys one `SubmissionCache` per row id on the runner instance; retrying a `NETWORK_ERROR` row through the same runner re-posts the byte-identical envelope, so the server replays instead of disposing twice. A runner recreated on render, or a `CommandIntent` reused in a loop, reintroduces the double-post.

`rowLabel` is `assetDisplayName(asset)` (already in `model.ts` — make and model, falling back to the asset code); include the `assetCode` so two identical trucks are distinguishable.

Per-row failures render translated via `errorMessage(i18n, code)`. `INVALID_STATE_TRANSITION` is the expected one here — someone else disposed that asset first — and it is **terminal, no retry**. Only `NETWORK_ERROR` rows get the retry button.

**One invalidation on settle**, of `["ws", session?.workspaceSlug, "assets"]`, after the whole batch — never per row, never a local cache patch (ADR-0001). One `notifyCommandSuccess("assets", ...)` toast for the batch; per-row detail lives in the results list. Leaving selection mode after the dialog closes is the right default.

### i18n

New keys under `assets.actions` (dispose button, target-status label, reason label and placeholder, confirm) and a selection group (select mode toggle, « Archiver ({count}) », phase titles if not already covered by ticket 32's shared dialog keys) in `apps/web/src/i18n/locales/fr.json` + `en.json`. ICU plurals for counts; `apps/web/src/i18n/locales.test.ts` enforces fr/en key parity, non-empty values, and no `{{` interpolation. Zero literal strings.

## Tasks

- [ ] `canDisposeAsset(role)` predicate (ADMIN, FINANCE_APPROVER) with a `// role-config` comment at each gate.
- [ ] Dispose panel in `AssetActions`: status select + required reason, `expectedVersion`, intent in a ref, existing conflict/approval/error panels reused; hidden for terminal assets and unauthorized roles.
- [ ] Selection mode on `AssetsStub`: toggle, per-card checkboxes with the same exclusions, `SelectionBar` with « Archiver (n) », page-scoped.
- [ ] Bulk dispose through the shared `BulkActionDialog` with `TInput = { targetStatus, reason }` and a `createBulkRunner<DisposeAssetPayload>` held in a ref.
- [ ] One invalidation + one toast on settle; no cache patching.
- [ ] i18n fr+en; zero literals.
- [ ] Tests in `apps/web/src/assets/AssetActions.test.tsx` and the `AssetsStub` suites (`AssetsStub.roles.test.tsx` is where the role gating belongs).

## Acceptance

- [ ] Test: the dispose action is offered to ADMIN and FINANCE_APPROVER, and **not** to OPS_MANAGER, FIELD_SUBMITTER, or a read-only role.
- [ ] Test: the dispose action is absent on `SOLD` / `RETIRED` / `WRITTEN_OFF` assets, and those cards expose no selection checkbox.
- [ ] Test: single dispose submits `dispose-asset` v1 with `{ assetId, targetStatus, reason }` and the asset's `expectedVersion`; confirm stays disabled without a reason.
- [ ] Test: `VERSION_CONFLICT` shows the existing conflict panel, not a generic error.
- [ ] Test: bulk dispose of 3 assets issues **3 separate submits**, one per asset id, each with that asset's own `expectedVersion` and the shared `targetStatus` + `reason`.
- [ ] Test: a partial batch (2 ok / 1 `INVALID_STATE_TRANSITION`) shows per-row results with failures first, the translated message, and **no retry button** for the terminal failure.
- [ ] Test: a `NETWORK_ERROR` row retried through the same runner re-posts the **identical** `commandId` + `idempotencyKey` — the double-post guard, asserted at the screen level.
- [ ] Test: exactly **one** assets invalidation fires after the batch settles.
- [ ] Test: selection is page-scoped and survives paging away and back.
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; jsdom command-routing tests stay green.
- [ ] Browser walk as smoke-admin: enter selection mode, pick 2 assets, archive them with a reason, see per-row results, then watch the statuses flip and the hero metrics stay honest.

## Out of scope

Server work (ticket 31 shipped the command, columns, seed and backfill), an approval queue for disposals, undoing or reversing a disposal, surfacing `disposedAt` / `disposalReason` in any read or detail view, bulk commission or bulk assign, converting the card grid to a table.
