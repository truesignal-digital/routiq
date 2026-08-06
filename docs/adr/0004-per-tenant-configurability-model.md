# Per-tenant configurability: enabled preset sets, config-as-data, no engine

A workspace enables a SET of template presets (`workspace_templates`, same shape
as module flags) rather than binding to exactly one or letting users pick per
record. Mixed fleets (trucks + buses in one business) are real in Cameroon, so
one-preset-per-workspace would force split books; the current no-binding state
shows every tenant the other business type's complexity. Sheet commands reject
non-enabled presets server-side (checked in the pipeline like modules); a
single-preset workspace gets single-preset UX with no template picker.
(Decided 2026-07-29.)

The rest of the configurability model, decided in the same session against
`docs/research/2026-07-29-per-tenant-configurability.md` (survey of Fleetio,
Samsara, ServiceTitan, Jobber, Odoo, Salesforce, ServiceNow + AWS/Azure
first-party guidance):

- **Workflow = approval chains + entry roles, both tenant data.** Lifecycles
  (status machines) stay fixed code with configurable labels — per-tenant state
  machines are the configuration engine §13 refuses. Approval rules stay a
  flat, first-match-wins table; if chains are ever needed, add `step_order`
  (Salesforce/SAP/Odoo all model approvals as ordered lists) — never a graph.
  Rules are business-readable, not tenant-writable: engineers edit them.
- **Terminology is preset-level, not tenant-level.** Each preset ships a sparse
  string overlay merged over the base locale (fr-CM → fr → en, first hit wins,
  keyed by symbolic id never source text). Per-tenant renames are not built:
  four of five surveyed competitors offer at most a two-value toggle. Category
  labels (already per-workspace rows) carry the real tenant vocabulary.
  Implemented 2026-08-06: the overlays live in `apps/web/src/i18n/presets/`
  (one sparse file per preset per locale, merged over the base catalog at
  runtime), and they apply only when a workspace has exactly one preset
  enabled — a mixed fleet keeps the base vocabulary, because it must not be
  told its buses are camions.
- **Categories are runtime tenant data** edited via audited commands
  (create / relabel / deactivate — never delete; records reference codes as
  plain text). Seeded per enabled preset via starter packs.
- **Starter packs are versioned data files replayed through ordinary commands**
  at provisioning (Odoo industry-pack pattern). Insert-only; pack updates
  affect future workspaces only; existing tenants change via the same admin
  commands, never re-replay.
- **Provisioning is vendor-only via CLI + operator principal**, not a
  super-admin UI. `provision-workspace.v1` runs through the dispatcher under a
  vendor-operator credential (no workspace binding, accepted only by platform
  commands — same restricted-principal seam §7 plans for AI). Rationale:
  Microsoft's <10-tenants guidance (scripts now, the script becomes the control
  plane later) and on-prem topology B, where the appliance needs cold-start
  provisioning without a hosted panel.

Rejected: metadata-driven/configurable entities (Salesforce-style — justified
only at tens of thousands of tenants; at tens, real Postgres columns and
migrations win), workflow graph engines (built for cross-service orchestration
at scale, not approval variance), tenant-writable rule editors (Fowler's
COBOL inference; every vendor's own postmortems). Scope guard: ROUTIQ onboards
asset-operating businesses only (see CONTEXT.md) — a retail store is a second
product, not a configuration.
