# 05 — record-journey-sheet.v1 (composite)

Status: ready-for-agent
Blocked by: 04

## Task

The make-or-break composite (§5.1): one payload emits activity + segments + crew + legs + readings + revenue/expense entries in ONE transaction. Passenger-journey flavour.

## Requirements

- Contract composes the granular payload schemas from issues 02–04 plus financial sub-payloads reusing `record-revenue`/`record-expense` payload shapes from existing contracts — do not duplicate field definitions; import and compose.
- Handler orchestrates INSIDE one transaction: create activity → segments/crew → legs → readings (if meter-reading tables exist; if they don't, STOP and split a schema issue — see spec open questions) → financial entries with postings attributed to the activity (`activity_id` on postings, §4.2). One command receipt, one audit event per emitted record set per existing dispatcher semantics — follow whatever `record-financial-entry` does for entry+postings atomicity.
- Financial amounts: `moneyMinor`, XAF exponent 0, signed postings summing to entry.
- Approval: auto (§5.1) — but embedded financial entries above threshold follow the entry approval rules; read §5.2 and match `record-expense` behaviour.
- Whole payload idempotent under one `idempotencyKey` — retry replays nothing twice.
- Tests: full happy path (activity + 2 legs + revenue + fuel expense), retry idempotency, partial-data path still succeeds with completeness exceptions, above-threshold expense lands PENDING_APPROVAL.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] New vitest files pass
- [ ] Single transaction — kill mid-way in a test (force constraint violation on last insert) leaves zero rows
