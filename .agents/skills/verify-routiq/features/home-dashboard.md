# Home dashboard

Home (`/`) is the Dashboard ("Tableau de bord" / "Dashboard"). Direction, Finance and the Administrator get its tabs: Overview (`/`), To do (`/to-do`), Profit by truck (`/profit-by-vehicle`) and Profit by branch (`/profit-by-branch`), the range in `?range=3-months|12-months` (#666). Drive it with `pnpm verify drive flow:dashboard --role director --lang en` (add `--viewport 390x844` for the phone layout, `--role admin-yde` for the costs view of a branch with no revenue). On a fresh seed this month holds almost no posted money; the 12-month range has the July trips.

Every Overview (the Dashboard, Money, Trucks, Trips, Maintenance) starts with the summary notice when it is due: Mondays, the 1st, or a big change (a vehicle grounded in the last 7 days, expenses 20% above the comparison) (#667). Otherwise the tiles come first and the counted line under them has "Show summary" / "Afficher le résumé". Closing it is stored on the device per person, workspace and Overview (`localStorage` keys `routiq-summary-closed:*`), so a fresh browser context sees it again. Drive it with `pnpm verify drive flow:summary-notice --role director --lang en` (add `--viewport 390x844`).

The cashier, the technician and the driver keep the older Home below: KPI cards for the role, a spending and revenue chart, and recent entries. Finance cards and the chart need a finance reader; the pending-approvals card needs FINANCE or DIRECTOR.

## Sub-features

- `home-kpis` shows the cards `pendingApprovals`, `assets`, `openPeriodExpense`, `openPeriodRevenue` as the role allows.
- `home-approvals-link` opens the approvals queue from the pending-approvals card.
- `home-chart` shows the expense and revenue chart with a range picker ("Période affichée").
- `home-recent` lists recent entries with "Voir toutes les écritures" / "See all entries".

## How to get to it (user POV)

- Sign in; Home is the landing page.
- Sidebar "Tableau de bord" / "Dashboard".

## Driving it with pnpm verify

Preconditions:

- Fresh seed: 2 pending approvals (VH003 repair 450,000 XAF by sali, VH003 brake parts 310,000 XAF by herve); 2 trucks in service.

- **Cards for a finance approver.** Run `pnpm verify drive flow:home --role finance --lang en`. It logs `kpi cards shown: pendingApprovals, assets, openPeriodExpense, openPeriodRevenue` and checks the `[data-kpi="pendingApprovals"] [data-slot="kpi-value"]` text equals `pendingApprovals.count` from `GET /v1/dashboard?days=90` (2 on a fresh seed).
- **Cards for the technician.** Run `pnpm verify drive flow:home --role technician`. Only the `assets` card shows; the flow logs that the dashboard read has no approvals.
- **Cards for an administrator.** Run `pnpm verify drive flow:home --role admin`. No approvals card (ADMIN approves no money); finance cards show.
- **Approvals link.** In a DriveScript, click `page.getByRole("link", { name: "Approbations en attente" })`. The URL becomes `/finance/approvals`.
- **Proof.** `01-home.png` and the cross-check line on stdout.

## Gotchas

- Each card is a link whose accessible name is its title; the number is inside `[data-slot="kpi-value"]`.
- The open period is the current month in the workspace time zone (Africa/Douala). Seeded trips are in July 2026, so the period cards can show small numbers even though the ledger has more.
