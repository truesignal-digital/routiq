# 05 — Provision CLI + seed-dev rewrite

Status: resolved
Blocked by: 04

## Task

The vendor-facing entry point: a script that reads a tenant file and dispatches `provision-workspace.v1` in-process. Then rewrite `seed-dev.ts` on top of it so there is exactly one provisioning code path (`.scratch/onboarding/issues/01-starter-packs.md`: generalize the embryo, don't parallel it).

## Requirements

- `apps/api/scripts/provision.ts` (tsx, top-level await, matching `seed-dev.ts` style):
  - input: `--file <path>` JSON matching the contract payload (validated with the contract schema; print zod issues readably on failure), or flags for the simple case.
  - ensures the vendor-operator principal row exists (create-if-missing), builds the `OperatorContext`, generates envelope (`commandId`, `idempotencyKey` derived from slug so re-running the same file is an idempotent replay, `origin: "API"` unless issue 02 added an origin value).
  - dispatches via `dispatchCommand` directly against `DATABASE_URL` — no HTTP, works on the appliance cold start (ARCHITECTURE.md §6a).
  - prints: workspace id/slug, branch, admin username, command id. NEVER prints the PIN back except echoing what the file already contained; no PIN in any log line.
  - register as a package script: `"provision": "tsx scripts/provision.ts"`.
- `scripts/seed-dev.ts`: reduce to a canned payload (sotrafret / DLA / amina) passed through the same provision path, keeping its idempotent re-run property. Delete the direct category/approval inserts from it.
- Verify end-to-end against docker Postgres: fresh DB → migrate → provision → login with the created credential via the running API or `app.inject`. Record the transcript in Comments.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] Fresh-DB end-to-end run recorded (provision → login → one tenant command succeeds)
- [ ] Re-running provision with same file: replay, zero duplicate rows
- [ ] `seed-dev.ts` contains no direct inserts of categories/approval rules

## Comments

2026-07-30 — Done (codex worker + orchestrator verification). apps/api/scripts/provision.ts (provisionTenant/provisionFromFile, uuid-v5-style deterministicProvisionId, get-or-create VENDOR_OPERATOR, contract-validated file input with readable zod errors, early rejection of unknown module codes, PIN never printed); seed-dev.ts rewritten as canned payload through the same path (no direct category/approval inserts remain); "provision" script in apps/api/package.json; scripts now typechecked (tsconfig include + one exactOptional fix in smoke.ts).

Orchestrator re-ran E2E against the real dev DB (worker transcript had run against an ephemeral env): fresh provision of tenant-two → replay with same command id on rerun; row counts exact (19 cats / 60 rules / 2 templates / 1 disabled module / 1 receipt / 1 operator).

CAVEAT for existing dev DBs: a pre-provisioning sotrafret (old direct-insert seed, different id) makes the new seed-dev fail with a clean 409 DUPLICATE_WORKSPACE_SLUG — intended fail-closed behavior; reset the dev DB (or drop the old workspace) to adopt the provisioned lineage.
