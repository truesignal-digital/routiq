# Home dashboard

Home (`/`) shows KPI cards for the signed-in role, a spending and revenue chart, and recent entries. Finance cards and the chart need a finance reader; the pending-approvals card needs FINANCE or DIRECTOR.

## Sub-features

- `home-kpis` shows the cards `pendingApprovals`, `assets`, `openPeriodExpense`, `openPeriodRevenue` as the role allows.
- `home-approvals-link` opens the approvals queue from the pending-approvals card.
- `home-chart` shows the expense and revenue chart with a range picker ("Période affichée").
- `home-recent` lists recent entries with "Voir toutes les écritures" / "See all entries".

## How to get to it (user POV)

- Sign in; Home is the landing page.
- Sidebar "Accueil" / "Home".

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
