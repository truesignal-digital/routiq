# Finance approvals

Expenses above the approval threshold (100,000 XAF for submitters and managers) wait in the approvals queue. A finance approver or admin approves or rejects each one; nobody decides on an entry they recorded themselves.

## Sub-features

- `appr-queue` lists pending entries with a branch filter ("Agence", "Toutes mes agences").
- `appr-panel` opens the entry from its number in the record panel (fields, postings, receipt, "Historique" / "History"), with "Rejeter l'écriture" / "Reject entry" and "Approuver l'écriture" / "Approve entry" last in its footer. Reject closes the panel and opens the reason dialog.
- `appr-entry-page` shows the same Reject entry / Approve entry under the entry on `/finance/entries/<id>` while it is SUBMITTED, to an approver who did not record it.
- `appr-approve` approves in one tap (no dialog) from the row ⋯ menu, the record panel or the entry page; the entry becomes POSTED.
- `appr-reject` rejects with a required reason; the entry becomes REJECTED.
- `appr-own` hides the decision menu on your own submissions ("Votre saisie — un autre approbateur doit décider").
- `appr-badge` shows the pending count on the "Approbations" tab and the Home card.

## How to get to it (user POV)

- Sidebar "Finances" → tab "Approbations" / "Approvals" in "Sections financières" / "Finance sections" (ADMIN, FINANCE_APPROVER only).
- Home → "Approbations en attente" / "Pending approvals" card.
- Row "⋯" ("Actions") → "Approuver l'écriture" / "Approve entry" or "Rejeter l'écriture" / "Reject entry".
- The entry number (e.g. "DLA-2026-00005") → record panel → footer "Approuver l'écriture" / "Approve entry" or "Rejeter l'écriture" / "Reject entry".
- Entry page (panel "Ouvrir en plein écran" / "Open full screen", or `/finance/entries/<id>`) → "Approuver l'écriture" / "Approve entry" or "Rejeter l'écriture" / "Reject entry" under the summary.

## Driving it with pnpm verify

Preconditions:

- Fresh seed: two SUBMITTED entries (repair 450,000 by sali, brake parts 310,000 by herve). Approver: `finance` (nadege) or `admin` (emilienne).

- **Approve.** Run `pnpm verify drive flow:approve-entry --role finance --lang en`. It takes the first entry from `GET /v1/finance/approvals`, clicks "Finance" → the "Approvals" tab, opens that row's "Actions" menu (row filtered by entry number), chooses "Approve entry" (one tap, no dialog), and waits for "Entry approved". The cross-check reads the entry as `POSTED`.
- **Approve from the panel.** Run `pnpm verify drive flow:approve-from-panel --role finance --lang en`. It clicks the first pending entry's number, waits for the panel titled by that number, clicks the footer's "Approve entry", waits for "Entry approved", the panel to close and the row to leave. The cross-check reads the entry as `POSTED` and absent from `GET /v1/finance/approvals`.
- **Reject.** In a DriveScript, same path with menu item "Reject entry"; fill "Rejection reason" (`#reason`) and click the dialog's "Reject entry". Read back `REJECTED`. Not yet a committed flow.
- **Own submission.** Not reachable with the seed: entries recorded by ADMIN or FINANCE_APPROVER post at once, so an approver never has a pending entry of their own. Report it as `verified-unreachable` unless the approval rules change.
- **Queue read.** `pnpm verify api GET /v1/finance/approvals --role finance` lists `entries` and `total`.
- **Proof.** `01-approvals-queue.png`, `02-approved.png`.

## Gotchas

- Every row's menu trigger is named just "Actions"; filter the row by entry number first.
- On a phone the success toast covers the entry page's bottom buttons, and a pointer resting under it pauses its timer; close it (its last button) before the next click there.
- The toast region is also a `dialog`. Scope the panel as `getByRole("dialog").filter({ has: getByRole("heading", { name: entryNumber }) })`.
- Entries recorded by ADMIN or FINANCE_APPROVER post at once with no upper bound. To create a pending entry, record more than 100,000 XAF as `field` or `manager`.
- Approving changes the queue and the Home count; reseed before a run that expects two pending entries.
