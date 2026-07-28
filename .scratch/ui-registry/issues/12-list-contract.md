# 12 — Shared list-query / list-response contract + ADR

Status: ready-for-human
Phase: 3
Blocked by: —

**What to build:** One read-side list convention in `packages/contracts` — shared Zod helpers for list queries (filters, sort, cursor, limit) and a `{ items, nextCursor }` response envelope — plus an ADR recording it, plus alignment of the existing finance read onto the helpers without breaking its clients.

## Context

The read side is CQRS-lite: plain REST/SQL views, no projections (CLAUDE.md, ARCHITECTURE.md §1/§5). Finance already does list reads properly and is the de facto template: `apps/api/src/reads/finance.ts:33-39` defines a local `listQuerySchema` (`status`, `periodCode`, `assetId`, `branchId`, `cursor`), `:41-60` defines local base64url cursor encode/decode over `{ postedAt, id }`, and `:79-105` applies workspace + branch scope, filters and keyset pagination. `packages/contracts/src/reads/finance.ts:28-31` shapes the response as `{ entries, nextCursor }`.

`/v1/assets` does none of it — `apps/api/src/reads/assets.ts:22` accepts no query params and returns the full unpaginated list (audit §5). Ticket 13 migrates it onto what this ticket defines, which is the point: the contract has to be proven on a second resource.

Zod 4 spellings only (`z.uuid()`, `z.iso.date()` — not the Zod 3 forms). ESM with `.js` import extensions inside packages.

## Tasks

- [ ] `packages/contracts/src/reads/list.ts`:
  - `listQuery(filters)` — takes a resource's filter object and extends it with `sort` (optional, `"field:asc"`-style string), `cursor` (optional opaque string), `limit` (optional, coerced int, bounded — default 50, max 100, matching the finance page size).
  - `listResponse(item, { key = "items" })` — `{ [key]: item[], nextCursor: string | null }`. The `key` escape hatch exists solely so finance can keep its published `entries` key; new resources use `items`.
  - Exported types alongside the schemas, and re-exported from `packages/contracts/src/index.ts`.
  - A schema test in the reads convention (parse round-trip, limit bounds rejected, unknown sort field rejected).
- [ ] `apps/api/src/reads/cursor.ts` — lift the base64url encode/decode from `apps/api/src/reads/finance.ts:41-60` into a shared helper parameterised by its payload schema, so ticket 13 reuses it rather than copying. Keep the existing finance cursor payload (`{ postedAt, id }`) and its DESC-NULLS-LAST semantics exactly; this is a move, not a redesign.
- [ ] Align `apps/api/src/reads/finance.ts` onto the helpers: its query parsing goes through `listQuery`, its cursor through the shared helper, its response schema through `listResponse(item, { key: "entries" })`. **Wire-compatible:** the same query params are accepted and the response still has an `entries` key, so `src/finance/useEntries.ts` and every finance screen keep working untouched.
- [ ] `docs/adr/0003-read-side-list-contract.md` in the house style of `docs/adr/0002-*.md` (prose, a few short paragraphs, ends with a dated decision line). Record: reads are plain SQL views over the write model, never projections; lists are keyset-paginated on a stable sort key, never offset; the envelope is `{ items, nextCursor }` with `entries` as a documented legacy exception on `/v1/finance/entries` to be retired when the web client is ready; filters are validated by Zod and a failure is `400 VALIDATION_FAILED`; limits are bounded server-side; branch scope and `inWorkspace` remain non-negotiable and are never client-supplied.

## Acceptance

- [ ] Existing finance read tests pass **unchanged** (`apps/api/src/reads/finance.test.ts`) — proof the alignment is wire-compatible
- [ ] New contracts test covers the helpers, including bound rejection
- [ ] ADR filed and cross-referenced from the finance read module
- [ ] `pnpm --filter @routiq/api test && pnpm --filter @routiq/contracts test && pnpm typecheck` green
- [ ] `pnpm --filter @routiq/web test` green; jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

Migrating `/v1/assets` (ticket 13), touching documents or categories reads, renaming the `entries` key on the wire, adding sorting to any endpoint that does not already have it, and anything on the command/write path — this is read-side only.

## Comments

- 2026-07-26 Opus worker: implemented; committed as 86f3e34. listQuery takes a raw filter shape (not ZodObject — generic .extend() collapsed field types); finance read tests passed unchanged (26/26); ADR-0003 filed. Ticket 13 must reuse apps/api/src/reads/cursor.ts.
- Finding: the assetId filter on /v1/finance/entries was parsed but never applied (dead since introduction — the audit's "server honors assetId" was wrong). Fixed in bc07001: correlated EXISTS over financial_postings (workspace_id + entry id), 4 new tests incl. cross-workspace isolation and cursor composition; mutation-tested.
