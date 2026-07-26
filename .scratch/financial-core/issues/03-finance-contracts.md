# 03 — Finance contracts: payloads, errors, module code

**What to build:** Zod payload schemas in `packages/contracts/src/commands/` for the six finance commands, new error codes, warning codes, and the `FINANCE` module code. Schemas follow existing spellings (Zod 4: `z.uuid()`, `z.iso.date()`; `moneyMinor` from envelope.ts).

**Blocked by:** 02.

**Status:** ready-for-human

- [x] `record-financial-entry.ts`: shared shape for record-revenue.v1 / record-expense.v1 — entryId (uuid), branchCode, categoryCode, economicDate (z.iso.date), amountMinor (positive int), paymentMethod CASH|MOMO|OM|BANK|OTHER, paymentReference?, sourceReference?, counterpartyName?, description?, estimateStatus default ACTUAL, postings: min-1 array of {lineNo, assetId?, amountMinor positive int, assetAttribution default DIRECT}
- [x] `approve-entry.ts` (entryId, note?) and reject variant (entryId, reason min 1) — reject requires reason
- [x] `reverse-entry.ts`: reversalEntryId (client uuid), originalEntryId, reason min 1
- [x] `lock-period.ts` / reopen variant: periodCode `/^\d{4}-(0[1-9]|1[0-2])$/`; reopen requires reason
- [x] Error codes added: POSTINGS_SUM_MISMATCH, MAKER_CANNOT_APPROVE, ENTRY_ALREADY_REVERSED, PERIOD_LOCKED, CATEGORY_KIND_MISMATCH
- [x] Warning codes exported as const: EVIDENCE_MISSING, LATE_POSTING, PERIOD_HAS_SUBMITTED_ENTRIES
- [x] `FINANCE` added to MODULE_CODES
- [x] Schema tests per contracts convention (register-asset.test.ts style): valid payload parses, postings empty array rejected, negative amounts rejected, bad periodCode rejected

## Comments

- Implemented 2026-07-24. Errors/warnings/FINANCE module landed earlier with 01/02; [codex] worker built the payload files (record-financial-entry.ts shared shape + approve/reject, reverse, lock/reopen) and tests; Fable reviewed. Contracts suite 53/53, typecheck green.
- Deviation from ticket text: posting payload carries no `lineNo` — the server assigns line_no from array index (decision inherited from the shipped record-expense contract; ordering is stable because the envelope payload is immutable).
