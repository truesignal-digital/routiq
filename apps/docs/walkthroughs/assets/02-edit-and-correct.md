# 02 — Edit and correct

**Goal** — Learn what a truck record lets you change, and how ROUTIQ corrects a mistake when it won't let you edit: by superseding and by leaving a visible trail.

**Log in as** — **Admin**. (The Entry operator can add and renew documents too, and you will check that.)

## Where you are

```mermaid
flowchart LR
  A[Register truck] --> B[Create trip]
  B --> C[Record costs]
  C --> D[Approval]
  D --> E[Close trip]
  E --> F[Review history]
  classDef current fill:#f59e0b,stroke:#b45309,color:#111827,stroke-width:2px
  class A,F current
```

## Steps

### The record itself does not have an Edit button

1. Open **Trucks** and click the truck you registered in lesson 01.
2. Look at the header actions.

> ✅ Expected: you see **Commission**, **Assign** and **History** — and nothing else. There is no **Edit**, no **Delete**, and no pencil icon anywhere on the record. This is deliberate: a truck's identity fields are written once by the registration command, and the audit trail is what makes the numbers hanging off that truck trustworthy.

### Corrections that are supported: documents supersede

3. On the truck record, click the **Documents** link near the bottom of the page.

> ✅ Expected: the page header reads **Truck documents**. With nothing recorded yet you get **No documents for this truck.** and an **Add a document** button.

4. Click **Add a document**. Choose a **Document type**, and fill **Title**, **Number**, **Issued** and **Expires**. Put an expiry a few months out. Click **Save**.

> ✅ Expected: a toast **Document saved**, and the document appears in the list with a green-ish validity chip reading **Valid → `date`**.

5. Now pretend the number was typed wrong. Click **Renew** on that document.

> ✅ Expected: a form opens titled **Renew `document name`**, pre-filled from the document you are replacing.

6. Change the **Number**, set a new **Expires** date, and click **Save**.

> ✅ Expected: a toast **Document renewed**. The list now shows the new document as the live one. The old one drops into a separate group carrying a **Superseded** badge and a **Replaced by** line pointing at its replacement. **The wrong value is still on screen** — it was not deleted, it was superseded.

### The trail: History

7. Go back to the truck record and click **History**.

> ✅ Expected: a panel slides in titled **Record history**, listing events oldest-relevant-first with a date grouping (**Today**, **Yesterday**, then dates). You should at least see **Asset registered**.

8. Click **Show changes** on the **Asset registered** row.

> ✅ Expected: the field-by-field values written by that command appear, using business names (`asset code`, `registration`, `chassis no.`, `acquisition price`, …), not database columns. Each event also names who did it and when.

9. If the history looks empty, click **Show all**.

> ✅ Expected: **No data changes on this record. Show all to see every event.** is what you see when only non-data events exist; **Show all** widens the list.

## Try to break it

- **Look for an edit path via the list.** Open the `⋯` menu on the truck's row in **Your trucks**. Expect only the lifecycle actions the record itself offers (**Commission** and/or **Assign**) plus **Open asset record** — no edit, no delete.
- **Renew the same document twice.** Renew a document, then find the now-superseded original and try to renew *that* one. If the UI lets you reach it, expect the command to fail with *This document was already renewed. Renew the latest version.* A document supersedes exactly once.
- **Save a document with no type.** Open **Add a document** and submit with **Document type** empty. Expect a required-field error and no toast.
- **Renew as the Entry operator.** Sign in as the Entry operator and open the same truck's **Documents**. Expect **Add a document** and **Renew** to be available and to work — documents are one of the things the Entry role genuinely owns.
- **Check the audit is append-only.** Do a renewal, then reopen **History**. Expect both **Document added** and **Document renewed** to be listed. Nothing you do in the UI should ever make an earlier event disappear or change.

> ⚠️ Note for maintainers: there is no correction path at all for a truck's own identity fields — a wrong **Truck code**, plate or chassis number registered by mistake can only be dealt with by registering a second truck, and the register keeps the wrong one forever with no way to retire it (see lesson 03: `DisposeAsset` from ARCHITECTURE.md §5.1 is not built in the web app). Worth confirming this is the intended pilot behaviour before testers report it as a bug each time.

Next: [03 — Lifecycle](/walkthroughs/assets/03-lifecycle)
