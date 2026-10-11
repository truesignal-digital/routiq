# Money: the Overview

**Goal:** read the **Money** Overview and check that each tile, chart and To do item agrees with the entries behind it.

**Log in as:** **Nadège**, Finance, all branches, in `transports-ngwa`. PINs are on [Access](/start-here/01-access). Later steps compare **Clarisse** (Cashier, Douala) and **Émilienne** (Director).

## Where you are

```mermaid
flowchart LR
  A[Money Overview] --> B[Entries and recording]
  B --> C[Approve and reject]
  C --> D[Accounting months]
  classDef current fill:#f59e0b,stroke:#b45309,color:#111827,stroke-width:2px
  class A current
```

## Words on this page

- **Revenue**: money the company earns. **Expense**: money it spends.
- **Profit**: revenue minus expenses recorded in ROUTIQ for the period on screen. Below zero it is shown as a **Loss**, never as a negative profit.
- Only **posted** entries count. Entries **awaiting review** are named under the notice as *Not counted*.

## Who sees what

| Role | Money in the sidebar | Tabs | Extra tiles |
| --- | --- | --- | --- |
| Director | Yes | Overview · Entries · To approve | To approve, month close |
| Finance | Yes | Overview · Entries · To approve | To approve, month close |
| Administrator | Yes | Overview · Entries | none |
| Cashier | Yes | Overview · Entries | none |
| Driver | No | (a link opens *The expenses you recorded.*) | none |
| Technician | No | none | none |

## Steps

1. Click **Money** in the sidebar.

> ✅ Expected: the header reads **Money** with *Every revenue and expense.* and a **Record expense** button. Tabs: **Overview** (selected), **Entries**, **To approve** with a count badge. The sidebar's **Money** row shows the same count in red.

![Money Overview for Finance: notice, five tiles, Expenses by category, To do, Fuel per km by truck](/money/overview-finance.png)

*Finance's Money Overview: the range picker, the notice, five tiles, a category chart, To do and fuel per km. Taken after Clarisse's two entries from the next page, so it counts 3 to approve.*

2. Look at the range picker under the tabs: **This month**, **3 months**, **12 months**.

> ✅ Expected: **This month** is selected. On the right: *1–11 October compared with 1–11 September*: the same days of the previous month.

3. Read the notice. It starts with **Something changed** and a date.

> ✅ Expected: one sentence about the period, for example *Nothing has been posted for October yet, so there is no result to give.* with a grey **Not enough data yet** label, or *So far in October: a profit of …* with **Ahead of September**. A line at the bottom starts with *Counted:* and lists what is *Not counted*: entries waiting for approval (with their total), entries with no receipt, trips still open.

4. Read the tiles: **Expenses**, **Revenue**, **To approve**, **Missing receipt**, **September 2026 close**.

> ✅ Expected: **Expenses** and **Revenue** in FCFA, each with a comparison line (for example *▼ 100% vs 1–11 Sept* or *Same as 1–11 Sept*). **To approve** has a yellow dot, the count and a line such as *760 000 FCFA · oldest 2 minutes ago* (2 entries in a fresh demo). **Missing receipt** shows a count and *Oldest 14 July 2026*. **September 2026 close** reads **Open** with *Earlier, not locked: July 2026*.

5. Read **Expenses by category** (*Where did spending change?*).

> ✅ Expected: one row per category with a bar for this period and a thin mark for the comparison period, and *0 FCFA vs 85 000 FCFA* style figures. **Open Entries** at the bottom.

6. Read **To do**.

> ✅ Expected for Finance in a fresh demo: **2 entries wait for your approval** with **Open To approve**, **4 entries have no receipt** with **Open in Entries**, and **Close September 2026** (*1 entry*) with **Review**.

> ⚠️ The notice's *Not counted* total and the **To approve** tile can differ. The notice counts every waiting entry dated in the period, including those only the Director can decide. The tile counts what you can decide, whatever its date.

7. Read **Fuel per km by truck** (*Is any truck spending more on fuel than it should?*).

> ✅ Expected in the demo: *No truck has both km and fuel recorded in this period.* and, under it, *Not counted:* lines naming trucks with no km or no fuel. **See all trucks** at the bottom.

8. Click **3 months**.

> ✅ Expected: the address gets `?range=3-months`. The right side reads *July – September 2026 compared with April – June 2026*. The tiles and the category chart change to those months (in the demo: **Expenses 1 516 000 FCFA**, **Revenue 2 850 000 FCFA**, with Fuel, Driver allowance, Repairs and Tolls bars).

![Money Overview on 3 months, July to September 2026](/money/overview-3-months.png)

*3 months compares the last three closed months with the three before.*

9. Click the **Missing receipt** tile.

> ✅ Expected: the **Entries** tab opens with the **Missing receipt** filter switched on and its count on the button.

10. Click **To approve** in the To do card.

> ✅ Expected: the **To approve** tab opens. See [Approve and reject](./03-approve-and-reject).

### Other roles

11. Sign in as **Clarisse** (Cashier, Douala).

> ✅ Expected: tabs **Overview** and **Entries** only. Tiles: **Expenses**, **Revenue**, **Missing receipt**. No **To approve**, no month close, and no profit or loss anywhere on the page. The branch selector at the top reads **Douala**.

![A cashier's Money Overview with three tiles and no To approve tab](/money/overview-cashier.png)

*The cashier sees revenue, expenses and missing receipts, nothing to decide.*

12. Sign in as **Émilienne** (Director).

> ✅ Expected: like Finance, but **To approve** counts more entries, because entries above 1 000 000 FCFA wait for the Director (in the demo, **3**: 2 410 000 FCFA in total).

## Try to break it

- **Add up the tiles.** Open **Entries**, filter **Status: Posted** and the current month. Add the expenses by hand. The total must match the **Expenses** tile. Do the same for revenue.
- **Check Not counted.** Record an expense above 100 000 FCFA (it waits). Come back to Overview. **Expenses** must not move; the *Not counted* line must grow by that amount.
- **Range in the address.** Pick **12 months**, copy the address, open it in a new tab. The same range must be selected.
- **Close the notice.** Click **×** on the notice and reload. Note whether it comes back.
- **Words.** Look for *margin*, *contribution*, *money in* or *money out* anywhere on Money. The app uses **Revenue**, **Expense**, **Profit** and **Loss** only. Any other word is a bug.
- **Driver link.** As **Sali** (Driver), type `/finance` in the address bar. Expect the page *The expenses you recorded.* with Sali's own entries only, no Overview tab.

## Report it

Use [Reporting bugs](/testing/reporting-bugs). Give the range you picked, the tile, the number it showed, and the number you counted.
