# Cross-session coordination — activities module

Branch: `activities-module`, in the worktree `../routiq-activities` (off `main` @ `a3aa47f`,
i.e. after ui-registry 26). The main checkout stays on `main` and is untouched — that isolation
is the point: `git worktree list` showed a single working tree, so a branch alone would have let
each session's edits land on the other's branch unnoticed.

## Status — 33 test files, 288 tests green (baseline 28 / 251)

| Ticket | State |
|---|---|
| 01 module code + vocabulary | done |
| 02 tables, EXCLUDE constraint, isolation | done |
| 03 extract `writeFinancialEntry` | done (Codex; finance tests unmodified) |
| 04 persons, places, presets | done |
| 05 `create-activity.v1` + scoped numbering | done |
| 06 `record-movement-leg.v1`, `record-meter-reading.v1` | done |
| 07 `substitute-asset.v1` | not started |
| 08 close/reopen + `evaluateCompleteness` | not started |
| 09 `sheet-writer` + journey sheet + `CommandOutcome.children` | not started |
| 10 haulage job sheet | not started |
| 11 queueability declarations | not started |

Still owed from the plan: the `POSTING_DEFERRED_PERIOD_LOCKED` degradation — an entry that would
auto-post into a locked period must land SUBMITTED instead of throwing, or a composite command
would destroy the operational facts sharing its transaction. It belongs with ticket 09, the first
command that can hit it.

Two sessions are live on this repo. The split below follows the working agreement already recorded
in `.scratch/web-mtp/spec.md:5,32` — it is not a new invention.

## Ownership

| Lane | Owns | This module touches it? |
|---|---|---|
| UI session | `apps/web/**` | **Only 2 JSON lines** — see below |
| UI session | `apps/api/src/reads/**` (GET only) | **No** — activity reads are deferred to phase D |
| UI session | `packages/contracts/src/reads/**` | **No** |
| Backend (this) | `apps/api/src/commands/**`, `apps/api/src/db/**`, migrations | Yes, exclusively |
| Backend (this) | `packages/contracts/src/commands/**`, `modules.ts`, `errors.ts` | Yes |

`packages/contracts/src/errors.ts` is the one genuinely shared file. Both lanes append; keep every
change append-only at the end of the arrays so a rebase is a trivial merge.

## The trap that made this note necessary

`apps/web/src/i18n/error-map.test.ts` is a **completeness meta-test over `COMMAND_ERROR_CODES`**.
Adding an error code in contracts without a matching `errors.<CODE>` string in **both**
`apps/web/src/i18n/locales/fr.json` and `en.json` turns the *other lane's* suite red, from a commit
that never mentions `apps/web`.

`COMMAND_WARNING_CODES` is **not** covered by that test, so warning codes are safe to add alone.

Rule adopted here: an error code and its two locale strings land in the same commit, always. That is
the only reason this branch touches `apps/web` at all — a two-line append inside the existing
`errors` object, nothing else.

## Deliberately handed over to the UI lane (not built here)

1. **Warnings i18n namespace.** Eight new `COMMAND_WARNING_CODES` ship with no locale strings.
   They are stable codes over the wire and the API is complete without them. The UI work is: hoist
   warning strings from `finance.record.warnings.*` to a root `warnings.<CODE>` namespace, add fr +
   en for all eight, and add a guard test asserting every `COMMAND_WARNING_CODES` member has a key
   in both catalogs — the guard that does not exist today and is why this gap was invisible.

   New codes: `ACTIVITY_MISSING_START_READING`, `ACTIVITY_MISSING_END_READING`, `ACTIVITY_NO_LEGS`,
   `ACTIVITY_MISSING_CREW`, `ACTIVITY_NO_REVENUE`, `ACTIVITY_OPEN_SEGMENT_AUTOCLOSED`,
   `METER_READING_DECREASED`, `POSTING_DEFERRED_PERIOD_LOCKED`.

2. **`commandQueueability` registry** (offline-outbox ticket 04). Its planned meta-test requires an
   entry per command exported from contracts, so it must account for the activity commands. Intended
   values — queueable: `record-haulage-job-sheet`, `record-journey-sheet`, `create-activity`,
   `record-movement-leg`, `record-meter-reading`, `substitute-asset`, `register-person`. Not
   queueable: `close-activity`, `reopen-activity` (§6 lists activity close among the decisions that
   always need the server).

3. **`ACTIVITIES` nav section.** `sections.ts`'s `key` union, nav locales and breadcrumbs. Adding
   the module code alone renders nothing, so there is no half-state.

## Operational notes

- **Do not run `pnpm db:migrate`** from this branch. The docker Postgres on 5435 is shared with the
  other session's dev app. Migrations are verified through Testcontainers (`pnpm --filter
  @routiq/api test`), which builds a disposable database per run.
- Adding `ACTIVITIES` to `MODULE_CODES` makes `/v1/me` report it enabled for every workspace
  immediately (absent row = enabled, `modules/registry.ts`). Harmless — no nav section consumes it.
- `workspace_modules.module_code` is a Drizzle TS enum over a plain `text` column with no DB CHECK,
  so the new module code needs no migration.
