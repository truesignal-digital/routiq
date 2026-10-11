# Entries and recording money

**Goal:** record an expense with a receipt and a revenue, find both in **Entries**, open one, and correct a posted entry by cancelling it and recording it again.

**Log in as:** **Clarisse**, Cashier, Douala, in `transports-ngwa`. PINs are on [Access](/start-here/01-access). The correction steps use **Nadège** (Finance).

## Where you are

```mermaid
flowchart LR
  A[Money Overview] --> B[Entries and recording]
  B --> C[Approve and reject]
  C --> D[Accounting months]
  classDef current fill:#f59e0b,stroke:#b45309,color:#111827,stroke-width:2px
  class B current
```

## The rules you are testing

- Up to **100 000 FCFA**, an entry posts at once. Above that it waits for Finance; above **1 000 000 FCFA**, for the Director. The hint under **Amount** says which before you save.
- A missing receipt is a warning, never a block.
- A posted entry is never edited. To fix it you **cancel** it (a cancellation line takes its amount out of the totals) and record it again. The original stays visible, marked **Cancelled**.

## Steps

### Record an expense with a receipt

1. Open **Money** and click **Record expense**.

> ✅ Expected: a side panel **Record an entry** with an **Expense** / **Revenue** switch (**Expense** selected). Fields: **Branch** (Clarisse's is filled in: **Douala (DLA)**), **Category**, **Amount (FCFA)**, **Payment method** (**Cash**), **Date** (today), **Counterparty (optional)**, **Description (optional)**, **Payment reference (optional)**, **Truck (optional)**, **Supporting document (optional)**. **Record the expense** stays greyed until the form is complete.

![Record an entry panel, empty, with the approval hint under Amount](/money/record-empty.png)

*Before you type an amount, the hint states both approval bands.*

2. Pick **Fuel**, type `25000` in **Amount (FCFA)** and `Total Bonabéri` in **Counterparty (optional)**.

> ✅ Expected: the hint under **Amount** changes to *At this amount, the entry posts directly.*

3. Under **Supporting document (optional)**, click *Drop files here or click to choose* and pick a photo of a receipt.

> ✅ Expected: the file appears under the drop zone with its name, size, a thumbnail and a green tick.

![Bottom of the panel with the receipt file attached](/money/record-expense-receipt.png)

*The receipt uploads before you save; a green tick means it arrived.*

4. Click **Record the expense**.

> ✅ Expected: the panel closes and a toast says **Entry recorded and posted**.

![Entries list with the Entry recorded and posted toast](/money/record-expense-posted.png)

*A small expense posts at once.*

### Record a revenue that waits

5. Click **Record expense** again and switch to **Revenue**.

> ✅ Expected: the category list reloads with revenue categories only (**Freight revenue**). The button becomes **Record the revenue**.

6. Pick **Freight revenue**, type `180000` and `Bafoussam Market` in **Counterparty (optional)**.

> ✅ Expected: the hint reads *Above 100 000 FCFA, this entry waits for Finance.*

![Record an entry switched to Revenue, 180 000 FCFA, waits for Finance](/money/record-revenue.png)

*Above 100 000 FCFA the hint says who decides.*

7. Click **Record the revenue**.

> ✅ Expected: a toast **Entry sent for approval** with *Attach the receipt when you have it.*

### Find them in Entries

8. Click the **Entries** tab. Reload the page if your two new entries are not there yet (see *Try to break it*).

> ✅ Expected: a line *Filtered: Douala – N results* (Clarisse only sees Douala). Filters: **Status**, **Direction**, **Period (YYYY-MM)**, **Truck**, **Missing receipt** with a count, and a **Show every line in the books** box. Columns: **Entry number**, **Status**, **Economic date**, **Posting date**, **Category**, **Amount**, **Counterparty**, **Linked to**. Your fuel shows **Posted** and **−25 000 FCFA**; your revenue shows **Awaiting review**, **+180 000 FCFA** and no posting date.

![Entries list with posted and awaiting-review entries](/money/entries.png)

*Expenses carry a minus sign, revenue a plus. Entries awaiting review have no posting date yet.*

On a phone, each entry is one row: number and amount on top, date and category under it, the status badge on the right, and the filters fold into one **Filters** button.

![Entries on a phone](/money/entries-phone.png)

*Entries on a phone: one row per entry.*

9. Open the filters and read their choices.

> ✅ Expected: **Status** offers **All**, **Awaiting review**, **Posted**, **Rejected**, **Cancelled**, **Posted and cancelled**. **Direction** offers **All**, **Expense**, **Revenue**. **Linked to** shows links such as *Trip DLA-2026-00002* or *Work order WO-0002: A/C recharge and leak check*.

10. Click an entry number, for example **DLA-2026-00008**.

> ✅ Expected: a side panel shows the entry: number, **Status**, **Category**, **Amount** with *Expense* under it, **Economic date**, **Posting date**, **Linked to**, **Payment method**, **Description**, **Posting lines**, **Receipt** (*No file on this entry.*), **History**, and at the bottom **Open full screen**, **Close** and (for Finance) **Cancel entry**.

![Entry side panel over the Entries list](/money/entry-panel.png)

*Clicking an entry number opens it beside the list.*

11. Click **Open full screen**.

> ✅ Expected: the entry's own page. Header: number, status badge, and *Expense · Fuel · VH001 · Recorded by Sali*. When no receipt is attached, a yellow block says **No receipt yet** *Waiting on Sali to attach the receipt.* with **Attach receipt**. Tabs: **Overview**, **Receipt** (with a count), **History**. Cards: **What**, **Who and how much**, **Proof**. Right column: **Amount**, **Linked**, **Latest**.

![An entry's own page with No receipt yet and Attach receipt](/money/entry-page.png)

*The full page puts the next step, here the missing receipt, in the status block.*

12. Open Clarisse's fuel entry and its **Receipt** tab.

> ✅ Expected: **Receipt on file**, the file name, *Recorded with the entry*, the date and who, and a download button.

![Receipt tab with receipt.png on file](/money/entry-receipt-tab.png)

*A receipt added while recording shows on the Receipt tab.*

### Correct a posted entry

13. Sign in as **Nadège** (Finance). Open Clarisse's posted fuel entry and click **Cancel entry**.

> ✅ Expected: a dialog **Cancel entry** with *The entry stays in the books, marked Cancelled. A cancellation line takes its amount out of the totals.* and **Why cancel this entry?** with four choices: **Entered twice**, **Didn't happen**, **Wrong details, to record again**, **Other**. Buttons **Keep entry** and **Cancel entry**.

![Cancel entry dialog with Wrong details, to record again chosen](/money/cancel-dialog.png)

*Cancelling asks for one of four reasons.*

14. Pick **Wrong details, to record again** and click **Cancel entry**.

> ✅ Expected: a toast **Entry cancelled**. The dialog now says **Entry cancelled** *Record it again with the right details. The form opens filled in from the cancelled entry.* with **Close** and **Record again**. Behind it, the badge reads **Cancelled** and the block says *Reason: Wrong details, to record again.* and *Cancelled by entry DLA-…*.

![After cancelling: Record again offered](/money/record-again-offered.png)

*Wrong details offers Record again straight away.*

15. Click **Record again**, change **Amount (FCFA)** to `28000` and click **Record the expense**.

> ✅ Expected: the panel **Record expense** opens filled from the cancelled entry (branch, category, counterparty). After saving, a toast **Entry recorded and posted** and the new entry's page open. It is a new number, recorded by Nadège.

![Record again form filled from the cancelled entry](/money/record-again-form.png)

*The new entry starts from the old one; change what was wrong.*

16. Go to **Entries** and tick **Show every line in the books**.

> ✅ Expected: three rows tell the story: the new entry (**Posted**, −28 000 FCFA), a **Cancellation** row *Cancellation of entry DLA-… (October 2026)* (+25 000 FCFA), and the original with **Cancelled in October 2026** (−25 000 FCFA). With the box cleared, the original shows **Cancelled** with its amount struck through and **Show cancellation**.

![Entries with every line shown: the cancellation pair and the new entry](/money/entries-every-line.png)

*Every line in the books: nothing is deleted, the cancellation adds a line.*

## Try to break it

- **Entries not refreshing.** Record an entry, then look at **Entries** without reloading. In the October 2026 build the new entry is missing until you reload the page. Check whether this still happens.
- **Centimes.** Type `4500,50` in **Amount (FCFA)**. Expect the field to turn red with **Please enter a number.** and **Record the expense** to stay greyed.

![Amount 4500,50 refused with Please enter a number.](/money/record-decimal.png)

*FCFA has no centimes; a comma or a point is refused.*

- **Record again and the receipt.** After **Record again**, open the new entry's **Receipt** tab. In the October 2026 build the receipt does not follow, and the new entry asks for one. Report what you see.
- **Cancel a cancellation.** Open a **Cancellation** row. There must be no **Cancel entry** on it.
- **Cancel as Cashier.** As **Clarisse**, open a posted entry. Expect no **Cancel entry** button.
- **Pending entries.** Open an entry **Awaiting review** from its **⋯** menu. Expect only **Open full screen**, no **Cancel entry**.
- **Vehicle and truck.** The **Truck (optional)** box says *Assign to a vehicle…*. Note screens that mix the two words.

## Report it

Use [Reporting bugs](/testing/reporting-bugs). Give the entry number, its status before and after, and what the toast said.
