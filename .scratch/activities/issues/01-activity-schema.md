# 01 — Activity tables (Drizzle schema + migration)

Status: ready-for-agent

## Task

Add to `apps/api/src/db/schema.ts`: `activities`, `activity_asset_segments`, `activity_people`, `movement_legs`. Model per ARCHITECTURE.md §3.1–§3.2; follow every convention in §4.1 and mirror the style of existing tables (e.g. `assets`, `financial_entries`).

## Requirements

- `workspace_id` on every table; composite tenant FKs (`FOREIGN KEY (workspace_id, asset_id) REFERENCES assets (workspace_id, id)` style) so cross-tenant refs are structurally impossible
- `row_version`, `created_by_command_id`, client-generatable UUID PKs
- `activities`: branch scope, activity type via `categories` ref, status (incl. completeness state for close: `COMPLETE` / `COMPLETE_WITH_EXCEPTIONS`), open/closed timestamps
- `activity_asset_segments`: role enum PRIMARY/TRAILER/SUBSTITUTE/RECOVERY, time range; **no overlapping PRIMARY segments per activity — Postgres `EXCLUDE USING gist` over the time range** (§3.2). Drizzle can't express EXCLUDE natively — add it in the generated migration SQL by hand and note it.
- `activity_people`: person ref + role (driver, conductor, assistant, relief)
- `movement_legs`: ordered within activity, origin/destination place refs, departed/arrived, distance, load state; FK to the primary segment
- Generate migration with `pnpm db:generate`; verify it applies with `pnpm db:migrate` against docker Postgres (port 5435)

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] Migration generated and applies cleanly to fresh DB
- [ ] EXCLUDE constraint present in migration SQL and rejects overlapping PRIMARY segments (prove with a small SQL test or vitest against the DB if a pattern for that exists; otherwise document manual check in Comments)
- [ ] Composite tenant FKs on all four tables
