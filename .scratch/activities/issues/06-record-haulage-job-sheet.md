# 06 — record-haulage-job-sheet.v1 (composite)

Status: ready-for-agent
Blocked by: 04

## Task

Sibling of issue 05, haulage/trucking flavour. Can run in parallel with 05 once 04 lands — coordinate: whichever lands second rebases on the first's shared composite helpers.

## Requirements

- Same composite semantics as issue 05 (one transaction, composed contracts, idempotency, money rules) — extract shared composite-sheet machinery rather than copy it if 05 already landed; otherwise build it here and 05 reuses.
- Haulage-specific payload: load/cargo description, load state on legs, trailer segment (role TRAILER) alongside PRIMARY tractor per §3.2.
- Template variance is DATA not code (§3.3): required-field differences between journey and haulage sheets come from category presets / required-field lists, not divergent hardcoded schemas — check `category-presets.ts` and `templates.ts` and follow the mechanism.
- Tests: tractor+trailer segments, cargo legs, financial attribution, idempotent retry.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] New vitest files pass
- [ ] No duplicated composite logic between 05 and 06 handlers
