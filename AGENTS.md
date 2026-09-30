# AGENTS.md — ROUTIQ

Rules for every coding agent working in this repository (Codex, Claude Code and others). `CLAUDE.md` imports this file. Before changing anything under `apps/web/`, also read [`apps/web/AGENTS.md`](apps/web/AGENTS.md).

## How trust works here

The codebase is the agent's memory: agents copy whatever patterns they find nearby, so one workaround copied a few times becomes the pattern. Every recurring mistake gets fixed at the highest rung that works:

1. **Architecture**: types and APIs that make the mistake impossible to write.
2. **Static checks**: guards, compiler flags and CI gates that fail the build.
3. **Guidance**: this file and the skills. Agents usually follow it and sometimes skip it.
4. **Human review**: the first rung to break as PR volume grows.

When a bug or review finding reveals a class of mistake, fix the instance and ask which rung stops the class. The current plan and its reasoning are in [`docs/audits/2026-09-25-trust-audit.md`](docs/audits/2026-09-25-trust-audit.md).

## Project

**ROUTIQ** is a vehicle-centered fleet operations and spending-traceability platform for Cameroon. The first target is companies managing their own internal fleets; preserve the existing trucking and passenger-transport pilots/presets. Trip revenue is not required for an internal fleet to obtain value. French-first with English support, intermittent connectivity and low-end Android shape delivery; offline recovery is a requirement, not a blanket claim of implemented behavior. **`ARCHITECTURE.md` is the authoritative design document — consult it before any non-trivial design decision; section references below point into it.** The [vehicle workspace v1 contract](docs/reference/vehicle-workspace-v1.md) distinguishes existing fields from planned additions and defines cost/read boundaries.

## Commands

pnpm workspace monorepo (never npm/yarn). Node ≥ 24.

```bash
pnpm typecheck                    # all packages (tsc --noEmit)
pnpm lint                         # repo guards (tools/guards); see "Guards and the ratchet"
pnpm lint:tighten                 # lower guard baselines after you remove violations
pnpm test                         # all packages (vitest run)
pnpm --filter @routiq/api test     # one package
pnpm --filter @routiq/api exec vitest run src/server.test.ts   # single test file
pnpm db:generate                  # drizzle-kit generate (from apps/api/src/db/schema.ts)
pnpm db:migrate                   # drizzle-kit migrate
docker compose up -d              # Postgres 17 on localhost:5435
docker compose --profile appliance up   # ROUTIQ cold start (§6a guard 4): API :3001 + Postgres (user/pass/db: routiq/routiq/routiq_dev)
```

- Env: copy `.env.example` → `.env` (`DATABASE_URL` points at port **5435**, not 5432; API `PORT=3001`).
- API tests start their own Postgres through testcontainers, so Docker must be running.
- Dev servers (`pnpm --filter ... dev`) — assume already running; don't start them.
- Dependency versions were deliberately pinned against the registry (ARCHITECTURE.md §8) — don't bump without reason. TypeScript 7 (native compiler), Zod 4 (`z.uuid()`, `z.iso.date()` — not the Zod 3 spellings), Tailwind 4 (CSS-first config, no tailwind.config.js), Drizzle 0.x (pin exact).
- **UI headless layer is Base UI (`@base-ui/react`), NEVER Radix.** shadcn components use the `base-nova` style configured in `apps/web/components.json` — vendor via the shadcn CLI so it resolves Base UI-backed versions; adding any `@radix-ui` package is a bug.

## Layout

| Path | Package | Role |
|---|---|---|
| `apps/api` | `@routiq/api` | Fastify command API + Drizzle schema/migrations |
| `apps/web` | `@routiq/web` | Vite + React 19 PWA |
| `packages/contracts` | `@routiq/contracts` | Zod command envelopes + payload schemas — shared by API, web, offline sync, future AI |
| `packages/domain` | `@routiq/domain` | Pure domain logic (money, invariants); no I/O deps |
| `tools` | `@routiq/tools` | Repo guards (`tools/guards`) and agent tooling; never imported by app code |

TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` (`tsconfig.base.json`). ESM everywhere; intra-package imports use `.js` extensions. No `any`, no `@ts-ignore`; `@ts-expect-error` only in type tests.

## Architecture (the big picture)

**One command layer, one write path** (§1, §5). Every mutation — web form, offline sync, CSV import, future AI agent — is a named, versioned command (`register-asset.v1`) through the same pipeline: authenticate → authorize → module check → idempotency → schema → optimistic concurrency → invariants → approval rules → **atomic commit** (records + command receipt + append-only audit event in one transaction). No adapter writes to the database directly. The one sanctioned exception is authentication state (sessions and credentials in `apps/api/src/auth/local.ts`); artifact registration in `apps/api/src/artifacts/routes.ts` still writes directly and is due to become a `register-artifact` command. Reads are plain REST/SQL views (CQRS-lite, no projections).

Canonical HTTP writes use `POST /v1/commands/:name` with `{ version, envelope, payload }`. The older generic `POST /v1/commands` shape is a temporary compatibility facade (ADR-0002). Add no new callers of it, tests included.

Adding a command touches three places:
1. **Payload schema** in `packages/contracts/src/commands/<name>.ts` — Zod object composing `commandEnvelope` from `envelope.ts`, plus a co-located test.
2. **Handler** in `apps/api/src/commands/` — implements `CommandDefinition` from `dispatcher.ts`, registered via `registerCommand`. `execute` runs inside one transaction.
3. **Catalog check** — the command catalog and approval defaults in §5.1 (26 commands are registered today); match its naming and approval semantics. Every workspace command needs a catalog approval default and an offline-queueability declaration (`commands/registry.test.ts` enforces both).

Never change the payload shape of a shipped command version. Add `vN+1` with a compatibility handler for `vN`, as `provision-workspace` v1 → v2 did (#20).

Each registered `name.vN` has its payload's JSON Schema stored in `apps/api/src/commands/contract-snapshots/`. `contract-snapshots.test.ts` fails when a version has no snapshot, when a snapshot has no handler, or when the current schema rejects a payload the stored one accepted (a removed field, a newly required field, a removed enum value, a type change, a tighter bound). Widening passes. After adding a command version or widening one, run `pnpm --filter @routiq/api contracts:snapshot` and commit the files it writes. Never write a snapshot by hand; the script refuses to rewrite a narrowed one.

**Command envelope rules** (`packages/contracts/src/envelope.ts`): tenant, actor, and branch scope are NEVER accepted from the client — the server derives them from auth. Envelope carries `commandId`, `idempotencyKey` (workspace-scoped unique; exact retry returns original result, same key + different payload → 409), `origin`, optional `expectedVersion`, `sourceArtifactIds`.

**Reads** are GET routes in `apps/api/src/reads/`, running inside `inWorkspace`. Every read must declare and check its gates itself: the module it belongs to, the roles allowed to see it, and the branch scope of the caller. Reads that skipped a gate caused #40, #58 and #59; a `defineRead` wrapper that makes the gates required is planned. List reads use `listQuery`/`listResponse` with keyset cursors from `reads/cursor.ts` (ADR-0003). Business days come from `reads/business-date.ts` (workspace time zone).

## Non-negotiable invariants (§3.4, §4.1)

- **Money:** minor units + `char(3)` currency; `bigint` in the database and domain, a safe integer (`moneyMinor = z.number().int()`) on the wire. **XAF has exponent 0 — 1 XAF = 1 minor unit; never divide by 100.** Use `moneyMinor` from contracts and `packages/domain/src/money.ts`.
- **Tenant isolation:** `workspace_id` on every tenant table; composite tenant FKs (`FOREIGN KEY (workspace_id, asset_id)`) so cross-tenant references are structurally impossible. New tables need explicit GRANTs to `routiq_app` in their migration (`db/grants.test.ts`).
- **Append-only corrections:** approved/posted financial and stock records, meter readings, documents, and notes are never edited — corrections supersede or reverse (`superseded_by_id`, `reverses_entry_id`), preserving the original. Posting amounts are SIGNED so reversals subtract. (UI edits vs corrections: ADR-0008.)
- **Postings sum exactly to their entry;** one canonical cost posting per economic fact.
- **Warn, don't block:** activity close with missing data sets completeness `COMPLETE_WITH_EXCEPTIONS`; period lock is the strict boundary. Reports never invent missing values.
- **Provenance:** every business row carries `created_by_command_id`; UUIDs are client-generatable (offline requirement); `row_version` on every mutable table.
- Lifecycle status ≠ availability; no new operational records after SOLD/RETIRED/WRITTEN_OFF.
- **Errors:** API errors are stable codes (`packages/contracts/src/errors.ts`), never English strings.

## Constraints that shape implementation choices

- **Offline is command replay, not sync protocol** (§6): the planned PWA outbox holds immutable envelopes replayed as idempotent calls; it is not built yet (`apps/web/src/commands/store.ts`). Facts captured offline are accepted with discrepancy flags; decisions (approvals, locks, releases) always need the server.
- **On-prem topology B must stay cheap** (§6a): auth behind a thin interface, storage via S3 API only (no Supabase-specific runtime features in business code; `@aws-sdk/*` only in `apps/api/src/storage/`), `docker-compose.yml` must run the full stack cold — it's the distribution artifact.
- **AI-ready, not AI-dependent** (§7): no business handler imports an AI provider SDK; AI lands later as a restricted principal using the same commands.
- **i18n:** fr-CM default, en switchable; no sentence concatenation.
- **Deliberately deferred** (§13): no event sourcing, no CRDTs, no microservices, no configuration engine, no payroll/GPS/ticketing. Don't reintroduce them; template variance is data (categories, required-field lists, `custom_values` JSONB), not code.
- **Project-scoped names:** nothing in this repo names another project or a personal host. Cross-project wiring lives in box env files, not here.

## Definition of done for a feature PR

1. The contract lives in `packages/contracts` with a test, and any shape change to a shipped command is a new version.
2. Writes go through `registerCommand`; reads check module, role and branch scope.
3. The UI follows the paved paths in `apps/web/AGENTS.md`.
4. `pnpm typecheck`, `pnpm lint` and `pnpm test` pass, and no guard baseline went up.
5. The PR targets `develop`, and its body has a **Walkthrough video** section linking a recording that shows the feature working in the app and nothing around it breaking. English app UI and English captions.
6. While testing, review the rest of the app for anything that looks wrong or broken. File each finding as its own issue (labels `walkthrough-finding` and `needs-triage`) or its own PR, and never fix it inside the feature PR. List them under **Found while testing**, or write "none".

## Guards and the ratchet

`pnpm lint` runs the rules in `tools/guards/rules.ts`. Each rule names a mistake that must not spread and says what to do instead. Known violations are counted per file in `tools/guards/baselines.json`, and those counts may only go down:

- A new violation fails, and so does a violation in a new file.
- When you remove violations, the count drops below its baseline and `pnpm lint` fails until you run `pnpm lint:tighten` and commit the lower baseline. That locks the improvement in.
- If a guard blocks you, change the code, or stop and ask. Never edit a rule to let your change through, never delete a rule, and never raise a baseline by hand. The only exception is an ADR in `docs/adr/`, cited by a `Trust-Exception: ADR-NNNN` commit trailer. The `ratchet` PR check enforces this: it runs the base branch's copy of `tools/ratchet.ts`, fails on a raised baseline, a removed rule, or removed lines in the guard machinery, and accepts only a trailer whose ADR exists.
- When a bug or review finding shows a new class of mistake, add a rule for it, with a case in `tools/guards/rules.test.ts`.

## Git and PRs

- Branch off `develop`; open PRs into `develop`. Never push to `develop` or `main` directly, never force-push a shared branch, never merge your own PR.
- `pnpm install` points git at `.githooks/`: `pre-push` refuses pushes to `main` and `develop` and runs `pnpm typecheck && pnpm lint`. Never bypass it with `--no-verify`.
- Claude Code sessions also run `.claude/hooks/git-guardrails.ts`, which blocks protected-branch pushes, force pushes, remote branch deletes, `--no-verify`, `gh pr merge`, `reset --hard`, `clean -f`, `branch -D` and `checkout .`/`restore .`.
- Fill in every section of `.github/pull_request_template.md`. The `pr-evidence` check fails a PR that changes `apps/web/src` or `apps/api/src` (tests excepted) without a walkthrough video link and a "Found while testing" list.
- Commit messages: short imperative subject; body only when the why isn't obvious.
- Issues live in GitHub (`docs/agents/issue-tracker.md`). `.scratch/` is read-only history; add nothing there.

## Agent skills

### Issue tracker

GitHub Issues on `truesignal-digital/routiq` via `gh` CLI. See `docs/agents/issue-tracker.md`. Legacy specs remain under `.scratch/`.

### Triage labels

Default five roles, label string = role name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`. Use the glossary's terms; don't drift to the synonyms it lists under _Avoid_.
