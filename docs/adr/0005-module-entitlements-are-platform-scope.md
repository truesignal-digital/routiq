# Module entitlements are platform-scope, not tenant-toggleable

A workspace's module flags (`workspace_modules`) are **entitlements the vendor
grants**, not preferences the tenant sets. `enable-module.v1` /
`disable-module.v1` move from `allowedRoles: ["ADMIN"]` to **platform scope**:
executed only by the Vendor Operator principal (the same workspace-free seam
`provision-workspace.v1` uses), invoked via CLI, never from tenant UI. The
tenant admin sees a read-only "your modules" view; changing it is a
conversation with the vendor, not a toggle. (Decided 2026-07-30.)

Why:

- §3.3a names these *entitlements*. They gate whole paid capability areas
  (maintenance, stock, …). A tenant-facing enable switch lets a tenant
  self-grant what is effectively a commercial term — wrong authority, even
  before billing exists.
- At pilot scale (two tenants, vendor operates the platform) every module
  change is already a vendor decision. Platform scope encodes the practice we
  actually have; a tenant toggle would encode one we don't.
- The command pipeline already has the seam: platform-scope commands with a
  non-member actor, receipts and audit events carrying `scope = 'PLATFORM'`
  and a generated null `tenant_actor_principal_id`. This ADR reuses it
  unchanged — no new mechanism.

The rejected alternative — two layers, where the vendor sets an entitlement
ceiling and the tenant may disable within it ("paid for stock, not using it
yet") — is deferred, not refused. It is purely additive later: keep
platform-scope entitlement rows as the ceiling and add a tenant-scoped
visibility flag beside them. Nothing in this decision has to be undone.

Consequences:

- The module-check pipeline stage (§3.3a) is unaffected — it reads
  `workspace_modules` the same way regardless of who wrote the row.
- Tenant-facing reads expose module state read-only (the workspace/me read);
  no tenant-facing module mutation route exists.
- The vendor CLI (`scripts/provision.ts` family) grows a module toggle
  entry point; until then, module changes ride the same in-process dispatch
  path provisioning uses.
