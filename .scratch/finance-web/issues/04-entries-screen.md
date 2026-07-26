# 04 — Entries screen: list, detail, reversal

Status: ready-for-agent
Blocked by: 01

**What to build:** Finance → Entries shows the branch's money records newest first: status chip (SUBMITTED amber / POSTED green / REJECTED red / REVERSED gray), direction indicator, category label per locale, formatted XAF amount, economic date, late-posting marker. Filters: status, period, asset. Tapping opens the detail: all entry fields, postings with asset codes, evidence refs (paymentReference/sourceReference), entry number, and the reversal chain — "reverses entry X" / "reversed by entry Y" links navigating between the pair.

**Reverse action:** on a POSTED entry, FINANCE_APPROVER/ADMIN see "Contre-passer" → reason dialog (required) → `reverse-entry.v1` with client-generated `reversalEntryId` and the entry's `rowVersion` as `expectedVersion`. Success navigates to the new mirror entry. `ENTRY_ALREADY_REVERSED` and version conflicts render by stable code.

## Constraints

- Data from ticket 01's reads via a `useEntries`/`useEntry` hook pair (pattern: `documents/useDocuments.ts`).
- Amount display: `Intl.NumberFormat` XAF, exponent 0. Negative (reversal) amounts render signed.
- Keyset pagination: "load more" appends via `nextCursor`; no page numbers.
- Append-only messaging: no edit affordance anywhere; the empty state and detail explain corrections are reversals.

## Files

- `apps/web/src/finance/useEntries.ts`, `useEntry.ts`; `screens/FinanceEntriesScreen.tsx`, `FinanceEntryDetailScreen.tsx`; routes under the finance tab; locale keys `finance.entries.*`.

## Acceptance

- [ ] List renders all four statuses correctly (fixture test)
- [ ] Reversal chain navigates both directions
- [ ] Reverse action hidden for non-approver roles; reason required
- [ ] Pagination appends without duplicates
- [ ] Web tests + typecheck green
