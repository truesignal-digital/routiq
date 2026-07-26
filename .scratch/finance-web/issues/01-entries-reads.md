# 01 — Entries + entry-detail reads

Status: ready-for-agent
Blocked by: —

**What to build:** The read contract handed over by `.scratch/financial-core/spec.md`: list and detail views for financial entries, shaped for the screens in tickets 03–04. Follow the documents-slice pattern (`packages/contracts/src/reads/documents.ts`, `apps/api/src/reads/documents.ts`) exactly.

## Contracts (`packages/contracts/src/reads/finance.ts`, export from `index.ts`)

- `financialEntryListItem`: id, entryNumber, direction, status, category `{code, labelFr, labelEn}`, amountMinor (number), currency, economicDate, postingPeriodCode (nullable), isLatePosting, branchId, counterpartyName, paymentMethod, estimateStatus, postedAt (nullable), rowVersion.
- `financialEntryListResponse`: `{ entries: [...], nextCursor: string | null }`.
- `financialEntryDetail`: list item fields + description, paymentReference, sourceReference, rejectedReason, reversesEntryId, reversedByEntryId (server-resolved back-link), postings: array of `{ lineNo, amountMinor, assetId, assetCode (nullable), assetAttribution, category {code, labelFr, labelEn} }`.

## Routes (`apps/api/src/reads/finance.ts`, register in `server.ts` beside documents)

- `GET /v1/finance/entries?status=&periodCode=&assetId=&branchId=&cursor=` — workspace + branch-scope filtered in SQL (`auth.branchScope !== "ALL"` → `inArray(branchId, scope)`); newest first, keyset pagination on `(posted_at DESC NULLS LAST, id)`, page 50; filters validated with zod, unknown status → 400 `VALIDATION_FAILED`.
- `GET /v1/finance/entries/:entryId` — 404 pattern from documents (out-of-scope indistinguishable from missing); postings joined to assets (code) and categories (labels); reversal chain resolved both directions in one query pass.

## Constraints

- `inWorkspace` for all queries; never bypass RLS context.
- bigint → number via a shared `serializeMinor` helper that throws above `Number.MAX_SAFE_INTEGER` (spec: money serialization decision). Put it in `apps/api/src/reads/` for reuse by ticket 02.
- No projections, no denormalized tables — plain SQL over `financial_entries`/`financial_postings` (CQRS-lite).

## Acceptance

- [x] Contracts exported, zod-parse round-trip test per reads/documents convention
- [x] Scope test: branch-scoped member sees only their branches' entries; ALL sees all
- [x] Pagination test: >50 entries pages correctly, stable order, no duplicates across pages
- [x] Detail test: reversal pair resolves both `reversesEntryId` and `reversedByEntryId`
- [x] `serializeMinor` overflow test
- [x] `pnpm --filter @routiq/api exec vitest run src/reads/finance.test.ts` green; typecheck green

## Comments

2026-07-26 [codex] implemented, Fable reviewed: contracts/routes/serializeMinor/tests match the ticket; independently verified 17/17 tests + typecheck green. Pagination cursor checked against DESC NULLS LAST ordering (correct incl. null tail); postedAt is always JS Date (ms) so the ISO cursor round-trips without microsecond loss; 404 matches the documents pattern.

2026-07-26 REGRESSION: the ticket-02 worker rewrote this ticket's verified route instead of extending it (NULLS FIRST ordering, broken null cursor, dropped branchId+periodCode filters, tests 17->13; 4 failing). Rework dispatched with an exact fix list. Re-verify before returning to ready-for-human. Process fix: verified tickets get committed immediately from now on.
