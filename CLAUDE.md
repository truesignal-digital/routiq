# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Asset lifecycle & profitability platform for Cameroonian transport operators (trucking + passenger transport). Pilot-stage: two known tenants, French-first users, intermittent connectivity, offline capture on low-end Android. **`ARCHITECTURE.md` (v0.2) is the authoritative design document — consult it before any non-trivial design decision; section references below point into it.**

## Commands

pnpm workspace monorepo (never npm/yarn). Node ≥ 24.

```bash
pnpm typecheck                    # all packages (tsc --noEmit)
pnpm test                         # all packages (vitest run)
pnpm --filter @asset/api test     # one package
pnpm --filter @asset/api exec vitest run src/server.test.ts   # single test file
pnpm db:generate                  # drizzle-kit generate (from apps/api/src/db/schema.ts)
pnpm db:migrate                   # drizzle-kit migrate
docker compose up -d              # Postgres 17 on localhost:5433 (user/pass/db: asset/asset/asset_dev)
```

- Env: copy `.env.example` → `.env` (`DATABASE_URL` points at port **5433**, not 5432; API `PORT=3001`).
- Dev servers (`pnpm --filter ... dev`) — assume already running; don't start them.
- Dependency versions were deliberately pinned against the registry (ARCHITECTURE.md §8) — don't bump without reason. TypeScript 7 (native compiler), Zod 4 (`z.uuid()`, `z.iso.date()` — not the Zod 3 spellings), Tailwind 4 (CSS-first config, no tailwind.config.js), Drizzle 0.x (pin exact).

## Layout

| Path | Package | Role |
|---|---|---|
| `apps/api` | `@asset/api` | Fastify command API + Drizzle schema/migrations |
| `apps/web` | `@asset/web` | Vite + React 19 PWA |
| `packages/contracts` | `@asset/contracts` | Zod command envelopes + payload schemas — shared by API, web, offline sync, future AI |
| `packages/domain` | `@asset/domain` | Pure domain logic (money, invariants); no I/O deps |

TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` (`tsconfig.base.json`). ESM everywhere; intra-package imports use `.js` extensions.

## Architecture (the big picture)

**One command layer, one write path** (§1, §5). Every mutation — web form, offline sync, CSV import, future AI agent — is a named, versioned command (`register-asset.v1`) through the same pipeline: authenticate → authorize → module check → idempotency → schema → optimistic concurrency → invariants → approval rules → **atomic commit** (records + command receipt + append-only audit event in one transaction). No adapter ever writes to the database directly. Reads are plain REST/SQL views (CQRS-lite, no projections).

Adding a command touches three places:
1. **Payload schema** in `packages/contracts/src/commands/<name>.ts` — Zod object composing `commandEnvelope` from `envelope.ts`, plus a test.
2. **Handler** in `apps/api/src/commands/` — implements `CommandDefinition` from `dispatcher.ts`, registered via `registerCommand`. `execute` runs inside one transaction.
3. **Catalog check** — the ~16 MTP commands and their approval defaults are enumerated in §5.1; match its naming and approval semantics.

**Command envelope rules** (`packages/contracts/src/envelope.ts`): tenant, actor, and branch scope are NEVER accepted from the client — the server derives them from auth. Envelope carries `commandId`, `idempotencyKey` (workspace-scoped unique; exact retry returns original result, same key + different payload → 409), `origin`, optional `expectedVersion`, `sourceArtifactIds`.

## Non-negotiable invariants (§3.4, §4.1)

- **Money:** `bigint` minor units + `char(3)` currency. **XAF has exponent 0 — 1 XAF = 1 minor unit; never divide by 100.** Use `moneyMinor` from contracts and `packages/domain/src/money.ts`.
- **Tenant isolation:** `workspace_id` on every tenant table; composite tenant FKs (`FOREIGN KEY (workspace_id, asset_id)`) so cross-tenant references are structurally impossible.
- **Append-only corrections:** approved/posted financial and stock records, meter readings, documents, and notes are never edited — corrections supersede or reverse (`superseded_by_id`, `reverses_entry_id`), preserving the original. Posting amounts are SIGNED so reversals subtract.
- **Postings sum exactly to their entry;** one canonical cost posting per economic fact.
- **Warn, don't block:** activity close with missing data sets completeness `COMPLETE_WITH_EXCEPTIONS`; period lock is the strict boundary. Reports never invent missing values.
- **Provenance:** every business row carries `created_by_command_id`; UUIDs are client-generatable (offline requirement); `row_version` on every mutable table.
- Lifecycle status ≠ availability; no new operational records after SOLD/RETIRED/WRITTEN_OFF.

## Constraints that shape implementation choices

- **Offline is command replay, not sync protocol** (§6): PWA outbox of immutable envelopes replayed as idempotent calls. Facts captured offline are accepted with discrepancy flags; decisions (approvals, locks, releases) always need the server.
- **On-prem topology B must stay cheap** (§6a): auth behind a thin interface, storage via S3 API only (no Supabase-specific runtime features in business code), `docker-compose.yml` must run the full stack cold — it's the distribution artifact.
- **AI-ready, not AI-dependent** (§7): no business handler imports an AI provider SDK; AI lands later as a restricted principal using the same commands.
- **i18n:** fr-CM default, en switchable; API errors are stable codes, never English strings; no sentence concatenation.
- **Deliberately deferred** (§13): no event sourcing, no CRDTs, no microservices, no configuration engine, no payroll/GPS/ticketing. Don't reintroduce them; template variance is data (categories, required-field lists, `custom_values` JSONB), not code.

## Agent skills

### Issue tracker

Local markdown under `.scratch/<feature-slug>/` (spec + `issues/NN-slug.md`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five roles, label string = role name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
