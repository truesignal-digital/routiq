# 01 — Contract payload + `workspace_templates` schema

Status: resolved

## Task

Two independent pieces the rest of the effort builds on: the `provision-workspace.v1` payload schema in contracts, and the `workspace_templates` table.

## Requirements

**Contract** — `packages/contracts/src/commands/provision-workspace.ts`, mirroring the existing command-file shape (see `module-toggle.ts`; use `z.strictObject`):

- `provisionWorkspacePayload`: workspace `{ slug, name, defaultCurrency?, timezone?, defaultLocale? }` (defaults XAF / Africa/Douala / fr-CM, matching schema defaults); `branch { code, name }` (first branch); `admin { displayName, username, pin }`; `enabledPresets: TemplateCode[]` (non-empty, from `TEMPLATE_CODES` in `templates.ts`); `disabledModules?: ModuleCode[]` (default `[]`, CORE not allowed in it).
- `provisionWorkspaceCommand` wrapping `{ name: z.literal("provision-workspace"), version: z.literal(1), envelope: commandEnvelope, payload }`.
- Client-generatable UUIDs: workspace/branch/principal ids are client-supplied `z.uuid()` fields in the payload (offline/appliance requirement, matches every other command).
- PIN: reuse whatever constraint the login contract (`packages/contracts/src/auth.ts`) implies; don't invent a new one.
- Test alongside, matching sibling contract tests (valid payload parses; slug/preset/module violations rejected).

**Schema** — `apps/api/src/db/schema.ts`:

- `workspace_templates`: same shape as `workspace_modules` (:204) — `workspaceId`, `presetCode` (enum over TEMPLATE_CODES), `enabled` boolean, `updatedByCommandId` NOT NULL FK to `commands`, `rowVersion`, unique `(workspaceId, presetCode)`.
- Generate migration `pnpm db:generate`; apply with `pnpm db:migrate` against docker Postgres (:5435). Check existing migrations for RLS/GRANT conventions on sibling tables (`workspace_modules`) and mirror them.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] Contract test passes (`pnpm --filter @routiq/contracts test`)
- [ ] Migration applies cleanly to fresh DB; RLS/GRANTs match `workspace_modules`

## Comments

2026-07-30 — Done (codex worker + review). Files: packages/contracts/src/commands/provision-workspace.ts (+test), apps/api/src/db/schema.ts (workspaceTemplates), apps/api/drizzle/0015_square_mesmero.sql. Review caught missing GRANT (0004 blanket grant covers only pre-existing tables) — fixed in file + applied to dev DB (routiq_app: SELECT,INSERT,UPDATE verified via information_schema). Slug regex added. typecheck green, 113 contract tests pass, migration applied.
