# Edit in the interface, correct in the books

> **Status (2026-10-08, #535).** Level 3 for money is not built (#86). The app
> ships a two-step correction instead: **Cancel entry** (`reverse-entry`) with
> the reason "wrong details", then **Record again**, which opens the record form
> filled in from the cancelled entry and records a new one. The original stays,
> marked Cancelled. The one-command correction below remains the target.

Users, business owners most of all, expect to change what they see on screen.
The ledger rule (`ARCHITECTURE.md` §3.4 invariant 4, §4.3) says approved money,
meter readings and stock are never changed in place. Both hold. **The interface
offers one action, "Modifier". The data layer decides whether saving is an
edit or a correction.** Users never choose between the two and never see the
word "reversal". (Decided with the owner 2026-09-30, #80.)

## Four levels

What "Modifier" does depends on what the record is and where it stands.

| Level | Applies to | What saving does | Trail |
|---|---|---|---|
| 1. Plain edit | Descriptive details: plate, make and model, chassis number, spec fields, a person's phone, a category label | Updates the row in place | Audit event with before and after, who and when. The vehicle's History tab is the only history screen. |
| 2. Free until decided | A pending record the actor authored: an expense awaiting approval, a work order not yet approved | The author updates it in place. Once someone approves or rejects it, it leaves this level. | Audit event |
| 3. Correction | Approved or posted money, meter readings, stock | Same form, pre-filled. Saving reverses the original and records the replacement in **one** command, in one transaction. | The original stays. Lists show one row with the current value and a "corrigé" badge. History shows the old value struck through. |
| 4. Locked | Money in a locked period | Same as level 3, but the form says the month is closed. The correction posts to the open period and is flagged `is_late_posting`. | As level 3 |

Rules that come with the levels:

- **Re-approval.** A level-3 correction goes back for approval when the amount
  changes, or when the new amount crosses the approval threshold. A change to
  the memo or the receipt photo alone does not.
- **No silent overwrite.** Every edit and every correction carries
  `expectedVersion`. A stale save gets a conflict, never a quiet overwrite.
- **Reversal rows stay out of normal lists.** Lists show the current value
  once. Finance can expand the history to see the original, its reversal and
  the replacement.
- **Level 2 is the author's only.** Nobody else edits a pending record in
  place. An approver who disagrees rejects it.

## Notes

Notes stay append-only: a correction is another note. The owner may later let
an author edit their own note as a level-1 edit with audit. Until the owner
decides that, nothing changes. (Decided for now 2026-09-30.)

## Why

- **The fraud owners fear most is an approved amount edited afterwards:** 40 000
  approved, 400 000 paid. If the approved amount can be edited, the approval
  means nothing. Level 3 keeps the approved figure on the record and sends a
  new amount back to an approver.
- **Cameroon follows OHADA accounting (SYSCOHADA).** It expects a validated
  entry to be corrected by a counter-entry, not altered. This still has to be
  confirmed with the pilot's accountant.
- **It is cheap.** Every command already writes an audit event with
  `beforeState`, `afterState` and `changedFields`, so levels 1 and 2 need no
  new history store. `reverse-entry` already reverses a posted entry and
  resolves late postings, and meter readings already carry `superseded_by_id`.
  Level 3 composes these in one command.

Rejected: a separate "Corriger" button next to "Modifier". It makes users learn
the ledger's rules to fix a typo, and a user who picks the wrong one either
fails or asks for help. Letting users edit approved amounts with only an audit
trail was also rejected: the audit event records the fraud but does not stop
it.

## Slices

- #84: level 1, edit vehicle details in place.
- #85: level 2, the author edits their own pending entry.
- #86: level 3, correct an approved entry from its edit form. Blocked by #60
  (reversal lines drop activity and person attribution) and #85.
