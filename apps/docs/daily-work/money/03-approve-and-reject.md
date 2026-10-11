# Approve and reject entries

**Goal:** work the **To approve** tab: approve one entry, reject another with a reason, and check who may decide what.

**Log in as:** **Nadège**, Finance, all branches, in `transports-ngwa`. PINs are on [Access](/start-here/01-access). Later steps use **Émilienne** (Director).

## Where you are

```mermaid
flowchart LR
  A[Money Overview] --> B[Entries and recording]
  B --> C[Approve and reject]
  C --> D[Accounting months]
  classDef current fill:#f59e0b,stroke:#b45309,color:#111827,stroke-width:2px
  class C current
```

## The rules you are testing

| Amount of the entry | Who decides |
| --- | --- |
| Up to 100 000 FCFA | Nobody. It posts at once. |
| Above 100 000, up to 1 000 000 FCFA | Finance or the Director |
| Above 1 000 000 FCFA | The Director |

- Nobody decides their own entry. A Finance member's own entry goes to the Director or another Finance member.
- The Director's own entries post at any amount.
- Administrators and Cashiers decide nothing; they have no **To approve** tab.
- Direction and Administrators move both amounts in [Company settings](/company/company-settings).

## Before you start

Do [Entries and recording](./02-entries-and-recording) steps 1 to 7 first, so Clarisse's 180 000 FCFA revenue is waiting. The demo also has two repair expenses waiting (450 000 and 310 000 FCFA) and one insurance expense of 1 650 000 FCFA for the Director.

## Steps

1. Open **Money** → **To approve**.

> ✅ Expected: the address ends in `/finance/approve`. A **Branch** filter sits above the table. Columns: **Entry number**, **Economic date**, **Submitted** (oldest first), **Branch** (a chip such as **Douala**), **Category** (with *· no receipt* in red when there is none), **Amount** (with *Expense* or *Revenue* under it), **Counterparty**. Each row ends with **Reject entry** and **Approve entry**. The 1 650 000 FCFA entry is not in Nadège's list.

![To approve tab for Finance with three entries](/money/to-approve-finance.png)

*Finance's queue: each row has Reject entry and Approve entry. The Director's band is not here.*

2. Click **Approve entry** on Clarisse's revenue (**Freight revenue**, **180 000 FCFA**).

> ✅ Expected: one click, no dialog. A toast **Entry approved**. The row leaves the list, and the counts on the tab and on the sidebar's **Money** row drop by one.

![The queue after approving: two rows left and the Entry approved toast](/money/approved.png)

*Approve is one click; the row leaves and the count drops.*

3. Click **Reject entry** on the 450 000 FCFA repair (**DLA-2026-00005**).

> ✅ Expected: a dialog **Reject entry** naming the entry: *DLA-2026-00005 · Repairs · 450 000 FCFA. Your reason is shown to Sali. The entry stays in the history as rejected and never counts in the books.* A required box **Rejection reason** (red star), and **Keep entry** / **Reject entry**.

4. Type `No invoice from the garage. Ask Akwa Truck Parts for one.` and click **Reject entry**.

![Reject entry dialog with a reason typed](/money/reject-dialog.png)

*Rejecting always asks for a reason, and says who will read it.*

> ✅ Expected: the dialog closes, the row leaves the list, the count drops again.

5. Open **Entries** and click **DLA-2026-00005**.

> ✅ Expected: the side panel shows **Status** **Rejected** (red) and a **Rejection reason** with exactly what you typed. The entry has no posting date and never counts in the totals.

![Rejected entry with its reason in the side panel](/money/rejected-panel.png)

*The rejection reason stays on the entry.*

### Your own entry

6. Still as Nadège, click **Record expense**. Pick **Insurance** and type `250000`.

> ✅ Expected: the hint reads *Above 100 000 FCFA, this entry waits for another Finance member or the Director.*

![Finance's own entry: the hint names another Finance member or the Director](/money/finance-own-hint.png)

*For Finance, the hint says someone else must decide.*

7. Click **Record the expense**, then open **To approve**.

> ✅ Expected: your own 250 000 FCFA entry is not in your list. Nobody decides their own entry.

### The Director

8. Sign in as **Émilienne** (Director) and open **Money** → **To approve**.

> ✅ Expected: the Director's list holds the 310 000 FCFA repair, the **1 650 000 FCFA** insurance and Nadège's **250 000 FCFA** insurance. The Director may decide any amount.

![The Director's To approve list, including the 1 650 000 FCFA entry](/money/to-approve-director.png)

*The Director sees the large entry and Finance's own entry.*

9. Approve Nadège's 250 000 FCFA entry.

> ✅ Expected: a toast **Entry approved**. In **Entries** it now shows **Posted** with today's posting date.

## Try to break it

- **Reject with no reason.** Open **Reject entry** and leave the box empty. **Reject entry** must not go through. Try a few spaces too.
- **Keep entry.** Open **Reject entry**, type a reason, then click **Keep entry**. Nothing must change.
- **Decide twice.** Open **To approve** in two tabs. Approve a row in the first, then approve the same row in the second. Expect a refusal or a refresh, never two decisions.
- **Old links.** Type `/finance/approvals` in the address bar. Expect to land on **To approve**.
- **No queue.** As **Boris** (Administrator) or **Clarisse** (Cashier), type `/finance/approve`. Expect to land on **Entries**, with no **To approve** tab.
- **Finance and the big band.** As **Nadège**, look for the 1 650 000 FCFA entry anywhere you could approve it. You must not find a way.
- **Rejected entries in the totals.** After rejecting, check the Overview tiles. A rejected amount must never be counted, not even under *Not counted*.

## Report it

Use [Reporting bugs](/testing/reporting-bugs). Give the entry number, the amount, who you were signed in as, and what the queue showed.
