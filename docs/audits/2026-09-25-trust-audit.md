# Trust audit: ROUTIQ

**Audited branch: `origin/develop` at `876e0b3`** ("Merge pull request #53", 2026-09-25). Work lands on this branch: PRs #48-#54 all merged into it (`gh pr list --state merged`). The default branch `main` has stood at `202b622` since 2026-08-15. `develop` is 20 commits ahead of `main` and 0 behind (`git rev-list --count`). The owner chose `develop` for this audit on 2026-09-25.

This version replaces the earlier same-day audit of `main` and its revision. Plan numbering restarts. The revision's decisions and sequencing notes are carried over where they still apply.

Method: the tree was read from `git archive origin/develop` in a scratch directory, so the local checkout was not switched. `origin/develop` matched the remote tip (`git ls-remote origin refs/heads/develop` → `876e0b3a`). Line numbers refer to `develop` unless a line says otherwise. This was a read-only pass: no file other than this one was changed.

**Uncommitted work is reported separately.** The local checkout is `main` with 9 modified tracked files (`git diff --stat HEAD`: 135 insertions, 1 deletion) plus untracked files. None of it is on `develop`, and none of it is counted in the scores.

| Uncommitted item | Why it matters |
|---|---|
| Capabilities work: `packages/contracts/src/capabilities.ts`, `apps/api/src/reads/capabilities.ts`, `apps/web/src/lib/capabilities.tsx`, `apps/api/drizzle/0025_person_membership_constraints.sql`, `@casl/*` added to `apps/web/package.json` | It has 4 `as any` (`reads/capabilities.ts:79-80`, `lib/capabilities.tsx:24-25`) and 2 Zod 3 spellings (`contracts/src/capabilities.ts:18,21`). Both break rules (A9, J1) before review sees them. It also brings in CASL, which D6 replaces with a plain typed lookup. See D4. |
| Prototype route in `apps/web/src/router.tsx:167-173`, plus `apps/web/src/prototypes/` and `screens/MaintenancePrototypeScreen.tsx` | Its own comment says "PROTOTYPE — throwaway, ticket #31. Delete this route with the prototype." A guard (item 5) keeps it from being committed by accident. |
| New `.scratch/` and `docs/research/` files, `.claude/launch.json` | Not a code-rule concern, except that `launch.json` is the only launch config (see the verification CLI score). |

## 0. Model

Trust comes from the environment, not from supervision. The codebase is the agent's memory: agents extend whatever patterns they find nearby, good or bad. One workaround copied a few times becomes the de facto pattern within weeks.

Every recurring agent mistake has a fix on the trust ladder. Higher rungs enforce; lower rungs only guide. Fix each mistake at the highest rung that works:

1. Architecture: types, data structures, module boundaries, and APIs that make the mistake impossible to write.
2. Static checks: lint rules, compiler flags, import-graph rules, and CI gates that fail the build on the mistake.
3. Guidance: agent rules files (CLAUDE.md, AGENTS.md, .cursor/rules), skills, review bots. Agents usually follow these and sometimes skip them.
4. Human review: style guide and code review. The first rung to break as PR volume grows.

Terms:
- paved path: the one blessed way to do a common job (fetch data, manage state, handle errors, add a route, style a component). One path per job, so agents never choose between rivals.
- rival paths: two or more live ways to do the same job.
- verification CLI: a checked-in command an agent runs to start the app, drive it, and collect evidence (test results, screenshots, perf traces, logs). Every session uses the same one instead of writing throwaway scripts.
- feature map: a machine-readable index of what the app does. Each feature lists its entry files, route or command, UI selectors or keyboard shortcuts, and main user flow. It lets an agent turn a vague bug report ("this button ???") into a location in code.
- gardener: a recurring cleanup lane that deletes dead code, removes shims, shrinks lint baselines, and turns each new anti-pattern into a lint rule.
- baseline: a recorded list of existing violations for a new rule, so only new violations fail. Lets strict rules land in an old codebase without a big-bang refactor.
- survivors: merged changes still merged a week later. Track survivors and reverts, not PR count.

## 1. Summary

1. The API write path is built for agents. `CommandDefinition` has a required, fail-closed branch policy (`apps/api/src/commands/dispatcher.ts:132`, checked at registration on line 255). Each command runs in one transaction, and the database adds Postgres RLS, composite tenant FKs and revoked grants. Guard tests back all of it (`apps/api/src/db/rls.test.ts:122-229`, `apps/api/src/db/grants.test.ts:36-61`).
2. Nothing requires the checks to pass. There is no linter, and `pnpm lint` exits 0 with "None of the selected packages has a "lint" script" (`package.json:11`). Branch protection and rulesets return 403 on this private free-plan repo. CI does not run on pushes to `develop` (`.github/workflows/ci.yml:5-6`). All 7 PRs into `develop` passed `ci` before merge, but by habit, not by rule, and with 0 reviews.
3. Reads are the weak side. Every GET route is a hand-written Fastify handler guarded only by `requireAuth`, and the four finance reads have no role check at all (`apps/api/src/reads/finance.ts:156-161`). Reads run in a read-write transaction (`apps/api/src/db/tenant.ts:7-18`). They hold 19 `req.auth!` assertions and 52 ad hoc `reply.status(...)` replies. Open issues #58 and #59 are both reads missing gates.
4. Codex writes the code: all 7 `develop` PRs come from `codex/*` branches. Yet Codex loads none of the project rules. There is no `AGENTS.md`, and `~/.codex/config.toml` sets no `project_doc_fallback_filenames`. The web conventions exist only in one person's private agent memory. Two results: 16 native date inputs where that memory says to use a date picker, and a component missing from the registry (`apps/web/src/components/money-input.tsx`).
5. There is no verification CLI and no feature map. `apps/api/scripts/smoke.ts`, the seed scripts and `docker compose --profile appliance` exist. But no committed command boots the app, drives the UI and saves evidence. The only launch config is untracked and points at another session's scratchpad (`.claude/launch.json:9`, local checkout).

The three changes that buy the most trust per hour:

1. **Rules every agent loads (S, plan items 1-2).** Add a root `AGENTS.md` that `CLAUDE.md` imports. Add `apps/web/AGENTS.md` with the conventions now kept in private memory. Every later Codex and Claude session then sees them.
2. **Make the checks block (S + M, plan items 4-6).** Run CI on `develop` pushes and add a committed pre-push hook. Turn `pnpm lint` into a guard suite with baselines. Require `ci` once D2 allows it.
3. **`defineRead` with required gates and a read-only transaction (M, plan items 7-9).** This removes the most frequent bug class, the same way `CommandDefinition` removed it on the write side.

## 2. Scorecard

### Project map

| Job | Exact command | Evidence |
|---|---|---|
| Typecheck | `pnpm typecheck` runs `tsc --noEmit` in all 4 packages. On the `develop` snapshot it reports 0 errors in contracts, domain, api and web | `package.json:9`; per-package `node_modules/.bin/tsc --noEmit` |
| Lint | none. `pnpm lint` exists, but no package defines `lint`. It prints "None of the selected packages has a "lint" script" and exits 0 | `package.json:11`, run output |
| Test | `pnpm test` runs vitest in every package. API tests start Postgres through testcontainers, so Docker must be running | `package.json:10`, `.github/workflows/ci.yml:63-65` |
| Run | `docker compose up -d` (Postgres on 5435), `pnpm db:migrate`, `pnpm --filter @routiq/api dev`, `pnpm --filter @routiq/web dev`. Or `docker compose --profile appliance up` for API and DB only | `CLAUDE.md:14-21`, `apps/api/package.json:7`, `apps/web/package.json:7` |

Stack:
- pnpm 10.28 workspace (`package.json:13`), Node 24, TypeScript 7 native compiler.
- API: Fastify 5, Drizzle 0.45, Postgres 17 (`apps/api/package.json`).
- Web: Vite 8, React 19, TanStack Router and Query, react-hook-form, Zod 4, i18next, Tailwind 4, shadcn on Base UI (`apps/web/package.json`).
- `main` and `develop` have the same dependencies (`git diff --stat main origin/develop -- '*package.json' pnpm-lock.yaml` is empty).

Guidance files read:
- `CLAUDE.md` (83 lines, tracked).
- `CLAUDE.local.md` (18 lines). It is git-excluded (`.git/info/exclude:18`) and exists only in the local checkout.
- `docs/agents/domain.md`, `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`.
- `apps/web/README.md`.
- ADRs 0001-0005, which `docs/agents/domain.md:8` makes required reading.
- 43 vendored skills in `.agents/skills/`, symlinked from `.claude/skills/`: 3,284 lines of `SKILL.md`, from `mattpocock/skills` per `skills-lock.json`.
- The private agent memory file `ui-registry-conventions.md`. It sits outside the repo but carries the web conventions.

No `AGENTS.md`, `.cursor/rules` or `.github/copilot-instructions.md` exists.

### Scores

| Rung / piece | Score | Evidence |
|---|---|---|
| 1. Architecture | **partial** | Strong on writes. `tsconfig.base.json:6-11` enables `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Committed production code has 0 `as any`, 0 `@ts-ignore` and 0 `@ts-nocheck`. The 4 `@ts-expect-error` are deliberate type tests (`apps/web/src/components/data-table.types.test.tsx:36-97`). Retired assets are refused before handlers run (`dispatcher.ts:115-120`). Platform commands have no `module` field by type (`dispatcher.ts:183-219`). `CommandError` accepts only typed codes (`dispatcher.ts:69-85`). The DB enforces tenant isolation and an append-only audit (`rls.test.ts:138-229`). Weak on reads. There is no read type. Reads get a full read-write `TenantTx` (`tenant.ts:4`). `auth?: AuthContext` is optional on every request (`apps/api/src/auth/plugin.ts:9-13`), hence 19 `req.auth!`. Illegal states are still representable: `primaryColumn?` is optional although every table must have one (`apps/web/src/components/data-table.tsx:207`), and posting sums are checked only in writer code (`apps/api/src/commands/financial-entry-writer.ts:66-70`), not in the DB. Package boundaries are not enforced: 2 web files import `@routiq/domain` and 0 API files do. |
| 2. Static checks | **partial** | CI runs typecheck, migrations, tests, the web build and `docker compose config` (`ci.yml:56-72`). It passed on all 7 `develop` PRs (`gh pr view 48..54 --json statusCheckRollup` → `ci:SUCCESS`). The repo's real lint is a set of guard tests: `apps/web/src/palette.test.ts:11-38` (no raw Tailwind shades), `apps/web/src/i18n/locales.test.ts:16-37` (fr/en parity, no `{{`), `apps/web/src/test-select.test.ts:23-37`, `apps/web/src/registry.test.ts:54`, `apps/api/src/commands/registry.test.ts:24-45`, `apps/api/src/db/grants.test.ts`, `apps/api/src/db/migration-replay.test.ts`. Missing: any lint config; a working `pnpm lint`; import-graph rules (a dependency-cruiser config ships in `.agents/skills/setup-ts-deep-modules/` but was never applied); a required status check (403); CI on `develop` pushes (`ci.yml:5-6`). The nightly cold start gates nothing, and it pins `actions/checkout@v4` while CI uses v7 (`nightly-cold-start.yml:14`, `ci.yml:44`). There is 1 inline suppression: `eslint-disable-next-line react-hooks/exhaustive-deps` at `apps/web/src/screens/ActivitySheetScreen.tsx:379`. It silences a linter that never runs. |
| 3. Guidance | **partial** | `CLAUDE.md` is specific and mostly accurate, but it drifts from the code: <br>• `CLAUDE.md:49` says "~16 MTP commands"; there are 26 `registerCommand`/`registerPlatformCommand` calls. <br>• `CLAUDE.md:55` says money is `bigint`; the wire type is `moneyMinor = z.number().int()` (`packages/contracts/src/envelope.ts:32`). <br>• `CLAUDE.md:65` describes a "PWA outbox" in the present tense; none exists, and `apps/web/src/commands/store.ts:6` says "the offline outbox later adds". <br>• `docs/agents/domain.md:9` still calls ARCHITECTURE.md "v0.2"; `ARCHITECTURE.md:11` calls the v0.2 design "historical context". <br>• `docs/agents/domain.md:11` says to proceed silently if `CONTEXT.md` is missing; it exists. <br>• `apps/web/README.md:26-29` says to run `registry:build` before `vite build`; the Dockerfile runs only `vite build` (`apps/web/Dockerfile:18-20`). <br>• `CLAUDE.local.md:3,7` names models and a global-file section that no longer exist. <br>The web conventions live only in private memory. There is no `AGENTS.md`, so Codex never loads `CLAUDE.md`. |
| 4. Human review | **none** | There is no `CODEOWNERS`, PR template or style guide: `.github/` holds only `actionlint.yaml` and `workflows/`. Branch protection and rulesets return 403 ("Upgrade to GitHub Pro or make this repository public"). All 18 merged PRs have 0 formal reviews. The only commenter is CodeRabbit. It skipped every `develop` PR ("Auto reviews are disabled on base/target branches other than the default branch", https://github.com/truesignal-digital/routiq/pull/54#issuecomment-5827696771) and was rate-limited on #8. Review happens after merge, as issues: #13-#25 came from a multi-branch review, then #55-#60. Issue #37 already asks for reviewed PRs. |
| Verification CLI | **partial** | The pieces exist: `docker compose --profile appliance up` (`CLAUDE.md:21`); `apps/api/scripts/smoke.ts` (433 lines, API only, not a package script, calls the legacy `/v1/commands` facade 18 times); `seed-dev.ts`, `seed-demo.ts` and `provision.ts`; testcontainers for tests. What is missing is one command that boots API and web, seeds, drives the UI, and saves screenshots and logs. There is no browser driver in the repo. The only launch config (`.claude/launch.json`) is untracked and hard-codes `/private/tmp/.../scratchpad/verify/env.sh` and worktree paths. |
| Feature map | **none** | Only the ingredients exist: 18 route paths in `apps/web/src/router.tsx`; the command list at `GET /v1/commands` (`apps/api/src/server.ts:137`); the catalog in `ARCHITECTURE.md` §5.1; the glossary `CONTEXT.md`; and a human tester handbook on the unmerged `docs/tester-handbook` branch (`apps/docs/`). Nothing links a feature to its files, route, commands and selectors. The web code has 0 `data-testid`, so selectors would be role plus accessible name. |

## 3. Rule migration table

Rungs are 1 architecture, 2 static check, 3 guidance and 4 human review. "Done" means the rule is already enforced at its target rung. Every rule from every guidance file is listed; a rule repeated across files points back to its first row.

**Totals: 91 rows, 85 distinct rules (6 duplicates).**
- 9 are already enforced.
- 42 can move up a rung.
- 33 stay guidance, because they need judgement or govern the agent's own workflow.
- 1 is stale and should be deleted.

### CLAUDE.md (tracked; line numbers match on `main` and `develop` except line 7)

| # | Rule (source line) | Now | Target | Mechanism |
|---|---|---|---|---|
| A1 | Consult ARCHITECTURE.md before non-trivial design decisions (7) | 3 | 3 | Stays: judgement. |
| A2 | pnpm only, never npm/yarn (11) | 3 (+`packageManager` field) | 2 | Guard: fail if `package-lock.json`, `yarn.lock` or `bun.lockb` exists outside `node_modules` (0 today). |
| A3 | Node ≥ 24 (11) | 2 partial (`package.json:5-7`) | 2 | `.npmrc` `engine-strict=true`. |
| A4 | Use the listed typecheck/test/migrate commands (14-19) | 3 + CI | 2 | Fold them into `pnpm verify` (items 25-27) and run the same script in CI. |
| A5 | `DATABASE_URL` uses port 5435, not 5432 (24) | 3 | 1 | Parse env with a Zod schema at boot; the error names the compose port. |
| A6 | Don't start dev servers (25) | 3 | 3 | Stays. `pnpm verify up` reuses running servers, which makes the rule mostly moot. |
| A7 | Dependency versions pinned; don't bump without reason (26) | 3 | 2 + 4 | Guard: packages marked "pin exact" carry no `^` or `~`. Put `package.json` and `pnpm-lock.yaml` under CODEOWNERS once review exists. |
| A8 | TypeScript 7 native compiler (26) | 1 | 1 | Done: `typescript ^7.0.2` in every package. |
| A9 | Zod 4 spellings (`z.uuid()`, `z.iso.date()`) (26) | 3 (0 on `develop`) | 2 | Guard regex `z\.string\(\)\.(uuid|email|url|datetime|date|ip)\(`. The uncommitted capabilities work already has 2 violations. |
| A10 | Tailwind 4 CSS-first, no `tailwind.config.js` (26) | 3 (0) | 2 | Guard: no `apps/web/tailwind.config.*`. |
| A11 | Drizzle 0.x pinned exact (26) | 3 (holds) | 2 | Same guard as A7, for `drizzle-orm` and `drizzle-kit`. |
| A12 | Base UI, never Radix (27) | 3 (0 in code, 0 in lockfile) | 2 | Guard: no `@radix-ui` in any `package.json`, `pnpm-lock.yaml` or import. |
| A13 | Vendor shadcn via the CLI with `base-nova` (27) | 1 partial (`apps/web/components.json`) | 3 | Stays: process rule. |
| A14 | TS strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` (38) | 1 | 1 | Done (`tsconfig.base.json:6-11`). No package tsconfig overrides them. |
| A15 | ESM; intra-package imports use `.js` (38) | 1 | 1 | Done for the NodeNext packages, where the compiler rejects missing extensions. Web uses bundler resolution by design. |
| A16 | Every mutation is a command; no adapter writes to the DB directly (42) | 1 partial | 1 + 2 | Read-only transactions for reads (item 7), plus a guard allowlist of files that may call `.insert(`, `.update(` or `.delete(`. Live exceptions: `apps/api/src/artifacts/routes.ts:183`, `apps/api/src/auth/local.ts:30,125,137` (D5). |
| A17 | Reads are plain REST/SQL views, no projections (42) | 3 | 3 | Stays: design judgement. |
| A18 | New clients use named routes; generic `/v1/commands` is temporary (44, ADR-0002) | 3 | 2 then 1 | Guard: the `"/v1/commands"` literal is allowed only in `commands/routes.ts` and `server.ts`. Baseline 51: 32 in tests, 18 in `scripts/smoke.ts`, 1 at `test/seed.ts:98`. Then delete the facade at `commands/routes.ts:15` (D10). |
| A19 | Payload schema in `contracts/src/commands/<name>.ts`, plus a test (47) | 3 | 2 | Registry test: every registered command maps to a contracts file with a co-located test. Baseline 8: `activity-close`, `activity-legs`, `add-or-renew-document`, `asset-lifecycle`, `create-activity`, `module-toggle`, `register-person`, `substitute-asset`. |
| A20 | Handler implements `CommandDefinition`, registers via `registerCommand`, runs in one transaction (48) | 1 | 1 | Done (`dispatcher.ts:108-172, 253`). |
| A21 | Match §5.1 naming and approval semantics (49) | 2 partial (`commands/registry.test.ts:24`) | 2 | Add checks that names are kebab-case and versions are positive integers. Whether a name fits the catalog stays guidance. |
| A22 | Tenant, actor and branch scope never come from the client (51) | 1 partial (`envelope.ts:20-27`) | 2 | Contract test: no workspace payload schema has a `workspaceId`, `tenantId`, `actorId` or `principalId` key. |
| A23 | Idempotency: an exact retry returns the original; the same key with a different payload → 409 (51) | 1 | 1 | Done (`dispatcher.ts`, `platform-scope.test.ts:206-234`, `receipts.test.ts`). |
| A24 | Money is minor units; never divide by 100 (55) | 3 (+ `bigint` DB columns) | 1 + 2 | Branded `MinorUnits` type in `@routiq/domain` (D7), plus a guard on `/ 100`, `* 100` and `toFixed(` applied to money values. 0 violations today: the 4 raw hits are CSS in `ui/drawer.tsx:143,145` and percentages in `ActivityTimeline.tsx:38-39`. |
| A25 | Use `moneyMinor` and `packages/domain/src/money.ts` (55) | 3 | 2 | Import rule: money is formatted only through `@routiq/domain`. The API imports it 0 times. |
| A26 | `workspace_id` everywhere; composite tenant FKs (56) | 1 | 1 + 2 | Catalog test over `pg_constraint`: every FK between tenant tables includes `workspace_id` (item 10). #15 was exactly this gap. |
| A27 | Append-only corrections, never edits (57) | 1 partial (`grants.test.ts:52-61`) | 1 | Extend revoked UPDATE/DELETE to meter readings, documents and notes, and assert it in the catalog test. |
| A28 | Postings sum exactly to their entry (58) | 1 partial (`financial-entry-writer.ts:66-70`) | 1 | Deferred constraint trigger on `financial_postings`, so a future writer cannot skip the check (item 11). |
| A29 | Warn, don't block; reports never invent values (59) | 3 | 3 | Stays: product judgement. `completeness.test.ts` covers the known case. |
| A30 | `created_by_command_id` on every business row; `row_version` on mutable tables (60) | 1 partial | 2 | Catalog test with an allowlist (item 10). |
| A31 | No operational records after SOLD/RETIRED/WRITTEN_OFF (61) | 1 (`dispatcher.ts:115-120`) | 2 | Registry test: a command whose payload has `assetId` declares `operationalAssetId` or sits on an explicit exemption list. `record-financial-entry` and `register-asset` need a ruling. |
| A32 | Offline is command replay; decisions need the server (65) | 2 partial (`commands/registry.test.ts:34`) | 3 | Stays for design; queueability is already enforced. Reword it to say the outbox is planned (see the Guidance score). |
| A33 | Auth behind a thin interface; storage via S3 API only; no Supabase (66) | 3 (0) | 2 | Import bans: `@supabase/*` anywhere, and `@aws-sdk/*` only in `apps/api/src/storage/`. Today only `storage/s3.ts` imports it. |
| A34 | `docker-compose.yml` runs the full stack cold (66) | 2 (`ci.yml:71-72` + nightly) | 2 | Also run the cold-start job on PRs that touch compose files or Dockerfiles. |
| A35 | No business handler imports an AI SDK (67) | 3 (0) | 2 | Import ban: `openai`, `@anthropic-ai/*`, `@google/genai`, `ai`. |
| A36 | fr-CM default, en switchable (68) | 1 | 1 | Done (`apps/web/src/i18n/index.ts`, `locales.test.ts:16`). |
| A37 | API errors are stable codes, never English (68) | 1 for commands | 1 | Reads send 52 ad hoc `reply.status(...).send(...)` replies. `defineRead` gives them a typed `ReadError(code)` (items 8-9). |
| A38 | No sentence concatenation (68) | 2 partial (`locales.test.ts:31`) | 2 | Guard: no `t(...) +` or `+ t(` (0 today). |
| A39 | Deferred scope: no event sourcing, CRDTs, microservices, config engine, payroll/GPS/ticketing (69) | 3 | 3 | Stays. Optional: a dependency denylist (`yjs`, `automerge`). |
| A40 | Template variance is data, not code (69) | 3 | 3 | Stays: judgement. |
| A41 | Issues live in GitHub; `.scratch/` is legacy (75) | 3 | 2 | CI step that fails when the diff adds files under `.scratch/`. |
| A42 | Use the five triage labels (79) | 3 | 3 | Stays: workflow. |
| A43 | Read `CONTEXT.md` and `docs/adr/` (83) | 3 | 3 | Stays: judgement. |

### docs/agents/domain.md, issue-tracker.md, triage-labels.md

| # | Rule (source line) | Now | Target | Mechanism |
|---|---|---|---|---|
| B1 | Read CONTEXT, ADRs and ARCHITECTURE before exploring (domain.md:7-9) | 3 | 3 | Duplicate of A43. |
| B2 | Proceed silently if CONTEXT.md or ADRs are missing (domain.md:11) | 3 | delete | Stale: both exist. |
| B3 | Use glossary vocabulary; avoid the listed synonyms (domain.md:29-31) | 3 | 2 partial | Guard: the `_Avoid_:` terms in `CONTEXT.md` must not appear in identifiers or `en.json` keys, with a baseline. Prose stays guidance. |
| B4 | Flag ADR conflicts explicitly (domain.md:35-37) | 3 | 3 | Stays: judgement. |
| C1 | Use `gh` for all issue operations (issue-tracker.md:3-12) | 3 | 3 | Stays: workflow. |
| C2 | PRs are not a triage surface (issue-tracker.md:18) | 3 | 3 | Stays: workflow. |
| C3 | Wayfinder map, child, blocking and claim operations (issue-tracker.md:36-45) | 3 | 3 | Stays: workflow. |
| C4 | Don't add tickets under `.scratch/` (issue-tracker.md:49-50) | 3 | 2 | Duplicate of A41. |
| D1 | Map triage roles to label strings (triage-labels.md:5-11) | 3 | 3 | Stays. |

### apps/web/README.md

| # | Rule (source line) | Now | Target | Mechanism |
|---|---|---|---|---|
| E1 | Every new `src/components/` file is registered in `registry.json` in the same change (19) | 2 half | 2 | `registry.test.ts:54` only checks that registered files exist. Add the reverse check. Baseline 1: `src/components/money-input.tsx`. |
| E2 | Run `registry:build` before `vite build` when deploying (26-29) | 3, contradicted | 2 | `Dockerfile:18-20` runs only `vite build`. Either make `build` run `shadcn build && vite build` and call it from the Dockerfile, or delete the sentence. |

### CLAUDE.local.md (git-excluded, local checkout only)

| # | Rule (source line) | Now | Target | Mechanism |
|---|---|---|---|---|
| F1 | Fable sessions orchestrate and never implement (7) | 3 | 3 | Stays. A PreToolUse hook could block Edit/Write, but it is unverified whether hook input shows the session model. |
| F2 | Opus sessions write code directly (8) | 3 | 3 | Stays. |
| F3 | When Fable budget runs out, Opus orchestrates (9) | 3 | 3 | Stays. |
| F4 | Investigation goes to `codex exec -s read-only` or codex-worker (10) | 3 | 3 | Stays. |
| F5 | Fable codes only when both workers fail, or fail review twice (11) | 3 | 3 | Stays. |
| F6 | Fable-appropriate work list (12) | 3 | 3 | Stays. |
| F7 | Before any Edit/Write from Fable, ask "did a worker produce this?" (13) | 3 | 3 | Stays; see F1. |
| F8 | Prefix Codex-derived results with `[codex]` (14) | 3 | 3 | Stays. |

Contradiction: `CLAUDE.local.md:3` cites a section called "Fable orchestrates, Opus 5 and GPT-5.6 code", and line 7 names "GPT-5.6 Sol high". The global file it enforces now has a "Model split" section that names Opus 5.5 and GPT-6 Astra (D13).

### ADRs (required reading per domain.md:8)

| # | Rule (source) | Now | Target | Mechanism |
|---|---|---|---|---|
| G1 | Never patch query caches optimistically (ADR-0001) | 3 (0 `setQueryData`/`onMutate`) | 2 | Guard ban on both in `apps/web/src`. |
| G2 | Named command routes (ADR-0002) | | | Duplicate of A18. |
| G3 | List reads use `listQuery`/`listResponse` with keyset cursors; never fake page counts (ADR-0003) | 1 in the UI (`data-table.types.test.tsx:52`) | 1 + 2 | The `defineRead` list variant returns `listResponse` by type, and a test checks that every list route uses it. |
| G4 | Per-tenant config is data; no configuration engine (ADR-0004) | 3 | 3 | Stays: judgement. |
| G5 | Module entitlements are platform-scope (ADR-0005) | 1 | 1 | Done: `PlatformCommandDefinition` has no `module` (`platform-scope.test.ts`). |

### Private agent memory: ui-registry-conventions.md (outside the repo)

| # | Rule | Now | Target | Mechanism |
|---|---|---|---|---|
| H1 | Stock shadcn dashboard-01 look, neutral theme | 3 | 3 | Stays: taste. Move it into the repo (item 2). |
| H2 | No drag-reorder or inline cell edit (append-only ledger) | 3 | 3 | Stays. Move it into the repo. |
| H3 | DataTable exclusivity: `rowViewer` ⊕ `onRowClick`, `pagination` ⊕ `loadMore` | 1 | 1 | Done (`data-table.types.test.tsx:36,52`). |
| H4 | Every table has a `primaryColumn`, the sole click target | 3 | 1 | Make `primaryColumn` required; it is optional at `data-table.tsx:207`. |
| H5 | Row-action role gating lives in the screen config (`// role-config` seams) | 3 | 3 | Stays. 5 seams exist. |
| H6 | Toasts go through `src/lib/notify.ts`; sonner is gone | 3 (0 sonner) | 2 | Import ban: `components/ui/toast` only from `lib/notify.ts` and the provider in `shell/AppShell.tsx`. Baseline 1: `shell/branch-context.tsx:12`. |
| H7 | Anti-drift guards: palette, `{{` ban, fr/en parity | 2 | 2 | Done (`palette.test.ts`, `locales.test.ts`). |
| H8 | Tab height goes on `TabsList`, never `min-h` on triggers | 3 (0) | 2 | Guard regex for `min-h-` on `TabsTrigger`. It was already fixed once, in `08b5502`. |
| H9 | Date and time fields use the shadcn date picker, never native inputs | 3, 16 violations | 1 + 2 | `DatePicker` and `DateTimePicker` registry components (only `date-range-picker.tsx` exists), plus a guard on `type="date"` and `type="datetime-local"`. Baseline 16: `ActivityActions.tsx` 6, `ActivitySheetScreen.tsx` 4, `AssetDocumentsScreen.tsx` 2, `sheet/LegRows.tsx` 2, `AssetRegisterScreen.tsx` 1, `FinanceRecordScreen.tsx` 1. The match at `activities/sheet-model.ts:119` is a doc comment and does not count, so patterns must skip comments. See D12. |
| H10 | List contract and keyset cursors in `reads/cursor.ts` | | | Duplicate of G3. |
| H11 | Dashboard numbers are server aggregates; never count client-side | 3 | 3 | Stays: judgement. |
| H12 | Business days go through `reads/business-date.ts` (workspace timezone) | 3 | 2 | Guard: `toISOString().slice(0, 10)` only inside `business-date.ts`. 0 elsewhere; only `reads/dashboard.ts` imports the helper. |

### Vendored skills (.agents/skills, 43 skills)

| # | Rule | Now | Target | Mechanism |
|---|---|---|---|---|
| I1 | Process workflows: grilling, tdd, triage, wayfinder, code-review, handoff, writing and others | 3 | 3 | Stays: these direct how an agent works, not what code may contain. One is useful as a mechanism: `setup-ts-deep-modules/dependency-cruiser.config.cjs` is a ready rung-2 import-graph rule set that was never installed. |

### User-global rules that govern code here (~/.claude/CLAUDE.md, ~/.agents/core.md; outside the repo)

| # | Rule | Now | Target | Mechanism |
|---|---|---|---|---|
| J1 | Strict TypeScript; no `any` unless unavoidable | 1 + 3 | 2 | Guard on `as any` and `: any` in production code: 0 on `develop`, 4 in uncommitted local work. |
| J2 | Prefer type inference over redundant annotations | 3 | 3 | Stays: judgement. |
| J3 | Comments only for constraints; no narration | 3 | 3 | Stays. Counter-example: `// Step 1` through `// Step 5` in `apps/api/src/artifacts/routes.ts:119-177`. |
| J4 | Use the project's package manager | | | Duplicate of A2. |
| J5 | Don't run dev servers or builds | | | Duplicate of A6. |
| J6 | Prefer checking commands such as `lint` | 3, contradicted | 2 | `pnpm lint` is a silent no-op. Item 5 makes it real. |
| J7 | A change is not done until it has been run | 3 | 2 | `pnpm verify` gives agents one way to run it (items 25-27). |
| J8 | Never commit, push or force-push unless asked | 3 | 2 | Install the vendored `git-guardrails-claude-code` hook in a committed `.claude/settings.json` (item 3). |
| J9 | Avoid stock design defaults (cream backgrounds, pill buttons, monospace labels…) | 3 | 3 | Stays: taste. The palette guard covers raw colours. |

### Owner directives for the feature definition of done (added 2026-09-25)

| # | Rule | Now | Target | Mechanism |
|---|---|---|---|---|
| K1 | A feature is done only when its PR links a walkthrough video. The video shows the feature working in the app and nothing around it breaking, with the English UI and English captions. | 3 (owner directive; lives only in private memory: `walkthrough-video-method.md`, `videos-in-english.md`) | 2 | A PR template section, "Walkthrough video", plus a `pr-evidence` CI job. The job fails when a PR touching `apps/web/src/` or `apps/api/src/` has no https link in that section (item 4a). `pnpm verify video` produces the recording (item 26a). The link pattern stays generic, with no file-host name in the repo, per the project-scoped naming rule. |
| K2 | While testing, review the app for anything that looks wrong or broken. File each finding as its own issue or PR; never fix it inside the feature PR. | 3 | 3 | Stays: what looks wrong is a judgement call. The PR template's "Found while testing" section (issue links, or "none") is required by the same `pr-evidence` job. Findings carry the `walkthrough-finding` label so the gardener can count them. |

## 4. Spreading patterns

### Workaround markers

There are 0 `TODO`, `FIXME`, `HACK` or `XXX` markers anywhere. 7 production lines in 5 files carry workaround wording, and 23 more are in tests. Search: `grep -rniE '\b(TODO|FIXME|HACK|XXX)\b|workaround|temporar|for now|throwaway|backward compat|legacy|compat(ibility)? (facade|handler|shim)'` over `apps/api/src apps/api/scripts apps/web/src packages/*/src`.

| File | Lines | What it is |
|---|---|---|
| `packages/domain/src/money.ts` | 21, 24 | `formatXAF` accepts two call shapes "for backward compatibility" |
| `packages/contracts/src/commands/provision-workspace.ts` | 115, 130 | `legacyProvisionedBranch`, for the v1 compatibility handler |
| `apps/api/src/reads/finance.ts` | 94 | Finance keeps the legacy `entries` key where other lists use `items` |
| `packages/contracts/src/reads/assets.ts` | 49 | The same `entries` escape hatch, documented as finance-only |
| `apps/api/src/artifacts/routes.ts` | 298 | Handling of legacy upload objects |

Two more shims the grep misses: `apps/api/scripts/dev-with-storage.ts:1-2` ("consider env-driven storage there, then delete this script") and the build workaround at `apps/web/Dockerfile:18-19`.

### Escape hatches and suppressions (`develop`, production code unless stated)

| Pattern | Count | Notes |
|---|---|---|
| `as any` / `: any` | 0 (tests: 5) | 4 more in uncommitted local work |
| `@ts-ignore` / `@ts-nocheck` | 0 | |
| `@ts-expect-error` | 4 | All deliberate type tests in `data-table.types.test.tsx` |
| Non-null `!` (regex approximation) | 39 | 19 are `req.auth!` in 10 read files (`activities.ts` 4, `finance.ts` 4, `assets.ts` 3, …) |
| `as SomeType` casts | 71 | Spread thin |
| `eslint-disable` | 1 | `react-hooks/exhaustive-deps` at `ActivitySheetScreen.tsx:379`. Dead, since no ESLint runs. |
| Unused locals and params (`tsc --noEmit --noUnusedLocals --noUnusedParameters`) | api 11, web 11, contracts 0, domain 0 (tests included) | Production examples: `apps/api/src/artifacts/routes.ts:2,69`, `apps/api/src/reads/assets.ts:15`, `apps/web/src/components/data-table.tsx:78`, `apps/web/src/components/status-badge.tsx:1`, `apps/web/src/screens/AssetDocumentsScreen.tsx:52` |

### Rival paths

| Job | Rivals (usage counts) | Paved path |
|---|---|---|
| API writes | The command dispatcher (26 registered commands) vs direct writes in `artifacts/routes.ts:183` and `auth/local.ts:30,125,137` | The dispatcher (`CLAUDE.md:42`). The exceptions are undocumented, so the next upload-like route will copy `artifacts/routes.ts`. **D5.** |
| API error replies | `CommandError` with typed codes (all commands) vs 74 ad hoc `reply.status(...).send(...)` in 13 files (`artifacts/routes.ts` 17, `reads/history.ts` 11, `reads/finance.ts` 10, `reads/activities.ts` 8, …) | One typed error per route family: `CommandError` for commands, `ReadError` from `defineRead` for reads. Typed codes are what `CLAUDE.md:68` requires. |
| API route gating | Commands declare `allowedRoles`, `module` and `branchAuthorization`. Reads use `preHandler: requireAuth`, plus hand-written checks in some handlers (`history.ts:207`, `members.ts:69`, `branches.ts:57`) and none in others (the 4 routes in `finance.ts`) | Declarative for both (items 8-9). The hand-written path produced #40, #58 and #59. |
| Command HTTP route | Named `POST /v1/commands/:name` (web client, `apps/web/src/commands/client.ts:46`) vs generic `POST /v1/commands` (32 test sites, 18 in `scripts/smoke.ts`, `test/seed.ts:98`) | The named route (ADR-0002). Tests are what agents copy, so the facade keeps spreading until the tests move. |
| Web reads | TanStack Query (`queryFn` in 18 files), but each module hand-writes its own `fetchX(token, …, fetchImpl = fetch)`. 20 files reference `fetch` directly, and `documents/useCategories.ts` fetches inline in its `queryFn` | A TanStack Query hook per resource, over one shared `readJson(path, guard)` helper (items 20-21). |
| Web read validation | Structural guards (`function is*`: 26) vs Zod `parse`/`safeParse` (9) | Structural guards, per the recorded decision that client reads validate structurally, not through Zod. That decision exists only in private memory today; item 2 writes it down. |
| Web writes | `commandClient` plus command intents, for all writes (0 `useMutation`, 0 raw POST) | Already one path. |
| Forms | react-hook-form + `zodResolver` (7 files) vs command UIs driven by `useState` (8 files: `ActivityActions.tsx` with 42 `useState` lines, `AssetActions.tsx`, `MemberActionDialog.tsx`, `BranchActionDialog.tsx`, `AssetDocumentsScreen.tsx`, `FinanceApprovalsScreen.tsx`, `FinancePeriodsScreen.tsx`, `FinanceEntryDetailScreen.tsx`) | react-hook-form. It is the documented `components/ui/form.tsx` path and carries field errors and aria wiring. |
| Form schema source | A local `z.object` rebuilt in all 7 RHF forms (e.g. `branches/CreateBranchDialog.tsx:80-100`) vs the contract payload schema (0) | Derive the schema from the contract (items 13-17). The local copies drifted twice: #19, #22. |
| Date and time input | `date-range-picker.tsx` (1 component) vs native `type="date"`/`"datetime-local"` (16 sites) | Registry date pickers, subject to **D12**. No single-date picker exists yet, so agents fall back to native inputs. |
| Toasts | `lib/notify.ts` (17 calls in 12 files) vs a direct `components/ui/toast` import (`shell/branch-context.tsx:12`) | `notify.ts`. |
| Tables | `DataTable` (10 files) vs raw `<table>` (only the `ui/table.tsx` primitive) | Already one path. |
| Web authorization | Role checks in screens (9 in 8 files, 5 `// role-config` seams) on `develop` vs CASL `useCan` (uncommitted local work, #47) | Server-computed capabilities with a typed `useCan(commandName)` and no CASL (D6, items 9a-9b). |
| i18n | `t()` everywhere. The only hard-coded text is in vendored primitives (`ui/sheet.tsx:73` "Close", `ui/sidebar.tsx:277,289` "Toggle Sidebar") | Already one path. A literal-string guard with those 3 as its baseline keeps it that way. |
| Money formatting | `formatXAF` in `@routiq/domain`, wrapped by `apps/web/src/lib/format.ts` | One path, with a dual-signature shim (`money.ts:21-24`). |
| Routing | TanStack Router only (`router.tsx`) | One path. |

### Duplicated and dead code

- `isRecord` is defined twice with the same signature: `apps/api/scripts/provision.ts:282` and `apps/web/src/assets/api.ts:152`.
- 22 unused locals or parameters (see the table above).
- `src/components/money-input.tsx` is not in `registry.json`.
- No dead-code or duplication tool is installed: `knip`, `ts-prune`, `jscpd`, `madge` and `depcruise` are all absent from `PATH` and `node_modules/.bin`. Unused exports and copy-paste blocks were therefore not measured.

## 5. History

Window: 2026-06-27 to 2026-09-25, on `origin/develop`. The repository's first commit is `0448daf` (2026-07-22), so the window covers its whole life.

### Survivors baseline

| Measure | Value | Command |
|---|---|---|
| Commits reachable from `develop` | 254 (219 non-merge, 35 merges) | `git log origin/develop --since=2026-06-27` with `--no-merges` / `--merges` |
| PRs merged | 18: 11 into `main` (#2-#12) and 7 into `develop` (#48-#54) | `gh pr list --state merged --limit 200` |
| PRs closed unmerged | 1: #1 "Add CI workflow", replaced by #2 | `gh pr list --state closed`, `mergedAt == null` |
| Reverts | 0 | `git log origin/develop --since=2026-06-27 -i --grep='revert\|back out\|undo'` |
| **Reverts per 100 merges** | **0** (0 of 35 merge commits; 0 of 18 PRs) | |
| First-parent commits | 173. Before `develop` existed, `main` took at most 11 of 166 through a PR. Since 2026-09-05, all 7 first-parent commits on `develop` are PR merges, each with green `ci` and 0 reviews. | `git log --first-parent origin/develop`; `gh pr view <n> --json statusCheckRollup,reviews` |
| Fix-vocabulary commits | 17 | subjects matching `fix|correct|repair|restore|missing|broken|typo|oops|address review|follow-?up` |
| Fast-follow fixes: a fix commit within 24 h of an earlier commit on a shared file (locale and lock files excluded) | 9 of 219 non-merge commits (4.1%) | scratch script over `git log origin/develop --no-merges --name-only` |

Zero reverts does not mean everything survived. This repo corrects forward. Review findings become issues (#13-#25, #55-#60) and land as ordinary commits that cite the issue, for example `c9353ab` "Trim branch names before the length check (#19)". The gardener should track fast-follow fixes and new `bug` issues each week, alongside reverts.

The `develop` flow is recent, and it is already better on one axis: every change since 2026-09-05 went through a PR with green CI. Nothing enforces that yet (D2, items 4-6).

### Fast-follow fixes

| Fix | Earlier commit | Gap | What was corrected |
|---|---|---|---|
| `13368fb` Fix ROUTIQ API container health probe | `5547818` | 0.1 h | Compose health check broken by the rename |
| `bed1018` fix(finance): reconcile total drill-through with signed ledger (#40) | `b8667f3` | 0.1 h | Signed-amount handling in executive totals |
| `5ce9388` Add finance nav + fix critical intent misrouting | `5ba6915` | 0.2 h | A command intent sent to the wrong command |
| `fc467e4` Add auth: memberships, fixed roles, username/PIN sessions | `b4e59fe` | 0.3 h | False positive on the word "fixed" (test harness adjusted) |
| `5497dac` Fix record screen branch selection (finance-web 03 review bug) | `17d9ea6` | 0.4 h | Branch selection logic |
| `08b5502` Fix tabs active pill: size the strip, never the trigger | `35053f7` | 0.5 h | UI primitive misuse |
| `35bead6` Fix denied-flash, table i18n, raw enums/UUIDs, filter debounce | `5c915c2` | 0.7 h | Raw enums and UUIDs shown to users; missing i18n |
| `1e069d0` Re-vendor form on Base UI useRender, restore RHF field + aria wiring | `38bfebf` | 1.0 h | A vendored primitive lost its form wiring |
| `66461f4` Fix 500 on asset-less posting detail (finance-web review bug) | `5ce9388` | 8.9 h | A read crashed on a missing optional relation |

### Highest-churn files (commits on `develop`, merges excluded)

Command: `git log origin/develop --no-merges --since=2026-06-27 --format='' --name-only | sort | uniq -c | sort -rn`

| Commits | File |
|---|---|
| 65 | `apps/web/src/i18n/locales/fr.json` |
| 63 | `apps/web/src/i18n/locales/en.json` |
| 32 | `apps/api/src/server.ts` |
| 31 | `packages/contracts/src/index.ts` |
| 22 | `apps/web/src/screens/FinanceEntriesScreen.tsx` |
| 20 | `apps/web/src/screens/FinanceRecordScreen.tsx`, `apps/web/src/screens/AssetsStub.tsx` |
| 19 | `apps/web/src/screens/FinanceApprovalsScreen.tsx`, `apps/web/src/screens/AssetRegisterScreen.tsx` |
| 18 | `apps/web/src/screens/FinanceEntryDetailScreen.tsx`, `apps/web/src/router.tsx`, `apps/api/src/db/schema.ts`, `apps/api/drizzle/meta/_journal.json` |
| 17 | `packages/contracts/src/errors.ts`, `apps/web/package.json`, `apps/api/src/commands/dispatcher.ts` |
| 16 | `pnpm-lock.yaml`, `apps/web/src/screens/FinancePeriodsScreen.tsx` |
| 14 | `apps/web/registry.json` |

The top of the list is shared registration points: the locale catalogs, `server.ts`, the contracts barrel, `router.tsx` and `errors.ts`. Every feature touches all of them. That is where merge conflicts and "forgot to register" bugs come from. The feature map (items 28-29) and per-module registration spread that load.

### Review comments

The 18 merged PRs have 0 formal reviews and 26 comments. All 26 are by `coderabbitai`, and all are status notices: the review was skipped on a non-default base branch, or rate-limited. There are no human review comments to sample. The review signal lives in issues instead.

### Recurring correction themes

Each theme is in the rule table or the plan.

| Theme | Evidence | Where it lands |
|---|---|---|
| Missing or misordered scope gates | Reads: #40 (`b8667f3`, `bed1018`); #58 (history skips branch scope); #59 (finance, dashboard and documents reads lack module and role gates, https://github.com/truesignal-digital/routiq/issues/59). Commands: #16 (inactive-branch refusal ran before the scope check, `branch-authorization.ts:54`) | Items 7-9 |
| Client validation drifts from the command schema | #19 (whitespace-only names accepted); #22 (the rename dialog accepts names the API rejects); `77a84a9` "Validate branch names in the dialogs against the command schema"; `8726088` "make the length message reachable" | Items 13-17 |
| Contract changed without a version bump | #20, fixed by `47a678a` "Bump provision-workspace to v2 with a v1 compatibility handler" | Item 12 |
| Missing composite tenant FK | #15, fixed by `0b48118` | Item 10 |
| UI primitive misuse and touch targets | `08b5502` (tabs), `1e069d0` (form wiring), #23 (44 px target), #57 (the header turns see-through) | H8, item 2 |
| Business dates and time zones | #41 (PR #50); #55 (approvals show the submission date as the economic date) | H12 |
| Ledger sign and attribution | `bed1018`; #60 (a reversal drops activity and person attribution) | A28, item 11 |
| Changes that never passed checks | #24 (order-dependent test), PR #5 (de-flake) | Items 4-6 |
| Review-found logic bugs in UI flows | `5497dac`; `5ce9388` ("critical intent misrouting"); `66461f4` (500 on asset-less posting detail) | Items 25-27: drive the flows, not only unit-test them |

## 6. Decisions for the owner

These decisions block plan items. Fill in the Answer column before running an item that a decision blocks. On 2026-09-25 the owner delegated every open decision to the auditor's judgement. Each answer gives its reason.

| # | Decision | Blocks | Options | Answer |
|---|---|---|---|---|
| D1 | Base branch for plan work | Every item | `develop`, where PRs #48-#54 landed; or `main` | **`develop`** (owner, 2026-09-25) |
| D2 | Make `ci` a required check. The protection and rulesets APIs return 403 on this private free-plan repo. | Item 4, ruleset step only. The hook and the `develop` trigger can land without it. | (a) Move the org to GitHub Team and add a ruleset requiring `ci` on `develop` and `main`. (b) Make the repo public. (c) Skip the ruleset and rely on CI plus the pre-push hook, which `--no-verify` or a direct push bypasses. | **(c) for now** (delegated). Every `develop` change since 2026-09-05 already came through a PR with green `ci`, and the owner is the only merger. Item 32 reports direct pushes to `develop` and PRs merged with a failing `ci`; the first non-zero week reopens this in favour of (a). |
| D3 | Where `TRUST_AUDIT.md` lives | Every item run in a worktree, because worktrees do not copy untracked files; also items 31-33, which compare against its baselines | (a) Commit it to `develop`. (b) Keep it outside the repo and pass its path to each run. It names out-of-repo files (`~/.claude/CLAUDE.md`, `~/.agents/core.md`, `~/.codex/config.toml`, the private memory file) and the model names in `CLAUDE.local.md`, so decide whether those belong in the repo. | **Commit it** (delegated). Item 1 adds it as `docs/audits/2026-09-25-trust-audit.md`. The living rules move to `AGENTS.md` and `tools/guards/`, so the snapshot never needs editing. The repo is private, so the out-of-repo file references can stay. |
| D4 | Uncommitted work in the local `main` checkout: the capabilities work, the maintenance prototype (#31), and the new `.scratch/` and `docs/research/` files | Any session run in that checkout. Item 5's J1 and A9 guards will flag the capabilities files as they stand. | (a) Move the work to its own branch off `develop`. (b) Finish and merge the capabilities work first, fixing its 4 `as any` and 2 Zod 3 spellings. | **Neither: leave the checkout alone** (delegated). All plan work runs in worktrees off `develop`. Item 9a ports the capabilities code and fixes it there. The prototype stays local until #31 closes. |
| D5 | Which direct DB writes outside commands are allowed? Session and credential writes (`auth/local.ts:30,125,137`) and artifact registration (`artifacts/routes.ts:183`) bypass the dispatcher. | Item 22, and the final allowlist in item 5 | (a) An ADR sanctions the auth and session writes, and artifact registration moves into a `register-artifact.v1` command, so evidence gets a receipt and an audit event. (b) An ADR sanctions both. (c) Move both into commands. | **(a)** (delegated). Auth and session state is infrastructure, not business records. Evidence files are business records, so their registration needs a receipt and an audit event. |
| D6 | The web authorization path: role checks and `// role-config` seams (on `develop`), or CASL capabilities (uncommitted, tied to #47) | Merging the capabilities work; afterwards, a guard banning the other path | (a) Pick CASL before the capabilities work merges, and migrate the 9 role checks. (b) Keep role checks and drop CASL. (c) Keep the server-computed capabilities read, drop CASL, and use a typed lookup. Either way, avoid letting both merge. | **(c)** (delegated). The uncommitted `lib/capabilities.tsx:20-29` uses CASL only to look up allowed (command, module) pairs, with no conditions, and its typing costs 4 `as any`. A typed `useCan(commandName)` over a `Set` built from `GET /v1/capabilities` does the same job with no dependency. The server stays the only access boundary. |
| D7 | The money wire type. `CLAUDE.md:55` says `bigint`; the wire uses `z.number().int()` (`envelope.ts:32`), which is safe up to 2^53 XAF. | Item 23 (deferred) | (a) Keep the safe-integer wire, document it, and add a branded `MinorUnits` type. (b) Switch the wire to string-encoded bigint. That bumps the version of every command that carries money. | **(a)** (delegated). XAF amounts stay far below 2^53, and a wire change would bump every money command for no gain. |
| D8 | Add a linter dependency, or keep lint as guard tests only. typescript-eslint's typed rules use the TypeScript JS API, and its compatibility with the TS 7 native compiler is unverified. | None: items 5-6 work either way. It decides whether `react-hooks/exhaustive-deps` is enforced. | (a) Guard tests now; revisit oxlint for react-hooks once it is verified against this toolchain. (b) Add ESLint and typescript-eslint now. | **(a)** (delegated). Guard tests extend an idiom the repo already uses and add no toolchain risk. |
| D9 | Add `@playwright/test`, plus a Chromium download in CI | Items 26-27 | (a) Add it. (b) Use only the in-app browser tooling, which leaves CI without UI evidence. | **(a) Yes** (delegated). The K1 recordings already use Playwright; bringing it into the repo makes them reproducible. |
| D10 | When can the generic `POST /v1/commands` facade go? Something outside this repo may still call it: demo-box scripts, provisioning runs, other clients. | The facade-removal step in item 33 | (a) Confirm there is no outside caller, then delete the facade once the item 6 baseline reaches 0. (b) Keep it, and document it as permanent in ADR-0002. | **(a)** (delegated). Move every caller in the repo first. The route then logs each call, and it is deleted after 2 weeks with no calls on the demo box. |
| D11 | Where the gardener runs | Item 33 | (a) A weekly GitHub Actions cron that opens an issue and one PR. (b) A scheduled Claude cloud routine. (c) A manual weekly session. | **(a)**, report only (delegated). The cron posts the numbers; agent sessions take the cleanup PRs. |
| D12 | Confirm the 2026-07-31 directive "never native date inputs" before converting 16 inputs. The native picker is well supported on low-end Android. | Items 18-19 | (a) Keep the directive and build the registry pickers. (b) Allow native inputs on touch devices and use the picker on desktop. (c) Drop the directive and delete rule H9. | **(a)** (delegated). It is the owner's standing directive, and one picker keeps behaviour the same on every device. |
| D13 | `CLAUDE.local.md` is personal and git-excluded, and its model names and section reference are stale. | Item 30, for that file only | (a) Update it to the current model split. (b) Delete it; the global file already covers it. (c) Leave it. | **(a)** (delegated). Update the model names and keep the rules. |

## 7. Plan

Order:
1. S items that change what every later session sees.
2. Architecture and static checks, most frequent mistakes first.
3. The verification CLI.
4. The feature map.
5. Guidance cleanup.
6. The gardener.

Each item fits one session and one reviewable diff. No item bundles more than 5 rules with existing violations. Before it changes anything, each run proves its gap again on `develop`, since line numbers drift.

Later items build on earlier ones:
- Item 4's hook calls the `pnpm lint` that item 5 makes real.
- Items 8-9 use item 7's read-only transaction.
- Items 14-17 use item 13's hook.
- Item 19 empties the H9 baseline from item 6.
- Items 9a-9b use `defineRead` from item 8.
- Item 26 visits routes from the feature map in item 28 once it exists.
- Item 26a reuses item 26's Playwright setup.

**1. Root `AGENTS.md` that every agent loads.** Rung 3 · S · no new dependency
- Build: move the body of `CLAUDE.md` into `AGENTS.md`. `CLAUDE.md` keeps `@AGENTS.md` plus Claude-only notes. Codex reads `AGENTS.md`; Claude Code follows the import. `AGENTS.md` also holds the feature definition of done:
  - a feature-map entry;
  - a versioned contract;
  - writes through `registerCommand` and reads through `defineRead`;
  - UI built on the paved paths;
  - green checks with no baseline raised;
  - K1: a walkthrough video link in the PR;
  - K2: testing findings filed separately.

  The same PR commits this audit as `docs/audits/2026-09-25-trust-audit.md` (D3).
- Files: `AGENTS.md`, `CLAUDE.md`, `docs/audits/2026-09-25-trust-audit.md`.
- Proof: `codex exec -s read-only "Which headless UI library and package manager must this repo use?"` answers Base UI and pnpm without being told.

**2. Web conventions into the repo.** Rung 3 · S · no new dependency
- Build: create `apps/web/AGENTS.md`, plus `apps/web/CLAUDE.md` containing `@AGENTS.md`. Put in them the rules now held only in `~/.claude/projects/-Users-linusbayere-Developer-routiq/memory/ui-registry-conventions.md`: DataTable (`primaryColumn`, `rowActions`, keyset pager), toasts through `notify.ts`, tab sizing, the date-picker directive, registry registration, structural read validation and business dates. Sessions in a worktree do not load that memory, so give the implementing session this path.
- Files: `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`.
- Proof: `codex exec -s read-only "How should a toast and a date field be built in apps/web?"` answers `notify.ts` and the registry date picker.

**3. Git guardrails for agent sessions.** Rung 2 · S · no new dependency
- Build: run the vendored `git-guardrails-claude-code` skill. It commits a `.claude/settings.json` PreToolUse hook that blocks `git push --force`, `reset --hard`, `clean -f` and `branch -D`.
- Files: `.claude/settings.json`, the hook script.
- Proof: in a Claude session, the hook refuses `git push --force`.

**4. Make the existing checks block.** Rung 2 · S · no new dependency
- Build: add `develop` to `push.branches` in CI. Commit `.githooks/pre-push` running `pnpm typecheck && pnpm lint`, and set `core.hooksPath` from a root `prepare` script. No ruleset for now (D2): item 32 watches for the cases a ruleset would have blocked.
- Files: `.github/workflows/ci.yml:5-6`, `.githooks/pre-push`, `package.json`.
- Proof: the hook refuses a push of a branch with a deliberate type error, and a push to `develop` starts a `ci` run (`gh run list --branch develop`).

**4a. PR template and evidence check (K1, K2).** Rung 2 · S · no new dependency
- Build: `.github/pull_request_template.md` with three sections: "What changed", "Walkthrough video" and "Found while testing". A `pr-evidence` job runs on `pull_request` events (`opened`, `edited`, `synchronize`, `reopened`). It fails when a PR touching `apps/web/src/` or `apps/api/src/` has no https link under "Walkthrough video", or has an empty "Found while testing" section ("none" is allowed). Create the `walkthrough-finding` label.
- Files: `.github/pull_request_template.md`, `.github/workflows/pr-evidence.yml`.
- Proof: a test PR that touches `apps/web/src/` without a link fails `pr-evidence`. Adding a link and "none" to the PR body makes it pass without a new push, through the `edited` event.

**5. Guard harness, a real `pnpm lint`, and the zero-violation bans.** Rung 2 · M · new root devDependency `vitest` (already used in every package)
- Build: a shared `forbid({ id, pattern, include, exclude, baseline })` helper in `tools/guards/`, generalising the `palette.test.ts` idiom, with patterns that skip comments. Root `lint` runs it, and CI gets a `pnpm lint` step. Unless D8 adds ESLint, delete the dead `eslint-disable` at `ActivitySheetScreen.tsx:379`.
- Bans with 0 violations on `develop` today:
  - A2 lockfiles; A7/A11 exact pins; A9 Zod 3 spellings; A10 Tailwind config; A12 Radix
  - A24 money `/ 100`; A33 Supabase, and `@aws-sdk` outside `storage/`; A35 AI SDKs
  - A38 `t()` concatenation; A41 new `.scratch/` files; G1 optimistic cache writes
  - H8 `min-h` on `TabsTrigger`; H12 `toISOString().slice(0, 10)`; J1 `any`
  - prototype imports in `router.tsx`
  - A16 DB writes outside an allowlist: commands, provisioning, db, `auth/local.ts`, `artifacts/routes.ts`
- Files: `tools/guards/*.test.ts`, `tools/guards/baselines/`, root `package.json`, root `vitest.config.ts`, `ci.yml`.
- Proof: `pnpm lint` passes on a clean `develop` tree. Adding `import "@radix-ui/react-dialog"` to any web file makes it fail with the rule id and `file:line`.

**6. Baselined guards for the rules with live violations.** Rung 2 · S · no new dependency
- Build: four rules with recorded baselines:
  - H9 native date inputs: 16
  - A18 `"/v1/commands"` literal: 51
  - E1 unregistered component files: 1 (`money-input.tsx`)
  - H6 direct toast import: 1 (`shell/branch-context.tsx:12`)
- Files: `tools/guards/`, `apps/web/src/registry.test.ts`.
- Proof: `pnpm lint` passes and prints the four baseline sizes. A new `type="date"` input fails it; the same text inside a comment does not.

**7. Read-only transactions for reads.** Rung 1 · S · no new dependency
- Build: `inWorkspaceRead` runs `SET TRANSACTION READ ONLY` after `set_config`.
- Files: `apps/api/src/db/tenant.ts`, a new test.
- Proof: a test shows that `tx.insert(...)` inside `inWorkspaceRead` is rejected with SQLSTATE `25006`.

**8. `defineRead`, with finance, dashboard and documents moved onto it (#59).** Rung 1 · M · no new dependency
- Build: `ReadDefinition { path, module, allowedRoles, branchScope, query, handler(tx: ReadTx, auth: AuthContext) }`. The wrapper:
  - runs the auth, module, role and branch checks;
  - uses `inWorkspaceRead`;
  - returns a typed `ReadError(code)`;
  - hands the handler a non-optional `AuthContext`.

  A Fastify `onRoute` hook throws at boot for any `/v1` GET not built with it. Its allowlist of unmigrated routes is emptied by item 9.
- Files: new `apps/api/src/reads/define-read.ts`, `reads/finance.ts`, `reads/dashboard.ts`, `reads/documents.ts`, `server.ts`.
- Proof: the #59 regression tests pass: a disabled module gives 403 `MODULE_DISABLED`, and a role without finance access gives 403. A boot test asserts that every `/v1` GET outside the allowlist declares `module` and `allowedRoles`.

**9. Move the remaining reads onto `defineRead` (#58).** Rung 1 · M · no new dependency
- Build: migrate `history`, `activities`, `assets`, `branches`, `members`, `categories` and `reference`, then empty the `onRoute` allowlist.
- Files: those 7 files in `apps/api/src/reads/`.
- Proof: the #58 regression test passes (history outside branch scope returns no rows). `grep -c 'req.auth!' apps/api/src/reads/*.ts` and `grep -c 'reply.status' apps/api/src/reads/*.ts` report 0 for every file.

**9a. Capabilities read and typed `useCan` (D6).** Rung 1 · M · removes `@casl/ability` and `@casl/react`
- Build: land the server-computed `GET /v1/capabilities` from the uncommitted work, built on `defineRead`. On the web side, `useCan(commandName)` is a typed lookup over a `Set` of allowed command names, with an `approvalMode` lookup beside it. It keeps the existing note that this is a render hint, never an access boundary. Fix the 4 `as any` and 2 Zod 3 spellings on the way.
- Files: `apps/api/src/reads/capabilities.ts`, `packages/contracts/src/capabilities.ts`, `apps/web/src/lib/capabilities.tsx`, `apps/web/package.json`.
- Proof: the capabilities tests pass, and the J1 and A9 guards read 0 on these files. `grep -rn '@casl' apps/web/src apps/web/package.json` returns nothing.

**9b. Move screen role checks onto `useCan`.** Rung 1/2 · S · no new dependency
- Build: replace the 9 role checks in 8 files, and the 5 `// role-config` seams, with `useCan`. Add a guard: no `role ===` or `roles.includes` in web screens and feature folders, and no `@casl` imports.
- Files: the 8 files, `tools/guards/`.
- Proof: the guard reads 0. A screen test shows that a member without finance roles sees no finance actions.

**10. Catalog invariants test.** Rung 2 · M · no new dependency
- Build: one test over `pg_catalog`, with an allowlist per rule. It checks that:
  - every table with `workspace_id` has RLS enabled and forced;
  - every FK between tenant tables includes `workspace_id`;
  - business tables carry `created_by_command_id`;
  - mutable tables carry `row_version`;
  - append-only tables have UPDATE and DELETE revoked.
- Files: new `apps/api/src/db/catalog-invariants.test.ts`.
- Proof: `pnpm --filter @routiq/api exec vitest run src/db/catalog-invariants.test.ts` passes, and a scratch migration that drops the composite FK from #15 makes it fail.

**11. Postings must sum to their entry, enforced in the DB.** Rung 1 · S · no new dependency
- Build: a deferred constraint trigger on `financial_postings`.
- Files: a new migration under `apps/api/drizzle/`, and a test in `apps/api/src/commands/record-expense.test.ts`.
- Proof: a raw insert of mismatched postings inside a transaction fails at commit, and `migration-replay.test.ts` still passes.

**12. Contract and registry completeness.** Rung 2 · S · no new dependency
- Build: snapshot `z.toJSONSchema(schema)` per `name.vN` to `packages/contracts/snapshots/`, so editing a shipped version fails (#20). Extend `commands/registry.test.ts` to check that:
  - every command has a contracts file and a co-located test (A19, baseline 8);
  - names are kebab-case (A21);
  - no payload key names a tenant, actor or principal (A22);
  - asset-bearing payloads declare `operationalAssetId` or sit on an exemption list (A31).
- Files: `packages/contracts/src/versions.test.ts`, `packages/contracts/snapshots/`, `apps/api/src/commands/registry.test.ts`.
- Proof: renaming a field in `provision-workspace` v2 fails `pnpm --filter @routiq/contracts test`, while adding v3 as a new schema passes.

**13. `useCommandForm`, with the branch and member dialogs moved onto it (#19, #22).** Rung 1 · M · no new dependency
- Build: `useCommandForm(payloadSchema, { pick, extend })` in `apps/web/src/commands/`. It combines react-hook-form, `zodResolver`, the existing `zod-error-map.ts`, command intents and `field-errors.ts`, and it derives the form schema from the contract. Migrate `CreateBranchDialog.tsx`, `BranchActionDialog.tsx` and `AddMemberDialog.tsx`.
- Files: `apps/web/src/commands/use-command-form.ts` and those 3 dialogs.
- Proof: a shared test feeds each dialog the contract's invalid fixtures (a whitespace-only name, an over-length name) and expects the same rejections the API gives.

**14. Move the remaining RHF forms onto `useCommandForm`.** Rung 1 · M · no new dependency
- Build: migrate `FinanceRecordScreen.tsx`, `AssetRegisterScreen.tsx`, `ActivitySheetScreen.tsx` and `RegisterPersonDialog.tsx`. `LoginScreen.tsx` keeps a local schema, because login is not a command. Add a guard: no `z.object(` in `*Screen.tsx` or `*Dialog.tsx` files other than the login screen.
- Files: those 4 files, `tools/guards/`.
- Proof: the guard passes at 0, and the existing screen tests pass.

**15. Move the asset and member action dialogs off `useState`.** Rung 1 · M · no new dependency
- Build: move `AssetActions.tsx`, `MemberActionDialog.tsx` and `AssetDocumentsScreen.tsx` onto `useCommandForm`.
- Files: those 3 files.
- Proof: `grep -c useState` falls in each file, and the existing tests pass.

**16. Move `ActivityActions.tsx` off `useState`.** Rung 1 · M · no new dependency
- Build: migrate its dialogs onto `useCommandForm`. The file has 42 `useState` lines today.
- Files: `apps/web/src/activities/ActivityActions.tsx` and its tests.
- Proof: the activity action tests pass, and `grep -c useState apps/web/src/activities/ActivityActions.tsx` is below 10.

**17. Move the finance decision dialogs off `useState`.** Rung 1 · S · no new dependency
- Build: the approve and reject notes, period lock and reopen, and reversal dialogs in `FinanceApprovalsScreen.tsx`, `FinancePeriodsScreen.tsx` and `FinanceEntryDetailScreen.tsx`.
- Files: those 3 files.
- Proof: the finance screen tests pass, and an empty reject reason gets the contract's error.

**18. Date and date-time pickers.** Rung 1 · M · no new dependency · blocked by D12
- Build: `date-picker.tsx` and `date-time-picker.tsx` registry components on Popover and Calendar, as `date-range-picker.tsx` does.
- Files: `apps/web/src/components/`, `apps/web/registry.json`.
- Proof: component tests cover keyboard entry and fr-CM formatting, and `registry.test.ts` passes.

**19. Replace the 16 native date inputs.** Rung 1 · M · no new dependency · after item 18
- Build: finance and assets first (4 sites), then activities (12 sites). Use two commits in one PR, or two PRs if review asks for it.
- Files: `FinanceRecordScreen.tsx`, `AssetRegisterScreen.tsx`, `AssetDocumentsScreen.tsx`, `ActivityActions.tsx`, `ActivitySheetScreen.tsx`, `activities/sheet/LegRows.tsx`.
- Proof: the H9 guard baseline is 0.

**20. Shared web read helper, first half.** Rung 1 · M · no new dependency
- Build: `apps/web/src/lib/read.ts` exporting `readJson(path, guard, { token, signal })`, which sets auth headers, handles 401 and extracts API errors. Migrate assets, branches, members, documents (including the inline fetch in `useCategories.ts`), dashboard and `auth/me.ts`.
- Files: `lib/read.ts` and those modules.
- Proof: the hook tests pass unchanged.

**21. Shared web read helper, second half.** Rung 1 · S · no new dependency
- Build: migrate activities, finance and history. Add a guard: `fetch(` appears only in `lib/read.ts`, `commands/client.ts`, `artifacts/upload.ts` and `auth/api.ts`.
- Files: those modules, `tools/guards/`.
- Proof: the guard passes at 0.

**22. Record which writes may bypass commands.** Rung 1/3 · S for the ADR, M if a new command is needed · no new dependency · blocked by D5
- Build: ADR-0006 following D5, plus a `register-artifact.v1` command if option (a) is chosen. Tighten the item 5 allowlist to match.
- Files: `docs/adr/0006-*.md`, possibly `apps/api/src/artifacts/routes.ts` and a new command.
- Proof: adding `tx.insert(...)` to any file outside the allowlist fails `pnpm lint`.

**23. Money type (deferred).** Rung 1 · M · no new dependency · blocked by D7
- Deferred because `develop` has 0 money violations and the history has no money bug.
- Build: a branded `MinorUnits` type in `@routiq/domain`. API finance code uses the domain helpers, and `CLAUDE.md:55` states the wire type.
- Files: `packages/domain/src/money.ts`, the API finance commands and reads.
- Proof: `pnpm typecheck` rejects a plain `number` where `MinorUnits` is expected, and the A24 guard stays at 0.

**24. Smoke test as a script, run in CI.** Rung 2 · S · no new dependency
- Build: add `smoke` to `apps/api/package.json`. Move `scripts/smoke.ts` to named routes, which removes 18 from the A18 baseline. Run it in CI against the Postgres service CI already starts.
- Files: `apps/api/scripts/smoke.ts`, `apps/api/package.json`, `ci.yml`.
- Proof: `pnpm --filter @routiq/api smoke` exits 0 locally and in CI.

**25. `pnpm verify` without a browser.** Tooling · M · no new dependency
- Build: `tools/verify.ts` with these subcommands:
  - `--help`
  - `up`: start compose Postgres on 5435, migrate, run `seed-dev`, and start the API on :3001 and the web app on :5173, reusing servers that are already running
  - `smoke`: run item 24's script
  - `logs` and `down`

  Every run writes to `.verify/<timestamp>/`, prints its evidence paths and exits non-zero on any failure. Replace the untracked `.claude/launch.json` with a committed one that calls these commands.
- Files: `tools/verify.ts`, root `package.json`, `.claude/launch.json`, `.gitignore` (add `.verify/`).
- Proof: `pnpm verify up && pnpm verify smoke && pnpm verify down` exits 0 and prints log paths under `.verify/`.

**26. `pnpm verify ui <route or feature id…>`.** Tooling · M · new dependency `@playwright/test` · blocked by D9
- Build: log in with the `seed-dev` credentials, visit each route (feature ids resolve through item 28's map), and save screenshots and console errors to `.verify/<timestamp>/`.
- Files: `tools/verify.ts`, `tools/verify/ui.ts`.
- Proof: `pnpm verify ui /assets /finance/entries` exits 0 and writes two PNGs and an empty `console-errors.txt`.

**26a. `pnpm verify video <feature-id>` (K1).** Tooling · M · reuses item 26's Playwright; needs `ffmpeg` on the machine
- Build: bring the walkthrough pipeline that now lives outside the repo into `tools/verify/video.ts`. It:
  - switches the app to English first, then navigates by clicks only;
  - drives the feature's flow script (from the feature map, once item 29 lands);
  - adds caption, cursor and live-evidence overlays;
  - records narration;
  - writes the mp4 to `.verify/<timestamp>/`.

  A `--dry` flag saves one screenshot per step for review before recording. Narration uses macOS `say`, so recording runs on the owner's Mac, not in CI. Uploading stays a separate step outside the repo, so no file-host name enters it.
- Files: `tools/verify/video.ts`, `tools/verify/overlays/`.
- Proof: `pnpm verify video <feature-id> --dry` writes one screenshot per flow step. A full run writes an mp4 whose sampled frames show the English UI and English captions.

**27. UI evidence in CI.** Rung 2 · S · no new dependency beyond item 26
- Build: a CI job that runs `pnpm verify up && pnpm verify ui` on PRs and uploads `.verify/` as an artifact.
- Files: `ci.yml`.
- Proof: a PR run shows the artifact with screenshots.

**28. Feature map skeleton and completeness test.** Tooling · M · no new dependency
- Build: `docs/features.json` with `{ id, titleKey, routes, commands, reads, entryFiles }`, seeded from `router.tsx` (18 paths), `listCommands()` (26) and the read routes. A test fails when a route, command or read is unmapped, or when an entry file does not exist.
- Files: `docs/features.json`, `apps/web/src/features.test.ts`.
- Proof: `pnpm --filter @routiq/web exec vitest run src/features.test.ts` passes, and adding a route without a map entry makes it fail.

**29. Feature map selectors and flows.** Tooling · M · no new dependency
- Build: add `selectors: [{ role, nameKey }]` and `flow` steps, drawing on the tester handbook on the `docs/tester-handbook` branch. The test checks that every `nameKey` exists in `fr.json` and `en.json`.
- Files: `docs/features.json`, `features.test.ts`.
- Proof: the test passes, and `pnpm verify ui` accepts a feature id and visits its routes.

**30. Fix stale and contradicting guidance.** Rung 3 · S · no new dependency
- Build: fix these:
  - `CLAUDE.md:49` (26 commands), `:55` (the wire type), `:65` (the outbox is planned), and the Commands list (`pnpm lint`, `pnpm verify`).
  - `docs/agents/domain.md:9` ("v0.2"); delete `docs/agents/domain.md:11`.
  - `apps/web/README.md:12` (the port) and `:26-29` (the registry build).
  - The stale comment at `apps/api/src/commands/dispatcher.ts:208`, which says workspace commands have no `redactPayload` although line 154 defines one.
  - `CLAUDE.local.md:3,7`, following D13.
- Files: the files named.
- Proof: `grep -n '~16' CLAUDE.md AGENTS.md` and `grep -n 'proceed silently' docs/agents/domain.md` return nothing, and a reviewer reads the diff.

**31. Replace enforced prose with guard pointers.** Rung 3 · S · no new dependency · after items 5-12
- Build: in the `AGENTS.md` files, each rule that a guard, type or test now enforces becomes one line naming its guard id or test file.
- Files: `AGENTS.md`, `apps/web/AGENTS.md`.
- Proof: a check in the guard suite confirms every rule id in `tools/guards/` appears in an `AGENTS.md`.

**32. Survivors script.** Gardener · S · no new dependency
- Build: `tools/survivors.ts`, which reproduces the section 5 numbers for any window: merged PRs, reverts per 100 merges, fast-follow fixes within 24 h and new `bug` issues. It also reports:
  - direct pushes to `develop` and PRs merged with a failing `ci`; either one being non-zero reopens D2;
  - `walkthrough-finding` issues opened and closed.
- Files: `tools/survivors.ts`, root `package.json`.
- Proof: `pnpm survivors --since 2026-06-27 --ref origin/develop` prints 0 reverts, 35 merges and 9 fast-follow fixes, matching this audit.

**33. Weekly gardener lane.** Gardener · M · no new dependency · blocked by D11
- Build: each run posts the survivors numbers and the total baseline size, then opens one PR that does one of:
  - shrink a guard baseline;
  - delete the unused locals (22 today);
  - remove a shim whose condition is met: the `/v1/commands` facade (after D10, once the A18 baseline is 0), `scripts/dev-with-storage.ts`, the dual signature in `money.ts:21-24`, or the duplicate `isRecord`;
  - register `money-input.tsx`;
  - turn a new `bug` issue theme into a guard or test.
- Files: `.github/workflows/gardener.yml` or a routine definition. Each weekly PR touches only its own target.
- Proof: a weekly issue shows the numbers, and the total baseline size falls week over week.
