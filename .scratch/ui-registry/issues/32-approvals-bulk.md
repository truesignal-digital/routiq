# 32 — Bulk approve / reject on the approvals queue

Status: ready-for-agent
Phase: 6
Blocked by: 27, 28

**What to build:** The first user-facing bulk action. An approver selects rows in the pending queue and approves or rejects them in one gesture; each row still goes through its own `approve-entry.v1` / `reject-entry.v1` command, and the dialog reports the outcome **per row**. Also lands the shared `bulk-action-dialog.tsx` that ticket 35 reuses for asset disposal.

Files: `apps/web/src/screens/FinanceApprovalsScreen.tsx`, new `apps/web/src/components/bulk-action-dialog.tsx` (+ tests). Runs in parallel with ticket 29 — different files.

## Design

### Selection gating

`FinanceApprovalsScreen` already computes the maker guard for its `rowActions` (~line 165): `isOwnSubmission(entry.submittedByPrincipalId, me?.principalId)` from `apps/web/src/finance/model.js`, plus `canApproveEntries(me?.role, me?.enabledModules)` from `apps/web/src/finance/permissions.js`. Feed the same predicate to ticket 28's new prop:

```ts
enableRowSelection={canApprove}
getRowCanSelect={(entry) => !isOwnSubmission(entry.submittedByPrincipalId, me?.principalId)}
```

The maker guard is **server-enforced** (`MAKER_CANNOT_APPROVE`); this only stops the operator building a batch that is guaranteed to fail on those rows. Keep the existing `guard` column badge — it explains the disabled checkbox.

### Selection toolbar

```tsx
selectionToolbar={({ selectedRows, clearSelection }) => (
  <>
    <Button onClick={() => openBulk("approve", selectedRows)}>
      {t("finance.approvals.bulkApprove", { count: selectedRows.length })}
    </Button>
    <Button variant="destructive" onClick={() => openBulk("reject", selectedRows)}>
      {t("finance.approvals.bulkReject", { count: selectedRows.length })}
    </Button>
  </>
)}
```

Labels are ICU: « Approuver ({count}) » / « Rejeter ({count}) ». `clearSelection` is called once the dialog settles and the operator closes it.

### `components/bulk-action-dialog.tsx` — shared, generic

Generic over the per-row payload `P` and over the shared operator input `TInput` (approvals: `{ note?: string }` / `{ reason: string }`; ticket 35: `{ targetStatus, reason }`). It owns the three phases and nothing domain-specific.

```ts
export interface BulkActionDialogProps<TRow, P, TInput> {
  open: boolean;
  title: string;
  confirmLabel: string;
  rows: TRow[];                                   // snapshotted on open — see below
  rowLabel: (row: TRow) => string;                // « ÉCR-2026-0142 »
  /** The shared-input form. Returns undefined while the input is invalid. */
  renderInput: (ctx: { value: TInput; onChange: (v: TInput) => void }) => ReactNode;
  initialInput: TInput;
  validate?: (input: TInput) => boolean;
  toBulkRow: (row: TRow, input: TInput) => BulkRow<P>;   // payload + per-row expectedVersion
  runner: BulkRunner<P>;                          // held in a ref by the caller
  onSettled: () => void | Promise<void>;          // ONE invalidation
  onClose: () => void;
}
```

**Phases:**

1. **confirm** — the row count, the shared-input form, cancel + confirm. **One note/reason for the whole batch**, not one per row: the reject reason is required server-side (`rejectEntryPayload.reason` is `min(1).max(500)`) and asking for ten of them is unusable. Validate reject with the existing `validateRejectionReason` (`apps/web/src/finance/model.ts` — trimmed, 1..500), same rule the single-row dialog already uses. Approve's note stays optional.
2. **running** — a progress indicator fed by the runner's `onProgress` (« 3 / 8 »), all controls disabled, and **closing is blocked**: no `onOpenChange` dismissal, no escape, no backdrop close. Commands are already in flight; letting the dialog vanish would leave the operator with no idea which rows landed.
3. **results** — one line per row: `rowLabel(row)` plus either a success mark (with the command's `warnings` rendered if any) or the failure's translated code via `errorMessage(i18n, code)` (`apps/web/src/lib/error-message.ts`). **Failures sort first** — that is the part needing action. A « Réessayer » button appears only when at least one failure is `NETWORK_ERROR`, and it re-runs **only those rows** through the **same** runner instance.

**Why the same runner:** ticket 27's runner keys one `SubmissionCache` per row id, so a retried row re-posts the byte-identical envelope — same `commandId`, same `idempotencyKey` — and the server replays instead of double-posting. Constructing a new runner (or a new `CommandIntent`) on retry re-mints the keys and reintroduces exactly the double-post this design exists to prevent. Hold the runner in a `useRef` in the screen, not in dialog state:

```ts
const approveRunner = useRef(createBulkRunner<ApproveEntryPayloadType>(commandClient, "approve-entry", 1));
const rejectRunner  = useRef(createBulkRunner<RejectEntryPayloadType>(commandClient, "reject-entry", 1));
```

`VERSION_CONFLICT`, `INVALID_STATE_TRANSITION` and `MAKER_CANNOT_APPROVE` are terminal per row and get **no** retry button — retrying is guaranteed to fail again. The remedy is refreshing the queue, which the settle invalidation already does.

**Row snapshot:** the dialog copies `rows` on open and renders results against that copy. The settle invalidation refetches the queue and the approved entries **leave it**; if the results list read live query data it would empty itself out from under the operator mid-read.

**Per-row `expectedVersion`:** each pending entry carries its own `rowVersion` (`pendingApprovalItem` extends `financialEntryListItem`, which has it). `toBulkRow` must set `options: { expectedVersion: row.rowVersion }` per row — a single shared version would be wrong for every row but one.

### Settle

**One invalidation when the whole batch finishes** — reuse the screen's existing `invalidateDecided` (invalidates the `["ws", slug, "finance", "approvals"]` and `["ws", slug, "finance", "entries"]` keys). Never per row, and **never patch the cache locally**: ADR-0001 says a decided entry leaves the queue because the server said so. Then `notifyCommandSuccess("finance", ...)` for the settle toast — one toast per batch, not per row; the per-row detail is in the results list.

### i18n

New keys under `finance.approvals` in `apps/web/src/i18n/locales/fr.json` + `en.json` — bulk labels (ICU `{count}`), the three phase titles, progress (`{done}` / `{total}`), the results headings, retry. `locales.test.ts` enforces fr/en parity, non-empty values, and ICU-only interpolation. Zero literals.

## Tasks

- [ ] `getRowCanSelect` + `enableRowSelection` + `selectionToolbar` on the approvals `DataTable`.
- [ ] New `apps/web/src/components/bulk-action-dialog.tsx` with the three phases, generic over `P` and `TInput`.
- [ ] Approve/reject runners in refs; per-row `expectedVersion`; retry restricted to `NETWORK_ERROR` rows through the same runner.
- [ ] One `invalidateDecided` + one success toast on settle; no cache patching.
- [ ] i18n fr+en; zero literals.
- [ ] Keep the existing single-row ⋯ menu approve/reject path working unchanged.
- [ ] Tests in `apps/web/src/screens/FinanceApprovalsScreen.test.tsx` and a dialog-level test.

## Acceptance

- [ ] Test: the maker's own rows are unselectable and excluded from select-all; the guard badge still renders.
- [ ] Test: selecting n rows shows « Approuver (n) » / « Rejeter (n) »; the count is the cross-page selection total.
- [ ] Test: bulk approve of 3 rows issues **3 separate submits**, one per entry id, each with that entry's own `expectedVersion`.
- [ ] Test: reject confirm is disabled until the shared reason passes `validateRejectionReason`; the same reason reaches every row's payload.
- [ ] Test: mixed batch (2 ok / 1 `VERSION_CONFLICT`) renders per-row results with failures first and the conflict's translated message; **no retry button** for a conflict-only failure set.
- [ ] Test: a `NETWORK_ERROR` row offers retry, and retrying re-posts the **identical** envelope (same `commandId` + `idempotencyKey`) for that row — the double-post guard, asserted at the screen level and not only in ticket 27's unit test.
- [ ] Test: the dialog cannot be closed during the running phase (escape, backdrop, and close button are all inert).
- [ ] Test: exactly **one** invalidation fires after the batch settles, regardless of row count or partial failure; results stay readable after the refetch.
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; jsdom command-routing tests stay green.
- [ ] Browser walk as smoke-approver: select several submitted entries (maker rows unselectable), bulk-approve with a note, see per-row results, and watch the queue refetch minus the approved rows.

## Out of scope

Rows-per-page and totals on this screen (ticket 33 — same file, sequential, do not start it here), asset disposal UI (35), a server batch command, bulk actions on entries/periods/documents, undo.
