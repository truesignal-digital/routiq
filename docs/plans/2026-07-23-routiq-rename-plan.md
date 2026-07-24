# ROUTIQ Rename Implementation Plan

Design: `docs/plans/2026-07-23-routiq-rename-design.md`

## Phase 1 — Protect Current State

- Capture `git status` for both worktrees.
- Export patches and untracked-file inventories for the financial-core and
  documents-screen work.
- Create a timestamped PostgreSQL custom-format backup and record table counts.

## Phase 2 — Rename Source Identity

- Change the root package to `routiq`.
- Change workspace packages and imports from `@asset/*` to `@routiq/*`.
- Change the visible application name to `ROUTIQ`.
- Change browser storage identity to `routiq.sessions.v1`.
- Change database defaults from `asset` / `asset_dev` / `asset_app` to
  `routiq` / `routiq_dev` / `routiq_app`.
- Change Docker Compose project and volume identity to ROUTIQ.
- Update the lockfile, scripts, tests, documentation, agent instructions, and
  setup migrations.
- Apply the same identity changes to the dirty `web-ui` worktree without
  losing its documents-screen work.

## Phase 3 — Move Repository and Worktree

- Move the linked UI worktree with `git worktree move`.
- Move the primary repository directory to `/Users/linusbayere/Developer/routiq`.
- Repair linked-worktree metadata from the new primary path.
- Verify both Git worktrees and their dirty-file inventories.

## Phase 4 — Database and Docker Cutover

- Stop the old Compose project without deleting its volume.
- Start the `routiq` Compose project with `routiq_pgdata`.
- Apply the renamed migration chain to `routiq_dev`.
- Restore the preserved application data.
- Verify table counts, migration state, roles, database name, container name,
  and volume name.

## Phase 5 — Verification

- Run identity searches in both worktrees.
- Install from the lockfile in both worktrees.
- Run package typechecks and tests, distinguishing known pre-existing
  financial-core incompleteness from rename regressions.
- Run a production web build.
- Apply migrations to an additional fresh ROUTIQ database.
- Verify the UI branding and Git worktree paths.
- Retain the database backup and report its location.

