# 24 — Server-side sorting for list reads (entries, approvals)

Status: ready-for-human
Phase: 5
Blocked by: —

**What to build:** (Linus 2026-07-27, data-table foundations) Sortable list reads. The `listQuery` contract already supports declared `sortFields` — no resource declares any. Add server-side sorting with keyset cursors keyed on the active sort, for `/v1/finance/entries` and `/v1/finance/approvals`.

## Context

ADR-0003: keyset only, never offset. `packages/contracts/src/reads/list.ts` has `sort` ("field:asc|desc") + per-resource `sortFields`. `apps/api/src/reads/cursor.ts` has timestamp + text keyset codecs. Entries read (`reads/finance.ts`) sorts `postedAt DESC` fixed; approvals read takes NO query params (fixed limit 100 + total). The web pager (ticket 25) walks cursors forward and pages back through cache — the API stays unidirectional.

## Tasks

- [ ] Entries: declare sortFields `economicDate`, `postedAt`, `amount`, `entryNumber`. Cursor payload must carry the active sort key's value + id (extend cursor.ts with a generic keyset codec parameterized by field/direction, or per-field codecs — keep tampered-cursor → 400). A cursor is only valid for the sort that produced it: encode the sort into the cursor payload and reject mismatches with VALIDATION_FAILED. Default stays postedAt:desc (wire-compatible when no sort param).
- [ ] Approvals: migrate the read onto `listQuery` (limit bounded, cursor, sortFields `submittedAt`, `amount`, `entryNumber`; default submittedAt:asc — oldest first is the queue's honest order). Keep the `total` field (the dashboard + badge rely on the shared predicate) and the response key. Existing consumers must keep working when no params are sent.
- [ ] Amount sorting sorts by the entry's signed total amount — define it in SQL deterministically (amount, then id tiebreak).
- [ ] Tests per resource: each sort field walks pages with no gaps/dups (3-page walk at limit=2 asc AND desc); cursor from sort A rejected under sort B; default order unchanged (existing tests pass unmodified for entries); approvals total unaffected by pagination params.

## Acceptance

- [ ] `pnpm --filter @routiq/api test && pnpm --filter @routiq/contracts test && pnpm typecheck` green; existing finance read tests pass unchanged.

## Out of scope

Web consumption (25/26), assets read sorting (assetCode order is fine for now), documents/periods reads.

## Comments

- 2026-07-27 Opus worker: committed (ui-registry 24). Generic KeysetColumn spec w/ typed binds (timestamptz/date/bigint/text — amounts round-trip as strings); nulls-last both directions; amount sorts entry-level signed total (§3.4). Deviations accepted: cursor-internals test updated (opaque per ADR); approvals defaultLimit 100 for wire-compat; ADR amended for the two-endpoint legacy key + sort-in-cursor; old in-flight cursors 400 across deploy (ephemeral); dead timestamp helpers deleted. 251 api tests.
