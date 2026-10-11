# Tour of the app

**Goal** — Learn the parts every screen shares: the sidebar, the header, the Dashboard, the Overview-first tabs, record pages, long forms and the phone layout. Once you know these, every module reads the same way.

**Log in as** — the Director (`emilienne`) on a computer, then again on a phone or a narrow window.

## The sidebar

The sidebar has two groups.

- **Daily work**: **Dashboard**, **Trucks**, **Trips**, **Maintenance**, **Money**. A red number on a row counts what waits for you there (problems to triage, entries to approve).
- **Company**: **People**, **Users**, **Branches**, **Accounting months**, **Company settings**.

Each role sees fewer rows. [Accounts and roles](./02-accounts.md) lists them.

At the bottom is your name, role and branches. Click it for **My settings** and **Sign out**.

## The header

From left to right: the button that folds the sidebar to icons, the breadcrumb (where you are, for example **Dashboard › Money › Entries**), then on the right the branch picker and the light/dark switch.

The branch picker shows **All my branches**, or one branch. Picking a branch narrows every page to it. A small notice confirms it, for example *You are viewing: Douala*, and the header gets a thin tinted line.

![The branch picker open on All my branches, Bafoussam, Douala, Yaoundé](/start-here/branch-switcher.png)

![Douala picked: the header shows Douala and the notice You are viewing: Douala](/start-here/branch-picked.png)

## The Dashboard

**Dashboard** is home for the Director, Administrators and Finance. It has four tabs: **Overview**, **To do**, **Profit by truck** and **Profit by branch**. The [Dashboard lesson](/daily-work/dashboard) walks through it.

## Every module opens on Overview

Trucks, Trips, Maintenance and Money each open on an **Overview** tab, then their work tabs:

| Page | Tabs |
| --- | --- |
| Trucks | **Overview** · **Trucks** · **Documents** |
| Trips | **Overview** · **Trips** |
| Maintenance | **Overview** · **Problems** · **Work orders** |
| Money | **Overview** · **Entries** · **To approve** |

An Overview reads top to bottom the same way on every page:

1. The page's main button top right (**Record expense**, **Register a truck**, **Record a sheet**, **Create work order**).
2. A range picker (**This month**, **3 months**, **12 months**) where money is shown, with the comparison period on the right.
3. The **summary**: one sentence about what changed, with a close button. See [Dashboard](/daily-work/dashboard).
4. A row of tiles. Each tile opens the list behind it.
5. Cards that explain the numbers, and a **To do** card.

![Money opens on Overview: summary, tiles, Expenses by category and To do](/start-here/overview-first-money.png)

## Record pages

A money entry, a trip and a truck each have a page built the same way:

- **One header**: the record's number or code, a status badge, and one line of facts. The actions sit top right.
- **A status block** under the header that says where the record stands and holds the decision. On a waiting entry it holds **Reject entry** and **Approve entry**. On a trip closed with gaps it lists what is missing.
- **Tabs**: **Overview** first and **History** last. A truck has the most: **Overview** · **Maintenance** · **Money** · **Trips** · **Documents** · **Details** · **History** (fewer for roles that may not see money or documents).
- **Titled sections** on Overview (for an entry: **What**, **Who and how much**, **Proof**).
- **A context column** on the right: the amount or money box, linked records, and the latest history with **All history**.

![A money entry waiting for approval: header, status block with the decision, tabs and the context column](/start-here/record-page-entry.png)

![A closed trip with gaps: the status block names the five missing things](/start-here/record-page-trip.png)

## Long forms

**Record a sheet** (Trips) and **Register a truck** (Trucks) are long forms on their own page:

- The form is split into titled sections. Each section shows its state: **Done** or **n missing**.
- A **So far** column on the right adds up what you typed (for a sheet: truck, route, distance, revenue, expenses, profit). Under it, **Still missing** lists what is left; each line takes you to the field.
- One footer stays at the bottom of the screen. The main button is last on the right (for a sheet: **Record and close**, then **Record sheet**).

![Record a sheet: sections on the left, So far and Still missing on the right, the footer at the bottom](/start-here/long-form-sheet.png)

## On a phone

Below tablet width the app changes shape:

- The sidebar becomes a bar at the bottom. For the Director it holds **Dashboard**, **Trucks**, **Money** and **Menu**. **Menu** opens the full sidebar. The bar changes with the role.
- Tiles sit two per row.
- On a record page, the decision buttons move to a bar above the bottom bar.
- A long form shows one section per step (*Step 1 of 7*), with **Next** at the bottom, then a review.

<div style="display:flex;gap:16px;flex-wrap:wrap">

![The Dashboard on a phone, with the bottom bar](/start-here/phone-dashboard.png)

![Menu opens the full sidebar](/start-here/phone-menu.png)

![A waiting entry on a phone: Reject entry and Approve entry above the bottom bar](/start-here/record-page-entry-phone.png)

![Record a sheet on a phone: one section per step](/start-here/long-form-phone-step.png)

</div>

## Money and dates

Money is written with a space between thousands and **FCFA** after it: **450 000 FCFA**. A loss is written as a word, never a minus profit: **Loss 86 000 FCFA**. Dates are written **29 July 2026**; tables shorten the month (**29 Jul 2026**). Date fields are typed **dd/mm/yyyy**.

## Steps

1. As `emilienne`, click each sidebar row in turn.

> ✅ Expected: Trucks, Trips, Maintenance and Money each open on **Overview**, with the tabs in the table above. The breadcrumb follows you.

2. Pick **Douala** in the branch picker, then go back to **All my branches**.

> ✅ Expected: the notice *You are viewing: Douala*, and the lists narrow to Douala. Going back shows all branches again.

3. Open **Money → To approve** and click an entry number.

> ✅ Expected: the record page with one header, a status block holding **Reject entry** and **Approve entry**, and tabs **Overview** · **Receipt** · **History**. Do not decide it yet: the [approvals lesson](/daily-work/money/03-approve-and-reject) does that.

4. Narrow the window to phone width (or use a phone).

> ✅ Expected: the bottom bar appears, tiles go two per row, and nothing scrolls sideways.

## Try to break it

- **Sideways scroll.** On a phone, open every page you can reach. Any page that scrolls left and right is a bug.
- **Lost tab.** Open a record's **History** tab, then reload. Expect to stay on History (the tab is in the address).
- **Two filled buttons.** On any record page, count the dark filled buttons in the header. More than one is a bug.
- **Page width.** Move between a list, a record and a long form. The content should keep the same width and left edge on every page.

## Report it

Use the template in [Reporting bugs](/testing/reporting-bugs).

Next: [Company flow](./04-company-flow.md)
