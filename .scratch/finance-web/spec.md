# Spec: Finance Web — reads and screens on the financial core

Status: ready-for-agent
Source: `.scratch/financial-core/spec.md` (explicit handoff: "Reads (`GET` views for entries, pending approvals, period status) are the UI session's territory"); ARCHITECTURE.md §4.2, §5.1, §5.2. Decisions locked with Linus 2026-07-26.

## Problem Statement

The financial core is live — `record-revenue.v1`, `record-expense.v1`, `approve-entry.v1`, `reject-entry.v1`, `reverse-entry.v1`, `lock-period.v1`, `reopen-period.v1` all work, with the submitted-state approval lifecycle, period resolution, and failure receipts. But no read view or screen exists: `apps/api/src/reads/` has nothing for finance and `apps/web/src/screens/` has no finance screen. The platform's actual product — trustworthy money records — is reachable only over curl. A field submitter cannot record an expense; a finance approver cannot see what is waiting for them; nobody can see whether a month is locked.

## Solution

The finance vertical slice on the web, following the documents-slice pattern exactly (contract in `packages/contracts/src/reads/`, route in `apps/api/src/reads/`, feature dir in `apps/web/src/finance/`, screen in `apps/web/src/screens/`):

- **Record screen** — one form for revenue and expense (direction toggle), category select filtered by kind, XAF amount, payment method, economic date, optional counterparty/description/reference. Submits `record-revenue.v1`/`record-expense.v1` via the existing command client. The outcome is surfaced honestly: POSTED ("recorded"), SUBMITTED ("waiting for approval") and warnings (`EVIDENCE_MISSING`, `LATE_POSTING`) rendered as non-blocking notices.
- **Entries screen** — the branch's money records: list with status chips (SUBMITTED/POSTED/REJECTED/REVERSED), direction, category label, amount, date; entry detail with postings, provenance (entry number, evidence refs), and the reversal chain (both directions). Reverse action for FINANCE_APPROVER/ADMIN with required reason.
- **Approvals inbox** — SUBMITTED entries awaiting decision, badge count in nav; approve (optional note) / reject (required reason) honoring `expectedVersion`. Maker ≠ approver is rendered, not just enforced: your own submissions show "yours — someone else must approve" instead of buttons.
- **Periods screen** — month list with OPEN/LOCKED status, lock/reopen actions (FINANCE_APPROVER/ADMIN, reopen requires reason), `PERIOD_HAS_SUBMITTED_ENTRIES` warning surfaced on lock.

All reads are plain CQRS-lite SQL views (no projections), branch-scope-filtered server-side like `reads/documents.ts`. fr-CM first; every new string in both locales; API errors remain stable codes.

## Implementation Decisions (locked 2026-07-26)

- **Navigation:** a `Finance` tab (fr `Finances`) in the shell nav, gated on the FINANCE module + role like the DOCUMENTS pattern (`apps/web/src/documents/permissions.ts`). Sub-nav inside the tab: Entries / Record / Approvals / Periods. Approvals and Periods only render for FINANCE_APPROVER + ADMIN.
- **Read routes** (all `GET`, `requireAuth`, `inWorkspace`, branch-scope filter in SQL):
  - `/v1/finance/entries?status=&periodCode=&assetId=&branchId=&cursor=` — newest-first, keyset-paginated on `(posted_at DESC NULLS LAST, id)`, page size 50.
  - `/v1/finance/entries/:entryId` — entry + postings (with asset codes + category labels) + `reversesEntryId`/`reversedByEntryId` both directions.
  - `/v1/finance/approvals` — SUBMITTED entries visible to the caller's branch scope, plus `submittedByPrincipalId` so the client can render the maker-guard state; includes `rowVersion` (the client must send it as `expectedVersion`).
  - `/v1/finance/periods` — periods for the workspace with status, lockedAt, and a count of entries posted in each.
- **Money serialization:** DB `bigint` → JSON `number` via `Number()` in read routes, mirroring the write payloads' `moneyMinor` (a JS number). XAF pilot amounts are far below 2^53; a shared `serializeMinor` helper in the read layer throws if `|amount| > Number.MAX_SAFE_INTEGER` so silent precision loss is structurally impossible. Display formatting: `Intl.NumberFormat` with `XAF` (exponent 0 — never divide by 100), locale-aware.
- **Amount input:** whole-number input (XAF has no decimals), thousands grouping as the user types, numeric keyboard on mobile (`inputMode="numeric"`). Client validates positive integer before submit; the server remains the authority.
- **Entry status after submit:** the command outcome's `recordStatus` (POSTED | SUBMITTED) drives the confirmation UI — no client-side re-derivation of approval rules.
- **Maker guard rendering:** the approvals read exposes the submitting principal; the client compares to the session principal and disables approve/reject with the explanatory string. Server still enforces `MAKER_CANNOT_APPROVE` — the UI treatment is a courtesy, not the control.
- **Reversal UX:** reverse is on the entry detail of a POSTED entry only; requires a reason; client generates `reversalEntryId` (offline-capable UUID convention). After success, detail shows the mirror link both ways.
- **Late posting:** entries with `is_late_posting` get a small indicator with the period it actually posted to; `LATE_POSTING` warning shown at record/approve time.
- **New locale keys** live under a `finance` namespace in `en.json`/`fr.json`; error codes already present (`POSTINGS_SUM_MISMATCH`, `MAKER_CANNOT_APPROVE`, `ENTRY_ALREADY_REVERSED`, `PERIOD_LOCKED`, `CATEGORY_KIND_MISMATCH`) get rendered where relevant; no sentence concatenation.
- **Single-posting form at MTP:** the record form creates one posting (optionally attached to an asset) — the payload's postings array with one line. Multi-line split UI is deferred; the contract already supports it.
- **Testing:** read routes get vitest coverage like `reads/documents.test.ts` (scope filtering, pagination, reversal chain); web models/permissions get unit tests like `documents/model.test.ts`; happy path exercised through the existing smoke conventions.

## Deferred (record in ticket Comments, do not build)

Multi-line posting UI; entry editing (append-only — corrections are reversals); CSV export; per-asset profitability rollups (reporting spec); attachment capture on the record form beyond `sourceArtifactIds` pass-through (evidence UX spec); offline queueing of record commands (offline-outbox spec — the form must not break when it lands, so keep command submission behind the existing client); notifications on approval-requested.

## Tickets

| # | Ticket | Owner | Blocked by |
|---|---|---|---|
| 01 | Entries + entry-detail reads (contracts, routes, tests) | worker, Fable review | — |
| 02 | Approvals + periods reads (contracts, routes, tests) | worker, Fable review | — |
| 03 | Record expense/revenue screen + outcome/warnings UX | worker, Fable review | — |
| 04 | Entries screen: list, detail, reversal action | worker, Fable review | 01 |
| 05 | Approvals inbox + maker-guard UX | worker, Fable review | 02 |
| 06 | Periods screen + lock/reopen | worker, Fable review | 02 |
| 07 | Finance nav gating, locale sweep, smoke | worker, Fable review | 03–06 |
