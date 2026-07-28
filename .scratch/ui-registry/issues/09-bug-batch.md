# 09 — Bug batch: denied flash, DataTable English, raw enums, filter debounce

Status: ready-for-human
Phase: 1
Blocked by: —

**What to build:** Four independent defects the audit turned up. No new components, no refactors — fix each, cover each with a test.

## Context

**1. Permission-denied flash (audit §4.8).** `FinanceRecordScreen.tsx:62` and `FinanceEntriesScreen.tsx:88` correctly wait for `/v1/me` (`me !== undefined && !canX`) before deciding. `FinancePeriodsScreen.tsx:121` and `FinanceApprovalsScreen.tsx:214` use a bare `!canX`, so every load flashes "access denied" until `/v1/me` resolves.

**2. Hardcoded English in the table (audit §2, §7).** `data-table.tsx:162` renders `{loadMore.isFetching ? "Loading…" : "Load more"}` in an app whose default language is fr-CM.

**3. Raw enum and raw UUIDs on entry detail (audit §7).** `FinanceEntryDetailScreen.tsx:186` prints the raw `paymentMethod` enum (`MOMO`) while the record form translates the same values via `finance.record.paymentMethods.*` (`FinanceRecordScreen.tsx:427`). `FinanceEntryDetailScreen.tsx:259` and `:273` use raw UUIDs as the visible text of reversal links.

**4. Filter bar has no debounce (audit §5).** `FinanceEntriesScreen.tsx:140` and `:154` feed `useEntries` params on every keystroke, so each character issues a request — bad on the intermittent connectivity this app targets.

## Tasks

- [ ] Guard both screens on `me !== undefined` before rendering denied state, matching `FinanceEntriesScreen.tsx:88`. While `me` is undefined render the existing loading state, not the denied state.
- [ ] Move the two `data-table.tsx:162` strings into `dataTable.loadMore` / `dataTable.loading` in `fr.json` and `en.json` (fr-CM first) and read them with `useTranslation()` inside the component. Parity is enforced by `src/i18n/locales.test.ts`.
- [ ] Translate `paymentMethod` on the detail screen through the existing `finance.record.paymentMethods.*` keys — extract the lookup so both screens use one helper rather than two copies.
- [ ] Give the reversal links human text: the linked entry's `entryNumber` (already on the read contract, `packages/contracts/src/reads/finance.ts`) with a localized label; never a bare UUID.
- [ ] Debounce the two free-text filter inputs (~300 ms) before they reach `useEntries`; select-driven filters stay immediate. Put the debounce in a small reusable hook under `src/lib/` — ticket 10's table toolbar reuses it.
- [ ] Tests: extend `FinancePeriodsScreen.test.ts` and `FinanceApprovalsScreen.test.ts` with a "no denied state while `me` is loading" case; extend `data-table.test.tsx` with the localized load-more label; extend `FinanceEntryDetailScreen.test.ts` for the translated payment method and non-UUID link text; add a fake-timer test proving N keystrokes produce one request.

## Acceptance

- [ ] All four defects covered by a test that fails against the current code
- [ ] `grep -rn "Load more\|Loading…" apps/web/src` returns nothing
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

Unifying the four permission-denied *shapes* and their copy (ticket 14 — this ticket only fixes the timing bug), rebuilding the entries filter bar (ticket 11), and any other DataTable feature work (ticket 10).

## Comments

- 2026-07-26: committed as 35bead6. [codex] worker did the four fixes + denied-flash tests; two vacuous debounce tests it wrote were replaced by an Opus worker with one mutation-verified fake-timer test (7 spurious query keys without debounce → 1 with). ReversalLink fetches entryNumber via cached useEntry (contract only carries UUIDs); text-primary not blue-600. Note: entry-detail translated-enum coverage was NOT added (no detail test file exists) — fold into ticket 14's test sweep. Follow-up in ticket 11: AssetsStub's local useDebouncedValue should switch to lib/useDebounce.
