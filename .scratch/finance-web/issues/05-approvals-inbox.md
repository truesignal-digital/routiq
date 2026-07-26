# 05 — Approvals inbox + maker-guard UX

Status: ready-for-human
Blocked by: 02

**What to build:** Finance → Approvals (FINANCE_APPROVER + ADMIN only) lists SUBMITTED entries oldest first: who submitted, when, category, amount, branch. Each row expands or navigates to a decision view: Approve (optional note) / Reject (reason required). Actions call `approve-entry.v1` / `reject-entry.v1` with the entry's `rowVersion` as `expectedVersion`.

**Maker guard rendered:** entries whose `submittedByPrincipalId` equals the session principal show "Votre saisie — un autre approbateur doit décider" instead of action buttons. The server still enforces `MAKER_CANNOT_APPROVE`; if it fires anyway (stale list), render the stable code like any command error.

**Badge:** the approvals `total` shows as a count badge on the Finance nav entry (wiring point exposed for ticket 07).

## Constraints

- After a decision, optimistically remove the row and refetch; version conflict (409) → refetch and re-render, no retry loop.
- Approving may return `LATE_POSTING` warning (entry's economic month since locked) — surface it on the confirmation.
- Reject requires a reason; it lands in `rejected_reason` and shows on the entry detail (ticket 04 renders it).

## Files

- `apps/web/src/finance/useApprovals.ts`, `permissions.ts` additions (canApprove: FINANCE_APPROVER + ADMIN + FINANCE module); `screens/FinanceApprovalsScreen.tsx`; locale keys `finance.approvals.*`.

## Acceptance

- [x] Own submissions render guard state, not buttons (model test on principal comparison)
- [x] Approve and reject payload mapping tests incl. expectedVersion
- [x] Role gating test: OPS_MANAGER/FIELD_SUBMITTER cannot reach the screen
- [x] Web tests + typecheck green

## Comments

2026-07-26 [codex] clean first-round pass. Tests import production code (isOwnSubmission, validateRejectionReason, canApproveEntries — the ticket-04 lesson held). expectedVersion on approve and reject, VERSION_CONFLICT refetch on both paths, maker guard rendered, LATE_POSTING notice, 23 fr/en keys at parity. 105 web tests + typecheck green, Fable-verified.
