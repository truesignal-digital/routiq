# Cross-session coordination — activities module

Branch: `activities-module`, in the worktree `../routiq-activities` (off `main` @ `a3aa47f`,
i.e. after ui-registry 26). The main checkout stays on `main` and is untouched — that isolation
is the point: `git worktree list` showed a single working tree, so a branch alone would have let
each session's edits land on the other's branch unnoticed.

## Status — COMPLETE. 118 test files, 1105 tests green across the monorepo

All 11 backend tickets, the reads, and the first UI slice are built and committed.

| Ticket | State |
|---|---|
| 01 module code + vocabulary | done |
| 02 tables, EXCLUDE constraint, isolation | done |
| 03 extract `writeFinancialEntry` | done (Codex) |
| 04 persons, places, presets | done |
| 05 `create-activity.v1` + scoped numbering | done |
| 06 `record-movement-leg.v1`, `record-meter-reading.v1` | done |
| 07 `substitute-asset.v1` | done |
| 08 close/reopen + `evaluateCompleteness` | done |
| 09/10 `sheet-writer` + both composite sheets | done |
| 11 queueability declarations | done |
| phase D reads | done (Codex) |
| phase E UI — list, detail, completeness banner | done |

## Handed back to the UI lane (no longer owed by this branch)

The warnings i18n namespace and its guard test were built here after all, because
the UI needed them: `warnings.<CODE>` in both catalogs plus
`apps/web/src/i18n/warning-map.test.ts`, which asserts every
`COMMAND_WARNING_CODES` member has words in fr and en. That guard did not exist —
key parity alone cannot catch a code missing from both files.

`COMMAND_QUEUEABILITY` also shipped here (`packages/contracts/src/commands/queueability.ts`)
with a registry guard, so offline-outbox ticket 04 can consume it rather than
redefine it.

## Still not built

- The sheet capture forms. The commands and reads exist; a clerk still cannot
  record a trip from the browser. This is the screen the <10-minute close target
  actually lives or dies on.
- Substitute / close / reopen dialogs on the detail screen (read-only today).
- Persons admin screen.
- §9 report 2 (activity contribution) and report 6 (data quality).

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
