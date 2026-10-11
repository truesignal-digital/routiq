# Accounts and roles

**Goal** — Know the six roles, what each one sees in the sidebar, and where each one lands after sign-in. Then prove it by signing in as each.

**Log in as** — each account in turn. Usernames are below; PINs and workspaces are on [Access](./01-access.md).

ROUTIQ gives each person two things: one **role** (what they may do) and their **branches** (where they may do it). A person with **All branches** also covers branches added later. The Director always covers every branch.

The branch picker in the header only narrows what you are looking at. It never gives you more access.

## The six roles at a glance

| Role | Trucking account | Lands on | Sidebar |
| --- | --- | --- | --- |
| Director | `emilienne` | Dashboard (profit) | Dashboard · Trucks · Trips · Maintenance · Money, then People · Users · Branches · Accounting months · Company settings |
| Administrator | `boris` (all), `amadou` (Yaoundé) | Dashboard (profit) | Dashboard · Trucks · Trips · Maintenance · Money, then People · Users · Company settings |
| Finance | `nadege` | Dashboard (profit) | Dashboard · Trucks · Trips · Money, then People · Accounting months |
| Cashier | `clarisse` (Douala) | A short Dashboard, no profit | Dashboard · Trucks · Money |
| Technician | `herve` | Maintenance | Dashboard · Trucks · Maintenance |
| Driver | `sali`, `patrice` (Yaoundé) | A short Dashboard | Dashboard · Trucks · Trips |

The passenger company has the same six roles: `josiane`, `paul`, `aline`, `grace`, `bertrand`, `eric`. See [Passenger company](/presets/passenger-company).

## Director

The owner or general manager. Sees everything, approves anything, runs the settings and who has access.

- Lands on the **Dashboard** with revenue, expenses and profit.
- Approves money entries above the Finance band (1 000 000 FCFA in the demo) and may decide any entry, except their own.
- Only the Director sees **Branches** in the sidebar.
- The Director's own entries post at any amount.

![The Director lands on the Dashboard](/start-here/landing-director.png)

## Administrator

Runs the daily work of their branches: trucks, trips, work orders, people. In the org chart this is the Chef d'agence. Changes Company settings together with the Director.

- Lands on the **Dashboard**.
- Registers trucks, records trips, runs work orders, releases trucks to service. With the demo rules a new work order opens already **Approved**, so there is no work order approval step to test.
- Adds people and gives app access to Drivers, Technicians and Cashiers.
- Does **not** approve money entries. Has no **Branches** or **Accounting months** row.

![Boris lands on the Dashboard; Company has People, Users and Company settings](/start-here/landing-administrator.png)

`amadou` only has Yaoundé. The demo has no trucks in Yaoundé, so his Dashboard shows the costs view: **Expenses**, **Truck costs** and **Company costs**, with no profit. This is how a branch with no revenue looks.

![Amadou's Dashboard: one branch, no revenue, so the costs view](/start-here/landing-administrator-yaounde.png)

## Finance

Checks money entries and keeps the books.

- Lands on the **Dashboard** with profit.
- Approves or rejects entries above the recording band up to the Finance band, never their own. A Finance member's own large entry goes to the Director or another Finance member.
- Reverses posted entries and locks accounting months.
- Sees **People** (read only) and **Accounting months**. No Maintenance row.

![Finance lands on the Dashboard; the sidebar has Money and Accounting months](/start-here/landing-finance.png)

## Cashier

Records money in and out at the counter, with receipts. Approves nothing.

- Lands on a short **Dashboard**: **Trucks in service** and **Recent entries**. No revenue, expenses or profit tiles.
- **Money** opens on **Overview** and **Entries** only. There is no **To approve** tab.
- Never sees profit anywhere.

![The Cashier's Dashboard: trucks in service and recent entries](/start-here/landing-cashier.png)

## Technician

The workshop: problems, work orders, parts and labour, meter readings. No books.

- Lands on **Maintenance**, on its **Overview** tab. The **Dashboard** row also opens Maintenance.
- Never sees revenue or profit on any page.

![The Technician lands on the Maintenance Overview](/start-here/landing-technician.png)

## Driver

Trips, fuel and expenses, meter readings, reporting problems. Sees their own records.

- Lands on a short **Dashboard**: **Trucks in service** and **Recent entries** (their own).
- **View all entries** opens the Money list titled *The expenses you recorded.*, even though Money is not in the Driver's sidebar.

![The Driver's Dashboard](/start-here/landing-driver.png)

## Steps

1. Sign in as each trucking account in turn, in English.

> ✅ Expected: each lands where the table says, and the sidebar shows exactly the rows in the table. The name at the bottom of the sidebar shows the role and branches, for example **Cashier · Douala**.

2. As `clarisse`, look at the header.

> ✅ Expected: the branch shows as **Douala**. There is no way to pick Bafoussam or Yaoundé.

3. As `boris`, open **Company settings**.

> ✅ Expected: the page says *Only the Director and Administrators can change them.* Boris sees **Change approval thresholds** and **Change Dashboard summary**. See [Company settings](/company/company-settings).

## Try to break it

- **Type an address you should not reach.** As `clarisse`, type `/more/users` after the app address. As `herve`, type `/finance`. Expect a refusal page, never the data.
- **Profit leaks.** As `clarisse` and `herve`, look at every page you can reach for the words revenue, profit or loss. The Cashier may see revenue entries she recorded, but never a profit figure. The Technician sees neither.
- **Approve your own entry.** As `nadege`, record an expense above 100 000 FCFA, then look for it in **Money → To approve**. Expect no way to approve it yourself: another approver must decide.
- **Branch scope.** As `amadou`, look for any Douala truck, trip or entry. Expect none.

## Report it

Use the template in [Reporting bugs](/testing/reporting-bugs). Name the account you used.

Next: [Tour of the app](./03-tour.md)
