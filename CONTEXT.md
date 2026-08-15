# ROUTIQ

Asset lifecycle & profitability platform for businesses whose profit centers are operated assets. Onboards asset-operating businesses only — variance between them is configuration, never new entities.

## Language

**Asset-Operating Business**:
A business whose profit centers are expensive operated assets (trucks, buses, machinery) that perform activities consuming costs and generating revenue.
_Avoid_: "any business", "client vertical"

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
The fixed, code-defined status sequence of a record (e.g. activity DRAFT → OPEN → CLOSED → LOCKED); invariants hang off it. Tenants may relabel statuses, never restructure them.
_Avoid_: workflow (lifecycles are not workflows), custom status

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
An operating location of a Workspace (fr: **Agence**); every operational record belongs to exactly one. Deactivated, never deleted; codes are immutable.
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
> **Domain expert:** "None. A store's profit center is inventory, not operated assets — it is not an **Asset-Operating Business**, so it is out of scope. We don't configure our way there."

## Flagged ambiguities

- **Categories (resolved 2026-07-30):** categories are runtime tenant data edited through audited commands (create / relabel / deactivate — never delete, records reference codes). Seeded per enabled preset via **Starter Packs**, not one flat union list.

- **Scope (resolved 2026-07-29):** "we could onboard a store" was floated — resolved: ROUTIQ onboards **Asset-Operating Businesses** only. A store fails the test; serving it would require configurable entities (the refused configuration engine, ARCHITECTURE.md §13).
- **"Workflow" (resolved 2026-07-29):** pinned to **Approval Chains** + **Entry Roles**, both tenant data. **Lifecycles** (status machines) stay fixed code with configurable labels — per-tenant state machines are the refused configuration engine.
- **Template binding (resolved 2026-07-29; server enforcement shipped 2026-07-30):** a Workspace enables a SET of Template Presets (mixed fleets are real in Cameroon); single-preset tenants see single-preset UX. Enforced server-side like module flags — `workspace_templates` rows written at Provisioning, checked in the command pipeline (`PRESET_DISABLED`). Workspaces with zero rows (pre-provisioning pilots) are grandfathered all-enabled with a `preset.unenforced` warning until backfilled. Remaining gap: web UX still shows both presets to single-preset tenants.
- **Terminology variance (resolved 2026-07-29):** a tenant's words come from its enabled **Template Presets** (preset-level string overlays merged over base locale) plus its own category labels. Per-tenant renames of UI terms are NOT built — market survey: 4 of 5 mature vertical SaaS offer at most a two-value toggle. Revisit only if a paying tenant refuses the preset's word.
