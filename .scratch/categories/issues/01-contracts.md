# 01 — Contracts for category + preset-toggle commands

Status: resolved

## Task

Five payload schemas in `packages/contracts/src/commands/`, mirroring `module-toggle.ts` shape (z.strictObject, command wrapper with name/version literals, inferred types, barrel export, sibling tests).

## Requirements

- `category.ts` (one file, four commands, shared base like module-toggle's pattern):
  - `create-category.v1`: `{ id: z.uuid(), kind: <categories kind enum — mirror the schema's values>, code: uppercase-snake regex (match existing codes like DRIVER_ALLOWANCE: `/^[A-Z][A-Z0-9_]*$/`, max ~40), labelFr: min 1, labelEn: min 1, profitabilityLayer?: ..., evidencePolicy?: ... (optional, same enums the categories table uses — read schema.ts) }`
  - `relabel-category.v1`: `{ categoryId: z.uuid(), labelFr, labelEn }` — labels only, code immutable (records reference codes as text).
  - `deactivate-category.v1` / `reactivate-category.v1`: `{ categoryId: z.uuid() }`
- `set-template-preset.ts`: `{ presetCode: z.enum(TEMPLATE_CODES), enabled: z.boolean() }`
- Envelope `expectedVersion` already exists on commandEnvelope — nothing extra for optimistic concurrency.
- Kind/layer/policy enums: single source — if the values only live in the Drizzle schema today, lift them into contracts (like MODULE_CODES) and have schema.ts import them; do NOT duplicate string lists in two places.
- Tests: valid payloads parse; bad code (lowercase, spaces), missing label, unknown kind, unknown preset rejected.

## Acceptance

- [ ] `pnpm typecheck` (schema.ts compiles against any lifted enums)
- [ ] `pnpm --filter @routiq/contracts test` green

## Comments

2026-07-30 — Done (codex worker cat-01 + review). categories.ts (CATEGORY_KINDS / PROFITABILITY_LAYERS / EVIDENCE_POLICIES lifted from Drizzle schema — schema.ts now imports them, single source), category.ts (four commands), set-template-preset.ts, tests, barrel exports. Verified: typecheck 4/4, contracts 128 tests green.
