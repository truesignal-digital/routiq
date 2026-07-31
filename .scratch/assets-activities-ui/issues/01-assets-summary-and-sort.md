# 01 — `/v1/assets/summary` read + assets sortFields

Status: ready-for-agent

## Task

Two api/contracts changes the new assets screen needs. Mirror existing read conventions (ADR-0003 list contract, `apps/api/src/reads/assets.ts`, cursor.ts sort-in-cursor).

## Requirements

- **Summary read**: `GET /v1/assets/summary` — counts by lifecycle bucket computed in SQL over the caller's workspace (branch scope respected like the list read). Response shape in `packages/contracts/src/reads/assets.ts`: `{ total, inService, attention, outOfService? }` — derive the bucket definitions from what `AssetsStub` uses today (`summarizeAssets` / STATUS_TONES: which lifecycle statuses count as "attention") so the strip's numbers keep their current meaning, just computed correctly. Module-gate ASSETS like the list read.
- **sortFields** for the assets list read: `assetCode` (asc/desc) via the same declared-sortFields + sort-in-cursor scheme activities uses (mismatched replay = 400). Default sort stays whatever it is today.
- Tests: summary counts across >1 keyset page (proves the aggregate beats loaded-pages counting); branch-scoped member sees scoped counts; sort replay with mismatched cursor → 400.

## Acceptance

- [ ] `pnpm typecheck` && full `pnpm --filter @routiq/api test` green
- [ ] Contracts test for the new response schema
