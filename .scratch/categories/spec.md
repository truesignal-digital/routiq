# Runtime category commands + preset toggle

Roadmap item 3 (ADR-0004, research rec 3): categories become runtime tenant data edited through audited commands — create / relabel / deactivate, never delete. Plus `set-template-preset.v1`, the missing writer for `workspace_templates` on existing workspaces (backfill path that lets the grandfather rule die).

## Goal

A tenant admin can add a category ("PEAGE_BEACH", "COMMISSION_AGENCE"), fix a label, and retire one — through the command pipeline, audited, offline-refused (decisions, not facts). Categories carry nearly all per-customer vocabulary (research: Fleetio Vehicle Types, ServiceTitan Trades, Odoo fleet states — all full-CRUD tenant rows keyed by code).

## Scope

1. **Contracts**: `create-category.v1`, `relabel-category.v1`, `deactivate-category.v1`, `reactivate-category.v1`, `set-template-preset.v1`.
2. **Category handlers**: four thin workspace commands over the existing `categories` table.
3. **Preset toggle handler**: mirror of `enable-module`/`disable-module` over `workspace_templates`, with grandfather materialization semantics (below).
4. Approval defaults + `COMMAND_QUEUEABILITY` entries (all five are decisions — never queued offline), locale strings for any new error codes.

## Non-scope

- Category management UI (More → Manage screen) — commands first; UI is a follow-up effort.
- Converting provision's pack replay to command replay — becomes possible after this; separate change when touched next.
- Read-route changes — pickers already read categories; inactive filtering exists via `active`.
- Deleting the grandfather rule — happens only after pilot tenants are backfilled (ops step, issue 03 checklist).

## Design decisions (grilled against ADR-0004 / research)

- **Reactivate exists from day one.** ADR names three verbs, but never-delete + unique `(workspace_id, kind, code)` means a deactivated code permanently blocks re-creation; archives must be reversible (Fleetio's are). Reactivate is the honest fourth verb, not a scope creep.
- **Code is immutable.** Relabel changes `labelFr`/`labelEn` (and `profitabilityLayer`/`evidencePolicy`? No — labels only; layer/policy changes are a different, rarer decision — deferred until a tenant asks). Records reference codes as plain text; renaming a code would orphan them.
- **Grandfather materialization**: the FIRST `set-template-preset` against a zero-row workspace writes explicit rows for ALL `TEMPLATE_CODES` — the target as requested, the others `enabled=true` — so ending grandfathering never silently disables the other preset mid-flight. Subsequent calls update one row.
- **Last-preset guard**: disabling the only enabled preset is refused (stable error) — a workspace with zero enabled presets can record nothing and renders nothing.
- **No new tables, no migrations expected** (categories + workspace_templates GRANTs already cover INSERT/UPDATE).

## References

- Pattern to mirror: `apps/api/src/commands/module-toggle.ts` (+ contract `packages/contracts/src/commands/module-toggle.ts`) — before/after audit, ADMIN role, workspace branchAuthorization.
- `categories` schema: `apps/api/src/db/schema.ts` (~:290) — kind enum, code, labels, layer/policy, `active`, `createdByCommandId`, unique (ws, kind, code).
- `workspace_templates`: schema ~:223; enablement rule `apps/api/src/templates/registry.ts`.
- Registry invariants (`registry.test.ts`): every workspace command needs an approval-defaults row + a COMMAND_QUEUEABILITY entry.
- Dispatcher checklist comment `dispatcher.ts` (~:77): contract file, handler + server.ts import, approval default, GRANTs.

## Ordering

01 contracts → 02 category handlers ∥ 03 preset toggle
