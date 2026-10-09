# Handoff: UI consistency and product direction (2026-10-04)

For the next session, which will break this direction down into GitHub issues and build them, starting before Wednesday 2026-10-07.

## State

- Branch `docs/ui-consistency-direction`, made from `develop@6399529`, holds `docs/design/consistency/` and the "Product direction" section in `AGENTS.md` (commit "docs: UI consistency system and product direction"). Issues link to the files on that branch.
- Open `docs/design/consistency/index.html` in a browser. The rules are in `README.md`.
- Owner decisions (2026-10-04):
  - **Theme:** neutral. The company logo and accent colour are customisable; "powered by ROUTIQ" stays.
  - **Everything else in `choices.html` is accepted as recommended:**
    - every record uses the vehicle-workspace shell
    - forms open in the side panel by default; dialogs only for decisions
    - six fixed form layouts
    - submit button always last
    - long forms become steps on phone
    - sidebar C, with Money as one place
    - phone bottom bar per role
    - coming-soon features shown in context
    - overview strips on every list
  - **`platform.html` recommendations accepted:**
    - customers are accounts plus individuals; passengers stay out until ticketing
    - Parcels is on by default for bus
    - the CRM part stays light
    - build Customers first among the new modules
  - **Direction requests:**
    - Scheduling (Planning tab inside Trips, a month calendar, the driver's calendar and trip status)
    - core vs modules, plug in and out
    - a platform console on a `console.` subdomain with module toggles
    - company settings (logo, accent colour)
    - the feature map as the source of truth
    - UI scoped by role
- Evidence from the owners' Loom videos (another product's tutorials) is kept **outside the repo**, because of the project-scoped names rule: `~/Developer/routiq-worktrees/_evidence/loom-2026-10-04/`.

## Verified facts that shape the issues

Re-checked 2026-10-04 on `origin/develop`, which is still `6399529` (no merges since the audit), so every file:line below holds. Changes since the first write-up:

- #127 (language lost on reload) is fixed on develop by #141: language is now a device preference in `localStorage` (`routiq-language`). Storing it on the account (epic 7) is still new work. The issue stays open until develop is released to main.
- #126 (Details breadcrumb) is fixed on develop by #142; trip routes still have no trail.
- The roles ADRs on `docs/roles-and-access` are numbered 0008 and 0009, but develop already has ADR-0008 (edit and correct). They land as ADR-0009 (six roles) and ADR-0010 (one person list).
- Open issues that overlap the epics and get linked, not duplicated: #70 (role-forbidden truck actions), #59, #103, #118, #121 (read gates), #40 (read-only executive; superseded by the roles decision), #91 (custodian → driver), #137 (branch switcher cut off), #136 (Base UI nativeButton errors), #143 (closed wording), #99–#101 (payments, receivables, customers).


- Trip statuses are `OPEN` and `CLOSED` only, and `create-activity` requires `startedAt`. Scheduling needs a lifecycle change (needs an ADR).
- `enable-module` / `disable-module` run as tenant `ADMIN` (`apps/api/src/commands/module-toggle.ts:29`). ADR-0005 says they must be platform scope; this is not implemented.
- `set-template-preset` runs as tenant `ADMIN`.
- These are backend only, with no screen: categories (`create-category`, `relabel-category`, `deactivate-category`, `reactivate-category`), `update-approval-threshold`, `provision-workspace` (platform scope, CLI at `apps/api/scripts/provision.ts`), and `create-activity`.
- The six team roles (Direction, Administrator, Finance, Cashier, Technician, Driver) were decided on 2026-09-27 but are not in the code. The code still has `ADMIN`, `OPS_MANAGER`, `FIELD_SUBMITTER`, `MAINTENANCE`, `FINANCE_APPROVER`, `EXECUTIVE_VIEWER`. The docs are on branch `docs/roles-and-access` (uncommitted, in another worktree).
- The customer on a trip is free text (`customerName`). "Party" is named in ARCHITECTURE.md but has no table.
- Bugs found by the audit:
  - approvals rows can't be opened before deciding
  - trip routes have no breadcrumb trail
  - money signs disagree (+ in Finance, − on trip detail)
  - the same status shows in different colours on different screens
  - primitives default to 28–32 px
  - 17 native date inputs remain
  - the Trucks overview says "Attention 0" while VH003 is grounded
  - pages are wider than the screen on phone (Maintenance, People)
  - #64: the sidebar shows Finance to roles that can't read it
  - #55: the Approvals date column shows the submission date

## Proposed issue breakdown (build order)

Each epic is a parent issue with slices underneath. Every slice is one PR with a walkthrough video, and updates the feature map.

1. **Foundation: roles.** Six team roles: `allowedRoles`, approval defaults with backfill, read gates, i18n, seed. Unblocks role-scoped UI.
2. **Foundation: bugs and guards** (`audit.html#order`, slices 1–7):
   - approvals rows open the entry
   - breadcrumbs for every route
   - 44 px primitives with a guard
   - one status badge per domain
   - command labels, destructive tone, submit always last
   - toasts for branches and users
   - date pickers replacing the native inputs, with a guard
   - money sign rule
   - Trucks "Attention" count
   - phone overflow
   - #64, #55
3. **Foundation: system pieces:**
   - field kit, `useCommandForm` and the form test harness (slice 8)
   - side panel as the default create surface (slice 9)
   - phone list rows in the DataTable
   - `MetricStrip` everywhere (slice 10)
4. **Navigation:**
   - sidebar C, with groups and role filtering driven by data
   - Money as one place: approvals become a view, `/finance/approvals` redirects, Periods move to Company → Accounting months
   - name menu with My settings; the More page goes
   - phone bottom bar
5. **Module manifest:** one manifest per existing module (nav rows, tabs, Home cards, commands, reads, roles, off-state test) replacing the scattered flag checks. Port `features/catalog.ts` and its test from `feat/brand-identity` as the feature map.
6. **Scheduling module:**
   - ADR for the PLANNED and CANCELLED statuses. No DELIVERED status: delivery is a recorded fact (decided 2026-10-08)
   - `plan-trip`, `assign-trip`, `reschedule-trip`, `cancel-planned-trip`, `start-planned-trip`
   - planning read
   - Book a trip
   - Trips → Planning tab with week and month views and the day panel
   - Home "Planned this week" card
   - driver's My schedule, My calendar and trip status line
   - later: bus timetable
7. **Company settings:**
   - `workspace_settings`, logo upload (S3), accent colour applied through tokens
   - screens for Approvals and Categories (backend already exists)
   - language stored on the account (#127)
8. **Platform console** (`console.` subdomain; the host is configuration, not code):
   - move module and preset commands to platform scope (ADR-0005)
   - operator sign-in with a second factor
   - pages: Tenants, Tenant (module toggles), Set up a tenant wizard over `provision-workspace`
   - health reads
   - support access with tenant consent
9. **Customers module:**
   - Party ADR
   - accounts and individuals, rates, contacts, notes, follow-ups, complaints
   - customer link and rate prefill on trips
   - receivables ADR, then "what they owe"
10. **Parcels module** (when a bus tenant signs). **Stock module** (when a workshop asks; decisions in #27). **Partners** (later; needs an ADR).

Realistic for Wednesday: epic 1 and the epic 2 bug slices. Epics 3–5 are the next block. Scheduling (6) is the first new module.

## Owner decisions (2026-10-08)

- **Trip price for drivers:** hidden. The company setting "Show trip price to drivers" is off by default. When the driver collects cash from the customer, that trip shows "Amount to collect".
- **Console domain:** `console.` on the product domain, read from configuration. Until a ROUTIQ domain is bought, it sits beside the demo host (wiring lives in the box env files, not the repo). The console must run under any host name, because on-prem installs need one too.
- **Stock:** receipts only for the pilot; no purchase orders. The supplier invoice is an expense in Money and uses the existing approval thresholds. Adjustments are approved by someone other than the counter (#27). Fuel is not stock; a company's own tank becomes a magasin holding litres in a later slice.
- **Prices and billing:** none in the console. ROUTIQ invoices by hand; revisit at about 3 to 5 paying companies. Candidate shape for that day: a base price per active vehicle per month, modules as add-ons.
- **Delivered:** not a status. Trips stay Planned → In progress → Closed (or Cancelled). Recording delivery stores the time, who received it and an optional photo on the trip or its last stage. Revisit only if the receivables ADR needs a "delivered, not invoiced" queue.

Still to ask the owners: do drivers ever collect cash, does either pilot company own a fuel tank, and will they buy a ROUTIQ domain?

## Files

| File | Use |
|---|---|
| `README.md` | All rules in text |
| `choices.html` | The 10 decisions and the owner's picks |
| `audit.html` + `audits/*.md` | Audit findings, fix order, raw reports |
| `pages.html`, `insights.html`, `forms.html`, `form-layouts.html`, `sidebar.html` | Consistency system |
| `platform.html`, `modules.html`, `scheduling.html`, `vendor.html`, `settings.html`, `stock.html` | Product direction and new modules |
| `featuremap.html` | What exists vs what doesn't |
| `kit.css`, `kit.js` | Mockup kit (tokens, logo, sidebar per role) |
