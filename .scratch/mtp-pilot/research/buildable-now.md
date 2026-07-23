# Buildable now — outline and direction (2026-07-22)

Question: what can start being built today without partner input, and in what order.
Sources: ARCHITECTURE.md v0.2 (full read), repo source (all 29 files under `apps/`+`packages/`), `.scratch/mtp-pilot/map.md` + all 14 tickets.

## 1. Current state (repo evidence)

~335 lines of source total. This is the **M0 scaffold** — tenancy + command-spine seed, nothing more.

| Package | Exists | Evidence |
|---|---|---|
| `apps/api` | Fastify server with `GET /health` + `GET /v1/commands` only; no command POST route | `apps/api/src/server.ts` (22 lines) |
| | Dispatcher **registry only**: `CommandDefinition`, `registerCommand`, `resolveCommand`. No pipeline — no auth, no idempotency lookup, no transaction wrapper, no handler registered | `apps/api/src/commands/dispatcher.ts` |
| | Drizzle schema M0: `workspaces`, `branches`, `principals`, `commands` (ws-scoped idempotency unique index present), `audit_events`. Header comment: composite tenant FKs + RLS deferred to M1 migrations | `apps/api/src/db/schema.ts`; migration `apps/api/drizzle/0000_serious_exodus.sql` |
| | One test: `/health` responds | `apps/api/src/server.test.ts` |
| `packages/contracts` | `commandEnvelope` (client never supplies tenant/actor/branch), `moneyMinor`, `currencyCode`; **one** command schema: `register-asset.v1` + test | `packages/contracts/src/envelope.ts`, `src/commands/register-asset.ts` |
| `packages/domain` | XAF money: `assertMoneyMinor`, `formatXAF` + test | `packages/domain/src/money.ts` |
| `apps/web` | Static placeholder page, fr text. No router, no TanStack, no forms, no PWA, no i18n | `apps/web/src/App.tsx` (10 lines) |

Missing vs ARCHITECTURE.md: memberships/roles, all domain tables (assets, activities, finance, maintenance, stock, documents, notes, notifications), the §5.3 pipeline, approval rules, `workspace_modules`, auth, RLS, pg-boss, i18n, offline layer, reports. Git repo initialized today, **zero commits**.

## 2. Buildable now — zero partner input

Everything below is fully specified in ARCHITECTURE.md; partner tickets gate only *seed data* and *form field lists*, not schema or commands.

| # | Work item | Spec | Depends on solo ticket | Size |
|---|---|---|---|---|
| B1 | **Command pipeline (write path)**: `POST /v1/commands/:name`, authenticate → authorize → module check → idempotency → schema → concurrency → invariants → approval eval → atomic commit (records + receipt + audit) | §5.3, §11 step 1 | 05 (baseline commit first) | L |
| B2 | Auth behind thin interface (Supabase identity + app-owned RBAC, username/PIN path), memberships + ~6 fixed roles | §6a guard 1, §10, §8 | — | M |
| B3 | M1 migration: composite tenant FKs, RLS + `FORCE ROW LEVEL SECURITY` + `SET LOCAL app.workspace_id`, revoke UPDATE/DELETE on audit | §4.4, §4.3 | — | M |
| B4 | `workspace_modules` + EnableModule/DisableModule + pipeline check | §3.3a | — | S |
| B5 | Testcontainers integration harness (RLS + idempotency proven by test) | §8 testing row | — | M |
| B6 | **Asset register**: categories table + TRUCKING/PASSENGER_TRANSPORT presets (code), assets table, RegisterAsset/CommissionAsset/AssignAsset handlers (register-asset contract already exists), documents + AddOrRenewDocument, photos via storage | §3.1, §3.3, §5.1, §11 step 2 | 14 (storage interface shape — resolve before photo upload code) | L |
| B7 | Activity graph tables + **granular** commands: CreateActivity, RecordMovementLeg, SubstituteAsset, CloseActivity (warn-not-block), meter readings, availability intervals, EXCLUDE constraint on primary segments | §3.1, §3.2, §3.4-6/7, §5.1 | — | L |
| B8 | Financial core: entries + signed postings, sum-to-entry check, RecordRevenue/RecordExpense, approval_rules table + single-step engine with safe default "require review" (thresholds are tenant-editable rows — seed later from ticket 06) | §4.2, §5.2 | — | L |
| B9 | Period lock + LockPeriod/ReopenPeriod + the one lock trigger | §4.3 | — | M |
| B10 | Defect → work order → release chain; minimal stock ledger + issue→expense link | §3.1, §5.1, §11 step 5 | — | L |
| B11 | Notes (append-only AddNote), notifications table + daily document-expiry pg-boss scan, in-app bell | §3.1, §5.5 | 11 (adopt working position: in-app only) | M |
| B12 | Reports as SQL views: Asset 360, activity contribution, asset-period profitability, doc expiry, data quality, stock, compensation | §9 | — | L |
| B13 | Web foundation: TanStack Router/Query, RHF+Zod shared schemas, Tailwind/shadcn, i18next fr-CM, then forms per command | §8 | — | L |
| B14 | Offline capture: PWA + Dexie outbox, branch snapshot, replay; numbering pre-allocated ranges (adopt `DLA-0042` provisionally, ticket 10 veto later) | §6 | 10 (provisional) | L |
| B15 | Hosting latency test page (build + deploy to both regions; measurement itself waits on Ange) | ticket 03 | 03 (partial) | S |
| B16 | Phase 0 pilot kit **artifact** (forms are producible solo; partner *reaction* is what's parked) | ticket 01, §11 Phase 0 | — | M |

## 3. Blocked / genuinely partner-dependent

| Ticket | What waits | Why it doesn't block build |
|---|---|---|
| 01 pilot kit | Partner reaction + field use | Kit itself is B16; composite-sheet *field lists* await it (map "Not yet specified") — granular commands (B7) cover the data model meanwhile |
| 02 sign-off | Downgraded to post-build feedback (user decision this session) | Build proceeds on v0.2 as-is |
| 04 devices | Test-matrix floor phone | Affects offline *hardening*, not offline *build* (B14) |
| 06 thresholds | XAF amounts per operator | Seed rows only; engine + safe default ship in B8 |
| 07 compensation | Real pay arrangements | Category seed + form defaults only; `person_id` posting column ships in B8 |
| 08 cash sessions | Confirm vs real daily sheet | Working rec in ticket: ship minimal table regardless — could fold into B8 provisionally |
| 09 trailer economics | Operator attribution practice | Schema supports both (§12.3); decides form display only |

## 4. Recommended direction

Ordered path (each wayfinder ticket = own session; build via main flow):

1. **Resolve 05** (S) — commit the scaffold, verify `pnpm typecheck` + `pnpm test` green. Unblocks the build hand-off per map fog list. `/wayfinder`.
2. **Resolve 14** (S, grilling with Linus) and **11** (S — adopt in-app-only, research 12 done). Mark 10 provisionally decided. `/wayfinder`.
3. **Spine spec** — `/to-spec` on build steps 1–2 (B1–B6): the write path + asset register. This is the make-everything-else-possible slab (§11: "everything else rides it"). Then `/to-tickets` → `/implement` per ticket, fresh context each.
4. **Next specs in build order** (§11): B7 activities → B8/B9 finance+periods → B10 maintenance/stock → B12 reports → B13/B14 web+offline (start offline early per §11 step 7 note).
5. **Parallel/idle**: B15 latency page (S), B16 pilot-kit artifact (M) — ready for the 2-week partner check-in, which also collects tickets 01/04/06/07/08/09 answers in one pass.

Roughly 6–8 weeks of the §11 8–12-week Phase 1 estimate is partner-independent. The only code paths genuinely waiting are: composite sheet payload field lists (01), threshold/category seed rows (06/07), and form display choices (09).
