# 30 — `total` on the finance entries list read

Status: ready-for-agent
Phase: 6
Blocked by: —

**What to build:** `/v1/finance/entries` returns a keyset page and nothing else, so the entries screen cannot say « Page 1 sur 12 » or « 583 résultats » — it does not know how many entries match. Add a `total` to the response, exactly the way `/v1/finance/approvals` already does it. API + contracts only; the UI wiring is ticket 33.

## Design

### Contracts

`packages/contracts/src/reads/finance.ts`, right below the existing declaration:

```ts
export const financialEntryListResponse = listResponse(financialEntryListItem, {
  key: "entries",
}).extend({ total: z.number() });
```

`pendingApprovalsResponse` (same file, ~line 68) is the precedent — same `.extend({ total: z.number() })` on a `listResponse`, with a doc comment explaining why the count travels with every page. Mirror both the code and the comment style. `total` is **required**, not optional: the only client is ours, and an optional field would let a future handler silently drop it.

### API — the count query, and where it must sit

`apps/api/src/reads/finance.ts`, the `/v1/finance/entries` handler (~line 154).

The approvals handler shows the shape (~lines 540-544):

```ts
// Counts the queue, not the page: the cursor never reaches this.
const [countResult] = await tx
  .select({ count: sql<number>`count(*)::integer` })
  .from(financialEntries)
  .where(and(...conditions));
const total = countResult?.count ?? 0;
```

**Two traps specific to the entries handler — approvals does not have either:**

1. **The cursor condition is pushed into the same array.** Approvals builds a separate `pageConditions` array, leaving `conditions` cursor-free. Entries instead does `conditions.push(afterKeyset(...))` inside `if (decodedCursor)` (~lines 222-231). The count **must** run before that push, or `total` shrinks on every page and « Page N sur M » lies. Either run the count immediately before the `if (decodedCursor)` block, or restructure entries to mirror approvals' `pageConditions` split — the second is cleaner and makes the invariant hard to break later. Either way, leave a comment saying the count precedes the cursor.

2. **The count needs the same joins as the page query.** Entries filters can reference joined tables: `periodCode` filters on `postingPeriods.periodCode`, which is only in scope because of the `leftJoin(postingPeriods, ...)` (~lines 264-270). A bare `select count(*) from financial_entries` will throw when `periodCode` is set. Carry `.innerJoin(categories, ...)` and `.leftJoin(postingPeriods, ...)` onto the count query too. `categories` is an inner join on a NOT NULL FK, so it does not change the count; include it anyway so the two queries cannot drift.

Everything else is already right and must stay right: the same workspace condition, the same `auth.branchScope` narrowing, the same `branchId`/`status`/`assetId` filters. The `assetId` filter is an `EXISTS` subquery precisely so duplicate postings cannot inflate row counts — it counts correctly as-is.

Return `financialEntryListResponse.parse({ entries, nextCursor, total })`.

### One-line ADR amendment

`docs/adr/0003-read-side-list-contract.md` already carries this line:

> Amended 2026-07-27: the `entries` legacy exception covers two endpoints, not one — `/v1/finance/entries` and `/v1/finance/approvals`, which also publishes a `total` alongside the envelope.

Amend it so `total` is attributed to both endpoints rather than to approvals alone, and state the rule it establishes: **a `total` is a display fact, never a jump target — keyset lists still refuse offset navigation.** Keep it to a sentence or two in the existing amendment voice; do not restructure the ADR.

## Tasks

- [ ] `financialEntryListResponse` extended with `total`; update `packages/contracts/src/reads/finance.test.ts` (or add it if the file does not cover this schema) so a response missing `total` fails to parse.
- [ ] Count query in the entries handler, placed **before** the cursor condition, with the page query's joins; `total` in the parsed response.
- [ ] ADR-0003 amendment.
- [ ] Tests in the API entries read suite (`apps/api/src/reads/` — follow the file the approvals read is tested in).

## Acceptance

- [ ] Test: **`total` is constant across every page of a full keyset walk** — seed more entries than one page, walk to the last page, assert every response reports the same `total`. This is the regression the cursor-condition trap produces.
- [ ] Test: `total` respects each filter — `status`, `periodCode` (proves the join is present), `assetId`, `branchId` — matching the number of rows a full walk returns under that filter.
- [ ] Test: `total` respects branch scope — a branch-scoped principal's `total` counts only their branches, never the workspace.
- [ ] Test: tenant isolation holds — a second workspace's entries never appear in the count.
- [ ] Test: empty result reports `total: 0` with `entries: []` and `nextCursor: null`.
- [ ] `pnpm --filter @routiq/api test && pnpm --filter @routiq/contracts test && pnpm typecheck` green. The web app still compiles (the extra field is additive; nothing reads it until ticket 33).

## Out of scope

Any web change — the entries screen wires the total in ticket 33. Assets `total` is ticket 34. Offset pagination, page-jump navigation, cached or approximate counts.
