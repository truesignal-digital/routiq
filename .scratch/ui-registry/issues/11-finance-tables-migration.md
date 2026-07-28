# 11 — Migrate the finance screens onto DataTable v2

Status: ready-for-human
Phase: 2
Blocked by: 10

**What to build:** Move all three finance list surfaces onto DataTable v2 — entries and approvals from DataTable v1, periods from raw `Table` primitives — turning the hand-built entries filter bar into the table's declarative filter config and replacing the free-text asset-UUID box with a real asset select.

## Context

Audit §2/§3: `FinanceEntriesScreen.tsx:171` and `FinanceApprovalsScreen.tsx:247` are DataTable v1's only consumers, each building `ColumnDef[]` inline in a `useMemo` keyed on `[i18n.resolvedLanguage, t]`. `FinancePeriodsScreen.tsx:160` renders raw `Table` primitives instead.

`FinanceEntriesScreen.tsx:116-155` is a hand-built filter bar: a raw `<select>` for status (`:116`), a period input, a **free-text UUID box for the asset filter** (`:152`) — a field no operator can use — and no debounce (ticket 09 added it; this ticket moves it into the toolbar config). The params flow through `useEntries` (`src/finance/useEntries.ts:32-54`) to the server, which honors `status`, `periodCode`, `assetId`, `branchId`, `cursor` with keyset pagination (`apps/api/src/reads/finance.ts:79-105`). Filtering therefore stays server-side — the table toolbar is a controlled surface, not a client filter.

Asset reference data for the select comes from the existing assets read (`src/assets/useAssets.ts`, `src/assets/reference.ts`). Ticket 13 reshapes `useAssets`; whichever lands second updates the other's call site.

## Tasks

- [ ] `FinanceEntriesScreen`: delete the hand-built filter bar (`:116-155`) and express it as DataTable v2's `filters` config — status as a `select` (options from the four entry statuses, localized), period as `search` or `select`, asset as a `select` fed by asset reference data showing asset code plus display name, value being the asset id. Wire `filterValues`/`onFilterChange` to the `useEntries` params.
- [ ] `FinanceApprovalsScreen`: move onto DataTable v2 with its declarative filter config; keep the approve/reject row actions and the maker-guard note working.
- [ ] `FinancePeriodsScreen`: replace the raw `Table` block (`:160`) with DataTable v2. Periods are a short unpaginated list — no filters needed unless one already exists; keep lock (`AlertDialog`) and reopen (`Dialog`) row actions and their toasts.
- [ ] Give each column a `meta.label` (for the visibility menu) and keep `meta.mobile` assignments so the card layout still reads well.
- [ ] Enable sorting only where the server can honour it or the data set is fully loaded; do not present a sort control that silently sorts one loaded page of a keyset-paginated list. State explicitly in the code which columns are sortable and why.
- [ ] Keep the cursor load-more behavior on entries and approvals; no offset pagination.
- [ ] Extend `FinanceEntriesScreen.test.ts`, `FinanceApprovalsScreen.test.ts`, `FinancePeriodsScreen.test.ts`: choosing an asset from the select sends `assetId` to the read; changing status refetches with the new param; the load-more cursor still pages; periods actions still fire their commands.

## Acceptance

- [ ] No free-text UUID input remains anywhere in finance
- [ ] Filter changes produce server requests with the right query params (asserted against a fake `fetchImpl`, as the existing finance tests do)
- [ ] No raw `Table` primitives left in `FinancePeriodsScreen`
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

Changing the finance read API — the query params and `{ entries, nextCursor }` envelope stay as they are (naming alignment is ticket 12). Replacing the hand-rolled removed-id `Set`s (`FinanceApprovalsScreen.tsx:52`, `FinancePeriodsScreen.tsx:70`) and invalidation granularity — ticket 14. Success-feedback and permission-denied unification — ticket 14.

## Comments

- 2026-07-26 Opus worker: committed as 9742cba. Honest-sort policy per screen (comments in code); approvals gets no filters (unpaginated prefix + total would lie); asset filter select drains cursor so options never silently truncate; entries table renders through pending so toolbar survives refetch. Open gap moved to ticket 14: FinanceRecordScreen free-text asset UUID field.
