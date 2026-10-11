# What's new in the October 2026 release

::: info When you can see it
These features reach the public demo site with the October 2026 release. Until then they are on the test build the team gives you.
:::

**Goal** — Know what changed since the last release, and test the biggest changes first.

**Log in as** — the Director (`emilienne`), then the roles each section names. PINs and workspaces are on [Access](/start-here/01-access).

![The new Dashboard: tabs, range, summary, tiles, the profit bridge and To do](/release/dashboard.png)

## What changed

### Home is the Dashboard

Home is now called **Dashboard**, with four tabs: **Overview**, **To do**, **Profit by truck** and **Profit by branch**. Overview shows tiles for revenue, expenses, profit (with its % of revenue), cost per km and trucks that can drive; a **What changed the profit** chart; **To do**; profit by truck; revenue and expenses per month; truck profit by branch; and **Coming up**. On a phone the tiles go two per row and the chart becomes a list. → [Dashboard](/daily-work/dashboard)

### Every module page opens on Overview

| Page | Tabs |
| --- | --- |
| Money | **Overview** · **Entries** · **To approve** |
| Trucks | **Overview** · **Trucks** · **Documents**, with a 30-day **Fleet board** |
| Trips | **Overview** · **Trips** (and **Planning** when Scheduling is on) |
| Maintenance | **Overview** · **Problems** · **Work orders** |

Technicians land on Maintenance and never see revenue or profit. Cashiers never see profit. Drivers keep their own short Dashboard. → [Trucks](/daily-work/trucks/01-overview-and-list), [Trips](/daily-work/trips/01-overview), [Maintenance](/daily-work/maintenance/01-overview), [Money](/daily-work/money/01-overview)

![Trucks opens on Overview with the Fleet board](/release/trucks-overview.png)

### A summary you can close

Every Overview starts with one sentence about what changed. It shows on Mondays and on the 1st of the month, and when something big changes. Close it with the cross; **Show summary** brings it back. The line that says what was counted stays under the tiles. → [Dashboard](/daily-work/dashboard#the-summary)

### Administrators can change Company settings

**Company settings** now belongs to the Director **and** the Administrators: the approval thresholds and the new **Dashboard summary** schedule. → [Company settings](/company/company-settings)

### Record pages

A money entry, a trip and a truck share one layout: one header with a status badge, a status block holding the decision (**Approve entry** / **Reject entry** on a waiting entry), tabs with **Overview** first and **History** last, titled sections, and a context column on the right. → [Tour: record pages](/start-here/03-tour#record-pages)

![A waiting entry: the decision sits in the status block](/release/record-page.png)

### Long forms

**Record a sheet** and **Register a truck** are split into sections marked **Done** or **n missing**, with a **So far** column and one footer that stays at the bottom. On a phone: one section per step, then a review. → [Tour: long forms](/start-here/03-tour#long-forms)

### One page width

Lists, records and forms now share the same width and left edge.

### Money words and formats

The app says **revenue**, **expenses** and **profit** everywhere. A loss reads **Loss 86 000 FCFA**. Money reads **450 000 FCFA**, dates **29 July 2026**, and date fields take **dd/mm/yyyy**. Trucks have **Visite technique** and **Carte grise** document types. → [Glossary](/glossary#money-words)

## What to test first

Do these in order. Each one takes a few minutes.

1. **The Dashboard as three roles.** Sign in as `emilienne`, `nadege` and `clarisse`. The first two get the profit Dashboard; Clarisse gets a short one with no profit. Then sign in as `herve`: he lands on Maintenance.
2. **The summary.** On the Dashboard, close the summary with the cross. Check that **Show summary** appears and brings it back, and that the "Counted: …" line stays under the tiles.
3. **Company settings as an Administrator.** Sign in as `boris`. Open **Company settings** and change the **Dashboard summary** schedule, then put it back.
4. **Approve from a record page.** As `nadege`, open **Money → To approve**, click an entry number, and approve it from the status block.
5. **A long form on a phone.** As `boris` on a phone, start **Record a sheet** and step through it to the review.
6. **Formats.** On any page, look for money written as "FCFA 450,000", a negative profit written with a minus sign, or a date like "07/29/26". Each one is a bug.

## Which accounts

| To test | Use |
| --- | --- |
| Dashboard with profit | `emilienne` (Director), `boris` (Administrator), `nadege` (Finance) |
| Dashboard for one branch with no revenue | `amadou` (Administrator, Yaoundé) |
| No profit anywhere | `clarisse` (Cashier), `herve` (Technician) |
| The Driver's own Dashboard | `sali` |
| Passenger words (Vehicles) | `josiane` in `littoral-voyages` |

## Older notes that no longer apply

If you tested in August or September: the old trucking-test and passenger-test companies, the Entry Clerk, Maintenance, Executive and Operations roles, the **Finance → Approvals** page and the **Entry detail** page are gone. The six roles are on [Accounts and roles](/start-here/02-accounts); approvals live in **Money → To approve**.

## Report it

Use the template in [Reporting bugs](/testing/reporting-bugs). Start the first line with `[October 2026]` so the team can sort release findings.
