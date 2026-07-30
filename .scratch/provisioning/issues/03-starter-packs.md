# 03 — Starter packs: versioned data files per preset

Status: resolved
Blocked by: 01

## Task

Split the flat seed bundles into versioned starter packs, one per template preset plus a shared core. Pure data reshaping — no dispatcher work.

## Requirements

- New module, e.g. `apps/api/src/provisioning/packs/` — packs are TypeScript data files (typed, reviewed, versioned in git; JSON adds parsing for zero benefit at two packs): `core.ts` (categories every workspace gets + `defaultApprovalRules` content), `trucking.ts`, `passenger-transport.ts`.
- Each pack: `{ code, version: 1, categories: [...], approvalRules?: [...] }`. Splitting the current `presetCategories()` list (`apps/api/src/commands/category-presets.ts`): TRUCK/TRAILER, FREIGHT_REVENUE, HAULAGE_JOB, LOADING → trucking; BUS/VAN, TICKET_REVENUE, SCHEDULED_JOURNEY, CHARTER, CREW_ALLOWANCE → passenger; the rest (FUEL, REPAIRS, INSURANCE, PARKING, TOLLS, DRIVER_ALLOWANCE, document types) → core. Use judgment where ambiguous and record the split in Comments; the invariant is: union(core + both packs) == today's list, no row lost or duplicated.
- Insert-only by design (ADR-0004): pack content is applied at provisioning; bumping a version affects future workspaces only. No update/replay machinery in this issue.
- `presetCategories()` and `defaultApprovalRules()` become thin composition over packs (or re-export) so `test/seed.ts`, `seed-dev.ts` and `registry.test.ts` keep working unchanged this issue.
- Test: the union invariant above, plus every approval-defaults entry still present.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] Union/no-loss test passes; existing api test suite green (seed callers unaffected)

## Comments

2026-07-30 — Done (codex via impl-01 + review). apps/api/src/provisioning/packs/{core,trucking,passenger-transport}.ts + packs.test.ts; category-presets.ts / approval-defaults.ts now thin composition. Split: core 8 (doc types + shared expenses), trucking 5 (TRUCK, TRAILER, FREIGHT_REVENUE, HAULAGE_JOB, LOADING), passenger 6 (BUS, VAN, TICKET_REVENUE, SCHEDULED_JOURNEY, CHARTER, CREW_ALLOWANCE); union invariant tested. Review pass 2: pack entry types are Omit<..., "workspaceId"> — no sentinel rows, wrappers inject. typecheck green; packs + registry tests pass; full api suite passed pre-Omit refactor (339).
