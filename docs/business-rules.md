# ROUTIQ — Business Rules (presentation notes)

One-page memory aid. Each rule: what it is, why, and what the user sees on screen.
Authoritative sources: `ARCHITECTURE.md`, `.scratch/financial-core/spec.md`, `.scratch/finance-web/spec.md`.

## 1. One write path — everything is a command

Every change — web form, offline sync, CSV import, future AI — goes through the same
pipeline: authenticate → authorize → module check → idempotency → validation →
invariants → approval rules → atomic commit (record + receipt + audit event, one
transaction). Nothing writes to the database any other way.

**Say it as:** "There is no back door. Every franc in the system has a who, when, and why attached."

## 2. Money is exact

Amounts are stored as whole XAF (exponent 0 — 1 XAF is the smallest unit, no
centimes, never divided by 100), as integers, never floats. Reversals are signed
negatives so sums always net exactly.

**On screen:** "50 000 XAF" — whole numbers only, grouped for reading.

## 3. Threshold approval — judgment where the money is

- Expense/revenue **at or under the threshold** → posts immediately (`Enregistré`).
- **Over the threshold** → saved as SUBMITTED and waits for a decision
  (`En attente d'approbation`) — this is a SUCCESS, the record is safe; it just
  isn't final.
- An approver (FINANCE_APPROVER or ADMIN) approves or rejects; rejection requires
  a written reason.

**Why:** field staff record small fuel/toll receipts all day; approving each one
would bury the approver. Human judgment is concentrated on large amounts.

**The number:** pilot placeholder is **100 000 XAF**, stored per tenant in
`approval_rules` — it is data, not code. Each business gets its own threshold
(can be 0 = "approve everything"). Changed via the `update-approval-threshold`
command — audited like everything else. Real per-tenant values are an open
onboarding decision (mtp-pilot 06).

## 4. Maker ≠ approver

The person who recorded an entry can never approve it, even an admin. The
approvals inbox shows your own submissions with "Votre saisie — un autre
approbateur doit décider" instead of buttons; the server enforces it regardless.

**Say it as:** "Four-eyes on every large movement of money."

## 5. Append-only — corrections are reversals, never edits

Once posted, an entry is never edited or deleted. A mistake is corrected by a
**reversal**: a mirror entry with the negated amount, linked both ways to the
original. The original stays visible, flagged REVERSED. An entry can be reversed
at most once. Reversal requires a reason and an approver role.

**Say it as:** "The history cannot be rewritten — mistakes are visible and so are their corrections. That's what makes the numbers trustworthy."

## 6. Monthly periods — locking makes history final

- Periods (calendar months) create themselves OPEN on first posting — no setup ceremony.
- **Locking** a period is the deliberate act (FINANCE_APPROVER/ADMIN): after the
  lock, that month's figures are final.
- Reopening is possible but requires a reason, and the reason is audited.
- An entry approved after its month locked **late-posts** into the current open
  month, flagged (`is_late_posting`) — recorded honestly rather than blocked or
  backdated.

## 7. Warn, don't block

Missing evidence (a receipt-expected category with no reference), late posting,
locking a month that still has pending submissions — these produce **warnings**,
never silent failures and never hard stops. Field reality is messy; the system
captures facts with flags instead of refusing them. The one strict boundary is
the period lock.

**On screen:** dismissible notices on the confirmation, e.g. "justificatif attendu".

## 8. Evidence expectations

Expense/revenue categories carry a policy: receipt expected or not. A mobile-money
transaction reference (MoMo/OM) counts as evidence. No receipt on a
receipt-expected category → the entry still posts, with an `EVIDENCE_MISSING`
warning attached.

## 9. Tenant isolation is structural

Every row carries the workspace id; foreign keys are composite on
(workspace, record), so a cross-tenant reference is impossible to even express;
row-level security backs it at the database. Two transport businesses on the same
server can never see each other's data — by construction, not by convention.

## 10. Roles (who can do what, finance)

| Role | Record | Approve/Reject | Reverse | Lock/Reopen period |
|---|---|---|---|---|
| FIELD_SUBMITTER | ✓ | — | — | — |
| OPS_MANAGER | ✓ | — | — | — |
| FINANCE_APPROVER | ✓ | ✓ (not own) | ✓ | ✓ |
| ADMIN | ✓ | ✓ (not own) | ✓ | ✓ |

Branch scope applies on top: a branch-scoped user only sees and touches their
branches' records.

## 11. Offline-ready by design (coming)

Commands are immutable envelopes with client-generated ids and idempotency keys:
a phone that lost signal replays its queue later and each command lands exactly
once. Facts (expenses, readings) can be captured offline; decisions (approvals,
locks) always require the server.

## 12. French first

fr-CM is the default language, English switchable. Errors are stable codes
translated in the UI — never raw English from the server.
