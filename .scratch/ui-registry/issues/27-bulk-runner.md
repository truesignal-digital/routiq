# 27 — Bulk command runner

Status: ready-for-agent
Phase: 6
Blocked by: —

**What to build:** The client-side fan-out that turns one operator gesture ("approve these 8") into N independent per-row commands, each an ordinary idempotent call through the existing command client. Component layer only — no screen touches this ticket. Files: new `apps/web/src/commands/bulk.ts` and `apps/web/src/commands/bulk.test.ts`.

## Design

### Why a fan-out and not a server batch command

Decided with Linus: **bulk is a client fan-out of the existing per-row commands. There is no server-side batch command and none is to be invented here.** One command = one economic fact (ARCHITECTURE.md §5). Fanning out preserves that: every row gets its own command receipt, its own audit event, its own idempotency key, and its own approval evaluation. It also means partial success is the normal case — 8 committed, 2 refused — and the UI reports it per row rather than pretending the batch is atomic. The same shape survives offline outbox replay and a future AI principal, because each row is just another envelope.

### The idempotency trap (the reason this ticket exists separately)

`SubmissionCache` (`apps/web/src/commands/submission-cache.ts`) holds exactly **one** submission:

```ts
private entry: { fingerprint: string; submission: CommandSubmission<P> } | undefined;
```

`for(payload, options)` compares a JSON fingerprint of `{ payload, options }` and mints a **new** `createSubmission` — new `commandId`, new `idempotencyKey` — whenever the fingerprint differs. `createCommandIntent` (`apps/web/src/commands/intent.ts`) wraps exactly one such cache, which is correct for a form (one form, one intent) and **wrong for a loop**.

Concretely, if a bulk loop reuses a single `CommandIntent` across rows: row A's submission is evicted by row B's, B's by C's. When the operator hits "réessayer" after a network drop, row A's payload no longer matches the cached fingerprint, so it mints a **fresh idempotency key** — and the server, which deduplicates on `idempotencyKey` (§5.3), sees a brand-new command. If A's first call actually reached the server before the connection died, A is now **posted twice**. On the connections this pilot runs on, that is not a hypothetical.

The fix is structural: the runner holds **one `SubmissionCache` per row id**, in a `Map<string, SubmissionCache<P>>` that lives on the runner object and outlives any single `run()` call. Re-running with the same row id and the same payload+options replays the identical envelope; the server answers `idempotentReplay: true` and nothing double-posts.

### API

```ts
import type { CommandResult, SubmissionOptions } from "@routiq/contracts";
import type { CommandClient, SubmitErrorCode } from "./client.js";

export interface BulkRow<P> {
  /** Stable identity of the thing being acted on — entry id, asset id. Keys the
   *  submission cache, so it must be the same string across retries. */
  id: string;
  payload: P;
  options?: SubmissionOptions;
}

export type BulkRowOutcome =
  | { id: string; ok: true; outcome: CommandResult }
  | { id: string; ok: false; code: SubmitErrorCode; metadata?: Record<string, unknown> };

export interface BulkProgress {
  done: number;
  total: number;
}

export interface BulkRunner<P> {
  run(
    rows: readonly BulkRow<P>[],
    onProgress?: (progress: BulkProgress) => void,
  ): Promise<BulkRowOutcome[]>;
}

export function createBulkRunner<P>(
  client: CommandClient,
  name: string,
  version: number,
): BulkRunner<P>;
```

### Behaviour contract

- **Sequential.** Rows are awaited one at a time, in the order given. Parallel submits would race the idempotency table and stampede a 2G link; ordering also makes the progress counter honest.
- **Never throws.** `client.submit` already converts every failure into `{ ok: false, code }` — a fetch rejection becomes `NETWORK_ERROR`, a non-OK response goes through `extractApiError`. Wrap the call in `try/catch` anyway and map an unexpected throw to `{ ok: false, code: "NETWORK_ERROR" }`; a bulk run that rejects mid-flight would strand the dialog with no per-row results.
- **No auto-retry.** `VERSION_CONFLICT`, `INVALID_STATE_TRANSITION`, `MAKER_CANNOT_APPROVE`, `APPROVAL_REQUIRED` and `ROLE_FORBIDDEN` are terminal for that row — retrying them is guaranteed to fail again and only burns the connection. Only the caller decides to retry, and it does so by calling `run()` again with the subset it wants (ticket 32 retries `NETWORK_ERROR` rows only). Retry policy is a UI decision, not the runner's.
- **`onProgress` fires after each row settles**, with `{ done, total }` where `done` counts settled rows including failures. Call it once per row, never before the first submit.
- **Results are returned in input order**, one outcome per input row, `outcome.id === row.id`. An empty `rows` array resolves to `[]` without calling the client.
- **The cache map is per-runner, not per-run.** Holding the runner in a `useRef` across dialog re-renders is what makes retry safe; the runner itself must not clear the map between runs.
- Per-row `expectedVersion` rides in `row.options` — approvals need a different `rowVersion` per entry, and `SubmissionCache` already treats a changed `expectedVersion` as a new intent (a stale-version attempt must not be replayed under the old key).

### Reuse — do not rebuild

- `createSubmission` / `CommandSubmission` / `SubmissionOptions` — `packages/contracts/src/client/submission.ts`
- `SubmissionCache` — `apps/web/src/commands/submission-cache.ts` (compose it; do not reimplement the fingerprint logic)
- `CommandClient` / `SubmitResult` / `SubmitErrorCode` — `apps/web/src/commands/client.ts`
- Test style: `apps/web/src/commands/intent.test.ts` and `submission-cache.test.ts` already fake a `CommandClient`; follow them rather than mocking `fetch`.

## Tasks

- [ ] Implement `createBulkRunner` in `apps/web/src/commands/bulk.ts` per the API above, with the `Map<rowId, SubmissionCache<P>>` and a doc comment stating the one-cache-per-row rule and why (the eviction/double-post chain).
- [ ] Do **not** export the runner through any barrel that would drag it into unrelated bundles; screens import it directly.
- [ ] Tests in `apps/web/src/commands/bulk.test.ts` against a fake `CommandClient` that records every submission it receives.

## Acceptance

- [ ] **Double-post regression test (non-negotiable):** run rows `[A, B]` where the fake client resolves A `ok` and B `NETWORK_ERROR`; re-run the same `[A, B]` (and separately just `[B]`) through the **same** runner; assert the recorded submissions for each row id are byte-identical across runs — same `envelope.commandId` **and** same `envelope.idempotencyKey` per row. This test is the point of the ticket; it must fail if the `Map` is replaced by a single shared cache.
- [ ] Test: results come back one-per-row in input order with matching ids; mixed ok/failed batch reports each row's own code.
- [ ] Test: submits are sequential — the fake client asserts no second call starts before the previous promise settles.
- [ ] Test: `onProgress` fires once per row with `done` incrementing 1..n and constant `total`, including for failing rows.
- [ ] Test: a client that *throws* (not rejects into `SubmitResult`) yields `{ ok: false, code: "NETWORK_ERROR" }` and the run still resolves for the remaining rows.
- [ ] Test: a row re-run with a **changed** payload or a changed `expectedVersion` mints a NEW envelope (the fingerprint rule is preserved, not defeated by the map).
- [ ] Test: empty `rows` resolves to `[]` with zero client calls.
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green.

## Out of scope

Any UI (the dialog is ticket 32, the shared `bulk-action-dialog.tsx` lands there), selection plumbing (28), server-side batching of any kind, offline outbox integration, retry policy.
