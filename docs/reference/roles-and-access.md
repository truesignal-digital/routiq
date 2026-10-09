# Roles and access

The training source for who may do what in ROUTIQ. Decisions:
[ADR-0009](../adr/0009-six-fixed-roles-named-by-the-team.md) (roles) and
[ADR-0010](../adr/0010-one-person-list-with-optional-app-access.md) (people
and app access). Status 2026-10: **the six roles are built** (role codes, command permissions,
app-access rules, migration), and so are **the default approval chain**
(migration 0037; every `approve-*` / `reject-*` command refuses the member who
made the record) and **the money read gates** (`MONEY_READ_SCOPE` in
`packages/contracts/src/roles.ts`). Still to build: the Personnel list
(ADR-0010). The "Built today" column in the migration table is the role each
person held before.

## The six roles

| Role (fr) | Role (en) | Who it is for | Branches |
|---|---|---|---|
| **Direction** | Director | Owner, DG, stakeholder. Sees everything, approves anything, runs settings and access. | Always all |
| **Administrateur** | Administrator | Runs daily operations of their branches: vehicles, trips, work orders, people. In the org chart: the Chef d'agence. | Listed branches or all, usually one |
| **Finance** | Finance | Validates money entries, keeps the books and documents, pays suppliers (planned). | Listed branches or all, usually all |
| **Caissier** | Cashier | Records money in and out at the counter, with receipts. Approves nothing. | Listed branches or all |
| **Technicien** | Technician | Workshop: problems, work orders, parts and labour, readings. No books. | Listed branches or all |
| **Chauffeur** | Driver | Trips, fuel and expenses, readings, reports problems. Sees own records. | Listed branches or all |

Every role but Direction is given either a list of branches or **All**. All
also covers branches added later. Direction always covers all branches,
whatever its access says.

## People and app access

- **Personnel** is the one list of people: drivers, mechanics, hostesses,
  convoyeurs, managers.
- **App access** is optional. It gives a person a role, branches and a login
  (username + PIN).
- **Fonction** (what they do: Chauffeur, Mécanicien, Hôtesse…) is not **Rôle**
  (what they may do in the app).
- **Chauffeur attitré** is the regular driver of a vehicle. It is optional and
  needs no login.
- Removing access keeps the person and their history.

## Feature map

- **✓** does it in their branches. Direction's ✓ covers all branches.
- **S** submits it, and it may go to review under the approval bands.
- **A** approves or rejects. The default chain: work orders → Administrateur,
  money → Finance up to 1 000 000 XAF, above that → Direction (owner,
  2026-10-05). Anyone's entry up to the recording band (100 000 XAF) posts
  without review, Finance's and the Administrateur's included; above it, it
  waits. Finance decides the ones above it up to 1 000 000 XAF; Direction
  decides above 1 000 000 XAF and may decide anything. No one decides their
  own entry, so a Finance member's own entry goes to Direction (or another
  Finance member). Only Direction's own entries post at any amount (#412).
  Both bands are tenant data: Direction moves them in the approval settings.
  When Direction moves a band, everyone else whose own entries it moves sees
  a notice in the app on their next screen, with their new chain, until they
  dismiss it. The amount field of the expense and revenue forms states the
  rule too (#422).
- **V** view only. **Own** only their own records. **—** no access. For
  trips, a driver's own trips are the ones they recorded, are planned to
  drive, or are on as driver (ADR-0012). Drivers see a trip's price only
  when the company turns on "Show trip price to drivers".
- **Planned** rows are not built yet. The roles are fixed now so training does
  not change when they ship.

| Area | Feature | Direction | Administrateur | Finance | Caissier | Technicien | Chauffeur |
|---|---|---|---|---|---|---|---|
| Home | Home dashboard | ✓ | ✓ | ✓ money view | ✓ cash view | ✓ work queue | ✓ own trips |
| Home | Reports page *(planned)* | ✓ | ✓ | ✓ money reports | — | — | — |
| Vehicles | See vehicles and the vehicle workspace | ✓ | ✓ | ✓ | V | V | V |
| Vehicles | Register and commission a vehicle | ✓ | ✓ | — | — | — | — |
| Vehicles | Transfer a vehicle to another branch | A | S | A | — | — | — |
| Vehicles | Set the assigned driver (Chauffeur attitré) | ✓ | ✓ | — | — | — | — |
| Vehicles | Record a meter reading | ✓ | ✓ | — | — | ✓ | ✓ |
| Vehicles | Write a note | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Vehicles | Mark a note from Direction as seen (it waits in the vehicle's To-do until then; never its author) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Vehicles | Location (reported, not GPS) *(planned)* | V | ✓ | — | — | — | ✓ |
| Maintenance | Report a problem | ✓ | ✓ | — | — | ✓ | ✓ |
| Maintenance | Mark a reported problem safety-critical (grounds the vehicle) | ✓ | ✓ | — | — | ✓ | ✓ |
| Maintenance | Take the safety-critical mark off a problem (never releases the vehicle) | ✓ | ✓ | — | — | — | — |
| Maintenance | Create and run a work order | ✓ | ✓ | — | — | ✓ | — |
| Maintenance | Add parts and labour to a work order | ✓ | ✓ | — | — | S | — |
| Maintenance | Approve a work order and its completion | A | A | — | — | — | — |
| Maintenance | Resolve or dismiss a problem | ✓ | ✓ | — | — | ✓ | — |
| Maintenance | Release a vehicle to service | ✓ | ✓ | — | — | — | — |
| Maintenance | Stock and purchase orders *(planned)* | A | A | A | — | S | — |
| Trips | Record a trip (sheets, legs, crew) | ✓ | ✓ | — | — | — | S own |
| Trips | Close a trip | ✓ | ✓ | — | — | — | ✓ own |
| Trips | Reopen a closed trip | ✓ | ✓ | — | — | — | — |
| Trips | Swap the vehicle on a trip | ✓ | ✓ | — | — | — | ✓ own |
| Trips | Start, pause and end a trip on the phone *(planned)* | ✓ | ✓ | — | — | — | ✓ own |
| Trips | Book, assign, move, edit or cancel a planned trip *(planned, ADR-0012)* | ✓ | ✓ | — | — | — | — |
| Trips | Start a planned trip *(planned, ADR-0012)* | ✓ | ✓ | — | — | — | ✓ own |
| Trips | Record a delivery *(planned, ADR-0012)* | ✓ | ✓ | — | — | — | ✓ own |
| Trips | Schedule calendar *(planned)* | ✓ | ✓ | V | — | V | V own |
| Trips | Driver page and performance *(planned)* | ✓ | ✓ | — | — | — | V own |
| Money | Record an expense (fuel, tolls, parts) | ✓ | ✓ | ✓ not on work orders | ✓ not on work orders | S on work orders | S not on work orders |
| Money | Record revenue (never on a work order) | ✓ | ✓ | ✓ | ✓ | — | — |
| Money | Attach a receipt or photo | ✓ | ✓ | ✓ | ✓ | ✓ own | ✓ own |
| Money | Approve or reject an entry | A | — | A | — | — | — |
| Money | Reverse a posted entry | ✓ | — | ✓ | — | — | — |
| Money | See entries and the ledger | ✓ | ✓ | ✓ | V branch entries | V work-order costs | V own |
| Money | Lock a period (the whole company's month; open question below) | ✓ | — | ✓ | — | — | — |
| Money | Reopen a locked period | ✓ | — | — | — | — | — |
| Money | Pay suppliers, in instalments, with receipts *(planned)* | A | V | ✓ | ✓ cash | — | — |
| Money | Suppliers list *(planned)* | ✓ | ✓ | ✓ | V | V | — |
| Money | Customers, bills and what they owe *(planned, trucking)* | ✓ | ✓ | ✓ | ✓ record payments | — | — |
| Documents | Add or renew a vehicle document | ✓ | ✓ | ✓ | — | — | — |
| Documents | See documents and expiry | ✓ | ✓ | ✓ | — | V | V |
| People | See Personnel | ✓ | ✓ | V | — | — | — |
| People | Add a person (driver, hostess, mechanic…) | ✓ | ✓ | — | — | — | — |
| People | Give, change or remove app access; reset PIN | ✓ every role but Direction | ✓ Chauffeur, Technicien, Caissier only | — | — | — | — |
| Settings | Branches, categories, approval bands | ✓ | — | — | — | — | — |
| Settings | Modules and template presets | vendor only (ADR-0005; `pnpm --filter @routiq/api entitlement`, #362; open question below) | — | — | — | — | — |
| Any | Approve something you submitted | — | — | — | — | — | — |

## Migration from the built roles

A plain map that promotes nobody (owner, 2026-10-04). Nobody becomes Direction automatically.

| Built today | Becomes | What changes for that person |
|---|---|---|
| ADMIN | ADMIN | Loses settings and approval of money entries. Direction is given by hand afterwards (new workspaces: the first account is DIRECTOR). |
| OPS_MANAGER | ADMIN | Gains approving work orders, adding people and access for field roles. |
| FIELD_SUBMITTER | DRIVER | Sees own records only (today: whole ledger). Can no longer renew documents or resolve problems. |
| MAINTENANCE | TECHNICIAN | Same work. Parts and labour stay limited to work orders. |
| FINANCE_APPROVER | FINANCE | Gains adding and renewing documents. Stops approving work orders (the Administrateur does). |
| EXECUTIVE_VIEWER | ADMIN | Gains daily operations of their branches. Direction is given by hand if the person needs it. |
| — | CASHIER | New role. |

## Open for the pilot team

- **Wording to confirm before training:** Convoyeur and Chef d'atelier. Research found no Cameroonian transport posting that uses them.
- **Who approves work orders:** does the Administrateur approve work orders
  alone, or does Finance also sign costs above a band? The default above
  follows the team's use-case document (Admin validates, Finance pays).
- **Open question: who turns modules on and off?** ADR-0005 makes modules
  entitlements the vendor grants, so the rule in this document is "vendor
  only". #362 enforces it for modules and template presets: every tenant
  role, Direction included, is refused, and the vendor changes them with
  `pnpm --filter @routiq/api entitlement`. Owner to confirm the rule before
  #362 merges.
- **Open question: may a Finance member limited to some branches lock the
  month for the whole company?** A month is one per company, not per branch,
  so a lock stops posting into that month in every branch. Today any Finance
  member may lock it, whatever their branches. Owner to decide whether that
  is intended, or whether locking needs all branches (or Direction).
