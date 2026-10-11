# Glossary for testers

Plain-English meanings of the words you meet in ROUTIQ and in this handbook. The words on screen depend on the company: see [Words by company](#words-by-company).

---

## Words by company

| Meaning | Trucking (`transports-ngwa`) | Passenger (`littoral-voyages`) | French, trucking / passenger |
| --- | --- | --- | --- |
| A vehicle the company runs | Truck | Vehicle | Camion / Véhicule |
| One job a vehicle does | Trip | Trip | Trajet / Voyage |
| One stretch of a trip | Leg | Leg | Étape / Étape |

Internally the team says **asset** for a truck or vehicle and **activity** for a trip. Those two words should never show on screen.

---

## The company

### Workspace

One company in ROUTIQ. Data never crosses workspaces. You type the workspace when you sign in (`transports-ngwa`, `littoral-voyages`).

### Branch (Agence)

A site of the company: a depot or an office. Every truck, trip, person and money entry belongs to one branch. Branches are deactivated, never deleted.

### Branch picker

The control at the top right of the header: **All my branches** or one branch. It narrows what you see. It never gives you more access.

### Preset

The starting setup of a company: trucking, passenger (bus) or internal fleet. It picks the default modules and the words on screen. The vendor sets it.

### Module

A part of the app a company may have or not: Trucks, Trips, Maintenance, Money, Scheduling. When a module is off, its rows and tabs disappear and its data is kept.

---

## Roles

Six fixed roles. Each person has one role and a list of branches (or **All branches**). See [Accounts and roles](/start-here/02-accounts).

| Role (English) | French | In one line |
| --- | --- | --- |
| **Director** | Direction | Sees everything, approves anything, runs settings and access. |
| **Administrator** | Administrateur | Runs the daily work of their branches. The Chef d'agence. |
| **Finance** | Finance | Checks money entries, keeps the books, locks months. |
| **Cashier** | Caissier / Caissière | Records money at the counter. Approves nothing. Never sees profit. |
| **Technician** | Technicien | Problems, work orders, readings. Never sees revenue or profit. |
| **Driver** | Chauffeur | Trips, fuel and expenses, problems. Sees own records. |

### People and Users

**People** is everyone the fleet works with, with or without a login. **Users** is who can sign in. A person's usual job (driver, mechanic) is not their role in the app.

### Assigned driver

The regular driver of a truck. Optional, and the driver needs no login.

---

## Money words

### Revenue (Recettes)

Money the company earns for its work: freight, fares. Recorded as revenue entries.

### Expenses (Dépenses)

Money spent to run the company: fuel, tolls, repairs, allowances, insurance. Recorded as expense entries, on a truck or not.

### Profit (Bénéfice) and Loss (Perte)

Revenue minus expenses recorded in ROUTIQ for the period and branches on screen. It is not the accountant's profit: taxes, loan repayments and depreciation are not in it. Below zero it is written as a word: **Loss 86 000 FCFA**, never "−86 000 FCFA profit". Profit only shows when the company records revenue; otherwise the page shows expenses and cost per km.

### Truck profit (Bénéfice du camion)

Revenue recorded on one truck minus the expenses recorded on it. In the passenger company: **Vehicle profit**.

### Company costs (Frais généraux)

Expenses not recorded on any truck: office rent, office staff, phones. They are never spread across trucks. Company profit = profit of all trucks − company costs (+ any revenue recorded with no truck).

### Cost per km

Expenses divided by km driven, for the trucks whose km are known. Shows **Not recorded** when km or fuel are missing.

### Money format

**450 000 FCFA**: a space between thousands, FCFA after. FCFA has no cents, so amounts are whole francs.

### Entry

One revenue or one expense. Its status:

- **Awaiting review** — above the recording band, waiting for a decision. Not counted in posted totals.
- **Posted** — final. Counted in every total.
- **Rejected** — refused with a reason. Counts nowhere.
- **Cancelled** — a posted entry undone with a reason (**Cancel entry**). The original stays visible; it can be recorded again.

### Cancellation (Cancel entry, Record again)

How a posted entry is corrected. **Cancel entry** asks for a reason (for example *Wrong details* or *Entered twice*). The original keeps its figures and reads **Cancelled**; a mirror entry with the opposite amount takes it out of the totals. With *Wrong details*, **Record again** opens the form filled in from the cancelled entry.

### Missing receipt

A posted or waiting entry with no receipt photo or file attached. Counted on Money's Overview and listed in **To do** until someone attaches one.

### Approval bands

Who decides an entry, by amount. In the demo: up to **100 000 FCFA** posts directly; up to **1 000 000 FCFA** Finance decides; above that the Director decides. Nobody decides their own entry; the Director's own entries post at any amount. Set in [Company settings](/company/company-settings).

### Accounting month (Accounting months)

A calendar month of the books, listed on **Accounting months**. Finance or the Director locks it with **Lock period** when it is final: its posted entries can no longer change, and a late entry dated in it posts in the current month and keeps its date. Only the Director can **Reopen period**, with a reason.

---

## Trucks and maintenance

### Can drive

A truck in service and not grounded. Counted out of the fleet that is not sold, retired or written off, in your branches. The Dashboard tile **Trucks that can drive** and the Trucks tile **Can drive** show the same count.

### Grounded

A truck that must not drive. A safety-critical problem grounds it the moment it is reported. Only **release to service** ends it; finishing the repair does not.

### Off the road

Plain words for a grounded truck, used in summaries and To do (*VH003 off the road since 8 October 2026*). The Maintenance Overview counts these trucks in its **Off the road** tile.

### Safety-critical

A problem that makes the truck unsafe to drive. Ticking it when reporting, or **Mark as safety-critical** afterwards, grounds the truck at once. Taking the mark off does not release the truck.

### Release to service

The decision that ends a grounding and makes the truck **Available** again. Only the Administrator or the Director may release, and never the person who completed the work. Until then a repaired truck reads **Waiting for release**.

### Available

The green truck badge: in service, not grounded, free to drive.

### Commission

Putting a registered truck into service (**Commission**). From then on its status reads **In service** and its operating history starts counting.

### In service

The truck's life status (Registered, In service, then sold, retired or written off). In service is not the same as can drive: a grounded truck is still in service.

### Problem

Something reported wrong with a truck (**Report a problem**), with a category and a description. It ends as **Resolved** (fixed) or **Dismissed** (a mistake, a duplicate, nothing found), or it goes into a work order.

### Work order

The repair job for a truck, usually from one problem, with an **Expected cost** and, once the work is completed, an **Actual cost**. With the demo rules a new work order opens already **Approved**. The Technician completes it with **Complete work**; its cost becomes a money entry that follows the approval bands.

### Visite technique and Carte grise

Two truck document types, with their Cameroonian names: the roadworthiness inspection (visite technique) and the registration certificate (carte grise). Expired or soon-due documents show in **To do** and **Coming up**.

### Fleet board

The Trucks Overview chart of the last 30 days: one row per truck, one square per day (on a trip, available, in the workshop, grounded, not recorded).

---

## Trips

### Sheet

The paper trip sheet a driver brings back. **Record a sheet** types it in: route, km, legs, crew, revenue and expenses.

### Closed with gaps

A trip closed while something is missing (no crew, no revenue, no meter reading). ROUTIQ warns but does not block: the trip closes and lists what is missing, and its profit is marked as not to be trusted until a manager reopens it and fills the gaps.

---

## Screens

### Dashboard (Tableau de bord)

Home for the Director, Administrators and Finance: tabs **Overview**, **To do**, **Profit by truck**, **Profit by branch**. See [Dashboard](/daily-work/dashboard).

### Overview (Vue d'ensemble)

The first tab of every module page and record page: summary, tiles, why, To do.

### Summary

The sentence at the top of an Overview that says what changed. It shows on Mondays and on the 1st (and when something big changes), unless the company chose otherwise. Close it with the cross; **Show summary** brings it back.

### To do

What waits for you, ranked by safety, then money. Each row has one button that takes you to the work.

### Record page

The page of one money entry, trip or truck: one header with a status badge, a status block holding the decision, tabs from **Overview** to **History**, and a context column.

### Long form

A form on its own page split into sections (**Done** or **n missing**), with a **So far** column and one footer at the bottom. On a phone, one section per step, then a review.

### Toast

A short message in a corner of the screen that confirms an action, for example **Dashboard summary saved**.

---

## Rules behind the screens

### Nobody approves their own work

The person who records an entry cannot decide it, whatever their role.

### Corrected, not edited

Posted money, meter readings and documents are never changed in place. A posted entry is cancelled and recorded again; a document is renewed. The original stays, so history is complete.

### Warn, don't block

Missing data produces warnings and gaps, not refusals. The strict boundary is a locked accounting month.

### Safe retry

Sending the same action twice (a double tap, a dropped connection) records it once.

---

If you meet a word that is not here, ask in the team chat. This glossary grows with the gaps you find.
