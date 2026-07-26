# 03 — Record expense/revenue screen

Status: ready-for-human
Blocked by: —

**What to build:** A field submitter opens Finance → Record on a phone and captures an expense in under a minute: direction toggle (Dépense/Recette), category (filtered to EXPENSE_CATEGORY or REVENUE_CATEGORY per direction via existing `/v1/categories`), amount in XAF, payment method (CASH/MOMO/OM/BANK/OTHER), economic date (default today), optional asset attach, counterparty, description, payment reference. Submit fires `record-expense.v1`/`record-revenue.v1` through the existing command client (`apps/web/src/commands/client.ts`) with a single-line postings array.

## UX decisions (from spec)

- Amount: whole-number XAF, `inputMode="numeric"`, thousands grouping while typing, positive integer validation client-side. Never divide by 100.
- Outcome screen states from `recordStatus`: POSTED → "Enregistré" confirmation; SUBMITTED → "En attente d'approbation" with explanation that the record is saved and waiting. Both are success states — never render SUBMITTED as an error.
- Warnings (`EVIDENCE_MISSING`, `LATE_POSTING`) render as dismissible notices on the confirmation, with the category's evidence expectation explained for EVIDENCE_MISSING.
- Command errors render by stable code (`CATEGORY_KIND_MISMATCH`, `POSTINGS_SUM_MISMATCH`, `PERIOD_LOCKED`, …) from the locale files — codes already exist in `errors`, wire them.
- Asset attach optional; when set, the posting carries `assetId` (attribution DIRECT). Asset picker reuses the asset list read scoped to the user's branches.
- Form is client-side only until submit — the server never stores drafts (DRAFT is a client concept per financial-core spec).

## Files

- `apps/web/src/finance/` — `model.ts` (form state → payload mapping, amount parsing), `permissions.ts` (canRecord: the four writing roles + FINANCE module, pattern from `documents/permissions.ts`), hooks as needed.
- `apps/web/src/screens/FinanceRecordScreen.tsx`; route in `router.tsx` under the finance tab (ticket 07 wires nav — this ticket may add the route directly).
- Locale keys under `finance.record.*` in both `en.json` and `fr.json` — fr-CM first, no sentence concatenation.

## Acceptance

- [x] Model tests: payload mapping (single posting sums to entry amount), amount parse/format round-trip, direction→category-kind filter
- [x] Permission tests per documents pattern
- [x] POSTED and SUBMITTED outcomes render distinct success states (component or model test)
- [x] Warning rendering covered
- [x] `pnpm --filter @routiq/web test` + typecheck green

## Comments

2026-07-26 [codex] implemented, Fable reviewed and independently verified: 89 web tests (+14 new) and typecheck green. recordStatus drives distinct POSTED/SUBMITTED success states; warnings render per stable code; category kind follows direction; 36 finance locale keys with exact fr/en parity; no hardcoded strings. Minor accepted nit: parseMoneyXaf admits 0, server rejects with stable code. Nav tab deliberately deferred to ticket 07.
