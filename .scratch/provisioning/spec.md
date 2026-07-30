# Workspace provisioning — `provision-workspace.v1`

Research item 1 (`docs/research/2026-07-29-per-tenant-configurability.md` § Recommendations): promote the seed bundles to a real provisioning command. Decisions locked in ADR-0004 and CONTEXT.md (Provisioning, Vendor Operator, Starter Pack terms).

## Goal

A production path that creates tenant #3 without running test code or hand-writing SQL. One audited command — `provision-workspace.v1` — through the existing dispatcher under a vendor-operator principal, invoked from a CLI on the server/appliance. The seed inherits idempotency, receipts, audit and `created_by_command_id` for free.

End state: `pnpm --filter @routiq/api provision --file tenant3.json` creates workspace + first branch + admin user (username/PIN) + enabled template presets + starter-pack categories and approval rules, atomically, with a command receipt. Running it twice with the same idempotency key replays the receipt.

## Current state (verified 2026-07-30)

- `presetCategories()` (`apps/api/src/commands/category-presets.ts`) and `defaultApprovalRules()` (`apps/api/src/commands/approval-defaults.ts`) are correct but called only from `src/test/seed.ts` and `scripts/seed-dev.ts` — direct inserts, no command, `created_by_command_id` null.
- `presetCategories()` is one flat list mixing trucking and passenger rows; no pack split.
- Auth is fully workspace-bound: `AuthContext` requires `workspaceId`/`membershipId`/`role`/`branchScope`; `resolveAuthContext` 401s without a membership. `principals` is the only workspace-free table — a vendor operator has no representation yet.
- The dispatcher pipeline (role → payload → branch auth → module check → idempotency → approval → receipt → execute) assumes `ctx.workspaceId` exists and wraps execute in `inWorkspace` RLS. `provision-workspace` creates the workspace *inside* execute — the pipeline needs a platform-command variant.
- `workspace_templates` does not exist (table or code). `TEMPLATE_CODES` = TRUCKING, PASSENGER_TRANSPORT in `packages/contracts/src/templates.ts`.
- No CLI entry points; `scripts/seed-dev.ts` is the embryo (`.scratch/onboarding/issues/01-starter-packs.md` says generalize it, don't parallel it).

## Scope

1. **Contracts + schema**: `provision-workspace.v1` payload schema; `workspace_templates` table (same shape as `workspace_modules`: workspace, presetCode, enabled, updatedByCommandId, rowVersion).
2. **Platform-command seam**: vendor-operator principal (workspace-free, accepted only by platform commands) + a dispatcher path for commands that have no workspace until execute runs. Same restricted-principal seam ARCHITECTURE.md §7 plans for AI.
3. **Starter packs as versioned data files**: split `presetCategories` into shared-core + per-preset packs (trucking, passenger); approval defaults stay one shared pack. Each pack carries a version.
4. **Handler**: composite execute — workspace, branch, admin principal/membership/credential, `workspace_templates` rows, pack replay for each enabled preset. All rows stamped `created_by_command_id`.
5. **CLI**: `scripts/provision.ts` dispatching in-process (DB access = vendor access; no HTTP surface). Rewrite `seed-dev.ts` on top of it.
6. **Preset enforcement**: sheet/asset commands reject `templateCode` not enabled for the workspace (closes the known gap flagged in CONTEXT.md).

## Non-scope

- Seed-origin side table `(bundle_code, bundle_version, seed_key)` — research item 2, separate effort.
- Runtime category commands (create/relabel/deactivate) — research item 3. Until they exist, pack replay is direct inserts inside the provision transaction (stamped with the provision command id), not sub-command replay. Revisit when item 3 lands.
- Pack updates applied to existing workspaces — ADR-0004: insert-only, future workspaces only.
- Branding fields, CSV fleet import, accompaniment — `.scratch/onboarding/spec.md` steps 6–8; that spec predates ADR-0004, its steps 1–5 are superseded by this one.
- Hosted admin UI / self-service signup — provisioning is vendor-only by decision.
- Any HTTP route for platform commands — CLI-only until a control plane is actually needed (Microsoft <10-tenants guidance).

## Authoritative references

- ADR-0004 (`docs/adr/0004-per-tenant-configurability-model.md`) — preset sets, starter packs, vendor-only provisioning.
- CONTEXT.md — Provisioning, Vendor Operator, Starter Pack, Template Preset definitions; template-binding gap.
- Research doc § Recommendations 1 (this), 2–3 (explicitly out).
- ARCHITECTURE.md §6a (appliance cold start — CLI must work on the box), §7.2 (restricted principal seam).
- Dispatcher checklist comment `apps/api/src/commands/dispatcher.ts:77-89`.

## Ordering

01 contracts+schema → 02 platform seam → 03 packs (∥ 02) → 04 handler → 05 CLI → 06 enforcement (∥ 05)

## Open questions

- `registry.test.ts` asserts every registered command has an approval-defaults entry; approval rules are per-workspace so a platform command can't have one. Issue 02 decides the exemption shape (likely: platform commands skip `evaluateApproval` and the registry invariant).
- Module flags: absent-means-enabled today. Provision payload may list modules to disable; writing explicit enabled rows for all modules is deliberately NOT done (keeps current semantics). Flag in review if this feels wrong.
- Operator credential shape: issue 02 proposes; CLI-on-the-box with `DATABASE_URL` may be sufficient identity for now (the operator principal row still exists for provenance), since anyone with the DB URL already owns the data.
