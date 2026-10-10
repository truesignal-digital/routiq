# ROUTIQ

Vehicle-centered fleet operations and spending traceability for companies operating vehicles, including internal service fleets and transport operators. An internal fleet supports the company's work without necessarily earning revenue per trip.

## Language

**Asset-Operating Business**:
A business operating vehicles or other expensive assets to deliver its own work or transport services; the assets consume costs but need not generate directly attributed revenue.
_Avoid_: "any business", "client vertical"

**Internal Fleet**:
Vehicles operated to support a company's own work, rather than requiring fares or freight revenue for each activity.
_Avoid_: unprofitable transport fleet, passenger preset

**Vehicle Workspace**:
The vehicle-centered view of its identity, records, money, documents and history, with the actions the reader is authorized to perform.
_Avoid_: separate ledger, new vehicle database

**Home Branch**:
The branch administratively responsible for a vehicle; not its physical location and not automatic authority for a visiting branch.
_Avoid_: current location, GPS location

**Assigned Driver** (fr: **Chauffeur attitré**):
The Person who regularly drives a vehicle; optional, must have the Chauffeur Fonction, needs no App Access. Replaces Custodian (ADR-0010). Accountability for a vehicle comes from its Home Branch's Administrateur, not from this field.
The UI says Assigned driver / Chauffeur attitré on every screen; until the ADR-0010 migration the code still calls it custodian (`custodian_membership_id`, `CUSTODIAN_INELIGIBLE`, the `change-custodian` action) (#91).
_Avoid_: custodian, owner, responsable

**Person** (fr: **Personne**):
Someone who works for the company and appears in its records — driver, mechanic, hostess, convoyeur, manager. Listed in Personnel; may or may not have App Access.
_Avoid_: user, member, contact, staff record

**App Access** (fr: **Accès à l'application**):
The login, Role and Branch Scope that let one Person use ROUTIQ. Belongs to exactly one Person; removing it keeps the Person and all history. Stored as a membership.
_Avoid_: user account, member (in UI), second person

**Role** (fr: **Rôle**):
One of six fixed, code-defined sets of permissions a Person's App Access carries: Direction, Administrateur, Finance, Caissier, Technicien, Chauffeur (ADR-0009). Never tenant data; never encodes branches.
_Avoid_: profile, permission set, job title, chef d'agence as a role name (the Chef d'agence of the org chart holds the Administrateur role)

**Fonction**:
What a Person does on the ground — Chauffeur, Mécanicien, Hôtesse, Convoyeur, Caissier, Autre. Decides who may crew a trip or drive a vehicle; grants nothing in the app.
_Avoid_: role, job title (titles like DG or Chef de parc are free text)

**Principal**:
The internal identity that signs commands — a human's, an AI agent's or an integration's. Never shown in the UI.
_Avoid_: user, person

**Availability**:
Whether a vehicle may take on work, read from its availability intervals: **Grounded** while one is open, available otherwise. Not assessed when the maintenance module is off. Distinct from lifecycle and physical location.
_Avoid_: lifecycle status, absence of recorded problems, absence of work orders

**Grounded**:
A vehicle with an open availability interval. A safety-critical issue opens one the moment it is reported; only a release to service closes it. Resolving the issue or completing the work does not.
_Avoid_: out of service (a lifecycle word), broken down, unavailable flag

**Attention Item**:
A fact about one vehicle that needs someone's next step: an issue with no work order, work awaiting authorization or sign-off, a vehicle awaiting release, a document expired or expiring, an entry awaiting review or its paperwork. Derived on read, never stored; it names who may not take the step, not who must.
_Avoid_: task, alert, notification

**Evidence State**:
What stands behind a financial entry: supplied (a file is linked), payment reference (paid by mobile money or bank with a reference), not expected (the category needs no receipt) or not supplied (evidence missing). It says what is attached, never that anyone checked it.
_Avoid_: verified, receipt status

**Actual Cost (of a work order)**:
The sum of the work order's non-rejected cost lines, pending ones included and reversals netted. Derived on read once the work is declared complete, never typed. An amount typed by an old client at close is kept apart as the **declared cost**.
_Avoid_: final cost, invoiced amount, typed cost

**Cost Outcome**:
What the closer says about a repair's cost when completing its work order: the cost is in cost lines, it cost nothing, or the invoice has not arrived yet. Every close names one; there is no silent close.
_Avoid_: cost status, payment status

**Note**:
A free-text remark a person with App Access writes on a vehicle. Append-only: a correction is another note. Every Role may write one (ADR-0009).
_Avoid_: comment thread, description, edit

**Correction**:
What saving "Modifier" does to approved or posted money, a meter reading or stock. One command reverses the original and records the replacement, so the original stays. Lists show the current value with a "corrigé" badge; history shows the old value struck through. A changed amount goes back for approval. Users never choose between an edit and a correction; the **Edit Level** decides (ADR-0008).
Not built yet for money (#86). Today a posted entry is corrected in two steps: **Cancel entry** with the reason "wrong details", then **Record again** with the form filled in from the cancelled entry (see **Cancellation**).
_Avoid_: edit (for approved money), reversal (in the interface), void, overwrite

**Cancellation (of an entry)**:
Taking a posted entry out of the books because it should not be there. Underneath it is a reversal: the `reverse-entry` command adds a second entry whose signed postings subtract the first, and the original's status becomes `REVERSED`. The interface says **Annuler l'écriture** / **Cancel entry**: the original reads **Annulée** / **Cancelled**, and the new row reads **Annulation de l'écriture {number}** / **Cancellation of entry {number}**. The reason is one of four: entered twice, didn't happen, wrong details (to record again), or other with the person's own words (#426). A cancellation is never cancelled; to undo one, record the entry again.
_Avoid_: reverse, extourne, contre-passation (in the interface), delete, void

**Edit Level**:
Which of four things "Modifier" does, decided by the record, never by the user (ADR-0008). **Plain edit**: descriptive details (plate, make and model, chassis, a phone number) change in place with an audit event. **Free until decided**: the author changes their own pending record in place until someone approves or rejects it. **Correction**: approved money, readings and stock. **Locked**: in a locked period, the correction posts to the open period as a late posting.
_Avoid_: edit mode, correction mode (users see one action)

**Vehicle History**:
A vehicle's timeline, read as one query over the audit trail of every record that belongs to it. A view of the trail, never a ledger or an editable log.
_Avoid_: timeline ledger, activity log table

**Recorded Vehicle Expenses**:
The signed posted expenses attributed to a vehicle across the stated cost layers, period and currency; not proof of cash paid or complete ownership cost.
_Avoid_: profit, savings, total ownership cost

**Revenue** (fr: **Recettes**):
Money the company earns for its work (freight, fares), recorded as revenue entries.
_Avoid_: money in, entrées, income, sales

**Expense** (fr: **Dépense**):
Money spent to run the company, recorded as an expense entry, on a vehicle or not.
_Avoid_: money out, sorties, cost entry

**Profit** (fr: **Bénéfice**; below zero **Loss** / **Perte**):
Revenue minus expenses recorded in ROUTIQ for the period and scope on screen. Not the accountant's profit: taxes, loan repayments and depreciation are not in it. A negative profit is shown as a Loss, never as a negative profit. Shown only when the company records revenue; an Internal Fleet sees expenses and cost per km instead.
_Avoid_: contribution, margin, marge, net income, gross profit

**Vehicle Profit** (fr: **Bénéfice du véhicule**; the preset word on screen, e.g. Bénéfice du camion):
Revenue recorded on one vehicle minus the expenses recorded on it. Company Costs are never spread across vehicles, so the vehicle profits add up to more than the company's Profit.
_Avoid_: contribution, vehicle margin

**Company Costs** (fr: **Frais généraux**):
Expenses not recorded on any vehicle: office rent, office staff, phones. Company profit = the sum of Vehicle Profits − Company Costs.
_Avoid_: overheads, shared costs, indirect costs (in the UI)

**Dashboard** (fr: **Tableau de bord**) and **Overview** (fr: **Vue d'ensemble**):
The Dashboard is Home. Every module page and record page opens on an Overview tab (that page's dashboard: summary, tiles, why, To do), followed by its work tabs.
_Avoid_: driver, pilotage, cockpit

**Template Preset**:
A named bundle of terminology, categories, required fields, and custom-field definitions that shapes ROUTIQ for one kind of asset-operating business (e.g. TRUCKING, PASSENGER_TRANSPORT).
_Avoid_: theme, profile, business type (as a schema concept)

**Workspace**:
One onboarded business tenant; the isolation boundary for all data and configuration.
_Avoid_: account, organization, company (in code)

**Workflow**:
How data moves between people in a Workspace — the combination of **Approval Chains** and **Entry Roles**; always tenant data, never tenant code.
_Avoid_: process engine, state machine (workflows do NOT include lifecycle states)

**Approval Chain**:
Tenant-configured rules deciding which role must approve a command, per category, branch, and amount band.
_Avoid_: sign-off flow, validation chain

**Entry Role**:
Which role may execute which command and see which form sections at each point of a record's life.
_Avoid_: permission set, profile

**Lifecycle**:
The fixed, code-defined status sequence of a record (e.g. a trip: PLANNED → OPEN → CLOSED, or PLANNED → CANCELLED, ADR-0012); invariants hang off it. Tenants may relabel statuses, never restructure them.
_Avoid_: workflow (lifecycles are not workflows), custom status

**Planned Trip** (fr: **Trajet planifié** / **Voyage planifié**, by preset):
A trip booked for a date before it starts: the same trip record in status PLANNED, with a planned start, and a vehicle and driver that may wait. Starting it on the day sets its actual start and makes it the running trip (shown "En cours" / "In progress"); cancelling it keeps it with a reason (ADR-0012). Part of the Scheduling module.
_Avoid_: booking, reservation, order (as a separate record), draft trip

**Delivery** (fr: **Livraison**):
The recorded fact that goods were handed over on a trip: when, who received them, an optional photo of the signed note, on the trip or one of its stages. Append-only; it never changes the trip's status. A trip stays In progress until it is closed (ADR-0012).
_Avoid_: delivered status, proof of delivery (as a status), completion

**Starter Pack**:
A versioned data file of categories and approval defaults for one Template Preset, replayed through ordinary commands when a Workspace is provisioned — never applied retroactively to existing Workspaces.
_Avoid_: seed script, fixture (packs go through the command pipeline; fixtures bypass it)

**Provisioning**:
The vendor-only act of creating a Workspace: workspace + its branches (one or many) + admin user + module flags + enabled presets + starter pack replay, as one audited command. Tenants never provision.
_Avoid_: signup, self-service onboarding

**Vendor Operator**:
The software vendor's own principal — no workspace binding, accepted only by provisioning and platform commands, invoked via CLI. Never a tenant user; never used for tenant business commands.
_Avoid_: super admin (implies an in-app tenant role), root user

**Branch**:
An operating location of a Workspace (fr: **Agence**); every operational record belongs to exactly one. Deactivated, never deleted; codes are immutable. Both code and name identify a Branch uniquely within its Workspace — codes never change, names may be renamed but never collide.
_Avoid_: site, location, department, git-style branch

**Branch Scope**:
The set of Branches a user's membership grants access to — the server-derived authorization boundary. Reads and commands can never reach outside it; the client never chooses it.
_Avoid_: branch filter, current branch

**Ambient Branch**:
The single Branch a user is currently viewing through, chosen in the shell switcher — a client-side lens that narrows collections *within* their Branch Scope. Never an access boundary: switching grants nothing, and record identity stays workspace-scoped. It narrows collections and their filters only — never what a command may reference, and never attention signals (badges count the whole Branch Scope).
_Avoid_: active branch, selected branch (implies per-screen state), branch scope

**Module Entitlement**:
The vendor-granted right of a Workspace to use a module (maintenance, stock, …). Platform-scope: only the Vendor Operator changes it (ADR-0005); tenants see it read-only. Distinct from an Entry Role, which governs who *within* an entitled Workspace may act.
_Avoid_: feature flag (implies tenant- or dev-toggleable), plan/tier (no billing model yet)

## Relationships

- A **Workspace** belongs to exactly one **Asset-Operating Business**
- A **Workspace** enables one or more **Template Presets**; forms and commands accept only enabled ones
- Every asset and activity stamps the single **Template Preset** it was created under
- A **Workspace** has one or more **Branches**; a user's **Branch Scope** is a subset of them, and the **Ambient Branch** is always one Branch within that scope (or none = whole scope)

## Example dialogue

> **Dev:** "A retail store wants to sign up — which **Template Preset** do we give them?"
> **Domain expert:** "Its delivery vehicles can be an **Internal Fleet**. Its retail inventory and sales business are outside ROUTIQ's scope; fleet support does not make ROUTIQ a retail system."

## Flagged ambiguities

- **Categories (resolved 2026-07-30):** categories are runtime tenant data edited through audited commands (create / relabel / deactivate — never delete, records reference codes). Seeded per enabled preset via **Starter Packs**, not one flat union list.

- **Scope (historical 2026-07-29, refined by the internal-fleet direction):** the original profit-center-only test excluded a store. The current boundary admits a company's operated fleet without admitting its retail/inventory business. The refusal of configurable entities and a general business engine remains.
- **"Workflow" (resolved 2026-07-29):** pinned to **Approval Chains** + **Entry Roles**, both tenant data. **Lifecycles** (status machines) stay fixed code with configurable labels — per-tenant state machines are the refused configuration engine.
- **Template binding (resolved 2026-07-29; server enforcement shipped 2026-07-30):** a Workspace enables a SET of Template Presets (mixed fleets are real in Cameroon); single-preset tenants see single-preset UX. Enforced server-side like module flags — `workspace_templates` rows written at Provisioning, checked in the command pipeline (`PRESET_DISABLED`). Workspaces with zero rows (pre-provisioning pilots) are grandfathered all-enabled with a `preset.unenforced` warning until backfilled. Remaining gap: web UX still shows both presets to single-preset tenants.
- **Roles and people (resolved 2026-09-27; roles built 2026-10, people not yet):** six fixed Roles named in the pilot team's words replace ADMIN/OPS_MANAGER/FIELD_SUBMITTER/MAINTENANCE/FINANCE_APPROVER/EXECUTIVE_VIEWER (ADR-0009). Persons and App Access stay separate records shown as one Personnel list; every App Access belongs to one Person; Custodian becomes Assigned Driver (ADR-0010). Feature map: [roles and access](docs/reference/roles-and-access.md).
- **Vehicle workspace terms (2026-09-25):** Grounded, Attention Item, Evidence State, Note and Vehicle History, and the refined Custodian and Availability, describe behaviour implemented on `feat/maintenance-on-develop` (#44), not yet merged to `develop`. See [the vehicle workspace reference](docs/reference/vehicle-workspace-v1.md).
- **Planned trips and delivery (decided 2026-10-08, not built):** a booking is the trip record in status PLANNED, not a second record; delivery is a fact, not a status; drivers see the trip price only when the company turns it on (ADR-0012, #332, #344).
- **Money words and dashboards (decided 2026-10-10):** the UI uses Revenue, Expense, Profit / Loss, Vehicle Profit and Company Costs only; "contribution", "margin" and Entrées/Sorties go. Home is the Dashboard and every page opens on an Overview tab; the summary sentence on an Overview is a closable notice on a company-set schedule (`docs/design/consistency/dashboards.html`).
- **Terminology variance (resolved 2026-07-29):** a tenant's words come from its enabled **Template Presets** (preset-level string overlays merged over base locale) plus its own category labels. Per-tenant renames of UI terms are NOT built — market survey: 4 of 5 mature vertical SaaS offer at most a two-value toggle. Revisit only if a paying tenant refuses the preset's word.
